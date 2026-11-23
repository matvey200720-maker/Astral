// apps/desktop/src/startup-guards.js
// Клей: выбор видеокарты до готовности приложения, защита запуска (сторож главного
// потока, наблюдатель замираний, монитор ресурсов, падения служебных процессов,
// долгие нативные вызовы) и защита главного окна (перезапуск страницы, окно сдачи).

import { attachSlowCallReport } from "@modovik/native-rs";
import { appLog } from "./app-log.js";
import { installApplicationMenu } from "./application-menu.js";
import { GPU_POWERFUL, storedGpuPreference } from "./app-presence.js";
import { createStallSampler } from "./main-stall-sampler.js";
import { mainWatchdog } from "./main-watchdog.js";
import { createResourceMonitor } from "./resource-monitor.js";
import { onHibernate } from "./hibernation-hooks.js";
import { watchChildProcesses, watchWindowHealth } from "./window-health.js";

// Текущий монитор ресурсов: одно состояние на процесс — каждый вызов
// guardStartup перезаписывает его (отчёты до него идут без строки о ресурсах).
let resourceMonitor = null;

const MIB = 1048576;
const STACK_WAIT_MS = 4000;
const STARTUP_HOLD_MS = 30000;
const SLOW_CALL_THRESHOLD_MS = 500;

const oneDecimal = (n) => n.toFixed(1).replace(".", ",");
const listChannels = (channels) => (channels && channels.length ? channels.join(", ") : "фоновые задачи");

export const applyGpuPreference = (app) => {
  const economy = storedGpuPreference(app.getPath("userData")) === "economy";
  if (economy) return "economy";
  app.commandLine.appendSwitch("force_high_performance_gpu");
  return GPU_POWERFUL;
};

export const stackHang = (stall) => ({ ...stall, type: "stack" });

// Тексты окна «несколько падений подряд» — данные, перенесены дословно из описания;
// неразрывные пробелы во французском тексте стоят после « и перед » (как в таблице описания).
const WINDOW_GIVE_UP_WORDS = {
  ru: [
    "Окно Astral несколько раз упало подряд",
    "Начатая установка доходит до конца. Закройте Astral и откройте снова. Если окно снова падает — закройте тяжёлые программы, обновите драйвер видеокарты, а журнал (Настройки → Логи → «Скачать для тикета») приложите к тикету в поддержку Astral.",
  ],
  uk: [
    "Вікно Astral кілька разів поспіль впало",
    "Розпочате встановлення доходить до кінця. Закрийте Astral і відкрийте знову. Якщо вікно знову падає — закрийте важкі програми, оновіть драйвер відеокарти, а журнал (Налаштування → Логи → «Завантажити для тікета») додайте до тікета в підтримку Astral.",
  ],
  en: [
    "The Astral window crashed several times in a row",
    "An install that was already running finishes. Close Astral and open it again. If the window keeps crashing, close heavy programs, update your graphics driver and attach the log (Settings → Logs → “Download for a ticket”) to a ticket for Astral support.",
  ],
  de: [
    "Das Astral-Fenster ist mehrmals hintereinander abgestürzt",
    "Eine begonnene Installation läuft zu Ende. Schließe Astral und öffne es neu. Stürzt das Fenster weiter ab, schließe speicherhungrige Programme, aktualisiere den Grafiktreiber und hänge das Protokoll (Einstellungen → Protokolle → „Für ein Ticket herunterladen“) an ein Ticket für den Astral-Support.",
  ],
  pl: [
    "Okno Astral kilka razy z rzędu uległo awarii",
    "Rozpoczęta instalacja dobiega końca. Zamknij Astral i otwórz go ponownie. Jeśli okno dalej się wywraca, zamknij ciężkie programy, zaktualizuj sterownik karty graficznej, a dziennik (Ustawienia → Logi → „Pobierz do zgłoszenia”) dołącz do zgłoszenia do wsparcia Astral.",
  ],
  fr: [
    "La fenêtre d’Astral a planté plusieurs fois de suite",
    "Une installation déjà commencée ira jusqu’au bout. Fermez Astral et rouvrez-le. Si la fenêtre plante encore, fermez les programmes gourmands, mettez à jour le pilote de votre carte graphique et joignez le journal (Paramètres → Journaux → «\u00A0Télécharger pour un ticket\u00A0») à un ticket pour le support d’Astral.",
  ],
};

export const windowGiveUpWords = (language) => WINDOW_GIVE_UP_WORDS[language] || WINDOW_GIVE_UP_WORDS.en;

// Снимок ресурсов в журнал, затем отчёт команде; сбои того и другого глотаются.
function reportWithSnapshot(report, details) {
  const steps = [() => resourceMonitor?.note(`Перед падением процесса ${details.type}`), () => report?.(details)];
  for (const step of steps) {
    try {
      step();
    } catch {
      // снимок и отчёт не должны ронять защиту
    }
  }
}

// Время простоя окна приходит числом или объектом с полем ms.
const hangMs = (event) => (typeof event === "number" ? event : event?.ms);

function showGiveUpBox(dialog, language) {
  const [title, text] = windowGiveUpWords(language());
  dialog.showErrorBox(title, text);
}

export const guardWindow = (win, dialog, reload, report, language, hang) => {
  if (!win?.webContents) return () => {};
  const speak = language === undefined ? () => "ru" : language;

  const hooks = {
    reload: reload || (() => win.webContents.reload()),
    report: (details) => {
      if (report) reportWithSnapshot(report, details);
    },
    onHang: (event) => {
      hang?.({ type: "window", ms: hangMs(event) });
    },
    onGiveUp: () => showGiveUpBox(dialog, speak),
  };
  return watchWindowHealth(win, hooks);
};

// Ждём результат не дольше limitMs; сбой или тишина — null.
async function awaitWithin(start, limitMs) {
  let timer;
  const silence = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([start(), silence]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const warnToLog = (source, message) => appLog.record({ level: "warn", source, message });

// Приёмник замираний сторожа: строка в журнал и отчёт со стеком замирания.
const makeStallReceiver = (sampler, hang) => async ({ ms, channels }) => {
  warnToLog("main", `Главный процесс не отвечал ${oneDecimal(ms / 1000)} с; в работе: ${listChannels(channels)}`);
  const stack = await awaitWithin(() => sampler.consumeStack(ms), STACK_WAIT_MS);
  const base = { type: "main", ms, channels };
  hang?.(stack ? { ...base, top: stack.top, text: stack.text } : base);
};

const writeSlowCall = ({ call, bytes, out, ms }) => {
  const sizes = [`вход ${oneDecimal(bytes / MIB)} МБ`];
  if (out !== null) sizes.push(`выход ${oneDecimal(out / MIB)} МБ`);
  const busy = listChannels(mainWatchdog.channels());
  warnToLog("native-rs", `Синхронный вызов ${call} в главном потоке: ${oneDecimal(ms / 1000)} с, ${sizes.join(", ")}; в работе: ${busy}`);
};

// Сторож взводится на старте и отпускается через 30 секунд; таймер не держит процесс.
const holdWatchdogAtLaunch = () => setTimeout(mainWatchdog.hold(), STARTUP_HOLD_MS).unref?.();

function startResourceMonitor(app, describeWork) {
  const monitor = createResourceMonitor({ app, describeWork });
  resourceMonitor = monitor;
  monitor.start();
  const hibernation = {
    sleep() {
      resourceMonitor.stop();
    },
    wake() {
      resourceMonitor.start();
    },
  };
  onHibernate("resource-monitor", hibernation);
}

export const guardStartup = (app, report, describeWork, Menu, hang) => {
  if (Menu) {
    const packaged = app.isPackaged;
    installApplicationMenu({ Menu, packaged });
  }

  const userData = app.getPath("userData");
  const onStack = (stall) => hang?.(stackHang(stall));
  const sampler = createStallSampler({ userData, onStack });
  const watchdogLinks = [
    ["attachSampler", sampler],
    ["attachStallReport", makeStallReceiver(sampler, hang)],
  ];
  for (const [method, argument] of watchdogLinks) mainWatchdog[method](argument);

  attachSlowCallReport(writeSlowCall, { thresholdMs: SLOW_CALL_THRESHOLD_MS });
  holdWatchdogAtLaunch();
  startResourceMonitor(app, describeWork === undefined ? () => "" : describeWork);

  // watchChildProcesses сам подписывается на child-process-gone, отфильтровывает
  // clean-exit и пишет строку в журнал; отчёт приходит только для GPU.
  watchChildProcesses(app, { report: (details) => reportWithSnapshot(report, details) });
};
