/*
 * Картинки украшений (задача 13 ТЗ 10.10.2026; голограмма — задача 6 ТЗ
 * 11.10.2026): логотип — картинка из хранилища мастерской, голограмма — своя
 * картинка или надпись, нарисованная шрифтом мастерской. Для кадра — сама
 * картинка; для игры — PNG в квадрате 256×256, который Astral Desktop кладёт
 * в модель ствола.
 *
 * У голограммы по этому же квадрату считаются её фигура и лист
 * (`@modovik/gun-studio`): кадр берёт пиксели холста (`artworkPixels`),
 * Astral Desktop — пиксели того же PNG. Одни и те же точки — одна и та же
 * фигура в кадре и в игре.
 */

import { useEffect, useState } from "react";
import { HOLOGRAM_PNG_SIZE } from "@modovik/gun-studio";
import { prepareOwnFonts } from "../../../../features/workshop/emblem/own-font.js";
import { resolveGunImage, textArtwork } from "./gun-images.js";
import { attachedModelArtwork, attachedModelDataUrl } from "./own-model-data.js";
import { tr } from "../../../../locales/ui.js";

/* Хост вписывает логотип в 128×128: вдвое больше хватает с запасом. */
const PNG_SIZE = HOLOGRAM_PNG_SIZE;
/* Своя модель на стволе (задача 6 ТЗ 17.10.2026) — тоже «со своим файлом»: .glb вместо картинки. */
const PICTURED = new Set(["logo", "hologram", "model"]);

/** Чем рисуется украшение: адрес картинки или надпись — ключ для кэшей. */
export function artworkKey(decoration) {
  if (!PICTURED.has(decoration?.kind)) return "";
  if (decoration.source) return decoration.source;
  if (decoration.kind === "hologram" && decoration.text) return `text:${decoration.text.font}:${decoration.text.font === "custom" ? decoration.text.fontAsset : ""}:${decoration.text.value}`;
  return "";
}

/** Картинка украшения: своя картинка или надпись (холст). */
export async function decorationArtwork(decoration) {
  if (decoration?.kind === "model" && decoration.source) return attachedModelArtwork(decoration.source);
  if (decoration?.source) return resolveGunImage(decoration.source);
  if (decoration?.kind === "hologram" && decoration.text) {
    /* Свой шрифт — в набор шрифтов документа до холста: в текстуру для игры не должен лечь запасной. */
    await prepareOwnFonts(decoration.text.fontAsset);
    const canvas = textArtwork({ text: decoration.text.value, font: decoration.text.font, fontAsset: decoration.text.fontAsset });
    if (canvas) return canvas;
  }
  throw new Error(tr("У украшения нет картинки."));
}

/** Картинка целиком в квадрат 256×256, с прозрачными полями — холст. */
export function squareCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PNG_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error(tr("Окно не рисует картинку украшения."));
  const width = Number(image?.naturalWidth || image?.width) || PNG_SIZE;
  const height = Number(image?.naturalHeight || image?.height) || PNG_SIZE;
  const scale = Math.min(PNG_SIZE / width, PNG_SIZE / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  context.drawImage(image, (PNG_SIZE - w) / 2, (PNG_SIZE - h) / 2, w, h);
  return canvas;
}

/*
 * Пиксели квадрата — по картинке один раз (кэш по самой картинке: пиксели в
 * состояние React не идут, см. заметку о буферах в пропсах).
 */
const pixelCache = new WeakMap();
export function artworkPixels(image) {
  if (!image) return null;
  if (pixelCache.has(image)) return pixelCache.get(image);
  const canvas = squareCanvas(image);
  const data = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, PNG_SIZE, PNG_SIZE);
  const pixels = data ? { rgba: data.data, width: PNG_SIZE, height: PNG_SIZE } : null;
  pixelCache.set(image, pixels);
  return pixels;
}

/** PNG картинки украшения целиком (`data:image/png`). */
export async function decorationPng(decoration) {
  return squareCanvas(await decorationArtwork(decoration)).toDataURL("image/png");
}

/**
 * PNG логотипов и голограмм для установки: `{ images: { [id]: data-URL },
 * missing }` — картинки, которой нет на этом компьютере (код работы с
 * чужого), в игру не едут, и окно говорит об этом.
 */
export async function decorationImagesFor(decorations) {
  const images = {};
  const missing = [];
  for (const decoration of decorations) {
    if (!artworkKey(decoration)) continue;
    try {
      images[decoration.id] =
        decoration.kind === "model" ? await attachedModelDataUrl(decoration.source) : await decorationPng(decoration);
    } catch {
      missing.push(decoration.id);
    }
  }
  return { images, missing };
}

/** Картинки логотипов и голограмм для кадра: `Map(id → картинка)`. */
export function useDecorationImages(decorations) {
  const [images, setImages] = useState(() => new Map());
  const wanted = decorations
    .map((item) => [item, artworkKey(item)])
    .filter(([, key]) => key)
    .map(([item]) => JSON.stringify({ id: item.id, kind: item.kind, source: item.source, text: item.text }))
    .join("\n");
  useEffect(() => {
    let cancelled = false;
    const entries = wanted ? wanted.split("\n").map((line) => JSON.parse(line)) : [];
    Promise.all(
      entries.map((item) =>
        decorationArtwork(item)
          .then((image) => [item.id, image])
          .catch(() => null),
      ),
    ).then((pairs) => {
      if (!cancelled) setImages(new Map(pairs.filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return images;
}
