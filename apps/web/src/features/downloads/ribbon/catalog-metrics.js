import { formatSize, modCardKickerParts } from "../../../catalog-utils.js";
import { installPhaseKey } from "../../../install-phase.js";
import { etaWords } from "../downloads-copy.js";
import { bytesPerSecond, estimateByRate } from "../eta.js";
import { readQueueTrail } from "../live-progress.js";

/*
 * Числа и слова строки очереди каталога: файлы и байты, слово фазы, скорость и остаток. Раньше лежали в `DownloadsPanel.jsx`
 * и считались для каждой строки; теперь их читают герой и списки «Ленты» (`CatalogItems.jsx`).
 */

const KNOWN_OPERATIONS = new Set(["remove", "reset"]);
export const operationKey = (operation) =>
  KNOWN_OPERATIONS.has(operation) ? operation : "install";

// Слово для фазы, которой нет в словаре движка: зависит от операции.
const UNKNOWN_PHASE_WORD = new Map([
  ["install", "preparing"],
  ["remove", "restoring"],
  ["reset", "checkingClean"],
]);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Первое из заданных значение, которое не null и не undefined.
function firstSet(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

export const clampPercent = (progress) => clamp(numberOr(progress, 0), 0, 100);

/* ---------- числа строки каталога ---------- */

function fileMetrics(row, summary, percent) {
  const known = firstSet(summary?.fileCount, row.totalFiles, row.fileCount);
  const totalFiles = Math.max(1, numberOr(known, 1));
  const reported = numberOr(row.completedFiles, 0);
  let doneFiles;
  if (reported > 0) doneFiles = reported;
  else if (percent >= 100) doneFiles = totalFiles;
  else doneFiles = Math.floor((totalFiles * percent) / 100);
  return {
    totalFiles,
    doneFiles: Math.min(totalFiles, doneFiles),
    filesKnown: known !== undefined,
  };
}

function byteMetrics(row, summary, percent) {
  const known = firstSet(summary?.writeBytes, row.totalBytes, row.sizeBytes);
  const totalBytes = Math.max(0, numberOr(known, 0));
  const loaded = numberOr(row.downloadedBytes, 0);
  let doneBytes;
  if (loaded > 0) doneBytes = loaded;
  else doneBytes = Math.round((totalBytes * percent) / 100);
  return { totalBytes, doneBytes: Math.min(totalBytes, doneBytes) };
}

/** Файлы и байты строки каталога: что известно, то берётся, остальное выводится из процента. */
export function catalogMetrics(row, percent) {
  const summary = row.installPlan?.summary;
  return {
    ...fileMetrics(row, summary, percent),
    ...byteMetrics(row, summary, percent),
  };
}

/** Размер мода в байтах для списка: что известно о нём до начала установки. */
export function sizeOfRow(row) {
  return Math.max(
    0,
    numberOr(
      firstSet(
        row.installPlan?.summary?.writeBytes,
        row.totalBytes,
        row.sizeBytes,
      ),
      0,
    ),
  );
}

export function bytesPart(copy, language, { doneBytes, totalBytes }) {
  const done = formatSize(doneBytes, language) || "0";
  return copy.of(done, formatSize(totalBytes, language));
}

export function detailLine(copy, language, metrics) {
  const head = copy.files(metrics.doneFiles, metrics.totalFiles);
  const tail =
    metrics.totalBytes > 0 ? [bytesPart(copy, language, metrics)] : [];
  return [head, ...tail].join(" · ");
}

/* ---------- слова и время ---------- */

export function phaseWord(copy, row, percent) {
  if (row.cancelling) {
    const rollingBack = row.phase === "restoring";
    return rollingBack ? copy.activity.restoring : copy.activity.cancelling;
  }
  const key = installPhaseKey(row.phase);
  if (key) {
    const skipsFiles = key === "prepare" && row.operation !== "install";
    return skipsFiles ? copy.activity.preparing : copy.phases[key];
  }
  if (percent >= 100) return copy.activity.finishing;
  return copy.activity[UNKNOWN_PHASE_WORD.get(operationKey(row.operation))];
}

// Подпись времени и скорости: остаток считается только у установки на скачивании.
export function timing(copy, row, language, now) {
  if (row.operation !== "install" || row.phase !== "download") {
    const almost = row.phase === "finalizing" ? copy.eta.almost : "";
    return { speed: "", eta: almost, rate: null, remainingMs: null };
  }
  const trail = readQueueTrail(row.queueId);
  const rate = bytesPerSecond(trail, now);
  const estimate = estimateByRate(trail, now);
  const speed =
    rate == null ? "" : `${formatSize(rate, language)}${copy.perSec}`;
  return {
    speed,
    eta: etaWords(copy, estimate, true),
    rate,
    remainingMs: estimate ? estimate.ms : null,
  };
}

/** Раздел мода словами языка окна: «Редукс», «Гапак» — то, что стоит над названием в каталоге. */
export function categoryOf(item, language) {
  return modCardKickerParts(item, "", language).text;
}

/** «Редукс · 703 МБ»: раздел и размер, что известны. */
export function metaLine(item, language, bytes) {
  return [
    categoryOf(item, language),
    bytes > 0 ? formatSize(bytes, language) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
