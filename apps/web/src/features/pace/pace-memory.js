/*
 * Память темпа (18.11.2026): сколько прошлые загрузки одного вида занимали на каждом этапе. Ожидание — не настройка, а данные
 * запуска: сглаженные длительности этапов в `localStorage` под своим ключом. Пока записи нет (первый запуск, чистый профиль) или ей
 * нельзя верить (чужая запись, нули, мусор), берутся значения по умолчанию. Общая для заставки запуска (`launch-memory.js`) и
 * карточки загрузки сцены (по ключу на вид сцены).
 */

import { clamp } from "./pace.js";

/** Доля прежнего значения при сглаживании: новая загрузка сдвигает ожидание на 40 %. */
const KEEP = 0.6;
/** Одна необычная загрузка (диск проснулся, сеть упала) не тянет ожидание дальше этого множителя прежнего значения. */
const OUTLIER = 2.5;

function browserStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Ожидаемые длительности этапов (мс): то, что запомнено под `key`, иначе `defaults`; каждое значение — в пределах `min…max`.
 * `count` — сколько этапов.
 */
export function readPace(
  key,
  { defaults, min, max },
  storage = browserStore(),
) {
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      saved?.v !== 1 ||
      !Array.isArray(saved.d) ||
      saved.d.length !== defaults.length
    )
      return [...defaults];
    return saved.d.map((value, index) => {
      const span = Number(value);
      return Number.isFinite(span) && span > 0
        ? clamp(span, min, max)
        : defaults[index];
    });
  } catch {
    return [...defaults];
  }
}

/** Запомнить загрузку: `durations` — результат `paceDurations`. Вернёт, записалось ли; мусор и недоведённая загрузка не пишутся. */
export function rememberPace(key, durations, limits, storage = browserStore()) {
  const { defaults, min, max } = limits;
  if (
    !Array.isArray(durations) ||
    durations.length !== defaults.length ||
    !durations.every((span) => Number.isFinite(span) && span >= 0)
  )
    return false;
  try {
    const before = readPace(key, limits, storage);
    const next = durations.map((span, index) =>
      Math.round(
        KEEP * before[index] +
          (1 - KEEP) * clamp(span, min, Math.min(max, before[index] * OUTLIER)),
      ),
    );
    storage.setItem(key, JSON.stringify({ v: 1, d: next }));
    return true;
  } catch {
    return false;
  }
}
