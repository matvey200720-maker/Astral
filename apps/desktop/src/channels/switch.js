import { randomUUID } from "node:crypto";
import { BRANCH_META, isBranch } from "./branches.js";

export const ASK_TTL_MS = 120_000;
export const PENDING_TTL_MS = 60_000;

// Ключи объекта переключателя — в этом порядке.
const PUBLIC_METHODS = ["request", "answer", "pending", "cancelPending", "runPendingOnExit", "hasPending"];

// Таблица обычная: для имён из прототипа product не определён — так и должно быть.
const productOf = (channel) => (BRANCH_META[channel] ?? BRANCH_META.beta).product;

const sameChannel = (channel) => (entry) => entry.channel === channel;

const refusal = (reason) => ({ started: false, reason });

// Просрочка — строго больше срока; NaN и отрицательная разница просрочкой не считаются.
const isStale = (job, clock) => clock() - job.at > PENDING_TTL_MS;

class Switcher {
  #ownChannel;
  #ports;
  #asking = null; // открытый вопрос: { id, from, to, finish }
  #timer = null; // таймер срока открытого вопроса
  #handoff = null; // согласие, ждущее выхода процесса: { at, channel, executablePath }

  constructor(ownChannel, ports) {
    this.#ownChannel = ownChannel;
    this.#ports = ports;
  }

  // Правила отказа по порядку; побеждает первое сработавшее. Возвращает { reason } или { install }.
  #screen(channel, claimedPath) {
    const ports = this.#ports;
    let install;
    const rules = [
      { reason: "unknown-branch", hit: () => !isBranch(channel) },
      { reason: "same-branch", hit: () => channel === this.#ownChannel },
      { reason: "not-installed", noted: true, hit: () => !(install = ports.installs().find(sameChannel(channel))) },
      {
        reason: "path-mismatch",
        noted: true,
        hit: () => Boolean(claimedPath) && claimedPath !== install.executablePath,
      },
      { reason: "updating", hit: () => ports.busy(channel) },
      { reason: "already-asking", hit: () => this.#asking?.to === channel },
    ];
    const rule = rules.find((candidate) => candidate.hit());
    if (!rule) return { install };
    if (rule.noted) ports.note("warn", `переключение на ${channel} отклонено: ${rule.reason}`);
    return { reason: rule.reason };
  }

  // Стереть вопрос, погасить таймер, сообщить окну и только потом завершить ожидание.
  #settle(entry, verdict) {
    this.#asking = null;
    clearTimeout(this.#timer);
    this.#ports.changed();
    entry.finish(Boolean(verdict));
  }

  #expire(entry) {
    if (this.#asking === entry) this.#settle(entry, false);
  }

  // Ответ самой функции ask: undefined — ждём окно или таймер, иное значение читается по истинности.
  async #relay(entry, reply) {
    let value;
    try {
      value = await reply;
    } catch {
      value = false;
    }
    if (value !== undefined && this.#asking === entry) this.#settle(entry, value);
  }

  // Всё до вызова ask выполняется синхронно; возвращает обещание решения (true/false).
  #askWindow(channel) {
    const ports = this.#ports;
    const entry = { id: randomUUID(), from: this.#ownChannel, to: channel, finish: null };
    const decision = new Promise((resolve) => {
      entry.finish = resolve;
    });
    this.#asking = entry;
    this.#timer = setTimeout(() => this.#expire(entry), ASK_TTL_MS);
    this.#timer.unref?.();
    ports.changed();
    const reply = ports.ask({ id: entry.id, from: entry.from, to: entry.to });
    this.#relay(entry, reply);
    return decision;
  }

  #agree(channel, install) {
    const ports = this.#ports;
    this.#handoff = { at: ports.clock(), channel, executablePath: install.executablePath };
    const [fromName, toName] = [this.#ownChannel, channel].map((name) => productOf(name));
    ports.note("info", `переключение: закрываем ${fromName}, следом откроется ${toName}`);
    ports.quit();
    return { started: true };
  }

  #takeHandoff() {
    const job = this.#handoff;
    this.#handoff = null;
    return job;
  }

  #launch(job) {
    try {
      this.#ports.unlock();
    } catch {
      // замок мог быть уже отпущен или его нет — запуск это не отменяет
    }
    this.#ports.spawn(job.executablePath);
  }

  async request({ channel, executablePath = "", confirm = true } = {}) {
    const { reason, install } = this.#screen(channel, executablePath);
    if (reason) return refusal(reason);

    if (this.#asking) this.#settle(this.#asking, false);
    if (confirm && !(await this.#askWindow(channel))) return refusal("declined");
    return this.#agree(channel, install);
  }

  answer(id, accepted) {
    const entry = this.#asking;
    if (entry && entry.id === id) this.#settle(entry, accepted);
  }

  pending() {
    const entry = this.#asking;
    if (!entry) return null;
    return {
      id: entry.id,
      from: entry.from,
      to: entry.to,
      fromName: productOf(entry.from),
      toName: productOf(entry.to),
    };
  }

  cancelPending() {
    if (this.#handoff === null) return;
    this.#ports.note("info", "переключение отменено: закрытие не состоялось");
    this.#handoff = null;
  }

  runPendingOnExit() {
    const job = this.#takeHandoff();
    if (!job) return false;
    if (isStale(job, this.#ports.clock)) {
      this.#ports.note("warn", "переключение устарело: закрытие шло слишком долго, ветку не запускаем");
      return false;
    }
    this.#launch(job);
    return true;
  }

  hasPending() {
    return this.#handoff !== null;
  }
}

export function createBranchSwitcher({
  ownChannel,
  discover,
  ask,
  quit,
  spawnDetached,
  releaseLock = () => {},
  isBusy = () => false,
  onChange = () => {},
  log = () => {},
  now = Date.now,
}) {
  // Внешние вызовы идут через замыкания: тексты платформенных ошибок называют параметры по именам.
  const switcher = new Switcher(ownChannel, {
    installs: () => discover(),
    ask: (question) => ask(question),
    quit: () => quit(),
    spawn: (file) => spawnDetached(file),
    unlock: () => releaseLock(),
    busy: (channel) => isBusy(channel),
    changed: () => onChange(),
    note: (level, message) => log(level, message),
    clock: () => now(),
  });
  return Object.fromEntries(PUBLIC_METHODS.map((name) => [name, switcher[name].bind(switcher)]));
}
