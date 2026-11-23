// Порядок каталога «Новые»: сверху — добавленное последним (06.11.2026, владелец: «новое — то, что только что добавлено»), внутри одной выкладки — по дате исходного
// поста в Discord (Т-71). Раньше порядок шёл только по дате поста, и старые посты, которые разбирают сейчас, уходили вниз.
// Саму дату поста и критерий «нового» даёт recommend.js.

import { isNewMod, postedTime } from "./recommend.js";

const DAY_MS = 86_400_000;
/** Карточки одной выкладки создаются подряд (секунды друг от друга): десять минут — одна партия, внутри партии решает дата поста. */
const BATCH_MS = 10 * 60 * 1000;
const FIRST_PLAUSIBLE = Date.parse("2020-01-01T00:00:00Z");
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Когда карточка добавлена в каталог, мс; 0 — неизвестно. Сервер отдаёт время косвенно: `id` карточки — UUIDv7, его первые 48 бит — миллисекунды создания (у всех
 * живых карточек на 06.11.2026 версия 7, время сходится с лентой сервера). Если сервер заведёт явное поле — `catalogAddedAt` (ISO), оно главнее.
 */
export function addedTime(mod) {
  const explicit = Date.parse(String(mod?.catalogAddedAt ?? ""));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const id = mod?.id;
  if (typeof id !== "string" || !UUID_V7.test(id)) return 0;
  const time = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
  return time >= FIRST_PLAUSIBLE && time <= Date.now() + DAY_MS ? time : 0;
}

export function newestFirst(list, { oldest = false } = {}) {
  // Любое истинное oldest переворачивает порядок. Сортировка устойчивая,
  // поэтому записи с равным временем (и без даты) остаются в порядке прихода.
  const direction = oldest ? 1 : -1;
  // Время каждой записи берётся один раз и хранится по самой записи. Дыра в списке
  // здесь не переносится: Map на ней бросает TypeError, как и должно быть.
  // Ключ первый — партия выкладки (у мода без времени добавления, например локального, — его дата поста), второй — дата поста.
  const times = new Map(
    list.map((item) => {
      const posted = postedTime(item);
      return [item, { batch: Math.floor((addedTime(item) || posted) / BATCH_MS), posted }];
    }),
  );
  return list
    .map((item) => ({ item, at: times.get(item) }))
    .sort((a, b) => direction * (a.at.batch - b.at.batch || a.at.posted - b.at.posted))
    .map(({ item }) => item);
}

export function modIsNew(mod, now = Date.now()) {
  // Есть дата поста (в том числе отрицательная) - решает она; нет - флаг сервера isNew.
  if (postedTime(mod) !== 0) return isNewMod(mod, now);
  return Boolean(mod?.isNew);
}
