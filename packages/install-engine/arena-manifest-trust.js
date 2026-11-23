import { createHash } from "node:crypto";

// Внутренний символ доверия: только сам install-engine может предъявить его
// в installPackage, поэтому строгая проверка манифеста ниже не обходится
// внешним кодом, который просто скопировал форму манифеста.
export const LOCAL_ARENA_TRUST = Symbol("local-arena-package");

// Копия списка расширений слота arenas из @modovik/mod-targets: trust-модуль
// не тянет зависимостей, чтобы проверка оставалась замкнутой и её нельзя было
// ослабить изменением чужого пакета.
const ARENA_RESOURCE_EXTENSIONS = Object.freeze([
  ".ymap",
  ".ytyp",
  ".ybn",
  ".ydr",
  /* Фрагменты и словари моделей — такие же ресурсы набора: в живых модах
     арены ими лежат урны, столбики и остановки, а в наборах интерьеров —
     витрины. Без них папка ставилась «почти целиком», и человек искал в игре
     пропавшие пропы. */
  ".yft",
  ".ydd",
  ".ytd",
  ".ymf",
]);

// Имя ресурса обязано заранее проходить ASTRAL_CONTENT_ENTRY_PATTERN движка
// (segment: [a-z0-9][a-z0-9._+~-]{0,119}) — русские и «почти похожие» имена
// отбрасываются здесь, а не молча переименовываются где-то по пути.
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._+~-]{0,119}$/;
/*
 * Имя ресурса обязано заранее проходить `ASTRAL_CONTENT_ENTRY_PATTERN`
 * движка. Единственное имя с подчёркиванием впереди — `_manifest.ymf`: по
 * нему игра связывает `.ymap` с его `.ytyp`, и без него расстановка просто
 * не грузится («never forget your _manifest.ymf» — первое, что отвечают
 * сообществу на «мод встал, а в игре ничего нет»). Имя задано игрой, и
 * переименовать его нельзя — а именно это и предлагал прежний отказ, из-за
 * чего готовый набор арены или интерьеров нельзя было поставить вовсе.
 */
const MANIFEST_RESOURCE_NAME = "_manifest.ymf";
const isSetResourceName = (name) =>
  name === MANIFEST_RESOURCE_NAME || RESOURCE_NAME_PATTERN.test(name);

const MAX_RESOURCE_COUNT = 256;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

// Whitelist полей по образцу интерьерного траста: всё, чего нет в списке, —
// повод для отказа, потому что неизвестное поле может изменить поведение
// установщика в будущем без пересмотра этой проверки.
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
  "arena",
  "files",
]);
const ARENA_KEYS = Object.freeze([
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

// Детерминированный хэш содержимого набора: отсортированные пары
// `имя\nsha256` — порядок обхода папки не влияет на digest, поэтому id и
// версия пакета стабильны между сборками одного и того же мода.
export function arenaSourceDigest(files) {
  const lines = files
    .map((file) => `${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/* Свои контейнеры арены и набора интерьеров со своим `_manifest.ymf`
   (задача 3 ТЗ 10.10.2026) — копия `manifest-containers.js`, чтобы проверка
   оставалась замкнутой (совпадение держит тест). */
export const ARENA_CONTAINERS = Object.freeze({
  arena: "x64/astral/astral_arena.rpf",
  "interior-set": "x64/astral/astral_interiors.rpf",
});
const ownManifestContainer = (id) => ARENA_CONTAINERS[/^local-legacy-(arena|interior-set)-/.exec(String(id))?.[1]] || "";

export function isLocalArenaManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей,
  // подробные сообщения даёт слой выше, который строит манифест сам.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.arena, ARENA_KEYS)) return false;

  /*
   * Два набора одной формы: арена и готовый набор интерьеров.
   *
   * Файлы у них устроены одинаково — ресурсы игры в контейнер
   * `astral_maps.rpf`, — а слот разный, и это важно: набор интерьеров не
   * должен вытеснять арену, а арена не должна вытеснять интерьеры. Поэтому
   * префикс id и слот сверяются парой, и подменить одно другим нельзя.
   */
  const idMatch = /^local-legacy-(arena|interior-set)-([a-z0-9]{8,16})$/.exec(
    manifest.id,
  );
  if (!idMatch) return false;
  const slot = idMatch[1] === "arena" ? "arenas" : "interiors";
  const suffix = idMatch[2];

  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  // Прямая схема слоя Astral: запись идёт в настоящий update.rpf, загрузчик
  // и папка mods не нужны. Эти четыре поля образуют единственную форму,
  // которой движок разрешает писать в корень игры без подписи.
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Арена меняет игровой мир — честно объявляем gameplayChanges, чтобы UI
  // не показывал пакет как «безопасный косметический».
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
  if (JSON.stringify(manifest.slots) !== JSON.stringify([slot])) return false;

  if (manifest.arena.schemaVersion !== 1) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.arena.sourceDigest || ""))
    return false;

  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  if (files.length < 1 || files.length > MAX_RESOURCE_COUNT) return false;
  if (manifest.arena.resourceCount !== files.length) return false;

  const seenNames = new Set();
  const digestInput = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/"))
      return false;
    const name = file.source.slice("payload/".length);
    if (!isSetResourceName(name)) return false;
    const extension = name.slice(name.lastIndexOf("."));
    if (!name.includes(".") || !ARENA_RESOURCE_EXTENSIONS.includes(extension))
      return false;
    // Одно имя — один слой в своём контейнере: дубликат означает, что при
    // копировании один файл молча перезапишет другой.
    if (seenNames.has(name)) return false;
    seenNames.add(name);
    if (file.target !== "update/update.rpf") return false;
    // Строго "import": batch-скрипты используют "upsert", но capability
    // astral-content-rpf-v1 принимает только import — расхождение здесь
    // обнаруживается до обращения к движку.
    if (file.action !== "import") return false;
    /* Свой контейнер со своим манифестом (задача 3 ТЗ 10.10.2026). */
    if (file.entry !== `${ownManifestContainer(manifest.id)}/${name}`) return false;
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
  const digest = arenaSourceDigest(digestInput);
  if (manifest.arena.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;

  return true;
}
