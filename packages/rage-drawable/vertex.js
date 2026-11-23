// Декларация вершины RAGE: маска семантик (16 бит) и 64-битные коды типов по 4 бита на семантику.
// Раскладка вершины, half float и чтение компонент из буфера.

export const SEMANTIC = Object.freeze({
  position: 0,
  blendWeights: 1,
  blendIndices: 2,
  normal: 3,
  colour0: 4,
  colour1: 5,
  uv0: 6,
  uv1: 7,
  tangent: 14,
});

export const TYPE = Object.freeze({
  half2: 1,
  float: 2,
  half4: 3,
  float2: 5,
  float3: 6,
  float4: 7,
  ubyte4: 8,
  colour: 9,
  rgba8snorm: 10,
});

const SEMANTIC_COUNT = 16;

// Размер семантики в байтах по коду типа; 0 (ничего), 4 (FloatUnk) и 11–15 места не занимают.
const SIZE_BY_CODE = [0, 4, 4, 8, 0, 8, 12, 16, 4, 4, 4, 0, 0, 0, 0, 0];

const TYPE_SHIFTS = Array.from({ length: SEMANTIC_COUNT }, (_, semantic) => BigInt(semantic * 4));

export function vertexLayout(flags, types) {
  const mask = flags >>> 0;
  const layout = new Map();
  let stride = 0;
  for (let semantic = 0; semantic < SEMANTIC_COUNT; semantic++) {
    if (((mask >>> semantic) & 1) === 0) continue;
    const type = Number((types >> TYPE_SHIFTS[semantic]) & 0xfn);
    const size = SIZE_BY_CODE[type];
    layout.set(semantic, { offset: stride, type, size });
    stride += size;
  }
  return { layout, stride };
}

const DENORMAL_SCALE = 2 ** -14;

export function halfToFloat(bits) {
  const half = bits & 0xffff;
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >>> 10) & 0x1f;
  const fraction = half & 0x3ff;
  if (exponent === 0) return sign * DENORMAL_SCALE * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

// Чтение одной компоненты: ширина в байтах и функция над DataView.
const FLOAT32 = { width: 4, read: (view, at) => view.getFloat32(at, true) };
const HALF = { width: 2, read: (view, at) => halfToFloat(view.getUint16(at, true)) };
const UNORM8 = { width: 1, read: (view, at) => view.getUint8(at) / 255 };
const SNORM8 = { width: 1, read: (view, at) => Math.max(-1, view.getInt8(at) / 127) };

const COMPONENT_READERS = new Map([
  [TYPE.half2, HALF],
  [TYPE.float, FLOAT32],
  [TYPE.half4, HALF],
  [TYPE.float2, FLOAT32],
  [TYPE.float3, FLOAT32],
  [TYPE.float4, FLOAT32],
  [TYPE.ubyte4, UNORM8],
  [TYPE.colour, UNORM8],
  [TYPE.rgba8snorm, SNORM8],
]);

// Читает ровно `count` компонент подряд, сколько бы их ни было у типа; неизвестный тип — false.
export function readComponents(view, at, type, out, outAt, count) {
  const reader = COMPONENT_READERS.get(type);
  if (!reader) return false;
  const { width, read } = reader;
  for (let i = 0; i < count; i++) out[outAt + i] = read(view, at + i * width);
  return true;
}
