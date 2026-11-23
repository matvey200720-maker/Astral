/*
 * Текстура метки залаза.
 *
 * Одна функция на всё, что показывает или отдаёт метку: кадр редактора,
 * плитки видов, обложка мастерской и та самая текстура, что уезжает в игру.
 * Кадр и игра поэтому не расходятся: в DDS уходят ровно эти пиксели.
 *
 * Как собирается текстура.
 *   1. Рисунок вида (`@modovik/climb-contract/art`) растрируется в две маски:
 *      `fill` — сама метка, `ink` — надписи поверх таблички. Своя картинка
 *      ложится в `fill` своими цветами.
 *   2. От обеих масок считается расстояние до метки (`climb-edt.js`) — из
 *      него выходят обводка и ореол, одинаковые у фигуры, буквы и картинки.
 *   3. Слои складываются снизу вверх: ореол цветом метки, обводка, заливка
 *      (ровная, градиентом или цветами картинки), надписи цветом обводки.
 *
 * Раскладку — где метка в текстуре и какой ширины поля под обводку и
 * ореол — считает контракт (`climbMarkerLayout`), и тот же расчёт ставит
 * плашку в модели. Поэтому здесь нет ни одного своего числа о размерах.
 */

import {
  CLIMB_SLOTS,
  climbMarkerColours,
  climbMarkerLayout,
  parseClimbColour,
} from "@modovik/climb-contract";
import { climbMarkerArt } from "@modovik/climb-contract/art";
import {
  READBACK,
  context2d,
  rgbaToCanvas,
} from "../../../components/desktop/workshop/canvas-surface.js";
import { createLruCache } from "../../../components/desktop/workshop/lru-cache.js";
import { distanceToShape } from "./climb-edt.js";
import { composeClimbPixels } from "./climb-pixels.js";
import { applyClimbFont } from "./climb-fonts.js";
import { isEmblemFontReady } from "../emblem/emblem-fonts.js";
import { ownFontAssetOf, prepareOwnFonts } from "../emblem/own-font.js";

export { composeClimbPixels };

function surface(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = context2d(canvas, READBACK);
  return context ? { canvas, context } : null;
}

/* ------------------------------------------------------------------ *
 * Рисунок → маски
 * ------------------------------------------------------------------ */

function frameMapper(layout, aspect) {
  const { content } = layout;
  const unit = content.height / 2;
  return {
    unit,
    point: (x, y) => [
      content.x + (x + aspect) * unit,
      content.y + (1 - y) * unit,
    ],
  };
}

function tracePath(context, commands, point) {
  context.beginPath();
  for (const command of commands) {
    if (command[0] === "M") context.moveTo(...point(command[1], command[2]));
    else if (command[0] === "L")
      context.lineTo(...point(command[1], command[2]));
    else if (command[0] === "C")
      context.bezierCurveTo(
        ...point(command[1], command[2]),
        ...point(command[3], command[4]),
        ...point(command[5], command[6]),
      );
    else if (command[0] === "Z") context.closePath();
  }
}

/*
 * Надпись вписывается в свою коробку по тому, что видно, а не по кеглю:
 * у Impact и Segoe Script при одном кегле буквы разной высоты, а коробка у
 * надписи одна. Меряется настоящая ширина и высота начертания строки.
 */
const PROBE_SIZE = 100;

function textBox(box, point) {
  const [left, top] = point(box[0], box[3]);
  const [right, bottom] = point(box[2], box[1]);
  return { left, top, width: right - left, height: bottom - top };
}

function measureInk(context, value, font) {
  applyClimbFont(context, font, PROBE_SIZE);
  const metrics = context.measureText(value);
  const ascent = metrics.actualBoundingBoxAscent ?? PROBE_SIZE * 0.72;
  const descent = metrics.actualBoundingBoxDescent ?? PROBE_SIZE * 0.08;
  const leftBearing = metrics.actualBoundingBoxLeft ?? 0;
  const rightBearing = metrics.actualBoundingBoxRight ?? metrics.width;
  return {
    ascent,
    leftBearing,
    width: Math.max(1, leftBearing + rightBearing),
    height: Math.max(1, ascent + descent),
  };
}

/* Строка тем кеглем, при котором её видимые буквы — `scale` пробных. */
function fillInk(context, value, font, box, ink, scale) {
  applyClimbFont(context, font, PROBE_SIZE * scale);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(
    value,
    box.left + (box.width - ink.width * scale) / 2 + ink.leftBearing * scale,
    box.top + (box.height - ink.height * scale) / 2 + ink.ascent * scale,
  );
}

function drawText(context, op, point) {
  const box = textBox(op.box, point);
  if (!op.text || box.width <= 0 || box.height <= 0) return;
  const ink = measureInk(context, op.text, op.font);
  const scale = Math.min(box.width / ink.width, box.height / ink.height);
  fillInk(context, op.text, op.font, box, ink, scale);
}

/*
 * Несколько строк одним кеглем — как «JUMP» над «SPACE» у мода: каждая
 * строка вписалась бы в свою коробку своим кеглем, и короткое слово вышло бы
 * крупнее длинного. Кегль — меньший из подошедших каждой строке.
 */
function drawLines(context, op, point) {
  const rows = op.lines
    .map((value, index) => ({ value, box: textBox(op.boxes[index], point) }))
    .filter((row) => row.value && row.box.width > 0 && row.box.height > 0);
  if (!rows.length) return;
  for (const row of rows) row.ink = measureInk(context, row.value, op.font);
  const scale = Math.min(
    ...rows.map((row) =>
      Math.min(row.box.width / row.ink.width, row.box.height / row.ink.height),
    ),
  );
  for (const row of rows)
    fillInk(context, row.value, op.font, row.box, row.ink, scale);
}

/*
 * Своя картинка в рамке метки. «Вписать» — картинка целиком, с полями;
 * «Заполнить» — рамка целиком, лишнее срезано. Увеличение — поверх этого, а
 * сдвиг двигает саму картинку по её свободному ходу: −100 — до упора влево
 * (вниз), 100 — вправо (вверх). У маленькой картинки ход — поля вокруг неё,
 * у большой — то, что за рамкой. Вышедшее за рамку срезается: поля под
 * обводку и ореол картинка не занимает.
 */
function drawPicture(context, op, point, picture) {
  if (!picture) return;
  const box = textBox(op.box, point);
  const image = op.image || {};
  const cover = image.fit === "cover";
  const base = (cover ? Math.max : Math.min)(
    box.width / picture.width,
    box.height / picture.height,
  );
  const scale = base * ((image.zoom || 100) / 100);
  const width = picture.width * scale;
  const height = picture.height * scale;
  const slackX = box.width - width;
  const slackY = box.height - height;
  const left =
    box.left + slackX / 2 + ((image.x || 0) / 100) * (Math.abs(slackX) / 2);
  const top =
    box.top + slackY / 2 - ((image.y || 0) / 100) * (Math.abs(slackY) / 2);
  context.save();
  context.beginPath();
  context.rect(box.left, box.top, box.width, box.height);
  context.clip();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, left, top, width, height);
  context.restore();
}

function drawOp(context, op, mapper, picture) {
  context.save();
  context.globalCompositeOperation =
    op.mode === "cut" ? "destination-out" : "source-over";
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#ffffff";
  if (op.type === "fill") {
    tracePath(context, op.path, mapper.point);
    context.fill("nonzero");
    if (op.round > 0) {
      context.lineJoin = "round";
      context.lineWidth = op.round * mapper.unit;
      context.stroke();
    }
  } else if (op.type === "stroke") {
    tracePath(context, op.path, mapper.point);
    context.lineWidth = op.width * mapper.unit;
    context.lineCap = op.cap;
    context.lineJoin = op.join;
    context.miterLimit = 10;
    context.stroke();
  } else if (op.type === "text") {
    drawText(context, op, mapper.point);
  } else if (op.type === "lines") {
    drawLines(context, op, mapper.point);
  } else if (op.type === "image") {
    drawPicture(context, op, mapper.point, picture);
  }
  context.restore();
}

/* ------------------------------------------------------------------ *
 * Своя картинка
 * ------------------------------------------------------------------ */

/*
 * Однотонный фон картинки → прозрачный.
 *
 * JPEG и скриншоты приходят с белым или чёрным полем вокруг рисунка, и на
 * стене это поле встало бы плашкой. Фон — цвет углов картинки; близкие к
 * нему пиксели гаснут, а на границе — плавно, без лесенки.
 *
 * Краевой пиксель — смесь рисунка и фона, и если оставить его цвет как
 * есть, вокруг рисунка встаёт светлая кайма бывшего белого поля. Поэтому
 * из полупрозрачных пикселей фон вычитается обратно: остаётся цвет рисунка
 * с той долей, что от него была.
 */
function keyOutBackground(rgba, width, height) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = [0, 1, 2].map((channel) => {
    const values = corners
      .map((index) => rgba[index * 4 + channel])
      .sort((a, b) => a - b);
    return (values[1] + values[2]) / 2;
  });
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    const distance = Math.hypot(
      rgba[at] - background[0],
      rgba[at + 1] - background[1],
      rgba[at + 2] - background[2],
    );
    const keep = Math.min(1, Math.max(0, (distance - 28) / 36));
    if (keep > 0 && keep < 1)
      for (let channel = 0; channel < 3; channel += 1)
        rgba[at + channel] =
          (rgba[at + channel] - background[channel] * (1 - keep)) / keep;
    rgba[at + 3] = Math.round(rgba[at + 3] * keep);
  }
  defringe(rgba, width, height);
}

/*
 * Кайма после вырезки фона.
 *
 * Сглаженный край рисунка на белом поле — пиксели наполовину белые, и по
 * расстоянию до фона их не отличить от светлых мест самого рисунка. Зато
 * они всегда стоят у прозрачного: краевым пикселям цвет берётся у соседей
 * поглубже, альфа остаётся своей.
 */
function defringe(rgba, width, height) {
  const solid = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    rgba[(y * width + x) * 4 + 3] >= 250;
  const interior = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let inner = solid(x, y);
      for (let dy = -1; inner && dy <= 1; dy += 1)
        for (let dx = -1; inner && dx <= 1; dx += 1)
          inner = solid(x + dx, y + dy);
      interior[y * width + x] = inner ? 1 : 0;
    }
  const source = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (interior[index] || source[index * 4 + 3] === 0) continue;
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1)
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const near = ny * width + nx;
          if (!interior[near]) continue;
          red += source[near * 4];
          green += source[near * 4 + 1];
          blue += source[near * 4 + 2];
          count += 1;
        }
      if (!count) continue;
      rgba[index * 4] = red / count;
      rgba[index * 4 + 1] = green / count;
      rgba[index * 4 + 2] = blue / count;
    }
}

const pictureCache = createLruCache(12);

/**
 * Картинка человека, готовая лечь в метку: повёрнутая и, если просили, без
 * фона. `pixels` — `{ width, height, rgba }` из `climb-image.js`.
 */
export function prepareClimbPicture(pixels, image) {
  if (!pixels || !image) return null;
  const key = `${image.assetId}|${image.rotate}|${image.keyOut}|${pixels.width}x${pixels.height}`;
  const cached = pictureCache.get(key);
  if (cached) return cached;
  const rgba = new Uint8ClampedArray(pixels.rgba);
  if (image.keyOut) keyOutBackground(rgba, pixels.width, pixels.height);
  const source = rgbaToCanvas(rgba, pixels.width, pixels.height);
  if (!source) return null;
  const turned = image.rotate === 90 || image.rotate === 270;
  const target = surface(
    turned ? pixels.height : pixels.width,
    turned ? pixels.width : pixels.height,
  );
  if (!target) return null;
  const { canvas, context } = target;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((image.rotate * Math.PI) / 180);
  context.drawImage(source, -pixels.width / 2, -pixels.height / 2);
  return pictureCache.set(key, canvas);
}

/* ------------------------------------------------------------------ *
 * Сборка текстуры
 * ------------------------------------------------------------------ */


/*
 * Поле расстояний до метки — то же, пока не поменялась сама форма (19.10.2026, лаг правки). Ползунки
 * прозрачности, свечения и цвета меняют краску, а не форму, и каждый их шаг считал поле заново —
 * половина цены шага. Кадр редактора (без `size`) помнит последнее поле каждой метки и берёт его, если
 * покрытие метки байт в байт то же.
 */
const DISTANCE_KEEP = 4;
const distances = new Map();
function shapeDistance(slotId, size, union, width, height) {
  const known = size ? null : distances.get(slotId);
  if (known && known.width === width && known.height === height && sameBytes(known.union, union)) return known.distance;
  const distance = distanceToShape(union, width, height);
  if (!size) {
    distances.delete(slotId);
    distances.set(slotId, { width, height, union, distance });
    while (distances.size > DISTANCE_KEEP) distances.delete(distances.keys().next().value);
  }
  return distance;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}


/**
 * Слои метки для досчёта: растр заливки и штрихов (холст окна), их покрытие и всё, чем слои красятся.
 * `null` — рисовать не на чем (тесты без холста). Досчёт — `finishClimbLayers` здесь же или в потоке.
 */
export function climbMarkerLayers(design, slotId, { size = 0, picture = null } = {}) {
  const layout = climbMarkerLayout(design, slotId, { size });
  const { width, height } = layout;
  const fillLayer = surface(width, height);
  const inkLayer = surface(width, height);
  if (!fillLayer || !inkLayer) return null;
  const art = climbMarkerArt(design, slotId);
  const mapper = frameMapper(layout, art.aspect);
  for (const op of art.ops)
    drawOp(
      op.layer === "ink" ? inkLayer.context : fillLayer.context,
      op,
      mapper,
      picture,
    );

  const fillPixels = fillLayer.context.getImageData(0, 0, width, height).data;
  const inkPixels = inkLayer.context.getImageData(0, 0, width, height).data;
  const size2 = width * height;
  const union = new Uint8Array(size2);
  for (let index = 0; index < size2; index += 1)
    union[index] = Math.max(
      fillPixels[index * 4 + 3],
      inkPixels[index * 4 + 3],
    );

  const marker = design.markers[slotId];
  const colours = climbMarkerColours(design, slotId);
  const usesPicture = marker.variant === "image";
  return {
    layout,
    width,
    height,
    fillPixels,
    inkPixels,
    union,
    needsDistance: layout.outline > 0 || layout.halo > 0,
    paint: {
      outline: layout.outline,
      halo: layout.halo,
      content: layout.content,
      gradient: Boolean(colours.gradient),
      fillTop: parseClimbColour(colours.fill),
      fillBottom: parseClimbColour(colours.fill2),
      outlineColour: parseClimbColour(colours.outline),
      usesPicture,
      tint: usesPicture ? (marker.image?.tint || 0) / 100 : 0,
      opacity: design.style.opacity / 100,
    },
  };
}

/** Досчёт слоёв здесь же: поле расстояний (если нужно) и смешивание → RGBA. */
export function finishClimbLayers(layers, distance) {
  const { width, height, fillPixels, inkPixels, paint } = layers;
  return composeClimbPixels({ width, height, fillPixels, inkPixels, distance, ...paint });
}

/**
 * Пиксели метки: `{ layout, width, height, rgba }` или `null`, если рисовать
 * не на чем (тесты без холста).
 *
 * `design` — приведённый макет. `size` — сторона вместо выбранной в макете
 * (плитки и обложка). `picture` — готовая своя картинка метки
 * (`prepareClimbPicture`) или `null`.
 */
export function renderClimbMarker(design, slotId, { size = 0, picture = null } = {}) {
  const layers = climbMarkerLayers(design, slotId, { size, picture });
  if (!layers) return null;
  const { layout, width, height, union, needsDistance } = layers;
  const distance = needsDistance ? shapeDistance(slotId, size, union, width, height) : null;
  return { layout, width, height, rgba: finishClimbLayers(layers, distance) };
}

/* ------------------------------------------------------------------ *
 * Холсты и файлы
 * ------------------------------------------------------------------ */

/*
 * Два запаса. Плитки (сторона задана: набор, виды, готовые наборы) мелкие и
 * нужны все разом — пять меток, восемь видов у каждой, десять наборов по
 * пять меток: сотня холстов по нескольку десятков килобайт. Текстуры в
 * натуральную величину весят мегабайты, и ползунок рождает новую на каждом
 * шаге. В общем запасе на 64 места текстуры вытесняли плитки, и смена метки
 * рисовала её виды заново.
 */
const tileCache = createLruCache(192);
const textureCache = createLruCache(12);

/* Свой шрифт, ещё не добравшийся до набора шрифтов документа, рисуется запасным — такая метка в запас не попадает под ключом готового. */
const markerKey = (design, slotId, size, picture) =>
  JSON.stringify([
    slotId,
    size || design.texture.size,
    design.style,
    design.markers[slotId],
    picture ? `${picture.width}x${picture.height}` : null,
    ownFontAssetOf(design.style) ? isEmblemFontReady(design.style.fontAsset) : null,
  ]);

/**
 * Метка холстом — для кадра, плиток и обложки. Посчитанное держится по
 * настройкам: ползунок ходит по одним и тем же значениям туда и обратно.
 */
/** Ключ и кэш меток кадра — для досчёта в потоке (`useClimbStageMarker.js`): та же метка не считается дважды. */
export const climbMarkerKey = (design, slotId, picture = null) => markerKey(design, slotId, 0, picture);
export const cachedClimbMarker = (key) => textureCache.get(key) || null;
export const rememberClimbMarker = (key, canvas) => (canvas ? textureCache.set(key, canvas) : null);

export function climbMarkerCanvas(design, slotId, options = {}) {
  const cache = options.size ? tileCache : textureCache;
  const key = markerKey(design, slotId, options.size, options.picture);
  const cached = cache.get(key);
  if (cached) return cached;
  const result = renderClimbMarker(design, slotId, options);
  if (!result) return null;
  const canvas = rgbaToCanvas(result.rgba, result.width, result.height);
  return canvas ? cache.set(key, canvas) : null;
}

/**
 * Метки набора строками — для полосы готового набора и обложки: десять
 * меток в одну строку сжались бы до точек. Строки идут подряд по порядку
 * набора и делят ширину поровну: широкая «Q» считается за четыре клетки.
 */
export function climbSlotRows(slots = CLIMB_SLOTS, count = 2) {
  const total = slots.reduce((sum, slot) => sum + slot.aspect, 0);
  const rows = Array.from({ length: count }, () => []);
  let units = 0;
  for (const slot of slots) {
    const row = Math.min(count - 1, Math.floor((units / total) * count));
    rows[row].push(slot);
    units += slot.aspect;
  }
  return rows.filter((row) => row.length);
}

const canvasUrls = new WeakMap();

/**
 * Холст строкой `data:` для `<img>` — один раз на холст. Запас отдаёт на те
 * же настройки тот же холст, и повторная плитка не сжимается в PNG заново.
 */
export function climbCanvasUrl(canvas) {
  if (!canvas?.toDataURL) return "";
  let url = canvasUrls.get(canvas);
  if (url === undefined) {
    url = canvas.toDataURL();
    canvasUrls.set(canvas, url);
  }
  return url;
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}

/**
 * Текстура метки для установки — PNG в base64.
 *
 * PNG, а не сырые пиксели: у метки больше половины текстуры прозрачно, и
 * сжатая картинка в десятки раз легче, чем 512×512×4 байт через мост окна.
 * Главный процесс разбирает её заново, доливает цвет под прозрачные края и
 * сам собирает DDS — своему входу он не верит.
 */
export async function climbMarkerPng(design, slotId, { picture = null } = {}) {
  /* Свой шрифт — в набор шрифтов документа до холста: в текстуре игры не должно оказаться запасного. */
  await prepareOwnFonts(design.style.fontAsset);
  const result = renderClimbMarker(design, slotId, { picture });
  if (!result) throw new Error("Текстуру метки нечем нарисовать: нет холста.");
  const canvas = rgbaToCanvas(result.rgba, result.width, result.height);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Холст не отдал PNG.")),
      "image/png",
    ),
  );
  return {
    data: base64FromBytes(new Uint8Array(await blob.arrayBuffer())),
    width: result.width,
    height: result.height,
  };
}
