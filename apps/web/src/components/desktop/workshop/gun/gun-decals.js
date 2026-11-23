import * as THREE from "three";

/* ============================================================ малая арифметика */

/* Скалярные помощники горячих циклов: числа на входе и на выходе, память не выделяется. */
const dot3 = (ax, ay, az, bx, by, bz) => ax * bx + ay * by + az * bz;
const cross2 = (a, b, c, d) => a * d - c * b;
const outside01 = (value) => value < 0 || value > 1;

/* Сумма одной компоненты по трём вершинам треугольника, слева направо. */
const vertexSum = (array, at) => array[at] + array[at + VERTEX_STEP] + array[at + 2 * VERTEX_STEP];

/* Те же действия над тройками-массивами: только для редких вызовов (ближайшая точка на треугольнике). */
const subv = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const slidev = (origin, direction, k) => [origin[0] - k * direction[0], origin[1] - k * direction[1], origin[2] - k * direction[2]];
const cornerv = (values, at) => [values[at], values[at + 1], values[at + 2]];
const vec3 = ({ x, y, z }) => [x, y, z];

const arrayOf = (geometry, name) => geometry?.attributes?.[name]?.array;

function unitCross(a, b) {
  const product = new THREE.Vector3();
  product.crossVectors(a, b);
  return product.normalize();
}

/* a·cos + b·sin покомпонентно: сначала произведение с первым множителем, потом со вторым. */
function spin(a, b, angle) {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return new THREE.Vector3(...AXES.map((axis) => a[axis] * cos + b[axis] * sin));
}

function pickUp(normal, hint) {
  if (hint) return hint;
  return Math.abs(normal.y) > STEEP_NORMAL_Y ? WORLD_X : WORLD_Y;
}

/* ====================================================================== запекатель */

class DecalBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera();
    Object.assign(this.camera, { near: 0, far: 1 });
    this.camera.updateProjectionMatrix();
    this.targets = new Map();
  }

  target(width, height) {
    const key = [width, height].join("x");
    if (!this.targets.has(key)) {
      this.targets.set(key, new THREE.WebGLRenderTarget(width, height, TARGET_OPTIONS));
    }
    return this.targets.get(key);
  }

  bake(request) {
    const { geometry, width, height, uniforms } = request;
    if (!decalTouches(geometry, uniforms)) return null;
    const pixels = this.capture(request);
    return hasAlpha(pixels) ? pixelsToCanvas(pixels, width, height) : null;
  }

  /* Сетка и материал живут только на время кадра, состояние рендерера возвращается при любом выходе. */
  capture({ geometry, width, height, uniforms }) {
    const material = createDecalBakeMaterial(uniforms);
    const mesh = Object.assign(new THREE.Mesh(geometry, material), { frustumCulled: false });
    this.scene.add(mesh);
    try {
      return this.develop(this.target(width, height), width, height);
    } finally {
      this.scene.remove(mesh);
      material.dispose();
    }
  }

  develop(target, width, height) {
    const pixels = new Uint8Array(width * height * 4);
    const saved = this.remember();
    try {
      this.aim(target);
      this.wipe();
      this.paint();
      this.readBack(target, width, height, pixels);
    } finally {
      this.recall(saved);
    }
    return pixels;
  }

  remember() {
    const color = new THREE.Color();
    return {
      target: this.renderer.getRenderTarget(),
      alpha: this.renderer.getClearAlpha(),
      color: this.renderer.getClearColor(color) ?? color,
    };
  }

  recall({ target, alpha, color }) {
    try {
      this.renderer.setRenderTarget(target);
    } finally {
      this.renderer.setClearColor(color, alpha);
    }
  }

  aim(target) {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
  }

  wipe() {
    this.renderer.clear(true, false, false);
  }

  paint() {
    this.renderer.render(this.scene, this.camera);
  }

  readBack(target, width, height, pixels) {
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  }

  dispose() {
    this.targets.forEach((target) => target.dispose());
    this.targets.clear();
  }
}

export function createDecalBaker(renderer) {
  const baker = new DecalBaker(renderer);
  return { bake: baker.bake.bind(baker), dispose: baker.dispose.bind(baker) };
}

function hasAlpha(pixels) {
  let at = 3;
  while (at < pixels.length && pixels[at] === 0) at += 4;
  return at < pixels.length;
}

/* Буфер цели читается снизу вверх, холст рисуется сверху вниз. */
function pixelsToCanvas(pixels, width, height) {
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const stride = width * 4;
  const rows = Array.from({ length: height }, (_, row) => pixels.subarray(row * stride, (row + 1) * stride));
  rows.reverse().forEach((line, top) => image.data.set(line, top * stride));
  context.putImageData(image, 0, 0);
  return canvas;
}

/* ================================================================ замер повторов */

export function stickerSpill(geometry, uniforms) {
  const uv = arrayOf(geometry, "bakeUv");
  if (!uv) return noSpill();
  const marks = decalTriangles(geometry, uniforms);
  return marks.length ? spillOf(marks, uv) : noSpill();
}

const noSpill = () => ({ painted: 0, shared: 0 });

function spillOf(marks, uv) {
  const sheet = new CoverageSheet();
  for (let tri = 0; tri < marks.length; tri += 1) {
    sheet.stamp(marks[tri] ? UNDER_DECAL : FOREIGN, uv, tri * 6);
  }
  return sheet.tally();
}

const wrapCell = (index) => ((index % SHEET_SIZE) + SHEET_SIZE) % SHEET_SIZE;

/* Лист 128 на 128: клетки, центры которых лежат внутри треугольника развёртки. */
class CoverageSheet {
  constructor() {
    this.cells = new Uint8Array(SHEET_SIZE * SHEET_SIZE);
  }

  stamp(bit, uv, at) {
    const u0 = uv[at];
    const v0 = uv[at + 1];
    const u1 = uv[at + 2];
    const v1 = uv[at + 3];
    const u2 = uv[at + 4];
    const v2 = uv[at + 5];
    const du1 = u1 - u0;
    const dv1 = v1 - v0;
    const du2 = u2 - u0;
    const dv2 = v2 - v0;
    const det = cross2(du1, dv1, du2, dv2);
    if (!(Math.abs(det) > DET_EPSILON)) return;

    const loX = Math.floor(Math.min(u0, u1, u2) * SHEET_SIZE);
    const hiX = Math.ceil(Math.max(u0, u1, u2) * SHEET_SIZE);
    const loY = Math.floor(Math.min(v0, v1, v2) * SHEET_SIZE);
    const hiY = Math.ceil(Math.max(v0, v1, v2) * SHEET_SIZE);
    if (hiX - loX > SHEET_SPAN || hiY - loY > SHEET_SPAN) return;

    for (let y = loY; y < hiY + 1; y += 1) {
      const rowV = (y + 0.5 + CENTER_SHIFT_V) / SHEET_SIZE - v0;
      const rowStart = wrapCell(y) * SHEET_SIZE;
      for (let x = loX; x < hiX + 1; x += 1) {
        const colU = (x + 0.5 + CENTER_SHIFT_U) / SHEET_SIZE - u0;
        const w1 = cross2(colU, rowV, du2, dv2) / det;
        const w2 = cross2(du1, dv1, colU, rowV) / det;
        if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) this.cells[rowStart + wrapCell(x)] |= bit;
      }
    }
  }

  tally() {
    let painted = 0;
    let shared = 0;
    for (const cell of this.cells) {
      if (cell & UNDER_DECAL) painted += 1;
      if (cell === UNDER_DECAL + FOREIGN) shared += 1;
    }
    return { painted, shared };
  }
}

/* ============================================================ деталь под точкой */

export function stickerPartOf(geometries, uniforms) {
  const { uAnchor, uNormal, uDepth } = uniforms;
  const nearest = new NearestPart(uAnchor.value, uNormal.value, uDepth.value);
  for (const geometry of geometries ?? []) nearest.consider(geometry);
  return nearest.part;
}

class NearestPart {
  constructor(anchor, axis, reach) {
    this.anchor = anchor;
    this.point = vec3(anchor);
    [this.px, this.py, this.pz] = this.point;
    [this.nx, this.ny, this.nz] = vec3(axis);
    this.reach = reach;
    this.square = reach * reach;
    this.part = -1;
  }

  consider(geometry) {
    const soup = soupOf(geometry);
    if (!soup || !soup.parts || this.isBeyond(geometry)) return;
    for (let tri = 0; tri < soup.count; tri += 1) this.offer(soup, tri);
  }

  isBeyond({ boundingBox: box }) {
    return Boolean(box) && box.distanceToPoint(this.anchor) > this.reach;
  }

  offer({ positions, normals, parts }, tri) {
    const part = parts[tri * 3];
    const base = tri * 9;
    // дешёвые отсевы первыми: деталь неизвестна, ящик треугольника не ближе лучшего, спиной к наклейке
    if (part < 0 || boxGapSquared(this.px, this.py, this.pz, positions, base) >= this.square) return;
    if (facingOf(normals, base, this.nx, this.ny, this.nz) < FACING_MIN) return;
    const square = squaredDistanceToTriangle(this.point, positions, base);
    if (square < this.square) {
      this.square = square;
      this.part = part;
    }
  }
}

/* Нижняя граница расстояния: до габаритного ящика треугольника. */
function boxGapSquared(px, py, pz, positions, base) {
  const gx = axisGap(px, positions, base);
  const gy = axisGap(py, positions, base + 1);
  const gz = axisGap(pz, positions, base + 2);
  return dot3(gx, gy, gz, gx, gy, gz);
}

function axisGap(p, array, at) {
  const a = array[at];
  const b = array[at + VERTEX_STEP];
  const c = array[at + 2 * VERTEX_STEP];
  return Math.max(Math.min(a, b, c) - p, 0, p - Math.max(a, b, c));
}

/* Квадрат расстояния от точки до треугольника: области вершин и рёбер идут по порядку, остальное — внутри. */
function squaredDistanceToTriangle(point, positions, base) {
  const [a, b, c] = [0, 3, 6].map((shift) => cornerv(positions, base + shift));
  const ab = subv(b, a);
  const ac = subv(c, a);
  const [ap, bp, cp] = [a, b, c].map((vertex) => subv(point, vertex));
  const d1 = dotv(ab, ap);
  const d2 = dotv(ac, ap);
  const d3 = dotv(ab, bp);
  const d4 = dotv(ac, bp);
  const d5 = dotv(ab, cp);
  const d6 = dotv(ac, cp);
  const kit = { ab, ac, ap, bp, cp, d1, d2, d3, d4, d5, d6, va: d3 * d6 - d5 * d4, vb: d5 * d2 - d1 * d6, vc: d1 * d4 - d3 * d2 };

  const region = TRIANGLE_REGIONS.find(([inside]) => inside(kit));
  const gap = region ? region[1](kit) : interiorGap(kit);
  return dotv(gap, gap);
}

function interiorGap({ ab, ac, ap, va, vb, vc }) {
  const scale = 1 / (va + vb + vc);
  return slidev(slidev(ap, ab, vb * scale), ac, vc * scale);
}

/* ======================================================== отбор треугольников */

export function decalTriangles(geometry, uniforms) {
  const soup = soupOf(geometry);
  return soup ? paintMask(soup, new DecalFrame(uniforms)) : new Uint8Array(0);
}

function paintMask(soup, frame) {
  const mask = new Uint8Array(soup.count);
  for (let tri = 0; tri < soup.count; tri += 1) {
    if (paintsTriangle(frame, soup, tri)) mask[tri] = 1;
  }
  return mask;
}

function paintsTriangle(frame, soup, tri) {
  const { positions, normals, parts } = soup;
  const base = tri * 9;
  if (frame.rejectsPart(parts ? parts[tri * 3] : -1)) return false;
  const inside = frame.covers(vertexSum(positions, base) / 3, vertexSum(positions, base + 1) / 3, vertexSum(positions, base + 2) / 3);
  return inside && !(facingOf(normals, base, frame.nx, frame.ny, frame.nz) < FACING_MIN);
}

/* Читаемый вид треугольного облака геометрии «в развёртке». */
function soupOf(geometry) {
  const positions = arrayOf(geometry, "position");
  const normals = arrayOf(geometry, "normal");
  if (!positions || !normals) return null;
  return { positions, normals, parts: arrayOf(geometry, "bakePart") ?? null, count: Math.floor(positions.length / 9) };
}

/* Косинус между суммой нормалей треугольника и осью наклейки. */
function facingOf(normals, base, nx, ny, nz) {
  const sx = vertexSum(normals, base);
  const sy = vertexSum(normals, base + 1);
  const sz = vertexSum(normals, base + 2);
  return dot3(sx, sy, sz, nx, ny, nz) / (Math.sqrt(dot3(sx, sy, sz, sx, sy, sz)) || 1);
}

/* Окно наклейки: числа из юниформов и положение точки на её осях. */
class DecalFrame {
  constructor(uniforms) {
    const { uAnchor, uNormal, uTangent, uBitangent, uHalf, uDepth, uPart } = uniforms;
    [this.ax, this.ay, this.az] = vec3(uAnchor.value);
    [this.nx, this.ny, this.nz] = vec3(uNormal.value);
    [this.tx, this.ty, this.tz] = vec3(uTangent.value);
    [this.bx, this.by, this.bz] = vec3(uBitangent.value);
    this.spanS = 2 * uHalf.value.x;
    this.spanT = 2 * uHalf.value.y;
    this.depth = uDepth.value;
    this.part = uPart?.value ?? -1;
  }

  /* NaN не отсекает: сравнения с ним ложны. */
  covers(x, y, z) {
    const dx = x - this.ax;
    const dy = y - this.ay;
    const dz = z - this.az;
    if (outside01(dot3(dx, dy, dz, this.tx, this.ty, this.tz) / this.spanS + 0.5)) return false;
    if (outside01(dot3(dx, dy, dz, this.bx, this.by, this.bz) / this.spanT + 0.5)) return false;
    return !(Math.abs(dot3(dx, dy, dz, this.nx, this.ny, this.nz)) > this.depth);
  }

  rejectsPart(part) {
    return this.part >= 0 && Math.abs(part - this.part) > PART_TOLERANCE;
  }
}

export function decalTouches(geometry, uniforms) {
  const { boundingBox: box } = geometry;
  return !box || box.distanceToPoint(uniforms.uAnchor.value) <= reachOf(uniforms);
}

/* Досягаемость наклейки: диагональ окна плюс толща. */
function reachOf({ uHalf, uDepth }) {
  return Math.hypot(uHalf.value.x, uHalf.value.y) + uDepth.value;
}

/* =============================================================== геометрия в развёртке */

export function buildBakeGeometry(meshes, root, uvMatrix) {
  const sink = new BakeSink();
  const rootInverse = new THREE.Matrix4().fromArray(root.matrixWorld.elements).invert();
  for (const entry of meshes) sink.take(entry, rootInverse, uvMatrix);
  return sink.toGeometry();
}

/* Одна вершина сетки модели, уже переведённая в оси корня. */
class Corner {
  constructor() {
    this.position = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.uv = new THREE.Vector3();
    this.part = -1;
  }
}

const product = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);

/* Сетка модели с матрицами в осях корня; строит вершины по номеру. */
class MeshReader {
  static open(mesh, rootInverse, uvMatrix) {
    const { geometry } = mesh;
    const { position, normal, uv, astralPart } = geometry.attributes;
    if (!position || !uv) return null;

    mesh.updateWorldMatrix(true, false);
    const toRoot = product(rootInverse, mesh.matrixWorld);
    return new MeshReader({
      position,
      normal,
      uv,
      astralPart,
      index: geometry.index,
      uvMatrix,
      toRoot,
      normalMatrix: new THREE.Matrix3().getNormalMatrix(toRoot),
    });
  }

  constructor(fields) {
    Object.assign(this, fields);
  }

  ranges(groups) {
    if (groups?.length) return groups;
    return [{ start: 0, count: this.index ? this.index.count : this.position.count }];
  }

  load(corner, vertex) {
    const at = this.index ? this.index.getX(vertex) : vertex;
    corner.position.fromBufferAttribute(this.position, at).applyMatrix4(this.toRoot);
    if (this.normal) {
      corner.normal.fromBufferAttribute(this.normal, at).applyMatrix3(this.normalMatrix).normalize();
    } else {
      corner.normal.set(0, 0, 1);
    }
    corner.uv.set(this.uv.getX(at), this.uv.getY(at), 1);
    if (this.uvMatrix) corner.uv.applyMatrix3(this.uvMatrix);
    corner.part = this.astralPart ? this.astralPart.getX(at) : -1;
  }
}

/* Растущий Float32-буфер одного атрибута. */
class Channel {
  constructor(itemSize) {
    this.itemSize = itemSize;
    this.data = new Float32Array(itemSize * 512);
    this.used = 0;
  }

  room() {
    if (this.used + this.itemSize <= this.data.length) return;
    const grown = new Float32Array(this.data.length * 2);
    grown.set(this.data);
    this.data = grown;
  }

  put1(a) {
    this.room();
    this.data[this.used] = a;
    this.used += 1;
  }

  put2(a, b) {
    this.room();
    this.data[this.used] = a;
    this.data[this.used + 1] = b;
    this.used += 2;
  }

  put3(a, b, c) {
    this.room();
    this.data[this.used] = a;
    this.data[this.used + 1] = b;
    this.data[this.used + 2] = c;
    this.used += 3;
  }

  toAttribute() {
    return new THREE.Float32BufferAttribute(this.data.subarray(0, this.used), this.itemSize);
  }
}

const copiesNeeded = (high, tile) => (high - tile > 1 ? 2 : 1);

/* Копит треугольники и раскладывает их по плиткам листа. */
class BakeSink {
  constructor() {
    this.position = new Channel(3);
    this.normal = new Channel(3);
    this.bakeUv = new Channel(2);
    this.bakePart = new Channel(1);
    this.first = new Corner();
    this.second = new Corner();
    this.third = new Corner();
  }

  take({ mesh, groups }, rootInverse, uvMatrix) {
    const reader = MeshReader.open(mesh, rootInverse, uvMatrix);
    if (reader) this.absorb(reader, groups);
  }

  absorb(reader, groups) {
    for (const { start, count } of reader.ranges(groups)) {
      for (let at = start; at - start < count; at += 3) {
        reader.load(this.first, at);
        reader.load(this.second, at + 1);
        reader.load(this.third, at + 2);
        this.emit();
      }
    }
  }

  /* Одна копия на каждую плитку, которую задевает треугольник (не больше двух по оси). */
  emit() {
    const { first, second, third } = this;
    const tileU = Math.floor(Math.min(first.uv.x, second.uv.x, third.uv.x));
    const tileV = Math.floor(Math.min(first.uv.y, second.uv.y, third.uv.y));
    const columns = copiesNeeded(Math.max(first.uv.x, second.uv.x, third.uv.x), tileU);
    const rows = copiesNeeded(Math.max(first.uv.y, second.uv.y, third.uv.y), tileV);

    for (let du = 0; du < columns; du += 1) {
      for (let dv = 0; dv < rows; dv += 1) {
        this.push(first, tileU, tileV, du, dv);
        this.push(second, tileU, tileV, du, dv);
        this.push(third, tileU, tileV, du, dv);
      }
    }
  }

  push({ position, normal, uv, part }, tileU, tileV, du, dv) {
    this.position.put3(position.x, position.y, position.z);
    this.normal.put3(normal.x, normal.y, normal.z);
    this.bakeUv.put2(uv.x - tileU - du, uv.y - tileV - dv);
    this.bakePart.put1(part);
  }

  toGeometry() {
    const geometry = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "bakeUv", "bakePart"]) {
      geometry.setAttribute(name, this[name].toAttribute());
    }
    geometry.computeBoundingBox();
    return geometry;
  }
}

/* ===================================================================== материалы */

function shaderMaterial(...parts) {
  return new THREE.ShaderMaterial(Object.assign({}, ...parts));
}

export function createDecalOverlayMaterial(uniforms) {
  const withRoot = Object.assign({}, uniforms, { uToRoot: { value: new THREE.Matrix4() } });
  return shaderMaterial(OVERLAY_STATE, { uniforms: withRoot, vertexShader: OVERLAY_VERTEX, fragmentShader: OVERLAY_FRAGMENT });
}

export function createDecalBakeMaterial(uniforms) {
  return shaderMaterial(BAKE_STATE, { uniforms, vertexShader: BAKE_VERTEX, fragmentShader: BAKE_FRAGMENT });
}

/* ====================================================================== юниформы */

export function decalUniforms(sticker, texture, modelLength) {
  const { anchor, normal, rotation, size, wear, id, flip, opacity } = sticker;
  const { x, y, z } = anchor;
  const basis = decalBasis(normal, rotation);
  const halfWidth = Math.max(MIN_WINDOW, ((size || DEFAULT_SIZE) / 100) * modelLength) / 2;
  const halfHeight = halfWidth * aspectOf(texture);

  const values = {
    uAnchor: new THREE.Vector3(x, y, z),
    uNormal: basis.normal,
    uTangent: basis.tangent,
    uBitangent: basis.bitangent,
    uHalf: new THREE.Vector2(halfWidth, halfHeight),
    uDepth: Math.max(halfWidth, halfHeight) * 2 * DEPTH_SHARE,
    uMap: texture,
    uWear: (wear || 0) / 100,
    uSeed: seedOf(id),
    uFlip: flip ? 1 : 0,
    uPart: -1,
    uOpacity: (opacity ?? 100) / 100,
  };
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
}

export function assignDecalUniforms(target, source) {
  for (const [name, { value }] of Object.entries(source)) {
    const slot = target[name];
    if (slot) slot.value = value;
    else target[name] = { value };
  }
}

function aspectOf(texture) {
  const image = texture?.image;
  return image?.width && image?.height ? image.height / image.width : 1;
}

function seedOf(id) {
  const codes = Array.from(String(id || ""), (symbol) => symbol.charCodeAt(0));
  return codes.reduce((sum, code) => sum + code, 0);
}

/* ========================================================================= базис */

export function decalBasis(normalLike, rotationDegrees = 0, upHint = null) {
  const normal = new THREE.Vector3(normalLike.x, normalLike.y, normalLike.z).normalize();
  const right = unitCross(pickUp(normal, upHint), normal);
  const tangent = spin(right, unitCross(normal, right), (rotationDegrees * Math.PI) / 180);
  return { normal, tangent, bitangent: unitCross(normal, tangent) };
}

/* ============================================================ константы и шейдеры */

const VERTEX_STEP = 3;
const AXES = ["x", "y", "z"];
const STEEP_NORMAL_Y = 0.92;
const WORLD_X = Object.freeze({ x: 1, y: 0, z: 0 });
const WORLD_Y = Object.freeze({ x: 0, y: 1, z: 0 });

const FACING_MIN = 0.12;
const FACING_SOFT_END = 0.3;
const PART_TOLERANCE = 0.5;
const ALPHA_CUTOFF = 0.003;
const DEPTH_SHARE = 0.6;
const MIN_WINDOW = 0.0001;
const DEFAULT_SIZE = 18;

const SHEET_SIZE = 128;
const SHEET_SPAN = 256;
const DET_EPSILON = 1e-12;
const CENTER_SHIFT_U = 0.001;
const CENTER_SHIFT_V = 0.0023;
const UNDER_DECAL = 1;
const FOREIGN = 2;

const TARGET_OPTIONS = { stencilBuffer: false, depthBuffer: false };

const OVERLAY_STATE = Object.fromEntries([
  ["polygonOffsetUnits", -4],
  ["polygonOffsetFactor", -2],
  ["polygonOffset", true],
  ["transparent", true],
  ["depthWrite", false],
]);

const BAKE_STATE = Object.fromEntries([
  ["blending", THREE.NoBlending],
  ["transparent", false],
  ["side", THREE.DoubleSide],
  ["depthWrite", false],
  ["depthTest", false],
]);

/* Области вокруг треугольника в порядке проверки: условие → вектор от ближайшей точки к проверяемой. */
const TRIANGLE_REGIONS = [
  [(k) => 0 >= k.d1 && 0 >= k.d2, (k) => k.ap],
  [(k) => 0 <= k.d3 && k.d3 >= k.d4, (k) => k.bp],
  [(k) => 0 >= k.vc && 0 <= k.d1 && 0 >= k.d3, (k) => slidev(k.ap, k.ab, k.d1 / (k.d1 - k.d3))],
  [(k) => 0 <= k.d6 && k.d6 >= k.d5, (k) => k.cp],
  [(k) => 0 >= k.vb && 0 <= k.d2 && 0 >= k.d6, (k) => slidev(k.ap, k.ac, k.d2 / (k.d2 - k.d6))],
  [
    (k) => 0 >= k.va && 0 <= k.d4 - k.d3 && 0 <= k.d5 - k.d6,
    (k) => slidev(k.bp, subv(k.ac, k.ab), (k.d4 - k.d3) / (k.d4 - k.d3 + (k.d5 - k.d6))),
  ],
];

/* Общая часть: юниформы проектора, износ и сама проекция. Слова uOpacity здесь нет. */
const PROJECTOR_GLSL = /* glsl */ `
uniform vec3 uAnchor;
uniform vec3 uNormal;
uniform vec3 uTangent;
uniform vec3 uBitangent;
uniform vec2 uHalf;
uniform float uDepth;
uniform sampler2D uMap;
uniform float uWear;
uniform float uSeed;
uniform float uFlip;
uniform float uPart;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vPart;

float decalHash(vec2 corner) {
  return fract(sin(dot(corner, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
}

float decalNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float low = mix(decalHash(cell), decalHash(cell + vec2(1.0, 0.0)), w.x);
  float high = mix(decalHash(cell + vec2(0.0, 1.0)), decalHash(cell + vec2(1.0, 1.0)), w.x);
  return mix(low, high, w.y);
}

float wearFactor(vec2 st) {
  if (uWear <= 0.0) return 1.0;
  float grain = decalNoise(st * 9.0) * 0.7 + decalNoise(st * 31.0) * 0.3;
  float rim = 2.0 * min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y));
  return smoothstep(uWear - 0.08, uWear + 0.04, grain + rim * 0.25);
}

vec4 projectDecal() {
  if (uPart >= 0.0 && abs(vPart - uPart) > ${PART_TOLERANCE}) return vec4(0.0);

  vec3 rel = vPosition - uAnchor;
  float s = dot(rel, uTangent) / (2.0 * uHalf.x) + 0.5;
  float t = dot(rel, uBitangent) / (2.0 * uHalf.y) + 0.5;
  float along = dot(rel, uNormal);
  if (s < 0.0 || s > 1.0 || t < 0.0 || t > 1.0 || abs(along) > uDepth) return vec4(0.0);

  float facing = dot(normalize(vNormal), uNormal);
  if (facing < ${FACING_MIN}) return vec4(0.0);

  if (uFlip > 0.5) s = 1.0 - s;
  vec4 texel = texture2D(uMap, vec2(s, t));
  float soft = smoothstep(${FACING_MIN}, ${FACING_SOFT_END}, facing);
  return vec4(texel.rgb, texel.a * wearFactor(vec2(s, t)) * soft);
}
`;

const OVERLAY_VERTEX = /* glsl */ `
uniform mat4 uToRoot;
attribute float astralPart;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vPart;

void main() {
  vPosition = (uToRoot * vec4(position, 1.0)).xyz;
  vNormal = mat3(uToRoot) * normal;
  vPart = astralPart;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const OVERLAY_FRAGMENT = /* glsl */ `
uniform float uOpacity;
${PROJECTOR_GLSL}
void main() {
  vec4 decal = projectDecal();
  float alpha = decal.a * uOpacity;
  if (alpha <= ${ALPHA_CUTOFF}) discard;
  gl_FragColor = vec4(decal.rgb, alpha);
}
`;

const BAKE_VERTEX = /* glsl */ `
attribute vec2 bakeUv;
attribute float bakePart;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vPart;

void main() {
  vPosition = position;
  vNormal = normal;
  vPart = bakePart;
  gl_Position = vec4(bakeUv.x * 2.0 - 1.0, 1.0 - bakeUv.y * 2.0, 0.0, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
${PROJECTOR_GLSL}
void main() {
  vec4 decal = projectDecal();
  if (decal.a <= ${ALPHA_CUTOFF}) discard;
  gl_FragColor = decal;
}
`;
