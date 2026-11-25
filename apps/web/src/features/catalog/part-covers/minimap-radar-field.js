import {
  canvasBlob,
  paintVectorCanvas,
} from "../../../components/desktop/workshop/world-map-vector-render.js";
import {
  DEFAULT_ATLAS,
  atlasSize,
  decodePackGeometry,
  normalizeAtlas,
} from "@modovik/vector-map";

// Пропорции кадра радара редактора (179 × 115 точек сцены) и размер растра.
const FRAME_RATIO = 179 / 115;
const FRAME_WIDTH = 1074;
const FRAME_HEIGHT = Math.round(FRAME_WIDTH / FRAME_RATIO);

// Замер охвата: берётся каждый четвёртый пиксель (16 байт), «плотный» — альфа выше порога.
const SCAN = { stride: 16, denseAbove: 200, needed: 0.6 };

// Долю охвата читают через getImageData сразу, поэтому холст рисуется на процессоре.
const ON_CPU = { cpu: true };

// Центр Лос-Сантоса: игрок в 50 м южнее Legion Square, кусок шириной 450 м.
const CITY_CENTER = { x: 195, y: -985 };
export const RADAR_SPOT = Object.freeze({ ...CITY_CENTER, width: 450 });

function pixelsOf(canvas) {
  const { width, height } = canvas;
  return canvas.getContext("2d").getImageData(0, 0, width, height).data;
}

// Доля плотных пикселей среди замеряемых (счёт идёт с конца массива).
function denseShare(rgba) {
  const { stride, denseAbove } = SCAN;
  let remaining = Math.ceil((rgba.length - 3) / stride);
  let dense = 0;
  while (remaining-- > 0) {
    dense += rgba[3 + remaining * stride] > denseAbove ? 1 : 0;
  }
  return dense / (rgba.length / stride);
}

export function radarRect(spot = RADAR_SPOT, atlas = DEFAULT_ATLAS) {
  const { width: wide } = spot;
  const high = wide / FRAME_RATIO;
  const grid = normalizeAtlas(atlas);
  const { width: gridW, height: gridH } = atlasSize(grid);
  const midY = spot.y + high / 2;
  return {
    u: (spot.x - wide / 2 - grid.originX) / gridW,
    v: (grid.originY - midY) / gridH,
    width: wide / gridW,
    height: high / gridH,
  };
}

// Рисует кадр и отдаёт его, только если радар мода закрывает достаточную долю.
function paintChecked(geometry, spot) {
  if (!geometry?.groups?.length) return null;
  const layers = { geometry, atlas: DEFAULT_ATLAS };
  const area = radarRect(spot);
  const canvas = paintVectorCanvas(layers, area, FRAME_WIDTH, FRAME_HEIGHT, null, ON_CPU);
  return canvas && denseShare(pixelsOf(canvas)) >= SCAN.needed ? canvas : null;
}

export function radarFieldCanvas(bytes, spot = RADAR_SPOT) {
  return paintChecked(decodePackGeometry(bytes), spot);
}

export async function radarFieldUrl(bytes, spot = RADAR_SPOT) {
  const canvas = bytes?.length ? radarFieldCanvas(bytes, spot) : null;
  if (!canvas) return "";
  const blob = await canvasBlob(canvas);
  return URL.createObjectURL(blob);
}
