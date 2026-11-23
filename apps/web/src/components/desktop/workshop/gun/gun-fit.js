import * as THREE from "three";

// Ячейки накопителя FitProbe.
const [WORLD, SHEET, COS, SIN, WEIGHT] = [0, 1, 2, 3, 4];

const DEGREES_PER_RADIAN = 180 / Math.PI;

const AXIS_KEYS = new Map([
  [0, "x"],
  [1, "y"],
]);

// Какая сторона габарита ведёт: порядок проверки x, затем y, иначе z.
const LEAD_RULES = [
  [0, (x, y, z) => x >= y && x >= z],
  [1, (x, y, z) => y >= z],
];

// Две меры детали: плотность развёртки на метр ствола и направление оси ствола на листе.
export function measureFit(meshes, settings) {
  const { width, height, axis = 0 } = settings;
  const uvMatrix = settings.mapper?.matrix ?? new THREE.Matrix3();
  const probe = new FitProbe(uvMatrix, width, height, AXIS_KEYS.get(axis) ?? "z");
  for (const entry of meshes || []) {
    probe.visit(entry.mesh, entry.groups);
  }
  return probe.verdict(Math.min(width, height) || 1);
}

// Копит суммы по треугольникам; рабочие векторы заводятся один раз, в цикле по треугольникам выделений нет.
class FitProbe {
  constructor(uvMatrix, width, height, axisKey) {
    this.uvMatrix = uvMatrix;
    this.width = width;
    this.height = height;
    this.axisKey = axisKey;
    this.corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.flats = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
    this.edgeP = new THREE.Vector3();
    this.edgeQ = new THREE.Vector3();
    this.sums = new Float64Array(5);
  }

  visit(mesh, groups) {
    const { position, uv } = mesh?.geometry?.attributes ?? {};
    if (!(position && uv)) return;
    const { index } = mesh.geometry;
    const total = (index ?? position).count;
    for (const [start, end] of spansOf(groups, total)) {
      for (let at = start; at + 3 <= end; at += 3) {
        this.triangle(mesh.matrixWorld, position, uv, index, at);
      }
    }
  }

  triangle(matrix, position, uv, index, at) {
    const { corners, flats, sums } = this;
    for (let k = 0; k < 3; k += 1) {
      const vertex = index ? index.getX(at + k) : at + k;
      const corner = corners[k];
      corner.fromBufferAttribute(position, vertex);
      corner.applyMatrix4(matrix);
      const flat = flats[k];
      flat.fromBufferAttribute(uv, vertex);
      flat.applyMatrix3(this.uvMatrix);
      flat.x *= this.width;
      flat.y *= this.height;
    }
    const a = corners[0];
    const b = corners[1];
    const c = corners[2];
    this.edgeP.subVectors(b, a);
    this.edgeQ.subVectors(c, a);
    const worldArea = 0.5 * this.edgeP.cross(this.edgeQ).length();

    const p1 = flats[1].x - flats[0].x;
    const q1 = flats[1].y - flats[0].y;
    const p2 = flats[2].x - flats[0].x;
    const q2 = flats[2].y - flats[0].y;
    const det = cross2(p1, q2, q1, p2);
    const sheetArea = 0.5 * Math.abs(det);
    if (!(worldArea > 0 && sheetArea > 0)) return;
    sums[WORLD] += worldArea;
    sums[SHEET] += sheetArea;

    // Градиент высоты вдоль оси ствола по строке и столбцу листа.
    const key = this.axisKey;
    const rise1 = b[key] - a[key];
    const rise2 = c[key] - a[key];
    const gradS = cross2(rise1, q2, rise2, q1) / det;
    const gradT = cross2(p1, rise2, p2, rise1) / det;
    if (!(Math.hypot(gradS, gradT) > 0)) return;

    // Удвоенный угол: «вперёд» и «назад» вдоль оси неразличимы.
    const turn = 2 * Math.atan2(gradT, gradS);
    sums[COS] += Math.cos(turn) * worldArea;
    sums[SIN] += Math.sin(turn) * worldArea;
    sums[WEIGHT] += worldArea;
  }

  verdict(unit) {
    const { sums } = this;
    if (!(sums[WORLD] > 0 && sums[SHEET] > 0)) return null;
    return {
      density: densityOf(sums[SHEET], sums[WORLD], unit),
      angle: orientation(sums[SIN], sums[COS]),
      coherence: sums[WEIGHT] ? Math.hypot(sums[COS], sums[SIN]) / sums[WEIGHT] : 0,
      area: sums[WORLD],
    };
  }
}

// a*b - c*d: определитель двух сторон и обе компоненты градиента считаются одной и той же операцией.
function cross2(a, b, c, d) {
  return a * b - c * d;
}

function densityOf(sheet, world, unit) {
  return Math.sqrt(sheet / world) / unit;
}

// Градусы по половине удвоенного угла, до десятых; половина округляется вверх.
function orientation(sinSum, cosSum) {
  const halfTurn = Math.atan2(sinSum, cosSum) / 2;
  const degrees = halfTurn * DEGREES_PER_RADIAN;
  return Math.round(degrees * 10) / 10;
}

// Диапазоны вершин: по группам, а без групп — вся сетка одним куском.
function* spansOf(groups, total) {
  if (!groups?.length) {
    yield [0, total];
    return;
  }
  for (const { start, count } of groups) {
    yield [start, Math.min(total, start + count)];
  }
}

function modelSize(root) {
  const box = new THREE.Box3();
  box.setFromObject(root);
  return box.getSize(new THREE.Vector3());
}

// Ось ствола: самая длинная сторона габарита корня (в мировых координатах).
export function longAxis(root) {
  const { x, y, z } = modelSize(root);
  for (const [axis, leads] of LEAD_RULES) {
    if (leads(x, y, z)) return axis;
  }
  return 2;
}
