/*
 * Залазы редукса по моделям автора (25.10.2026): метка мастерской ↔ картинка автора, чтобы «Редактировать» у части
 * открывало редактор «Залазы» с этими метками, а не пустой макет.
 *
 * Метки автора бывают двух видов (как в обложке `apps/desktop/src/climb-cover.js`):
 *
 *   плашка    — пара треугольников, вся метка нарисована в текстуре модели (314, Sakura V2): картинка — самая крупная
 *               встроенная текстура, обрезанная по непрозрачному — цвет автора лежит в ней;
 *   выдавлена — метка из контура модели (SPEX: Blink x Skye, Korolevskiy): картинка — лицевые грани, спроецированные на
 *               плоскость метки, белым по прозрачному (текстура у таких меток — белая 4 × 4, цвет задаёт игра).
 *
 * Имена файлов — метки мастерской (`arrow.ydr`…), `CLIMB_FILE_ALIASES` (набор SPEX) или метка с приставкой автора (`kifin_arrow.ydr`).
 * Метки, которых у автора нет, остаются заготовкой редактора.
 */

import { inflateSync } from "fflate";
import { CLIMB_FILE_ALIASES, CLIMB_MODELS, CLIMB_SLOTS } from "@modovik/climb-contract";
import { encodePng } from "@modovik/gfx";
import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";

const inflateRaw = (data) => inflateSync(data);
const OPAQUE = 8;
const PLATE_TRIANGLES = 4;
/** Длинная сторона картинки метки — как у текстуры метки редактора. */
const LONG_SIDE = 512;
const AXES = { x: 0, y: 1, z: 2 };

/*
 * `@modovik/rage-drawable` отдаёт модель в осях просмотра (Y вверх, как glTF), а опись меток мастерской (`CLIMB_MODELS`) —
 * в осях игры (Z вверх, Y вглубь): x → x, y → z, z → −y. Обратно, чтобы ось и сторона лица читались из описи как есть.
 */
function inGameAxes(array) {
  if (!array) return array;
  const out = new Float32Array(array.length);
  for (let at = 0; at < array.length; at += 3) {
    out[at] = array[at];
    out[at + 1] = -array[at + 2];
    out[at + 2] = array[at + 1];
  }
  return out;
}

const meshesInGameAxes = (meshes) =>
  meshes.map((mesh) => ({
    positions: inGameAxes(mesh.positions),
    normals: inGameAxes(mesh.normals),
    indices: mesh.indices,
  }));

const fileStem = (file) =>
  String(file?.name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.ydr$/i, "")
    .toLowerCase();

/** Слово слота в конце имени с приставкой автора: `kifin_arrow` → `arrow` (после «_» или «-»); имя без приставки — пусто. */
const PREFIXED_SLOT = /^(?:[a-z0-9]+[_-])+([a-z0-9]+)$/;

/** Модели с приставкой автора по слотам: слот → байты первой по алфавиту имён модели. */
function prefixedModels(byStem) {
  const known = new Set(CLIMB_SLOTS.map((slot) => slot.id));
  const found = new Map();
  for (const [stem, bytes] of [...byStem].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const slotId = PREFIXED_SLOT.exec(stem)?.[1];
    if (!slotId || !known.has(slotId)) continue;
    if (!found.has(slotId)) found.set(slotId, bytes);
  }
  return found;
}

/**
 * Файлы части → `Map(слот → { bytes, alias })`: метки мастерской по своему имени, SPEX — по `CLIMB_FILE_ALIASES`, модель с приставкой автора
 * (`kifin_arrow.ydr`, слово слота в конце имени после «_» или «-») — как псевдоним. Своё имя главнее псевдонима SPEX, псевдоним — приставки;
 * из нескольких имён с приставкой берётся первое по алфавиту.
 */
export function climbModelFiles(files) {
  const byStem = new Map(files.filter((file) => /\.ydr$/i.test(String(file?.name || ""))).map((file) => [fileStem(file), file.bytes]));
  const prefixed = prefixedModels(byStem);
  const found = new Map();
  for (const slot of CLIMB_SLOTS) {
    const own = byStem.get(slot.id);
    const alias = own ? undefined : byStem.get(CLIMB_FILE_ALIASES[slot.id]) || prefixed.get(slot.id);
    if (own || alias) found.set(slot.id, { bytes: own || alias, alias: !own });
  }
  return found;
}

/** Лицо метки: у меток мастерской — из описи, у модели автора под другим именем — по её самой тонкой оси. */
function faceOf(slotId, alias, meshes) {
  if (!alias) return CLIMB_MODELS[slotId];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let at = 0; at < mesh.positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
      }
  const size = max.map((value, axis) => value - min[axis]);
  const depth = size.indexOf(Math.min(...size));
  if (!Number.isFinite(size[depth]) || depth === 0) return null;
  const axis = depth === 2 ? "z" : "y";
  /* Текст читается слева направо: по Z — смотрим с +Z, по Y — с −Y (как у плиток мастерской). */
  return { axis, facing: axis === "z" ? 1 : -1 };
}

/** Лицевые треугольники метки в координатах лица: `[[u, v] × 3]…` (как `markerTriangles` обложки). */
export function faceTriangles(meshes, model) {
  const depth = AXES[model.axis];
  const vertical = model.axis === "z" ? 1 : 2;
  const mirror = (model.axis === "z" && model.facing < 0) || (model.axis === "y" && model.facing > 0);
  const triangles = [];
  for (const { positions, normals, indices } of meshes)
    for (let at = 0; at < indices.length; at += 3) {
      const corners = [indices[at], indices[at + 1], indices[at + 2]];
      const facing = normals
        ? corners.reduce((sum, vertex) => sum + normals[vertex * 3 + depth], 0) / 3
        : 0;
      if (facing * model.facing <= 0.5) continue;
      triangles.push(corners.map((vertex) => [(mirror ? -1 : 1) * positions[vertex * 3], positions[vertex * 3 + vertical]]));
    }
  return triangles;
}

/**
 * Треугольники → RGBA белым по прозрачному, длинная сторона `LONG_SIDE`, поле 2 %. Рисуется вдвое крупнее и ужимается
 * усреднением: края гладкие, без ступенек.
 */
export function rasterizeShape(triangles, { colour = [255, 255, 255], longSide = LONG_SIDE } = {}) {
  if (!triangles.length) return null;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const triangle of triangles)
    for (const [u, v] of triangle) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  const spanU = Math.max(1e-6, maxU - minU);
  const spanV = Math.max(1e-6, maxV - minV);
  const pad = Math.max(2, Math.round(longSide * 0.02));
  const scale = (longSide - pad * 2) / Math.max(spanU, spanV);
  const width = Math.max(4, Math.round(spanU * scale) + pad * 2);
  const height = Math.max(4, Math.round(spanV * scale) + pad * 2);
  const over = 2;
  const bigWidth = width * over;
  const bigHeight = height * over;
  const mask = new Uint8Array(bigWidth * bigHeight);
  for (const triangle of triangles) {
    const points = triangle.map(([u, v]) => [(pad + (u - minU) * scale) * over, (pad + (maxV - v) * scale) * over]);
    const [[x0, y0], [x1, y1], [x2, y2]] = points;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const right = Math.min(bigWidth - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(bigHeight - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = top; y <= bottom; y += 1)
      for (let x = left; x <= right; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        /* Допуск в долю пикселя закрывает щели между соседними треугольниками. */
        if (w0 >= -0.002 && w1 >= -0.002 && w2 >= -0.002) mask[y * bigWidth + x] = 1;
      }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (let dy = 0; dy < over; dy += 1)
        for (let dx = 0; dx < over; dx += 1) covered += mask[(y * over + dy) * bigWidth + x * over + dx];
      const at = (y * width + x) * 4;
      rgba[at] = colour[0];
      rgba[at + 1] = colour[1];
      rgba[at + 2] = colour[2];
      rgba[at + 3] = Math.round((covered / (over * over)) * 255);
    }
  return { width, height, rgba };
}

/* Непрозрачная часть картинки плашки: метка без пустых полей текстуры. */
function opaqueCrop({ width, height, rgba }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (rgba[(y * width + x) * 4 + 3] > OPAQUE) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (maxX < 0) return null;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const out = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1)
    out.set(rgba.subarray(((minY + y) * width + minX) * 4, ((minY + y) * width + minX + cropWidth) * 4), y * cropWidth * 4);
  return { width: cropWidth, height: cropHeight, rgba: out };
}

/** Самая крупная встроенная текстура модели → `{ width, height, rgba }` или `null`. */
function plateTexture(drawable) {
  let best = null;
  for (const ref of drawable.embeddedTextures || []) {
    if (best && ref.width * ref.height <= best.width * best.height) continue;
    try {
      const decoded = decodeTextureRef(ref, { maxSize: LONG_SIDE });
      best = { width: decoded.width, height: decoded.height, rgba: decoded.rgba };
    } catch {
      /* лист не читается — следующий */
    }
  }
  return best;
}

/**
 * Картинка одной метки автора: `{ width, height, rgba, kind }` или `null` (модель не читается, лица нет, пустая).
 * `kind` — `"plate"` (картинка в текстуре) или `"shape"` (выдавленный контур).
 */
export function climbMarkerArt(slotId, { bytes, alias }) {
  const { drawables } = readDrawable(bytes, { inflateRaw });
  const drawable = drawables[0];
  if (!drawable?.meshes?.length) return null;
  const meshes = meshesInGameAxes(drawable.meshes);
  const model = faceOf(slotId, alias, meshes);
  if (!model) return null;
  const triangles = faceTriangles(meshes, model);
  if (!triangles.length) return null;
  if (triangles.length <= PLATE_TRIANGLES) {
    const texture = plateTexture(drawable);
    const crop = texture ? opaqueCrop(texture) : null;
    return crop ? { ...crop, kind: "plate" } : null;
  }
  const shape = rasterizeShape(triangles);
  return shape ? { ...shape, kind: "shape" } : null;
}

/**
 * Залазы части → `{ cover: null, work: { kind: "climbing", markers } }` или `null`, если ни одной метки не прочиталось.
 * `markers` — `[{ slot, width, height, kind, png }]` в порядке набора мастерской; `lost` — что редактор не повторит.
 */
export function climbingFrom(files) {
  const found = climbModelFiles(files);
  const markers = [];
  for (const slot of CLIMB_SLOTS) {
    const file = found.get(slot.id);
    if (!file) continue;
    let art = null;
    try {
      art = climbMarkerArt(slot.id, file);
    } catch {
      art = null;
    }
    if (!art) continue;
    markers.push({
      slot: slot.id,
      width: art.width,
      height: art.height,
      kind: art.kind,
      png: encodePng(art.rgba, art.width, art.height, 4),
    });
  }
  if (!markers.length) return null;
  return {
    cover: null,
    work: {
      kind: "climbing",
      markers,
      lost: [
        "места меток на карте — их ставит расстановка мода, редактор их не меняет",
        ...(markers.some((marker) => marker.kind === "shape") ? ["глубина выдавленных надписей — в редакторе метка плоская, с картинкой на плашке"] : []),
      ],
    },
  };
}
