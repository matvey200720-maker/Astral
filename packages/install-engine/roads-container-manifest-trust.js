import { createHash } from "node:crypto";
import { LOCAL_ROADS_CONTAINER_TRUST } from "./container-trust-symbols.js";
import { ROADS_MODEL_NAMES } from "./roads-model-names.js";
import { ROADS_UPDATE_CONTAINERS, ROADS_CONTAINER_MAX_BYTES, ROADS_UPDATE_TARGET, roadsContainerOf, roadsUpdateEntry } from "./roads-update-route.js";

/*
 * «Дороги» через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026; `roads-update-route.js`): та же работа мастерской, но файлы лежат не в пакетах `astral_roads*`,
 * а в двух контейнерах слоя `x64/astral/astral_rp_road(_b).rpf` самого `update.rpf`. Форма манифеста — как у воды и оптимизации (`astral-content-rpf-v1`:
 * одни импорты в контейнеры слоя), id того же вида `local-legacy-roads-<12 hex>` (слот `roads`, откат и снятие находят работу как прежде), но отпечаток другой:
 * те же файлы в пакетах и в контейнере — две разные работы. Право писать даёт ровно эта форма.
 */
export { LOCAL_ROADS_CONTAINER_TRUST };
export const ROADS_CONTAINER_SCHEMA = 2;
export const ROADS_CONTAINER_SLOT = "roads";

const MiB = 1024 * 1024;
const MAX_FILES = 6000;
const MAX_FILE_BYTES = 96 * MiB;
const MAX_TOTAL_BYTES = 2 * ROADS_CONTAINER_MAX_BYTES;
const MOD_ID = /^local-legacy-roads-([a-f0-9]{12})$/;
const NAME = "Дороги Astral";
const DICTIONARY = /^[a-z0-9][a-z0-9._+~-]{0,119}\.ytd$/;
const MODEL = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ydd|yft)$/;
const MODEL_NAMES = new Set(ROADS_MODEL_NAMES);
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "astral-content-rpf-v1", "direct-update-rpf-v1", "direct-update-entries-v1"]);

const MANIFEST_KEYS = Object.freeze(["id", "version", "name", "editions", "scope", "adapter", "requiresLoader", "gameplayChanges", "capabilities", "slots", "roads", "files"]);
const ROADS_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Отпечаток содержимого: отсортированные пары `имя\nsha256` и метка формы. */
export function roadsContainerSourceDigest(files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`roads-container-v1\n${lines.join("\n")}`, "utf8").digest("hex");
}

/** Манифест из описи собранных словарей `{ name, size, sha256 }`. */
export function buildRoadsContainerManifest(files) {
  const digest = roadsContainerSourceDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-roads-${suffix}`,
    version: `${ROADS_CONTAINER_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Облик мира: цвет дорог, не правила игры.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [ROADS_CONTAINER_SLOT],
    roads: { schemaVersion: ROADS_CONTAINER_SCHEMA, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: ROADS_UPDATE_TARGET,
        action: "import",
        entry: roadsUpdateEntry(file.name),
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalRoadsContainerManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.roads, ROADS_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${ROADS_CONTAINER_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false || manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([ROADS_CONTAINER_SLOT])) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (manifest.roads.schemaVersion !== ROADS_CONTAINER_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.roads.sourceDigest || "")) return false;
  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.roads.resourceCount !== files.length) return false;
  const seen = new Set();
  const sides = new Map(ROADS_UPDATE_CONTAINERS.map((container) => [container, 0]));
  let total = 0;
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.action !== "import" || file.target !== ROADS_UPDATE_TARGET) return false;
    const entry = String(file.entry || "");
    const name = entry.slice(entry.lastIndexOf("/") + 1);
    /* Словарь — любое простое имя `.ytd`; модель — только из описи; запись — ровно в свой контейнер. */
    if (seen.has(name) || !(DICTIONARY.test(name) || (MODEL.test(name) && MODEL_NAMES.has(name)))) return false;
    if (entry !== roadsUpdateEntry(name)) return false;
    seen.add(name);
    if (file.source !== `payload/${name}`) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) return false;
    total += file.size;
    const container = roadsContainerOf(name);
    sides.set(container, sides.get(container) + file.size);
    described.push({ name, sha256: file.sha256 });
  }
  if (total > MAX_TOTAL_BYTES) return false;
  if ([...sides.values()].some((bytes) => bytes > ROADS_CONTAINER_MAX_BYTES)) return false;
  const digest = roadsContainerSourceDigest(described);
  if (manifest.roads.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
