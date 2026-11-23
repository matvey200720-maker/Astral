import { WORK_CATALOG_CARDS } from "@modovik/publishing";
import { isBlankFrame, loadImage } from "../../publishing/frames/capture.js";

export { WORK_CATALOG_CARDS, workCatalogDescription } from "@modovik/publishing";

const [FRAME_W, FRAME_H] = [1200, 675];
const PROBE = 64;
const FIELD_COLOUR = "#0e0e10";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LINK_ATTRIBUTES = ["href", "xlink:href"];
// Какие стороны карты читаем из viewBox (номер числа) и откуда брать запасной размер.
const MAP_AXES = [
  ["width", 2, "clientWidth"],
  ["height", 3, "clientHeight"],
];
const MAP_FALLBACK = 1000;
const COVER_SELECTOR = [".workshop-cover canvas", ".workshop-cover svg", ".workshop-cover img", "img.workshop-work-image"].join(", ");

// Приведение к ключу таблицы делает сама Object.hasOwn: массив из одной строки сойдёт за вид,
// имена из прототипа не сойдут, объект без прототипа бросит TypeError.
export const canSendWorkToCatalog = (workKind) => Object.hasOwn(WORK_CATALOG_CARDS, workKind);

const canvasOf = (width, height) => Object.assign(document.createElement("canvas"), { width, height });

// viewBox делится по пробелам и запятым; ведущий пробел даёт пустой первый кусок и сдвигает всё.
function mapExtent(svg) {
  const parts = String(svg.getAttribute("viewBox") || "").split(/[\s,]+/);
  return Object.fromEntries(MAP_AXES.map(([axis, at, client]) => [axis, Number(parts[at]) || svg[client] || MAP_FALLBACK]));
}

// Картинка внутри карты вшивается data-адресом, иначе в растр она не попадёт. Ложь — вшить не удалось.
async function inlineOne(node) {
  const address = LINK_ATTRIBUTES.reduce((found, name) => found || node.getAttribute(name), "");
  if (!address || address.startsWith("data:")) {
    return true;
  }
  const loaded = await loadImage(address);
  const holder = canvasOf(loaded.naturalWidth, loaded.naturalHeight);
  const context = holder.getContext("2d");
  if (context) {
    context.drawImage(loaded, 0, 0);
    node.setAttribute("href", holder.toDataURL("image/png"));
  }
  return Boolean(context);
}

// Вложенные картинки идут одна за другой; после первой неудачи остальные не трогаем.
const inlineAll = (nodes) =>
  Array.from(nodes).reduce((chain, node) => chain.then((ok) => ok && inlineOne(node)), Promise.resolve(true));

async function mapToPicture(svg) {
  const clone = svg.cloneNode(true);
  if (!(await inlineAll(clone.querySelectorAll("image")))) {
    return null;
  }
  const attributes = { xmlns: SVG_NAMESPACE, ...mapExtent(svg) };
  Object.entries(attributes).forEach(([name, value]) => clone.setAttribute(name, String(value)));

  const markup = new XMLSerializer().serializeToString(clone);
  const address = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  return loadImage(address).finally(() => URL.revokeObjectURL(address));
}

// Откуда берётся рисунок: карту умещаем целиком (min), остальное заполняет кадр (max).
const ARTWORK_SOURCES = [
  [() => SVGSVGElement, mapToPicture, Math.min],
  [() => HTMLImageElement, (image) => loadImage(image.currentSrc || image.src), Math.max],
];

async function artworkOf(element) {
  const [, produce, fit] = ARTWORK_SOURCES.find(([kind]) => element instanceof kind()) ?? [null, (plain) => plain, Math.max];
  const drawable = await produce(element);
  return drawable && { drawable, fit };
}

// Размер рисунка: естественный, а если его нет, то заданный; нуль и NaN — нет размера.
function sizeOf(drawable) {
  const width = drawable.naturalWidth || drawable.width;
  const height = drawable.naturalHeight || drawable.height;
  return width && height ? { width, height } : null;
}

// Где и каким размером рисовать: по центру кадра, масштаб выбирает fit.
function placement({ width, height }, fit) {
  const scale = fit(FRAME_W / width, FRAME_H / height);
  const [shownW, shownH] = [width * scale, height * scale];
  return [(FRAME_W - shownW) / 2, (FRAME_H - shownH) / 2, shownW, shownH];
}

// Чёрный холст WebGL и пустая картинка не годятся: смотрим уменьшенную копию.
function looksBlank(drawable) {
  const probe = canvasOf(PROBE, PROBE).getContext("2d");
  probe.drawImage(drawable, 0, 0, PROBE, PROBE);
  return isBlankFrame(probe.getImageData(0, 0, PROBE, PROBE));
}

export async function captureWorkCover(card) {
  try {
    const element = card?.querySelector?.(COVER_SELECTOR);
    const artwork = element && (await artworkOf(element));
    const size = artwork && sizeOf(artwork.drawable);
    if (!size) {
      return null;
    }

    const frame = canvasOf(FRAME_W, FRAME_H);
    const context = frame.getContext("2d");
    if (!context || looksBlank(artwork.drawable)) {
      return null;
    }

    const box = placement(size, artwork.fit);
    const strokes = [
      () => { context.fillStyle = FIELD_COLOUR; },
      () => context.fillRect(0, 0, FRAME_W, FRAME_H),
      () => context.drawImage(artwork.drawable, ...box),
    ];
    strokes.forEach((stroke) => stroke());
    return frame.toDataURL("image/webp", 0.9);
  } catch {
    return null;
  }
}
