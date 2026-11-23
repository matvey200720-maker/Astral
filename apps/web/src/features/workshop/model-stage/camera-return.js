// Общие часы перелёта камеры домой: длительность, плавная кривая, поворот угла.
import { motionEnabled } from "../../../motion-preference.js";

const TRIP = { fastest: 0.45, slowest: 1.1, skipBelow: 0.004, reachFloor: 1e-6, msPerSecond: 1000 };

// Не прячет NaN: Math.max/Math.min его пропускают дальше.
const unit = (value) => Math.min(1, Math.max(0, value));

// Ступенька: нуль на концах, 0,5 посередине; вход не зажимается.
export function smooth(share) {
  const square = share * share;
  return square * (3 - 2 * share);
}

// Кратчайшая дуга от `from` к `to`, отложенная от `from` (углы не нормируются).
const arc = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function turnTo(from, to) {
  return from + arc(from, to);
}

const secondsFor = (share) =>
  share < TRIP.skipBelow ? 0 : TRIP.fastest + (TRIP.slowest - TRIP.fastest) * share;

export const returnSeconds = (travel, reach) =>
  motionEnabled() ? secondsFor(unit(travel / Math.max(reach, TRIP.reachFloor))) : 0;

export function createReturnTrip() {
  // Пока перелёта нет, sampler === null; иначе это функция «момент -> доля пути 0…1».
  let sampler = null;
  const trip = {};
  Object.defineProperty(trip, "active", {
    get: () => sampler !== null,
    enumerable: true,
    configurable: true,
  });
  trip.begin = (seconds, now = performance.now()) => {
    const span = seconds * TRIP.msPerSecond;
    sampler = seconds > 0 ? (at) => unit((at - now) / span) : null;
    return sampler !== null;
  };
  trip.progress = (now = performance.now()) => {
    if (sampler === null) return null;
    const done = sampler(now);
    if (done >= 1) sampler = null;
    return smooth(done);
  };
  trip.cancel = () => {
    sampler = null;
  };
  return trip;
}
