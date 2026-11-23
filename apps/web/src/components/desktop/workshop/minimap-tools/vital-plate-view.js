import {
  ARMOUR_PRESENT_MIN,
  vitalPlateBlock,
  vitalPlateLayout,
} from "@modovik/minimap-contract/vital-plate-layout";
import { contoursPath } from "./vital-icon-view.js";

/*
 * Плашка под HP и бронёй в предпросмотре (владелец, 21.11.2026). Расчёт — один с игрой, в договоре (`minimap-contract/vital-plate-layout.js`): блоки, величина
 * плашки, черта, броня «только когда она есть». Здесь к контурам добавляется путь SVG (`d`), которым предпросмотр их рисует.
 */

export { ARMOUR_PRESENT_MIN, vitalPlateBlock };

/**
 * Что нарисовать: плашки (одна общая или по одной на сторону), черта и слой — см. `vitalPlateLayout`; у каждой плашки добавлен `d`, у черты тоже.
 * @param {object} config проект
 * @param {{ armour?: number, drawn?: { health?: boolean, armour?: boolean }, big?: boolean }} [state] броня в кадре (0…100), какие значки рисуются, вид карты
 */
export function vitalPlateModel(config, state = {}) {
  const layout = vitalPlateLayout(config, state);
  return {
    ...layout,
    plates: layout.plates.map((item) => ({
      ...item,
      d: contoursPath(item.contours),
    })),
    divider: layout.divider && {
      ...layout.divider,
      d: `M${layout.divider.x1} ${layout.divider.y1}L${layout.divider.x2} ${layout.divider.y2}`,
    },
  };
}
