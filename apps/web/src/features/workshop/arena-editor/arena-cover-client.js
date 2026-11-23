// Клиент потока обложек арены: пиксели плашек и полотен считаются в фоне.
// Нет потока или он не справился — те же функции считают здесь же, результат тот же.

import { arenaCoverPicture } from "@modovik/climb-contract/recolor/arenas";
import { panelJobPixels } from "./arena-panel-pixels.js";

// Две полосы работы: что отправить потоку и чем посчитать на месте.
const LANES = {
  cover: {
    envelope: (id, jobs) => ({ id, jobs }),
    inline: (jobs) => jobs.map((job) => arenaCoverPicture(job.look, job.picture, job.decal)),
  },
  panel: {
    envelope: (id, jobs) => ({ id, jobs, kind: "panel" }),
    inline: (jobs) => jobs.map((job) => panelJobPixels(job)),
  },
};

// channel: undefined — поток ещё не пробовали, null — недоступен, иначе сам поток.
const link = { channel: undefined, serial: 0, waiting: new Map() };

function receive(event) {
  const data = event.data;
  if (!data) return;
  const entry = link.waiting.get(data.id);
  if (!entry) return;
  link.waiting.delete(data.id);
  if (data.error) entry.reject(new Error(data.error));
  else entry.resolve(data.out);
}

// Сбой потока: все ждущие падают, а поток до перезагрузки окна больше не пробуем.
function collapse(event) {
  const failure = new Error(event.message || "arena-cover-worker");
  const stranded = [...link.waiting.values()];
  link.waiting.clear();
  link.channel = null;
  for (const entry of stranded) entry.reject(failure);
}

function openChannel() {
  if (typeof Worker !== "function") return null;
  try {
    const worker = new Worker(new URL("./arena-cover-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = receive;
    worker.onerror = collapse;
    return worker;
  } catch {
    return null;
  }
}

function ask(lane, jobs) {
  const id = (link.serial += 1);
  return new Promise((resolve, reject) => {
    link.waiting.set(id, { resolve, reject });
    try {
      link.channel.postMessage(lane.envelope(id, jobs));
    } catch (error) {
      link.waiting.delete(id);
      reject(error);
    }
  });
}

function dispatch(lane, jobs) {
  if (jobs.length === 0) return Promise.resolve([]);
  if (link.channel === undefined) link.channel = openChannel();
  if (!link.channel) return Promise.resolve(lane.inline(jobs));
  return ask(lane, jobs).catch(() => lane.inline(jobs));
}

export function arenaCoverPicturesAsync(jobs) {
  return dispatch(LANES.cover, jobs);
}

export function arenaPanelPicturesAsync(jobs) {
  return dispatch(LANES.panel, jobs);
}
