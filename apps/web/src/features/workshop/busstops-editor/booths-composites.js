/*
 * Составные листы кадра «Будок»: своя картинка надписи «24 HRS.» и «PARKING»
 * и листков NOTICE и WARNING — в острова своего места листа декалей.
 *
 * Лист собирается той же функцией, что и в установщике
 * (`placeImageInIslands` из `arena-slots.js`): основа — штатный лист игры
 * игрока (его читает Astral Desktop), сверху — картинка в острова места с её
 * способом вписать, размером и фоном. Что видно в кадре, то и уедет в игру.
 * Без Astral Desktop листа игры нет — основа рисуется средними цветами мест
 * листа (подпись кадра об этом говорит).
 *
 * Основа и картинки читаются один раз на окно и держатся пикселями: смена
 * размера или фона пересобирает только составной лист, а не читает игру
 * заново. Устройство то же, что у `atms-composites.js`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { atmSurfaceHasPicture, atmSurfaceTransform } from "@modovik/climb-contract/recolor/atms";
import { BOOTHS_INVENTORY, boothLookOf, normalizeBooths } from "@modovik/climb-contract/recolor/busstop-booths";
import { normalizeFinishImage } from "@modovik/climb-contract/recolor/finish";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";
import { composeSheetsAsync } from "../model-stage/sheet-compose-client.js";
import { imageBlobPixels } from "../hangar-editor/hangar-emblem.js";

const IMAGE_SIDE = 1024;
const SHEET_SIDE = 512;

function context2d(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    return canvas.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/** Картинки по местам листов работы: `[{ key, type, sheet, entry, layers }]`. */
export function boothPictureJobs(input) {
  const booths = normalizeBooths(input);
  const jobs = [];
  for (const type of BOOTHS_INVENTORY.types) {
    const look = boothLookOf(booths, type.id);
    for (const sheet of type.sheets) {
      const layers = sheet.areas
        .filter((area) => area.part && atmSurfaceHasPicture(look.parts[area.part]))
        .map((area) => ({ islands: area.islands || [], asset: normalizeFinishImage(look.parts[area.part].image).asset, transform: atmSurfaceTransform(look.parts[area.part]) }))
        .filter((layer) => layer.asset);
      if (layers.length) jobs.push({ key: `${type.id}:${sheet.name}`, type, sheet, entry: { game: type.at, texture: sheet.name }, layers });
    }
  }
  return jobs;
}

/* Пиксели своей картинки из хранилища окна (кэш окна): разбор и чтение — в фоновом потоке (`imageBlobPixels`), без него — здесь. */
const pictures = new Map();
function assetPixels(asset) {
  if (pictures.has(asset)) return pictures.get(asset);
  const pending = (async () => {
    const blob = await getWorkshopAsset(asset).catch(() => null);
    if (!blob) return null;
    const off = await imageBlobPixels(blob, IMAGE_SIDE);
    if (off) return off;
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (!bitmap) return null;
    const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = context2d(width, height);
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return { rgba: context.getImageData(0, 0, width, height).data, width, height };
  })();
  pictures.set(asset, pending);
  pending.then((value) => !value && pictures.delete(asset));
  return pending;
}

/* Основа листа пикселями: лист игры или средние цвета мест (без Astral Desktop). */
const bases = new Map();
function basePixels(job) {
  const key = `${textureKey(job.entry, SHEET_SIDE)}|${job.sheet.width}x${job.sheet.height}`;
  if (bases.has(key)) return bases.get(key);
  const pending = (async () => {
    const image = await loadSceneImage(job.entry, SHEET_SIDE).catch(() => null);
    const width = image?.width || job.sheet.width;
    const height = image?.height || job.sheet.height;
    const context = context2d(width, height);
    if (!context) return null;
    if (image) context.drawImage(image, 0, 0, width, height);
    else
      for (const area of [...job.sheet.areas].reverse()) {
        const rect = area.rect || [0, 0, 1, 1];
        context.fillStyle = area.colour || "#808080";
        context.fillRect(rect[0] * width, rect[1] * height, (rect[2] - rect[0]) * width, (rect[3] - rect[1]) * height);
      }
    return { rgba: context.getImageData(0, 0, width, height).data, width, height, real: Boolean(image) };
  })();
  bases.set(key, pending);
  pending.then((value) => !value?.real && bases.delete(key));
  return pending;
}

function textureOf(rgba, width, height) {
  const context = context2d(width, height);
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const texture = new THREE.CanvasTexture(context.canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Составные листы работы: `Map` `<будка>:<лист>` → текстура кадра. */
export function useBoothComposites(project) {
  const jobs = useMemo(() => boothPictureJobs(project?.booths ?? project), [project]);
  const key = JSON.stringify(jobs.map((job) => [job.key, job.layers]));
  const [composites, setComposites] = useState(() => new Map());
  const made = useRef(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      /* Листы собирает фоновый поток (`composeSheetsAsync`, как у арены): картинка в острова — построчный разбор. */
      const keys = [];
      const work = [];
      for (const job of jobs) {
        const base = await basePixels(job);
        if (cancelled) return;
        if (!base) continue;
        const ops = [];
        for (const layer of job.layers) {
          const image = await assetPixels(layer.asset);
          if (cancelled) return;
          if (image) ops.push({ op: "image", islands: layer.islands, image, transform: layer.transform });
        }
        keys.push(job.key);
        work.push({ base, ops });
      }
      const sheets = await composeSheetsAsync(work);
      if (cancelled) return;
      const next = new Map();
      sheets.forEach((sheet, index) => {
        const texture = textureOf(sheet.rgba, sheet.width, sheet.height);
        if (texture) next.set(keys[index], texture);
      });
      if (cancelled) {
        for (const texture of next.values()) texture.dispose();
        return;
      }
      for (const texture of made.current.values()) texture.dispose();
      made.current = next;
      setComposites(next);
    })();
    return () => {
      cancelled = true;
    };
    // Пересборка — по ключу картинок работы, а не по каждому новому массиву.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      for (const texture of made.current.values()) texture.dispose();
      made.current = new Map();
    },
    [],
  );
  return composites;
}
