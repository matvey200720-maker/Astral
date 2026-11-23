/*
 * Листы щитов в кадре: облик работы на листе рекламы — той же функцией, что
 * у установщика (`paintBillboardOnSheet` договора): основа — лист игры
 * игрока (`loadSceneImage`, читает Astral Desktop), сверху — картинка щита
 * на его месте и рисунок поверх. Что видно в кадре, то и уедет в игру.
 *
 * Пиксели (основа листа, своя картинка) живут здесь, в кэше окна, а не в
 * состоянии React: в пропсах ездят только готовые текстуры кадра.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BILLBOARD_LIST,
  billboardAspect,
  billboardDrawingKey,
  billboardLiveState,
  billboardLookIsStock,
  billboardLookOf,
  billboardPixels,
  billboardSheet,
} from "@modovik/climb-contract/recolor/billboards";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { placeModelAnimationFrameAt } from "@modovik/climb-contract/recolor/place-models";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { drawingPixels, prepareDrawingFonts } from "./billboards-drawing.js";
import { billboardSheetPixels, paintBillboardItem } from "./billboards-sheet.js";
import { imageBlobPixels } from "../hangar-editor/hangar-emblem.js";
import { SURFACE_STOCK_SIDE, surfaceCanvas } from "../surface-stock.js";

/* Своей картинке в кадре хватает 1024 px по длинной стороне; листы — до 1024. */
const IMAGE_SIDE = 1024;
const SHEET_SIDES = [64, 128, 256, 512, 1024];

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/* Лица щитов по листам (вблизи): лист → `[{ board, entry }]`. */
let facesBySheet = null;
function sheetFaces(sheetId) {
  if (!facesBySheet) {
    facesBySheet = new Map();
    for (const board of BILLBOARD_LIST)
      for (const entry of board.faces) {
        const list = facesBySheet.get(entry.sheet) || [];
        list.push({ board, entry });
        facesBySheet.set(entry.sheet, list);
      }
  }
  return facesBySheet.get(sheetId) || [];
}

/* Своя картинка пикселями (кэш окна по ключу хранилища): разбор и чтение — в фоновом потоке (`imageBlobPixels`), без него — здесь. */
const assets = new Map();
export function assetPixels(asset) {
  if (!asset) return Promise.resolve(null);
  if (assets.has(asset)) return assets.get(asset);
  const pending = (async () => {
    const blob = await getWorkshopAsset(asset).catch(() => null);
    if (!blob) return null;
    const off = await imageBlobPixels(blob, IMAGE_SIDE);
    if (off) return off;
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (!bitmap) return null;
    const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = context2d(canvasOf(width, height));
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { rgba: context.getImageData(0, 0, width, height).data, width, height };
  })();
  assets.set(asset, pending);
  pending.then((value) => !value && assets.delete(asset));
  while (assets.size > 12) assets.delete(assets.keys().next().value);
  return pending;
}

/* Основа листа пикселями: лист игры игрока или средний цвет листа (браузер без Astral Desktop). */
const bases = new Map();
export function basePixels(sheet) {
  if (bases.has(sheet.id)) return bases.get(sheet.id);
  const side = SHEET_SIDES.find((value) => value >= Math.max(sheet.width, sheet.height)) || 1024;
  const pending = (async () => {
    const image = await loadSceneImage({ game: sheet.at, texture: sheet.name }, side).catch(() => null);
    const width = image?.width || Math.min(sheet.width, 512);
    const height = image?.height || Math.min(sheet.height, 512);
    const context = context2d(canvasOf(width, height));
    if (!context) return null;
    if (image) context.drawImage(image, 0, 0, width, height);
    else {
      const [r, g, b] = hexBytes(sheet.colour || "#808080");
      context.fillStyle = `rgb(${r}, ${g}, ${b})`;
      context.fillRect(0, 0, width, height);
    }
    return { rgba: context.getImageData(0, 0, width, height).data, width, height, real: Boolean(image) };
  })();
  bases.set(sheet.id, pending);
  pending.then((value) => !value?.real && bases.delete(sheet.id));
  while (bases.size > 24) bases.delete(bases.keys().next().value);
  return pending;
}

/* Лицо щита, что крупнее всего на листе: основа «Как в игре» — с него. */
export function mainFace(board) {
  let best = null;
  for (const entry of board?.faces || []) {
    const sheet = billboardSheet(entry.sheet);
    if (!sheet) continue;
    const [w, h] = billboardPixels(entry, sheet.width, sheet.height);
    if (!best || w * h > best.area) best = { entry, sheet, area: w * h };
  }
  return best;
}

/* Реклама игры на месте щита — картинкой `width × height` с листа (или средним цветом без Astral Desktop). */
export async function stockPicture(board, width, height, brightness) {
  const face = mainFace(board);
  if (!face) return null;
  const base = await basePixels(face.sheet);
  if (!base) return null;
  const [a, b, c] = face.entry.map;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const factor = brightness / 100;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const s = (x + 0.5) / width;
      const t = (y + 0.5) / height;
      const u = a[0] + (b[0] - a[0]) * s + (c[0] - a[0]) * t;
      const v = a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * t;
      const px = Math.min(base.width - 1, Math.max(0, Math.floor(u * base.width)));
      const py = Math.min(base.height - 1, Math.max(0, Math.floor(v * base.height)));
      const from = (py * base.width + px) * 4;
      const to = (y * width + x) * 4;
      rgba[to] = base.rgba[from] * factor;
      rgba[to + 1] = base.rgba[from + 1] * factor;
      rgba[to + 2] = base.rgba[from + 2] * factor;
      rgba[to + 3] = 255;
    }
  return { rgba, real: base.real };
}

/*
 * Реклама игры на месте щита — холстом в пропорции щита, не больше `side` по большей стороне: рамка «Своя картинка» показывает, что на
 * щите сейчас (`useSurfaceStock`). Лист игры ложится на холст аффинным переносом `drawImage` по углам лица (`entry.map`), без цикла по
 * пикселям. `null` — листа нет: окно без Astral Desktop или лист не прочитан (средний цвет листа рамке не показываем).
 */
export async function stockFace(board, side = SURFACE_STOCK_SIDE) {
  const face = mainFace(board);
  if (!face) return null;
  const sheetSide = SHEET_SIDES.find((value) => value >= Math.max(face.sheet.width, face.sheet.height)) || 1024;
  const image = await loadSceneImage({ game: face.sheet.at, texture: face.sheet.name }, sheetSide).catch(() => null);
  if (!image?.width || !image?.height) return null;
  const aspect = billboardAspect(board) || 1;
  const width = aspect >= 1 ? side : Math.max(1, Math.round(side * aspect));
  const height = aspect >= 1 ? Math.max(1, Math.round(side / aspect)) : side;
  const made = surfaceCanvas(width, height);
  if (!made) return null;
  /* Точка холста (x, y) → точка листа: i = A·(x, y) + o; холсту нужен обратный перенос. */
  const [a, b, c] = face.entry.map;
  const A = [
    [((b[0] - a[0]) * image.width) / width, ((c[0] - a[0]) * image.width) / height],
    [((b[1] - a[1]) * image.height) / width, ((c[1] - a[1]) * image.height) / height],
  ];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  if (Math.abs(det) < 1e-9) return null;
  const inv = [
    [A[1][1] / det, -A[0][1] / det],
    [-A[1][0] / det, A[0][0] / det],
  ];
  const o = [a[0] * image.width, a[1] * image.height];
  made.context.setTransform(inv[0][0], inv[1][0], inv[0][1], inv[1][1], -(inv[0][0] * o[0] + inv[0][1] * o[1]), -(inv[1][0] * o[0] + inv[1][1] * o[1]));
  made.context.drawImage(image, 0, 0);
  return made.canvas;
}

/* Текстура листа и то, чем её обновлять кусками: контекст холста и пиксели, что он показывает (гифка меняет кадр на месте щита). */
function textureOf(rgba, width, height) {
  const context = context2d(canvasOf(width, height));
  if (!context) return null;
  const imageData = new ImageData(rgba, width, height);
  context.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData = { context, imageData };
  return texture;
}

/** Отпечаток облика щитов листа: тот же облик — тот же лист кадра. */
export function sheetLookKey(project, sheetId, focus = null) {
  const gifs = billboardLiveState(project).states;
  return JSON.stringify([
    focus,
    sheetFaces(sheetId).map(({ board }) => {
      const look = billboardLookOf(project, board.id);
      /* Рисунок — ключом его картинки: тысячи точек в отпечаток не нужны; гифка — играет она или стоит первым кадром. */
      return billboardLookIsStock(look) ? 0 : { ...look, drawing: billboardDrawingKey(look.drawing), gif: gifs.get(board.id) || null };
    }),
  ]);
}

const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-4;

/*
 * Щиты другой модели на том же месте листа, которых установщик разводит
 * своей копией словаря (`split`), в кадр взятого щита не рисуются: в игре у
 * его модели свой лист.
 */
function hiddenBySplit(item, focusEntries) {
  return Boolean(item.entry.split) && focusEntries.some((focus) => focus.entry.arch !== item.entry.arch && overlaps(focus.entry.clip, item.entry.clip));
}

/*
 * Поток первого кадра листа (`billboards-sheet-worker.js`; 31.10.2026, вечер: после фриза своей картинки — облик щита в его место листа на
 * главном потоке держал окно ~100 мс при ×4). Без `Worker` (тесты) и при сбое — здесь же, как раньше.
 */
const sheetWork = { worker: null, seq: 0, pending: new Map() };
function sheetWorker() {
  if (sheetWork.worker !== null) return sheetWork.worker;
  if (typeof Worker !== "function") return (sheetWork.worker = false);
  try {
    sheetWork.worker = new Worker(new URL("./billboards-sheet-worker.js", import.meta.url), { type: "module" });
  } catch {
    return (sheetWork.worker = false);
  }
  sheetWork.worker.onmessage = (event) => {
    const { id, error, rgba } = event.data || {};
    const job = sheetWork.pending.get(id);
    if (!job) return;
    sheetWork.pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(rgba);
  };
  sheetWork.worker.onerror = (event) => {
    for (const job of sheetWork.pending.values()) job.reject(new Error(event.message || "billboards-sheet-worker"));
    sheetWork.pending.clear();
    /* Поток не встал (чанк не загрузился) — дальше считаем здесь: письма в мёртвый поток без ответа повесили бы лист. */
    sheetWork.worker = false;
  };
  return sheetWork.worker;
}

function billboardSheetAsync(job) {
  const worker = sheetWorker();
  if (!worker) return Promise.resolve(billboardSheetPixels(job));
  const id = (sheetWork.seq += 1);
  return new Promise((resolve, reject) => {
    sheetWork.pending.set(id, { resolve, reject });
    worker.postMessage({ id, job });
  }).catch(() => billboardSheetPixels(job));
}

/**
 * Составной лист: облик щитов работы на листе. `{ texture, real }` —
 * `real`: основа — лист игры игрока, а не средний цвет. `focus` — щит
 * кадра: его облик на листе — тот, что будет у него в игре.
 */
export async function composeSheet(sheetId, project, focus = null) {
  const sheet = billboardSheet(sheetId);
  if (!sheet) return null;
  const base = await basePixels(sheet);
  if (!base) return null;
  const focusEntries = sheetFaces(sheetId).filter((item) => item.board.id === focus);
  const gifs = billboardLiveState(project).states;
  const items = [];
  for (const item of sheetFaces(sheetId)) {
    const { board, entry } = item;
    if (board.id !== focus && hiddenBySplit(item, focusEntries)) continue;
    const look = billboardLookOf(project, board.id);
    if (billboardLookIsStock(look)) continue;
    const image = look.mode === "image" ? await assetPixels(look.image.asset) : null;
    /* Рисунок поверх облика — тем же холстом, что уедет в игру. */
    await prepareDrawingFonts(look.drawing);
    const drawing = drawingPixels(look.drawing);
    items.push({ entry, look, image, drawing, aspect: billboardAspect(board), live: Boolean(gifs.get(board.id) === "live" && look.image.animation && image) });
  }
  /* Первый кадр листа — в фоновом потоке (`billboards-sheet.js`); щиты, чья гифка играет, меняют кадр на ходу здесь же (`paint`). */
  const rgba = await billboardSheetAsync({ base: { rgba: base.rgba, width: base.width, height: base.height }, items: items.map(({ live: _live, ...item }) => item) });
  const live = items
    .filter((item) => item.live)
    .map((item) => ({ entry: item.entry, animation: item.look.image.animation, paint: (frame) => paintBillboardItem(rgba, base.width, base.height, item, frame), frame: 0 }));
  const texture = textureOf(rgba, base.width, base.height);
  /* Кусок листа с местом щита — в холст и в видеокарту: весь лист на каждый кадр гифки не гоняем. */
  const dirty = (entry) => {
    const x0 = Math.max(0, Math.floor(entry.clip[0] * base.width) - 1);
    const y0 = Math.max(0, Math.floor(entry.clip[1] * base.height) - 1);
    const x1 = Math.min(base.width, Math.ceil(entry.clip[2] * base.width) + 1);
    const y1 = Math.min(base.height, Math.ceil(entry.clip[3] * base.height) + 1);
    return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
  };
  return {
    texture,
    real: base.real,
    live: texture
      ? live.map((item) => ({
          animation: item.animation,
          frame: 0,
          show(frame) {
            item.paint(frame);
            texture.userData.context.putImageData(texture.userData.imageData, 0, 0, ...dirty(item.entry));
            texture.needsUpdate = true;
          },
        }))
      : [],
  };
}

/**
 * Текстуры составных листов для кадра: `sheetIds` — листы рекламы сцены,
 * ответ — `{ textures: { [лист]: texture }, real }`. Пересобираются только
 * листы, у чьих щитов поменялся облик; старые текстуры освобождаются.
 */
export function useBillboardSheets(sheetIds, project, focus = null) {
  const keys = useMemo(() => Object.fromEntries((sheetIds || []).map((id) => [id, sheetLookKey(project, id, focus)])), [sheetIds, project, focus]);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const signature = JSON.stringify(keys);
  const [state, setState] = useState({ textures: {}, real: true });
  const made = useRef(new Map());
  /* Кадр гифки на листах кадра: вызывается каждый кадр сцены; меняет только те щиты, у кого кадр сменился. */
  const tick = useCallback((seconds) => {
    for (const item of made.current.values())
      for (const gif of item.live || []) {
        const frame = placeModelAnimationFrameAt(gif.animation, seconds);
        if (frame === gif.frame) continue;
        gif.frame = frame;
        gif.show(frame);
      }
  }, []);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    let cancelled = false;
    const wanted = JSON.parse(signature);
    const timer = setTimeout(async () => {
      const next = {};
      let real = true;
      for (const [sheetId, key] of Object.entries(wanted)) {
        const known = made.current.get(sheetId);
        if (known?.key === key) {
          next[sheetId] = known.texture;
          real &&= known.real;
          continue;
        }
        const composed = await composeSheet(sheetId, projectRef.current, focusRef.current).catch(() => null);
        if (cancelled) {
          composed?.texture?.dispose?.();
          return;
        }
        if (!composed?.texture) continue;
        known?.texture?.dispose?.();
        made.current.set(sheetId, { key, texture: composed.texture, real: composed.real, live: composed.live });
        next[sheetId] = composed.texture;
        real &&= composed.real;
      }
      for (const [sheetId, item] of made.current)
        if (!(sheetId in wanted)) {
          item.texture?.dispose?.();
          made.current.delete(sheetId);
        }
      if (!cancelled) setState({ textures: next, real, playing: [...made.current.values()].some((item) => item.live?.length) });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature]);
  useEffect(
    () => () => {
      for (const item of made.current.values()) item.texture?.dispose?.();
      made.current.clear();
    },
    [],
  );
  return { ...state, tick };
}
