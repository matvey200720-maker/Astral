/*
 * Плитки укрытий: карта формы — один раз, цвет — на каждую правку.
 *
 * Растеризация шестнадцати форм занимает около десятой доли секунды, и
 * делать её одним куском значило бы уронить кадр при входе в редактор.
 * Поэтому формы растеризуются по одной в свободное время окна, а плитка,
 * до которой очередь не дошла, пока пуста. Цвет накладывается на готовую
 * карту за миллисекунду — это уже по правке.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  rasterizeWallbangShape,
  wallbangTileCanvas,
} from "./wallbang-raster.js";

const idle = (callback) =>
  typeof window !== "undefined" &&
  typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(callback, { timeout: 200 })
    : setTimeout(callback, 16);
const cancelIdle = (handle) =>
  typeof window !== "undefined" &&
  typeof window.cancelIdleCallback === "function"
    ? window.cancelIdleCallback(handle)
    : clearTimeout(handle);

/*
 * Карты форм живут весь сеанс: у одной формы и размера карта одна. Карт
 * немного — плитки, готовые наборы и обложки разных размеров, — но потолок
 * у кэша есть: самая старая уходит первой.
 */
const MAX_RASTERS = 64;
const rasters = new Map();
const rasterKey = (id, width, height, view) =>
  `${id}:${width}x${height}:${view?.yaw ?? ""}:${view?.pitch ?? ""}`;

export function cachedWallbangRaster(shape, id, { width, height, view } = {}) {
  const key = rasterKey(id, width, height, view);
  if (rasters.has(key)) return rasters.get(key);
  const raster = rasterizeWallbangShape(shape, { width, height, ...view });
  rasters.set(key, raster);
  while (rasters.size > MAX_RASTERS)
    rasters.delete(rasters.keys().next().value);
  return raster;
}

/**
 * Карты форм для набора укрытий: `Map(id → карта)`, растут по одной.
 * `shapes` — загруженные формы (`Map(id → форма)`).
 */
export function useWallbangRasters(shapes, ids, { width, height, view } = {}) {
  const [version, setVersion] = useState(0);
  const idsKey = ids.join("|");
  useEffect(() => {
    let cancelled = false;
    let handle = null;
    const queue = ids.filter(
      (id) =>
        shapes?.has(id) && !rasters.has(rasterKey(id, width, height, view)),
    );
    const step = () => {
      if (cancelled) return;
      const id = queue.shift();
      if (!id) return;
      cachedWallbangRaster(shapes.get(id), id, { width, height, view });
      setVersion((value) => value + 1);
      handle = idle(step);
    };
    if (queue.length) handle = idle(step);
    return () => {
      cancelled = true;
      if (handle !== null) cancelIdle(handle);
    };
    // Карта зависит от формы и размера, а не от каждой правки облика.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, idsKey, width, height, view?.yaw, view?.pitch]);

  return useMemo(() => {
    const ready = new Map();
    for (const id of ids) {
      const raster = rasters.get(rasterKey(id, width, height, view));
      if (raster) ready.set(id, raster);
    }
    return ready;
    // `version` — сигнал «карта дорисовалась».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, idsKey, width, height, view?.yaw, view?.pitch, shapes]);
}

/** Плитки как картинки: `Map(id → data URL)` в облике работы и времени суток. */
export function useWallbangTiles(
  shapes,
  ids,
  project,
  scene = "day",
  size = { width: 240, height: 150 },
) {
  const ready = useWallbangRasters(shapes, ids, size);
  const previous = useRef(new Map());
  return useMemo(() => {
    const tiles = new Map();
    for (const [id, raster] of ready) {
      const canvas = wallbangTileCanvas(raster, project, id, scene);
      const url = canvas?.toDataURL?.() || "";
      tiles.set(id, url || previous.current.get(id) || "");
    }
    /* Карта формы нового размера ещё не дорисовалась (очередь по одной в свободное время): плитка
       держит прежний кадр, а не гаснет. */
    for (const id of ids) if (!tiles.has(id) && previous.current.get(id)) tiles.set(id, previous.current.get(id));
    previous.current = tiles;
    return tiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- набор форм назван `ready`, а не списком `ids`
  }, [ready, project, scene]);
}
