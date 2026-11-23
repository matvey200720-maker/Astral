/*
 * Обложка «Положение мини-карты» (владелец, 12.11.2026: «кадр изображает экран 1920×1080; мини-карта уменьшена и стоит там, где она стоит в редуксе,
 * чтобы было видно расположение»).
 *
 * На матовом поле обложек — экран игры 16:9, на нём мини-карта в прямоугольнике записи `minimap` из `frontend.xml` автора (`gameEntryRect`,
 * `@modovik/minimap-contract`: тот же расчёт, которым редактор мини-карты ставит её на «Экране»). Рисуется только то, что известно из файла: место и
 * размер. Игрового кадра под картой нет — экран пустой, без нарисованного «мира».
 */
import { paintWorkshopMatte } from "@modovik/gfx/workshop-matte";
import { drawnBounds } from "./rasterize-cover.js";

/** Экран игры, который изображает кадр. */
export const GAME_SCREEN = Object.freeze({ width: 1920, height: 1080 });
/* Доля ширины обложки под экран и вид рамки экрана. */
const SCREEN_SHARE = 0.9;
const SCREEN_FILL = "#0e1014";
const SCREEN_EDGE = "rgba(255, 255, 255, 0.16)";
const SCREEN_RADIUS = 10;
const LABEL = `${GAME_SCREEN.width} × ${GAME_SCREEN.height}`;
const LABEL_COLOUR = "rgba(255, 255, 255, 0.34)";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Прямоугольник экрана на обложке: 16:9, по центру, `SCREEN_SHARE` ширины (и не выше 86 % высоты).
 * @param {{ width: number, height: number }} size размер обложки
 */
export function screenBox(size) {
  const aspect = GAME_SCREEN.width / GAME_SCREEN.height;
  const width = Math.min(size.width * SCREEN_SHARE, size.height * 0.86 * aspect);
  const height = width / aspect;
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/**
 * Прямоугольник мини-карты на обложке по её месту на экране игры.
 * @param {{ left: number, top: number, width: number, height: number }} rect доли экрана (`gameEntryRect`)
 * @param {{ x: number, y: number, width: number, height: number }} box экран на обложке
 */
export function minimapBox(rect, box) {
  /* Запись автора может выводить карту за край экрана (`posX` меньше нуля у штатной): на обложке она остаётся внутри экрана — виден край, а не обрезок. */
  const width = clamp(rect.width, 0.02, 1) * box.width;
  const height = clamp(rect.height, 0.02, 1) * box.height;
  const x = box.x + clamp(rect.left * box.width, 0, box.width - width);
  const y = box.y + clamp(rect.top * box.height, 0, box.height - height);
  return { x, y, width, height };
}

function roundedRect(context, { x, y, width, height }, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/**
 * Холст обложки: экран игры и мини-карта на её месте.
 * @param {HTMLCanvasElement} layer слой с нарисованной мини-картой (любого размера; берётся его закрашенная часть)
 * @param {{ left: number, top: number, width: number, height: number }} rect место мини-карты в долях экрана
 * @param {{ width: number, height: number }} size размер обложки
 * @returns {HTMLCanvasElement|null} `null` — слой пуст
 */
export function minimapScreenCanvas(layer, rect, size) {
  const bounds = drawnBounds(layer);
  if (!bounds) return null;
  const canvas = Object.assign(document.createElement("canvas"), { width: size.width, height: size.height });
  const context = canvas.getContext("2d");
  paintWorkshopMatte(context, size.width, size.height);

  const box = screenBox(size);
  roundedRect(context, box, SCREEN_RADIUS);
  context.fillStyle = SCREEN_FILL;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = SCREEN_EDGE;
  context.stroke();

  const place = minimapBox(rect, box);
  context.save();
  roundedRect(context, box, SCREEN_RADIUS);
  context.clip();
  Object.assign(context, { imageSmoothingQuality: "high" });
  context.drawImage(layer, bounds.x, bounds.y, bounds.width, bounds.height, place.x, place.y, place.width, place.height);
  context.restore();

  context.font = "500 15px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.fillStyle = LABEL_COLOUR;
  /* Подпись — цифры размера экрана: перевода не требует. Стоит в углу, противоположном карте по горизонтали, чтобы не лечь на неё. */
  const onRight = place.x + place.width / 2 > box.x + box.width / 2;
  context.textAlign = onRight ? "left" : "right";
  context.fillText(LABEL, onRight ? box.x + 16 : box.x + box.width - 16, box.y + box.height - 12);
  return canvas;
}
