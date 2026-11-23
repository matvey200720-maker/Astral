/*
 * «Расписание» в 3D-кадре — тот же лист, что уедет в игру
 * (`schedule-sheet.js`), на плашке в размер табло сервера. Плитки и обложка
 * — без three.js, в `schedule-sheet.js`.
 *
 * Кадр: плашка щита места над площадкой — лицом к камере (в −Y, как у табло
 * в игре), лист работы или облик сервера; без свечения плашку освещает
 * свет кадра (у игры `default` — свет мира), со свечением она светится сама
 * (`emissive`). Сзади плашки нет — в игре табло тоже видно только спереди.
 *
 * Плашка выбирается щелчком (18.10.2026): она называется кадру
 * (`userData.pick`, `schedule-aim.js`), а выбранная строка или заголовок
 * обводятся рамкой (`scheduleSelectionObject`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  SCHEDULE_BOARD,
  SCHEDULE_SHEET,
  normalizeScheduleProject,
  scheduleIsStock,
  scheduleSignature,
} from "@modovik/climb-contract/recolor/schedule";
import { disposeProxies, shapeProxy } from "../model-stage/selection-highlight.js";
import { SCHEDULE_BOARD_PICK, scheduleSelectionRect, scheduleSheetSize } from "./schedule-aim.js";
import { loadServerSheet, paintScheduleSheet, prepareScheduleSheet } from "./schedule-sheet.js";

/* Низ табло над площадкой кадра, м: табло сервера висят над землёй. */
export const STAGE_LIFT = 1.1;

/** Свечение шейдера → яркость плашки кадра: 0 — без своего света. */
export const glowLight = (glow) => (glow > 0 ? Math.min(1.6, 0.55 + glow * 0.18) : 0);

/**
 * Лист работы на одном холсте 2048 × 1024: перерисовывается по смыслу
 * работы (шрифт, значки и свои картинки сначала загружаются). `version`
 * растёт с каждой перерисовкой — по ней кадр берёт новый лист.
 */
export function useScheduleSheet(project) {
  const canvasRef = useRef(null);
  if (!canvasRef.current && typeof document !== "undefined") {
    canvasRef.current = document.createElement("canvas");
    canvasRef.current.width = SCHEDULE_SHEET.width;
    canvasRef.current.height = SCHEDULE_SHEET.height;
  }
  const [version, setVersion] = useState(0);
  const key = scheduleSignature(project);
  useEffect(() => {
    const canvas = canvasRef.current;
    let context = null;
    try {
      context = canvas?.getContext("2d") || null;
    } catch {
      context = null;
    }
    if (!context) return undefined;
    let cancelled = false;
    const normal = normalizeScheduleProject(project);
    prepareScheduleSheet(normal)
      .then((assets) => {
        if (cancelled) return;
        paintScheduleSheet(context, normal, assets);
        setVersion((value) => value + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Лист перерисовывается по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { canvas: canvasRef.current, version };
}

/** Облик табло сервера (`server.png`) — картинка или `null`, пока грузится. */
export function useServerSheet() {
  const [image, setImage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadServerSheet().then((value) => !cancelled && setImage(value));
    return () => {
      cancelled = true;
    };
  }, []);
  return image;
}

function sheetTexture(source) {
  const texture = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Объект кадра: плашка табло размера `scale` (масштаб сущности сервера)
 * лицом в −Y, низом на `STAGE_LIFT` над площадкой; `source` — холст листа
 * или картинка облика сервера (`null`, пока лист рисуется, — тёмная плашка).
 */
export function scheduleBoardObject(source, { scale, glow = 0, kind = "work" }) {
  const width = SCHEDULE_BOARD.width * scale;
  const height = SCHEDULE_BOARD.height * scale;
  const geometry = new THREE.PlaneGeometry(width, height);
  const map = source ? sheetTexture(source) : null;
  const light = glowLight(glow);
  const material = new THREE.MeshStandardMaterial({
    ...(map ? { map } : { color: new THREE.Color(0x1d1f24) }),
    transparent: Boolean(map),
    alphaTest: map ? 0.01 : 0,
    roughness: 0.85,
    metalness: 0,
    side: THREE.FrontSide,
    ...(light && map ? { emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: light } : {}),
  });
  const mesh = new THREE.Mesh(geometry, material);
  /* Плоскость лежит в XY лицом в +Z: поворот на 90° вокруг X — лицом в −Y, верх листа — вверх. */
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(0, 0, STAGE_LIFT + height / 2);
  mesh.name = "schedule-board";
  /* Что на плашке: лист работы, облик сервера или пока ничего (лист рисуется). */
  mesh.userData.sheet = source ? kind : "loading";
  mesh.userData.glow = glow;
  /* Кадр узнаёт плашку по щелчку и отдаёт её размеры: точка попадания → место на листе. */
  mesh.userData.pick = { kind: SCHEDULE_BOARD_PICK, width, height, lift: STAGE_LIFT };
  return {
    object: mesh,
    width,
    height,
    dispose() {
      geometry.dispose();
      material.dispose();
      map?.dispose();
    },
  };
}

/**
 * Объекты кадра: табло места `place` — лист работы, а «как на сервере» (или
 * «Сравнить») — облик сервера. Пересобирается с новым листом, размером и
 * свечением.
 */
export function useScheduleObjects({ project, place, compare = false }) {
  const normal = normalizeScheduleProject(project);
  const stock = scheduleIsStock(normal);
  const sheet = useScheduleSheet(normal);
  const server = useServerSheet();
  const showServer = stock || compare;
  const source = showServer ? server : sheet.version ? sheet.canvas : null;
  const glow = showServer ? 0 : normal.glow;
  const items = useMemo(
    () => [scheduleBoardObject(source, { scale: place.scale, glow, kind: showServer ? "server" : "work" })],
    // Лист меняется версией (`sheet.version`), а не новым холстом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, sheet.version, place.scale, glow, showServer],
  );
  useEffect(() => () => items.forEach((item) => item.dispose()), [items]);
  return items;
}

/* Рамка чуть шире места на листе (точки раскладки) и в паре сантиметров перед лицом плашки. */
const FRAME_PAD = 10;
const FRAME_FRONT = 0.02;

/**
 * Что обвести выбранным на плашке: `selection` — `{ tool, index }` (строка «Строки»
 * или заголовок «Заголовка и шрифта»); `project` — нормализованная работа (от неё
 * места на листе), `scale` — размер табло места. Описание подсветки кадра
 * (`{ proxies }`, `selection-highlight.js`): штрихи и контур, как у всего выбранного (задача 10Б
 * 18.10.2026 — прежде это была белая рамка). `null`, если выбирать нечего.
 * Лучи подсветку не видят: щелчок берёт плашку под ней.
 */
export function scheduleSelectionSpec({ project, scale, selection }) {
  const rect = selection ? scheduleSelectionRect(project, selection) : null;
  if (!rect) return null;
  const sheet = scheduleSheetSize(project);
  const width = SCHEDULE_BOARD.width * scale;
  const height = SCHEDULE_BOARD.height * scale;
  const k = width / sheet.width;
  const left = -width / 2 + (rect[0] - FRAME_PAD) * k;
  const right = -width / 2 + (rect[0] + rect[2] + FRAME_PAD) * k;
  const top = STAGE_LIFT + height - (rect[1] - FRAME_PAD) * k;
  const bottom = STAGE_LIFT + height - (rect[1] + rect[3] + FRAME_PAD) * k;
  const y = -FRAME_FRONT;
  const corners = [
    [left, y, bottom],
    [right, y, bottom],
    [right, y, top],
    [left, y, top],
  ];
  return { proxies: [shapeProxy(corners)] };
}

/** Обводка выбранного в кадре «На месте»: пересобирается с местом, размером табло и выбором. */
export function useScheduleSelection({ project, place, tool, index }) {
  const normal = normalizeScheduleProject(project);
  const rows = normal.rows.length;
  const frame = useMemo(
    () => scheduleSelectionSpec({ project: normal, scale: place.scale, selection: tool === "rows" || tool === "title" ? { tool, index } : null }),
    // Места на листе зависят от числа строк и колонок, а не от каждой правки текста.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, normal.columns, place.scale, tool, index],
  );
  useEffect(() => () => disposeProxies(frame?.proxies), [frame]);
  return frame;
}

/**
 * Рамка кадра: табло места, земля под ним и человек справа от него — для масштаба (`schedule-ped.js`, из игры: пока его
 * нет или игры нет, справа просто пусто); камера — спереди, чуть сверху.
 */
export function scheduleFrame(place) {
  const width = SCHEDULE_BOARD.width * place.scale;
  const height = SCHEDULE_BOARD.height * place.scale;
  return {
    bounds: { min: [-width / 2 - 0.3, -0.6, 0], max: [width / 2 + 1.9, 0.6, STAGE_LIFT + height] },
    ground: true,
    view: { yaw: 0, pitch: 0.08, zoom: 1 },
  };
}
