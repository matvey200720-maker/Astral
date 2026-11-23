/*
 * Ракурсы кадра обложки арены Majestic (27.10.2026, «обложки зала Majestic со стороны трибун»).
 *
 * Зал Majestic собирается из файлов сервера и мода (`arena-hall-cover.js`: папка, `mazearena_int_3.ytyp`), и оси у него свои — осями
 * интерьера, а не штатной сцены, на которую посажен глаз кадра GTA 5 RP. Поэтому камеры считает главный процесс и отдаёт окну
 * (`arena.json`: `frames` — кадры, которые снимаются всегда, `candidates` — пул, из которого окно берёт лучшие по картинке,
 * `arena-frame-score.js`). Поза камеры — `{ eye, yaw, pitch, fov }`, `look = (sin yaw·cos pitch, cos yaw·cos pitch, sin pitch)`, Z вверх.
 *
 * Зал — круглая арена (`mj_ma_int3_rm2_*`): центр `(-9,5; 0; -6)`, пол круга на `z = -6`, ступени-трибуны поднимаются к входам с востока
 * (`x ≈ +1,5`) и с запада (`x ≈ -19`), над кругом — кольцо потолка. Оболочка у модов своя (VEX REDUX — другая), потому камеры не заданы
 * поштучно: пул — вид на круг с кольца вокруг него, от входов и из центра на трибуны; плохие кадры (стена вплотную, пустота) отсеивает оценка.
 *
 * Со своей моделью автора в круге (звезда) первые кадры — на неё со стороны входа и с боков (`frames`), общие виды берутся из пула.
 */

/** Центр круга и глаз у входа (верх ступеней, восток). */
export const MAJESTIC_CENTRE = Object.freeze([-9.5, 0, -6]);
export const MAJESTIC_ENTRANCE = Object.freeze([1.5, 0, -2.5]);

const PI = Math.PI;
/* Сколько кадров всего (обложка + галерея) снимается из пула. */
export const MAJESTIC_FRAMES = 6;

/* Вес кадра при выборе: вид на круг с трибун — лучшая обложка, от входов — хуже, из центра на трибуны — для галереи. */
const WEIGHT = Object.freeze({ ring: 1, entrance: 0.5, outward: 0.3 });

/** Взгляд из `eye` в точку `target`. */
function lookAt(eye, target, fov = 72, weight = 1) {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  return { eye: [...eye], yaw: Math.atan2(dx, dy), pitch: Math.atan2(dz, Math.hypot(dx, dy)), fov, weight };
}

/**
 * Пул кандидатов: вид на круг (его центр чуть ниже взгляда) с кольца вокруг центра — две дальности, две высоты, восемь сторон; от входов
 * на круг и в соседние залы; из центра круга на трибуны вокруг.
 */
export function majesticCandidates() {
  const [cx, cy, cz] = MAJESTIC_CENTRE;
  const pool = [];
  for (const radius of [6, 9.5])
    for (const height of [-3, -1])
      for (let side = 0; side < 8; side += 1) {
        const angle = (side * PI) / 4;
        pool.push(lookAt([cx + Math.sin(angle) * radius, cy + Math.cos(angle) * radius, height], [cx, cy, cz + 1], 72, WEIGHT.ring));
      }
  pool.push({ eye: [1.5, 0, -2.5], yaw: -PI / 2, pitch: 0.05, fov: 72, weight: WEIGHT.entrance });
  pool.push({ eye: [-19, 0, -2.5], yaw: PI / 2, pitch: 0.05, fov: 72, weight: WEIGHT.entrance });
  pool.push({ eye: [0, 12, -2], yaw: 0, pitch: 0, fov: 72, weight: WEIGHT.entrance });
  pool.push({ eye: [0, -12, -2], yaw: PI, pitch: 0, fov: 72, weight: WEIGHT.entrance });
  for (let side = 0; side < 8; side += 1) pool.push({ eye: [cx, cy, -3], yaw: (side * PI) / 4, pitch: 0.05, fov: 72, weight: WEIGHT.outward });
  return pool;
}

/*
 * Обложка Majestic — зал на высоте глаза (28.10.2026, круг 5, `ref/26`: «внутри холла, на высоте глаз, широкий угол»). Оболочка у модов своя, и одна поза на все
 * арены то стоит в стене, то смотрит в пустоту, поэтому обложка — лучший по картинке из ряда поз на высоте глаза вокруг круга: восемь сторон, глаз 1,7 м над полом
 * круга, взгляд в круг, угол 80°. Окно снимает их мелко и берёт один (`arena-frame-score.js`); остальные кадры — галерея.
 */
const COVER_EYE = 1.7;
const COVER_RADIUS = 11;
export function majesticCoverPool() {
  const [cx, cy, cz] = MAJESTIC_CENTRE;
  const floor = cz;
  const pool = [];
  for (let side = 0; side < 8; side += 1) {
    const angle = (side * PI) / 4;
    pool.push(lookAt([cx + Math.sin(angle) * COVER_RADIUS, cy + Math.cos(angle) * COVER_RADIUS, floor + COVER_EYE], [cx, cy, floor + 1.5], 80, 1));
  }
  return pool;
}

/* Кадров галереи, когда есть витрина автора (`arena-view-plan.js`): позы витрины и три общих; в галерее не больше двенадцати. */
export const MAJESTIC_SHOWCASE_MAX = 12;
export const MAJESTIC_SHOWCASE_POOL = 3;

/** Три ракурса на звезду: от входа и с боков (поворот вокруг звезды, рад) и расстояние до неё, м. */
const STAR_VIEWS = Object.freeze([
  Object.freeze({ turn: 0, distance: 8 }),
  Object.freeze({ turn: 0.6, distance: 8.5 }),
  Object.freeze({ turn: -0.6, distance: 8.5 }),
]);

/* Высота глаза над землёй под звездой: со ступеней, не с пола круга. */
const EYE_RISE = 3.4;
/* Взгляд — не в основание звезды, а выше: статуя — по грудь, табличка — по центру. */
const LOOK_RISE = 1.4;
const DEFAULT_SIZE = 2;

/** Расстояние до звезды: ближе для малых моделей (но не ближе 2,5 м), дальше для больших. */
export function majesticDistance(view, size = DEFAULT_SIZE) {
  return Math.max(2.5, Math.min(view.distance, 1.5 + size * 2.2));
}

/** Поза камеры на звезду `star` (`{ at: [x, y, z], size? }`) со стороны входа, повёрнутая вокруг неё на `turn`. */
export function majesticStarFrame(star, { turn = 0, distance = 8, fov = 72 } = {}) {
  const [sx, sy, sz] = star.at;
  const from = Math.atan2(MAJESTIC_ENTRANCE[0] - sx, MAJESTIC_ENTRANCE[1] - sy) + turn;
  const eye = [sx + Math.sin(from) * distance, sy + Math.cos(from) * distance, sz + EYE_RISE];
  return lookAt(eye, [sx, sy, sz + Math.min(LOOK_RISE, (star.size || DEFAULT_SIZE) / 2)], fov);
}

/**
 * Кадры арены Majestic для окна: `frames` — снимаются всегда, `candidates` — пул, `take` — сколько кадров всего, `cover` — поза обложки (если есть).
 * `plan` — позы на звезду и витрину автора, выбранные по сетке зала (`arena-view-plan.js: planMajesticViews`): они в `frames` вместо слепых кадров на звезду
 * (`majesticStarFrame` — только когда сетки зала нет), а обложка — `plan.cover`; без `plan.cover` обложку берёт оценка из `coverPool`, и звезда идёт первым кадром галереи.
 */
export function majesticFrames({ star = null, plan = null } = {}) {
  const planned = Array.isArray(plan?.frames) && plan.frames.length > 0;
  const blind = star?.at && star.from !== "none" ? STAR_VIEWS.map((view) => majesticStarFrame(star, { turn: view.turn, distance: majesticDistance(view, star.size) })) : [];
  const frames = planned ? plan.frames : blind;
  return {
    frames,
    candidates: majesticCandidates(),
    take: planned ? Math.min(MAJESTIC_SHOWCASE_MAX, Math.max(MAJESTIC_FRAMES, frames.length + MAJESTIC_SHOWCASE_POOL)) : MAJESTIC_FRAMES,
    coverPool: majesticCoverPool(),
    ...(plan?.cover ? { cover: plan.cover } : {}),
  };
}
