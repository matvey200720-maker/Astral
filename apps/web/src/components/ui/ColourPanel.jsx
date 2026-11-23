import { ArrowCounterClockwise } from "./icons.jsx";
import Button from "./Button.jsx";
import { ColorPopover } from "./ColorPicker.jsx";
import Slider from "./Slider.jsx";
import { tr, useTr } from "../../locales/ui.js";
import "./colour-panel.css";

/*
 * Панель цвета в самой панели редактора (ТЗ 29.10.2026-d, п. 3; образец — «Цвета» в редакторе брони у конкурента): квадрат
 * насыщенности и яркости, полоса оттенка, HEX и R G B, готовые цвета, «Недавние», пипетка — тот же орган, что у всплывающего окна
 * поля цвета (`ColorPicker.jsx`), но не за кнопкой, а на виду. Поверх — то, чего у окна нет:
 *
 *  • «Сила» — как сильно цвет ложится на деталь, 5–100 %; слайдера нет, пока редактор не передал `onStrength`;
 *  • «Исходный цвет» — вернуть деталь к заводскому цвету; кнопки нет, пока редактор не передал `original`
 *    (`{ onClick, disabled, title }`): честно вернуть исходное он умеет не везде.
 *
 * Управляемая: `value` — цвет, `onChange` — каждая правка (не чаще кадра), `onCommit` — цвет устоялся и ушёл в «Недавние».
 */
export default function ColourPanel({
  label = "",
  value,
  onChange,
  onCommit,
  swatches = [],
  strength = 100,
  onStrength = null,
  original = null,
  className = "",
}) {
  useTr();
  const name = label || tr("Цвет");
  return (
    <div className={`ui-colour-panel${className ? ` ${className}` : ""}`}>
      <ColorPopover
        role="group"
        className="is-inline"
        label={name}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        swatches={swatches}
        swatchLabel={name}
      />
      {onStrength && (
        <Slider label={tr("Сила")} value={strength} min={5} max={100} unit="%" onChange={onStrength} />
      )}
      {original && (
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowCounterClockwise aria-hidden="true" />}
          disabled={Boolean(original.disabled)}
          title={original.title || tr("Исходный цвет")}
          onClick={original.onClick}
        >
          {tr("Исходный цвет")}
        </Button>
      )}
    </div>
  );
}
