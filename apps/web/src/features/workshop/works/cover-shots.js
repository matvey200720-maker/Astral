/*
 * Откуда снимается кадр редактора — одна мерка на штатные плитки (`scripts/stock-covers-live/recipes.mjs`) и на снимок работы
 * (`work-covers.js`): та же рамка и тот же момент, что у стандартного предпросмотра, поэтому работа и плитка видны с одной позиции.
 *
 * Вид обложки (`covers/editor-covers.js`) →
 *   target — сам кадр внутри области предпросмотра (кадр GTA вписан в неё с полями; у полоски HP — экран без подложки);
 *   crop   — кусок снимка в долях (0…1), если нужен не весь: `{ left, top, width, height }`;
 *   moment — на какой секунде выстрела снимать эффект: без этого снимок попадает между очередями в пустой кадр;
 *   inset  — кадр ложится на обложку целиком, эта доля её высоты: остров большой карты не режется рамкой плитки.
 *
 * Модуль без импортов: его читает и скрипт под Node.
 */

export const COVER_SHOTS = Object.freeze({
  /* Ник, полоска и плечи крупного плана: вид «Крупно», как открывается редактор. */
  "target-hp": Object.freeze({ target: ".target-hp-preview", crop: { left: 0.2067, top: 0.345, width: 0.5866, height: 0.65 } }),
  impact: Object.freeze({ target: ".fx-frame-canvas", crop: { left: 0.2, top: 0.2, width: 0.6, height: 0.64 }, moment: 0.3 }),
  tracer: Object.freeze({ target: ".fx-frame-canvas", crop: { left: 0.14, top: 0.2, width: 0.58, height: 0.62 }, moment: 0.04 }),
  "kill-effect": Object.freeze({ target: ".fx-frame-canvas" }),
  "screen-hits": Object.freeze({ target: ".fx-frame-canvas" }),
  sky: Object.freeze({ crop: { left: 0, top: 0.1, width: 1, height: 0.737 } }),
  "world-map": Object.freeze({ inset: 0.94 }),
});

export const coverShotOf = (kind) => COVER_SHOTS[kind] || null;
