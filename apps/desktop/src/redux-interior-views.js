/*
 * Ракурсы обложки и галереи интерьера редукса (13.11.2026, sad redux (5rp): 11 интерьеров `v_int_<N>` — оружейный, тату-салон, парикмахерская, магазин, заправка…).
 *
 * Комната — не зал стадиона: пять-десять метров, стена всегда рядом, потолок над головой. Поэтому позы выбираются по самим сеткам комнаты (`hallScene`-образный набор
 * `{ stem, positions, indices }`, как у `arena-stadium-views.js`), но мерки комнатные: глаз стоит на полу (1,65 м над любым этажом, где пола много) под потолком, курсов
 * шестнадцать, кадр оценивается мелким z-буфером (`arena-view-plan.js: rasterize`) — не «в стену» (десятый процентиль глубины), не сквозь стену (задние грани), не пустой
 * (небо в проёме) и не одна поверхность; лучший — тот, где больше моделей автора, разнообразие и глубина комнаты. Окно снимает эти позы тем же съёмщиком зала арены
 * (`stadiumFrames`: `frames` — галерея, `coverPool` — из него окно берёт обложку по картинке, где комната не чёрная, `candidates` — добор галереи).
 *
 * Свет и цвет здесь не трогаются: это геометрия.
 */

import { buildRaster, rasterize } from "./arena-view-plan.js";
import { floorPoints, spreadPoints } from "./arena-stadium-views.js";

export const INTERIOR_FOV = 80;
/* Высота глаза над полом и наклон: почти горизонтально, чтобы в кадре были и стены, и пол, и потолок. */
export const EYE_HEIGHT = 1.65;
const PITCH = 0.02;
const YAWS = 16;
const EYES = 60;
/* Мелкий кадр оценки. */
const SIZE = Object.freeze({ width: 96, height: 64 });
/* Над глазом потолок: не вплотную и не выше этого (м) — иначе пол на крыше или под открытым небом. */
const CEILING_MIN = 0.35;
const CEILING_MAX = 6;
const CEILING_SHARE = 0.7;
/* Пол — не любая плоскость лицом вверх (столешница, полка, ступень): этаж берётся там, где такой поверхности больше всего. */
const LEVEL_STEP = 0.2;
const LEVEL_SHARE = 0.3;
/* Критерии «кадр годится». */
export const NEAR_P10 = 0.75;
const NEAR_CENTRE = 0.9;
const BACK_SHARE = 0.03;
const HOLE_SHARE = 0.35;
const MIN_STEMS = 4;
const TOP_STEM = 0.8;
/* Серая болванка (материал без листа ни у автора, ни в игре) в кадре: больше этой доли видимых точек — кадр не годится (владелец 13.11.2026: «текстурки один в один, как в игре»). */
export const BARE_SHARE = 0.01;
/* Глубина комнаты в кадре: девяностый процентиль от и до (м) — меньше теснота, больше «дальше не нужно». */
const DEPTH_FROM = 1.5;
const DEPTH_SPAN = 5;
/* Близнецы: глаз ближе (м) и курс ближе (рад); общие модели в кадре. */
const TWIN_GAP = 1.2;
const TWIN_TURN = 1;
const ALONG_TURN = 0.35;
const ALONG_GAP = 4;
const SAME_VIEW = 0.8;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const turnOf = (one, other) =>
  Math.abs(Math.atan2(Math.sin(one - other), Math.cos(one - other)));

/** Метрики кадра z-буфера (`rasterize`): глубина по процентилям, доли пустого, задних граней, своих моделей автора и разнообразие. */
export function roomMetrics(raster, pose, ownOf, size = SIZE, bareOf = null) {
  const { depth, hit, behind, width, height } = rasterize(raster, pose, size);
  const total = width * height;
  const left = Math.floor(width * 0.25);
  const right = Math.ceil(width * 0.75);
  const top = Math.floor(height * 0.25);
  const bottom = Math.ceil(height * 0.75);
  const depths = [];
  const counts = new Map();
  let holes = 0;
  let back = 0;
  let own = 0;
  let bare = 0;
  let nearCentre = Infinity;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (behind[at]) back += 1;
      if (hit[at] < 0) {
        holes += 1;
        continue;
      }
      const z = depth[at];
      depths.push(z);
      if (x >= left && x < right && y >= top && y < bottom && z < nearCentre)
        nearCentre = z;
      counts.set(hit[at], (counts.get(hit[at]) || 0) + 1);
      if (ownOf[hit[at]]) own += 1;
      if (bareOf?.[hit[at]]) bare += 1;
    }
  const seen = depths.length;
  depths.sort((one, other) => one - other);
  const stems = new Set();
  let top1 = 0;
  for (const [solid, count] of counts) {
    stems.add(raster.meta[solid].stem);
    if (count > top1) top1 = count;
  }
  return {
    hole: holes / total,
    back: back / total,
    nearCentre: seen ? nearCentre : 0,
    p10: seen ? depths[Math.floor(seen * 0.1)] : 0,
    p90: seen ? depths[Math.min(seen - 1, Math.floor(seen * 0.9))] : 0,
    own: seen ? own / seen : 0,
    bare: seen ? bare / seen : 0,
    stems: stems.size,
    stemList: stems,
    top: seen ? top1 / seen : 1,
  };
}

/**
 * Мерки по умолчанию — комната из десятков моделей: в кадре не меньше `minStems` разных, и ни одна не занимает больше `topStem` видимого. У зала, что собран из нескольких
 * крупных оболочек (казино в глухом коробе: комната — одна сетка на всё помещение), модель в кадре одна, и такой зал снимается с `minStems: 1, topStem: 1`; потолок у него
 * выше обычного (`ceilingMax`, м).
 */
export const ROOM_RULES = Object.freeze({
  minStems: MIN_STEMS,
  topStem: TOP_STEM,
  ceilingMax: CEILING_MAX,
});

/** Годится ли кадр: не «в стену», не сквозь стену, не пустой, не одна поверхность и без серых болванок. */
export const roomUsable = (
  metrics,
  { minStems = MIN_STEMS, topStem = TOP_STEM } = {},
) =>
  metrics.bare <= BARE_SHARE &&
  metrics.p10 >= NEAR_P10 &&
  metrics.nearCentre >= NEAR_CENTRE &&
  metrics.back <= BACK_SHARE &&
  metrics.hole <= HOLE_SHARE &&
  metrics.stems >= minStems &&
  metrics.top <= topStem;

/** Оценка годного кадра: больше своих моделей автора, больше разных моделей, глубже комната; пустое и «вплотную» — минус. */
export function roomScore(metrics) {
  const deep = clamp((metrics.p90 - DEPTH_FROM) / DEPTH_SPAN, 0, 1);
  const variety =
    Math.min(1, metrics.stems / 10) * (1 - Math.max(0, metrics.top - 0.45));
  return (
    (0.35 + 0.65 * metrics.own) *
    (0.25 + 0.75 * variety) *
    (0.3 + 0.7 * deep) *
    (1 - metrics.hole * 0.6)
  );
}

/* Одна ли это картина: глаз рядом и курс близок, либо курс почти тот же вдоль прохода, либо в кадре почти те же модели. */
function twinOf(one, other) {
  const apart = Math.hypot(
    one.pose.eye[0] - other.pose.eye[0],
    one.pose.eye[1] - other.pose.eye[1],
    (one.pose.eye[2] - other.pose.eye[2]) * 2,
  );
  const turned = turnOf(one.pose.yaw, other.pose.yaw);
  if (apart < TWIN_GAP && turned < TWIN_TURN) return true;
  if (apart < ALONG_GAP && turned < ALONG_TURN) return true;
  const common = [...one.metrics.stemList].filter((stem) =>
    other.metrics.stemList.has(stem),
  ).length;
  const smaller = Math.min(
    one.metrics.stemList.size,
    other.metrics.stemList.size,
  );
  return (
    smaller > 0 &&
    common / smaller >= SAME_VIEW &&
    turned < TWIN_TURN * 1.5 &&
    apart < ALONG_GAP * 1.5
  );
}

const lookAt = (eye, yaw, pitch = PITCH, fov = INTERIOR_FOV) => ({
  eye: eye.map((value) => Math.round(value * 100) / 100),
  yaw: Math.round(yaw * 1000) / 1000,
  pitch,
  fov,
});

/**
 * Места для глаз: центры пола на этажах, где его больше всего (`LEVEL_SHARE` от самого большого), равномерно по комнате; у каждого над головой потолок.
 * @param {object[]} solids сетки комнаты
 * @param {object} raster z-буфер комнаты (`buildRaster`)
 */
export function eyePlaces(
  solids,
  raster,
  { eyes = EYES, ceilingMax = CEILING_MAX } = {},
) {
  const floor = floorPoints(solids, { cell: 1, minArea: 0.9 });
  if (!floor.length) return [];
  const area = new Map();
  for (const point of floor) {
    const level = Math.round(point.z / LEVEL_STEP);
    area.set(level, (area.get(level) || 0) + point.area);
  }
  const biggest = Math.max(...area.values());
  const levels = new Set(
    [...area]
      .filter(([, sum]) => sum >= biggest * LEVEL_SHARE)
      .map(([level]) => level),
  );
  const onLevels = floor.filter((point) =>
    levels.has(Math.round(point.z / LEVEL_STEP)),
  );
  const covered = [];
  for (const place of spreadPoints(onLevels, eyes)) {
    const eye = [place.x, place.y, place.z + EYE_HEIGHT];
    /* Вверх: мелкий кадр почти в зенит; потолок — когда над головой он закрывает почти весь кадр (одна лампа или полка над глазом — не потолок). */
    const up = rasterize(
      raster,
      { eye, yaw: 0, pitch: 1.5, fov: 70 },
      { width: 8, height: 8 },
    );
    let roofed = 0;
    for (let at = 0; at < up.hit.length; at += 1)
      if (
        up.hit[at] >= 0 &&
        up.depth[at] >= CEILING_MIN &&
        up.depth[at] <= ceilingMax
      )
        roofed += 1;
    if (roofed >= up.hit.length * CEILING_SHARE)
      covered.push({ ...place, eye });
  }
  return covered;
}

/**
 * Ракурсы комнаты: `{ cover, coverPool, frames, pool, report }` или `null`, если сеток нет или ни одна поза не годится.
 *   • `cover` — лучший кадр (`roomScore`); `coverPool` — он и ещё несколько непохожих: окно выберет из них по картинке, где комната не чёрная;
 *   • `frames` — кадры галереи: лучшие из непохожих на обложку и друг на друга (не больше `gallery`);
 *   • `pool` — остальные годные с весом `weight` (0…1): окно добирает ими галерею по картинке.
 * @param {{ solids: object[], ownStems?: Iterable<string>, gallery?: number, eyes?: number, yaws?: number, fov?: number, pitch?: number, rules?: { minStems?: number, topStem?: number, ceilingMax?: number } }} input
 *   `rules` — мерки зала (`ROOM_RULES`): у комнаты из десятков моделей они прежние, у зала из крупных оболочек — свои. `groupOf(поза)` — в какой комнате зала стоит глаз:
 *   кадры галереи берутся по одному из разных комнат, пока они есть.
 */
export function planInteriorViews({
  solids,
  ownStems = [],
  gallery = 3,
  eyes = EYES,
  yaws = YAWS,
  fov = INTERIOR_FOV,
  pitch = PITCH,
  rules = {},
  groupOf = null,
} = {}) {
  const solid = (solids || []).filter(
    (item) => !item.blend && item.indices?.length,
  );
  if (!solid.length) return null;
  const raster = buildRaster(solid);
  const own = new Set([...ownStems].map((stem) => String(stem).toLowerCase()));
  const ownOf = Uint8Array.from(raster.meta, (item) =>
    own.has(String(item.stem).toLowerCase()) ? 1 : 0,
  );
  /* Сетки растра идут в порядке `solid`: `bare` — у кого материал без листа. */
  const bareOf = Uint8Array.from(solid, (item) => (item.bare ? 1 : 0));
  const places = eyePlaces(solid, raster, {
    eyes,
    ...(rules.ceilingMax ? { ceilingMax: rules.ceilingMax } : {}),
  });
  const valid = [];
  let tried = 0;
  let bareBlocked = 0;
  for (const place of places)
    for (let side = 0; side < yaws; side += 1) {
      const pose = lookAt(place.eye, (side * 2 * Math.PI) / yaws, pitch, fov);
      const metrics = roomMetrics(raster, pose, ownOf, SIZE, bareOf);
      tried += 1;
      if (roomUsable(metrics, rules))
        valid.push({ pose, metrics, score: roomScore(metrics) });
      else if (
        metrics.bare > BARE_SHARE &&
        roomUsable({ ...metrics, bare: 0 }, rules)
      )
        bareBlocked += 1;
    }
  const report = [
    {
      id: "candidates",
      places: places.length,
      poses: tried,
      usable: valid.length,
      bareBlocked,
    },
  ];
  if (!valid.length)
    return { cover: null, coverPool: [], frames: [], pool: [], report };

  const byScore = [...valid].sort((left, right) => right.score - left.score);
  const cover = byScore[0];
  const picked = [cover];
  const free = (item) => !picked.some((other) => twinOf(item, other));
  /* Галерея — не похожие на лучший кадр и друг на друга; обложка на выбор окна — он и непохожие на галерею, чтобы выбранная по картинке обложка не повторила кадр галереи. */
  const frames = [];
  /* Зал из нескольких комнат (`groupOf` — в какой комнате стоит глаз): сначала лучший кадр каждой другой комнаты, и лишь потом повторы, чтобы галерея не осталась в самой большой. */
  const shown = new Set(groupOf ? [groupOf(cover.pose)] : []);
  if (groupOf)
    for (const item of byScore) {
      if (frames.length >= gallery) break;
      const group = groupOf(item.pose);
      if (shown.has(group) || !free(item)) continue;
      shown.add(group);
      picked.push(item);
      frames.push(item);
    }
  for (const item of byScore) {
    if (frames.length >= gallery) break;
    if (!free(item)) continue;
    picked.push(item);
    frames.push(item);
  }
  const coverPool = [cover];
  for (const item of byScore) {
    if (coverPool.length >= 4) break;
    if (
      picked.includes(item) ||
      !free(item) ||
      coverPool.some((other) => twinOf(item, other))
    )
      continue;
    coverPool.push(item);
  }
  const pool = [];
  for (const item of byScore) {
    if (pool.length >= 12) break;
    if (
      picked.includes(item) ||
      !free(item) ||
      coverPool.some((other) => twinOf(item, other)) ||
      pool.some((other) => twinOf(item, other))
    )
      continue;
    pool.push(item);
  }
  const top = byScore[0].score || 1;
  const weighted = (item) => ({
    ...item.pose,
    weight:
      Math.round(clamp(0.4 + 0.6 * (item.score / top), 0.4, 1) * 100) / 100,
  });
  return {
    cover: cover.pose,
    coverPool: coverPool.map(weighted),
    frames: frames.map((item) => item.pose),
    pool: pool.map(weighted),
    report: [
      ...report,
      {
        id: "cover",
        p10: Math.round(cover.metrics.p10 * 10) / 10,
        p90: Math.round(cover.metrics.p90 * 10) / 10,
        own: Math.round(cover.metrics.own * 100) / 100,
        stems: cover.metrics.stems,
      },
      {
        id: "frames",
        picked: frames.length,
        pool: pool.length,
        ...(groupOf ? { rooms: shown.size } : {}),
      },
    ],
  };
}
