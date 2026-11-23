import { createContext, useContext } from "react";

/*
 * «Окно рядов сетки хоть раз сдвинулось прокруткой» (`VirtualGrid`, `data-virtual-scrolled`) — для карточек внутри неё.
 *
 * В прокрученной сетке плиты скелета под фото карточки не видны (`assembly-motion.css`: `[data-virtual-scrolled] .ui-media-card-frame > .ui-skeleton`),
 * но стоят в документе: элемент со своим стилем, три эффекта и своя загрузка того же адреса ради «доехало». Карточка, знающая, что сетка прокручена, плиты
 * не ставит вовсе (стенд 30.10.2026: узел плиты — седьмая часть цены вставки карточки). Вне сетки значение `false`: ничего не меняется.
 */
const VirtualScrolledContext = createContext(false);

export const VirtualScrolledProvider = VirtualScrolledContext.Provider;

export function useVirtualScrolled() {
  return useContext(VirtualScrolledContext);
}
