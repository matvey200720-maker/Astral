/*
 * Бережная запись больших файлов (31.10.2026, тестер: «диск 100 %, отклик 174 мс, RAM 99 %» при 16 МБ/с записи, владелец: «чтобы обнова качалась, но не долбила диск в сотку»).
 *
 * Кэш системы принимает запись почти мгновенно (стенд `scripts/perf/ram/disk-write-modes.mjs`, блок 4 МБ: 1,2 мс), и загрузчик этого не замечает: диск отстаёт, а изменённые страницы
 * копятся в памяти. На машине с полной памятью и QLC-диском это худшее сочетание. Сброс кусками (`datasync` каждые 64 МБ, прежнее решение) обратной связи не даёт, а бьёт по соседям:
 * под чужой нагрузкой сброс стоял до 3 с при очереди диска 255, запись до 5,3 с. Поэтому здесь три правила:
 *
 *   — большой файл открыт сквозь кэш (`FILE_FLAG_WRITE_THROUGH`): запись завершается, когда байты на диске. Изменённые страницы не копятся, сбрасывать нечего, а время записи —
 *     честная мера того, сколько диск сейчас может;
 *   — большие чтения и записи процесса идут по одной (`diskTurn`): несколько линий и загрузка наперёд не складываются в очередь на диске;
 *   — после операции диск отдыхает столько же, сколько она шла: занятость от Astral не больше половины. На быстром диске отдых незаметен (4 МБ за 9 мс при бюджете 40 мс на блок
 *     на потолке 100 МБ/с), на занятом скорость падает сама — диск в этот момент нужен другим. Когда память на исходе, отдых втрое дольше.
 *
 * Состояние своё у каждого потока: поток копии (`copy-worker.js`) ведёт свою очередь, а большие копии и так идут по одной (`copy-off-thread.js`).
 * Целостность это не трогает: меняется только то, как и когда байты попадают на диск. Понизить приоритет ввода-вывода самих потоков из JS нельзя, для этого нужен вызов Windows
 * (`THREAD_MODE_BACKGROUND_BEGIN`, как в движке, `disk.rs`).
 */

import { constants as fsConstants } from "node:fs";
import os from "node:os";
import { noteDiskOp } from "./disk-profile.js";
import { MAX_REST_MS as GOVERNED_MAX_REST_MS, diskGovernor } from "./disk-governor.js";

const MEGABYTE = 1024 * 1024;

/* Размер одной записи и одного чтения большого файла. */
export const DISK_BLOCK_BYTES = 4 * MEGABYTE;
/* С какого размера файл считается большим. Мелкие файлы (пакет на десятки тысяч файлов) идут кэшем, параллельно и без очереди, как раньше. */
export const CAREFUL_MIN_BYTES = 16 * MEGABYTE;

/* Числа libuv на Windows: в `fs.constants` их там нет, значения — из `uv/win.h`. На других системах те же биты значат другое, поэтому только на Windows. */
const UV_FS_O_SYNC = 0x08000000;
const UV_FS_O_SEQUENTIAL = 0x0800;

const OPEN_MODES = Object.freeze({
  w: fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC,
  wx: fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
  a: fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND,
  ax: fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_APPEND,
});

/** Флаги открытия большого файла на запись: сквозь кэш на Windows, прежняя строка в остальном. */
export function carefulWriteFlags(mode, { platform = process.platform } = {}) {
  if (platform !== "win32" || !(mode in OPEN_MODES)) return mode;
  return OPEN_MODES[mode] | UV_FS_O_SYNC;
}

/** Флаги чтения большого файла подряд: система читает наперёд и не держит прочитанное в кэше дольше нужного. */
export function carefulReadFlags({ platform = process.platform } = {}) {
  return platform === "win32" ? fsConstants.O_RDONLY | UV_FS_O_SEQUENTIAL : "r";
}

/* Отдых не длиннее этого: на диске под чужой нагрузкой загрузка замедляется, но не встаёт. Регулятор диска (`disk-governor.js`), когда уступает, растягивает отдых до своего предела. */
const MAX_REST_MS = 2000;
/* Память на исходе, когда свободно меньше этой доли. У машины на 16 ГБ — около 960 МБ. */
const LOW_MEMORY_SHARE = 0.06;
const LOW_MEMORY_REST = 3;
const MEMORY_CHECK_MS = 1000;

/*
 * Стенд медленного диска (`ASTRAL_DISK_THROTTLE=<мс на операцию>:<МБ/с>`, `setDiskThrottle`): настоящего жёсткого диска на стенде нет, поэтому операции
 * идут по одной с задержкой, как с одной головкой: `opMs` — перемещение, байты — по скорости. Подстройка видит только время операций и не знает о дросселе.
 * `diskThrottleStats` — очередь: сколько операций стояло разом, это и есть «долбится».
 */
const parseThrottle = (text) => {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(text || "").trim());
  return match ? { opMs: Number(match[1]), mbps: Number(match[2]) } : null;
};
/*
 * «Быстрая установка» (13.11.2026, решение владельца): человек сам снял тормоз с диска — отдыха после операции нет,
 * диск занят настолько, насколько может. Очередь больших операций и запись сквозь кэш остаются. Состояние своё у
 * каждого потока; потоку копии его передаёт `copy-off-thread.js`.
 */
let restEnabled = true;
const restListeners = new Set();

export function setDiskRest(enabled) {
  restEnabled = enabled !== false;
  for (const listener of restListeners) listener(restEnabled);
}

export const diskRestEnabled = () => restEnabled;

/*
 * Множитель отдыха от регулятора диска (20.11.2026): 1 — отдых «столько же», как был; регулятор поднимает его, когда диск занят больше цели (`disk-governor.js: restFactor`). Главный процесс спрашивает
 * регулятор сам, по месту операции; потоку копии и процессам сборки у регулятора брать нечего (у него нет датчика), им главный процесс присылает число — так же, как потолок записи и отдых.
 */
let restFactorValue = 1;
const restFactorListeners = new Set();

export function setDiskRestFactor(value) {
  const number = Number(value);
  const next = Number.isFinite(number) && number > 1 ? Math.min(number, 40) : 1;
  if (next === restFactorValue) return;
  restFactorValue = next;
  for (const listener of restFactorListeners) listener(next);
}

export const diskRestFactor = () => restFactorValue;

/** Подписка на смену множителя отдыха; возвращает отписку. */
export function onDiskRestFactorChange(listener) {
  restFactorListeners.add(listener);
  return () => restFactorListeners.delete(listener);
}

/* Множитель для операции на месте `place`: у регулятора — его решение по диску места, иначе присланное главным процессом число. */
function governedRestFactor(place) {
  const governor = diskGovernor();
  if (governor.isActive()) return governor.restFactor(place ? [place] : null);
  return restFactorValue;
}

/** Подписка на смену режима отдыха; возвращает отписку. */
export function onDiskRestChange(listener) {
  restListeners.add(listener);
  return () => restListeners.delete(listener);
}

let throttle = parseThrottle(process.env.ASTRAL_DISK_THROTTLE);
let throttleTail = Promise.resolve();
let throttleWaiting = 0;
const throttleStats = { ops: 0, peakQueue: 0, queueSum: 0, busyMs: 0 };

/** Стенду и тестам: `{ opMs, mbps }` или `null`. */
export function setDiskThrottle(value) {
  throttle = value;
  /* Поток копии заводит свой дроссель с теми же числами: у него своя очередь, как и своя копия. */
  if (value) process.env.ASTRAL_DISK_THROTTLE = `${value.opMs}:${value.mbps}`;
  else delete process.env.ASTRAL_DISK_THROTTLE;
  Object.assign(throttleStats, { ops: 0, peakQueue: 0, queueSum: 0, busyMs: 0 });
}
export const diskThrottleStats = () => ({ ...throttleStats, meanQueue: throttleStats.ops ? +(throttleStats.queueSum / throttleStats.ops).toFixed(2) : 0 });
/** Счётчики потока копии — в общие. */
export function addDiskThrottleStats(other) {
  if (!other) return;
  throttleStats.ops += other.ops;
  throttleStats.queueSum += other.queueSum;
  throttleStats.busyMs += other.busyMs;
  throttleStats.peakQueue = Math.max(throttleStats.peakQueue, other.peakQueue);
}

/** Операция диска на стенде: ждёт своей очереди и отрабатывает время. Без стенда ничего не стоит. */
export function throttledOp(bytes) {
  if (!throttle) return null;
  const { opMs, mbps } = throttle;
  throttleWaiting += 1;
  throttleStats.ops += 1;
  throttleStats.queueSum += throttleWaiting;
  throttleStats.peakQueue = Math.max(throttleStats.peakQueue, throttleWaiting);
  const cost = opMs + (bytes / MEGABYTE / mbps) * 1000;
  throttleStats.busyMs += cost;
  const job = throttleTail.then(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          throttleWaiting -= 1;
          resolve();
        }, cost),
      ),
  );
  throttleTail = job;
  return job;
}

const abortError = (signal) => Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR", cause: signal?.reason });

/** Очередь и отдых; часы, сон и память подставляются в тестах. */
export function createDiskCare({
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  freeMemory = () => os.freemem(),
  totalMemory = () => os.totalmem(),
  restFactor = governedRestFactor,
} = {}) {
  let tail = Promise.resolve();
  let restUntil = 0;
  let memoryCheckedAt = -Infinity;
  let memoryLow = false;

  function isMemoryLow() {
    const time = now();
    if (time - memoryCheckedAt >= MEMORY_CHECK_MS) {
      memoryCheckedAt = time;
      memoryLow = freeMemory() < totalMemory() * LOW_MEMORY_SHARE;
    }
    return memoryLow;
  }

  /**
   * Выполнить большую операцию своей очередью, отдохнув после предыдущей. `measure` — `{ kind, bytes, place }`: время операции идёт в
   * подстройку под диск (`disk-profile.js`), сон потолка и очередь в него не входят.
   */
  async function turn(work, { signal = null, measure = null } = {}) {
    const before = tail;
    let release;
    tail = new Promise((resolve) => (release = resolve));
    await before;
    try {
      if (signal?.aborted) throw abortError(signal);
      /* Работа с диском началась: регулятору пора поднять датчик (без него он не знает, что диск занят). */
      diskGovernor().touch();
      const rest = restEnabled ? restUntil - now() : 0;
      if (rest > 0) await sleep(rest);
      const started = now();
      const result = await work();
      const finished = now();
      const factor = restEnabled ? restFactor(measure?.place ?? null) : 1;
      restUntil = finished + Math.min(factor > 1 ? GOVERNED_MAX_REST_MS : MAX_REST_MS, (finished - started) * (isMemoryLow() ? LOW_MEMORY_REST : 1) * factor);
      if (measure) noteDiskOp(measure.kind, result?.bytesRead ?? measure.bytes, finished - started, measure.place);
      return result;
    } finally {
      release();
    }
  }

  return { turn, isMemoryLow };
}

let shared = createDiskCare();

/** Стенду и тестам: своя очередь с подставными часами. Без аргумента — настоящая. */
export function setDiskCareForTests(care = null) {
  shared = care || createDiskCare();
}

export const diskTurn = (work, options) => shared.turn(work, options);
export const diskMemoryIsLow = () => shared.isMemoryLow();

/** Записать всё: `write` файла может вернуться, записав меньше. */
export async function writeFully(handle, piece) {
  await throttledOp(piece.length);
  for (let written = 0; written < piece.length; ) written += (await handle.write(piece, written, piece.length - written)).bytesWritten;
}

/** Большой кусок — блоками по `DISK_BLOCK_BYTES`, каждый своей очередью. */
export async function carefulWrite(handle, piece, { signal = null, place = null } = {}) {
  for (let at = 0; at < piece.length; at += DISK_BLOCK_BYTES) {
    const block = piece.subarray(at, Math.min(piece.length, at + DISK_BLOCK_BYTES));
    await diskTurn(() => writeFully(handle, block), { signal, measure: place ? { kind: "write", bytes: block.length, place } : null });
  }
}

/**
 * Куски сети копятся в одном буфере и уходят на диск крупными записями: сеть отдаёт по 16–64 КБ, а новые буферы на каждый кусок — это мусор, за которым сборщик не успевает.
 * `careful` — запись большого файла (очередь и отдых). `flush` ничего не теряет при отказе: `pending` обнуляется только после записи.
 */
export function createBlockWriter(handle, { bufferBytes = DISK_BLOCK_BYTES, careful = false, signal = null, place = null } = {}) {
  const buffer = Buffer.allocUnsafeSlow(Math.max(1, bufferBytes));
  let filled = 0;
  const flush = async () => {
    if (!filled) return;
    const piece = buffer.subarray(0, filled);
    if (careful) await carefulWrite(handle, piece, { signal, place });
    else await writeFully(handle, piece);
    filled = 0;
  };
  return {
    get pending() {
      return filled;
    },
    flush,
    async append(chunk) {
      for (let at = 0; at < chunk.length; ) {
        const take = Math.min(chunk.length - at, buffer.length - filled);
        buffer.set(at === 0 && take === chunk.length ? chunk : chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === buffer.length) await flush();
      }
    },
  };
}
