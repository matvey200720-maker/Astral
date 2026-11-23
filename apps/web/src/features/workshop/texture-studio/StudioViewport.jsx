/*
 * Холст студии на экране (ТЗ 18.10.2026, Session 1, задача 6): собранный
 * документ (`session.compositor.flat`) с масштабом и сдвигом, а поверх —
 * отдельный прозрачный холст «наведения»: бегущие муравьи выделения,
 * рамка протяжки, ломаная лассо, направляющие панелей, кисть-курсор, рамка
 * выбранного слоя. Мазок пересобирает и перерисовывает только свой кусок —
 * лист 8089 × 1280 не заливается на экран заново на каждую точку.
 *
 * Мышь: левая — инструмент; средняя, пробел и «Рука» — сдвиг; колесо —
 * масштаб к точке под курсором, Shift + колесо — сдвиг по горизонтали.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { maskSegments } from "./engine/selection.js";
import { toScreen, visibleRect, zoomAt, clampView, fitView, stepZoom, viewOfRect, actualView } from "./engine/view.js";
import { measureText } from "./compositor.js";
import { wrapPoint } from "./wall-view.js";
import { markWheel } from "../../../components/ui/wheel-mark.js";
import { tr } from "../../../locales/ui.js";

const CHECK = 12;

/* Шахматка прозрачности: плитка 2 × 2 клетки, как её рисуют редакторы. */
function checkerPattern(context) {
  const tile = document.createElement("canvas");
  tile.width = CHECK * 2;
  tile.height = CHECK * 2;
  const painter = tile.getContext("2d");
  painter.fillStyle = "#2a2c30";
  painter.fillRect(0, 0, CHECK * 2, CHECK * 2);
  painter.fillStyle = "#34373c";
  painter.fillRect(0, 0, CHECK, CHECK);
  painter.fillRect(CHECK, CHECK, CHECK, CHECK);
  return context.createPattern(tile, "repeat");
}

const BRUSH_TOOLS = new Set(["brush", "eraser", "stamp", "heal", "tone", "soften"]);

/* Вид, в который вписана область поверхности `focus` (рамка холста) или, без неё, весь холст. */
const fitFocus = (focus, doc, box) => (focus ? viewOfRect(focus, box, 32) : fitView(doc, box));

/**
 * `session`, `controller`, `view` (`{ zoom, x, y }`) и `onView(next)` — вид держит
 * окно студии (панель масштаба внизу читает тот же). `options` — настройки
 * инструмента (размер кисти для курсора), `guides` — панели фасада
 * (`[{ x, width, label }]` в пикселях холста) или `null`, `spaceHeld` — зажат
 * пробел (временная «Рука»), `cursorBox` — где сейчас курсор (для кисти).
 * `focus` — область листа выбранной поверхности (`{ x, y, width, height }`,
 * пиксели холста) или `null`: вид вписывается в неё, остальной лист притушен.
 * `wall` — пространство выбранной стены (`wall-view.js`, 3Б ТЗ 18.10.2026) или `null`:
 * вместо листа на экране стена, лист на ней повторён узором, а точки мыши
 * переводятся в лист (кисть идёт по стене непрерывно, `session.setWrap`).
 */
const StudioViewport = forwardRef(function StudioViewport({ session, controller, overlay, view, onView, options, guides = null, focus = null, wall = null, spaceHeld = false, flatVersion = 0, selectionRevision = 0, overlayTick = 0, activeLayer = null, label = "" }, ref) {
  const hostRef = useRef(null);
  const viewCanvas = useRef(null);
  const overCanvas = useRef(null);
  const boxRef = useRef({ width: 1, height: 1, ratio: 1 });
  const viewRef = useRef(view);
  const pending = useRef({ full: true, rect: null });
  const frame = useRef(0);
  const pointer = useRef({ x: -100, y: -100, inside: false });
  const panning = useRef(null);
  const segmentsRef = useRef({ revision: -1, segments: new Int32Array(0), truncated: false });
  const phase = useRef(0);
  const focusRef = useRef(focus);
  const wallRef = useRef(wall);
  /* Мазок по стене: где он начался (непрерывный путь по стене) — точка листа и её свёртка. */
  const anchorRef = useRef(null);
  viewRef.current = view;
  focusRef.current = focus;
  wallRef.current = wall;

  const size = () => boxRef.current;
  /* То, что на экране под видом: лист или, в виде «стена», сама стена (в пикселях стены). */
  const spaceSize = useCallback(() => (wallRef.current ? { width: wallRef.current.width, height: wallRef.current.height } : { width: session.width, height: session.height }), [session]);

  /* ------------------------------- рисование ------------------------------- */

  const paintView = useCallback(() => {
    const canvas = viewCanvas.current;
    const flat = session.compositor.flat;
    if (!canvas || !flat) return;
    const { ratio } = boxRef.current;
    const context = canvas.getContext("2d");
    const current = viewRef.current;
    const todo = pending.current;
    pending.current = { full: false, rect: null };
    const space = wallRef.current;
    if (space) {
      /* Стена: лист — узором, каждый раз целиком (мазок правит лист, а на стене он отзывается во всех повторах). */
      const { width, height } = boxRef.current;
      context.save();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = getComputedStyle(canvas).getPropertyValue("--txs-bg") || "#17181b";
      context.fillRect(0, 0, width, height);
      const from = toScreen(current, { x: 0, y: 0 });
      const to = toScreen(current, { x: space.width, y: space.height });
      context.fillStyle = checkerPattern(context);
      context.fillRect(from.x, from.y, to.x - from.x, to.y - from.y);
      context.save();
      context.translate(current.x, current.y);
      context.scale(current.zoom, current.zoom);
      const pattern = context.createPattern(flat.canvas, "repeat");
      if (pattern && typeof DOMMatrix === "function") {
        const { a, b, c, d, e, f } = space.pattern;
        pattern.setTransform(new DOMMatrix([a, b, c, d, e, f]));
        context.imageSmoothingEnabled = current.zoom < 1.5;
        context.imageSmoothingQuality = "high";
        context.fillStyle = pattern;
        context.fillRect(0, 0, space.width, space.height);
      }
      context.restore();
      context.restore();
      return;
    }
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let screen = null;
    if (!todo.full && todo.rect) {
      /* Мазок: только тронутый кусок — из маленького кармана сборщика, а не из всего холста (его снимок стоил бы копии всего листа). */
      const margin = Math.ceil(2 / Math.max(0.05, current.zoom));
      const piece = session.compositor.piece({ x: todo.rect.x - margin, y: todo.rect.y - margin, width: todo.rect.width + margin * 2, height: todo.rect.height + margin * 2 });
      if (piece) {
        const origin = toScreen(current, { x: piece.area.x, y: piece.area.y });
        const width = piece.area.width * current.zoom;
        const height = piece.area.height * current.zoom;
        context.fillStyle = checkerPattern(context);
        context.fillRect(origin.x, origin.y, width, height);
        context.imageSmoothingEnabled = current.zoom < 1.5;
        context.imageSmoothingQuality = "high";
        context.drawImage(piece.canvas, 0, 0, piece.area.width, piece.area.height, origin.x, origin.y, width, height);
        context.restore();
        return;
      }
      const a = toScreen(current, { x: todo.rect.x, y: todo.rect.y });
      const b = toScreen(current, { x: todo.rect.x + todo.rect.width, y: todo.rect.y + todo.rect.height });
      screen = { x: Math.floor(a.x) - 1, y: Math.floor(a.y) - 1, width: Math.ceil(b.x - a.x) + 3, height: Math.ceil(b.y - a.y) + 3 };
      context.beginPath();
      context.rect(screen.x, screen.y, screen.width, screen.height);
      context.clip();
    }
    const { width, height } = boxRef.current;
    if (!screen) {
      context.fillStyle = getComputedStyle(canvas).getPropertyValue("--txs-bg") || "#17181b";
      context.fillRect(0, 0, width, height);
    }
    const docW = session.width * current.zoom;
    const docH = session.height * current.zoom;
    context.fillStyle = checkerPattern(context);
    context.fillRect(current.x, current.y, docW, docH);
    context.imageSmoothingEnabled = current.zoom < 1.5;
    context.imageSmoothingQuality = "high";
    context.drawImage(flat.canvas, 0, 0, session.width, session.height, current.x, current.y, docW, docH);
    context.restore();
  }, [session]);

  const schedule = useCallback(
    (rect = null) => {
      const todo = pending.current;
      if (!rect) todo.full = true;
      else if (!todo.full) {
        if (!todo.rect) todo.rect = { ...rect };
        else {
          const x0 = Math.min(todo.rect.x, rect.x);
          const y0 = Math.min(todo.rect.y, rect.y);
          const x1 = Math.max(todo.rect.x + todo.rect.width, rect.x + rect.width);
          const y1 = Math.max(todo.rect.y + todo.rect.height, rect.y + rect.height);
          todo.rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        }
      }
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        paintView();
      });
    },
    [paintView],
  );

  const paintOverlay = useCallback(() => {
    const canvas = overCanvas.current;
    if (!canvas) return;
    const { ratio, width, height } = boxRef.current;
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const current = viewRef.current;
    const at = (point) => toScreen(current, point);

    /* Стена: лист повторяется плиткой — повторы притушены, «главная» плитка (с серединой стены) яркая, швы пунктиром. */
    const space = wallRef.current;
    if (space) {
      const from = at({ x: 0, y: 0 });
      const to = at({ x: space.width, y: space.height });
      context.save();
      context.beginPath();
      context.rect(from.x, from.y, to.x - from.x, to.y - from.y);
      context.clip();
      const outline = (cell) => {
        context.beginPath();
        cell.corners.forEach((corner, index) => {
          const screenPoint = at(corner);
          if (index === 0) context.moveTo(screenPoint.x, screenPoint.y);
          else context.lineTo(screenPoint.x, screenPoint.y);
        });
        context.closePath();
      };
      if (space.tiles.count > 1 && space.tiles.cells.length) {
        context.fillStyle = "rgba(9, 10, 12, 0.34)";
        for (const cell of space.tiles.cells)
          if (!cell.main) {
            outline(cell);
            context.fill();
          }
        context.lineWidth = 1;
        context.strokeStyle = "rgba(255, 255, 255, 0.42)";
        context.setLineDash([6, 4]);
        for (const cell of space.tiles.cells) {
          outline(cell);
          context.stroke();
        }
      }
      context.restore();
      context.save();
      context.lineWidth = 1.5;
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue("--astral-accent").trim() || "#f4f4f5";
      context.strokeRect(Math.round(from.x) + 0.5, Math.round(from.y) + 0.5, Math.round(to.x - from.x), Math.round(to.y - from.y));
      context.restore();
    }

    /* Область выбранной поверхности: всё вокруг притушено, по краю — тонкая рамка. */
    if (!space && focus) {
      const a = at({ x: focus.x, y: focus.y });
      const b = at({ x: focus.x + focus.width, y: focus.y + focus.height });
      context.save();
      context.beginPath();
      context.rect(0, 0, width, height);
      context.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      context.fillStyle = "rgba(9, 10, 12, 0.72)";
      context.fill("evenodd");
      context.lineWidth = 1.5;
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue("--astral-accent").trim() || "#f4f4f5";
      context.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      context.restore();
    }

    /* Панели фасада: границы и номера. */
    if (!space && guides?.length) {
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(255, 255, 255, 0.55)";
      context.setLineDash([6, 4]);
      context.font = '600 12px "Segoe UI", system-ui, sans-serif';
      context.textBaseline = "top";
      for (const panel of guides) {
        const left = at({ x: panel.x, y: 0 });
        const right = at({ x: panel.x + panel.width, y: session.height });
        context.strokeRect(Math.round(left.x) + 0.5, Math.round(left.y) + 0.5, Math.round(right.x - left.x), Math.round(right.y - left.y));
        const text = panel.metres ? `${panel.label} · ${panel.metres[0]} × ${panel.metres[1]} ${tr("м")}` : panel.label;
        const pad = 6;
        const measured = context.measureText(text).width;
        context.setLineDash([]);
        context.fillStyle = "rgba(0, 0, 0, 0.65)";
        context.fillRect(left.x + 6, left.y + 6, measured + pad * 2, 20);
        context.fillStyle = "#fff";
        context.fillText(text, left.x + 6 + pad, left.y + 10);
        context.setLineDash([6, 4]);
      }
      context.restore();
    }

    /* Выделение: бегущие муравьи по границе маски. */
    const selection = space ? null : session.selection;
    if (selection) {
      if (segmentsRef.current.revision !== selectionRevision) segmentsRef.current = { revision: selectionRevision, ...maskSegments(selection) };
      const { segments, truncated } = segmentsRef.current;
      context.save();
      context.lineWidth = 1;
      if (!truncated) {
        const black = new Path2D();
        const white = new Path2D();
        const shift = phase.current;
        for (let index = 0; index < segments.length; index += 4) {
          const a = at({ x: segments[index], y: segments[index + 1] });
          const b = at({ x: segments[index + 2], y: segments[index + 3] });
          const on = (((segments[index] + segments[index + 1] + shift) >> 2) & 1) === 0;
          const path = on ? black : white;
          path.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
          path.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
        }
        context.strokeStyle = "#000";
        context.stroke(black);
        context.strokeStyle = "#fff";
        context.stroke(white);
      }
      context.restore();
    }

    /* Протяжка и ломаная. */
    const preview = overlay.get();
    if (preview) {
      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "#fff";
      context.shadowColor = "rgba(0, 0, 0, 0.8)";
      context.shadowBlur = 2;
      if (preview.kind === "marquee") {
        const a = at({ x: preview.rect.x, y: preview.rect.y });
        const b = at({ x: preview.rect.x + preview.rect.width, y: preview.rect.y + preview.rect.height });
        context.setLineDash(preview.dashed ? [4, 4] : []);
        context.beginPath();
        if (preview.shape === "ellipse") context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        else context.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        context.stroke();
      } else if (preview.kind === "lasso" || preview.kind === "polygon") {
        context.beginPath();
        preview.points.forEach((point, index) => {
          const screen = at(point);
          if (index === 0) context.moveTo(screen.x, screen.y);
          else context.lineTo(screen.x, screen.y);
        });
        if (preview.kind === "polygon" && preview.cursor) {
          const cursor = at(preview.cursor);
          context.lineTo(cursor.x, cursor.y);
        }
        context.stroke();
        const first = at(preview.points[0]);
        context.strokeRect(first.x - 4, first.y - 4, 8, 8);
      } else if (preview.kind === "line") {
        const a = at(preview.from);
        const b = at(preview.to);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.restore();
    }

    /* Рамка выбранного слоя-объекта (картинка, надпись, фигура). */
    if (!space && activeLayer && ["image", "text", "shape"].includes(activeLayer.type)) {
      let box = null;
      if (activeLayer.type === "image") box = { x: activeLayer.x, y: activeLayer.y, width: activeLayer.width, height: activeLayer.height };
      else if (activeLayer.type === "shape") box = { x: Math.min(activeLayer.x1, activeLayer.x2), y: Math.min(activeLayer.y1, activeLayer.y2), width: Math.abs(activeLayer.x2 - activeLayer.x1), height: Math.abs(activeLayer.y2 - activeLayer.y1) };
      else {
        const measured = measureText(overCanvas.current.getContext("2d"), activeLayer);
        box = { x: activeLayer.x - (activeLayer.align === "center" ? measured.width / 2 : activeLayer.align === "right" ? measured.width : 0), y: activeLayer.y, width: measured.width, height: measured.height };
      }
      const a = at({ x: box.x, y: box.y });
      const b = at({ x: box.x + box.width, y: box.y + box.height });
      context.save();
      context.strokeStyle = "rgba(120, 180, 255, 0.95)";
      context.lineWidth = 1;
      context.setLineDash([5, 3]);
      context.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      context.restore();
    }

    /* Курсор кисти: кружок размера кисти. */
    const tip = pointer.current;
    if (tip.inside && BRUSH_TOOLS.has(options.tool) && !spaceHeld) {
      const radius = Math.max(2, (options.size * current.zoom) / 2);
      context.save();
      context.strokeStyle = "rgba(255, 255, 255, 0.95)";
      context.lineWidth = 1;
      context.shadowColor = "rgba(0, 0, 0, 0.9)";
      context.shadowBlur = 1.5;
      context.beginPath();
      context.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }, [session, guides, focus, overlay, options.tool, options.size, activeLayer, selectionRevision, spaceHeld]);

  const overlayFrame = useRef(0);
  /* Рисует всегда свежая отрисовка: размер окна и события сессии держат `scheduleOverlay` с первого показа, а рамка поверхности и направляющие с тех пор менялись. */
  const paintOverlayRef = useRef(paintOverlay);
  paintOverlayRef.current = paintOverlay;
  const scheduleOverlay = useCallback(() => {
    if (overlayFrame.current) return;
    overlayFrame.current = requestAnimationFrame(() => {
      overlayFrame.current = 0;
      paintOverlayRef.current();
    });
  }, []);
  useEffect(() => {
    scheduleOverlay();
  }, [paintOverlay, scheduleOverlay]);

  /* ------------------------------ размер окна ------------------------------ */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const previous = boxRef.current;
      if (previous.width === width && previous.height === height && previous.ratio === ratio) return;
      boxRef.current = { width, height, ratio };
      for (const canvas of [viewCanvas.current, overCanvas.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      /* Первый размер — вписать область поверхности или холст; дальше вид остаётся, где был. */
      if (previous.width === 1 && previous.height === 1) onView(fitFocus(wallRef.current ? null : focusRef.current, spaceSize(), { width, height }));
      schedule();
      scheduleOverlay();
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
    // Размер окна следит за собой; вид меняется своими событиями.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    schedule();
    scheduleOverlay();
  }, [view, wall, schedule, scheduleOverlay]);

  useEffect(() => {
    scheduleOverlay();
  }, [scheduleOverlay, activeLayer, guides, selectionRevision, overlayTick]);

  /* «Весь лист» / «Эта поверхность»: вид вписывается в новую рамку; на первом показе его уже вписал размер окна. */
  const focusKey = wall ? `wall:${Math.round(wall.width)}:${Math.round(wall.height)}` : focus ? `${focus.x}:${focus.y}:${focus.width}:${focus.height}` : "";
  const shownFocus = useRef(focusKey);
  useEffect(() => {
    if (shownFocus.current === focusKey) return;
    shownFocus.current = focusKey;
    onView(fitFocus(wallRef.current ? null : focusRef.current, spaceSize(), size()));
    // Вид меняется только от смены рамки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  /* События сессии: мазок — кусок, остальное — весь холст. */
  useEffect(
    () =>
      session.subscribe((event) => {
        if (event.kind === "pixels") schedule(event.rect);
        else if (event.kind === "doc") schedule();
        scheduleOverlay();
      }),
    [session, schedule, scheduleOverlay],
  );

  useEffect(() => {
    schedule();
  }, [flatVersion, schedule]);

  /* Муравьи бегут: четыре кадра в секунду, пока есть выделение. */
  useEffect(() => {
    if (!selectionRevision && !session.selection) return undefined;
    const timer = window.setInterval(() => {
      phase.current = (phase.current + 1) % 8;
      scheduleOverlay();
    }, 250);
    return () => window.clearInterval(timer);
  }, [selectionRevision, session, scheduleOverlay]);

  useEffect(
    () => () => {
      /* Номера обнуляем: React в разработке монтирует окно заново, и застрявший номер глушил бы все перерисовки. */
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(overlayFrame.current);
      frame.current = 0;
      overlayFrame.current = 0;
    },
    [],
  );

  /* ---------------------------------- мышь --------------------------------- */

  const local = (event) => {
    const rect = overCanvas.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  /* Точка листа под мышью; в виде «стена» — через развёртку стены, без свёртки в лист. */
  const rawDoc = (event) => {
    const point = local(event);
    const current = viewRef.current;
    const x = (point.x - current.x) / current.zoom;
    const y = (point.y - current.y) / current.zoom;
    const space = wallRef.current;
    return space ? space.toDoc(x, y) : { x, y };
  };
  /* В виде «стена» путь мазка непрерывен: стартовая точка свёрнута в лист, дальше — те же шаги по стене (сессия сворачивает кисть через край сама). */
  const docPoint = (event) => {
    const raw = rawDoc(event);
    const space = wallRef.current;
    if (!space) return raw;
    const anchor = anchorRef.current;
    if (anchor) return { x: anchor.start.x + raw.x - anchor.from.x, y: anchor.start.y + raw.y - anchor.from.y };
    return wrapPoint(raw, space.docWidth, space.docHeight);
  };

  const onPointerDown = (event) => {
    overCanvas.current.setPointerCapture?.(event.pointerId);
    hostRef.current?.focus?.();
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      panning.current = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    if (wallRef.current) {
      const raw = rawDoc(event);
      anchorRef.current = { from: raw, start: wrapPoint(raw, wallRef.current.docWidth, wallRef.current.docHeight) };
    }
    controller.down(docPoint(event), event);
    scheduleOverlay();
  };
  const onPointerMove = (event) => {
    const point = local(event);
    pointer.current = { x: point.x, y: point.y, inside: true };
    if (panning.current) {
      const dx = event.clientX - panning.current.x;
      const dy = event.clientY - panning.current.y;
      panning.current = { x: event.clientX, y: event.clientY };
      onView(clampView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }, spaceSize(), size()));
      return;
    }
    controller.move(docPoint(event), event);
    scheduleOverlay();
  };
  const onPointerUp = (event) => {
    overCanvas.current.releasePointerCapture?.(event.pointerId);
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (event.button !== 0) return;
    const point = docPoint(event);
    controller.up(point, { ...event, shiftKey: event.shiftKey, altKey: event.altKey, offsetX: local(event).x, offsetY: local(event).y });
    anchorRef.current = null;
    scheduleOverlay();
  };
  const onPointerLeave = () => {
    pointer.current = { ...pointer.current, inside: false };
    scheduleOverlay();
  };
  const onDoubleClick = (event) => {
    if (controller.polygon) {
      controller.finishPolygon();
      event.preventDefault();
    }
  };

  const onWheel = useCallback(
    (event) => {
      event.preventDefault();
      const rect = overCanvas.current.getBoundingClientRect();
      const around = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const current = viewRef.current;
      if (event.shiftKey) {
        onView(clampView({ ...current, x: current.x - event.deltaY }, spaceSize(), size()));
        return;
      }
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      onView(clampView(zoomAt(current, current.zoom * factor, around), spaceSize(), size()));
    },
    [onView, spaceSize],
  );

  useEffect(() => {
    const canvas = overCanvas.current;
    canvas?.addEventListener("wheel", onWheel, { passive: false });
    /* Колесо над холстом — приближение: метка для правила `scroll`. */
    const unmarkWheel = markWheel(canvas);
    return () => {
      canvas?.removeEventListener("wheel", onWheel);
      unmarkWheel();
    };
  }, [onWheel]);

  useImperativeHandle(
    ref,
    () => ({
      box: () => ({ ...boxRef.current }),
      fit: () => onView(fitFocus(wallRef.current ? null : focusRef.current, spaceSize(), size())),
      fitAll: () => onView(fitView(spaceSize(), size())),
      actual: () => onView(actualView(spaceSize(), size())),
      zoomStep: (direction, around = null) => {
        const box = size();
        const point = around && around.x ? around : { x: box.width / 2, y: box.height / 2 };
        onView(clampView(zoomAt(viewRef.current, stepZoom(viewRef.current.zoom, direction), point), spaceSize(), box));
      },
      zoomTo: (rect) => onView(viewOfRect(rect, size())),
      pan: (dx, dy) => onView(clampView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy }, spaceSize(), size())),
      visible: () => visibleRect(viewRef.current, size()),
      refresh: () => schedule(),
    }),
    [onView, schedule, spaceSize],
  );

  const cursor = spaceHeld || options.tool === "hand" ? "grab" : options.tool === "zoom" ? "zoom-in" : options.tool === "picker" ? "crosshair" : options.tool === "move" ? "move" : options.tool === "text" ? "text" : BRUSH_TOOLS.has(options.tool) ? "none" : "crosshair";

  return (
    <div ref={hostRef} className="txs-viewport" tabIndex={-1} role="application" aria-label={label || tr("Холст студии")}>
      <canvas ref={viewCanvas} className="txs-view-canvas" aria-hidden="true" />
      <canvas
        ref={overCanvas}
        className="txs-over-canvas"
        aria-hidden="true"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
});

export default StudioViewport;
