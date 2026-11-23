import { createHash } from "node:crypto";

/*
 * Готовая большая карта из папки мода.
 *
 * Редактор карты собирает плитки сам и ставит их своим пакетом. Но у людей на
 * руках есть и готовые карты — папка, повторяющая устройство `update.rpf`:
 * двенадцать плиток `minimap*`, два `.gfx` интерфейса, `minimap.ymt`,
 * `mapzoomdata.meta` и вложенный `minimap.rpf`. Ставить такую карту руками
 * через OpenIV — это и есть то, от чего приложение избавляет.
 *
 * Почему не через слой `x64/astral`: карта не добавляет свой контейнер, а
 * заменяет записи игры на их местах. Двенадцать плиток и оба `.gfx` в
 * `update.rpf` уже лежат; `minimap.ymt`, `mapzoomdata.meta` и
 * `minimap.rpf` приходят из базовых архивов, и в `update.rpf` их кладут
 * поверх — так карту и собирают все моды. Поэтому действие у всех записей
 * одно, `upsert`: заменить, если запись есть, положить, если её нет.
 *
 * Слот тот же, что у редактора карты (`large-map`): готовая карта и своя —
 * это две карты в одном месте, и второй должна сменять первую, а не
 * складываться с ней.
 */
export const LOCAL_MAP_PACK_TRUST = Symbol("local-map-pack-package");

/*
 * Что готовой карте разрешено трогать.
 *
 * Список закрытый и точный: папка мода — это чужие файлы, и «положим всё, что
 * в ней есть» означало бы дать любому архиву переписать что угодно в
 * `update.rpf`. Всё, чего в списке нет, пакет не примет.
 */
const MAP_PACK_ENTRIES = Object.freeze([
  /^x64\/data\/cdimages\/scaleform_generic\.rpf\/minimap(?:_sea)?_\d{1,2}_\d{1,2}\.ytd$/,
  /^x64\/patch\/data\/cdimages\/scaleform_minimap\.rpf\/[a-z0-9_]{1,64}\.gfx$/,
  /^x64\/data\/tune\/minimap\.ymt$/,
  /^common\/data\/ui\/mapzoomdata\.meta$/,
  /^x64\/levels\/gta5\/minimap\.rpf$/,
]);

const MAX_RESOURCE_COUNT = 40;
const MAX_RESOURCE_BYTES = 48 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

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
  "mapPack",
  "files",
]);
const MAP_PACK_KEYS = Object.freeze([
  "schemaVersion",
  "sourceDigest",
  "resourceCount",
]);
const FILE_KEYS = Object.freeze([
  "source",
  "target",
  "action",
  "entry",
  "size",
  "sha256",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

/** Разрешена ли эта запись готовой карте. */
export const isMapPackEntry = (entry) =>
  MAP_PACK_ENTRIES.some((pattern) => pattern.test(String(entry || "")));

/**
 * Детерминированный хэш содержимого: отсортированные пары `запись\nsha256`.
 * Порядок обхода папки на него не влияет, поэтому одна и та же карта всегда
 * даёт один и тот же id.
 */
export function mapPackSourceDigest(files) {
  const lines = files
    .map((file) => `${file.entry}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export function isLocalMapPackManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.mapPack, MAP_PACK_KEYS)) return false;

  const idMatch = /^local-legacy-map-pack-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];

  if (manifest.version !== `1.0.0-${suffix}`) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"]))
    return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  // Карта — это картинка на экране, а не правила игры.
  if (manifest.gameplayChanges !== false) return false;
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(["rpf-container-entry-v1", "direct-update-entries-v1"])
  )
    return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify(["large-map"]))
    return false;

  if (manifest.mapPack.schemaVersion !== 1) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.mapPack.sourceDigest || ""))
    return false;

  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  if (files.length < 1 || files.length > MAX_RESOURCE_COUNT) return false;
  if (manifest.mapPack.resourceCount !== files.length) return false;

  const seen = new Set();
  const digestInput = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.entry !== "string" || !isMapPackEntry(file.entry))
      return false;
    if (seen.has(file.entry)) return false;
    seen.add(file.entry);
    if (file.source !== `payload/${file.entry}`) return false;
    if (file.target !== "update/update.rpf") return false;
    /*
     * Только upsert. Плитки и `.gfx` в архиве уже есть, а `minimap.ymt`,
     * `mapzoomdata.meta` и `minimap.rpf` приходят из базовых архивов и в
     * `update.rpf` кладутся поверх: одно действие на оба случая избавляет от
     * догадок, какая запись у этой сборки игры уже существует.
     */
    if (file.action !== "upsert") return false;
    if (
      !Number.isInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_RESOURCE_BYTES
    )
      return false;
    totalBytes += file.size;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ entry: file.entry, sha256: file.sha256 });
  }
  if (totalBytes > MAX_TOTAL_BYTES) return false;

  const digest = mapPackSourceDigest(digestInput);
  if (manifest.mapPack.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;

  return true;
}
