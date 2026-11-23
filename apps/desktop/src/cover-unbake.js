/*
 * Обложка вещи без матового поля (24.10.2026, владелец: «обложка — PNG с прозрачным фоном, только модель, без запечённой
 * подложки»).
 *
 * `media-reshoot.js` до этого дня клал прозрачный снимок вещи на матовое поле мастерской (`@modovik/gfx/workshop-matte`) и
 * сохранял результат поверх обложки; снимок пропал, а поле — серое и известное до пикселя: фон равен ему точно (с
 * точностью ±1 на канал от округления), край вещи — смесь `α·вещь + (1 − α)·поле`. `unbake` вычитает поле:
 *
 *  1. фон — пиксели, равные полю, связанные с краем кадра (заливкой от границы), — становятся прозрачными;
 *  2. внутри вещи цвет и непрозрачность не меняются; пустоты, не связанные с краем (петля сумки), остаются цветом поля —
 *     на плитке поле то же, различия не видно;
 *  3. кайма вещи (два пикселя от фона) разбирается по смеси: цвет вещи берётся у ближайших внутренних пикселей, α —
 *     проекцией отличия от поля на отличие цвета вещи от поля, цвет без поля — из той же смеси. Если вещь темна, как
 *     поле (разница меньше 10 по каналу), α считается единицей.
 * Кадр (центровка и размер) не трогается.
 */

import sharp from "sharp";
import { workshopMatteRgba } from "@modovik/gfx/workshop-matte";

const BACKGROUND_TOLERANCE = 3;
const FLAT_COLOUR = 100;
const RING = 2;

/** Поле размера `width × height`, серые значения по пикселю (кэш: размеров на практике два). */
const fields = new Map();
function fieldOf(width, height) {
  const key = `${width}x${height}`;
  if (!fields.has(key)) {
    const rgba = workshopMatteRgba(width, height);
    const gray = new Uint8Array(width * height);
    for (let at = 0; at < gray.length; at += 1) gray[at] = rgba[at * 4];
    fields.set(key, gray);
  }
  return fields.get(key);
}

/**
 * RGBA PNG на поле → RGBA PNG без поля. Ответ: `{ png, stats }`; `stats` — доля фона, каймы и самой вещи.
 * @param {Uint8Array|Buffer} input
 */
export async function unbake(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const field = fieldOf(width, height);
  const total = width * height;
  const isField = (pixel) => {
    const at = pixel * 4;
    const gray = field[pixel];
    return (
      data[at + 3] === 255 &&
      Math.abs(data[at] - gray) + Math.abs(data[at + 1] - gray) + Math.abs(data[at + 2] - gray) <= BACKGROUND_TOLERANCE
    );
  };
  /* Заливка фона от границы кадра. */
  const background = new Uint8Array(total);
  const stack = [];
  const push = (pixel) => {
    if (!background[pixel] && isField(pixel)) {
      background[pixel] = 1;
      stack.push(pixel);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const pixel = stack.pop();
    const x = pixel % width;
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (pixel >= width) push(pixel - width);
    if (pixel < total - width) push(pixel + width);
  }
  /* Открытие маски (сжать на пиксель и вернуть): узкие «щупальца» фона, что залив протянул в тёмные места самой вещи
     (чёрный рюкзак, пиксели в пределах ±1 от поля), с фоном не остаются. Настоящая граница фона не сдвигается. */
  const within = (mask, x, y) => x < 0 || y < 0 || x >= width || y >= height || mask[y * width + x] === 1;
  const eroded = new Uint8Array(total);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (!background[y * width + x]) continue;
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) if (!within(background, x + dx, y + dy)) {
          all = 0;
          break;
        }
      eroded[y * width + x] = all;
    }
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (!background[pixel]) continue;
      let keep = 0;
      for (let dy = -1; dy <= 1 && !keep; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && eroded[ny * width + nx]) {
            keep = 1;
            break;
          }
        }
      if (!keep) background[pixel] = 0;
    }
  /* Кайма: не фон, но в двух пикселях от него. */
  const ring = new Uint8Array(total);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      if (background[pixel]) continue;
      near: for (let dy = -RING; dy <= RING; dy += 1)
        for (let dx = -RING; dx <= RING; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (background[ny * width + nx]) {
            ring[pixel] = 1;
            break near;
          }
        }
    }
  const out = Buffer.alloc(total * 4);
  let ringCount = 0;
  let backgroundCount = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const at = pixel * 4;
      if (background[pixel]) {
        backgroundCount += 1;
        continue;
      }
      if (!ring[pixel]) {
        out[at] = data[at];
        out[at + 1] = data[at + 1];
        out[at + 2] = data[at + 2];
        out[at + 3] = 255;
        continue;
      }
      ringCount += 1;
      /* Цвет вещи — среднее внутренних пикселей рядом (пятое окно); нет их — кайма непрозрачна. */
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let dy = -3; dy <= 3; dy += 1)
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const other = ny * width + nx;
          if (background[other] || ring[other]) continue;
          sumR += data[other * 4];
          sumG += data[other * 4 + 1];
          sumB += data[other * 4 + 2];
          count += 1;
        }
      const gray = field[pixel];
      let alpha = 1;
      if (count) {
        const cR = sumR / count - gray;
        const cG = sumG / count - gray;
        const cB = sumB / count - gray;
        const length = cR * cR + cG * cG + cB * cB;
        if (length >= FLAT_COLOUR) {
          const projection = ((data[at] - gray) * cR + (data[at + 1] - gray) * cG + (data[at + 2] - gray) * cB) / length;
          alpha = Math.min(1, Math.max(0, projection));
          if (alpha > 0.96) alpha = 1;
        }
      }
      if (alpha < 0.04) continue;
      for (let channel = 0; channel < 3; channel += 1)
        out[at + channel] = Math.min(255, Math.max(0, Math.round((data[at + channel] - (1 - alpha) * gray) / alpha)));
      out[at + 3] = Math.round(alpha * 255);
    }
  const png = await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png, stats: { width, height, background: backgroundCount / total, ring: ringCount / total } };
}

/**
 * Лежит ли обложка на матовом поле: все четыре угла и середины верхнего и нижнего края — поле, непрозрачные. `corners: true` — только
 * углы: большая карта упирается краем в кадр, и середины краёв у неё — сама карта.
 */
export async function isOnMatte(input, { corners = false } = {}) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const field = fieldOf(width, height);
  const probes = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    ...(corners
      ? []
      : [
          [width >> 1, 0],
          [width >> 1, height - 1],
        ]),
  ];
  return probes.every(([x, y]) => {
    const pixel = y * width + x;
    const at = pixel * 4;
    const gray = field[pixel];
    return (
      data[at + 3] === 255 &&
      Math.abs(data[at] - gray) + Math.abs(data[at + 1] - gray) + Math.abs(data[at + 2] - gray) <= BACKGROUND_TOLERANCE
    );
  });
}

/** Обложка вещи без поля: на поле — вычитает его, уже прозрачная остаётся как есть. */
export async function transparentCover(input) {
  return (await isOnMatte(input)) ? new Uint8Array((await unbake(input)).png) : new Uint8Array(input);
}
