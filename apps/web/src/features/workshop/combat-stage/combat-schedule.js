/*
 * Расписание выстрелов 3D-предпросмотров эффектов (задача 4А, 18.10.2026).
 *
 * Чистые функции и счётчик времени без сцены — проверяются тестами. Сцена
 * спрашивает у счётчика, сколько выстрелов наступило за кадр и насколько каждый
 * опоздал: новый эффект проигрывается вперёд на это опоздание, поэтому очередь
 * на 74 выстрела в секунду не «слипается» по кадрам, как не слипается в игре.
 */

/* Как стреляет стрелок:
 *   single — по одному: следующий, когда прежний догорел и прошла пауза
 *            (как было в плоской сцене: видно каждый выброс целиком);
 *   burst  — очередями в темпе ствола, между очередями пауза;
 *   auto   — не отпуская спуск, в темпе ствола. */
export const SHOT_STYLES = Object.freeze(["single", "burst", "auto"]);

/* Карабин — штатный ствол сцены: его темп (444 выстрела в минуту) в игре. */
export const DEFAULT_RPM = 444;

/** Секунд между выстрелами по темпу ствола (выстрелов в минуту). */
export const shotInterval = (rpm) => (Number(rpm) > 0 ? 60 / Number(rpm) : 0.25);

/**
 * Счётчик выстрелов.
 *
 * @param {object} [options]
 * @param {"single"|"burst"|"auto"} [options.style]
 * @param {number} [options.interval] — секунд между выстрелами очереди
 * @param {number} [options.burst] — выстрелов в очереди
 * @param {number} [options.gap] — пауза между очередями, с
 * @param {number} [options.pause] — пауза между одиночными, с
 */
export function createShotClock(options = {}) {
  let style = "burst";
  let interval = shotInterval(DEFAULT_RPM);
  let burst = 5;
  let gap = 1.15;
  let pause = 0.35;
  let wait = 0;
  let left = burst;
  let quiet = 0;

  function configure(next = {}) {
    if (SHOT_STYLES.includes(next.style)) style = next.style;
    if (next.interval > 0) interval = next.interval;
    if (next.burst >= 1) burst = Math.floor(next.burst);
    if (next.gap >= 0) gap = next.gap;
    if (next.pause >= 0) pause = next.pause;
    left = Math.min(left, burst);
  }
  configure(options);
  left = burst;

  /** Сначала: первый выстрел — сразу. */
  function reset() {
    wait = 0;
    left = burst;
    quiet = 0;
  }

  /**
   * Прошло `dt` секунд, `active` эффектов ещё играют (нужно «по одному»).
   * Возвращает опоздание каждого наступившего выстрела, с: сколько прошло
   * после его срока к концу шага.
   */
  function advance(dt, active = 0) {
    const shots = [];
    if (style === "single") {
      if (active > 0) {
        quiet = 0;
        return shots;
      }
      quiet += dt;
      if (quiet >= pause) {
        shots.push(quiet - pause);
        quiet = 0;
      }
      return shots;
    }
    let remaining = dt;
    for (let guard = 0; guard < 64; guard += 1) {
      if (wait > remaining) {
        wait -= remaining;
        break;
      }
      remaining -= wait;
      shots.push(remaining);
      if (style === "auto") wait = interval;
      else {
        left -= 1;
        if (left > 0) wait = interval;
        else {
          wait = gap;
          left = burst;
        }
      }
    }
    return shots;
  }

  return {
    configure,
    reset,
    advance,
    get style() {
      return style;
    },
    get interval() {
      return interval;
    },
  };
}

/* Малый детерминированный генератор (mulberry32): один и тот же выстрел —
   один и тот же исход при любом числе перерисовок. */
export function seededUnit(seed) {
  let a = (seed >>> 0) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/* У своего выстрела игра зажимает LOD следа в начало шкалы: свой трассер
   виден всегда, а не растворяется с расстоянием до стрелка. */
export const OWN_SHOT_LOD = Object.freeze([0, 0.05]);

/**
 * Ступень LOD эффекта у выстрела (0…1). Чужой выстрел — по расстоянию от
 * камеры до эффекта (границы `rule.lod`), свой — в `OWN_SHOT_LOD`.
 */
export function shotLod({ own = false, distance = 0, lod = null, jitter = 0.5 }) {
  if (own) return OWN_SHOT_LOD[0] + (OWN_SHOT_LOD[1] - OWN_SHOT_LOD[0]) * Math.min(Math.max(jitter, 0), 1);
  const min = Number(lod?.min);
  const max = Number(lod?.max);
  if (!(max > min)) return 0;
  return Math.min(Math.max((distance - min) / (max - min), 0), 1);
}
