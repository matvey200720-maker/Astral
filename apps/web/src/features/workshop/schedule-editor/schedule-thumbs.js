/*
 * Плитки значков «Расписания» для панели: значок сервера или значок Astral
 * на белом квадрате — как на табло сервера (data URL; без холста — пусто,
 * и плитка рисует пустую рамку). Один раз на значок за окно.
 */

import { useEffect, useState } from "react";
import { SCHEDULE_ASTRAL_ICON_GRID, SCHEDULE_ICONS, SCHEDULE_SERVER_COLOURS, findScheduleAstralIcon } from "@modovik/climb-contract/recolor/schedule";

/* Пропорция квадрата значка у сервера (256 × 220). */
const THUMB = { width: 256, height: 220 };
const thumbs = new Map();

function context2d(canvas) {
  try {
    return canvas.getContext("2d") || null;
  } catch {
    return null;
  }
}

function paper() {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB.width;
  canvas.height = THUMB.height;
  const context = context2d(canvas);
  if (!context) return null;
  context.fillStyle = SCHEDULE_SERVER_COLOURS.box;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function astralThumb(id) {
  const icon = findScheduleAstralIcon(id);
  if (!icon || typeof Path2D !== "function") return Promise.resolve("");
  const sheet = paper();
  if (!sheet) return Promise.resolve("");
  const side = THUMB.height * 0.8;
  sheet.context.translate((THUMB.width - side) / 2, (THUMB.height - side) / 2);
  sheet.context.scale(side / SCHEDULE_ASTRAL_ICON_GRID, side / SCHEDULE_ASTRAL_ICON_GRID);
  sheet.context.fillStyle = SCHEDULE_SERVER_COLOURS.icon;
  sheet.context.fill(new Path2D(icon.path), "nonzero");
  return Promise.resolve(sheet.canvas.toDataURL?.() || "");
}

function serverThumb(id) {
  const icon = SCHEDULE_ICONS.find((item) => item.id === id);
  if (!icon || typeof Image === "undefined") return Promise.resolve("");
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const sheet = paper();
      if (!sheet) return resolve("");
      sheet.context.drawImage(image, 0, 0, THUMB.width, THUMB.height);
      resolve(sheet.canvas.toDataURL?.() || "");
    };
    image.onerror = () => resolve("");
    image.src = icon.url;
  });
}

function thumbOf(id) {
  if (!thumbs.has(id)) {
    const made = (findScheduleAstralIcon(id) ? astralThumb(id) : serverThumb(id)).catch(() => "");
    thumbs.set(id, made);
    made.then((url) => {
      if (!url) thumbs.delete(id);
    });
  }
  return thumbs.get(id);
}

/** Плитка значка сервера или Astral (`""`, пока рисуется или без холста). */
export function useIconThumb(id) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!id || typeof document === "undefined") {
      setUrl("");
      return undefined;
    }
    let cancelled = false;
    thumbOf(id).then((value) => !cancelled && setUrl(value));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return url;
}
