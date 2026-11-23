/*
 * Частота окна проигрывания «Анимации» (1.11.2026): шестьдесят кадров в секунду на любой машине, а слабая видеокарта режет не частоту, а разрешение.
 *
 * Раньше профиль по названию видеочипа («low» — Intel HD/UHD) и средний интервал выше 23 мс навсегда переводили окно на тридцать кадров при плотности 1,0 без сглаживания — на
 * ноутбуке это и была рваная пикселизованная картинка. Здесь решение без видеокарты и окна, чтобы его можно было проверить:
 *  - окно рисует в плотность экрана (до двух), доля от неё — \`scale\` (\`MIN_SCALE\`…1);
 *  - не успевает: скользящее среднее интервала выше \`SLOW_MS\` и выше собственной развёртки экрана на пятую часть (экран на 30 Гц сам даёт 33 мс, и разрешение тут ни при чём) —
 *    доля падает на шаг \`SCALE_STEP\`, не чаще раза в \`STEP_FRAMES\` кадров;
 *  - шаг не помог (интервал не стал короче на \`MIN_GAIN\`) — значит, тормозит не видеочип, а что-то снаружи (чужая нагрузка процессора, компоновка окна): доля возвращается и
 *    больше не режется, чтобы не мылить картинку зря (замер 1.11.2026: на занятом ПК доля падала до 0,55 при тех же 20 мс интервала);
 *  - интервал с запасом ниже \`FAST_MS\` долго (\`RAISE_FRAMES\`) — доля возвращается к полной;
 *  - тридцать кадров — последняя мера: на самой низкой доле интервал всё ещё выше \`HALF_MS\`.
 */

export const SLOW_MS = 21;
export const FAST_MS = 17.4;
export const HALF_MS = 29;
export const DISPLAY_SLACK = 1.18;
export const DEFAULT_DISPLAY_MS = 16.7;
export const WARMUP_FRAMES = 60;
export const STEP_FRAMES = 40;
export const RAISE_FRAMES = 240;
export const SCALE_STEP = 0.85;
export const MIN_GAIN = 0.05;
export const MIN_SCALE = 0.65;

/** Начальное состояние: для сцены и для нового разгона. */
export const newPace = () => ({ interval: 0, shownAt: 0, frames: 0, since: 0, calm: 0, probe: null, futile: false, half: false });

/**
 * Один показанный кадр в \`now\`. \`pace\` меняется на месте. \`scale\` — нынешняя доля, \`displayMs\` — развёртка экрана (0 — не измерена).
 * Ответ — новая доля или \`null\`, если она не меняется.
 */
export function stepPace(pace, { now, scale, displayMs = 0, minScale = MIN_SCALE }) {
  const gap = now - pace.shownAt;
  if (pace.shownAt && gap < 120) pace.interval = pace.interval ? pace.interval * 0.95 + gap * 0.05 : gap;
  pace.shownAt = now;
  pace.frames += 1;
  pace.since += 1;
  if (pace.frames <= WARMUP_FRAMES) return null;
  const slow = pace.interval > Math.max(SLOW_MS, (displayMs || DEFAULT_DISPLAY_MS) * DISPLAY_SLACK);
  if (slow) pace.calm = 0;
  else if (pace.interval < FAST_MS) pace.calm += 1;

  /* Прошлый шаг: помог ли он. Оценка — через \`STEP_FRAMES\` кадров, пока скользящее среднее устоялось. */
  if (pace.probe) {
    if (pace.since < STEP_FRAMES) return null;
    const { scale: before, interval } = pace.probe;
    pace.probe = null;
    pace.since = 0;
    if (pace.interval > interval * (1 - MIN_GAIN)) {
      pace.futile = true;
      return before;
    }
    return null;
  }
  if (slow && !pace.futile && pace.since >= STEP_FRAMES) {
    if (scale > minScale + 0.01) {
      pace.probe = { scale, interval: pace.interval };
      pace.since = 0;
      return Math.max(minScale, scale * SCALE_STEP);
    }
    if (!pace.half && pace.interval > HALF_MS) pace.half = true;
    return null;
  }
  if (!slow && pace.calm >= RAISE_FRAMES && scale < 1 && !pace.half) {
    pace.calm = 0;
    pace.since = 0;
    /* Вернулись к доле, от которой уходили, — следующую попытку режем заново: нагрузка могла смениться. */
    pace.futile = false;
    return Math.min(1, scale / SCALE_STEP);
  }
  return null;
}
