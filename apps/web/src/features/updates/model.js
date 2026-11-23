// Логика показа обновлений по снимку службы: без React и без моста, всё проверяется тестом
// (docs/beta/release-channels.md, §5.3-5.4).

// Порядок ключей виден снаружи, поэтому состояние «службы нет» записано одной JSON-строкой
export const OFF_STATE = Object.freeze(
  JSON.parse(
    '{"phase":"idle","disabled":true,"channel":null,"current":null,"candidate":null,"progress":null,"checkedAt":null,"error":null,"lastFailure":null,"auto":true}',
  ),
);

// disabled здесь строго ровно true, а в describe/promptKind - по истинности: так было с 13.10.2026
export const normalizeState = (raw) =>
  typeof raw === "object" && raw ? { ...OFF_STATE, ...raw, ...{ disabled: raw.disabled === true } } : OFF_STATE;

// Обычный объект, а не Map: имена из прототипа ("constructor") проходят как есть
const MODE_BY_PHASE = Object.fromEntries(
  "idle checking up-to-date available downloading ready applying error"
    .split(" ")
    .map((phase) => [phase, phase === "up-to-date" ? "current" : phase]),
);

export const UPDATE_STEPS = Object.freeze("signature download verify ready".split(" "));

// Недоверенное число: отрицательное и мусор дают 0, строки с числом читаются числом
const floor0 = (v) => Math.max(0, Number(v)) || 0;

export function downloadFacts(state) {
  const cand = state.candidate;
  const p = state.progress;
  const total = cand && cand.bytes;
  if (!(total > 0) || !p) return null;

  const isPak = p.file === "pak";
  const verifying = p.stage === "verify";
  const got = Math.max(p.received || 0, 0);
  // baseBytes строкой склеивается как текст (поведение старого кода)
  const base = cand.baseBytes || 0;

  // Доля идёт по сумме двух файлов: сначала база, потом интерфейс
  let raw = isPak ? base + got : got;
  if (verifying) raw = isPak ? total : base;
  const doneBytes = Math.min(total, Math.max(0, Math.round(raw)));

  // До 100 % не доходим: зашифрованный pak по размеру больше записанного в манифесте
  const share = Math.min(doneBytes / total, 0.99);
  const stalledMs = floor0(p.stalledMs);
  const bytesPerSec = verifying || stalledMs ? 0 : floor0(p.bytesPerSec);
  const checkTotal = Number(p.total);
  const retry = p.retry;

  return {
    share,
    percent: Math.floor(100 * share),
    doneBytes,
    totalBytes: total,
    bytesPerSec,
    etaSec: bytesPerSec ? Math.max(Math.round((total - doneBytes) / bytesPerSec), 1) : null,
    attempt: p.attempt ? p.attempt : 1,
    stage: verifying ? "verify" : "download",
    file: isPak ? "pak" : "base",
    retry: retry !== null && typeof retry === "object" ? retry : null,
    stalledMs,
    resumedFrom: floor0(p.resumedFrom),
    verifyPercent:
      verifying && checkTotal > 0 ? Math.floor(Math.min(1, floor0(p.received) / checkTotal) * 100) : null,
  };
}

// Статусы четырёх этапов по режимам; проверка файлов - отдельная строка таблицы
const ALL_DONE = "done done done done";
const STEP_STATUSES = {
  available: "done todo todo todo",
  downloading: "done active todo todo",
  ...{ verifying: "done done active todo", ready: ALL_DONE },
  applying: ALL_DONE,
};

export function stepsOf(state) {
  const { candidate, mode } = describe(state);
  if (!candidate) return null;
  const rowName = mode === "downloading" && state.progress?.stage === "verify" ? "verifying" : mode;
  if (!Object.hasOwn(STEP_STATUSES, rowName)) return null;
  const words = STEP_STATUSES[rowName].split(" ");
  return UPDATE_STEPS.map((id, index) => ({ id, status: words[index] }));
}

export function describe(state) {
  const off = !state || Boolean(state.disabled);
  const candidate = off ? null : (state.candidate ?? null);
  const mode = off ? "off" : (MODE_BY_PHASE[state.phase] ?? "idle");
  const facts = mode === "downloading" ? downloadFacts(state) : null;
  return { mode, locked: !!candidate?.required, candidate, facts };
}

export const CHANNEL_LABELS = Object.freeze({ ...{ alpha: "Alpha", beta: "Beta" }, release: "Release" });

export function channelLabel(channel) {
  return CHANNEL_LABELS[channel] ?? "";
}

// Что показать в углу. Обязательное обновление ведёт экран-замок, угол молчит
export function promptKind(state, options = {}) {
  const { snoozed, progressHidden } = options;
  const { mode, locked } = describe(state);
  if (locked) return null;
  if (mode === "downloading") return progressHidden ? null : "downloading";
  const calm = !snoozed && (mode === "ready" || (mode === "available" && state.auto === false));
  return calm ? mode : null;
}

// Картинка выпуска лежит внутри интерфейса самой версии: только безопасный относительный путь
// (первый знак буква или цифра, две точки подряд нигде не допускаются)
export const coverUrl = (cover) =>
  typeof cover === "string" && /^[\dA-Za-z][\w./-]*$/.test(cover) && !cover.includes("..") ? `/${cover}` : null;

const NOTE_ORDER = "ru en uk de pl fr".split(" ");

export function pickNotes(notes, language) {
  const bag = typeof notes === "object" && notes ? notes : {};
  const hit = [language, ...NOTE_ORDER].map((key) => bag[key]).find((t) => typeof t === "string" && t.trim());
  return hit ?? "";
}

export function hasReleaseNotes(release, language) {
  const source = release || {};
  return coverUrl(source.cover) !== null || pickNotes(source.notes, language) !== "";
}

export function downloadShare(state) {
  const facts = downloadFacts(state);
  return facts ? facts.share : null;
}
