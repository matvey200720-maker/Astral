/*
 * Анимация прицела (задача владельца 10.11.2026: «анимированные прицелы, чтобы они могли переливаться или плавно пропадать / затухать, когда убираешь прицеливание»).
 *
 * РАЗВЕДКА по разобранному `hud_reticle.gfx` (класс `HUD_RETICLE`, Steam Legacy c9b2b885…):
 *  • как игра гасит прицел. Фильм не прячет ролик целиком при отпускании прицеливания: игра шлёт `START_DIM_RETICLE([alpha])`, и штатный метод пишет
 *    `this.reticleMC.reticle._alpha = alpha` одним шагом (кроме снайперских: у них метод выходит сразу). Целиком ролик прячет только `SET_RETICLE_VISIBLE(false)`
 *    (`this.CONTENT._visible = …`, и `READY` / `LOAD_RETICLE` при загрузке). Значит плавное затухание возможно ровно там, где игра сама просит «притушить», и
 *    делается твином `TweenStarLite.to(reticle, секунды, { _alpha })` — тем же, что у штатных мигания и затухания; режим «Своя задержка» уже так работает (0,01 с).
 *    Если движок гасит ролик через `SET_RETICLE_VISIBLE(false)` или не рисует его вовсе, затухания не будет: это решает стенд (строка в STAND-CHECKLIST).
 *  • появление. При новом прицеливании игра зовёт `RESET_RETICLE()` (штатно `reticle._alpha = DEFAULT_COLOUR[3]` одним шагом) и `START_DIM_RETICLE` с большей яркостью.
 *    Плавное появление — тот же твин вверх.
 *  • выстрел. События выстрела в ролик игра НЕ шлёт: у класса нет метода выстрела. Есть событие попадания — `SHOW_HITMARKER([1 | 2])` (1 — убийство, 2 — попадание).
 *    «Пульс при выстреле» поэтому невозможен, возможен «пульс при попадании»: на попадании прозрачность всего ролика (`CONTENT._alpha`, штатный код её не трогает) на миг
 *    проседает и твином возвращается.
 *  • что не делаем. Масштаб при появлении («лёгкое сжатие»): позиция прицела — `reticle._x/_y` самого клипа, а `_xscale/_yscale` того же клипа пишет игра (`dotScaler`) при
 *    каждой смене цели, любой масштаб поверх разошёлся бы с ней.
 *  • переливание (ведущая 10.11.2026: «обход без кода, кадрами»). Цвет красит игра, но только одному именованному клипу: `Colour.Colourise(this.reticleMC.reticle, r, g, b, a)` —
 *    во всех пяти ветках `SET_RETICLE_LOCKON_TYPE` (и в `STOP_FLASHING_RETICLE` / `START_FLASHING_RETICLE`), ColorTransform со сдвигом (r − 255, g − 255, b − 255), множители 1.
 *    Покадрового скрипта для цвета не нужно: временная шкала фильма идёт (отметка попадания проигрывает свои 15 кадров через `gotoAndPlay`, мини-карта мигает точками тем же
 *    способом), а вложенный клип крутит свою шкалу сам, даже когда родитель остановлен `gotoAndStop`. Поэтому заливка прицела кладётся не фигурой, а зацикленным клипом из
 *    кадров, в каждом из которых то же самое белое поле с другим `cxform` (сплошной цвет, альфа фигуры не трогается). Кадры считает `shimmerColourAt` — одна арифметика
 *    у окна и у компилятора. Игра при этом красит родителя: пока цели нет, она красит белым (сдвиг 0) — перелив выходит в точности заданных цветов; на цели (союзник, захват,
 *    враг) клип остаётся статичным и цвет задаёт игра, как раньше (для этого `SET_RETICLE_LOCKON_TYPE` ставит союзнику и захвату кадр 2, а не 1).
 *    Шкала ролика и сброс: `reticleMC.gotoAndStop(кадр)` вызывает только `SET_RETICLE_TYPE` (смена оружия), `SET_RETICLE_VISIBLE` кадров не трогает, поэтому перелив не
 *    сбрасывается на показе; на смене оружия клип создаётся заново и идёт с первого кадра. Что `reticle.gotoAndStop(1)` из кадра 2 перезапускает клип (а не продолжает), —
 *    догадка о движке, для перелива она безвредна (цвета начинаются с первого); проверяет стенд.
 *
 * Все поля по умолчанию выключены — прежний прицел собирается байт в байт.
 */

import { normalizeHex } from "./colour.js";

/** Пределы полей; границы — те же, что видит редактор. */
export const RETICLE_ANIMATION_LIMITS = Object.freeze({
  /** Длительность затухания, с: 0,01 — как в игре (одним шагом), больше — плавно. */
  fadeSeconds: Object.freeze({ min: 0.01, max: 2, step: 0.05 }),
  /** Длительность появления, с: 0 — сразу, как в игре. */
  appearSeconds: Object.freeze({ min: 0, max: 1.5, step: 0.05 }),
  /** Насколько прозрачность проседает на попадании, % от полной. */
  hitPulseStrength: Object.freeze({ min: 10, max: 80, step: 5 }),
  /** За сколько прозрачность возвращается, с. */
  hitPulseSeconds: Object.freeze({ min: 0.08, max: 0.8, step: 0.02 }),
  /** Один оборот перелива, с. */
  shimmerSeconds: Object.freeze({ min: 0.8, max: 8, step: 0.1 }),
  /** Сколько цветов в переливе. */
  shimmerColours: Object.freeze({ min: 2, max: 4 }),
});

/** Кадров в секунду у `hud_reticle.gfx` (заголовок файла: 30,0) — столько кадров ролик играет в секунду. */
export const RETICLE_MOVIE_FPS = 30;
/** Предел кадров одного оборота перелива: меньше — рывки, больше — лишний вес файла. */
export const SHIMMER_FRAME_LIMITS = Object.freeze({ min: 24, max: 240 });

export const DEFAULT_RETICLE_ANIMATION = Object.freeze({
  fadeSeconds: RETICLE_ANIMATION_LIMITS.fadeSeconds.min,
  appearSeconds: 0,
  hitPulse: false,
  hitPulseStrength: 35,
  hitPulseSeconds: 0.25,
  shimmer: false,
  shimmerSeconds: 3,
  shimmerColours: Object.freeze(["#ffffff", "#7fd8ff"]),
});

const clamp = (value, { min, max }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 1000) / 1000));
};

/** Цвета перелива: от двух до четырёх верных `#rrggbb`; меньше двух — цвета по умолчанию. */
function normalizeShimmerColours(input) {
  const { min, max } = RETICLE_ANIMATION_LIMITS.shimmerColours;
  const colours = (Array.isArray(input) ? input : []).map((value) => normalizeHex(value, null)).filter(Boolean).slice(0, max);
  return colours.length >= min ? colours : [...DEFAULT_RETICLE_ANIMATION.shimmerColours];
}

/** Настройки анимации прицела в границах контракта (без поля — всё выключено). */
export function normalizeReticleAnimation(input) {
  const source = input && typeof input === "object" ? input : {};
  const limits = RETICLE_ANIMATION_LIMITS;
  return {
    fadeSeconds: clamp(source.fadeSeconds, limits.fadeSeconds, DEFAULT_RETICLE_ANIMATION.fadeSeconds),
    appearSeconds: clamp(source.appearSeconds, limits.appearSeconds, DEFAULT_RETICLE_ANIMATION.appearSeconds),
    hitPulse: source.hitPulse === true,
    hitPulseStrength: clamp(source.hitPulseStrength, limits.hitPulseStrength, DEFAULT_RETICLE_ANIMATION.hitPulseStrength),
    hitPulseSeconds: clamp(source.hitPulseSeconds, limits.hitPulseSeconds, DEFAULT_RETICLE_ANIMATION.hitPulseSeconds),
    shimmer: source.shimmer === true,
    shimmerSeconds: clamp(source.shimmerSeconds, limits.shimmerSeconds, DEFAULT_RETICLE_ANIMATION.shimmerSeconds),
    shimmerColours: normalizeShimmerColours(source.shimmerColours),
  };
}

/** Есть ли в настройках хоть что-то анимированное. */
export const reticleAnimationActive = (animation) =>
  animation.fadeSeconds > RETICLE_ANIMATION_LIMITS.fadeSeconds.min || animation.appearSeconds > 0 || animation.hitPulse === true || animation.shimmer === true;

/** Сколько кадров занимает один оборот перелива. */
export const shimmerFrameCount = (seconds) =>
  Math.max(SHIMMER_FRAME_LIMITS.min, Math.min(SHIMMER_FRAME_LIMITS.max, Math.round(Number(seconds) * RETICLE_MOVIE_FPS) || SHIMMER_FRAME_LIMITS.min));

const channelsOf = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/**
 * Цвет перелива на доле оборота `phase` (0…1, 1 = снова начало): плавный переход от цвета к цвету по кругу, с замедлением у каждого цвета.
 * Один и тот же расчёт у компилятора (кадры клипа) и окна (предпросмотр). Возвращает [r, g, b].
 */
export function shimmerColourAt(colours, phase) {
  const list = (Array.isArray(colours) && colours.length ? colours : DEFAULT_RETICLE_ANIMATION.shimmerColours).map((hex) => channelsOf(normalizeHex(hex, "#ffffff")));
  const wrapped = ((Number(phase) % 1) + 1) % 1;
  const scaled = wrapped * list.length;
  const index = Math.floor(scaled);
  const along = scaled - index;
  const eased = along * along * (3 - 2 * along);
  const from = list[index % list.length];
  const to = list[(index + 1) % list.length];
  return from.map((channel, at) => Math.round(channel + (to[at] - channel) * eased));
}
