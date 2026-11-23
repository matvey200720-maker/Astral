import { ATTENTION_HIDDEN, getAttention } from "../../attention.js";
import { editorRoomOpen } from "./useEditorRoom.js";

/*
 * Когда можно греть впрок (31.10.2026): окно настроек (`settings/SettingsPrewarm.jsx`) и страницы, что собираются скрытыми до первого захода (`desktop/KeptPage.jsx`).
 *
 * Не раньше, чем через 10 с после старта окна, и только если 2 с ничего не трогали. Не греется: окно скрыто или свёрнуто, открыт редактор (там WebGL), открыто окно
 * (удержанное закрытое окно — `is-kept` — открытым не считается, правило в docs/3D.md). Слушатели ввода лёгкие (метка времени), заводятся один раз.
 */

export const PREWARM_BOOT_MS = 10_000;
export const PREWARM_QUIET_MS = 2_000;

let lastInput = -Infinity;
let tracking = false;

/** Когда человек в последний раз что-то трогал: слежка заводится один раз. */
export function trackInput() {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  const touch = () => {
    lastInput = performance.now();
  };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(type, touch, { capture: true, passive: true });
  }
}

/** Для тестов: считать, что ввода давно не было / только что был. */
export function noteInputAt(at) {
  lastInput = at;
}

/** Можно ли греть прямо сейчас (всё, кроме «идёт установка» — оно приходит свойством). */
export function prewarmAllowed() {
  if (typeof document === "undefined") return false;
  return (
    document.visibilityState === "visible" &&
    getAttention() !== ATTENTION_HIDDEN &&
    !editorRoomOpen() &&
    !document.querySelector(".ui-dialog-backdrop:not(.is-kept) > .ui-dialog") &&
    performance.now() - lastInput >= PREWARM_QUIET_MS
  );
}
