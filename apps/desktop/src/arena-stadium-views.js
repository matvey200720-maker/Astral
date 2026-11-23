/*
 * Ракурсы обложки и галереи стадиона GTA 5 RP — зал Maze Bank Arena (`v_int_62`) с файлами мода (13.11.2026, HALLOWEN 240: «арену хорошо показать, чтобы полностью всё отображалось»).
 *
 * Прежде обложка стадиона была одной фиксированной позой (`ARENA_LOBBY_COVER`: восточный торец холла, взгляд вдоль коридора — правая половина кадра чёрная), а галерея — слепыми
 * разворотами от глаза штатной сцены, и часть кадров упиралась носом в стену или столб. Зал мода — не круг с одной звездой, как у Majestic: это лобби, туннели, телестудия на нижнем
 * уровне и лестницы между ними, и автор правит именно их. Поэтому позы выбираются по самому залу (`arena-view-plan.js`: сетки зала, мелкий кадр программным z-буфером): глаз стоит на полу
 * (1,7 м над любым из полов, что есть в сетках), курсов двенадцать, кадр оценивается по геометрии, а не по тому, как его нарисует окно.
 *
 * Кадр годится, если он не «в стену»: ближайшая точка в середине кадра дальше `NEAR_CENTRE` м, в кадре не больше `CLOSE_SHARE` ближних пикселей, камера не смотрит на задние грани,
 * пустого мало и видно не меньше трёх разных моделей. Обложка — самый широкий из годных (дальняя точка кадра, доля своих моделей автора, разнообразие); галерея — по лучшему кадру на
 * каждое «семейство» своих моделей автора (лобби, туннели, студия, лестницы), потом самые широкие из оставшихся, всё без близнецов. Свет и цвет здесь не трогаются: это геометрия.
 */

import { buildRaster, rasterize } from "./arena-view-plan.js";

export const STADIUM_FOV = 80;
/* Высота глаза над полом и наклон: чуть вниз, чтобы в кадре был пол, а не одни потолочные балки. */
const EYE_HEIGHT = 1.7;
const PITCH = 0.04;
const YAWS = 12;
/* Сколько глаз пробуется (по пространству и по этажам равномерно) и ячейка карты полов, м. */
const EYES = 220;
const CELL = 2;
/* Пол — поверхность лицевой гранью вверх не меньше этой площади в ячейке (метры квадратные): ступенька и карниз полом не считаются. */
const FLOOR_AREA = 3;
/* Критерии «кадр не в стену». */
export const NEAR_CENTRE = 1.5;
export const CLOSE_RANGE = 3;
export const CLOSE_SHARE = 0.4;
const BACK_SHARE = 0.03;
const HOLE_SHARE = 0.4;
const MIN_STEMS = 3;
/* Семейство в кадре, если занимает не меньше этой доли видимых пикселей. */
const FAMILY_SHARE = 0.08;
const TOP_STEM = 0.85;
/* «Широкий» кадр: девяностый процентиль глубины не меньше этого (м). */
export const WIDE_DEPTH = 11;
/* Близнецы: глаз ближе этого (м) при взгляде в ту же сторону (рад) — один кадр. */
const TWIN_GAP = 8;
const TWIN_TURN = 1;
const ALONG_GAP = 24;
const ALONG_TURN = 0.35;
const sameLevel = (one, other) => Math.abs(one.eye[2] - other.eye[2]) < 1.5;

/**
 * Семейства своих моделей зала: имя модели → семейство. Зал Maze Bank Arena: лобби (ярус пола 0), туннели, телестудия на нижнем ярусе и лестницы. Модель вне семейств в кадре
 * считается «залом» — она держит общий вид, но семейства не даёт.
 */
export const STADIUM_FAMILIES = Object.freeze([
  Object.freeze({
    id: "lobby",
    test: /^(v_62_(lob_det\d*|lobby_wall|signs\d*|barrier\d*|aud_[a-z0-9_]+)|v_ilev_stad_fdoor|v_ilev_serv_door\d+|prop_park_ticket_01|prop_vend_[a-z0-9_]+|prop_atm_\d+)$/,
    count: 2,
  }),
  Object.freeze({ id: "tunnel", test: /^v_62_tunnel_[a-z0-9_]+$/, count: 1 }),
  Object.freeze({
    id: "studio",
    test: /^(v_62_(curt[a-z0-9_]*|ceiling_rig|cables|studio_[a-z0-9]+|boom_mic|table|stage_dec\d+|tv_ovl|board\d+)|prop_(tv_cam|tv_flat|studio_light|kino_light|rub_table)_\d+)$/,
    count: 2,
  }),
  Object.freeze({ id: "stairs", test: /^v_62_stairs\d*$/, count: 1 }),
]);

/* Кадров галереи сверх «по семействам»: их добирает окно из пула по картинке. */
export const EXTRA_FRAMES = 2;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Карта полов: ячейки `CELL` м, в каждой уровни (z, округлённые до 0,2 м), на которых лежит не меньше `FLOOR_AREA` м² поверхности лицевой гранью вверх.
 * @param {{ positions: Float32Array, indices: ArrayLike<number>, blend?: boolean, doubleSided?: boolean }[]} solids
 * @returns {{ x: number, y: number, z: number, area: number }[]} центры полов (центр ячейки по площади, высота уровня)
 */
export function floorPoints(
  solids,
  { cell = CELL, minArea = FLOOR_AREA } = {},
) {
  const cells = new Map();
  for (const solid of solids) {
    if (solid.blend) continue;
    const { positions, indices } = solid;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = indices[at] * 3;
      const b = indices[at + 1] * 3;
      const c = indices[at + 2] * 3;
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (!(length > 1e-9)) continue;
      const up = nz / length;
      if (up < 0.9 && !(solid.doubleSided && -up >= 0.9)) continue;
      const area = length / 2;
      /* Большой пол — один-два треугольника на весь зал: он делится на точки с шагом около ячейки, иначе пол «живёт» только в центре своего треугольника. */
      const steps = clamp(
        Math.ceil((Math.sqrt(area) / (cell / 2)) * 1.4),
        1,
        60,
      );
      const each = area / ((steps * (steps + 1)) / 2);
      for (let row = 0; row < steps; row += 1)
        for (let column = 0; column < steps - row; column += 1) {
          const k = (column + 1 / 3) / steps;
          const l = (row + 1 / 3) / steps;
          const x = positions[a] + ux * k + vx * l;
          const y = positions[a + 1] + uy * k + vy * l;
          const z = positions[a + 2] + uz * k + vz * l;
          const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.round(z * 5)}`;
          const known = cells.get(key) || { area: 0, x: 0, y: 0, z: 0 };
          known.area += each;
          known.x += x * each;
          known.y += y * each;
          known.z += z * each;
          cells.set(key, known);
        }
    }
  }
  const out = [];
  for (const item of cells.values())
    if (item.area >= minArea)
      out.push({
        x: item.x / item.area,
        y: item.y / item.area,
        z: item.z / item.area,
        area: item.area,
      });
  return out;
}

/** Не больше `count` точек, равномерно по залу: самая дальняя от уже взятых каждый раз (этаж весит втрое: нижний ярус не должен теряться среди лобби). */
export function spreadPoints(points, count) {
  if (points.length <= count) return [...points];
  const start = points.reduce(
    (best, point) => (point.area > best.area ? point : best),
    points[0],
  );
  const picked = [start];
  const far = points.map((point) =>
    Math.hypot(point.x - start.x, point.y - start.y, (point.z - start.z) * 3),
  );
  while (picked.length < count) {
    let at = 0;
    for (let index = 1; index < far.length; index += 1)
      if (far[index] > far[at]) at = index;
    if (!(far[at] > 0)) break;
    const next = points[at];
    picked.push(next);
    for (let index = 0; index < points.length; index += 1)
      far[index] = Math.min(
        far[index],
        Math.hypot(
          points[index].x - next.x,
          points[index].y - next.y,
          (points[index].z - next.z) * 3,
        ),
      );
  }
  return picked;
}

/**
 * Что видит поза в кадре z-буфера (`rasterize`): расстояния, доли «вплотную», пустого и задних граней, разнообразие моделей, доля своих моделей автора и доли семейств.
 * `owner[i]` — семейство (номер) и «своя ли» у сетки `i` растра; середина кадра — по 25 % с каждой стороны.
 */
export function stadiumMetrics(
  raster,
  pose,
  { familyOf, ownOf, families, size = { width: 96, height: 64 } },
) {
  const { depth, hit, behind, width, height } = rasterize(raster, pose, size);
  const total = width * height;
  const left = Math.floor(width * 0.25);
  const right = Math.ceil(width * 0.75);
  const top = Math.floor(height * 0.25);
  const bottom = Math.ceil(height * 0.75);
  const depths = [];
  const counts = new Map();
  const share = new Float32Array(families.length);
  let holes = 0;
  let back = 0;
  let close = 0;
  let own = 0;
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
      if (z < CLOSE_RANGE) close += 1;
      if (x >= left && x < right && y >= top && y < bottom && z < nearCentre)
        nearCentre = z;
      counts.set(hit[at], (counts.get(hit[at]) || 0) + 1);
      if (ownOf[hit[at]]) own += 1;
      const family = familyOf[hit[at]];
      if (family >= 0) share[family] += 1;
    }
  const seen = depths.length;
  depths.sort((one, other) => one - other);
  const stems = new Set();
  let top1 = 0;
  for (const [solid, count] of counts) {
    stems.add(raster.meta[solid].stem);
    if (count > top1) top1 = count;
  }
  for (let index = 0; index < share.length; index += 1)
    share[index] = seen ? share[index] / seen : 0;
  return {
    hole: holes / total,
    back: back / total,
    close: seen ? close / seen : 1,
    nearCentre: seen ? nearCentre : 0,
    p10: seen ? depths[Math.floor(seen * 0.1)] : 0,
    p90: seen ? depths[Math.min(seen - 1, Math.floor(seen * 0.9))] : 0,
    own: seen ? own / seen : 0,
    stems: stems.size,
    top: seen ? top1 / seen : 1,
    families: share,
  };
}

/** Годится ли кадр: не «в стену», не сквозь стену, не пустой и не одна поверхность. */
export const usable = (metrics) =>
  metrics.nearCentre >= NEAR_CENTRE &&
  metrics.close <= CLOSE_SHARE &&
  metrics.back <= BACK_SHARE &&
  metrics.hole <= HOLE_SHARE &&
  metrics.stems >= MIN_STEMS &&
  metrics.top <= TOP_STEM;

/* Оценка «общего» кадра: широкий (дальняя точка), с долей своих моделей автора и разными моделями; вплотную и пусто — минус. */
export function overallScore(metrics) {
  const wide = clamp((metrics.p90 - 5) / 18, 0, 1);
  const variety =
    Math.min(1, metrics.stems / 8) * (1 - Math.max(0, metrics.top - 0.5));
  return (
    (0.3 + 0.7 * metrics.own) *
    (0.25 + 0.75 * variety) *
    (0.3 + 0.7 * wide) *
    (1 - metrics.hole * 0.5) *
    (1 - metrics.close * 0.6)
  );
}

const lookAt = (eye, yaw, pitch = PITCH, fov = STADIUM_FOV) => ({
  eye: eye.map((value) => Math.round(value * 100) / 100),
  yaw: Math.round(yaw * 1000) / 1000,
  pitch,
  fov,
});

const twinOf = (one, other) => {
  const apart = Math.hypot(
    one.eye[0] - other.eye[0],
    one.eye[1] - other.eye[1],
    (one.eye[2] - other.eye[2]) * 2,
  );
  const turned = Math.abs(
    Math.atan2(Math.sin(one.yaw - other.yaw), Math.cos(one.yaw - other.yaw)),
  );
  /* Тот же вид вдоль того же прохода (глаз сдвинут по взгляду, курс почти тот же) — близнец и издали: кадр отличается лишь крупностью. */
  return (
    apart < 2 ||
    (apart < TWIN_GAP && turned < TWIN_TURN) ||
    (apart < ALONG_GAP && turned < ALONG_TURN && sameLevel(one, other))
  );
};

/**
 * Ракурсы стадиона: `{ cover, coverPool, frames, pool, report }` или `null`, если сеток нет.
 *
 *   • `cover` — лучший широкий кадр (`overallScore`, дальняя точка не меньше `WIDE_DEPTH`; нет такого — лучший из годных);
 *   • `coverPool` — он и ещё несколько самых широких кадров из других мест: окно выберет из них по картинке, где зал не чёрный (`arena-frame-score.js`);
 *   • `frames` — кадры галереи: по лучшему (и второму, где `count`) на каждое семейство, в котором есть свои модели, затем самые лучшие общие; не больше `gallery` всего;
 *   • `pool` — остальные годные кадры с весом `weight` (0…1): окно добирает ими галерею по картинке;
 *   • `report` — по семействам и общим: сколько кадров, лучшая оценка и доля семейства.
 *
 * @param {{ solids: object[], ownStems?: Iterable<string>, families?: object[], gallery?: number, eyes?: number, yaws?: number, fov?: number }} input
 *   `solids` — сетки зала (`hallScene({ keepSolids: true })`), `ownStems` — модели автора (его файл или его словарь у штатной модели)
 */
export function planStadiumViews({
  solids,
  ownStems = [],
  families = STADIUM_FAMILIES,
  gallery = 6,
  eyes = EYES,
  yaws = YAWS,
  fov = STADIUM_FOV,
  pitch = PITCH,
} = {}) {
  if (!solids?.length) return null;
  const solid = solids.filter((item) => !item.blend);
  if (!solid.length) return null;
  const raster = buildRaster(solid);
  const own = new Set([...ownStems].map((stem) => String(stem).toLowerCase()));
  const familyOf = Int16Array.from(raster.meta, (item) =>
    families.findIndex((family) =>
      family.test.test(String(item.stem).toLowerCase()),
    ),
  );
  const ownOf = Uint8Array.from(raster.meta, (item) =>
    own.has(String(item.stem).toLowerCase()) ? 1 : 0,
  );
  const present = families.map((_, index) => familyOf.includes(index));

  const places = spreadPoints(floorPoints(solid), eyes);
  const valid = [];
  for (const place of places) {
    const eye = [place.x, place.y, place.z + EYE_HEIGHT];
    for (let side = 0; side < yaws; side += 1) {
      const pose = lookAt(eye, (side * 2 * Math.PI) / yaws, pitch, fov);
      const metrics = stadiumMetrics(raster, pose, {
        familyOf,
        ownOf,
        families,
      });
      if (usable(metrics))
        valid.push({ pose, metrics, score: overallScore(metrics) });
    }
  }
  const report = [
    {
      id: "candidates",
      places: places.length,
      poses: places.length * yaws,
      usable: valid.length,
    },
  ];
  if (!valid.length)
    return { cover: null, coverPool: [], frames: [], pool: [], report };

  const byScore = [...valid].sort((left, right) => right.score - left.score);
  const wide = byScore.filter((item) => item.metrics.p90 >= WIDE_DEPTH);
  const coverList = wide.length ? wide : byScore;
  const cover = coverList[0];
  const picked = [cover];
  const free = (item) => !picked.some((other) => twinOf(item.pose, other.pose));

  /* Обложка на выбор окна: она и самые широкие из других мест. */
  const coverPool = [cover];
  for (const item of coverList.slice(1)) {
    if (coverPool.length >= 5) break;
    if (!coverPool.some((other) => twinOf(item.pose, other.pose)))
      coverPool.push(item);
  }

  const frames = [];
  const take = (item, id) => {
    picked.push(item);
    frames.push({ ...item, id });
  };
  families.forEach((family, index) => {
    if (!present[index]) return;
    const ranked = valid
      .map((item) => ({
        item,
        value:
          item.metrics.families[index] *
          (0.4 + (0.6 * item.score) / Math.max(byScore[0].score, 1e-6)),
      }))
      .filter(
        ({ item, value }) =>
          item.metrics.families[index] >= FAMILY_SHARE && value > 0,
      )
      .sort((left, right) => right.value - left.value);
    let got = 0;
    for (const { item } of ranked) {
      if (got >= (family.count || 1) || frames.length >= gallery) break;
      if (!free(item)) continue;
      take(item, family.id);
      got += 1;
    }
    report.push({
      id: family.id,
      picked: got,
      ...(ranked[0]
        ? {
            share:
              Math.round(ranked[0].item.metrics.families[index] * 100) / 100,
          }
        : { share: 0 }),
    });
  });
  /* Общие виды добирают галерею до `gallery`: самые широкие из ещё не взятых мест. */
  let general = 0;
  for (const item of byScore) {
    if (frames.length >= gallery) break;
    if (!free(item)) continue;
    take(item, "hall");
    general += 1;
  }
  report.push({ id: "hall", picked: general });

  const pool = [];
  for (const item of byScore) {
    if (pool.length >= 16) break;
    if (
      picked.some((other) => other === item) ||
      !free(item) ||
      coverPool.some((other) => twinOf(item.pose, other.pose))
    )
      continue;
    if (pool.some((other) => twinOf(item.pose, other.pose))) continue;
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
        p90: Math.round(cover.metrics.p90 * 10) / 10,
        own: Math.round(cover.metrics.own * 100) / 100,
        stems: cover.metrics.stems,
      },
    ],
    labels: frames.map((item) => item.id),
    details: [
      { id: "cover", metrics: cover.metrics },
      ...frames.map((item) => ({ id: item.id, metrics: item.metrics })),
    ].map(({ id, metrics }) => ({
      id,
      p10: Math.round(metrics.p10 * 10) / 10,
      p90: Math.round(metrics.p90 * 10) / 10,
      nearCentre: Math.round(metrics.nearCentre * 10) / 10,
      close: Math.round(metrics.close * 100) / 100,
      hole: Math.round(metrics.hole * 100) / 100,
      own: Math.round(metrics.own * 100) / 100,
      stems: metrics.stems,
    })),
  };
}

/**
 * Кадры стадиона для окна (`arena.json`): `frames` — снимаются всегда, `coverPool` — из него окно берёт обложку по картинке, `candidates` — пул добора галереи, `take` — сколько кадров
 * галереи всего. Нет плана — `null`: кадры остаются прежними (фиксированная обложка и развороты).
 */
export function stadiumFrames(plan, { extra = EXTRA_FRAMES } = {}) {
  if (!plan?.cover || !plan.frames?.length) return null;
  return {
    frames: plan.frames,
    coverPool: plan.coverPool,
    candidates: plan.pool,
    take: plan.frames.length + Math.min(extra, plan.pool.length),
  };
}
