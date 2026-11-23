import { useCallback, useEffect, useSyncExternalStore } from "react";

import { onLocalInstallProgress } from "../../api.js";
import {
  STAGE_COUNT,
  createPace,
  feedPace,
  paceDurations,
  paceShare,
  readExpect,
  rememberRun,
  sizeBucket,
  stageOfEvent,
  stepPace,
} from "./progress-pace.js";

/*
 * Ход установки из каталога — мимо корня приложения (задача 1 ТЗ 08.10,
 * вечер).
 *
 * Главный процесс шлёт ход загрузки до десяти раз в секунду, и каждое
 * событие раньше становилось новым состоянием очереди в `DesktopShell`: на
 * каждое — два коммита всей оболочки с открытой страницей. Во время загрузки
 * интерфейс «долбился»: на странице каталога это +60 мс работы потока окна в
 * секунду и рваные кадры прокрутки (замер в `REPORT.md`).
 *
 * Теперь проценты, байты и файлы живут здесь, по `queueId`, а читают их только
 * те, кто их показывает: кнопка «Идёт установка…», строка «Загрузок», полка.
 * Очередь оболочки меняется только тогда, когда меняется сама строка: встала,
 * началась, сменила шаг или «можно ли отменить», кончилась.
 *
 * Показанный процент установки — не процент движка, а ровный ход поверх него (владелец, 18.11.2026; `progress-pace.js`): движок шлёт скачивание по байтам, потом
 * разом 88 и 90, молчит и ставит 99 на всю подмену архива. Здесь события движка кормят темп, а число (`progress`, доли этапов — `pace`) двигает один общий таймер,
 * пока есть идущие установки. Сырое число движка остаётся только у строки очереди оболочки. В разработке и в сборке замера `?qa-pace=off` возвращает число
 * движка как есть — A/B из одной сборки.
 */

const values = new Map();
const listeners = new Map();
/* Что последним ушло в очередь оболочки по строке: шаг и «можно ли
   отменить» — то, что меняет надписи и кнопки, а не проценты. */
const lastShape = new Map();
/* Строки, о которых помнит склад: неудачные и снятые уходят из очереди без
   события «конец», и без предела склад рос бы с каждой установкой. */
const KEEP = 64;
/* Отсчёты загрузки по строке — «в какой момент какая доля». Из них считается
   скорость, а из неё «осталось ≈ …» (features/downloads/eta.js). Лежат отдельно
   от хода: отсчёт — не повод будить тех, кто читает проценты. */
const trails = new Map();
const TRAIL_KEEP = 120;
/* С какой доли скачивания строка началась: больше нуля — часть файлов уже лежала на диске (докачка в «Загрузках»). */
const starts = new Map();
/* Доля, выросшая за один отчёт сразу на столько, — не скорость сети: файлы,
   что уже лежали у Astral, засчитываются мгновенно. С таким скачком в окне
   «осталось ≈» выходило бы «почти готово» на первых восьми секундах загрузки
   единственного нового файла. После скачка скорость меряется заново. */
const TRAIL_JUMP = 0.15;

/* Ровный ход: по строке — ведро размера пакета (память запусков) и состояние темпа. */
const paces = new Map();
const PACE_TICK_MS = 80;
let paceTimer = null;
const paceClock = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();
function paceEnabled() {
  try {
    const dev = import.meta.env.DEV || import.meta.env.MODE === "perf";
    return !(
      dev &&
      new URLSearchParams(window.location.search).get("qa-pace") === "off"
    );
  } catch {
    return true;
  }
}
const PACE_ON = paceEnabled();

/* Поля хода, которые меняются на каждом шаге загрузки. */
const LIVE_FIELDS = ["progress", "downloadedBytes", "completedFiles", "totalFiles"];

function recordTrail(queueId, fraction, bytes) {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return;
  const trail = trails.get(queueId) || [];
  const last = trail[trail.length - 1];
  if (last && fraction === last.f) return;
  /* Доля пошла назад — новая попытка; скакнула вперёд — файлы, что уже лежали:
     прежний ход к новому не относится. */
  if (last && (fraction < last.f || fraction - last.f >= TRAIL_JUMP)) trail.length = 0;
  /* `b` — сколько байт скачано: из них считается скорость в МБ/с (eta.js: `bytesPerSecond`). */
  trail.push({ t: Date.now(), f: fraction, ...(Number.isFinite(bytes) ? { b: bytes } : {}) });
  if (trail.length > TRAIL_KEEP) trail.splice(0, trail.length - TRAIL_KEEP);
  trails.set(queueId, trail);
}

/** Отсчёты загрузки строки `{ t, f, b }` (время, доля, байты) по возрастанию времени; пусто, если их нет. */
export function readQueueTrail(queueId) {
  return (queueId && trails.get(queueId)) || [];
}

function notify(queueId) {
  for (const listener of listeners.get(queueId) || []) listener();
}

/* Показанное число темпа — в склад: `progress` с шагом 0,05 (полосы плавнее числа), номер этапа и доли этапов для героя. */
function publishPace(queueId, entry) {
  const { state } = entry;
  const progress = Math.round(state.shown * 20) / 20;
  const stage = state.done ? STAGE_COUNT : state.stage;
  const previous = values.get(queueId);
  if (
    previous &&
    previous.progress === progress &&
    previous.pace?.stage === stage
  )
    return;
  const shares = Array.from({ length: STAGE_COUNT }, (_, index) =>
    paceShare(state, index),
  );
  values.delete(queueId);
  values.set(queueId, { ...(previous || {}), progress, pace: { stage, shares } });
  evictOldest();
  notify(queueId);
}

/* Склад не растёт без предела: старые строки уходят вместе со своим отсчётом и темпом. */
function evictOldest() {
  while (values.size > KEEP) {
    const oldest = values.keys().next().value;
    values.delete(oldest);
    trails.delete(oldest);
    starts.delete(oldest);
    lastShape.delete(oldest);
    paces.delete(oldest);
  }
}

function stopPaceTimer() {
  if (paceTimer === null) return;
  clearInterval(paceTimer);
  paceTimer = null;
}

function stepPaces() {
  const now = paceClock();
  for (const [queueId, entry] of paces) {
    if (entry.settled) continue;
    entry.state = stepPace(entry.state, now);
    publishPace(queueId, entry);
    if (entry.state.done && entry.state.shown >= 99.95) entry.settled = true;
  }
  if ([...paces.values()].every((entry) => entry.settled)) stopPaceTimer();
}

function ensurePaceTimer() {
  if (paceTimer === null && typeof setInterval === "function")
    paceTimer = setInterval(stepPaces, PACE_TICK_MS);
}

/**
 * Событие хода установки от движка → в темп (число идёт ровно, `progress-pace.js`). `sizeBytes` — размер пакета строки, если оболочка его знает: от него зависит
 * память запусков. Вернёт `true`, когда число ведёт темп: тогда сырой процент движка в склад не кладут.
 */
export function feedInstallProgress(queueId, update, sizeBytes = 0) {
  if (!PACE_ON || !queueId) return false;
  const now = paceClock();
  let entry = paces.get(queueId);
  if (!entry) {
    const bucket = sizeBucket(sizeBytes);
    entry = {
      bucket,
      state: createPace({ expect: readExpect(bucket), now }),
      settled: false,
    };
    paces.set(queueId, entry);
  }
  /* Новая попытка под тем же номером (повтор): ход заново, ожидания — уже с учётом только что законченной. */
  if (entry.state.done && stageOfEvent(update) !== "done")
    entry.state = createPace({ expect: readExpect(entry.bucket), now });
  const before = entry.state;
  entry.state = feedPace(entry.state, update, now);
  entry.settled = false;
  if (entry.state.done && !before.done)
    rememberRun(entry.bucket, paceDurations(entry.state));
  publishPace(queueId, entry);
  ensurePaceTimer();
  return true;
}

/** Размер пакета строки очереди в байтах (что знает оболочка до первого события) — для ведра памяти запусков; неизвестен — 0. */
export function queueRowBytes(row) {
  const known = row?.installPlan?.summary?.writeBytes ?? row?.totalBytes ?? row?.sizeBytes;
  return Number.isFinite(Number(known)) ? Number(known) : 0;
}

/** Записать ход строки. Тот же ход — без оповещения. */
export function publishQueueProgress(queueId, patch) {
  if (!queueId) return;
  recordTrail(queueId, patch.fraction, patch.downloadedBytes);
  if (!starts.has(queueId) && typeof patch.fraction === "number" && Number.isFinite(patch.fraction)) {
    starts.set(queueId, patch.fraction);
  }
  const previous = values.get(queueId) || null;
  const next = { ...(previous || {}) };
  let changed = !previous;
  for (const field of LIVE_FIELDS) {
    if (patch[field] === undefined || patch[field] === null) continue;
    if (next[field] !== patch[field]) {
      next[field] = patch[field];
      changed = true;
    }
  }
  if (!changed) return;
  values.delete(queueId);
  values.set(queueId, next);
  evictOldest();
  notify(queueId);
}

/** Ход строки или `null`, если о ней ещё ничего не приходило. */
export function readQueueProgress(queueId) {
  return (queueId && values.get(queueId)) || null;
}

/** С какой доли скачивания началась строка (0…1) или `null`, если событий ещё не было. */
export function readQueueStart(queueId) {
  return queueId && starts.has(queueId) ? starts.get(queueId) : null;
}

/** Строка ушла из очереди — её ход больше не нужен. */
export function forgetQueueProgress(queueId) {
  lastShape.delete(queueId);
  trails.delete(queueId);
  starts.delete(queueId);
  paces.delete(queueId);
  if (!paces.size) stopPaceTimer();
  if (!values.delete(queueId)) return;
  notify(queueId);
}

function subscribe(queueId, listener) {
  if (!queueId) return () => {};
  if (!listeners.has(queueId)) listeners.set(queueId, new Set());
  listeners.get(queueId).add(listener);
  return () => {
    const set = listeners.get(queueId);
    set?.delete(listener);
    if (set && !set.size) listeners.delete(queueId);
  };
}

/** Ход строки очереди для компонента — перерисовывает только его. */
export function useQueueProgress(queueId) {
  const listen = useCallback(
    (listener) => subscribe(queueId, listener),
    [queueId],
  );
  const read = useCallback(() => readQueueProgress(queueId), [queueId]);
  return useSyncExternalStore(listen, read, read);
}

/**
 * Строка очереди с живым ходом поверх: то, что показывать. У строки без
 * событий (демо, удаление, сброс — их ход двигает окно само) — она как есть.
 */
export function withLiveProgress(item, live) {
  if (!item || !live || item.failed) return item;
  return { ...item, ...live };
}

/** То же одной строкой хука: строка и её живой ход. */
export function useLiveQueueItem(item) {
  return withLiveProgress(item, useQueueProgress(item?.queueId || ""));
}

/**
 * Мост событий главного процесса: проценты — в склад, смена строки — в
 * очередь оболочки. `setQueue` — сеттер очереди `DesktopShell`.
 */
export function useInstallProgressBridge(setQueue, sizeOf = null) {
  useEffect(
    () =>
      onLocalInstallProgress((update) => {
        const queueId = update.operationId;
        /* Слово человеку до первого байта (пара «редукс + мод каталога»): кладётся в строку и живёт в ней до конца установки. */
        const notice = update.notice?.text
          ? { code: String(update.notice.code || ""), text: String(update.notice.text) }
          : null;
        if (notice)
          setQueue((previous) =>
            previous.map((item) =>
              item.queueId === queueId ? { ...item, notice } : item,
            ),
          );
        const percent =
          update.percent == null
            ? undefined
            : Math.min(99, Number(update.percent) || 0);
        /* Число ведёт темп (`feedInstallProgress`): сырой процент движка в склад не идёт, остальные поля — как были. */
        const paced = feedInstallProgress(queueId, update, sizeOf?.(queueId) || 0);
        publishQueueProgress(queueId, {
          progress: paced ? undefined : percent,
          downloadedBytes: update.downloadedBytes,
          completedFiles: update.completed,
          totalFiles: update.total,
          fraction: update.fraction,
        });
        /* Событие без шага шаг не стирает: строка остаётся на прежнем. */
        const last = lastShape.get(queueId) || {};
        const phase = update.phase || last.phase || "";
        const cancellable = update.cancellable ?? last.cancellable;
        if (
          lastShape.has(queueId) &&
          last.phase === phase &&
          last.cancellable === cancellable
        )
          return;
        lastShape.set(queueId, { phase, cancellable });
        setQueue((previous) =>
          previous.map((item) =>
            item.queueId === queueId
              ? {
                  ...item,
                  progress: percent ?? item.progress,
                  phase: phase || item.phase,
                  phaseStartedAt:
                    phase && phase !== item.phase
                      ? Date.now()
                      : item.phaseStartedAt,
                  cancellable: cancellable ?? item.cancellable,
                  completedFiles: update.completed ?? item.completedFiles,
                  totalFiles: update.total ?? item.totalFiles,
                  downloadedBytes:
                    update.downloadedBytes ?? item.downloadedBytes,
                }
              : item,
          ),
        );
      }),
    [setQueue],
  );
}

/** Для тестов: склад заводится заново. */
export function resetQueueProgress() {
  const ids = [...values.keys()];
  values.clear();
  trails.clear();
  starts.clear();
  lastShape.clear();
  paces.clear();
  stopPaceTimer();
  ids.forEach(notify);
}
