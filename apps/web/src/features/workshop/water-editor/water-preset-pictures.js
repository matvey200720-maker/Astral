/*
 * Картинки готовых видов воды (ТЗ 27.10.2026): настоящее море у Венис-Бич из игры в облике вида — вместо блока воды на сетке.
 *
 * Готовые виды (`WATER_PRESETS`) — постоянные числа, поэтому плитка — готовая картинка из поставки, как штатные обложки полки
 * (`covers/stock-covers.js`): ничего не рисуется у человека, игра не нужна, плитка стоит сразу. Снимает их
 * `scripts/stock-covers-live/water-presets.mjs` тем же кадром, что редактор («У берега», `water-sea-capture.js`).
 */

import { WATER_PRESETS } from "@modovik/climb-contract/recolor/water";

const PICTURES_URL = "/assets/workshop-covers/water-presets";

/** Размер картинки готового вида: 25 : 12, как плитка `.recolor-preset` (`recolor-editor.css`). */
export const WATER_PRESET_PICTURE_SIZE = Object.freeze({ width: 650, height: 312 });

const IDS = new Set(WATER_PRESETS.map((preset) => preset.id));

/** Адрес картинки готового вида или `null`, если такого вида нет. */
export const waterPresetPicture = (presetId) => (IDS.has(presetId) ? `${PICTURES_URL}/${presetId}.webp` : null);
