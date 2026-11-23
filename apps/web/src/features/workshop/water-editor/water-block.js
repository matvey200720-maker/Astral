/*
 * Блок воды кадра, обложки и плиток «Воды» — гладь с мягкими волнами на
 * сетке, на матовой плашке, как оболочка у «Зон» (сцена `water-block.bin`,
 * `scripts/prepare-water-scene.mjs`).
 *
 * Своих моделей у воды в игре нет — море это квады и туман, — поэтому блок
 * постановочный, и подпись кадра говорит это прямо. Цвет глади и бортов —
 * та же арифметика, что у установщика (`waterScreenColour`): вдоль блока —
 * от берега (слева) к глубине, «по карте» — у пляжа Веспуччи. Прозрачность
 * — сколько света доходит до дна-сетки сквозь 6 м воды, как дно видно в
 * игре: на 10 % света — на глубине 2754 / a² м, где a — альфа квадов
 * (`PS_FogComposite`: 2^(−78,433·(a/255)²·d)). Цвет глади — как днём на
 * солнце: в игре его освещают солнце и небо.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WATER_VISIBILITY, waterAlphaFactor } from "@modovik/climb-contract/recolor/water";
import { waterScreenColour } from "./water-text.js";

export const WATER_BLOCK_URL = "/assets/workshop/water/water-block.bin";

const LENGTH = 120;
const WIDTH = 64;
const DEPTH = 6;
/* Блок стоит у пляжа Веспуччи: сюда смотрят эффекты «по карте». */
const ORIGIN = Object.freeze({ x: -1500, y: -1250 });
const DENSITY = Math.log(10) / WATER_VISIBILITY.k;
const SURFACE = Object.freeze({ width: 128, height: 64 });
const SIDES = Object.freeze({ width: 128, height: 32 });
/* Сетка пола сцены: 220 × 160 м, линии через 5 м, через 25 м — ярче. */
const GRID = Object.freeze({ length: 220, width: 160, step: 5, major: 25, fade: [52, 100] });

const blockBounds = (asset) => asset.parts?.find((part) => part.id === "water")?.bounds || asset.bounds;

/** Рамка кадра: блок сверху-сбоку, как оболочка на обложке «Зон»; под ним — сетка. */
export function waterBlockFrame(asset) {
  return { bounds: blockBounds(asset), ground: true, view: { yaw: -0.7, pitch: 0.58, zoom: 1.02 } };
}

/** Рамка снимка (обложка, плитки): тот же вид, блок крупнее. */
export function waterBlockThumbFrame(asset) {
  return { bounds: blockBounds(asset), ground: true, view: { yaw: -0.7, pitch: 0.62 } };
}

/* Сколько света гасит толща `depth` метров при прозрачности облика: 0…1. */
function opacityAt(look, depth) {
  const alpha = waterAlphaFactor(look.transparency) * WATER_VISIBILITY.vanillaAlpha;
  return 1 - Math.exp(-DENSITY * alpha * alpha * depth);
}

/* Лист по точкам: `fill(u, v, rgb) → альфа`; развёртка сцены — v сверху вниз. Точки пишутся прямо в буфер: массив на
   точку у листа в 760 тысяч точек (сетка пола) держал главный поток полсекунды (замер ×4, 23.10.2026). */
function sheet(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  const colour = [0, 0, 0];
  for (let row = 0; row < height; row += 1)
    for (let column = 0; column < width; column += 1) {
      const alpha = fill((column + 0.5) / width, (row + 0.5) / height, colour);
      const at = (row * width + column) * 4;
      data[at] = colour[0];
      data[at + 1] = colour[1];
      data[at + 2] = colour[2];
      data[at + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  return sheetTexture(data, width, height);
}

function sheetTexture(data, width, height) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Листы блока по облику группы воды (`compileWaterLooks(работа)[группа]`):
 * `{ surface, sides }`. Гладь — цвет воды и сколько её видно над дном;
 * борта — толща, глубже темнее, как стекло аквариума.
 */
export function waterBlockSheets(look) {
  const surfaceAlpha = Math.max(0.14, opacityAt(look, DEPTH));
  const sideAlpha = Math.min(0.95, 0.55 + 0.4 * opacityAt(look, 12));
  const surface = sheet(SURFACE.width, SURFACE.height, (u, v, out) => {
    waterScreenColour(look, 1 - u, ORIGIN.x - LENGTH / 2 + u * LENGTH, ORIGIN.y - WIDTH / 2 + v * WIDTH, out);
    return surfaceAlpha;
  });
  const sides = sheet(SIDES.width, SIDES.height, (u, v, out) => {
    /* Вглубь — к цвету глубины и темнее: на дне меньше света. */
    waterScreenColour(look, (1 - u) * (1 - 0.7 * v), ORIGIN.x - LENGTH / 2 + u * LENGTH, ORIGIN.y - WIDTH / 2, out);
    const shade = 1 - 0.35 * v;
    for (let channel = 0; channel < 3; channel += 1) out[channel] = Math.round(out[channel] * shade);
    return sideAlpha;
  });
  return { surface, sides };
}

let gridTexture = null;
/*
 * Лист сетки пола — один на окно: светлые линии на прозрачном, гаснут к краю.
 *
 * Линия зависит от столбца и от строки порознь (`max(по x, по y)`), поэтому расстояния до линий считаются один раз на
 * столбец и на строку, а не четыре раза на каждую из 760 тысяч точек; точкам между линиями (почти все) остаётся цвет
 * и нулевая альфа без расчёта убывания. Цифры те же, что у прежнего поточечного расчёта: `water-block-grid.test.js`.
 * Прежняя версия на этом листе держала главный поток ~0,5 с (стенд ×4) на запуске у каждого окна — в прогреве обложек.
 */
function gridSheet() {
  if (gridTexture) return gridTexture;
  const width = 1024;
  const height = Math.round((width * GRID.width) / GRID.length);
  const metre = GRID.length / width;
  const near = (value, step) => {
    const rest = ((value % step) + step) % step;
    return Math.min(rest, step - rest);
  };
  const across = (position, step, half) => Math.max(0, 1 - near(position, step) / half);
  const xs = new Float64Array(width);
  const minorX = new Float64Array(width);
  const majorX = new Float64Array(width);
  for (let column = 0; column < width; column += 1) {
    xs[column] = -GRID.length / 2 + ((column + 0.5) / width) * GRID.length;
    minorX[column] = across(xs[column], GRID.step, metre * 0.9);
    majorX[column] = across(xs[column], GRID.major, metre * 1.3);
  }
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) {
    data[at] = 200;
    data[at + 1] = 205;
    data[at + 2] = 212;
  }
  for (let row = 0; row < height; row += 1) {
    const y = -GRID.width / 2 + ((row + 0.5) / height) * GRID.width;
    const minorY = across(y, GRID.step, metre * 0.9);
    const majorY = across(y, GRID.major, metre * 1.3);
    for (let column = 0; column < width; column += 1) {
      const strength = Math.max(Math.max(minorX[column], minorY) * 0.55, Math.max(majorX[column], majorY));
      if (strength === 0) continue;
      const r = Math.hypot(xs[column], y);
      const fade = 1 - Math.min(1, Math.max(0, (r - GRID.fade[0]) / (GRID.fade[1] - GRID.fade[0])));
      data[(row * width + column) * 4 + 3] = Math.round(Math.min(1, Math.max(0, strength * 0.42 * fade)) * 255);
    }
  }
  gridTexture = sheetTexture(data, width, height);
  return gridTexture;
}

/** Облик материалов блока: гладь блестит мягко, борта — матовее, сетка — линии. */
export function waterBlockLook(sheets) {
  return (index, info) => {
    if (info.group === "surface") return { colour: info.colour, texture: sheets?.surface, roughness: 0.34, metalness: 0 };
    if (info.group === "sides") return { colour: info.colour, texture: sheets?.sides, roughness: 0.4, metalness: 0 };
    if (info.group === "grid") return { colour: info.colour, texture: gridSheet(), roughness: 1, metalness: 0 };
    return { colour: info.colour };
  };
}

/** Листы блока для кадра: пересобираются по смыслу облика, старые освобождаются. */
export function useWaterBlockSheets(look) {
  const key = JSON.stringify(look);
  const sheets = useMemo(
    () => waterBlockSheets(look),
    // Листы пересобираются по смыслу облика (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(
    () => () => {
      sheets.surface.dispose();
      sheets.sides.dispose();
    },
    [sheets],
  );
  return { sheets, key };
}
