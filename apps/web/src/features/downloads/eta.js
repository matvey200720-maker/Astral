// Оценки «осталось ≈ …» для окна «Загрузки»: по скорости последних секунд
// (установка из каталога) и по истории таких же работ (мастерская).
// Часы модуль не читает: «сейчас» приходит аргументом.
import { currentBuild, noteBuild } from "./build-id.js";

const verdict = (ms, source, overdue) => ({ ms, source, overdue });

// ---- по скорости: окно отсчётов -> прирост -> остаток ----

const hasBytes = (sample) => Number.isFinite(sample.b);
const notDone = (sample) => sample.f < 1;

// Окно: последний отсчёт, «сейчас» и номер первого отсчёта окна; порядок времени в списке не проверяется.
function sampleWindow(samples, now, usable) {
  const count = Array.isArray(samples) ? samples.length : 0;
  if (count < 2) return null;
  const newest = samples[count - 1];
  if (!usable(newest)) return null;
  const present = Math.max(newest.t, now);
  const edge = present - RATE.windowMs;
  const begin = samples.findIndex((sample) => sample.t >= edge);
  return begin < 0 ? null : { newest, present, begin };
}

// Медленная тяжёлая загрузка: начало окна уходит назад, пока доля не прибавит нужного.
function widenBack(samples, begin, newestShare) {
  let at = begin;
  while (at > 0 && newestShare - samples[at].f < RATE.minGain) at -= 1;
  return at;
}

const bytesPerSecond = (samples, now) => {
  const win = sampleWindow(samples, now, hasBytes);
  if (win === null) return null;
  const first = samples[win.begin];
  if (!Number.isFinite(first.b)) return null;
  const grown = win.newest.b - first.b;
  const elapsed = win.present - first.t;
  return elapsed >= RATE.minSpanMs && grown > 0 ? (grown * MS_PER_SECOND) / elapsed : null;
};

const remainingByRate = (samples, now) => {
  const win = sampleWindow(samples, now, notDone);
  if (win === null) return null;
  const start = samples[widenBack(samples, win.begin, win.newest.f)];
  const gain = win.newest.f - start.f;
  const elapsed = win.present - start.t;
  const ahead = 1 - win.newest.f;
  return elapsed >= RATE.minSpanMs && gain >= RATE.minGain ? (ahead * elapsed) / gain : null;
};

const estimateByRate = (samples, now) => {
  const ms = remainingByRate(samples, now);
  return ms === null || ms > RATE.ceilingMs ? null : verdict(ms, "rate", false);
};

// ---- по истории ----

const overdueAfter = (expected) => {
  const tripled = expected * OVERDUE.factor;
  const padded = expected + OVERDUE.slackMs;
  return tripled > padded ? tripled : padded;
};

const isOverdue = (elapsed, expected, runs, advancing) =>
  !advancing && runs >= OVERDUE.minRuns && elapsed > overdueAfter(expected);

const estimateByHistory = (report) => {
  const { advancing = false, runs = 1, expectedMs, elapsedMs } = report;
  const expected = Number(expectedMs);
  if (Number.isNaN(expected) || expected <= 0) return null;
  if (elapsedMs < expected) return verdict(expected - elapsedMs, "history", false);
  return isOverdue(elapsedMs, expected, runs, advancing) ? verdict(0, "history", true) : null;
};

// ---- показ ----

// Полосы округления: пока секунд меньше предела — эта полоса; NaN и бесконечность уходят в последнюю.
const BANDS = [
  { unit: "sec", below: 90, pick: (s) => Math.max(10, 10 * Math.round(s / 10)) },
  { unit: "min", below: Infinity, pick: (s) => Math.ceil(s / 60) },
];

const roundedRemaining = (ms) => {
  const whole = Math.round(ms / 1000);
  const seconds = whole < 0 ? 0 : whole;
  const band = BANDS.find((b) => seconds < b.below) ?? BANDS[BANDS.length - 1];
  return { unit: band.unit, value: band.pick(seconds) };
};

const workshopRunKind = (job) => `workshop:${[job?.coverSlotId, job?.editor].find(Boolean) ?? "work"}`;

// ---- память о прошлых работах ----

const plainObject = (value) => (typeof value === "object" && value !== null ? value : null);
const asList = (value) => (Array.isArray(value) ? value : []);

function readJson(key) {
  try {
    return JSON.parse(globalThis.localStorage.getItem(key));
  } catch {
    return null;
  }
}

// Виды документа, если он снят на этой сборке; иначе null.
function kindsOfBuild(doc, build) {
  const sameBuild = doc !== null && String(doc.build ?? "") === build;
  return sameBuild ? plainObject(doc.kinds) : null;
}

function saveHistory(doc) {
  const box = globalThis.localStorage;
  box.setItem(KEYS.runs, JSON.stringify(doc));
  box.removeItem(KEYS.legacyRuns);
}

// Сбои хранилища и вида (ключ-объект без прототипа) наружу не выходят: история — удобство.
function appendRun(kind, value) {
  try {
    const build = currentBuild();
    const kinds = { ...kindsOfBuild(plainObject(readJson(KEYS.runs)), build) };
    const kept = [...asList(kinds[kind]), value].slice(-KEEP_RUNS);
    saveHistory({ build, kinds: { ...kinds, [kind]: kept } });
  } catch {
    // нечего делать: следующая работа запишет заново
  }
}

const recordRun = (kind, ms) => {
  const duration = Number(ms);
  if (duration > 0) appendRun(kind, Math.round(duration));
};

// Ключ вида здесь не защищён от исключений: объект без прототипа бросает.
function usableRuns(kind) {
  const kinds = kindsOfBuild(plainObject(readJson(KEYS.runs)), currentBuild());
  const list = asList(kinds && kinds[kind]);
  return Float64Array.from(list.filter((v) => typeof v === "number" && v > 0 && v < Infinity)).sort();
}

const runCount = (kind) => usableRuns(kind).length;

const expectedRunMs = (kind) => {
  const runs = usableRuns(kind);
  const n = runs.length;
  return n === 0 ? null : (runs[(n - 1) >> 1] + runs[n >> 1]) / 2;
};

const MS_PER_SECOND = 1000;
const KEEP_RUNS = 5;
const RATE = { windowMs: 8000, minSpanMs: 3000, minGain: 0.005, ceilingMs: 10_800_000 };
const OVERDUE = { factor: 3, slackMs: 60_000, minRuns: 3 };
const KEYS = { runs: "astral.downloads.runs.v2", legacyRuns: "astral.downloads.runs.v1" };

export {
  bytesPerSecond,
  estimateByHistory,
  estimateByRate,
  expectedRunMs,
  noteBuild,
  recordRun,
  remainingByRate,
  roundedRemaining,
  runCount,
  workshopRunKind,
};
