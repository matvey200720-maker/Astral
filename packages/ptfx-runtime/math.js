/*
 * Немного линейной алгебры для движка частиц.
 *
 * Мир — как в GTA: правая система, ось Z вверх, метры. Матрица эффекта —
 * три оси и точка (`{ x, y, z, origin }`): ось Z эффекта попадания смотрит из
 * раны (у выходного — по ходу пули), ось Y — вверх вдоль тела. Векторы —
 * массивы из трёх чисел; горячие места пишут в заранее выделенные `out`.
 */

export const DEG = Math.PI / 180;

export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];

export function add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function scale(out, a, s) {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(out, a) {
  const size = Math.hypot(a[0], a[1], a[2]);
  if (size < 1e-9) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  out[0] = a[0] / size;
  out[1] = a[1] / size;
  out[2] = a[2] / size;
  return out;
}

export function cross(out, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Поворот по углам в градусах (x, y, z) — как поворот домена RMPTFX:
 * сперва вокруг X, затем Y, затем Z. Возвращает матрицу 3×3 по строкам.
 */
export function rotationMatrix(degrees) {
  const [ax, ay, az] = degrees;
  const cx = Math.cos(ax * DEG);
  const sx = Math.sin(ax * DEG);
  const cy = Math.cos(ay * DEG);
  const sy = Math.sin(ay * DEG);
  const cz = Math.cos(az * DEG);
  const sz = Math.sin(az * DEG);
  /* R = Rz · Ry · Rx */
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function rotate(out, m, v) {
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Матрица эффекта: оси и точка. Оси нормируются, Y достраивается. */
export function effectFrame({ origin = [0, 0, 0], z = [0, 0, 1], up = [0, 0, 1] } = {}) {
  const axisZ = normalize([0, 0, 0], z);
  /* «Вверх» не может совпасть с осью Z эффекта: тогда X берётся от мировой X. */
  let axisX = cross([0, 0, 0], up, axisZ);
  if (length(axisX) < 1e-4) axisX = cross([0, 0, 0], [1, 0, 0], axisZ);
  normalize(axisX, axisX);
  const axisY = normalize([0, 0, 0], cross([0, 0, 0], axisZ, axisX));
  return Object.freeze({
    origin: [...origin],
    x: axisX,
    y: axisY,
    z: axisZ,
  });
}

/** Точка из пространства эффекта в мир. */
export function toWorld(out, frame, local) {
  const [lx, ly, lz] = local;
  out[0] = frame.origin[0] + frame.x[0] * lx + frame.y[0] * ly + frame.z[0] * lz;
  out[1] = frame.origin[1] + frame.x[1] * lx + frame.y[1] * ly + frame.z[1] * lz;
  out[2] = frame.origin[2] + frame.x[2] * lx + frame.y[2] * ly + frame.z[2] * lz;
  return out;
}

/** Вектор (без переноса) из пространства эффекта в мир. */
export function directionToWorld(out, frame, local) {
  const [lx, ly, lz] = local;
  out[0] = frame.x[0] * lx + frame.y[0] * ly + frame.z[0] * lz;
  out[1] = frame.x[1] * lx + frame.y[1] * ly + frame.z[1] * lz;
  out[2] = frame.x[2] * lx + frame.y[2] * ly + frame.z[2] * lz;
  return out;
}
