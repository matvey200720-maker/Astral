import { afterVirtualFling } from "./virtual-fling.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export { borderField, contentInset, edgeColors, inkLuma } from "./frame-crop-pixels.js";
import { measurePixels, sampleSize } from "./frame-crop-pixels.js";

// Состояние живёт, пока живо окно: замеры (в том числе неудачные), идущие замеры, подсказки плиток.
const measured = new Map();
const inFlight = new Map();
const tileHints = new Map();
// Поток замера: сам поток, отключён ли он насовсем, номер последнего задания и ожидающие задания.
const jobs = new Map();
let jobSerial = 0;
let thread = null;
let threadOff = typeof Worker !== "function";

// Полосы продолжения краёв: сторона, между какими паддингами тянется, позиция, вдоль ширины ли.
const STRIPES = [
  ["top", "left", "right", "left top", true],
  ["bottom", "left", "right", "left bottom", true],
  ["left", "top", "bottom", "left top", false],
  ["right", "top", "bottom", "right top", false],
];
const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round2 = (v) => Math.round(100 * v) / 100;
const pct = (v) => `${(v * 100).toFixed(2)}%`;
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const absolute = (src) => new URL(src, window.location.href);

// ---------- расчёт рамки ----------

// Окно показа по одной оси. Начало: free — как есть, иначе в картинку (win < pic) или к рисунку
// (keep). Результат: доли окна вне картинки (с начала, с конца) и доли картинки, что отрезаются.
const fitAxis = (ideal, win, pic, free, keep) => {
  const start = free
    ? ideal
    : clamp(ideal, ...(win < pic ? [0, pic - win] : keep || [pic - win, 0]));
  const [from, to] = [Math.max(0, start), Math.min(pic, start + win)];
  return [(from - start) / win, (start + win - to) / win, from / pic, 1 - to / pic];
};

export const fitInset = (crop, ratio = 0, options = {}) => {
  if (!crop) return null;
  const { margin = 0.05, reserve = 0, centered = false } = {
    margin: options.margin,
    reserve: options.reserve,
    centered: options.centered,
  };
  const edge = crop.inset || NO_INSET;
  // границы рисунка в высотах картинки
  const x0 = edge.left * crop.aspect;
  const x1 = (1 - edge.right) * crop.aspect;
  const y0 = edge.top;
  const y1 = 1 - edge.bottom;
  const inkW = x1 - x0;
  const inkH = y1 - y0;
  const tile = ratio || inkW / inkH;
  const gap = Math.min(tile, 1) * clamp(margin, 0, 0.2);
  const fitW = (tile - gap * 2) / inkW;
  const share = centered || !(reserve > 0 && reserve < 0.9) ? 0 : reserve;
  const room = 1 - (share && (crop.bright || fitW <= (1 - gap * 2) / inkH) ? share : 0);
  const scale = Math.min(
    fitW,
    ((crop.bright ? room : 1) - gap * 2) / inkH,
    Math.min(tile / crop.aspect, 1) * 2.5,
  );
  const winW = tile / scale;
  const winH = 1 / scale;
  const above = clamp((room - inkH * scale) / 2, gap, (1 - inkH * scale) / 2);
  const across = fitAxis((x0 + x1 - winW) / 2, winW, crop.aspect, centered, null);
  const down = fitAxis(y0 - above * winH, winH, 1, centered, room < 1 ? [y1 - winH, y0] : null);
  const cuts = [down[2], across[3], down[3], across[2]];
  return {
    viewBox: cuts.every((c) => c < 0.005)
      ? ""
      : `inset(${cuts.map((c) => pct(Math.max(0, c))).join(" ")})`,
    padding: { top: down[0], right: across[1], bottom: down[1], left: across[0] },
    ratio: tile,
  };
};

export const renderFillStyle = (crop, ratio, options = {}) => {
  const frame = fitInset(crop, ratio, {
    centered: Boolean(crop.transparent),
    margin: options.margin,
    reserve: options.reserve,
  });
  const pad = frame.padding;
  const bands = STRIPES.filter(([side]) => pad[side] > 0.002);
  const style = {
    objectFit: "contain",
    objectPosition: "50% 50%",
    boxSizing: "border-box",
    padding: bands.length
      ? [pad.top / ratio, pad.right, pad.bottom / ratio, pad.left].map(pct).join(" ")
      : "0",
    filter: "none",
  };
  style.backgroundColor = crop.field ? rgb(crop.field) : "transparent";
  if (crop.field && bands.length) {
    // градиент, позиция и размер каждой полосы
    const gradient = ([side, lo, hi, , flat]) => {
      const [from, to] = [pad[lo], pad[hi]];
      const colors = crop.edges?.[side] || Array(2).fill(crop.field);
      const stops = colors.map(
        (c, i) => `${rgb(c)} ${pct(from + ((1 - from - to) * (i + 0.5)) / colors.length)}`,
      );
      return `linear-gradient(${flat ? "to right, " : ""}${stops.join(", ")})`;
    };
    const size = ([side, , , , flat]) => {
      const thick = pct(pad[side] + 0.01);
      return flat ? `100% ${thick}` : `${thick} 100%`;
    };
    style.backgroundImage = bands.map(gradient).join(", ");
    style.backgroundPosition = bands.map((band) => band[3]).join(", ");
    style.backgroundSize = bands.map(size).join(", ");
    style.backgroundRepeat = "no-repeat";
  }
  if (frame.viewBox) style.objectViewBox = frame.viewBox;
  return style;
};

// ---------- замер адреса ----------

const isForeign = (src) => {
  try {
    const { protocol, origin } = absolute(src);
    return protocol.startsWith("http") && origin !== window.location.origin;
  } catch {
    return false;
  }
};

const readImage = (img) => {
  const { naturalWidth, naturalHeight } = img;
  if (!naturalWidth || !naturalHeight) return null;
  try {
    const { aspect, width, height } = sampleSize(naturalWidth, naturalHeight);
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx?.drawImage(img, 0, 0, width, height);
    return ctx && measurePixels(ctx.getImageData(0, 0, width, height).data, width, height, aspect);
  } catch {
    return null;
  }
};

const measureOnCanvas = (src) =>
  new Promise((resolve) => {
    const img = Object.assign(
      new Image(),
      { decoding: "async" },
      isForeign(src) && { crossOrigin: "anonymous" },
      { onload: () => resolve(readImage(img)), onerror: () => resolve(null), src },
    );
  });

function onLaneReply(event) {
  const { id, result, failed } = event?.data || {};
  const [src, settle] = jobs.get(id) ?? [];
  if (!settle) return;
  jobs.delete(id);
  settle(failed ? measureOnCanvas(src) : (result ?? null));
}

// Поток сломался: отключить насовсем, а всех ожидающих измерить на холсте окна по порядку.
function onLaneCrash() {
  threadOff = true;
  thread?.terminate();
  thread = null;
  jobs.forEach(([src, settle]) => settle(measureOnCanvas(src)));
  jobs.clear();
}

function openLane() {
  if (thread || threadOff) return thread;
  try {
    thread = Object.assign(
      new Worker(new URL("./frame-crop-worker.js", import.meta.url), { type: "module" }),
      { onmessage: onLaneReply, onerror: onLaneCrash },
    );
  } catch {
    threadOff = true;
  }
  return thread;
}

const askLane = (port, src) =>
  new Promise((resolve) => {
    jobs.set(++jobSerial, [src, resolve]);
    port.postMessage({ id: jobSerial, src: absolute(src).href });
  });

// Один замер на адрес: пока он идёт, все просящие получают то же обещание.
function measureOnce(src) {
  const going = inFlight.get(src);
  if (going) return going;
  const port = openLane();
  const task = (port ? askLane(port, src) : measureOnCanvas(src)).then((found) => {
    inFlight.delete(src);
    return found;
  });
  inFlight.set(src, task);
  return task;
}

// Замер адреса и запись в кэш (overwrite — поверх существующей записи), затем сообщить результат.
async function remember(src, overwrite, notify) {
  const found = await measureOnce(src);
  if (overwrite || !measured.has(src)) measured.set(src, found);
  notify?.(found);
}

export const warmFrameCrop = (src) => {
  const skip = !src || typeof document === "undefined" || measured.has(src) || inFlight.has(src);
  if (!skip) remember(src, false);
};

// ---------- хуки ----------

export const useFrameCrop = (src) => {
  const [crop, setCrop] = useState(() => (src ? measured.get(src) : null));
  useEffect(() => {
    const cached = !src || typeof document === "undefined" ? null : measured.get(src);
    setCrop(cached);
    if (cached !== undefined) return undefined;
    let active = true;
    const startMeasuring = () => {
      if (!active) return;
      remember(src, true, (found) => {
        if (active) setCrop(found);
      });
    };
    const cancelWait = afterVirtualFling(startMeasuring, { url: src });
    return () => {
      active = false;
      cancelWait?.();
    };
  }, [src]);
  return crop;
};

export const useRenderFill = (src, options = {}) => {
  const {
    caption = "",
    deferRead = false,
    fallback = "cover",
    hint = "",
    margin = 0.05,
    reserve = 0,
  } = options;
  const hintKey = caption ? "" : hint;
  const imgRef = useRef(null);
  const [measuredBefore] = useState(() => measured.has(src));
  const [tile, setTile] = useState(() => {
    const shared = hintKey ? tileHints.get(hintKey) : undefined;
    return shared && shared.share === reserve ? shared : { ratio: 0, share: reserve };
  });
  const tileNow = useRef(tile);
  tileNow.current = tile;

  const crop = useFrameCrop(src);
  const fillable = Boolean(crop && crop.inset && (crop.field || crop.transparent));

  useLayoutEffect(() => {
    const frame = fillable ? imgRef.current?.parentElement : null;
    if (!frame) return undefined;
    const label = caption ? frame.querySelector(caption) : null;

    const read = () => {
      const box = frame.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const labelTop = label ? label.getBoundingClientRect().top : 0;
      const share = labelTop ? clamp((box.bottom - labelTop) / box.height, 0, 0.7) : reserve;
      const next = { ratio: round2(box.width / box.height), share: round2(share) };
      if (hintKey) tileHints.set(hintKey, next);
      const was = tileNow.current;
      if (was.ratio !== next.ratio || was.share !== next.share) setTile(next);
    };

    const canObserve = typeof ResizeObserver === "function";
    const hintFits = Boolean(hintKey) && tileNow.current.ratio > 0;
    const leaveToObserver = deferRead && canObserve;
    if (!hintFits && !leaveToObserver) read();
    if (!canObserve) return undefined;

    const watcher = new ResizeObserver(read);
    watcher.observe(frame);
    if (label) watcher.observe(label);
    return () => watcher.disconnect();
  }, [src, fillable, caption, reserve, hintKey, deferRead]);

  if (crop === undefined || crop === null) {
    return { mode: fallback, ready: crop === null, ref: imgRef, style: undefined };
  }
  if (!fillable) {
    return {
      mode: crop.transparent ? "contain" : "cover",
      ready: true,
      ref: imgRef,
      style: undefined,
    };
  }
  const measuredTile = tile.ratio > 0;
  return {
    mode: "fill",
    ready: measuredTile || measuredBefore,
    ref: imgRef,
    style: measuredTile
      ? renderFillStyle(crop, tile.ratio, { margin, reserve: tile.share })
      : undefined,
    transparent: Boolean(crop.transparent),
  };
};
