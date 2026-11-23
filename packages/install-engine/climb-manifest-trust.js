import { createHash } from "node:crypto";

// Внутренний символ доверия, как у арены и интерьеров: предъявить его в
// installPackage может только сам install-engine, поэтому строгую проверку
// ниже нельзя обойти, просто скопировав форму манифеста снаружи.
/* Свой контейнер залазов со своим `_manifest.ymf` (задача 3 ТЗ 10.10.2026) —
   копия `manifest-containers.js`, чтобы проверка оставалась замкнутой
   (совпадение держит тест). */
export const CLIMBS_CONTAINER = "x64/astral/astral_climbs.rpf";

export const LOCAL_CLIMB_TRUST = Symbol("local-climb-package");

// Копия списка расширений слота climbs из @modovik/mod-targets: trust-модуль
// не тянет зависимостей, чтобы проверка оставалась замкнутой и её нельзя
// было ослабить изменением чужого пакета.
const CLIMB_RESOURCE_EXTENSIONS = Object.freeze([
  ".ymap",
  ".ytyp",
  ".ymf",
  ".ydr",
  ".ytd",
]);

// Имена ресурсов обязаны заранее проходить ASTRAL_CONTENT_ENTRY_PATTERN
// движка. Единственное имя с подчёркиванием впереди — `_manifest.ymf`: так
// его ищет сама игра, переименовать нельзя, а разрешать подчёркивание всем
// подряд незачем.
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._+~-]{0,119}$/;
const MANIFEST_RESOURCE_NAME = "_manifest.ymf";

const MAX_RESOURCE_COUNT = 64;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

// Whitelist полей: всё, чего нет в списке, — повод для отказа, потому что
// неизвестное поле может изменить поведение установщика в будущем без
// пересмотра этой проверки.
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
  "climbs",
  "files",
]);
const CLIMBS_KEYS = Object.freeze([
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

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/**
 * Детерминированный хэш содержимого набора: отсортированные пары
 * `имя\nsha256`. Порядок обхода папки не влияет на digest, поэтому id и
 * версия пакета одинаковы для одного и того же набора файлов — а перекраска
 * меняет байты моделей и, значит, весь пакет целиком.
 */
export function climbSourceDigest(files) {
  const lines = files
    .map((file) => `${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function isLocalClimbManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  // Подробные сообщения даёт слой выше, который строит манифест сам.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.climbs, CLIMBS_KEYS)) return false;

  const idMatch = /^local-legacy-climbs-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];

  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  // Прямая схема слоя Astral: запись идёт в настоящий update.rpf, загрузчик
  // и папка mods не нужны.
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Залазы ставят в мир новые пропы — это изменение мира, а не косметика.
  if (manifest.gameplayChanges !== true) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify([
      "rpf-container-entry-v1",
      "astral-content-rpf-v1",
      "direct-update-rpf-v1",
      "direct-update-entries-v1",
    ])
  )
    return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify(["climbs"]))
    return false;

  if (manifest.climbs.schemaVersion !== 1) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.climbs.sourceDigest || ""))
    return false;

  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  if (files.length < 1 || files.length > MAX_RESOURCE_COUNT) return false;
  if (manifest.climbs.resourceCount !== files.length) return false;

  const seenNames = new Set();
  const digestInput = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/"))
      return false;
    const name = file.source.slice("payload/".length);
    if (name !== MANIFEST_RESOURCE_NAME && !RESOURCE_NAME_PATTERN.test(name))
      return false;
    const extension = name.slice(name.lastIndexOf("."));
    if (!name.includes(".") || !CLIMB_RESOURCE_EXTENSIONS.includes(extension))
      return false;
    // Одно имя — один слой в своём контейнере: дубликат означает, что при
    // копировании один файл молча перезапишет другой.
    if (seenNames.has(name)) return false;
    seenNames.add(name);
    if (file.target !== "update/update.rpf") return false;
    // Строго "import": capability astral-content-rpf-v1 принимает только его,
    // и расхождение обнаруживается до обращения к движку.
    if (file.action !== "import") return false;
    /* Свой контейнер со своим манифестом (задача 3 ТЗ 10.10.2026). */
    if (file.entry !== `${CLIMBS_CONTAINER}/${name}`) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_RESOURCE_BYTES
    )
      return false;
    totalBytes += file.size;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256 });
  }
  if (totalBytes > MAX_TOTAL_BYTES) return false;

  // sourceDigest обязан сходиться с пересчётом по files: id, версия и digest
  // связаны одним хэшем содержимого, подделать одно поле без остальных нельзя.
  const digest = climbSourceDigest(digestInput);
  if (manifest.climbs.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;

  return true;
}
