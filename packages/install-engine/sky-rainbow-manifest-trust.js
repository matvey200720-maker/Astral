import { createHash } from "node:crypto";

/*
 * Радуга неба — своя модель Astral в своём контейнере слоя.
 *
 * Редактор неба собирает её сам (`compile-sky-rainbow` нативного хоста):
 * одна дуга моделями ступеней яркости, лист спектра, объекты по часам,
 * расстановка и `_manifest.ymf`.
 * Контейнер — `x64/astral/astral_sky.rpf`, а не общий `astral_maps.rpf`:
 * `_manifest.ymf` в контейнере один, и радуга не должна делить его с
 * аренами и интерьерами.
 *
 * Схема 2 (26.09.2026) — одна радуга в одном месте вместо утренней и
 * вечерней дуг. Схема 3 (27.09.2026) — та же дуга, но моделей у неё от
 * одной до пяти: ступени яркости по часам, чтобы ночью радуга не сияла над
 * тёмным небом (`packages/timecycle/rainbow-light.js`). Проверка ниже
 * касается только новой установки; прежние радуги снимаются из описи
 * установленного, как любой пакет, и уступают слот новой без повторной
 * проверки своего манифеста.
 *
 * Схема видна и в описи установленного — старшей цифрой версии пакета
 * (`3.0.0-<хэш>`): по ней приложение узнаёт радугу, поставленную прежней
 * версией, и переставляет её (`isSkyRainbowCurrent`).
 *
 * Символ доверия, как у арен и залазов: предъявить его в installPackage может
 * только сам install-engine, поэтому строгую проверку ниже нельзя обойти,
 * скопировав форму манифеста снаружи.
 */
export const LOCAL_SKY_RAINBOW_TRUST = Symbol("local-sky-rainbow-package");

export const SKY_RAINBOW_CONTAINER = "x64/astral/astral_sky.rpf";
export const SKY_RAINBOW_SLOT = "sky-rainbow";

/* Закрытый список: общие файлы и модели ступеней `astral_rainbow_1.ydr` …
   `astral_rainbow_5.ydr` подряд с первой — и ничего сверх. */
export const SKY_RAINBOW_SHARED_FILES = Object.freeze([
  "_manifest.ymf",
  "astral_rainbow.ytd",
  "astral_rainbow.ytyp",
  "astral_rainbow_map.ymap",
]);
export const SKY_RAINBOW_MAX_TIERS = 5;
export const skyRainbowModelFile = (tier) => `astral_rainbow_${tier}.ydr`;

/** Файлы радуги из `tiers` ступеней, по алфавиту. */
export function skyRainbowFiles(tiers) {
  const count = Number(tiers);
  if (!Number.isInteger(count) || count < 1 || count > SKY_RAINBOW_MAX_TIERS)
    throw new RangeError(`У радуги от 1 до ${SKY_RAINBOW_MAX_TIERS} ступеней.`);
  return [
    ...SKY_RAINBOW_SHARED_FILES,
    ...Array.from({ length: count }, (_, index) =>
      skyRainbowModelFile(index + 1),
    ),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export const SKY_RAINBOW_SCHEMA = 3;
const SCHEMA_VERSION = SKY_RAINBOW_SCHEMA;
const versionOf = (suffix) => `${SCHEMA_VERSION}.0.0-${suffix}`;

/**
 * Поставлена ли радуга нынешней схемой — по версии из описи установленного.
 * Прежние (`1.0.0-…`: две дуги или одна без ступеней) — нет.
 */
export const isSkyRainbowCurrent = (version) =>
  String(version || "").startsWith(`${SCHEMA_VERSION}.0.0-`);

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
  "skyRainbow",
  "files",
]);
const RAINBOW_KEYS = Object.freeze([
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

/**
 * Хэш содержимого: отсортированные пары `имя\nsha256`. Одна и та же радуга
 * даёт один и тот же id — компилятор детерминирован, и повторное «Применить»
 * с включённой радугой не пересобирает архив игры.
 */
export function skyRainbowDigest(files) {
  const lines = files
    .map((file) => `${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export const isSkyRainbowModId = (value) =>
  /^local-legacy-sky-rainbow-[a-f0-9]{12}$/.test(String(value || ""));

/** Манифест радуги из описи собранных файлов. */
export function buildSkyRainbowManifest(files) {
  const digest = skyRainbowDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-sky-rainbow-${suffix}`,
    version: versionOf(suffix),
    name: "Радуга Astral",
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Радуга — картинка в небе, правил игры она не меняет.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [SKY_RAINBOW_SLOT],
    skyRainbow: {
      schemaVersion: SCHEMA_VERSION,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: "update/update.rpf",
        action: "import",
        entry: `${SKY_RAINBOW_CONTAINER}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalSkyRainbowManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.skyRainbow, RAINBOW_KEYS)) return false;

  const idMatch = /^local-legacy-sky-rainbow-([a-f0-9]{12})$/.exec(manifest.id);
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
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES))
    return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([SKY_RAINBOW_SLOT]))
    return false;
  if (manifest.skyRainbow.schemaVersion !== SCHEMA_VERSION) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.skyRainbow.sourceDigest || ""))
    return false;

  const files = manifest.files;
  const tiers = Array.isArray(files)
    ? files.length - SKY_RAINBOW_SHARED_FILES.length
    : 0;
  if (tiers < 1 || tiers > SKY_RAINBOW_MAX_TIERS) return false;
  if (manifest.skyRainbow.resourceCount !== files.length) return false;
  /* Ровно общие файлы и модели ступеней 1…n подряд. */
  const allowed = skyRainbowFiles(tiers);

  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/"))
      return false;
    const name = file.source.slice("payload/".length);
    if (!allowed.includes(name) || seen.has(name)) return false;
    seen.add(name);
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "import") return false;
    if (file.entry !== `${SKY_RAINBOW_CONTAINER}/${name}`) return false;
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
  const digest = skyRainbowDigest(digestInput);
  if (manifest.skyRainbow.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
