/*
 * Картинка вещи сервера для сетки «На что поставить?» (владелец, 25.10.2026: вещи — картинками, как в магазине одежды).
 *
 * База вещей Astral картинок не несёт (`server-base-format.js`), а окно чужих адресов не грузит: картинку по https-адресу приносит
 * Desktop (`readProjectPicture` → `ProjectPicture.jsx`, список хостов и кэш на диске — у него). Здесь только откуда взять адрес:
 *   1. у вещи уже есть адрес (`preview` — вики Majestic и nightz, снимок каталога);
 *   2. GTA5RP — по сквозному номеру вещи на сервере (`gta5rpPicture`: files.gta5rp.com/Clothes512/<пол>_<вид>_<номер>_<цвет>.png);
 *   3. Majestic — по сквозному номеру из вики (`majesticImageMap`: пол | вид | номер → первая картинка вики);
 *   4. у вещи базы без фото сервера (запасное имя) — обложка её карточки каталога по хэшу (`pictureSha`, `extra.pic` базы): адрес строит `coverUrlOf`, так же, как у обложек каталога
 *      (локальный API окна отдаёт медиа из источника сборки), своей константы адреса нет. Обложка — `itemCoverUrl`, отдельно от адреса картинки: плитка показывает её ПОСЛЕ снимка вещи
 *      из игры (снимок — настоящий вид вещи, обложка — картинка карточки каталога), а не вместо него.
 * Порядок плитки: свой адрес / фото сервера → снимок из игры (если вещь снимается) → обложка карточки → значок вида.
 */
import { gta5rpPicture } from "@modovik/clothing/project-items";
import { mirrorPhotoUrl } from "@modovik/clothing/photos";
import { coverUrlOf } from "../library/mod-picture.js";

const FIRST = 0;

/** Ключ вещи в карте картинок вики Majestic: пол, вид, сквозной номер. */
export const majesticImageKey = (gender, component, global) =>
  `${gender}|${component}|${global}`;

/**
 * Карта картинок вики Majestic из её вещей: `Map(пол|вид|номер → адрес)`. Вещь вики — `{ gender, component, drawable (сквозной
 * номер), images[] }` (`majestic-wiki.js`, `normalizeWikiItem`); берётся первая картинка с разрешённого хоста. Все картинки вещи —
 * в `map.lists` (тот же ключ → адреса): по ним окно «Какой цвет будет виден в игре» рисует каждый цвет вещи своей картинкой.
 */
export function majesticImageMap(wikiItems = [], allowed = () => true) {
  const map = new Map();
  const lists = new Map();
  map.lists = lists;
  for (const wiki of wikiItems) {
    if (!wiki || !Number.isInteger(wiki.drawable)) continue;
    const urls = (wiki.images || []).filter((image) => image && allowed(image));
    if (!urls.length) continue;
    const key = majesticImageKey(wiki.gender, wiki.component, wiki.drawable);
    map.set(key, urls[0]);
    lists.set(key, urls);
  }
  return map;
}

/**
 * Картинка цвета вещи (номер цвета с нуля): GTA5RP — файл сервера этого цвета, Majestic — картинка вики с тем же номером, а если
 * картинка у вики одна — она; нет адреса — пустая строка (окно рисует образец цвета).
 */
export function itemColourPictureUrl(item, colour, majesticImages = null) {
  if (!item) return "";
  if (item.colourPictures?.[Math.max(0, colour)]) return item.colourPictures[Math.max(0, colour)];
  /* Бронежилет Majestic по прочности: у вики одна картинка, расцветки снимаются из игры (`itemColourCount`). */
  if (item.server === "majestic" && item.armorTier < 2) return "";
  /* Наше зеркало фото магазинов (`photos.js`): у сервера, выложенного на CDN целиком, фото берётся оттуда, а не с чужого хостинга. */
  const mirrored = mirrorPhotoUrl(item, Math.max(0, colour));
  if (mirrored) return mirrored;
  const global = Number.isInteger(item.global) && item.global >= 0 ? item.global : null;
  if (item.server === "gta5rp" && global !== null)
    return gta5rpPicture(item.gender, item.component, global, Math.max(0, colour)) || "";
  if (item.server === "majestic" && global !== null && majesticImages) {
    const list = majesticImages.lists?.get(majesticImageKey(item.gender, item.component, global));
    if (list?.length) return list[colour] || list[0];
  }
  return itemPictureUrl(item, majesticImages);
}

/**
 * Сколько расцветок вещи показывают свою картинку (28.10.2026, владелец: «каждая расцветка отдельно, без «N расцветок»»): GTA5RP — файл сервера есть у
 * каждого цвета, Majestic — столько, сколько картинок у вики; у вещи без картинок сервера (вещь самой GTA, снимок из игры — только первая расцветка) —
 * одна. Расцветок у вещи не больше `item.textures` и 26.
 */
export function itemColourCount(item, majesticImages = null, { gameShots = false } = {}) {
  if (!item) return 1;
  const total = Math.max(1, Math.min(26, Number(item.textures) || 1));
  if (item.colourPictures?.length > 1) return Math.min(total, item.colourPictures.length);
  if (total > 1 && gameShots && item.server === "majestic" && item.armorTier < 2) return total;
  /* Вещь игры снимается в каждой своей расцветке (`item-shots.js`). Плитка одинаковых вещей (`look`) — те же цвета. */
  const noNumber = !(Number.isInteger(item.global) && item.global >= 0);
  if (total > 1 && gameShots && noNumber && (!item.server || item.server === "gta5rp") && !item.glove && (item.look || !(item.together?.length > 1))) return total;
  if (total < 2 || item.together?.length > 1) return 1;
  const global = Number.isInteger(item.global) && item.global >= 0 ? item.global : null;
  if (item.server === "gta5rp" && global !== null) return total;
  if (item.server === "majestic" && global !== null && majesticImages) {
    const list = majesticImages.lists?.get(majesticImageKey(item.gender, item.component, global));
    return list?.length > 1 ? Math.min(total, list.length) : 1;
  }
  return 1;
}

/** Адрес картинки вещи или пустая строка. */
export function itemPictureUrl(item, majesticImages = null) {
  if (!item) return "";
  if (item.colourPictures?.[FIRST]) return item.colourPictures[FIRST];
  const mirrored = mirrorPhotoUrl(item, FIRST);
  if (mirrored) return mirrored;
  if (item.preview) return item.preview;
  const global = Number.isInteger(item.global) && item.global >= 0 ? item.global : null;
  const photo =
    global === null
      ? ""
      : item.server === "gta5rp"
        ? gta5rpPicture(item.gender, item.component, global, FIRST) || ""
        : item.server === "majestic" && majesticImages
          ? majesticImages.get(majesticImageKey(item.gender, item.component, global)) || ""
          : "";
  return photo;
}

/** Обложка карточки каталога по хэшу вещи базы (`pictureSha`) или пустая строка: плитка берёт её после снимка из игры. */
export const itemCoverUrl = (item) => coverUrlOf(item?.pictureSha);
