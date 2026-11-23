/*
 * Чтение своей модели `.glb` без three.js — для своей модели ствола и своих
 * моделей на стволе (задача 6 ТЗ 17.10.2026).
 *
 * Окно показывает GLB загрузчиком three.js, а в игру модель собирает Astral
 * Desktop — и обе стороны должны увидеть одни и те же треугольники. Здесь —
 * то же, что делает загрузчик: сцена по умолчанию, узлы с матрицами или
 * переносом/поворотом/масштабом, примитивы-треугольники (полосы и веера
 * разворачиваются), позиции, нормали, развёртка `TEXCOORD_0`, материал с
 * цветом и картинкой цвета. Кости и морфы не применяются: модель — в позе,
 * в которой её сохранили (как её и рисует загрузчик без анимации).
 *
 * Чего нет и что сказано словами: сжатие Draco и meshopt (их надо снять при
 * экспорте), внешние файлы рядом с моделью (в `.glb` всё должно быть
 * внутри). Модуль — чистые данные: его читают окно, главный процесс и тесты.
 */

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENTS = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 });
const COMPRESSED = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression"]);

/*
 * Пределы разбора против чужого файла (проверка границ доверия, ТЗ 17.10).
 * Файл в сотни байт может объявить аксессор на десятки миллионов точек или
 * граф узлов, где у каждого уровня два одинаковых потомка: без этих пределов
 * разбор держал гигабайты памяти или не заканчивался. Пределы считаются по
 * ОБЪЯВЛЕННОМУ в файле, до выделения памяти и до обхода.
 */
/* Аксессор без буфера (нули) и sparse: данных в файле нет, нулей — не больше. */
const MAX_ZERO_VALUES = 2_000_000;
/* Заходов в узлы за разбор: повтор потомка без цикла иначе даёт 2^глубина. */
export const GLB_MAX_NODE_VISITS = 20_000;

/* Свойство самой таблицы, а не прототипа (`constructor`, `toString` из файла). */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** Отказ разбора: `code` — для окна, текст — человеку. */
export function glbRefusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const utf8 = (bytes) => new TextDecoder().decode(bytes);

function base64Bytes(text) {
  if (typeof Buffer !== "undefined") {
    const buffer = Buffer.from(text, "base64");
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Разбор контейнера GLB: `{ json, bin }`. */
export function splitGlb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20) throw glbRefusal("GLB_FORMAT", "Это не модель .glb: файл слишком короткий.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw glbRefusal("GLB_FORMAT", "Это не модель .glb (нет подписи glTF). Сохрани модель как «glTF Binary (.glb)».");
  if (view.getUint32(4, true) !== 2) throw glbRefusal("GLB_VERSION", "Модель .glb старой версии glTF 1 — пересохрани её как glTF 2.");
  const total = Math.min(view.getUint32(8, true), bytes.byteLength);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > total) throw glbRefusal("GLB_FORMAT", "Файл .glb обрезан — модель не дописана до конца.");
    if (type === JSON_CHUNK && !json) json = JSON.parse(utf8(bytes.subarray(start, start + length)));
    else if (type === BIN_CHUNK && !bin) bin = bytes.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json || typeof json !== "object") throw glbRefusal("GLB_FORMAT", "В файле .glb нет описания сцены.");
  if (!/^2\./.test(String(json.asset?.version || ""))) throw glbRefusal("GLB_VERSION", "Модель не glTF 2 — пересохрани её как glTF Binary (.glb).");
  const required = (json.extensionsRequired || []).filter((name) => COMPRESSED.has(name));
  if (required.length)
    throw glbRefusal("GLB_COMPRESSED", `Модель сжата (${required.join(", ")}) — сохрани .glb без сжатия: в Blender сними галочку «Compression».`);
  return { json, bin };
}

/* Байты буфера: свой кусок GLB или встроенный base64; внешний файл — отказ. */
function bufferBytes(json, bin, index) {
  const buffer = json.buffers?.[index];
  if (!buffer) throw glbRefusal("GLB_FORMAT", "Модель ссылается на буфер, которого нет.");
  if (buffer.uri === undefined) {
    if (!bin) throw glbRefusal("GLB_FORMAT", "У модели нет двоичной части с геометрией.");
    return bin;
  }
  const match = /^data:[^,]*;base64,(.*)$/s.exec(String(buffer.uri));
  if (!match) throw glbRefusal("GLB_EXTERNAL", "Модель ссылается на внешний файл рядом с собой — сохрани её одним файлом .glb.");
  return base64Bytes(match[1]);
}

function viewBytes(json, bin, cache, index) {
  if (cache.has(index)) return cache.get(index);
  const view = json.bufferViews?.[index];
  if (!view) throw glbRefusal("GLB_FORMAT", "Модель ссылается на кусок буфера, которого нет.");
  const buffer = bufferBytes(json, bin, view.buffer ?? 0);
  const start = Number(view.byteOffset || 0);
  const length = Number(view.byteLength || 0);
  const stride = Number(view.byteStride || 0);
  if (![start, length, stride].every((value) => Number.isInteger(value) && value >= 0))
    throw glbRefusal("GLB_FORMAT", "Кусок буфера модели описан неверно (отрицательные или дробные размеры).");
  if (start + length > buffer.byteLength) throw glbRefusal("GLB_FORMAT", "Кусок буфера модели выходит за его край.");
  const result = { bytes: buffer.subarray(start, start + length), stride };
  cache.set(index, result);
  return result;
}

const READERS = {
  5120: [1, (v, o) => v.getInt8(o), 127],
  5121: [1, (v, o) => v.getUint8(o), 255],
  5122: [2, (v, o) => v.getInt16(o, true), 32767],
  5123: [2, (v, o) => v.getUint16(o, true), 65535],
  5125: [4, (v, o) => v.getUint32(o, true), 4294967295],
  5126: [4, (v, o) => v.getFloat32(o, true), 1],
};

/** Слишком тяжёлая модель: отказ с кодом `GLB_TOO_HEAVY` (текст — для окна и главного процесса). */
export function glbTooHeavy(maxTriangles) {
  return glbRefusal(
    "GLB_TOO_HEAVY",
    `В модели больше ${maxTriangles.toLocaleString("ru-RU")} треугольников — такую Astral не упрощает: игра на ней упадёт, а упрощение заняло бы слишком долго. Упрости модель в Blender (Decimate) и принеси снова.`,
  );
}

/**
 * Значения аксессора плоским массивом чисел (с учётом `normalized` и `sparse`).
 * `maxValues` — сколько чисел вправе дать этот аксессор (`count × компонент`);
 * объявленное в файле проверяется ДО выделения массива, как и то, что данные
 * лежат внутри буфера.
 */
export function readAccessor(json, bin, index, cache = new Map(), { maxValues = Infinity } = {}) {
  const accessor = json.accessors?.[index];
  if (!accessor) throw glbRefusal("GLB_FORMAT", "Модель ссылается на данные, которых нет.");
  const reader = own(READERS, accessor.componentType);
  const size = own(COMPONENTS, accessor.type);
  if (!reader || !size) throw glbRefusal("GLB_FORMAT", "У модели данные неизвестного вида.");
  const [bytesPer, read, max] = reader;
  const count = accessor.count >>> 0;
  if (count > 50_000_000) throw glbRefusal("GLB_LARGE", "В модели десятки миллионов точек — это не модель оружия.");
  if (count * size > maxValues) throw glbRefusal("GLB_LARGE", "В модели данных больше, чем нужно её треугольникам, — файл повреждён или это не модель оружия.");
  const scale = accessor.normalized && accessor.componentType !== 5126 ? max : 1;
  const signed = accessor.componentType === 5120 || accessor.componentType === 5122;
  let view = null;
  let step = 0;
  let base = 0;
  if (accessor.bufferView !== undefined) {
    const { bytes, stride } = viewBytes(json, bin, cache, accessor.bufferView);
    step = stride || bytesPer * size;
    base = Number(accessor.byteOffset || 0);
    if (!Number.isInteger(base) || base < 0 || step < bytesPer * size)
      throw glbRefusal("GLB_FORMAT", "Данные модели описаны неверно (смещение или шаг).");
    if (count && base + (count - 1) * step + bytesPer * size > bytes.byteLength)
      throw glbRefusal("GLB_FORMAT", "Данные модели выходят за край буфера.");
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } else if (count * size > MAX_ZERO_VALUES) {
    /* Без буфера и без нулей по делу: объявлено много, а самих данных в файле нет. */
    throw glbRefusal("GLB_FORMAT", "У модели объявлены данные на сотни тысяч точек, но самих данных в файле нет — файл повреждён.");
  }
  const out = new Float64Array(count * size);
  if (view)
    for (let item = 0; item < count; item += 1)
      for (let k = 0; k < size; k += 1) {
        let value = read(view, base + item * step + k * bytesPer);
        if (scale !== 1) value = signed ? Math.max(value / scale, -1) : value / scale;
        out[item * size + k] = value;
      }
  if (accessor.sparse) {
    const { count: changed, indices, values } = accessor.sparse;
    const indexReader = own(READERS, indices?.componentType);
    if (!indexReader || !values || !Number.isInteger(changed) || changed < 0 || changed > count)
      throw glbRefusal("GLB_FORMAT", "Разреженные данные модели описаны неверно.");
    const at = viewBytes(json, bin, cache, indices.bufferView);
    const val = viewBytes(json, bin, cache, values.bufferView);
    if (
      Number(indices.byteOffset || 0) + changed * indexReader[0] > at.bytes.byteLength ||
      Number(values.byteOffset || 0) + changed * size * bytesPer > val.bytes.byteLength
    )
      throw glbRefusal("GLB_FORMAT", "Разреженные данные модели выходят за край буфера.");
    const iv = new DataView(at.bytes.buffer, at.bytes.byteOffset, at.bytes.byteLength);
    const vv = new DataView(val.bytes.buffer, val.bytes.byteOffset, val.bytes.byteLength);
    for (let item = 0; item < changed; item += 1) {
      const target = indexReader[1](iv, (indices.byteOffset || 0) + item * indexReader[0]);
      if (target >= count) continue;
      for (let k = 0; k < size; k += 1) {
        let value = read(vv, (values.byteOffset || 0) + (item * size + k) * bytesPer);
        if (scale !== 1) value = signed ? Math.max(value / scale, -1) : value / scale;
        out[target * size + k] = value;
      }
    }
  }
  return out;
}

/* --------------------------- матрицы узлов --------------------------- */

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Матрица 4×4 по столбцам (как в glTF): `a × b`. */
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  return out;
}

/** Матрица из переноса, кватерниона и масштаба (по столбцам). */
export function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const nodeMatrix = (node) =>
  Array.isArray(node.matrix) && node.matrix.length === 16 ? node.matrix.map(Number) : compose(node.translation, node.rotation, node.scale);

/* Нормали — обратной транспонированной частью 3×3 матрицы узла. */
function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  const inv = det || 1;
  /* (A⁻¹)ᵀ = cof(A) / det. */
  return [
    (a[4] * a[8] - a[5] * a[7]) / inv, (a[6] * a[5] - a[3] * a[8]) / inv, (a[3] * a[7] - a[6] * a[4]) / inv,
    (a[7] * a[2] - a[1] * a[8]) / inv, (a[0] * a[8] - a[6] * a[2]) / inv, (a[6] * a[1] - a[0] * a[7]) / inv,
    (a[1] * a[5] - a[4] * a[2]) / inv, (a[3] * a[2] - a[0] * a[5]) / inv, (a[0] * a[4] - a[3] * a[1]) / inv,
  ];
}

/* ------------------------------ сцена ------------------------------ */

/*
 * Треугольники примитива: списком, полосой или веером. Число треугольников
 * известно по объявленному (`total`) ДО сборки: больше `budget` — отказ, а
 * полоса и веер пишутся сразу в `Uint32Array` нужной длины, без списка на
 * миллионы чисел.
 */
function triangleIndices(mode, indices, count, { budget = Infinity, refuse = () => new Error("GLB_TOO_HEAVY") } = {}) {
  const at = (k) => (indices ? indices[k] : k);
  const total = indices ? indices.length : count;
  const triangles = mode === 4 || mode === undefined ? Math.floor(total / 3) : Math.max(0, total - 2);
  if (triangles > budget) throw refuse();
  const out = new Uint32Array(triangles * 3);
  if (mode === 4 || mode === undefined) {
    for (let k = 0; k < out.length; k += 1) out[k] = at(k);
  } else if (mode === 5) {
    for (let k = 0; k < triangles; k += 1) {
      const first = k % 2 ? k + 1 : k;
      const second = k % 2 ? k : k + 1;
      out[k * 3] = at(first);
      out[k * 3 + 1] = at(second);
      out[k * 3 + 2] = at(k + 2);
    }
  } else if (mode === 6) {
    for (let k = 1; k <= triangles; k += 1) {
      out[(k - 1) * 3] = at(0);
      out[(k - 1) * 3 + 1] = at(k);
      out[(k - 1) * 3 + 2] = at(k + 1);
    }
  }
  return out;
}

/* Картинка цвета материала: байты и вид (PNG, JPEG, WebP). */
function imageOf(json, bin, cache, textureIndex) {
  const texture = json.textures?.[textureIndex];
  if (!texture) return null;
  const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.extensions?.KHR_texture_basisu?.source;
  const image = json.images?.[source];
  if (!image) return null;
  if (image.bufferView !== undefined) return { index: source, mimeType: String(image.mimeType || ""), bytes: viewBytes(json, bin, cache, image.bufferView).bytes };
  const match = /^data:([^;,]*)[^,]*;base64,(.*)$/s.exec(String(image.uri || ""));
  if (match) return { index: source, mimeType: match[1], bytes: base64Bytes(match[2]) };
  throw glbRefusal("GLB_EXTERNAL", "Картинка модели лежит отдельным файлом — сохрани модель одним .glb с картинками внутри.");
}

/**
 * Модель из `.glb`: сетки в осях сцены (матрицы узлов применены), материалы
 * и картинки. `{ meshes: [{ positions, normals|null, uvs|null, indices,
 * material }], materials: [{ name, colour: [r,g,b,a], image, alpha,
 * cutoff }], images: [{ mimeType, bytes }], stats }`. `material` у сетки —
 * номер в `materials` (у примитива без материала — свой серый).
 */
export function readGlb(input, { maxTriangles = Infinity } = {}) {
  const { json, bin } = splitGlb(input);
  const cache = new Map();
  const materials = [];
  const images = [];
  const imageIndex = new Map();
  const materialIndex = new Map();
  const materialFor = (index) => {
    const key = Number.isInteger(index) && json.materials?.[index] ? index : -1;
    if (materialIndex.has(key)) return materialIndex.get(key);
    const source = key >= 0 ? json.materials[key] : {};
    const pbr = source.pbrMetallicRoughness || {};
    const gloss = source.extensions?.KHR_materials_pbrSpecularGlossiness;
    const factor = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : Array.isArray(gloss?.diffuseFactor) ? gloss.diffuseFactor : [1, 1, 1, 1];
    const textureIndex = pbr.baseColorTexture?.index ?? gloss?.diffuseTexture?.index;
    let image = null;
    if (Number.isInteger(textureIndex)) {
      const found = imageOf(json, bin, cache, textureIndex);
      if (found) {
        if (!imageIndex.has(found.index)) {
          imageIndex.set(found.index, images.length);
          images.push({ mimeType: found.mimeType, bytes: found.bytes });
        }
        image = imageIndex.get(found.index);
      }
    }
    const alphaMode = String(source.alphaMode || "OPAQUE").toUpperCase();
    const entry = {
      name: String(source.name || (key >= 0 ? `material_${key}` : "default")).slice(0, 64),
      colour: [0, 1, 2, 3].map((k) => Math.min(1, Math.max(0, Number(factor[k] ?? 1)))),
      image,
      alpha: alphaMode === "BLEND" ? "blend" : alphaMode === "MASK" ? "mask" : "opaque",
      cutoff: Number.isFinite(Number(source.alphaCutoff)) ? Number(source.alphaCutoff) : 0.5,
    };
    materialIndex.set(key, materials.length);
    materials.push(entry);
    return materials.length - 1;
  };

  const meshes = [];
  let triangles = 0;
  let vertices = 0;
  /* Точек во всех сетках вместе — не больше трёх на треугольник предела: иначе
     большой аксессор с парой индексов читался бы заново при каждом заходе. */
  const vertexBudget = maxTriangles * 3;
  let visits = 0;
  const declared = (accessorIndex) => json.accessors?.[accessorIndex]?.count >>> 0;
  const sameCount = (accessorIndex, type, count) => json.accessors?.[accessorIndex]?.type === type && declared(accessorIndex) === count;
  const visit = (nodeIndex, parent, depth) => {
    visits += 1;
    if (visits > GLB_MAX_NODE_VISITS)
      throw glbRefusal(
        "GLB_FORMAT",
        `Узлы модели повторяются слишком много раз (больше ${GLB_MAX_NODE_VISITS.toLocaleString("ru-RU")} заходов) — объедини объекты или сделай копии настоящими (в Blender — Object → Apply → Make Instances Real).`,
      );
    if (depth > 64) throw glbRefusal("GLB_FORMAT", "Узлы модели вложены слишком глубоко.");
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    const mesh = Number.isInteger(node.mesh) ? json.meshes?.[node.mesh] : null;
    for (const primitive of mesh?.primitives || []) {
      const mode = primitive.mode ?? 4;
      if (![4, 5, 6].includes(mode) || primitive.attributes?.POSITION === undefined) continue;
      if (json.accessors?.[primitive.attributes.POSITION]?.type !== "VEC3") throw glbRefusal("GLB_FORMAT", "Точки модели записаны не тройками координат.");
      /* Объявленное в файле — до чтения: точек больше предела, индексов больше бюджета — отказ без выделения памяти. */
      if (vertices + declared(primitive.attributes.POSITION) > vertexBudget) throw glbTooHeavy(maxTriangles);
      const budget = maxTriangles - triangles;
      if (primitive.indices !== undefined && declared(primitive.indices) > budget * 3 + 2) throw glbTooHeavy(maxTriangles);
      const raw = readAccessor(json, bin, primitive.attributes.POSITION, cache);
      const count = raw.length / 3;
      const indices = triangleIndices(mode, primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices, cache) : null, count, {
        budget,
        refuse: () => glbTooHeavy(maxTriangles),
      });
      for (let k = 0; k < indices.length; k += 1) if (indices[k] >= count) throw glbRefusal("GLB_FORMAT", "Треугольник модели смотрит в точку, которой нет.");
      triangles += indices.length / 3;
      vertices += count;
      if (triangles > maxTriangles) throw glbTooHeavy(maxTriangles);
      const positions = new Float32Array(count * 3);
      for (let k = 0; k < count; k += 1) {
        const x = raw[k * 3];
        const y = raw[k * 3 + 1];
        const z = raw[k * 3 + 2];
        positions[k * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
        positions[k * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
        positions[k * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
      }
      let normals = null;
      if (primitive.attributes.NORMAL !== undefined && sameCount(primitive.attributes.NORMAL, "VEC3", count)) {
        const n = readAccessor(json, bin, primitive.attributes.NORMAL, cache, { maxValues: count * 3 });
        const m = normalMatrix(world);
        normals = new Float32Array(count * 3);
        for (let k = 0; k < count; k += 1) {
          const x = m[0] * n[k * 3] + m[3] * n[k * 3 + 1] + m[6] * n[k * 3 + 2];
          const y = m[1] * n[k * 3] + m[4] * n[k * 3 + 1] + m[7] * n[k * 3 + 2];
          const z = m[2] * n[k * 3] + m[5] * n[k * 3 + 1] + m[8] * n[k * 3 + 2];
          const length = Math.hypot(x, y, z) || 1;
          normals[k * 3] = x / length;
          normals[k * 3 + 1] = y / length;
          normals[k * 3 + 2] = z / length;
        }
      }
      const uvs =
        primitive.attributes.TEXCOORD_0 !== undefined && sameCount(primitive.attributes.TEXCOORD_0, "VEC2", count)
          ? Float32Array.from(readAccessor(json, bin, primitive.attributes.TEXCOORD_0, cache, { maxValues: count * 2 }))
          : null;
      /* Зеркальная матрица узла выворачивает треугольники — как загрузчик, разворачиваем обратно. */
      const det =
        world[0] * (world[5] * world[10] - world[6] * world[9]) -
        world[4] * (world[1] * world[10] - world[2] * world[9]) +
        world[8] * (world[1] * world[6] - world[2] * world[5]);
      if (det < 0) for (let k = 0; k + 2 < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
      meshes.push({ positions, normals, uvs: uvs && uvs.length === count * 2 ? uvs : null, indices, material: materialFor(primitive.material) });
    }
    for (const child of node.children || []) visit(child, world, depth + 1);
  };
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? (json.nodes || []).map((_, index) => index);
  for (const root of roots) visit(root, IDENTITY, 0);
  if (!meshes.length) throw glbRefusal("GLB_EMPTY", "В модели нет ни одного треугольника.");
  return {
    meshes,
    materials,
    images,
    stats: { meshes: meshes.length, materials: materials.length, images: images.length, vertices, triangles },
  };
}
