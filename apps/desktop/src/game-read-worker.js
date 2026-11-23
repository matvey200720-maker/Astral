import { AsyncLocalStorage } from "node:async_hooks";
import { parentPort, workerData } from "node:worker_threads";
import "./native-block-codec.js";

// Тело потока чтения игры: читатель грузится один раз, дальше каждое сообщение — один вызов.

const MAX_DEPTH = 4;

/* Трасса чтений (`game-read-trace.js`): включается данными потока при запуске (`workerData.trace`), хост по ней же узнаёт о хвосте. Без неё — ни меток времени, ни лишних сообщений. */
const TRACED = workerData?.trace === true;
const trace = TRACED ? await import("./game-read-trace.js") : null;
/* Вызовы моста к движку, сделанные из этого вызова читателя: счёт и сумма длительностей по вызову, а не по потоку. */
const nativeScope = TRACED ? new AsyncLocalStorage() : null;

// Сообщение родителю вида { <ключ>: значение }, одним аргументом.
const relay = (key) => (value) => {
  parentPort.postMessage({ [key]: value });
};

// Ошибка нативного хоста: код переносится, только если он истинный.
const hostFailure = (error) => Object.assign(new Error(error.message), error.code ? { code: error.code } : null);

const failureReply = (id, error) => ({
  id,
  error: { message: String(error?.message || error), code: error?.code ?? null },
});

// Нативный хост живёт в главном потоке: вызов уходит родителю, ответ приходит сообщением.
function createNativeBridge() {
  let lastId = 0;
  const waiting = new Map();

  function native(command, input) {
    const stats = nativeScope?.getStore();
    const began = stats ? trace.wallNow() : 0;
    return new Promise((resolve, reject) => {
      const id = ++lastId;
      waiting.set(id, (error, result) => {
        if (stats) {
          stats.calls += 1;
          stats.ms += trace.wallNow() - began;
        }
        return error ? reject(hostFailure(error)) : resolve(result);
      });
      parentPort.postMessage({ nativeCall: { id, command, input } });
    });
  }

  function accept({ id, result, error }) {
    const settle = waiting.get(id);
    if (!settle) return;
    waiting.delete(id);
    settle(error, result);
  }

  return { native, accept };
}

const { native, accept: acceptNativeReply } = createNativeBridge();

// Этапы загрузки в порядке выполнения: (нужен ли этап, сам этап).
const LOAD_STAGES = [
  [
    () => workerData.logs,
    async () => {
      const { appLog } = await import("./app-log.js");
      const sendLog = relay("log");
      appLog.record = (entry) => {
        sendLog(entry);
        return appLog;
      };
    },
  ],
  [
    () => workerData.context,
    async () => {
      const { setNativeContextDefaults } = await import("./native-engine.js");
      setNativeContextDefaults(workerData.context);
    },
  ],
];

for (const [needed, load] of LOAD_STAGES) {
  if (needed()) await load();
}
const reader = await import(workerData.module);

// Слот списка аргументов с дополнением: новый объект, при `field` — вложенное поле слота.
const withExtra = (slot, field, extra) => (field
  ? { ...(slot || {}), [field]: { ...(slot?.[field] || {}), ...extra } }
  : { ...(slot || {}), ...extra });

function graft(list, at, field, extra) {
  while (list.length <= at) list.push(undefined);
  list[at] = withExtra(list[at], field, extra);
  return list;
}

// Список аргументов вызова: исходные, затем ход работы, затем инструменты.
function argumentsFor({ args, toolsAt, progressAt }, onProgress) {
  const [toolSlot, toolField = null] = Array.isArray(toolsAt) ? toolsAt : [toolsAt];
  const grafts = [
    { at: progressAt, extra: { onProgress }, wanted: () => true },
    { at: toolSlot, field: toolField, extra: { native }, wanted: () => workerData.native },
  ];
  return grafts
    .filter(({ at, wanted }) => Number.isInteger(at) && wanted())
    .reduce((list, { at, field = null, extra }) => graft(list, at, field, extra), [...(args || [])]);
}

// Буферы результата, которые можно передать без копирования, в порядке обхода вглубь.
function* transferables(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return;
  if (value instanceof ArrayBuffer) {
    yield value;
    return;
  }
  if (ArrayBuffer.isView(value)) {
    const { buffer } = value;
    if (value.byteOffset === 0 && value.byteLength === buffer.byteLength && buffer instanceof ArrayBuffer) {
      yield buffer;
    }
    return;
  }
  for (const inner of Object.values(value)) yield* transferables(inner, depth + 1);
}

// Хвост трассы вызова: метки потока одним сообщением после ответа (после — потому что время отправки известно, только когда она кончилась).
function traceTail(id, note) {
  const { calls, ms } = note.native;
  return {
    id,
    startedAt: note.startedAt,
    readMs: (note.parsedAt ?? trace.wallNow()) - note.startedAt,
    postedAt: note.postedAt ?? trace.wallNow(),
    sendMs: note.sendMs ?? null,
    bytes: note.bytes ?? 0,
    nativeCalls: calls,
    nativeMs: ms,
    ok: note.ok,
    ...(note.ok ? {} : { error: note.error }),
  };
}

async function runCall(message) {
  const { id, exportName, args, toolsAt, progressAt, transfer } = message || {};
  const note = TRACED ? { startedAt: trace.wallNow(), native: { calls: 0, ms: 0 }, ok: true } : null;
  try {
    if (typeof reader[exportName] !== "function") {
      throw new Error(`У читателя нет функции ${exportName}.`);
    }
    const onProgress = (status) => {
      parentPort.postMessage({ id, progress: status });
    };
    const list = argumentsFor({ args, toolsAt, progressAt }, onProgress);
    const result = await (note ? nativeScope.run(note.native, () => reader[exportName](...list)) : reader[exportName](...list));
    if (note) {
      note.parsedAt = trace.wallNow();
      /* Размер двоичных частей — до отправки: после передачи буферы пусты. */
      note.bytes = trace.binaryBytes(result);
      note.postedAt = trace.wallNow();
    }
    parentPort.postMessage({ id, result }, transfer ? [...new Set(transferables(result))] : []);
    if (note) note.sendMs = trace.wallNow() - note.postedAt;
  } catch (error) {
    if (note) Object.assign(note, { ok: false, error: trace.errorClass(error), parsedAt: note.parsedAt ?? trace.wallNow(), postedAt: trace.wallNow(), sendMs: null });
    parentPort.postMessage(failureReply(id, error));
  } finally {
    if (note) parentPort.postMessage({ trace: traceTail(id, note) });
  }
}

// Вид сообщения родителя: (признак, обработчик); последняя строка — любой вызов функции.
const MESSAGE_KINDS = [
  [(message) => message?.nativeReply, (message) => acceptNativeReply(message.nativeReply)],
  [() => true, runCall],
];

async function onMessage(message) {
  for (const [matches, handle] of MESSAGE_KINDS) {
    if (matches(message)) return handle(message);
  }
}

parentPort.on("message", onMessage);
parentPort.postMessage({ ready: true });
