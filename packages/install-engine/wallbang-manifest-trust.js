import { createHash } from "node:crypto";

/*
 * Прострелы — подсветка простреливаемых укрытий в своём контейнере слоя.
 *
 * Редактор «Прострелы» ставит шестнадцать оболочек укрытий из мода
 * prostrel (перекрашенных на месте: цвет, альфа, свечение), их типы,
 * расстановку и `_manifest.ymf`. Контейнер — `x64/astral/astral_wallbang.rpf`,
 * а не общий `astral_maps.rpf`: `_manifest.ymf` в контейнере один, и
 * прострелы не должны делить его с залазами, аренами и интерьерами. Так
 * прострелы и залазы ставятся и снимаются порознь, хотя мод приходил одним
 * архивом.
 *
 * Строгая форма: ровно файлы набора (`@modovik/climb-contract/wallbang`,
 * objects.js) и ничего сверх — список скопирован сюда нарочно, чтобы
 * проверку нельзя было ослабить правкой чужого пакета; совпадение списков
 * держит тест. Символ доверия предъявить может только install-engine.
 */
export const LOCAL_WALLBANG_TRUST = Symbol("local-wallbang-package");

export const WALLBANG_CONTAINER = "x64/astral/astral_wallbang.rpf";
export const WALLBANG_SLOT = "wallbang";
export const WALLBANG_SCHEMA = 1;

export const WALLBANG_OBJECT_IDS = Object.freeze([
  "fence",
  "long_fence",
  "gate",
  "wood_fence",
  "transformer",
  "roof_aircon",
  "roof_box",
  "big_aircon",
  "trailer",
  "parapet",
  "garages",
  "house_garage",
  "house",
  "corner_wall",
  "fence_panels",
  "dumpster",
]);

/* Файлы набора по алфавиту: общие и модели оболочек. */
export const WALLBANG_FILES = Object.freeze(
  [
    "_manifest.ymf",
    "astral_wallbang.ytyp",
    "astral_wallbang_map.ymap",
    ...WALLBANG_OBJECT_IDS.map((id) => `astral_wallbang_${id}.ydr`),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
);

const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;

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
  "wallbang",
  "files",
]);
const WALLBANG_KEYS = Object.freeze([
  "schemaVersion",
  "sourceDigest",
  "resourceCount",
]);
const FILE_KEYS = Object.freeze([
  "source",
  "target",
  "action",
  "entry",
  "merge",
  "size",
  "sha256",
]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const versionOf = (suffix) => `${WALLBANG_SCHEMA}.0.0-${suffix}`;

/**
 * Хэш содержимого: отсортированные пары `имя\nsha256`. Одинаковая
 * подсветка даёт один и тот же id пакета, и повторное «Применить» с тем же
 * обликом архив игры не пересобирает.
 */
export function wallbangDigest(files) {
  const lines = files
    .map((file) => `${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export const isWallbangModId = (value) =>
  /^local-legacy-wallbang-[a-f0-9]{12}$/.test(String(value || ""));

export const isWallbangFileName = (name) =>
  WALLBANG_FILES.includes(String(name || ""));

/** Манифест прострелов из описи собранных файлов `{ name, size, sha256 }`. */
export function buildWallbangManifest(files) {
  const digest = wallbangDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-wallbang-${suffix}`,
    version: versionOf(suffix),
    name: "Прострелы Astral",
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Подсветка ставит в мир новые пропы на каптах — это изменение мира,
    // как у залазов, а не косметика интерфейса.
    gameplayChanges: true,
    capabilities: [...CAPABILITIES],
    slots: [WALLBANG_SLOT],
    wallbang: {
      schemaVersion: WALLBANG_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: "update/update.rpf",
        action: "import",
        entry: `${WALLBANG_CONTAINER}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalWallbangManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.wallbang, WALLBANG_KEYS)) return false;
  const idMatch = /^local-legacy-wallbang-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== versionOf(suffix)) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== true) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES))
    return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([WALLBANG_SLOT]))
    return false;
  if (manifest.wallbang.schemaVersion !== WALLBANG_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.wallbang.sourceDigest || ""))
    return false;

  /* Ровно файлы набора, каждый по разу: скрытое укрытие едет прозрачной
     моделью, а не пропуском — место в расстановке ждёт свою модель. */
  const files = manifest.files;
  if (!Array.isArray(files) || files.length !== WALLBANG_FILES.length)
    return false;
  if (manifest.wallbang.resourceCount !== files.length) return false;
  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/"))
      return false;
    const name = file.source.slice("payload/".length);
    if (!isWallbangFileName(name) || seen.has(name)) return false;
    seen.add(name);
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "import") return false;
    if (file.entry !== `${WALLBANG_CONTAINER}/${name}`) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_RESOURCE_BYTES
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256 });
  }

  // id, версия и digest связаны одним хэшем содержимого: подделать одно поле
  // без остальных нельзя.
  const digest = wallbangDigest(digestInput);
  if (manifest.wallbang.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
