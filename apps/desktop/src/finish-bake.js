/*
 * Отделка поверхности в пикселях листа — общая сборка «Ангара» и «Завода».
 *
 * Та же арифметика, что у шейдера кадра (`recolor-material.js`), и те же
 * функции узора, градиента и подкраски (`@modovik/climb-contract/recolor/
 * finish`), поэтому в игре ровно то, что было в кадре:
 *
 *   по листу (завод) — плитка отделки повторена `finishRepeats` раз по
 *     развёртке, как игра повторяет лист по модели;
 *   по стенам (ангар) — точка стены → плоскость её грани (`boxProjection`):
 *     узор — метрами, картинка «растянуть» — на всю стену.
 *
 * Светотень основы (тени, швы, грязь листа) остаётся долей `shade`:
 * отделка × яркость основы / опорная яркость, как `rcBase` в шейдере.
 */

import sharp from "sharp";
import { gifSurfaceFrame } from "@modovik/climb-contract/recolor/gif-surface";
import {
  boxProjection,
  finishWallMetres,
  finishRepeats,
  gradientTile,
  normalizeFinishImage,
  patternTile,
  sampleImage,
  sampleTile,
  tintImagePixels,
} from "@modovik/climb-contract/recolor/finish";

const PATTERN_TILE = 512;
const GRADIENT_TILE = 256;
const IMAGE_SIDE = 2048;
const IMAGE_BYTES = 8 * 1024 * 1024;

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Цвет под полностью прозрачным пикселем — чёрный, как в кадре окна.
 * Окно рисует картинку холстом (`finish-textures.js`, `drawImage` +
 * `getImageData`): холст хранит цвета с умножением на альфу, и у пикселя с
 * альфой 0 цвета не остаётся, шейдер кадра берёт один `rgb` — прозрачный фон
 * в кадре чёрный. Файл PNG хранит под прозрачным то, что записал редактор
 * (чаще всего белый): без этой правки лист в игре белел там, где кадр темнел
 * («картинка на рекламе остановки не встала, панель белая», 10.11.2026).
 * Альфа остаётся как была; лист без прозрачных пикселей не меняется.
 */
export function blackUnderTransparent(rgba) {
  for (let at = 0; at + 3 < rgba.length; at += 4) if (rgba[at + 3] === 0) rgba[at] = rgba[at + 1] = rgba[at + 2] = 0;
  return rgba;
}

/**
 * Картинки отделки из окна: `{ [ключ]: { data: base64 } }` → ключ →
 * `{ rgba, width, height }` (не больше 2048 px). Лишние не читаются, нужная,
 * но пропавшая — отказ словами.
 */
export async function decodeFinishImages(assets, payload = {}) {
  const out = new Map();
  for (const asset of assets) {
    const data = typeof payload?.[asset]?.data === "string" ? payload[asset].data : "";
    if (!data) throw new Error("Своя картинка отделки не пришла — выберите её ещё раз.");
    if (data.length > Math.ceil(IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new RangeError("Своя картинка не читается или больше 8 МБ.");
    let decoded;
    try {
      decoded = await sharp(Buffer.from(data, "base64"), { failOn: "error", limitInputPixels: 64 * 1024 * 1024 })
        .rotate()
        .resize(IMAGE_SIDE, IMAGE_SIDE, { fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new RangeError("Своя картинка — не картинка (нужны PNG, JPEG или WebP).");
    }
    const { data: pixels, info } = decoded;
    out.set(asset, { rgba: blackUnderTransparent(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length)), width: info.width, height: info.height });
  }
  return out;
}

/**
 * Источник отделки: плитка и как её брать. `images` — ключ → картинка.
 * `{ rgba, width, height, wrap, repeats }`.
 */
export function finishSource(settings, images = new Map()) {
  if (settings.mode === "pattern")
    return { rgba: patternTile(settings.pattern, PATTERN_TILE), width: PATTERN_TILE, height: PATTERN_TILE, wrap: true, kind: "pattern" };
  if (settings.mode === "gradient")
    return { rgba: gradientTile(settings.gradient, GRADIENT_TILE), width: GRADIENT_TILE, height: GRADIENT_TILE, wrap: false, kind: "gradient" };
  if (settings.mode === "image") {
    const image = normalizeFinishImage(settings.image);
    const sheet = image.asset ? images.get(image.asset) : null;
    if (!sheet) throw new Error("Своя картинка отделки не пришла — выберите её ещё раз.");
    /* Гифка: на листе лежит первый кадр, остальные играет плашка. */
    const decoded = image.animation ? gifSurfaceFrame(sheet, image.animation, 0) : sheet;
    return {
      rgba: tintImagePixels(decoded.rgba, image),
      width: decoded.width,
      height: decoded.height,
      wrap: image.fit === "tile",
      kind: "image",
      fit: image.fit,
      scale: image.scale,
    };
  }
  return null;
}

/** Средний цвет источника отделки (`#rrggbb`) — облик дальнего листа: с сотни метров узор не различить. */
export function finishMeanColour(source) {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = source.rgba.length / 4;
  for (let at = 0; at < source.rgba.length; at += 4) {
    r += source.rgba[at];
    g += source.rgba[at + 1];
    b += source.rgba[at + 2];
  }
  return `#${[r, g, b].map((value) => Math.round(value / count).toString(16).padStart(2, "0")).join("")}`;
}

/* Цвет источника в точке плитки (s, t: t сверху вниз, как у строк картинки). */
function sourceColour(source, s, t) {
  if (source.width === source.height && source.kind !== "image") {
    const clampS = source.wrap ? s : Math.min(0.999, Math.max(0, s));
    const clampT = source.wrap ? t : Math.min(0.999, Math.max(0, t));
    return sampleTile(source.rgba, source.width, clampS, clampT);
  }
  return sampleImage(source.rgba, source.width, source.height, s, 1 - t, source.wrap);
}

/* Смесь со светотенью основы — `rcBase` шейдера. */
function shaded(colour, base, share, ref) {
  const factor = 1 + (Math.min(1.6, Math.max(0, luma(base[0], base[1], base[2]) / Math.max(0.02, ref))) - 1) * share;
  return [0, 1, 2].map((channel) => Math.min(255, Math.max(0, colour[channel] * factor)));
}

/** Средняя яркость листа — опора светотени (как средний цвет листа в кадре). */
export function sheetReference(rgba) {
  let sum = 0;
  const count = rgba.length / 4;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    r += rgba[at];
    g += rgba[at + 1];
    b += rgba[at + 2];
  }
  sum = luma(r / count, g / count, b / count);
  return Math.max(0.05, sum);
}

/**
 * Отделка по листу (завод): `base` — первый уровень листа RGBA `width ×
 * height`, `settings` — группа работы. Новый первый уровень; альфа — листа.
 * `shade` — множитель светотени (ржавые листы: ржавчина — перепады яркости,
 * их тянет слабее).
 */
export function bakeSheetFinish(base, width, height, settings, source, { ref = sheetReference(base), shade = 1 } = {}) {
  const out = new Uint8ClampedArray(base.length);
  const repeats = finishRepeats(settings);
  const share = (settings.shade / 100) * shade;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const colour = sourceColour(source, u * repeats, v * repeats);
      const next = shaded(colour, [base[at], base[at + 1], base[at + 2]], share, ref);
      out[at] = next[0];
      out[at + 1] = next[1];
      out[at + 2] = next[2];
      out[at + 3] = base[at + 3];
    }
  return out;
}

/**
 * Отделка по стенам (ангар): тексели листа с меткой `label` (карта
 * `surface.labels`) получают отделку по своей точке и нормали
 * (`surface.positions`, `surface.normals`); `box` — рамка поверхности;
 * `metres` — свой размер плитки (штатный лист «Стандарта GTA»), иначе — по
 * настройкам отделки. Правит `rgba` на месте.
 */
export function bakeWallFinish(rgba, width, height, surface, label, settings, source, { box, ref, metres: tile = null }) {
  const share = settings.shade / 100;
  const metres = tile ?? finishWallMetres(settings);
  const point = [0, 0, 0];
  const normal = [0, 0, 0];
  for (let index = 0; index < width * height; index += 1) {
    if (surface.labels[index] !== label) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      point[axis] = surface.positions[index * 3 + axis];
      normal[axis] = surface.normals[index * 3 + axis];
    }
    const [s, t] = boxProjection(point, normal, box, metres ? { fit: "metres", metres } : { fit: "stretch" });
    const colour = sourceColour(source, s, 1 - t);
    const at = index * 4;
    const next = shaded(colour, [rgba[at], rgba[at + 1], rgba[at + 2]], share, ref);
    rgba[at] = next[0];
    rgba[at + 1] = next[1];
    rgba[at + 2] = next[2];
  }
  return rgba;
}
