/*
 * Своя картинка у выбранной стены (3В ТЗ 18.10.2026): холст студии — сама стена, развёрнутая в
 * плоскость, а не лист игры. Основа — лист материала, повторённый по развёртке так, как он лежит
 * на стене (рельеф и швы листа — в самой картинке); альфа — по контуру треугольников стены:
 * проёмы, витрины и всё, что не стена, прозрачно. Итог встаёт в игру плашкой ровно по рамке
 * стены (`building-walls.js` договора) и закрывает только стену.
 *
 * Модуль чистый — без three и без DOM: пиксели в `Uint8ClampedArray`, тесты идут без холста.
 *
 *   wall       — стена из `wall-face.js` (`wallFromHit` добавляет часть и материал);
 *   sheet      — лист материала `{ rgba, width, height }`;
 *   decal      — её рамка как наклейка `{ point, normal, width, height, angle }`, метры сцены.
 */

import { decalBasis } from "@modovik/climb-contract/recolor/decal";
import { BUILDING_WALL_SIDE, buildingWallSheet } from "@modovik/climb-contract/recolor/building-walls";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Рамка стены как наклейка для плашки: центр рамки на плоскости самой выступающей вершины стены
 * (плашка не прячется за выступами, допуск группы — 12 см), нормаль — наружу, `angle` — поворот
 * осей наклейки к осям стены (у стен с отвесной нормалью — 0), размер — рамка стены.
 */
export function wallPlateDecal(wall) {
  const { basis, origin, width, height, depth } = wall;
  const front = depth?.front || 0;
  const centre = [0, 1, 2].map((axis) => origin[axis] + basis.right[axis] * (width / 2) + basis.up[axis] * (height / 2) + basis.normal[axis] * front);
  /* Оси наклейки по нормали (`decalBasis`) и поворот вокруг неё, что совмещает их с осями стены. */
  const base = decalBasis(basis.normal, 0);
  const angle = (Math.atan2(dot(basis.right, base.up), dot(basis.right, base.right)) * 180) / Math.PI;
  return {
    point: centre.map((value) => round(value, 3)),
    normal: basis.normal.map((value) => round(value, 4)),
    width: round(width, 2),
    height: round(height, 2),
    angle: Math.abs(angle) < 0.005 ? 0 : round(angle, 2),
  };
}

/** Плотность листа игры на стене, пикселей листа на метр (по площади, `sqrt|det|`). */
export function sheetDensity(wall, sheetWidth, sheetHeight) {
  const { a, b, d, e } = wall.sheet;
  return Math.sqrt(Math.abs(a * e - b * d) * sheetWidth * sheetHeight);
}

const powerOfTwoUp = (value) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

/**
 * Размер холста: степени двойки по пропорции рамки стены (как лист плашки сторон). Длинная сторона —
 * не больше `BUILDING_WALL_SIDE` и не больше того, что лист игры на этой стене может дать
 * (`density` — пикселей листа на метр): мелкая стена не растягивается до 2048.
 */
export function wallPlateSize(wall, density = Infinity) {
  const metres = [wall.width, wall.height];
  const wanted = Math.max(metres[0], metres[1]) * (Number.isFinite(density) ? density : BUILDING_WALL_SIDE);
  const longest = Math.min(BUILDING_WALL_SIDE, Math.max(256, powerOfTwoUp(wanted)));
  const [width, height] = buildingWallSheet(metres, longest);
  return { width, height, perMetre: Math.min(width / metres[0], height / metres[1]) };
}

/* Билинейная выборка листа с повтором. */
function sampleWrapped(sheet, u, v, out) {
  const x = u * sheet.width - 0.5;
  const y = v * sheet.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const wx = (px) => ((px % sheet.width) + sheet.width) % sheet.width;
  const wy = (py) => ((py % sheet.height) + sheet.height) % sheet.height;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ]) {
    const at = (wy(y0 + dy) * sheet.width + wx(x0 + dx)) * 4;
    for (let channel = 0; channel < 4; channel += 1) out[channel] += sheet.rgba[at + channel] * weight;
  }
  return out;
}

/**
 * Лист игры на стене, как он лежит на ней в игре: `width × height` пикселей, строка 0 — верх стены.
 * Пиксель (x, y) — метры стены `s = x / ширина · ширина стены`, `t` — вверх от низа рамки; лист
 * берётся по развёртке стены (`wall.sheet`: `u = a·s + b·t + c`, `v = d·s + e·t + f`), повтор — плиткой.
 */
export function wallBasePixels(wall, sheet, width, height) {
  const { a, b, c, d, e, f } = wall.sheet;
  const out = new Uint8ClampedArray(width * height * 4);
  const texel = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    const t = (1 - (y + 0.5) / height) * wall.height;
    for (let x = 0; x < width; x += 1) {
      const s = ((x + 0.5) / width) * wall.width;
      sampleWrapped(sheet, a * s + b * t + c, d * s + e * t + f, texel);
      const at = (y * width + x) * 4;
      out[at] = texel[0];
      out[at + 1] = texel[1];
      out[at + 2] = texel[2];
      out[at + 3] = 255;
    }
  }
  return out;
}

/**
 * Альфа контура стены: 255 там, где под пикселем есть треугольник стены (`wall.shape` — метры от
 * левого нижнего угла рамки), иначе 0. Контур расширен на пиксель: швы между соседними
 * треугольниками и край не оставляют щелей и ступенек.
 */
export function wallMask(wall, width, height) {
  const mask = new Uint8Array(width * height);
  const kx = width / wall.width;
  const ky = height / wall.height;
  const { shape } = wall;
  for (let at = 0; at + 5 < shape.length; at += 6) {
    const x0 = shape[at] * kx;
    const y0 = height - shape[at + 1] * ky;
    const x1 = shape[at + 2] * kx;
    const y1 = height - shape[at + 3] * ky;
    const x2 = shape[at + 4] * kx;
    const y2 = height - shape[at + 5] * ky;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = minY; y <= maxY; y += 1)
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w1 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w2 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w0 = 1 - w1 - w2;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * width + x] = 255;
      }
  }
  /* Расширение на пиксель (3 × 3): закрывает швы и дроби краёв. */
  const grown = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let dy = -1; dy <= 1 && !value; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            value = 255;
            break;
          }
        }
      }
      grown[y * width + x] = value;
    }
  return grown;
}

/** Альфа пикселей — не выше маски стены (правка не закрывает проёмы); правит и возвращает `rgba`. */
export function applyWallMask(rgba, mask) {
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const at = pixel * 4 + 3;
    if (mask[pixel] === 0) rgba[at] = 0;
    else if (mask[pixel] < 255) rgba[at] = Math.min(rgba[at], mask[pixel]);
  }
  return rgba;
}

/**
 * Основа холста: лист игры на стене с альфой по контуру; нет листа (браузер без Astral Desktop) — ровный тон
 * `colour`. `{ rgba, width, height, perMetre, mask }`.
 */
export function wallPlateBase(wall, sheet, { density = null, colour = "#8d9097" } = {}) {
  const size = wallPlateSize(wall, density ?? (sheet ? sheetDensity(wall, sheet.width, sheet.height) : Infinity));
  let rgba;
  if (sheet) rgba = wallBasePixels(wall, sheet, size.width, size.height);
  else {
    rgba = new Uint8ClampedArray(size.width * size.height * 4);
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
    for (let at = 0; at < rgba.length; at += 4) {
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
  }
  const mask = wallMask(wall, size.width, size.height);
  applyWallMask(rgba, mask);
  return { rgba, width: size.width, height: size.height, perMetre: size.perMetre, mask };
}

/** Плотность итоговой картинки — для честной строки: пикселей на метр и сколько метров стены умещает лист игры. */
export function wallPlateDensity(size, wall, sheetPerMetre = 0) {
  return { perMetre: round(size.perMetre, 1), sheetPerMetre: round(sheetPerMetre, 1), thin: sheetPerMetre > 0 && size.perMetre < sheetPerMetre * 0.8 };
}
