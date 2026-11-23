import { paintWorkshopMatte } from "@modovik/gfx/workshop-matte";

const PNG_TYPE = "image/png";
const DEFAULT_MARGIN = 0.04;
// Пиксель считается «нарисованным», если его альфа строго выше порога.
const INK_ABOVE = 8;
const READ_HINT = { willReadFrequently: true };
const NS = { xhtml: "http://www.w3.org/1999/xhtml", svg: "http://www.w3.org/2000/svg" };
const SVG_PREFIX = "data:image/svg+xml;charset=utf-8,";

const blankCanvas = (width, height) =>
  Object.assign(document.createElement("canvas"), { width, height });

const canvasWithContext = (width, height) => {
  const canvas = blankCanvas(width, height);
  return [canvas, canvas.getContext("2d")];
};

// Ждёт onload/onerror объекта; start запускает работу, когда обработчики уже выставлены.
function settle(target, { failure, start, result = () => target }) {
  return new Promise((resolve, reject) => {
    Object.assign(target, {
      onload: () => resolve(result()),
      onerror: () => reject(new Error(failure)),
    });
    start();
  });
}

// Выполняет шаги по одному, дожидаясь каждого.
const inOrder = (items, step) =>
  items.reduce((chain, item) => chain.then(() => step(item)), Promise.resolve());

/* ---------- рамка нарисованного и посадка в кадр ---------- */

const extent = (from, to) => to - from + 1;

// Крайние нарисованные столбцы строки или null, если строка пуста.
function inkSpanOfRow(rgba, rowStart, columns) {
  const stop = rowStart + columns * 4;
  const blank = (at) => !(rgba[at] > INK_ABOVE);
  let head = rowStart + 3;
  while (head < stop && blank(head)) head += 4;
  if (!(head < stop)) return null;
  let tail = stop - 1;
  while (blank(tail)) tail -= 4;
  return [(head - 3 - rowStart) / 4, (tail - 3 - rowStart) / 4];
}

export function drawnBounds(canvas) {
  const context = canvas.getContext("2d", READ_HINT);
  const { width, height } = canvas;
  const rgba = context.getImageData(0, 0, width, height).data;
  const spans = Array.from({ length: height }, (_, row) =>
    inkSpanOfRow(rgba, row * width * 4, width),
  );
  const top = spans.findIndex(Boolean);
  if (top < 0) return null;
  const inked = spans.filter(Boolean);
  const left = Math.min(...inked.map(([first]) => first));
  const right = Math.max(...inked.map(([, last]) => last));
  return {
    x: left,
    y: top,
    width: extent(left, right),
    height: extent(top, spans.findLastIndex(Boolean)),
  };
}

const centeredOffsets = (size, width, height) => ({
  x: (size.width - width) / 2,
  y: (size.height - height) / 2,
});

function fitBounds(bounds, size, room) {
  if (!bounds) return null;
  const [byWidth, byHeight] = ["width", "height"].map(
    (axis) => (size[axis] * room) / bounds[axis],
  );
  const fit = Math.min(byWidth, byHeight);
  const [width, height] = [bounds.width, bounds.height].map((side) => side * fit);
  return { bounds, fit, ...centeredOffsets(size, width, height), width, height };
}

export function coverPlacement(layer, size, { margin = DEFAULT_MARGIN } = {}) {
  return fitBounds(drawnBounds(layer), size, 1 - margin * 2);
}

/* ---------- кадр обложки ---------- */

const rectOf = ({ x, y, width, height }) => [x, y, width, height];

/* `bare` — кадр без поля: матовое поле не рисуется, вокруг содержимого прозрачно (`@modovik/gfx/map-card`). Такой кадр окно страницы мода
   меряет по непрозрачным точкам и показывает содержимое целиком; рамок и обводок вокруг него нет (владелец, 13.11.2026). */
export function paintedCover(layer, size, placement, { bare = false } = {}) {
  const { width, height } = size;
  const canvas = blankCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!bare) paintWorkshopMatte(context, width, height);
  Object.assign(context, { imageSmoothingQuality: "high" });
  context.drawImage(layer, ...rectOf(placement.bounds), ...rectOf(placement));
  return canvas;
}

const toPngBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, PNG_TYPE));

export async function pngBytes(canvas) {
  const blob = await toPngBlob(canvas);
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

const pngIfPlaced = (layer, size, placement, options) =>
  placement ? pngBytes(paintedCover(layer, size, placement, options)) : null;

export async function fillCoverWith(layer, size, { margin = DEFAULT_MARGIN, bare = false } = {}) {
  return pngIfPlaced(layer, size, coverPlacement(layer, size, { margin }), { bare });
}

/* ---------- снимок вёрстки в холст ---------- */

function readAsDataUrl(blob) {
  const reader = new FileReader();
  return settle(reader, {
    failure: "Картинка обложки не прочиталась.",
    result: () => reader.result,
    start: () => reader.readAsDataURL(blob),
  });
}

const isInline = (address) => !address || address.startsWith("data:");

async function asDataAddress(address) {
  return isInline(address)
    ? address
    : fetch(address)
        .then((response) => response.blob())
        .then(readAsDataUrl);
}

// Вычисленный стиль элемента одной строкой `имя:значение;…` в порядке обхода.
function styleLine(element) {
  const computed = getComputedStyle(element);
  return Array.from(computed, (name) => `${name}:${computed.getPropertyValue(name)}`).join(";");
}

function imageInsteadOfCanvas(canvas) {
  const style = styleLine(canvas);
  const stand = document.createElement("img");
  [
    ["src", canvas.toDataURL(PNG_TYPE)],
    ["style", style],
  ].forEach(([name, value]) => stand.setAttribute(name, value));
  return stand;
}

const isElement = (node) => node.nodeType === Node.ELEMENT_NODE;

async function dressElement(source, copy) {
  copy.setAttribute("style", styleLine(source));
  if (!(source instanceof HTMLImageElement)) return;
  const address = source.currentSrc || source.src;
  copy.setAttribute("src", await asDataAddress(address));
}

// Копия дерева с зашитыми стилями; картинки читаются строго по очереди.
async function inlinedClone(source) {
  if (source instanceof HTMLCanvasElement) return imageInsteadOfCanvas(source);
  const copy = source.cloneNode(false);
  if (isElement(source)) await dressElement(source, copy);
  await inOrder(Array.from(source.childNodes), async (child) => {
    copy.appendChild(await inlinedClone(child));
  });
  return copy;
}

const serialize = (node) => new XMLSerializer().serializeToString(node);

const svgDocument = (markup, width, height) =>
  [
    `<svg xmlns="${NS.svg}" width="${width}" height="${height}">`,
    '<foreignObject x="0" y="0" width="100%" height="100%">',
    markup,
    "</foreignObject></svg>",
  ].join("");

async function layoutAsSvg(element, width, height) {
  const root = await inlinedClone(element);
  Object.assign(root.style, { width: `${width}px`, height: `${height}px` });
  root.setAttribute("xmlns", NS.xhtml);
  return svgDocument(serialize(root), width, height);
}

function loadPicture(svg) {
  const picture = new Image();
  return settle(picture, {
    failure: "Картинка обложки не загрузилась.",
    start: () => {
      picture.src = SVG_PREFIX + encodeURIComponent(svg);
    },
  });
}

export async function rasterizeLayout(element, { width, height }) {
  const [canvas, context] = canvasWithContext(width, height);
  const svg = await layoutAsSvg(element, width, height);
  context.drawImage(await loadPicture(svg), 0, 0);
  return canvas;
}
