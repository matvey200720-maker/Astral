import { fetchEngineAsset } from "./engine-assets.js";

// ARS2 — модель «для видеочипа» из хранилища канала данных движка
// (раскладка: rage-res/src/gpu_asset.rs, PLAN.md «ARS2 — модель для GPU», 19.10.2026).
// В продукте загрузчик выключен флагом: на оружии он на 20 % медленнее GLB (решение 19.10.2026).
export const ARS2_FLAG_KEY = "astral.ars2.loader.v1";
const MAGIC = [0x41, 0x52, 0x53, 0x32]; // «ARS2»
const LIMITS = { vertices: 4e6, indices: 16e6 }; // индексов: 16e6 не кратно трём, годится 15 999 999
const INDEX_TYPES = ["u16", "u32"]; // ширина индекса: 2 << номер

const broken = (message) => Object.assign(Error(message), { code: "ENGINE_MODEL_BROKEN" });
function need(ok, message) {
  if (!ok) throw broken(message);
}
// Выполнить и молча отдать undefined, если бросило.
const quiet = (attempt) => {
  try {
    return attempt();
  } catch {
    return undefined;
  }
};
const up4 = (n) => (n + 3) & -4;
const within = (n, max = 4294967295) => Number.isInteger(n) && n === Math.min(Math.max(n, 0), max);
const triple = (v) => v instanceof Array && v.length === 3 && v.every(Number.isFinite);
const signOf = (v) => (v < 0 ? -1 : 1);
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

export function f16ToF32(half) {
  const bits = half & 0xffff;
  const exp = (bits >>> 10) & 0x1f;
  const sign = bits & 0x8000 ? -1 : 1;
  if (exp === 31) return bits & 0x3ff ? NaN : sign * Infinity;
  // Показатель 0 (ноль и субнормальные) даёт нулевое значение со знаком.
  return exp ? sign * 2 ** (exp - 15) * (1 + (bits & 0x3ff) / 1024) : sign * 0;
}

// Нормировка с защитой от нулевой длины (полуоси бывают сколь угодно малыми).
const unitOf = (v) => {
  const len = Math.max(Math.hypot(...v), Number.MIN_VALUE);
  return v.map((c) => c / len);
};

// Октаэдр: пара int8 -> единичный вектор; нижняя полусфера «складывается» к углам квадрата.
const octa = (a, b) => {
  const [x, y] = [a / 127, b / 127];
  const z = 1 - Math.abs(x) - Math.abs(y);
  return unitOf(z < 0 ? [(1 - Math.abs(y)) * signOf(x), (1 - Math.abs(x)) * signOf(y), z] : [x, y, z]);
};

// Окно на входные байты, если адрес выровнен под элемент; иначе копия (значения те же).
function view(Kind, bytes, offset, count) {
  const at = bytes.byteOffset + offset;
  if (at % Kind.BYTES_PER_ELEMENT === 0) return new Kind(bytes.buffer, at, count);
  return new Kind(new Uint8Array(bytes.buffer, at, count * Kind.BYTES_PER_ELEMENT).slice().buffer);
}

function readHeader(bytes) {
  need(bytes.length >= 12 && MAGIC.every((c, i) => bytes[i] === c), "Файл не ARS2.");
  const version = u32(bytes, 4);
  need(version === 1, `ARS2 версии ${version} не поддерживается.`);
  const length = u32(bytes, 8);
  need(12 + length <= bytes.length, "Заголовок ARS2 обрезан.");
  const header = quiet(() => JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length))));
  need(header !== undefined, "Заголовок ARS2 не JSON.");
  need(header && typeof header === "object", "Заголовок ARS2 не объект.");
  return [header, length];
}

// Партии и LOD: одинаковые записи { first, count, имя }; имя — name, иначе material, иначе "".
const nameOf = (entry) => entry.name ?? entry.material ?? "";
const spans = (entry, total) => within(entry?.first) && within(entry.count) && entry.first + entry.count <= total;

function ranges(list, label, total, key) {
  if (list === undefined) return [];
  need(Array.isArray(list), `${label} не список.`);
  return list.map((entry) => {
    need(spans(entry, total), `${label} выходит за индексы.`);
    need(typeof nameOf(entry) === "string", `${label} без имени.`);
    return { [key]: nameOf(entry), first: entry.first, count: entry.count };
  });
}

// Разбор и все проверки; порядок отказов — как в описании формата.
function parseArs2(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const [header, length] = readHeader(bytes);

  const { vertexCount: V, indexCount: n, indexType } = header;
  need(within(V, LIMITS.vertices) && within(n, LIMITS.indices) && n % 3 === 0, "Счётчики ARS2 вне пределов.");
  const kind = INDEX_TYPES.indexOf(indexType);
  need(kind >= 0, "В ARS2 неизвестный тип индексов.");
  const width = 2 << kind;

  // Начала блоков: позиции, нормали, UV, индексы и конец раскладки; каждый блок выровнен до четырёх.
  const [posAt, nrmAt, uvAt, idxAt, end] = [6 * V, 2 * V, 4 * V, width * n].reduce(
    (at, size) => [...at, at.at(-1) + up4(size)],
    [up4(12 + length)],
  );
  need(bytes.length >= end, "Модель ARS2 обрезана.");

  const { center, half } = header.bounds ?? {};
  need(triple(center) && triple(half), "В ARS2 нет рамки позиций.");
  need(half.every((h) => h > 0), "Полуось рамки ARS2 не положительна.");

  const batches = ranges(header.batches, "Партия ARS2", n, "material");
  const lods = ranges(header.lods, "LOD ARS2", n, "name");

  const indices = view([Uint16Array, Uint32Array][kind], bytes, idxAt, n);
  // 65535 в u16-буфере WebGL2 читается как перезапуск примитива.
  const stray = indices.findIndex((i) => i >= V || (width === 2 && i === 65535));
  if (stray >= 0) {
    throw broken(
      indices[stray] >= V
        ? "Индекс ARS2 смотрит мимо вершин."
        : "В ARS2 с u16-индексами стоит 65535: рестарт примитива в WebGL2.",
    );
  }

  const sections = {
    positions: view(Int16Array, bytes, posAt, 3 * V),
    normals: new Int8Array(bytes.buffer, bytes.byteOffset + nrmAt, 2 * V),
    uvs: view(Uint16Array, bytes, uvAt, 2 * V),
    indices,
  };
  // Ключи сразу в порядке результата decodeArs2Gpu; decodeArs2 берёт из них подмножество.
  return { vertexCount: V, indexCount: n, ...sections, center, half, batches, lods };
}

// Нормали по вершинам: shape превращает единичный вектор в то, что кладётся в out.
function fillNormals(out, stride, raw, shape = (unit) => unit) {
  for (let v = 0; 2 * v < raw.length; v++) out.set(shape(octa(raw[2 * v], raw[2 * v + 1])), v * stride);
  return out;
}

export const decodeArs2 = (input) => {
  const model = parseArs2(input);
  const { center, half } = model;
  const world = {
    positions: Float32Array.from(model.positions, (raw, i) => (raw / 32767) * half[i % 3] + center[i % 3]),
    normals: fillNormals(new Float32Array(3 * model.vertexCount), 3, model.normals),
    uvs: Float32Array.from(model.uvs, f16ToF32),
  };
  return Object.fromEntries(
    Object.entries(model)
      .filter(([key]) => key !== "center" && key !== "half")
      .map(([key, value]) => [key, world[key] ?? value]),
  );
};

// Для GPU нормали заранее умножены на полуоси рамки: нормальная матрица узла сцены масштаб рамки отменяет.
export const decodeArs2Gpu = (input) => {
  const model = parseArs2(input);
  const toBytes = (unit) => unitOf(unit.map((c, k) => c * model.half[k])).map((c) => Math.round(c * 127));
  return { ...model, normals: fillNormals(new Int8Array(4 * model.vertexCount), 4, model.normals, toBytes) };
};

export async function loadEngineModel(sha, options = {}) {
  const { signal, fetchImpl } = options;
  // Нет канала — не ошибка, а «берите прежний путь»; остальные отказы идут наружу.
  const fetched = await fetchEngineAsset(sha, { signal, fetchImpl }).then(
    (bytes) => [bytes],
    (err) => {
      if (err?.code === "ENGINE_ASSETS_UNAVAILABLE") return [];
      throw err;
    },
  );
  return fetched.length ? decodeArs2(fetched[0]) : null;
}

// Любая неисправность хранилища — «выключено»; сам доступ к localStorage стоит вне защиты.
const windowStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

export function ars2LoaderEnabled(storage = windowStorage()) {
  return quiet(() => storage.getItem(ARS2_FLAG_KEY)) === "1";
}

export async function loadEngineModelBehindFlag(sha, options = {}) {
  const { signal, fetchImpl, storage } = options;
  return ars2LoaderEnabled(storage) ? loadEngineModel(sha, { signal, fetchImpl }) : null;
}
