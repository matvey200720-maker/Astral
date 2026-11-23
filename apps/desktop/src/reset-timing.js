/*
 * Замер «Вернуть GTA V без модов» по фазам (сброс 12.10).
 *
 * У сброса не было строки времени в журнале вовсе: канал не числился среди
 * установок (`app-log.js`), а владелец видел «двадцать минут» и не мог сказать,
 * на что. Теперь движок отдаёт свои фазы (`restoreOriginalTarget`, `onTimings`),
 * обработчик добавляет свои — точки отката и настройки — и в журнал ложится
 * одна строка: что сколько заняло и сколько гигабайт пришлось переписать.
 * Строка служебная, как и прочие строки журнала, — по-русски.
 */

const LABELS = Object.freeze({
  state: "состояние",
  adopt: "проверка игры",
  bases: "копии основ",
  copy: "копирование",
  swap: "подмена",
  cleanup: "история и уборка кэша",
  points: "точки отката",
  settings: "настройки GTA",
});

const seconds = (ms) =>
  `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1).replace(".", ",")} с`;

const gigabytes = (bytes) =>
  `${(Math.max(0, Number(bytes) || 0) / 1e9).toFixed(2).replace(".", ",")} ГБ`;

/**
 * Строка журнала: `engine` — отчёт движка (`{ totalMs, phases }`), `extra` —
 * фазы обработчика (`[{ phase, ms }]`).
 */
export function resetTimingLine({ engine = null, extra = [] } = {}) {
  const phases = [...(engine?.phases || []), ...extra];
  const total =
    (Number(engine?.totalMs) || 0) +
    extra.reduce((sum, item) => sum + (Number(item?.ms) || 0), 0);
  const parts = phases.map((item) => {
    const label = LABELS[item.phase] || String(item.phase || "");
    const notes = [];
    if (item.phase === "copy" && item.bytes) notes.push(gigabytes(item.bytes));
    if (item.phase === "adopt" && Number.isFinite(item.settled) && item.settled)
      notes.push(`уже штатных ${item.settled}`);
    if (item.phase === "bases" && Number.isFinite(item.files))
      notes.push(`файлов ${item.files}`);
    return `${label} ${seconds(item.ms)}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  });
  return `reset-target: всего ${seconds(total)} — ${parts.join(" · ")}`;
}

/** Часы для фаз обработчика: `lap(phase)` закрывает фазу с прошлой отметки. */
export function handlerLaps(clock = Date.now) {
  let last = clock();
  const phases = [];
  return {
    phases,
    lap(phase) {
      const now = clock();
      phases.push({ phase, ms: now - last });
      last = now;
    },
  };
}
