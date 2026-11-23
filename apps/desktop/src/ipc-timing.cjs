"use strict";

// Замер времени ответа по каналам invoke. Нужен только стенду (ASTRAL_PERF_IPC=1),
// грузится предзагрузчиком через require, поэтому CommonJS и без импортов.

const SAMPLE_LIMIT = 300;
const QUANTILES = { p50: 0.5, p95: 0.95 };
// Числовые счётчики записи канала в порядке полей.
const COUNTERS = ["count", "errors", "pending", "totalMs", "maxMs"];

function tenth(value) {
  return Math.round(value * 10) / 10;
}

function ascending(a, b) {
  return a - b;
}

function costliestFirst(a, b) {
  return b.totalMs - a.totalMs;
}

function newTally(channel) {
  const tally = { channel };
  for (const key of COUNTERS) {
    tally[key] = 0;
  }
  tally.recent = [];
  return tally;
}

// Образец с номером min(n - 1, floor(q * n)); при чётном n медиана — старший из средних.
function percentile(samples, q) {
  if (samples.length === 0) {
    return null;
  }
  const ordered = samples.slice().sort(ascending);
  const last = ordered.length - 1;
  const rank = Math.floor(q * ordered.length);
  return tenth(ordered[Math.min(last, rank)]);
}

function describe(tally) {
  const { channel, count, errors, pending, totalMs, maxMs, recent } = tally;
  const entry = { channel, count, errors, pending, totalMs: tenth(totalMs), maxMs: tenth(maxMs) };
  for (const [label, q] of Object.entries(QUANTILES)) {
    entry[label] = percentile(recent, q);
  }
  return entry;
}

// Время завершённого вызова: последние образцы, суммарное и наибольшее время.
function record(tally, ms) {
  const { recent, totalMs, maxMs } = tally;
  recent.push(ms);
  recent.splice(0, recent.length - SAMPLE_LIMIT);
  Object.assign(tally, { totalMs: totalMs + ms, maxMs: Math.max(maxMs, ms) });
}

// Один вызов invoke: начало засекается при создании, конец — в finish.
function startMeasurement(tally, clock) {
  // Часы-не-функция падают здесь: запись канала уже заведена, а счётчики остаются нулями.
  const startedAt = clock();
  Object.assign(tally, { pending: tally.pending + 1, count: tally.count + 1 });

  // failures — 1, если вызов завершился ошибкой, иначе 0.
  function finish(failures) {
    const ms = clock() - startedAt;
    tally.errors += failures;
    tally.pending -= 1;
    record(tally, ms);
  }

  const succeeded = (value) => {
    finish(0);
    return value;
  };

  const rejected = (reason) => {
    finish(1);
    throw reason;
  };

  // Синхронное исключение учитывается как ошибка и летит дальше синхронно тем же объектом;
  // иначе любой результат приводится к обещанию, которое учтёт исход и отдаст его как был.
  function track(call) {
    try {
      return Promise.resolve(call()).then(succeeded, rejected);
    } catch (error) {
      finish(1);
      throw error;
    }
  }

  return { track };
}

const performanceNow = () => globalThis.performance.now();

function createIpcTiming(now = performanceNow) {
  const tallies = new Map();

  function tallyFor(channel) {
    if (!tallies.has(channel)) tallies.set(channel, newTally(channel));
    return tallies.get(channel);
  }

  function wrap(invoke) {
    return (channel, ...args) => startMeasurement(tallyFor(channel), now).track(() => invoke(channel, ...args));
  }

  function stats() {
    return Array.from(tallies.values()).map((tally) => describe(tally)).sort(costliestFirst);
  }

  function reset() {
    tallies.clear();
  }

  return { wrap, stats, reset };
}

module.exports = { createIpcTiming };
