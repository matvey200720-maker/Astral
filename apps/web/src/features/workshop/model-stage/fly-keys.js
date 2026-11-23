/*
 * Клавиши полёта — чистый разбор, общий для всех камер мастерской
 * (`stage-camera.js`, окно предпросмотра `preview-stage.js`).
 *
 * Полёт слушает окно, а не холст (18.10.2026): курсор над кадром — и W A S D
 * уже летят, без щелчка для фокуса. Окно видит и клавиши соседних полей, поэтому
 * разбор отвечает на два вопроса: чьё это нажатие и что оно значит для камеры.
 */

/* Печатают в поле — буквы его, а не камеры: W в названии проекта — буква. */
export const isTypingTarget = (target) =>
  typeof HTMLElement !== "undefined" &&
  target instanceof HTMLElement &&
  Boolean(
    target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable,
  );

/* Движение полёта: вперёд, влево, назад, вправо; вниз и вверх. */
export const FLY_MOVE_CODES = Object.freeze(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyC", "Space"]);
const FLY_MOVE = new Set(FLY_MOVE_CODES);
/* Эти клавиши поднимают в полёт сами: пробел и C — слишком частые, чтобы
   взлетать от случайного нажатия на кнопку рядом. */
const STARTS_FLIGHT = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const SPEED_UP = new Set(["Equal", "NumpadAdd"]);
const SPEED_DOWN = new Set(["Minus", "NumpadSubtract"]);

/** Клавиша-модификатор скорости: `Shift` (по `key`, как и раньше). */
export const isBoost = (event) => event.key === "Shift" || event.code === "ShiftLeft" || event.code === "ShiftRight";

/* Ctrl — вниз: так летят в арене и в окне предпросмотра, и рука тянется к нему в любом кадре. */
export const isDownKey = (event) => event.key === "Control" || event.code === "ControlLeft" || event.code === "ControlRight";

/*
 * Сочетания, которыми окно закрывается или выходит из приложения: Ctrl+W — закрыть окно, Ctrl+Q —
 * выйти (меню Electron по умолчанию). W и Q — клавиши полёта, а Ctrl — «вниз»: человек, летящий
 * вперёд, зажимал Ctrl, и Astral закрывался посреди кадра (19.10.2026, «зажал Ctrl — и всё упало»;
 * воспроизведено настоящими клавишами). Над кадром эти сочетания гасятся.
 */
const WINDOW_SHORTCUT_CODES = new Set(["KeyW", "KeyQ"]);

/**
 * Что значит нажатие для камеры.
 *
 * @param {{ code?: string, key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} event
 * @param {{ flying: boolean, adjusting?: boolean }} state — `flying`: камера в
 *   полёте; `adjusting`: эмблема в руке — Q и E тогда её поворот, а не взлёт
 * @returns {"move"|"start"|"boost"|"faster"|"slower"|"leave"|"guard"|null}
 *   `start` — поднять в полёт и двигаться; `move` — двигаться в полёте (и с Ctrl, Alt, Cmd в руке:
 *   сочетание — не команда окну); `guard` — не лететь, но и окну не отдавать (Ctrl+W, Ctrl+Q над кадром)
 */
export function flyKeyAction(event, { flying, adjusting = false }) {
  if (isBoost(event)) return "boost";
  const code = event.code || "";
  const modified = event.ctrlKey || event.metaKey || event.altKey;
  if (flying && (isDownKey(event) || (modified && FLY_MOVE.has(code)))) return "move";
  if (modified) return (event.ctrlKey || event.metaKey) && WINDOW_SHORTCUT_CODES.has(code) ? "guard" : null;
  if (flying) {
    if (FLY_MOVE.has(code)) return "move";
    if (SPEED_UP.has(code)) return "faster";
    if (SPEED_DOWN.has(code)) return "slower";
    if (event.key === "Escape") return "leave";
    return null;
  }
  if (!STARTS_FLIGHT.has(code)) return null;
  if (adjusting && (code === "KeyQ" || code === "KeyE")) return null;
  return "start";
}

/* Имя клавиши в наборе зажатых: Shift — по значению, остальные — по коду. */
export const heldName = (event) => (isBoost(event) ? "Shift" : event.code);
