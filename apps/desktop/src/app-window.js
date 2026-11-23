import { BrowserWindow } from "electron";
import { isServiceWindow } from "./service-windows.js";

const OVERLAY_CLEAR = "rgba(0, 0, 0, 0)";
const OVERLAY_HEIGHT = 40;

/* Уничтоженное окно в списке ещё бывает (второй запуск или ссылка `astral://` в миг закрытия): любой его метод
   бросает «Object has been destroyed», поэтому окном интерфейса оно не считается (05.11.2026). */
function isRegularWindow(candidate) {
  if (candidate.isDestroyed()) return false;
  return !isServiceWindow(candidate);
}

export function appWindow() {
  for (const candidate of BrowserWindow.getAllWindows()) {
    if (isRegularWindow(candidate)) return candidate;
  }
  return null;
}

export function applyTitlebarTheme(win, value) {
  const usable = Boolean(win) && !win.isDestroyed() && typeof win.setTitleBarOverlay === "function";
  if (!usable) return;
  const light = value === "light";
  const overlay = { color: OVERLAY_CLEAR, symbolColor: light ? "#161616" : "#f4f4f5", height: OVERLAY_HEIGHT };
  win.setTitleBarOverlay(overlay);
}

// Порядок обращений: видимость → показ, затем свёрнутость → восстановление, в конце фокус.
const RAISE_STEPS = [
  [(win) => !win.isVisible(), "show"],
  [(win) => win.isMinimized(), "restore"],
];

export function raiseAppWindow() {
  const win = appWindow();
  if (!win) return win;
  for (const [needed, action] of RAISE_STEPS) {
    if (needed(win)) win[action]();
  }
  win.focus();
  return win;
}
