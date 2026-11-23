import { createElement, useEffect, useRef } from "react";
import { perfCount } from "../../../../../perf-count.js";
import { canvasGlyphRasterizer } from "./sdf-raster.js";
import { buildSdfAtlas } from "./sdf-atlas.js";
import { labelInstances } from "./label-quads.js";
import { groupRunsByFont } from "./label-runs.js";
import { createLabelCanvas } from "./label-pass.js";

// Пикселей канвы на единицу сцены и размер растеризации знака.
const DENSITY = 2;
const GLYPH_PX = 64;
const ATLAS_LIMIT = 8;
const KEY_SEPARATOR = "\u0000";
const ATLAS_GEOMETRY = { cell: 128, radius: 12, columns: 16, fontSize: GLYPH_PX };

const CANVAS_STYLE = { width: "100%", height: "100%", display: "block" };

let gpuProbe;

function probeContexts() {
  try {
    const kinds = ["webgl2", "2d"];
    return kinds.every((kind) => Boolean(document.createElement("canvas").getContext(kind)));
  } catch {
    return false;
  }
}

export function labelsGpuAvailable() {
  if (gpuProbe === undefined) gpuProbe = probeContexts();
  return gpuProbe;
}

// Кэш атласов уровня файла: порядок записей в Map — от давно использованной к свежей.
function createAtlasCache(limit) {
  const entries = new Map();
  return {
    take(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    keep(key, value) {
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
  };
}

const atlasCache = createAtlasCache(ATLAS_LIMIT);

function collectGlyphs(runs) {
  return new Set(runs.flatMap((run) => [...run.text]));
}

function rasterFont(font) {
  const [weight, ...family] = font.split(" ");
  return [weight, `${GLYPH_PX}px`, family.join(" ")].join(" ");
}

function atlasFor(font, runs) {
  const chars = collectGlyphs(runs);
  const key = [font, [...chars].sort().join("")].join(KEY_SEPARATOR);
  const cached = atlasCache.take(key);
  if (cached) return cached;

  const rasterize = canvasGlyphRasterizer({ font: rasterFont(font) });
  if (!rasterize) return null;
  const atlas = buildSdfAtlas({ ...ATLAS_GEOMETRY, chars, rasterize });
  atlasCache.keep(key, atlas);
  return atlas;
}

const doubled = (value) => value * DENSITY;

function densify(run) {
  const { halo } = run;
  return Object.assign({}, run, {
    x: doubled(run.x),
    y: doubled(run.y),
    size: doubled(run.size),
    halo: halo ? { ...halo, width: doubled(halo.width) } : halo,
  });
}

// Запись размера сбрасывает буфер канвы, поэтому пишем только при расхождении.
function fitCanvas(canvas, width, height) {
  [["width", width], ["height", height]].forEach(([side, extent]) => {
    const pixels = Math.max(1, Math.round(extent * DENSITY));
    if (canvas[side] !== pixels) canvas[side] = pixels;
  });
}

function obtainPass(canvas, passRef) {
  if (!passRef.current) passRef.current = createLabelCanvas(canvas);
  return passRef.current;
}

function releasePass(passRef) {
  const pass = passRef.current;
  if (!pass) return;
  pass.dispose();
  passRef.current = null;
}

function paintLabels(canvas, passRef, runs, width, height) {
  if (!canvas) return perfCount("map.labels.noCanvas");
  if (!runs.length) return undefined;
  fitCanvas(canvas, width, height);

  const pass = obtainPass(canvas, passRef);
  if (!pass) return perfCount("map.labels.noPass");

  const queue = [...groupRunsByFont(runs.map(densify))].flatMap(([font, group]) => {
    const atlas = atlasFor(font, group);
    if (!atlas) {
      perfCount("map.labels.noAtlas");
      return [];
    }
    pass.setAtlas(atlas, font);
    return [[font, labelInstances(group, atlas)]];
  });

  pass.clear();
  queue.forEach(([font, quads]) => pass.draw(quads, font));
  return perfCount("map.labels.gpu");
}

// Разметка: foreignObject (x, y, width, height, pointer-events) и в нём пустой canvas.
function layerMarkup(width, height, canvasRef) {
  const frameProps = { x: "0", y: "0", width, height, pointerEvents: "none" };
  const surface = createElement("canvas", { ref: canvasRef, style: CANVAS_STYLE });
  return createElement("foreignObject", frameProps, surface);
}

export function LabelsGpuLayer({ runs, width, height }) {
  const passRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => () => releasePass(passRef), []);

  useEffect(() => {
    paintLabels(canvasRef.current, passRef, runs, width, height);
  }, [runs, width, height]);

  return layerMarkup(width, height, canvasRef);
}
