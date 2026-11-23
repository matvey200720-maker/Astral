import fs from "node:fs/promises";
import { IO_PRIORITY, setFileIoPriority } from "@modovik/native-rs";
import { sharedWritePacer } from "./write-pacing.js";
import {
  CAREFUL_MIN_BYTES,
  carefulReadFlags,
  carefulWriteFlags,
  diskRestEnabled,
  diskTurn,
  onDiskRestChange,
  throttledOp,
  writeFully,
} from "./disk-care.js";
import { diskKind } from "./disk-profile.js";

export const COPY_BUFFER_BYTES = 4 * 1024 * 1024;

const ignore = () => {};

/*
 * Ступень ввода-вывода файлов копии (18.11.2026, «при установке диск под 100 % и всё лагает»).
 *
 * Копия собранного архива в папку игры — больше половины времени установки мода каталога, и идёт она в главном процессе:
 * ступень процесса (`child-priority.js`) её не достаёт, а чтения и записи Node выполняет общий пул потоков. Поэтому ступень
 * ставится самим открытым файлам копии (`setFileIoPriority`, `@modovik/native-rs`): её чтения и записи уступают очередь
 * чужим программам, окно и остальные файлы процесса не задеты. Диск никому больше не нужен — скорость та же.
 *
 * Режим тот же, что у отдыха диска (`disk-care.js`): обычный — «низкий», «Быстрая установка» — «обычный»; режим сменили
 * посреди копии — ступень открытых файлов меняется сразу. Выключатель общий с процессами установки,
 * `ASTRAL_INSTALL_IO_PRIORITY`: `0` — «очень низкий», `2` — не понижать. Нет модуля или система отказала — копия идёт как шла.
 */
export const COPY_IO_ENV = "ASTRAL_INSTALL_IO_PRIORITY";

/** Ступень файлов копии: `gentle` — обычный режим (отдых диска включён). */
export function copyIoLevel({ gentle = diskRestEnabled(), env = process.env } = {}) {
  if (!gentle) return IO_PRIORITY.normal;
  const word = String(env?.[COPY_IO_ENV] ?? "").trim();
  if (word === "0") return IO_PRIORITY.veryLow;
  if (word === "2") return IO_PRIORITY.normal;
  return IO_PRIORITY.low;
}

/* Сбой смены ступени копию не трогает. */
function applyIoLevel(setIoPriority, files, level) {
  if (typeof setIoPriority !== "function") return;
  for (const file of files) {
    try {
      setIoPriority(file, level);
    } catch {
      /* ступень не сменилась — копия идёт с прежней */
    }
  }
}

// Флаги открытия: обычный и «бережный» (для больших файлов) режимы одной таблицей.
const OPEN_MODES = {
  plain: { read: () => "r", write: (mode) => mode },
  careful: { read: () => carefulReadFlags(), write: (mode) => carefulWriteFlags(mode) },
};

export function abortError(signal) {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  error.cause = signal?.reason;
  return error;
}

// Умолчания ставятся только вместо undefined: null остаётся null, а options === null падает здесь же.
function copySettings(options) {
  const given = (name, fallback) => (options[name] === undefined ? fallback() : options[name]);
  return {
    onChunk: given("onChunk", () => null),
    signal: given("signal", () => null),
    durable: given("durable", () => false),
    flags: given("flags", () => "w"),
    bufferBytes: given("bufferBytes", () => COPY_BUFFER_BYTES),
    /* Чем ставить ступень ввода-вывода открытым файлам копии; `null` — не ставить. */
    setIoPriority: given("setIoPriority", () => setFileIoPriority),
    /* Общий писатель читает потолок на каждом куске: «Быстрая установка», включённая или выключенная посреди копии,
       действует сразу. Без потолка он ничего не ждёт. */
    pacer: given("pacer", () => sharedWritePacer()),
  };
}

// Один буфер на всю копию; негодный размер отвергает сама платформа.
const allocateChunkBuffer = (bytes) => Buffer.allocUnsafeSlow(bytes);

// Сеанс копии: оба файла открыты, операции идут напрямую или через очередь больших операций диска.
class CopySession {
  #reader;
  #writer;
  #buffer;
  #source;
  #destination;
  #queued;
  #unfollowIo = ignore;

  static async open({ source, destination, flags, buffer, large, setIoPriority = null }) {
    const modes = OPEN_MODES[large ? "careful" : "plain"];
    const queued = large || diskKind(destination) === "slow";
    const reader = await fs.open(source, modes.read());
    let writer;
    try {
      writer = await fs.open(destination, modes.write(flags));
    } catch (error) {
      await reader.close().catch(ignore);
      throw error;
    }
    const session = new CopySession({ reader, writer, buffer, source, destination, queued });
    session.#followIoLevel(setIoPriority);
    return session;
  }

  /* Свежим файлам «обычную» ставить незачем; дальше ступень идёт за режимом, пока файлы открыты. */
  #followIoLevel(setIoPriority) {
    const files = [this.#reader, this.#writer];
    const level = copyIoLevel();
    if (level !== IO_PRIORITY.normal) applyIoLevel(setIoPriority, files, level);
    this.#unfollowIo = onDiskRestChange((gentle) => applyIoLevel(setIoPriority, files, copyIoLevel({ gentle })));
  }

  constructor({ reader, writer, buffer, source, destination, queued }) {
    this.#reader = reader;
    this.#writer = writer;
    this.#buffer = buffer;
    this.#source = source;
    this.#destination = destination;
    this.#queued = queued;
  }

  #run(work, measure) {
    return this.#queued ? diskTurn(work, { measure }) : work();
  }

  async #fill() {
    const length = this.#buffer.length;
    await throttledOp(length);
    return this.#reader.read(this.#buffer, { offset: 0, length, position: null });
  }

  // Куски — начало одного и того же буфера, действительны до следующего чтения.
  async *chunks(signal) {
    const measure = { kind: "read", bytes: this.#buffer.length, place: this.#source };
    for (;;) {
      if (signal?.aborted) {
        throw abortError(signal);
      }
      const { bytesRead } = await this.#run(() => this.#fill(), measure);
      if (bytesRead === 0) {
        return;
      }
      yield this.#buffer.subarray(0, bytesRead);
    }
  }

  store(chunk) {
    const measure = { kind: "write", bytes: chunk.length, place: this.#destination };
    return this.#run(() => writeFully(this.#writer, chunk), measure);
  }

  flush() {
    return this.#writer.sync();
  }

  async close() {
    this.#unfollowIo();
    await this.#reader.close().catch(ignore);
    await this.#writer.close().catch(ignore);
  }
}

export async function copyThroughBuffer(source, destination, options = {}) {
  const { onChunk, signal, durable, flags, bufferBytes, pacer, setIoPriority } = copySettings(options);
  if (signal?.aborted) {
    throw abortError(signal);
  }
  const buffer = allocateChunkBuffer(bufferBytes);
  const sourceBytes = (await fs.stat(source)).size;
  const session = await CopySession.open({
    source,
    destination,
    flags,
    buffer,
    large: sourceBytes >= CAREFUL_MIN_BYTES,
    setIoPriority,
  });

  try {
    for await (const chunk of session.chunks(signal)) {
      if (onChunk != null) {
        onChunk(chunk);
      }
      await session.store(chunk);
      if (pacer) {
        await pacer.wrote(chunk.length);
      }
    }
    if (durable) {
      await session.flush();
    }
  } finally {
    await session.close();
  }
}
