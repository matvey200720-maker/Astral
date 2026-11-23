/*
 * Плитки укрытий без WebGL: своя растеризация формы.
 *
 * Плиток на экране десятки — шестнадцать укрытий, готовые наборы, обложка
 * на полке, — и заводить на каждую контекст WebGL нельзя: браузер держит
 * их меньше двадцати на страницу. Поэтому форма растеризуется один раз на
 * размер плитки — в карту освещённости граней и покрытия (с суперсэмплингом
 * 2×2 ради ровного края), — а цвет подсветки накладывается на неё каждой
 * правкой за доли миллисекунды (`paintWallbangTile`).
 *
 * Камера ортографическая, Z вверх, как у моделей игры; грани, отвёрнутые от
 * камеры, отбрасываются — как в игре.
 */

import { SUN_DIRECTION, frameLook, shadePixel } from "./wallbang-look.js";

const SUPERSAMPLE = 2;

/* Базис камеры: вправо, вверх и к камере (от цели). */
export function viewBasis(yaw, pitch) {
  const right = [Math.cos(yaw), Math.sin(yaw), 0];
  const toCamera = [
    Math.sin(yaw) * Math.cos(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
  ];
  const up = [
    toCamera[1] * right[2] - toCamera[2] * right[1],
    toCamera[2] * right[0] - toCamera[0] * right[2],
    toCamera[0] * right[1] - toCamera[1] * right[0],
  ];
  return { right, up, toCamera };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Карта формы: `{ width, height, lambert, coverage }` — освещённость
 * видимой грани и доля покрытия пикселя, байтами 0…255.
 */
export function rasterizeWallbangShape(
  shape,
  { width, height, yaw = -0.62, pitch = 0.42, margin = 0.08 } = {},
) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const sw = w * SUPERSAMPLE;
  const sh = h * SUPERSAMPLE;
  const { right, up, toCamera } = viewBasis(yaw, pitch);
  const { positions, indices } = shape;
  const count = positions.length / 3;
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const depth = new Float32Array(count);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const point = [0, 0, 0];
  for (let vertex = 0; vertex < count; vertex += 1) {
    point[0] = positions[vertex * 3];
    point[1] = positions[vertex * 3 + 1];
    point[2] = positions[vertex * 3 + 2];
    sx[vertex] = dot(point, right);
    sy[vertex] = dot(point, up);
    depth[vertex] = dot(point, toCamera);
    minX = Math.min(minX, sx[vertex]);
    maxX = Math.max(maxX, sx[vertex]);
    minY = Math.min(minY, sy[vertex]);
    maxY = Math.max(maxY, sy[vertex]);
  }
  const usable = 1 - margin * 2;
  const scale = Math.min(
    (sw * usable) / Math.max(1e-6, maxX - minX),
    (sh * usable) / Math.max(1e-6, maxY - minY),
  );
  const offsetX = (sw - (maxX - minX) * scale) / 2;
  const offsetY = (sh - (maxY - minY) * scale) / 2;
  for (let vertex = 0; vertex < count; vertex += 1) {
    sx[vertex] = offsetX + (sx[vertex] - minX) * scale;
    /* Экран вниз, мир вверх. */
    sy[vertex] = sh - (offsetY + (sy[vertex] - minY) * scale);
  }

  const zbuffer = new Float32Array(sw * sh).fill(-Infinity);
  const shade = new Float32Array(sw * sh);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (let face = 0; face < indices.length; face += 3) {
    const i0 = indices[face];
    const i1 = indices[face + 1];
    const i2 = indices[face + 2];
    for (let axis = 0; axis < 3; axis += 1) {
      a[axis] = positions[i1 * 3 + axis] - positions[i0 * 3 + axis];
      b[axis] = positions[i2 * 3 + axis] - positions[i0 * 3 + axis];
    }
    let nx = a[1] * b[2] - a[2] * b[1];
    let ny = a[2] * b[0] - a[0] * b[2];
    let nz = a[0] * b[1] - a[1] * b[0];
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    nx /= length;
    ny /= length;
    nz /= length;
    /* Отвёрнутая грань не видна — как у игры с отсечением задних граней. */
    if (nx * toCamera[0] + ny * toCamera[1] + nz * toCamera[2] <= 0) continue;
    const lambert = Math.max(
      0,
      nx * SUN_DIRECTION[0] + ny * SUN_DIRECTION[1] + nz * SUN_DIRECTION[2],
    );
    const x0 = sx[i0];
    const y0 = sy[i0];
    const x1 = sx[i1];
    const y1 = sy[i1];
    const x2 = sx[i2];
    const y2 = sy[i2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const rightEdge = Math.min(sw - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(sh - 1, Math.ceil(Math.max(y0, y1, y2)));
    const d0 = depth[i0];
    const d1 = depth[i1];
    const d2 = depth[i2];
    for (let y = top; y <= bottom; y += 1) {
      const py = y + 0.5;
      for (let x = left; x <= rightEdge; x += 1) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * d0 + w1 * d1 + w2 * d2;
        const at = y * sw + x;
        if (z <= zbuffer[at]) continue;
        zbuffer[at] = z;
        shade[at] = lambert;
      }
    }
  }

  /* Суперсэмплинг → пиксель: доля покрытых отсчётов и их средний свет,
     оба — байтом 0…255: карта живёт в кэше сеанса, и восьми бит свету
     плитки хватает с запасом. */
  const lambert = new Uint8ClampedArray(w * h);
  const coverage = new Uint8ClampedArray(w * h);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  let lowest = -1;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let covered = 0;
      let light = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy += 1)
        for (let dx = 0; dx < SUPERSAMPLE; dx += 1) {
          const at = (y * SUPERSAMPLE + dy) * sw + x * SUPERSAMPLE + dx;
          if (zbuffer[at] === -Infinity) continue;
          covered += 1;
          light += shade[at];
        }
      const pixel = y * w + x;
      coverage[pixel] = Math.round((covered / samples) * 255);
      lambert[pixel] = covered ? Math.round((light / covered) * 255) : 0;
      if (covered) lowest = y;
    }
  /* `floor` — нижний край формы долей высоты плитки: там укрытие стоит на
     земле, и обложка кладёт под него тень. */
  const floor = lowest < 0 ? 1 : (lowest + 1) / h;
  return { width: w, height: h, lambert, coverage, floor };
}

/**
 * Плитка укрытия: карта формы, облик из работы и время суток → пиксели RGBA
 * (прозрачно вне формы). `target` — ImageData или массив того же размера.
 */
export function paintWallbangTile(raster, project, id, scene = "day", target) {
  const look = frameLook(project, id);
  const pixels =
    target?.data ||
    target ||
    new Uint8ClampedArray(raster.width * raster.height * 4);
  const colour = [0, 0, 0];
  for (let pixel = 0; pixel < raster.width * raster.height; pixel += 1) {
    const coverage = raster.coverage[pixel];
    const at = pixel * 4;
    if (!coverage) {
      pixels[at + 3] = 0;
      continue;
    }
    shadePixel(look, scene, raster.lambert[pixel] / 255, colour);
    pixels[at] = colour[0];
    pixels[at + 1] = colour[1];
    pixels[at + 2] = colour[2];
    pixels[at + 3] = coverage;
  }
  return pixels;
}

/*
 * Плитка на холсте: `document` нужен только здесь — растеризация и цвет
 * живут без него и проверяются тестом.
 */
export function wallbangTileCanvas(raster, project, id, scene = "day") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(raster.width, raster.height);
  paintWallbangTile(raster, project, id, scene, image);
  context.putImageData(image, 0, 0);
  return canvas;
}
