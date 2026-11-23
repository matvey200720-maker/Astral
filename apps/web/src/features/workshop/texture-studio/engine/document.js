/*
 * Документ студии текстур (ТЗ 18.10.2026, Session 1, задача 6): холст
 * `{ width, height, layers }` — стопка слоёв снизу вверх. Чистая модель, без
 * DOM: слои, их свойства, порядок, склейка и (де)сериализация. Пиксели
 * растровых слоёв в документе не лежат — они в хранилище холстов студии
 * (`raster-store.js`), под тем же `id` слоя; документ — лёгкий JSON, его и
 * кладут в историю и в хранилище работы.
 *
 * Виды слоёв:
 *   base   — основа: текстура поверхности из игры (или текущая картинка
 *            места), пиксели в хранилище, правке не поддаётся целиком —
 *            только сверху;
 *   raster — пиксели: кисть, ластик, штамп, заливка, вставка;
 *   image  — вставленная картинка (`asset`), её можно двигать, масштабировать
 *            и вертеть, пока слой не растрирован;
 *   text   — надпись: слова, шрифт, цвет, размер, место, поворот;
 *   shape  — фигура: линия, стрелка, прямоугольник, овал;
 *   fill   — заливка: цвет или градиент на весь слой;
 *   adjust — корректирующий слой: уровни, кривые, тон/насыщенность, баланс,
 *            яркость/контраст, чёрно-белое, инверсия, порог, постеризация —
 *            правит всё, что под ним (в пределах маски слоя).
 * У каждого слоя: непрозрачность (0…100), режим смешивания (16 режимов),
 * видимость, замок и необязательная маска (растр в хранилище под
 * `mask:<id>`).
 */

/** Предел стороны холста: больше видеокарта и память окна не тянут. */
export const MAX_SIDE = 8192;
export const MIN_SIDE = 16;

export const LAYER_TYPES = Object.freeze(["base", "raster", "image", "text", "shape", "fill", "adjust"]);

/* 16 режимов смешивания: имя студии → значение `globalCompositeOperation` холста.
   `group` — раздел списка, как в Photoshop (18.10.2026, владелец: «режимы
   стоящие, но перегружено и неудобно»): шестнадцать строк читаются пятью
   разделами, и у каждого — одна фраза, что он делает. */
export const BLEND_MODES = Object.freeze([
  Object.freeze({ id: "normal", label: "Обычный", op: "source-over", group: "normal" }),
  Object.freeze({ id: "darken", label: "Затемнение", op: "darken", group: "darker" }),
  Object.freeze({ id: "multiply", label: "Умножение", op: "multiply", group: "darker" }),
  Object.freeze({ id: "color-burn", label: "Затемнение основы", op: "color-burn", group: "darker" }),
  Object.freeze({ id: "lighten", label: "Замена светлым", op: "lighten", group: "lighter" }),
  Object.freeze({ id: "screen", label: "Экран", op: "screen", group: "lighter" }),
  Object.freeze({ id: "color-dodge", label: "Осветление основы", op: "color-dodge", group: "lighter" }),
  Object.freeze({ id: "overlay", label: "Перекрытие", op: "overlay", group: "contrast" }),
  Object.freeze({ id: "soft-light", label: "Мягкий свет", op: "soft-light", group: "contrast" }),
  Object.freeze({ id: "hard-light", label: "Жёсткий свет", op: "hard-light", group: "contrast" }),
  Object.freeze({ id: "difference", label: "Разница", op: "difference", group: "compare" }),
  Object.freeze({ id: "exclusion", label: "Исключение", op: "exclusion", group: "compare" }),
  Object.freeze({ id: "hue", label: "Цветовой тон", op: "hue", group: "colour" }),
  Object.freeze({ id: "saturation", label: "Насыщенность", op: "saturation", group: "colour" }),
  Object.freeze({ id: "color", label: "Цветность", op: "color", group: "colour" }),
  Object.freeze({ id: "luminosity", label: "Яркость", op: "luminosity", group: "colour" }),
]);

/* Разделы списка режимов: имя и что раздел делает — одной фразой. */
export const BLEND_GROUPS = Object.freeze([
  Object.freeze({ id: "normal", label: "", hint: "Слой лежит поверх как есть" }),
  Object.freeze({ id: "darker", label: "Темнее", hint: "Тёмное слоя ложится на основу, белое пропадает" }),
  Object.freeze({ id: "lighter", label: "Светлее", hint: "Светлое слоя ложится на основу, чёрное пропадает" }),
  Object.freeze({ id: "contrast", label: "Контраст", hint: "Светлое осветляет, тёмное затемняет, серое пропадает" }),
  Object.freeze({ id: "compare", label: "Сравнение", hint: "Видна разница между слоем и основой" }),
  Object.freeze({ id: "colour", label: "Цвет", hint: "От слоя берётся только тон, насыщенность или яркость" }),
]);
export const BLEND_IDS = Object.freeze(BLEND_MODES.map((mode) => mode.id));
export const blendOperation = (id) => BLEND_MODES.find((mode) => mode.id === id)?.op || "source-over";

export const ADJUST_KINDS = Object.freeze(["levels", "curves", "hue-saturation", "color-balance", "brightness-contrast", "black-white", "invert", "threshold", "posterize"]);
export const SHAPE_KINDS = Object.freeze(["line", "arrow", "rect", "ellipse"]);
export const TEXT_FONTS = Object.freeze(["sans", "serif", "mono", "stencil", "script", "block"]);
/* Свой шрифт человека (ТЗ 23.10.2026, п. F): `font: "custom"` и ключ файла в хранилище окна; файла в документе нет. */
const FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;

const HEX = /^#[0-9a-f]{6}$/i;
const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const number = (value, [low, high], fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(high, Math.max(low, parsed)) : fallback;
};
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const colour = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);

/** Размер холста: целые, в пределах. */
export function normalizeSize(width, height) {
  return {
    width: Math.round(number(width, [MIN_SIDE, MAX_SIDE], 1024)),
    height: Math.round(number(height, [MIN_SIDE, MAX_SIDE], 1024)),
  };
}

let serial = 0;
/** Свободный `id` слоя в документе: `l1`, `l2`… (в пределах одного документа не повторяется). */
export function nextLayerId(doc) {
  const taken = new Set((doc?.layers || []).map((layer) => layer.id));
  let id;
  do {
    serial += 1;
    id = `l${serial}`;
  } while (taken.has(id));
  return id;
}

/* ------------------------------------------------------------------ *
 * Слои
 * ------------------------------------------------------------------ */

const DEFAULT_NAMES = Object.freeze({ base: "Основа", raster: "Слой", image: "Картинка", text: "Текст", shape: "Фигура", fill: "Заливка", adjust: "Коррекция" });

function normalizeGradient(input) {
  const source = plain(input);
  const stops = (Array.isArray(source.stops) ? source.stops : [])
    .map((stop) => ({ at: round(number(plain(stop).at, [0, 1], 0), 3), colour: colour(plain(stop).colour, "#ffffff"), alpha: round(number(plain(stop).alpha, [0, 1], 1), 3) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 8);
  return {
    kind: source.kind === "radial" ? "radial" : "linear",
    angle: round(number(source.angle, [-360, 360], 90), 1),
    stops: stops.length >= 2 ? stops : [{ at: 0, colour: "#000000", alpha: 1 }, { at: 1, colour: "#ffffff", alpha: 1 }],
  };
}

function normalizeAdjustParams(kind, input) {
  const source = plain(input);
  switch (kind) {
    case "levels":
      return {
        inLow: Math.round(number(source.inLow, [0, 253], 0)),
        inHigh: Math.round(number(source.inHigh, [2, 255], 255)),
        gamma: round(number(source.gamma, [0.1, 9.99], 1)),
        outLow: Math.round(number(source.outLow, [0, 255], 0)),
        outHigh: Math.round(number(source.outHigh, [0, 255], 255)),
      };
    case "curves": {
      const points = (Array.isArray(source.points) ? source.points : [])
        .map((point) => [Math.round(number(point?.[0], [0, 255], 0)), Math.round(number(point?.[1], [0, 255], 0))])
        .sort((a, b) => a[0] - b[0]);
      const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0]).slice(0, 16);
      return { points: unique.length >= 2 ? unique : [[0, 0], [255, 255]] };
    }
    case "hue-saturation":
      return { hue: Math.round(number(source.hue, [-180, 180], 0)), saturation: Math.round(number(source.saturation, [-100, 100], 0)), lightness: Math.round(number(source.lightness, [-100, 100], 0)) };
    case "color-balance":
      return {
        shadows: [0, 1, 2].map((i) => Math.round(number(source.shadows?.[i], [-100, 100], 0))),
        midtones: [0, 1, 2].map((i) => Math.round(number(source.midtones?.[i], [-100, 100], 0))),
        highlights: [0, 1, 2].map((i) => Math.round(number(source.highlights?.[i], [-100, 100], 0))),
      };
    case "brightness-contrast":
      return { brightness: Math.round(number(source.brightness, [-100, 100], 0)), contrast: Math.round(number(source.contrast, [-100, 100], 0)) };
    case "threshold":
      return { level: Math.round(number(source.level, [1, 255], 128)) };
    case "posterize":
      return { levels: Math.round(number(source.levels, [2, 32], 4)) };
    case "black-white":
      return { red: Math.round(number(source.red, [-200, 300], 40)), green: Math.round(number(source.green, [-200, 300], 60)), blue: Math.round(number(source.blue, [-200, 300], 20)) };
    default:
      return {};
  }
}

/** Слой после разбора: все поля на месте, числа в пределах. */
export function normalizeLayer(input, doc = null) {
  const source = plain(input);
  const type = LAYER_TYPES.includes(source.type) ? source.type : "raster";
  const id = typeof source.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(source.id) ? source.id : nextLayerId(doc);
  const layer = {
    id,
    type,
    name: String(source.name ?? DEFAULT_NAMES[type]).slice(0, 60) || DEFAULT_NAMES[type],
    visible: source.visible !== false,
    locked: source.locked === true,
    opacity: Math.round(number(source.opacity, [0, 100], 100)),
    blend: BLEND_IDS.includes(source.blend) ? source.blend : "normal",
    mask: source.mask === true,
  };
  if (type === "image")
    return {
      ...layer,
      asset: String(source.asset || ""),
      x: round(number(source.x, [-65536, 65536], 0)),
      y: round(number(source.y, [-65536, 65536], 0)),
      width: round(number(source.width, [1, 65536], 256)),
      height: round(number(source.height, [1, 65536], 256)),
      rotate: round(number(source.rotate, [-360, 360], 0), 1),
    };
  if (type === "text")
    return {
      ...layer,
      value: String(source.value ?? "").slice(0, 400),
      font: TEXT_FONTS.includes(source.font) ? source.font : source.font === "custom" && FONT_ASSET.test(String(source.fontAsset || "")) ? "custom" : "sans",
      ...(FONT_ASSET.test(String(source.fontAsset || "")) ? { fontAsset: source.fontAsset, fontName: String(source.fontName ?? "").trim().slice(0, 60) } : {}),
      size: Math.round(number(source.size, [4, 4096], 96)),
      colour: colour(source.colour, "#ffffff"),
      x: round(number(source.x, [-65536, 65536], 0)),
      y: round(number(source.y, [-65536, 65536], 0)),
      align: ["left", "center", "right"].includes(source.align) ? source.align : "left",
      rotate: round(number(source.rotate, [-360, 360], 0), 1),
    };
  if (type === "shape")
    return {
      ...layer,
      shape: SHAPE_KINDS.includes(source.shape) ? source.shape : "rect",
      x1: round(number(source.x1, [-65536, 65536], 0)),
      y1: round(number(source.y1, [-65536, 65536], 0)),
      x2: round(number(source.x2, [-65536, 65536], 100)),
      y2: round(number(source.y2, [-65536, 65536], 100)),
      stroke: colour(source.stroke, "#ffffff"),
      strokeWidth: round(number(source.strokeWidth, [0, 2048], 8)),
      fill: source.fill === null || source.fill === "" ? null : colour(source.fill, "#ffffff"),
    };
  if (type === "fill") {
    const gradient = source.gradient ? normalizeGradient(source.gradient) : null;
    return { ...layer, colour: colour(source.colour, "#808080"), gradient };
  }
  if (type === "adjust") {
    const kind = ADJUST_KINDS.includes(source.kind) ? source.kind : "brightness-contrast";
    return { ...layer, kind, params: normalizeAdjustParams(kind, source.params) };
  }
  return layer;
}

/** Документ после разбора: размер в пределах, слои разобраны, активный слой — существующий. */
export function normalizeDocument(input) {
  const source = plain(input);
  const size = normalizeSize(source.width, source.height);
  const doc = { version: 1, ...size, background: source.background === "transparent" ? "transparent" : colour(source.background, "#000000"), layers: [], active: "" };
  const seen = new Set();
  for (const raw of Array.isArray(source.layers) ? source.layers : []) {
    const layer = normalizeLayer(raw, doc);
    if (seen.has(layer.id)) continue;
    seen.add(layer.id);
    doc.layers.push(layer);
    if (doc.layers.length >= 200) break;
  }
  doc.active = seen.has(source.active) ? source.active : doc.layers.at(-1)?.id || "";
  return doc;
}

/** Новый документ с основой (`base`) — текстурой поверхности. */
export function createDocument({ width, height, background = "#000000", withBase = true } = {}) {
  const doc = normalizeDocument({ width, height, background, layers: [] });
  if (withBase) {
    const layer = normalizeLayer({ type: "base", id: "base" }, doc);
    doc.layers.push(layer);
    doc.active = layer.id;
  }
  return doc;
}

/* ------------------------------------------------------------------ *
 * Правки структуры: каждая возвращает новый документ
 * ------------------------------------------------------------------ */

const indexOf = (doc, id) => doc.layers.findIndex((layer) => layer.id === id);
export const layerOf = (doc, id) => doc.layers.find((layer) => layer.id === id) || null;

/** Слой поверх активного (или в самый верх). */
export function addLayer(doc, input) {
  const layer = normalizeLayer(input, doc);
  const at = doc.active ? indexOf(doc, doc.active) + 1 : doc.layers.length;
  const layers = [...doc.layers.slice(0, at), layer, ...doc.layers.slice(at)];
  return { ...doc, layers, active: layer.id };
}

export function removeLayer(doc, id) {
  const at = indexOf(doc, id);
  if (at < 0 || doc.layers[at].type === "base") return doc;
  const layers = doc.layers.filter((layer) => layer.id !== id);
  const active = doc.active === id ? layers[Math.min(at, layers.length) - 1]?.id || layers[0]?.id || "" : doc.active;
  return { ...doc, layers, active };
}

/** Копия слоя над ним (`newId` — id копии, пиксели копирует вызывающий). */
export function duplicateLayer(doc, id, newId = null) {
  const at = indexOf(doc, id);
  if (at < 0 || doc.layers[at].type === "base") return { doc, copy: null };
  const copy = normalizeLayer({ ...doc.layers[at], id: newId || nextLayerId(doc), name: `${doc.layers[at].name} ${copySuffix(doc.layers[at].name)}`.trim() }, doc);
  const layers = [...doc.layers.slice(0, at + 1), copy, ...doc.layers.slice(at + 1)];
  return { doc: { ...doc, layers, active: copy.id }, copy };
}
const copySuffix = (name) => (/копия/i.test(name) ? "" : "копия");

/** Слой выше (`+1`) или ниже (`-1`); основа всегда внизу. */
export function moveLayer(doc, id, step) {
  const at = indexOf(doc, id);
  if (at < 0 || doc.layers[at].type === "base") return doc;
  const to = Math.min(doc.layers.length - 1, Math.max(doc.layers[0]?.type === "base" ? 1 : 0, at + step));
  if (to === at) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(at, 1);
  layers.splice(to, 0, layer);
  return { ...doc, layers };
}

/** Слой на место `to` (перетаскивание в списке). */
export function reorderLayer(doc, id, to) {
  const at = indexOf(doc, id);
  if (at < 0 || doc.layers[at].type === "base") return doc;
  const floor = doc.layers[0]?.type === "base" ? 1 : 0;
  const target = Math.min(doc.layers.length - 1, Math.max(floor, to));
  if (target === at) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(at, 1);
  layers.splice(target, 0, layer);
  return { ...doc, layers };
}

/** Свойства слоя (имя, видимость, замок, непрозрачность, режим, поля вида). */
export function patchLayer(doc, id, patch) {
  const at = indexOf(doc, id);
  if (at < 0) return doc;
  const layers = doc.layers.map((layer, index) => (index === at ? normalizeLayer({ ...layer, ...patch, id: layer.id, type: layer.type }, doc) : layer));
  return { ...doc, layers };
}

export const selectLayer = (doc, id) => (indexOf(doc, id) >= 0 && doc.active !== id ? { ...doc, active: id } : doc);

/** Слой, на который можно рисовать пикселями: растровый или основа (ей тоже можно, как «Фону» привычных редакторов). */
export const isPixelLayer = (layer) => layer?.type === "raster" || layer?.type === "base";

/** Можно ли слить слой вниз: оба — растровые (или нижний — основа), верхний виден. */
export function canMergeDown(doc, id) {
  const at = indexOf(doc, id);
  if (at <= 0) return false;
  const top = doc.layers[at];
  const below = doc.layers[at - 1];
  return top.type === "raster" && (below.type === "raster" || below.type === "base");
}

/** Документ после склейки слоя вниз (пиксели склеивает вызывающий). */
export function mergeDown(doc, id) {
  if (!canMergeDown(doc, id)) return doc;
  const at = indexOf(doc, id);
  const layers = doc.layers.filter((layer) => layer.id !== id);
  return { ...doc, layers, active: doc.layers[at - 1].id };
}

/** Размер холста поменяли: слои с местом (картинка, текст, фигура) пересчитываются в новый размер вместе с ним. */
export function resizeDocument(doc, width, height) {
  const size = normalizeSize(width, height);
  const kx = size.width / doc.width;
  const ky = size.height / doc.height;
  const layers = doc.layers.map((layer) => {
    if (layer.type === "image") return { ...layer, x: round(layer.x * kx), y: round(layer.y * ky), width: round(layer.width * kx), height: round(layer.height * ky) };
    if (layer.type === "text") return { ...layer, x: round(layer.x * kx), y: round(layer.y * ky), size: Math.max(4, Math.round(layer.size * ky)) };
    if (layer.type === "shape") return { ...layer, x1: round(layer.x1 * kx), y1: round(layer.y1 * ky), x2: round(layer.x2 * kx), y2: round(layer.y2 * ky), strokeWidth: round(layer.strokeWidth * Math.max(kx, ky)) };
    return layer;
  });
  return { ...doc, ...size, layers };
}

/** Картинки документа, что нужны для сборки (ключи хранилища окна), без повторов. */
/** Свои шрифты надписей документа: ключи файлов в хранилище окна (по одному). */
export const documentFonts = (doc) => [...new Set(doc.layers.filter((layer) => layer.type === "text" && layer.font === "custom" && layer.fontAsset).map((layer) => layer.fontAsset))];

export const documentAssets = (doc) => [...new Set(doc.layers.filter((layer) => layer.type === "image" && layer.asset).map((layer) => layer.asset))];

/** Отпечаток документа для сравнений («поменялось ли что-то»): структура слоёв без активного слоя. */
export const documentSignature = (doc) => JSON.stringify({ w: doc.width, h: doc.height, b: doc.background, l: doc.layers });

export const serializeDocument = (doc) => JSON.stringify(normalizeDocument(doc));
export function parseDocument(text) {
  try {
    return normalizeDocument(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return null;
  }
}
