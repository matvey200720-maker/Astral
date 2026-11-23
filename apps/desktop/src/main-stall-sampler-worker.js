/*
 * Поток-наблюдатель (`main-stall-sampler.js`): при замирании главного потока
 * снимает его профиль через инспектор и дописывает в журнал Astral самый
 * тяжёлый стек. Пишет сам — главный поток в этот момент стоит, а Windows
 * может закрыть окно раньше, чем он оживёт.
 */

import fs from "node:fs";
import inspector from "node:inspector";
import { parentPort, workerData } from "node:worker_threads";
import { createScrubber } from "./app-log.js";
import { heaviestStack } from "./main-stall-sampler.js";

const { shared, stallMs, sampleMs, userData, logFile } = workerData;
const flags = new Int32Array(shared, 0, 4);
const times = new Float64Array(shared, 16, 1);
const scrub = createScrubber({ extraPaths: userData ? [userData] : [] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Опрос главного потока раз в 50 мс: замирание около порога в 2 с не проскакивает между опросами. */
const POLL_MS = 50;
const seconds = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} с`;

let session = null;
const post = (method, params = {}) =>
  new Promise((resolve, reject) => session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))));

/* Профиль снимается, пока поток стоит, и не дольше: как только он ожил (отметка
   времени сдвинулась), снимать уже нечего — иначе стек был бы тем, что он делал
   после разморозки. */
async function sample() {
  if (!session) {
    session = new inspector.Session();
    session.connectToMainThread();
  }
  const beatAtStart = times[0];
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 2000 });
  await post("Profiler.start");
  const until = Date.now() + sampleMs;
  while (Date.now() < until && times[0] === beatAtStart) await sleep(POLL_MS);
  const { profile } = await post("Profiler.stop");
  await post("Profiler.disable").catch(() => {});
  return heaviestStack(profile);
}

function write(entry) {
  try {
    fs.appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {
    /* Журнал — удобство: отказ диска наблюдателя не останавливает. */
  }
}

/* `Atomics.waitAsync` цикл событий потока не держит: без таймера поток,
   дождавшись простоя, просто завершался бы — и наблюдателя больше не было.
   Таймер раз в минуту — единственная цена ожидания. */
setInterval(() => {}, 60_000);

async function waitArmed() {
  while (Atomics.load(flags, 0) === 0) {
    const waited = Atomics.waitAsync(flags, 0, 0);
    if (waited.async) await waited.value;
  }
}

let reported = false;
for (;;) {
  await waitArmed();
  await sleep(POLL_MS);
  const lag = Date.now() - times[0];
  if (Atomics.load(flags, 0) === 0 || lag < stallMs) {
    reported = false;
    continue;
  }
  if (reported) continue;
  reported = true;
  try {
    const stack = await Promise.race([sample(), sleep(sampleMs + 8000).then(() => null)]);
    /* Пока снимался профиль, поток мог ожить: тогда «стоит» — сколько стоял
       к началу замера, а не 0 с (в журнале 19.10 было «стоит 0,0 с»). */
    const now = Math.max(lag, Date.now() - times[0]);
    if (!stack) {
      write({ level: "warn", source: "main", message: `Главный поток стоит ${seconds(now)}; профиль снять не удалось (поток в машинном коде)` });
      parentPort?.postMessage({ type: "stall", ms: now, failed: true });
      continue;
    }
    write({
      level: "warn",
      source: "main",
      message: scrub(`Главный поток стоит ${seconds(now)}; занят: ${stack.top} (${Math.round(stack.share * 100)}% замера)`, 300),
      detail: scrub(stack.text, 2000),
    });
    parentPort?.postMessage({ type: "stall", ms: now, top: scrub(stack.top, 200), text: scrub(stack.text, 2000), share: stack.share });
  } catch (error) {
    write({ level: "warn", source: "main", message: `Главный поток стоит ${seconds(lag)}; профиль не снят: ${String(error?.message || error).slice(0, 160)}` });
    parentPort?.postMessage({ type: "stall", ms: lag, failed: true });
  }
}
