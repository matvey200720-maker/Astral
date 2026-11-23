import { MAP_COVER, mapCoverField } from "@modovik/vector-map";
import { modelShellOf, zoneSheetOf } from "./zone-footprints.js";

const MODEL_FILE = /\.ydr$/i;
const DICT_FILE = /\.ytd$/i;
const SHEET_LIMIT = 12;
const SHEET_SHARE = 0.78;
const ZONE_RED = [230, 40, 40];
const MIN_SIDE = 5;
const LOW_HEIGHT = 2.5;
const HEIGHT_SHARE = 0.15;
const STREAK_SHARE = 0.03;
// Поля обложки: доли высоты (боковые тоже от высоты).
const GAP_SHARE = { top: 0.06, bottom: 0.12, side: 0.06 };

const pointsOf = (hull) => Array.from(hull, ([x, y]) => [x, y]);

// Удвоенная знаковая площадь контура по формуле шнурования.
const twiceArea = (points) => points.reduce((sum, [x, y], at) => {
  const [nextX, nextY] = points[(at + 1) % points.length];
  return sum + (x * nextY - nextX * y);
}, 0);

// Квадрат наибольшего расстояния между двумя точками контура.
const longestReach = (points) => points.reduce((reach, [x, y]) => points.reduce(
  (best, [otherX, otherY]) => Math.max(best, (x - otherX) * (x - otherX) + (y - otherY) * (y - otherY)),
  reach,
), 0);

// След-«черта»: площадь контура меньше доли квадрата наибольшего расстояния.
function isStreak(hull) {
  const points = pointsOf(hull);
  return Math.abs(twiceArea(points)) / 2 < STREAK_SHARE * longestReach(points);
}

function isFlat(shell) {
  const [sizeX, sizeY, sizeZ] = shell.size;
  const side = Math.max(sizeX, sizeY);
  const ceiling = Math.max(LOW_HEIGHT, side * HEIGHT_SHARE);
  return sizeZ <= ceiling && side >= MIN_SIDE;
}

// Условия приёмки оболочки; проверяются по порядку, остановка на первом «нет».
const ACCEPT_RULES = [
  (shell) => shell?.hull?.length >= 3,
  isFlat,
  (shell) => !isStreak(shell.hull),
];

function acceptedShells(files) {
  const shells = [];
  for (const file of files) {
    if (!MODEL_FILE.test(file?.name) || !file.bytes) continue;
    const shell = modelShellOf(new Uint8Array(file.bytes));
    if (ACCEPT_RULES.every((rule) => rule(shell))) shells.push(shell);
  }
  return shells;
}

// Общий лист: цвет первого словаря .ytd, который его дал.
function sharedSheet(files) {
  let sheet = null;
  for (const file of files) {
    if (!DICT_FILE.test(file?.name) || !file.bytes) continue;
    sheet = zoneSheetOf(file.bytes);
    if (sheet) break;
  }
  return sheet;
}

const hexOf = ([red, green, blue]) =>
  "#" + [red, green, blue].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("");

// Сетка клеток: колонок столько, чтобы клетка вышла как можно крупнее при форме рабочей области.
function gridFor(width, height, count) {
  const gap = Object.fromEntries(Object.entries(GAP_SHARE).map(([edge, share]) => [edge, Math.round(height * share)]));
  const areaW = width - gap.side * 2;
  const areaH = height - gap.top - gap.bottom;
  const cols = Math.ceil(Math.sqrt(count * (areaW / areaH)));
  const rows = Math.ceil(count / cols);
  const cell = Math.min(areaW / cols, areaH / rows);
  const origin = [gap.side + (areaW - cols * cell) / 2, gap.top + (areaH - rows * cell) / 2];
  return {
    cell,
    centreOf: (index) => [
      origin[0] + (index % cols) * cell + cell / 2,
      origin[1] + Math.floor(index / cols) * cell + cell / 2,
    ],
  };
}

// Размах по оси и её середина (нулевой размах считается единицей).
function axisOf(values) {
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  return { span, mid: low + span / 2 };
}

// Контур модели в клетке: вид сверху, Y модели вверх, кадра вниз.
function outlineIn(hull, [centreX, centreY], cell) {
  const points = pointsOf(hull);
  const across = axisOf(points.map(([x]) => x));
  const depth = axisOf(points.map(([, y]) => y));
  const scale = (SHEET_SHARE * cell) / Math.max(across.span, depth.span);
  return points
    .map(([x, y]) => {
      const left = centreX + (x - across.mid) * scale;
      const top = centreY - (y - depth.mid) * scale;
      return `${left.toFixed(1)},${top.toFixed(1)}`;
    })
    .join(" ");
}

function polygonOf(points, colour) {
  return `<polygon points="${points}" fill="${colour}" fill-opacity="0.22" stroke="${colour}" `
    + `stroke-width="3" stroke-linejoin="round"/>`;
}

export async function zoneOutlinesPng(files = [], { width = MAP_COVER.width, height = MAP_COVER.height } = {}) {
  const shells = acceptedShells(files);
  if (shells.length === 0) return null;
  const shared = sharedSheet(files);

  const drawn = shells
    .map((shell) => ({ shell, footprint: shell.size[0] * shell.size[1] }))
    .sort((a, b) => b.footprint - a.footprint)
    .slice(0, SHEET_LIMIT);
  const grid = gridFor(width, height, drawn.length);
  const polygons = drawn.map(({ shell }, index) => {
    const points = outlineIn(shell.hull, grid.centreOf(index), grid.cell);
    return polygonOf(points, hexOf(shell.colour || shared || ZONE_RED));
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${polygons.join("")}</svg>`;

  const { default: sharp } = await import("sharp");
  const field = mapCoverField(width, height);
  const base = Buffer.from(field.buffer, field.byteOffset, field.byteLength);
  const png = await sharp(base, { raw: { width, height, channels: 4 } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}
