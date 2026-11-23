/*
 * Ровный шаг кадров сцен с движением — общий модуль движка мастерской: окно «Анимации» (2.11.2026, владелец: «анимация дергает») и живой
 * персонаж мастерской одежды (`createPoseTempo` в `gun/gun-scene.js`, 2.11.2026: там был тот же порог 13,7 мс по часам обработчика, и поза
 * бралась по ним же).
 *
 * Было: предел в шестьдесят кадров считал время по `performance.now()` в обработчике кадра — «рано ли» и «который момент клипа». На экране 200 Гц
 * (5 мс развёртка) порог 13,7 мс пропускал то две, то три развёртки подряд: кадры шли через 15 и 20 мс вперемешку (55–66 в секунду), а момент
 * клипа брался со сдвигом обработчика внутри кадра (0,3–8 мс: React, снимки плиток). Глаз видит это как рывки быстрого движения, хотя кадров
 * «шестьдесят». У мастерской одежды то же самое (`anim-cadence.mjs --simulate --wear`): на 144–200 Гц промежутки вперемешку, а на 75 Гц
 * промежутки 13,3/26,7 мс давали среднее больше 23 мс, и персонаж уходил на медленный темп (≈ 25 кадров).
 *
 * Стало: время кадра — метка развёртки (`frameTime` от `requestAnimationFrame`, одна на кадр экрана); шаг — целое число развёрток, одно и то же
 * весь клип: `stride` = ⌊частота экрана / предел⌋ (не меньше 1). 60 Гц — каждую развёртку, 75 — каждую (75 кадров), 120 и 144 — через одну
 * (60 и 72), 165 — через одну (82), 200 — каждую третью (66,7). Развёртка меряется по самим кадрам (нижняя треть промежутков между соседними
 * вызовами), пока замера нет — по `displayMs` окна или порогом времени, как раньше. Здесь — без окна и видеокарты, чтобы это можно было проверить.
 */

/* Сколько промежутков между соседними вызовами помнит замер развёртки. */
export const VSYNC_SAMPLES = 24;
/* Промежуток длиннее — не развёртка, а простой (пауза, спрятанное окно, долгая задача). */
const VSYNC_MAX_MS = 50;
/* Запас к «⌊частота / предел⌋»: экран 120 Гц меряется как 119,8 — это всё ещё две развёртки на кадр при пределе 60. */
const STRIDE_SLACK = 0.05;
/* Без замера развёртки — прежний порог: кадр не раньше предела минус запас на дрожь. */
const FALLBACK_SLACK_MS = 3;

/** Новое состояние шага: на сцену и на новый клип (замер развёртки при новом клипе сохраняется, `restartCadence`). */
export const newCadence = () => ({ last: 0, drawnAt: 0, gaps: [] });

/** Новый клип или конец паузы: следующий кадр рисуется сразу, замер развёртки остаётся. */
export function restartCadence(cadence) {
  cadence.drawnAt = 0;
  cadence.last = 0;
}

/** Развёртка экрана по замеру, мс; 0 — замера ещё нет. */
export function vsyncOf(cadence) {
  const gaps = cadence.gaps;
  if (gaps.length < 6) return 0;
  const sorted = [...gaps].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 3)];
}

/** Сколько развёрток на кадр при пределе `maxFps` и развёртке `vsyncMs`: не меньше одной. */
export function strideFor(vsyncMs, maxFps) {
  if (!(vsyncMs > 0) || !(maxFps > 0)) return 1;
  return Math.max(1, Math.floor(1000 / vsyncMs / maxFps + STRIDE_SLACK));
}

/* Промежуток от прошлого вызова — в замер развёртки; тот же `frameTime` второй раз не считается. */
function listen(cadence, frameTime, measure) {
  if (measure && cadence.last && frameTime > cadence.last) {
    const gap = frameTime - cadence.last;
    if (gap < VSYNC_MAX_MS) {
      cadence.gaps.push(gap);
      if (cadence.gaps.length > VSYNC_SAMPLES) cadence.gaps.shift();
    }
  }
  cadence.last = frameTime;
}

/**
 * Кадр нарисован на развёртке `frameTime` помимо шага (камера движется, просьба со стороны): следующий шаг считается от него.
 * `measure: false` — вызовы идут не каждую развёртку (цикл спит таймером), их промежутки — не развёртка, замер остаётся прежним.
 */
export function cadenceDrawn(cadence, frameTime, { measure = true } = {}) {
  listen(cadence, frameTime, measure);
  cadence.drawnAt = frameTime;
}

/**
 * Вызов кадра на развёртке `frameTime`: рисовать ли его. `cadence` меняется на месте. `displayMs` — развёртка, измеренная окном заранее
 * (0 — нет), пока своих промежутков мало. `measure: false` — как у `cadenceDrawn`.
 */
export function cadenceDue(cadence, frameTime, { maxFps = 60, displayMs = 0, measure = true } = {}) {
  listen(cadence, frameTime, measure);
  if (!cadence.drawnAt || frameTime < cadence.drawnAt) {
    cadence.drawnAt = frameTime;
    return true;
  }
  const vsync = vsyncOf(cadence) || displayMs;
  const passed = frameTime - cadence.drawnAt;
  const due = vsync > 0 ? Math.round(passed / vsync) >= strideFor(vsync, maxFps) : passed >= 1000 / maxFps - FALLBACK_SLACK_MS;
  if (due) cadence.drawnAt = frameTime;
  return due;
}
