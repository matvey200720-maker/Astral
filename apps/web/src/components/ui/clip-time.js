/*
 * Время и перемотка проигрывателя ролика (`ClipPlayer.jsx`, `ClipControls.jsx`): чистые функции без React — их же смотрят тесты.
 */

/** Сколько секунд проматывает стрелка на полосе, сколько — PageUp и PageDown. */
export const SEEK_STEP = 5;
export const SEEK_STEP_BIG = 10;

/** Через сколько органы прячутся, если ролик играет, а мышь стоит (ТЗ владельца 29.10.2026: «прячутся через ~2 с»). */
export const CONTROLS_IDLE_MS = 2000;

const finite = (value) => Number.isFinite(value) && value >= 0;

/** «0:12», у длинных роликов «1:02:03»; неизвестное (длина ещё не пришла) — «0:00». */
export function clipClock(seconds) {
  const total = finite(seconds) ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Доля 0…1: сколько ролика позади. Длины нет — полоса пуста. */
export function clipFraction(time, duration) {
  if (!finite(time) || !finite(duration) || duration <= 0) return 0;
  return Math.min(1, time / duration);
}

/** Куда попал щелчок на полосе: доля ширины (0…1) → секунды ролика. */
export function seekTarget(fraction, duration) {
  if (!finite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, fraction)) * duration;
}

/** Сдвиг стрелкой: время ± шаг, не дальше краёв ролика. */
export function nudgeTime(time, delta, duration) {
  const next = (finite(time) ? time : 0) + delta;
  const end = finite(duration) ? duration : next;
  return Math.min(end, Math.max(0, next));
}
