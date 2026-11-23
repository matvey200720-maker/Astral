/*
 * Заставка и пробуждение (15.11.2026): место знака в заголовке и полёт туда после сна. Отдельно от `contour-model.js`, потому что
 * экран пробуждения и точка посадки нужны в стартовом куске окна, а остальная математика заставки едет позже.
 */

/** Знак на месте знака в заголовке окна: центр и ширина по умолчанию (макет `LAND`), если настоящий знак не нашёлся. */
export const LAND_DEFAULT = Object.freeze({ x: 30, y: 20.5, w: 21.5 });

export const WAKE_FLY_MS = 800;

/** Знак пробуждения: ширина `min(14 %, 22 %)`, центр на 44 % высоты (`wake.html`). */
export function wakeLayout(width, height) {
  return {
    size: Math.min(width * 0.14, height * 0.22),
    cx: width / 2,
    cy: height * 0.44,
  };
}

/** Знак уезжает в заголовок: `e` 0…1 → смещение (px) и масштаб относительно знака в окне. Дуга изогнута, как в макете. */
export function wakeFlight(e, layout, land = LAND_DEFAULT) {
  const dx = (land.x - layout.cx) * e;
  const dy = (land.y - layout.cy) * e;
  const bend = -60 * Math.sin(Math.PI * e);
  return {
    x: dx + bend * 0.6,
    y: dy + bend * 0.8,
    s: 1 + (land.w / layout.size - 1) * e,
  };
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Полёт кадрами для `Element.animate` (линейный ход по кадрам, ease-in-out уже внутри): `steps + 1` значений `transform`. */
export function wakeFrames(layout, land = LAND_DEFAULT, steps = 16) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const flight = wakeFlight(easeInOut(i / steps), layout, land);
    return {
      offset: i / steps,
      transform: `translate(${flight.x.toFixed(2)}px, ${flight.y.toFixed(2)}px) scale(${flight.s.toFixed(4)})`,
    };
  });
}
