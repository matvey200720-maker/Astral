import Slider from "../../../ui/Slider.jsx";
import { ShapePicker } from "../WorldMapShapes.jsx";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Меню рисования большой карты (22.10.2026, ТЗ владельца: «выбрал инструмент
 * рисования — рядом выезжает нарядное меню с его функциями»). Выезжает у значка
 * инструмента (`flyout` колонки `EditorToolRail`), закрывается выбором, щелчком
 * мимо и Esc. Полные настройки — цвет, плотность, сглаживание — остаются
 * справа: меню лишь короче к ним путь.
 *
 *  • «Фигуры» — сетка фигур и ряд «Контур / Пунктир / Точки / Заливка»
 *    (`ShapePicker`, тот же выбор, что в панели справа);
 *  • «Кисть» — вид линии и толщина.
 *
 * Прямая «Линия» и «Стрелка» — свои инструменты колонки (как на образце владельца,
 * 22.10): в меню «Кисти» их нет, чтобы не было двух мест.
 */

/* Значки инструментов колонки: тот самый штрих, что ляжет на карту. */
const ToolSvg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" fill="none">
    {children}
  </svg>
);
export const LineToolIcon = () => (
  <ToolSvg>
    <path d="M5 19 19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </ToolSvg>
);
export const ArrowToolIcon = () => (
  <ToolSvg>
    <path d="M5 19 17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M20 4 13.4 5.7 18.3 10.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
  </ToolSvg>
);

const LINES = Object.freeze([
  Object.freeze({ id: "solid", label: "Сплошная" }),
  Object.freeze({ id: "dashed", label: "Пунктир" }),
  Object.freeze({ id: "dotted", label: "Точки" }),
]);

/* Образец вида линии — короткий штрих этим видом. */
function LineIcon({ line }) {
  return (
    <svg className="wmc-style-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none">
      <path
        d="M4 12h16"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap={line === "solid" ? "butt" : "round"}
        strokeDasharray={line === "dashed" ? "4.4 3.2" : line === "dotted" ? "0.01 4.2" : undefined}
      />
    </svg>
  );
}

/** Меню «Кисти»: вид линии и толщина — их обычно подбирают тут же, не уводя взгляд от карты. */
export function BrushMenu({ brush, onBrush }) {
  useTr();
  return (
    <div className="wmc-draw-menu">
      <div className="wmc-shape-styles wmc-draw-lines" role="radiogroup" aria-label={tr("Линия")}>
        {LINES.map((item) => (
          <button
            type="button"
            key={item.id}
            role="radio"
            aria-checked={(brush.line || "solid") === item.id}
            className={(brush.line || "solid") === item.id ? "is-active" : ""}
            onClick={() => onBrush({ line: item.id })}
          >
            <LineIcon line={item.id} />
            <span>{tr(item.label)}</span>
          </button>
        ))}
      </div>
      <Slider
        label={tr("Толщина")}
        value={brush.size}
        min={4}
        max={1200}
        step={2}
        unit={tr(" м")}
        onChange={(size) => onBrush({ size })}
      />
    </div>
  );
}

/** Меню «Фигур»: тот же выбор, что в панели справа. */
export function ShapesMenu({ shape, style, onShape, onStyle }) {
  return (
    <div className="wmc-draw-menu">
      <ShapePicker shape={shape} style={style} onShape={onShape} onStyle={onStyle} compact />
    </div>
  );
}
