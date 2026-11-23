import { sendCloudShowcaseEvents } from "../../api.js";
import { showcaseEnabled } from "./enabled.js";

export const VIEW_WINDOW_MS = 30 * 60 * 1000;

const SEND_DELAY_MS = 4000;
const SEND_NOW_AT = 20;
const BATCH_MAX = 50;

// Состояние окна: очередь, один таймер, память показов и отправитель.
const box = { queue: [], timer: null, shown: new Map(), sender: null };

function stopTimer() {
  clearTimeout(box.timer);
  box.timer = null;
}

function armTimer() {
  box.timer ??= setTimeout(flushShowcaseEvents, SEND_DELAY_MS);
}

// Разница с undefined или NaN ложна: показ без прошлого показа принимается.
function takeView(key, now) {
  if (now - box.shown.get(key) < VIEW_WINDOW_MS) return false;
  box.shown.set(key, now);
  return true;
}

// События, пришедшие за время отправки, уходят сразу следом.
function sendRest() {
  if (box.queue.length > 0) flushShowcaseEvents();
}

export function recordShowcaseEvent(id, kind, { slot = "", now = Date.now() } = {}) {
  const accepted = showcaseEnabled() && (kind !== "view" || takeView(`${slot}:${id}`, now));
  if (!accepted) return false;
  box.queue.push({ id, kind });
  if (box.queue.length < SEND_NOW_AT) armTimer();
  else flushShowcaseEvents();
  return true;
}

export function flushShowcaseEvents() {
  stopTimer();
  if (box.queue.length === 0) return Promise.resolve();
  const batch = box.queue.splice(0, BATCH_MAX);
  let reply;
  try {
    reply = Promise.resolve((box.sender || sendCloudShowcaseEvents)(batch));
  } catch {
    reply = Promise.resolve();
  }
  // Отказ отправки глотаем: пачка пропадает, повторов нет.
  return reply.then(sendRest, sendRest);
}

export function configureShowcaseEvents({ sender } = {}) {
  box.sender = sender;
}

export function resetShowcaseEvents() {
  stopTimer();
  box.queue.length = 0;
  box.shown.clear();
}

function onVisibility() {
  if (document.visibilityState === "hidden") flushShowcaseEvents();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
