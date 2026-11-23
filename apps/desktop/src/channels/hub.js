import { BRANCHES, BRANCH_META, isBranch } from "./branches.js";

const VERSION_LIMIT = 64;

// Порядок важен: ранг 0 — неизвестна, 1 — открыта аккаунту, 2 — доступ снят.
const ACCESS_BY_RANK = ["unknown", "ok", "denied"];

// Ключи объекта хаба — в этом порядке.
const PUBLIC_METHODS = [
  "getState",
  "emit",
  "refreshInstalls",
  "setKnown",
  "setDenied",
  "setBusy",
  "setDataMode",
  "switchChanged",
  "installedChannels",
  "knownChannels",
];

// Запись ответа сервера годится, если проходит все правила по порядку.
const OFFER_RULES = [
  (entry) => entry,
  (entry) => isBranch(entry.channel),
  (entry) => typeof entry.version === "string",
  (entry) => entry.version.length > 0,
  (entry) => entry.version.length <= VERSION_LIMIT,
];

// Таблица обычная: для имён из прототипа product не определён — так и должно быть.
const productOf = (channel) => (BRANCH_META[channel] ?? BRANCH_META.beta).product;

const sameChannel = (channel) => (item) => item.channel === channel;

// Копия выбранных полей; поля без значения остаются ключами со значением undefined.
const subset = (source, ...keys) => (source ? Object.fromEntries(keys.map((key) => [key, source[key]])) : null);

const tidyOffers = (list) =>
  Array.isArray(list)
    ? list
      .filter((entry) => OFFER_RULES.every((rule) => rule(entry)))
      .map((entry) => subset(entry, "channel", "version"))
    : [];

function branchView(channel, { installs, offers, lost, busy, ownChannel }) {
  const disk = installs.find(sameChannel(channel));
  const offer = offers.find(sameChannel(channel));
  const rank = lost.has(channel) ? 2 : Number(Boolean(offer));
  return {
    channel,
    name: productOf(channel),
    installed: subset(disk, "version", "build"),
    current: channel === ownChannel,
    available: subset(offer, "version"),
    access: ACCESS_BY_RANK[rank],
    busy: busy[channel] ?? null,
  };
}

class ChannelsHub {
  #enabled;
  #ownChannel;
  #readInstalls;
  #askSwitcher;
  #send;
  #installs;
  #offers = [];
  #offersAt = null;
  #lostScreen = null;
  #dataMode = null;
  #lost = new Set();
  #busy = Object.create(null);

  constructor({ enabled, ownChannel, readInstalls, askSwitcher, send }) {
    this.#enabled = enabled;
    this.#ownChannel = ownChannel;
    this.#readInstalls = readInstalls;
    this.#askSwitcher = askSwitcher;
    this.#send = send;
    this.#installs = enabled ? readInstalls() : [];
  }

  getState() {
    const view = {
      installs: this.#installs,
      offers: this.#offers,
      lost: this.#lost,
      busy: this.#busy,
      ownChannel: this.#ownChannel,
    };
    return {
      enabled: this.#enabled,
      ownChannel: this.#ownChannel,
      ownName: this.#ownChannel ? productOf(this.#ownChannel) : null,
      branches: this.#enabled ? BRANCHES.map((channel) => branchView(channel, view)) : [],
      knownAt: this.#offersAt,
      denied: this.#lostScreen,
      switchRequest: this.#askSwitcher() ?? null,
      dataMode: this.#dataMode,
    };
  }

  emit() {
    const snapshot = this.getState();
    this.#send(snapshot);
    return snapshot;
  }

  // Применить изменение и разослать новый снимок; сбой изменения рассылку отменяет.
  #commit(change) {
    change();
    return this.emit();
  }

  // Для неизвестной ветки — только снимок, без изменения и рассылки.
  #whenBranch(channel, change) {
    return isBranch(channel) ? this.#commit(change) : this.getState();
  }

  #takeOffers(list) {
    this.#offers = tidyOffers(list);
    this.#offersAt = new Date().toISOString();
  }

  // Куда можно уйти вместо отобранной ветки: установленные впереди, остальные в прежнем порядке.
  #alternativesFor(lostChannel) {
    const candidates = this.#offers.filter(({ channel }) => channel !== lostChannel && !this.#lost.has(channel));
    const installs = this.#installs;
    const onDisk = new Set(
      candidates.map(({ channel }) => channel).filter((channel) => installs.some(sameChannel(channel))),
    );
    return candidates
      .map(({ channel, version }) => ({ channel, name: productOf(channel), version, installed: onDisk.has(channel) }))
      .sort((left, right) => Number(right.installed) - Number(left.installed));
  }

  refreshInstalls() {
    return this.#commit(() => {
      if (this.#enabled) this.#installs = this.#readInstalls();
    });
  }

  setKnown(list) {
    return this.#commit(() => {
      this.#takeOffers(list);
      const back = new Set(this.#offers.map(({ channel }) => channel));
      this.#lost = new Set([...this.#lost].filter((channel) => !back.has(channel)));
      if (this.#lostScreen && back.has(this.#lostScreen.channel)) this.#lostScreen = null;
    });
  }

  setDenied({ channel, channels = null }) {
    return this.#whenBranch(channel, () => {
      this.#lost.add(channel);
      if (Array.isArray(channels)) this.#takeOffers(channels);
      const alternatives = this.#alternativesFor(channel);
      if (channel === this.#ownChannel) this.#lostScreen = { channel, name: productOf(channel), alternatives };
    });
  }

  setBusy(channel, state) {
    return this.#whenBranch(channel, () => {
      this.#busy[channel] = state || null;
    });
  }

  setDataMode(next) {
    return this.#commit(() => {
      this.#dataMode = next ?? null;
    });
  }

  switchChanged() {
    return this.emit();
  }

  installedChannels() {
    return this.#installs.map((item) => item.channel);
  }

  knownChannels() {
    return this.#offers.map((offer) => subset(offer, "channel", "version"));
  }
}

export function createChannelsHub({ enabled, ownChannel, discover, switcher = null, broadcast = () => {} }) {
  // Внешние вызовы идут через замыкания: тексты платформенных ошибок называют параметры по именам.
  const hub = new ChannelsHub({
    enabled,
    ownChannel,
    readInstalls: () => discover(),
    askSwitcher: () => switcher?.pending(),
    send: (state) => broadcast(state),
  });
  return Object.fromEntries(PUBLIC_METHODS.map((name) => [name, hub[name].bind(hub)]));
}
