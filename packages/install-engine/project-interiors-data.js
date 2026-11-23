/*
 * Пакеты данных «Интерьеров проектов» (решение владельца 17.10.2026, вечер).
 *
 * Интерьеры Majestic и GTA 5 РП раздаются с CDN Astral как моды облачного
 * каталога, но это не моды: в пакете файлы проекта (модели, словари, типы,
 * карты, коллизии), которые редактор читает как папку игрока. Манифест такого
 * пакета объявляет возможность `project-interiors-data-v1`, и движок:
 *
 *   — не ставит его как мод: `validateManifest` без явного разрешения
 *     отказывает, поэтому «Установить» на карточке, установка «Сборкой» и план
 *     установки доходят до отказа, не тронув ни игру, ни хранилище;
 *   — пропускает только строго такую форму (`assertProjectInteriorsData`):
 *     файлы только под `mods/astral-project-interiors/<id>/`, только
 *     расширения ресурсов игры, у каждого файла sha256 и размер. Старый
 *     лаунчер, не знающий возможности, «поставил» бы такой пакет в
 *     изолированную папку `mods`, где ни одно имя не совпадает с файлом игры.
 *
 * Скачивает такой пакет только редактор (`downloadSignedPackage` с явным
 * `projectInteriorsData: true`): подпись манифеста, хосты CDN и sha256 каждого
 * файла проверяются теми же правилами, что у обычной установки.
 *
 * Модуль без зависимостей. Значения совпадают с
 * `@modovik/climb-contract/recolor/project-interiors-packs` — это проверяет
 * тест `tests/project-interiors-cdn-bundle.test.js`.
 */

export const PROJECT_INTERIORS_DATA_CAPABILITY = "project-interiors-data-v1";
export const PROJECT_INTERIORS_DATA_ROOT = "mods/astral-project-interiors";
export const PROJECT_INTERIORS_DATA_EXTENSIONS = Object.freeze(["ydr", "ydd", "yft", "ytd", "ytyp", "ymap", "ymf", "ybn", "ycd", "rpf"]);
const ID = /^projint-(?:mj|rp)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_MAX = 64;
const DIGEST = /^[0-9a-f]{64}$/;
/* Пакет — не больше, чем принимает конвейер каталога (проверка структуры): 5000 записей включая `mod.json`. */
const FILES_MAX = 4999;

const extensionOf = (name) => {
  const dot = String(name).lastIndexOf(".");
  return dot < 0 ? "" : String(name).slice(dot + 1).toLowerCase();
};

/** Манифест объявляет возможность пакета данных (форма не проверяется). */
export function isProjectInteriorsDataManifest(manifest) {
  return Array.isArray(manifest?.capabilities) && manifest.capabilities.some((item) => String(item).trim().toLowerCase() === PROJECT_INTERIORS_DATA_CAPABILITY);
}

/**
 * Проверка формы пакета данных на уже нормализованном манифесте
 * (`validateManifest`): `id`, `files` — `[{ action, source, target, sha256, size }]`.
 * Без `allowed` — отказ: это не мод, ставить его нельзя.
 */
export function assertProjectInteriorsData({ id, files }, { allowed = false } = {}) {
  if (!allowed)
    throw new Error("Это файлы интерьеров проектов для редактора, а не мод: как мод они не ставятся.");
  if (!ID.test(id) || id.length > ID_MAX) throw new Error("Пакет интерьеров проектов: имя пакета не по форме.");
  if (!files.length || files.length > FILES_MAX) throw new Error("Пакет интерьеров проектов: число файлов вне границ.");
  const prefix = `${PROJECT_INTERIORS_DATA_ROOT}/${id}/`;
  const seen = new Set();
  for (const file of files) {
    if (file.action !== "replace") throw new Error("Пакет интерьеров проектов: только файлы, без удалений и слияний.");
    if (!file.target.startsWith(prefix) || file.target.length === prefix.length)
      throw new Error("Пакет интерьеров проектов: файл вне своей папки.");
    if (!PROJECT_INTERIORS_DATA_EXTENSIONS.includes(extensionOf(file.source)))
      throw new Error("Пакет интерьеров проектов: в нём может быть только файл игры (модель, словарь, тип, карта, коллизия).");
    if (!DIGEST.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0)
      throw new Error("Пакет интерьеров проектов: у каждого файла должны быть sha256 и размер.");
    const key = file.source.toLowerCase();
    if (seen.has(key)) throw new Error("Пакет интерьеров проектов: два файла с одним именем.");
    seen.add(key);
  }
}
