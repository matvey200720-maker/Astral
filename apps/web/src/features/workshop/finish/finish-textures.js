/*
 * Отделка поверхности как текстура 3D-кадра.
 *
 * Плитка узора и полоса градиента считаются теми же функциями, что пишет в
 * листы установщик (`@modovik/climb-contract/recolor/finish`), своя картинка
 * подкрашивается той же `tintImagePixels`: в кадре ровно то, что уедет в
 * игру. Текстура кэшируется на окно по отпечатку отделки: плитки готовых
 * видов, кадр и обложка делят одну.
 */

import { useMemo } from "react";
import * as THREE from "three";
import {
  gradientTile,
  normalizeFinishImage,
  patternTile,
  tintImagePixels,
} from "@modovik/climb-contract/recolor/finish";
import { gifSurfaceCell } from "@modovik/climb-contract/recolor/gif-surface";
import { placeModelAnimationFrameAt } from "@modovik/climb-contract/recolor/place-models";
import { useFinishImage } from "./finish-assets.js";
import { isLiveFinish, liveFinishTexture } from "./live-finish.js";

const PATTERN_SIZE = 256;
const GRADIENT_SIZE = 128;
const IMAGE_SIDE = 1024;
const CACHE_LIMIT = 48;
const cache = new Map();

function remember(key, make) {
  if (cache.has(key)) return cache.get(key);
  const value = make();
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.get(oldest)?.dispose?.();
    cache.delete(oldest);
  }
  return value;
}

function dataTexture(rgba, width, height, repeat) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Текстура узора или градиента — сразу, без ожидания (плитки, обложки). */
export function finishTextureNow(settings) {
  if (!settings) return null;
  if (settings.mode === "pattern")
    return remember(`pattern:${JSON.stringify(settings.pattern)}`, () =>
      dataTexture(patternTile(settings.pattern, PATTERN_SIZE), PATTERN_SIZE, PATTERN_SIZE, true),
    );
  if (settings.mode === "gradient")
    return remember(`gradient:${JSON.stringify(settings.gradient)}`, () =>
      dataTexture(gradientTile(settings.gradient, GRADIENT_SIZE), GRADIENT_SIZE, GRADIENT_SIZE, false),
    );
  return null;
}

/* Своя картинка, вписанная не больше 1024 px и подкрашенная. */
function imageTexture(bitmap, image) {
  const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = tintImagePixels(context.getImageData(0, 0, width, height).data, image);
  return dataTexture(pixels, width, height, image.fit === "tile");
}

/*
 * Гифка: кадр листа кадров, подкрашенный, холстом; `userData.play(секунды)`
 * меняет кадр по часам кадра сцены (`placeModelAnimationFrameAt`) — в кадре
 * играет то же, что играет плашка в игре.
 */
function animatedImageTexture(bitmap, image) {
  const first = gifSurfaceCell(image.animation, bitmap.width, bitmap.height, 0);
  const scale = Math.min(1, IMAGE_SIDE / Math.max(first.width, first.height));
  const width = Math.max(1, Math.round(first.width * scale));
  const height = Math.max(1, Math.round(first.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = 4;
  let shown = -1;
  const draw = (frame) => {
    const cell = gifSurfaceCell(image.animation, bitmap.width, bitmap.height, frame);
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, cell.x, cell.y, cell.width, cell.height, 0, 0, width, height);
    if (image.strength) context.putImageData(new ImageData(tintImagePixels(context.getImageData(0, 0, width, height).data, image), width, height), 0, 0);
    shown = frame;
    texture.needsUpdate = true;
  };
  draw(0);
  texture.userData.play = (seconds) => {
    const frame = placeModelAnimationFrameAt(image.animation, seconds);
    if (frame !== shown) draw(frame);
  };
  return texture;
}

/**
 * Текстура отделки поверхности (`settings` — группа или сторона работы)
 * или `null`: у своей картинки — когда она прочитана из хранилища.
 */
export function useFinishTexture(settings) {
  const mode = settings?.mode || "";
  const image = mode === "image" ? normalizeFinishImage(settings.image) : null;
  /* Картинка из открытой студии (`live-finish.js`): текстура холста, а не файл из хранилища. */
  const live = image?.asset && isLiveFinish(image.asset) ? image.asset : "";
  const bitmap = useFinishImage(live ? "" : image?.asset || "");
  const key =
    mode === "pattern"
      ? JSON.stringify(settings.pattern)
      : mode === "gradient"
        ? JSON.stringify(settings.gradient)
        : live
          ? live
          : mode === "image" && bitmap
            ? JSON.stringify({ asset: image.asset, tint: image.tint, strength: image.strength, fit: image.fit, animation: image.animation })
            : "";
  return useMemo(() => {
    if (live) return liveFinishTexture(live);
    if (mode === "pattern" || mode === "gradient") return finishTextureNow(settings);
    if (mode === "image" && bitmap && typeof document !== "undefined")
      return remember(`image:${key}`, () => (image.animation ? animatedImageTexture(bitmap, image) : imageTexture(bitmap, image)));
    return null;
    // Текстура меняется отпечатком отделки, а не каждой новой работой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, key, bitmap]);
}
