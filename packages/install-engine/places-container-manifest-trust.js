import { createHash } from "node:crypto";
import { LOCAL_PLACES_CONTAINER_TRUST } from "./container-trust-symbols.js";
import { ROADS_CONTAINER_MAX_BYTES } from "./roads-update-route.js";
import { PLACES_RP_MANIFEST, PLACES_RP_MANIFEST_PAYLOAD, placesRpNeverByContainer } from "./places-rp-parts.js";
import { PLACES_UPDATE_TARGET, PLACES_WHOLE_SETS, placesContainerEntry, placesPartialSet } from "./places-update-route.js";
import { RECOLOR_SETS, recolorSetOfModId } from "./recolor-manifest-trust.js";

/*
 * Места мастерской через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026; `places-update-route.js`): та же работа набора, но все файлы лежат в его контейнере слоя
 * `x64/astral/astral_<набор>.rpf` самого `update.rpf`, а не в пакете `astral_places`. Форма манифеста — как у дорог и растительности в контейнерах (`astral-content-rpf-v1`: одни импорты
 * в контейнер слоя, без слияния ресурсов), ключи — как у манифеста набора (`recolor`), id того же вида `local-legacy-<набор>-<12 hex>` (слот набора, откат, снятие и перенос находят работу
 * как прежде), но схема и отпечаток другие: те же файлы в пакете и в контейнере — две разные работы. Едут только наборы целиком (`PLACES_WHOLE_SETS`). Право писать даёт ровно эта форма.
 */
export { LOCAL_PLACES_CONTAINER_TRUST };
export const PLACES_CONTAINER_SCHEMA = 5;

const MAX_TOTAL_BYTES = ROADS_CONTAINER_MAX_BYTES;
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "astral-content-rpf-v1", "direct-update-rpf-v1", "direct-update-entries-v1"]);
const MANIFEST_KEYS = Object.freeze(["id", "version", "name", "editions", "scope", "adapter", "requiresLoader", "gameplayChanges", "capabilities", "slots", "recolor", "files"]);
const RECOLOR_KEYS = Object.freeze(["set", "schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);

/* Набор в контейнере: целиком (`PLACES_WHOLE_SETS`) или частью на RP (`PLACES_PARTIAL_SETS`, 21.11.2026) — у второго не едут перекрытия, что перебивает пакет Rockstar, и то, что едет только с ними. */
const containerSet = (setId) => PLACES_WHOLE_SETS.includes(setId) || placesPartialSet(setId);
const carried = (setId, name) => !(placesPartialSet(setId) && placesRpNeverByContainer(setId, name));
/* Частичный набор кладёт СВОЙ манифест контейнера (`_manifest.ymf` по едущим файлам, собран заново): из пакета сборки он берётся под именем `payload/_manifest.rp.ymf`, а полный манифест сборки (он называет и снятые типы) в контейнер не идёт. */
const payloadOf = (setId, file) => (placesPartialSet(setId) && file.name === PLACES_RP_MANIFEST ? PLACES_RP_MANIFEST_PAYLOAD : file.name);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Отпечаток содержимого: набор, метка формы и отсортированные пары `имя\nsha256`. */
export function placesContainerSourceDigest(setId, files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`${setId}\nplaces-container-v1\n${lines.join("\n")}`, "utf8").digest("hex");
}

/** Манифест набора из описи собранных файлов `{ name, size, sha256 }`. */
export function buildPlacesContainerManifest(setId, files) {
  const set = RECOLOR_SETS[setId];
  if (!set || !containerSet(setId)) throw new Error(`Набор «${setId}» контейнером в update.rpf не едет.`);
  if (placesPartialSet(setId)) {
    const own = new Set([...set.files, ...set.extra]);
    const stray = files.find((file) => !own.has(file.name) || !carried(setId, file.name));
    if (stray) throw new Error(`Файл «${stray.name}» набора «${setId}» контейнером в update.rpf не едет.`);
    const full = files.find((file) => file.name === PLACES_RP_MANIFEST && file.payload !== PLACES_RP_MANIFEST_PAYLOAD);
    if (full) throw new Error(`Манифест набора «${setId}» в контейнер идёт только заново собранным по едущим файлам (payload/${PLACES_RP_MANIFEST_PAYLOAD}).`);
  }
  const digest = placesContainerSourceDigest(setId, files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-${setId}-${suffix}`,
    version: `${PLACES_CONTAINER_SCHEMA}.0.0-${suffix}`,
    name: set.name,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Модели мира: набор меняет здания и пропы, как у пакетной формы.
    gameplayChanges: true,
    capabilities: [...CAPABILITIES],
    slots: [set.slot],
    recolor: { set: setId, schemaVersion: PLACES_CONTAINER_SCHEMA, sourceDigest: `sha256:${digest}`, resourceCount: files.length },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({ source: `payload/${payloadOf(setId, file)}`, target: PLACES_UPDATE_TARGET, action: "import", entry: placesContainerEntry(setId, file.name), size: file.size, sha256: file.sha256 })),
  };
}

export function isLocalPlacesContainerManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.recolor, RECOLOR_KEYS)) return false;
  const setId = manifest.recolor.set;
  if (!containerSet(setId)) return false;
  const set = RECOLOR_SETS[setId];
  const match = /^local-legacy-([a-z]+)-([a-f0-9]{12})$/.exec(manifest.id || "");
  if (!match || match[1] !== setId || recolorSetOfModId(manifest.id) !== setId) return false;
  const suffix = match[2];
  if (manifest.version !== `${PLACES_CONTAINER_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== set.name) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false || manifest.gameplayChanges !== true) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([set.slot])) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (manifest.recolor.schemaVersion !== PLACES_CONTAINER_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.recolor.sourceDigest || "")) return false;
  const files = manifest.files;
  const allowed = new Set([...set.files, ...set.extra].filter((name) => carried(setId, name)));
  if (!Array.isArray(files) || files.length < 1 || files.length > allowed.size) return false;
  if (manifest.recolor.resourceCount !== files.length) return false;
  const seen = new Set();
  let total = 0;
  const described = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.action !== "import" || file.target !== PLACES_UPDATE_TARGET) return false;
    const source = String(file.source || "").startsWith("payload/") ? file.source.slice("payload/".length) : "";
    /* Частичный набор: манифест контейнера — только собранный заново (`payload/_manifest.rp.ymf`), полный манифест сборки не принимается. */
    const name = placesPartialSet(setId) && source === PLACES_RP_MANIFEST_PAYLOAD ? PLACES_RP_MANIFEST : source;
    if (!name || !allowed.has(name) || seen.has(name) || payloadOf(setId, { name }) !== source) return false;
    seen.add(name);
    if (file.entry !== placesContainerEntry(setId, name)) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > set.maxBytes) return false;
    total += file.size;
    described.push({ name, sha256: file.sha256 });
  }
  if (total > MAX_TOTAL_BYTES) return false;
  /* Набор не `partial` едет целиком: его свои файлы — все до одного, кроме `optional`. */
  if (!set.partial && set.files.some((name) => !seen.has(name) && !set.optional.includes(name))) return false;
  const digest = placesContainerSourceDigest(setId, described);
  if (manifest.recolor.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
