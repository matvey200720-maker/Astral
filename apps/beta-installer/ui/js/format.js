// Форматирование чисел и подписей окна установщика. Слов здесь нет: единицы
// приходят функцией перевода `t`, язык чисел — строкой `locale`.

const STEP = 1024;
const DASH = "\u2014";

const BRANCHES = Object.freeze("release beta alpha".split(" "));

// Имена веток — имена собственные (CHANNELS.md §1), на языки не делятся.
// Таблица умышленно обычный объект: прототипные имена в ней «находятся».
const PRODUCT_NAMES = Object.fromEntries(
  [["release", ""], ["beta", " Beta"], ["alpha", " Alpha"]].map(([channel, tail]) => [channel, `Astral${tail}`]),
);

// Строки шкалы размера: ключ единицы, делитель, число знаков после запятой по значению
// (null — байты, их округляем сами, без языка).
const SCALES = [
  ["unit.b", 1, null],
  ["unit.kb", STEP, () => 0],
  ["unit.mb", STEP ** 2, (value) => (value < 100 ? 1 : 0)],
  ["unit.gb", STEP ** 3, () => 1],
];

const labelled = (number, unitKey, t) => `${number} ${t(unitKey)}`;
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const lower = (text = "") => text.toLowerCase();

const isBranch = (channel) => BRANCHES.indexOf(channel) >= 0;

const productName = (channel) => {
  const key = String(channel ?? "");
  return PRODUCT_NAMES[key] ?? (key === "" ? "Astral" : `Astral ${capitalize(key)}`);
};

const percentOf = (received, total) => {
  if (![received, total].every(Number.isFinite) || total <= 0) return 0;
  // Сначала умножение, потом деление: 29 из 100 дают 29 (поправка 07.11.2026).
  const whole = Math.floor((received * 100) / total);
  return Math.max(0, Math.min(100, whole));
};

// Единица — первая, где округлённое число ещё меньше 1024: «1 МБ», а не «1 024 КБ».
const formatBytes = (bytes, { t, locale = "en" }) => {
  const usable = typeof bytes === "number" && bytes >= 0 && bytes < Infinity;
  if (!usable) return DASH;

  const [unitKey, size, digitsOf] = SCALES.find(
    ([, divisor], at) => at === SCALES.length - 1 || Math.round(bytes / divisor) < STEP,
  );
  const value = bytes / size;
  const shown =
    digitsOf === null
      ? Math.round(value)
      : value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digitsOf(value) });
  return labelled(shown, unitKey, t);
};

const formatSpeed = (bytesPerSec, { t, locale = "en" }) =>
  Number.isFinite(bytesPerSec) && bytesPerSec > 0 ? formatBytes(bytesPerSec, { t, locale }) + t("unit.perSecond") : "";

const formatDuration = (seconds, { t }) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.max(1, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = total % 60;
  if (hours >= 1) return [labelled(hours, "unit.h", t), labelled(minutes, "unit.min", t)].join(" ");
  if (minutes === 0) return labelled(rest, "unit.s", t);
  const minutesPart = labelled(minutes, "unit.min", t);
  return rest > 0 && minutes < 10 ? `${minutesPart} ${labelled(rest, "unit.s", t)}` : minutesPart;
};

const formatClock = (seconds) => {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  return `${Math.trunc(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// Домашнюю часть пути прячем: строка читается целиком и не светит имя пользователя.
const APPDATA_ALIASES = { local: "%LOCALAPPDATA%", roaming: "%APPDATA%" };

const shortenPath = (path) => {
  const text = String(path ?? "");
  const [drive, users, owner, appdata, area, ...tail] = text.split("\\");
  const home =
    /^[a-z]:$/i.test(drive) &&
    lower(users) === "users" &&
    owner &&
    lower(appdata) === "appdata" &&
    Object.hasOwn(APPDATA_ALIASES, lower(area));
  return home ? [APPDATA_ALIASES[lower(area)], ...tail].join("\\") : text;
};

// Ровно восемь латинских знаков и цифр складываем в «XXXX-XXXX», иначе строка как есть.
const formatUserCode = (code) => {
  const given = String(code ?? "");
  const chars = given.match(/[A-Za-z0-9]/g) ?? [];
  return chars.length === 8 ? [...chars.slice(0, 4), "-", ...chars.slice(4)].join("").toUpperCase() : given;
};

// Ключи текстов предупреждений экрана итога по кодам от хоста; остальные коды
// (shortcuts, registry, uninstaller…) отдельного текста не имеют и пропускаются.
const DONE_WARNINGS = new Map([
  ["access_revoked", "done.warning.revoked"],
  ["access_expired", "done.warning.expired"],
  ["report", "done.warning.report"],
]);

// Ключи идут в порядке первого появления кода, повторы схлопываются; не массив — пусто.
const doneWarningKeys = (codes) =>
  Array.isArray(codes) ? [...new Set(codes.map((code) => DONE_WARNINGS.get(code)).filter(Boolean))] : [];

export {
  BRANCHES,
  doneWarningKeys,
  formatBytes,
  formatClock,
  formatDuration,
  formatSpeed,
  formatUserCode,
  isBranch,
  percentOf,
  productName,
  shortenPath,
};
