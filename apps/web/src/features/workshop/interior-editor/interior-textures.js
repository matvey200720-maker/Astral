/*
 * Картинки, которые человек принёс сам.
 *
 * Текстуру можно взять из самого помещения — это настоящие текстуры Rockstar,
 * уже приехавшие в кадр, — а можно положить свою. Своя лежит там же, где
 * остальные файлы мастерской: в её хранилище, ключом от хэша содержимого.
 * В макет при этом уезжает ссылка `asset:<sha256>`, а не байты: у проекта
 * потолок в 512 КиБ, и одна картинка съела бы его целиком.
 *
 * Хэш ключом — не мелочь: одна и та же картинка, положенная на пол и на стены,
 * хранится один раз, а проект, открытый заново, находит её по той же ссылке.
 *
 * Проверку файла делает `workshop-assets.js` — тот же код, что проверяет звуки
 * и эмблемы: расширение, MIME, сигнатура и размер. Здесь остаётся сузить
 * список до картинок: `.ytd` из игры сюда класть незачем, а `.svg` — картинка,
 * которую рисует браузер по нашему же коду.
 */

import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../../../components/desktop/workshop/workshop-assets.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

/** Где картинка лежит в хранилище мастерской. */
export const finishTextureKey = (hash) => `interior-finish/${hash}`;

/** Ссылка на картинку в макете — по её хэшу. */
export const finishTextureReference = (hash) => `asset:${hash}`;

/**
 * Принять картинку от человека.
 *
 * Возвращает ссылку для макета и имя файла для подписи. Отказ — обычным
 * исключением с текстом, который можно показать: «Файл больше 64 МБ» человеку
 * говорит больше, чем молчаливо не покрашенная стена.
 */
export async function importFinishTexture(file) {
  const name = String(file?.name || "");
  const extension = name.includes(".")
    ? name.split(".").pop().toLowerCase()
    : "";
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error("Подойдёт картинка PNG, JPEG или WebP.");
  const { blob, metadata } = await prepareWorkshopAsset(file);
  await putWorkshopAsset(finishTextureKey(metadata.hash), blob);
  return {
    reference: finishTextureReference(metadata.hash),
    name: metadata.name,
    hash: metadata.hash,
  };
}

/**
 * Прочитать принесённую картинку обратно — уже для кадра.
 *
 * Отдаётся не текстура, а картинка: three.js живёт в сцене, и заводить его
 * копию здесь значило бы завести вторую.
 */
export async function loadFinishTexture(reference) {
  const value = String(reference || "");
  if (!value.startsWith("asset:")) return null;
  const blob = await getWorkshopAsset(finishTextureKey(value.slice(6)));
  if (!blob) return null;
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  /* Запасной путь для окружений без `createImageBitmap` (jsdom в тестах, старые
     вебвью): та же картинка, только через объектную ссылку. */
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
