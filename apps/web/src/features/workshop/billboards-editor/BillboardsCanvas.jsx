/*
 * Холст инструмента «Рисунок» (задача 3 ТЗ 17.10.2026): полотно щита
 * плоско, в его пропорции — кисть, ластик, заливка и надпись прямо на нём.
 *
 * Три слоя одного размера (холст рисунка, `look.drawing.size`):
 *   • основа — облик щита под рисунком: своя картинка, цвет, градиент или
 *     реклама игры с листа вашей GTA V (`basePixels`), той же арифметикой,
 *     что у кадра и установщика;
 *   • рисунок — шаги работы (`drawingCanvas`);
 *   • живой слой — штрих, пока кнопка мыши зажата, и кружок кисти под
 *     курсором (у надписи — сама надпись).
 * Штрих уходит в работу, когда кнопку отпускают: один штрих — один шаг
 * «Отменить» редактора.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  billboard,
  billboardAspect,
  billboardDrawingHas,
  billboardDrawingSize,
  billboardLookOf,
  billboardPicture,
  normalizeBillboardLook,
} from "@modovik/climb-contract/recolor/billboards";
import { assetPixels, stockPicture } from "./billboards-art.js";
import { brushBlur, drawingCanvas, drawingFont, paintStroke } from "./billboards-drawing.js";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { tr, useTr } from "../../../locales/ui.js";
import { boardLabelText, trFill } from "./billboards-text.js";

/* Поля вокруг полотна в кадре (px экрана). */
const MARGIN = 28;
/* Точки штриха — не чаще, чем через столько пикселей холста. */
const STEP = 1.5;

function context2d(canvas) {
  try {
    return canvas?.getContext("2d") || null;
  } catch {
    return null;
  }
}

/** Холст рисунка щита: свой у рисунка, иначе — по пропорции щита. */
export function drawingSizeOf(board, look) {
  return billboardDrawingHas(look?.drawing) ? look.drawing.size : billboardDrawingSize(billboardAspect(board));
}

export default function BillboardsCanvas({ project, boardId, settings, onStroke, onSheets = null }) {
  useTr();
  const board = billboard(boardId);
  const look = useMemo(() => normalizeBillboardLook(billboardLookOf(project, boardId)), [project, boardId]);
  const [width, height] = drawingSizeOf(board, look);
  const frameRef = useRef(null);
  const baseRef = useRef(null);
  const drawRef = useRef(null);
  const liveRef = useRef(null);
  const scratchRef = useRef(null);
  const strokeRef = useRef(null);
  const [box, setBox] = useState(null);
  const [real, setReal] = useState(true);
  /* Лист игры не прочитан — по «?» в колонке, не строкой на холсте (`design-qa.md`, п. 14). */
  useEffect(() => {
    onSheets?.(real);
  }, [onSheets, real]);
  const [busy, setBusy] = useState(false);

  /* Полотно вписано в кадр по пропорции холста. */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const fit = () => {
      const availableWidth = Math.max(40, frame.clientWidth - MARGIN * 2);
      const availableHeight = Math.max(40, frame.clientHeight - MARGIN * 2);
      const scale = Math.min(availableWidth / width, availableHeight / height);
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      setBox({ left: Math.round((frame.clientWidth - w) / 2), top: Math.round((frame.clientHeight - h) / 2), width: w, height: h });
    };
    fit();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [width, height]);

  const placed = Boolean(box);

  /* Основа: облик щита под рисунком. */
  const baseKey = JSON.stringify([boardId, width, height, placed, { ...look, drawing: null }]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const canvas = baseRef.current;
      const context = context2d(canvas);
      if (!context) return;
      const bare = { ...look, drawing: { size: [0, 0], ops: [] } };
      let picture = null;
      let fromGame = true;
      if (bare.mode === "colour" || bare.mode === "gradient" || (bare.mode === "image" && bare.image.asset)) {
        const image = bare.mode === "image" ? await assetPixels(bare.image.asset) : null;
        picture = billboardPicture(bare, image, width, height, width / height);
      }
      if (!picture) {
        const stock = await stockPicture(board, width, height, bare.brightness);
        picture = stock && { rgba: stock.rgba, width, height };
        fromGame = Boolean(stock?.real);
      }
      if (cancelled) return;
      canvas.width = width;
      canvas.height = height;
      if (picture) context.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), width, height), 0, 0);
      setReal(fromGame);
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- основа пересобирается по отпечатку облика */
  }, [baseKey]);

  /* Рисунок работы. */
  useEffect(() => {
    const canvas = drawRef.current;
    const context = context2d(canvas);
    if (!context) return;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    const drawn = drawingCanvas(look.drawing);
    if (drawn) context.drawImage(drawn, 0, 0);
    if (canvas.style) canvas.style.visibility = "visible";
    setBusy(false);
    /* `placed` — холсты в разметке появляются, когда полотно вписано в кадр. */
  }, [look.drawing, width, height, placed]);

  /* Точка холста под указателем. */
  function pointOf(event) {
    const rect = liveRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [((event.clientX - rect.left) / rect.width) * width, ((event.clientY - rect.top) / rect.height) * height];
  }

  /* Живой слой: штрих поверх рисунка или кружок кисти / надпись под курсором. */
  function paintLive(point) {
    const live = liveRef.current;
    const context = context2d(live);
    if (!context) return;
    if (live.width !== width || live.height !== height) {
      live.width = width;
      live.height = height;
    }
    context.clearRect(0, 0, width, height);
    const stroke = strokeRef.current;
    if (stroke) {
      if (!scratchRef.current) scratchRef.current = document.createElement("canvas");
      const scratch = scratchRef.current;
      if (scratch.width !== width || scratch.height !== height) {
        scratch.width = width;
        scratch.height = height;
      }
      const drawn = drawingCanvas(look.drawing);
      if (drawn) context.drawImage(drawn, 0, 0);
      paintStroke(context, scratch, stroke);
      return;
    }
    if (!point) return;
    const [x, y] = point;
    if (settings.tool === "text") {
      if (!settings.text.trim()) return;
      context.save();
      context.globalAlpha = 0.6;
      context.font = drawingFont({ size: settings.textSize, font: settings.font, fontAsset: settings.fontAsset, bold: settings.bold });
      context.textAlign = "center";
      context.textBaseline = "middle";
      const [r, g, b] = hexBytes(settings.colour);
      context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      context.fillText(settings.text, x, y);
      context.restore();
      return;
    }
    if (settings.tool === "fill") return;
    /* Кружок кисти: размер и мягкий край. */
    const radius = settings.size / 2;
    context.save();
    context.lineWidth = Math.max(1, width / 600);
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "rgba(0, 0, 0, 0.6)";
    context.beginPath();
    context.arc(x, y, radius + context.lineWidth, 0, Math.PI * 2);
    context.stroke();
    const blur = brushBlur(settings.size, settings.hardness);
    if (blur > 0.3) {
      context.setLineDash([4, 4]);
      context.strokeStyle = "rgba(255, 255, 255, 0.6)";
      context.beginPath();
      context.arc(x, y, Math.max(1, radius - blur), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function onPointerDown(event) {
    /* Левая кнопка (или перо, палец): правая и средняя — мимо. */
    if ((event.button ?? 0) > 0 || busy) return;
    const point = pointOf(event);
    if (!point) return;
    const [x, y] = point.map((value) => Math.round(value));
    if (settings.tool === "fill") {
      onStroke({ tool: "fill", colour: settings.colour, x, y, tolerance: settings.tolerance });
      return;
    }
    if (settings.tool === "text") {
      onStroke({ tool: "text", colour: settings.colour, x, y, text: settings.text, size: settings.textSize, font: settings.font, ...(settings.font === "custom" ? { fontAsset: settings.fontAsset } : {}), bold: settings.bold });
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    strokeRef.current = {
      tool: settings.tool,
      colour: settings.colour,
      size: settings.size,
      hardness: settings.hardness,
      opacity: settings.opacity,
      points: [x, y],
    };
    if (drawRef.current?.style) drawRef.current.style.visibility = "hidden";
    paintLive(point);
  }

  function onPointerMove(event) {
    const point = pointOf(event);
    if (!point) return;
    const stroke = strokeRef.current;
    if (stroke) {
      const [lastX, lastY] = stroke.points.slice(-2);
      if (Math.hypot(point[0] - lastX, point[1] - lastY) < STEP) return;
      stroke.points.push(Math.round(point[0]), Math.round(point[1]));
    }
    paintLive(point);
  }

  function onPointerUp(event) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    /* Пока работа не пришла с новым шагом, живой слой держит штрих — без мигания. Не лёг (рисунок полон) — как было. */
    if (onStroke(stroke)) {
      setBusy(true);
      return;
    }
    if (drawRef.current?.style) drawRef.current.style.visibility = "visible";
    context2d(liveRef.current)?.clearRect(0, 0, width, height);
  }

  function onPointerLeave() {
    if (!strokeRef.current) paintLive(null);
  }

  /* Штрих пришёл в работу (или не лёг) — живой слой пуст. */
  useEffect(() => {
    if (!strokeRef.current) context2d(liveRef.current)?.clearRect(0, 0, width, height);
  }, [look.drawing, width, height]);

  const layer = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  const cursor = settings.tool === "fill" || settings.tool === "text" ? "crosshair" : "none";
  const where = board ? boardLabelText(board) : tr("Щит");
  return (
    <div className="fx-stage recolor-stage is-studio billboards-canvas-stage">
      <div ref={frameRef} className="model-stage-frame">
        {box && (
          <div style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height }}>
            <canvas ref={baseRef} width={width} height={height} style={layer} aria-hidden="true" />
            <canvas ref={drawRef} width={width} height={height} style={layer} aria-hidden="true" />
            <canvas
              ref={liveRef}
              width={width}
              height={height}
              style={{ ...layer, cursor, touchAction: "none" }}
              role="img"
              aria-label={trFill("Полотно «{0}» для рисунка: {1} × {2} px", where, width, height)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerLeave}
            />
          </div>
        )}
      </div>
    </div>
  );
}
