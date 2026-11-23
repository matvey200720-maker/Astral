import * as THREE from "three";
import { tr } from "../../../locales/ui.js";
import { emblemFontFamily, ensureEmblemFont } from "./emblem-fonts.js";
import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  putWorkshopAsset,
} from "../../../components/desktop/workshop/workshop-assets.js";
import {
  emblemAssets,
  emblemTextFilled,
  emblemTextKey,
  normalizeEmblemText,
} from "@modovik/climb-contract/recolor/emblems";
import { decalMatrixRows } from "@modovik/climb-contract/recolor/decal";
import { useEffect, useState } from "react";

export { emblemFontFamily, ensureEmblemFont, saveEmblemFont } from "./emblem-fonts.js";

const MSG_FONT_LOST = "Файл своего шрифта пропал из хранилища окна — загрузите его ещё раз.";
const MSG_STILL_DRAWING = "Надпись ещё рисуется — нажмите «Применить» ещё раз.";
const MSG_IMAGE_LOST = "Картинка эмблемы пропала из хранилища окна — загрузите её ещё раз.";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// ---------- гарнитуры ----------

const SIZE = 160;

// Вес, начертание и стопка семейств; строка холста и CSS собираются отсюда же.
const FACES = {
  block: { weight: "900", style: "normal", families: '"Arial Black", "Segoe UI Black", Impact, sans-serif' },
  wide: { weight: "900", style: "normal", families: '"Segoe UI Black", "Arial Black", sans-serif' },
  modern: { weight: "700", style: "normal", families: 'Bahnschrift, "Segoe UI", sans-serif' },
  serif: { weight: "700", style: "normal", families: 'Georgia, "Times New Roman", serif' },
  stencil: { weight: "400", style: "normal", families: 'Stencil, "Stencil Std", Impact, "Arial Black", sans-serif' },
  script: { weight: "700", style: "italic", families: '"Segoe Script", "Brush Script MT", "Segoe Print", cursive' },
  mono: { weight: "700", style: "normal", families: 'Consolas, "Cascadia Mono", "Courier New", monospace' },
};

const shorthand = ({ weight, style, families }, px) =>
  [style === "italic" && style, weight !== "400" && weight, `${px}px`, families].filter(Boolean).join(" ");

const customFace = (fontAsset) => ({
  weight: "700",
  style: "normal",
  families: `"${emblemFontFamily(fontAsset)}", "Arial Black", sans-serif`,
});

// Параметры надписи не нормализуются; null и undefined — TypeError.
function faceOf({ font, fontAsset }) {
  if (font === "custom" && fontAsset) return customFace(fontAsset);
  return FACES[Object.hasOwn(FACES, font) ? font : "block"];
}

export const EMBLEM_TEXT_FONT_STACKS = Object.freeze(
  Object.fromEntries(Object.entries(FACES).map(([name, face]) => [name, shorthand(face, SIZE)])),
);

export const EMBLEM_OUTLINE_COLOURS = Object.freeze(
  Object.fromEntries([
    ["dark", "#101114"],
    ["light", "#f4f5f7"],
  ]),
);

export const emblemCanvasFont = (text) => shorthand(faceOf(text), SIZE);

export function emblemCssFont(text) {
  const { families, weight, style } = faceOf(text);
  return { family: families, weight, style };
}

// ---------- холсты ----------

// Холст с двумерным контекстом либо null (нет страницы, нет контекста, сбой).
function openCanvas() {
  try {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

// Вызывает make один раз, результат (в том числе неудачу) помнит навсегда.
const once = (make) => {
  let box;
  return () => (box ??= { value: make() }).value;
};

const sharedRuler = once(() => openCanvas()?.ctx ?? null);

// Шаги записи на контекст: метод вызывается, всё остальное — свойство.
function perform(ctx, steps) {
  for (const [name, ...args] of steps) {
    if (typeof ctx[name] === "function") ctx[name](...args);
    else ctx[name] = args[0];
  }
}

// ---------- раскладка надписи ----------

const px = (k) => Math.round(SIZE * k);
const PLATE_HEIGHT = 384;
const FRAME = { across: 0.88, down: 0.72, lineHeight: 1.1, cap: 6, rim: 0.06 };

// Обычная надпись: поле и обводка идут от кегля, холст растёт под текст.
function plainMetrics(text, natural) {
  const edge = text.outline === "none" ? 0 : px(0.08);
  const pad = px(0.12) + edge;
  return {
    width: clamp(Math.ceil(natural) + 2 * pad, 8, 4096),
    height: px(1.25) + 2 * pad,
    size: SIZE,
    stroke: 2 * edge,
  };
}

// Надпись на плашке: холст задан пропорциями, кегль подгоняется под рамку.
function plateMetrics(text, natural) {
  const { ratio } = text;
  const width = clamp(Math.round(PLATE_HEIGHT * ratio), 64, 1024);
  const height = Math.max(32, Math.round(width / ratio));
  const rim = text.outline === "none" ? 0 : FRAME.rim;
  const fits = [
    (width * FRAME.across) / Math.max(1, natural * (1 + rim)),
    (height * FRAME.down) / (SIZE * FRAME.lineHeight),
    FRAME.cap,
  ];
  const fit = Math.min(...fits);
  return {
    width,
    height,
    size: Math.max(6, Math.round(SIZE * fit)),
    stroke: rim ? Math.max(2, Math.round(SIZE * fit * rim * 2)) : 0,
  };
}

export function emblemTextLayout(input, context = sharedRuler()) {
  if (!context) return null;
  const text = normalizeEmblemText(input);
  const face = faceOf(text);
  const line = text.value.trim();
  context.font = shorthand(face, SIZE);
  const natural = context.measureText(line).width;
  const measure = text.backdrop ? plateMetrics : plainMetrics;
  const { height, size, stroke, width } = measure(text, natural);
  return { text, line, width, height, size, font: shorthand(face, size), stroke };
}

// ---------- рисунок надписи ----------

function inkSteps(text, plan) {
  const [midX, midY] = [plan.width / 2, plan.height / 2];
  const plate = text.backdrop
    ? [["fillStyle", text.backdrop], ["fillRect", 0, 0, plan.width, plan.height]]
    : [];
  const outline =
    plan.stroke > 0
      ? [
          ["lineJoin", "round"],
          ["lineWidth", plan.stroke],
          ["strokeStyle", EMBLEM_OUTLINE_COLOURS[text.outline]],
          ["strokeText", plan.line, midX, midY],
        ]
      : [];
  return [
    ...plate,
    ["font", plan.font],
    ["textAlign", "center"],
    ["textBaseline", "middle"],
    ...outline,
    ["fillStyle", text.colour],
    ["fillText", plan.line, midX, midY],
  ];
}

export function renderEmblemText(input) {
  const text = normalizeEmblemText(input);
  if (!emblemTextFilled(text)) return null;
  const opened = openCanvas();
  if (!opened) return null;
  const { canvas, ctx } = opened;
  const plan = emblemTextLayout(text, ctx);
  canvas.width = plan.width;
  canvas.height = plan.height;
  perform(ctx, inkSteps(text, plan));
  return { aspect: plan.width / plan.height, canvas };
}

// ---------- сохранение надписи ----------

// Уже нарисованные надписи: ключ параметров -> результат.
const drawnTable = new Map();

function encodePng(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ?? null), "image/png");
    } catch {
      resolve(null);
    }
  });
}

function asPngFile(blob) {
  const name = tr("надпись.png");
  return typeof File === "function" ? new File([blob], name, { type: "image/png" }) : Object.assign(blob, { name });
}

const fontGate = (fontAsset) =>
  Promise.resolve(ensureEmblemFont(fontAsset)).then((found) => {
    if (!found) throw new Error(MSG_FONT_LOST);
  });

// PNG в хранилище окна под ключом sha256, итог — в таблицу нарисованного.
function persist(blob, canvas, text, key) {
  const pngOnly = { extensions: new Set(["png"]) };
  return prepareWorkshopAsset(asPngFile(blob), pngOnly).then((prepared) => {
    const asset = `hangar-emblem:${prepared.metadata.hash}`;
    return putWorkshopAsset(asset, prepared.blob).then(() => {
      const made = { asset, name: text.value.trim(), width: canvas.width, height: canvas.height, drawn: key };
      drawnTable.set(key, made);
      return made;
    });
  });
}

function paint(input) {
  const text = normalizeEmblemText(input);
  const key = emblemTextKey(text);
  if (drawnTable.has(key)) return drawnTable.get(key);

  const develop = () => {
    const rendered = renderEmblemText(text);
    if (!rendered) return null;
    const { canvas } = rendered;
    return encodePng(canvas).then((blob) => (blob ? persist(blob, canvas, text, key) : null));
  };

  if (text.font !== "custom") return develop();
  return fontGate(text.fontAsset).then(develop);
}

export const drawEmblemText = (input) => new Promise((resolve) => resolve(paint(input)));

// ---------- картинки для «Применить» ----------

const BASE64_CHUNK = 32768;

function* slices(bytes) {
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) yield bytes.subarray(at, at + BASE64_CHUNK);
}

const toBase64 = (blob) =>
  blob
    .arrayBuffer()
    .then((buffer) =>
      btoa(Array.from(slices(new Uint8Array(buffer)), (part) => String.fromCharCode(...part)).join("")),
    );

const isStale = ({ kind, text, drawn }) =>
  kind === "text" && emblemTextFilled(text) && drawn !== emblemTextKey(text);

export const pendingTexts = (items) => items.filter(isStale);

export async function emblemImages(items) {
  const list = items || [];
  if (pendingTexts(list).length) throw new Error(MSG_STILL_DRAWING);
  const keys = emblemAssets(list);
  if (!keys.length) return null;
  // ключи читаются по порядку: каждый шаг ждёт накопитель предыдущих
  const pairs = await keys.reduce(async (soFar, key) => {
    const done = await soFar;
    const blob = await getWorkshopAsset(key);
    if (!blob) throw new Error(MSG_IMAGE_LOST);
    return [...done, [key, { data: await toBase64(blob) }]];
  }, Promise.resolve([]));
  return { emblems: Object.fromEntries(pairs) };
}

// ---------- атлас картинок для шейдера ----------

const TILE_W = 1024;
const TILE_H = 512;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
const ATLAS_W = TILE_W * ATLAS_COLS;
const ATLAS_H = TILE_H * ATLAS_ROWS;
const TILE_INSET = 2;
const TILE_RESIZE = { resizeWidth: TILE_W, resizeHeight: TILE_H, resizeQuality: "high" };
const ATLAS_TEXTURE = {
  colorSpace: THREE.NoColorSpace,
  flipY: false,
  generateMipmaps: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  needsUpdate: true,
};

// Плитки атласа по порядку картинок; лишние сверх сетки отбрасываются.
function* cells(pictures) {
  for (const [index, { asset, image }] of pictures.slice(0, ATLAS_COLS * ATLAS_ROWS).entries()) {
    yield {
      asset,
      image,
      x: (index % ATLAS_COLS) * TILE_W,
      y: Math.floor(index / ATLAS_COLS) * TILE_H,
    };
  }
}

const rectOf = ({ x, y }) =>
  [
    [x + TILE_INSET, ATLAS_W],
    [y + TILE_INSET, ATLAS_H],
    [x + TILE_W - TILE_INSET, ATLAS_W],
    [y + TILE_H - TILE_INSET, ATLAS_H],
  ].map(([edge, whole]) => edge / whole);

export function buildEmblemAtlas(pictures) {
  if (!pictures.length) return null;
  const opened = openCanvas();
  if (!opened) return null;
  const { canvas, ctx } = opened;
  Object.assign(canvas, { width: ATLAS_W, height: ATLAS_H });
  const rects = new Map();
  for (const cell of cells(pictures)) {
    ctx.drawImage(cell.image, cell.x, cell.y, TILE_W, TILE_H);
    rects.set(cell.asset, rectOf(cell));
  }
  return { texture: Object.assign(new THREE.CanvasTexture(canvas), ATLAS_TEXTURE), rects };
}

// ---------- хук текстур ----------

const ATLAS_RELEASE_MS = 500;

// Картинка через <img>: временный адрес объекта отзывается в любом исходе.
function viaImage(blob) {
  return new Promise((resolve) => {
    const address = URL.createObjectURL(blob);
    const picture = new Image();
    const settle = (outcome) => {
      URL.revokeObjectURL(address);
      resolve(outcome);
    };
    picture.onload = () => settle(picture);
    picture.onerror = () => settle(null);
    picture.src = address;
  });
}

// Способы разобрать картинку сразу до плитки; следующий берётся при отказе.
const DECODERS = [
  async (blob) => {
    if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap недоступен");
    return createImageBitmap(blob, TILE_RESIZE);
  },
  viaImage,
];

async function decode(blob) {
  for (const decoder of DECODERS) {
    try {
      return await decoder(blob);
    } catch {
      // формат, который растр не берёт: пробуем следующий способ
    }
  }
  return null;
}

const readBlob = async (key) => {
  try {
    return await getWorkshopAsset(key);
  } catch {
    return null;
  }
};

async function loadTile(key, cancelled) {
  const blob = await readBlob(key);
  if (!blob || cancelled()) return null;
  const image = await decode(blob);
  if (!cancelled()) return image;
  image?.close?.();
  return null;
}

// Один прогон сборки атласа для набора ключей; stop снимает прежний атлас позже.
class AtlasRun {
  constructor(signature, publish) {
    this.keys = signature ? signature.split("|") : [];
    this.publish = publish;
    this.gate = new AbortController();
    this.texture = null;
  }

  get stale() {
    return this.gate.signal.aborted;
  }

  start() {
    if (!this.keys.length) {
      this.publish(new Map());
      return this;
    }
    Promise.all(this.keys.map((key) => loadTile(key, () => this.stale))).then((tiles) => this.land(tiles));
    return this;
  }

  land(tiles) {
    if (this.stale) {
      tiles.forEach((image) => image?.close?.());
      return;
    }
    const pictures = this.keys.reduce(
      (acc, asset, at) => (tiles[at] ? [...acc, { asset, image: tiles[at] }] : acc),
      [],
    );
    const atlas = buildEmblemAtlas(pictures);
    pictures.forEach(({ image }) => image.close?.());
    this.texture = atlas?.texture ?? null;
    const { texture } = this;
    this.publish(new Map([...(atlas?.rects ?? [])].map(([asset, rect]) => [asset, { texture, rect }])));
  }

  stop() {
    this.gate.abort();
    const { texture } = this;
    // прежний атлас снимаем не сразу: кадр не должен остаться без текстуры
    if (texture) window.setTimeout(() => texture.dispose(), ATLAS_RELEASE_MS);
  }
}

export function useEmblemTextures(items) {
  const [textures, setTextures] = useState(() => new Map());
  const signature = emblemAssets(items ?? []).join("|");
  useEffect(() => {
    const run = new AtlasRun(signature, setTextures).start();
    return () => run.stop();
  }, [signature]);
  return textures;
}

// ---------- наклейки для шейдера ----------

const decalWorld = (decal) => {
  const world = new THREE.Matrix4();
  world.set(...[].concat(...decalMatrixRows(decal)));
  return world;
};

export function emblemDecalLooks(decals, textures, keep = null) {
  const looks = [];
  for (const decal of decals) {
    const entry = textures.get(decal.asset);
    if (!entry) continue;
    if (keep && !keep(decal)) continue;
    looks.push({
      texture: entry.texture,
      rect: entry.rect,
      world: decalWorld(decal),
      opacity: decal.opacity,
    });
  }
  return looks;
}
