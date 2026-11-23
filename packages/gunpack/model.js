// Модель ствола для фотостудии и сборки GLB: выбор .ydr, очередь словарей
// текстур по старшинству, пометка вывернутых контурных оболочек (неоновой
// обводки) и раскодирование текстур 16 бит на канал.
import { decodeTextureRef, findTexture, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";

const MAX_TEXTURE = 1024;
const STUB_AREA = 16 * 16;
const HULL_RATIO = -0.02;
const BOX_SLACK = 0.05;
const TRIANGLE_SLACK = 0.25;
const AXES = [0, 1, 2];

function listOrEmpty(value, what) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new TypeError(`${what}: ожидался список.`);
  return value;
}

// ---------- оболочки ----------

// Слепок части: число треугольников, габаритный ящик и доля объёма от ящика.
// Знак доли говорит, наружу или внутрь смотрят грани.
function footprint(mesh) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  const triangles = indices ? indices.length / 3 : 0;
  const vertexCount = positions ? Math.floor(positions.length / 3) : 0;
  const shape = { triangles, ratio: 0, low: [], high: [], size: [] };
  if (vertexCount === 0 || !indices?.length) return shape;

  const sum = [0, 0, 0];
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vertexCount; v += 1) {
    for (const axis of AXES) {
      const x = positions[3 * v + axis];
      sum[axis] += x;
      low[axis] = Math.min(low[axis], x);
      high[axis] = Math.max(high[axis], x);
    }
  }
  const center = sum.map((s) => s / vertexCount);
  const size = AXES.map((axis) => high[axis] - low[axis]);
  Object.assign(shape, { low, high, size });

  const boxVolume = size[0] * size[1] * size[2];
  if (!(boxVolume > 0)) return shape;

  const corner = (index) => AXES.map((axis) => positions[3 * index + axis] - center[axis]);
  let volume = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [corner(indices[t]), corner(indices[t + 1]), corner(indices[t + 2])];
    const cross = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
    volume += (a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6;
  }
  shape.ratio = volume / boxVolume;
  return shape;
}

// Обычная часть, на которую похожа оболочка: того же размера и той же сетки.
function isTwin(hull, other) {
  if (!(other.ratio > 0)) return false;
  if (Math.abs(other.triangles - hull.triangles) > hull.triangles * TRIANGLE_SLACK) return false;
  return AXES.every((axis) => {
    const slack = Math.max(hull.size[axis], other.size[axis]) * BOX_SLACK;
    return Math.abs(hull.low[axis] - other.low[axis]) <= slack && Math.abs(hull.high[axis] - other.high[axis]) <= slack;
  });
}

export function invertedHulls(meshes) {
  const shapes = listOrEmpty(meshes, "Части модели").map(footprint);
  const hulls = [];
  shapes.forEach((shape, index) => {
    if (shape.ratio < HULL_RATIO && shapes.some((other, j) => j !== index && isTwin(shape, other))) hulls.push(index);
  });
  return hulls;
}

// ---------- встроенные текстуры ----------

const isRealTexture = (entry) => Number(entry?.width) * Number(entry?.height) > STUB_AREA;

export function realEmbedded(embedded) {
  return listOrEmpty(embedded, "Встроенные текстуры").filter(isRealTexture);
}

export function stubEmbedded(embedded) {
  return listOrEmpty(embedded, "Встроенные текстуры").filter((entry) => !isRealTexture(entry));
}

// ---------- текстуры 16 бит на канал ----------

// Код формата → байт на пиксель и запись одного пикселя в RGBA.
// Из 16-битного значения (младший байт первым) берётся старший байт.
const WIDE_FORMATS = new Map([
  [
    36, // A16B16G16R16: четыре канала в порядке хранения
    {
      bytes: 8,
      put(rgba, at, data, from) {
        for (let channel = 0; channel < 4; channel += 1) rgba[at + channel] = data[from + 2 * channel + 1];
      },
    },
  ],
  [
    81, // L16: яркость в три канала, альфа непрозрачна
    {
      bytes: 2,
      put(rgba, at, data, from) {
        const light = data[from + 1];
        rgba[at] = light;
        rgba[at + 1] = light;
        rgba[at + 2] = light;
        rgba[at + 3] = 255;
      },
    },
  ],
]);

const levelSide = (side, level) => Math.max(1, side >> level);

export function decodeWideTexture(entry, maxSize = MAX_TEXTURE) {
  const format = WIDE_FORMATS.get(entry?.formatCode);
  const data = entry?.resource?.data;
  if (!format || !data || !(entry.dataAt >= 0) || !(entry.levels >= 1)) return null;

  const dims = (level) => [levelSide(entry.width, level), levelSide(entry.height, level)];
  let level = 0;
  let skipped = 0;
  while (level < entry.levels - 1 && Math.max(...dims(level)) > maxSize) {
    const [w, h] = dims(level);
    skipped += w * h * format.bytes;
    level += 1;
  }
  const [width, height] = dims(level);
  const pixels = width * height;
  const start = entry.dataAt + skipped;
  if (start + pixels * format.bytes > data.length) return null;

  const rgba = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p += 1) format.put(rgba, p * 4, data, start + p * format.bytes);
  return { width, height, rgba };
}

// ---------- модель ствола ----------

function pickModel(files) {
  for (const role of ["model-hi", "model"]) {
    const file = files.find((f) => f.role === role);
    if (file) return file;
  }
  const byName = files.find((f) => typeof f.name === "string" && f.name.toLowerCase().endsWith(".ydr"));
  if (!byName) throw new Error("У ствола нет модели .ydr.");
  return byName;
}

function readDictionaries(files, role, options) {
  const dictionaries = [];
  for (const file of files) {
    if (file.role !== role) continue;
    try {
      dictionaries.push(readTextureDictionary(file.bytes, options));
    } catch {
      // битый словарь пропускается, остальные идут в очередь
    }
  }
  return dictionaries;
}

export function weaponModel(files, { inflateRaw, maxTexture = MAX_TEXTURE } = {}) {
  if (!Array.isArray(files)) throw new TypeError("Файлы ствола: ожидался список.");
  const modelFile = pickModel(files);
  const options = { inflateRaw };
  const hiDictionaries = readDictionaries(files, "texture-hi", options);
  const dictionaries = readDictionaries(files, "texture", options);

  const drawable = readDrawable(modelFile.bytes, options).drawables[0];
  if (!drawable) throw new Error("В модели нет ни одной части.");
  for (const index of invertedHulls(drawable.meshes)) drawable.meshes[index].invertedHull = true;

  // Старшинство: настоящие встроенные, словари hi, обычные словари, пустышки.
  const queue = [
    realEmbedded(drawable.embeddedTextures),
    ...hiDictionaries,
    ...dictionaries,
    stubEmbedded(drawable.embeddedTextures),
  ];

  const decode = (entry) => {
    try {
      return entry.format ? decodeTextureRef(entry, { maxSize: maxTexture }) : decodeWideTexture(entry, maxTexture);
    } catch {
      return null;
    }
  };

  const look = (name) => {
    const entry = findTexture(name, queue);
    if (!entry) return null;
    const image = decode(entry);
    return image ? { name: entry.name, width: image.width, height: image.height, rgba: image.rgba } : null;
  };

  // Кэш без учёта регистра; соседу уходит имя первого вызова как пришло.
  const cache = new Map();
  const texture = (name) => {
    if (!name) return null;
    const key = String(name).toLowerCase();
    if (!cache.has(key)) cache.set(key, look(name));
    return cache.get(key);
  };

  return { model: modelFile.name, drawable, texture };
}
