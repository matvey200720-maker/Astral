/*
 * Флаг в окне: лист вида в облике работы и развевающееся полотнище кадра.
 *
 * Лист — той же функцией, что у установщика (`paintFlagSheet` договора):
 * основа — лист игры игрока (`loadSceneImage`, читает Astral Desktop), на
 * нём — флаг страны или своя картинка. Что видно на полотнище, то и уедет в
 * игру (лист в игре — штатного размера, 256 × 128).
 *
 * Развевается полотнище в кадре волной по полоскам листа — это постановка, а
 * не ткань игры: в игре флаг развевает её ветер, своей физикой фрагмента.
 *
 * Пиксели (лист игры, своя картинка) живут здесь, в кэше окна, а не в
 * состоянии React: наружу уходят только готовые холсты.
 */

import { useEffect, useState } from "react";
import { FLAG_CLOTH_ASPECT, flagLookDraws, flagLookIsStock, normalizeFlagLook, paintFlagSheet } from "@modovik/climb-contract/recolor/flags";
import { createPicture, drawCountryFlag } from "@modovik/climb-contract/recolor/flag-art";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";

/* Своей картинке на полотнище 256 × 128 хватает 1024 px по длинной стороне. */
const IMAGE_SIDE = 1024;

/*
 * Виды игры, похожие на флаги стран из шаблонов: пока лист игры не прочитан
 * (браузер без Astral Desktop, обложка), «Как в игре» у них рисуется флагом
 * страны — приблизительно, о чём говорит подпись кадра.
 */
export const KIND_LOOKALIKE = Object.freeze({ us: "us", canada: "ca", uk: "gb", russia: "ru", mexico: "mx", france: "fr", japan: "jp", german: "de" });

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/* Лист игры вида пикселями — или `null` (браузер без Astral Desktop). */
const originals = new Map();
export function gameSheet(kind) {
  if (originals.has(kind.id)) return originals.get(kind.id);
  const pending = (async () => {
    const file = kind.files[0];
    const image = await loadSceneImage({ game: file.at, texture: kind.sheet }, Math.max(kind.width, kind.height)).catch(() => null);
    if (!image) return null;
    const context = context2d(canvasOf(kind.width, kind.height));
    if (!context) return null;
    context.drawImage(image, 0, 0, kind.width, kind.height);
    return { rgba: context.getImageData(0, 0, kind.width, kind.height).data, width: kind.width, height: kind.height };
  })();
  originals.set(kind.id, pending);
  pending.then((value) => !value && originals.delete(kind.id));
  return pending;
}

/* Своя картинка пикселями (кэш окна по ключу хранилища). */
const assets = new Map();
export function imagePixels(asset) {
  if (!asset) return Promise.resolve(null);
  if (assets.has(asset)) return assets.get(asset);
  const pending = (async () => {
    const blob = await getWorkshopAsset(asset).catch(() => null);
    if (!blob || typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (!bitmap) return null;
    const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = context2d(canvasOf(width, height));
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { rgba: context.getImageData(0, 0, width, height).data, width, height };
  })();
  assets.set(asset, pending);
  pending.then((value) => !value && assets.delete(asset));
  while (assets.size > 8) assets.delete(assets.keys().next().value);
  return pending;
}

/* Лист без листа игры: похожий флаг страны или средний цвет листа. */
function stand(kind) {
  const country = KIND_LOOKALIKE[kind.id];
  if (country) return drawCountryFlag(createPicture(kind.width, kind.height), country, [0, 0, kind.width, kind.height], FLAG_CLOTH_ASPECT).rgba;
  const picture = createPicture(kind.width, kind.height, kind.colour || "#808080");
  return picture.rgba;
}

/**
 * Лист вида в облике: `{ rgba, real }` — `real`, если основой был лист игры.
 * Своей картинки нет в хранилище — на полотнище её нет и в кадре.
 */
export function flagSheetPixels(kind, input, { original = null, image = null } = {}) {
  const look = normalizeFlagLook(input);
  const width = kind.width;
  const height = kind.height;
  const painted = paintFlagSheet({ original: original?.rgba || null, width, height, look, image });
  if (painted) return { rgba: painted, real: Boolean(original) };
  /* «Как в игре» без листа игры: приблизительно, с тоном облика. */
  const base = stand(kind);
  const toned = flagLookIsStock(look) ? base : paintFlagSheet({ original: base, width, height, look: { ...look, mode: "standard" } }) || base;
  return { rgba: toned, real: false };
}

function sheetCanvas(rgba, width, height) {
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context || typeof ImageData === "undefined") return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}

/**
 * Лист вида в облике работы холстом: `{ canvas, real, missing }`. `game` —
 * читать ли лист игры (кадр — да, обложка — нет: полке хватает похожего).
 */
export function useFlagSheet(kind, look, { game = true } = {}) {
  const [sheet, setSheet] = useState({ canvas: null, real: false, missing: false });
  const asset = look?.mode === "image" ? look.image?.asset || "" : "";
  const key = JSON.stringify(look || {});
  useEffect(() => {
    if (!kind) return undefined;
    let cancelled = false;
    (async () => {
      const normal = normalizeFlagLook(look);
      /* Лист игры нужен «Как в игре» и рукаву у древка своего рисунка. */
      const original = game ? await gameSheet(kind) : null;
      const image = asset ? await imagePixels(asset) : null;
      if (cancelled) return;
      const missing = Boolean(asset) && !image;
      const shown = missing ? { ...normal, mode: "standard" } : normal;
      const { rgba, real } = flagSheetPixels(kind, shown, { original, image });
      setSheet({ canvas: sheetCanvas(rgba, kind.width, kind.height), real, missing, draws: flagLookDraws(shown) });
    })();
    return () => {
      cancelled = true;
    };
    /* Облик сравнивается строкой: та же работа — тот же лист. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, asset, game]);
  return sheet;
}

/* Миниатюры флагов стран: адрес картинки (кэш окна), `""` без холста. */
const thumbs = new Map();
export function countryThumb(id, width = 152, height = 80) {
  const key = `${id}@${width}x${height}`;
  if (thumbs.has(key)) return thumbs.get(key);
  let url = "";
  try {
    const picture = drawCountryFlag(createPicture(width, height), id, [0, 0, width, height], FLAG_CLOTH_ASPECT);
    const canvas = sheetCanvas(picture.rgba, width, height);
    url = canvas?.toDataURL?.("image/png") || "";
  } catch {
    url = "";
  }
  if (url) thumbs.set(key, url);
  return url;
}

/* ------------------------------------------------------------------ *
 * Развевающееся полотнище
 * ------------------------------------------------------------------ */

/** Где в кадре древко и полотнище: середина кадра с полями. */
export function flagLayout(width, height) {
  const clothWidth = Math.min(width * 0.64, height * 0.56 * FLAG_CLOTH_ASPECT);
  const clothHeight = clothWidth / FLAG_CLOTH_ASPECT;
  const pole = Math.max(3, clothWidth * 0.018);
  const left = (width - clothWidth) / 2 + pole;
  const top = height * 0.46 - clothHeight / 2;
  return { left, top, clothWidth, clothHeight, pole, poleTop: top - clothHeight * 0.14, ground: height * 0.95 };
}

/**
 * Кадр полотнища на древке: `sheet` — холст листа, `time` — секунды. Волна
 * бежит от древка к свободному краю, у древка ткань неподвижна; свет и тень —
 * по наклону ткани. Полоски листа рисуются с нахлёстом, без щелей.
 */
export function drawWavingFlag(context, sheet, { width, height, time = 0 }) {
  const { left, top, clothWidth, clothHeight, pole, poleTop, ground } = flagLayout(width, height);
  context.clearRect(0, 0, width, height);
  /* Древко — металл, шар сверху. */
  const metal = context.createLinearGradient(left - pole * 2, 0, left, 0);
  metal.addColorStop(0, "#5d6168");
  metal.addColorStop(0.45, "#d8dadd");
  metal.addColorStop(1, "#7b7f86");
  context.fillStyle = metal;
  context.fillRect(left - pole * 1.6, poleTop, pole * 1.4, ground - poleTop);
  context.beginPath();
  context.arc(left - pole * 0.9, poleTop, pole * 1.25, 0, Math.PI * 2);
  context.fill();
  if (!sheet) return;
  const strips = Math.max(32, Math.round(clothWidth / 3));
  const source = sheet.width / strips;
  const step = clothWidth / strips;
  for (let index = 0; index < strips; index += 1) {
    const u = (index + 0.5) / strips;
    const phase = Math.PI * 2 * 1.35 * u - time * 2.6;
    const swing = clothHeight * 0.075 * u ** 1.15;
    const near = 1 + 0.045 * u * Math.cos(phase);
    const h = clothHeight * near;
    /* Края полосок — по целым пикселям: без щелей и без двойной тени на стыке. */
    const x = Math.round(left + index * step);
    const w = Math.round(left + (index + 1) * step) - x;
    const y = top + swing * Math.sin(phase) + clothHeight * 0.03 * u * u - (h - clothHeight) / 2;
    if (w <= 0) continue;
    context.drawImage(sheet, index * source, 0, source, sheet.height, x, y, w, h);
    const slope = Math.cos(phase) * Math.min(1, u * 4);
    context.fillStyle = slope > 0 ? `rgba(255, 255, 255, ${0.16 * slope})` : `rgba(0, 0, 0, ${0.3 * -slope})`;
    context.fillRect(x, y, w, h);
  }
}
