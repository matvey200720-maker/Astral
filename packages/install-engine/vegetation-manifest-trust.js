import { createHash } from "node:crypto";
import { VEGETATION_FILES } from "./vegetation-files.js";
import { VEGETATION_WORLD_FILES } from "./vegetation-world-files.js";
/* Посадка: карты районов и карты травы засаженности (ТЗ 11.10.2026). */
import { VEGETATION_PLANTING_FILES } from "./vegetation-planting-files.js";
/* «В разнобой»: копии моделей и словарей, типы копий, карты районов (ТЗ 17.10.2026). */
import { VEGETATION_VARIETY_FILES } from "./vegetation-variety-files.js";
import {
  isVegetationHeiFile,
  isVegetationMapFile,
  VEGETATION_DLC_ALL_PACKS,
  VEGETATION_DLC_STREAM,
  VEGETATION_DLC_TARGET,
  VEGETATION_LAYOUT_THREE_PACKS,
  VEGETATION_LAYOUT_TWO_PACKS,
  vegetationArchiveOf,
  vegetationArchivesOf,
  vegetationLayoutPacks,
  vegetationMapStreamOf,
  vegetationPackOf,
  vegetationStreamOf,
} from "./vegetation-dlc.js";

/*
 * Растительность из мастерской — один пакет движка: листва и её карточки
 * вдали, трава и земля «Зелёного Сэнди Шорс», улучшенные модели из мода
 * игрока под именами моделей игры. Своих файлов растительность не везёт —
 * правит файлы игры игрока (`apps/desktop/src/recolor-vegetation.js`);
 * право писать даёт ровно эта форма манифеста, а имена — копия описи
 * (`vegetation-files.js`).
 *
 * С 05.10.2026 (схема 2, задача 10) файлы едут в свой пакет дополнения
 * `astral_vegetation` (`vegetation-dlc.js`), а не в контейнер update.rpf:
 * пустыня целиком с дальними планами — около двух гигабайт, update.rpf их
 * не вместит (предел 4 ГБ), а пакет, загруженный после пакетов Rockstar,
 * перекрывает и их файлы. Прежние пакеты схемы 1 (в
 * `x64/astral/astral_vegetation.rpf`) узнаются по id и уходят заменой.
 *
 * Схема 3 (05.10.2026): файлы — по четырём потоковым архивам пакета, каждый
 * в своём (`vegetationStreamOf`), и ни один архив не больше 1,5 ГБ. Пакет
 * схемы 2 (всё в одном архиве) остаётся в игре, пока работа не сменится.
 *
 * Схема 4 («Трава по миру», 06.10.2026): трава обеих зон со штатной травой
 * города и загорода — до шести гигабайт, а архив пакета дополнения держит
 * меньше 4 ГиБ (самый большой у Rockstar — 3,98 ГБ). Файлы — по восьми
 * частям двух пакетов (`astral_vegetation` и `astral_vegetation_b`, по
 * четыре части в каждом), часть и пакет — по имени файла; у каждого пакета
 * потолок 3,75 ГБ, у части — 1,5 ГБ. Разрешение манифеста — на каждый
 * пакет, в котором есть файлы.
 *
 * С задачи 2 ТЗ 10.10.2026 (вечер) пакет вправе везти ещё словари и модели
 * с листами живых изгородей и карты районов с деревьями перемешки
 * (`vegetation-world-files.js`) — форма манифеста та же.
 *
 * «В разнобой» (задача 7 ТЗ 17.10.2026): копии моделей и словарей деревьев
 * и кустов своего цвета (`astral_vm<N>_<имя>`), их постоянные типы
 * (`astral_vegmix*.ytyp`) и карты районов (`vegetation-variety-files.js`) —
 * форма манифеста та же.
 *
 * С 12.10.2026 файлы сетевой карты (`hei_…`) — в архиве `GROUP_MAP` своего
 * пакета (`vegetationArchiveOf`). Это другая раскладка тех же файлов: у
 * работы с ними новый id, и поставленное раньше переезжает переносом
 * (`migrateInstalledPlaces`).
 *
 * Схема 5 (19.11.2026, третий пакет): файлы — по двенадцати частям трёх
 * пакетов (`astral_vegetation_c`, части 9–12). Схема 4 остаётся у всех работ,
 * что помещаются в два пакета; схему 5 получает только работа, которой двух
 * мало, и только при включённом третьем пакете (`chooseVegetationLayout`).
 * Проверка принимает обе: поставленное по схеме 4 стоит как стояло.
 */
import { LOCAL_VEGETATION_TRUST, VEGETATION_MOD_ID, VEGETATION_THIRD_PACK_ENV, isVegetationModId } from "./vegetation-ids.js";
export { LOCAL_VEGETATION_TRUST, VEGETATION_THIRD_PACK_ENV, isVegetationModId };
export const VEGETATION_SCHEMA = 4;
export const VEGETATION_SCHEMA_THREE_PACKS = 5;
const LAYOUT_OF_SCHEMA = Object.freeze({ [VEGETATION_SCHEMA]: VEGETATION_LAYOUT_TWO_PACKS, [VEGETATION_SCHEMA_THREE_PACKS]: VEGETATION_LAYOUT_THREE_PACKS });
const schemaOfLayout = (layout) => (layout === VEGETATION_LAYOUT_THREE_PACKS ? VEGETATION_SCHEMA_THREE_PACKS : VEGETATION_SCHEMA);
/* Где лежат файлы растительности в архиве пакета. */
export const VEGETATION_CONTAINER = VEGETATION_DLC_STREAM;
export const VEGETATION_ARCHIVE = VEGETATION_DLC_TARGET;
export const VEGETATION_SLOT = "vegetation";

const ALLOWED = new Set([...VEGETATION_FILES, ...VEGETATION_WORLD_FILES, ...VEGETATION_PLANTING_FILES, ...VEGETATION_VARIETY_FILES]);
/** Все имена, какие манифест растительности вправе везти (кандидаты для чтения `GROUP_MAP` игры: `apps/desktop/src/map-name-candidates.js`). */
export const VEGETATION_ALLOWED_NAMES = ALLOWED;
const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 96 * MiB;
const MAX_PACK_BYTES = 3840 * MiB;
const maxTotalBytes = (layout) => MAX_PACK_BYTES * vegetationLayoutPacks(layout).length;
const MAX_STREAM_BYTES = 1536 * MiB;
/** Пределы пакета и его части — те же, что проверяет доверие. */
export const VEGETATION_MAX_PACK_BYTES = MAX_PACK_BYTES;
export const VEGETATION_MAX_STREAM_BYTES = MAX_STREAM_BYTES;
/* Архивы пакетов, куда растительность вправе писать: части и архивы сетевой карты. Какой из них — файла, решает раскладка. */
const ARCHIVES = new Set(VEGETATION_DLC_ALL_PACKS.flatMap(vegetationArchivesOf));
const MOD_ID = VEGETATION_MOD_ID;
const NAME = "Растительность Astral";

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
  "vegetation",
  "files",
]);
const VEGETATION_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
/* Разрешения: вход в архив и по одному на каждый пакет, где есть файлы. */
const capabilitiesOf = (names, layout) => [
  "rpf-container-entry-v1",
  ...vegetationLayoutPacks(layout).filter((pack) => names.some((name) => vegetationPackOf(name, layout) === pack)).map((pack) => pack.capability),
];

/*
 * Выбор раскладки (19.11.2026). Третий пакет включает выключатель `ASTRAL_VEGETATION_THIRD_PACK`: `1` — работа, которая не
 * помещается в два пакета, ложится в три; `force` — в три ложится любая (стенды и проверка в игре). Без выключателя —
 * всегда два пакета, как было: в игре три пакета пока не проверены.
 */

/** Байты по пакетам и архивам работы в раскладке `layout`: `{ packs: Map<имя пакета, байт>, streams: Map<архив, байт>, total }`. */
export function vegetationLayoutSizes(files, { mapNames = null, layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const packs = new Map();
  const streams = new Map();
  let total = 0;
  for (const file of files || []) {
    const size = Number(file.size) || 0;
    const pack = vegetationPackOf(file.name, layout).name;
    const stream = vegetationArchiveOf(file.name, mapNames, layout);
    packs.set(pack, (packs.get(pack) || 0) + size);
    streams.set(stream, (streams.get(stream) || 0) + size);
    total += size;
  }
  return { packs, streams, total };
}

/** Работа помещается в раскладку: ни один пакет и ни одна часть не больше предела. */
export function vegetationLayoutFits(files, options = {}) {
  const { packs, streams } = vegetationLayoutSizes(files, options);
  return [...packs.values()].every((bytes) => bytes <= MAX_PACK_BYTES) && [...streams.values()].every((bytes) => bytes <= MAX_STREAM_BYTES);
}

/** Третий пакет разрешён выключателем: `"off"`, `"overflow"` (только когда двух мало) или `"force"`. */
export function vegetationThirdPackMode(env = process.env) {
  const word = String(env?.[VEGETATION_THIRD_PACK_ENV] ?? "").trim().toLowerCase();
  if (word === "force") return "force";
  return ["1", "on", "true"].includes(word) ? "overflow" : "off";
}

/** Раскладка для работы из файлов `{ name, size }`. */
export function chooseVegetationLayout(files, { mapNames = null, env = process.env } = {}) {
  const mode = vegetationThirdPackMode(env);
  if (mode === "force") return VEGETATION_LAYOUT_THREE_PACKS;
  if (mode === "off" || vegetationLayoutFits(files, { mapNames, layout: VEGETATION_LAYOUT_TWO_PACKS })) return VEGETATION_LAYOUT_TWO_PACKS;
  return VEGETATION_LAYOUT_THREE_PACKS;
}

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * Хэш содержимого: отсортированные пары `имя\nsha256` и раскладка. `file.mapped` — файл лежит в архиве `GROUP_MAP` пакета (по умолчанию — по правилу `hei_`).
 */
export function vegetationSourceDigest(files, { layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  /* Файлы сетевой карты в архивах `GROUP_MAP` (12.10.2026) — другая раскладка: новый id. Раскладка, где в `_mp` ровно `hei_` (кроме пропов), — прежняя
     `map-group-v1` (id работ без расхождений не меняются). Иначе (26.10.2026, по игре игрока) — `map-group-v2` и два списка: `+имя` — файл без `hei_` в `_mp`
     (словари крон и травяные карты `apa_*`, `lr_*`, `xm_*`…), `-имя` — `hei_` оставлен в части на старте (у Rockstar он вне `GROUP_MAP`). */
  const mappedOf = (file) => file.mapped ?? isVegetationHeiFile(file.name);
  const added = files.filter((file) => mappedOf(file) && !isVegetationHeiFile(file.name)).map((file) => `+${file.name}`).sort();
  const held = files.filter((file) => !mappedOf(file) && isVegetationHeiFile(file.name)).map((file) => `-${file.name}`).sort();
  const mapLayout = added.length || held.length ? `\nmap-group-v2\n${[...added, ...held].join("\n")}` : files.some(mappedOf) ? "\nmap-group-v1" : "";
  /* Три пакета — другое место тех же файлов: у работы новый id. У двух пакетов строка хэша прежняя. */
  const packsLayout = layout === VEGETATION_LAYOUT_THREE_PACKS ? "\npacks-3" : "";
  return createHash("sha256").update(`vegetation${packsLayout}${mapLayout}\n${lines.join("\n")}`, "utf8").digest("hex");
}


/**
 * Манифест растительности из описи собранных файлов `{ name, size, sha256 }`. `mapNames` — имена, что игра включает только наборами `GROUP_MAP`
 * (`game-map-names.js`): их архив — `<пакет>_mp.rpf`, остальные (даже `hei_`) — в части на старте; без списка (игру не прочитали) — запасное правило `hei_`.
 * `layout` — раскладка (`chooseVegetationLayout`): два пакета (схема 4) или три (схема 5).
 */
export function buildVegetationManifest(files, { mapNames = null, layout = VEGETATION_LAYOUT_TWO_PACKS } = {}) {
  const schema = schemaOfLayout(layout);
  const digest = vegetationSourceDigest(files.map((file) => ({ ...file, mapped: isVegetationMapFile(file.name, mapNames) })), { layout });
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-vegetation-${suffix}`,
    version: `${schema}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: листва и трава, не правила игры.
    gameplayChanges: false,
    capabilities: capabilitiesOf(files.map((file) => file.name), layout),
    slots: [VEGETATION_SLOT],
    vegetation: { schemaVersion: schema, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: vegetationPackOf(file.name, layout).target,
        action: "import",
        entry: `${vegetationArchiveOf(file.name, mapNames, layout)}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalVegetationManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.vegetation, VEGETATION_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  const schema = manifest.vegetation.schemaVersion;
  const layout = Object.hasOwn(LAYOUT_OF_SCHEMA, schema) ? LAYOUT_OF_SCHEMA[schema] : null;
  if (layout === null) return false;
  if (manifest.version !== `${schema}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([VEGETATION_SLOT])) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.vegetation.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > ALLOWED.size) return false;
  if (manifest.vegetation.resourceCount !== files.length) return false;
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
       (`vegetationSourceDigest`: какие файлы в `_mp` без `hei_` и какие `hei_` остались в части). */
    if (slash < 1 || !ARCHIVES.has(stream)) return false;
    const pack = vegetationPackOf(name, layout);
    const mapStream = vegetationMapStreamOf(pack);
    if (stream !== vegetationStreamOf(name, layout) && stream !== mapStream) return false;
    if (file.target !== pack.target) return false;
    if (!ALLOWED.has(name) || seen.has(name)) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    total += file.size;
    streams.set(stream, (streams.get(stream) || 0) + file.size);
    packs.set(file.target, (packs.get(file.target) || 0) + file.size);
    described.push({ name, sha256: file.sha256, mapped: stream === mapStream });
  }
  if (total > maxTotalBytes(layout)) return false;
  if ([...streams.values()].some((bytes) => bytes > MAX_STREAM_BYTES)) return false;
  if ([...packs.values()].some((bytes) => bytes > MAX_PACK_BYTES)) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(capabilitiesOf(described.map((item) => item.name), layout))) return false;
  const digest = vegetationSourceDigest(described, { layout });
  if (manifest.vegetation.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
