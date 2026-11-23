import { createHash } from "node:crypto";
import {
  isRoadsHeiFile,
  isRoadsMapFile,
  ROADS_DLC_MAX_BYTES,
  ROADS_DLC_PACKS,
  ROADS_DLC_STREAMS,
  ROADS_DLC_TARGET,
  ROADS_MODELS_CAPABILITY,
  roadsArchiveOf,
  roadsArchivesOf,
  roadsMapStreamOf,
  roadsPackOf,
  roadsStreamOf,
} from "./roads-dlc.js";
import { ROADS_MODEL_NAMES } from "./roads-model-names.js";

/*
 * «Дороги» мастерской — один пакет движка (задача 6 ТЗ 07.10.2026):
 * словари карты игрока с перекрашенными листами асфальта, грунтовок,
 * тротуаров и разметки — в своих пакетах дополнения `astral_roads` и
 * `astral_roads_b` (`roads-dlc.js`). Своих картинок пакет не везёт — только
 * словари игры под их же именами (какие именно — по описи
 * `inventory/roads.js` и переписи игры игрока), поэтому имена здесь — не
 * список, а форма: словарь `.ytd` строчными, в своей части своего пакета.
 *
 * Право писать даёт ровно эта форма манифеста: одна работа, только импорт
 * словарей (и, по своей возможности, моделей из описи), ни одного другого
 * вида файлов. Разрешение — на каждый пакет, в котором есть файлы.
 *
 * Модели (ТЗ 17.10.2026, вечер, задача 1): `.ydr`, `.ydd`, `.yft` со
 * встроенными листами дорог принимаются только при возможности
 * `direct-roads-models-v1` и только по имени из списка `roads-model-names.js`
 * — копии описи, сгенерированной вместе с ней (проверять модель по чужому
 * пакету нельзя, как и в `recolor-sets.js`). Словарь по-прежнему — любое
 * простое имя `.ytd`: какие именно, решает перепись игры игрока.
 *
 * С 12.10.2026 файлы сетевой карты (`hei_…`) — в архиве `GROUP_MAP` своего
 * пакета (`roadsArchiveOf`): у работы с ними новый id, и поставленное
 * раньше переезжает переносом (`migrateInstalledPlaces`).
 */
export const LOCAL_ROADS_TRUST = Symbol("local-roads-package");
export const ROADS_SCHEMA = 1;
export const ROADS_ARCHIVE = ROADS_DLC_TARGET;
export const ROADS_CONTAINER = ROADS_DLC_STREAMS[0];
export const ROADS_SLOT = "roads";

const MiB = 1024 * 1024;
const MAX_FILES = 6000;
const MAX_FILE_BYTES = 96 * MiB;
const MAX_STREAM_BYTES = 1536 * MiB;
const MAX_TOTAL_BYTES = ROADS_DLC_MAX_BYTES * ROADS_DLC_PACKS.length;
const MOD_ID = /^local-legacy-roads-([a-f0-9]{12})$/;
const NAME = "Дороги Astral";
const DICTIONARY = /^[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
const MODEL = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const MODEL_NAMES = new Set(ROADS_MODEL_NAMES);
/** Это имя модели карты (а не словаря) — по расширению. */
const isModelName = (name) => /\.(?:ydr|ydd|yft)$/.test(name);
/* Архивы пакетов, куда дороги вправе писать: части и архивы сетевой карты. */
const ARCHIVES = new Set(ROADS_DLC_PACKS.flatMap(roadsArchivesOf));

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
  "roads",
  "files",
]);
const ROADS_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
/* Разрешения: вход в архив, по одному на каждый пакет, где есть файлы, и — если среди них модели — своё. */
const capabilitiesOf = (names) => [
  "rpf-container-entry-v1",
  ...ROADS_DLC_PACKS.filter((pack) => names.some((name) => roadsPackOf(name) === pack)).map((pack) => pack.capability),
  ...(names.some(isModelName) ? [ROADS_MODELS_CAPABILITY] : []),
];

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * Хэш содержимого: отсортированные пары `имя\nsha256` и раскладка. `file.mapped` — файл лежит в архиве `GROUP_MAP` пакета (по умолчанию — по правилу `hei_`).
 */
export function roadsSourceDigest(files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  /* Словари сетевой карты в архивах `GROUP_MAP` (12.10.2026) — другая раскладка: новый id. Раскладка, где в `_mp` ровно `hei_` (кроме пропов), — прежняя
     `map-group-v1` (id работ без расхождений не меняются). Иначе (26.10.2026, по игре игрока) — `map-group-v2` и два списка: `+имя` — файл без `hei_` в `_mp`
     (`apa_*`, `lr_*`, `xm_*`…), `-имя` — `hei_` оставлен в части на старте (`hei_ch3_rd1a_*` у Rockstar вне `GROUP_MAP`). У такой работы новый id, и
     поставленное раньше переезжает переносом (`migrateInstalledPlaces`). */
  const mappedOf = (file) => file.mapped ?? isRoadsHeiFile(file.name);
  const added = files.filter((file) => mappedOf(file) && !isRoadsHeiFile(file.name)).map((file) => `+${file.name}`).sort();
  const held = files.filter((file) => !mappedOf(file) && isRoadsHeiFile(file.name)).map((file) => `-${file.name}`).sort();
  const layout = added.length || held.length ? `\nmap-group-v2\n${[...added, ...held].join("\n")}` : files.some(mappedOf) ? "\nmap-group-v1" : "";
  return createHash("sha256").update(`roads${layout}\n${lines.join("\n")}`, "utf8").digest("hex");
}

export const isRoadsModId = (value) => MOD_ID.test(String(value || ""));

/**
 * Манифест дорог из описи собранных словарей `{ name, size, sha256 }`. `mapNames` — имена, что игра включает только наборами `GROUP_MAP`
 * (`game-map-names.js`): их архив — `<пакет>_mp.rpf`, остальные (даже `hei_`) — в части на старте; без списка (игру не прочитали) — запасное правило `hei_`.
 */
export function buildRoadsManifest(files, { mapNames = null } = {}) {
  const digest = roadsSourceDigest(files.map((file) => ({ ...file, mapped: isRoadsMapFile(file.name, mapNames) })));
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-roads-${suffix}`,
    version: `${ROADS_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: цвет дорог, не правила игры.
    gameplayChanges: false,
    capabilities: capabilitiesOf(files.map((file) => file.name)),
    slots: [ROADS_SLOT],
    roads: { schemaVersion: ROADS_SCHEMA, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: roadsPackOf(file.name).target,
        action: "import",
        entry: `${roadsArchiveOf(file.name, mapNames)}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalRoadsManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.roads, ROADS_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${ROADS_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([ROADS_SLOT])) return false;
  if (manifest.roads.schemaVersion !== ROADS_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.roads.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.roads.resourceCount !== files.length) return false;
  const seen = new Set();
  let total = 0;
  const streams = new Map();
  const packs = new Map();
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.action !== "import") return false;
    if (!hasExactKeys(file.merge, ["strategy"]) || file.merge.strategy !== "rpf-resource-layer-v1") return false;
    const entry = String(file.entry || "");
    const slash = entry.indexOf("/");
    const stream = entry.slice(0, slash);
    const name = entry.slice(slash + 1);
    /* Поток — часть по имени или архив `GROUP_MAP` своего пакета: где файл лёг, решила сборка по игре игрока (оба архива — наши), а раскладку держит id
       (`roadsSourceDigest`: какие файлы в `_mp` без `hei_` и какие `hei_` остались в части). */
    if (slash < 1 || !ARCHIVES.has(stream)) return false;
    const mapStream = roadsMapStreamOf(roadsPackOf(name));
    if (stream !== roadsStreamOf(name) && stream !== mapStream) return false;
    /* Словарь — по простому имени; модель — только из описи (список — копия, не чужой пакет). */
    if (seen.has(name) || !(DICTIONARY.test(name) || (MODEL.test(name) && MODEL_NAMES.has(name)))) return false;
    if (file.target !== roadsPackOf(name).target) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    total += file.size;
    streams.set(stream, (streams.get(stream) || 0) + file.size);
    packs.set(file.target, (packs.get(file.target) || 0) + file.size);
    described.push({ name, sha256: file.sha256, mapped: stream === mapStream });
  }
  if (total > MAX_TOTAL_BYTES) return false;
  if ([...streams.values()].some((bytes) => bytes > MAX_STREAM_BYTES)) return false;
  if ([...packs.values()].some((bytes) => bytes > ROADS_DLC_MAX_BYTES)) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(capabilitiesOf(described.map((item) => item.name)))) return false;
  const digest = roadsSourceDigest(described);
  if (manifest.roads.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
