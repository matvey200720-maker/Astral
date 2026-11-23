import { createHash } from "node:crypto";
import { LOCAL_VEGETATION_CARRIER_TRUST } from "./container-trust-symbols.js";
import { CARRIER_LANES } from "./carrier-targets.js";
import { VEGETATION_FILES } from "./vegetation-files.js";
import { VEGETATION_GRASS_MAP_FILES } from "./vegetation-grass-map-files.js";
import { VEGETATION_WORLD_FILES } from "./vegetation-world-files.js";
import { VEGETATION_PLANTING_FILES } from "./vegetation-planting-files.js";
import { VEGETATION_VARIETY_FILES } from "./vegetation-variety-files.js";
import { VEGETATION_CONTAINER_MAX_BYTES } from "./vegetation-update-route.js";
import { VEGETATION_SPILL_LANE, vegetationLaneContainerOf, vegetationLaneContainers, vegetationLaneEntryOf, vegetationLaneTarget } from "./vegetation-carrier-route.js";

/*
 * «Растительность» с травой, изгородями и цветами на нескольких носителях (GTA 5 RP, 21.11.2026; `vegetation-carrier-route.js`). Одна работа мастерской, у КАЖДОГО файла свой носитель:
 *  • `update` — контейнеры `x64/astral/astral_rp_vegetation(_b).rpf` самого `update.rpf` (деревья вида и всё, что раскладчик положил туда);
 *  • `update2` — три контейнера слоя `x64/astral/astral_rp_vegetation_u2(_b|_c).rpf` носителя `update2.rpf`; регистрации `update2:/%PLATFORM%/astral/<имя>.rpf` в `content.xml` внутри `update.rpf`;
 *  • штатный пакет-носитель (`mpbiker` и другие по таблице `carrier-targets.js`, форма М) — те же имена контейнеров по пути `x64/levels/gta5/<имя>.rpf`, регистрация в `content.xml` самого пакета.
 * Форма манифеста — контейнерная (`astral-content-rpf-v1`), id того же вида `local-legacy-vegetation-<12 hex>` (слот `vegetation`, откат и снятие находят работу как прежде), схема 3: вне `update.rpf`
 * должен лежать хотя бы один файл (иначе это форма `update.rpf` со схемой 2). Отпечаток считает носитель каждого файла: те же файлы в другом месте — другая работа. Карты травы (`*_grass_N.ymap`,
 * только из описи карт игры) подтверждены в сюжете и на сервере ТОЛЬКО в update2.rpf: в `update.rpf` и в штатном пакете они не принимаются. Право писать даёт ровно эта форма.
 */
export { LOCAL_VEGETATION_CARRIER_TRUST };
export const VEGETATION_CARRIER_SCHEMA = 3;
export const VEGETATION_CARRIER_SLOT = "vegetation";

const MiB = 1024 * 1024;
const MAX_FILES = 12000;
const MAX_FILE_BYTES = 96 * MiB;
/* Носители манифеста по id и по цели: `update`, `update2`, штатные пакеты по таблице. */
const LANE_IDS = Object.freeze([VEGETATION_SPILL_LANE, ...CARRIER_LANES.map((item) => item.id)]);
const LANE_OF_TARGET = new Map(LANE_IDS.map((id) => [vegetationLaneTarget(id), id]));
const MAX_TOTAL_BYTES = (id) => vegetationLaneContainers(id).length * VEGETATION_CONTAINER_MAX_BYTES;
const MOD_ID = /^local-legacy-vegetation-([a-f0-9]{12})$/;
const NAME = "Растительность Astral";
const DICTIONARY = /^[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
const MODEL = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
/* Карты травы (`<район>_grass_<N>.ymap`): форма — шаблон; принимается имя из описи карт травы игры (`vegetation-grass-map-files.js`) и только в update2. */
const GRASS_MAP = /^[a-z0-9][a-z0-9_]{0,100}_grass_[0-9]{1,3}\.ymap$/;
const GRASS_MAP_NAMES = new Set(VEGETATION_GRASS_MAP_FILES);
/* Имена словарей и моделей — те же, что у пакетной формы: опись, мир (изгороди и прокси), посадка, «в разнобой». */
const NAMES = new Set([...VEGETATION_FILES, ...VEGETATION_WORLD_FILES, ...VEGETATION_PLANTING_FILES, ...VEGETATION_VARIETY_FILES]);
const nameAllowed = (name, lane) => (NAMES.has(name) && (DICTIONARY.test(name) || MODEL.test(name))) || (lane === "update2" && GRASS_MAP.test(name) && GRASS_MAP_NAMES.has(name));
/** Карта травы игры — всегда в update2 (`vegetation-container-build.js`): по описи, не по шаблону. */
export const isVegetationGrassMapName = (name) => GRASS_MAP_NAMES.has(String(name).toLowerCase());
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "astral-content-rpf-v1", "direct-update-rpf-v1", "direct-update-entries-v1"]);

const MANIFEST_KEYS = Object.freeze(["id", "version", "name", "editions", "scope", "adapter", "requiresLoader", "gameplayChanges", "capabilities", "slots", "vegetation", "files"]);
const VEGETATION_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Носитель файла описи сборки: `lane` (id) или прежняя метка `carrier` (true — update2, иначе update). */
const laneOfFile = (file) => file.lane ?? (file.carrier ? "update2" : VEGETATION_SPILL_LANE);
const TAG = (lane) => (lane === "update2" ? "c" : lane === VEGETATION_SPILL_LANE ? "u" : lane);

/** Отпечаток содержимого: отсортированные тройки `носитель\nимя\nsha256` и метка формы (`u` — update.rpf, `c` — update2.rpf, у штатного пакета — его id; прежние отпечатки не меняются). */
export function vegetationCarrierSourceDigest(files) {
  const lines = files.map((file) => `${TAG(laneOfFile(file))}\n${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`vegetation-carrier-v1\n${lines.join("\n")}`, "utf8").digest("hex");
}

/** Манифест из описи собранных файлов `{ name, size, sha256, lane? | carrier? }`. */
export function buildVegetationCarrierManifest(files) {
  const digest = vegetationCarrierSourceDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-vegetation-${suffix}`,
    version: `${VEGETATION_CARRIER_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: цвет листвы и травы, не правила игры.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [VEGETATION_CARRIER_SLOT],
    vegetation: { schemaVersion: VEGETATION_CARRIER_SCHEMA, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => {
        const lane = laneOfFile(file);
        return {
          source: `payload/${file.name}`,
          target: vegetationLaneTarget(lane),
          action: "import",
          entry: vegetationLaneEntryOf(lane)(file.name),
          size: file.size,
          sha256: file.sha256,
        };
      }),
  };
}

export function isLocalVegetationCarrierManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.vegetation, VEGETATION_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${VEGETATION_CARRIER_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false || manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([VEGETATION_CARRIER_SLOT])) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (manifest.vegetation.schemaVersion !== VEGETATION_CARRIER_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.vegetation.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.vegetation.resourceCount !== files.length) return false;
  const seen = new Set();
  const sides = new Map(LANE_IDS.flatMap((id) => vegetationLaneContainers(id).map((container) => [`${id}|${container}`, 0])));
  const totals = new Map(LANE_IDS.map((id) => [id, 0]));
  let outside = 0;
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.action !== "import" || !LANE_OF_TARGET.has(file.target)) return false;
    const lane = LANE_OF_TARGET.get(file.target);
    const entry = String(file.entry || "");
    const name = entry.slice(entry.lastIndexOf("/") + 1);
    /* Имя — из описи растительности: словарь `.ytd` или модель (карта травы — только update2); запись — ровно в свой контейнер своего носителя. */
    if (seen.has(name) || !nameAllowed(name, lane)) return false;
    if (entry !== vegetationLaneEntryOf(lane)(name)) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    totals.set(lane, totals.get(lane) + file.size);
    const side = `${lane}|${vegetationLaneContainerOf(lane)(name)}`;
    sides.set(side, sides.get(side) + file.size);
    if (lane !== VEGETATION_SPILL_LANE) outside += 1;
    described.push({ name, sha256: file.sha256, lane });
  }
  if (outside < 1) return false;
  if ([...totals].some(([id, bytes]) => bytes > MAX_TOTAL_BYTES(id))) return false;
  if ([...sides.values()].some((bytes) => bytes > VEGETATION_CONTAINER_MAX_BYTES)) return false;
  const digest = vegetationCarrierSourceDigest(described);
  if (manifest.vegetation.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}

/**
 * Что именно в манифесте не так — для сообщения об ошибке сборки (стенды, журнал): имена не из описи, большие файлы, перегруженные контейнеры, счёт. Без секретов: только имена и размеры.
 * Не заменяет строгую проверку (`isLocalVegetationCarrierManifest`), только объясняет её отказ.
 */
export function describeVegetationCarrierProblem(manifest) {
  const reasons = [];
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  if (files.length < 1 || files.length > MAX_FILES) reasons.push(`файлов ${files.length} (допустимо 1…${MAX_FILES})`);
  const outsideNames = [];
  const big = [];
  const wrongEntry = [];
  const sides = new Map();
  const totals = new Map();
  let outside = 0;
  for (const file of files) {
    const entry = String(file?.entry || "");
    const name = entry.slice(entry.lastIndexOf("/") + 1);
    const lane = LANE_OF_TARGET.get(file?.target);
    if (!lane) {
      wrongEntry.push(`${name} (цель ${file?.target})`);
      continue;
    }
    if (lane !== VEGETATION_SPILL_LANE) outside += 1;
    if (!nameAllowed(name, lane)) outsideNames.push(name);
    if (entry !== vegetationLaneEntryOf(lane)(name)) wrongEntry.push(name);
    if (!Number.isInteger(file?.size) || file.size < 1 || file.size > MAX_FILE_BYTES) big.push(`${name} ${file?.size}`);
    const size = Number(file?.size) || 0;
    totals.set(lane, (totals.get(lane) || 0) + size);
    const key = `${lane}/${vegetationLaneContainerOf(lane)(name)}`;
    sides.set(key, (sides.get(key) || 0) + size);
  }
  if (outsideNames.length) reasons.push(`имена вне описи или формы (${outsideNames.length}): ${outsideNames.slice(0, 5).join(", ")}`);
  if (wrongEntry.length) reasons.push(`запись не в свой контейнер (${wrongEntry.length}): ${wrongEntry.slice(0, 5).join(", ")}`);
  if (big.length) reasons.push(`размер вне 1…${MAX_FILE_BYTES} Б (${big.length}): ${big.slice(0, 5).join(", ")}`);
  for (const [id, bytes] of totals) if (bytes > MAX_TOTAL_BYTES(id)) reasons.push(`носитель ${id}: всего ${bytes} Б больше ${MAX_TOTAL_BYTES(id)}`);
  for (const [key, bytes] of sides) if (bytes > VEGETATION_CONTAINER_MAX_BYTES) reasons.push(`контейнер ${key}: ${bytes} Б больше предела ${VEGETATION_CONTAINER_MAX_BYTES}`);
  if (!outside) reasons.push("вне update.rpf нет ни одного файла");
  return reasons.length ? reasons.join("; ") : "по описи имён, размеров и контейнеров причины нет (проверяются ключи, id, версия, отпечаток)";
}
