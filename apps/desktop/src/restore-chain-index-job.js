import { buildChainIndex } from "./restore-chain-index.js";

export const CHAIN_INDEX_FLAG = "ASTRAL_CHAIN_INDEX";

const WAIT_CEILING_MS = 600000;

const textOf = (value) => (value === null || value === undefined ? "" : String(value));

export function chainIndexEnabled(env = process.env) {
  return textOf(env[CHAIN_INDEX_FLAG]).trim() === "1";
}

// Умолчания подставляются только вместо undefined: null остаётся null.
function resolveSettings(settings) {
  const fallback = {
    enabled: false,
    build: buildChainIndex,
    delayMs: 60000,
    retryMs: 120000,
    log: () => {},
    timers: { setTimeout, clearTimeout },
  };
  const resolved = { root: settings.root, gate: settings.gate, gameRoots: settings.gameRoots };
  for (const key of Object.keys(fallback)) {
    resolved[key] = settings[key] === undefined ? fallback[key] : settings[key];
  }
  return resolved;
}

const resolveRoot = (root) => (typeof root === "function" ? root() : root);

// Корни игр -> { game } для единственной игры либо { skip: причина }.
function chooseGame(candidates) {
  const games = Array.from(new Set(candidates));
  if (games.length === 1) return { game: games[0] };
  return { skip: games.length > 1 ? "several-games" : "no-game" };
}

const skippedReport = (reason) => ({ status: "skipped", reason, done: 0, total: 0, points: [] });

const floorWait = (floor, wait) => Math.max(floor, wait);
const capWait = (ms) => Math.min(ms, WAIT_CEILING_MS);

// Статус итога сборки -> пауза до следующего прохода; других статусов в таблице нет.
const FOLLOW_UP = new Map([
  ["waiting", (result, retryMs) => capWait(floorWait(retryMs, result.waitMs ?? 0))],
  ["paused", (result, retryMs) => retryMs],
]);

function pauseAfter(result, retryMs) {
  const rule = FOLLOW_UP.get(result.status);
  return rule ? { ms: rule(result, retryMs) } : null;
}

class ChainIndexJob {
  #config;
  #timer = null;
  #busy = false;
  #tick = () => this.#runOnce();

  constructor(config) {
    this.#config = config;
  }

  start() {
    this.#schedule(this.#config.delayMs);
  }

  // Идущий проход не прерывает и после себя может снова завести таймер.
  stop() {
    this.#config.timers.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(ms) {
    const { enabled, timers } = this.#config;
    if (!enabled) return;
    timers.clearTimeout(this.#timer);
    this.#timer = timers.setTimeout(this.#tick, ms);
    this.#timer?.unref?.();
  }

  async #runOnce() {
    this.#timer = null;
    if (this.#busy) return;
    this.#busy = true;
    await this.#attempt().finally(() => {
      this.#busy = false;
    });
  }

  #attempt() {
    const { log, retryMs } = this.#config;
    return this.#survey()
      .then((pause) => {
        if (pause) this.#schedule(pause.ms);
      })
      .catch((error) => {
        log(null, error);
        this.#schedule(retryMs);
      });
  }

  async #survey() {
    const { gameRoots, root, gate, build, log, retryMs } = this.#config;
    const choice = chooseGame((await gameRoots()).filter(Boolean));
    if (choice.skip) {
      log(skippedReport(choice.skip));
      return null;
    }
    const result = await build({ root: resolveRoot(root), gameRoot: choice.game, gate });
    log(result);
    return pauseAfter(result, retryMs);
  }
}

export function createChainIndexJob(settings) {
  const job = new ChainIndexJob(resolveSettings(settings));
  return Object.freeze({ start: job.start.bind(job), stop: job.stop.bind(job) });
}
