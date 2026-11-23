import { coverFor, hasOwnCover } from "../../utils/catalogMedia.js";

/*
 * Настоящая картинка мода каталога (задачи 2–4 ТЗ 08.10, вечер): своя
 * обложка, первый кадр галереи или то, что окно запомнило, пока каталог знал
 * мод. Пусто — картинки нет, и рисовать её нечем; снимок слота мастерской и
 * городской кадр по хешу id сюда не подставляются — они выдавали бы себя за
 * этот мод.
 *
 * Отдельный лёгкий модуль: его читают и «Загрузки» в стартовом куске окна,
 * которым тянуть за собой мастерскую (`my-mods.js`) незачем.
 */
export function modPicture(mod, face = null) {
  if (!mod) return "";
  if (hasOwnCover(mod)) return coverFor(mod);
  for (const item of [...(mod.gallery || []), ...(mod.media || [])]) {
    const src = typeof item === "string" ? item : item?.url || item?.src;
    const type = typeof item === "string" ? "image" : item?.type || "image";
    if (src && type !== "video") return src;
  }
  return typeof face?.cover === "string" ? face.cover.trim() : "";
}

/*
 * sha256 обложки мода каталога — по адресу картинки (`/api/media/cloud/<sha256>` у окна, `…/sha256/<sha256>` у CDN). Он едет в запись
 * установки замененки одежды (`origin.cover`): карточка «Библиотеки» рисуется по записи и тогда, когда каталог ещё не пришёл
 * (25.10.2026: «Футболка 1952» стояла без превью). Своей обложки нет — пусто.
 */
export function modCoverSha(mod) {
  if (!hasOwnCover(mod)) return "";
  return shaOfUrl(coverFor(mod));
}

/** sha256 картинки по адресу медиа каталога (`…/<sha256>`) или пустая строка: так «Библиотека» просит картинку у локального API. */
export function shaOfUrl(url) {
  const match = /(?:^|\/)([a-f0-9]{64})(?:[/?#].*)?$/i.exec(String(url || ""));
  return match ? match[1].toLowerCase() : "";
}

/** Адрес обложки по sha256 — как его отдаёт локальный API окна. */
export const coverUrlOf = (sha) =>
  /^[a-f0-9]{64}$/i.test(String(sha || "")) ? `/api/media/cloud/${String(sha).toLowerCase()}` : "";
