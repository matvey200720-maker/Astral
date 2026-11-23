import { packColorOverrides } from "./pack-colors.js";
import { paintTerrain, terrainStyle } from "./terrain.js";
import { viewWindow, visiblePath } from "./triangle-window.js";

// Геометрия векторных паков: группы «высота + цвет + прозрачность», двоичный вид «APG1», рисование и перевод в роли радара.

const APG = { magic: 0x31475041 };
const KIND = { kind: "pack" };
const ATLAS_X = { origin: -4600, span: 10000 };
const ATLAS_Y = { origin: -5600, span: 14500 };
const AXES = [ATLAS_X, ATLAS_Y];

// Границы полос высоты: ниже первой — вода, ниже второй — суша, ниже третьей — кварталы.
const EDGES = { water: -1, land: 5.5, blocks: 11.5 };
const VIEW_MARGIN_PIXELS = 12;
const FALLBACK_LAND = "#1d1d1d";

/* --- двоичные поля: таблицы «имя, тип» и курсор --- */

const TYPES = {
  u8: { size: 1, read: (view, at) => view.getUint8(at), write: (view, at, value) => view.setUint8(at, value) },
  u16: { size: 2, read: (view, at) => view.getUint16(at, true), write: (view, at, value) => view.setUint16(at, value, true) },
  u32: { size: 4, read: (view, at) => view.getUint32(at, true), write: (view, at, value) => view.setUint32(at, value, true) },
  f32: { size: 4, read: (view, at) => view.getFloat32(at, true), write: (view, at, value) => view.setFloat32(at, value, true) },
};

const FILE_FIELDS = [
  ["magic", "u32"],
  ["groups", "u32"],
];

const GROUP_FIELDS = [
  ["red", "u8"],
  ["green", "u8"],
  ["blue", "u8"],
  ["alpha", "u8"],
  ["height", "f32"],
  ["vertices", "u32"],
];

const schemaSize = (schema) => schema.reduce((total, [, type]) => total + TYPES[type].size, 0);
const FILE_SIZE = schemaSize(FILE_FIELDS);
const GROUP_SIZE = schemaSize(GROUP_FIELDS);
const VERTEX_SIZE = 2 * TYPES.u16.size;

class Cursor {
  constructor(bytes) {
    const { buffer, byteOffset, byteLength } = bytes;
    this.bytes = bytes;
    this.view = new DataView(buffer, byteOffset, byteLength);
    this.at = 0;
  }

  left() {
    return this.bytes.length - this.at;
  }

  get(type) {
    const { size, read } = TYPES[type];
    const value = read(this.view, this.at);
    this.at += size;
    return value;
  }

  put(type, value) {
    const { size, write } = TYPES[type];
    write(this.view, this.at, value);
    this.at += size;
  }
}

const readRecord = (cursor, schema) => {
  const record = {};
  for (const [name, type] of schema) record[name] = cursor.get(type);
  return record;
};

const writeRecord = (cursor, schema, record) => {
  for (const [name, type] of schema) cursor.put(type, record[name]);
};

/* --- общие мелочи --- */

const clamp = (low, high, value) => Math.min(Math.max(value, low), high);

const hexByte = (value) => {
  const digits = value.toString(16);
  return digits.length < 2 ? `0${digits}` : digits;
};

const compareBy = (...keys) => (a, b) => keys.reduce((verdict, key) => verdict || key(a) - key(b), 0);

const fetchOrCreate = (store, key, make) => store.get(key) ?? store.set(key, make()).get(key);

const attempt = (job) => {
  try {
    return { value: job() };
  } catch (error) {
    return { error };
  }
};

const listOf = (value) => value || [];

// Начала шагов по списку длины length: 0, step, 2·step, … пока шаг помещается целиком.
const strides = (length, step) => Array.from({ length: Math.floor(length / step) }, (_, n) => n * step);

/* --- разбор плиток --- */

// Читает плитки по одной: следующая читается, когда потребитель закончил с предыдущей.
function* readModels(list, load) {
  for (const file of list) yield { file, outcome: attempt(() => load(file.bytes)) };
}

// Треугольники всех пригодных мешей модели: вершины идут тройками, неполный хвост отбрасывается.
function* trianglesOf(model) {
  for (const drawable of listOf(model.drawables)) {
    for (const { positions, colours, indices } of listOf(drawable.meshes)) {
      if (!positions || !indices) continue;
      for (const at of strides(indices.length, 3)) {
        yield { positions, colours, corners: [indices[at], indices[at + 1], indices[at + 2]] };
      }
    }
  }
}

// Цвет первой вершины в байтовой шкале без округления и её непрозрачность; без массива цветов — белый, непрозрачный.
const vertexColour = (colours, vertex) =>
  colours
    ? { rgb: [0, 1, 2].map((k) => colours[vertex * 4 + k] * 255), alpha: colours[vertex * 4 + 3] }
    : { rgb: [255, 255, 255], alpha: 1 };

const colourByte = (value) => hexByte(Math.round(clamp(0, 255, value)));

// Точка плоскости: X как есть, Y — минус глубина.
const planarPoint = (positions, vertex) => {
  const base = vertex * 3;
  return [positions[base], 0 - positions[base + 2]];
};

const describeTriangle = ({ positions, colours, corners }) => {
  const first = corners[0];
  const { rgb, alpha } = vertexColour(colours, first);
  if (alpha <= 0.004) return null;
  const tenths = Math.round(positions[first * 3 + 1] * 10);
  return {
    height: tenths / 10,
    color: `#${rgb.map(colourByte).join("")}`,
    step: Math.round(alpha * 255),
    points: corners.flatMap((vertex) => planarPoint(positions, vertex)),
  };
};

export const parsePackGeometry = (files, { readDrawable, inflateRaw }) => {
  const buckets = new Map();
  const skipped = [];
  const tally = { tiles: 0, triangles: 0 };
  const load = (bytes) => readDrawable(bytes, { inflateRaw, kind: "ydd" });

  for (const { file, outcome } of readModels(Array.isArray(files) ? files : [], load)) {
    if ("error" in outcome) {
      const { error } = outcome;
      skipped.push({ name: String(file.name || ""), reason: String(error?.message || error) });
      continue;
    }
    tally.tiles += 1;
    for (const triangle of trianglesOf(outcome.value)) {
      const seen = describeTriangle(triangle);
      if (!seen) continue;
      const bucket = fetchOrCreate(buckets, [seen.height, seen.color, seen.step].join("|"), () => ({
        color: seen.color,
        alpha: seen.step / 255,
        height: seen.height,
        order: buckets.size,
        points: [],
      }));
      bucket.points.push(...seen.points);
      tally.triangles += 1;
    }
  }

  const groups = [...buckets]
    .map(([, bucket]) => bucket)
    .sort(compareBy((group) => group.height, (group) => group.order))
    .map(({ color, alpha, height, points }) => ({ color, alpha, height, positions: new Float32Array(points) }));
  return { ...KIND, groups, triangles: tally.triangles, tiles: tally.tiles, skipped };
};

/* --- двоичный вид «APG1» --- */

// Координата атласа в 16 бит: вычесть начало, поделить на размах, умножить на 65535, округлить, зажать.
const toCode = (value, axis) => {
  const share = (value - axis.origin) / axis.span;
  return clamp(0, 65535, Math.round(share * 65535));
};
const fromCode = (code, axis) => (code / 65535) * axis.span + axis.origin;

const sumOf = (items, measure) => {
  let total = 0;
  for (const item of items) total += measure(item);
  return total;
};

export const encodePackGeometry = (geometry) => {
  const groups = [...(geometry?.groups || [])];
  const size = FILE_SIZE + sumOf(groups, (group) => GROUP_SIZE + (group.positions.length / 2) * VERTEX_SIZE);
  const cursor = new Cursor(new Uint8Array(size));
  writeRecord(cursor, FILE_FIELDS, { magic: APG.magic, groups: groups.length });

  for (const { color, alpha, height, positions } of groups) {
    const groupStart = cursor.at;
    const text = String(color || "#000000");
    const [red, green, blue] = [1, 3, 5].map((from) => parseInt(text.slice(from, from + 2), 16));
    writeRecord(cursor, GROUP_FIELDS, {
      red,
      green,
      blue,
      alpha: Math.round((alpha ?? 1) * 255),
      height: height || 0,
      vertices: positions.length / 2,
    });
    // пары координат, включая неполную последнюю (её вторая половина — NaN)
    for (const i of strides(positions.length + 1, 2)) {
      AXES.forEach((axis, k) => cursor.put("u16", toCode(positions[i + k], axis)));
    }
    cursor.at = groupStart + GROUP_SIZE + (positions.length / 2) * VERTEX_SIZE;
  }
  return cursor.bytes;
};

function bytesFrom(input) {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input || 0);
}

export const decodePackGeometry = (input) => {
  const bytes = bytesFrom(input);
  if (bytes.length < FILE_SIZE) return null;
  const cursor = new Cursor(bytes);
  const head = readRecord(cursor, FILE_FIELDS);
  if (head.magic !== APG.magic) return null;

  const groups = [];
  let triangles = 0;
  for (let remaining = head.groups; remaining > 0; remaining -= 1) {
    if (cursor.left() < GROUP_SIZE) return null;
    const { red, green, blue, alpha, height, vertices } = readRecord(cursor, GROUP_FIELDS);
    if (cursor.left() < vertices * VERTEX_SIZE) return null;
    const positions = Float32Array.from({ length: vertices * 2 }, (_, i) => fromCode(cursor.get("u16"), AXES[i % 2]));
    groups.push({ color: `#${[red, green, blue].map(hexByte).join("")}`, alpha: alpha / 255, height, positions });
    triangles += vertices / 3;
  }
  return { ...KIND, groups, triangles, tiles: 0 };
};

/* --- перевод в геометрию радара --- */

const ROLE_ORDER = "water land blocks paths freeway roads rail".split(" ");
const pairsOf = (text) => new Map(text.split(" ").map((pair) => pair.split("=")));
const GAME_ROLE_COLORS = pairsOf("land=#1d1d1d blocks=#414141 paths=#636363 freeway=#828282 roads=#b4b4b4 rail=#dcdcdc");
const PACK_ROAD_ROLES = pairsOf("#fff7c5=freeway #a97b52=paths #65595a=rail");
const WATER_SHALLOW = [215, 221, 224];
const WATER_DEEP = [61, 79, 85];
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];

const SIX_HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

const lightnessOf = (color) => {
  const match = SIX_HEX.exec(String(color || ""));
  if (!match) return 0;
  const parts = match.slice(1).map((pair, i) => (parseInt(pair, 16) / 255) * LUMA_WEIGHTS[i]);
  return parts[0] + parts[1] + parts[2];
};

// Роль группы: по высоте, а выше кварталов — по цвету дорог пака.
const roleOf = ({ height, color }) => {
  if (height < EDGES.water) return "water";
  if (height < EDGES.land) return "land";
  if (height < EDGES.blocks) return "blocks";
  return PACK_ROAD_ROLES.get(String(color).toLowerCase()) ?? "roads";
};

// Самая светлая и самая тёмная вода: от них считается глубина.
const waterSpan = (groups) => {
  const lights = groups.flatMap((group) => (group.height < EDGES.water ? [lightnessOf(group.color)] : []));
  return { shallow: Math.max(0, ...lights), deep: Math.min(1, ...lights) };
};

const classifyGroup = (group, { shallow, deep }) => {
  const role = roleOf(group);
  if (role !== "water" || !(shallow > deep)) return { role, depth: 0 };
  const share = (shallow - lightnessOf(group.color)) / (shallow - deep);
  return { role, depth: Math.round(share * 1000) / 1000 };
};

const waterColor = (depth) =>
  `#${WATER_SHALLOW.map((shallow, i) => hexByte(Math.round((WATER_DEEP[i] - shallow) * depth + shallow))).join("")}`;

function joinFloats(parts) {
  const joined = new Float32Array(sumOf(parts, (part) => part.length));
  parts.reduce((offset, part) => {
    joined.set(part, offset);
    return offset + part.length;
  }, 0);
  return joined;
}

export const packRadarGeometry = (geometry) => {
  const listed = geometry?.groups;
  const groups = Array.isArray(listed) ? listed : [];
  const span = waterSpan(groups);

  const slots = new Map();
  for (const group of groups) {
    const { role, depth } = classifyGroup(group, span);
    const color = role === "water" ? waterColor(depth) : GAME_ROLE_COLORS.get(role);
    fetchOrCreate(slots, `${role}:${depth}`, () => ({ role, depth, color, parts: [] })).parts.push(group.positions);
  }

  const result = [...slots.values()]
    .sort(compareBy((slot) => ROLE_ORDER.indexOf(slot.role), (slot) => slot.depth))
    .map(({ role, depth, color, parts }) => ({ role, depth, color, positions: joinFloats(parts) }));
  let triangles = 0;
  result.forEach((group) => {
    triangles += group.positions.length / 6;
  });
  return { groups: result, triangles, tiles: 0, bundled: true };
};

/* --- рисование --- */

// Рисунок описывается данными: [метод, ...аргументы]; свойства канвы задаёт assign в порядке ключей.
const play = (context, steps) => steps.forEach(([method, ...args]) => context[method](...args));

const assign = (context, props) => {
  for (const [name, value] of Object.entries(props)) context[name] = value;
};

// save … restore вокруг тела; при исключении restore не зовётся.
const withState = (context, body) => {
  context.save();
  body();
  context.restore();
};

// Контур треугольника как таблица команд: [метод пути, буква SVG, смещения координат от начала треугольника].
const OUTLINE = [
  ["moveTo", "M", [0, 1]],
  ["lineTo", "L", [2, 3]],
  ["lineTo", "L", [4, 5]],
  ["closePath", "Z", []],
];

// Память: путь группы (вместе со способом построения) и путь всей суши пака.
const groupPaths = new WeakMap();
const landPaths = new WeakMap();

const plainPath = () => new Path2D();

function buildGroupPath(positions, factory) {
  const starts = strides(positions.length, 6);
  const coordsAt = (start, offsets) => offsets.map((offset) => positions[start + offset]);
  if (!factory) {
    const svg = starts.flatMap((start) => OUTLINE.map(([, letter, offsets]) => letter + coordsAt(start, offsets).join(" ")));
    return new Path2D(svg.join(""));
  }
  const path = factory();
  for (const start of starts) OUTLINE.forEach(([method, , offsets]) => path[method](...coordsAt(start, offsets)));
  return path;
}

const pathOfGroup = (group, factory) => fetchOrCreate(groupPaths, group, () => buildGroupPath(group.positions, factory));

const inLandBand = ({ height }) => height >= EDGES.water && height < EDGES.land;

function landPathOf(geometry, factory, createPath) {
  const known = landPaths.get(geometry);
  if (known) return known;
  const lands = [...geometry.groups].filter(inLandBand);
  if (!lands.length) return null;
  const path = createPath();
  lands.forEach((group) => path.addPath(pathOfGroup(group, factory)));
  landPaths.set(geometry, path);
  return path;
}

// Цвет суши пака для рельефа: самая длинная по positions группа полосы суши (при равенстве — первая).
function landColourOf(geometry, overrides) {
  const biggest = [...geometry.groups]
    .filter(inLandBand)
    .reduce((best, group) => (best && !(group.positions.length > best.positions.length) ? best : group), null);
  if (!biggest) return FALLBACK_LAND;
  return overrides?.get(biggest) || biggest.color;
}

export const paintPackGeometry = (context, geometry, options) => {
  const { world, width, height } = options;
  const factory = options.createPath;
  const createPath = factory ? factory : plainPath;
  const run = world.x1 - world.x0;
  const scale = width / run;
  const pixel = 1 / scale;
  const { base } = options;

  withState(context, () => {
    play(context, [
      ["clearRect", 0, 0, width, height],
      ["setTransform", scale, 0, 0, -scale, -world.x0 * scale, world.y0 * scale],
    ]);

    const overrides = packColorOverrides(geometry, base);
    const landColour = landColourOf(geometry, overrides);
    const terrain = terrainStyle(base, landColour);
    const view = options.cull !== false ? viewWindow(world, VIEW_MARGIN_PIXELS / scale) : null;
    const waterHidden = Array.isArray(base?.hidden) && base.hidden.includes("water");

    let reliefPending = true;
    const paintRelief = () => {
      reliefPending = false;
      const land = landPathOf(geometry, factory, createPath);
      if (!land) return;
      withState(context, () => {
        assign(context, { globalAlpha: 1 });
        context.clip(land);
        paintTerrain(context, terrain, { createPath, pixel });
      });
    };

    for (const group of geometry.groups) {
      if (waterHidden && group.height < EDGES.water) continue;
      if (reliefPending && terrain && group.height >= EDGES.land) paintRelief();
      assign(context, { globalAlpha: group.alpha ?? 1, fillStyle: overrides?.get(group) || group.color });
      const visible = view && visiblePath([group], view, createPath);
      context.fill(visible ? visible.path : pathOfGroup(group, factory));
    }
    if (reliefPending && terrain) paintRelief();
  });
};
