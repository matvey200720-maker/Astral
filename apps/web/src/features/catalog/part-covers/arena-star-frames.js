/*
 * Кадры обложки арены, нацеленные на звезду автора (26.10.2026, «арены один в один»).
 *
 * Владелец: кадр арены — со стороны трибун, звезда (или модель автора) в центре зала в кадре. Раньше обложка смотрела по общему
 * развороту от глаза штатной сцены (`ARENA_HALL_TURNS`): звезда выходила маленькой у края. Здесь камера стоит от звезды на `distance`
 * метров — со стороны, где глаз штатной сцены (вход и ряды), повёрнута вокруг звезды на `turn` — и смотрит на неё.
 * Оси — зала (Z вверх, `look = (sin yaw, cos yaw)`, как у `stage-camera.js`).
 */

/** Три ракурса на звезду: прямо со стороны трибун и сбоку с обеих сторон (расстояние в метрах, поворот вокруг звезды в радианах). */
export const STAR_VIEWS = Object.freeze([
  Object.freeze({ turn: 0, distance: 9 }),
  Object.freeze({ turn: 0.55, distance: 9.5 }),
  Object.freeze({ turn: -0.55, distance: 9.5 }),
]);

const EYE_HEIGHT = 1.7;
/* Взгляд — не в основание, а выше: у звезды ~5 м (statue), у дерева и реквизита — по пояс. */
const LOOK_RISE = 2;

/* Размер звезды неизвестен — по статуе (5 м): кадр с расстояния ракурса. */
const DEFAULT_SIZE = 5;

/**
 * Расстояние до звезды: ракурс рассчитан на статую в 5 м; модель меньше — подходим (но не ближе 2,5 м), больше — не дальше ракурса.
 */
export function distanceFor(view, size = DEFAULT_SIZE) {
  return Math.max(2.5, Math.min(view.distance, 1.3 + size * 2.2));
}

/** Звезда меньше этого (м) — табличка, а не статуя: со стороны входа её может не быть видно, ракурс подбирается по картинке (`starRing`). */
export const SMALL_STAR = 1.5;

/* Вектор `vector` — вращением `[x, y, z, w]` (кватернион, как хранит размещение зала). */
function rotate(vector, [qx, qy, qz, qw]) {
  const [x, y, z] = vector;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

/**
 * Кандидаты на малую звезду: кольцо вокруг неё — стороны, расстояния и высоты глаза; каждый кадр смотрит на звезду. Окно снимает их мелко и берёт те, где
 * центр кадра богат деталями (`arena-frame-score.js`): белая табличка на белом полу в кадре со стороны входа не видна, а на фоне тёмной стены — видна.
 */
export function starRing({ star, distances = [2.5, 4, 6], heights = [1, 1.7, 2.6], sides = 12, fov = 72 }) {
  const [sx, sy, sz] = star.at;
  const rise = Math.min(LOOK_RISE, (star.size || DEFAULT_SIZE) / 2);
  const views = [];
  /* Плоская табличка видна «в лоб» только со стороны её нормали: Blink x Skye положил `hatemod` плашмя в метре над полом — с высоты глаза со стороны
     входа она видна ребром. Нормаль — ось толщины модели (игровая Y), повёрнутая вращением размещения; кадры с обеих её сторон — с большим весом. */
  const normal = star.rotation ? rotate([0, 1, 0], star.rotation) : null;
  if (normal)
    for (const sign of [1, -1])
      for (const distance of [1.4, 2, 2.8]) {
        const eye = [sx + normal[0] * sign * distance, sy + normal[1] * sign * distance, sz + normal[2] * sign * distance];
        if (eye[2] < 0.8) continue;
        /* Строго над табличкой смотреть незачем (оси взгляда нет): чуть в сторону. */
        const skew = Math.hypot(eye[0] - sx, eye[1] - sy) < 0.3 ? 0.35 : 0;
        const from = [eye[0] + skew, eye[1], eye[2]];
        const dx = sx - from[0];
        const dy = sy - from[1];
        views.push({ eye: from, yaw: Math.atan2(dx, dy), pitch: Math.atan2(sz - from[2], Math.hypot(dx, dy)), fov, weight: 1.6 });
      }
  for (const distance of distances)
    for (const height of heights)
      for (let side = 0; side < sides; side += 1) {
        const angle = (side * 2 * Math.PI) / sides;
        const eye = [sx + Math.sin(angle) * distance, sy + Math.cos(angle) * distance, height];
        const dx = sx - eye[0];
        const dy = sy - eye[1];
        views.push({ eye, yaw: Math.atan2(dx, dy), pitch: Math.atan2(sz + rise - eye[2], Math.hypot(dx, dy)), fov });
      }
  return views;
}

/**
 * Поза камеры `{ eye, yaw, pitch, fov }` для звезды `star` (`{ at: [x, y, z] }`) со стороны `home` (глаз штатной сцены, `[x, y, z]`).
 */
export function starFrame({ star, home, turn = 0, distance = 9, fov = 72 }) {
  const [sx, sy, sz] = star.at;
  const rise = Math.min(LOOK_RISE, (star.size || DEFAULT_SIZE) / 2);
  const from = Math.atan2(home[0] - sx, home[1] - sy) + turn;
  const eye = [sx + Math.sin(from) * distance, sy + Math.cos(from) * distance, EYE_HEIGHT];
  const dx = sx - eye[0];
  const dy = sy - eye[1];
  const dz = sz + rise - eye[2];
  return { eye, yaw: Math.atan2(dx, dy), pitch: Math.atan2(dz, Math.hypot(dx, dy)), fov };
}
