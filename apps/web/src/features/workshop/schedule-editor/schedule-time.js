/*
 * Время строки «Расписания» (задача 4 ТЗ 11.10.2026, утро: «время — удобным
 * вводом: часы:минуты, диапазоны, несколько времён»).
 *
 * На щит время уходит строкой, как его написали: «18:00», «12:00–14:00»,
 * «10:00, 14:00, 18:00», «24/7». Здесь — разбор этой строки на часы и
 * промежутки, чтобы правка шла полями часов, и обратная сборка. Строку,
 * которая на часы не делится («24/7», «по выходным»), панель правит
 * своим текстом — как написано.
 */

import { SCHEDULE_LIMITS } from "@modovik/climb-contract/recolor/schedule";

export const DAY = 24 * 60;
const pad = (value) => String(value).padStart(2, "0");
/* Тире промежутка и разделитель времён на щите. */
export const RANGE_DASH = "–";
export const TIMES_JOIN = ", ";

/**
 * Часы в минутах от полуночи или `null`: «9», «09», «930», «0930», «9:30»,
 * «9.30», «24:00». Больше суток и минуты за 59 — не время.
 */
export function parseClock(input) {
  const text = String(input ?? "").trim();
  let hours;
  let minutes;
  let match = /^(\d{1,2})(?:[:.](\d{1,2}))?$/.exec(text);
  if (match) {
    hours = Number(match[1]);
    minutes = match[2] === undefined ? 0 : Number(match[2]) * (match[2].length === 1 ? 10 : 1);
  } else if ((match = /^(\d{1,2})(\d{2})$/.exec(text))) {
    hours = Number(match[1]);
    minutes = Number(match[2]);
  } else return null;
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

export const formatClock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Строка времени → `[{ from, to }]` (минуты; `to` — `null` у одного
 * времени) или `null`, если хоть одна часть — не часы. Пустая строка —
 * пустой список.
 */
export function parseTimes(input) {
  const text = String(input ?? "").trim();
  if (!text) return [];
  const items = [];
  for (const part of text.split(/\s*[,;]\s*/)) {
    if (!part) return null;
    const range = /^([\d:.]+)\s*[-–—]\s*([\d:.]+)$/.exec(part);
    if (range) {
      const from = parseClock(range[1]);
      const to = parseClock(range[2]);
      if (from === null || to === null) return null;
      items.push({ from, to });
      continue;
    }
    const at = parseClock(part);
    if (at === null) return null;
    items.push({ from: at, to: null });
  }
  return items;
}

/** `[{ from, to }]` → строка на щит: «12:00–14:00, 18:00». */
export const formatTimes = (items) => items.map((item) => (item.to === null || item.to === undefined ? formatClock(item.from) : `${formatClock(item.from)}${RANGE_DASH}${formatClock(item.to)}`)).join(TIMES_JOIN);

/** Влезет ли список в предел поля времени. */
export const timesFit = (items) => formatTimes(items).length <= SCHEDULE_LIMITS.time;

/* Сдвиг часов по кругу суток (24:00 после 23:45 — это 00:00 следующих). */
export const shiftClock = (minutes, step) => (((minutes + step) % DAY) + DAY) % DAY;

/** Следующее время для «+ Время»: через час после последнего, иначе 12:00. */
export function nextClock(items) {
  const last = items.at(-1);
  if (!last) return 12 * 60;
  return shiftClock(last.to ?? last.from, 60);
}
