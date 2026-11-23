import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../atomic-file.js";

export const INSTALL_STATE_DIRECTORY = "install-channel";

// Хода установки чаще, чем раз в это число миллисекунд, не пишем.
const PROGRESS_GAP_MS = 700;
const DETAIL_LIMIT = 300;

// Код клиента обновлений → [код моста установщика, можно ли повторить].
const BRIDGE = {
  NO_NETWORK: ["NETWORK_UNAVAILABLE", true],
  SERVER: ["SERVER_UNAVAILABLE", true],
  PROTOCOL: ["SERVER_UNAVAILABLE", false],
  SUPERSEDED: ["SERVER_UNAVAILABLE", true],
  AUTH: ["BETA_ACTIVATION_REVOKED", false],
  CHANNEL_DENIED: ["BETA_CHANNEL_DENIED", false],
  DISK_FULL: ["DISK_FULL", true],
  HASH_MISMATCH: ["HASH_MISMATCH", true],
  SIGNATURE_INVALID: ["SIGNATURE_INVALID", false],
  HELPER_UNAVAILABLE: ["INSTALL_FAILED", true],
  HELPER_FAILED: ["INSTALL_FAILED", true],
  NO_RELEASE: ["INSTALL_FAILED", false],
};

export function bridgeError(code) {
  const [bridge, retryable] = BRIDGE[code] ?? ["INTERNAL", false];
  return { code: bridge, retryable };
}

// Итог, уже записанный помощником, лаунчер не затирает.
const FINAL_STATES = new Set(["done", "error"]);

// Что дописать по коду выхода помощника: ключ — вердикт, значение — содержимое файла.
const SETTLEMENTS = {
  done: (code, version) => (version ? { state: "done", version } : { state: "done" }),
  error: (code) => ({
    state: "error",
    ...bridgeError("HELPER_FAILED"),
    detail: `helper exited with code ${code}`,
  }),
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const forget = () => undefined;

// Доля 0–100: только конечные числа, округление половиной вверх.
const shareField = (name, value) => (
  Number.isFinite(value) ? { [name]: clamp(Math.round(value), 0, 100) } : {}
);

const parseObject = (text) => {
  const parsed = JSON.parse(text);
  return parsed !== null && typeof parsed === "object" ? parsed : null;
};

class StateFile {
  #now;
  #fs;
  #tail = Promise.resolve();
  #lastWorking = 0;

  constructor(file, now, fsImpl) {
    this.file = file;
    this.#now = now;
    this.#fs = fsImpl;
  }

  // Записи идут одна за другой; метка времени берётся, когда очередь дошла до записи.
  // Сбой гасится: цепочка не отклоняется, а следующая запись пробует заново.
  #append(fields) {
    this.#tail = this.#tail.then(() => this.#flush(fields)).then(forget, forget);
    return this.#tail;
  }

  #flush(fields) {
    const clock = this.#now;
    const line = JSON.stringify({ ...fields, at: clock().toISOString() });
    return writeFileAtomic(this.file, `${line}\n`, { fsImpl: this.#fs });
  }

  // Истина, если вызов хода надо пропустить; принятый вызов сдвигает отсчёт.
  #throttled(force) {
    const clock = this.#now;
    const calledAt = clock().getTime();
    const tooSoon = calledAt - this.#lastWorking < PROGRESS_GAP_MS;
    if (force || !tooSoon) {
      this.#lastWorking = calledAt;
      return false;
    }
    return true;
  }

  working({ phase = "download", percent, overall, version, force = false } = {}) {
    if (this.#throttled(force)) return Promise.resolve();
    return this.#append({
      state: "working",
      phase,
      ...shareField("percent", percent),
      ...shareField("overall", overall),
      ...(version ? { version } : {}),
    });
  }

  failed(clientCode, detail = "") {
    return this.#append({
      state: "error",
      ...bridgeError(clientCode),
      ...(detail ? { detail: String(detail).slice(0, DETAIL_LIMIT) } : {}),
    });
  }

  read() {
    return this.#tail
      .then(() => this.#fs.readFile(this.file, "utf8"))
      .then(parseObject)
      .catch(() => null);
  }

  async settleFromExit(code, { version } = {}) {
    const recorded = await this.read();
    if (FINAL_STATES.has(recorded?.state)) return recorded.state;
    const verdict = code === 0 ? "done" : "error";
    await this.#append(SETTLEMENTS[verdict](code, version));
    return verdict;
  }

  settled() {
    return this.#tail;
  }
}

export function createInstallStateFile({ userData, channel, now = () => new Date(), fsImpl = fs }) {
  const state = new StateFile(path.join(userData, INSTALL_STATE_DIRECTORY, `${channel}.json`), now, fsImpl);
  return {
    file: state.file,
    working: state.working.bind(state),
    failed: state.failed.bind(state),
    read: state.read.bind(state),
    settleFromExit: state.settleFromExit.bind(state),
    settled: state.settled.bind(state),
  };
}
