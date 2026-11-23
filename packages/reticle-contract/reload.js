/*
 * Индикатор перезарядки (владелец, 14.11.2026): одно описание на редактор,
 * кадр и сборку `hud_reticle.gfx` и `hud.gfx`.
 *
 * ЧТО ИГРА СООБЩАЕТ. Слова «перезарядка» фильмам HUD игра не шлёт: у класса
 * `HUD_RETICLE` (hud_reticle.gfx Steam Legacy) только тип, разброс, зум,
 * захват, попадание и видимость, у блока оружия `HUD_WEAPON_ICON` (hud.gfx) —
 * ствол, патроны и полоса заряда шокера и гранаты (`SET_WEAPON_TIMER`). Зато
 * патроны игра шлёт на каждый выстрел, перезарядку и смену ствола:
 * `CONTAINER_METHOD(2, "SET_AMMO_COUNT", запас, в обойме, размер обоймы, тип)`
 * и при смене ствола `CONTAINER_METHOD(2, "SET_PLAYER_WEAPON", хеш, …)`.
 * Диспетчер контейнера `CONTAINER_METHOD` получает их всегда — и когда блок
 * спрятан сервером, — а фильмы HUD грузятся в контейнер `MovieClipLoader` и
 * делят один `_global`. По этим числам:
 *
 *  • начало — обойма опустела (была больше нуля, стала 0) при запасе больше
 *    нуля: игра сама начинает перезарядку;
 *  • конец — обойма выросла до полной или кончился запас; выросла не до конца
 *    — патрон за патроном (помповые), доля — обойма / размер. Полная обойма
 *    раньше конца длительности — ещё не конец: см. «ДЛИТЕЛЬНОСТЬ»;
 *  • ручная перезарядка (R при неполной обойме) — начала в числах нет, виден
 *    только конец: по желанию индикатор вспыхивает и быстро дозаливается;
 *  • стволы без обоймы (размер 0 или 1: рукопашная, гранаты, РПГ) молчат.
 *
 * ДЛИТЕЛЬНОСТИ в фильмах нет — она берётся из файлов игры при сборке (владелец,
 * 15.11.2026: «пусть оно всё считывается с реальных файлов игры»): weapons.meta
 * (`ReloadTimeSP`, `AnimReloadRate`) и клип перезарядки ствола
 * (`weaponReloadMs`; чтение — `apps/desktop/src/reticle-reload-files.js`).
 * Таблица «ствол → мс» (`reloadTimeKey`) вшивается в файл прицела.
 * Длительность — от начала перезарядки до мига, когда снова можно стрелять, а
 * не до полной обоймы (владелец, 15.11.2026: «лучше брать из файлов число»):
 * игра пополняет обойму раньше (пистолет — на ≈ 1,35 с из 1,83). Поэтому
 * полная обойма раньше срока заливку не обрывает — фаза `full`: кольцо
 * доходит до 100 % по часам к концу длительности, потом удержание и
 * затухание; выстрел в этой фазе (обойма убыла) значит «стрелять уже можно» —
 * быстрая дозаливка от текущей доли. Длительность вышла, а полной обоймы нет —
 * стоит на 95 % и ждёт её. Ствол без длительности из файлов — честная
 * запасная ветка: заливки по ходу нет, индикатор дозаливается, когда приходит
 * полная обойма (`RELOAD_UNKNOWN_LIMIT_MS` — сколько ждать конца).
 *
 * ВРЕМЯ — по часам (`getTimer()` в файле, `now` здесь), а не кадрами клипа:
 * стенд 15.11.2026 намерил, что клип тикает ≈ 24,5 раза в секунду, а не 30, и
 * не тикает вовсе, пока игра прячет прицел, — кадровый счёт отставал, а замер
 * после спрятанного прицела выходил втрое короче. Состояние хранит начало фазы
 * (`since`), кадр лишь перечитывает часы. Файл и кадр редактора идут по одному
 * автомату (`reloadWeapon`, `reloadAmmo`, `reloadTick`). Заливка — кадры своего
 * клипа: в кадре k — доля k / STEPS, фигуры те же, что рисует редактор
 * (`reloadFrameContours`).
 *
 * ГДЕ — сдвиг от середины прицела в точках сцены 1280×720: прицел игра ставит в
 * середину экрана. Клип лежит на корне фильма прицела, поверх `CONTENT`, и
 * не гаснет, когда игра прячет прицел.
 */

import { annulus, arcBand, rectangle, shapesBounds } from "./geometry.js";
import { regionContours } from "./region.js";
import { RETICLE_STAGE, RETICLE_TWIPS } from "./stage.js";
import { RETICLE_MOVIE_FPS } from "./animation.js";

/** Ступеней заливки: у клипа STEPS + 1 кадров, в первом — пусто. */
export const RELOAD_STEPS = 40;
/** Дольше длительности из файлов заливка не идёт: стоит на этой доле и ждёт конца. */
export const RELOAD_CAP = 0.95;
/** Дозаливка на конце, полная заливка на виду и затухание — миллисекундами. */
export const RELOAD_FINISH_MS = 170;
export const RELOAD_HOLD_MS = 270;
export const RELOAD_FADE_MS = 300;
/** Конца нет дольше «длительность × 2 + это» (сбили перекатом, бегом) — индикатор гаснет. */
export const RELOAD_TIMEOUT_MS = 3000;
/** Длительность ствола не нашлась в файлах: конца ждём столько, потом гаснет. */
export const RELOAD_UNKNOWN_LIMIT_MS = 10000;
/**
 * Длительность из файлов принимается только в этих пределах: короче — не
 * перезарядка (битое число, клип не тот), дольше — тоже. Пистолет на стенде —
 * 1350 мс, помповое — 2096 мс.
 */
export const RELOAD_TIME_MIN_MS = 300;
export const RELOAD_TIME_MAX_MS = 15000;
/** Стволов в таблице не больше — защита файла прицела от мусора. */
export const RELOAD_TIMES_MAX = 1024;
/**
 * Прежние числа только для стенда (`tools/ingame-qa/stand/hud/reload.mjs`):
 * кадров в секунду у фильма прицела и средние 2 с. Автомат их не использует —
 * длительность у каждого ствола своя, из файлов игры.
 */
export const RELOAD_DEFAULT_SECONDS = 2;
export const RELOAD_FPS = RETICLE_MOVIE_FPS;
export const RELOAD_DEFAULT_FRAMES = Math.round(
  RELOAD_DEFAULT_SECONDS * RELOAD_FPS,
);

export const RELOAD_PHASE = Object.freeze({
  idle: 0,
  run: 1,
  finish: 2,
  fade: 3,
  /** Обойма полная раньше конца длительности: заливка дорабатывает по часам. */
  full: 4,
});

/* ------------------------------ настройки ------------------------------ */

export const RELOAD_KINDS = Object.freeze([
  Object.freeze({
    id: "ring",
    label: "Кольцо",
    note: "заливается по часовой от верха",
  }),
  Object.freeze({
    id: "line",
    label: "Линия",
    note: "полоса слева направо или от середины",
  }),
  Object.freeze({
    id: "icon",
    label: "Значок",
    note: "значок заливается снизу вверх",
  }),
]);

export const RELOAD_LINE_FROM = Object.freeze([
  Object.freeze({ id: "left", label: "Слева направо" }),
  Object.freeze({ id: "center", label: "От середины" }),
]);

/** Дуги кольца: 0 — целое. */
export const RELOAD_SEGMENTS = Object.freeze([0, 4, 6, 8, 12]);

export const RELOAD_LIMITS = Object.freeze({
  size: Object.freeze({ min: 8, max: 200, step: 1, unit: "", label: "Размер" }),
  thickness: Object.freeze({
    min: 1,
    max: 16,
    step: 0.5,
    unit: "",
    label: "Толщина",
  }),
  trackOpacity: Object.freeze({
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    label: "Пустая часть",
  }),
  opacity: Object.freeze({
    min: 10,
    max: 100,
    step: 5,
    unit: "%",
    label: "Прозрачность",
  }),
  x: Object.freeze({
    min: -RETICLE_STAGE.width / 2,
    max: RETICLE_STAGE.width / 2,
    step: 1,
    unit: "",
    label: "По горизонтали",
  }),
  y: Object.freeze({
    min: -RETICLE_STAGE.height / 2,
    max: RETICLE_STAGE.height / 2,
    step: 1,
    unit: "",
    label: "По вертикали",
  }),
});

/* Новый индикатор — кольцо вокруг прицела, белое на тёмной пустой части. Выключен: старые работы не меняются, файл без него байт в байт прежний. */
export const RELOAD_DEFAULTS = Object.freeze({
  enabled: false,
  kind: "ring",
  icon: "bullet",
  size: 44,
  thickness: 3,
  segments: 0,
  lineFrom: "left",
  color: "#ffffff",
  trackColor: "#000000",
  trackOpacity: 40,
  opacity: 100,
  x: 0,
  y: 0,
  manualFlash: true,
});

/* ------------------------------- значки ------------------------------- */

/*
 * Значки — фигуры в единицах высоты: середина в 0,0, высота 1 (от −0,5 до
 * 0,5). Фигура — массив контуров, как у прицела; перекрытия частей значка
 * сливает `regionContours`, поэтому части можно класть друг на друга.
 */
const RAD = Math.PI / 180;

function ellipseTop(cx, bottom, halfWidth, height, steps = 24) {
  /* Полуэллипс вершиной вверх: от правого края основания к левому. */
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI;
    points.push([
      cx + Math.cos(angle) * halfWidth,
      bottom - Math.sin(angle) * height,
    ]);
  }
  return [points];
}

function bulletShapes(cx = 0, width = 0.36) {
  const half = width / 2;
  const body = half * 0.84;
  return [
    rectangle(cx - half, 0.4, cx + half, 0.5),
    rectangle(cx - body, -0.06, cx + body, 0.42),
    ellipseTop(cx, -0.04, body * 0.92, 0.46),
  ];
}

/* Изогнутый магазин: две дуги по точкам и опорная плита внизу. */
function magazineShapes() {
  const steps = 16;
  const front = [];
  const back = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const y = -0.5 + t * 0.9;
    const bend = 0.16 * t * t;
    back.push([-0.24 + bend, y]);
    front.push([0.14 + bend + 0.04 * t, y]);
  }
  return [[[...back.reverse(), ...front]], rectangle(-0.1, 0.38, 0.4, 0.5)];
}

function shellShapes() {
  return [
    rectangle(-0.16, -0.5, 0.16, 0.2),
    rectangle(-0.18, 0.18, 0.18, 0.42),
    rectangle(-0.21, 0.4, 0.21, 0.5),
  ];
}

const regular = (sides, radius, rotation) => [
  Array.from({ length: sides }, (_, index) => {
    const angle = (rotation + (index * 360) / sides) * RAD;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }),
];

export const RELOAD_ICONS = Object.freeze([
  Object.freeze({
    id: "bullet",
    label: "Патрон",
    shapes: () => bulletShapes(),
  }),
  Object.freeze({
    id: "bullets",
    label: "Три патрона",
    shapes: () => [
      ...bulletShapes(-0.32, 0.26),
      ...bulletShapes(0, 0.26),
      ...bulletShapes(0.32, 0.26),
    ],
  }),
  Object.freeze({
    id: "magazine",
    label: "Магазин патронов",
    shapes: magazineShapes,
  }),
  Object.freeze({ id: "shell", label: "Гильза", shapes: shellShapes }),
  Object.freeze({
    id: "diamond",
    label: "Ромб",
    shapes: () => [
      [
        [
          [0, -0.5],
          [0.36, 0],
          [0, 0.5],
          [-0.36, 0],
        ],
      ],
    ],
  }),
  Object.freeze({
    id: "hexagon",
    label: "Шестигранник",
    shapes: () => [regular(6, 0.5, -90)],
  }),
]);

const ICON_IDS = new Set(RELOAD_ICONS.map((item) => item.id));
const KIND_IDS = new Set(RELOAD_KINDS.map((item) => item.id));
const LINE_FROM_IDS = new Set(RELOAD_LINE_FROM.map((item) => item.id));
const HEX = /^#[0-9a-f]{6}$/i;

const bounded = (value, { min, max, step }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / step) * step;
  return Math.min(max, Math.max(min, Math.round(stepped * 100) / 100));
};

const colour = (value, fallback) =>
  HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback;

/** Индикатор в границах договора; чужие поля отбрасываются. */
export function normalizeReloadIndicator(input) {
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = RELOAD_DEFAULTS;
  const limits = RELOAD_LIMITS;
  const segments = Number(source.segments);
  return {
    enabled: source.enabled === true,
    kind: KIND_IDS.has(source.kind) ? source.kind : base.kind,
    icon: ICON_IDS.has(source.icon) ? source.icon : base.icon,
    size: bounded(source.size, limits.size, base.size),
    thickness: bounded(source.thickness, limits.thickness, base.thickness),
    segments: RELOAD_SEGMENTS.includes(segments) ? segments : base.segments,
    lineFrom: LINE_FROM_IDS.has(source.lineFrom)
      ? source.lineFrom
      : base.lineFrom,
    color: colour(source.color, base.color),
    trackColor: colour(source.trackColor, base.trackColor),
    trackOpacity: bounded(
      source.trackOpacity,
      limits.trackOpacity,
      base.trackOpacity,
    ),
    opacity: bounded(source.opacity, limits.opacity, base.opacity),
    x: bounded(source.x, limits.x, base.x),
    y: bounded(source.y, limits.y, base.y),
    manualFlash: source.manualFlash !== false,
  };
}

/**
 * Правка из редактора: любая настройка включает индикатор, выключает только
 * выключатель — как у счётчиков патронов и урона.
 */
export function editReloadIndicator(current, change = {}) {
  const next = { ...normalizeReloadIndicator(current), ...change };
  next.enabled = typeof change.enabled === "boolean" ? change.enabled : true;
  return normalizeReloadIndicator(next);
}

/* ------------------------------ готовые ------------------------------ */

/*
 * Готовые индикаторы ставят вид целиком (форму, размер, цвета, место), от
 * значений по умолчанию: от прежнего ничего не просачивается. Включают его.
 */
const preset = (id, label, values) =>
  Object.freeze({ id, label, values: Object.freeze(values) });
export const RELOAD_PRESETS = Object.freeze([
  preset("ring", "Кольцо", {
    kind: "ring",
    size: 44,
    thickness: 3,
    segments: 0,
  }),
  preset("segments", "Сегменты", {
    kind: "ring",
    size: 56,
    thickness: 4,
    segments: 8,
    color: "#7cf0a0",
    trackOpacity: 35,
  }),
  preset("line", "Полоса", {
    kind: "line",
    size: 72,
    thickness: 4,
    lineFrom: "center",
    y: 34,
    trackOpacity: 45,
  }),
  preset("bullet", "Патрон", {
    kind: "icon",
    icon: "bullet",
    size: 30,
    x: 36,
    color: "#ffd166",
    trackOpacity: 50,
  }),
  preset("magazine", "Магазин патронов", {
    kind: "icon",
    icon: "magazine",
    size: 32,
    x: 38,
    color: "#ffffff",
    trackOpacity: 50,
  }),
  preset("shell", "Гильза", {
    kind: "icon",
    icon: "shell",
    size: 28,
    x: 34,
    color: "#ff8a5c",
    trackOpacity: 50,
  }),
]);

/* «Вспышка в конце ручной» — поведение, а не вид: готовый её не меняет. */
export function reloadPresetConfig(item, current = {}) {
  const { manualFlash } = normalizeReloadIndicator(current);
  return normalizeReloadIndicator({
    ...RELOAD_DEFAULTS,
    ...item.values,
    manualFlash,
    enabled: true,
  });
}

/** Какой из готовых сейчас стоит: совпадает всё, кроме выключателя и вспышки. */
export function reloadPresetOf(input) {
  const config = normalizeReloadIndicator(input);
  const same = (item) => {
    const look = reloadPresetConfig(item, config);
    return Object.keys(look).every(
      (key) =>
        key === "enabled" || key === "manualFlash" || look[key] === config[key],
    );
  };
  return RELOAD_PRESETS.find(same)?.id || "";
}

/** Быстрое место: середина, под, над, справа, слева — с зазором от прицела. */
export function reloadPlacement(input, where) {
  const config = normalizeReloadIndicator(input);
  const { width, height } = reloadBox(config);
  const gap = 18;
  const places = {
    center: { x: 0, y: 0 },
    below: { x: 0, y: Math.round(height / 2 + gap) },
    above: { x: 0, y: -Math.round(height / 2 + gap) },
    right: { x: Math.round(width / 2 + gap), y: 0 },
    left: { x: -Math.round(width / 2 + gap), y: 0 },
  };
  return places[where] || places.center;
}

export const RELOAD_PLACES = Object.freeze([
  Object.freeze({ id: "center", label: "Вокруг" }),
  Object.freeze({ id: "below", label: "Под прицелом" }),
  Object.freeze({ id: "above", label: "Над прицелом" }),
  Object.freeze({ id: "right", label: "Справа" }),
  Object.freeze({ id: "left", label: "Слева" }),
]);

/* ------------------------------ геометрия ------------------------------ */

/** Фигуры индикатора целиком: середина в 0,0, точки сцены. */
export function reloadShapes(input) {
  const config = normalizeReloadIndicator(input);
  if (config.kind === "line") {
    const half = config.size / 2;
    const thick = config.thickness / 2;
    return [rectangle(-half, -thick, half, thick)];
  }
  if (config.kind === "ring") {
    const outer = config.size / 2;
    const inner = Math.max(0, outer - config.thickness);
    if (!config.segments) return [annulus(0, 0, inner, outer)];
    const span = 360 / config.segments;
    /* Зазор между дугами — полторы толщины по окружности, но не больше 40 % дуги. */
    const gap = Math.min(
      span * 0.4,
      (config.thickness * 1.5) / Math.max(1, outer) / RAD,
    );
    return Array.from({ length: config.segments }, (_, index) => {
      const from = -90 + index * span + gap / 2;
      return arcBand(0, 0, inner, outer, from, from + span - gap);
    });
  }
  /* Значок — серединой рамки в 0,0: магазин изогнут вправо, и без этого уехал бы от точки. */
  const icon =
    RELOAD_ICONS.find((item) => item.id === config.icon) || RELOAD_ICONS[0];
  const raw = icon.shapes();
  const box = shapesBounds(raw);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return raw.map((shape) =>
    shape.map((loop) =>
      loop.map(([x, y]) => [(x - cx) * config.size, (y - cy) * config.size]),
    ),
  );
}

/** Рамка индикатора в точках сцены: ширина и высота. */
export function reloadBox(input) {
  const bounds = shapesBounds(reloadShapes(input));
  return bounds
    ? { width: bounds.width, height: bounds.height }
    : { width: 0, height: 0 };
}

/** Ступень заливки по доле 0…1: та же, что номер кадра клипа минус один. */
export const reloadStep = (progress) =>
  Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * RELOAD_STEPS);

/* Что вычесть из фигуры, чтобы осталась залитая (`filled`) или пустая часть при доле `share`. */
function cutOf(config, bounds, share, filled) {
  const far = 4 * Math.max(bounds.width, bounds.height, 1);
  if (config.kind === "ring") {
    const angle = -90 + 360 * share;
    const reach = config.size;
    return filled
      ? arcBand(0, 0, 0, reach, angle, 270)
      : arcBand(0, 0, 0, reach, -90, angle);
  }
  if (config.kind === "line") {
    const left = bounds.x;
    const width = bounds.width;
    if (config.lineFrom === "center") {
      const half = (width * share) / 2;
      return filled
        ? [
            ...rectangle(-far, -far, -half, far),
            ...rectangle(half, -far, far, far),
          ]
        : rectangle(-half, -far, half, far);
    }
    const level = left + width * share;
    return filled
      ? rectangle(level, -far, far, far)
      : rectangle(-far, -far, level, far);
  }
  const bottom = bounds.y + bounds.height;
  const level = bottom - bounds.height * share;
  return filled
    ? rectangle(-far, -far, far, level)
    : rectangle(-far, level, far, far);
}

/**
 * Контуры кадра `step` (0…STEPS) в твипах — те, что уходят в игру: пустая часть
 * (`track`) и залитая (`fill`) не перекрываются. Редактор рисует их же, делённые
 * на 20.
 */
export function reloadFrameContours(input, step) {
  const config = normalizeReloadIndicator(input);
  const shapes = reloadShapes(config);
  const bounds = shapesBounds(shapes) || { x: 0, y: 0, width: 0, height: 0 };
  const share =
    Math.min(RELOAD_STEPS, Math.max(0, Math.round(step))) / RELOAD_STEPS;
  const fill =
    share <= 0
      ? []
      : share >= 1
        ? regionContours(shapes)
        : regionContours(shapes, [cutOf(config, bounds, share, true)]);
  const track =
    share >= 1
      ? []
      : share <= 0
        ? regionContours(shapes)
        : regionContours(shapes, [cutOf(config, bounds, share, false)]);
  return { fill, track };
}

/** Контуры кадра в точках сцены — для SVG. */
export function reloadFrameShapes(input, step) {
  const { fill, track } = reloadFrameContours(input, step);
  const points = (contours) =>
    contours.map((loop) =>
      loop.map(([x, y]) => [x / RETICLE_TWIPS, y / RETICLE_TWIPS]),
    );
  return { fill: points(fill), track: points(track) };
}

/* ------------------------------ автомат ------------------------------ */

/**
 * Индикатор до первых патронов. `clip` −1 — числа ствола ещё не приходили.
 * `since` — часы (мс) в начале фазы, `elapsed` — сколько прошло к последнему
 * кадру; `duration` — мс, 0 — длительность ствола не нашлась; `times` — таблица
 * длительностей из файлов игры (`reloadIdle`).
 */
export const RELOAD_IDLE = Object.freeze({
  phase: RELOAD_PHASE.idle,
  since: 0,
  elapsed: 0,
  duration: 0,
  progress: 0,
  from: 0,
  shell: 0,
  weapon: null,
  clip: -1,
  times: Object.freeze({}),
});

/**
 * Ключ ствола в таблице длительностей: хеш без знака, десятичной строкой
 * (WEAPON_PISTOL → "453432689"). Игра может прислать хеш со знаком — файл
 * приводит его так же.
 */
export function reloadTimeKey(weapon) {
  const number = Number(weapon);
  return String(number < 0 ? number + 4294967296 : weapon);
}

const sensible = (value, low, high) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= low && number <= high
    ? number
    : null;
};

/**
 * Длительность перезарядки ствола, мс, из чисел файлов игры: `info` — поля
 * CWeaponInfo (`reloadTimeSP` в секундах, −1 — по клипу; `animReloadRate`),
 * `clip` — клип перезарядки `{ seconds, rate }` или `null`. Вне
 * `RELOAD_TIME_MIN_MS`…`RELOAD_TIME_MAX_MS` или без чисел — `null`.
 */
export function weaponReloadMs(info = {}, clip = null) {
  const fixed = Number(info?.reloadTimeSP);
  let ms = null;
  if (fixed > 0) ms = fixed * 1000;
  else if (clip && Number(clip.seconds) > 0) {
    const rate = sensible(clip.rate, 0.05, 20) ?? 1;
    const anim = sensible(info?.animReloadRate, 0.05, 20) ?? 1;
    ms = (Number(clip.seconds) / rate / anim) * 1000;
  }
  if (ms === null) return null;
  return sensible(Math.round(ms), RELOAD_TIME_MIN_MS, RELOAD_TIME_MAX_MS);
}

/** Таблица длительностей в границах договора: ключи — `reloadTimeKey`, мс — целые в пределах. */
export function normalizeReloadTimes(input) {
  const out = {};
  if (!input || typeof input !== "object") return Object.freeze(out);
  const pairs = input instanceof Map ? [...input] : Object.entries(input);
  for (const [weapon, value] of pairs) {
    if (Object.keys(out).length >= RELOAD_TIMES_MAX) break;
    const key = reloadTimeKey(weapon);
    if (!/^\d{1,10}$/.test(key) || Number(key) > 4294967295) continue;
    const ms = sensible(
      Math.round(Number(value)),
      RELOAD_TIME_MIN_MS,
      RELOAD_TIME_MAX_MS,
    );
    if (ms !== null) out[key] = ms;
  }
  return Object.freeze(out);
}

/** Индикатор до первых патронов с таблицей длительностей из файлов игры. */
export function reloadIdle(times) {
  return { ...RELOAD_IDLE, times: normalizeReloadTimes(times) };
}

/* Часы назад не идут: отрицательное «прошло» — ноль. */
const elapsedAt = (state, now) => Math.max(0, now - state.since);
/* Доля по часам: без длительности — ноль (заливки по ходу нет). */
const timeShare = (state, elapsed) =>
  state.duration > 0 ? Math.min(RELOAD_CAP, elapsed / state.duration) : 0;
/* Конец по часам после полной обоймы (фаза `full`): удержание — ровно от конца длительности. */
const finishAtDuration = (state) => ({
  ...state,
  phase: RELOAD_PHASE.finish,
  since: state.since + state.duration - RELOAD_FINISH_MS,
  elapsed: 0,
  from: 1,
  progress: 1,
});

/** Смена ствола (`SET_PLAYER_WEAPON`): перезарядка прежнего забыта, таблица — нет. */
export function reloadWeapon(state, weapon) {
  const current = state || RELOAD_IDLE;
  if (current.weapon === weapon) return current;
  return { ...RELOAD_IDLE, weapon, times: current.times };
}

/**
 * Числа патронов (`SET_AMMO_COUNT`): запас вне обоймы, в обойме, размер обоймы;
 * `now` — часы, мс. Начало, конец, патрон за патроном и ручная перезарядка — см.
 * шапку файла.
 */
export function reloadAmmo(state, input, numbers = {}, now = 0) {
  const config = normalizeReloadIndicator(input);
  const current = state || RELOAD_IDLE;
  /* Числами, как их приводит файл (`ToNumber`): игра шлёт целые. */
  const reserve = Number(numbers.reserve);
  const clip = Number(numbers.clip);
  const size = Number(numbers.size);
  const previous = current.clip;
  const next = { ...current, clip };
  if (!(size > 1) || previous < 0) return next;
  if (clip === 0 && previous > 0) {
    if (!(reserve > 0)) return next;
    const known = (current.times || {})[reloadTimeKey(current.weapon)];
    return {
      ...next,
      phase: RELOAD_PHASE.run,
      since: now,
      elapsed: 0,
      progress: 0,
      shell: 0,
      from: 0,
      duration: known === undefined ? 0 : known,
    };
  }
  if (clip > previous) {
    if (current.phase === RELOAD_PHASE.run) {
      if (!(clip < size) || !(reserve > 0)) {
        /* Кадров могло не быть (прицел спрятан) — доля по часам. */
        const elapsed = elapsedAt(current, now);
        /* Обойма полная раньше срока: стрелять ещё нельзя — заливка дорабатывает по часам. */
        if (current.duration > 0 && elapsed < current.duration)
          return {
            ...next,
            phase: RELOAD_PHASE.full,
            elapsed,
            progress: Math.max(
              current.progress,
              Math.max(elapsed / current.duration, current.shell),
            ),
          };
        /* Конец: длительность вышла (заливка на потолке) или её нет. */
        const time = Math.max(timeShare(current, elapsed), current.shell);
        const from = Math.max(current.progress, time);
        return {
          ...next,
          phase: RELOAD_PHASE.finish,
          since: now,
          elapsed: 0,
          from,
          progress: from,
        };
      }
      const shell = clip / size;
      return { ...next, shell, progress: Math.max(current.progress, shell) };
    }
    if (current.phase === RELOAD_PHASE.full) return next;
    if (!config.manualFlash) return next;
    return {
      ...next,
      phase: RELOAD_PHASE.finish,
      since: now,
      elapsed: 0,
      from: 0,
      progress: 0,
      shell: 0,
    };
  }
  if (clip < previous && current.phase === RELOAD_PHASE.run)
    return { ...next, phase: RELOAD_PHASE.fade, since: now, elapsed: 0 };
  /* Выстрел после полной обоймы: стрелять уже можно — быстрая дозаливка от доли по часам. */
  if (clip < previous && current.phase === RELOAD_PHASE.full) {
    const share = Math.min(1, elapsedAt(current, now) / current.duration);
    const from = Math.max(current.progress, share);
    return {
      ...next,
      phase: RELOAD_PHASE.finish,
      since: now,
      elapsed: 0,
      from,
      progress: from,
    };
  }
  return next;
}

/** Кадр фильма: `now` — часы, мс. */
export function reloadTick(state, now = 0) {
  const current = state || RELOAD_IDLE;
  if (current.phase === RELOAD_PHASE.idle) return current;
  const elapsed = elapsedAt(current, now);
  if (current.phase === RELOAD_PHASE.run) {
    const limit =
      current.duration > 0
        ? current.duration * 2 + RELOAD_TIMEOUT_MS
        : RELOAD_UNKNOWN_LIMIT_MS;
    if (elapsed > limit)
      return { ...current, phase: RELOAD_PHASE.fade, since: now, elapsed: 0 };
    const time = timeShare(current, elapsed);
    return { ...current, elapsed, progress: Math.max(time, current.shell) };
  }
  if (current.phase === RELOAD_PHASE.full) {
    if (!(elapsed < current.duration)) return finishAtDuration(current);
    return {
      ...current,
      elapsed,
      progress: Math.max(elapsed / current.duration, current.shell),
    };
  }
  if (current.phase === RELOAD_PHASE.finish) {
    if (elapsed >= RELOAD_FINISH_MS + RELOAD_HOLD_MS)
      return {
        ...current,
        phase: RELOAD_PHASE.fade,
        since: now,
        elapsed: 0,
        progress: 1,
      };
    const progress =
      elapsed >= RELOAD_FINISH_MS
        ? 1
        : current.from + ((1 - current.from) * elapsed) / RELOAD_FINISH_MS;
    return { ...current, elapsed, progress };
  }
  if (elapsed >= RELOAD_FADE_MS)
    return {
      ...current,
      phase: RELOAD_PHASE.idle,
      elapsed: 0,
      progress: 0,
      from: 0,
      shell: 0,
    };
  return { ...current, elapsed };
}

/** Что сейчас рисовать: видно ли, ступень заливки и прозрачность 0…100. */
export function reloadLook(state, input) {
  const config = normalizeReloadIndicator(input);
  if (!state || state.phase === RELOAD_PHASE.idle)
    return { visible: false, step: 0, alpha: 0 };
  const fade =
    state.phase === RELOAD_PHASE.fade ? 1 - state.elapsed / RELOAD_FADE_MS : 1;
  return {
    visible: true,
    step: reloadStep(state.progress),
    alpha: config.opacity * fade,
  };
}
