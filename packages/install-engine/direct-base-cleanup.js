/*
 * Основа update.rpf — игра без записей Astral.
 *
 * Пересборка update.rpf кладёт все слои движка на основу — копию архива
 * игры. Большинству слоёв всё равно, что лежало под ними: они приносят
 * готовый файл. Но часть записей собирается правкой того, что лежит в
 * основе: метаданные звука (`audio-rel-patch-v1`), таймцикл, ядро эффектов,
 * кровь. Правка знает, каким файл был у игры, и отказывается, если он уже
 * другой, — так она не портит ни чужой мод, ни новую версию игры.
 *
 * Перебазирование (`direct-update-rebase.js`) снимает основу с живого
 * архива, когда его поменяли в обход движка: нативный патч неба, таймцикла,
 * мини-карты. До 27.09.2026 оно брало живой архив целиком — вместе с тем, что
 * положило туда прошлое «Применить». У владельца основа так унесла уже
 * поправленный `sounds.dat54.rel`: правка звуков попаданий на нём не
 * вставала («В объекте 0XE4C51247 ссылок на 0X1A385A10: 0, ожидалось 1»), и
 * падала любая установка в update.rpf — залазы, карта, радуга, — хотя звук
 * они даже не трогали. Тот же корень у «сброс карты не сбрасывает»: снятый
 * мод оставался в основе и возвращался.
 *
 * Очистка возвращает записи движка их прежний вид — но только ту, о которой
 * доказано, что в основе лежит ровно положенное движком:
 *
 *  • запись папки `x64/astral` — наша по определению, она уходит;
 *  • готовый файл слоя — в основе тот же SHA-256, что у файла слоя;
 *  • собранная запись — сборщик, пущенный на образце, даёт ровно то, что
 *    лежит в основе; тогда образец и хранит её прежний вид;
 *  • запись, которую слой удалял, — в основе её нет;
 *  • запись, которую прежнее перебазирование запомнило своей (`carried`), —
 *    её не было в игре, она уходит.
 *
 * Прежний вид берётся из образца: прежней основы (при перебазировании — она
 * чиста по построению) или защищённой копии архива, снятой при первой
 * подготовке, если после неё игра не обновлялась. Запись, которую поменял
 * кто-то ещё, остаётся как есть: это теперь часть игры, и слой ляжет поверх
 * неё, как лёг бы на любую.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ASTRAL_CONTAINER_ROOT } from "./astral-paths.js";
import { assertAbsoluteInside } from "./engine-state.js";
import { resolveEntryMaterializers } from "./entry-materializers.js";
import { isUnifiedPtfxEntry } from "./ptfx-core-entry.js";
import { sha256File } from "./manifest.js";
import { composedSha256, rememberSha256 } from "./file-fingerprint.js";
import { throwIfAborted } from "./runtime-guard.js";
import { exists } from "./storage-state.js";
import { ensureStoredFile, storedFileSize, storedFileTimes } from "./chunk-store.js";

export const DIRECT_BASE_TARGET = "update/update.rpf";

/*
 * Сдвиговые записи (10.11.2026, накопление «Окружения»): правка слоя АДДИТИВНА — применённая дважды, она сдвигает дважды. Категории звука
 * (`categories.dat22.rel`, `audio-rel-patch-v1`) — сдвиг громкости: у владельца в основе он лежал 13 раз, и звуки окружения стояли на −100 дБ.
 * Оставить такую запись в основе такой, какой она лежит в живом архиве (`keep`), нельзя ни при каких обстоятельствах: следующая сборка сложит
 * сдвиг поверх сдвига. Прежний вид сдвиговой записи берётся ТОЛЬКО из защищённой копии игры (образец с пометкой `stock`); нет её, или она старше
 * обновления игры, — очистка отказывает словами (`ShiftBaseRefused`), а не молчит.
 */
const SHIFT_ENTRIES = new Set(["x64/audio/config/categories.dat22.rel"]);
export const SHIFT_AUDIT_FORMAT = 1;

export class ShiftBaseRefused extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ShiftBaseRefused";
    this.code = "shift-base-refused";
    Object.assign(this, details);
  }
}

/** Запись — сдвиг слоя, который нельзя оставлять в основе (`SHIFT_ENTRIES`, стратегия `audio-rel-patch-v1`). */
export function isShiftEntry(entry, layers) {
  const strategy = Array.isArray(layers) ? layers.at(-1)?.merge?.strategy : null;
  return strategy === "audio-rel-patch-v1" && SHIFT_ENTRIES.has(String(entry || "").replaceAll("\\", "/").toLowerCase());
}

/* Копия update.rpf, снятая при первой подготовке (`resource-composition.js`,
   `ensureArchiveResource`). Уборка кэша её не трогает. */
export const PROTECTED_UPDATE_COPY = "update-update.rpf.original.rpf";

/* Меняется, когда очистка начинает решать иначе при той же основе. */
const CLEANUP_FORMAT = 1;
const CLEANUP_MOD_ID = "@without-astral";

/*
 * Инструменты помощника RPF. Перебазирование зовут восемь мест движка, и ни
 * одно не должно помнить про помощника, — поэтому приложение регистрирует
 * их один раз при запуске, как сборщики записей (`entry-materializers.js`).
 *
 *  • `rpfComposer(request)` — пересборка архива операциями;
 *  • `entryProbe({ archivePath, entries, … })` → какие из записей есть;
 *  • `entryReader({ archivePath, entries, outputDirectory, … })` →
 *    `[{ entry, file, sha256? }]`.
 */
const TOOL_NAMES = Object.freeze(["rpfComposer", "entryProbe", "entryReader"]);
/*
 * Необязательный инструмент: `entrySearch({ archivePath, query, … })` →
 * записи архива, в пути которых есть `query`. Им находятся файлы
 * контейнеров Astral, которых состояние не знает (следы прежней установки,
 * задача 1 ТЗ 10.10.2026), — без него такие контейнеры остаются в основе
 * мёртвым грузом, но игра их не читает: их строки снимаются из content.xml.
 */
const OPTIONAL_TOOL_NAMES = Object.freeze(["entrySearch"]);

let defaults = Object.freeze({});

export function setDefaultBaseTools(tools = {}) {
  const next = {};
  for (const name of [...TOOL_NAMES, ...OPTIONAL_TOOL_NAMES]) {
    const value = tools?.[name];
    if (value == null) continue;
    if (typeof value !== "function")
      throw new TypeError(`Инструмент основы ${name} должен быть функцией.`);
    next[name] = value;
  }
  defaults = Object.freeze(next);
}

/** Полный набор инструментов вызова или `null`, если чего-то нет. */
export function resolveBaseTools(explicit = {}) {
  const pick = (name) =>
    typeof explicit?.[name] === "function"
      ? explicit[name]
      : defaults[name] || null;
  const tools = Object.fromEntries(TOOL_NAMES.map((name) => [name, pick(name)]));
  if (!TOOL_NAMES.every((name) => tools[name])) return null;
  for (const name of OPTIONAL_TOOL_NAMES) if (pick(name)) tools[name] = pick(name);
  return tools;
}

/*
 * Файлы контейнеров `x64/astral/<имя>` в архиве — по поиску помощника.
 * Пусто, если поиска нет: тогда контейнеры остаются, а реестры их не
 * регистрируют.
 */
async function foreignContainerEntries({ tools, archivePath, containers, target, signal }) {
  if (!containers?.length || typeof tools.entrySearch !== "function") return [];
  const found = new Set();
  for (const name of containers) {
    throwIfAborted(signal);
    const prefix = `${ASTRAL_CONTAINER_ROOT}/${String(name).toLowerCase()}/`;
    const entries = await tools.entrySearch({
      archivePath,
      query: prefix,
      archiveTarget: DIRECT_BASE_TARGET,
      edition: target.edition,
      gameRoot: target.gameRoot,
      signal,
    });
    for (const entry of entries || []) {
      const key = String(entry || "").replaceAll("\\", "/").toLowerCase();
      if (key.startsWith(prefix) && !archiveLeaf(key)) found.add(key);
    }
  }
  return [...found].sort();
}

/*
 * Какой сборщик собирает запись — тем же правилом, что и пересборка
 * (`resource-composition.js`). Запись, которую пересборка кладёт готовым
 * файлом, доказывается хешем файла; собранную стратегией, которой здесь
 * нет, не доказать — она остаётся в основе как есть.
 */
const MATERIALIZER_BY_STRATEGY = Object.freeze({
  "astral-tracer-v1": "tracerMaterializer",
  "ypt-texture-layer-v1": "ptfxTextureMaterializer",
  "awc-stream-layer-v1": "awcMaterializer",
  "blood-routing-v1": "bloodRoutingMaterializer",
  "weapons-meta-tracer-patch-v1": "weaponsMetaMaterializer",
  "audio-rel-patch-v1": "audioRelMaterializer",
  "timecycle-modifier-v1": "timecycleMaterializer",
  "ptx-clip-rows-v1": "clipRowsMaterializer",
});

function entryKind(layers) {
  if (!layers) return { kind: "carried" };
  const top = layers.at(-1);
  if (top?.action === "delete") return { kind: "deleted" };
  const strategy = top?.merge?.strategy;
  if (isUnifiedPtfxEntry(layers))
    return { kind: "materialized", materializer: "ptfxTextureMaterializer" };
  if (MATERIALIZER_BY_STRATEGY[strategy])
    return {
      kind: "materialized",
      materializer: MATERIALIZER_BY_STRATEGY[strategy],
    };
  return { kind: "payload", sha256: top?.sha256 || null };
}

const ownedByContainer = (entry) =>
  entry.toLowerCase().startsWith(`${ASTRAL_CONTAINER_ROOT}/`);

/* Вложенный архив целиком помощник не удаляет — только файлы внутри. */
const archiveLeaf = (entry) => entry.toLowerCase().endsWith(".rpf");

/*
 * Умеет ли пересборка (помощник и движок) удалить запись-вложенный архив целиком. Пока нет: `compose.rs` разрешает `.rpf` последним звеном только не-удалению
 * (`normalize_entry(&op.entry, op.action != Action::Delete)`, отказ «RPF entry must point to a file inside the archive»). Цена (проба 04.11.2026,
 * `scripts/probe-world-map-sequence.mjs`): «карта → нативная правка мимо движка → карта → снятие карты» оставляет в update.rpf контейнер радара
 * `x64/levels/gta5/minimap.rpf` с картовыми плитками (51 из 65 не штатные) — он подменяет штатный из x64e.rpf целиком, и радар после снятия карты остаётся картовым.
 * Когда движок научится удалять контейнер (заявка №5 в `docs/optimization-04-11/engine-request-compose.md`), переключатель включают в том же коммите, что и пересборку движка.
 */
export const ENGINE_DELETES_CONTAINERS = false;

const samePath = (left, right) =>
  path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();


/*
 * Защищённая копия годится в образец, только если снята после последнего
 * обновления игры: каждое обновление Legacy приносит новый GTA5.exe, а
 * копия от прежней сборки вернула бы в основу устаревшие файлы.
 */
async function takenAfterGameUpdate(file, gameRoot) {
  try {
    /* Кусками: время из описи, а не сборки, иначе собранная сегодня копия выглядела бы моложе обновления игры. */
    const copy = await storedFileTimes(file);
    const executable = await fs.stat(path.join(gameRoot, "GTA5.exe"));
    return Boolean(copy) && executable.mtimeMs <= (copy.birthtimeMs || copy.mtimeMs);
  } catch {
    return false;
  }
}

/**
 * Образцы прежнего вида записей — от самого надёжного.
 *
 * `trusted` — образцу верят и там, где доказать нечем (готовый файл слоя
 * заменил файл игры, и прежний вид есть только в образце). Непроверенный
 * образец годится лишь собранным записям: там доказательство точное.
 */
export async function directBaseReferences({
  resource,
  gameRoot,
  paths,
  targetKey,
  previous = null,
  exclude = null,
}) {
  const protectedCopy = path.join(
    paths.bases,
    targetKey,
    PROTECTED_UPDATE_COPY,
  );
  const list = [];
  const protectedFresh = await takenAfterGameUpdate(protectedCopy, gameRoot);
  const add = async (file, trusted) => {
    if (!file) return;
    if (exclude && samePath(file, exclude)) return;
    if (list.some((item) => samePath(item.path, file))) return;
    /* Образец собирается, только когда из него читают (`archiveReader`): чаще всего он не нужен, а сборка оригинала — два гигабайта записи. */
    if (!(await storedFileSize(file).then((size) => size !== null))) return;
    /* `stock` — защищённая копия игры, снятая после последнего обновления: единственный образец, чей вид сдвиговых записей штатный по построению. */
    list.push({ path: path.resolve(file), trusted, stock: samePath(file, protectedCopy) && protectedFresh });
  };
  /* Прежняя основа: живой архив собран на ней, значит, её вид записей и
     есть тот, что правил движок. Верить ей можно, если она уже очищена или
     это сама защищённая копия. */
  if (previous?.exists)
    await add(
      previous.path,
      previous.withoutAstral === true || samePath(previous.path, protectedCopy),
    );
  if (resource?.original?.exists && resource.original.withoutAstral === true)
    await add(resource.original.path, true);
  await add(protectedCopy, protectedFresh);
  return list;
}

/*
 * Чтение записей архива партиями. Каждый архив спрашивается один раз на
 * наличие и один раз на чтение нужного: помощник открывает двухгигабайтный
 * архив за запуск, и лишний запуск — это лишние секунды.
 */
function archiveReader({ tools, archivePath, target, work, signal }) {
  const present = new Map();
  const files = new Map();
  const request = {
    archivePath,
    archiveTarget: DIRECT_BASE_TARGET,
    edition: target.edition,
    gameRoot: target.gameRoot,
    signal,
  };
  return {
    archivePath,
    async has(entries) {
      const unknown = [...new Set(entries)].filter(
        (entry) => !present.has(entry),
      );
      if (unknown.length) {
        throwIfAborted(signal);
        await ensureStoredFile(archivePath, { signal });
        const found = new Set(
          [...(await tools.entryProbe({ ...request, entries: unknown }))].map(
            (entry) => String(entry).toLowerCase(),
          ),
        );
        for (const entry of unknown)
          present.set(entry, found.has(entry.toLowerCase()));
      }
      return new Set(entries.filter((entry) => present.get(entry)));
    },
    async read(entries) {
      const wanted = [...(await this.has(entries))].filter(
        (entry) => !files.has(entry),
      );
      if (wanted.length) {
        throwIfAborted(signal);
        const outputDirectory = path.join(work, randomUUID());
        const extracted = await tools.entryReader({
          ...request,
          entries: wanted,
          outputDirectory,
        });
        for (const item of extracted || []) {
          const entry = wanted.find(
            (candidate) =>
              candidate.toLowerCase() === String(item.entry).toLowerCase(),
          );
          if (!entry) continue;
          files.set(entry, {
            file: item.file,
            sha256: item.sha256 || (await sha256File(item.file)),
          });
        }
        for (const entry of wanted)
          if (!files.has(entry))
            throw new Error(`Запись основы не прочитана: ${entry}`);
      }
      return new Map(
        entries
          .filter((entry) => files.has(entry))
          .map((entry) => [entry, files.get(entry)]),
      );
    },
  };
}

/* Что пересборка положила бы в запись, будь основой образец. */
async function materializeOnReference({
  entry,
  layers,
  materializer,
  reference,
  target,
  paths,
  targetKey,
  signal,
}) {
  await ensureStoredFile(reference.path, { signal });
  const source = await materializer({
    layers,
    entry,
    archiveTarget: DIRECT_BASE_TARGET,
    baseArchive: reference.path,
    baseSha256: null,
    targetKey,
    edition: target.edition,
    gameRoot: target.gameRoot,
    stateDir: paths.root,
    resolveLayerSource: (cachePath) =>
      assertAbsoluteInside(paths.payloads, cachePath),
    signal,
  });
  return sha256File(source);
}

/*
 * Прежний вид сдвиговой записи — из штатного образца (защищённая копия игры). Совпала с живой — трогать нечего, нет в копии — записи в игре не было.
 * Нет штатного образца — отказ словами: любой другой образец мог унаследовать накопленный сдвиг (прежняя основа его уже несёт).
 */
async function stockDecision({ entry, samples, liveSha256 }) {
  const stock = samples.find((sample) => sample.stock);
  if (!stock)
    throw new ShiftBaseRefused(
      `Запись ${entry} — сдвиг громкости слоя: применённый дважды, он копится, поэтому прежний вид берётся только из защищённой копии игры, а её нет или она снята до последнего обновления игры. Основа не очищена: проверьте файлы игры и нажмите «Применить» ещё раз.`,
      { entry },
    );
  const present = await stock.reader.has([entry]);
  if (!present.has(entry)) return { action: "remove" };
  const prior = (await stock.reader.read([entry])).get(entry);
  if (!prior) throw new ShiftBaseRefused(`Запись ${entry} не прочиталась из защищённой копии игры.`, { entry });
  if (liveSha256 && prior.sha256 === liveSha256) return { action: "none" };
  return { action: "restore", from: stock.path, ...prior };
}

/**
 * Лечение основы, в которой сдвиговая запись уже накопилась (до 10.11.2026 очистка оставляла её в основе, `keep`): сверяет такие записи основы со
 * штатными из защищённой копии и возвращает штатные. Основа с меткой `withoutAstral` больше не очищалась, поэтому сдвиг в ней лежал вечно.
 *
 * @returns {Promise<{ audited: boolean, changed: boolean, missing?: boolean, path?: string, sha256?: string, healed?: Array<{entry: string, from: string|null, to: string|null}> }>}
 *   `audited: false` — проверить не с чем (нет помощника или штатного образца): метку проверки ставить нельзя, проверка повторится
 */
export async function healShiftEntries({ target, base, references = [], paths, targetKey, baseTools = {}, signal = null }) {
  const tools = resolveBaseTools(baseTools);
  if (!tools || !base?.path) return { audited: false, changed: false };
  const owned = [];
  for (const [entry, record] of Object.entries(target.archives?.[DIRECT_BASE_TARGET]?.entries || {}))
    if (isShiftEntry(entry, Array.isArray(record?.layers) ? record.layers : [])) owned.push(entry);
  if (!owned.length) return { audited: true, changed: false };
  const stock = references.find((reference) => reference.stock);
  if (!stock) return { audited: false, changed: false };
  /* Основа пропала (ни файла, ни описи; опись есть, а куски потеряны): читать нечем, лечение пропускается, метку ставить нельзя. Проверка стоит ПОСЛЕ выходов, что основу не читают (нет сдвиговых записей, нет штатного образца): иначе остывшая основа
     собиралась бы из кусков (до 2 ГБ) ради ответа «читать нечего». Она же собирает остывшую основу один раз (дальше `archiveReader` находит файл) и бросает наружу отмену и нехватку места — их за «основы нет» принимать нельзя. */
  if (!(await ensureStoredFile(base.path, { signal }))) return { audited: false, changed: false, missing: true };
  const directory = path.join(paths.bases, targetKey, "update-rebases");
  await fs.mkdir(directory, { recursive: true });
  const work = path.join(directory, `.heal-${randomUUID()}`);
  try {
    const here = archiveReader({ tools, archivePath: base.path, target, work, signal });
    const there = archiveReader({ tools, archivePath: stock.path, target, work, signal });
    const inBase = await here.has(owned);
    const ours = await here.read([...inBase]);
    const inStock = await there.has(owned);
    const theirs = await there.read([...inStock]);
    const operations = [];
    const healed = [];
    for (const entry of owned) {
      const now = ours.get(entry)?.sha256 || null;
      const was = theirs.get(entry)?.sha256 || null;
      if (now === was) continue;
      healed.push({ entry, from: now, to: was });
      if (was) operations.push({ entry, action: inBase.has(entry) ? "replace" : "upsert", source: theirs.get(entry).file, sha256: was, modId: CLEANUP_MOD_ID });
      else operations.push({ entry, action: "delete", allowDelete: true, allowMissing: true, modId: CLEANUP_MOD_ID });
    }
    if (!operations.length) return { audited: true, changed: false };
    const stage = path.join(directory, `.heal-${randomUUID()}.stage`);
    try {
      const composed = await tools.rpfComposer({
        baseArchive: base.path,
        outputArchive: stage,
        archiveTarget: DIRECT_BASE_TARGET,
        edition: target.edition,
        gameRoot: target.gameRoot,
        operations,
        allowDeletes: operations.some((operation) => operation.action === "delete"),
        signal,
      });
      const sha256 = composedSha256(composed) || (await sha256File(stage));
      const output = path.join(directory, `${sha256}.rpf`);
      if (await exists(output)) await fs.rm(stage, { force: true });
      else await fs.rename(stage, output);
      await rememberSha256(output, sha256).catch(() => {});
      return { audited: true, changed: true, path: output, sha256, healed };
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Очищает основу update.rpf от записей Astral.
 *
 * @param {object} options
 * @param {object} options.target цель движка (записи слоёв — `archives`)
 * @param {{path: string, sha256: string, carried?: string[]}} options.source
 *   архив, из которого снимается основа: живой update.rpf при
 *   перебазировании или основа, снятая прежним перебазированием
 * @param {Array<{path: string, trusted: boolean}>} options.references
 * @param {Record<string, {path: string, sha256: string} | {absent: true}>} [options.overrides]
 *   прежний вид записи, известный точнее образца: основа когда-то вобрала правку
 *   работы мастерской, а архив перемотан мимо неё (`direct-update-rebase.js`)
 * @param {boolean} [options.trackAbsorbed] запомнить, что основа вбирает сейчас
 * @param {string[]} [options.watch] записи, которые правят работы мастерской: их
 *   вбирание запоминается и там, где слоя движка на записи пока нет
 * @param {boolean} [options.layersInLive] слои движка лежат в живом архиве: он получен из собранного
 *   движком архива нашими нативными правками (а не перемотан к виду до сборки слоя)
 * @param {Record<string, {modId: string, sha256: string}> | null} [options.previousWorkOver]
 *   записи, где прежняя основа уже знала работу поверх слоя: запись, не изменившаяся с тех пор
 *   (снятие работы перемотало архив к виду, который основа вобрала), остаётся за работой
 * @param {boolean} [options.dryRun] только решить, ничего не собирая
 * @returns {Promise<null | {
 *   changed: boolean, path?: string, sha256?: string,
 *   restored: string[], removed: string[],
 *   kept: Array<{entry: string, reason: string}>,
 * }>} `null` — инструментов помощника нет, очистка невозможна
 */
export async function cleanDirectUpdateBase({
  target,
  source,
  references = [],
  overrides = null,
  trackAbsorbed = false,
  watch = [],
  previousWorkOver = null,
  layersInLive = false,
  /* Контейнеры Astral, которых состояние не знает: их файлы уходят из
     основы, как записи, которых в игре не было (задача 1 ТЗ 10.10.2026). */
  foreignContainers = [],
  paths,
  targetKey,
  baseTools = {},
  materializers: explicitMaterializers = {},
  dryRun = false,
  signal = null,
  deleteContainers = ENGINE_DELETES_CONTAINERS,
}) {
  const tools = resolveBaseTools(baseTools);
  if (!tools) return null;
  const materializers = resolveEntryMaterializers(explicitMaterializers);
  const owned = new Map();
  for (const [entry, record] of Object.entries(
    target.archives?.[DIRECT_BASE_TARGET]?.entries || {},
  )) {
    const layers = Array.isArray(record?.layers) ? record.layers : [];
    if (layers.length) owned.set(entry, layers);
  }
  for (const entry of source.carried || [])
    if (!owned.has(entry)) owned.set(entry, null);
  for (const entry of await foreignContainerEntries({
    tools,
    archivePath: source.path,
    containers: foreignContainers,
    target,
    signal,
  }))
    if (!owned.has(entry)) owned.set(entry, null);
  const result = { changed: false, restored: [], removed: [], kept: [] };
  /* Записи работ мастерской без слоя движка: основа берёт их из живого архива как
     есть. Слоя на них пока нет, но мод, поставленный позже, спрячет под собой
     правку — и снятие работы должно знать, что было до неё. */
  const watched = trackAbsorbed
    ? [...new Set(watch.map(String))].filter((entry) => entry && !owned.has(entry))
    : [];
  if (!owned.size && !watched.length) return result;

  const directory = path.join(paths.bases, targetKey, "update-rebases");
  await fs.mkdir(directory, { recursive: true });
  const work = path.join(directory, `.without-astral-${randomUUID()}`);
  try {
    const base = archiveReader({
      tools,
      archivePath: source.path,
      target,
      work,
      signal,
    });
    const samples = references.map((reference) => ({
      ...reference,
      reader: archiveReader({
        tools,
        archivePath: reference.path,
        target,
        work,
        signal,
      }),
    }));
    const entries = [...owned.keys()].sort((a, b) => a.localeCompare(b));
    const inBase = await base.has(entries);
    const hashes = await base.read(
      entries.filter((entry) => {
        if (ownedByContainer(entry) || !inBase.has(entry)) return false;
        const { kind } = entryKind(owned.get(entry));
        return kind === "payload" || kind === "materialized";
      }),
    );

    /* Решение по записи: `restore` — прежний вид из образца, `remove` —
       в игре её не было, `keep` — не наша или не доказать. */
    const decisions = new Map();
    const needPrior = [];
    for (const entry of entries) {
      const layers = owned.get(entry);
      const { kind, sha256, materializer } = entryKind(layers);
      if (ownedByContainer(entry)) {
        decisions.set(
          entry,
          inBase.has(entry) ? { action: "remove" } : { action: "none" },
        );
        continue;
      }
      if (kind === "carried") {
        decisions.set(
          entry,
          inBase.has(entry) ? { action: "remove" } : { action: "none" },
        );
        continue;
      }
      if (kind === "deleted") {
        if (inBase.has(entry))
          decisions.set(entry, {
            action: "keep",
            reason: "возвращена снаружи",
          });
        else needPrior.push(entry);
        continue;
      }
      if (!inBase.has(entry)) {
        decisions.set(entry, { action: "keep", reason: "нет в основе" });
        continue;
      }
      if (kind === "payload") {
        if (sha256 && hashes.get(entry)?.sha256 === sha256)
          needPrior.push(entry);
        else {
          const top = layers.at(-1);
          decisions.set(entry, {
            action: "keep",
            reason: "в основе не файл слоя",
            /* Под слоем движка лежит чужая или наша нативная правка: основа
               её вбирает. Что было до неё — запоминается (`absorbed`). */
            absorbed: true,
            /* Какому слою достался архив: если правка легла после него, это
               работа мастерской поверх слоя (`workOver`, ниже). */
            over: sha256 && top?.modId ? { modId: String(top.modId), sha256 } : null,
          });
        }
        continue;
      }
      if (isShiftEntry(entry, layers)) {
        decisions.set(entry, await stockDecision({ entry, samples, liveSha256: hashes.get(entry)?.sha256 || null }));
        continue;
      }
      const build = materializers[materializer];
      if (typeof build !== "function") {
        decisions.set(entry, { action: "keep", reason: "нет сборщика" });
        continue;
      }
      let proven = null;
      /* Почему сборка на образце не вышла: не молчим, причина идёт в `kept` (раньше `catch → continue` её съедал, и запись оставалась в основе). */
      const failures = [];
      for (const sample of samples) {
        throwIfAborted(signal);
        let output = null;
        try {
          output = await materializeOnReference({
            entry,
            layers,
            materializer: build,
            reference: sample,
            target,
            paths,
            targetKey,
            signal,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          failures.push(`${path.basename(sample.path)}: ${String(error?.message || error).slice(0, 160)}`);
          continue;
        }
        if (output !== hashes.get(entry)?.sha256) continue;
        const prior = (await sample.reader.read([entry])).get(entry);
        if (prior) {
          proven = { action: "restore", from: sample.path, ...prior };
          break;
        }
      }
      /*
       * На образцах не сошлось: поверх слоя запись поправила нативная работа
       * мастерской (трассер каталога, а сверху «Применить» эффектов). Сборщик,
       * который умеет снять с живой записи ровно свой вклад
       * (`withoutLayers` — у ядра игрока: слоты каталога и картинка слоя,
       * доказанная байтами), отдаёт запись без него, работа мастерской
       * остаётся. Иначе вклад слоя оставался бы в основе и переживал снятие
       * мода (Х20, 29.10.2026).
       */
      if (!proven && typeof build.withoutLayers === "function") {
        try {
          for (const sample of samples) await ensureStoredFile(sample.path, { signal });
          const without = await build.withoutLayers({
            layers,
            entry,
            archiveTarget: DIRECT_BASE_TARGET,
            liveArchive: source.path,
            references: samples.map((sample) => ({
              path: sample.path,
              trusted: sample.trusted,
            })),
            targetKey,
            edition: target.edition,
            gameRoot: target.gameRoot,
            stateDir: paths.root,
            signal,
          });
          if (without?.file)
            proven = {
              action: "restore",
              from: "without-layers",
              file: without.file,
              sha256: without.sha256 || (await sha256File(without.file)),
            };
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
      decisions.set(
        entry,
        proven || { action: "keep", reason: failures.length ? `сборка на образцах не вышла: ${failures.join("; ")}` : "сборка на образцах не совпала" },
      );
    }

    /* Прежний вид готовых файлов и удалённых записей — из первого образца,
       которому можно верить и который сам не несёт файл слоя. */
    const trusted = samples.filter((sample) => sample.trusted);
    /* Первый надёжный образец читается одной партией: по записи на запуск
       помощника тысяча плиток тумана воды или словари набора оптимизации
       шли бы десятки минут (05.10.2026). Остальные — по требованию. */
    if (trusted.length && needPrior.length) {
      const present = await trusted[0].reader.has(needPrior);
      await trusted[0].reader.read([...present]);
    }
    for (const entry of needPrior) {
      const layers = owned.get(entry);
      const { kind, sha256 } = entryKind(layers);
      let decided = null;
      /* Прежний вид известен точнее образца: основа вобрала правку работы,
         мимо которой архив теперь перемотан, и образец несёт её. */
      const known = overrides?.[entry];
      if (known?.absent) {
        decisions.set(entry, { action: "remove" });
        continue;
      }
      if (known?.path && known.sha256 !== sha256 && (await exists(known.path))) {
        decisions.set(entry, {
          action: "restore",
          from: "prior",
          file: known.path,
          sha256: known.sha256,
        });
        continue;
      }
      for (const sample of trusted) {
        const present = await sample.reader.has([entry]);
        if (!present.has(entry)) {
          /* В игре записи не было: слой её добавлял. Заменить отсутствующее
             или вернуть то, чего не было, нельзя — образец не тот. */
          if (kind === "deleted" || layers.at(-1)?.action === "replace")
            continue;
          decided = { action: "remove" };
          break;
        }
        const prior = (await sample.reader.read([entry])).get(entry);
        if (!prior || (sha256 && prior.sha256 === sha256)) continue;
        decided = { action: "restore", from: sample.path, ...prior };
        break;
      }
      decisions.set(
        entry,
        decided || { action: "keep", reason: "нет надёжного образца" },
      );
    }

    /* Что основа вбирает сейчас и что лежало до этого — прежний вид из первого
       надёжного образца. Файл кладётся рядом с основами под своим хешем: при
       перемотке мимо вобранной правки он и станет прежним видом записи. */
    if (trackAbsorbed) {
      const priors = path.join(paths.bases, targetKey, "entry-priors");
      result.absorbed = {};
      /*
       * «Последний применённый побеждает» (04.11.2026). Слой лёг первым, потом
       * нативная работа мастерской переписала его запись: в живом архиве сейчас
       * работа, а не файл слоя. Раньше сборка клала слой обратно и молча стирала
       * работу (проба 04.11.2026, сценарий C разбора `incident-2026-11-04-hud-work-lost.md`). Основа
       * помнит такую запись вместе со слоем, которому достался архив: пока
       * сверху тот же слой, сборка записи не трогает (`resource-composition.js`);
       * пришёл новый мод — он снова последний.
       *
       * Работа — это запись, которую правила наша нативная правка (она в `watch`) и которая
       * не равна ни файлу слоя, ни прежнему виду из надёжного образца. Равна образцу —
       * архив перемотан к виду до слоя (снятие работы под модом), слой ещё не лёг, и работы
       * над ним нет; образца нет — доказать нечем, запись остаётся за слоем, как раньше.
       * Исключение — образец сам несёт работу: прежняя основа уже знала её поверх этого же
       * слоя (`previousWorkOver`), и запись с тех пор не изменилась (снимают верхнюю из двух
       * версий работы — под ней остаётся нижняя).
       *
       * И слой должен лежать в живом архиве (`layersInLive`): работа правила собранный архив.
       * Перемотка снятия работы возвращает архив к виду до сборки слоя (мод встал позже работы,
       * сид 59 стенда) — слою только предстоит лечь поверх, он последний.
       */
      const touched = new Set(
        watch.map((entry) => String(entry).replaceAll("\\", "/").toLowerCase()),
      );
      result.workOver = {};
      /* Прежний вид записи до вбирания: исправленный (`overrides` — образец несёт
         правку перемотанной операции), иначе — из первого надёжного образца. */
      const priorOf = async (entry) => {
        const known = overrides?.[entry];
        if (known?.absent) return { absent: true };
        if (known?.path && (await exists(known.path))) return { path: known.path, sha256: known.sha256 };
        for (const sample of trusted) {
          const present = await sample.reader.has([entry]);
          if (!present.has(entry)) return { absent: true };
          const read = (await sample.reader.read([entry])).get(entry);
          if (!read) continue;
          await fs.mkdir(priors, { recursive: true });
          const stored = path.join(priors, `${read.sha256}.bin`);
          if (!(await exists(stored))) {
            const stage = `${stored}.${randomUUID()}.stage`;
            await fs.copyFile(read.file, stage);
            await fs.rename(stage, stored);
          }
          return { path: stored, sha256: read.sha256 };
        }
        return null;
      };
      /* Те же записи у первого надёжного образца — одной партией. */
      const absorbing = [...watched, ...entries.filter((entry) => decisions.get(entry)?.absorbed)];
      if (trusted.length && absorbing.length) {
        const present = await trusted[0].reader.has(absorbing);
        await trusted[0].reader.read([...present]);
      }
      /* Запись работы без слоя: вбирается, если в живом архиве она не та, что была
         до этого. */
      if (watched.length && trusted.length) {
        const here = await base.has(watched);
        const ours = await base.read(watched.filter((entry) => here.has(entry)));
        for (const entry of watched) {
          const prior = await priorOf(entry);
          if (!prior) continue;
          const now = ours.get(entry)?.sha256 || null;
          const was = prior.absent ? null : prior.sha256;
          if (now === was) continue;
          result.absorbed[entry] = prior;
        }
      }
      for (const entry of entries) {
        const decision = decisions.get(entry);
        if (!decision?.absorbed) continue;
        const prior = await priorOf(entry);
        if (prior) result.absorbed[entry] = prior;
        const live = hashes.get(entry)?.sha256 || null;
        if (!decision.over || !prior || !live || !touched.has(entry.toLowerCase())) continue;
        const known = previousWorkOver?.[entry];
        const stillOver = known?.modId === decision.over.modId && known?.sha256 === decision.over.sha256;
        if ((layersInLive && live !== (prior.absent ? null : prior.sha256)) || stillOver) result.workOver[entry] = decision.over;
      }
    }

    const operations = [];
    for (const entry of entries) {
      const decision = decisions.get(entry);
      if (decision.action === "remove") {
        if (archiveLeaf(entry) && !deleteContainers) {
          result.kept.push({ entry, reason: "вложенный архив не удаляется" });
          continue;
        }
        operations.push({
          entry,
          action: "delete",
          allowDelete: true,
          allowMissing: true,
          modId: CLEANUP_MOD_ID,
        });
        result.removed.push(entry);
      } else if (decision.action === "restore") {
        operations.push({
          entry,
          action: inBase.has(entry) ? "replace" : "upsert",
          source: decision.file,
          sha256: decision.sha256,
          modId: CLEANUP_MOD_ID,
        });
        result.restored.push(entry);
      } else if (decision.action === "keep") {
        result.kept.push({ entry, reason: decision.reason });
      }
    }
    if (!operations.length || dryRun) {
      if (dryRun) result.operations = operations;
      return result;
    }

    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          format: CLEANUP_FORMAT,
          source: source.sha256,
          operations: operations.map(({ entry, action, sha256 }) => ({
            entry,
            action,
            sha256: sha256 || null,
          })),
        }),
      )
      .digest("hex");
    /* Та же очистка той же основы собирается один раз: повтор установки
       после отказа на следующем шаге не ждёт минуту заново. */
    const memo = path.join(directory, `${source.sha256}.without-astral.json`);
    try {
      const known = JSON.parse(await fs.readFile(memo, "utf8"));
      const cached = path.join(directory, `${known.sha256}.rpf`);
      if (
        known.fingerprint === fingerprint &&
        /^[0-9a-f]{64}$/.test(known.sha256) &&
        (await exists(cached))
      )
        return { ...result, changed: true, path: cached, sha256: known.sha256 };
    } catch {}
    const stage = path.join(directory, `.without-astral-${randomUUID()}.stage`);
    try {
      const composed = await tools.rpfComposer({
        baseArchive: source.path,
        outputArchive: stage,
        archiveTarget: DIRECT_BASE_TARGET,
        edition: target.edition,
        gameRoot: target.gameRoot,
        operations,
        allowDeletes: operations.some(
          (operation) => operation.action === "delete",
        ),
        signal,
      });
      /* Отпечаток — от помощника, по записанным байтам (02.11.2026): второе чтение двух гигабайт не нужно. */
      const sha256 = composedSha256(composed) || (await sha256File(stage));
      const output = path.join(directory, `${sha256}.rpf`);
      if (await exists(output)) await fs.rm(stage, { force: true });
      else await fs.rename(stage, output);
      await rememberSha256(output, sha256).catch(() => {});
      await fs.writeFile(memo, JSON.stringify({ fingerprint, sha256 }));
      return { ...result, changed: true, path: output, sha256 };
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
