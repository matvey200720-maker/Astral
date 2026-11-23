/*
 * Инструменты студии на мыши (ТЗ 18.10.2026, Session 1, задача 6): нажатие,
 * движение, отпускание в точках холста — для каждого инструмента своё. Без
 * React и без DOM: контроллер получает сессию (`session.js`), настройки и
 * «наведение» (`overlay`) — рамки и ломаные, что окно рисует поверх холста.
 *
 *   кисть, ластик, штамп, восстанавливающая, осветлитель, размытие, палец —
 *     мазок (`session.beginStroke`): точки идут с шагом вдоль линии мыши;
 *   заливка — «ведро» щелчком, градиент протяжкой;
 *   область, лассо, палочка — маска выделения с операцией new/add/sub/inter;
 *   пипетка — цвет холста в цвет кисти (Alt — в цвет фона);
 *   текст, фигуры — новый слой щелчком / протяжкой;
 *   перемещение — слой-объект двигается полями, растр — пикселями, а с
 *     выделением — вырезанным кусочком;
 *   рука и масштаб — вид (его двигает окно, контроллер зовёт `view`).
 */

import { dabsAlong } from "./engine/brush.js";
import { ellipseMask, polygonMask, rectMask } from "./engine/selection.js";
import { isPixelLayer, layerOf } from "./engine/document.js";
import { createSurface } from "./raster-store.js";

const CLOSE_REACH = 10;

/** Рамка по двум точкам; `square` — квадрат, `centre` — от центра. */
export function dragRect(a, b, { square = false, centre = false } = {}) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * size;
    dy = Math.sign(dy || 1) * size;
  }
  if (centre) return { x: a.x - dx, y: a.y - dy, width: dx * 2, height: dy * 2 };
  return { x: a.x, y: a.y, width: dx, height: dy };
}

/**
 * Контроллер: `deps` — `{ session, options(), setOptions(patch), colours() / setColours(), overlay: { set(value), get() }, view: { pan(dx, dy), zoomTo(rect), zoomStep(direction, point) }, onText(id), onNotice(text) }`.
 * `options()` — `{ tool, kind, size, hardness, opacity, flow, tolerance, contiguous, sampleAll, feather, selectionOp, foreground, background, amount, range, aligned, shape: {…}, text: {…} }`.
 */
export function createToolController(deps) {
  const { session, overlay } = deps;
  let drag = null;
  let polygon = null;

  const opts = () => deps.options();
  const LABELS = { brush: "Кисть", eraser: "Ластик", stamp: "Штамп", heal: "Восстанавливающая кисть", tone: "Осветление", soften: "Размытие" };

  /* --------------------------------- мазок --------------------------------- */

  function strokeParams(options, event) {
    const stampSource = deps.stampSource?.() || null;
    return {
      tool: options.tool === "tone" ? options.kind : options.tool === "soften" ? options.kind : options.tool,
      size: options.size,
      hardness: options.hardness,
      opacity: options.opacity / 100,
      flow: options.flow / 100,
      colour: event.altKey && options.tool === "brush" ? options.background : options.foreground,
      amount: options.amount / 100,
      range: options.range,
      offset: stampSource?.offset || [0, 0],
    };
  }

  function startStroke(point, event) {
    const options = opts();
    if (options.tool === "stamp" || options.tool === "heal") {
      /* Alt + щелчок — образец; без образца штамп молчит. */
      if (event.altKey) {
        deps.setStampSource({ point, anchor: null, offset: [0, 0] });
        deps.onNotice?.("Образец взят — ведите кистью");
        return;
      }
      const source = deps.stampSource?.();
      if (!source?.point) {
        deps.onNotice?.("Сначала Alt + щелчок — откуда брать");
        return;
      }
      /* Выровнено: сдвиг «откуда» постоянен между мазками; иначе — заново с образца. */
      const offset = options.aligned && source.anchor ? source.offset : [source.point.x - point.x, source.point.y - point.y];
      deps.setStampSource({ ...source, anchor: point, offset });
    }
    const stroke = session.beginStroke(strokeParams(options, event));
    if (!stroke) {
      deps.onNotice?.("Этот слой нельзя править: он закреплён или скрыт, либо это слой коррекции");
      return;
    }
    drag = { kind: "stroke", stroke, last: point, carry: null, tool: options.tool, label: LABELS[options.tool] || "Мазок" };
    const first = dabsAlong([point.x, point.y], [point.x, point.y], stroke.spacing, null);
    for (const dab of first.points) stroke.dab(dab[0], dab[1]);
    drag.carry = first.carry;
  }

  function continueStroke(point) {
    const { stroke, last } = drag;
    const run = dabsAlong([last.x, last.y], [point.x, point.y], stroke.spacing, drag.carry);
    for (const dab of run.points) stroke.dab(dab[0], dab[1]);
    drag.carry = run.carry;
    drag.last = point;
  }

  /* --------------------------------- выделение ------------------------------ */

  const maskOf = (shape, rect, size) => {
    if (shape === "ellipse") return ellipseMask(size.width, size.height, rect.x, rect.y, rect.width, rect.height);
    return rectMask(size.width, size.height, rect.x, rect.y, rect.width, rect.height);
  };

  /* ------------------------------- перемещение ------------------------------ */

  function startMove(point) {
    const layer = session.activeLayer();
    if (!layer || layer.locked) return;
    if (layer.type === "image" || layer.type === "text" || layer.type === "shape") {
      drag = { kind: "move-object", id: layer.id, from: point, start: { ...layer } };
      return;
    }
    if (!isPixelLayer(layer)) return;
    const size = { width: session.width, height: session.height };
    const surface = session.store.get(layer.id);
    const whole = { x: 0, y: 0, ...size };
    const before = session.store.read(layer.id, whole);
    const snapshot = createSurface(size.width, size.height);
    snapshot.context.drawImage(surface.canvas, 0, 0);
    if (session.selection) {
      /* Вырезанный кусок: пиксели под маской уходят со слоя и едут с мышью. */
      const mask = session.selection;
      const lifted = createSurface(size.width, size.height);
      const live = surface.context.getImageData(0, 0, size.width, size.height);
      const piece = lifted.context.createImageData(size.width, size.height);
      for (let at = 0; at < mask.data.length; at += 1) {
        const weight = mask.data[at] / 255;
        if (weight <= 0) continue;
        const p = at * 4;
        piece.data[p] = live.data[p];
        piece.data[p + 1] = live.data[p + 1];
        piece.data[p + 2] = live.data[p + 2];
        piece.data[p + 3] = live.data[p + 3] * weight;
        live.data[p + 3] *= 1 - weight;
      }
      lifted.context.putImageData(piece, 0, 0);
      surface.context.putImageData(live, 0, 0);
      snapshot.context.clearRect(0, 0, size.width, size.height);
      snapshot.context.putImageData(live, 0, 0);
      drag = { kind: "move-pixels", id: layer.id, from: point, before, snapshot, lifted, selection: mask, offset: [0, 0] };
    } else drag = { kind: "move-pixels", id: layer.id, from: point, before, snapshot, lifted: null, selection: null, offset: [0, 0] };
  }

  function dragMove(point) {
    const dx = Math.round(point.x - drag.from.x);
    const dy = Math.round(point.y - drag.from.y);
    if (drag.kind === "move-object") {
      const next = { ...drag.start };
      if (drag.start.type === "shape") Object.assign(next, { x1: drag.start.x1 + dx, y1: drag.start.y1 + dy, x2: drag.start.x2 + dx, y2: drag.start.y2 + dy });
      else Object.assign(next, { x: drag.start.x + dx, y: drag.start.y + dy });
      session.patchLayer(drag.id, next, "Переместить", `move:${drag.id}`);
      return;
    }
    drag.offset = [dx, dy];
    const surface = session.store.get(drag.id);
    surface.context.clearRect(0, 0, session.width, session.height);
    if (drag.lifted) {
      surface.context.drawImage(drag.snapshot.canvas, 0, 0);
      surface.context.drawImage(drag.lifted.canvas, dx, dy);
    } else surface.context.drawImage(drag.snapshot.canvas, dx, dy);
    session.render();
  }

  function endMove() {
    const { id, before, offset } = drag;
    if (offset[0] || offset[1]) {
      const whole = { x: 0, y: 0, width: session.width, height: session.height };
      const after = session.store.read(id, whole);
      session.commitDocument(drag.lifted ? "Переместить выделенное" : "Переместить слой", (doc) => doc, { patches: [{ layer: id, ...whole, before: before.data, after: after.data }] });
      if (drag.lifted) session.moveSelection(offset[0], offset[1]);
    } else if (drag.lifted) {
      /* Сдвига не было: вырезанное возвращается на место. */
      const surface = session.store.get(id);
      surface.context.clearRect(0, 0, session.width, session.height);
      surface.context.drawImage(drag.snapshot.canvas, 0, 0);
      surface.context.drawImage(drag.lifted.canvas, 0, 0);
      session.render();
    }
  }

  /* --------------------------------- события -------------------------------- */

  return {
    /** Что рисует окно поверх холста сейчас: `{ kind, … }` или `null`. */
    get preview() {
      return overlay.get();
    },

    down(point, event) {
      const options = opts();
      const tool = options.tool;
      if (tool === "brush" || tool === "eraser" || tool === "stamp" || tool === "heal" || tool === "tone" || tool === "soften") {
        startStroke(point, event);
        return;
      }
      if (tool === "fill") {
        if (options.kind === "bucket") {
          void session.bucket(point.x, point.y, options.foreground, { tolerance: options.tolerance, contiguous: options.contiguous, opacity: options.opacity / 100, sampleAll: options.sampleAll });
        } else drag = { kind: "gradient", from: point, to: point };
        return;
      }
      if (tool === "marquee") {
        drag = { kind: "marquee", from: point, shape: options.kind };
        return;
      }
      if (tool === "lasso") {
        if (options.kind === "polygon") {
          if (!polygon) polygon = [point];
          else if (Math.hypot(point.x - polygon[0].x, point.y - polygon[0].y) * (deps.zoom?.() || 1) <= CLOSE_REACH && polygon.length >= 3) {
            this.finishPolygon();
            return;
          } else polygon.push(point);
          overlay.set({ kind: "polygon", points: [...polygon], cursor: point });
        } else drag = { kind: "lasso", points: [point] };
        return;
      }
      if (tool === "wand") {
        void session.wand(point.x, point.y, { tolerance: options.tolerance, contiguous: options.contiguous, sampleAll: options.sampleAll, op: options.selectionOp, feather: options.feather });
        return;
      }
      if (tool === "picker") {
        drag = { kind: "picker" };
        this.pick(point, event);
        return;
      }
      if (tool === "text") {
        const id = session.addText(point.x, point.y, { colour: options.foreground, size: options.text.size, font: options.text.font, fontAsset: options.text.fontAsset, fontName: options.text.fontName });
        deps.onText?.(id);
        return;
      }
      if (tool === "shape") {
        drag = { kind: "shape", from: point, to: point, shape: options.kind };
        return;
      }
      if (tool === "move") {
        startMove(point);
        return;
      }
      if (tool === "hand") {
        drag = { kind: "hand", from: { x: event.clientX, y: event.clientY } };
        return;
      }
      if (tool === "zoom") {
        drag = { kind: "zoom", from: point, to: point, clientFrom: { x: event.clientX, y: event.clientY }, out: event.altKey };
      }
    },

    move(point, event) {
      if (polygon && !drag) {
        overlay.set({ kind: "polygon", points: [...polygon], cursor: point });
        return;
      }
      if (!drag) return;
      if (drag.kind === "stroke") continueStroke(point);
      else if (drag.kind === "marquee") {
        drag.to = point;
        overlay.set({ kind: "marquee", shape: drag.shape, rect: dragRect(drag.from, point, { square: event.shiftKey, centre: event.altKey }) });
      } else if (drag.kind === "lasso") {
        drag.points.push(point);
        overlay.set({ kind: "lasso", points: drag.points });
      } else if (drag.kind === "gradient") {
        drag.to = point;
        overlay.set({ kind: "line", from: drag.from, to: point });
      } else if (drag.kind === "shape") {
        drag.to = point;
        const base = dragRect(drag.from, point, { square: event.shiftKey });
        overlay.set(drag.shape === "line" || drag.shape === "arrow" ? { kind: "line", from: drag.from, to: point, arrow: drag.shape === "arrow" } : { kind: "marquee", shape: drag.shape, rect: base });
      } else if (drag.kind === "picker") this.pick(point, event);
      else if (drag.kind === "move-object" || drag.kind === "move-pixels") dragMove(point);
      else if (drag.kind === "hand") {
        deps.view.pan(event.clientX - drag.from.x, event.clientY - drag.from.y);
        drag.from = { x: event.clientX, y: event.clientY };
      } else if (drag.kind === "zoom") {
        drag.to = point;
        overlay.set({ kind: "marquee", shape: "rect", rect: dragRect(drag.from, point), dashed: true });
      }
    },

    up(point, event) {
      if (!drag) return;
      const current = drag;
      drag = null;
      const options = opts();
      const size = { width: session.width, height: session.height };
      if (current.kind === "stroke") {
        current.stroke.end(current.label);
      } else if (current.kind === "marquee") {
        const rect = dragRect(current.from, point, { square: event.shiftKey, centre: event.altKey });
        if (Math.abs(rect.width) >= 1 && Math.abs(rect.height) >= 1) {
          session.setSelection(maskOf(current.shape, rect, size), options.selectionOp);
          if (options.feather >= 1) session.featherSelection(options.feather);
        } else if (options.selectionOp === "new") session.deselect();
        overlay.set(null);
      } else if (current.kind === "lasso") {
        if (current.points.length >= 3) {
          session.setSelection(polygonMask(size.width, size.height, current.points.map((p) => [p.x, p.y])), options.selectionOp);
          if (options.feather >= 1) session.featherSelection(options.feather);
        }
        overlay.set(null);
      } else if (current.kind === "gradient") {
        const from = [current.from.x, current.from.y];
        const to = [point.x, point.y];
        if (Math.hypot(to[0] - from[0], to[1] - from[1]) >= 2) {
          const stops = options.gradient?.stops || [{ at: 0, colour: options.foreground, alpha: 1 }, { at: 1, colour: options.background, alpha: 1 }];
          session.gradient(from, to, stops.length >= 2 ? stops : [{ at: 0, colour: options.foreground, alpha: 1 }, { at: 1, colour: options.background, alpha: 1 }], { kind: options.kind === "radial" ? "radial" : "linear", opacity: options.opacity / 100 });
        }
        overlay.set(null);
      } else if (current.kind === "shape") {
        const a = current.from;
        let b = point;
        if (event.shiftKey && current.shape !== "line" && current.shape !== "arrow") {
          const rect = dragRect(a, point, { square: true });
          b = { x: a.x + rect.width, y: a.y + rect.height };
        }
        if (Math.hypot(b.x - a.x, b.y - a.y) >= 3) {
          const filled = options.shape?.fill && current.shape !== "line" && current.shape !== "arrow";
          session.addShape(current.shape, a.x, a.y, b.x, b.y, { stroke: options.foreground, fill: filled ? options.background : null, strokeWidth: options.shape?.strokeWidth ?? 8 });
        }
        overlay.set(null);
      } else if (current.kind === "move-object") {
        /* Слой-объект уже двигался полями: ничего больше. */
      } else if (current.kind === "move-pixels") {
        drag = current;
        endMove();
        drag = null;
      } else if (current.kind === "zoom") {
        const rect = dragRect(current.from, point);
        if (Math.abs(rect.width) * (deps.zoom?.() || 1) > 6 && Math.abs(rect.height) * (deps.zoom?.() || 1) > 6 && !current.out) {
          deps.view.zoomTo({ x: Math.min(current.from.x, point.x), y: Math.min(current.from.y, point.y), width: Math.abs(rect.width), height: Math.abs(rect.height) });
        } else deps.view.zoomStep(current.out ? -1 : 1, { x: event.offsetX ?? 0, y: event.offsetY ?? 0 });
        overlay.set(null);
      }
    },

    /** Цвет под точкой в цвет кисти (`Alt` — в цвет фона). */
    pick(point, event) {
      const options = opts();
      const colour = session.pickColour(point.x, point.y, { sampleAll: options.sampleAll });
      if (colour) deps.setColours(event.altKey ? { background: colour } : { foreground: colour });
    },

    /** Лассо-ломаная закрыта (Enter, двойной щелчок или щелчок у первой точки). */
    finishPolygon() {
      if (!polygon) return;
      const options = opts();
      if (polygon.length >= 3) {
        session.setSelection(polygonMask(session.width, session.height, polygon.map((p) => [p.x, p.y])), options.selectionOp);
        if (options.feather >= 1) session.featherSelection(options.feather);
      }
      polygon = null;
      overlay.set(null);
    },

    /** Esc: незаконченное отменяется. */
    cancel() {
      if (drag?.kind === "stroke") drag.stroke.end(drag.label);
      if (drag?.kind === "move-pixels" || drag?.kind === "move-object") drag = null;
      drag = null;
      polygon = null;
      overlay.set(null);
    },

    get active() {
      return Boolean(drag || polygon);
    },
    get polygon() {
      return polygon;
    },
    layerAt(point) {
      const doc = session.doc;
      for (let at = doc.layers.length - 1; at >= 0; at -= 1) {
        const layer = doc.layers[at];
        if (!layer.visible) continue;
        if (layer.type === "image" && point.x >= layer.x && point.y >= layer.y && point.x <= layer.x + layer.width && point.y <= layer.y + layer.height) return layer;
      }
      return layerOf(doc, doc.active);
    },
  };
}
