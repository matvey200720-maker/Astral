import { tr, useTr } from "../../../../locales/ui.js";
import { soundDecimal } from "./sound-copy.js";
import { resolveColor } from "./WaveformPlayer.jsx";
import { waveformPeaks } from "./sound-model.js";
import { createElement as h, useEffect, useMemo, useRef, useState } from "react";

/* Числа настройки: зазор между ручками, шаги клавиш, допуск «до конца», разметка волны. */
const TUNING = Object.freeze({
  gap: 0.02,
  nudge: 0.01,
  nudgeShift: 0.1,
  endSlack: 0.0005,
  minBars: 16,
  pxPerBar: 3,
  barShare: 0.92,
  maxScale: 3,
});

const DEFAULTS = Object.freeze({
  start: 0,
  end: 0,
  guideSeconds: 0,
  span: 0,
  disabled: false,
  accent: "var(--astral-accent)",
});

// Две ручки диапазона: индекс 0 — начало, 1 — конец.
const SIDES = Object.freeze(["start", "end"]);
const [FROM, TO] = [0, 1];

const between = (value, low, high) => Math.min(Math.max(value, low), high);
const milli = (value) => Math.round(value * 1000) / 1000;
const share = (value, length) => (length > 0 ? (value / length) * 100 : 0);
const isWindowed = (span, length) => span > 0 && span < length;

/* Значения свойств, где undefined заменяется умолчанием (null остаётся как есть). */
function withDefaults(props) {
  const out = {};
  for (const name of Object.keys(DEFAULTS)) {
    out[name] = props[name] === undefined ? DEFAULTS[name] : props[name];
  }
  return out;
}

/* Диапазон [от, до] из свойств: окно заданной длины либо обычная пара. */
function rangeOf({ start, end, span }, length) {
  if (isWindowed(span, length)) {
    const from = between(start, 0, length - span);
    return [from, from + span];
  }
  const stop = end > 0 ? Math.min(end, length) : length;
  return [Math.min(start, length), stop];
}

/* Ручка пары встаёт на время под указателем, не подходя к соседке ближе зазора. */
function placeSide(range, side, time, length) {
  if (side === FROM) return [between(time, 0, range[TO] - TUNING.gap), range[TO]];
  return [range[FROM], between(time, range[FROM] + TUNING.gap, length)];
}

function slide(anchor, span, length) {
  const from = between(anchor, 0, length - span);
  return [from, from + span];
}

/* То, что уходит наружу: округление до тысячных, конец у края файла — «до конца». */
function toPayload([from, to], length) {
  const atEnd = to >= length - TUNING.endSlack;
  return { trimStart: milli(from), trimEnd: atEnd ? 0 : milli(to) };
}

const secondsText = (value) =>
  tr("{value} с").replace("{value}", () => soundDecimal(value.toFixed(2)));

/* ---------- клавиши ---------- */
const nudger = (sign) => (current, length, big) =>
  current + sign * (big ? TUNING.nudgeShift : TUNING.nudge);

const KEY_TARGETS = new Map([
  ["Home", () => 0],
  ["End", (current, length) => length],
  ["ArrowLeft", nudger(-1)],
  ["ArrowDown", nudger(-1)],
  ["ArrowRight", nudger(1)],
  ["ArrowUp", nudger(1)],
]);

/* ---------- холст ---------- */
function sampleSize(canvas) {
  const ratio = window.devicePixelRatio;
  return {
    width: Math.round(canvas.clientWidth),
    height: Math.round(canvas.clientHeight),
    scale: ratio >= 1 ? Math.min(ratio, TUNING.maxScale) : 1,
  };
}

const sameSize = (a, b) => a.width === b.width && a.height === b.height && a.scale === b.scale;

function watchSize(canvas, onSample) {
  onSample();
  if (typeof ResizeObserver !== "function") return undefined;
  const watcher = new ResizeObserver(onSample);
  watcher.observe(canvas);
  return () => watcher.disconnect();
}

function watchTheme(canvas, onChange) {
  const host = canvas.closest("[data-theme]") || document.documentElement;
  const watcher = new MutationObserver(onChange);
  watcher.observe(host, { attributes: true, attributeFilter: ["data-theme"] });
  return () => watcher.disconnect();
}

const barCount = (width) => Math.max(TUNING.minBars, Math.round(width / TUNING.pxPerBar));

/* Прямоугольник одной колонки волны: [x, y, ширина, высота] в CSS-пикселях. */
function barRect([low, high], index, count, { width, height, scale }) {
  const pitch = width / count;
  const half = height / 2;
  const hair = 1 / scale;
  const a = half + high * half * TUNING.barShare;
  const b = half + low * half * TUNING.barShare;
  return [
    Math.round(index * pitch * scale) / scale,
    Math.min(a, b),
    Math.max(hair, pitch - hair),
    Math.max(hair, Math.abs(a - b)),
  ];
}

function paintBars(canvas, size, peaks, accent) {
  const ctx = size.width && size.height ? canvas.getContext("2d") : null;
  if (!ctx) return;
  const { width, height, scale } = size;
  if (canvas.width !== width * scale) canvas.width = width * scale;
  if (canvas.height !== height * scale) canvas.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (peaks.length === 0) return;
  ctx.fillStyle = resolveColor(accent, canvas);
  peaks.forEach((pair, index) => ctx.fillRect(...barRect(pair, index, peaks.length, size)));
}

/* Подписки холста и его рисование: размер, тема окна, пики. */
function useWaveCanvas(canvasRef, buffer, accent) {
  const [size, setSize] = useState({ width: 0, height: 0, scale: 1 });
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    return watchSize(canvas, () => {
      const next = sampleSize(canvas);
      setSize((prev) => (sameSize(prev, next) ? prev : next));
    });
  }, [canvasRef]);
  useEffect(
    () => watchTheme(canvasRef.current, () => setThemeTick((tick) => tick + 1)),
    [canvasRef],
  );

  // Колонки выводятся из ширины, так что пики пересчитываются только вместе с ней.
  const peaks = useMemo(
    () => (buffer && size.width > 0 ? waveformPeaks(buffer, barCount(size.width)) : []),
    [buffer, size.width],
  );

  // themeTick в теле не читается: он лишь сигнал перерисовать цвет после смены темы.
  useEffect(() => {
    paintBars(canvasRef.current, size, peaks, accent);
  }, [canvasRef, peaks, accent, themeTick, size]);
}

/* ---------- жест указателя ---------- */
/* Один жест: слушатели висят на том элементе, где началось нажатие.
   Всё нужное (диапазон, onChange, длина) зафиксировано на момент нажатия. */
function beginDrag(event, grab, ctx) {
  event.preventDefault();
  const holder = event.currentTarget;
  if (holder.setPointerCapture) holder.setPointerCapture(event.pointerId);
  const drag = {
    latest: ctx.range,
    side: grab === "track" ? null : SIDES.indexOf(grab),
    hold: 0,
  };

  const advance = (clientX, first) => {
    const time = ctx.timeAt(clientX);
    if (ctx.windowed) {
      if (first) {
        const inside = time >= ctx.range[FROM] && time <= ctx.range[TO];
        drag.hold = inside ? time - ctx.range[FROM] : ctx.span / 2;
      }
      drag.latest = slide(time - drag.hold, ctx.span, ctx.length);
    } else {
      if (first && drag.side === null) {
        const toStart = Math.abs(time - ctx.range[FROM]);
        drag.side = toStart <= Math.abs(time - ctx.range[TO]) ? FROM : TO;
      }
      drag.latest = placeSide(drag.latest, drag.side, time, ctx.length);
    }
    ctx.publish(drag.latest);
  };

  const listeners = {
    pointermove: (moved) => advance(moved.clientX, false),
    pointerup: () => finish(),
    pointercancel: () => finish(),
  };
  const finish = () => {
    Object.keys(listeners).forEach((type) => holder.removeEventListener(type, listeners[type]));
    ctx.publish(null);
    if (ctx.report) ctx.report(toPayload(drag.latest, ctx.length));
  };
  Object.keys(listeners).forEach((type) => holder.addEventListener(type, listeners[type]));
  advance(event.clientX, true);
}

/* ---------- разметка ---------- */
function handleView(side, view) {
  const value = view.shown[side];
  const name = SIDES[side];
  return h("div", {
    className: `snd-trim-handle is-${name}`,
    role: "slider",
    tabIndex: view.disabled ? -1 : 0,
    "aria-label": tr(side === FROM ? "Начало" : "Конец"),
    "aria-valuemin": 0,
    "aria-valuemax": Number(view.length.toFixed(3)),
    "aria-valuenow": Number(value.toFixed(3)),
    "aria-valuetext": secondsText(value),
    ...(view.disabled ? { "aria-disabled": "true" } : null),
    style: { left: `${share(value, view.length)}%` },
    onPointerDown: view.onHandleDown(name),
    onKeyDown: view.onHandleKey(side),
  });
}

function guideView({ shown, length, guideSeconds }) {
  const mark = shown[FROM] + guideSeconds;
  if (!(guideSeconds > 0 && mark < shown[TO])) return null;
  return h("span", {
    className: "snd-trim-guide",
    style: { left: `${share(mark, length)}%` },
    title: tr("Длина звука в игре"),
    "aria-hidden": "true",
  });
}

function cutView(style) {
  return h("span", { className: "snd-trim-cut", style, "aria-hidden": "true" });
}

function readoutView([from, to]) {
  return h(
    "small",
    { className: "snd-trim-readout" },
    `${secondsText(from)} — ${secondsText(to)}`,
    h("span", null, `· ${secondsText(Math.max(0, to - from))}`),
  );
}

export default function TrimWaveform(props) {
  useTr();
  const { buffer, onChange } = props;
  const setting = withDefaults(props);
  const canvasRef = useRef(null);
  const trackRef = useRef(null);
  const [draft, setDraft] = useState(null);
  useWaveCanvas(canvasRef, buffer, setting.accent);

  const length = (buffer && buffer.duration) || 0;
  const windowed = isWindowed(setting.span, length);
  const base = rangeOf(setting, length);
  const shown = draft || base;

  const timeAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return rect.width ? ((clientX - rect.left) / rect.width) * length : 0;
  };
  const gestureContext = () => ({
    range: base,
    length,
    windowed,
    span: setting.span,
    timeAt,
    publish: setDraft,
    report: onChange,
  });
  const canGrab = (event) => !setting.disabled && length > 0 && event.button === 0;

  const view = {
    shown,
    length,
    disabled: setting.disabled,
    onHandleDown: (name) => (event) => {
      event.stopPropagation();
      if (canGrab(event)) beginDrag(event, name, gestureContext());
    },
    onHandleKey: (side) => (event) => {
      const target = KEY_TARGETS.get(event.key);
      if (!target) return;
      event.preventDefault();
      const value = target(base[side], length, event.shiftKey);
      const range = windowed
        ? slide(side === FROM ? value : value - setting.span, setting.span, length)
        : placeSide(base, side, value, length);
      if (onChange) onChange(toPayload(range, length));
    },
  };

  const cutLeft = cutView({ left: 0, width: `${share(shown[FROM], length)}%` });
  const cutRight = cutView({ left: `${share(shown[TO], length)}%`, right: 0 });
  const track = h(
    "div",
    {
      className: "snd-trim-track",
      ref: trackRef,
      onPointerDown: (event) => {
        if (canGrab(event)) beginDrag(event, "track", gestureContext());
      },
    },
    h("canvas", { ref: canvasRef, "aria-hidden": "true" }),
    cutLeft,
    cutRight,
    guideView({ shown, length, guideSeconds: setting.guideSeconds }),
    handleView(FROM, view),
    handleView(TO, view),
  );
  return h(
    "div",
    { className: setting.disabled ? "snd-trim is-disabled" : "snd-trim" },
    track,
    readoutView(shown),
  );
}
