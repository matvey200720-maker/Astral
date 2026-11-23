// Цели замены звука: слой ствола, одна дорожка или банк целиком.
import { describeBank, isWeaponBank, weaponLayers } from "@modovik/sound-studio";
import { SOUND_LIMITS, soundBankKey } from "./sound-model.js";
import { tr } from "../../../../locales/ui.js";
import { capFrames } from "./sound-fit.js";

export const BANK_STREAM = "0X00000000";

const TRACK_WORD = "Дорожка";

export const trackTitle = (index) => TRACK_WORD + " " + (index + 1);

// Выбирает перечисленные поля в заданном порядке.
const fields = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));

const TIMING = ["sampleRate", "seconds"];

// Порядок ключей цели один для всех трёх видов: голова, видовая часть, итог проверки.
function build({ head, view, locked, reason }) {
  return { ...head, ...view, replaceable: !locked, reason: locked ? reason : "" };
}

export function layerTarget(bank, layer) {
  const id = layer.id;
  const blocker = layer.streams.find((stream) => stream.replaceable === false);
  return build({
    head: { key: "layer:" + id, kind: "layer", id, role: layer.role },
    view: {
      ...fields(layer, ["title", "hint"]),
      bank,
      streams: layer.streams,
      ...fields(layer, TIMING),
    },
    locked: Boolean(blocker),
    reason: blocker?.reason || tr("Этот звук заменить нельзя."),
  });
}

export function streamTarget(bank, stream, index) {
  const hash = stream.hash;
  return build({
    head: { key: "stream:" + hash, kind: "stream", id: hash },
    view: { title: trackTitle(index), hint: "", bank, streams: [stream], ...fields(stream, TIMING) },
    locked: stream.replaceable === false,
    reason: stream.reason || tr("Эту дорожку заменить нельзя."),
  });
}

export function bankTarget(bank, title) {
  const open = !bank.pending && !bank.readOnly;
  const whole = {
    hash: BANK_STREAM,
    ...fields(bank, ["seconds", "sampleRate"]),
    replaceable: open,
    reason: bank.reason,
  };
  return build({
    head: { key: "bank", kind: "bank", id: BANK_STREAM },
    view: { title, hint: "", bank, streams: [whole], ...fields(bank, TIMING) },
    locked: !open,
    reason: bank.reason || "",
  });
}

const wholeBankOptions = (target, channels) => {
  const { fixedLength, samples } = target.bank;
  return {
    channels,
    maxSeconds: SOUND_LIMITS.bankTrackSeconds,
    fixedFrames: fixedLength ? samples : null,
  };
};

const shelfOptions = (target) => {
  const streams = target?.streams;
  const room = capFrames(target?.bank?.budget, streams?.[0], streams?.length || 1);
  return room ? { channels: 1, maxFrames: room } : { channels: 1 };
};

export function renderOptionsFor(target, channels = 1) {
  return target?.kind === "bank" ? wholeBankOptions(target, channels) : shelfOptions(target);
}

export function targetMaxSeconds(target) {
  const byKind = new Map([["bank", SOUND_LIMITS.bankTrackSeconds]]);
  return byKind.get(target?.kind) ?? SOUND_LIMITS.trackSeconds;
}

export function targetBankKey(target) {
  const owner = target?.bank ?? {};
  return soundBankKey(owner.archive, owner.bank);
}

// Поиск назначений со своим файлом по дорожкам цели.
class FileLookup {
  constructor(target, assignmentOf) {
    this.target = target;
    this.assignmentOf = assignmentOf;
  }

  #found(stream) {
    const { assignmentOf, target } = this;
    const candidate = assignmentOf(target.bank, stream.hash);
    return candidate?.assetHash ? candidate : null;
  }

  // Первое найденное; следующие дорожки не опрашиваются.
  first() {
    for (const stream of this.target.streams) {
      const hit = this.#found(stream);
      if (hit) return hit;
    }
    return null;
  }

  count() {
    let total = 0;
    this.target.streams.forEach((stream) => {
      if (this.#found(stream)) total += 1;
    });
    return total;
  }
}

export const targetAssignment = (target, assignmentOf) =>
  target ? new FileLookup(target, assignmentOf).first() : null;

export const assignedVariants = (target, assignmentOf) =>
  target ? new FileLookup(target, assignmentOf).count() : 0;

function wholeBankDefault(bank) {
  const title = describeBank(bank.bank, bank.archive).title;
  const whole = bankTarget(bank, title);
  return whole.replaceable ? whole : null;
}

// Выстрел, если его можно заменять, иначе первый открытый слой оружейного банка.
function weaponDefault(bank) {
  if (!isWeaponBank(bank.archive)) return null;
  const open = Array.from(weaponLayers(bank.streams || []), (layer) => layerTarget(bank, layer)).filter(
    (candidate) => candidate.replaceable,
  );
  const fire = open.filter((candidate) => candidate.role === "fire");
  return [...fire, ...open][0] ?? null;
}

export function defaultTargetOf(bank) {
  if (!bank || bank.readOnly || bank.pending) return null;
  const choose = bank.kind === "bank" ? wholeBankDefault : weaponDefault;
  return choose(bank);
}
