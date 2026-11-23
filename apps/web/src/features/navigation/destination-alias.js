import { goBackToCart } from "../cart/cart-return.js";

/*
 * Имена назначений, которые оболочка (`navigate` в `DesktopShell.jsx`) не держит страницами, а переводит на свои:
 *  - «account» — старое имя входа в профиль (аватар, меню): с 16.11.2026 ведёт на страницу профиля, как и «Профиль» в настройках;
 *  - «home» — Главная в возврате из редактора (`returnPage: "home"`); в оболочке она зовётся `overview`;
 *  - «cart» — возврат из редактора работы, открытого из корзины (`returnPage: "cart"`): на страницу, откуда открыли корзину, и корзина снова открыта (`features/cart/cart-return.js`).
 * Без этого возврат с `returnPage` приходил бы в пустой раздел.
 */
export const DESTINATION_PAGES = Object.freeze({
  account: "profile",
  home: "overview",
});

/**
 * Назначение — псевдоним: переход выполнен (`true`), оболочка дальше не идёт. Обычное имя страницы — `false`.
 * `navigate` — функция перехода оболочки.
 */
export function followAlias(destination, navigate) {
  if (destination === "cart") {
    goBackToCart(navigate);
    return true;
  }
  const page = DESTINATION_PAGES[destination];
  if (!page) return false;
  navigate(page);
  return true;
}
