import Button from "../../components/ui/Button.jsx";
import { Check, ShoppingCart } from "../../components/ui/icons.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { canGoToCart, partKeyOf } from "./cart-eligibility.js";
import { toggleCart, useInCart } from "./cart-store.js";

/*
 * «В корзину» на странице мода (квадратный значок рядом с «Установить») и значок на карточке каталога. Второй путь рядом с обычным «Скачать»: мод откладывается, ставится из
 * корзины («Скачать всё»). У набора, работы и вещи одежды кнопки нет (`canGoToCart`).
 *
 * `compact` — круглый значок в углу карточки; нажатие не открывает карточку.
 */
export default function CartButton({
  mod,
  owner = null,
  compact = false,
  size = "lg",
  className = "",
}) {
  useTr();
  /* Часть мода (`owner` — мод, чья она) лежит в корзине под своим ключом, и состояние кнопки — по нему же. */
  const key =
    owner?.id && owner.id !== mod?.id ? partKeyOf(owner.id, mod?.id) : mod?.id;
  const inCart = useInCart(key);
  if (!canGoToCart(mod)) return null;
  const label = inCart ? tr("В корзине — убрать") : tr("В корзину");
  if (compact) {
    /* Корень карточки — кнопка, и вложить в неё вторую нельзя: знак держит роль и клавиши сам, как сердце (`MediaCard`). Нажатие,
       щелчок и клавиши до карточки не доходят — мод не открывается. */
    const stop = (event) => event.stopPropagation();
    const act = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCart(key);
    };
    return (
      <span
        role="button"
        tabIndex={0}
        className={`cart-card-button${inCart ? " is-in-cart" : ""}${className ? ` ${className}` : ""}`}
        aria-label={label}
        aria-pressed={inCart}
        title={label}
        onPointerDown={stop}
        onPointerUp={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        onKeyUp={stop}
        onClick={act}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") act(event);
        }}
      >
        {inCart ? (
          <Check weight="bold" aria-hidden="true" />
        ) : (
          <ShoppingCart aria-hidden="true" />
        )}
      </span>
    );
  }
  /* На странице мода — квадратный значок без слова, в одной строке с «Установить» (владелец, 12.11.2026); слово — подсказкой и для чтения с экрана. */
  const hint = inCart ? tr("Убрать из корзины") : tr("В корзину");
  return (
    <Button
      variant="secondary"
      size={size}
      className={`cart-add-button${className ? ` ${className}` : ""}`}
      icon={inCart ? <Check weight="bold" /> : <ShoppingCart />}
      aria-pressed={inCart}
      ariaLabel={hint}
      title={hint}
      onClick={() => toggleCart(key)}
    />
  );
}
