import { RETURN_DOWNLOADS } from "../downloads/downloads-return.js";

/*
 * Что делает карандаш у строки библиотеки на «Загрузках» (владелец, 16.11.2026). Описание действия — `edit` у карточки (`libraryShelfModel` в `CatalogPages.jsx`):
 *   `{ type: "editor", slotId, section, variant?, catalog? }` — работа мастерской: редактор на ней, «назад» ведёт на «Загрузки»;
 *   `{ type: "clothing", mod }` — вещь одежды: окно выбора цели (то же, что «Установить» на карточке и в корзине), решает `LibraryRows.jsx`.
 * Редактор открывается на странице мастерской (`presetWorkshopEditor` ложит запрос в память её редакторов), а не внутри библиотеки: «Загрузки» — не страница редакторов.
 */

const registry = () => import("../workshop/useWorkshopEditors.jsx");

/** Открыть редактор работы и уйти в мастерскую. `true` — редактор открылся. */
export async function openRowEditor(
  edit,
  { navigate, language = "ru", load = registry },
) {
  const { type, ...query } = edit;
  if (type !== "editor") return false;
  const { presetWorkshopEditor } = await load();
  const shown = presetWorkshopEditor(query, {
    locale: language,
    returnPage: RETURN_DOWNLOADS,
  });
  if (shown) navigate("workshop");
  return Boolean(shown);
}
