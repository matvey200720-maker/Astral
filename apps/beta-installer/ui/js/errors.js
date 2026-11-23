// Что окну делать с ошибкой хоста (BRIDGE.md §5): у поля или страницей, какая
// кнопка главная, нужен ли журнал. Слов здесь нет — только ключи словаря
// ./i18n/index.js: `field.<КОД>`, `error.<КОД>.title`, `error.<КОД>.text`.

const words = (text) => text.split(" ");

const FIELD_CODES = Object.freeze(
  words(
    "CODE_FORMAT BETA_CODE_INVALID BETA_CODE_USED BETA_CODE_EXPIRED BETA_CODE_REVOKED BETA_NOT_REGISTERED " +
      "RATE_LIMITED BETA_UNAVAILABLE SERVER_UNAVAILABLE NETWORK_UNAVAILABLE UNSUPPORTED_OS INTERNAL",
  ),
);

const SCREEN_CODES = Object.freeze(
  words(
    "BETA_ACTIVATION_DENIED BETA_ACTIVATION_REVOKED DPOP_INVALID BETA_TICKET_INVALID BETA_CHANNEL_DENIED " +
      "BETA_UNAVAILABLE SERVER_UNAVAILABLE NETWORK_UNAVAILABLE RATE_LIMITED DISK_FULL ACCESS_DENIED FOLDER_BUSY " +
      "APP_RUNNING HASH_MISMATCH SIGNATURE_INVALID INSTALL_FAILED DAILY_LIMIT UNSUPPORTED_OS INTERNAL",
  ),
);

const KNOWN_CODES = new Set([...FIELD_CODES, ...SCREEN_CODES]);
// Прежняя попытка не продолжится: код вводят заново.
const START_OVER = new Set(words("BETA_ACTIVATION_DENIED BETA_ACTIVATION_REVOKED DPOP_INVALID BETA_TICKET_INVALID"));
// Повторять нечего: закрыть и написать команде.
const NOTHING_TO_RETRY = new Set(words("UNSUPPORTED_OS SIGNATURE_INVALID INTERNAL ACCESS_DENIED"));
// К этим кодам (и к незнакомым, они становятся INTERNAL) прикладывается «Открыть журнал».
const WITH_LOG = new Set(words("INSTALL_FAILED FOLDER_BUSY SIGNATURE_INVALID ACCESS_DENIED HASH_MISMATCH INTERNAL"));
const RETRY_STAGES = new Set(words("download install uninstall"));

// Первое подходящее правило решает; порядок важен (side побеждает всё,
// openSite и pickFolder — даже poll).
const PRIMARY_RULES = [
  [({ stage }) => stage === "side", "close"],
  [({ code }) => code === "BETA_NOT_REGISTERED", "openSite"],
  [({ code }) => code === "FOLDER_BUSY", "pickFolder"],
  [({ code, stage }) => START_OVER.has(code) || stage === "poll", "restart"],
  [({ code }) => NOTHING_TO_RETRY.has(code), "close"],
  [({ retryable, stage }) => retryable && RETRY_STAGES.has(stage), "retry"],
  [({ retryable }) => !retryable, "close"],
  [() => true, "restart"],
];

const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const textOrEmpty = (value) => (typeof value === "string" ? value : "");

// Код приводим к верхнему регистру без обрезки пробелов; чужой — INTERNAL.
const readCode = (error) => {
  const raw = error?.code;
  const name = raw ? String(raw).toUpperCase() : "";
  return KNOWN_CODES.has(name) ? name : "INTERNAL";
};

const presentError = (error, stage = "submit") => {
  const code = readCode(error);
  const retryable = Boolean(error?.retryable);
  const [, primary] = PRIMARY_RULES.find(([applies]) => applies({ code, stage, retryable }));
  const { retryAfterSec, detail } = error ?? {};

  return {
    code,
    field: stage === "submit" && FIELD_CODES.includes(code),
    primary,
    retryable,
    logs: stage === "side" || WITH_LOG.has(code),
    retryAfterSec: finiteOrNull(retryAfterSec),
    detail: textOrEmpty(detail),
    stage,
  };
};

const errorKeys = (presented) => {
  if (presented.field) return { text: `field.${presented.code}` };
  const base = `error.${presented.code}`;
  return { title: `${base}.title`, text: `${base}.text` };
};

export { FIELD_CODES, SCREEN_CODES, errorKeys, presentError };
