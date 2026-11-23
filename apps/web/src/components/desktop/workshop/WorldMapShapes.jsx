import { PenNib } from "../../ui/icons.jsx";
import { ZONE_SHAPES, ZONE_STYLES, unitShapePoints } from "@modovik/vector-map";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Выбор фигуры большой карты — как в графических редакторах: ряд стилей
 * линии сверху («Контур», «Пунктир», «Точки», «Заливка») и сетка фигур под
 * ним. Один и тот же выбор стоит в двух местах: выпадашкой у инструмента
 * «Зоны» (короткий путь, не уводящий взгляд от карты) и в панели справа,
 * где рядом лежат цвет и толщина.
 *
 * Значки фигур рисуются из тех же точек, что и сами фигуры на карте
 * (`vector-map/shapes.js`): звезда в выборе и звезда на карте — одна звезда.
 */

/* Точки фигуры в квадрате значка 24×24 с полем в три точки. */
function iconPath(shape) {
  const points = unitShapePoints(shape);
  if (!points.length) return "";
  return `${points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${(12 + point.x * 18).toFixed(2)} ${(
          12 +
          point.y * 18
        ).toFixed(2)}`,
    )
    .join("")}Z`;
}

export function ShapeIcon({ shape }) {
  if (shape === "free") return <PenNib aria-hidden="true" />;
  return (
    <svg
      className="wmc-shape-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={iconPath(shape)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Значок стиля линии — тот же прямоугольник, нарисованный этим стилем. */
function StyleIcon({ style }) {
  const dash =
    style === "dashed" ? "3 2.4" : style === "dotted" ? "0.01 2.6" : undefined;
  return (
    <svg
      className="wmc-style-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="4"
        y="6"
        width="16"
        height="12"
        rx="2"
        fill={style === "filled" ? "currentColor" : "none"}
        fillOpacity={style === "filled" ? 0.9 : undefined}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray={dash}
        strokeLinecap={style === "dotted" ? "round" : "butt"}
      />
    </svg>
  );
}

/**
 * Ряд стилей и сетка фигур.
 *
 * @param {object} props
 * @param {string} props.shape выбранная фигура или `free`
 * @param {string|null} props.style выбранный стиль (`outline`, `dashed`,
 *   `dotted`, `filled`) или `null`, если сочетание своё
 * @param {(shape: string) => void} props.onShape
 * @param {(style: {id, line, fill}) => void} props.onStyle
 * @param {boolean} [props.free] показывать ли «Свою» — у выбранной зоны
 *   своя форма получается правкой вершин, а не выбором
 */
export function ShapePicker({
  shape,
  style,
  onShape,
  onStyle,
  free = true,
  compact = false,
}) {
  useTr();
  return (
    <div className={`wmc-shapes${compact ? " is-compact" : ""}`}>
      <div className="wmc-shape-styles" role="radiogroup" aria-label={tr("Линия")}>
        {ZONE_STYLES.map((item) => (
          <button
            type="button"
            key={item.id}
            role="radio"
            aria-checked={style === item.id}
            className={style === item.id ? "is-active" : ""}
            onClick={() => onStyle(item)}
          >
            <StyleIcon style={item.id} />
            <span>{tr(item.label)}</span>
          </button>
        ))}
      </div>
      <div className="wmc-shape-grid" role="radiogroup" aria-label={tr("Фигура")}>
        {ZONE_SHAPES.map((item) => (
          <button
            type="button"
            key={item.id}
            role="radio"
            aria-checked={shape === item.id}
            aria-label={tr(item.label)}
            title={tr(item.label)}
            className={shape === item.id ? "is-active" : ""}
            onClick={() => onShape(item.id)}
          >
            <ShapeIcon shape={item.id} />
          </button>
        ))}
        {free && (
          <button
            type="button"
            role="radio"
            aria-checked={shape === "free"}
            aria-label={tr("Своя фигура пером")}
            title={tr("Своя фигура — ставьте вершины пером")}
            className={shape === "free" ? "is-active" : ""}
            onClick={() => onShape("free")}
          >
            <ShapeIcon shape="free" />
          </button>
        )}
      </div>
    </div>
  );
}
