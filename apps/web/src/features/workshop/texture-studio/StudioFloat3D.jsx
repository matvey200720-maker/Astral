// Плавающее окно «3D-вид» студии: объект редактора с текстурой холста, которая обновляется на лету.

import {
  FollowStageContext,
  LiveStageContext,
  createLiveRepaint,
  registerLiveFinish,
  unregisterLiveFinish,
} from "../finish/live-finish.js";
import * as THREE from "three";
import { EditorNotesContext } from "../../../components/ui/editor-notes.js";
import Button from "../../../components/ui/Button.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFloatPacer } from "./float-pacer.js";
import { createPortal } from "react-dom";
import ModelStage from "../model-stage/ModelStage.jsx";
import { Cube, EyeSlash, Minus } from "../../../components/ui/icons.jsx";

/* ---------- постоянные ---------- */

const deepFreeze = (tree) => {
  Object.values(tree).forEach((part) => typeof part === "object" && deepFreeze(part));
  return Object.freeze(tree);
};
const zeroBox = (...keys) => Object.fromEntries(keys.map((key) => [key, 0]));

export const FLOAT_EDGE = 16;
export const FLOAT_REFRESH_MS = 120,
  RELOAD_REFRESH_MS = 300;
export const FLOAT_EDGES = Object.freeze("n ne e se s sw w nw".split(" "));
export const FLOAT_HOME = deepFreeze(
  Object.fromEntries([
    ["h", "right"],
    ["v", "bottom"],
    ["dx", FLOAT_EDGE],
    ["dy", FLOAT_EDGE],
  ]),
);

const [MIN_WIDTH, MIN_HEIGHT, DEFAULT_SHARE] = [260, 190, 0.5];
const [STEP, SNAP, CLICK_SLOP, SETTLE_MS, PREVIEW_SIDE] = [24, 56, 4, 180, 2048];
const [PILL_WIDTH, PILL_HEIGHT] = [132, 36];
const STORE_KEY = "modovik-studio-float";
const PLACE_KEYS = ["h", "v", "dx", "dy"];
const MODES = Object.freeze("open pill hidden".split(" "));
const PILL = deepFreeze({ width: PILL_WIDTH, height: PILL_HEIGHT });
const NO_SPACE = deepFreeze({
  bounds: zeroBox("width", "height"),
  canvas: zeroBox("left", "top", "width", "height"),
});
const REDRAW_KINDS = new Set(["history", "doc", "busy"]);
const GESTURE_END = ["pointerup", "pointercancel"];
const ARROWS = new Map([
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, -1]],
  ["ArrowDown", [0, 1]],
]);

export const FLOAT_PRESETS = Object.freeze(
  [
    ["s", "S", 0.32, "Маленький 3D-вид"],
    ["m", "M", DEFAULT_SHARE, "Средний 3D-вид"],
    ["l", "L", 0.72, "Большой 3D-вид"],
  ].map(([id, short, share, label]) => Object.freeze({ id, short, share, label })),
);

// Оси окна: размер, ближняя сторона, дальняя, ключ стороны, ключ отступа, минимум.
const ACROSS = ["width", "left", "right", "h", "dx", MIN_WIDTH];
const DOWN = ["height", "top", "bottom", "v", "dy", MIN_HEIGHT];
const AXES = [ACROSS, DOWN];

/* ---------- арифметика и геометрия ---------- */

function clamp(value, low, high) {
  const lifted = Math.max(low, value);
  return Math.min(high, lifted);
}
const equalBy = (keys) => (a, b) => keys.every((key) => a[key] === b[key]);
const sameAnchor = equalBy(PLACE_KEYS);
const sameBox = equalBy(["left", "top", "width", "height"]);
const sameDims = equalBy(["width", "height"]);
// Векторы — пары [x, y].
const vecOf = ({ x, y }) => [x, y];
const minus = (a, b) => a.map((part, i) => part - b[i]);
const bump = (setter) => () => setter((value) => value + 1);

// Свободное место по оси для отступа окна.
const roomFor = (total, taken) => Math.max(FLOAT_EDGE, (total || 0) - (taken || 0) - FLOAT_EDGE);

export const floatSize = (area, own = null, bounds = area) =>
  area?.width && area?.height
    ? Object.fromEntries(
        AXES.map(([dim, , , , , floor]) => [
          dim,
          clamp(own?.[dim] ?? area[dim] * DEFAULT_SHARE, floor, Math.max(floor, bounds[dim] - FLOAT_EDGE * 2)),
        ]),
      )
    : null;

export const floatPresetSize = (area, id, bounds = area) => {
  const preset = FLOAT_PRESETS.find((item) => item.id === id);
  if (!(preset && area?.width && area?.height)) return null;
  const scaled = Object.fromEntries(AXES.map(([dim]) => [dim, Math.round(area[dim] * preset.share)]));
  return floatSize(area, scaled, bounds);
};

export const floatClamp = (bounds, size, place = FLOAT_HOME) => {
  const [side, edge] = AXES.map(([, near, far, sideKey]) => (place[sideKey] === near ? near : far));
  const [dx, dy] = AXES.map(([dim, , , , gapKey]) =>
    clamp(place[gapKey], FLOAT_EDGE, roomFor(bounds?.[dim], size?.[dim])),
  );
  return { h: side, v: edge, dx, dy };
};

export const floatPoint = (bounds, size, place = FLOAT_HOME) => {
  const docked = floatClamp(bounds, size, place);
  const [x, y] = AXES.map(([dim, near, , sideKey, gapKey]) =>
    docked[sideKey] === near ? docked[gapKey] : bounds[dim] - size[dim] - docked[gapKey],
  );
  return { x, y };
};

// Одна ось места после броска: к какой стороне ближе и какой отступ (с прилипанием к краю).
const settleAxis = ([dim, near, far], start, bounds, size, snap) => {
  const beyond = start + size[dim] / 2 > bounds[dim] / 2;
  const gap = beyond ? bounds[dim] - size[dim] - start : start;
  return [beyond ? far : near, Math.round(snap && gap < FLOAT_EDGE + SNAP ? FLOAT_EDGE : gap)];
};

export const floatSettle = (bounds, size, x, y, options = {}) => {
  const { snap = true } = options;
  const [[side, dx], [edge, dy]] = [x, y].map((start, i) => settleAxis(AXES[i], start, bounds, size, snap));
  return floatClamp(bounds, size, { h: side, v: edge, dx, dy });
};

export const floatHome = (bounds, canvas) => {
  if (!(bounds?.width && canvas?.width)) return FLOAT_HOME;
  const [dx, dy] = AXES.map(
    ([dim, near]) => Math.max(0, Math.round(bounds[dim] - canvas[near] - canvas[dim])) + FLOAT_EDGE,
  );
  return { h: "right", v: "bottom", dx, dy };
};

export const floatCorner = (bounds, canvas, place) => {
  const measured = bounds?.width && canvas?.width;
  const [dx, dy] = AXES.map(([dim, near, , sideKey]) => {
    if (!measured) return FLOAT_EDGE;
    const gap = place[sideKey] === near ? canvas[near] : bounds[dim] - canvas[near] - canvas[dim];
    return Math.max(0, Math.round(gap)) + FLOAT_EDGE;
  });
  const { h: side, v: edge } = place;
  return { h: side, v: edge, dx, dy };
};

// Буква края, сторона рамки, номер оси сдвига и пределы (порядок w, e, n, s важен).
const EDGE_RULES = [
  ["w", "left", 0, (box) => [FLOAT_EDGE, box.right - MIN_WIDTH]],
  ["e", "right", 0, (box, bounds) => [box.left + MIN_WIDTH, bounds.width - FLOAT_EDGE]],
  ["n", "top", 1, (box) => [FLOAT_EDGE, box.bottom - MIN_HEIGHT]],
  ["s", "bottom", 1, (box, bounds) => [box.top + MIN_HEIGHT, bounds.height - FLOAT_EDGE]],
];

export const floatResize = (bounds, origin, edge, dx, dy) => {
  const box = { left: origin.x, top: origin.y, right: origin.x + origin.width, bottom: origin.y + origin.height };
  for (const [letter, side, axis, limits] of EDGE_RULES) {
    if (!edge.includes(letter)) continue;
    const [low, high] = limits(box, bounds);
    box[side] = clamp(box[side] + [dx, dy][axis], low, high);
  }
  const [x, y] = [box.left, box.top].map(Math.round);
  const [width, height] = [box.right - box.left, box.bottom - box.top].map(Math.round);
  return { x, y, width, height };
};

/* ---------- память окна ---------- */

const validPlace = (place) =>
  AXES.every(
    ([, near, far, sideKey, gapKey]) => [near, far].includes(place?.[sideKey]) && Number.isFinite(place[gapKey]),
  );

// Сбой хранилища или битый JSON читаются как пустая запись.
const loadStored = () => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const readFloatState = () => {
  const value = loadStored();
  const [width, height, place] = [value?.width, value?.height, value?.place];
  const trusted = value?.space === "window" && validPlace(place);
  const mode = MODES.includes(value?.mode) ? value.mode : "open";
  return {
    size: width > 0 && height > 0 ? { width, height } : null,
    place: trusted ? Object.fromEntries(PLACE_KEYS.map((key) => [key, place[key]])) : FLOAT_HOME,
    mode,
  };
};

const writeFloatState = ({ size, place, mode }) => {
  const kept = place === FLOAT_HOME ? null : place;
  const record = Object.assign({}, size, { place: kept, space: "window", mode });
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch {
    /* хранилище закрыто */
  }
};

/* ---------- рисование прямо в узел, в обход React ---------- */

const anchorStyle = (place) =>
  Object.fromEntries([
    [place.h, place.dx],
    [place.v, place.dy],
  ]);

const paintRect = (box, { x, y, width, height }) =>
  Object.assign(box.style, {
    left: `${x}px`,
    top: `${y}px`,
    right: "auto",
    bottom: "auto",
    width: `${width}px`,
    height: `${height}px`,
  });

const paintAnchor = (box, place, size) => {
  const sides = AXES.flatMap(([, near, far, sideKey, gapKey]) =>
    [near, far].map((side) => [side, place[sideKey] === side ? `${place[gapKey]}px` : ""]),
  );
  Object.assign(box.style, Object.fromEntries(sides), { width: `${size.width}px`, height: `${size.height}px` });
};

const shiftCss = (vec) => `translate3d(${vec.map((part) => part.toFixed(1)).join("px, ")}px, 0)`;

// Доезд к якорю после броска: узел «стоит» на старом месте, потом едет на новое.
const consumeSettle = (root, dragRef) => {
  const [box, offset] = [root.current, dragRef.current.offset];
  dragRef.current.offset = null;
  if (!(box && offset)) return;
  const { classList, style } = box;
  classList.remove("is-settling");
  style.transform = shiftCss(offset);
  void box.offsetWidth;
  classList.add("is-settling");
  style.transform = "";
  window.setTimeout(classList.remove.bind(classList, "is-settling"), SETTLE_MS + 40);
};

/* ---------- жесты ---------- */

// Каркас жеста: слушатели на ручке, перерисовка не чаще раза в кадр, снятие всего в конце.
// onMove, вернувший false, кадр не заказывает.
const startGesture = (handle, pointerId, { onMove, onPaint, onEnd }) => {
  const pending = { frame: 0 };
  const wiring = [];
  const flush = () => {
    pending.frame = 0;
    onPaint();
  };
  function finish() {
    wiring.forEach(([type, fn]) => handle.removeEventListener(type, fn));
    if (pending.frame) cancelAnimationFrame(pending.frame);
    onEnd();
  }
  wiring.push(
    [
      "pointermove",
      (moved) => {
        if (onMove(moved) !== false && !pending.frame) pending.frame = requestAnimationFrame(flush);
      },
    ],
    ...GESTURE_END.map((type) => [type, finish]),
  );
  handle.setPointerCapture?.(pointerId);
  wiring.forEach(([type, fn]) => handle.addEventListener(type, fn));
};

// Протяжка за край или угол: старт считает фабрика, ход и финиш — план жеста.
const resizeStart = (env, event, edge) => {
  const origin = { ...floatPoint(env.bounds, env.size, env.anchored), ...env.size };
  return { edge, origin, rect: origin, start: [event.clientX, event.clientY] };
};

const resizePlan = (env, box, g) => ({
  onMove: ({ clientX, clientY }) => {
    const [dx, dy] = minus([clientX, clientY], g.start);
    g.rect = floatResize(env.bounds, g.origin, g.edge, dx, dy);
  },
  onPaint: () => paintRect(box, g.rect),
  onEnd: () => {
    box.classList.remove("is-resizing");
    if (g.rect === g.origin) return;
    const { width, height } = g.rect;
    const next = { width, height };
    const landed = floatSettle(env.bounds, next, ...vecOf(g.rect), { snap: false });
    paintAnchor(box, landed, next);
    env.setOwn(next);
    env.setPlace(env.keepHome(landed));
  },
});

const beginResize = (env, event) => {
  const box = env.root.current;
  if (event.button > 0 || !(box && env.size && env.bounds.width)) return;
  event.preventDefault();
  const grip = event.currentTarget;
  startGesture(grip, event.pointerId, resizePlan(env, box, resizeStart(env, event, grip.dataset.edge || "se")));
  box.classList.add("is-resizing");
};

// Размер с клавиатуры: Alt + стрелка двигает ближайший к стрелке край.
const keyResize = (env, [sx, sy]) => {
  const { bounds, size, anchored } = env;
  const edge = (sy ? (anchored.v === "bottom" ? "n" : "s") : "") + (sx ? (anchored.h === "right" ? "w" : "e") : "");
  const rect = floatResize(bounds, { ...floatPoint(bounds, size, anchored), ...size }, edge, sx, sy);
  const { width, height } = rect;
  const next = { width, height };
  const [dx, dy] = AXES.map(([dim, near, , sideKey], i) => {
    const start = i ? rect.y : rect.x;
    return anchored[sideKey] === near ? start : bounds[dim] - start - rect[dim];
  });
  const { h: side, v: edgeV } = anchored;
  env.setOwn(next);
  env.setPlace(env.keepHome(floatClamp(bounds, next, { h: side, v: edgeV, dx, dy })));
};

// Сдвиг окна стрелкой без Alt.
const nudge = (env, shift) => {
  const shape = env.shownSize();
  const corner = vecOf(floatPoint(env.bounds, shape, env.anchored));
  const [x, y] = corner.map((part, i) => part + shift[i]);
  env.setPlace(floatSettle(env.bounds, shape, x, y, { snap: false }));
};

// Перетаскивание за шапку или таблетку: сдвиг короче CLICK_SLOP жестом не считается.
const movePlan = (env, box, g) => {
  const { bounds, dragRef } = env;
  const mem = dragRef.current;
  const release = () => {
    mem.moved = false;
  };
  const land = () => {
    // Щелчок, что браузер пришлёт следом, — часть броска.
    window.setTimeout(release, 0);
    const next = floatSettle(bounds, g.shape, ...g.at);
    mem.offset = minus(g.at, vecOf(floatPoint(bounds, g.shape, next)));
    return sameAnchor(next, env.anchored) ? consumeSettle(env.root, dragRef) : env.setPlace(env.keepHome(next));
  };
  const drop = () => {
    box.style.transform = "";
  };
  return {
    onMove: ({ clientX, clientY }) => {
      const shift = minus([clientX, clientY], g.start);
      if (!mem.moved) {
        if (Math.hypot(...shift) < CLICK_SLOP) return false;
        box.classList.add("is-moving");
        mem.moved = true;
      }
      g.at = AXES.map(([dim], i) => clamp(g.from[i] + shift[i], 0, Math.max(0, bounds[dim] - g.shape[dim])));
      return true;
    },
    onPaint: () => {
      box.style.transform = shiftCss(minus(g.at, g.from));
    },
    onEnd: () => {
      box.classList.remove("is-moving");
      (mem.moved ? land : drop)();
    },
  };
};

const beginMove = (env, event) => {
  const box = env.root.current;
  if (event.button > 0 || !(box && env.bounds.width)) return;
  const shape = env.shownSize();
  const from = vecOf(floatPoint(env.bounds, shape, env.anchored));
  const g = { shape, from, at: from, start: [event.clientX, event.clientY] };
  env.dragRef.current.moved = false;
  startGesture(event.currentTarget, event.pointerId, movePlan(env, box, g));
};

// Стрелка: без Alt окно едет, с Alt тянется край.
const steer = (env, event, unit) => {
  event.preventDefault();
  const shift = unit.map((part) => part * STEP * (event.shiftKey ? 3 : 1));
  (event.altKey && env.open && env.size ? keyResize : nudge)(env, shift);
};

const onFloatKey = (env, event) => {
  if (!env.bounds.width) return;
  const unit = ARROWS.get(event.key);
  if (unit) return steer(env, event, unit);
  if (event.key !== "Home") return;
  event.preventDefault();
  env.setPlace(FLOAT_HOME);
};

/* ---------- хуки ---------- */

const dimsOf = ({ clientWidth: width, clientHeight: height }) => ({ width, height });

// Мера хозяина окна и холста внутри него.
const surveySpace = (host, parent) => {
  const canvas = { left: 0, top: 0, ...dimsOf(parent) };
  if (parent !== host) {
    const [at, base] = [parent, host].map((node) => node.getBoundingClientRect());
    const [left, top] = ["left", "top"].map((side) => Math.round(at[side] - base[side]));
    Object.assign(canvas, { left, top });
  }
  return { bounds: dimsOf(host), canvas };
};

// Метка в дереве, хозяин окна (корень студии) и его мера вместе с холстом.
const locateHost = (marker) => marker?.closest(".txs-root") ?? marker?.parentElement ?? null;

const useFloatSpace = () => {
  const slot = useRef(null);
  const [space, setSpace] = useState(() => NO_SPACE);
  const [host, setHost] = useState(null);
  useLayoutEffect(function findHost() {
    setHost(locateHost(slot.current));
  }, []);
  useEffect(
    function watchSpace() {
      if (!host) return undefined;
      const parent = slot.current?.parentElement;
      if (!parent) return undefined;
      const measure = () => {
        const next = surveySpace(host, parent);
        setSpace((prev) => (sameDims(prev.bounds, next.bounds) && sameBox(prev.canvas, next.canvas) ? prev : next));
      };
      const Observer = typeof ResizeObserver === "function" ? ResizeObserver : null;
      measure();
      if (!Observer) return undefined;
      const observer = new Observer(measure);
      new Set([host, parent]).forEach((node) => observer.observe(node));
      return () => observer.disconnect();
    },
    [host],
  );
  return { slot, host, space };
};

// Место и размер окна, его якорь и запоминание «домашнего» места.
const useFloatBox = (space, saved, open) => {
  const { bounds, canvas } = space;
  const [place, setPlace] = useState(() => saved.place);
  const [own, setOwn] = useState(() => saved.size);
  const root = useRef(null);
  const area = useMemo(() => Object.fromEntries(AXES.map(([dim]) => [dim, canvas[dim]])), [canvas]);
  const home = useMemo(function homeSpot() {
    return floatHome(bounds, canvas);
  }, [bounds, canvas]);
  const size = useMemo(function boxSize() {
    return floatSize(area, own, bounds);
  }, [area, own, bounds]);
  const shownSize = useCallback(
    function shownShape() {
      if (open && size) return size;
      const { offsetWidth, offsetHeight } = root.current ?? {};
      return offsetWidth ? { width: offsetWidth, height: offsetHeight } : PILL;
    },
    [open, size],
  );
  const anchored = useMemo(
    function dockedAt() {
      const free = place !== FLOAT_HOME;
      const target = free ? place : home;
      if (!bounds.width) return target;
      return floatClamp(bounds, open && size ? size : PILL, target);
    },
    [bounds, open, size, place, home],
  );
  const keepHome = useCallback(
    function stayHome(landed) {
      if (place !== FLOAT_HOME) return landed;
      return sameAnchor(landed, anchored) ? FLOAT_HOME : landed;
    },
    [place, anchored],
  );
  const placing = { own, setOwn, place, setPlace };
  const geometry = { area, size, shownSize, anchored, keepHome };
  return { root, ...placing, ...geometry };
};

// Снять кадр холста студии в холст текстуры.
const paintPreview = (flat, canvas) => {
  const context = canvas.getContext("2d");
  const span = [canvas.width, canvas.height];
  context.clearRect(0, 0, ...span);
  Object.assign(context, { imageSmoothingQuality: "high" });
  context.drawImage(flat, 0, 0, ...span);
};

// Текстура холста студии, ужатая до PREVIEW_SIDE по большей стороне.
const makePreviewTexture = ({ compositor, width, height }) => {
  if (typeof document === "undefined" || !compositor.flat?.canvas) return null;
  const shrink = Math.min(PREVIEW_SIDE / Math.max(width, height), 1);
  const canvas = Object.assign(document.createElement("canvas"), {
    width: Math.max(1, Math.round(width * shrink)),
    height: Math.max(1, Math.round(height * shrink)),
  });
  return Object.assign(new THREE.CanvasTexture(canvas), {
    colorSpace: THREE.NoColorSpace,
    flipY: false,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    anisotropy: 4,
  });
};

const useStudioTexture = (session) => {
  const texture = useMemo(() => makePreviewTexture(session), [session]);
  useEffect(
    function disposeTexture() {
      return () => texture?.dispose();
    },
    [texture],
  );
  return texture;
};

// Кадр редактора читает текстуру по ключу, поэтому рисуем, только когда ключ занят.
const useLiveKey = (view3d, texture) => {
  const [keyed, setKeyed] = useState(false);
  useEffect(
    function holdKey() {
      if (!(view3d.asset && texture)) return undefined;
      setKeyed(true);
      registerLiveFinish(view3d.asset, texture);
      return function releaseKey() {
        setKeyed(false);
        unregisterLiveFinish(view3d.asset, texture);
      };
    },
    [view3d.asset, texture],
  );
  return keyed;
};

// Живой облик отделки: tick растёт, когда облик просит перерисовку.
const useLiveLook = (view3d, texture) => {
  const [tick, setTick] = useState(() => 0);
  const [live, setLive] = useState(() => null);
  useEffect(
    function openLive() {
      if (typeof view3d.live !== "function" || !texture) return undefined;
      const next = view3d.live(texture.image, { refresh: bump(setTick) });
      setLive(next);
      return function closeLive() {
        next.dispose?.();
      };
    },
    [texture, view3d],
  );
  return { live, tick, setTick };
};

// Один проход обновления: холст студии -> текстура -> облик -> кадр.
const refreshOnce = (ctx) => {
  const canvas = ctx.open && ctx.texture?.image;
  const flat = canvas && ctx.session.compositor.flat?.canvas;
  if (!(canvas && flat)) return;
  paintPreview(flat, canvas);
  ctx.texture.needsUpdate = true;
  const followers = [
    () => ctx.live?.update?.(canvas),
    () => ctx.stageRef.current?.repaint?.(),
    () => ctx.repaint.fire(),
    bump(ctx.setTick),
  ];
  if (ctx.view3d.reloads) followers.push(bump(ctx.setVersion));
  followers.forEach((notify) => notify());
};

const useRefreshPacer = (session, view3d, preview, views) => {
  const { texture, live, open } = preview;
  const { flatVersion, repaint } = preview;
  const latest = useRef({ run: null, gap: FLOAT_REFRESH_MS });
  latest.current = {
    run: () => refreshOnce({ session, view3d, ...preview, ...views }),
    gap: view3d.reloads || typeof view3d.live === "function" ? RELOAD_REFRESH_MS : FLOAT_REFRESH_MS,
  };
  const pacer = useMemo(
    function makePacer() {
      return createFloatPacer({
        run() {
          return latest.current.run?.();
        },
        gap() {
          return latest.current.gap;
        },
      });
    },
    [],
  );
  useEffect(
    function kickOff() {
      if (open && texture) {
        pacer.schedule(false);
      }
    },
    [flatVersion, open, texture, session, live, repaint, pacer],
  );
  useEffect(
    function followSession() {
      if (!open || !texture) return undefined;
      const onSessionEvent = ({ kind }) => REDRAW_KINDS.has(kind) && pacer.schedule(true);
      return session.subscribe(onSessionEvent);
    },
    [session, open, texture, pacer],
  );
  useEffect(
    function cancelOnLeave() {
      return () => pacer.cancel();
    },
    [texture, open, pacer],
  );
};

// Что показать в окне: облик и объекты для обычного кадра, готовый кадр редактора.
const useStageContent = (view3d, { live, texture, tick }, { keyed, version }) => {
  const look = useMemo(
    function lookNow() {
      if (live) return live.look();
      if (!texture || !view3d.lookFor) return null;
      return view3d.lookFor(texture);
    },
    [live, texture, view3d, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const objects = useMemo(
    function objectsNow() {
      return live?.objects ? live.objects() : null;
    },
    [live, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const editorStage = useMemo(
    function editorFrame() {
      if (!keyed || typeof view3d.stage !== "function") return null;
      return view3d.stage(version);
    },
    [keyed, view3d, version],
  );
  return { look, objects, editorStage };
};

// Какой из быстрых размеров сейчас стоит (с точностью до пикселя).
const matchPreset = (area, bounds, size) => {
  const hit = (item) => {
    const other = floatPresetSize(area, item.id, bounds);
    return other && AXES.every(([dim]) => Math.abs(other[dim] - size[dim]) <= 1);
  };
  return size ? FLOAT_PRESETS.find(hit)?.id || "" : "";
};

/* ---------- разметка ---------- */

// Малая кнопка окна; сверху лежат умолчания, остальное — поверх них в заданном порядке.
const softButton = (props, ...kids) => h(Button, { size: "sm", variant: "ghost", ...props }, ...kids);

const pillView = (drag, onClick) =>
  softButton(
    {
      className: "txs-float-pill",
      icon: h(Cube),
      "aria-label": tr("Развернуть 3D-вид"),
      title: tr("Щёлкните, чтобы развернуть; потяните, чтобы переместить"),
      ...drag,
      onClick,
    },
    tr("3D-вид"),
  );

const headerView = ({ drag, active, choose, setMode }) =>
  h(
    "header",
    null,
    softButton(
      {
        className: "txs-float-handle",
        icon: h(Cube),
        "aria-label": tr(
          "Переместить 3D-вид: потяните за шапку или стрелками; Alt + стрелки — размер; Home — в правый нижний угол",
        ),
        title: tr("Потяните, чтобы переместить куда угодно; размер — за края и углы окна"),
        ...drag,
      },
      tr("3D-вид"),
    ),
    h(
      "div",
      { className: "txs-float-tools" },
      h(
        "div",
        { className: "txs-float-sizes", role: "group", "aria-label": tr("Размер 3D-вида") },
        ...FLOAT_PRESETS.map((item) =>
          softButton(
            {
              key: item.id,
              variant: active === item.id ? "secondary" : "ghost",
              "aria-pressed": active === item.id,
              "aria-label": tr(item.label),
              title: tr(item.label),
              onClick: () => choose(item.id),
            },
            item.short,
          ),
        ),
      ),
      softButton({
        icon: h(Minus),
        "aria-label": tr("Свернуть 3D-вид в таблетку"),
        title: tr("Свернуть 3D-вид в таблетку"),
        onClick: () => setMode("pill"),
      }),
      softButton({
        icon: h(EyeSlash),
        "aria-label": tr("Скрыть 3D-вид"),
        title: tr("Скрыть 3D-вид — вернуть кнопкой «3D-вид» в углу холста"),
        onClick: () => setMode("hidden"),
      }),
    ),
  );

// Содержимое окна: готовый кадр редактора или обычная сцена с текстурой студии.
const stageView = ({ editorStage, repaint, modelProps }) => {
  if (editorStage) {
    return h(
      LiveStageContext.Provider,
      { value: repaint },
      h("div", { className: "txs-float-stage is-editor" }, editorStage),
    );
  }
  return modelProps.look ? h("div", { className: "txs-float-stage" }, h(ModelStage, modelProps)) : null;
};

const edgeViews = (onPointerDown) =>
  FLOAT_EDGES.map((edge) =>
    h("span", { key: edge, className: "txs-float-edge", "data-edge": edge, "aria-hidden": "true", onPointerDown }),
  );

const windowView = (spec) =>
  h(
    "section",
    {
      ref: spec.root,
      className: spec.open ? "txs-float" : "txs-float is-pill",
      style: spec.style,
      "data-h": spec.anchored.h,
      "data-v": spec.anchored.v,
      role: "dialog",
      "aria-modal": "false",
      "aria-label": tr("3D-вид объекта"),
    },
    h(
      "div",
      { className: "txs-float-box" },
      spec.head,
      h(EditorNotesContext.Provider, { value: null }, h(FollowStageContext.Provider, { value: true }, spec.stage)),
    ),
    spec.edges,
  );

const restoreView = (root, style, onShow) =>
  h(
    "div",
    { ref: root, className: "txs-float-restore", style },
    softButton({ variant: "secondary", icon: h(Cube), title: tr("Показать 3D-вид"), onClick: onShow }, tr("3D-вид")),
  );

/* ---------- компонент ---------- */

const StudioFloat3D = ({ session, view3d, flatVersion }) => {
  useTr();
  const { slot, host, space } = useFloatSpace();
  const { bounds, canvas } = space;
  const saved = useState(readFloatState)[0];
  const [mode, setMode] = useState(() => saved.mode);
  const open = mode === "open";
  const box = useFloatBox(space, saved, open);
  const { root, own, place, anchored } = box;
  const repaint = useMemo(function makeRepaint() {
    return createLiveRepaint();
  }, []);
  const dragRef = useRef({ moved: false, offset: null });
  const [version, setVersion] = useState(0);

  useEffect(
    function remember() {
      const record = { size: own, place, mode };
      writeFloatState(record);
    },
    [own, place, mode],
  );
  // Якорь сменился после броска: доезд ставится до первой отрисовки.
  useLayoutEffect(
    function settleAfterDrop() {
      if (dragRef.current.offset) consumeSettle(root, dragRef);
    },
    [place, root],
  );

  const texture = useStudioTexture(session);
  const keyed = useLiveKey(view3d, texture);
  const { live, tick, setTick } = useLiveLook(view3d, texture);
  const stageRef = useRef(null);
  useRefreshPacer(
    session,
    view3d,
    { texture, live, open, flatVersion, repaint },
    { stageRef, setTick, setVersion },
  );
  const { look, objects, editorStage } = useStageContent(view3d, { live, texture, tick }, { keyed, version });
  const preset = useMemo(() => matchPreset(box.area, bounds, box.size), [box.area, bounds, box.size]);

  const marker = h("span", { ref: slot, className: "txs-float-slot", hidden: true });
  if (!host) return marker;

  const env = { ...box, open, bounds, dragRef };
  const drag = {
    onPointerDown: (event) => beginMove(env, event),
    onKeyDown: (event) => onFloatKey(env, event),
  };
  const pillClick = () => {
    const mem = dragRef.current;
    if (!mem.moved) return setMode("open");
    mem.moved = false;
  };

  let content;
  if (mode === "hidden") {
    content = restoreView(root, anchorStyle(floatCorner(bounds, canvas, anchored)), () => setMode("open"));
  } else {
    const { size, area } = box;
    const modelProps = {
      loadKit: "props",
      ref: stageRef,
      scene: view3d.scene,
      look,
      parts: view3d.parts || null,
      frame: view3d.frame,
      frameKey: view3d.frameKey || "",
      objects,
      label: tr("Объект с текстурой студии"),
      autoRotate: false,
    };
    const head = open
      ? headerView({
          drag,
          active: preset,
          choose: (id) => box.setOwn(id === "m" ? null : floatPresetSize(area, id, bounds)),
          setMode,
        })
      : pillView(drag, pillClick);
    content = windowView({
      root,
      open,
      anchored,
      style: open && size ? { ...anchorStyle(anchored), width: size.width, height: size.height } : anchorStyle(anchored),
      head,
      stage: open ? stageView({ editorStage, repaint, modelProps }) : null,
      edges: open ? edgeViews((event) => beginResize(env, event)) : null,
    });
  }
  return (
    <>
      {marker}
      {createPortal(content, host)}
    </>
  );
};

export default StudioFloat3D;
