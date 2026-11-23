/*
 * Редкий пульс перерисовки для кадра сцены (опыт `keep-frames`, `stage-exp.js`; 17.11.2026, замер в настоящем Electron, отчёт 19, раздел 11.A).
 *
 * Находка: окно не рисует кадров → дискретная видеокарта засыпает → первый кадр после покоя ждёт пробуждения; пульс держит кадры и карту. Приложение ставит `--force_high_performance_gpu` (`startup-guards.js:
 * applyGpuPreference`), на ноутбуке с двумя картами дискретная засыпает, если окно 10–20 с не рисует. Кадр сцены рисуется по требованию (`stage-loop.js`), анимаций оформления в редакторе нет — после покоя первый кадр
 * ждёт пробуждения карты. Любая идущая перерисовка это снимает. Цена: пока сцена на экране, дискретная карта не засыпает (батарея ноутбука); в скрытом окне пульс стоит. Выбор видеокарты пульс не читает и от него
 * не зависит: на встроенной карте и на ПК с одной картой он безвреден.
 *
 * Здесь та же перерисовка, но таймером, а не css-анимацией: в состоянии окна `idle` (60 с без ввода) `attention-pause.css` гасит анимации, а перерисовка `background-color` кадры даёт и замирание снимает.
 * Раз в `мс` у элемента 1×1 (`.model-stage-keepalive` в углу рамки кадра под холстом, `aria-hidden`, мышь не ловит) меняется `data-phase`, а с ним цвет заливки: краска страницы обновляется по-настоящему. Ни кадра сцены, ни вызовов
 * WebGL, ни цикла `requestAnimationFrame`. Документ скрыт — таймер стоит, виден — идёт; снять таймер — вернуть из `startKeepFrames` функцию. Состояние `idle` пульс не останавливает: в этом смысл.
 *
 * Элемент лежит ПОД холстом кадра: `mountKeepFrames` ставит его в DOM прямо перед холстом (холст — первый ребёнок рамки, `ModelStage.jsx`), а холст непрозрачный и накрывает его целиком — кадр игры не меняется
 * ни на пиксель. Где холст прозрачен или скрыт (`is-settling`, заставка), заливка — матовая плашка кадра в доле 1–2 % поверх той же матовой плашки рамки, цвет тот же. Даёт ли перерисовка под холстом кадр окна —
 * проверяется замером в Electron. Создание и снятие — в эффекте холста: пересоздание холста не оставляет второй точки.
 *
 * С журналом меток (`stage-marks.js`) число пульсов — `window.__astralKeepFrames`; без него в `window` ничего не пишется.
 */
import { stageMarksOn } from "./stage-marks.js";

/** Запускает пульс на элементе. Возвращает функцию, что снимает таймер и слушатель видимости документа. */
export function startKeepFrames(element, intervalMs, doc = globalThis.document) {
  if (!element || !doc) return () => {};
  /* Журнал меток может завестись после монтажа (опыт `marks` включает его при создании кадра): счёт читает его на каждом пульсе. */
  const count = (step) => {
    if (stageMarksOn()) globalThis.__astralKeepFrames = (globalThis.__astralKeepFrames || 0) + step;
  };
  count(0);
  let phase = 0;
  let timer = 0;
  const pulse = () => {
    phase = phase === 0 ? 1 : 0;
    element.setAttribute("data-phase", String(phase));
    count(1);
  };
  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  };
  const follow = () => {
    if (doc.visibilityState !== "visible") {
      stopTimer();
      return;
    }
    if (!timer) timer = setInterval(pulse, intervalMs);
  };
  follow();
  doc.addEventListener("visibilitychange", follow);
  return () => {
    doc.removeEventListener("visibilitychange", follow);
    stopTimer();
  };
}

/**
 * Элемент пульса прямо перед холстом (порядок в DOM: пульс, холст) и сам пульс на нём. Возвращает функцию: она снимает таймер со слушателем и убирает элемент.
 * Вызывается там же, где холст ставится в рамку, и снимается в очистке того же эффекта.
 */
export function mountKeepFrames(canvas, intervalMs, doc = canvas?.ownerDocument) {
  if (!canvas || !doc) return () => {};
  const element = doc.createElement("span");
  element.className = "model-stage-keepalive";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("data-phase", "0");
  canvas.before(element);
  const stop = startKeepFrames(element, intervalMs, doc);
  return () => {
    stop();
    element.remove();
  };
}
