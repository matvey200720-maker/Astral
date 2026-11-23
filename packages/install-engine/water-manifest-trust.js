import { createHash } from "node:crypto";

/*
 * Вода из мастерской — один пакет движка: цвет моря и озёр, прозрачность и
 * цвет рек. Своих файлов вода не везёт: всё правится на файлах игры игрока
 * (`apps/desktop/src/recolor-water.js`), а право писать в update.rpf даёт
 * ровно эта форма манифеста.
 *
 *   • плитки тумана воды — замена на своём месте во вложенных архивах
 *     `x64/textures/waterfog_txds.rpf` и `waterfog_txds_dx.rpf`
 *     (`waterfog-N`, Кайо — `waterfog_h4-N`): в update.rpf они уже лежат;
 *   • `water.xml` и `water_heistisland.xml` — прозрачность квадов: первый
 *     игра держит в common.rpf, поэтому оба кладутся поверх (`upsert`);
 *   • реки — модели и словари из основных архивов с перекрашенным туманом в
 *     своём контейнере `x64/astral/astral_water.rpf`, только из описи
 *     (копия `@modovik/climb-contract/recolor/inventory/water` — нарочно
 *     здесь, совпадение держит тест);
 *   • под водой (задача 2, 05.10.2026) — подводные модификаторы
 *     `timecycle_mods_1.xml` слоем объединения `timecycle-modifier-v1`:
 *     движок кладёт их поверх файла игрока по имени, чужие модификаторы
 *     остаются (как модификаторы опьянения у оптимизации). С задачи 7 ТЗ
 *     11.10.2026 — и местные виды под водой (берег, порт, каналы, реки,
 *     озёра): список — подпоследовательность `WATER_TIMECYCLE_MODIFIERS` с
 *     тремя общими, прежние пакеты из трёх имён остаются своими;
 *   • подводная дымка (задача 7) — `underwater_render_mist.xml` поверх
 *     (`upsert`): игра читает его с `common:/`, который update.rpf перекрывает.
 */
export const LOCAL_WATER_TRUST = Symbol("local-water-package");
export const WATER_SCHEMA = 1;
export const WATER_CONTAINER = "x64/astral/astral_water.rpf";
export const WATER_SLOT = "water";
export const WATER_XML_ENTRY = "common/data/levels/gta5/water.xml";
export const WATER_ISLAND_XML_ENTRY = "common/data/levels/gta5/water_heistisland.xml";
/* Подводные модификаторы: файл, имена (копия `WATER_UNDERWATER_MODIFIERS`
   договора — совпадение держит тест) и приоритет — выше таймцикла каталога
   (100): своя вода под водой выигрывает у подводного вида редукса. */
export const WATER_TIMECYCLE_ENTRY = "common/data/timecycle/timecycle_mods_1.xml";
/* Вода (задача 7 ТЗ 11.10.2026): три общих — обязательны, местные виды под
   водой — какие есть в файле игрока (копия `WATER_UNDERWATER_LAYER`). */
export const WATER_TIMECYCLE_REQUIRED = Object.freeze(["underwater", "underwater_deep", "underwater_deep_clear"]);
export const WATER_TIMECYCLE_MODIFIERS = Object.freeze([
  ...WATER_TIMECYCLE_REQUIRED,
  "WATER_shore",
  "WATER_port",
  "WATER_silty",
  "WATER_muddy",
  "WATER_cove",
  "WATER_river",
  "WATER_salton",
  "WATER_salton_bottom",
  "WATER_silverlake",
  "WATER_resevoir",
  "WATER_hills",
  "WATER_lab",
  "WATER_militaryPOOP",
]);
export const WATER_TIMECYCLE_PRIORITY = 250;
/* Подводная дымка (вода, задача 7): частицы UNDERWATER_MIST — копия поверх. */
export const WATER_MIST_ENTRY = "common/data/levels/gta5/weather/underwater_render_mist.xml";
const MAX_MIST_BYTES = 64 * 1024;

/*
 * Имена слоя «под водой»: подпоследовательность `WATER_TIMECYCLE_MODIFIERS`
 * в его порядке, без повторов, с тремя общими. Прежние пакеты (только три
 * общих) этому отвечают.
 */
export function isWaterTimecycleNames(names) {
  if (!Array.isArray(names) || names.length < WATER_TIMECYCLE_REQUIRED.length) return false;
  let cursor = 0;
  for (const name of names) {
    const at = WATER_TIMECYCLE_MODIFIERS.indexOf(name, cursor);
    if (at < 0) return false;
    cursor = at + 1;
  }
  return WATER_TIMECYCLE_REQUIRED.every((name) => names.includes(name));
}

/* Файлы рек, которые пакет вправе везти: модели и словари игры с туманом. */
export const WATER_RIVER_FILES = Object.freeze([
  "bh1_40_grndmain_wtr.ydr", "bh1_43_lod.ytd", "bh1_43_water.ytd", "bh1_lod_43_children.ytd",
  "ch1_04b_river_lod.ytd", "ch1_04b_water01.ydr", "ch1_04b_water02.ydr", "ch1_04b_water03.ydr",
  "ch1_05_crkwater_1001.ydr", "ch1_05_crkwater_1005.ydr", "ch1_05_crkwater_1006.ydr",
  "ch1_05_crkwater_top.ydr", "ch1_05_river02_lod.ytd", "ch1_05_water_01old.ydr",
  "ch1_05_water_02.ydr", "ch1_05_water_03.ydr", "ch1_05_water_04.ydr", "ch1_05_water_05.ydr",
  "ch1_05b_lod.ytd", "ch1_05b_water.ytd", "ch1_09b_river.ytd", "ch1_09b_water01.ytd",
  "ch1_lod_ch1_04b_water01_slod2_children.ytd", "ch1_lod_ch1_04b_water01_slod3_children.ydd",
  "ch1_lod_ch1_05_crkwater_slod2_children.ytd", "ch1_lod_ch1_05_crkwater_slod3_children.ydd",
  "ch1_lod_ch1_05_water_slod2_children.ytd", "ch1_lod_ch1_05_water_slod3_children.ydd",
  "ch1_lod_slod2_05_children.ytd", "ch1_lod_slod3.ytd", "ch2_01_river_lod.ytd",
  "ch2_01_water_01.ydr", "ch2_01_water_02.ydr", "ch2_01_water_03.ydr", "ch3_06_lod.ytd",
  "ch3_06_stream_water.ydr", "ch3_12_lod.ytd", "ch3_12_water.ytd", "ch3_lod_slod3.ytd",
  "ch3_lod_water_slod2_children.ytd", "ch3_lod_water_slod3_children.ydd",
  "ch3_lod_weir_01_slod2_children.ytd", "ch3_lod_weir_01_slod3_children.ydd",
  "cs1_14_canriv_04.ydr", "cs1_14_canriv_05.ydr", "cs1_14_canriv_06.ydr", "cs1_14_canriv_07.ydr",
  "cs1_14_canriv_08.ydr", "cs1_14_canriv_lod.ytd", "cs1_14b_canriv_01.ydr",
  "cs1_14b_canriv_02.ydr", "cs1_14b_canriv_03.ydr", "cs1_14b_water2_lod.ytd",
  "cs1_14b_water2_slod.ytd", "cs1_14b_water3_slod.ytd", "cs1_14b_water3lod.ytd",
  "cs1_14b_water_lod.ytd", "cs1_14b_water_trncrsh.ydr", "cs1_14b_waterblend.ydr",
  "cs1_lod_riv_slod3.ytd", "cs1_lod_riva_slod2_children.ytd", "cs1_lod_riva_slod3_children.ydd",
  "cs1_lod_rivb_slod2_children.ytd", "cs1_lod_rivb_slod3_children.ydd", "cs2_03_channel_water.ydr",
  "cs2_03_lod.ytd", "cs3_05_water.ytd", "cs3_05_water07_grp1.ydr", "cs3_05_water07_grp2.ydr",
  "cs3_05_water_lod.ytd", "cs3_05_waterg1_lod.ytd", "cs3_05_waterg1_slod.ytd",
  "cs3_05_waterg2_lod.ytd", "cs3_05_waterg2_slod.ytd", "cs3_05_watermesh02.ydr",
  "cs3_05_watermesh03.ydr", "cs3_05_watermesh05.ydr", "cs3_05_watermesh08.ydr",
  "cs3_06_wetwater.ytd", "cs3_06_wetwater02.ydr", "cs3_06_wetwater_lod.ytd", "cs3_lod_slod2.ytd",
  "cs3_lod_slod3.ytd", "cs3_lod_water_slod2_01_children.ytd",
  "cs3_lod_water_slod2_02_children.ytd", "cs3_lod_water_slod2_03_children.ytd",
  "cs3_lod_water_slod3_02_children.ydd", "cs3_lod_water_slod3_03_children.ydd", "cs6_08_water.ytd",
  "cs6_08_water_lod.ytd", "cs6_08_water_slod.ytd", "cs6_09_river.ytd", "cs6_09_river_lod.ytd",
  "cs6_09_river_slod.ytd", "id1_00_water.ytd", "id1_00_water1.ydr", "id1_00_water_lod.ytd",
  "id1_08_brg_slod_children.ydd", "id1_lod_slod4.ytd", "id1_lod_water_slod2_children.ytd",
  "id1_lod_water_slod3_children.ydd", "id2_00_a_water.ytd", "id2_00_a_waterlod.ytd",
  "id2_00_lod.ytd", "id2_00_water.ytd", "id2_00_waterlod.ytd", "id2_21_e_water.ydr",
  "id2_lod_00_water_a_slod2_children.ytd", "id2_lod_00_water_ab_slod2_children.ytd",
  "id2_lod_slod2.ytd", "id2_lod_slod4.ytd", "id2_lod_water00_slod2_children.ytd",
  "id2_lod_water_00b_slod2_children.ytd", "id2_lod_water_00c_slod2_children.ytd",
  "vb_35_waterlod.ytd", "vb_ca_tunnel.ytd", "vb_ca_water1.ydr", "vb_ca_water3.ydr",
  "vb_ca_water6.ydr", "vb_ca_water_lod.ytd",
]);
const RIVERS = new Set(WATER_RIVER_FILES);

const FOG_TILE = /^x64\/textures\/waterfog_txds\.rpf\/(waterfog(?:_h4)?-\d{1,3}\.ytd)$/;
const FOG_DX_TILE = /^x64\/textures\/waterfog_txds_dx\.rpf\/(waterfog(?:_h4)?-\d{1,3}-dx\.ytd)$/;
/* 408 плиток штата и 64 Кайо. */
const MAX_TILES = 472;
const MiB = 1024 * 1024;
const MAX_TILE_BYTES = MiB;
const MAX_XML_BYTES = 2 * MiB;
const MAX_RIVER_BYTES = 24 * MiB;
const MAX_TOTAL_BYTES = 512 * MiB;
const MOD_ID = /^local-legacy-water-([a-f0-9]{12})$/;
const NAME = "Вода Astral";

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
  "water",
  "files",
]);
const WATER_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "tiles", "dxTiles", "quads", "rivers"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);
const RIVER_FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
]);
/* С подводными модификаторами — ещё слой объединения таймцикла. */
const UNDERWATER_CAPABILITIES = Object.freeze([...CAPABILITIES, "timecycle-modifier-merge-v1"]);
const TIMECYCLE_MERGE = Object.freeze({
  strategy: "timecycle-modifier-v1",
  priority: WATER_TIMECYCLE_PRIORITY,
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/*
 * Запись воды на месте игры в update.rpf: плитка тумана — заменой (во
 * вложенном архиве она уже лежит), квады — поверх. Эти файлы игра берёт по
 * своему адресу, а не по имени из контейнера Astral: `waterfog_txds.rpf` в
 * content.xml не прописан вовсе, `water_HeistIsland.xml` прописан путём
 * `update:/common/…`, `water.xml` читается из `common:/`, который update.rpf
 * перекрывает. Поэтому только они и лежат рядом с контейнером рек — движок
 * (`manifest.js`) пускает их туда лишь у манифеста строгой формы воды.
 */
export function isWaterGameEntry(file) {
  if (file?.target !== "update/update.rpf") return false;
  const entry = String(file.entry || "");
  if (FOG_TILE.test(entry) || FOG_DX_TILE.test(entry)) return file.action === "replace";
  if (entry === WATER_XML_ENTRY || entry === WATER_ISLAND_XML_ENTRY) return file.action === "upsert";
  if (entry === WATER_TIMECYCLE_ENTRY) return file.action === "replace" && file.merge?.strategy === "timecycle-modifier-v1";
  if (entry === WATER_MIST_ENTRY) return file.action === "upsert";
  return false;
}

/** Хэш содержимого: отсортированные пары `запись\nsha256`. */
export function waterSourceDigest(files) {
  const lines = files.map((file) => `${file.entry}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`water\n${lines.join("\n")}`, "utf8").digest("hex");
}

export const isWaterModId = (value) => MOD_ID.test(String(value || ""));

/**
 * Манифест воды из описи собранных файлов `{ kind, name, size, sha256 }`:
 * `kind` — `fog` (плитка), `dx` (упрощённая плитка), `xml` (квады),
 * `river` (файл реки в контейнер).
 */
export function buildWaterManifest(files) {
  const described = files.map((file) => {
    const common = { target: "update/update.rpf", size: file.size, sha256: file.sha256 };
    if (file.kind === "fog")
      return { source: `payload/fog/${file.name}`, ...common, action: "replace", entry: `x64/textures/waterfog_txds.rpf/${file.name}` };
    if (file.kind === "dx")
      return { source: `payload/fog-dx/${file.name}`, ...common, action: "replace", entry: `x64/textures/waterfog_txds_dx.rpf/${file.name}` };
    if (file.kind === "xml")
      return {
        source: `payload/${file.name}`,
        ...common,
        action: "upsert",
        entry: file.name === "water.xml" ? WATER_XML_ENTRY : WATER_ISLAND_XML_ENTRY,
      };
    if (file.kind === "river")
      return {
        source: `payload/rivers/${file.name}`,
        ...common,
        action: "import",
        entry: `${WATER_CONTAINER}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
      };
    if (file.kind === "timecycle") {
      /* Имена — те, что собраны в документ (без описи — прежние три). */
      const includeNames = file.names ? [...file.names] : [...WATER_TIMECYCLE_REQUIRED];
      if (!isWaterTimecycleNames(includeNames)) throw new Error("Слой «под водой» несёт чужие модификаторы таймцикла.");
      return {
        source: "payload/timecycle_mods_1.xml",
        ...common,
        action: "replace",
        entry: WATER_TIMECYCLE_ENTRY,
        merge: { ...TIMECYCLE_MERGE, includeNames },
      };
    }
    if (file.kind === "mist")
      return { source: "payload/weather/underwater_render_mist.xml", ...common, action: "upsert", entry: WATER_MIST_ENTRY };
    throw new Error(`Неизвестный вид файла воды: ${file.kind}.`);
  });
  const underwater = files.some((file) => file.kind === "timecycle");
  const digest = waterSourceDigest(described);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-water-${suffix}`,
    version: `${WATER_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Цвет и прозрачность воды — облик, а не правила игры.
    gameplayChanges: false,
    capabilities: [...(underwater ? UNDERWATER_CAPABILITIES : CAPABILITIES)],
    slots: [WATER_SLOT],
    water: {
      schemaVersion: WATER_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      tiles: files.filter((file) => file.kind === "fog").length,
      dxTiles: files.filter((file) => file.kind === "dx").length,
      quads: files.some((file) => file.kind === "xml"),
      rivers: files.filter((file) => file.kind === "river").length,
    },
    files: described.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0)),
  };
}

export function isLocalWaterManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.water, WATER_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${WATER_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  const underwater = Array.isArray(manifest.files) && manifest.files.some((file) => file?.entry === WATER_TIMECYCLE_ENTRY);
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(underwater ? UNDERWATER_CAPABILITIES : CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([WATER_SLOT])) return false;
  if (manifest.water.schemaVersion !== WATER_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.water.sourceDigest || "")) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_TILES * 2 + 4 + RIVERS.size) return false;
  const seen = new Set();
  let total = 0;
  let tiles = 0;
  let dxTiles = 0;
  let xml = 0;
  let rivers = 0;
  for (const file of files) {
    const river = String(file?.entry || "").startsWith(`${WATER_CONTAINER}/`);
    const timecycle = file?.entry === WATER_TIMECYCLE_ENTRY;
    if (!hasExactKeys(file, river || timecycle ? RIVER_FILE_KEYS : FILE_KEYS)) return false;
    if (file.target !== "update/update.rpf") return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1) return false;
    /* Одна запись — один файл: дубликат означал бы двойную замену. */
    if (seen.has(file.entry)) return false;
    seen.add(file.entry);
    const fog = FOG_TILE.exec(file.entry);
    const dx = FOG_DX_TILE.exec(file.entry);
    if (fog) {
      if (file.source !== `payload/fog/${fog[1]}` || file.action !== "replace" || file.size > MAX_TILE_BYTES) return false;
      tiles += 1;
    } else if (dx) {
      if (file.source !== `payload/fog-dx/${dx[1]}` || file.action !== "replace" || file.size > MAX_TILE_BYTES) return false;
      dxTiles += 1;
    } else if (file.entry === WATER_XML_ENTRY || file.entry === WATER_ISLAND_XML_ENTRY) {
      const name = file.entry.split("/").pop();
      if (file.source !== `payload/${name}` || file.action !== "upsert" || file.size > MAX_XML_BYTES) return false;
      xml += 1;
    } else if (timecycle) {
      if (file.source !== "payload/timecycle_mods_1.xml" || file.action !== "replace" || file.size > MAX_XML_BYTES) return false;
      if (!hasExactKeys(file.merge, ["strategy", "priority", "includeNames"])) return false;
      if (file.merge.strategy !== TIMECYCLE_MERGE.strategy || file.merge.priority !== TIMECYCLE_MERGE.priority) return false;
      if (!isWaterTimecycleNames(file.merge.includeNames)) return false;
    } else if (file.entry === WATER_MIST_ENTRY) {
      if (file.source !== "payload/weather/underwater_render_mist.xml" || file.action !== "upsert" || file.size > MAX_MIST_BYTES) return false;
    } else if (river) {
      const name = file.entry.slice(WATER_CONTAINER.length + 1);
      if (!RIVERS.has(name)) return false;
      if (file.source !== `payload/rivers/${name}` || file.action !== "import" || file.size > MAX_RIVER_BYTES) return false;
      if (!hasExactKeys(file.merge, ["strategy"]) || file.merge.strategy !== "rpf-resource-layer-v1") return false;
      rivers += 1;
    } else return false;
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) return false;
  if (tiles > MAX_TILES || dxTiles > MAX_TILES) return false;
  /* Опись обязана говорить правду о том, что внутри. */
  if (manifest.water.tiles !== tiles || manifest.water.dxTiles !== dxTiles || manifest.water.rivers !== rivers) return false;
  if (manifest.water.quads !== xml > 0) return false;
  const digest = waterSourceDigest(files);
  if (manifest.water.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
