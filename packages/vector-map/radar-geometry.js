// Геометрия штатной карты: роли цветов радара, разбор плиток, двоичный вид «AMG1» и раскладка атласа.

export const RADAR_ROLES = Object.freeze("water land blocks paths freeway roads rail".split(" "));
export const RADAR_GEOMETRY_VERSION = 1;

/* --- двоичные поля: таблицы «имя, тип» и курсор --- */

const FORMAT = { magic: 0x31474d41, maxGroups: 256, maxVertices: 4000000 };

const TYPES = {
  u8: { size: 1, read: (view, at) => view.getUint8(at), write: (view, at, value) => view.setUint8(at, value) },
  u32: { size: 4, read: (view, at) => view.getUint32(at, true), write: (view, at, value) => view.setUint32(at, value, true) },
  f32: { size: 4, read: (view, at) => view.getFloat32(at, true), write: (view, at, value) => view.setFloat32(at, value, true) },
};

const FILE_FIELDS = [
  ["magic", "u32"],
  ["version", "u32"],
  ["groups", "u32"],
];

// Три нулевых байта выравнивания — обычные поля, которым ничего не передают.
const GROUP_FIELDS = [
  ["role", "u8"],
  ["depth", "u8"],
  ["red", "u8"],
  ["green", "u8"],
  ["blue", "u8"],
  ["pad0", "u8"],
  ["pad1", "u8"],
  ["pad2", "u8"],
  ["vertices", "u32"],
];

const schemaSize = (schema) => schema.reduce((total, [, type]) => total + TYPES[type].size, 0);
const FILE_SIZE = schemaSize(FILE_FIELDS);
const GROUP_SIZE = schemaSize(GROUP_FIELDS);

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

/* --- роль цвета --- */

// Серые цвета: первая строка, чей предел не меньше серости; выше всех — рельсы.
const GREY_LIMITS = [
  [48, "land"],
  [80, "blocks"],
  [112, "paths"],
  [138, "freeway"],
  [200, "roads"],
];

const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];
const clamp = (low, high, value) => Math.min(Math.max(value, low), high);

const waterDepth = (channels) => {
  const [red, green, blue] = channels.map((value, i) => value * LUMA_WEIGHTS[i]);
  const luminance = (red + green + blue) / 255;
  return clamp(0, 1, (0.86 - luminance) / (0.86 - 0.28));
};

const greyRole = (channels) => {
  const grey = channels.reduce((sum, value) => sum + value) / 3;
  const row = GREY_LIMITS.find(([limit]) => grey <= limit);
  return row ? row[1] : "rail";
};

export const classifyRadarColour = (red, green, blue, height = 0) => {
  const channels = [red, green, blue];
  const spread = Math.max(...channels) - Math.min(...channels);
  const isWater = height < -1 || spread > 4;
  return isWater ? { role: "water", depth: waterDepth(channels) } : { role: greyRole(channels), depth: 0 };
};

/* --- разбор плиток --- */

const listOf = (value) => value || [];

const attempt = (job) => {
  try {
    return { value: job() };
  } catch (error) {
    return { error };
  }
};

// Читает плитки по одной: следующая читается, когда потребитель закончил с предыдущей.
function* readModels(list, load) {
  for (const file of list) yield { file, outcome: attempt(() => load(file.bytes)) };
}

// Треугольники всех пригодных мешей модели: вершины идут тройками, неполный хвост отбрасывается.
function* trianglesOf(model) {
  for (const drawable of listOf(model.drawables)) {
    for (const { positions, colours, indices } of listOf(drawable.meshes)) {
      if (!positions || !indices) continue;
      const whole = Math.floor(indices.length / 3);
      for (let n = 0; n < whole; n += 1) {
        yield { positions, colours, corners: [indices[n * 3], indices[n * 3 + 1], indices[n * 3 + 2]] };
      }
    }
  }
}

const hexByte = (value) => {
  const digits = value.toString(16);
  return digits.length < 2 ? `0${digits}` : digits;
};

const colourByte = (value) => hexByte(Math.round(clamp(0, 255, value)));

const fetchOrCreate = (store, key, make) => store.get(key) ?? store.set(key, make()).get(key);

const compareBy = (...keys) => (a, b) => keys.reduce((verdict, key) => verdict || key(a) - key(b), 0);

// Точка плоскости: X как есть, Y — минус глубина.
const planarPoint = (positions, vertex) => {
  const base = vertex * 3;
  return [positions[base], 0 - positions[base + 2]];
};

// Цвет первой вершины в байтовой шкале без округления; без массива цветов — белый.
const vertexRgb = (colours, vertex) =>
  colours ? [0, 1, 2].map((k) => colours[vertex * 4 + k] * 255) : [255, 255, 255];

export const parseRadarTiles = (files, { readDrawable, inflateRaw }) => {
  const buckets = new Map();
  const tally = { tiles: 0, triangles: 0 };
  const load = (bytes) => readDrawable(bytes, { inflateRaw, kind: "ydd" });

  for (const { outcome } of readModels(Array.isArray(files) ? files : [], load)) {
    if ("error" in outcome) continue;
    tally.tiles += 1;
    for (const { positions, colours, corners } of trianglesOf(outcome.value)) {
      const first = corners[0];
      const rgb = vertexRgb(colours, first);
      const { role, depth } = classifyRadarColour(...rgb, positions[first * 3 + 1]);
      const color = `#${rgb.map(colourByte).join("")}`;
      const bucket = fetchOrCreate(buckets, [role, color].join("|"), () => ({ role, depth, color, points: [] }));
      bucket.points.push(...corners.flatMap((vertex) => planarPoint(positions, vertex)));
      tally.triangles += 1;
    }
  }

  const groups = [...buckets.values()]
    .sort(compareBy((group) => RADAR_ROLES.indexOf(group.role), (group) => group.depth))
    .map(({ role, depth, color, points }) => ({ role, depth, color, positions: new Float32Array(points) }));
  return { groups, triangles: tally.triangles, tiles: tally.tiles };
};

/* --- двоичный вид «AMG1» --- */

export const encodeRadarGeometry = (geometry) => {
  const groups = [...(geometry?.groups || [])];
  const size = FILE_SIZE + groups.map((group) => GROUP_SIZE + 4 * group.positions.length).reduce((a, b) => a + b, 0);
  const cursor = new Cursor(new Uint8Array(size));
  writeRecord(cursor, FILE_FIELDS, { magic: FORMAT.magic, version: RADAR_GEOMETRY_VERSION, groups: groups.length });

  for (const { role, depth, color, positions } of groups) {
    // Цвет читается одним шестнадцатеричным числом без первого знака; каналы — его байты.
    const packed = parseInt(String(color).slice(1), 16) || 0;
    writeRecord(cursor, GROUP_FIELDS, {
      role: Math.max(0, RADAR_ROLES.indexOf(role)),
      depth: Math.round((depth || 0) * 255),
      red: packed >> 16,
      green: packed >> 8,
      blue: packed,
      vertices: positions.length / 2,
    });
    for (const value of positions) cursor.put("f32", value);
  }
  return cursor.bytes;
};

const asView = (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
};

export const decodeRadarGeometry = (input) => {
  const bytes = asView(input);
  if (!bytes || bytes.length < FILE_SIZE) return null;
  const cursor = new Cursor(bytes);
  const head = readRecord(cursor, FILE_FIELDS);
  const accepted = head.magic === FORMAT.magic && head.version === RADAR_GEOMETRY_VERSION && head.groups <= FORMAT.maxGroups;
  if (!accepted) return null;

  const groups = [];
  let vertexTotal = 0;
  for (let remaining = head.groups; remaining > 0; remaining -= 1) {
    if (cursor.left() < GROUP_SIZE) return null;
    const entry = readRecord(cursor, GROUP_FIELDS);
    const role = RADAR_ROLES[entry.role];
    vertexTotal += entry.vertices;
    if (!role || entry.vertices % 3 !== 0 || vertexTotal > FORMAT.maxVertices) return null;
    if (cursor.left() < 8 * entry.vertices) return null;
    groups.push({
      role,
      depth: entry.depth / 255,
      color: `#${[entry.red, entry.green, entry.blue].map(hexByte).join("")}`,
      positions: Float32Array.from({ length: 2 * entry.vertices }, () => cursor.get("f32")),
    });
  }
  return { groups, triangles: vertexTotal / 3 };
};

/* --- атлас карты паузы --- */

// Окна из четырёх float32 big-endian подряд с шагом в четыре байта.
function* atlasCandidates(bytes) {
  const { buffer, byteOffset, byteLength } = bytes;
  const view = new DataView(buffer, byteOffset, byteLength);
  const windows = Math.floor((bytes.length - 12) / 4);
  for (let n = 0; n < windows; n += 1) {
    yield Array.from({ length: 4 }, (_, i) => view.getFloat32((n + i) * 4, false));
  }
}

const withinReach = (value) => Number.isFinite(value) && Math.abs(value) <= 20000;

const atlasBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  return input ? new Uint8Array(input) : null;
};

export const readMinimapAtlas = (input) => {
  const bytes = atlasBytes(input);
  if (!bytes || bytes.length < 16) return null;
  for (const [tileUnits, repeat, originX, originY] of atlasCandidates(bytes)) {
    const sideFits = tileUnits >= 1000 && tileUnits <= 20000 && repeat === tileUnits;
    const originFits = [originX, originY].every(withinReach) && originX < 0 && originY > 0;
    if (sideFits && originFits) return { tileUnits, originX, originY };
  }
  return null;
};
