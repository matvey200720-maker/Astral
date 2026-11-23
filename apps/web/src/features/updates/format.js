// Числа обновлений для человека. Слова приходят аргументом `copy` из updatesCopyFor(язык):
// сам модуль текстов не хранит, кроме разделителя частей.
import { formatBytes } from "../../components/desktop/settings/format-bytes.js";

const SEP = " · ";
// Докачка с диска упоминается, пока новых данных меньше двух мебибайт
const RESUME_NOTE_LIMIT = 2 * 1024 * 1024;
const TWO = "2-digit";
const NUM = "numeric";

const stamp = (language, options, date) => new Intl.DateTimeFormat(language, options).format(date);

// null здесь - ноль (начало 1970), как у new Date(null); непригодное время даёт пустую строку
export function formatWhen(iso, language, copy, now) {
  const date = new Date(iso);
  if (Number.isNaN(+date)) return "";
  const clock = stamp(language, { hour: TWO, minute: TWO }, date);
  const sameDay = date.toDateString() === (now === undefined ? new Date() : now).toDateString();
  return `${sameDay ? copy.today : stamp(language, { day: NUM, month: "short" }, date)}, ${clock}`;
}

export function formatDay(iso, language) {
  const date = new Date(iso);
  return Number.isNaN(+date) ? "" : stamp(language, { day: NUM, month: "long", year: NUM }, date);
}

export const formatSpeed = (bytesPerSec, language, copy) =>
  bytesPerSec > 0 ? formatBytes(bytesPerSec, language) + copy.speedUnit : "";

// Часы - с минутами всегда; секунды живут только до десяти минут и только ненулевые
export function formatDuration(seconds, copy) {
  if (!(typeof seconds === "number" && seconds >= 0 && seconds < Infinity)) return "";
  const total = Math.round(seconds) || 1;
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const rows = [
    [h, "h", h > 0],
    [m, "min", h > 0 || m > 0],
    [s, "s", h === 0 && (m === 0 || (s > 0 && m < 10))],
  ];
  return rows
    .filter((row) => row[2])
    .map(([n, unit]) => `${n} ${copy.units[unit]}`)
    .join(" ");
}

export const progressLine = (facts, language, copy) => {
  if (!facts) return "";
  const eta = formatDuration(facts.etaSec, copy);
  return [
    `${facts.percent} %`,
    copy.of(...[facts.doneBytes, facts.totalBytes].map((n) => formatBytes(n, language))),
    formatSpeed(facts.bytesPerSec, language, copy),
    eta && copy.etaLeft(eta),
  ]
    .filter(Boolean)
    .join(SEP);
};

// Примечание одно, главное: обрыв связи, затем зависание, затем докачка
function noteOf(facts, copy) {
  const { retry, stalledMs, resumedFrom, doneBytes, totalBytes } = facts;
  if (retry) {
    const secs = Math.ceil(retry.inMs / 1000) || 0;
    const wait = secs <= 0 ? "" : formatDuration(secs, copy);
    const reason = copy.retryReason[retry.code] || copy.retryReason.DEFAULT;
    return copy.retryNote(reason, retry.attempt, retry.max, wait);
  }
  if (stalledMs > 0) return copy.stalledNote(formatDuration(stalledMs / 1000, copy));
  const quiet = facts.stage === "verify" || !(resumedFrom > 0) || !(doneBytes - resumedFrom < RESUME_NOTE_LIMIT);
  const onDisk = quiet ? 0 : Math.round((resumedFrom / totalBytes) * 100);
  return onDisk >= 1 ? copy.resumedNote(onDisk) : "";
}

export const transferLines = (facts, language, copy) =>
  facts
    ? {
        line:
          facts.stage !== "verify"
            ? progressLine(facts, language, copy)
            : copy.verifyLine(facts.verifyPercent ?? 0),
        note: noteOf(facts, copy),
      }
    : { line: "", note: "" };

export { formatBytes };
