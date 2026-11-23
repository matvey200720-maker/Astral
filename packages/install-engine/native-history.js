import { invalidateOperation, operationMemo } from "./operation-scope.js";

const FINGERPRINT = /^[0-9a-f]{64}$/i;

let historySource = null;
let historyGeneration = 0;

export function setNativeArchiveHistory(history = null) {
  if (history !== null && typeof history !== "function") {
    throw new TypeError("История нативных правок должна быть функцией.");
  }
  historySource = history;
  historyGeneration += 1;
  invalidateOperation();
}

const fingerprintOf = (value) =>
  typeof value === "string" && FINGERPRINT.test(value) ? value.toLowerCase() : null;

const isRecord = (value) => value !== null && typeof value === "object";

// Точки отката игры. null: поставщика нет или чтение сорвалось; [] — ответ не был списком.
async function readPoints(gameRoot) {
  const source = historySource;
  if (source === null) {
    return null;
  }
  try {
    const answer = await operationMemo(`${historyGeneration}:${gameRoot}`, () => source({ gameRoot }));
    return Array.isArray(answer) ? answer.filter(isRecord) : [];
  } catch {
    return null;
  }
}

// Все отпечатки, от которых по правкам (хотя бы одной) можно дойти до target.
function ancestorsOf(target, points) {
  const parentsByChild = new Map();
  for (const point of points) {
    const before = fingerprintOf(point.before);
    const after = fingerprintOf(point.after);
    if (before === null || after === null || before === after) {
      continue;
    }
    const parents = parentsByChild.get(after) ?? [];
    parents.push(before);
    parentsByChild.set(after, parents);
  }

  const found = new Set();
  const pending = [target];
  while (pending.length > 0) {
    for (const parent of parentsByChild.get(pending.pop()) ?? []) {
      if (!found.has(parent)) {
        found.add(parent);
        pending.push(parent);
      }
    }
  }
  return found;
}

export async function reachedByOwnNativeChanges({ gameRoot, known = [], live }) {
  const target = fingerprintOf(live);
  if (target === null) {
    return false;
  }
  const points = await readPoints(gameRoot);
  if (points === null) {
    return false;
  }
  if (!Array.isArray(known)) {
    throw new TypeError("Известные отпечатки должны быть массивом.");
  }
  const ancestors = ancestorsOf(target, points);
  return known.some((item) => ancestors.has(fingerprintOf(item)));
}

export async function rewoundEngineSteps({ gameRoot }) {
  const points = (await readPoints(gameRoot)) ?? [];
  const steps = points
    .filter((point) => point.rewound && typeof point.step === "string" && point.step !== "")
    .map((point) => point.step);
  return new Set(steps);
}

export async function ownRewindInProgress({ gameRoot }) {
  const points = (await readPoints(gameRoot)) ?? [];
  return points.some((point) => Boolean(point.rewound));
}

export async function nativeTouchedWorks({ gameRoot }) {
  const points = (await readPoints(gameRoot)) ?? [];
  return points
    .filter((point) => !point.engine && !point.rewound && Array.isArray(point.entries) && point.entries.length > 0)
    .map((point) => ({
      patch: String(point.patch || ""),
      entries: point.entries.map((entry) => String(entry)),
    }));
}

export async function nativeTouchedEntries({ gameRoot }) {
  const points = (await readPoints(gameRoot)) ?? [];
  const entries = points
    .filter((point) => !point.engine && Array.isArray(point.entries))
    .flatMap((point) => point.entries.map((entry) => String(entry)));
  return [...new Set(entries)];
}
