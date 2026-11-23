import { isCatalogBundle } from "../../catalog-utils.js";
import { isCatalogWork } from "../workshop/works/catalog-work.js";

/*
 * Что можно отложить в корзину (владелец, 16.11.2026: «корзина везде, в том числе на одежде»): всё, что есть в каталоге, — моды, вещи одежды и их паки, наборы, работы.
 * Чем отличается установка, решает `cartKindOf`: корзина кладёт всё, а ставит каждую позицию её же путём.
 */
export function canGoToCart(mod) {
  return Boolean(mod?.id);
}

/*
 * Работа мастерской лежит в корзине под своим ключом из «Моих работ» (`work:<id>` для снимка редактора, `project:<id>` для проекта студии, `features/workshop/works/workshop-works.js`), а не под id
 * из каталога: ключ ссылается на сохранённую работу, и «Установить» берёт её последнюю сохранённую версию.
 */
export const WORK_KEY = /^(work|project):/;
export const isWorkKey = (id) => typeof id === "string" && WORK_KEY.test(id);

/*
 * Часть мода (компонент сборки, часть редукса, ствол ганпака) лежит в корзине под ключом `part:<id мода>:<id части>` (владелец, 16.11.2026: «хочешь конкретный ствол из ганпака или часть редукса — кладёшь
 * в корзину, потом ставишь»). Часть — отдельная запись каталога со своим id; мод нужен затем, чтобы строка корзины называла, откуда она, и «Открыть карточку» вела на мод. Старые записи (чистые id модов) не меняются.
 */
export const PART_KEY = /^part:([^:]+):([^:]+)$/;
export const isPartKey = (id) => typeof id === "string" && PART_KEY.test(id);
export const partKeyOf = (ownerId, partId) => `part:${ownerId}:${partId}`;
export function parsePartKey(id) {
  const found = typeof id === "string" ? PART_KEY.exec(id) : null;
  return found ? { ownerId: found[1], partId: found[2] } : null;
}

/** Виды работ, что ставятся только после выбора цели (одежда): из корзины их «Установить» открывает редактор работы сразу с окном выбора цели (то же, что у «Применить»), молча они не ставятся. Скин ствола цели не выбирает — он ставится в слот ствола, как работы сборок. */
export const CHOOSING_WORK_KINDS = Object.freeze(["clothing"]);

/**
 * Как позиция ставится из корзины:
 *  - `"mod"` — одним нажатием, как «Установить» на карточке (`onInstall` оболочки), «Скачать всё» ставит её без вопросов;
 *  - `"clothing"` — вещь одежды сперва спрашивает, на что ставить (окно «Сделать заменёнку» и его соседи, как на карточке): «Установить» у строки открывает это окно, «Скачать всё» её не трогает;
 *  - `"card"` — набор из частей и работа мастерской ставятся со своей карточки (у них нет отдельного окна выбора): «Установить» у строки открывает карточку, «Скачать всё» их не трогает.
 */
export function cartKindOf(mod) {
  if (isCatalogBundle(mod) || isCatalogWork(mod)) return "card";
  /* Признак вещи одежды — категория, раздел или блок одежды карточки (`domain.clothing`), как у оболочки (`looksLikeClothing`). */
  if (
    mod?.catalogCategory === "clothing" ||
    mod?.catalogSection === "clothing" ||
    mod?.domain?.clothing
  )
    return "clothing";
  return "mod";
}

/** Позиция ждёт выбора и «Скачать всё» её молча не ставит. */
export const needsChoice = (mod) => cartKindOf(mod) !== "mod";
