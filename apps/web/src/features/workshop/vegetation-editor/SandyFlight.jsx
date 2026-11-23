/*
 * Полёт над «Зелёным Сэнди Шорс» — общий 3D-кадр мастерской (`ModelStage`,
 * общая камера: ЛКМ — вращение, щелчок ПКМ — полёт, колесо — ближе).
 *
 * Сцена — модели земли района вокруг Сэнди-Шорс на своих местах
 * (`scripts/prepare-sandy-scene.mjs`): у материала земли четыре слоя игры,
 * маска и веса в цветах вершин (`recolor-material.js` смешивает их). Листы
 * слоёв — из игры игрока по адресу, как у арены; слой, который меняет план
 * мода, кадр закрывает картинкой склада (превью) — с цветом травы человека,
 * той же `recolourGrass`, что у установщика. Выключенный «Сэнди» — та же
 * местность пустыней Rockstar: видно «до» и «после».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { recolourGrass } from "@modovik/climb-contract/recolor/vegetation";
import ModelStage from "../model-stage/ModelStage.jsx";
import { SANDY_SCENE_URL as SANDY_SCENE, sandyFlightFrame } from "./sandy-scene.js";

/* Сцена и рамка пролёта — в `sandy-scene.js`: ими снимает и окно-съёмщик
   обложек частей (16.10). */
export { SANDY_SCENE_URL, sandyFlightFrame } from "./sandy-scene.js";

const previewUrl = (id) => `/assets/workshop/vegetation/green/${id}.webp`;

/* Пиксели превью — один раз на окно. */
const bases = new Map();
function loadPreview(id) {
  if (!bases.has(id))
    bases.set(
      id,
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return resolve(null);
          context.drawImage(image, 0, 0);
          resolve(context.getImageData(0, 0, canvas.width, canvas.height));
        };
        image.onerror = () => resolve(null);
        image.src = previewUrl(id);
      }),
    );
  return bases.get(id);
}

function sheetOf(base, colour) {
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = colour ? recolourGrass(base.data, colour) : base.data;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), base.width, base.height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  /* Как листы сцены: развёртка DirectX, повтор по земле. */
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Листы плана для сцены: `Map` «картинка|цвет» → текстура. */
function useGreenSheets(asset, colour, enabled) {
  const [sheets, setSheets] = useState(() => new Map());
  const made = useRef(new Map());
  const wanted = useMemo(() => {
    const list = new Map();
    if (!asset || !enabled) return list;
    for (const info of asset.materials) {
      for (const green of info.green || []) if (green) list.set(`${green[0]}|${green[1] && colour ? colour : ""}`, { id: green[0], colour: green[1] ? colour : null });
      if (info.terrain?.maskGreen != null) list.set(`${info.terrain.maskGreen}|`, { id: info.terrain.maskGreen, colour: null });
    }
    return list;
  }, [asset, colour, enabled]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map();
      for (const [key, item] of wanted) {
        const known = made.current.get(key);
        if (known) {
          next.set(key, known);
          continue;
        }
        const base = await loadPreview(item.id);
        if (cancelled) return;
        const texture = base ? sheetOf(base, item.colour) : null;
        if (texture) next.set(key, texture);
      }
      if (cancelled) return;
      for (const [key, texture] of made.current) if (!next.has(key)) texture.dispose();
      made.current = next;
      setSheets(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  useEffect(
    () => () => {
      for (const texture of made.current.values()) texture.dispose();
      made.current = new Map();
    },
    [],
  );
  return sheets;
}

export default function SandyFlight({ enabled, colour = null, onCamera = null, label = "" }) {
  const [asset, setAsset] = useState(null);
  const sheets = useGreenSheets(asset, colour, enabled);
  const look = useCallback(
    (index, info) => {
      const base = { colour: info.colour, roughness: 0.94 };
      if (!enabled || !info.green) return base;
      const sheet = (green) => (green ? sheets.get(`${green[0]}|${green[1] && colour ? colour : ""}`) || null : null);
      return {
        ...base,
        ...(sheet(info.green[0]) ? { texture: sheet(info.green[0]) } : {}),
        ...(info.terrain ? { layers: [null, sheet(info.green[1]), sheet(info.green[2]), sheet(info.green[3])] } : {}),
        ...(info.terrain?.maskGreen != null ? { mask: sheets.get(`${info.terrain.maskGreen}|`) || null } : {}),
      };
    },
    [enabled, colour, sheets],
  );
  return (
    <ModelStage loadKit="nature"
      scene={SANDY_SCENE}
      look={look}
      frame={sandyFlightFrame}
      /* Местность — кусок настоящей карты: цвет уходит к краю (19.10.2026). */
      edgeFade
      label={label}
      onScene={setAsset}
      onCamera={onCamera}
      autoRotate={false}
      className="vegetation-flight"
    />
  );
}
