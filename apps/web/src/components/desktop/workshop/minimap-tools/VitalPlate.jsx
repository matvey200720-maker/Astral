import { MINIMAP_SCENE, vitalPlateShape } from "@modovik/minimap-contract";
import { contoursPath } from "./vital-icon-view.js";
import { vitalPlateModel } from "./vital-plate-view.js";

/*
 * Плашка под HP и бронёй (владелец, 21.11.2026) в предпросмотре мини-карты и миниатюра вида плашки в выборе.
 *
 * Слой — весь кадр сцены (191×136 точек), фигуры и черта лежат в точках сцены: плашка встаёт ровно туда, где её посчитал договор (`vital-plate-view.js`). Цвет и прозрачность
 * приходят из проекта. Когда броня «только когда она есть» уходит, плашка сжимается и гаснет, а с бронёй возвращается: у фигуры меняется контур (`d`) и прозрачность, браузер
 * ведёт их плавно за один и тот же промежуток (токен `--astral-duration`). Контур пилюли — те же точки на любую пропорцию, поэтому его можно вести от одного к другому.
 */

const SCENE_BOX = `0 0 ${MINIMAP_SCENE.width} ${MINIMAP_SCENE.height}`;

/**
 * @param {object} props
 * @param {object} props.config проект
 * @param {number} props.armour броня в кадре (0…100): по ней решается, есть ли блок брони
 * @param {{ health?: boolean, armour?: boolean }} props.drawn какие значки рисуются
 * @param {boolean} [props.big] большая карта
 */
export default function VitalPlate({ config, armour, drawn, big = false }) {
  const model = vitalPlateModel(config, { armour, drawn, big });
  if (!model.plates.length) return null;
  const { plate } = model;
  return (
    <svg
      className="mmc-vital-plate"
      viewBox={SCENE_BOX}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-shared={plate.shared ? "yes" : "no"}
      data-armour={model.present ? "present" : "absent"}
      style={{ zIndex: model.zIndex }}
    >
      {model.plates.map((item) => (
        <path
          key={item.key}
          className="mmc-vital-plate-shape"
          data-plate={item.key}
          data-shape={item.shape}
          data-present={item.present ? "yes" : "no"}
          d={item.d}
          fill={plate.colour}
          fillRule="evenodd"
          style={{
            d: `path("${item.d}")`,
            opacity: item.present ? plate.opacity : 0,
          }}
        />
      ))}
      {model.divider && (
        <path
          className="mmc-vital-plate-divider"
          data-orientation={model.divider.vertical ? "vertical" : "horizontal"}
          data-present={model.divider.present ? "yes" : "no"}
          d={model.divider.d}
          fill="none"
          stroke={plate.divider.colour}
          strokeWidth={model.divider.width}
          style={{ opacity: model.divider.present ? plate.divider.opacity : 0 }}
        />
      )}
    </svg>
  );
}

/* Размер фигуры в квадрате миниатюры (ширина, высота) и пропорция, под которую считается пилюля: лежачие — пилюля и прямоугольник. */
const THUMB = Object.freeze({
  pill: [0.92, 0.46, 2],
  rect: [0.9, 0.62, 2],
  square: [0.72, 0.72, 1],
  triangle: [0.86, 0.8, 1],
  heart: [1, 1, 1],
  shield: [0.9, 0.9, 1],
});

/** Миниатюра вида плашки в выборе: фигура вида, цвет берёт у текста кнопки. «Нет» — крестик. */
export function VitalPlateThumb({ shape }) {
  const [width, height, aspect] = THUMB[shape] || [];
  if (!width)
    return (
      <svg
        className="mmc-vital-thumb"
        viewBox="-0.5 -0.5 1 1"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M-0.34 -0.34L0.34 0.34M0.34 -0.34L-0.34 0.34"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.1"
          strokeLinecap="round"
        />
      </svg>
    );
  const contours = vitalPlateShape(shape, aspect).map((contour) =>
    contour.map(([x, y]) => [x * width, y * height]),
  );
  return (
    <svg
      className="mmc-vital-thumb"
      viewBox="-0.5 -0.5 1 1"
      aria-hidden="true"
      focusable="false"
    >
      <path d={contoursPath(contours)} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
