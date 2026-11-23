import {
  generateWearMask as bakeWear,
  generatePattern as bakePattern,
} from "./gun-patterns-core.js";

// Обычный объект (прототип Object.prototype): имена вроде toString берутся из него, как раньше.
const jobTable = Object.fromEntries([
  ["pattern", bakePattern],
  ["wear", bakeWear],
]);

const jobFor = (type) => jobTable[type] || bakePattern;

// Аргументы postMessage для задания: сообщение и список передачи.
function compose(job) {
  const pixels = jobFor(job.type)(job.params, job.width, job.height);
  return [{ id: job.id, width: job.width, height: job.height, pixels }, [pixels.buffer]];
}

self.onmessage = (event) => {
  const job = event.data || {};
  try {
    self.postMessage(...compose(job));
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error?.message || error) });
  }
};
