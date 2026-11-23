/*
 * Какой цвет мода показывает обложка (28.10.2026, вечер, владелец: «выбираю другую расцветку — 3D ставит одну и ту же, чёрную Nike»).
 *
 * Первый кадр ленты у вещи — обложка: разбор рисует её расцветкой «наугад» (стабильно по хэшу имени, `packages/clothing/worker.js`), а в
 * галерее та же расцветка лежит своим кадром. Обложка не кадр цвета (`colourOfImage` её не знает), и «3D» на ней открывал последний
 * выбранный цвет или первый — не тот, что на экране (Free Fire белая на сцене, а на персонаже Nike чёрная).
 *
 * Берём цвет обложки так:
 *   1. карточка сама назвала его — `domain.clothing.coverLetter` (разбор пишет её с 28.10.2026);
 *   2. иначе сличаем обложку с кадрами цветов по распределению цветов шляпы на тёмном фоне: кадры и обложка — один рендер, разный кадр
 *      и размер, поэтому сличается не картинка, а краски. Цвета, похожие до неразличимости (три чёрных), на экране и в 3D не отличаются —
 *      берётся первый из ближайших.
 * Картинки берутся с нашего CDN (`Access-Control-Allow-Origin: *`, браузер их уже держит для ленты), считается один раз на мод.
 */
import { colourListOf } from "@modovik/clothing/colour-list";
import { modColoursOf } from "./colour-mapping.js";

const SIZE = 48;
const BINS = 64;
/* Пиксель фона — отличается от фона (медиана краёв) меньше, чем на столько, суммой каналов. */
const BACKGROUND = 12;
/* Дальше этого картинка — не та вещь: цвет не называем. Сумма модулей разностей долей по 64 корзинам, от 0 до 2. */
const FAR = 0.9;

/** Распределение цветов предмета: 64 корзины (по 2 бита на канал), доли среди пикселей, не похожих на фон. `rgba` — SIZE×SIZE×4. */
export function paletteOf(rgba, size = SIZE) {
  const pixel = (x, y) => (y * size + x) * 4;
  const border = [];
  for (let x = 0; x < size; x += 1) for (const y of [0, size - 1]) border.push(pixel(x, y));
  for (let y = 1; y < size - 1; y += 1) for (const x of [0, size - 1]) border.push(pixel(x, y));
  const median = (channel) => border.map((at) => rgba[at + channel]).sort((a, b) => a - b)[border.length >> 1];
  const [r0, g0, b0] = [median(0), median(1), median(2)];
  const shares = new Float64Array(BINS);
  let count = 0;
  for (let at = 0; at < size * size * 4; at += 4) {
    if (rgba[at + 3] < 128) continue;
    const r = rgba[at];
    const g = rgba[at + 1];
    const b = rgba[at + 2];
    if (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) < BACKGROUND) continue;
    shares[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += 1;
    count += 1;
  }
  if (count) for (let index = 0; index < BINS; index += 1) shares[index] /= count;
  return shares;
}

const gap = (a, b) => {
  let sum = 0;
  for (let index = 0; index < BINS; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum;
};

/** Буква ближайшего по краскам цвета; все далеко — пусто. `frames`: `[{ letter, palette }]` по порядку цветов. */
export function nearestColour(cover, frames) {
  let best = null;
  for (const frame of frames) {
    const away = gap(cover, frame.palette);
    if (!best || away < best.away) best = { letter: frame.letter, away };
  }
  return best && best.away <= FAR ? best.letter : "";
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Картинка не загрузилась."));
    image.src = url;
  });
}

async function paletteOfUrl(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Холст недоступен.");
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return paletteOf(context.getImageData(0, 0, SIZE, SIZE).data);
}

/** Буква цвета, который назвала сама карточка (`coverLetter`): та буква автора, что лежит в одном из цветов списка. */
export function declaredCoverColour(mod) {
  const wanted = String((mod?.domain?.clothing || mod?.clothing || {}).coverLetter || "");
  if (!/^[a-z]$/.test(wanted)) return "";
  const { colours } = colourListOf(mod);
  return colours.find((colour) => String(colour.letters || colour.letter).includes(wanted))?.letter || "";
}

const known = new Map();

/** Цвет мода, который нарисован на обложке `cover`; не определился — пусто (3D тогда откроется первым цветом). Один расчёт на мод. */
export function coverColourOf(mod, cover) {
  const key = `${mod?.id || ""}|${cover || ""}`;
  if (known.has(key)) return known.get(key);
  const pending = (async () => {
    const declared = declaredCoverColour(mod);
    if (declared) return declared;
    const colours = modColoursOf(mod).filter((colour) => colour.image);
    if (!cover || colours.length < 2) return "";
    const [coverPalette, ...palettes] = await Promise.all([cover, ...colours.map((colour) => colour.image)].map((url) => paletteOfUrl(url)));
    return nearestColour(
      coverPalette,
      colours.map((colour, index) => ({ letter: colour.letter, palette: palettes[index] })),
    );
  })().catch(() => "");
  known.set(key, pending);
  return pending;
}

/** Забыть расчёты (тесты). */
export function forgetCoverColours() {
  known.clear();
}
