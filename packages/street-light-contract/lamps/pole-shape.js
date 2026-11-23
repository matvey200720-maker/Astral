/*
 * Где у фонаря столб — по сетке самой модели.
 *
 * Украшения обвивают столб, а столбы у фонарей разные: девятиметровая
 * мачта с консолью, четырёхметровый парковый, бетонный, старинный. Чисел
 * «ось тут, высота столько» в файле нет, поэтому столб находится так, как
 * его увидел бы человек с рулеткой: модель режется горизонтальными
 * плоскостями, и на каждой высоте берётся срез — где плоскость пересекает
 * треугольники. Столб — то, что стоит на одной оси много срезов подряд и
 * тонко: на этой оси срезы дают маленький круг, а консоль, плафон и
 * основание — широкие пятна или срезы в стороне.
 *
 * Вершин у столба мало (цилиндр — это кольцо внизу и кольцо вверху), поэтому
 * считаются не вершины, а пересечения рёбер с плоскостью: срез честный на
 * любой высоте. Всё — в осях модели (Z вверх), в метрах.
 *
 * Чистые функции: их зовут и установщик (по модели игрока), и тесты.
 */

/* Сколько срезов по высоте: шаг ~20 см у девятиметрового фонаря. */
const SLICES = 48;
/* Точка среза относится к столбу, если она ближе этого к оси. */
const NEAR_AXIS = 0.45;
/* Столб тоньше этого радиуса; шире — основание, плафон, консоль. */
const MAX_POLE_RADIUS = 0.26;
/* Короче этого столба нет: украшать нечего. */
const MIN_POLE_SPAN = 1.2;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/* Точки, где плоскость z = h пересекает рёбра треугольника. */
function sliceTriangle(a, b, c, h, out) {
  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ];
  for (const [p, q] of edges) {
    const dp = p[2] - h;
    const dq = q[2] - h;
    if ((dp < 0 && dq < 0) || (dp > 0 && dq > 0) || dp === dq) continue;
    const t = dp / (dp - dq);
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
}

/**
 * Треугольники модели из сеток `[{ positions, indices }]` (позиции — тройки
 * в осях модели, Z вверх). Возвращает массив `[a, b, c]` точек.
 */
export function meshTriangles(meshes) {
  const triangles = [];
  for (const mesh of meshes || []) {
    const positions = mesh?.positions;
    const indices = mesh?.indices;
    if (!positions || !indices) continue;
    const point = (index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
    for (let at = 0; at + 2 < indices.length; at += 3)
      triangles.push([point(indices[at]), point(indices[at + 1]), point(indices[at + 2])]);
  }
  return triangles;
}

/**
 * Столб модели по её треугольникам: `{ axis: [x, y], bottom, top, radius,
 * profile: [[z, r], …], base, height }` или `null`, если столба нет (настенный
 * фонарь, кронштейн). `bottom`/`top` — где столб тонкий и цельный: над
 * основанием и под консолью; `profile` — радиус столба по высоте (срезы).
 */
export function poleProfile(triangles) {
  if (!Array.isArray(triangles) || !triangles.length) return null;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const triangle of triangles)
    for (const point of triangle) {
      if (point[2] < zMin) zMin = point[2];
      if (point[2] > zMax) zMax = point[2];
    }
  const height = zMax - zMin;
  if (!(height > MIN_POLE_SPAN)) return null;

  const slices = [];
  for (let index = 0; index < SLICES; index += 1) {
    const z = zMin + height * ((index + 0.5) / SLICES);
    const points = [];
    for (const [a, b, c] of triangles) sliceTriangle(a, b, c, z, points);
    slices.push({ z, points });
  }

  /* Ось — по средним срезам: на середине высоты у фонаря режется только столб
     (у мачт светофоров ещё короба — их отсекает медиана и уточнение). */
  const middle = slices.filter((slice) => slice.z > zMin + height * 0.25 && slice.z < zMin + height * 0.75);
  const mid = middle.flatMap((slice) => slice.points);
  if (!mid.length) return null;
  let axis = [median(mid.map((point) => point[0])), median(mid.map((point) => point[1]))];
  for (let pass = 0; pass < 2; pass += 1) {
    const near = mid.filter((point) => Math.hypot(point[0] - axis[0], point[1] - axis[1]) < NEAR_AXIS);
    if (!near.length) return null;
    axis = [
      near.reduce((sum, point) => sum + point[0], 0) / near.length,
      near.reduce((sum, point) => sum + point[1], 0) / near.length,
    ];
  }

  /* Радиус среза у оси; нет точек у оси — столба на этой высоте нет. */
  const rings = slices.map((slice) => {
    const near = slice.points.filter((point) => Math.hypot(point[0] - axis[0], point[1] - axis[1]) < NEAR_AXIS);
    if (!near.length) return { z: slice.z, radius: null };
    const radius = Math.max(...near.map((point) => Math.hypot(point[0] - axis[0], point[1] - axis[1])));
    return { z: slice.z, radius };
  });

  /* Самая длинная цельная часть тонкого столба. */
  let best = null;
  let start = -1;
  for (let index = 0; index <= rings.length; index += 1) {
    const ring = rings[index];
    const thin = ring && ring.radius !== null && ring.radius <= MAX_POLE_RADIUS;
    if (thin && start < 0) start = index;
    if (!thin && start >= 0) {
      const run = { from: start, to: index - 1 };
      if (!best || run.to - run.from > best.to - best.from) best = run;
      start = -1;
    }
  }
  if (!best) return null;
  const step = height / SLICES;
  const bottom = rings[best.from].z - step / 2;
  const top = rings[best.to].z + step / 2;
  if (top - bottom < MIN_POLE_SPAN) return null;
  const profile = rings.slice(best.from, best.to + 1).map((ring) => [round(ring.z), round(ring.radius)]);
  const radius = median(profile.map(([, r]) => r));
  /* Основание: самый широкий срез у оси ниже столба (если он есть). */
  const below = rings.slice(0, best.from).filter((ring) => ring.radius !== null);
  const base = below.length ? round(Math.max(...below.map((ring) => ring.radius))) : null;
  return {
    axis: [round(axis[0]), round(axis[1])],
    bottom: round(bottom),
    top: round(top),
    radius: round(radius),
    base,
    height: round(height),
    ground: round(zMin),
    profile,
  };
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/** Радиус столба на высоте `z` по профилю (между срезами — по прямой). */
export function poleRadiusAt(profile, z) {
  const rows = profile?.profile;
  if (!rows?.length) return profile?.radius || 0.1;
  if (z <= rows[0][0]) return rows[0][1];
  for (let index = 1; index < rows.length; index += 1) {
    const [z1, r1] = rows[index];
    if (z <= z1) {
      const [z0, r0] = rows[index - 1];
      const t = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
      return r0 + (r1 - r0) * t;
    }
  }
  return rows[rows.length - 1][1];
}
