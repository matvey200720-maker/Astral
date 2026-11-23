// Доля не доходит до 100 %: «готово» сообщает отдельная фаза клиента.
const SHARE_CEILING = 0.99;

const bound = (floor, ceiling, value) => Math.max(floor, Math.min(ceiling, value));
const received = (progress) => Math.max(0, progress.received || 0);

// Число из поля снимка: только положительное, иначе 0. Поле читается дважды, как в клиенте окна.
const positive = (read) => {
  const first = Number(read());
  return first > 0 ? Number(read()) : 0;
};

// Объект (в том числе массив) как есть, всё остальное — null.
const objectOrNull = (read) => (read() && typeof read() === "object" ? read() : null);

// Сколько байт «есть» у обновления: по стадии и файлу.
const DONE_SOURCE = {
  "verify/pak": (ctx) => ctx.totalBytes,
  "verify/base": (ctx) => ctx.baseBytes,
  "download/pak": (ctx) => ctx.baseBytes + received(ctx.progress),
  "download/base": (ctx) => received(ctx.progress),
};

// Шаги вычисления в том порядке, в каком читаются поля снимка; каждый видит уже посчитанное.
const STEPS = [
  ["totalBytes", (ctx) => ctx.candidate.bytes],
  ["baseBytes", (ctx) => ctx.candidate.baseBytes || 0],
  ["stage", (ctx) => (ctx.progress.stage === "verify" ? "verify" : "download")],
  ["file", (ctx) => (ctx.progress.file === "pak" ? "pak" : "base")],
  ["doneBytes", (ctx) => bound(0, ctx.totalBytes, Math.round(DONE_SOURCE[`${ctx.stage}/${ctx.file}`](ctx)))],
  ["share", (ctx) => bound(0, SHARE_CEILING, ctx.doneBytes / ctx.totalBytes)],
  ["percent", (ctx) => Math.floor(ctx.share * 100)],
  ["stalledMs", (ctx) => positive(() => ctx.progress.stalledMs)],
  [
    "bytesPerSec",
    (ctx) => (ctx.stalledMs !== 0 || ctx.stage !== "download" ? 0 : positive(() => ctx.progress.bytesPerSec)),
  ],
  [
    "etaSec",
    (ctx) => (ctx.bytesPerSec ? Math.max(1, Math.round((ctx.totalBytes - ctx.doneBytes) / ctx.bytesPerSec)) : null),
  ],
  ["attempt", (ctx) => ctx.progress.attempt || 1],
  ["retry", (ctx) => objectOrNull(() => ctx.progress.retry)],
  ["resumedFrom", (ctx) => Math.max(0, Number(ctx.progress.resumedFrom) || 0)],
  [
    "verifyPercent",
    ({ stage, progress }) => {
      if (stage !== "verify" || !(Number(progress.total) > 0)) {
        return null;
      }
      return bound(0, 100, Math.floor((received(progress) / progress.total) * 100));
    },
  ],
];

const RESULT_KEYS = [
  "stage", "file", "share", "percent", "doneBytes", "totalBytes", "bytesPerSec", "etaSec", "attempt", "retry",
  "stalledMs", "resumedFrom", "verifyPercent",
];

export function overallProgress(state) {
  const { candidate, progress } = state ?? {};
  const usable = Boolean(candidate && progress) && candidate.bytes > 0;
  if (!usable) {
    return null;
  }
  const ctx = { candidate, progress };
  for (const [name, step] of STEPS) {
    ctx[name] = step(ctx);
  }
  return Object.fromEntries(RESULT_KEYS.map((key) => [key, ctx[key]]));
}
