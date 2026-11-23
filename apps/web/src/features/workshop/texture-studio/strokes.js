/*
 * Мазок студии (ТЗ 18.10.2026, Session 1, задача 6): один нажим — один мазок
 * по пикселям слоя. Мазок держит весь слой как `ImageData` (одно чтение на
 * нажим, а не на каждую точку), каждая точка пишет свой кусок и кладёт его
 * на холст слоя (`putImageData` по рамке точки): стоимость точки — размер
 * кисти, а не лист 8089 × 1280.
 *
 * Кисть и ластик копят покрытие по нажиму (`flow` — сколько даёт одна точка,
 * копится до 100 %), а непрозрачность режет итог мазка целиком: наезд точки
 * на точку не красит темнее, чем выбрано — как у привычных редакторов.
 * Штамп, восстанавливающая кисть, осветлитель, размытие и палец правят
 * пиксели каждой точкой (`engine/brush.js`).
 *
 * Итог мазка — `{ rect, before, after }`: кусок пикселей слоя до и после; на
 * нём строится шаг истории.
 */

import { brushSpacing, brushTip, stampClone, stampDodgeBurn, stampSmudge, stampSoften } from "./engine/brush.js";
import { hexToRgb } from "./engine/fill.js";
import { unionRect } from "./engine/history.js";
import { clampRect, readAll } from "./raster-store.js";

export const STROKE_TOOLS = Object.freeze(["brush", "eraser", "stamp", "heal", "dodge", "burn", "blur", "sharpen", "smudge"]);

/**
 * Начать мазок по `surface` (`createSurface`). Параметры: `tool` — один из
 * `STROKE_TOOLS`, `size`, `hardness` (0…100), `opacity` и `flow` (0…1), `colour`
 * (`#rrggbb`), `selection` (маска выделения или `null`), `source` — пиксели,
 * откуда штамп берёт (`Uint8ClampedArray` размера слоя; без него — сам слой
 * на начало мазка), `offset` — сдвиг «откуда» для штампа, `amount` — сила
 * осветлителя/размытия (0…1), `range` — тона осветлителя.
 */
export function beginStroke(surface, params) {
  const { tool, size = 30, hardness = 80, opacity = 1, flow = 1, colour = "#000000", selection = null, source = null, offset = [0, 0], amount = 0.5, range = "midtones" } = params;
  const live = readAll(surface);
  const { width, height } = live;
  const base = new Uint8ClampedArray(live.data);
  const side = Math.max(1, Math.round(size));
  const tip = brushTip(side, hardness);
  const rgb = hexToRgb(colour);
  const coverage = tool === "brush" || tool === "eraser" ? new Uint8ClampedArray(width * height) : null;
  const sourcePixels = source || base;
  let pickup = null;
  let dirty = null;
  let touched = null;

  /* Пересчёт пикселей рамки по покрытию мазка (кисть, ластик). */
  function settle(area) {
    for (let y = area.y; y < area.y + area.height; y += 1)
      for (let x = area.x; x < area.x + area.width; x += 1) {
        const pixel = y * width + x;
        const at = pixel * 4;
        const alpha = (coverage[pixel] / 255) * opacity;
        const under = base[at + 3] / 255;
        if (tool === "eraser") {
          live.data[at] = base[at];
          live.data[at + 1] = base[at + 1];
          live.data[at + 2] = base[at + 2];
          live.data[at + 3] = base[at + 3] * (1 - alpha);
        } else {
          const out = alpha + under * (1 - alpha);
          for (let channel = 0; channel < 3; channel += 1) live.data[at + channel] = out > 0 ? (rgb[channel] * alpha + base[at + channel] * under * (1 - alpha)) / out : 0;
          live.data[at + 3] = out * 255;
        }
      }
  }

  function dab(cx, cy) {
    const x0 = Math.round(cx - side / 2);
    const y0 = Math.round(cy - side / 2);
    const area = clampRect({ x: x0, y: y0, width: side, height: side }, width, height);
    if (!area) return null;
    let rect = null;
    if (coverage) {
      for (let y = area.y; y < area.y + area.height; y += 1)
        for (let x = area.x; x < area.x + area.width; x += 1) {
          const weight = (tip[(y - y0) * side + (x - x0)] / 255) * flow * (selection ? selection.data[y * width + x] / 255 : 1);
          if (!weight) continue;
          const pixel = y * width + x;
          coverage[pixel] += (255 - coverage[pixel]) * weight;
        }
      settle(area);
      rect = area;
    } else if (tool === "stamp" || tool === "heal") rect = stampClone(live.data, sourcePixels, width, height, cx, cy, tip, side, offset, opacity, selection, tool === "heal");
    else if (tool === "dodge" || tool === "burn") rect = stampDodgeBurn(live.data, width, height, cx, cy, tip, side, tool === "dodge" ? amount : -amount, range, selection);
    else if (tool === "blur" || tool === "sharpen") rect = stampSoften(live.data, width, height, cx, cy, tip, side, amount, tool, selection);
    else if (tool === "smudge") {
      const result = stampSmudge(live.data, width, height, cx, cy, tip, side, amount, pickup, selection);
      pickup = result.pickup;
      rect = result.rect;
    }
    if (!rect) return null;
    surface.context.putImageData(live, 0, 0, rect.x, rect.y, rect.width, rect.height);
    dirty = unionRect(dirty, rect);
    touched = unionRect(touched, rect);
    return rect;
  }

  return {
    spacing: Math.max(1, brushSpacing(side, hardness)),
    dab,
    /** Рамка, тронутая с прошлого вызова (для пересборки), и сброс. */
    takeDirty() {
      const rect = dirty;
      dirty = null;
      return rect;
    },
    /** Мазок окончен: `{ rect, before, after }` или `null`, если ничего не тронуто. */
    end() {
      if (!touched) return null;
      const rect = touched;
      const before = new Uint8ClampedArray(rect.width * rect.height * 4);
      const after = new Uint8ClampedArray(rect.width * rect.height * 4);
      for (let row = 0; row < rect.height; row += 1) {
        const from = ((rect.y + row) * width + rect.x) * 4;
        before.set(base.subarray(from, from + rect.width * 4), row * rect.width * 4);
        after.set(live.data.subarray(from, from + rect.width * 4), row * rect.width * 4);
      }
      return { rect, before, after };
    },
  };
}
