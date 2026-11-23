/*
 * Кадр «Цветов» (задача 2 ТЗ 10.10.2026, вечер) — луг рядами до горизонта.
 *
 * Пучки — настоящие листы пачек травы и цветов из игры игрока (`v_proc1.rpf`:
 * `ng_ip_plants.ytd`, `ng_ip_dry_bushes.ytd`…): лист — несколько стеблей с
 * цветами на прозрачном, игра ставит его пачками так же. Доля пучков-цветов
 * и их виды — как в работе: в игре цветами станет та же доля пачек мелкой
 * травы. Расстановка — сцена Astral, а не кадр игры, и подпись кадра говорит
 * это; без Astral Desktop листов нет — пучки нарисованы цветом вида.
 *
 * Холст рисуется только когда что-то поменялось: работа, листы, размер.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FLOWER_KINDS, placeShare } from "@modovik/climb-contract/recolor/vegetation";
import { loadSceneImage } from "../model-stage/scene-textures.js";

/* Листы процедурной травы у игры — в одном архиве. */
const PROC = "x64i.rpf:levels/gta5/props/procedural/v_proc1.rpf";
const GRASS_ENTRY = Object.freeze({ game: `${PROC}/ng_ip_green_grasses.ytd`, texture: "nxg_proc_greenplantsgrass_sl_01" });
const flowerEntry = (kind) => ({ game: `${PROC}/${kind.dictionary}.ytd`, texture: kind.texture });
/* Как в игре: в траве Rockstar цветы редки — одуванчики и луговая смесь. */
const GAME_MIX = Object.freeze({ kinds: ["dandelion", "meadow"], share: 8 });
const ROWS = 16;
const SPRITE = 256;
/* Лист травы у игры светлый: травинку красит цвет экземпляра пачки
   (≈ 110, 110, 86 у Rockstar) — пучок травы в кадре берёт тот же оттенок. */
const GRASS_TINT = "rgb(176, 196, 120)";

/* Пучок травы оттенком экземпляра: умножение цвета по форме листа. */
function tintedGrass(image) {
  if (typeof document === "undefined") return image;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return image;
  context.drawImage(image, 0, 0);
  context.globalCompositeOperation = "multiply";
  context.fillStyle = GRASS_TINT;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(image, 0, 0);
  return canvas;
}

/** Что рисовать на лугу: `{ kinds, share }` по цветам работы. */
export function meadowMix(flowers) {
  if (flowers.mode === "none") return { kinds: [], share: 0 };
  if (flowers.mode === "game") return GAME_MIX;
  return { kinds: flowers.kinds, share: flowers.share };
}

/* Нарисованный пучок: стебли и цветки цветом вида (без листов игры). */
function drawnTuft(context, x, y, height, colour, salt) {
  context.lineWidth = Math.max(1, height / 60);
  const stems = 7;
  for (let stem = 0; stem < stems; stem += 1) {
    const sway = (placeShare(salt, stem, 0x51) - 0.5) * height * 0.5;
    const top = y - height * (0.55 + placeShare(salt, stem, 0x52) * 0.45);
    context.strokeStyle = "#3e5b2a";
    context.beginPath();
    context.moveTo(x + (stem - stems / 2) * height * 0.03, y);
    context.quadraticCurveTo(x + sway * 0.4, (y + top) / 2, x + sway, top);
    context.stroke();
    if (colour) {
      context.fillStyle = colour;
      context.beginPath();
      context.arc(x + sway, top, Math.max(1.5, height * 0.045), 0, Math.PI * 2);
      context.fill();
    }
  }
}

function paint(canvas, { mix, images }) {
  const context = canvas?.getContext?.("2d");
  if (!context) return;
  const { width, height } = canvas;
  const horizon = height * 0.36;
  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#1b2430");
  sky.addColorStop(1, "#6f7c88");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);
  const ground = context.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, "#5e6a52");
  ground.addColorStop(0.25, "#4b5f33");
  ground.addColorStop(1, "#2f4021");
  context.fillStyle = ground;
  context.fillRect(0, horizon, width, height - horizon);
  const kinds = mix.kinds.map((id) => FLOWER_KINDS.find((kind) => kind.id === id)).filter(Boolean);
  const share = mix.share / 100;
  for (let row = 0; row < ROWS; row += 1) {
    const near = (row + 1) / ROWS;
    const y = horizon + (height - horizon) * Math.pow(near, 1.35) * 1.06;
    const tuft = height * (0.035 + 0.4 * Math.pow(near, 1.8));
    const step = Math.max(6, tuft * 0.42);
    for (let column = 0, x = -step * placeShare(row, 0, 0x53); x < width + step; column += 1, x += step) {
      const at = x + (placeShare(row, column, 0x54) - 0.5) * step;
      const flower = kinds.length && placeShare(row, column, 0x55) < share ? kinds[Math.floor(placeShare(row, column, 0x56) * kinds.length)] : null;
      const image = flower ? images.get(flower.id) : images.get("grass");
      const scale = 0.75 + placeShare(row, column, 0x57) * 0.5;
      const size = tuft * scale;
      if (image) {
        const aspect = image.width / Math.max(1, image.height);
        context.drawImage(image, at - (size * aspect) / 2, y - size, size * aspect, size);
      } else drawnTuft(context, at, y, size, flower ? flower.colour : null, row * 131 + column);
    }
  }
}

/** `onReal(true|false)` — прочитались ли листы игры (подпись кадра). */
export default function FlowerMeadow({ flowers, label = "", onReal = null }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const [images, setImages] = useState(() => new Map());
  const [size, setSize] = useState([0, 0]);
  const mix = useMemo(() => meadowMix(flowers), [flowers]);
  const wanted = useMemo(() => [...new Set([...mix.kinds, ...GAME_MIX.kinds])].join(","), [mix]);
  useEffect(() => {
    onReal?.(images.size > 0);
  }, [images, onReal]);

  /* Листы — один раз на окно (кэш `loadSceneImage`); неудача — нарисованные пучки. */
  useEffect(() => {
    let cancelled = false;
    const ids = wanted.split(",").filter(Boolean);
    Promise.all([
      loadSceneImage(GRASS_ENTRY, SPRITE)
        .catch(() => null)
        .then((image) => ["grass", image ? tintedGrass(image) : null]),
      ...ids.map((id) => {
        const kind = FLOWER_KINDS.find((item) => item.id === id);
        return loadSceneImage(flowerEntry(kind), SPRITE)
          .catch(() => null)
          .then((image) => [id, image]);
      }),
    ]).then((list) => {
      if (!cancelled) setImages(new Map(list.filter(([, image]) => image)));
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const fit = () => setSize([Math.round(frame.clientWidth), Math.round(frame.clientHeight)]);
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size[0] || !size[1]) return;
    const ratio = Math.min(typeof window === "object" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size[0] * ratio);
    canvas.height = Math.round(size[1] * ratio);
    paint(canvas, { mix, images });
  }, [mix, images, size]);

  const real = images.size > 0;
  /* Рамка и холст — те же, что у «Травы вблизи»: луг рисуется непрозрачно поверх неба рамки. */
  return (
    <div ref={frameRef} className={`vegetation-ground ${real ? "is-real" : "is-drawn"}`} role="img" aria-label={label}>
      <canvas ref={canvasRef} className="vegetation-ground-plane" />
    </div>
  );
}
