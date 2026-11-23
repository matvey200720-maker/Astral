/*
 * Фото вещей магазинов на нашем CDN (владелец, 28.10.2026: «не значки, а сами фотографии… все фотки моделей загрузи на сервер, в приложение»).
 *
 * Окно «Сделать заменёнку» показывало фото вещи с чужого хостинга: у GTA5RP — файл сервера по сквозному номеру и цвету
 * (`files.gta5rp.com/Clothes512/<пол>_<вид>_<номер>_<цвет>.png`, `gta5rpPicture`), у Majestic — картинка вики. Зеркало кладёт те же фото к нам
 * (`scripts/catalog-clothing-photos.mjs`): по одному файлу на расцветку, имя из тех же слов — без индекса и без хешей:
 *
 *   <origin>/<версия набора>/<сервер>/<пол>_<вид>_<номер>_<цвет>.webp     m_jbib_611_3.webp
 *
 * CDN отдаёт только `/sha256/<hex>` и `/sha256/<hex>/<путь>` (ведущая, 28.10.2026), поэтому набор лежит там как пакет: `<версия набора>` — sha256 файла
 * `manifest.tsv` набора (файл, байты, sha256 по каждой картинке; рядом — `SET` с этим хешем). Новая версия набора — новый хеш, старый лежит до снятия.
 *
 * Набор выложен (28.10.2026), `PHOTO_MIRROR` назван. Нет набора (`set` пуст) или сервера в списке — окно берёт фото по-старому; сервер вписывают, когда его файлы на CDN целиком
 * (покрытие — `coverage.json` рядом с файлами; у GTA5RP 193 расцветки без фото — у источника их нет). Модуль без зависимостей, кроме построителя адреса GTA5RP.
 */

import { gta5rpPicture } from "./project-items.js";

/** Откуда окно берёт зеркало (`set` — версия набора, хеш его manifest.tsv) и какие серверы выложены целиком. */
export const PHOTO_MIRROR = Object.freeze({
  origin: "https://cdn.astral-mods.online/sha256",
  /* Набор выложен на CDN и сверен (16.11.2026, в раздаче с 11:19:32 UTC): 64 829 файлов (прежний, 28.10.2026, — 64 780; добавлено 49 фото Majestic, пропало 0), sha256 манифеста на CDN = версия.
     Прежний набор — `4f367fe6bda5c477b7b754d42c747d901dfc86a3729affdfb195c5c6d8ce4ef1`; откат — вернуть этот хеш (если cards его не снимала с CDN). Список номеров набора для теста покрытия — `tests/data/photo-mirror-keys.json`. */
  set: "c051a1027804a61b20cc802642c830d95d948804c593bb76bba009f8e9480ac8",
  servers: Object.freeze(["gta5rp", "majestic"]),
});

/** Сторона фото на CDN, точек: плитка окна показывает до ~200 точек, запас на плотный экран. */
export const PHOTO_SIDE = 384;
export const PHOTO_COLOURS_MAX = 26;

const letter = (gender) => (gender === "female" ? "f" : "m");

/** Имя файла фото расцветки: пол, вид, сквозной номер на сервере, номер цвета с нуля. */
export const photoFileName = ({ gender, component, global }, colour = 0) =>
  `${letter(gender)}_${component}_${global}_${Math.max(0, Math.floor(colour))}.webp`;

/** Сколько расцветок у вещи (до `PHOTO_COLOURS_MAX`). */
export const photoColours = (item) => Math.max(1, Math.min(PHOTO_COLOURS_MAX, Number(item?.textures) || 1));

/** Вещь, у которой фото есть на сервере: известен сквозной номер (в базе «нет» — −1) и вид. */
export const photoable = (item) => Boolean(item) && Number.isInteger(item.global) && item.global >= 0 && Boolean(item.component) && (item.gender === "male" || item.gender === "female");

/** Адрес зеркала для расцветки вещи или `null`, если набор не назван или сервер в нём не выложен целиком. */
export function mirrorPhotoUrl(item, colour = 0, mirror = PHOTO_MIRROR) {
  if (!mirror.set || !photoable(item) || !item.server || !mirror.servers.includes(item.server)) return null;
  return `${mirror.origin}/${mirror.set}/${item.server}/${photoFileName(item, colour)}`;
}

/** Адрес фото у проекта-источника (то, что зеркалится). GTA5RP — файл сервера; Majestic — картинки вики, их даёт вызывающий (`wikiImages`). */
export function upstreamPhotoUrl(item, colour = 0, wikiImages = null) {
  if (!photoable(item)) return null;
  if (item.server === "gta5rp") return gta5rpPicture(item.gender, item.component, item.global, colour);
  if (item.server === "majestic") return wikiImages?.[colour] || null;
  return null;
}

/** Задания зеркала по списку вещей одного сервера: `[{ file, url, key }]` по расцветкам, без повторов одного файла. */
export function photoJobs(items, { server, wikiImagesOf = () => null } = {}) {
  const jobs = [];
  const seen = new Set();
  for (const raw of items) {
    const item = { ...raw, server: raw.server || server };
    if (!photoable(item)) continue;
    const images = item.server === "majestic" ? wikiImagesOf(item) : null;
    const count = item.server === "majestic" ? Math.min(photoColours(item), images?.length || 0) : photoColours(item);
    for (let colour = 0; colour < count; colour += 1) {
      const file = `${item.server}/${photoFileName(item, colour)}`;
      const url = upstreamPhotoUrl(item, colour, images);
      if (!url || seen.has(file)) continue;
      seen.add(file);
      jobs.push({ file, url, key: `${item.server}|${item.gender}|${item.component}|${item.global}|${colour}` });
    }
  }
  return jobs;
}
