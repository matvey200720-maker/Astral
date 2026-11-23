/*
 * Облик своих моделей для 3D-кадра (задача 1 ТЗ 11.10.2026, вечер).
 *
 * Модели работы → то, что рисует слой моделей кадра (`place-models-layer.js`):
 * единичная сетка той же функцией, что у установщика (`placeModelUnitMesh`),
 * лист картинки, движение (`placeModelMotion`). Картинки и сетки читаются из
 * хранилища окна один раз на сеанс (кэш по ключу).
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { arenaStarModel } from "@modovik/climb-contract/recolor/arena-star";
import {
  placeModelCellPixels,
  placeModelMotion,
  placeModelSceneRules,
  placeModelSolid,
  placeModelUnitMesh,
} from "@modovik/climb-contract/recolor/place-models";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { loadPlaceMesh } from "./model-assets.js";

/* Сторона пикселей для «Объёма»: маске хватает 512 px (клеток у неё до 96). */
const PIXEL_SIDE = 512;

const pictures = new Map();

async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* ниже — через <img> */
    }
  }
  if (typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Картинка из хранилища: `{ texture, rgba, width, height, alpha }` или `null`.
 * Лист — сверху вниз, как листы игры (`flipY = false`).
 */
export function loadModelPicture(asset) {
  if (!asset) return Promise.resolve(null);
  if (pictures.has(asset)) return pictures.get(asset);
  const pending = getWorkshopAsset(asset)
    .then(async (blob) => {
      if (!blob) return null;
      const image = await decode(blob);
      if (!image) return null;
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      const scale = Math.min(
        1,
        PIXEL_SIDE / Math.max(naturalWidth, naturalHeight),
      );
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      let context = null;
      try {
        context = canvas.getContext("2d", { willReadFrequently: true });
      } catch {
        context = null;
      }
      let rgba = null;
      let alpha = false;
      if (context) {
        context.drawImage(image, 0, 0, width, height);
        rgba = context.getImageData(0, 0, width, height).data;
        for (let at = 3; at < rgba.length; at += 4)
          if (rgba[at] < 250) {
            alpha = true;
            break;
          }
      }
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return { texture, rgba, width, height, alpha };
    })
    .catch(() => null);
  pictures.set(asset, pending);
  return pending;
}

/* Что задаёт сетку модели: сменилось — сетка новая. */
export const placeModelGeometryKey = (item) =>
  [
    item.shape,
    item.asset,
    item.shape === "solid" ? item.depth : "",
    item.shape === "plate" ? `${item.width}x${item.height}` : "",
    item.texture || "",
    /* Живая картинка: развёртка смотрит в первую клетку своей сетки кадров. */
    item.animation ? `${item.animation.columns}x${item.animation.rows}` : "",
  ].join("|");

/**
 * Облик моделей сцены `scene` для кадра: `[{ id, key, unit, texture, alpha,
 * shape, position, rotation, size, opacity, glow, motion }]`. Скрытые и
 * модели других сцен в кадр не идут; модель, чьи файлы ещё читаются, —
 * следом, как только прочтутся.
 */
export function usePlaceModelLooks(models, scene = "") {
  const shown = useMemo(
    () =>
      (models || []).filter(
        (item) =>
          !item.hidden && (!scene || !item.scene || item.scene === scene),
      ),
    [models, scene],
  );
  const [sources, setSources] = useState(() => new Map());
  const wanted = useMemo(() => {
    const keys = new Set();
    for (const item of shown) {
      if (item.shape === "mesh") {
        keys.add(item.asset);
        if (item.texture) keys.add(item.texture);
      } else keys.add(item.asset);
    }
    return [...keys].sort().join(",");
  }, [shown]);

  useEffect(() => {
    let cancelled = false;
    const keys = wanted ? wanted.split(",") : [];
    Promise.all(
      keys.map(async (asset) => [
        asset,
        asset.startsWith("place-model:")
          ? await loadPlaceMesh(asset).catch(() => null)
          : await loadModelPicture(asset),
      ]),
    ).then((entries) => {
      if (!cancelled) setSources(new Map(entries.filter(([, value]) => value)));
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  /* Сетки «Объёма» считаются раз на картинку и толщину. */
  const solids = useMemo(() => new Map(), []);
  return useMemo(() => {
    const out = [];
    for (const item of shown) {
      const rules = placeModelSceneRules(item.scene || scene);
      const picture =
        sources.get(item.shape === "mesh" ? item.texture : item.asset) || null;
      let unit = null;
      if (item.shape === "mesh")
        unit = placeModelUnitMesh(item, {
          mesh: sources.get(item.asset) || null,
        });
      else if (item.shape === "solid") {
        const key = `${item.asset}|${item.depth}`;
        if (!solids.has(key) && picture?.rgba)
          solids.set(
            key,
            placeModelSolid(
              arenaStarModel,
              picture.rgba,
              picture.width,
              picture.height,
              item.depth,
            ),
          );
        unit = solids.get(key) || null;
      } else
        unit = placeModelUnitMesh(item, {
          cell: placeModelCellPixels(item.animation, picture),
        });
      if (!unit) continue;
      out.push({
        id: item.id,
        key: placeModelGeometryKey(item),
        unit,
        texture: picture?.texture || null,
        /* Лист с прозрачностью — прозрачный и у сетки (стекло «Цвета», своя модель с вырезом): установщик тогда же берёт шейдер `alpha`. */
        alpha:
          Boolean(picture?.alpha) &&
          (item.shape === "plate" || item.shape === "solid" || item.shape === "mesh"),
        shape: item.shape,
        position: item.position,
        rotation: item.rotation,
        normal: item.normal || [0, 0, 1],
        size: item.size,
        opacity: item.opacity,
        glow: item.glow,
        /* В зале Majestic модель стоит и живая картинка — первым кадром: так её покажет игра. */
        motion: rules.motion ? placeModelMotion(item) : placeModelMotion(null),
        animation: rules.animation ? item.animation || null : null,
      });
    }
    return out;
  }, [shown, sources, solids, scene]);
}
