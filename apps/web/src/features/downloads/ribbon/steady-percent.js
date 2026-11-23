/*
 * Процент строки «Загрузок» (владелец 18.11.2026, 17:40): «проценты есть, но они иногда пропадают… оставь просто проценты».
 *
 * Правило одно на любой вид установки (мод каталога, одежда, ганпак, часть сборки, работа мастерской): число видно от постановки в очередь до
 * «Готово», не уходит в тире и не откатывается назад, когда меняется этап или событие приходит без числа. Источник числа — по убыванию
 * доверия: доля из события хода (`fraction`, 0…1), потом `done / total`, потом ровный ход по времени (`pacePercent`) — для работ и установок,
 * у которых событий нет вовсе (одежда из каталога, этап «Подготовка» дорог, воды, текстур, зданий).
 */

const MEMORY = new Map();
const MEMORY_LIMIT = 64;

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Число, которое строка показывает: не меньше показанного раньше. `key` — строка очереди (`queueId` или `id:попытка` работы); `value` — то, что
 * знаем сейчас (проценты или `null`). Без ключа — как есть. Память ограничена: старые строки забываются первыми.
 */
export function steadyPercent(key, value) {
  const now = Number.isFinite(value) ? clamp(value) : null;
  if (!key) return now;
  const before = MEMORY.get(key) ?? 0;
  const next = now === null ? before : Math.max(before, now);
  MEMORY.delete(key);
  MEMORY.set(key, next);
  if (MEMORY.size > MEMORY_LIMIT) MEMORY.delete(MEMORY.keys().next().value);
  return next;
}

/** Что показывалось строке последним (0, если ничего), без обновления — для остановившейся строки. */
export const lastPercent = (key) => (key ? (MEMORY.get(key) ?? 0) : 0);

/** Строка ушла из очереди — число о ней больше не нужно. */
export const forgetPercent = (key) => {
  if (key) MEMORY.delete(key);
};

/** Для тестов: забыть всё. */
export const resetSteadyPercent = () => MEMORY.clear();

/**
 * Число из события хода «Подготовки» работы мастерской: `fraction` (0…1, не убывает — растительность), иначе `done / total` (дороги), иначе
 * `null` — события числа не несут (вода, текстуры, здания, подсчёт заданий в первые секунды).
 */
export function preparePercent(progress) {
  if (progress?.fraction != null && Number.isFinite(Number(progress.fraction)))
    return clamp(Number(progress.fraction) * 100);
  const total = Number(progress?.total);
  const done = Number(progress?.done);
  if (total > 0 && Number.isFinite(done)) return clamp((done / total) * 100);
  return null;
}

const PACE_CEILING = 95;
const PACE_MIN_EXPECTED_MS = 3000;
const PACE_DEFAULT_EXPECTED_MS = 20000;

/**
 * Ровный ход по времени, когда события числа не дают: плавная кривая от 0 к 95 %, около ожидаемой длительности работы (по записям прошлых работ
 * того же вида) — 80 %. Последние проценты ставит сам итог, не кривая.
 */
export function pacePercent(elapsedMs, expectedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const expected =
    Number(expectedMs) > 0
      ? Math.max(PACE_MIN_EXPECTED_MS, Number(expectedMs))
      : PACE_DEFAULT_EXPECTED_MS;
  return Math.round(PACE_CEILING * (1 - Math.exp((-1.6 * elapsed) / expected)));
}

const NBSP = String.fromCharCode(0xa0);

/** Подпись процента: число, неразрывный пробел и знак — «42 %» не рвётся на две строки. */
export const percentText = (value) => `${value}${NBSP}%`;
