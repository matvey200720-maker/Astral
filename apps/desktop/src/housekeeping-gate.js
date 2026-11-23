import fs from "node:fs/promises";
import path from "node:path";

const MB = 1048576;

export const GATE_DEFAULTS = Object.freeze({
  graceMs: 5 * 60 * 1000,
  idleMs: 2 * 60 * 1000,
  minIntervalMs: 3 * 60 * 60 * 1000,
  lowSpaceBytes: 20 * 1024 ** 3,
  packBacklog: 2,
  yieldToUser: true,
  mbPerSecond: 30,
  gameCheckMs: 20000,
});

// Что подставляется вместо не заданных (undefined) зависимостей; порядок чтения полей deps — порядок строк.
const DEP_FALLBACKS = [
  ["now", () => Date.now],
  ["startedAt", () => Date.now()],
  ["systemIdleMs", () => () => Infinity],
  ["attention", () => () => null],
  ["busyWork", () => () => false],
  ["gameRunning", () => async () => false],
  ["freeSpace", () => async () => Infinity],
  ["sleep", () => (ms) => new Promise((done) => setTimeout(done, ms))],
];

function option(source, key, fallback) {
  const value = source[key];
  return value === undefined ? fallback : value;
}

function wireDeps(deps) {
  const wired = {};
  for (const [key, makeFallback] of DEP_FALLBACKS) {
    const given = deps[key];
    wired[key] = given === undefined ? makeFallback() : given;
  }
  return wired;
}

const verdict = (ok, reason, extra) => ({ ok, reason, ...extra });

// Обход шагов решения: шаг — [проверка, ответ]; await только там, где проверка вернула обещание.
async function judge(prepare, steps, fallback) {
  const context = prepare();
  for (const [probe, answer] of steps) {
    let hit = probe(context);
    if (hit instanceof Promise) hit = await hit;
    if (hit) return answer(context);
  }
  return fallback(context);
}

export function createHousekeepingGate(deps = {}) {
  const { now, startedAt, systemIdleMs, attention, busyWork, gameRunning, freeSpace, sleep } = wireDeps(deps);
  const settings = Object.freeze({ ...GATE_DEFAULTS, ...deps.settings });

  const watch = { gameAt: -Infinity, gameOn: false, spaceLow: false };
  const packing = { markedAt: 0 };
  const lastBlock = {
    endedAt: 0,
    spent() {
      return now() - (this.endedAt || now());
    },
    stamp() {
      this.endedAt = now();
    },
  };

  async function refreshGame() {
    if (!(now() - watch.gameAt >= settings.gameCheckMs)) return watch.gameOn;
    watch.gameAt = now();
    watch.gameOn = Boolean(await gameRunning().catch(() => false));
    return watch.gameOn;
  }

  async function measureSpace() {
    const free = await freeSpace().catch(() => Infinity);
    watch.spaceLow = free < settings.lowSpaceBytes;
    return watch.spaceLow;
  }

  // Правила остановки по порядку; снимок внимания берётся лениво и один раз за вызов.
  const stopRules = [
    [() => busyWork(), "work"],
    [(look) => look().suspended, "sleep"],
    [() => watch.gameOn, "game"],
    [() => watch.spaceLow, ""],
    [(look) => settings.yieldToUser && !look().locked && systemIdleMs() < settings.idleMs, "user-active"],
    [(look) => look().onBattery, "battery"],
  ];

  function mustStop() {
    let snapshot;
    const look = () => (snapshot ??= attention() || {});
    for (const [applies, reason] of stopRules) {
      if (applies(look)) return reason;
    }
    return "";
  }

  const startSteps = [
    [() => busyWork(), () => verdict(false, "work")],
    [() => refreshGame(), () => verdict(false, "game")],
    [(ask) => ask.force, () => verdict(true, "forced")],
    [() => measureSpace(), () => verdict(true, "low-space")],
    [
      (ask) => {
        ask.sinceStart = now() - startedAt;
        return ask.sinceStart < settings.graceMs;
      },
      (ask) => verdict(false, "startup", { waitMs: settings.graceMs - ask.sinceStart }),
    ],
  ];
  const mayStart = (options = {}) =>
    judge(
      () => ({ force: options.force }),
      startSteps,
      () => {
        const reason = mustStop();
        return reason ? verdict(false, reason) : verdict(true, "");
      },
    );

  const packSteps = [
    [(ask) => ask.force, () => verdict(true, "forced")],
    [() => measureSpace(), () => verdict(true, "low-space")],
    [(ask) => ask.pending >= settings.packBacklog, () => verdict(true, "backlog")],
  ];
  const mayPack = (options = {}) =>
    judge(
      () => ({ force: options.force, pending: option(options, "pending", 0) }),
      packSteps,
      () => {
        const since = now() - packing.markedAt;
        if (packing.markedAt && since < settings.minIntervalMs) {
          return verdict(false, "interval", { waitMs: settings.minIntervalMs - since });
        }
        return verdict(true, "");
      },
    );

  function markPacked() {
    packing.markedAt = now();
  }

  // Потолок скорости чтения: после блока в bytes байт досыпаем до mbPerSecond.
  async function pace(bytes) {
    await refreshGame();
    const needed = (bytes / (settings.mbPerSecond * MB)) * 1000;
    const spent = lastBlock.spent();
    lastBlock.stamp();
    if (needed > spent) await sleep(needed - spent);
    lastBlock.stamp();
  }

  return Object.freeze({ mayStart, mayPack, mustStop, markPacked, pace, refreshGame, settings });
}

// Ближайший существующий предок пути (включая сам путь), от нижнего к корню.
function* ancestorsOf(start) {
  let at = start;
  for (;;) {
    yield at;
    const up = path.dirname(at);
    if (up === at) return;
    at = up;
  }
}

export async function freeSpaceOf(directory) {
  for (const candidate of ancestorsOf(path.resolve(String(directory || ".")))) {
    try {
      const info = await fs.statfs(candidate);
      return Number(info.bavail) * Number(info.bsize);
    } catch (error) {
      if (error?.code !== "ENOENT") return Infinity;
    }
  }
  return Infinity;
}
