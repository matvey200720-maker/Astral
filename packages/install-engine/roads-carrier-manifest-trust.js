import { createHash } from "node:crypto";
import { LOCAL_ROADS_CARRIER_TRUST } from "./container-trust-symbols.js";
import { ROADS_MODEL_NAMES } from "./roads-model-names.js";
import { ROADS_CONTAINER_MAX_BYTES, ROADS_UPDATE_TARGET } from "./roads-update-route.js";
import { ROADS_CARRIER_TARGET, ROADS_SPILL_CARRIER, roadsLaneContainerOf, roadsLaneContainers, roadsLaneEntryOf } from "./roads-carrier-route.js";
import { CARRIER_LANES } from "./carrier-targets.js";

/*
 * «Дороги» через носитель `update/update2.rpf` (GTA 5 RP, 20.11.2026; `roads-carrier-route.js`): та же работа мастерской, но файлы лежат в трёх контейнерах слоя
 * `x64/astral/astral_rp_road(_b|_c).rpf` носителя, а регистрации `update2:/%PLATFORM%/astral/<имя>.rpf` приложение дописывает в `content.xml` файла `update.rpf` само
 * (`carrier-targets.js`, за выключателем `ASTRAL_CARRIERS=update2`). Форма манифеста — обычная контейнерная (`astral-content-rpf-v1`), id того же вида `local-legacy-roads-<12 hex>`
 * (слот `roads`, откат и снятие находят работу как прежде), отпечаток другой: те же файлы в `update.rpf` и в носителе — две разные работы. Право писать даёт ровно эта форма.
 */
export { LOCAL_ROADS_CARRIER_TRUST };
export const ROADS_CARRIER_SCHEMA = 3;
export const ROADS_CARRIER_SLOT = "roads";

const MiB = 1024 * 1024;
const MAX_FILES = 6000;
const MAX_FILE_BYTES = 96 * MiB;
/* Носители манифеста по id: `update2`, штатные пакеты по таблице и второй носитель раскладки — сам `update.rpf` (`update`, контейнеры `astral_rp_road(_b).rpf`). */
const TARGET_OF = new Map([...CARRIER_LANES.map((item) => [item.id, item.target]), [ROADS_SPILL_CARRIER, ROADS_UPDATE_TARGET]]);
const LANE_OF_TARGET = new Map([...TARGET_OF].map(([id, target]) => [target, id]));
const MAX_TOTAL_BYTES = (id) => roadsLaneContainers(id).length * ROADS_CONTAINER_MAX_BYTES; /* на каждый носитель */
const MOD_ID = /^local-legacy-roads-([a-f0-9]{12})$/;
const NAME = "Дороги Astral";
const DICTIONARY = /^[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
const MODEL = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const MODEL_NAMES = new Set(ROADS_MODEL_NAMES);
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "astral-content-rpf-v1", "direct-update-rpf-v1", "direct-update-entries-v1"]);

const MANIFEST_KEYS = Object.freeze(["id", "version", "name", "editions", "scope", "adapter", "requiresLoader", "gameplayChanges", "capabilities", "slots", "roads", "files"]);
const ROADS_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);

const carrierIdOf = (target) => LANE_OF_TARGET.get(target);
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Отпечаток содержимого: отсортированные пары `имя\nsha256` и метка формы. */
export function roadsCarrierSourceDigest(files) {
  /* Файл в штатном пакете называет носителя в отпечатке (две раскладки — две разные работы); у update2 строка прежняя, прежние id не меняются. */
  const lines = files.map((file) => `${file.carrier && file.carrier !== "update2" ? `${file.carrier}:` : ""}${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`roads-carrier-v1\n${lines.join("\n")}`, "utf8").digest("hex");
}

/** Манифест из описи собранных словарей `{ name, size, sha256 }`. */
export function buildRoadsCarrierManifest(files) {
  const digest = roadsCarrierSourceDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-roads-${suffix}`,
    version: `${ROADS_CARRIER_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: цвет дорог, не правила игры.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [ROADS_CARRIER_SLOT],
    roads: { schemaVersion: ROADS_CARRIER_SCHEMA, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: TARGET_OF.get(file.carrier || "update2") ?? ROADS_CARRIER_TARGET,
        action: "import",
        entry: roadsLaneEntryOf(file.carrier || "update2")(file.name),
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalRoadsCarrierManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.roads, ROADS_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${ROADS_CARRIER_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false || manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([ROADS_CARRIER_SLOT])) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (manifest.roads.schemaVersion !== ROADS_CARRIER_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.roads.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.roads.resourceCount !== files.length) return false;
  const seen = new Set();
  const sides = new Map([...TARGET_OF].flatMap(([id, target]) => roadsLaneContainers(id).map((container) => [`${target}|${container}`, 0])));
  const totals = new Map([...TARGET_OF.values()].map((target) => [target, 0]));
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.action !== "import" || !LANE_OF_TARGET.has(file.target)) return false;
    const lane = LANE_OF_TARGET.get(file.target);
    const entry = String(file.entry || "");
    const name = entry.slice(entry.lastIndexOf("/") + 1);
    /* Словарь — любое простое имя `.ytd`; модель — только из описи; запись — ровно в свой контейнер. */
    if (seen.has(name) || !(DICTIONARY.test(name) || (MODEL.test(name) && MODEL_NAMES.has(name)))) return false;
    if (entry !== roadsLaneEntryOf(lane)(name)) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    totals.set(file.target, totals.get(file.target) + file.size);
    const side = `${file.target}|${roadsLaneContainerOf(lane)(name)}`;
    sides.set(side, sides.get(side) + file.size);
    described.push({ name, sha256: file.sha256, carrier: carrierIdOf(file.target) });
  }
  if ([...totals].some(([target, bytes]) => bytes > MAX_TOTAL_BYTES(LANE_OF_TARGET.get(target)))) return false;
  if ([...sides.values()].some((bytes) => bytes > ROADS_CONTAINER_MAX_BYTES)) return false;
  const digest = roadsCarrierSourceDigest(described);
  if (manifest.roads.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
