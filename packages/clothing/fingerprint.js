// Отпечаток вещи для поиска повторов: форма без порядка вершин, картинки устойчиво к пересжатию, габарит.

export const FINGERPRINT_ALGO = "clothing-v1";

const VERTEX_STEPS_PER_UNIT = 2000; // шаг полмиллиметра
const BOX_STEPS_PER_UNIT = 100;
const GRID_COLUMNS = 9;
const GRID_ROWS = 8;
const GEOMETRY_HEX_LENGTH = 32;
const VALUE_HEX_LENGTH = 40;
const IMAGE_HEX_LENGTH = 16;
const NO_COLOURS_DISTANCE = 64;

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Тройки подряд из positions всех сеток; неполная тройка добирается undefined.
function* triples(meshes) {
  for (const mesh of meshes) {
    const positions = mesh.positions;
    const count = positions.length;
    for (let at = 0; at < count; at += 3) yield [positions[at], positions[at + 1], positions[at + 2]];
  }
}

// Вычитание с NaN ложно: такая координата считается равной, сравнение идёт дальше.
function byAxes(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Знаковые 32-битные little-endian: лишние разряды заворачиваются, NaN пишется нулём.
function int32LittleEndian(values) {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return new Uint8Array(view.buffer);
}

export async function geometryHash(meshes) {
  const snapped = Array.from(triples(meshes || []), (vertex) =>
    vertex.map((value) => Math.round(value * VERTEX_STEPS_PER_UNIT)),
  );
  const hex = await sha256Hex(int32LittleEndian(snapped.sort(byAxes).flat()));
  return hex.slice(0, GEOMETRY_HEX_LENGTH);
}

// Границы клеток по одной оси; маленькая картинка повторяется: клетка не уже одной точки.
function cellSpans(size, count) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * size) / count);
    return [start, Math.max(Math.floor(((index + 1) * size) / count), start + 1)];
  });
}

function meanBrightness(rgba, width, [left, right], [top, bottom]) {
  let sum = 0;
  let points = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * width + x) * 4;
      sum += 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2];
      points += 1;
    }
  }
  return sum / points;
}

// Сетка 8 строк по 9 клеток; без размеров клеток нет, значения — NaN.
function brightnessGrid({ width, height, rgba }) {
  const columns = cellSpans(width, GRID_COLUMNS);
  return cellSpans(height, GRID_ROWS).map((rowSpan) =>
    columns.map((columnSpan) => meanBrightness(rgba, width, columnSpan, rowSpan)),
  );
}

// Бит на пару соседних клеток строки: «1», если левая строго ярче; первая пара — старший бит.
export function imageHash(picture) {
  const bits = brightnessGrid(picture)
    .flatMap((row) => row.slice(1).map((right, index) => (row[index] > right ? "1" : "0")))
    .join("");
  return BigInt(`0b${bits}`).toString(16).padStart(IMAGE_HEX_LENGTH, "0");
}

export function hammingHex(left, right) {
  const difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  return difference.toString(2).replaceAll("0", "").length;
}

// Габарит: минимум и максимум по осям; NaN проходит в итог, как его даёт Math.min/Math.max.
class Extent {
  low = [Infinity, Infinity, Infinity];
  high = [-Infinity, -Infinity, -Infinity];
  empty = true;

  include(vertex) {
    this.empty = false;
    this.low = this.low.map((value, axis) => Math.min(value, vertex[axis]));
    this.high = this.high.map((value, axis) => Math.max(value, vertex[axis]));
    return this;
  }

  toString() {
    if (this.empty) return "";
    return [...this.low, ...this.high].map((value) => Math.round(value * BOX_STEPS_PER_UNIT)).join(",");
  }
}

export async function clothingFingerprint({ meshes, pictures = [] }) {
  const list = [...(meshes || [])];
  const geometry = await geometryHash(list);
  const textures = pictures.map((picture) => [picture.letter, imageHash(picture)]);
  const vertexCount = list.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const extent = [...triples(list)].reduce((box, vertex) => box.include(vertex), new Extent());

  const distinct = [...new Set(textures.map(([, hash]) => hash))].sort().join(",");
  const value = await sha256Hex(new TextEncoder().encode(`${geometry}|${distinct}`));
  return {
    algo: FINGERPRINT_ALGO,
    value: value.slice(0, VALUE_HEX_LENGTH),
    parts: [
      `geom:${geometry}`,
      `v:${vertexCount}`,
      `box:${extent}`,
      ...textures.map(([letter, hash]) => `tex:${letter}:${hash}`),
    ],
  };
}

// Разобранный отпечаток: каждая часть — «вид:значение[:значение]», чужие виды пропускаются.
class PrintSheet {
  geometry = "";
  vertices = 0;
  box = [];
  hashes = [];

  static of(fingerprint) {
    const sheet = new PrintSheet();
    for (const part of fingerprint.parts || []) sheet.take(String(part).split(":"));
    return sheet;
  }

  take([kind, first, second]) {
    switch (kind) {
      case "geom":
        this.geometry = first;
        break;
      case "v":
        this.vertices = Number(first);
        break;
      case "box":
        this.box = first.split(",").map(Number);
        break;
      case "tex":
        this.hashes.push(second);
        break;
      default:
        break;
    }
  }
}

// Факты сравнения считаются по требованию и один раз: таблица решений смотрит их по порядку.
class Comparison {
  #nearest;

  constructor(left, right) {
    this.left = left;
    this.right = right;
  }

  get sameGeometry() {
    return Boolean(this.left.geometry) && this.left.geometry === this.right.geometry;
  }

  // Сперва расстояния, затем равенство количества.
  get coloursMatch() {
    const { left, right } = this;
    return (
      left.hashes.length > 0 &&
      left.hashes.every((mine) => right.hashes.some((theirs) => hammingHex(mine, theirs) <= 4)) &&
      left.hashes.length === right.hashes.length
    );
  }

  get sameShape() {
    const { left, right } = this;
    if (!left.vertices || !right.vertices) return false;
    const spread = Math.abs(left.vertices - right.vertices) / Math.max(left.vertices, right.vertices);
    return (
      spread < 0.02 &&
      left.box.length === 6 &&
      right.box.length === 6 &&
      left.box.every((value, axis) => Math.abs(value - right.box[axis]) <= 1)
    );
  }

  get nearest() {
    this.#nearest ??= Math.min(
      NO_COLOURS_DISTANCE,
      ...this.left.hashes.flatMap((mine) => this.right.hashes.map((theirs) => hammingHex(mine, theirs))),
    );
    return this.#nearest;
  }
}

const VERDICTS = [
  { when: (facts) => facts.sameGeometry && facts.coloursMatch, kind: "same", score: 0.97 },
  { when: (facts) => facts.sameGeometry, kind: "variant", score: 0.9 },
  { when: (facts) => facts.sameShape && facts.nearest <= 6, kind: "same", score: 0.9 },
  { when: (facts) => facts.sameShape, kind: "variant", score: 0.75 },
  { when: (facts) => facts.nearest <= 4, kind: "similar", score: 0.6 },
  { when: () => true, kind: "different", score: 0 },
];

export function compareFingerprints(left, right) {
  if (!left || !right) return { kind: "different", score: 0 };
  if (left.value && left.value === right.value) return { kind: "same", score: 1 };

  const facts = new Comparison(PrintSheet.of(left), PrintSheet.of(right));
  const { kind, score } = VERDICTS.find((verdict) => verdict.when(facts));
  return { kind, score };
}
