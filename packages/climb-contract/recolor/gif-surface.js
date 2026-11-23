/*
 * Гифка на поверхности (задача 6 ТЗ 17.10.2026, вечер): «ставить гифки на
 * баннеры, остановки, в аренах на картины и на стены».
 *
 * Общее место для всех, кто показывает гифку не на отдельной модели, а на
 * чужой поверхности: щит карты, постер остановки, полотно арены. Что здесь:
 *
 *   • кадры — лист-атлас (`animation`: сетка `columns × rows`, `frames`,
 *     `delays`, как у живых моделей мест — `normalizePlaceModelAnimation`);
 *     клетка листа — кадр: `gifSurfaceCell`, `gifSurfaceFrame`;
 *   • первый кадр — всегда: где гифке не двигаться (общий лист, дальний
 *     план, место сверх предела), там лежит он — `gifSurfaceFrame(…, 0)`;
 *   • атлас под поверхность — каждый кадр подогнан под её пропорцию тем же
 *     способом, что неподвижная картинка (`gifSurfaceAtlas`): одна функция у
 *     кадра окна и у установщика;
 *   • пределы и вес — профиль на каждое место (`GIF_SURFACE_PROFILES`):
 *     сторона атласа, сколько гифок живут разом, сколько они весят
 *     (`gifSurfaceBudget`); что не влезло — первый кадр, и окно говорит какое.
 *
 * Игра сменяет кадры клипом развёртки (`<модель>_uv_<шейдер>` в словаре
 * клипов, архетипу — флаг 0x400 и `clipDictionary`): клип двигает целиком
 * шейдер целиком модели, поэтому живой бывает только поверхность со своей
 * моделью или со своим листом (плашка перед щитом, постер остановки,
 * плашка полотна арены). Лицо, запечённое в модель района, и общий лист
 * зала оживить нельзя — там гифка встаёт первым кадром.
 *
 * Чистые функции без DOM и Node: их читают окно (кадр, предпросмотр),
 * установщик и тесты.
 */

import { PLACE_MODEL_ANIMATION_LIMITS, PLACE_MODEL_LIMIT, normalizePlaceModelAnimation, placeModelAnimationClip } from "./place-models.js";

export { normalizePlaceModelAnimation as normalizeGifAnimation };

const MiB = 1024 * 1024;

/**
 * Профили мест. `atlasSide` — наибольшая сторона атласа, px (степень двойки);
 * `maxLive` — сколько гифок живут разом на работу; `maxBytes` — сколько они
 * весят вместе (атласы DXT5 со всеми мипами, клипы и модели).
 * `places` — «Модели» мест (11.11.2026, «гифка на стену» во всём маппинге): лист
 * по умолчанию 2048 (так было и до профиля — работы без поля остаются как были), у «экономной»
 * чёткости (`animation.economy`) — `economySide` 1024;
 * живых не больше `maxLive` (общий счёт с моделями места — `PLACE_MODEL_LIMIT`),
 * с `warnLive` окно предупреждает, вес живых листов — не больше 96 МБ: что сверх —
 * первым кадром с названной причиной.
 */
export const GIF_SURFACE_PROFILES = Object.freeze({
  billboards: Object.freeze({ atlasSide: 1024, maxLive: 12, maxBytes: 40 * MiB }),
  busstops: Object.freeze({ atlasSide: 1024, maxLive: 4, maxBytes: 40 * MiB }),
  arenas: Object.freeze({ atlasSide: 2048, maxLive: 16, maxBytes: 160 * MiB }),
  places: Object.freeze({ atlasSide: 2048, economySide: 1024, maxLive: PLACE_MODEL_LIMIT, warnLive: 10, maxBytes: 96 * MiB }),
});

/** Профиль места или `null`. */
export const gifSurfaceProfile = (id) => GIF_SURFACE_PROFILES[id] || null;

/* ------------------------------------------------------------------ *
 * Вес
 * ------------------------------------------------------------------ */

/* Файлы живой модели сверх листа: модель (сетка, шейдер, рамки) и ресурсный заголовок. */
const MODEL_OVERHEAD = 24 * 1024;
/* Один тик клипа развёртки в словаре: две дорожки по несколько байт на кадр плюс заголовок. */
const CLIP_BYTES_PER_TICK = 12;
const CLIP_OVERHEAD = 8 * 1024;

/** Лист DXT5 со всеми мипами, байт: один байт на тексель и треть сверху. */
export const gifSurfaceSheetBytes = (width, height) => Math.ceil((Math.max(1, width) * Math.max(1, height) * 4) / 3);

/**
 * Что весит живая гифка в игре, байт: лист, клип по кругу (30 кадров/с) и
 * модель. `width`/`height` — размер листа, `animation` — кадры.
 */
export function gifSurfaceBytes(width, height, animation) {
  const ticks = animation ? placeModelAnimationClip(animation).shifts.length : 0;
  return gifSurfaceSheetBytes(width, height) + ticks * CLIP_BYTES_PER_TICK + CLIP_OVERHEAD + MODEL_OVERHEAD;
}

/** Самый тяжёлый вес одной живой гифки места: лист во всю сторону профиля и самый длинный клип. */
export function gifSurfaceWorstBytes(profileId) {
  const profile = gifSurfaceProfile(profileId);
  if (!profile) return 0;
  const { frames, fps, duration } = PLACE_MODEL_ANIMATION_LIMITS;
  const ticks = Math.round((duration / 1000) * fps) + 1;
  return gifSurfaceSheetBytes(profile.atlasSide, profile.atlasSide) + Math.min(ticks, frames[1] * fps) * CLIP_BYTES_PER_TICK + CLIP_OVERHEAD + MODEL_OVERHEAD;
}

/**
 * Кому из претендентов быть живым. `candidates` — по порядку важности:
 * `[{ key, bytes? }]` (`bytes` — вес, иначе худший для места). Ответ —
 * `{ live: [ключи], still: [{ key, reason }], bytes }`: `reason` — `"limit"`
 * (живых уже `maxLive`) или `"weight"` (вес вместе больше `maxBytes`).
 * Тяжёлый претендент не мешает лёгким за ним: берётся всё, что влезает.
 */
export function gifSurfaceBudget(profileId, candidates) {
  const profile = gifSurfaceProfile(profileId);
  const worst = gifSurfaceWorstBytes(profileId);
  const live = [];
  const still = [];
  let bytes = 0;
  for (const candidate of candidates || []) {
    const cost = Number.isFinite(candidate.bytes) ? candidate.bytes : worst;
    if (!profile || live.length >= profile.maxLive) still.push({ key: candidate.key, reason: "limit" });
    else if (bytes + cost > profile.maxBytes) still.push({ key: candidate.key, reason: "weight" });
    else {
      live.push(candidate.key);
      bytes += cost;
    }
  }
  return { live, still, bytes };
}

/* ------------------------------------------------------------------ *
 * Живые модели мест («Модели»: гифка на стене)
 * ------------------------------------------------------------------ */

/** Сторона листа живой модели места: по умолчанию 2048 («высокая»), у «экономной» (`animation.economy`) — 1024. */
export const placeModelSheetSide = (animation) => (animation?.economy ? GIF_SURFACE_PROFILES.places.economySide : GIF_SURFACE_PROFILES.places.atlasSide);

/**
 * Что получится из живой модели места: `{ sheet: [w, h], cell: [w, h], frames, seconds, bytes }` — лист после подгонки под сторону, клетка кадра на нём, кадров, круг в секундах
 * и вес в игре (`gifSurfaceBytes`). Лист, как его собрало окно, — `animation.sheet`; нет его (работа до 11.11) — худший случай: квадрат во всю сторону.
 */
export function placeModelGifSummary(animation) {
  const side = placeModelSheetSide(animation);
  const [width, height] = (animation.sheet || [side, side]).map((value) => Math.min(value, side));
  const cell = [Math.max(1, Math.floor(width / animation.columns)), Math.max(1, Math.floor(height / animation.rows))];
  const seconds = animation.delays.reduce((sum, value) => sum + value, 0) / 1000;
  return { sheet: [width, height], cell, frames: animation.frames, seconds, bytes: gifSurfaceBytes(width, height, animation) };
}

/**
 * Кому из живых моделей места быть живым. `items` — модели работы по порядку (с `id`, `animation`); бюджет — профиль `places`: не больше `maxLive` живых, вес живых листов
 * не больше `maxBytes`. `{ live: Set<id>, still: Map<id, "limit" | "weight">, bytes, count, warn }`: `count` — сколько всего живых моделей просят места, `warn` — их `warnLive`
 * или больше (окно рисует жёлтое предупреждение). Модель без `animation` в счёт не идёт.
 */
export function placeModelsGifPlan(items) {
  const animated = (items || []).filter((item) => item?.animation);
  const plan = gifSurfaceBudget("places", animated.map((item) => ({ key: item.id, bytes: placeModelGifSummary(item.animation).bytes })));
  return { live: new Set(plan.live), still: new Map(plan.still.map((item) => [item.key, item.reason])), bytes: plan.bytes, count: animated.length, warn: animated.length >= GIF_SURFACE_PROFILES.places.warnLive };
}

/* ------------------------------------------------------------------ *
 * Кадры листа
 * ------------------------------------------------------------------ */

/**
 * Клетка кадра `frame` на листе `width × height`: `{ x, y, width, height }`
 * в пикселях (целые; лист делится на `columns × rows` поровну, остаток от
 * деления — полем справа и снизу).
 */
export function gifSurfaceCell(animation, width, height, frame = 0) {
  const { columns, rows, frames } = animation;
  const index = ((Math.round(frame) % frames) + frames) % frames;
  const cell = [Math.max(1, Math.floor(width / columns)), Math.max(1, Math.floor(height / rows))];
  return { x: (index % columns) * cell[0], y: Math.floor(index / columns) * cell[1], width: cell[0], height: cell[1] };
}

/**
 * Кадр `frame` из листа кадров `picture` (`{ rgba, width, height }`) —
 * картинкой `{ rgba, width, height }`. Лист без `animation` — как есть
 * (обычная картинка — единственный кадр).
 */
export function gifSurfaceFrame(picture, animation, frame = 0) {
  if (!animation || !picture?.rgba) return picture;
  const cell = gifSurfaceCell(animation, picture.width, picture.height, frame);
  const rgba = new Uint8ClampedArray(cell.width * cell.height * 4);
  for (let y = 0; y < cell.height; y += 1) {
    const from = ((cell.y + y) * picture.width + cell.x) * 4;
    rgba.set(picture.rgba.subarray(from, from + cell.width * 4), y * cell.width * 4);
  }
  return { rgba, width: cell.width, height: cell.height };
}

/**
 * Атлас под поверхность: каждый кадр листа `picture` — своей картинкой
 * поверхности в клетку нового листа той же сетки. `render(frame, width,
 * height)` — пиксели кадра `width × height` (RGBA, подогнанные под
 * пропорцию поверхности — тем же способом, что неподвижная картинка); `null`
 * — кадр пуст. Размер листа — как у `picture` (но не больше `side`), клетка —
 * его доля. `{ rgba, width, height, frame: [клетка w, h], animation }`.
 */
export function gifSurfaceAtlas(picture, animation, render, { side = 1024 } = {}) {
  const { columns, rows, frames } = animation;
  const pow2 = (value, limit) => Math.max(columns > rows ? columns : rows, Math.min(limit, 2 ** Math.round(Math.log2(Math.max(1, value)))));
  const width = pow2(picture.width, side);
  const height = pow2(picture.height, side);
  const cell = [Math.max(1, Math.floor(width / columns)), Math.max(1, Math.floor(height / rows))];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    const pixels = render(frame, cell[0], cell[1]);
    if (!pixels) continue;
    const x0 = (frame % columns) * cell[0];
    const y0 = Math.floor(frame / columns) * cell[1];
    for (let y = 0; y < cell[1]; y += 1) rgba.set(pixels.subarray(y * cell[0] * 4, (y + 1) * cell[0] * 4), ((y0 + y) * width + x0) * 4);
  }
  return { rgba, width: cell[0] * columns, height: cell[1] * rows, frame: cell, animation };
}

/* ------------------------------------------------------------------ *
 * Лист кадров в окне
 * ------------------------------------------------------------------ */

/**
 * Как кадры гифки лягут листом: `{ keep, delays, columns, rows, cell,
 * sheet, dropped }`. Кадров больше 64 — берутся равномерно (задержки
 * выкинутых прибавляются к оставленным: круг той же длины). Клетка —
 * степень двойки, не больше `cellSide` и доли `side` листа на столбец и на
 * строку; лист — до `side` по обеим сторонам. Одна раскладка у всех мест:
 * разница между ними — только `side` (и `cellSide`).
 */
export function planGifAtlas(width, height, delays, { side = 2048, cellSide = 512 } = {}) {
  const total = delays.length;
  const count = Math.min(PLACE_MODEL_ANIMATION_LIMITS.frames[1], total);
  const keep = [];
  const kept = [];
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor((index * total) / count);
    const to = Math.floor(((index + 1) * total) / count);
    keep.push(from);
    kept.push(delays.slice(from, to).reduce((sum, value) => sum + value, 0));
  }
  const columns = 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(count))));
  const rows = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(count / columns))));
  const pow2 = (value) => 2 ** Math.round(Math.log2(Math.max(1, value)));
  const cellWidth = Math.max(16, Math.min(pow2(width), cellSide, side / columns));
  const cellHeight = Math.max(16, Math.min(pow2(height), cellSide, side / rows));
  return { keep, delays: kept, columns, rows, cell: [cellWidth, cellHeight], sheet: [cellWidth * columns, cellHeight * rows], dropped: total - count };
}
