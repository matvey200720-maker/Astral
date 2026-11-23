import { currentUiLanguage } from "../../../locales/ui.js";
import { stockCover } from "./stock-covers.js";

/*
 * Обложка «Животных» — штатная картинка вида: стандартный кабан из игры, по центру, без перекраски (06.11.2026).
 *
 * Плитке полки нужен рисователь вида в списке `cover-loaders.js`, иначе `EditorCover` не ставит ничего и плитка остаётся
 * пустой плашкой (так «Животные» стояли на полке с 05.11: картинка лежала в поставке, но показать её было некому). Работа
 * человека на плитке не показывается — её обложка в библиотеке — снимок кадра редактора (`works/work-covers.js`); запасной
 * вид, пока снимка нет, — та же штатная картинка.
 */
export default function AnimalsCover() {
  const stock = stockCover("animals", currentUiLanguage());
  if (!stock) return null;
  return <img className="workshop-cover-image workshop-cover-stock" data-photo="" src={stock.url} alt="" draggable="false" decoding="async" />;
}
