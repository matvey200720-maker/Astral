// Клиент сведения выстрела: отдельный поток, а при его отсутствии — расчёт в самом окне.
import { decodeShotWaves, shotRandom } from "./shot-render-waves.js";
import { mixShotParts } from "@modovik/sound-studio/shot-mix";

const PROTOCOL = Object.freeze({ window: 3, notLoaded: "shot-not-loaded", crash: "shot-render-worker" });

function packPart(part) {
  if (!part) return null;
  const { left, right, sampleRate, peak } = part;
  return { channels: [left, right], sampleRate, peak };
}

// Всё состояние клиента живёт в одном объекте на окно.
class ShotLink {
  #worker = null;
  #decided = false;
  #lastId = 0;
  #sentKeys = [];
  #pending = new Map();
  #lone = new Map();

  // Решение «есть ли поток» принимается один раз и не пересматривается.
  #connect() {
    if (this.#decided) return this.#worker;
    this.#decided = true;
    if (typeof Worker !== "function") return null;
    try {
      const worker = new Worker(new URL("./shot-render-worker.js", import.meta.url), { type: "module" });
      Object.assign(worker, { onmessage: this.#onAnswer, onerror: this.#onFailure });
      this.#worker = worker;
    } catch {
      this.#worker = null;
    }
    return this.#worker;
  }

  #take(id) {
    const waiter = this.#pending.get(id);
    this.#pending.delete(id);
    return waiter;
  }

  #onAnswer = (event) => {
    const reply = event.data || {};
    const waiter = this.#take(reply.id);
    if (!waiter) return;
    waiter[reply.error ? "reject" : "resolve"](reply.error ? new Error(reply.error) : reply.parts);
  };

  #onFailure = (event) => {
    const reason = event.message || PROTOCOL.crash;
    const waiters = Array.from(this.#pending.values());
    this.#pending.clear();
    this.#sentKeys = [];
    waiters.forEach((waiter) => waiter.reject(new Error(reason)));
  };

  // Дорожки уходят потоку, только если ключа нет среди трёх последних отправленных.
  #needsTracks(key) {
    const known = this.#sentKeys.includes(key);
    if (!known) this.#sentKeys = this.#sentKeys.concat([key]).slice(-PROTOCOL.window);
    return !known;
  }

  #dispatch(worker, message) {
    return new Promise((resolve, reject) => {
      this.#pending.set(message.id, { resolve, reject });
      worker.postMessage(message);
    });
  }

  async #ask(worker, key, shot, options) {
    const id = ++this.#lastId;
    const message = { id, key, shot: this.#needsTracks(key) ? shot : null, options };
    try {
      return await this.#dispatch(worker, message);
    } catch (error) {
      if (error.message !== PROTOCOL.notLoaded) throw error;
      this.#sentKeys = this.#sentKeys.filter((sent) => sent !== key);
      return this.#ask(worker, key, shot, options);
    }
  }

  #recall(key, shot) {
    if (!this.#lone.has(key)) {
      this.#lone.clear();
      this.#lone.set(key, Object.assign({ program: shot.program }, { waves: decodeShotWaves(shot.waves) }));
    }
    return this.#lone.get(key);
  }

  #mixHere(key, shot, options) {
    const { program, waves } = this.#recall(key, shot);
    const mixed = mixShotParts(program, waves, Object.assign({}, options, { random: shotRandom(options.seed) }));
    const { cadence, missing } = mixed;
    return {
      first: packPart(mixed.first),
      shots: mixed.shots.map((part) => packPart(part)),
      tail: packPart(mixed.tail),
      cadence,
      skipped: mixed.skipped.length,
      missing,
    };
  }

  request(key, shot, options) {
    const worker = this.#connect();
    if (!worker) return Promise.resolve(this.#mixHere(key, shot, options));
    return this.#ask(worker, key, shot, options);
  }
}

const link = new ShotLink();

export const renderShotParts = (key, shot, options = {}) => link.request(key, shot, options);
