/*
 * Заставка «Контур» в потоке (17.11.2026): рисует холст, пока главный поток занят чем угодно другим. Цикл — `contour-loop.js`,
 * хозяин — `contour-host.js`. Протокол:
 *
 *   главный → воркер  { type: "init", canvas, width, height, ratio, input, expect }  — холст отдан, цикл пошёл (`expect` — память запусков)
 *                      { type: "size", width, height, ratio }                  — окно сменило размер
 *                      { type: "input", closed, ready, hold, fail }            — ход запуска (любые из полей)
 *                      { type: "exit", next, land }                            — ответ на `exit-begin`
 *                      { type: "stop" }
 *   воркер → главный  { type: "ready", origin }  — модуль загружен (`origin` — начало времени воркера, для сверки кадров)
 *                      { type: "first" }          — первый кадр нарисован: знак из разметки можно убрать
 *                      { type: "view", t, L, k, phase, exit, plan? }  — кадр: ход, слова, слой ухода
 *                      { type: "exit-begin" }     — начался уход: нужно место посадки знака
 *                      { type: "finish", durations }  — уход закончен; `durations` — длительности лучей этого запуска для памяти
 */

import { createLoop } from "./contour-loop.js";

let loop = null;

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    loop = createLoop({
      canvas: message.canvas,
      post: (data) => self.postMessage(data),
      schedule: (callback) => self.requestAnimationFrame(callback),
      cancel: (id) => self.cancelAnimationFrame(id),
    });
    loop.resize(message.width, message.height, message.ratio);
    loop.setExpect(message.expect);
    loop.setInput(message.input);
    loop.start();
  } else if (message.type === "size")
    loop?.resize(message.width, message.height, message.ratio);
  else if (message.type === "input") loop?.setInput(message);
  else if (message.type === "exit")
    loop?.setLanding(message.next, message.land);
  else if (message.type === "stop") {
    loop?.stop();
    self.close();
  }
};

self.postMessage({ type: "ready", origin: performance.timeOrigin });
