import { createHash } from "node:crypto";

/*
 * «Дальность прорисовки» (задача 7 ТЗ 06.10.2026) — свой пакет движка.
 *
 * Два файла и ничего сверх:
 *   • `timecycle_mods_2.xml` объединением `timecycle-modifier-v1` — один
 *     модификатор `AstralDrawDistance` (дальность отсечения и туман-стена);
 *     движок кладёт его поверх файла игрока по имени, модификаторы игры и
 *     чужих модов остаются;
 *   • `astral_draw_distance.ymap` в своём контейнере слоя Astral — карта с
 *     одной коробкой этого модификатора на всю карту (как коробки
 *     `ReduceDrawDistanceMAP` у Rockstar).
 *
 * Имя модификатора — копия из `@modovik/optimizer/draw-distance.js` (нарочно
 * здесь: проверку нельзя ослабить правкой чужого пакета; совпадение держит
 * тест). Символ доверия предъявить может только install-engine.
 */
export const LOCAL_DRAW_DISTANCE_TRUST = Symbol("local-draw-distance-package");
export const DRAW_DISTANCE_SCHEMA = 1;
export const DRAW_DISTANCE_SLOT = "optimization-draw-distance";
export const DRAW_DISTANCE_MODIFIER_NAME = "AstralDrawDistance";
export const DRAW_DISTANCE_TIMECYCLE_ENTRY = "common/data/timecycle/timecycle_mods_2.xml";
export const DRAW_DISTANCE_CONTAINER_ENTRY = "x64/astral/astral_draw_distance.rpf";
export const DRAW_DISTANCE_MAP_FILE = "astral_draw_distance.ymap";
const TIMECYCLE_FILE = "timecycle_mods_2.xml";
/* Выше слоёв оптимизации (300): своё имя всё равно одно, но порядок — явный. */
const TIMECYCLE_PRIORITY = 320;
const UPDATE = "update/update.rpf";
const MAX_TIMECYCLE_BYTES = 64 * 1024;
const MAX_MAP_BYTES = 64 * 1024;

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
  "drawDistance",
  "files",
]);
const DRAW_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "distance", "fileCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
  "timecycle-modifier-merge-v1",
]);
const MOD_ID = /^local-legacy-drawdist-([a-f0-9]{12})$/;
const NAME = "Дальность прорисовки Astral";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const versionOf = (suffix) => `${DRAW_DISTANCE_SCHEMA}.0.0-${suffix}`;

export const isDrawDistanceModId = (value) => MOD_ID.test(String(value || ""));

/** Хэш содержимого: дальность и отсортированные пары `имя\nsha256`. */
export function drawDistanceDigest(distance, files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(`draw-distance\n${distance}\n${lines.join("\n")}`, "utf8").digest("hex");
}

/* Место и политика объединения файла по имени. */
function fileShape(name) {
  if (name === TIMECYCLE_FILE)
    return {
      action: "replace",
      entry: DRAW_DISTANCE_TIMECYCLE_ENTRY,
      merge: { strategy: "timecycle-modifier-v1", priority: TIMECYCLE_PRIORITY, includeNames: [DRAW_DISTANCE_MODIFIER_NAME] },
      maxBytes: MAX_TIMECYCLE_BYTES,
    };
  if (name === DRAW_DISTANCE_MAP_FILE)
    return {
      action: "import",
      entry: `${DRAW_DISTANCE_CONTAINER_ENTRY}/${DRAW_DISTANCE_MAP_FILE}`,
      merge: { strategy: "rpf-resource-layer-v1" },
      maxBytes: MAX_MAP_BYTES,
    };
  return null;
}

/** Манифест пакета из описи собранных файлов `{ name, size, sha256 }` и дальности, м. */
export function buildDrawDistanceManifest(distance, files) {
  if (!Number.isInteger(distance) || distance < 1) throw new Error("Дальность прорисовки — целое число метров.");
  const digest = drawDistanceDigest(distance, files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-drawdist-${suffix}`,
    version: versionOf(suffix),
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    /* Только вид: туман и дальность отсечения, столкновений и предметов не трогает. */
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [DRAW_DISTANCE_SLOT],
    drawDistance: {
      schemaVersion: DRAW_DISTANCE_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      distance,
      fileCount: files.length,
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => {
        const shape = fileShape(file.name);
        if (!shape) throw new Error(`Файл ${file.name} — не файл дальности прорисовки.`);
        return {
          source: `payload/${file.name}`,
          target: UPDATE,
          action: shape.action,
          entry: shape.entry,
          merge: shape.merge,
          size: file.size,
          sha256: file.sha256,
        };
      }),
  };
}

export function isLocalDrawDistanceManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.drawDistance, DRAW_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== versionOf(suffix)) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root" || manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false || manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([DRAW_DISTANCE_SLOT])) return false;
  if (manifest.drawDistance.schemaVersion !== DRAW_DISTANCE_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.drawDistance.sourceDigest || "")) return false;
  const distance = manifest.drawDistance.distance;
  if (!Number.isInteger(distance) || distance < 50 || distance > 20000) return false;

  /* Ровно два файла: модификатор и карта с коробкой. */
  const files = manifest.files;
  if (!Array.isArray(files) || files.length !== 2) return false;
  if (manifest.drawDistance.fileCount !== files.length) return false;
  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/")) return false;
    const name = file.source.slice("payload/".length);
    const shape = fileShape(name);
    if (!shape || seen.has(name)) return false;
    seen.add(name);
    if (file.target !== UPDATE || file.action !== shape.action || file.entry !== shape.entry) return false;
    if (JSON.stringify(file.merge) !== JSON.stringify(shape.merge)) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > shape.maxBytes) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256 });
  }
  const digest = drawDistanceDigest(distance, digestInput);
  if (manifest.drawDistance.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
