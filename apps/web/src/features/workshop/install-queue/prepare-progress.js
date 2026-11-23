// План этапов: идентификатор и замеренное время, мс (null - замера нет, как у дорог).
// Замер 22.10.2026 на неполных данных: годится лишь как относительная ширина полос.
const STAGE_PLAN = [
  ["models", 7800],
  ["copies", 20700],
  ["maps", 6100],
  ["roads", null],
  ["pack", 50],
];
const PACK = "pack";

export const PREPARE_STAGES = Object.freeze(STAGE_PLAN.map(([id]) => id));
export const STAGE_TIME_MS = Object.freeze(Object.fromEntries(STAGE_PLAN.filter(([, ms]) => ms !== null)));

export const ETA_MIN_MS = 5000;
export const ETA_WINDOW_MS = 20000;
export const STALL_MS = 15000;

const asList = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
// Число из поля события: приведение к числу, всё нечисловое и ложное - 0.
const field = (source, name) => Number(source?.[name]) || 0;
const textOf = (value) => String(value || "");

// Окно образцов держит один образец за границей: индекс первого оставляемого образца.
function firstKept(samples, at) {
  const lastCut = samples.length - 2;
  let index = 0;
  while (index < lastCut && at - samples[index + 1].t >= ETA_WINDOW_MS) index += 1;
  return index;
}

export function trailAfter(trail, progress, at) {
  const history = asList(trail);
  const done = field(progress, "done");
  const grown = history.at(-1)?.done === done ? history : history.concat({ t: at, done });
  const from = firstKept(grown, at);
  return from === 0 ? grown : grown.slice(from);
}

// Остаток по скорости от первого образца окна.
function remainingMs(origin, { done, total }, at) {
  const elapsed = at - origin.t;
  const gained = done - origin.done;
  if (elapsed < ETA_MIN_MS || done <= origin.done) return null;
  return Math.round((total - done) / (gained / elapsed));
}

export function etaMsOf(trail, progress, at) {
  const samples = asList(trail);
  const done = field(progress, "done");
  const total = field(progress, "total");
  if (total <= 0 || done >= total || samples.length === 0) return null;
  return remainingMs(samples[0], { done, total }, at);
}

export function stalledMsOf(trail, at) {
  const latest = asList(trail).at(-1);
  if (!latest) return 0;
  return Math.max(0, at - latest.t);
}

// Этапы строки: прочитанные из события, потом отобранные - с файлами, а упаковка по фазе.
const readStage = (progress, id) => {
  const raw = progress?.stages?.[id];
  const data = isRecord(raw) ? raw : {};
  return { id, done: field(data, "done"), total: field(data, "total") };
};
const isShown = (stage, phase) => (stage.id === PACK ? phase === PACK : stage.total > 0);

// Ширина по замеренному времени, а если хоть у одного этапа замера нет - по числу файлов (у упаковки 0).
function barShares(stages) {
  const timed = stages.every((stage) => Object.hasOwn(STAGE_TIME_MS, stage.id));
  const weightOf = (stage) => {
    if (timed) return STAGE_TIME_MS[stage.id];
    return stage.id === PACK ? 0 : stage.total;
  };
  const weights = stages.map(weightOf);
  let sum = 0;
  for (const weight of weights) sum += weight;
  const divisor = sum === 0 ? 1 : sum;
  return weights.map((weight) => weight / divisor);
}

function describeStages(progress) {
  const stages = PREPARE_STAGES.map((id) => readStage(progress, id)).filter((stage) => isShown(stage, progress?.phase));
  const shares = barShares(stages);
  return stages.map((stage, at) => ({
    ...stage,
    fraction: stage.id === PACK ? 1 : Math.min(1, stage.done / stage.total),
    weight: shares[at],
    current: stage.id === progress?.stage || (stage.id === PACK && progress?.phase === PACK),
  }));
}

const percentOf = (done, total) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null);

// Порядок ключей вида задаётся списком, а не порядком записи значений.
const VIEW_ORDER = [
  "counting", "stages", "index", "count", "done", "total",
  "bytes", "percent", "eta", "stalled", "stalledSeconds", "lastName",
];
const READING_ORDER = ["counting", "reading", "archivesDone", "archivesTotal", ...VIEW_ORDER.slice(1)];
const arrange = (order, values) => Object.fromEntries(order.map((key) => [key, values[key]]));

const COUNTERS = ["index", "count", "done", "total", "bytes", "stalledSeconds"];
const idleValues = () => ({
  ...Object.fromEntries(COUNTERS.map((key) => [key, 0])),
  stages: [],
  percent: null,
  eta: null,
  stalled: false,
});

export function prepareView(progress, trail, at) {
  if (progress?.phase === "read") {
    return arrange(READING_ORDER, {
      ...idleValues(),
      counting: false,
      reading: true,
      archivesDone: field(progress, "archivesDone"),
      archivesTotal: field(progress, "archivesTotal"),
      lastName: textOf(progress.lastName),
    });
  }
  const counting = progress?.phase === "count";
  const done = field(progress, "done");
  const total = field(progress, "total");
  const stages = describeStages(progress);
  const quietMs = counting || done >= total ? 0 : stalledMsOf(trail, at);
  return arrange(VIEW_ORDER, {
    lastName: textOf(progress?.lastName),
    done,
    total,
    bytes: field(progress, "bytes"),
    counting,
    stages,
    count: stages.length,
    index: Math.max(0, stages.findIndex((stage) => stage.current)),
    percent: counting ? null : percentOf(done, total),
    eta: counting ? null : etaMsOf(trail, progress, at),
    stalled: quietMs >= STALL_MS,
    stalledSeconds: Math.trunc(quietMs / 1000),
  });
}
