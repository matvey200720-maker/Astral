// Что окно помнит об обновлениях: «Позже», «Видел», закрытые предложения веток (localStorage)
// и скрытые ходы (только в памяти до конца запуска). Ключи с v1 заведены на случай смены формата.

export const SNOOZE_MS = 43_200_000; // 12 часов

const [SNOOZE_KEY, SEEN_KEY, OFFERS_KEY] = [
  "astral.updates.snooze.v1",
  "astral.updates.seen.v1",
  "astral.branches.offers.v1",
];

// Хранилище бывает недоступно (приватное окно, очистка, тесты) и записи бывают битые:
// любой сбой молча даёт undefined, и мы просто ничего не помним
const attempt = (fn) => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};
const disk = (method, ...args) => attempt(() => window.localStorage[method](...args));
const readJson = (key) => attempt(() => JSON.parse(disk("getItem", key)));

// Скрытые до конца запуска: ходы скачивания и карточки установки веток в одной таблице.
// Ключи - текст с двоеточием, поэтому 2 и "2" дают одну запись (и редкое совпадение видов, Ск29).
let hidden = {};
const marks = (keyOf) => ({
  has: (x) => Boolean(x && hidden[keyOf(x)]),
  add: (x) => {
    if (x) hidden[keyOf(x)] = true;
  },
  del: (x) => {
    if (x) delete hidden[keyOf(x)];
  },
});
const progress = marks((c) => `${c.channel}:${c.sequence}`);
const install = marks((b) => `install:${b}`);

export const isProgressHidden = progress.has;
export const hideProgress = progress.add;
export const isInstallHidden = install.has;
export const hideInstall = install.add;
export const showInstall = install.del;
export const forgetHiddenTransfers = () => {
  hidden = {};
};

// В записи остаются только строки: числа и мусор отбрасываются при чтении
const offers = () => {
  const list = readJson(OFFERS_KEY);
  return (Array.isArray(list) ? list : []).filter((x) => typeof x === "string");
};

export function isOfferDismissed(channel) {
  return offers().includes(channel);
}

export const dismissOffer = (channel) => {
  const list = channel && offers();
  if (list && !list.includes(channel)) disk("setItem", OFFERS_KEY, JSON.stringify([...list, channel]));
};

export const seenVersion = () => disk("getItem", SEEN_KEY) ?? null;

export const markSeen = (version) => {
  if (version) disk("setItem", SEEN_KEY, String(version));
};

// «Позже» привязано к каналу и порядковому номеру: новая версия получит подсказку снова
export const isSnoozed = (candidate, now = Date.now()) => {
  const note = candidate && readJson(SNOOZE_KEY);
  if (!note || note.channel !== candidate.channel || note.sequence !== candidate.sequence) return false;
  return now < Number(note.until);
};

export const snooze = (candidate, now = Date.now(), ms = SNOOZE_MS) => {
  if (!candidate) return;
  const { channel, sequence } = candidate;
  disk("setItem", SNOOZE_KEY, JSON.stringify({ channel, sequence, until: now + ms }));
};

export const clearSnooze = () => {
  disk("removeItem", SNOOZE_KEY);
};
