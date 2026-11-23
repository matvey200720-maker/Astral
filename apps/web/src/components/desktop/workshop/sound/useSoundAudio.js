// Звуковое хозяйство студии: оригиналы из игры, файлы человека, рендеры и воспроизведение.
import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkshopAsset } from "../workshop-assets.js";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import { base64ToBuffer, renderAssignment, settingsKey } from "./sound-model.js";
import { audioBufferBytes, createSoundCache, renderBytes } from "./sound-cache.js";
import {
  audioBufferFromChannels,
  decodeAudioBytes,
  playBuffer,
  stopPlayback,
} from "./WaveformPlayer.jsx";

const MIB = 1024 * 1024;
const RESULT_ORDER = [
  "playing",
  "halt",
  "loadOriginal",
  "originalOf",
  "loopOf",
  "originalFailed",
  "forgetOriginals",
  "loadAsset",
  "rememberAsset",
  "renderFor",
  "playOriginal",
  "playRender",
];

export const soundAssetKey = (hash) => `sound-studio/${hash}`;

export async function gameRootOf(host) {
  const games = await host.detectGames();
  const isLegacy = (game) => String(game.edition || "").toLowerCase() === "legacy";
  const legacy = (games || []).find(isLegacy);
  if (legacy === undefined) throw new Error(tr("Установка GTA V Legacy не найдена."));
  return legacy.path;
}

const originalKeyOf = (owner, stream) =>
  owner && stream ? [owner.archive, owner.bank, stream.hash].map(String).join(":") : "";

// Тот же объект, если флага нет: равное значение не должно перерисовывать студию.
function withoutKey(flags, key) {
  if (!flags[key]) return flags;
  return Object.fromEntries(Object.entries(flags).filter(([name]) => name !== key));
}

// Ключ рендера: настройки назначения, частота и четыре числа предела.
function renderKeyOf(assignment, rate, options) {
  const limits = [["channels", 1], ["fixedFrames", 0], ["maxSeconds", 0], ["maxFrames", 0]];
  return [settingsKey(assignment), rate, ...limits.map(([name, spare]) => options[name] || spare)].join("|");
}

// Всё хозяйство вне React: запасы с потолками, чтения в полёте, петли и токен воспроизведения.
// Перерисовку и сообщения студии desk получает готовыми обратными вызовами.
class SoundDesk {
  originals = createSoundCache({ maxBytes: 96 * MIB, maxEntries: 96 });
  assets = createSoundCache({ maxBytes: 64 * MIB });
  renders = createSoundCache({ maxBytes: 32 * MIB, maxEntries: 64 });
  reading = new Map();
  loops = new Map();
  token = "";

  constructor(signals) {
    this.signals = signals;
  }

  // ---------- воспроизведение ----------

  settle = (tag) => {
    if (this.token !== tag) return;
    this.token = "";
    this.signals.playing("");
  };

  halt = () => {
    stopPlayback();
    this.token = "";
    this.signals.playing("");
  };

  #claim(tag) {
    stopPlayback();
    this.token = tag;
    this.signals.playing(tag);
  }

  #sound(buffer, tag, { maxSeconds, onEnded }) {
    const finishing = (finish) => {
      this.settle(tag);
      onEnded?.(finish);
    };
    playBuffer(buffer, { maxSeconds, onEnded: finishing });
  }

  async playOriginal(stream, options = {}, owner) {
    const { maxSeconds = 0, onEnded, restart = false } = options;
    const tag = `orig|${stream.hash}`;
    if (!restart && this.token === tag) {
      this.halt();
      return false;
    }
    this.#claim(tag);
    const buffer = await this.loadOriginal(stream, owner);
    if (this.token !== tag) return false;
    if (!buffer) {
      this.settle(tag);
      return false;
    }
    this.#sound(buffer, tag, { maxSeconds, onEnded });
    return true;
  }

  playRender = async (tag, assignment, rate, options) => {
    if (this.token === tag) return this.halt();
    this.#claim(tag);
    let rendered;
    try {
      rendered = await this.renderFor(assignment, rate, options);
    } catch (failure) {
      this.settle(tag);
      throw failure;
    }
    const buffer = audioBufferFromChannels(rendered.channels, rendered.sampleRate);
    if (this.token === tag) playBuffer(buffer, { onEnded: () => this.settle(tag) });
    return undefined;
  };

  // ---------- оригиналы ----------

  async #askGame(host, owner, stream) {
    const gameRoot = await gameRootOf(host);
    const where = { archive: owner.archive, bank: owner.bank, stream: stream.hash };
    return host.readSoundStream(Object.assign({ gameRoot }, where));
  }

  async #readFromGame(host, owner, stream, key) {
    try {
      const reply = await this.#askGame(host, owner, stream);
      const buffer = await decodeAudioBytes(base64ToBuffer(reply.wav));
      this.loops.set(key, Number.isInteger(reply.loopPoint) ? reply.loopPoint : null);
      this.originals.set(key, buffer, audioBufferBytes(buffer));
      this.signals.recovered(key);
      return buffer;
    } catch (error) {
      const message = sanitizeDesktopErrorMessage(error) || tr("Не удалось прочитать звук из игры.");
      this.signals.failed(key, message);
      return null;
    } finally {
      this.reading.delete(key);
    }
  }

  #begin(host, owner, stream, key) {
    const job = this.#readFromGame(host, owner, stream, key);
    this.reading.set(key, job);
    return job;
  }

  async loadOriginal(stream, owner) {
    const host = desktopHost();
    const usable = Boolean(owner && stream && host?.readSoundStream);
    if (!usable) return null;
    const key = originalKeyOf(owner, stream);
    const kept = this.originals.get(key);
    if (kept !== undefined) return kept;
    return this.reading.get(key) ?? this.#begin(host, owner, stream, key);
  }

  forgetOriginals = () => {
    this.originals.clear();
    this.signals.forgotten();
  };

  // ---------- файлы человека и рендеры ----------

  #shelve(hash, buffer) {
    this.assets.set(hash, buffer, audioBufferBytes(buffer));
    return buffer;
  }

  async #fetchAsset(hash) {
    const blob = await getWorkshopAsset(soundAssetKey(hash));
    if (!blob) return null;
    return this.#shelve(hash, await decodeAudioBytes(await blob.arrayBuffer()));
  }

  loadAsset = async (hash) => (hash ? this.assets.get(hash) || this.#fetchAsset(hash) : null);

  rememberAsset = (hash, buffer) => {
    this.#shelve(hash, buffer);
  };

  #missing(name) {
    const phrase = tr("Файл «{name}» не найден — перетащите его заново.");
    return new Error(phrase.replace("{name}", name));
  }

  renderFor = async (assignment, rate, options = {}) => {
    const key = renderKeyOf(assignment, rate, options);
    const kept = this.renders.get(key);
    if (kept) return kept;
    const source = await this.loadAsset(assignment.assetHash);
    if (!source) throw this.#missing(assignment.assetName);
    const rendered = await renderAssignment(source, assignment, rate, options);
    this.renders.set(key, rendered, renderBytes(rendered));
    return rendered;
  };
}

// Связь хозяйства с состоянием React: чтение оригинала сообщается счётчиком версии.
function reactSignals({ setPlaying, setFailed, setRevision, notifier }) {
  const bump = () => setRevision((count) => count + 1);
  return {
    playing: setPlaying,
    recovered(key) {
      setFailed((flags) => withoutKey(flags, key));
      bump();
    },
    failed(key, message) {
      setFailed((flags) => Object.assign({}, flags, { [key]: true }));
      notifier.current?.(message);
    },
    forgotten() {
      setFailed({});
    },
  };
}

export function useSoundAudio({ bank, onNotice }) {
  const [playing, setPlaying] = useState("");
  const [failed, setFailed] = useState({});
  const [, setRevision] = useState(0);
  const notifier = useRef(onNotice);
  const deskRef = useRef(null);
  if (deskRef.current === null) {
    deskRef.current = new SoundDesk(reactSignals({ setPlaying, setFailed, setRevision, notifier }));
  }
  const desk = deskRef.current;

  useEffect(() => {
    notifier.current = onNotice;
  });
  useEffect(() => () => stopPlayback(), []);

  const loadOriginal = useCallback(
    function loadOriginal(stream, owner = bank) {
      return desk.loadOriginal(stream, owner);
    },
    [bank, desk],
  );
  const loopOf = useCallback(
    function loopOf(stream, owner = bank) {
      const key = originalKeyOf(owner, stream);
      return key ? desk.loops.get(key) : undefined;
    },
    [bank, desk],
  );
  const playOriginal = useCallback(
    function playOriginal(stream, options = {}) {
      return desk.playOriginal(stream, options, bank);
    },
    [bank, desk],
  );

  const parts = {
    playing,
    halt: desk.halt,
    loadOriginal,
    originalOf(stream) {
      const key = originalKeyOf(bank, stream);
      return key ? (desk.originals.peek(key) ?? null) : null;
    },
    loopOf,
    originalFailed(stream) {
      const key = originalKeyOf(bank, stream);
      return key ? Boolean(failed[key]) : false;
    },
    forgetOriginals: desk.forgetOriginals,
    loadAsset: desk.loadAsset,
    rememberAsset: desk.rememberAsset,
    renderFor: desk.renderFor,
    playOriginal,
    playRender: desk.playRender,
  };
  return Object.fromEntries(RESULT_ORDER.map((name) => [name, parts[name]]));
}
