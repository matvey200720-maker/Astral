import { Worker } from "node:worker_threads";

// метка пула (как есть, любое значение) -> множество живых потоков и работ
const roster = new Map();

const membersOf = (label) => roster.get(label) ?? roster.set(label, new Set()).get(label);

// Обработчик выхода: участник сам убирается из своего пула.
const leaverFrom = (members, member) => () => members.delete(member);

// Участник записывается в пул и уходит из него, когда сообщит о завершении.
function enlist(label, member) {
  const members = membersOf(label);
  members.add(member);
  member.once?.("exit", leaverFrom(members, member));
  return member;
}

export function trackedWorker(label, url, options) {
  const args = options === undefined ? [url] : [url, options];
  return enlist(label, new Worker(...args));
}

export function trackedTask(label, task) {
  return enlist(label, task);
}

export function workerCensus() {
  const alive = Array.from(roster).filter(([, members]) => members.size > 0);
  const pools = alive.reduce((counts, [label, members]) => {
    counts[label] = members.size;
    return counts;
  }, {});
  const total = alive.reduce((sum, [, members]) => sum + members.size, 0);
  return { total, pools };
}

export function workerCensusLine() {
  const census = workerCensus();
  const headline = `${census.total} потоков`;
  const shares = Object.entries(census.pools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, size]) => `${label} ${size}`);
  return shares.length ? `${headline}: ${shares.join(", ")}` : headline;
}
