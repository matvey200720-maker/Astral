/*
 * Линия раздела «Сравнить со штатным»: где она стоит и как её двигают. Чистые функции без React и three — ручка в `CompareStage.jsx` зовёт их,
 * тест проверяет их без WebGL. Положение — доля ширины кадра слева направо (0…1): штатная модель слева от линии, скин справа.
 */

/** Шаг клавиш ←/→ на ручке, доля ширины кадра; с Shift — крупнее. */
export const KEY_STEP = 0.05;
export const KEY_STEP_BIG = 0.2;

export const clampSplit = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
};

/** Положение линии под указателем: `left` и `width` — рамка кадра в окне, `clientX` — где указатель. */
export const splitFromPointer = (clientX, left, width) =>
  width > 0 ? clampSplit((clientX - left) / width) : null;

/** Новое положение от клавиши ручки; `null` — клавиша не наша. ←/→ двигают, Shift — крупнее, Home/End — к краям. */
export function splitFromKey(current, key, shift = false) {
  const step = shift ? KEY_STEP_BIG : KEY_STEP;
  if (key === "ArrowLeft") return clampSplit(current - step);
  if (key === "ArrowRight") return clampSplit(current + step);
  if (key === "Home") return 0;
  if (key === "End") return 1;
  return null;
}
