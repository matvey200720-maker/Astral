import { createHash } from "node:crypto";
import { OPTIMIZATION_LAYER_FILES } from "./optimization-layer-files.js";

/*
 * Слои оптимизации мастерской — каждый своим пакетом.
 *
 * Слой бывает трёх видов, и у каждого своя строгая форма:
 *
 *   контейнер  — модели, карты и текстуры в своём `x64/astral/astral_opt_<слой>.rpf`
 *                (газоны, мусор, грязь, полки, частицы, лёгкие текстуры):
 *                только имена из описи (`optimization-layer-files.js`) и
 *                только расширения своего слоя;
 *   запись     — один файл игры на своём месте в `update.rpf`, правленный
 *                на файле игрока (трава, дым колёс, грязь на кузове, следы,
 *                тряска, эмбиент, попадания пуль): действие `replace`; файл,
 *                которого в update.rpf нет (местности частиц), — `upsert`,
 *                и только у слоя, где это записано;
 *   таймцикл   — модификаторы опьянения и наркотиков слоем объединения
 *                `timecycle-modifier-v1`: движок кладёт их поверх файла
 *                игрока по имени, чужие модификаторы остаются.
 *
 * Символ доверия предъявить может только install-engine; манифест не той
 * формы — обычный неподписанный пакет, и движок его отвергнет.
 */
export const LOCAL_OPTIMIZATION_TRUST = Symbol("local-optimization-package");
export const OPTIMIZATION_SCHEMA = 1;

const MiB = 1024 * 1024;
const UPDATE = "update/update.rpf";

/* Модификаторы таймцикла слоя «Алко- и наркоэффекты» — копия списка из
   `@modovik/optimizer/layer-patches.js` (совпадение держит тест). */
export const OPTIMIZATION_DRUG_MODIFIERS = Object.freeze([
  "Drunk",
  "drug_flying_base",
  "drug_flying_01",
  "drug_flying_02",
  "DRUG_gas_huffin",
  "Drug_deadman",
  "Drug_deadman_blend",
  "DRUG_2_drive",
  "drug_drive_blend01",
  "drug_drive_blend02",
  "drug_wobbly",
]);
/* Модификаторы слоя «Экран при ранении» (`timecycle_mods_1.xml`) — копия
   списка из `@modovik/optimizer/layer-patches.js` (совпадение держит тест). */
export const OPTIMIZATION_DAMAGE_SCREEN_MODIFIERS = Object.freeze(["damage", "hitped", "dying", "pulse"]);
const TIMECYCLE_PRIORITY = 300;

const containerOf = (layerId) => `x64/astral/astral_opt_${layerId.replace(/-/g, "_")}.rpf`;

/*
 * Слои: вид, имя пакета, изменение мира (модели без столкновений — да),
 * предел файла и допустимые расширения (у контейнера) или запись (у записи).
 */
export const OPTIMIZATION_LAYERS_TRUST = Object.freeze({
  grass: { kind: "entry", name: "Мелкая трава", entry: "x64/models/plantsmgr.ydd", maxBytes: 4 * MiB, gameplay: false },
  "lawn-grass": { kind: "container", name: "Трава на газонах и сорняки", ext: /\.(ymap|ydr|yft)$/, maxBytes: 64 * 1024, gameplay: false },
  retexture: { kind: "container", name: "Лёгкие текстуры", ext: /\.ytd$/, maxBytes: 2 * MiB, gameplay: false, texture: true },
  /* Ступени «Ухудшения текстур» (задача 9): те же словари, что у мода, из игры
     игрока со срезанными верхними mip — имена из описи мода, свой контейнер. */
  "textures-128": { kind: "container", name: "Ухудшение текстур: до 128 px", ext: /\.ytd$/, maxBytes: 16 * MiB, gameplay: false, texture: true, names: "retexture" },
  "textures-64": { kind: "container", name: "Ухудшение текстур: до 64 px", ext: /\.ytd$/, maxBytes: 16 * MiB, gameplay: false, texture: true, names: "retexture" },
  "textures-32": { kind: "container", name: "Ухудшение текстур: до 32 px", ext: /\.ytd$/, maxBytes: 16 * MiB, gameplay: false, texture: true, names: "retexture" },
  "textures-16": { kind: "container", name: "Ухудшение текстур: до 16 px", ext: /\.ytd$/, maxBytes: 16 * MiB, gameplay: false, texture: true, names: "retexture" },
  particles: { kind: "container", name: "Частицы эффектов", ext: /\.ypt$/, maxBytes: 64 * 1024, gameplay: false },
  "wheel-smoke": { kind: "entry", name: "Дым из-под колёс", entry: "common/data/effects/wheelfx.dat", maxBytes: MiB, gameplay: false },
  "litter-small": { kind: "container", name: "Мелкий мусор", ext: /\.(ydr|yft)$/, maxBytes: 64 * 1024, gameplay: true },
  "litter-large": { kind: "container", name: "Крупный мусор", ext: /\.(ydr|yft)$/, maxBytes: 4 * MiB, gameplay: true },
  "street-dirt": { kind: "container", name: "Грязь на улицах", ext: /\.(ydr|yft)$/, maxBytes: 64 * 1024, gameplay: true },
  "shelf-goods": { kind: "container", name: "Товары на полках", ext: /\.(ydr|yft|ydd|ytyp)$/, maxBytes: 8 * MiB, gameplay: true },
  "car-dirt": { kind: "entry", name: "Грязь на машинах", entry: "common/data/effects/decals.dat", maxBytes: MiB, gameplay: false },
  decals: { kind: "entry", name: "Следы пуль и крови", entry: "x64/textures/fxdecal.ytd", maxBytes: 64 * MiB, gameplay: false },
  "explosion-shake": { kind: "entry", name: "Тряска от взрывов", entry: "x64/data/metadata/explosion.ymt", maxBytes: MiB, gameplay: false },
  /* Эмбиент и частицы выстрелов (ТЗ 17.10.2026, задача 2). Местности частиц
     в update.rpf нет (игра читает их из x64a.rpf) — запись кладётся
     `upsert`: заменить, если её туда уже положили, положить, если нет. */
  ambient: { kind: "entry", name: "Эмбиент окружения", entry: "common/data/effects/entityfx.dat", maxBytes: MiB, gameplay: false },
  "ambient-region": {
    kind: "entry",
    name: "Частицы в воздухе по местности",
    entry: "x64/data/effects/vfxregioninfo.ymt",
    action: "upsert",
    maxBytes: 64 * 1024,
    gameplay: false,
  },
  "bullet-impacts": { kind: "entry", name: "Частицы попаданий пуль", entry: "common/data/effects/weaponfx.dat", maxBytes: MiB, gameplay: false },
  /* Частицы ударов и скольжения (ТЗ 05.11.2026): materialfx.dat игра держит в
     common.rpf, в update.rpf его нет — запись кладётся `upsert`, как местности. */
  "collision-particles": {
    kind: "entry",
    name: "Искры и осколки при столкновениях",
    entry: "common/data/effects/materialfx.dat",
    action: "upsert",
    maxBytes: MiB,
    gameplay: false,
  },
  "drug-effects": {
    kind: "timecycle",
    name: "Алко- и наркоэффекты",
    entry: "common/data/timecycle/timecycle_mods_4.xml",
    /* Какие модификаторы слой вправе перекрыть: ровно эти, по имени. */
    modifiers: OPTIMIZATION_DRUG_MODIFIERS,
    maxBytes: 64 * 1024,
    gameplay: false,
  },
  /* Экран при ранении (ТЗ 17.10.2026, вечер): красная виньетка, серость и
     пульс экрана при попадании по вам и на низком здоровье. */
  "damage-screen": {
    kind: "timecycle",
    name: "Экран при ранении",
    entry: "common/data/timecycle/timecycle_mods_1.xml",
    modifiers: OPTIMIZATION_DAMAGE_SCREEN_MODIFIERS,
    maxBytes: 64 * 1024,
    gameplay: false,
  },
});

const LAYER_IDS = Object.freeze(Object.keys(OPTIMIZATION_LAYERS_TRUST));
const MOD_ID = /^local-legacy-opt-([a-z]+(?:-[a-z]+)*)-([a-f0-9]{12})$/;

const CAPABILITIES = Object.freeze({
  container: Object.freeze([
    "rpf-container-entry-v1",
    "astral-content-rpf-v1",
    "direct-update-rpf-v1",
    "direct-update-entries-v1",
  ]),
  entry: Object.freeze(["rpf-container-entry-v1", "direct-update-entries-v1"]),
  timecycle: Object.freeze([
    "rpf-container-entry-v1",
    "direct-update-entries-v1",
    "timecycle-modifier-merge-v1",
  ]),
});

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "optimization",
  "files",
]);
const OPTIMIZATION_KEYS = Object.freeze(["layer", "schemaVersion", "sourceDigest", "fileCount"]);
const CONTAINER_FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const ENTRY_FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const basename = (entry) => entry.slice(entry.lastIndexOf("/") + 1);

/** Слой пакета по его id: `local-legacy-opt-<слой>-<хэш>`. */
export function optimizationLayerOfModId(value) {
  const match = MOD_ID.exec(String(value || ""));
  return match && LAYER_IDS.includes(match[1]) ? match[1] : null;
}

export const isOptimizationModId = (value, layerId = null) => {
  const layer = optimizationLayerOfModId(value);
  return Boolean(layer) && (!layerId || layer === layerId);
};

/**
 * Хэш содержимого: слой и отсортированные пары `запись\nsha256`. Тот же слой
 * из тех же файлов — тот же id, и повторное включение архив не пересобирает.
 */
export function optimizationDigest(layerId, files) {
  const lines = files.map((file) => `${file.entry}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`${layerId}\n${lines.join("\n")}`, "utf8").digest("hex");
}

/**
 * Манифест слоя из описи собранных файлов `{ name, size, sha256 }`. У слоя
 * «запись» и «таймцикл» файл один — его место слой знает сам.
 */
export function buildOptimizationManifest(layerId, files) {
  const layer = OPTIMIZATION_LAYERS_TRUST[layerId];
  if (!layer) throw new Error(`Слоя оптимизации «${layerId}» нет.`);
  if (!files.length) throw new Error("Слой без файлов.");
  if (layer.kind !== "container" && files.length !== 1) throw new Error("У слоя-записи один файл.");
  const entries = files.map((file) => ({
    ...file,
    entry: layer.kind === "container" ? `${containerOf(layerId)}/${file.name}` : layer.entry,
  }));
  const digest = optimizationDigest(layerId, entries);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-opt-${layerId}-${suffix}`,
    version: `${OPTIMIZATION_SCHEMA}.0.0-${suffix}`,
    name: `Оптимизация Astral: ${layer.name}`,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: layer.gameplay,
    capabilities: [...CAPABILITIES[layer.kind]],
    slots: [`optimization-${layerId}`],
    optimization: {
      layer: layerId,
      schemaVersion: OPTIMIZATION_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      fileCount: entries.length,
    },
    files: [...entries]
      .sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0))
      .map((file) => {
        const common = {
          source: `payload/${file.name}`,
          target: UPDATE,
          action: layer.kind === "container" ? "import" : layer.action || "replace",
          entry: file.entry,
        };
        if (layer.kind === "container")
          return { ...common, merge: { strategy: "rpf-resource-layer-v1" }, size: file.size, sha256: file.sha256 };
        if (layer.kind === "timecycle")
          return {
            ...common,
            merge: {
              strategy: "timecycle-modifier-v1",
              priority: TIMECYCLE_PRIORITY,
              includeNames: [...layer.modifiers],
            },
            size: file.size,
            sha256: file.sha256,
          };
        return { ...common, size: file.size, sha256: file.sha256 };
      }),
  };
}

function validFile(layerId, layer, file, seen) {
  if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > layer.maxBytes) return false;
  if (file.target !== UPDATE) return false;
  if (typeof file.source !== "string" || !file.source.startsWith("payload/")) return false;
  const name = file.source.slice("payload/".length);
  if (seen.has(name)) return false;
  seen.add(name);
  if (layer.kind === "container") {
    if (!hasExactKeys(file, CONTAINER_FILE_KEYS)) return false;
    if (file.action !== "import") return false;
    if (!layer.ext.test(name)) return false;
    if (!(OPTIMIZATION_LAYER_FILES[layer.names || layerId] || []).includes(name)) return false;
    if (file.entry !== `${containerOf(layerId)}/${name}`) return false;
    return hasExactKeys(file.merge, ["strategy"]) && file.merge.strategy === "rpf-resource-layer-v1";
  }
  if (file.action !== (layer.action || "replace") || file.entry !== layer.entry || name !== basename(layer.entry)) return false;
  if (layer.kind === "entry") return hasExactKeys(file, ENTRY_FILE_KEYS);
  if (!hasExactKeys(file, CONTAINER_FILE_KEYS)) return false;
  return (
    hasExactKeys(file.merge, ["strategy", "priority", "includeNames"]) &&
    file.merge.strategy === "timecycle-modifier-v1" &&
    file.merge.priority === TIMECYCLE_PRIORITY &&
    sameJson(file.merge.includeNames, layer.modifiers)
  );
}

/* ------------------------------------------------------------------ *
 * Набор оптимизации (задача 8, 05.10.2026)
 * ------------------------------------------------------------------ */

/*
 * Все включённые слои — одним пакетом движка. Раньше каждый слой был своим
 * пакетом: карточка «Эффекты» из четырёх слоёв — четыре пересборки
 * update.rpf, а выключение при работах мастерской сверху шло корзиной
 * библиотеки — перемоткой архива и повтором каждой работы, десятки минут.
 * Набор пересобирает архив один раз на переключение, а выключение слоя —
 * та же замена набора, без перемотки. Файлы набора — ровно те же, что у
 * слоёв, и проверяются правилами своего слоя; полезная нагрузка — по папке
 * на слой (`payload/<слой>/<имя>`), имена у слоёв не сталкиваются.
 */
const SET_ID = /^local-legacy-opt-set-([a-f0-9]{12})$/;
const SET_OPTIMIZATION_KEYS = Object.freeze(["layers", "schemaVersion", "sourceDigest", "fileCount"]);
const SET_NAME = "Оптимизация Astral: набор слоёв";
/* Общий слот всех наборов: новый набор всегда вправе заменить прежний. */
const SET_SLOT = "optimization-set";
/* Порядок возможностей набора — как у движка в манифестах слоёв. */
const CAPABILITY_ORDER = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
  "timecycle-modifier-merge-v1",
]);

/** Пакет набора слоёв: `local-legacy-opt-set-<хэш>`. */
export const isOptimizationSetModId = (value) => SET_ID.test(String(value || ""));

/** Слои записи установки движка: слой пакета-слоя или слоты пакета-набора. */
export function optimizationLayersOfRecord(item) {
  const single = optimizationLayerOfModId(item?.modId);
  if (single) return [single];
  if (!isOptimizationSetModId(item?.modId)) return [];
  return (Array.isArray(item?.slots) ? item.slots : [])
    .filter((slot) => slot !== SET_SLOT)
    .map((slot) => String(slot).replace(/^optimization-/, ""))
    .filter((layerId) => LAYER_IDS.includes(layerId));
}

/** Хэш содержимого набора: слой, запись и sha256 каждого файла, по порядку. */
export function optimizationSetDigest(entries) {
  const lines = entries.map((file) => `${file.layer}\n${file.entry}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`optimization-set\n${lines.join("\n")}`, "utf8").digest("hex");
}

/**
 * Манифест набора из собранных слоёв `[{ layerId, files: [{ name, size,
 * sha256 }] }]`: файлы — как в манифестах слоёв, источник — папка слоя.
 */
export function buildOptimizationSetManifest(layers) {
  const sorted = [...layers].sort((a, b) => (a.layerId < b.layerId ? -1 : a.layerId > b.layerId ? 1 : 0));
  if (!sorted.length) throw new Error("Набор без слоёв.");
  const files = [];
  const capabilities = new Set();
  let gameplay = false;
  for (const { layerId, files: built } of sorted) {
    const layer = OPTIMIZATION_LAYERS_TRUST[layerId];
    if (!layer) throw new Error(`Слоя оптимизации «${layerId}» нет.`);
    const single = buildOptimizationManifest(layerId, built);
    for (const capability of single.capabilities) capabilities.add(capability);
    gameplay ||= layer.gameplay;
    for (const file of single.files) files.push({ ...file, source: `payload/${layerId}/${file.source.slice("payload/".length)}`, layer: layerId });
  }
  const digest = optimizationSetDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-opt-set-${suffix}`,
    version: `${OPTIMIZATION_SCHEMA}.0.0-${suffix}`,
    name: SET_NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: gameplay,
    capabilities: CAPABILITY_ORDER.filter((capability) => capabilities.has(capability)),
    slots: [SET_SLOT, ...sorted.map(({ layerId }) => `optimization-${layerId}`)],
    optimization: {
      layers: sorted.map(({ layerId }) => layerId),
      schemaVersion: OPTIMIZATION_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      fileCount: files.length,
    },
    files: files
      .sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0))
      .map(({ layer: _layer, ...file }) => file),
  };
}

/* Чей файл набора: контейнер слоя по пути, запись — по месту в update.rpf. */
function setFileLayer(file) {
  for (const layerId of LAYER_IDS) {
    const layer = OPTIMIZATION_LAYERS_TRUST[layerId];
    if (layer.kind === "container" ? String(file?.entry || "").startsWith(`${containerOf(layerId)}/`) : file?.entry === layer.entry) return layerId;
  }
  return null;
}

export function isLocalOptimizationSetManifest(manifest, edition) {
  // Fail-closed, как у слоя: любое несовпадение с эталонной формой — false.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.optimization, SET_OPTIMIZATION_KEYS)) return false;
  const layers = manifest.optimization.layers;
  if (!Array.isArray(layers) || !layers.length || !layers.every((layerId) => LAYER_IDS.includes(layerId))) return false;
  if (!sameJson(layers, [...new Set(layers)].sort())) return false;
  /* Ступень текстур — одна: два контейнера с теми же словарями спорили бы,
     чей вид увидит игра. */
  if (layers.filter((layerId) => OPTIMIZATION_LAYERS_TRUST[layerId].texture).length > 1) return false;
  const idMatch = SET_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${OPTIMIZATION_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== SET_NAME) return false;
  if (!sameJson(manifest.editions, ["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry" || manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== layers.some((layerId) => OPTIMIZATION_LAYERS_TRUST[layerId].gameplay)) return false;
  const expectedCapabilities = new Set(layers.flatMap((layerId) => CAPABILITIES[OPTIMIZATION_LAYERS_TRUST[layerId].kind]));
  if (!sameJson(manifest.capabilities, CAPABILITY_ORDER.filter((capability) => expectedCapabilities.has(capability)))) return false;
  if (!sameJson(manifest.slots, [SET_SLOT, ...layers.map((layerId) => `optimization-${layerId}`)])) return false;
  if (manifest.optimization.schemaVersion !== OPTIMIZATION_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.optimization.sourceDigest || "")) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || !files.length || manifest.optimization.fileCount !== files.length) return false;
  const seen = new Map(layers.map((layerId) => [layerId, new Set()]));
  const counted = new Map(layers.map((layerId) => [layerId, 0]));
  const entries = [];
  for (const file of files) {
    const layerId = setFileLayer(file);
    if (!layerId || !seen.has(layerId)) return false;
    const prefix = `payload/${layerId}/`;
    if (typeof file.source !== "string" || !file.source.startsWith(prefix)) return false;
    /* Файл набора — файл своего слоя: те же ключи, имена, пределы и места. */
    if (!validFile(layerId, OPTIMIZATION_LAYERS_TRUST[layerId], { ...file, source: `payload/${file.source.slice(prefix.length)}` }, seen.get(layerId))) return false;
    counted.set(layerId, counted.get(layerId) + 1);
    entries.push({ layer: layerId, entry: file.entry, sha256: file.sha256 });
  }
  for (const layerId of layers) {
    const count = counted.get(layerId);
    if (!count || (OPTIMIZATION_LAYERS_TRUST[layerId].kind !== "container" && count !== 1)) return false;
  }
  const digest = optimizationSetDigest(entries);
  if (manifest.optimization.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}

export function isLocalOptimizationManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.optimization, OPTIMIZATION_KEYS)) return false;
  const layerId = manifest.optimization.layer;
  if (!LAYER_IDS.includes(layerId)) return false;
  const layer = OPTIMIZATION_LAYERS_TRUST[layerId];
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch || idMatch[1] !== layerId) return false;
  const suffix = idMatch[2];
  if (manifest.version !== `${OPTIMIZATION_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== `Оптимизация Astral: ${layer.name}`) return false;
  if (!sameJson(manifest.editions, ["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== layer.gameplay) return false;
  if (!sameJson(manifest.capabilities, CAPABILITIES[layer.kind])) return false;
  if (!sameJson(manifest.slots, [`optimization-${layerId}`])) return false;
  if (manifest.optimization.schemaVersion !== OPTIMIZATION_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.optimization.sourceDigest || "")) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || !files.length) return false;
  if (layer.kind !== "container" && files.length !== 1) return false;
  if (manifest.optimization.fileCount !== files.length) return false;
  const seen = new Set();
  for (const file of files) if (!validFile(layerId, layer, file, seen)) return false;

  // id, версия и digest связаны одним хэшем содержимого.
  const digest = optimizationDigest(
    layerId,
    files.map((file) => ({ entry: file.entry, sha256: file.sha256 })),
  );
  if (manifest.optimization.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
