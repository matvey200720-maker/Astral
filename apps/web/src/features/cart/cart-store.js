import { useSyncExternalStore } from "react";

/*
 * Корзина загрузок (ТЗ 03.11.2026): мод откладывают кнопкой «В корзину» на карточке и странице мода, потом ставят все разом
 * («Скачать всё» → обычная очередь установки оболочки). Прямое «Скачать» осталось как было, корзина — второй путь.
 *
 * Помнится только список id: имя, вес и обложку берём из каталога в момент показа, поэтому устаревших цифр в записи нет.
 * Запись живёт между запусками (`localStorage`); без хранилища (закрытое окно, чужая песочница) корзина работает до закрытия.
 */

const STORAGE_KEY = "astral-download-cart";
/* Больше, чем человек соберёт руками; предел — от разросшейся записи, а не от желания. */
export const CART_LIMIT = 200;

const listeners = new Set();
let ids = readStored();
let open = false;
let snapshot = { ids, open };

function readStored() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id) => typeof id === "string" && id))].slice(0, CART_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function commit(nextIds, nextOpen = open) {
  const idsChanged = nextIds !== ids;
  ids = nextIds;
  open = nextOpen;
  snapshot = { ids, open };
  if (idsChanged) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* Хранилища нет — корзина живёт до закрытия окна. */
    }
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

/** Состояние корзины для отрисовки: `{ ids, open }`. */
export const useCart = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
/** Лежит ли мод в корзине; перерисовывается только при смене ответа. */
export const useInCart = (id) =>
  useSyncExternalStore(subscribe, () => ids.includes(id), () => false);

export const cartHas = (id) => ids.includes(id);

/** Положить мод. `false`, если корзина полна. */
export function addToCart(id) {
  if (!id || ids.includes(id)) return true;
  if (ids.length >= CART_LIMIT) return false;
  commit([...ids, id]);
  return true;
}

export function removeFromCart(...removed) {
  const drop = new Set(removed);
  if (!ids.some((id) => drop.has(id))) return;
  commit(ids.filter((id) => !drop.has(id)));
}

export function toggleCart(id) {
  if (ids.includes(id)) removeFromCart(id);
  else addToCart(id);
}

export function clearCart() {
  if (ids.length) commit([]);
}

export const openCart = () => commit(ids, true);
export const closeCart = () => commit(ids, false);

/** Сбросить память модуля из тестов: `ids` берутся из хранилища заново. */
export function resetCartForTests() {
  commit(readStored(), false);
}
