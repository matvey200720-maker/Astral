import { createInstallTrace, withInstallTrace } from "@modovik/install-engine/install-trace.js";
import { isCancellation } from "./operation-cancel.js";

/* Запись хода установки по фазам идёт во всех ветках (решение 22.11.2026: по тикету из открытого релиза должно быть видно, где
   установка тратит время). Авто-отчёт «долгая установка» — только в этой ветке: в открытом релизе 60 с на слабом ПК норма. */
export const REPORT_CHANNEL = "alpha";
export const SLOW_INSTALL_MS = 60000;

const LOG_SOURCE = "install";
const SLOW_REPORT_NAME = "InstallSlow";
const MAX_ERROR_CHARS = 200;
const UNCHANGED_STATUS = "unchanged";
// Наборы, чьи установки попадают в журнал, и название их строки.
const JOURNALED_SETS = new Map([["vegetation", "Растительность"]]);

/** Уходит ли «долгая установка» отчётом в авто-ошибки: только в альфе. Строка в локальном журнале пишется везде. */
export function installReportOn(channel) {
  return channel === REPORT_CHANNEL;
}

class JournalSettings {
  constructor({ channel, log, report, slowMs = SLOW_INSTALL_MS }) {
    // Запись включена, как только задан приёмник строк; без настройки журнала нет.
    this.enabled = typeof log === "function";
    this.reports = installReportOn(channel);
    this.sinks = { log, report };
    this.slowMs = slowMs;
  }
}

// Настройка одна на процесс; пока её не задали, журнал выключен.
let settings = new JournalSettings({});

export function configureInstallJournal(config) {
  settings = new JournalSettings(config);
}

const secondsText = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} с`;
const labelled = ([name, value]) => `${name}: ${value}`;

export function formatInstallJournal({ label, outcome, trace }) {
  const { totalMs, steps, notes } = trace;
  const headline = [label, `${outcome}, ${secondsText(totalMs)}`];
  const message = [headline, ...Object.entries(notes)].map(labelled).join("; ");
  const detail = steps.map(({ name, ms }) => `  ${labelled([name, secondsText(ms)])}`).join("\n");
  return { message, detail };
}

const failureText = (error) => String(error?.message || error).slice(0, MAX_ERROR_CHARS);

// Обещание, которое не отклоняется: итог работы ложится в объект { failed, value | error }.
// Работа стартует сразу, синхронное исключение тоже становится итогом.
const capture = (work) =>
  new Promise((resolve) => resolve(work())).then(
    (value) => ({ failed: false, value }),
    (error) => ({ failed: true, error }),
  );

function describeOutcome({ failed, value, error }) {
  if (failed) {
    /* Отмена — не ошибка (журнал 17.11.2026: «ошибка: This operation was aborted» у отменённой части сборки). */
    if (isCancellation(error)) return { level: "info", outcome: "отменено" };
    return { level: "warn", outcome: `ошибка: ${failureText(error)}` };
  }
  const unchanged = value?.status === UNCHANGED_STATUS;
  return { level: "info", outcome: unchanged ? "без изменений" : "установлено" };
}

// Строка журнала и отчёт. Любой сбой здесь поглощается: журнал не должен ломать установку.
// Приёмники и порог берутся из настройки на момент конца работы, а не её начала.
function writeEntry(label, trace, finished) {
  try {
    const { level, outcome } = describeOutcome(finished);
    const summary = trace.finish();
    const { message, detail } = formatInstallJournal({ label, outcome, trace: summary });
    const { sinks, slowMs, reports } = settings;
    const { log, report } = sinks;
    log({ level, source: LOG_SOURCE, message, detail });
    if (reports && summary.totalMs > slowMs) {
      report({ name: SLOW_REPORT_NAME, message, stack: detail });
    }
  } catch {
    // сбой записи не становится сбоем установки
  }
}

export async function journalOperation(label, run) {
  if (!settings.enabled) {
    return run();
  }

  const trace = createInstallTrace();
  const finished = await capture(() => withInstallTrace(trace, run));
  writeEntry(label, trace, finished);
  if (finished.failed) {
    throw finished.error;
  }
  return finished.value;
}

export async function journalInstall(set, run) {
  const label = JOURNALED_SETS.get(set);
  return label === undefined ? run() : journalOperation(label, run);
}
