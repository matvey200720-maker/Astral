/*
 * Трасса чтений игры в потоках чтения (`game-read-host.js`, `game-read-worker.js`): время каждого вызова читателя — запуск потока, проверка ключей, очередь потока, сам
 * читатель, отправка и получение ответа — одной строкой JSON на вызов. Для замера входа во вкладки мастерской на настоящей сборке (`docs/perf/speed-3d-rust/14-tab-reads-inventory.md`).
 *
 * Выключатель — `ASTRAL_READ_TRACE=1` в окружении главного процесса (по умолчанию выключен). Выключенная трасса не добавляет ни одного сообщения между потоками и не берёт
 * ни одной метки времени: хост и поток проверяют один флаг. Включённая — дописывает строки в `ASTRAL_READ_TRACE_FILE` (без неё — `astral-read-trace-<pid>.jsonl` во временной папке);
 * путь один раз попадает в журнал приложения. Строки копятся в памяти и дописываются пачкой по таймеру и при выходе из процесса: ни одной синхронной записи на вызов.
 *
 * В строках нет путей, текстов ошибок и ничего из запроса: короткое имя модуля, имя экспорта, числа и класс ошибки.
 * Часы потоков сводятся через `performance.timeOrigin + performance.now()` (проверено: расхождение потока и главного процесса — сотые доли миллисекунды).
 *
 * Состав строки (миллисекунды округлены до сотых):
 *   module, export, at (время начала вызова, мс эпохи), launchMs (только у первого вызова потока: от рождения потока до «готов», с импортом модуля),
 *   keysMs (проверка ключей в обёртке `createGameReader`; у прямых вызовов хоста нет), queueMs (от отправки до начала работы в потоке; у первого вызова — от готовности потока),
 *   readMs (сам читатель), sendMs (отправка ответа потоком: у ответа без передачи в неё входит копия), receiveMs (от отправки потоком до получения в главном: перенос, ожидание
 *   цикла событий главного процесса, разбор ответа), totalMs (от входа в обёртку или в хост до ответа), bytes (двоичные части ответа), transfer, concurrent (вызовов этого хоста
 *   в полёте при отправке, считая этот), progress (сообщений хода), nativeCalls и nativeMs (вызовы моста `tools.native` за время этого вызова; nativeMs — сумма длительностей,
 *   параллельные считаются каждый), ok, error (класс: `code` или имя ошибки; поток упал — WORKER_CRASH, WORKER_OOM, WORKER_EXIT; отмена — ABORT_ERR).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const ON_WORDS = new Set(["1", "on", "true", "yes"]);
const MAX_DEPTH = 4;
const FLUSH_MS = 400;
const CODE = /^[A-Z][A-Z0-9_]{1,48}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;

/** Включена ли трасса в окружении: по умолчанию нет. */
export const traceWanted = (env = process.env) => ON_WORDS.has(String(env?.ASTRAL_READ_TRACE ?? "").trim().toLowerCase());

/** Время стены в миллисекундах эпохи; одно на все потоки процесса. */
export const wallNow = () => performance.timeOrigin + performance.now();

const hundredth = (value) => Math.round(value * 100) / 100;

/** Короткое имя модуля читателя: последний сегмент адреса, без пути. */
export function moduleLabel(module) {
  const text = String(module ?? "").split(/[?#]/)[0];
  const last = text.split(/[\\/]/).filter(Boolean).pop();
  return last || "?";
}

/** Класс ошибки без текста: код, если он похож на код, иначе имя. */
export function errorClass(error) {
  const code = String(error?.code ?? "");
  if (CODE.test(code)) return code;
  const name = String(error?.name ?? "");
  return NAME.test(name) ? name : "Error";
}

/** Двоичные части результата тем же обходом, что `transferables` потока: буфер и виды на него считаются один раз. */
export function binaryBytes(value) {
  const seen = new Set();
  let total = 0;
  const walk = (item, depth) => {
    if (!item || typeof item !== "object" || depth > MAX_DEPTH) return;
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
      const buffer = item instanceof ArrayBuffer ? item : item.buffer;
      if (seen.has(buffer)) return;
      seen.add(buffer);
      total += item.byteLength;
      return;
    }
    for (const inner of Object.values(item)) walk(inner, depth + 1);
  };
  walk(value, 0);
  return total;
}

/** Файл трассы: из окружения или во временной папке с номером процесса. */
export function traceFileOf(env = process.env) {
  const given = String(env?.ASTRAL_READ_TRACE_FILE ?? "").trim();
  return given || path.join(os.tmpdir(), `astral-read-trace-${process.pid}.jsonl`);
}

class Sink {
  #lines = [];
  #timer = null;
  #chain = Promise.resolve();
  #failed = false;

  constructor(file, options) {
    this.file = file;
    this.flushMs = options.flushMs ?? FLUSH_MS;
    this.note = options.note ?? null;
  }

  push(row) {
    this.#lines.push(`${JSON.stringify(row)}\n`);
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.flushMs);
    this.#timer.unref?.();
  }

  /** Дописать накопленное; обещание кончается, когда запись на диске. */
  flush() {
    if (this.#lines.length === 0) return this.#chain;
    const text = this.#lines.join("");
    this.#lines = [];
    this.#chain = this.#chain
      .then(async () => {
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        await fsp.appendFile(this.file, text);
      })
      .catch(() => {
        if (this.#failed) return;
        this.#failed = true;
        this.note?.("failed", this.file);
      });
    return this.#chain;
  }

  /** При выходе из процесса таймера уже не будет: остаток — одной синхронной записью. */
  flushSync() {
    if (this.#lines.length === 0) return;
    const text = this.#lines.join("");
    this.#lines = [];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, text);
    } catch {
      /* на выходе писать некуда — трасса не должна ничего ронять */
    }
  }
}

const sinks = new Map();
let exitHooked = false;

/** Одна запись на файл на процесс: все хосты пишут через неё. `note(kind, file)` зовётся при создании (`"opened"`) и при отказе записи (`"failed"`). */
export function traceSinkFor(file, options = {}) {
  const known = sinks.get(file);
  if (known) return known;
  const sink = new Sink(file, options);
  sinks.set(file, sink);
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => {
      for (const one of sinks.values()) one.flushSync();
    });
  }
  options.note?.("opened", file);
  return sink;
}

/** Дождаться записи всего накопленного (проверки и остановка стенда). */
export async function flushReadTrace() {
  await Promise.all([...sinks.values()].map((sink) => sink.flush()));
}

/**
 * Строка трассы по данным хоста и потока. `call` — со стороны хоста (метки главного процесса), `tail` — присланное потоком (может не быть, если поток упал), `state` — состояние потока.
 * Каждая стадия не короче нуля, а `totalMs` не меньше суммы очереди и чтения: округление не должно нарушить порядок.
 */
export function composeRow(call, tail, state) {
  const cut = (value) => hundredth(Math.max(0, value));
  const row = { module: call.module, export: call.exportName, at: Math.round(call.enteredAt) };
  if (call.first && state?.launchMs != null) row.launchMs = cut(state.launchMs);
  if (call.keysMs != null) row.keysMs = cut(call.keysMs);
  let busy = 0;
  if (tail) {
    const base = Math.max(call.sentAt, state?.readyAt ?? call.sentAt);
    const queueMs = cut(tail.startedAt - base);
    const readMs = cut(tail.readMs);
    busy = queueMs + readMs;
    row.queueMs = queueMs;
    row.readMs = readMs;
    row.sendMs = tail.sendMs == null ? null : cut(tail.sendMs);
    row.receiveMs = cut(call.recvAt - tail.postedAt);
  }
  row.totalMs = Math.max(cut(call.recvAt - call.enteredAt), hundredth(busy));
  if (tail) row.bytes = tail.bytes;
  row.transfer = call.transfer;
  row.concurrent = call.concurrent;
  row.progress = call.progress;
  if (tail) {
    row.nativeCalls = tail.nativeCalls;
    row.nativeMs = cut(tail.nativeMs);
  }
  const ok = tail ? tail.ok : call.ok;
  row.ok = Boolean(ok);
  if (!row.ok) row.error = tail?.error ?? call.error ?? "Error";
  return row;
}
