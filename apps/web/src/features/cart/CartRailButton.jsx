import RailGlyph, {
  RailBadge,
  RailTip,
} from "../../components/desktop/navigation/rail-glyphs.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { trFill } from "../../locales/tr-fill.js";
import { closeCart, openCart, useCart } from "./cart-store.js";

/*
 * Кнопка корзины в нижней части рейки, над «Загрузками» (владелец, 16.11.2026: «значок корзины виден с самого начала»): стоит всегда. Число отложенного — тем же бейджем, что у загрузок;
 * пустая корзина — значок без числа, и окно по нажатию объясняет, что сюда кладут.
 */
export default function CartRailButton({ style }) {
  useTr();
  const { ids, open } = useCart();
  const label = ids.length ? trFill("Корзина: {0}", ids.length) : tr("Корзина");
  return (
    <button
      type="button"
      className={`sidebar-cart-button${open ? " active" : ""}`}
      onClick={open ? closeCart : openCart}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      style={style}
    >
      <RailGlyph id="cart" />
      {ids.length > 0 && <RailBadge count={ids.length} />}
      <RailTip label={tr("Корзина — очередь установки")} />
    </button>
  );
}
