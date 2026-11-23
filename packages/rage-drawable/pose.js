/*
 * Персонаж в позе (ТЗ 06.10.2026, вечер, задача 2: «В руках»).
 *
 * Части педа лежат в файлах в позе привязки. Здесь они встают в позу клипа
 * игры: локальные повороты костей из клипа (`sample-anim-pose` нативного
 * хоста) накладываются на скелет `mp_m_freemode_01.yft`, и каждая вершина
 * переносится взвешенной суммой матриц своих костей — как это делает игра
 * (скининг до четырёх костей на вершину).
 *
 * Считается в осях RAGE (Z вверх); вершины моделей уже в осях glTF
 * (`drawable.js`: (x, y, z) → (x, z, −y)), поэтому на входе и на выходе —
 * перевод. Матрицы 4×4 — по столбцам, как в `drawable.js` и glTF.
 */

/** Кость кисти, на которую игра вешает оружие (`PH_R_Hand`). */
export const BONE_PH_R_HAND = 0x6f06;
/** Кость левой кисти (`PH_L_Hand`) — вторая рука у длинных стволов. */
export const BONE_PH_L_HAND = 0xeb95;

export function composeMatrix(rotation, translation, scale = [1, 1, 1]) {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

export function multiplyMatrices(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  return out;
}

/** Обратная к аффинной матрице (поворот·масштаб + смещение). */
export function invertAffine(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const r = [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
  const [tx, ty, tz] = [m[12], m[13], m[14]];
  return [
    r[0],
    r[1],
    r[2],
    0,
    r[3],
    r[4],
    r[5],
    0,
    r[6],
    r[7],
    r[8],
    0,
    -(r[0] * tx + r[3] * ty + r[6] * tz),
    -(r[1] * tx + r[4] * ty + r[7] * tz),
    -(r[2] * tx + r[5] * ty + r[8] * tz),
    1,
  ];
}

/* Оси: RAGE (x, y, z) ↔ glTF (x, z, −y). */
const RAGE_TO_GLTF = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const GLTF_TO_RAGE = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

/** Матрица из осей RAGE в оси glTF: C·M·C⁻¹. */
export function rageMatrixToGltf(matrix) {
  return multiplyMatrices(multiplyMatrices(RAGE_TO_GLTF, matrix), GLTF_TO_RAGE);
}

/**
 * Скелет в позе. `bones` — кости `readDrawable` (`rotation`, `translation`,
 * `scale`, `parent`, `tag`); `pose` — Map тег → `{ rotation?, translation? }`
 * в осях RAGE, локально к родителю (так их отдаёт клип). Кость без дорожки в
 * клипе остаётся в позе привязки.
 *
 * Возвращает `{ bind, posed }` — абсолютные матрицы каждой кости.
 */
export function poseSkeleton(bones, pose = new Map()) {
  const local = (index, posed) => {
    const bone = bones[index];
    const track = posed ? pose.get(bone.tag) : null;
    return composeMatrix(
      track?.rotation || bone.rotation,
      track?.translation || bone.translation,
      bone.scale || [1, 1, 1],
    );
  };
  const solve = (posed) => {
    const out = new Array(bones.length).fill(null);
    const absolute = (index, depth = 0) => {
      if (out[index]) return out[index];
      if (depth > bones.length) throw new Error("Кольцо в скелете.");
      const parent = bones[index].parent;
      out[index] =
        parent >= 0 && parent < bones.length && parent !== index
          ? multiplyMatrices(absolute(parent, depth + 1), local(index, posed))
          : local(index, posed);
      return out[index];
    };
    for (let index = 0; index < bones.length; index += 1) absolute(index);
    return out;
  };
  return { bind: solve(false), posed: solve(true) };
}

/** Матрицы скининга кости: поза · (привязка)⁻¹ — в осях RAGE. */
export function skinMatrices({ bind, posed }) {
  return bind.map((matrix, index) => {
    const inverse = invertAffine(matrix);
    return inverse ? multiplyMatrices(posed[index], inverse) : null;
  });
}

/**
 * Скинованные меши (`readDrawable(..., { skin: true })`) в позе: новые
 * массивы позиций и нормалей, остальное — как было. Вершина без весов
 * остаётся на месте.
 */
export function poseMeshes(meshes, matrices) {
  return meshes.map((mesh) => {
    if (!mesh.skin) return mesh;
    const { weights, joints } = mesh.skin;
    const count = mesh.positions.length / 3;
    const positions = new Float32Array(mesh.positions.length);
    const normals = mesh.normals ? new Float32Array(mesh.normals.length) : null;
    const blended = new Float64Array(12);
    for (let vertex = 0; vertex < count; vertex += 1) {
      blended.fill(0);
      let total = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const weight = weights[vertex * 4 + slot];
        if (!(weight > 0)) continue;
        const matrix = matrices[joints[vertex * 4 + slot]];
        if (!matrix) continue;
        total += weight;
        for (let k = 0; k < 3; k += 1) {
          blended[k] += matrix[k] * weight;
          blended[3 + k] += matrix[4 + k] * weight;
          blended[6 + k] += matrix[8 + k] * weight;
          blended[9 + k] += matrix[12 + k] * weight;
        }
      }
      const at = vertex * 3;
      /* glTF → RAGE. */
      const x = mesh.positions[at];
      const y = -mesh.positions[at + 2];
      const z = mesh.positions[at + 1];
      if (!(total > 0)) {
        positions.set(mesh.positions.subarray(at, at + 3), at);
        if (normals) normals.set(mesh.normals.subarray(at, at + 3), at);
        continue;
      }
      const s = 1 / total;
      const px = (blended[0] * x + blended[3] * y + blended[6] * z + blended[9]) * s;
      const py = (blended[1] * x + blended[4] * y + blended[7] * z + blended[10]) * s;
      const pz = (blended[2] * x + blended[5] * y + blended[8] * z + blended[11]) * s;
      /* RAGE → glTF. */
      positions[at] = px;
      positions[at + 1] = pz;
      positions[at + 2] = -py;
      if (normals) {
        const nx = mesh.normals[at];
        const ny = -mesh.normals[at + 2];
        const nz = mesh.normals[at + 1];
        const qx = blended[0] * nx + blended[3] * ny + blended[6] * nz;
        const qy = blended[1] * nx + blended[4] * ny + blended[7] * nz;
        const qz = blended[2] * nx + blended[5] * ny + blended[8] * nz;
        const length = Math.hypot(qx, qy, qz) || 1;
        normals[at] = qx / length;
        normals[at + 1] = qz / length;
        normals[at + 2] = -qy / length;
      }
    }
    return { ...mesh, positions, normals, skin: null };
  });
}

/** Поза клипа из ответа `sample-anim-pose`: Map тег → `{ rotation, translation }`. */
export function poseFromClip(bones = []) {
  const pose = new Map();
  for (const bone of bones) {
    const tag = Number(bone?.tag);
    if (!Number.isInteger(tag)) continue;
    const entry = pose.get(tag) || {};
    if (bone.track === "rotation" && bone.value?.length === 4) entry.rotation = bone.value.map(Number);
    if (bone.track === "translation" && bone.value?.length === 3) entry.translation = bone.value.map(Number);
    pose.set(tag, entry);
  }
  return pose;
}
