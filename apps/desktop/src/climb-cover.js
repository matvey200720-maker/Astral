import * as climbContract from "@modovik/climb-contract";
import * as dds from "@modovik/dds";
import * as matte from "@modovik/gfx/workshop-matte";
import * as ypt from "@modovik/ypt";
import * as drawable from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import sharp from "sharp";

export { CLIMB_FILE_ALIASES } from "@modovik/climb-contract";

const OPAQUE_ABOVE = 8; // альфа выше порога — точка непрозрачная
const PLATE_TRIANGLES = 4; // не больше — «плашка» с картинкой в текстуре
const FACING_ABOVE = 0.5; // средняя нормаль по глубине должна быть строго больше
const ASPECT_RANGE = [0.6, 4];
const MARK_FIT = 0.9;
const PICTURE_FIT = 0.92;
const ROWS_SHARE = 0.86;
const CELL_SHARE = 0.92;
const ROW_SPLIT_FROM = 4;
const AXIS_SLOT = { x: 0, y: 1, z: 2 };

// Результат действия либо запасное значение, если оно бросило.
function attempt(work, fallback) {
  try {
    return work();
  } catch {
    return fallback;
  }
}

// Номера кусков по три подряд: 0, 3, 6, … пока не кончится список.
const triples = (length) => Array.from({ length: Math.ceil(length / 3) }, (_, slot) => slot * 3);

// Все вершины всех геометрий всех моделей: [x, y, z]
const verticesOf = (geometry) =>
  geometry.models.flatMap((model) =>
    model.geometries.flatMap(({ positions }) =>
      triples(positions.length).map((at) => [positions[at], positions[at + 1], positions[at + 2]])));

// Все треугольники: индексы по три подряд, в порядке геометрий
const trianglesOf = (geometry) =>
  geometry.models.flatMap((model) =>
    model.geometries.flatMap(({ positions, normals, indices }) =>
      triples(indices.length).map((at) => ({ positions, normals, corners: [indices[at], indices[at + 1], indices[at + 2]] }))));

export function thinFace(bytes) {
  const points = verticesOf(ypt.readDrawableGeometry(bytes));
  const low = [0, 1, 2].map((axis) => points.reduce((best, point) => (point[axis] < best ? point[axis] : best), Infinity));
  const high = [0, 1, 2].map((axis) => points.reduce((best, point) => (point[axis] > best ? point[axis] : best), -Infinity));
  const sizes = high.map((top, axis) => top - low[axis]);
  const thinnest = sizes.reduce((best, size, axis) => (size < sizes[best] ? axis : best), 0);
  if (thinnest === 0 || !Number.isFinite(sizes[thinnest])) return null;
  // читать метку слева направо: смотрим с +z или с −y
  return thinnest === 2 ? { axis: "z", facing: 1 } : { axis: "y", facing: -1 };
}

// Средняя по трём углам компонента нормали вдоль глубины; без нормалей — 0.
function meanDepth(normals, corners, depth) {
  if (!normals) return 0;
  const [a, b, c] = corners;
  return (normals[a * 3 + depth] + normals[b * 3 + depth] + normals[c * 3 + depth]) / 3;
}

export function markerTriangles(bytes, { axis, facing }) {
  const depth = AXIS_SLOT[axis];
  const up = axis === "z" ? 1 : 2;
  const mirrored = (axis === "z" && facing < 0) || (axis === "y" && facing > 0);
  const side = mirrored ? -1 : 1;
  return trianglesOf(ypt.readDrawableGeometry(bytes))
    .filter(({ normals, corners }) => !(meanDepth(normals, corners, depth) * facing <= FACING_ABOVE))
    // зеркало — умножение на −1; оно же (на +1) всегда выполняется и для несуществующей вершины
    .map(({ positions, corners }) => corners.map((index) => [side * positions[index * 3], positions[index * 3 + up]]));
}

// Пиксели первого уровня текстуры или null, если уровня нет / он не расшифровался.
function firstLevelPixels(texture) {
  const level = texture.spans?.[0];
  if (!level) return null;
  return attempt(() => {
    const slice = texture.payload.subarray(level.offset, level.offset + level.bytes);
    return dds.decodeTexture(texture.format, slice, texture.width, texture.height);
  }, null);
}

// Суммы цветов непрозрачных точек и их число.
function opaqueSums(pixels) {
  const sums = { red: 0, green: 0, blue: 0, count: 0 };
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] > OPAQUE_ABOVE) {
      sums.red += pixels[at];
      sums.green += pixels[at + 1];
      sums.blue += pixels[at + 2];
      sums.count += 1;
    }
  }
  return sums;
}

// Цвет словаря текстур автора (`.ytd`): среднее по непрозрачным точкам всех листов; null — словарь не прочитался или пуст.
export function sheetColour(bytes) {
  const textures = attempt(() => drawable.readTextureDictionary(bytes, { inflateRaw: inflateRawNode }), []);
  const readable = textures.map((texture) => attempt(() => drawable.decodeTextureRef(texture, { maxSize: 64 }).rgba, null)).filter(Boolean);
  const all = readable.map(opaqueSums);
  const count = all.reduce((sum, part) => sum + part.count, 0);
  if (!count) return null;
  return ["red", "green", "blue"].map((channel) => Math.round(all.reduce((sum, part) => sum + part[channel], 0) / count));
}

/* Метка без своих листов внутри модели красится листами автора из словаря рядом (`kifin.ytd` у `kifin_*.ydr`, GODMODE, 12.11.2026): `outside` — цвет этого словаря.
   Без него остаётся прежний белый. */
export function markerColour(bytes, outside = null) {
  const textures = attempt(() => ypt.readDrawableTextures(bytes), []);
  if (!textures.length) return outside ?? [255, 255, 255];
  const readable = textures.map((texture) => firstLevelPixels(texture)).filter(Boolean);
  const all = readable.map(opaqueSums);
  const count = all.reduce((sum, part) => sum + part.count, 0);
  const total = ["red", "green", "blue"].map((channel) => all.reduce((sum, part) => sum + part[channel], 0));
  return count ? total.map((sum) => Math.round(sum / count)) : null;
}

// Картинка плашки — самая крупная читаемая текстура. Текстуры идут в своём порядке; расшифровывается
// только та, что строго крупнее уже найденной.
function plateOf(bytes) {
  const textures = [...ypt.readDrawableTextures(bytes)];
  return textures.reduce((best, texture) => {
    if (best && !(texture.width * texture.height > best.width * best.height)) return best;
    const rgba = firstLevelPixels(texture);
    return rgba ? { width: texture.width, height: texture.height, rgba } : best;
  }, null);
}

// Прямоугольник непрозрачной части картинки или null, если её нет.
function opaqueBox({ width, height, rgba }) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let cell = 0; cell < width * height; cell += 1) {
    if (rgba[cell * 4 + 3] > OPAQUE_ABOVE) {
      const x = cell % width;
      const y = (cell - x) / width;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const clampAspect = (ratio) => Math.min(Math.max(ratio, ASPECT_RANGE[0]), ASPECT_RANGE[1]);

function contourOf(triangles) {
  const pairs = triangles.flat();
  const lowest = (pick) => pairs.reduce((best, pair) => Math.min(best, pick(pair)), Infinity);
  const highest = (pick) => pairs.reduce((best, pair) => Math.max(best, pick(pair)), -Infinity);
  const first = ([u]) => u;
  const second = ([, v]) => v;
  return { minU: lowest(first), maxU: highest(first), minV: lowest(second), maxV: highest(second) };
}

// Форма метки: плашка с картинкой (если треугольников мало) или силуэт; null — картинки нет.
function markerShape(triangles, bytes) {
  const picture = triangles.length <= PLATE_TRIANGLES ? plateOf(bytes) : null;
  if (!picture) {
    const { minU, maxU, minV, maxV } = contourOf(triangles);
    return { aspect: clampAspect((maxU - minU) / Math.max(maxV - minV, 1e-6)) };
  }
  const crop = opaqueBox(picture);
  return crop && { picture, crop, aspect: clampAspect(crop.width / crop.height) };
}

function markerOf(slot, bytes, ownFile, outside = null) {
  const colour = markerColour(bytes, outside);
  if (colour === null) return null;
  const face = ownFile ? climbContract.CLIMB_MODELS[slot.id] : thinFace(bytes);
  if (!face) return null;
  const triangles = markerTriangles(bytes, face);
  if (triangles.length === 0) return null;
  const shape = markerShape(triangles, bytes);
  return shape && { slot, triangles, colour, ...shape };
}

/* Модель метки под именем с приставкой автора: `kifin_arrow.ydr`, `chief-hit.ydr` — слово слота в конце имени после `_` или `-`. */
const prefixedStem = (slotId) => new RegExp(`[_-]${slotId}$`);

/** Имя файла метки залазов: своё (`arrow.ydr`), псевдоним SPEX или с приставкой автора (`kifin_arrow.ydr`). */
export function isClimbMarkerName(name) {
  const stem = String(name || "").toLowerCase().replace(/\.ydr$/, "");
  if (stem === String(name || "").toLowerCase()) return false;
  return climbContract.CLIMB_SLOTS.some((slot) => stem === slot.id || stem === climbContract.CLIMB_FILE_ALIASES[slot.id] || prefixedStem(slot.id).test(stem));
}

/* Цвет словаря текстур для модели: одноимённый словарь (`kifin_car.ytd`), иначе общий словарь набора — единственный, что не назван ни одной моделью. */
function outsideColours(files) {
  const sheets = files.filter((file) => /\.ytd$/i.test(String(file.name || "")) && file.bytes);
  if (!sheets.length) return () => null;
  const stemOf = (file) => String(file.name).toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const models = new Set(files.filter((file) => /\.ydr$/i.test(String(file.name || ""))).map(stemOf));
  const cache = new Map();
  const colourOf = (sheet) => {
    if (!cache.has(sheet)) cache.set(sheet, attempt(() => sheetColour(sheet.bytes), null));
    return cache.get(sheet);
  };
  const shared = sheets.filter((sheet) => !models.has(stemOf(sheet)));
  return (stem) => {
    const own = sheets.find((sheet) => stemOf(sheet) === stem);
    return (own && colourOf(own)) || (shared.length === 1 ? colourOf(shared[0]) : null);
  };
}

export function climbMarkersOf(files) {
  // имя в нижнем регистре -> байты; при одинаковых именах побеждает последний файл
  const byName = new Map(files.map((file) => [String(file.name || "").toLowerCase(), file.bytes]));
  const outside = outsideColours(files);
  return climbContract.CLIMB_SLOTS.flatMap((slot) => {
    // файл «есть», только если у него истинные bytes
    const own = byName.get(`${slot.id}.ydr`);
    // псевдоним ищется всегда, когда своего файла нет (у слота без псевдонима — ключ «undefined.ydr»)
    const aliased = own ? null : byName.get(`${climbContract.CLIMB_FILE_ALIASES[slot.id]}.ydr`);
    // имя с приставкой автора (`kifin_arrow.ydr`): первое по алфавиту, лицо метки — по самой тонкой оси модели
    const tail = prefixedStem(slot.id);
    const prefixed = own || aliased ? null : [...byName.keys()].filter((name) => name.endsWith(".ydr") && tail.test(name.slice(0, -4))).sort()[0];
    const bytes = own || aliased || (prefixed ? byName.get(prefixed) : null);
    if (!bytes) return [];
    const stem = own ? slot.id : aliased ? climbContract.CLIMB_FILE_ALIASES[slot.id] : prefixed.slice(0, -4);
    // битая модель: этой метки просто нет
    const marker = attempt(() => markerOf(slot, bytes, Boolean(own), outside(stem)), null);
    return marker ? [marker] : [];
  });
}

const widthOfRow = (row) => row.reduce((sum, marker) => sum + marker.aspect, 0);

// До четырёх меток — один ряд; больше — два, разрез там, где самый широкий ряд уже всего.
function splitIntoRows(markers) {
  if (markers.length <= ROW_SPLIT_FROM) return [markers];
  const cuts = Array.from({ length: markers.length - 1 }, (_, at) => at + 1);
  const best = cuts.reduce(
    (found, cut) => {
      const widest = Math.max(widthOfRow(markers.slice(0, cut)), widthOfRow(markers.slice(cut)));
      return widest < found.width ? { cut, width: widest } : found;
    },
    { cut: 1, width: Infinity }
  );
  return [markers.slice(0, best.cut), markers.slice(best.cut)];
}

function silhouettePath(marker, cell) {
  const { minU, maxU, minV, maxV } = contourOf(marker.triangles);
  // порядок действий важен для последней цифры; защиты от деления на ноль нет (вырожденный контур даёт NaN)
  const scale = Math.min(cell.width / (maxU - minU), cell.height / (maxV - minV)) * MARK_FIT;
  const offsetX = cell.left + (cell.width - (maxU - minU) * scale) / 2;
  const offsetY = cell.top + (cell.height - (maxV - minV) * scale) / 2;
  const pointAt = ([u, v]) => `${(offsetX + (u - minU) * scale).toFixed(2)} ${(offsetY + (maxV - v) * scale).toFixed(2)}`;
  return marker.triangles.map((corners) => `M${corners.map(pointAt).join("L")}Z`).join("");
}

const hexOf = (colour) => `#${colour.map((part) => part.toString(16).padStart(2, "0")).join("")}`;

function silhouetteSvg(width, height, shapes) {
  const body = shapes
    .map(({ colour, d }) => {
      const hex = hexOf(colour);
      return `<path d="${d}" fill="${hex}" stroke="${hex}" stroke-width="0.6" stroke-linejoin="round"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

async function plateOverlay(marker, cell) {
  const { picture, crop } = marker;
  const scale = PICTURE_FIT * Math.min(cell.width / crop.width, cell.height / crop.height);
  const [fitWidth, fitHeight] = [crop.width, crop.height].map((side) => Math.max(1, Math.round(side * scale)));
  // вид на те же байты, без копирования
  const pixels = Buffer.from(picture.rgba.buffer, picture.rgba.byteOffset, picture.rgba.byteLength);
  const raw = { raw: { width: picture.width, height: picture.height, channels: 4 } };
  const input = await sharp(pixels, raw).extract(crop).resize(fitWidth, fitHeight).png().toBuffer();
  return {
    input,
    left: Math.round(cell.left + (cell.width - fitWidth) / 2),
    top: Math.round(cell.top + (cell.height - fitHeight) / 2),
  };
}

export async function climbCoverPng(files, { width = 1200, height = 800 } = {}) {
  const markers = climbMarkersOf(files);
  if (!markers.length) return null;

  const rows = splitIntoRows(markers);
  const rowHeight = (height * ROWS_SHARE) / rows.length;
  const cellHeight = Math.min(rowHeight, (width * CELL_SHARE) / Math.max(...rows.map(widthOfRow)));
  const blockTop = (height - cellHeight * rows.length) / 2;

  const placed = rows.flatMap((row, rowNo) => {
    let left = (width - cellHeight * widthOfRow(row)) / 2;
    return row.map((marker) => {
      const cell = { left, top: blockTop + rowNo * cellHeight, width: cellHeight * marker.aspect, height: cellHeight };
      left += cell.width;
      return { marker, cell };
    });
  });
  const plates = placed.filter(({ marker }) => marker.picture);
  const shapes = placed
    .filter(({ marker }) => !marker.picture)
    .map(({ marker, cell }) => ({ colour: marker.colour, d: silhouettePath(marker, cell) }));

  const overlays = [{ input: Buffer.from(silhouetteSvg(width, height, shapes)) }];
  for (const plate of plates) overlays.push(await plateOverlay(plate.marker, plate.cell));

  // матовое поле запрашивается последним, прямо перед итоговой сборкой
  const field = Buffer.from(matte.workshopMatteRgba(width, height).buffer);
  const png = await sharp(field, { raw: { width, height, channels: 4 } }).composite(overlays).png().toBuffer();
  return new Uint8Array(png);
}
