/*
 * Размер модели ствола в руках, %: пределы и привязка к ним. Пределы — как в студии (`MODEL_SCALE` в
 * `@modovik/rage-drawable/model-adjust.js`: 50–200 %), тест сверяет их с ней. Модуль без зависимостей: его читают и экран,
 * и ленивая сцена сравнения.
 */
export const SIZE_MIN = 50;
export const SIZE_MAX = 200;
export const SIZE_STEP = 5;
export const SIZE_DEFAULT = 100;

export const clampSize = (value) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number)
    ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, number))
    : SIZE_DEFAULT;
};
