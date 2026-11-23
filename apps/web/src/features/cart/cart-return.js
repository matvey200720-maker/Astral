/*
 * Возврат в корзину (владелец, 16.11.2026): щелчок по названию работы в корзине открывает её редактор, «назад» из него приводит туда, откуда корзину открыли, и корзина снова открыта.
 * Страница, с которой открыли корзину, запоминается здесь на один заход (`rememberCartOrigin`), а `returnPage: "cart"` у реестра редакторов (`presetWorkshopEditor`, `openModEditor`) зовёт
 * оболочку по имени «cart» — `goBackToCart`.
 */
import { openCart } from "./cart-store.js";

export const RETURN_CART = "cart";

let origin = "";

/** Страница оболочки, на которой стояла корзина, когда из неё ушли в редактор. */
export function rememberCartOrigin(page) {
  origin = typeof page === "string" ? page : "";
}

/** Вернуться: на ту страницу, откуда открывали корзину (нет записи — на Главную), и открыть корзину. Запись отдаётся один раз. */
export function goBackToCart(navigate) {
  const page = origin || "overview";
  origin = "";
  navigate(page);
  openCart();
}

// Подпись кнопки «назад» в редакторе, открытом из корзины.
const LABELS = {
  ru: "Назад в корзину",
  uk: "Назад до кошика",
  en: "Back to the cart",
  de: "Zurück zum Warenkorb",
  pl: "Wróć do koszyka",
  fr: "Retour au panier",
};
export const cartReturnLabel = (locale = "ru") => LABELS[locale] ?? LABELS.en;
