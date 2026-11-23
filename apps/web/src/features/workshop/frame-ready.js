/*
 * «Кадр редактора готов» — общий сигнал для съёмки обложек (Хелпер 11, 25.10.2026).
 *
 * Обложка плитки и обложка сохранённой работы — снимок настоящего кадра редактора, а не рисунок. Снимать можно только
 * кадр в полной загрузке: все модели, словари текстур и листы наложены, нет заставки, серых плит и «Загружаю…».
 * Оболочка редактора (`EditorShell`) и кадры уже говорят это разметкой, и здесь она читается в одном месте:
 *
 *   • оболочка — не скелет (`ui-editor-skeleton`, `aria-busy`): редактор приехал целиком;
 *   • `data-stage-busy` — кадр грузит сцену, листы или текстуры (`stage-busy.js`, `useStageBusy`);
 *   • `data-screen-room` ≠ `ready` — занавес комнаты ещё над кадром (`screen-ready.js`);
 *   • в кадре есть холст, серая плита скелета и недокачанная картинка — тоже «не готово».
 *
 * Дальше сигнал «кадр стоит»: `whenEditorFrameReady` ждёт, пока «готово» продержится несколько кадров подряд, а не
 * мигнёт между двумя загрузками. Съёмщик штатных обложек (`scripts/stock-covers-live/`) к тому же сверяет сами пиксели.
 */

const SETTLE_FRAMES = 6;
const POLL_MS = 120;

/**
 * Что сейчас с кадром открытого редактора.
 * @returns {{ ready: boolean, why: string[], rect: number[]|null, hasCanvas: boolean }}
 */
export function editorFrameState(root = typeof document === "undefined" ? null : document) {
  const shell = root?.querySelector?.(".ui-editor-shell");
  const frame = root?.querySelector?.(".ui-editor-canvas");
  if (!shell || !frame) return { ready: false, why: ["нет редактора"], rect: null, hasCanvas: false };
  const why = [];
  if (shell.classList.contains("ui-editor-skeleton") || shell.getAttribute("aria-busy") === "true") why.push("редактор грузится");
  if (shell.hasAttribute("data-stage-busy")) why.push("сцена грузится");
  const room = root.querySelector("[data-screen-room]");
  if (room && room.getAttribute("data-screen") !== "ready") why.push("занавес комнаты");
  const hasCanvas = Boolean(frame.querySelector("canvas"));
  if (!hasCanvas && !frame.querySelector("svg, img")) why.push("в кадре пусто");
  if (frame.querySelector(".ui-skeleton")) why.push("скелет");
  if ([...frame.querySelectorAll("img")].some((image) => !image.complete)) why.push("картинки");
  const box = frame.getBoundingClientRect();
  const rect = box.width > 8 && box.height > 8 ? [box.x, box.y, box.width, box.height] : null;
  if (!rect) why.push("кадр без размера");
  return { ready: why.length === 0, why, rect, hasCanvas };
}

/**
 * Дождаться, пока кадр готов и простоял так `SETTLE_FRAMES` проверок подряд. `true` — готов, `false` — не дождались.
 * Работает и в закрытом окне (таймер, а не кадры анимации): отсчёт идёт по часам.
 */
export function whenEditorFrameReady({ timeout = 8000, signal = null, settle = SETTLE_FRAMES } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let steady = 0;
    const tick = () => {
      if (signal?.aborted) return resolve(false);
      steady = editorFrameState().ready ? steady + 1 : 0;
      if (steady >= settle) return resolve(true);
      if (Date.now() - started > timeout) return resolve(false);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

/* Для съёмщика и ручной проверки в песочнице: `window.__astralFrameReady()`. */
if (typeof window !== "undefined" && import.meta.env?.DEV) window.__astralFrameReady = editorFrameState;
