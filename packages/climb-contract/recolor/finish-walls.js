// Деление поверхности на стены, проекция картинки на стену и файл «разметки стен» сцены кадра.

export const FINISH_WALL_SURFACES = Object.freeze(['walls', 'floor', 'ceiling']);
export const FINISH_WALL_TIE = 0.001;
export const FINISH_WALL_WELD = 0.0005;
export const FINISH_WALL_SIDE = 0.5;

const MIN_FACE_HEIGHT = 0.0001;
const NORMAL_TRUST = 0.5;
const UNSHOWN_SHADERS = ['emissive', 'glass', 'alpha', 'additive', 'decal', 'cutout'];
const MAP_SIGNATURE = 'AFW1';
const MAP_PREAMBLE = 8;
const WALL_NUMBERS = 7;
const AXES = [0, 1, 2];

// ---------- Векторы и группы ----------

const minus = (to, from) => to.map((value, axis) => value - from[axis]);
const dot = (a, b) => AXES.map((axis) => a[axis] * b[axis]).reduce((sum, term) => sum + term);
const cross = (a, b) => AXES.map((axis) => a[(axis + 1) % 3] * b[(axis + 2) % 3] - a[(axis + 2) % 3] * b[(axis + 1) % 3]);
const norm = (vector) => Math.hypot(...vector);
const indexes = (length) => Array.from({ length }, (_, at) => at);
const vertexAt = (points, index) => AXES.map((axis) => points[index * 3 + axis]);

// Корень группы; пройденный путь потом сжимается до корня.
function rootOf(parent, start) {
  const path = [];
  let node = start;
  while (parent[node] !== node) {
    path.push(node);
    node = parent[node];
  }
  path.forEach((visited) => {
    parent[visited] = node;
  });
  return node;
}

function join(parent, left, right) {
  const leftRoot = rootOf(parent, left);
  parent[rootOf(parent, right)] = leftRoot;
}

// ---------- Поверхности и признаки материала ----------

export function arenaSurfaceProjected(server, surface, item) {
  return [server === 'majestic', FINISH_WALL_SURFACES.includes(surface), item?.mode === 'image'].every(Boolean);
}

export function finishWallShader(shader) {
  const name = String(shader || '').toLowerCase();
  return !UNSHOWN_SHADERS.some((word) => name.includes(word));
}

export function finishWallMaterial(info) {
  if (!info) return false;
  const lit = ['emissive', 'decal'].some((flag) => info[flag]);
  return !lit && (info.alpha || 'opaque') === 'opaque';
}

// ---------- Класс грани ----------

export function finishFaceClass(normal) {
  const magnitudes = AXES.map((axis) => Math.abs(normal[axis]));
  const threshold = Math.max(...magnitudes) - FINISH_WALL_TIE;
  const axis = [2, 0].find((candidate) => magnitudes[candidate] >= threshold) ?? 1;
  return axis * 2 + (normal[axis] < 0 ? 1 : 0);
}

export function finishClassNormal(cls) {
  return Object.assign([0, 0, 0], { [cls >> 1]: cls & 1 ? -1 : 1 });
}

// ---------- Деление на стены ----------

const NEIGHBOURS = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dz) => [dx, dy, dz])));

// Для каждой вершины — корень её группы: точки ближе FINISH_WALL_WELD считаются одной (транзитивно).
function weldedVertices(points, count) {
  const parent = Int32Array.from(indexes(count));
  const buckets = new Map();
  indexes(count).forEach((index) => {
    const here = vertexAt(points, index);
    if (!here.every(Number.isFinite)) return;
    const cell = here.map((value) => Math.floor(value / FINISH_WALL_WELD));
    NEIGHBOURS
      .flatMap((step) => buckets.get(cell.map((part, axis) => part + step[axis]).join(',')) ?? [])
      .filter((other) => norm(minus(here, vertexAt(points, other))) < FINISH_WALL_WELD)
      .forEach((other) => join(parent, other, index));
    const home = cell.join(',');
    if (!buckets.has(home)) buckets.set(home, []);
    buckets.get(home).push(index);
  });
  return Int32Array.from(parent, (_, index) => rootOf(parent, index));
}

// Записанные нормали вершин берутся, если их сумма заметной длины и смотрит туда же, куда обход.
function faceDirection(winding, normals, face) {
  const recorded = normals ?? null;
  if (recorded === null) return winding;
  const sum = AXES.map((axis) => [0, 1, 2].reduce((total, corner) => total + Number(recorded[face * 9 + corner * 3 + axis]), 0));
  return dot(sum, winding) > 0 && norm(sum) > NORMAL_TRUST ? sum : winding;
}

// Класс грани или -1, если грань не годится в стены (вершины совпали после сварки или грань слишком тонкая).
function classOfFace(points, normals, welded, face) {
  const roots = AXES.map((corner) => welded[face * 3 + corner]);
  if (new Set(roots).size < 3) return -1;
  const [a, b, c] = roots.map((_, corner) => vertexAt(points, face * 3 + corner));
  const winding = cross(minus(b, a), minus(c, a));
  const longest = Math.max(...[[b, a], [c, a], [c, b]].map(([to, from]) => norm(minus(to, from))));
  if (!(norm(winding) / longest >= MIN_FACE_HEIGHT)) return -1;
  const direction = faceDirection(winding, normals, face);
  return finishFaceClass(direction.map((part) => part / norm(direction)));
}

// Три ребра грани как числа: класс и пара сваренных вершин, порядок вершин не важен.
function edgeKeys(welded, face, cls, span) {
  return AXES.map((corner) => {
    const from = welded[face * 3 + corner];
    const to = welded[face * 3 + ((corner + 1) % 3)];
    return (cls * span + Math.min(from, to)) * span + Math.max(from, to);
  });
}

export function finishWalls(points, normals = null) {
  const faceCount = Math.floor(points.length / 9);
  const welded = weldedVertices(points, faceCount * 3);
  const classes = indexes(faceCount).map((face) => classOfFace(points, normals, welded, face));

  // Грани одного класса с общим ребром склеиваются в одну стену.
  const together = Int32Array.from(indexes(faceCount));
  const firstOnEdge = new Map();
  classes.forEach((cls, face) => {
    if (cls < 0) return;
    edgeKeys(welded, face, cls, faceCount * 3).forEach((edge) => {
      if (firstOnEdge.has(edge)) join(together, firstOnEdge.get(edge), face);
      else firstOnEdge.set(edge, face);
    });
  });

  // Стены нумеруются по первой грани; рамка — по исходным вершинам всех граней стены.
  const roots = classes.map((cls, face) => (cls < 0 ? -1 : rootOf(together, face)));
  const order = [...new Set(roots.filter((root) => root >= 0))];
  const slot = new Map(order.map((root, at) => [root, at]));
  const members = order.map(() => []);
  const wallOf = Int32Array.from(roots, (root) => slot.get(root) ?? -1);
  wallOf.forEach((wall, face) => {
    if (wall >= 0) members[wall].push(face);
  });
  const walls = members.map((faceList) => {
    const corners = faceList.flatMap((face) => AXES.map((corner) => vertexAt(points, face * 3 + corner)));
    const reach = (pick, start) => corners.reduce((best, corner) => best.map((value, axis) => pick(value, corner[axis])), start);
    return {
      cls: classes[faceList[0]],
      min: reach(Math.min, [Infinity, Infinity, Infinity]),
      max: reach(Math.max, [-Infinity, -Infinity, -Infinity]),
    };
  });
  return { walls, wallOf };
}

export function finishWallShown(wall) {
  const wallAxis = wall.cls >> 1;
  const extents = AXES.map((axis) => (axis === wallAxis ? Infinity : wall.max[axis] - wall.min[axis]));
  return Math.min(...extents) >= FINISH_WALL_SIDE;
}

// ---------- Из сцены кадра в оси модели ----------

export function finishWallsModelPoints(points, place, { normals = false } = {}) {
  const [qx, qy, qz, qw] = place.rotation;
  const shift = normals ? [0, 0, 0] : [...place.position];
  const [planeScale, heightScale] = normals ? [1, 1] : (place.scale ?? [1, 1]);
  const divisors = [planeScale, planeScale, heightScale];
  const turnAxis = [-qx, -qy, -qz];

  const toModel = (vector) => {
    const lever = cross(turnAxis, vector).map((part) => part * 2);
    const side = cross(turnAxis, lever);
    return vector.map((part, axis) => (part + qw * lever[axis] + side[axis]) / divisors[axis]);
  };

  const result = new Float64Array(points.length);
  indexes(Math.floor(points.length / 3)).forEach((triple) => {
    result.set(toModel(minus(vertexAt(points, triple), shift)), triple * 3);
  });
  return result;
}

// ---------- Проекция картинки на стену ----------

// Для каждой оси стены: какая ось идёт по ширине, какая по высоте и при каком «минусе» ширина считается с другого края.
const WALL_LAYOUTS = new Map([
  [2, { across: 0, upward: 1, reversedWhen: () => false }],
  [0, { across: 1, upward: 2, reversedWhen: (mirrored) => mirrored }],
]);
const SIDE_LAYOUT = { across: 0, upward: 2, reversedWhen: (mirrored) => !mirrored };

export function finishWallCoords(point, cls, box) {
  const { across, upward, reversedWhen } = WALL_LAYOUTS.get(cls >> 1) ?? SIDE_LAYOUT;
  const extent = (axis) => Math.max(box.max[axis] - box.min[axis], 0.001);
  const offset = (axis) => point[axis] - box.min[axis];
  const first = reversedWhen((cls & 1) === 1) ? extent(across) - offset(across) : offset(across);
  return [first, offset(upward), extent(across), extent(upward)];
}

export function finishWallUv([s, t, width, height], metres = 0, aspect = 1) {
  return metres > 0
    ? [s / metres, 1 - (t * aspect) / metres]
    : [s / width, 1 - t / height];
}

export function finishWallTile(metres, aspect = 1) {
  return metres > 0 ? [metres, metres / (aspect > 0 ? aspect : 1)] : null;
}

// ---------- Файл разметки стен ----------

export function encodeFinishWallsMap({ scene, groups, meshes, walls, faces }) {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify({ version: 1, scene, groups, meshes }));
  const headerSize = Math.ceil(headerBytes.length / 4) * 4;
  const wallValues = new Float32Array(walls.length * WALL_NUMBERS);
  walls.forEach((wall, at) => wallValues.set([wall.cls, ...wall.min, ...wall.max], at * WALL_NUMBERS));
  const faceValues = faces.flatMap((mesh) => Array.from(mesh));

  const head = new Uint8Array(MAP_PREAMBLE + headerSize).fill(0x20);
  head.set(encoder.encode(MAP_SIGNATURE));
  new DataView(head.buffer).setUint32(4, headerSize, true);
  head.set(headerBytes, MAP_PREAMBLE);

  const faceStart = wallValues.length * 4;
  const body = new DataView(new ArrayBuffer(faceStart + faceValues.length * 2));
  wallValues.forEach((value, at) => body.setFloat32(at * 4, value, true));
  faceValues.forEach((value, at) => body.setUint16(faceStart + at * 2, value, true));

  const bytes = new Uint8Array(head.length + body.byteLength);
  bytes.set(head);
  bytes.set(new Uint8Array(body.buffer), head.length);
  return bytes;
}

export function decodeFinishWallsMap(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const signed = [...MAP_SIGNATURE].every((letter, at) => data[at] === letter.charCodeAt(0));
  if (data.length < MAP_PREAMBLE || !signed) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(MAP_PREAMBLE, MAP_PREAMBLE + headerSize)));

  let cursor = MAP_PREAMBLE + headerSize;
  const read = (count, width, getter) => Array.from({ length: count }, () => {
    const value = getter.call(view, cursor, true);
    cursor += width;
    return value;
  });

  const wallTotal = header.groups.map((group) => group.count).reduce((sum, count) => sum + count, 0);
  const walls = new Float32Array(wallTotal * WALL_NUMBERS);
  walls.set(read(walls.length, 4, DataView.prototype.getFloat32));

  const meshes = new Map([...header.meshes].map(([number, group, count]) => {
    const faces = new Uint16Array(count);
    faces.set(read(faces.length, 2, DataView.prototype.getUint16));
    return [number, { group, faces }];
  }));
  return { scene: header.scene, groups: header.groups, meshes, walls };
}
