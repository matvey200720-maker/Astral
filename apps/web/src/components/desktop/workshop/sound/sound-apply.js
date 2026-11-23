// «Применить» студии звука: состояния банков, очередь установки, сессия записи, память о поставленном.
import { useMemo, useRef, useSyncExternalStore } from "react";
import { describeBank, isWeaponBank } from "@modovik/sound-studio";
import { tr } from "../../../../locales/ui.js";
import { soundCounted, soundTitle } from "./sound-copy.js";
import { BANK_STREAM, renderOptionsFor } from "./sound-targets.js";
import { capFrames } from "./sound-fit.js";
import {
  loadSoundProject,
  settingsKey,
  soundBankKey,
  splitWavParts,
  storeSoundProject,
} from "./sound-model.js";
import {
  workshopInstallStatusOf,
  subscribeWorkshopInstalls,
} from "../../../../features/workshop/install-queue/queue.js";
import {
  applyWorkshopWork,
  DEFAULT_INSTALL_STEPS,
} from "../../../../features/workshop/install-queue/index.js";

export const SOUND_INSTALL_KEY = "astral.sound-studio.install";
export const SOUND_RIGHTS_NOTICE =
  "Устанавливая звук, вы подтверждаете права на использование этой записи.";

export function soundInstallKey(archive, bank) {
  return [SOUND_INSTALL_KEY, String(archive), String(bank)].join(":");
}

// Подписи первых двух шагов считаются при каждом чтении: язык окна выбирается позже загрузки модуля.
const lazyStep = (id, label, hint) =>
  Object.freeze(
    Object.defineProperties(
      { id },
      { label: { enumerable: true, get: label }, hint: { enumerable: true, get: hint } },
    ),
  );

export const SOUND_INSTALL_STEPS = Object.freeze([
  lazyStep(
    "stage",
    () => tr("Готовим звук"),
    () => tr("Ваш файл приводится к частоте и длине звука игры"),
  ),
  lazyStep(
    "build",
    () => tr("Проверяем"),
    () => tr("Собранное сверяется с тем, что вы слышали"),
  ),
  ...DEFAULT_INSTALL_STEPS,
]);

export function soundRightsNotice() {
  return tr(SOUND_RIGHTS_NOTICE);
}

// ---------- отпечаток назначений: FNV-1a, 32 бита ----------

const FNV = Object.freeze({ offset: 0x811c9dc5, prime: 16777619, wrap: 2 ** 32 });

// reduce.call идёт по кодовым единицам UTF-16, а не по символам.
function fnv1a(text) {
  const step = (hash, unit) => Math.imul(hash ^ unit.charCodeAt(0), FNV.prime) >>> 0;
  const hash = Array.prototype.reduce.call(text, step, FNV.offset);
  return (hash + FNV.wrap).toString(16).slice(-8);
}

function lineOf(one) {
  const head = String(one.stream);
  return head + "=" + settingsKey(one);
}

export function soundSignature(assignments) {
  const digest = fnv1a(assignments.map(lineOf).sort().join("\n"));
  return `fnv1a:${digest}:${assignments.length}`;
}

// ---------- состояния банков ----------

function groupByBank(assignments) {
  const withFiles = [...assignments].filter((one) => one.assetHash && one.archive);
  const groups = new Map();
  withFiles.forEach((one) => {
    const key = soundBankKey(one.archive, one.bank);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(one);
  });
  return groups;
}

function wantedStreams(bank) {
  const hashes = bank.kind === "bank" ? [BANK_STREAM] : (bank.streams || []).map((s) => s.hash);
  return new Set(hashes);
}

function stateOf(mine, work, recorded, signature) {
  if (!mine.length) return work ? "leftover" : "";
  return work && recorded === signature ? "installed" : "pending";
}

function recordOf(bank, groups, installed, works) {
  const key = soundBankKey(bank.archive, bank.bank);
  const work = works ? (works.get(key) ?? null) : null;
  const accepted = wantedStreams(bank);
  const assignments = (groups.get(key) ?? []).filter((one) => accepted.has(one.stream));
  const signature = assignments.length ? soundSignature(assignments) : "";
  const state = stateOf(assignments, work, installed?.[key], signature);
  return [key, { key, bank, state, signature, assignments, work }];
}

export function soundBankStates({ banks = [], assignments = [], installed, works }) {
  const groups = groupByBank(assignments);
  return new Map(Array.from(banks, (bank) => recordOf(bank, groups, installed, works)));
}

export function pendingSoundBanks(states) {
  const collected = [];
  for (const record of states.values()) {
    if (record.state === "pending") collected.push(record);
  }
  return collected;
}

const REPLACED = new Set(["pending", "installed"]);

export const isReplacedState = (state) => REPLACED.has(state);

// Метки сравниваются как набор пар, порядок ключей не важен.
const flatLabels = (labels) =>
  Array.from(labels, ([key, state]) => `${key}\u0000${state}`)
    .sort()
    .join("\u0001");

const sameLabels = (left, right) => left.size === right.size && flatLabels(left) === flatLabels(right);

export function useSoundStateLabels(states) {
  const remembered = useRef(null);
  const pairs = [...states].map(([key, record]) => [key, record.state]);
  const labels = new Map(pairs.filter(([, state]) => state));
  const unchanged = remembered.current !== null && sameLabels(remembered.current, labels);
  remembered.current = unchanged ? remembered.current : labels;
  return remembered.current;
}

// ---------- надпись кнопки и очередь ----------

const bankTitle = (entry) => soundTitle(describeBank(entry.bank.bank, entry.bank.archive).title);

function idleLabel() {
  const title = tr("Сначала поставьте свой звук — в игру пока нечего ставить");
  return { label: tr("Применить"), title };
}

function countedLabel(pending) {
  const weaponsOnly = pending.every((entry) => isWeaponBank(entry.bank.archive));
  const counted = soundCounted(pending.length, weaponsOnly ? "weapon" : "replacement");
  return `${tr("Применить")} · ${counted}`;
}

export function soundApplyLabel(pending) {
  if (!pending.length) return idleLabel();
  const names = pending.map(bankTitle).join(", ");
  const title = [tr("Поставить в игру: {names}.").replace("{names}", names), soundRightsNotice()].join(" ");
  return { label: pending.length === 1 ? tr("Применить") : countedLabel(pending), title };
}

const IN_FLIGHT = new Set(["running", "queued"]);

function statusOf(entry) {
  const key = soundInstallKey(entry.bank.archive, entry.bank.bank);
  return workshopInstallStatusOf(key, entry.signature);
}

function hintFor(statuses) {
  if (statuses.includes("running-other")) {
    return tr("Прежняя версия звука ещё ставится — эта встанет сразу после неё");
  }
  if (statuses.includes("queued-other")) {
    return tr("В очереди ждёт прежняя версия звука — нажатие заменит её этой");
  }
  return "";
}

function summarize(pending, line) {
  const statuses = line.split("|").slice(0, pending.length);
  const fresh = statuses.flatMap((status, at) => (IN_FLIGHT.has(status) ? [] : [pending[at]]));
  const stuck = pending.length > 0 && fresh.length === 0;
  const busy = stuck ? (statuses.includes("running") ? "running" : "queued") : "";
  return { busy, fresh, hint: hintFor(statuses) };
}

export function useSoundApplyQueue(pending) {
  const line = useSyncExternalStore(subscribeWorkshopInstalls, () => pending.map(statusOf).join("|"));
  return useMemo(() => summarize(pending, line), [line, pending]);
}

// ---------- сессия записи ----------

// Открытая сессия главного процесса: запись частями, последовательно.
class Stager {
  constructor(host, session) {
    this.host = host;
    this.session = session;
  }

  send(head, pieces, tail = {}) {
    const total = pieces.length;
    return pieces.reduce(
      (chain, wav, part) =>
        chain.then(() => this.host.stageSoundWav({ ...head, wav, part, parts: total, ...tail })),
      Promise.resolve(),
    );
  }

  // Сбой после открытия: сессия закрывается, отказ закрытия глотается, причина остаётся первичной.
  async abort(failure) {
    await this.host.endSoundSession({ session: this.session }).catch(() => {});
    throw failure;
  }

  #sourceOf(assignments) {
    const source = assignments.find((one) => one.stream === BANK_STREAM);
    if (source) return source;
    throw new Error(tr("Файл музыки не найден — поднесите его заново."));
  }

  async wholeBank(bank, assignments, renderFor) {
    const source = this.#sourceOf(assignments);
    const rendered = await renderFor(source, bank.sampleRate, renderOptionsFor({ kind: "bank", bank }, 2));
    const channels = [["left", 0], ["right", 1]];
    for (const [channel, at] of channels) {
      const head = { session: this.session, channel, sampleRate: bank.sampleRate };
      await this.send(head, splitWavParts(rendered.wavs[at]));
    }
  }

  #trackOf(bank, assignment) {
    const track = bank.streams.find((candidate) => candidate.hash === assignment.stream);
    if (track) return track;
    throw new Error(tr("Звука, на который стоял ваш файл, в игре больше нет — обновите список."));
  }

  async #cook(renderFor, assignment, track, room) {
    const settings = { channels: 1, ...(room ? { maxFrames: room } : {}) };
    const rendered = await renderFor(assignment, track.sampleRate, settings);
    return splitWavParts(rendered.wav);
  }

  async tracks(bank, assignments, renderFor) {
    const cooked = new Map();
    for (const assignment of assignments) {
      const track = this.#trackOf(bank, assignment);
      const room = capFrames(bank.budget, track, assignments.length);
      const repeatKey = `${settingsKey(assignment)}|${track.sampleRate}|${room || 0}`;
      if (!cooked.has(repeatKey)) {
        cooked.set(repeatKey, await this.#cook(renderFor, assignment, track, room));
      }
      const head = { session: this.session, stream: assignment.stream, sampleRate: track.sampleRate };
      await this.send(head, cooked.get(repeatKey), assignment.fx?.loop ? { loopStart: 0 } : {});
    }
  }
}

export async function stageSoundSession(host, { bank, assignments }, renderFor) {
  const whole = bank.kind === "bank";
  if (whole && !(bank.sampleRate > 0)) {
    throw new Error(tr("Песня ещё не прочитана из игры — откройте её и нажмите «Применить» снова."));
  }
  const opened = await host.beginSoundSession({});
  const stager = new Stager(host, opened.session);
  const work = whole
    ? stager.wholeBank(bank, assignments, renderFor)
    : stager.tracks(bank, assignments, renderFor);
  await work.catch((failure) => stager.abort(failure));
  return stager.session;
}

export async function settledSoundBank(host, bank, gameRoot) {
  if (bank?.pending) {
    if (!host?.readSoundBank) throw new Error(tr("Песню не прочитать из игры — откройте её заново."));
    const query = { gameRoot, archive: bank.archive, bank: bank.bank };
    return Object.assign({}, bank, await host.readSoundBank(query), { pending: false });
  }
  return bank;
}

// ---------- что уехало в игру ----------

class Roster {
  #members = new Set();

  join(listener) {
    this.#members.add(listener);
    return () => this.#members.delete(listener);
  }

  get size() {
    return this.#members.size;
  }

  announce(...news) {
    Array.from(this.#members).forEach((listener) => listener(...news));
  }
}

const installRoster = new Roster();

export const subscribeSoundInstalls = (listener) => installRoster.join(listener);

export function recordSoundInstall(bankKey, signature) {
  if (!installRoster.size) {
    const project = loadSoundProject();
    const installed = { ...project.installed, [bankKey]: signature };
    storeSoundProject({ ...project, installed });
    return;
  }
  installRoster.announce(bankKey, signature);
}

// ---------- постановка в очередь ----------

const appliedText = (title) => tr("«{title}»: свой звук в игре").replace("{title}", title);

// Одна работа очереди: подготовка звука, план, применение и всегда закрытие сессии.
class InstallJob {
  constructor(target, tools) {
    this.target = target;
    this.tools = tools;
  }

  async #endQuietly(session) {
    try {
      await this.tools.host.endSoundSession({ session });
    } catch {
      // закрытие сессии не должно затмевать причину отказа
    }
  }

  async #stage(report) {
    const { host, renderFor } = this.tools;
    report({ step: "stage", note: tr("Готовим звук") });
    const gameRoot = await this.tools.resolveGameRoot();
    const settled = await settledSoundBank(host, this.target.bank, gameRoot);
    const session = await stageSoundSession(host, { ...this.target, bank: settled }, renderFor);
    return { gameRoot, session };
  }

  async #publish(report, { gameRoot, session }) {
    const { host, onPlan, onApplied } = this.tools;
    const { key, signature, bank } = this.target;
    const remember = (plan) => onPlan?.(key, plan);
    report({ step: "build", note: tr("Проверяем собранное") });
    const where = { session, gameRoot, archive: bank.archive, bank: bank.bank };
    const ready = await host.planSound(where);
    remember(ready);
    await host.applySound({ ...where, expectedManifestHash: ready.manifestHash });
    remember({ ...ready, applied: true });
    onApplied?.(key, signature);
    return ready;
  }

  run = async ({ report }) => {
    const staged = await this.#stage(report);
    try {
      return await this.#publish(report, staged);
    } finally {
      await this.#endQuietly(staged.session);
    }
  };

  spec({ title, notify, savedText }) {
    const { archive, bank } = this.target.bank;
    return Object.fromEntries([
      ["key", soundInstallKey(archive, bank)],
      ["signature", this.target.signature],
      ["title", title],
      ["editor", tr("Звуки")],
      ["coverSlotId", "sounds"],
      ["steps", SOUND_INSTALL_STEPS],
      ["notify", notify],
      ["savedText", savedText],
      ["run", this.run],
      ["doneText", () => appliedText(title)],
    ]);
  }
}

function savedTextFor(names) {
  switch (names.length > 1) {
    case true:
      return tr("Ставим в игру: {names}").replace("{names}", names.join(", "));
    default:
      return tr("«{name}» — ставим в игру").replace("{name}", names[0]);
  }
}

export function queueSoundApply({ host, targets, resolveGameRoot, renderFor, notify, onPlan, onApplied }) {
  const jobs = Array.from(targets, (target) => ({ target, title: bankTitle(target) }));
  const savedText = savedTextFor(jobs.map((job) => job.title));
  const tools = { host, resolveGameRoot, renderFor, onPlan, onApplied };
  for (const { target, title } of jobs) {
    void applyWorkshopWork(new InstallJob(target, tools).spec({ title, notify, savedText }));
  }
}
