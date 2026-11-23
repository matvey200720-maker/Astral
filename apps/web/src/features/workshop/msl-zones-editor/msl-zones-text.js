/* Слова и числа редактора МСЛ-зон. */

import { COLOUR_EFFECT_LABELS } from "@modovik/climb-contract/recolor/colour-effects";
import { MSL_TILE_BUDGET, findMslColour, mslColourLook, mslLookHex } from "@modovik/climb-contract/recolor/msl-zones";
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { pluralWord } from "../../../plural.js";

const number = (value, digits = 1) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(".", ",");

export const metresText = (value) => `${number(value, value < 1 ? 2 : 1)} ${tr("м")}`;
export const percentText = (value) => `${Math.round(value)}\u00a0%`;
export const distanceText = (value) => (value >= 1000 ? `${number(value / 1000, 2)} ${tr("км")}` : `${Math.round(value)} ${tr("м")}`);
/* Число с пробелом между тысячами: «1 877». */
export const countText = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/* Быстрые цвета поля «Свой цвет». */
export const MSL_SWATCHES = Object.freeze(["#00ffd5", "#00b205", "#d51a1a", "#dee300", "#004dc2", "#d5188e", "#f4f4f4", "#ff8a1f"]);

/* Быстрые дальности: вплотную, рядом, квартал, как в моде, далеко. */
export const MSL_DISTANCE_STOPS = Object.freeze([
  Object.freeze({ value: 25, label: "25 м" }),
  Object.freeze({ value: 100, label: "100 м" }),
  Object.freeze({ value: 300, label: "300 м" }),
  Object.freeze({ value: 1500, label: "1,5 км" }),
  Object.freeze({ value: 3000, label: "3 км" }),
]);

/** Быстрые дальности и — если дальность работы между ними — она сама своим сегментом, по порядку: старое значение не теряется. */
export function distanceOptions(current) {
  if (MSL_DISTANCE_STOPS.some((item) => item.value === current)) return MSL_DISTANCE_STOPS;
  return [...MSL_DISTANCE_STOPS, { value: current, label: distanceText(current) }].sort((a, b) => a.value - b.value);
}

/** Цвет мода в списке: образец (hex) и что с ним в работе. */
export function mslColourRow(project, id) {
  const item = findMslColour(id);
  const look = mslColourLook(project, id);
  const own = Boolean(project.colours?.[id]) && !project.ownColour;
  /* Подпись — только у цвета, облик которого изменён: «как в моде» у остальных не печатаем. */
  const state = own ? (look.mode === "solid" ? tr("свой цвет") : tr(COLOUR_EFFECT_LABELS[look.mode].toLowerCase())) : "";
  return { id, label: `${item.many} линии`, swatch: mslLookHex(look, 0), mod: item.colour, own, state };
}

/**
 * Подсказка к дальности: когда линия появится в игре (`plan` — сторона
 * кусков и сколько моделей, `look` — `mslAppearance`).
 */
export function distanceHint(value, width, plan = null, look = null) {
  const parts = [];
  if (plan && look) {
    parts.push(
      trFill("Линия появится примерно за {0}.", distanceText(look.typical)),
    );
    const wanted = Math.max(25, Math.min(400, Math.round(value / 5) * 5));
    if (plan.side > wanted)
      parts.push(trFill("Мельче не режем: кусков вышло бы больше {0} — лишняя нагрузка на игру, поэтому линия появляется чуть раньше.", countText(MSL_TILE_BUDGET)));
    parts.push(trFill("В игре — {0} {1}.", countText(plan.tiles), modelsWord(plan.tiles)));
  } else {
    parts.push(tr("Видна с выбранного расстояния."));
  }
  if (width < 0.6 && value > 1500) parts.push(tr("Узкая лента вдали тоньше точки экрана — для дальности от 1,5 км поставьте ширину от 0,6 м."));
  else if (value > 2500) parts.push(tr("Дальше 2,5 км линии видны через полкарты: при слабой видеокарте это стоит кадров."));
  return parts.join(" ");
}

/* «1 модель», «3 модели», «152 модели», «1 877 моделей». */
export function modelsWord(count) {
  /* Форма — по правилу языка окна (`plural.js`): после 21 у русского «модель», у польского «modeli», у английского «models». */
  return pluralWord(count, [tr("модель"), tr("модели"), tr("моделей")]);
}
