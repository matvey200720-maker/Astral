import { useEffect, useLayoutEffect, useRef } from "react";
import { ATTENTION_HIDDEN, getAttention, subscribeAttention, watchFrameGate } from "../../../attention.js";

// Кадры по требованию (docs/3D.md, правило 4): стоящая сцена кадров не просит,
// закрытые ворота внимания останавливают время, своего вечного rAF не заводим.
export const STAGE_IDLE = Infinity;

// Имя отмены по ключу заказа. Функции окна ищутся в момент вызова: тесты их подменяют на window.
const UNDO = { raf: "cancelAnimationFrame", nap: "clearTimeout" };

const wallClock = () => (typeof performance === "undefined" ? Date : performance).now();

// Снять заказы по ключам, по порядку: ключ с пустым заказом пропускается.
function drop(s, ...keys) {
  for (const key of keys) {
    if (s[key] === null) continue;
    window[UNDO[key]](s[key]);
    s[key] = null;
  }
}

// Заказ кадра: второй заказ, пока первый не отработал, не делается; ждущий сон снимается.
function order(s) {
  if (s.dead || s.raf !== null) return;
  drop(s, "nap");
  s.raf = window.requestAnimationFrame((stamp) => tick(s, stamp));
}

function sleep(s, ms) {
  s.nap = window.setTimeout(() => {
    s.nap = null;
    order(s);
  }, ms);
}

function tick(s, stamp) {
  if (s.dead) return;
  s.raf = null;
  const at = wallClock();
  const { clock, paused, frame } = s;
  // закрытые ворота: paused() не зовём
  const stopped = !s.on || paused();
  if (at - s.prev < s.gap && !stopped) {
    order(s);
    return;
  }
  s.prev = at;
  // Метка развёртки (решение 2.11.2026, frame-cadence.js): шаг движения считается по ней,
  // но только если это конечное число в (0, at]; иначе берём время обработчика.
  const frameTime = Number.isFinite(stamp) && at >= stamp && stamp > 0 ? stamp : at;
  const next = frame(clock ? clock(at, stopped) : at, { now: at, stopped, frameTime });
  // Дальше кадры просим, только если цикл идёт: IDLE и мусор (undefined, NaN) — конец.
  // Сравнения по правилам JS, значение не приводится; больше 16 мс — спим таймером.
  if (stopped || s.dead || !(next < STAGE_IDLE)) return;
  (next > 16 ? sleep : order)(s, next);
}

// invalidate: в спрятанное окно просьба откладывается, в закрытое, но видимое — выполняется
// (та же таблица, что у draw в attention.js).
function ask(s) {
  if (s.dead) return;
  if (!s.on && getAttention() === ATTENTION_HIDDEN) {
    s.held = true;
    return;
  }
  s.held = false;
  order(s);
}

function gate(s, open) {
  if (s.dead) return;
  s.on = open;
  if (open) {
    s.held = false;
    order(s);
    return;
  }
  drop(s, "raf", "nap");
  // время сцены встаёт сразу, а не в момент следующего кадра (часы — frozenClock из TracerRange.jsx)
  const { clock } = s;
  if (clock) clock(wallClock(), true);
  ask(s);
}

// wires — отписки в порядке подписки; снимаем с конца: сначала ворота, потом внимание.
function halt(s, wires) {
  if (s.dead) return;
  s.dead = true;
  drop(s, "raf", "nap");
  while (wires.length) wires.pop()();
}

export function startStageLoop({ frame, maxFps = 0, paused = () => false, clock = null, element }) {
  // gap: 3 мс — запас на дрожь развёртки (кадр 144 Гц — 6,9 мс, два — 13,9), поэтому предел 144 — каждый второй.
  const s = {
    clock,
    paused,
    frame,
    gap: maxFps > 0 ? 1000 / maxFps - 3 : 0,
    dead: false,
    on: true,
    raf: null,
    nap: null,
    held: false,
    prev: -Infinity,
  };
  const wires = [
    subscribeAttention((state) => {
      if (s.held && state !== ATTENTION_HIDDEN) ask(s);
    }),
    watchFrameGate(element, (open) => gate(s, open)),
  ];
  return { invalidate: () => ask(s), stop: () => halt(s, wires) };
}

// Запуск по зависимостям вызывающего. Ложный ответ setup — цикла нет и очистки нет.
function attach(loopRef, elementRef, setup) {
  const { current: element } = elementRef;
  const settings = setup(element);
  const loop = settings && startStageLoop({ element, ...settings });
  if (!loop) return undefined;
  loopRef.current = loop;
  return () => {
    loop.stop();
    settings.dispose?.();
    if (loopRef.current !== loop) return;
    loopRef.current = null;
  };
}

export const useStageLoop = (elementRef, setup, deps) => {
  const loopRef = useRef(null);
  // Перерисовка компонента — просьба о кадре: React уже записал холсту новые размеры (это стирает
  // картинку), а сцена читает настройки из ссылок.
  useLayoutEffect(() => loopRef.current?.invalidate());
  // Перезапуск только по зависимостям вызывающего.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => attach(loopRef, elementRef, setup), deps);
  return loopRef;
};
