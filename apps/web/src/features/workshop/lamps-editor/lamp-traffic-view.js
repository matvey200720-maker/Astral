/*
 * Светофор кадра фонаря: мачта с консолью над дорогой и короба сигналов.
 *
 * Владелец (ТЗ 11.10.2026): «сделать чтобы светофоры тоже меняли свой цвет
 * на перекрёстках». Краска столбов ложится и на мачты светофоров (вид
 * «Светофоры», `pole.js` контракта), и кадр должен это показывать: слева
 * за фонарём, у перекрёстка, стоит мачта с консолью над дорогой, под консолью
 * и на мачте — короба сигналов. Мачта и консоль — в краске вида «Светофоры»
 * (средний цвет листа после той же краски, `poleMeanColour`), с тем же
 * блеском и прозрачностью; короба и линзы — как в игре: в игре красится
 * только область мачты на общем листе (`POLE_SHEET_AREAS`), и в кадре
 * короба тёмные, а красный, жёлтый и зелёный не перекрашиваются.
 *
 * Светофор нарисован Astral, как и весь кадр. Горит красный: один огонь
 * читается как светофор, три горящих — как гирлянда.
 *
 * Здесь — геометрия и пересечения (оси сцены: метры, Z вверх, камера
 * смотрит вдоль +Y); свет на них считают `lamp-view.js` на процессоре и
 * `lamp-scene-shader.js` на видеокарте теми же числами.
 */

/*
 * Пропорции `prop_traffic_01a` по срезам модели: мачта ~0,3 м толщиной,
 * консоль на высоте ~5,8 м, короба сигналов метр высотой. Мачта — в 4,6 м
 * левее плафона и в семи метрах за фонарём: в кадрах «Фонарь» и «Столб» она не
 * заслоняет ни столб, ни плафон, и пятно лампы до неё достаёт.
 */
export const TRAFFIC_GEOMETRY = Object.freeze({
  mast: Object.freeze({ x: -4.6, y: 7, radius: 0.14, height: 6.3, base: 0.24, baseHeight: 0.35 }),
  arm: Object.freeze({ from: Object.freeze([-4.6, 7, 5.8]), to: Object.freeze([0.1, 7, 5.8]), radius: 0.075 }),
  /* Центры коробов: два под консолью над дорогой, один на мачте. */
  heads: Object.freeze([
    Object.freeze([-0.5, 7, 5.22]),
    Object.freeze([-2.5, 7, 5.22]),
    Object.freeze([-4.6, 6.78, 3.0]),
  ]),
  /* Полуразмеры короба (ширина, глубина, высота). */
  head: Object.freeze([0.19, 0.14, 0.5]),
  /* Линзы на передней грани (смотрит на камеру, −Y): радиус и шаг по высоте. */
  lens: Object.freeze({ radius: 0.11, step: 0.31 }),
});

/*
 * Сигналы сверху вниз: красный, жёлтый, зелёный (линейные цвета). Горящий —
 * ярко, как стекло дальнего огня; погасшие — тускло, но своим цветом: так
 * видно, что это светофор, а не лампа.
 */
export const TRAFFIC_SIGNALS = Object.freeze([
  Object.freeze([1, 0.025, 0.015]),
  Object.freeze([1, 0.5, 0.02]),
  Object.freeze([0.03, 1, 0.4]),
]);
export const TRAFFIC_LIT = 0;
export const TRAFFIC_LIT_GLOW = 1.6;
export const TRAFFIC_DIM_GLOW = 0.03;
/* Короб сигналов — тёмный металл: его лист в игре темнее мачты в шесть раз. */
export const TRAFFIC_HOUSING = 0.18;

/** Свечение линз сверху вниз — у горящей свой цвет ярко, у остальных тускло. */
export const trafficLensGlow = () =>
  TRAFFIC_SIGNALS.map((colour, index) =>
    colour.map((value) => value * (index === TRAFFIC_LIT ? TRAFFIC_LIT_GLOW : TRAFFIC_DIM_GLOW)),
  );

/* Знаменатель без нуля: луч вдоль грани не даёт NaN (тот же приём в шейдере). */
const safe = (value) => (Math.abs(value) < 1e-8 ? 1e-8 : value);

function hitCylinder(origin, dir, x, y, radius, z0, z1) {
  const ox = origin[0] - x;
  const oy = origin[1] - y;
  const a = dir[0] * dir[0] + dir[1] * dir[1];
  if (a < 1e-9) return Infinity;
  const b = ox * dir[0] + oy * dir[1];
  const c = ox * ox + oy * oy - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t <= 0) return Infinity;
  const z = origin[2] + dir[2] * t;
  return z >= z0 && z <= z1 ? t : Infinity;
}

function hitCapsule(origin, dir, a, b, radius) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const baba = dot(ba, ba);
  const bard = dot(ba, dir);
  const baoa = dot(ba, oa);
  const rdoa = dot(dir, oa);
  const oaoa = dot(oa, oa);
  const qa = baba - bard * bard;
  const qb = baba * rdoa - baoa * bard;
  const qc = baba * oaoa - baoa * baoa - radius * radius * baba;
  const h = qb * qb - qa * qc;
  if (h >= 0 && qa > 1e-9) {
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (t > 0 && y > 0 && y < baba) return t;
  }
  return Infinity;
}

/* Короб по осям: центр, полуразмеры. `{ t, normal }` или `null`. */
function hitBox(origin, dir, centre, half) {
  let near = -Infinity;
  let far = Infinity;
  let axis = 0;
  for (let index = 0; index < 3; index += 1) {
    const inverse = 1 / safe(dir[index]);
    const a = (centre[index] - half[index] - origin[index]) * inverse;
    const b = (centre[index] + half[index] - origin[index]) * inverse;
    const low = Math.min(a, b);
    if (low > near) {
      near = low;
      axis = index;
    }
    far = Math.min(far, Math.max(a, b));
  }
  if (near > far || near <= 0) return null;
  const normal = [0, 0, 0];
  normal[axis] = dir[axis] > 0 ? -1 : 1;
  return { t: near, normal };
}

/*
 * Ближайшая часть светофора на луче: `{ t, part, normal, lens }` или
 * `null`. `part` — `mast` (мачта, фланец, консоль: краска вида), `housing`
 * (короб) или `lens` (линза, `lens` — её номер сверху вниз).
 */
export function hitTraffic(origin, dir, g = TRAFFIC_GEOMETRY) {
  let best = null;
  const take = (t, part, normal, lens = -1) => {
    if (t < (best?.t ?? Infinity)) best = { t, part, normal, lens };
  };
  const radial = (t) => {
    const p = [origin[0] + dir[0] * t - g.mast.x, origin[1] + dir[1] * t - g.mast.y];
    const length = Math.hypot(...p) || 1;
    return [p[0] / length, p[1] / length, 0];
  };
  const tMast = hitCylinder(origin, dir, g.mast.x, g.mast.y, g.mast.radius, 0, g.mast.height);
  if (Number.isFinite(tMast)) take(tMast, "mast", radial(tMast));
  const tBase = hitCylinder(origin, dir, g.mast.x, g.mast.y, g.mast.base, 0, g.mast.baseHeight);
  if (Number.isFinite(tBase)) take(tBase, "mast", radial(tBase));
  const tArm = hitCapsule(origin, dir, g.arm.from, g.arm.to, g.arm.radius);
  if (Number.isFinite(tArm)) take(tArm, "mast", [0, -0.6, 0.8]);
  for (const centre of g.heads) {
    const hit = hitBox(origin, dir, centre, g.head);
    if (!hit || hit.t >= (best?.t ?? Infinity)) continue;
    let lens = -1;
    if (hit.normal[1] < -0.5) {
      const x = origin[0] + dir[0] * hit.t - centre[0];
      const z = origin[2] + dir[2] * hit.t - centre[2];
      for (let index = 0; index < 3; index += 1) {
        const dz = z - g.lens.step * (1 - index);
        if (x * x + dz * dz < g.lens.radius * g.lens.radius) lens = index;
      }
    }
    take(hit.t, lens >= 0 ? "lens" : "housing", hit.normal, lens);
  }
  return best;
}
