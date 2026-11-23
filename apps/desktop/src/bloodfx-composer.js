/*
 * Композиция `bloodfx.dat` из слоёв крови.
 *
 * Пакет каталога не приносит bloodfx.dat — только правку `blood-routing-v1`:
 * какие правила частиц показывают записи и какая запись отвечает за пару
 * «кость × класс оружия». Файл собирается здесь, на компьютере игрока, из
 * его собственного bloodfx.dat — из той базы update.rpf, на которую
 * складываются все слои.
 *
 *  • Правки всех установленных слоёв складываются в одну. Два мода, которые
 *    спорят за одну клетку или одно поле, — отказ до записи в игру, а не
 *    «побеждает последний».
 *  • Правка накладывается на разобранный файл: меняются только нужные поля,
 *    всё остальное остаётся байт в байт.
 *  • Правила частиц, на которые правка ведёт, сверяются с ядром эффектов,
 *    каким оно ЛЯЖЕТ В АРХИВ после этой сборки (`composedCore`: слои ядра
 *    автора, собранные тем же проходом), а нет слоёв на ядре — с ядром базы:
 *    маршрут на правило, которого нет, молча ничего не нарисует, и человек
 *    решит, что мод сломан. Сверка идёт при КАЖДОЙ сборке, и с готовым файлом
 *    из кэша тоже: ядро могли снять или заменить, а файл крови остаётся тем же.
 *    Не хватает правил — `EffectRulesMissing` (с перечнем слоёв): прямая
 *    установка отказывает, а прежние слои движок снимает каскадом.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  BLOOD_ROUTING_STRATEGY,
  applyBloodRouting,
  mergeBloodRouting,
  parseBloodFx,
  serializeBloodFx,
} from "@modovik/bloodfx";
import { EFFECTS_CORE_ENTRY, EffectRulesMissing } from "@modovik/install-engine/effect-rules.js";
import { extractRpfEntry, inspectYpt } from "./rpf-composer.js";

/* Клон своего правила автора из каталога: приставка пакета `astral_own_<6 hex>_`. */
const OWN_CLONE = /^astral_own_[a-f0-9]{6}_[a-z0-9_]+$/i;
const ROUTED_FIELDS = ["fxSystem", "fxSystemBodyArmour", "fxSystemHeavyArmour", "fxSystemUnderwater"];
/* Имена правил частиц, на которые ведёт правка слоя крови. */
const routedNames = (patch) =>
  (Array.isArray(patch?.effects) ? patch.effects : []).flatMap((edit) => ROUTED_FIELDS.map((key) => String(edit?.[key] || "")).filter(Boolean));

/* Ядро эффектов: по нему сверяются правила частиц. */
export const BLOOD_RULES_CORE_ENTRY = EFFECTS_CORE_ENTRY;

/* Правила собранного ядра по файлу: одна проверка помощником на файл, пока он тот же (путь, размер, время). */
const coreRulesMemo = new Map();

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
}

async function coreRuleSet({ composedCore, baseArchive, work, extract, inspect, archiveTarget, edition, gameRoot }) {
  let input = composedCore;
  if (!input) {
    input = path.join(work, "core.ypt");
    await extract({ archivePath: baseArchive, entry: BLOOD_RULES_CORE_ENTRY, output: input, archiveTarget, edition, gameRoot });
  }
  const stat = await fs.stat(input).catch(() => null);
  const key = stat ? `${path.resolve(input)}|${stat.size}|${Math.round(stat.mtimeMs)}` : "";
  if (key && composedCore && coreRulesMemo.has(key)) return coreRulesMemo.get(key);
  /* Собранное ядро лежит под именем-отпечатком без расширения (`payloads/<пакет>/<sha256>`), а помощник RPF читает только файл `.ypt` («Expected a .ypt archive»,
     11.11, valorant v3): под своим именем копия в рабочей папке. */
  if (composedCore && !/\.ypt$/i.test(input)) {
    input = path.join(work, "core.ypt");
    await fs.copyFile(composedCore, input);
  }
  const inspection = await inspect({ input, edition, gameRoot });
  const rules = new Set(inspection?.resource?.effectRules || []);
  if (key && composedCore) {
    if (coreRulesMemo.size >= 8) coreRulesMemo.delete(coreRulesMemo.keys().next().value);
    coreRulesMemo.set(key, rules);
  }
  return rules;
}

/*
 * Сверка правил слоёв с ядром. `perLayer` — `{ modId: [правила, на которые ведёт слой] }`. Клоны своих правил автора (`astral_own_<пакет>_…`, «наш Core»)
 * исключены: их ставит тот же пакет слоем ядра одной операцией (`ypt-own-rules-v1`, проверка манифеста держит их вместе).
 */
async function assertRoutedRules(perLayer, context) {
  const required = Object.fromEntries(
    Object.entries(perLayer).map(([modId, names]) => [modId, [...new Set(names)].filter((rule) => !OWN_CLONE.test(rule))]),
  );
  if (!Object.values(required).some((names) => names.length)) return;
  const rules = await coreRuleSet(context);
  const dependents = Object.entries(required)
    .map(([modId, names]) => ({ modId, missing: names.filter((rule) => !rules.has(rule)) }))
    .filter((item) => item.missing.length);
  if (!dependents.length) return;
  const missing = [...new Set(dependents.flatMap((item) => item.missing))];
  const message = `В ядре эффектов игры нет правил ${missing.join(", ")} — слой крови не ставится.`;
  /* Ядро не прочиталось вовсе (пустой набор) — это сбой чтения, а не «правил нет»: отказ без каскада, слои не снимаются. */
  if (!rules.size) throw new Error(message);
  throw new EffectRulesMissing(message, { dependents, missing });
}

export async function materializeBloodRoutingEntry(
  {
    layers,
    entry,
    archiveTarget,
    baseArchive,
    composedCore = null,
    targetKey,
    edition,
    gameRoot,
    stateDir,
    signal,
  },
  { extract = extractRpfEntry, inspect = inspectYpt } = {},
) {
  throwIfAborted(signal);
  if (!layers?.length) throw new Error(`Нет активных слоёв крови: ${entry}`);
  if (layers.some((layer) => layer.merge?.strategy !== BLOOD_ROUTING_STRATEGY))
    throw new Error(`Несовместимые слои крови в ${entry}.`);
  const ordered = [...layers].sort((left, right) =>
    left.modId.localeCompare(right.modId),
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        base: await sha256File(baseArchive),
        entry,
        layers: ordered.map((layer) => ({
          modId: layer.modId,
          sha256: layer.sha256,
        })),
      }),
    )
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_bloodfx-composites",
    targetKey,
    `${fingerprint}.dat`,
  );
  /* Правила каждого слоя — рядом с готовым файлом: сверка при каждой сборке не требует снова разбирать bloodfx.dat. */
  const rulesFile = `${output}.rules.json`;
  const context = (work) => ({ composedCore, baseArchive, work, extract, inspect, archiveTarget, edition, gameRoot });
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 16) {
      let known = null;
      try {
        known = JSON.parse(await fs.readFile(rulesFile, "utf8"))?.perLayer || null;
      } catch {
        /* кэш прежней сборки без файла правил — собирается заново ниже, файл правил появится */
      }
      if (known && typeof known === "object") {
        const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
        await fs.mkdir(work, { recursive: true });
        try {
          await assertRoutedRules(known, context(work));
        } finally {
          await fs.rm(work, { recursive: true, force: true });
        }
        return output;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const patches = [];
    for (const layer of ordered) {
      const bytes = await fs.readFile(layer.cachePath);
      if (
        layer.sha256 &&
        createHash("sha256").update(bytes).digest("hex") !== layer.sha256
      )
        throw new Error(`Маршруты крови ${layer.modId} повреждены.`);
      try {
        patches.push(JSON.parse(bytes.toString("utf8")));
      } catch {
        throw new Error(`Маршруты крови ${layer.modId} не читаются.`);
      }
    }
    /* Маршрут пакета своих правил ведёт только на его клоны (`astral_own_<id пакета>_…`) или на штатные правила. */
    for (const [index, layer] of ordered.entries()) {
      const prefix = `astral_own_${createHash("sha256").update(String(layer.modId)).digest("hex").slice(0, 6)}_`;
      const foreign = routedNames(patches[index]).filter((name) => OWN_CLONE.test(name) && !name.toLowerCase().startsWith(prefix));
      if (foreign.length)
        throw new Error(`Маршруты крови «${layer.modId}» ведут на чужие правила ${foreign.join(", ")} — слой крови не ставится.`);
    }
    const merged = mergeBloodRouting(patches);

    const base = path.join(work, "bloodfx.dat");
    await extract({
      archivePath: baseArchive,
      entry,
      output: base,
      archiveTarget,
      edition,
      gameRoot,
    });
    const baseText = await fs.readFile(base, "utf8");
    const document = parseBloodFx(baseText);
    const report = applyBloodRouting(document, merged);
    throwIfAborted(signal);

    /* Какие правила нужны каждому слою — по отдельности: по этому каскад знает, кого снимать, когда ядро лишилось правил. */
    const perLayer = {};
    for (const [index, layer] of ordered.entries())
      perLayer[layer.modId] = applyBloodRouting(parseBloodFx(baseText), patches[index]).requiredEffectRules;
    if (report.requiredEffectRules.length) await assertRoutedRules(perLayer, context(work));

    const staged = path.join(work, "result.dat");
    await fs.writeFile(staged, serializeBloodFx(document), "utf8");
    throwIfAborted(signal);
    await fs.writeFile(rulesFile, JSON.stringify({ perLayer }), "utf8");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
