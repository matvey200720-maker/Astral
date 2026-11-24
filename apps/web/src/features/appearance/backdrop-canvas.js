/*
 * Живой фон на холсте 2D (волны «Живая вода», линии «Поток»): форма кривых меняется по-настоящему, а не едет слоем.
 * Один холст 2D, не WebGL: второй контекст на окно заводить нельзя (docs/3D.md). Цена держится низкой так:
 *   - холст вдвое меньше окна по каждой стороне (растягивается CSS) — кривые мягкие, пикселей в четыре раза меньше;
 *   - 15 кадров в секунду: следующий кадр планируется по времени (`setTimeout`), а на отрисовку берётся один `requestAnimationFrame`;
 *     между кадрами холст не просыпается на каждый такт экрана;
 *   - стоит, когда окно не в фокусе или свёрнуто, человек отошёл, фон ушёл с экрана, «Анимации интерфейса» выключены, включено «меньше движения»
 *     (в том числе сменённое на лету), открыт редактор, перегрев, открыты настройки (общий фон под ними), и не перерисовывается, пока листают
 *     (ворота — `backdrop-gate.js`: одна пара слушателей на окно, состояние кэшируется и читается по событиям, не на кадре).
 */
import { watchFrameGate } from "../../attention.js";
import { gateState, isScrolling, subscribeBackdropGate } from "./backdrop-gate.js";

const FPS = 15;
const FRAME_MS = 1000 / FPS;
const SCALE = 0.5;

/**
 * Запускает рисование: `draw(ctx, width, height, seconds, rgb)` зовётся на каждом кадре. Возвращает функцию остановки.
 * `rgb` — строка «r, g, b» акцента (`accentOf(id).rgb`), красит фон, как прежние слои. `still` — миниатюра: один кадр, цикла нет.
 */
export function startBackdropCanvas(canvas, draw, rgb, still = false) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};
  let timer = 0;
  let frame = 0;
  let open = true;
  let width = 0;
  let height = 0;
  /* Время фона не бежит, пока он стоит: возврат продолжает с того же места, а не прыгает. */
  let clock = still ? 7 : 0;
  let stamp = 0;
  /* Холст в окне настроек (`.is-scoped`) идёт, пока окно открыто; общий под ним стоит. */
  const scoped = Boolean(canvas.closest?.(".is-scoped"));

  const size = () => {
    const box = canvas.getBoundingClientRect();
    const next = [Math.max(2, Math.round(box.width * SCALE)), Math.max(2, Math.round(box.height * SCALE))];
    if (next[0] === width && next[1] === height) return;
    [width, height] = next;
    canvas.width = width;
    canvas.height = height;
    paint();
  };
  const paint = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, clock, rgb);
  };
  let stopped = false;
  const running = () => {
    const gate = gateState();
    return !stopped && open && !gate.still && (scoped || !gate.settingsOpen);
  };
  const step = (now) => {
    frame = 0;
    if (!running()) return;
    clock += Math.min((now - (stamp || now)) / 1000, 0.25);
    stamp = now;
    paint();
    schedule();
  };
  const schedule = () => {
    if (timer || frame) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!running()) return;
      /* Листают — кадр пропускается без отрисовки и без запроса кадра экрана. */
      if (isScrolling()) schedule();
      else frame = requestAnimationFrame(step);
    }, FRAME_MS);
  };
  const wake = () => {
    if (!running()) return;
    stamp = 0;
    schedule();
  };

  const resizer = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  resizer?.observe(canvas);
  size();
  if (still) return () => resizer?.disconnect();
  const offGate = subscribeBackdropGate(wake);
  const offFrame = watchFrameGate(canvas, (value) => {
    open = value;
    if (value) wake();
  });
  wake();

  return () => {
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    timer = 0;
    frame = 0;
    resizer?.disconnect();
    offGate();
    offFrame();
  };
}

const TAU = Math.PI * 2;

/* Слой воды: сумма трёх бегущих синусов, у каждого свой период и своя скорость (периоды секунд — 14…40, не кратны). */
const wave = (x, w, layer, t) =>
  layer.base +
  layer.parts.reduce((sum, [cycles, amp, speed, phase]) => sum + amp * Math.sin(TAU * (cycles * (x / w) + phase) + speed * t), 0);

const WATER = [
  { base: 0.56, top: 0.045, tint: 0, parts: [[1.0, 0.045, 0.31, 0.1], [2.3, 0.02, -0.46, 0.5], [3.7, 0.008, 0.71, 0.2]] },
  { base: 0.66, top: 0.05, tint: 0, parts: [[1.6, 0.038, -0.38, 0.3], [2.9, 0.018, 0.52, 0.7], [4.6, 0.007, -0.83, 0.4]] },
  { base: 0.76, top: 0.06, tint: 0, parts: [[1.2, 0.034, 0.44, 0.6], [3.1, 0.016, -0.61, 0.1], [5.2, 0.006, 0.9, 0.8]] },
  { base: 0.86, top: 0.15, tint: 1, parts: [[1.9, 0.028, -0.5, 0.2], [3.4, 0.014, 0.68, 0.55], [5.8, 0.005, -1.02, 0.35]] },
];

/** «Живая вода»: четыре слоя, по гребню каждого тонкая светлая линия; вода тает книзу, как прежние гряды. */
export function drawWater(ctx, w, h, t, rgb) {
  const step = Math.max(3, Math.round(w / 140));
  WATER.forEach((layer) => {
    const colour = layer.tint ? rgb : "255, 255, 255";
    const fill = ctx.createLinearGradient(0, h * (layer.base - 0.06), 0, h);
    fill.addColorStop(0, `rgba(${colour}, ${layer.top})`);
    fill.addColorStop(1, `rgba(${colour}, 0)`);
    /* Гребень считается один раз и идёт и в заливку, и в линию. */
    const crest = [];
    for (let x = 0; x <= w + step; x += step) crest.push([x, wave(x, w, layer, t) * h]);
    const trace = () => crest.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    /* Сначала заливка (путь замыкается вниз), потом линия гребня поверх: гребень не режется заливкой. */
    ctx.beginPath();
    trace();
    ctx.save();
    ctx.lineTo(w + step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    trace();
    ctx.strokeStyle = `rgba(${colour}, ${layer.tint ? 0.34 : 0.16})`;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();
  });
}

/** «Поток»: 26 тонких линий поперёк окна; поле смещения — сумма бегущих волн, согласованных по номеру линии, поэтому рябь переливается по диагонали. */
export function drawStream(ctx, w, h, t, rgb) {
  const lines = 26;
  const step = Math.max(3, Math.round(w / 110));
  for (let i = 0; i < lines; i += 1) {
    const rest = (0.12 + (i / (lines - 1)) * 0.82) * h;
    const lean = i / lines;
    ctx.beginPath();
    for (let x = 0; x <= w + step; x += step) {
      const u = x / w;
      const lift =
        Math.sin(TAU * (1.1 * u + 0.6 * lean) + 0.34 * t) * 0.026 +
        Math.sin(TAU * (2.4 * u - 0.9 * lean) - 0.47 * t) * 0.013 +
        Math.sin(TAU * (0.5 * u + 1.7 * lean) + 0.21 * t) * 0.03;
      /* Ряд «вспухает» в середине окна и выравнивается к краям: линии не слипаются у границ. */
      const y = rest + lift * h * Math.sin(Math.PI * Math.min(1, Math.max(0, u * 0.92 + 0.04)));
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const major = i % 5 === 0;
    ctx.strokeStyle = major ? `rgba(${rgb}, 0.2)` : "rgba(255, 255, 255, 0.075)";
    ctx.lineWidth = major ? 1.2 : 1;
    ctx.stroke();
  }
}
