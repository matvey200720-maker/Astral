import { useEffect, useState } from "react";

const FALLBACK_MS = 120;

const once = (job) => {
  let spent = false;
  return () => {
    if (!spent) {
      spent = true;
      job();
    }
  };
};

/**
 * Пауза после отрисовки: кадр анимации, в нём нулевой таймер; запасной таймер на 120 мс — на
 * случай, когда кадры не идут (окно скрыто). Обратный вызов выполняется один раз, кто успел.
 * Возвращает отмену всего, что запрошено.
 */
function afterPaint(run) {
  const fire = once(run);
  const ids = { frame: 0, zero: 0, backup: 0 };
  ids.frame = requestAnimationFrame(() => {
    ids.zero = setTimeout(fire, 0);
  });
  ids.backup = setTimeout(fire, FALLBACK_MS);
  return () => {
    cancelAnimationFrame(ids.frame);
    clearTimeout(ids.zero);
    clearTimeout(ids.backup);
  };
}

/**
 * Режим «сразу»: окно без кадров анимации или тестовая сборка. Читается на каждой отрисовке;
 * окружение Vite читается необязательно и только если кадры анимации есть.
 */
const switchesInstantly = () =>
  typeof requestAnimationFrame !== "function" || import.meta.env?.MODE === "test";

// Состояние переключателя: что показано и идёт ли «досадка» после смены.
const stageOf = (shown, settling) => ({ shown, settling });

// Что делать эффекту в каждой фазе; идёт первая из поднятых фаз, иначе покой.
const PHASE_ACTIONS = {
  rest: () => undefined,
  jump: (setStage, value) => {
    setStage(stageOf(value, false));
    return undefined;
  },
  swap: (setStage, value) => afterPaint(() => setStage(stageOf(value, true))),
  settle: (setStage) => afterPaint(() => setStage((prev) => Object.assign({}, prev, { settling: false }))),
};

const phaseOf = (flags) => flags.find(([raised]) => raised)?.[1] ?? "rest";

/**
 * Сначала плашка «Обновляю…», потом новое значение: пересборка кадра идёт уже под плашкой.
 * Возвращает { value, busy }; value — то, что реально показано.
 */
export function useStageSwitch(value, cheap = null) {
  const [stage, setStage] = useState(stageOf(value, false));
  const instant = switchesInstantly();
  const differs = !Object.is(value, stage.shown);
  // cheap спрашивается только пока значение отличается от показанного (и в режиме «сразу» тоже)
  const fast = differs && Boolean(cheap) ? Boolean(cheap(value)) : false;
  const { settling } = stage;

  useEffect(() => {
    const phase = phaseOf([
      [instant, "rest"],
      [fast, "jump"],
      [differs, "swap"],
      [settling, "settle"],
    ]);
    return PHASE_ACTIONS[phase](setStage, value);
  }, [instant, fast, differs, settling, value]);

  const direct = instant || fast;
  return {
    value: direct ? value : stage.shown,
    busy: direct ? false : differs || settling,
  };
}
