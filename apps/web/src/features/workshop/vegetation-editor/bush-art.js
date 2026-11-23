/*
 * Кусты в кадре «Растительности» (задача 2 ТЗ 10.10.2026, вечер): большой
 * куст `prop_bush_lrg_01` (≈ 63 тыс. по миру — вдоль дорог и в парках) и
 * высокая стриженая живая изгородь у домов Веспуччи
 * (`vb_ca_vb_hedgetallmed`, 4 м — как у особняков Рокфорд-Хиллз). Сетки — из
 * игры игрока (`scripts/prepare-bush-scene.mjs`), листы — из её же архивов
 * по адресу (у куста — в самой модели, у изгороди — словарь района), их и
 * красит установщик. Листва перекрашивается той же арифметикой, что у
 * установщика (`recolourLeafLevel`, `bushLeafParams`): цвет, эффект, у «как
 * листва» — и густота деревьев. Считает её поток (`leaf-recolour.js`, ТЗ
 * 22.10.2026, п. 6): лист 512×512 стоил ~27 мс главного потока на каждый шаг
 * цвета, а у куста их несколько; пока поток считает, в кадре прежний лист (первый
 * раз — исходный лист игры), и ползунок не ждёт пикселей.
 *
 * Пиксели листов живут модульным кэшем по адресу, а не в состоянии и не в
 * пропсах: React в режиме разработки расписывал бы буферы при каждой правке.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { compileVegetationLooks, normalizeVegetationProject, vegetationProjectSignature } from "@modovik/climb-contract/recolor/vegetation";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";
import { bitmapPixels, leafTexture } from "./oak-art.js";
import { leafRecolourer } from "./leaf-recolour.js";
import { bushLeafParams } from "./vegetation-text.js";

export const BUSH_SCENES = Object.freeze({
  bush: "/assets/workshop/vegetation/bush.bin",
  hedge: "/assets/workshop/vegetation/hedge.bin",
});

/** Рамка кадра куста: куст целиком, чуть сверху, земли нет. */
export function bushFrame(asset) {
  return { bounds: asset.bounds, ground: false, view: { yaw: -0.7, pitch: 0.24, zoom: 0.78 } };
}

/** Рамка кадра изгороди: стена изгороди наискосок, с тротуара. */
export function hedgeFrame(asset) {
  return { bounds: asset.bounds, ground: false, view: { yaw: -0.75, pitch: 0.18, zoom: 0.82 } };
}

const LEAF_SIZE = 512;
const pixelCache = new Map();

/**
 * Листы куста или изгороди сцены `asset` в облике работы: `{ textures, real }`
 * — `Map` имя листа → текстура и прочитались ли листы игры. Пока листов нет
 * (браузер без Astral Desktop) — пусто: сцена рисует их средним цветом.
 */
export function useBushLeaves(asset, input, { opaque = false } = {}) {
  const project = useMemo(() => normalizeVegetationProject(input), [input]);
  const signature = vegetationProjectSignature(project);
  const [loaded, setLoaded] = useState({ asset: null, names: [] });
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;
    const leaves = (asset.materials || []).filter((material) => material.group === "leaves" && material.texture != null);
    Promise.all(
      leaves.map(async (material) => {
        const entry = asset.textures?.[material.texture];
        const key = textureKey(entry, LEAF_SIZE);
        if (!key) return null;
        if (!pixelCache.has(key)) {
          const image = await loadSceneImage(entry, LEAF_SIZE).catch(() => null);
          const pixels = image ? bitmapPixels(image) : null;
          if (pixels) pixelCache.set(key, pixels);
        }
        return pixelCache.has(key) ? { name: material.name, key } : null;
      }),
    ).then((list) => {
      if (!cancelled) setLoaded({ asset, names: list.filter(Boolean) });
    });
    return () => {
      cancelled = true;
    };
  }, [asset]);
  /* Листы кадра по имени: текстура, которую видит сцена, и что за облик на ней (ключ пересчёта). */
  const store = useRef(new Map());
  const [textures, setTextures] = useState(() => new Map());
  useEffect(() => {
    const kept = store.current;
    const drop = () => {
      for (const entry of kept.values()) entry.texture.dispose();
      kept.clear();
    };
    const publish = () => setTextures(new Map([...kept].map(([name, entry]) => [name, entry.texture])));
    if (loaded.asset !== asset) {
      drop();
      publish();
      return undefined;
    }
    const looks = compileVegetationLooks(project);
    /* Кусты как в игре — свой лист не нужен: сцена рисует лист игры сама. */
    if (!looks.bushes) {
      drop();
      publish();
      return undefined;
    }
    let cancelled = false;
    const wanted = `${signature}|${opaque}`;
    const put = (name, pixels, key) => {
      const entry = kept.get(name);
      entry?.texture.dispose();
      kept.set(name, { texture: leafTexture(pixels), key });
    };
    let changed = false;
    for (const { name, key } of loaded.names) {
      const base = pixelCache.get(key);
      if (!base) continue;
      const entry = kept.get(name);
      if (entry?.key === wanted) continue;
      const params = bushLeafParams(looks, name, { opaque });
      /* Лист не меняется (кусты как в игре в части видов) — исходный лист сразу. */
      if (!params || (!params.compiled && params.foliage >= 100)) {
        put(name, base, wanted);
        changed = true;
        continue;
      }
      /* Пока поток считает: прежний лист остаётся, а первый раз — исходный лист игры. */
      if (!entry) {
        put(name, base, "");
        changed = true;
      }
      leafRecolourer()
        .recolour(`bush|${name}|${opaque ? 1 : 0}`, `bush|${key}`, base, params)
        .then((rgba) => {
          if (!rgba || cancelled) return;
          put(name, { rgba, width: base.width, height: base.height }, wanted);
          publish();
        });
    }
    if (changed) publish();
    return () => {
      cancelled = true;
    };
    // Листы пересобираются по смыслу работы (`signature`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, asset, signature, opaque]);
  /* Кадр закрылся — листы отдают видеопамять. */
  useEffect(
    () => () => {
      for (const entry of store.current.values()) entry.texture.dispose();
      store.current.clear();
    },
    [],
  );
  return { textures, real: loaded.asset === asset && loaded.names.length > 0 };
}

/** Облик материалов куста: листва — своим листом, остальное — листами сцены. */
export function bushLook(textures) {
  return (index, info) =>
    info.group === "leaves" && textures.get(info.name) ? { colour: info.colour, texture: textures.get(info.name) } : { colour: info.colour };
}
