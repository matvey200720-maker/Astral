import { useEffect, useRef, useState } from "react";
import { perfTimed } from "../../../perf-count.js";
import { islandFilm, renderIslandPixels } from "./world-map-island.js";

/*
 * Растр острова Кайо-Перико для основной карты (задача 42Б, 20.10.2026).
 *
 * Остров — векторный фильм игры, а карта штата рисует слои SVG: фильм превращается в картинку на прозрачном фоне
 * по всей сцене острова (2000×2000 пикселей сцены, один пиксель — одна игровая единица) и ложится слоем окна на
 * своё место в мире (islandAtlasRect). Цвета — pairs, в которые карта красит остров; без пар — штатные.
 *
 * Фильм рисуется заново, только когда поменялись цвета, и после паузы SETTLE_MS: ползунок цвета не пересчитывает
 * остров на каждый шаг. Адрес картинки — адрес объекта (blob:), старый освобождается.
 */

/** Точек картинки на пиксель сцены фильма: 1 — как у плиток штата (одна точка на игровую единицу). */
export const ISLAND_RASTER_SCALE = 1;
/** Сторона сцены острова, пикселей фильма. */
const SCENE_SIDE = 2000;
/** Пауза после правки цвета перед пересчётом острова, мс. */
const SETTLE_MS = 180;

function canvasBlob(canvas) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") return resolve(null);
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * @param {Uint8Array|null} gfx чистый фильм острова из игры (useIslandMap)
 * @param {string[]} pairs пары «было=стало», в которые карта красит остров
 * @returns {string} адрес картинки острова или пустая строка, пока её нет
 */
export function useIslandLayer(gfx, pairs) {
  const [href, setHref] = useState("");
  const current = useRef("");
  const key = Array.isArray(pairs) ? pairs.join("|") : "";
  useEffect(() => {
    if (!gfx || typeof document === "undefined") return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const island = islandFilm(gfx, pairs);
      if (!island) return;
      const side = Math.round(SCENE_SIDE * ISLAND_RASTER_SCALE);
      const pixels = perfTimed("map.island.raster", () =>
        renderIslandPixels(island, { width: side, height: side, scale: ISLAND_RASTER_SCALE, centre: { x: 0, y: 0 }, sea: null }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d");
      if (!context || typeof ImageData === "undefined") return;
      context.putImageData(new ImageData(pixels, side, side), 0, 0);
      const blob = await canvasBlob(canvas);
      if (cancelled || !blob || typeof URL?.createObjectURL !== "function") return;
      const next = URL.createObjectURL(blob);
      const previous = current.current;
      current.current = next;
      setHref(next);
      if (previous) URL.revokeObjectURL(previous);
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- цвета — по ключу, а не по новому массиву с теми же парами
  }, [gfx, key]);
  /* Окно закрыто — картинка острова не нужна. */
  useEffect(
    () => () => {
      if (current.current && typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(current.current);
      current.current = "";
    },
    [],
  );
  return gfx ? href : "";
}
