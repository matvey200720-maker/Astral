/*
 * Здоровье окна (ТЗ 06.10.2026, вечер, задача 1).
 *
 * Страница окна живёт в своём процессе. Упала она (нехватка памяти в тяжёлом
 * редакторе, сбой видеодрайвера) — Electron оставлял пустое тёмное окно, а в
 * журнале не было ни строки: человек видел «лаунчер умер» и перезапускал всё.
 * Теперь падение пишется в журнал и окно перезагружается само — главный
 * процесс при этом жив, и начатая запись в игру доходит до конца (её ход
 * окно снова получает событиями). Чтобы окно, которое падает сразу после
 * загрузки, не крутилось по кругу, перезагрузок не больше трёх за пять
 * минут; дальше — понятное окно с объяснением.
 *
 * Зависание страницы (`unresponsive`) и падения служебных процессов (GPU,
 * сеть) тоже ложатся в журнал: по ним видно, что именно тормозило.
 */

import { appIsLeaving, appLog } from "./app-log.js";

const RELOAD_WINDOW_MS = 5 * 60 * 1000;
const MAX_RELOADS = 3;

const REASONS = {
  crashed: "страница упала",
  oom: "странице не хватило памяти",
  killed: "процесс страницы завершён системой",
  "launch-failed": "процесс страницы не запустился",
  "integrity-failure": "проверка целостности не прошла",
  abnormal: "страница завершилась с ошибкой",
};

/**
 * `win` — главное окно; `reload()` — как открыть страницу заново (по
 * умолчанию — перезагрузка); `onGiveUp()` — когда перезагрузки кончились;
 * `report(details)` — отчёт об ошибке (бета 14.10.2026: падение окна при
 * «Применить» мини-карты у kevake было только в его журнале — теперь оно
 * приходит команде отчётом, а с ним и журнал).
 */
export function watchWindowHealth(win, { log = appLog, reload = null, onGiveUp = null, report = null, onHang = null, now = Date.now } = {}) {
  const contents = win?.webContents;
  if (!contents) return () => {};
  const reloads = [];
  let unresponsiveSince = null;

  const onGone = (_event, details = {}) => {
    const reason = String(details.reason || "");
    if (reason === "clean-exit") return;
    log.record({
      level: "error",
      source: "window",
      message: `Окно перезапущено: ${REASONS[reason] || reason || "страница завершилась"} (код ${details.exitCode ?? "—"})`,
    });
    try {
      report?.({ type: "Renderer", reason, exitCode: details.exitCode });
    } catch {
      /* Отчёт — дополнение к журналу: его сбой окно не держит. */
    }
    if (win.isDestroyed?.()) return;
    const at = now();
    while (reloads.length && at - reloads[0] > RELOAD_WINDOW_MS) reloads.shift();
    if (reloads.length >= MAX_RELOADS) {
      onGiveUp?.(details);
      return;
    }
    reloads.push(at);
    setTimeout(() => {
      if (win.isDestroyed?.()) return;
      if (reload) reload();
      else contents.reload();
    }, 300);
  };
  const onUnresponsive = () => {
    unresponsiveSince = now();
    log.record({ level: "warn", source: "window", message: "Окно не отвечает" });
  };
  const onResponsive = () => {
    if (unresponsiveSince === null) return;
    const ms = now() - unresponsiveSince;
    const seconds = (ms / 1000).toFixed(1).replace(".", ",");
    unresponsiveSince = null;
    log.record({ level: "info", source: "window", message: `Окно снова отвечает (не отвечало ${seconds} с)` });
    try {
      onHang?.({ ms });
    } catch {
      /* Отчёт — дополнение к журналу. */
    }
  };
  contents.on("render-process-gone", onGone);
  contents.on("unresponsive", onUnresponsive);
  contents.on("responsive", onResponsive);
  return () => {
    contents.removeListener?.("render-process-gone", onGone);
    contents.removeListener?.("unresponsive", onUnresponsive);
    contents.removeListener?.("responsive", onResponsive);
  };
}

/**
 * Падения служебных процессов Chromium (видеочип, сеть, звук) — в журнал;
 * падение видеочипа — ещё и отчётом (`report`), остальные — только журнал.
 */
export function watchChildProcesses(app, { log = appLog, report = null, leaving = appIsLeaving } = {}) {
  app.on("child-process-gone", (_event, details = {}) => {
    if (details.reason === "clean-exit") return;
    /* Выход уже начался: выход ради обновления снимает все процессы из папки приложения (`updates/leftover-processes.js`),
       и Chromium докладывает про свои GPU и сеть «crashed (код -1)». Это закрытие, а не падение: ни ошибки, ни отчёта. */
    if (leaving()) {
      log.record({
        level: "info",
        source: "window",
        message: `Служебный процесс ${details.type || "?"}${details.name ? ` (${details.name})` : ""} закрыт при выходе: ${details.reason || "?"} (код ${details.exitCode ?? "—"})`,
      });
      return;
    }
    log.record({
      level: details.type === "GPU" ? "error" : "warn",
      source: "window",
      message: `Служебный процесс ${details.type || "?"}${details.name ? ` (${details.name})` : ""} завершился: ${details.reason || "?"} (код ${details.exitCode ?? "—"})`,
    });
    if (details.type !== "GPU") return;
    try {
      report?.({ type: "GPU", reason: String(details.reason || ""), exitCode: details.exitCode });
    } catch {
      /* Отчёт — дополнение к журналу. */
    }
  });
}
