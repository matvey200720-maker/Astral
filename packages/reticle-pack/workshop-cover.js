import { createRenderer, createSurface, encodePng, surfaceToRgba } from "@modovik/gfx";
import { workshopMatteLevel } from "@modovik/gfx/workshop-matte";
import { RETICLE_STAGE } from "@modovik/reticle-contract";
import { readReticleScript } from "./mod-script.js";
import { RETICLE_VIEWS, readReticle } from "./scene.js";

// 3 : 2, как плитка «Что внутри».
export const PART_COVER = Object.freeze({ width: 1200, height: 800 });

const FILL_SHARE = 0.45;
const DRAWN_THRESHOLD = 0.04;
const ENLARGE = Object.freeze({ least: 1, most: 40 });
const BACKING = [12, 12, 12];

const clamp = (value, least, most) => Math.min(most, Math.max(least, value));

// Сетка точек как ряд индексов: столбцов ceil(width), всего ceil(width) · ceil(height).
function pixelRun(width, height) {
  const cols = Math.ceil(width);
  return { cols, total: cols * Math.ceil(height) };
}

// Положение точки по индексу и смещение её первого канала в данных растра.
function locate(i, cols, width) {
  const x = i % cols;
  const y = (i - x) / cols;
  return { x, y, at: (y * width + x) * 4 };
}

// Рисунок белый, а игра красит его сдвигом каналов (цвет − 255); без кода — без окраски.
function tintFromCode(gfx) {
  try {
    const colour = readReticleScript(gfx)?.colour;
    if (!colour) return undefined;
    return { mult: [1, 1, 1, 1], add: [...colour.slice(0, 3).map((channel) => channel - 255), 0] };
  } catch {
    return undefined;
  }
}

// Поле мастерской: серое, яркость точки зависит от её положения в кадре.
function matteSheet(width, height) {
  const sheet = createSurface(width, height);
  const { cols, total } = pixelRun(width, height);
  for (let i = 0; i < total; i++) {
    const { x, y, at } = locate(i, cols, width);
    const level = workshopMatteLevel(x + 0.5, y + 0.5, width, height);
    [level, level, level, 1].forEach((value, c) => {
      sheet.data[at + c] = value;
    });
  }
  return sheet;
}

const gapBetween = (a, b, at) => [0, 1, 2].reduce((sum, c) => sum + Math.abs(a[at + c] - b[at + c]), 0);

// Размеры рамки точек, заметно отличающихся от поля (обе границы входят), или null.
function drawnSize(matte, painted, width, height) {
  const { cols, total } = pixelRun(width, height);
  const hits = [];
  for (let i = 0; i < total; i++) {
    if (gapBetween(painted, matte, locate(i, cols, width).at) > DRAWN_THRESHOLD) hits.push(i);
  }
  if (hits.length === 0) return null;
  const span = (values) => values.reduce((a, b) => Math.max(a, b)) - values.reduce((a, b) => Math.min(a, b)) + 1;
  return {
    width: span(hits.map((i) => locate(i, cols, width).x)),
    height: span(hits.map((i) => locate(i, cols, width).y)),
  };
}

// Матрица «центр кадра, масштаб от ширины сцены»: прицел стоит посередине.
function centredMatrix(width, height, zoom) {
  const scale = (width / RETICLE_STAGE.width) * zoom;
  return { a: scale, b: 0, c: 0, d: scale, tx: width / 2, ty: height / 2 };
}

// Всё нужное для рисования обложки: поле, рендерер, окраска и штатный масштаб вида.
function openStudio(reticle, width, height) {
  const matte = matteSheet(width, height);
  const renderer = createRenderer(reticle.gfx, {});
  const cxform = tintFromCode(reticle.gfx);
  const { frame, zoom } = RETICLE_VIEWS.find((candidate) => candidate.id === "ordinary");
  return {
    matte,
    stock: zoom || 1,
    paint(scaleZoom) {
      const surface = { ...matte, data: matte.data.slice() };
      renderer.renderFrame({
        sprite: reticle.sprite,
        frame,
        width,
        height,
        transform: centredMatrix(width, height, scaleZoom),
        surface,
        ...(cxform ? { cxform } : {}),
      });
      return surface;
    },
  };
}

export function reticleWorkshopCoverPng(bytes, { width = PART_COVER.width, height = PART_COVER.height } = {}) {
  const studio = openStudio(readReticle(bytes), width, height);

  // Пробный кадр в штатном масштабе показывает, насколько прицел мал.
  const probe = studio.paint(studio.stock);
  const used = drawnSize(studio.matte.data, probe.data, width, height);
  const gain = used
    ? Math.min(...[[width, used.width], [height, used.height]].map(([room, taken]) => (room * FILL_SHARE) / taken))
    : ENLARGE.least;
  const zoom = studio.stock * clamp(gain, ENLARGE.least, ENLARGE.most);

  const picture = zoom === studio.stock ? probe : studio.paint(zoom);
  return encodePng(surfaceToRgba(picture, BACKING), width, height, 4);
}
