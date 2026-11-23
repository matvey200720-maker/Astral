import "./mod-variant-switch.css";
import SegmentedControl from "../../../ui/SegmentedControl.jsx";
import { useTr } from "../../../../locales/ui.js";

/*
 * Переключатель вариантов карточки над «Установить» (ТЗ владельца 10.11.2026, `ref/1.png`): редукс «под GTA 5 RP / под Majestic /
 * с серыми таймциклами» — одна карточка, а версия выбирается здесь. Выбор меняет всю страницу — обложку, кадры, «Компоненты», вес и
 * платформы — и запоминается на карточку (`features/catalog/card-variant.js`).
 *
 * Сегменты — общий `SegmentedControl` (токены шкалы, плашка-индикатор). Заголовка нет: слово варианта — сама подпись. Два–три
 * варианта идут одной строкой поровну, четыре — сеткой 2×2, чтобы подписи не резались. Пока группа ставится или снимается, выбор закрыт:
 * половина сборки не должна уезжать под другой вариант.
 */

// Больше трёх вариантов в колонке карточки одной строкой не читаются.
const ROW_LIMIT = 3;

export default function ModVariantSwitch({ view }) {
  useTr();
  const choice = view.plan.variantChoice;
  if (!choice) return null;
  const grid = choice.options.length > ROW_LIMIT;
  return (
    <div className={grid ? "mod-card-variant mod-variant-switch is-grid" : "mod-card-variant mod-variant-switch"} data-count={choice.options.length}>
      <SegmentedControl
        label={view.actionCopy.variant}
        size="lg"
        indicator={!grid}
        options={choice.options}
        value={choice.value}
        onChange={choice.onChange}
        disabled={Boolean(choice.busy || view.plan.active)}
      />
    </div>
  );
}
