import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
/* Отпечаток основы из памяти (`file-fingerprint.js`): установка пересобирает все записи архива, и каждая читала двухгигабайтный update.rpf заново (02.11.2026). */
import { fingerprintSha256 as sha256File } from "@modovik/install-engine/file-fingerprint.js";
import {
  ASTRAL_PTFX_CORE_CHANNEL,
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_TRACER_SLOTS,
  findStudioTracerWeapon,
  isCatalogTracerRule,
  isPlayerCoreLayer,
} from "@modovik/tracer-contract";
import {
  extractRpfEntry,
  inspectYpt,
  patchWeaponTracerBindings,
  patchYptTextures,
} from "./rpf-composer.js";
import { readTracerBindings } from "./tracer-weapons.js";
import {
  catalogTracerAssignments,
  materializePlayerCoreEntry,
} from "./ptfx-player-core.js";

/* Меняется, когда сборка `weapons.meta` начинает давать другие байты. */
const WEAPONS_FORMAT = 2;

function assertActiveLayers(layers, entry) {
  if (!layers.length) throw new Error(`Нет активных слоёв трассера: ${entry}`);
  const role = layers[0].merge?.role;
  /* Путь установки у всех слоёв записи один: ядро игрока (слоты каталога
     100…115) или системное ядро (000…015). */
  const player = isPlayerCoreLayer(layers[0].merge);
  const occupiedWeapons = new Set();
  for (const layer of layers) {
    const merge = layer.merge;
    const known = player
      ? isPlayerCoreLayer(merge)
      : merge?.coreChannel === ASTRAL_PTFX_CORE_CHANNEL &&
        merge?.coreVersion === ASTRAL_PTFX_CORE_VERSION;
    if (merge?.strategy !== "astral-tracer-v1" || merge.role !== role || !known) {
      throw new Error(`Несовместимые слои трассера в ${entry}.`);
    }
    for (const weapon of merge.weapons) {
      if (occupiedWeapons.has(weapon)) {
        throw new Error(
          `Для ${weapon} одновременно выбрано несколько трассеров.`,
        );
      }
      occupiedWeapons.add(weapon);
    }
  }
  return { role, player };
}

function assignmentFor(layers) {
  const ordered = [...layers].sort((left, right) =>
    left.modId.localeCompare(right.modId),
  );
  if (ordered.length > ASTRAL_TRACER_SLOTS.length) {
    throw new Error(
      `Одновременно поддерживается не более ${ASTRAL_TRACER_SLOTS.length} разных трассеров.`,
    );
  }
  return ordered.map((layer, index) => ({
    layer,
    slot: ASTRAL_TRACER_SLOTS[index],
  }));
}

/*
 * Стволы, которые держат слот каталога, а в наборе их нет, — следы трассера,
 * вобранного основой (мастерская «Применила» поверх, и основа взяла архив
 * целиком). Слоты 100…115 ставит только каталог, поэтому такому стволу
 * возвращается прежний след: из образца игры (`prior`, если там не слот
 * каталога), иначе штатный из таблицы. Привязки мастерской (000…015) и чужие
 * правила не трогаются.
 */
export function strayCatalogBindings(xml, bound, prior = null) {
  const strays = [];
  for (const [weapon, now] of readTracerBindings(xml)) {
    if (bound.has(weapon) || !isCatalogTracerRule(now.tracerFx)) continue;
    const was = prior?.get(weapon);
    const stock =
      was && !isCatalogTracerRule(was.tracerFx)
        ? was
        : findStudioTracerWeapon(weapon)?.vanilla;
    if (!stock) continue;
    strays.push({
      weapon,
      tracerFx: stock.tracerFx,
      chanceSP: stock.chanceSP,
      chanceMP: stock.chanceMP,
    });
  }
  return strays;
}

/*
 * `weapons.meta` без привязок каталога — для очистки основы
 * (`direct-base-cleanup.js`, `withoutLayers`): живой файл, вобравший работу
 * мастерской поверх трассера каталога, отдаётся с прежним следом у стволов
 * каталога. Нечего снимать — `null`.
 */
export async function weaponsWithoutCatalog({
  layers,
  entry,
  archiveTarget,
  liveArchive,
  references = [],
  targetKey,
  edition,
  gameRoot,
  stateDir,
  tools: explicitTools = {},
}) {
  const own = layers.every(
    (layer) =>
      layer.merge?.strategy === "astral-tracer-v1" &&
      layer.merge.role === "weapons" &&
      isPlayerCoreLayer(layer.merge),
  );
  if (!layers.length || !own) return null;
  const tools = {
    extract: extractRpfEntry,
    patch: patchWeaponTracerBindings,
    ...explicitTools,
  };
  const directory = path.join(
    stateDir,
    "payloads",
    "_tracer-without",
    String(targetKey),
  );
  const work = path.join(directory, `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const live = path.join(work, "live.meta");
    await tools.extract({ archivePath: liveArchive, entry, output: live, archiveTarget, edition, gameRoot });
    const trusted = references.find((item) => item?.trusted && item.path);
    let prior = null;
    if (trusted) {
      const file = path.join(work, "prior.meta");
      prior = await tools
        .extract({ archivePath: trusted.path, entry, output: file, archiveTarget, edition, gameRoot })
        .then(async () => readTracerBindings(await fs.readFile(file, "utf8")))
        .catch(() => null);
    }
    const strays = strayCatalogBindings(await fs.readFile(live, "utf8"), new Set(), prior);
    if (!strays.length) return null;
    const output = path.join(directory, `${randomUUID()}.meta`);
    await tools.patch({ input: live, output, edition, gameRoot, bindings: strays });
    return { file: output };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function materializeTracerEntry(request) {
  const {
    layers,
    entry,
    archiveTarget,
    baseArchive,
    targetKey,
    edition,
    gameRoot,
    stateDir,
    signal,
  } = request;
  if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
  const { role, player } = assertActiveLayers(layers, entry);
  /* Ядро игрока собирает общий сборщик ядра — вместе со слоями текстур. */
  if (player && role === "core") return materializePlayerCoreEntry(request);
  const assignments = player
    ? catalogTracerAssignments(layers)
    : assignmentFor(layers);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        ...(player ? { format: WEAPONS_FORMAT } : {}),
        base: await sha256File(baseArchive),
        entry,
        layers: assignments.map(({ layer, slot }) => ({
          modId: layer.modId,
          sha256: layer.sha256,
          merge: layer.merge,
          slot,
        })),
      }),
    )
    .digest("hex");
  const extension = role === "core" ? ".ypt" : ".meta";
  const entryKey = createHash("sha256")
    .update(entry.toLowerCase())
    .digest("hex");
  const output = path.join(
    stateDir,
    "payloads",
    "_tracer-composites",
    targetKey,
    entryKey,
    `${fingerprint}${extension}`,
  );
  try {
    const stat = await fs.lstat(output);
    if (stat.isFile() && stat.size > 16) return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const work = path.join(path.dirname(output), `.stage-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  const base = path.join(work, `base${extension}`);
  const staged = path.join(work, `result${extension}`);
  try {
    await extractRpfEntry({
      archivePath: baseArchive,
      entry,
      output: base,
      archiveTarget,
      edition,
      gameRoot,
    });
    if (role === "core") {
      const inspection = await inspectYpt({ input: base, edition, gameRoot });
      const textureNames = new Set(
        (inspection.resource?.textures || []).map((item) => item.name),
      );
      const effectRules = new Set(inspection.resource?.effectRules || []);
      for (const { slot } of assignments) {
        if (!textureNames.has(slot.texture) || !effectRules.has(slot.rule)) {
          throw new Error(
            `Astral PTFX Core ${ASTRAL_PTFX_CORE_VERSION} не установлен или повреждён: отсутствует ${slot.rule}/${slot.texture}.`,
          );
        }
      }
      await patchYptTextures({
        input: base,
        output: staged,
        edition,
        gameRoot,
        patches: assignments.map(({ layer, slot }) => ({
          texture: slot.texture,
          source: layer.cachePath,
          sha256: layer.sha256,
        })),
      });
    } else {
      const bindings = assignments.flatMap(({ layer, slot }) =>
        layer.merge.weapons.map((weapon) => ({
          weapon,
          tracerFx: slot.rule,
          chanceSP: layer.merge.chanceSP,
          chanceMP: layer.merge.chanceMP,
        })),
      );
      const strays = player
        ? strayCatalogBindings(
            await fs.readFile(base, "utf8"),
            new Set(bindings.map((item) => item.weapon)),
          )
        : [];
      await patchWeaponTracerBindings({
        input: base,
        output: staged,
        edition,
        gameRoot,
        bindings: [...bindings, ...strays],
      });
    }
    if (signal?.aborted) throw signal.reason || new Error("Операция отменена.");
    await fs.rename(staged, output);
    return output;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/* Снятие вклада каталога из основы, вобравшей правку мастерской. */
materializeTracerEntry.withoutLayers = weaponsWithoutCatalog;
