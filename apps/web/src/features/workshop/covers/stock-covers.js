import { currentUiLanguage } from "../../../locales/ui.js";
import index from "./stock-covers.json";

/*
 * Штатные обложки полки — готовыми картинками из поставки (ТЗ 41-А, 20.10.2026:
 * «плитки грузятся невероятно долго»).
 *
 * Обложка, пока человек ничего не ставил, — один и тот же кадр у всех. Рисовать
 * его на каждом компьютере незачем: картинка снята с настоящего предпросмотра
 * редактора в полной загрузке (`scripts/stock-covers-live/`, Хелпер 11, 25.10.2026,
 * владелец: «фотки через наш предпросмотр, где будет показано всё»), и WebP лежит
 * рядом с остальными картинками мастерской (`/assets/workshop-covers/`). Полка
 * ставит её в плитку сразу — без печи, без IndexedDB и без первого запуска, который
 * иначе рисовал бы три десятка обложек.
 *
 * Плитка окончательна и в приложении с игрой, и при работе человека в игре
 * (24.10.2026, владелец: «превью плиток — готовые картинки, а не живая модель с
 * текстурами»): живая сцена — только внутри редактора, а работа человека
 * встаёт обложкой в библиотеке (`slot-cover.jsx`), не на полке.
 *
 * Файл лёгкий нарочно: полка спрашивает у него только адрес.
 */

const PICTURES_URL = "/assets/workshop-covers";
const COVERS = Object.freeze(index.covers || {});

/** Размер, в котором сняты штатные обложки: ширина × высота плитки. */
export const STOCK_COVER_SIZE = Object.freeze({
  ...(index.size || { width: 320, height: 200 }),
});

export const hasStockCover = (kind) => Boolean(COVERS[kind]);

/** Штатная картинка вида окончательна: печь её не заменяет, а плитка не ждёт ни печи, ни размера. */
export const stockCoverIsFinal = (kind) => hasStockCover(kind);

/** Виды со штатной картинкой — для проверки поставки. */
export const stockCoverKinds = () => Object.keys(COVERS);

/*
 * Языки, на которых картинки с текстом ещё не сняты. Французский (с 29.10.2026) снять заново пока нельзя — съёмка идёт с игрой на
 * этом ПК (`scripts/stock-covers-live`), — и он берёт английские: плитки «Полоска HP» и «Групповые метки» ставили адрес `….fr.webp`
 * в никуда (17.11.2026). Сняли `fr` — убрать его отсюда и добавить `fr` в `LANGUAGES` теста.
 */
const NOT_SHOT_YET = Object.freeze({ fr: "en" });

/** Имя файла штатной обложки вида `kind` на языке `language`. */
export function stockCoverFile(kind, language = "ru") {
  const entry = COVERS[kind];
  if (!entry) return null;
  if (!entry.text) return `${kind}.webp`;
  return `${kind}.${NOT_SHOT_YET[language] || language}.webp`;
}

/** Штатная обложка вида: `{ url }` или `null`, если такой картинки в поставке нет. */
export function stockCover(kind, language = currentUiLanguage()) {
  const entry = COVERS[kind];
  if (!entry) return null;
  return { url: `${PICTURES_URL}/${stockCoverFile(kind, language)}` };
}
