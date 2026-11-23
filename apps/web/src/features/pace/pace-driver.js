/*
 * Ведущий хода (18.11.2026): держит траекторию хода вперёд и отвечает на вопрос «где ход в этот миг», не интегрируя кадры. Зачем:
 * ход, который считают шагами по кадрам страницы, встаёт вместе с главным потоком (разбор сцены, загрузка текстур в видеокарту —
 * полоса «зависала на 70 %», а потом вылетала). Здесь ход — функция времени от готового ряда точек: полоса ведётся анимацией
 * `transform` на композиторе по тем же точкам, число берёт то же значение по часам, и после долгой стоянки главного потока оба
 * оказываются там, где им быть положено, без догонялок.
 *
 * Чистый: часы, DOM и анимации — у вызывающего (`useLoaderPace` в `features/workshop/stage-loader/`). Время — в мс от начала
 * работы (`startAt` вызывающий вычитает сам).
 */

import {
  advanceToGo,
  createToGoRun,
  paceDurations,
  paceTrajectory,
  planOf,
  spanOf,
  TO_GO,
} from "./pace.js";

/** Сколько ряд ведёт вперёд, пока вход не менялся, и шаг точек; кончился — ряд продолжается от своего конца. */
export const HORIZON_MS = 4000;
export const SAMPLE_MS = 50;

/**
 * `limits` — `{ defaults, min, max }` ожидаемых длительностей, `expect` — запомненные длительности (мс), `count` — число этапов,
 * `shape` — форма хода в луче (`RAY_PLAN` по умолчанию). Ширина луча — по ожидаемой длительности этапа: скорость хода одна на всех лучах.
 */
export function createPaceDriver({
  count = 4,
  limits,
  expect,
  shape,
  start = null,
}) {
  const spans = Array.from({ length: count }, (_, k) =>
    spanOf(expect, k, limits),
  );
  const plan = planOf(count, spans, shape);
  let input = { closed: 0, partial: 0, done: false, expect, limits };
  let base = createToGoRun(plan);
  /* Загрузка уже идёт, когда карточка открылась: ход не считает с нуля, а стоит там, где работа уже есть (закрытые этапы). */
  if (start?.done) {
    // карточка открыта на уже готовой сцене: сто процентов сразу
    base = {
      ...base,
      closed: count,
      L: 1,
      V: 0,
      closedAt: base.closedAt.map(() => 0),
    };
    input = { ...input, closed: count, done: true };
  } else if (start?.closed > 0) {
    const closed = Math.min(start.closed, count - 1);
    base = {
      ...base,
      closed,
      L: plan.edges[closed] * TO_GO.goal,
      closedAt: base.closedAt.map((at, k) => (k <= closed ? 0 : at)),
    };
    input = { ...input, closed, partial: start.partial ?? 0 };
  }
  let line = null;
  const replan = () => {
    line = {
      from: base.T,
      ...paceTrajectory(
        plan,
        base,
        input,
        { horizonMs: HORIZON_MS, sampleMs: SAMPLE_MS },
        advanceToGo,
      ),
      base,
    };
  };
  replan();

  /** Ряд доходит до `ms`: кончился — продолжается от конца, вход тот же. */
  const reach = (ms) => {
    while (ms > line.from + HORIZON_MS) {
      base = line.end;
      replan();
    }
  };

  /** Уровень и скорость в миг `ms` (мс от начала): линейно между точками ряда. */
  const stateAt = (ms) => {
    reach(ms);
    const into = Math.min(Math.max(ms - line.from, 0), HORIZON_MS);
    const index = Math.min(
      Math.floor(into / SAMPLE_MS),
      line.samples.length - 2,
    );
    const [t0, l0, v0] = line.samples[index];
    const [t1, l1, v1] = line.samples[index + 1];
    const k = t1 > t0 ? (into - t0) / (t1 - t0) : 0;
    return { level: l0 + (l1 - l0) * k, velocity: v0 + (v1 - v0) * k };
  };

  return {
    plan,
    /** Целое число для показа: до конца выше 99 не бывает; в конце — только когда ход дошёл до единицы. */
    percentAt(ms) {
      const { level } = stateAt(ms);
      return input.done
        ? Math.round(level * 100)
        : Math.min(99, Math.round(level * 100));
    },
    levelAt: (ms) => stateAt(ms).level,
    /** Вход изменился в миг `ms`: этап закрылся, листов стало больше, работа кончилась. Ряд строится заново от того, где ход сейчас. */
    update(next, ms) {
      const { level, velocity } = stateAt(ms);
      const merged = { ...input, ...next };
      if (
        merged.closed === input.closed &&
        merged.done === input.done &&
        (merged.partial ?? 0) === (input.partial ?? 0)
      ) {
        // ничего нового: ряд тот же
        input = merged;
        return false;
      }
      const at = { ...line.base, T: ms, L: level, V: velocity };
      base = advanceToGo(plan, at, 0, merged);
      input = merged;
      replan();
      return true;
    },
    /** Ряд строится заново от того, где ход сейчас, при том же входе: полосе, чья анимация подходит к концу, нужен новый ряд без скачка. */
    rebase(ms) {
      const { level, velocity } = stateAt(ms);
      base = { ...line.base, T: ms, L: level, V: velocity };
      replan();
    },
    /** Кадры анимации полосы: `transform: scaleX(уровень)` по точкам ряда, `offset` — доля `duration`. */
    keyframes() {
      return {
        duration: HORIZON_MS,
        frames: line.samples.map(([t, level]) => ({
          transform: `scaleX(${level.toFixed(4)})`,
          offset: t / HORIZON_MS,
        })),
        from: line.from,
      };
    },
    /** Ряд кончился бы раньше `ms` — пора брать новый (полосе, чья анимация кончилась). */
    expiresAt: () => line.from + HORIZON_MS,
    /** Ход дошёл до конца: единица и работа кончилась. */
    finishedAt: (ms) => input.done && stateAt(ms).level >= 1,
    /** Длительности этапов этой работы для памяти (мс), `null`, пока не все закрыты. */
    durations: () =>
      paceDurations(input.done ? advanceToGo(plan, base, 0, input) : base, 0),
  };
}
