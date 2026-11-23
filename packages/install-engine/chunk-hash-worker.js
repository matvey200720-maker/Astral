/*
 * Поток счёта хранилища кусков (`chunk-hash-off-thread.js`, 02.11.2026). Байты лежат в общем
 * буфере (`SharedArrayBuffer` из `workerData.shared`): главный поток читает файл в него и
 * спрашивает, поток считает и отвечает. Пока ответа нет, главный поток буфер не трогает.
 *
 * Счёт тот же, что был в главном потоке (`chunk-store.js`): нарезка по содержимому (gear-хеш,
 * кусок от 256 КБ до 4 МБ) и SHA-256 куска и всего файла. Границы кусков постоянны (с
 * 10.10.2026): `tests/chunk-store.test.js` сверяет их с прежним счётом байт в байт.
 */
import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { CUT_GEAR, CUT_MASK, CUT_MAX, CUT_MIN, CUT_SKIP } from "./chunk-cut.js";

const bytes = Buffer.from(workerData.shared);
let whole = createHash("sha256");
/* Нарезка: состояние между блоками — байты куска до начала блока, их хеш и скользящий хеш. */
let pieceHash = createHash("sha256");
let have = 0;
let rolling = 0;

/*
 * Скользящий хеш — 32 бита со сдвигом на байт: через 32 байта прежние байты из него выходят.
 * Поэтому первые `CUT_SKIP` байт куска (до `CUT_MIN − 32`) не считаются: граница там всё
 * равно не ставится, а к `CUT_MIN` хеш уже тот же, что при счёте с начала куска.
 */
function cut(length) {
  const ends = [];
  const shas = [];
  whole.update(bytes.subarray(0, length));
  let start = 0;
  let index = 0;
  let state = rolling;
  while (index < length) {
    const offset = have + (index - start);
    if (offset < CUT_SKIP) {
      index = start + (CUT_SKIP - have);
      state = 0;
      if (index >= length) break;
    }
    const forced = start + (CUT_MAX - 1 - have);
    const earliest = start + (CUT_MIN - 1 - have);
    const last = Math.min(length - 1, forced);
    let hit = -1;
    for (; index <= last; index += 1) {
      state = ((state << 1) + CUT_GEAR[bytes[index]]) >>> 0;
      if (index === forced || ((state & CUT_MASK) === 0 && index >= earliest)) {
        hit = index;
        break;
      }
    }
    if (hit < 0) break;
    pieceHash.update(bytes.subarray(start, hit + 1));
    ends.push(hit + 1);
    shas.push(pieceHash.digest("hex"));
    pieceHash = createHash("sha256");
    start = hit + 1;
    index = start;
    have = 0;
    state = 0;
  }
  if (start < length) {
    pieceHash.update(bytes.subarray(start, length));
    have += length - start;
  }
  rolling = state;
  return { ends, shas };
}

function cutEnd() {
  const sha = have ? pieceHash.digest("hex") : null;
  pieceHash = createHash("sha256");
  have = 0;
  rolling = 0;
  return sha;
}

const sha = (length) => createHash("sha256").update(bytes.subarray(0, length)).digest("hex");

parentPort.on("message", (message) => {
  const { id, op, length = 0 } = message || {};
  try {
    let value = null;
    if (op === "sha") value = sha(length);
    else if (op === "check") {
      value = sha(length) === message.sha;
      if (value && message.feed) whole.update(bytes.subarray(0, length));
    } else if (op === "feed") whole.update(bytes.subarray(0, length));
    else if (op === "whole") {
      value = whole.digest("hex");
      whole = createHash("sha256");
    } else if (op === "cut") value = cut(length);
    else if (op === "cutEnd") value = cutEnd();
    else if (op !== "ping") throw new Error(`Поток кусков: нет действия ${op}.`);
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
