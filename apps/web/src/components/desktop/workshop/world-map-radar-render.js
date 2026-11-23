/*
 * Рисовальщик своих предметов карты для радара (задача 28 ТЗ 19.10.2026, этап В).
 *
 * Надпись, значок и картинка карты на радаре — треугольники, а получаются они из рисунка: окно рисует предмет на
 * канву тем же кодом, что плитки карты (`paintSceneItem`, тот же шрифт, те же глифы и картинки), а `radar-items.js`
 * вынимает из рисунка контуры букв и сетку цвета. Здесь только канва: нарисовать предмет в нужном куске сцены и
 * отдать точки (RGBA без предумножения).
 *
 * Прозрачность, размытие, свечение и смешивание предмета рисунок не несёт — они ложатся на готовую фигуру (цвет
 * вершин), иначе по альфе нельзя было бы найти край буквы. Цвет текста и глифа в рисунке чёрный: нужна только форма.
 */

import { RADAR_ITEM_LAYERS, paintSceneItem } from "@modovik/vector-map";
import { loadSceneFonts } from "./world-map-render.js";

/** Больше этой стороны растр не бывает: холст такой стороны уже сотни мегабайт. */
const SIDE_LIMIT = 4096;

async function loadImage(href) {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`Не удалось прочитать изображение: ${href}`);
  return createImageBitmap(await response.blob());
}

/** Картинки слоёв радара: значки-картинки меток и эмблемы. Картинки подложки сюда не нужны, они тяжёлые. */
export async function collectRadarImages(scene) {
  const hrefs = new Set();
  for (const layer of scene.layers || [])
    if (RADAR_ITEM_LAYERS.includes(layer.id))
      for (const item of layer.items || []) if (item.kind === "image" && item.href && !item.lazy) hrefs.add(item.href);
  const images = new Map();
  await Promise.all(
    [...hrefs].map(async (href) => {
      try {
        images.set(href, await loadImage(href));
      } catch {
        /* Пропавшая картинка просто не рисуется. */
      }
    }),
  );
  return images;
}

/* Предмет для рисунка: форма без цвета, прозрачности, размытия и свечения. */
function shapeOf(item, part) {
  const base = { ...item, opacity: 1, blur: 0, glow: null, blend: undefined };
  if (item.kind === "text") {
    const outlined = part !== "fill" && item.stroke && item.strokeWidth > 0;
    return { ...base, fill: "#000000", stroke: outlined ? "#000000" : null, strokeWidth: outlined ? item.strokeWidth : 0 };
  }
  if (item.kind === "glyph") {
    const outlined = part === "outline" && item.stroke && item.strokeWidth > 0;
    return { ...base, badge: null, fill: "#000000", stroke: outlined ? "#000000" : null, strokeWidth: outlined ? item.strokeWidth : 0 };
  }
  return base;
}

function scratchCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Окружение для `createRadarItems`: рисует предмет в куске сцены и отдаёт точки.
 *
 * @param {{ images?: Map<string, ImageBitmap> }} [options] картинки сцены по адресу
 */
export function createRadarItemEnv({ images = new Map() } = {}) {
  /* Холст растёт по надобности и переиспользуется: сотни надписей — сотни рисунков, и каждому новый холст — лишняя работа. */
  let canvas = null;
  return {
    render(item, view, part = "all") {
      const width = Math.max(1, Math.ceil(view.width * view.scale));
      const height = Math.max(1, Math.ceil(view.height * view.scale));
      if (width > SIDE_LIMIT || height > SIDE_LIMIT) return null;
      if (!canvas || canvas.width < width || canvas.height < height) canvas = scratchCanvas(Math.max(width, canvas?.width || 0), Math.max(height, canvas?.height || 0));
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      if (!context) return null;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(view.scale, 0, 0, view.scale, -view.x * view.scale, -view.y * view.scale);
      try {
        paintSceneItem(context, shapeOf(item, part), images, view.scale);
      } catch {
        return null;
      }
      const picture = context.getImageData(0, 0, width, height);
      return { width: picture.width, height: picture.height, data: picture.data };
    },
  };
}

/**
 * Всё, что нужно радару от окна: шрифты сцены загружены, картинки прочитаны, рисовальщик готов.
 *
 * @returns {Promise<{ env: object, images: Map<string, ImageBitmap> }>}
 */
export async function prepareRadarItems(scene) {
  await loadSceneFonts(scene);
  const images = await collectRadarImages(scene);
  return { env: createRadarItemEnv({ images }), images };
}
