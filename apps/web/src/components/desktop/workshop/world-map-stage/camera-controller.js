// Камера большой карты без React: живой кадр жеста, фиксация, колесо, перелёт, сдвиг, шаги.
// Всё, что нужно снаружи, приходит через порты:
//   snap()      → { frame, canvas, scene, win, projector } последней отрисовки
//   writeView   → записать кадр в состояние (и в память редактора)
//   svg(), stage() → узлы; motionOff() → без движения; floor → { sync(view) }
//   onView(payload), onZoom(zoom, dots) → сообщения наверх
import { resolveFrame, clampView, glideZoom, zoomAround, panFrame } from "../world-map-frame.js";
import { zoomPath, flightDuration, easeInOut } from "../world-map-flight.js";
import { canvasFrameOf, canvasTransform, dotsPerUnit, escapesCanvas, stretchedBeyond, nearlySameView, clampZoom, centerOfFrame, viewAtPathPoint } from "./frame-math.js";
import { QUIET_MS, FRAME_MS, GLIDE_TAU_MS, FALLBACK_WIDTH, CLICK_SLOP, FLIGHT_SKIP_SPAN, FLIGHT_ARRIVE_SHARE } from "./numbers.js";

const PUBLIC = [
  "onWheel", "beginPan", "dragPan", "settle", "halt", "stopWheel", "zoomBy", "nudge", "goHome",
  "flyTo", "sync", "tellFrame", "tellZoomNow", "current", "isMoving", "holdMs", "dispose",
];

const toUnit = (value) => Math.min(1, Math.max(0, value));

class Camera {
  #ports;
  #live = null;
  // кадр, уже записанный в состояние, но ещё не отрисованный
  #pending = null;
  #quiet = null;
  #wheel = null;
  #flight = null;
  #arriveAt = 0;
  #sentKey = "";

  constructor(ports) {
    this.#ports = ports;
    PUBLIC.forEach((name) => {
      this[name] = this[name].bind(this);
    });
  }

  // ——— мелочи ———
  #put(view) {
    this.#pending = view;
    this.#ports.writeView(view);
  }

  #resolve(view) {
    const { scene, win } = this.#ports.snap();
    return resolveFrame(view, scene, win);
  }

  current() {
    const view = this.#live ?? this.#pending;
    return view ? this.#resolve(view) : this.#ports.snap().frame;
  }

  #dropQuiet() {
    clearTimeout(this.#quiet ?? undefined);
    this.#quiet = null;
  }

  #armQuiet() {
    this.#dropQuiet();
    this.#quiet = setTimeout(() => {
      this.#quiet = null;
      this.settle(true);
    }, QUIET_MS);
  }

  // Нарисованный холст едет трансформом к живому кадру; нет живого кадра - трансформ снят
  #paint() {
    const el = this.#ports.svg();
    if (!el) return;
    if (!this.#live) {
      el.style.transform = "";
      return;
    }
    const { canvas, win } = this.#ports.snap();
    const goal = canvasFrameOf(this.#resolve(this.#live));
    el.style.transform = canvasTransform(canvas, goal, win.width * 1.5);
  }

  tellFrame(resolved) {
    const { win } = this.#ports.snap();
    const key = [
      resolved.x, resolved.y, resolved.width, resolved.height, resolved.zoom, win.width, win.height,
    ].join("|");
    if (key === this.#sentKey) return;
    this.#sentKey = key;
    this.#ports.onView({ ...resolved, pixels: { width: win.width, height: win.height } });
  }

  tellZoomNow(zoom) {
    const { scene, win } = this.#ports.snap();
    this.#ports.onZoom(zoom, dotsPerUnit(win, zoom, scene));
  }

  isMoving() {
    return [this.#live, this.#flight, this.#quiet].some((one) => one !== null);
  }

  // сколько мс осталось до «камера подъехала» (0, если камера не летит)
  holdMs() {
    if (!this.#flight) return 0;
    return Math.max(0, Math.round(this.#arriveAt - performance.now()));
  }

  sync() {
    this.#pending = null;
    this.#paint();
    if (!this.#live) this.#ports.floor.sync(null);
  }

  // ——— живой кадр ———
  // Живой шаг: кадр не идёт в состояние, пока не вышел за запас холста (ключевой кадр)
  #step(wanted, { timer = false, flight: flying = false } = {}) {
    const { scene, win, canvas } = this.#ports.snap();
    const view = clampView(wanted, scene, win);
    const resolved = resolveFrame(view, scene, win);
    this.#live = view;
    this.tellFrame(resolved);
    this.#paint();
    const goalWidth = canvasFrameOf(resolved).width;
    const keyframe =
      escapesCanvas(resolved, canvas) ||
      (flying && stretchedBeyond(canvas.width / goalWidth));
    this.#ports.floor.sync(view);
    // ключевой кадр встаёт в состояние как обычная фиксация: живой кадр сброшен, трансформ
    // снимется со сменой холста; на колесе вместо него остаётся таймер тишины
    if (keyframe) {
      this.#live = null;
      this.#put(view);
    }
    if (timer) this.#armQuiet();
  }

  // Зафиксировать живой кадр. Возвращает кадр, с которого надо продолжать
  settle(announce = true) {
    this.#dropQuiet();
    const gone = this.#live;
    this.#live = null;
    const shown = this.current();
    let base = shown;
    if (gone) {
      base = this.#resolve(gone);
      this.tellFrame(base);
      if (!nearlySameView(gone, shown)) this.#put(gone);
      else if (!this.#pending) {
        this.#paint();
        this.#ports.floor.sync(null);
      }
    }
    if (announce) this.tellZoomNow(base.zoom);
    return base;
  }

  // ——— остановки ———
  stopWheel() {
    if (this.#wheel) cancelAnimationFrame(this.#wheel.raf);
    this.#wheel = null;
  }

  #stopFlight(fix) {
    if (!this.#flight) return;
    cancelAnimationFrame(this.#flight.raf);
    this.#flight = null;
    if (fix) this.settle(true);
  }

  halt() {
    this.stopWheel();
    this.#stopFlight(true);
  }

  dispose() {
    this.#dropQuiet();
    this.stopWheel();
    this.#stopFlight(false);
    this.#live = null;
  }

  // ——— колесо и щипок ———
  #wheelAnchor({ clientX, clientY }) {
    const rect = this.#ports.stage()?.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return { x: 0.5, y: 0.5 };
    return {
      x: toUnit((clientX - rect.left) / rect.width),
      y: toUnit((clientY - rect.top) / rect.height),
    };
  }

  #wheelTick = (stamp) => {
    const run = this.#wheel;
    if (!run) return;
    const { scene, win } = this.#ports.snap();
    const base = this.current();
    const dt = run.last === null ? FRAME_MS : Math.min(100, Math.max(0, stamp - run.last));
    run.last = stamp;
    const next = run.instant
      ? run.target
      : glideZoom(base.zoom, run.target, dt, GLIDE_TAU_MS);
    if (next !== base.zoom) {
      this.#step(zoomAround(base, run.anchor, next, scene, win), { timer: true });
    }
    if (next !== run.target) {
      run.raf = requestAnimationFrame(this.#wheelTick);
      return;
    }
    this.#wheel = null;
  };

  #zoomIntent(intent, event) {
    const run = this.#wheel;
    const base = run ? run.target : (this.#live ?? this.#ports.snap().frame).zoom;
    const fresh = {
      target: clampZoom(base * intent.factor),
      instant: this.#ports.motionOff() || !intent.glide,
      anchor: this.#wheelAnchor(event),
    };
    if (run) {
      Object.assign(run, fresh);
      return;
    }
    this.#wheel = { ...fresh, last: null, raf: 0 };
    this.#wheel.raf = requestAnimationFrame(this.#wheelTick);
  }

  #panIntent({ dx, dy }) {
    const base = this.current();
    const perDot = base.width / (this.#ports.snap().win.width || FALLBACK_WIDTH);
    this.#step(
      { x: base.x + dx * perDot, y: base.y + dy * perDot, zoom: base.zoom },
      { timer: true },
    );
  }

  onWheel(intent, event) {
    this.#stopFlight(true);
    const handlers = { zoom: () => this.#zoomIntent(intent, event), pan: () => this.#panIntent(intent) };
    handlers[intent.kind]?.();
  }

  // ——— сдвиг рукой ———
  beginPan(clientX, clientY) {
    this.#dropQuiet();
    return { x: clientX, y: clientY, base: this.current(), moved: false };
  }

  dragPan(pan, clientX, clientY) {
    const shift = { x: clientX - pan.x, y: clientY - pan.y };
    pan.moved = pan.moved || Math.hypot(shift.x, shift.y) > CLICK_SLOP;
    const { scene, win } = this.#ports.snap();
    this.#step(panFrame(pan.base, shift, win, scene, win));
  }

  // ——— шаги сразу в состояние: кнопки, клавиши, команда ———
  #beforeStep() {
    this.stopWheel();
    this.#stopFlight(false);
    return this.settle(true);
  }

  zoomBy(factor) {
    const base = this.#beforeStep();
    const { scene, win } = this.#ports.snap();
    // шаг идёт к середине кадра: якорь - доля кадра, выведенная из точки сцены
    const mid = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
    const anchor = { x: (mid.x - base.x) / base.width, y: (mid.y - base.y) / base.height };
    const zoom = clampZoom(base.zoom * factor);
    this.#put(clampView(zoomAround(base, anchor, zoom, scene, win), scene, win));
  }

  nudge(dotsX, dotsY) {
    const base = this.#beforeStep();
    const { scene, win } = this.#ports.snap();
    this.#put(panFrame(base, { x: -dotsX, y: -dotsY }, win, scene, win));
  }

  // «fit» перелёт не обрывает и живой кадр не фиксирует: кадр встаёт сразу, перелёт идёт дальше
  goHome() {
    this.stopWheel();
    if (!this.#flight) this.settle(true);
    this.#put({ x: 0, y: 0, zoom: 1 });
  }

  // ——— перелёт ———
  #land(goal) {
    this.#dropQuiet();
    this.#live = null;
    this.#put(goal);
  }

  flyTo(goal) {
    this.stopWheel();
    this.#stopFlight(false);
    const path = zoomPath(
      centerOfFrame(this.current()),
      centerOfFrame(this.#resolve(goal)),
    );
    if (this.#ports.motionOff() || path.span < FLIGHT_SKIP_SPAN) {
      this.#land(goal);
      return;
    }
    const length = flightDuration(path);
    const began = performance.now();
    this.#arriveAt = began + length * FLIGHT_ARRIVE_SHARE;
    const run = { raf: 0 };
    const fly = () => {
      const t = Math.min(1, (performance.now() - began) / length);
      if (t >= 1) {
        this.#flight = null;
        this.#land(goal);
        this.tellZoomNow(goal.zoom);
        return;
      }
      run.raf = requestAnimationFrame(fly);
      const { scene, win } = this.#ports.snap();
      const view = viewAtPathPoint(path(easeInOut(t)), scene, win);
      this.#step(view, { flight: true });
    };
    this.#flight = run;
    run.raf = requestAnimationFrame(fly);
  }
}

export const createCameraController = (ports) => new Camera(ports);
