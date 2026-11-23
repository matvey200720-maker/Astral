/*
 * Цвет залаза: разбор и канонический вид.
 *
 * Отдельным файлом, потому что цвет нужен и там, где макет проверяют
 * (`index.js`, главный процесс), и там, где метку рисуют (окно редактора).
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * `#rrggbb` или `#rgb` → [r, g, b].
 *
 * Непонятый цвет останавливает сборку, а не превращается в «примерно чёрный»:
 * молчаливая подмена доехала бы до игры незамеченной.
 */
export function parseClimbColour(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(
    String(value || "").trim(),
  );
  if (!match) throw new Error(`Цвет должен быть в виде #rrggbb: «${value}».`);
  const digits =
    match[1].length === 3
      ? [...match[1]].map((character) => character + character).join("")
      : match[1];
  const number = Number.parseInt(digits, 16);
  return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
}

export const formatClimbColour = (rgb) =>
  `#${rgb
    .map((value) =>
      Math.round(clamp01(value / 255) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Канонический шестизначный вид: проекты сравниваются текстом. */
export const normalizeClimbColour = (value) =>
  formatClimbColour(parseClimbColour(value));
