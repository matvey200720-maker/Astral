// «Применить» в редакторе: кадр сминается в комок бумаги и улетает к кнопке «Загрузки».
// Кадр снимает браузер (View Transitions, вместе с холстом WebGL), а модуль считает
// покадровые значения и отдаёт их анимациям браузера. Нельзя смять — null, и летит плашка.
import { releaseRangeSelection } from "../../utils/rangeSelection.js";
import { motionEnabled } from "../../motion-preference.js";

export const CRUMPLE_DURATION_MS = 1100;

// Идущий полёт: пока он есть, новые нажатия получают то же обещание.
let flight = null;

export function canCrumple(stage) {
  const doc = globalThis.document;
  if (!doc || !motionEnabled()) return false;
  return !BLOCKERS.some((blocked) => blocked(doc, stage));
}

export function crumpleWorkToDownloads({ stage, seed = Date.now() }) {
  if (flight !== null) return flight;
  if (!canCrumple(stage)) return null;
  const trip = new Trip(stage, seed);
  if (!trip.begin()) return null;
  flight = trip.ride();
  return flight;
}

/** Один полёт: слои, переход браузера и уборка за ним. */
class Trip {
  constructor(stage, seed) {
    this.stage = stage;
    this.rect = stage.getBoundingClientRect();
    this.landing = chooseLanding();
    this.host = stage.closest(HOST_SELECTOR) || document.body;
    this.rng = new Lcg(seed);
    const radius = getComputedStyle(stage).borderRadius;
    this.folds = makeLayer(FOLDS_CLASS, this.rect, radius);
    this.shade = makeLayer(SHADE_CLASS, this.rect, radius);
    const markup = foldsMarkup(this.rng);
    this.folds.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
    this.root = document.documentElement;
    this.transition = null;
    this.tidied = false;
  }

  /** Запускает переход; false, если браузер отказал сразу. */
  begin() {
    releaseRangeSelection();
    this.root.classList.add(FLYING_CLASS);
    this.stage.style.viewTransitionName = SHEET_NAME;
    try {
      this.transition = document.startViewTransition(() => this.mount());
      return true;
    } catch {
      this.tidy();
      return false;
    }
  }

  // Вызывает браузер: кадр отдаёт имя перехода слою граней, слои встают на страницу.
  mount() {
    this.stage.style.viewTransitionName = "";
    if (this.tidied) return;
    this.folds.style.viewTransitionName = SHEET_NAME;
    this.host.append(this.folds, this.shade);
  }

  tidy() {
    this.tidied = true;
    this.stage.style.viewTransitionName = "";
    this.folds.remove();
    this.shade.remove();
    this.root.classList.remove(FLYING_CLASS);
  }

  takeOff() {
    const plan = planFlight(this.rect, this.landing);
    const shape = drawShape(this.rng, plan);
    for (const [part, frames] of timeline(plan, shape)) {
      this.root.animate(frames, {
        duration: CRUMPLE_DURATION_MS,
        easing: "linear",
        fill: "forwards",
        pseudoElement: `::view-transition-${part}(${SHEET_NAME})`,
      });
    }
    this.shade.animate(SHADE_KEYFRAMES, {
      duration: CRUMPLE_DURATION_MS,
      easing: "linear",
      fill: "forwards",
    });
    const { button } = this.landing;
    if (button && typeof button.animate === "function") {
      button.animate(WOBBLE_KEYFRAMES, {
        duration: WOBBLE_MS,
        delay: CRUMPLE_DURATION_MS * LANDING_SHARE - 40,
        easing: "cubic-bezier(0.2, 0.78, 0.2, 1)",
      });
    }
  }

  // Обещание никогда не отказывает; убирается всегда, чем бы ни кончился переход.
  async ride() {
    try {
      const { ready, finished } = this.transition;
      quiet(finished);
      await ready;
      this.takeOff();
      await finished;
    } catch {
      // отказ ready или finished и сбой анимаций дальше не идут
    } finally {
      this.tidy();
      flight = null;
    }
  }
}

/** Линейный конгруэнтный генератор: одинаковый seed даёт одинаковые числа. */
class Lcg {
  constructor(seed) {
    this.state = seed >>> 0 || 1;
  }

  next() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

function quiet(promise) {
  Promise.resolve(promise).catch(() => {});
}

function showsOnScreen(rect) {
  const reachX = window.innerWidth || Infinity;
  const reachY = window.innerHeight || Infinity;
  const big = rect.width > 80 && rect.height > 80;
  return big && rect.right > 0 && rect.bottom > 0 && rect.top < reachY && rect.left < reachX;
}

const centerOf = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

// Точка посадки: центр кнопки на виду, иначе угол у левого края.
function chooseLanding() {
  const button = document.querySelector(BUTTON_SELECTOR);
  const winH = window.innerHeight;
  if (!button) return { x: CORNER_X, y: winH - 96, button: null };
  const box = button.getBoundingClientRect();
  const hub = centerOf(box);
  const visible = box.width > 0 && box.right > 4 && getComputedStyle(button).visibility !== "hidden";
  if (visible) return { ...hub, button };
  return { x: CORNER_X, y: Math.min(Math.max(hub.y, 56), winH - 56), button: null };
}

function makeLayer(className, rect, radius) {
  const layer = document.createElement("div");
  layer.className = className;
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    left: px(rect.left),
    top: px(rect.top),
    width: px(rect.width),
    height: px(rect.height),
    borderRadius: radius,
  });
  return layer;
}

// Слой граней, шаг 1: сетка узлов; крайние координаты не сдвигаются и чисел не берут.
function foldGrid(rng) {
  const nodes = GRID_COLS * GRID_ROWS;
  const xs = new Float64Array(nodes);
  const ys = new Float64Array(nodes);
  for (let at = 0; at < nodes; at += 1) {
    const col = at % GRID_COLS;
    const row = (at - col) / GRID_COLS;
    xs[at] = (col / (GRID_COLS - 1)) * 100;
    if (col > 0 && col < GRID_COLS - 1) xs[at] += (rng.next() - 0.5) * 9;
    ys[at] = (row / (GRID_ROWS - 1)) * 100;
    if (row > 0 && row < GRID_ROWS - 1) ys[at] += (rng.next() - 0.5) * 11;
  }
  return { xs, ys };
}

const vertexText = (xs, ys, i) => `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;

function trianglePolygon(grid, a, b, c, fill) {
  const { xs, ys } = grid;
  const points = `${vertexText(xs, ys, a)} ${vertexText(xs, ys, b)} ${vertexText(xs, ys, c)}`;
  return `<polygon points="${points}" fill="${fill}"/>`;
}

// Слой граней, шаг 2: клетки по строкам; диагональ, затем цвет и прозрачность каждого треугольника.
function foldCells(rng, grid) {
  let markup = "";
  for (let cell = 0; cell < (GRID_COLS - 1) * (GRID_ROWS - 1); cell += 1) {
    const col = cell % (GRID_COLS - 1);
    const corner = ((cell - col) / (GRID_COLS - 1)) * GRID_COLS + col;
    const split = CELL_SPLITS[rng.next() > 0.5 ? 0 : 1];
    for (let t = 0; t < split.length; t += 3) {
      const tone = rng.next() > 0.5 ? "255,255,255" : "0,0,0";
      const fill = `rgba(${tone},${(0.2 + rng.next() * 0.55).toFixed(2)})`;
      markup += trianglePolygon(grid, corner + split[t], corner + split[t + 1], corner + split[t + 2], fill);
    }
  }
  return markup;
}

const foldsMarkup = (rng) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${foldCells(rng, foldGrid(rng))}</svg>`;

// Геометрия полёта: шар, снос, дуга от начала к посадке через опорную точку.
function planFlight(rect, landing) {
  const w = rect.width;
  const h = rect.height;
  const ball = Math.min(w, h) * 0.34;
  const hub = centerOf(rect);
  const side = Math.sign(landing.x - hub.x) || -1;
  const drift = { x: side * Math.min(48, w * 0.05), y: -Math.min(28, h * 0.05) };
  const start = { x: hub.x + drift.x, y: hub.y + drift.y };
  const via = {
    x: mix(start.x, landing.x, 0.32),
    y: Math.min(start.y, landing.y) - Math.min(170, h * 0.3),
  };
  return {
    w,
    h,
    ball,
    side,
    drift,
    start,
    via,
    end: landing,
    crushScale: 112 / (2 * ball),
    gateScale: 22 / (2 * ball),
  };
}

// Контур комка: для каждой точки рамки длина луча шара, излом и сдвиг вдоль.
function drawShape(rng, { w, h, ball }) {
  const column = () => new Float64Array(RIM_POINTS);
  const shape = {
    sx: column(),
    sy: column(),
    ex: column(),
    ey: column(),
    ux: column(),
    uy: column(),
    fold: column(),
    slide: column(),
  };
  for (let n = 0; n < RIM_POINTS; n += 1) {
    const side = n >> 3;
    const x = RIM_X[side](n & 7, w);
    const y = RIM_Y[side](n & 7, h);
    const angle = Math.atan2(y - h / 2, x - w / 2);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const reach = ball * (0.9 + rng.next() * 0.22);
    shape.fold[n] = (rng.next() - 0.62) * ball * 0.5;
    shape.slide[n] = (rng.next() - 0.5) * ball * 0.16;
    shape.sx[n] = x;
    shape.sy[n] = y;
    shape.ux[n] = ux;
    shape.uy[n] = uy;
    shape.ex[n] = w / 2 + ux * reach;
    shape.ey[n] = h / 2 + uy * reach;
  }
  return shape;
}

// Многоугольник на доле смятия k: рамка вминается внутрь и сходится в неровный шар.
function outline(shape, k) {
  const m = easeInOut(k);
  const crease = Math.sin(Math.PI * Math.min(1, k * 1.15));
  let points = "";
  for (let n = 0; n < RIM_POINTS; n += 1) {
    const dent = shape.fold[n] * crease;
    const shift = shape.slide[n] * crease;
    const x = mix(shape.sx[n], shape.ex[n], m) + shape.ux[n] * dent - shape.uy[n] * shift;
    const y = mix(shape.sy[n], shape.ey[n], m) + shape.uy[n] * dent + shape.ux[n] * shift;
    points += `${n === 0 ? "" : ", "}${px(x)} ${px(y)}`;
  }
  return `polygon(${points})`;
}

// Фазы полёта в момент u (0..1): подъём, смятие, пролёт, затухание и общий масштаб.
function beatAt(u, plan) {
  const lift = easeOut(ramp(u, 0, 0.1));
  const share = ramp(u, 0.06, 0.46);
  const squash = easeInOut(share);
  const q = ramp(u, 0.42, 0.95 - 0.42);
  const pace = q * q * (1.35 - 0.35 * q);
  const fade = ramp(u, 0.95, 1 - 0.95);
  const rolled = mix(1 + 0.014 * lift, plan.crushScale, squash);
  const scale = mix(rolled, plan.gateScale, pace) * mix(1, 0.2, fade);
  return { lift, share, squash, pace, fade, scale };
}

function pairFrame(beat, plan, shape) {
  const { lift, squash, pace, fade, scale } = beat;
  const { start, via, end, drift } = plan;
  const x = bezier(start.x, via.x, end.x, pace) - start.x + drift.x * squash;
  const y = bezier(start.y, via.y, end.y, pace) - start.y + drift.y * squash - 6 * lift * (1 - squash);
  const turn = plan.side * (-1.5 * lift * (1 - squash) + 24 * squash + 320 * pace);
  return {
    transform: `translate(${px(x)}, ${px(y)}) rotate(${turn.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    clipPath: outline(shape, beat.share),
    opacity: 1 - fade,
  };
}

function oldFrame({ lift, squash }) {
  const brightness = 1 + 0.05 * lift * (1 - squash) - 0.14 * squash;
  const contrast = 1 + 0.16 * squash;
  const saturate = 1 - 0.2 * squash;
  return {
    filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)})`,
  };
}

const freshFrame = ({ share }) => ({ opacity: (0.92 * easeOut(clamp01(share * 1.25))).toFixed(3) });

function groupFrame({ scale, fade }) {
  const depth = Math.max(0.12, scale);
  const lift = px(Math.max(3, 26 * depth));
  const blur = px(Math.max(4, 34 * depth));
  return { filter: `drop-shadow(0 ${lift} ${blur} rgba(0, 0, 0, ${(0.5 * (1 - fade)).toFixed(3)}))` };
}

// Все кадры считаются в одном цикле: у смятия, масштаба и пути разные темпы.
function timeline(plan, shape) {
  const sets = { pair: [], old: [], fresh: [], group: [] };
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const beat = beatAt(i / (FRAME_COUNT - 1), plan);
    sets.pair.push(pairFrame(beat, plan, shape));
    sets.old.push(oldFrame(beat));
    sets.fresh.push(freshFrame(beat));
    sets.group.push(groupFrame(beat));
  }
  return [
    ["image-pair", sets.pair],
    ["old", sets.old],
    ["new", sets.fresh],
    ["group", sets.group],
  ];
}

const px = (value) => `${Math.round(value * 10) / 10}px`;
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const ramp = (u, from, span) => clamp01((u - from) / span);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Квадратичная кривая Безье по одной оси.
function bezier(from, via, to, t) {
  const rest = 1 - t;
  return rest * rest * from + 2 * rest * t * via + t * t * to;
}

// Причины отказа по порядку; первая сработавшая и есть ответ.
const BLOCKERS = [
  (doc) => doc.documentElement.classList.contains(FLYING_CLASS),
  (doc) => typeof doc.startViewTransition !== "function",
  (doc) => doc.visibilityState !== "visible",
  (doc) => typeof doc.documentElement.animate !== "function",
  (doc, stage) => !stage?.isConnected,
  (doc, stage) => !showsOnScreen(stage.getBoundingClientRect()),
];

// Точки рамки по часовой стрелке от левого верхнего угла: верх, право, низ, лево.
// Номер на стороне i = 0..7 из 8; по осям x и y отдельно, чтобы не плодить пары.
const RIM_X = [(i, w) => (w * i) / 8, (i, w) => w, (i, w) => w - (w * i) / 8, () => 0];
const RIM_Y = [() => 0, (i, h) => (h * i) / 8, (i, h) => h, (i, h) => h - (h * i) / 8];

// Смещения углов клетки (a, b, c, d = 0, 1, 9, 8): повёрнутая диагональ и обычная.
const CELL_SPLITS = [
  [0, 1, 9, 0, 9, 8],
  [0, 1, 8, 1, 9, 8],
];

const SHADE_KEYFRAMES = [
  { opacity: 0 },
  { opacity: 1, offset: 0.1 },
  { opacity: 1, offset: 0.42 },
  { opacity: 0, offset: 0.72 },
];

const WOBBLE_KEYFRAMES = [
  { transform: "translateY(0) scale(1)" },
  { transform: "translateY(2px) scale(0.94)", offset: 0.3 },
  { transform: "translateY(-3px) scale(1.06)", offset: 0.65 },
  { transform: "translateY(0) scale(1)" },
];

const SHEET_NAME = "astral-work-sheet";
const FLYING_CLASS = "is-work-crumpling";
const FOLDS_CLASS = "work-crumple-folds";
const SHADE_CLASS = "work-crumple-shade";
const BUTTON_SELECTOR = ".sidebar-download-button";
const HOST_SELECTOR = ".desktop-app";
const CORNER_X = 30;
const FRAME_COUNT = 57;
const RIM_POINTS = 32;
const GRID_COLS = 8;
const GRID_ROWS = 6;
const LANDING_SHARE = 0.95;
const WOBBLE_MS = 520;
