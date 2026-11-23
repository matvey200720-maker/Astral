// Плоская «модель»: заглушка Rockstar или лист, который не вещь. По такой модели обложка выходит плоской картинкой, и карточка не нужна (правило владельца с 19.10: плоская текстура обложкой не бывает никогда).
//
// 06.11.2026: штатные `hand_000/001/003_u` Ограбления казино (`mpheist3`) — два треугольника размером 0,005 × 0,035 × 0,053 м. Перекраска сумки «ложилась» на этот квад, и в каталоге
// появились десятки плоских листов. Признаки заглушки — два, оба независимы от размера единиц модели:
//   • треугольников меньше, чем в коробке (12) — вещью быть не может;
//   • все вершины в одной плоскости (главные оси разброса: толщина к ширине < 4 %) — лист, как бы много треугольников у него ни было и как бы он ни был наклонён.
// Узкая длинная вещь (кольцо браслета, шнурок) плоской не считается: её толщина сравнивается со второй осью, а не с самой длинной.

/** Меньше треугольников, чем у коробки, — не вещь. */
export const MIN_TRIANGLES = 12;
/** Толщина (стандартное отклонение вдоль наименьшей оси) к ширине (вдоль средней): меньше — вершины лежат в плоскости. */
export const FLAT_RATIO = 0.04;

/** Число треугольников и вершины, которые в них входят (без мёртвых). */
function usedGeometry(drawable) {
  let triangles = 0;
  const points = [];
  for (const mesh of drawable?.meshes || []) {
    const positions = mesh?.positions;
    if (!positions?.length) continue;
    const indices = mesh.indices?.length ? mesh.indices : null;
    const count = indices ? indices.length : positions.length / 3;
    triangles += Math.floor(count / 3);
    const seen = new Set();
    for (let at = 0; at < count; at += 1) {
      const vertex = indices ? indices[at] : at;
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) points.push(x, y, z);
    }
  }
  return { triangles, points };
}

/** Собственные значения симметричной матрицы 3×3 `[xx, xy, xz, yy, yz, zz]` по возрастанию. */
function eigenvalues([xx, xy, xz, yy, yz, zz]) {
  const offDiagonal = xy * xy + xz * xz + yz * yz;
  if (offDiagonal === 0) return [xx, yy, zz].sort((a, b) => a - b);
  const mean = (xx + yy + zz) / 3;
  const spread = Math.sqrt(((xx - mean) ** 2 + (yy - mean) ** 2 + (zz - mean) ** 2 + 2 * offDiagonal) / 6);
  const [bxx, byy, bzz] = [(xx - mean) / spread, (yy - mean) / spread, (zz - mean) / spread];
  const [bxy, bxz, byz] = [xy / spread, xz / spread, yz / spread];
  const determinant = bxx * (byy * bzz - byz * byz) - bxy * (bxy * bzz - byz * bxz) + bxz * (bxy * byz - byy * bxz);
  const angle = Math.acos(Math.max(-1, Math.min(1, determinant / 2))) / 3;
  const largest = mean + 2 * spread * Math.cos(angle);
  const smallest = mean + 2 * spread * Math.cos(angle + (2 * Math.PI) / 3);
  return [smallest, 3 * mean - largest - smallest, largest];
}

/** Толщина облака вершин к его ширине (0 — плоскость) и число треугольников. */
export function modelShape(drawable) {
  const { triangles, points } = usedGeometry(drawable);
  const count = points.length / 3;
  if (count < 3) return { triangles, thickness: 0 };
  const centre = [0, 0, 0];
  for (let at = 0; at < points.length; at += 3) for (let axis = 0; axis < 3; axis += 1) centre[axis] += points[at + axis] / count;
  const covariance = [0, 0, 0, 0, 0, 0];
  for (let at = 0; at < points.length; at += 3) {
    const x = points[at] - centre[0];
    const y = points[at + 1] - centre[1];
    const z = points[at + 2] - centre[2];
    covariance[0] += (x * x) / count;
    covariance[1] += (x * y) / count;
    covariance[2] += (x * z) / count;
    covariance[3] += (y * y) / count;
    covariance[4] += (y * z) / count;
    covariance[5] += (z * z) / count;
  }
  const [smallest, middle] = eigenvalues(covariance);
  /* Ни ширины, ни толщины — точка или отрезок: не вещь. */
  if (!(middle > 0)) return { triangles, thickness: 0 };
  return { triangles, thickness: Math.sqrt(Math.max(smallest, 0) / middle) };
}

/**
 * Почему по этой модели нельзя рисовать вещь: словами для отчёта разбора. `null` — настоящая модель.
 * @param {{ meshes?: Array<{ positions?: ArrayLike<number>, indices?: ArrayLike<number> }> }|null} drawable
 */
export function flatModelReason(drawable) {
  const { triangles, thickness } = modelShape(drawable);
  if (!triangles) return "в модели нет ни одного треугольника";
  if (triangles < MIN_TRIANGLES) return `в модели меньше ${MIN_TRIANGLES} треугольников (всего ${triangles}) — это заглушка, а не вещь`;
  if (thickness < FLAT_RATIO) return "модель плоская: все вершины лежат в одной плоскости, это лист, а не вещь";
  return null;
}
