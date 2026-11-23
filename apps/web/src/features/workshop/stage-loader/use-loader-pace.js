import { useEffect, useLayoutEffect, useRef } from "react";
import { createPaceDriver } from "../../pace/pace-driver.js";
import { readPace, rememberPace } from "../../pace/pace-memory.js";
import {
  motionEnabled,
  systemPrefersReducedMotion,
} from "../../../motion-preference.js";

/*
 * Ход процента и полосы карточки загрузки сцены (18.11.2026): общий темп (`features/pace/`), по запомненной длительности прошлых
 * загрузок этого вида сцены. Заменил `smooth-percent.js`, где число шло ступенями настоящего счёта плюс запас в шесть пунктов:
 * «до 70 % доходит, потом фриз, и там быстро» (слова владельца 18.11) — этап без хода держал число у потолка запаса, а полоса
 * вставала вместе с главным потоком.
 *
 *  • ход идёт ровно от 1 до 100: этапы карточки (`LOADER_STAGES`) — вехи на оси ожидаемого времени; закрылся раньше ожидания — ход
 *    плавно ускоряется, позже — плавно замедляется, не встаёт и не прыгает; назад не идёт; «100 %» пишется, только когда сцена
 *    правда готова (`done`), а до того выше 99 не бывает;
 *  • полоса ведётся анимацией `transform` на композиторе по готовому ряду точек (`pace-driver.js`), а не кадрами страницы: главный
 *    поток занят разбором сцены и загрузкой текстур в видеокарту — полоса идёт; число берёт то же значение по часам, и после стоянки
 *    потока оба оказываются там, где им быть положено;
 *  • ни одного кадра React на ход: число пишется в узел напрямую (`textContent`), состояние не меняется — кадры нужны только пока
 *    карточка на экране, а в конце (`done`) ход короткий, растворение ничего не ждёт (замер 31.10.2026: отрисовка карточки на каждом
 *    кадре держала главный поток ещё полсекунды после готового кадра);
 *  • спокойный режим и окружение без `Element.animate` — число и полоса меняются шагом в один процент, без движения между шагами.
 *
 * Выучивается: когда карточка уходит с готовой сценой, длительности этапов этой загрузки сглаживаются с запомненными
 * (`pace-memory.js`, ключ — вид сцены `kit`).
 */

/** Ожидание по умолчанию — читаю, собираю, текстуры, свет (мс; в сумме 4,5 с — сколько обычно идёт загрузка сцены на ПК тестеров), пока этого вида сцены ещё не видели, и пределы, в которых памяти верят. */
export const LOAD_DEFAULTS = Object.freeze([500, 800, 2600, 600]);
export const LOAD_LIMITS = Object.freeze({
  defaults: LOAD_DEFAULTS,
  min: 150,
  max: 60_000,
});
export const paceKeyOf = (kit) => `astral-load-pace:${kit || "hall"}`;
const STEPS = LOAD_DEFAULTS.length;
/** За сколько до конца ряда анимации берётся новый. */
const RENEW_MS = 300;

/**
 * Показ хода на двух узлах: `textEl` (число) и `barEl` (заливка полосы; её родитель — полоса с `aria-valuenow`). Без React и без
 * `window`: часы и кадры — параметры, поэтому проверяется тестом. Возвращает `{ update, freeze, destroy, percent }`.
 */
export function attachPaceView({
  driver,
  textEl,
  barEl,
  t0,
  now = () => performance.now(),
  calm = false,
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
}) {
  const animated = !calm && typeof barEl.animate === "function";
  const meter = barEl.parentElement;
  let animation = null;
  let animatedUntil = 0;
  let frame = 0;
  let shown = -1;
  let stopped = false;
  const rel = () => now() - t0;

  const write = (percent, level) => {
    if (percent !== shown) {
      shown = percent;
      textEl.textContent = `${percent}%`;
      meter?.setAttribute("aria-valuenow", String(percent));
      if (!animated)
        barEl.style.transform = `scaleX(${(percent / 100).toFixed(2)})`;
    }
    return level;
  };
  const play = () => {
    if (!animated) return;
    animation?.cancel();
    const { frames, duration, from } = driver.keyframes();
    animation = barEl.animate(frames, {
      duration,
      easing: "linear",
      fill: "forwards",
    });
    animation.currentTime = Math.max(0, rel() - from);
    animatedUntil = from + duration;
  };
  const tick = () => {
    frame = 0;
    if (stopped) return;
    const ms = rel();
    write(driver.percentAt(ms));
    /* Анимация подходит к концу ряда — новый ряд от того места, где ход сейчас: полоса не встаёт на горизонте и не прыгает. */
    if (animated && ms >= animatedUntil - RENEW_MS) {
      driver.rebase(ms);
      play();
    }
    if (driver.finishedAt(ms)) {
      write(100);
      return;
    }
    frame = raf(tick);
  };
  write(driver.percentAt(rel()));
  play();
  frame = raf(tick);
  return {
    percent: () => shown,
    /** Вход изменился (этап закрылся, листов стало больше, работа кончилась): ряд строится заново от того, где ход сейчас. */
    update(input) {
      if (stopped) return;
      if (driver.update(input, rel())) play();
      if (!frame) frame = raf(tick);
    },
    /** Загрузка отказала: ход и полоса стоят там, где были. */
    freeze() {
      stopped = true;
      if (frame) caf(frame);
      frame = 0;
      animation?.pause();
    },
    destroy() {
      stopped = true;
      if (frame) caf(frame);
      frame = 0;
      animation?.cancel();
    },
  };
}

/**
 * Для карточки: `{ textRef, barRef, initial }`. `closed` — сколько шагов карточки готово подряд, `partial` — настоящая доля идущего
 * шага (листы 3 из 10), `done` — сцена готова и карточка растворяется, `enabled` — счёт вообще есть, `frozen` — отказ.
 */
export function useLoaderPace({
  kit,
  closed,
  partial = 0,
  done = false,
  enabled = true,
  frozen = false,
}) {
  const textRef = useRef(null);
  const barRef = useRef(null);
  const box = useRef(null);
  if (!box.current) {
    const key = paceKeyOf(kit);
    const t0 = performance.now();
    const driver = createPaceDriver({
      count: STEPS,
      limits: LOAD_LIMITS,
      expect: readPace(key, LOAD_LIMITS),
      start: { closed: Math.min(closed, STEPS - 1), partial, done },
    });
    box.current = {
      key,
      t0,
      driver,
      view: null,
      initial: `${driver.percentAt(0)}%`,
    };
  }
  const state = box.current;
  const input = {
    closed: done ? STEPS : Math.min(closed, STEPS - 1),
    partial,
    done,
  };
  const latest = useRef(input);
  latest.current = input;

  /* Показ ставится один раз на узлы карточки; пока счёта нет (`enabled` ложно), узлов у карточки нет. */
  useLayoutEffect(() => {
    if (!enabled || !textRef.current || !barRef.current) return undefined;
    const calm = !motionEnabled() || systemPrefersReducedMotion();
    state.view = attachPaceView({
      driver: state.driver,
      textEl: textRef.current,
      barEl: barRef.current,
      t0: state.t0,
      calm,
    });
    state.view.update(latest.current);
    return () => {
      state.view?.destroy();
      state.view = null;
      /* Загрузка кончилась готовой сценой: запомнить, сколько заняли этапы. */
      if (latest.current.done)
        rememberPace(state.key, state.driver.durations(), LOAD_LIMITS);
    };
  }, [enabled, state]);

  useEffect(() => {
    if (frozen) state.view?.freeze();
    else state.view?.update(latest.current);
  }, [input.closed, input.partial, input.done, frozen, state]);

  return { textRef, barRef, initial: state.initial };
}
