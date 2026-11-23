/*
 * Ручки обработки звука — одна схема на обе студии звука.
 *
 * Здесь только данные: какие ручки есть, их границы, «как без обработки» и
 * отпечаток. Сама обработка — в окне (`sound-fx.js`, OfflineAudioContext), а
 * схема нужна и окну, и разбору проекта прежней студии (`normalizeAssignment`
 * чистит ручки назначения по тем же границам), поэтому живёт в пакете.
 *
 * Ручки называются тем, что человек хочет сделать со звуком, а не тем, как
 * это сделано: «Приглушить», а не «ФНЧ 2,4 кГц».
 *
 * Задача 3 ТЗ 07.10.2026 развела скорость и тон. Задача 6 ТЗ 10.10.2026
 * (вечер, «свой звук длиннее нужного») добавила подгонку длины: скорость до
 * ×4 и «как плёнка» (`tape` — быстрее и выше разом), «Плотнее» (компрессор),
 * «Срезать низ» (ФВЧ — вместе с «Приглушить» даёт рацию и телефон) и петлю
 * без щелчка (`loop`, шов `loopFade`) для мест, которые игра крутит по кругу.
 * `fit` — какой подгонкой собран звук; на сэмплы она не влияет и нужна окну,
 * чтобы повторное открытие показало тот же выбор.
 */

export const FIT_MODES = Object.freeze(["trim", "speed", "loop", "keep"]);

export const FX_DEFAULTS = Object.freeze({
  gain: 0,
  muffle: 0,
  bass: 0,
  treble: 0,
  drive: 0,
  echo: 0,
  room: 1.2,
  pitch: 0,
  trimStart: 0,
  trimEnd: 0,
  fadeOut: 12,
  normalize: true,
  /* Ручки задачи 3 ТЗ 07.10.2026 — после прежних: прежние работы читаются
     как были. */
  speed: 1,
  mid: 0,
  echoDelay: 0,
  echoFeedback: 35,
  echoMix: 40,
  fadeIn: 0,
  reverse: false,
  /* Ручки задачи 6 ТЗ 10.10.2026 (вечер). */
  tape: false,
  comp: 0,
  lowcut: 0,
  loop: false,
  loopFade: 60,
  fit: "",
});

/* Ручки, которых не было до 07.10.2026: в отпечаток идут, только когда
   их тронули, — иначе каждая стоящая в игре работа показалась бы новой. */
const EXTRA_KNOBS = Object.freeze([
  "speed",
  "mid",
  "echoDelay",
  "echoFeedback",
  "echoMix",
  "fadeIn",
  "reverse",
  "tape",
  "comp",
  "lowcut",
  "loop",
  "loopFade",
]);

/* Границы ручек: окно рисует ползунки по ним, модель зажимает по ним же. */
export const FX_LIMITS = Object.freeze({
  gain: Object.freeze({ min: -30, max: 6, step: 0.5 }),
  muffle: Object.freeze({ min: 0, max: 100, step: 1 }),
  bass: Object.freeze({ min: -12, max: 12, step: 0.5 }),
  treble: Object.freeze({ min: -12, max: 12, step: 0.5 }),
  drive: Object.freeze({ min: 0, max: 100, step: 1 }),
  echo: Object.freeze({ min: 0, max: 100, step: 1 }),
  room: Object.freeze({ min: 0.2, max: 4, step: 0.1 }),
  pitch: Object.freeze({ min: -12, max: 12, step: 1 }),
  trimStart: Object.freeze({ min: 0, max: 600, step: 0.001 }),
  trimEnd: Object.freeze({ min: 0, max: 600, step: 0.001 }),
  fadeOut: Object.freeze({ min: 0, max: 2000, step: 1 }),
  /* ×4 — подогнать длинный файл под короткое место; дальше уже не звук,
     а писк. ×0,25 — «тяжелее» в четыре раза. */
  speed: Object.freeze({ min: 0.25, max: 4, step: 0.01 }),
  mid: Object.freeze({ min: -12, max: 12, step: 0.5 }),
  echoDelay: Object.freeze({ min: 0, max: 1000, step: 5 }),
  echoFeedback: Object.freeze({ min: 0, max: 90, step: 1 }),
  echoMix: Object.freeze({ min: 0, max: 100, step: 1 }),
  fadeIn: Object.freeze({ min: 0, max: 2000, step: 1 }),
  comp: Object.freeze({ min: 0, max: 100, step: 1 }),
  lowcut: Object.freeze({ min: 0, max: 100, step: 1 }),
  loopFade: Object.freeze({ min: 5, max: 1000, step: 5 }),
});

const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/* Скорость прежней «плёнки» для тона в полутонах. */
const tapeSpeed = (pitch) => 2 ** (pitch / 12);

/** Ручки в границах; всё незнакомое — как по умолчанию. */
export function normalizeFx(value) {
  const source = value && typeof value === "object" ? value : {};
  const fx = {};
  for (const [name, limits] of Object.entries(FX_LIMITS)) {
    const number = finite(source[name], FX_DEFAULTS[name]);
    fx[name] = Math.min(limits.max, Math.max(limits.min, number));
  }
  fx.pitch = Math.round(fx.pitch);
  fx.normalize = source.normalize !== false;
  fx.reverse = source.reverse === true;
  fx.tape = source.tape === true;
  fx.loop = source.loop === true;
  fx.fit = FIT_MODES.includes(source.fit) ? source.fit : "";
  /* Работа до 07.10.2026: «Тон» был скоростью плёнки — та же скорость. */
  if (source.speed === undefined)
    fx.speed = Math.min(
      FX_LIMITS.speed.max,
      Math.max(FX_LIMITS.speed.min, tapeSpeed(fx.pitch)),
    );
  return fx;
}

/* Скорость та же, что у прежней плёнки при этом тоне. */
const tapeLike = (fx) => Math.abs(fx.speed - tapeSpeed(fx.pitch)) < 1e-6;

/** Все ручки на месте «как есть» — обработки нет. */
export const fxIsNeutral = (fx) => {
  const value = normalizeFx(fx);
  return (
    value.gain === 0 &&
    value.muffle === 0 &&
    value.bass === 0 &&
    value.treble === 0 &&
    value.drive === 0 &&
    value.echo === 0 &&
    value.pitch === 0 &&
    value.trimStart === 0 &&
    value.trimEnd === 0 &&
    Math.abs(value.speed - 1) < 1e-6 &&
    value.mid === 0 &&
    (value.echoDelay === 0 || value.echoMix === 0) &&
    value.fadeIn === 0 &&
    !value.reverse &&
    value.comp === 0 &&
    value.lowcut === 0 &&
    !value.loop
  );
};

/* Ручка задачи 6 меняет сэмплы, только когда к ней есть на что: «как
   плёнка» — при скорости не ×1, шов — у петли. */
const extraMatters = (name, value) => {
  if (name === "speed") return !tapeLike(value);
  if (name === "tape") return value.tape && Math.abs(value.speed - 1) >= 1e-6;
  if (name === "loopFade")
    return value.loop && value.loopFade !== FX_DEFAULTS.loopFade;
  return value[name] !== FX_DEFAULTS[name];
};

/* Строка всех ручек — ключ запаса рендеров и часть отпечатка установки.
   Новые ручки — только тронутые; скорость — только не «как у плёнки». */
export const fxKey = (fx) => {
  const value = normalizeFx(fx);
  const base = Object.keys(FX_DEFAULTS)
    .filter((name) => !EXTRA_KNOBS.includes(name) && name !== "fit")
    .map((name) => String(value[name]))
    .join("|");
  const extras = EXTRA_KNOBS.filter((name) => extraMatters(name, value)).map(
    (name) => `${name}=${value[name]}`,
  );
  return extras.length ? `${base}|${extras.join("|")}` : base;
};

/*
 * Обработка поверх назначения прежней студии.
 *
 * У назначения уже есть свои поля — обрезка, громкость в процентах, плавные
 * края, тон плёнкой, реверс, нормализация, — и звучат они так же, как до
 * задачи 6. Новое (тембр, скорость с высотой и без, рация, петля…) ложится
 * рядом отдельным объектом и только тронутыми ручками: назначение без них —
 * `null`, и его звук и отпечаток не меняются ни на байт.
 */
export const ASSIGNMENT_FX_KNOBS = Object.freeze([
  /* Тон без темпа (готовые «Тяжелее», «Звонче») — рядом с плёночным тоном
     назначения, а не вместо него. */
  "pitch",
  "bass",
  "mid",
  "treble",
  "muffle",
  "drive",
  "echo",
  "room",
  "echoDelay",
  "echoFeedback",
  "echoMix",
  "speed",
  "tape",
  "comp",
  "lowcut",
  "loop",
  "loopFade",
  "fit",
]);

export function normalizeAssignmentFx(value) {
  if (!value || typeof value !== "object") return null;
  const fx = normalizeFx({ ...value, speed: value.speed ?? 1 });
  const kept = {};
  for (const name of ASSIGNMENT_FX_KNOBS)
    if (fx[name] !== FX_DEFAULTS[name]) kept[name] = fx[name];
  return Object.keys(kept).length ? kept : null;
}
