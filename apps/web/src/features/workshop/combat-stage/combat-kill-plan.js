/*
 * Постановка килл-эффекта в 3D-сцене (задача 4А, 18.10.2026): когда стреляет
 * наш персонаж, когда враг падает и сколько играет сам эффект. Чистые функции —
 * проверяются тестами.
 *
 * Время — то же, что у шкалы редактора: миллисекунды после килла. Ноль — убивающий
 * выстрел; эффект экрана идёт от нуля ровно столько, сколько выставил человек
 * (`project.duration`), и ролик длится эффект плюс пауза до повтора: удлинил
 * эффект — удлинился ролик.
 *
 * Падение врага — не анимация игры, а поворот тела вокруг ступней под
 * действием «тяжести»: анимации падения хранятся в клипах игры, и читать их
 * ради одного кадра предпросмотра нечем. Подпись кадра говорит это прямо.
 */

/* Очередь нашего персонажа: убивающий выстрел и два следом, мс после килла. */
export const KILL_SHOT_TIMES = Object.freeze([0, 90, 180]);
/* Враг начинает падать через мгновение после выстрела и ложится за 0,6 с. */
export const FALL_START_MS = 30;
export const FALL_MS = 600;
/* Тело лёжа — спиной на земле, таз выше неё на толщину спины, м. */
export const LIE_LIFT = 0.14;
/* Шаг назад больше этого — перемотка, а не ход времени: выстрелы не наверстываются. */
export const MAX_JUMP_MS = 300;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Длина ролика: эффект и пауза до повтора.
 *
 * @param {object} input
 * @param {number} input.effectMs — длительность эффекта, что выставил человек
 * @param {number} input.gapMs — пауза до следующего повтора
 */
export function killClip({ effectMs, gapMs }) {
  const effect = Math.max(1, Number(effectMs) || 0);
  const gap = Math.max(0, Number(gapMs) || 0);
  return { killAt: 0, effectEnd: effect, loop: effect + gap };
}

/** Выстрелы, что наступили за шаг от `previous` до `now`; перемотка вперёд большим скачком их не стреляет. */
export function shotsCrossed(previous, now, times = KILL_SHOT_TIMES) {
  /* Круг начался заново (или «Килл» нажали с нуля): всё, что у нуля, — следующее. */
  const from = now < previous ? Number.NEGATIVE_INFINITY : previous;
  if (Number.isFinite(from) && now - from > MAX_JUMP_MS) return [];
  if (!Number.isFinite(from) && now > MAX_JUMP_MS) return [];
  return times.map((at, index) => ({ index, at })).filter((shot) => shot.at > from && shot.at <= now);
}

/** Ход падения 0…1: до начала враг стоит, после — лежит. */
export const fallProgress = (momentMs) => clamp01((momentMs - FALL_START_MS) / FALL_MS);

/* Враг падает не строго вдоль линии огня (камера за плечом стрелка смотрела бы вдоль падения, и оно
   сжималось бы в точку), а чуть вбок: так падение читается с места, откуда на него смотрят. */
export const FALL_LEAN = 0.6;

/**
 * Поза падающего врага: наклон тела вокруг горизонтальной оси и положение таза
 * относительно ступней, которые стоят на месте. Падает назад — от стрелка, с
 * уходом на `lean` радиан в сторону +X.
 *
 * @param {number} progress — `fallProgress`
 * @param {number} footLift — высота таза над землёй стоя, м
 * @param {number} [lean] — азимут падения: 0 — вдоль +Y (от стрелка), положительный — к +X
 * @returns {{ tilt: number, lean: number, position: number[] }} `tilt` — угол падения, `position` — таз в мире при ступнях в начале координат
 */
export function toppleFor(progress, footLift, lean = FALL_LEAN) {
  /* Тяжесть: падение ускоряется, поэтому угол растёт квадратом хода. */
  const angle = (Math.PI / 2) * progress * progress;
  const reach = footLift * Math.sin(angle);
  return {
    tilt: angle,
    lean,
    position: [reach * Math.sin(lean), reach * Math.cos(lean), footLift * Math.cos(angle) + LIE_LIFT * Math.sin(angle)],
  };
}
