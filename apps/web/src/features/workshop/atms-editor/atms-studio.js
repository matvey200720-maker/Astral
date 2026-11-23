/*
 * «Студия» у банкоматов (ТЗ 18.10.2026, Session 1, задача 6): экран, вывеска,
 * полоса логотипов и клавиатура — картинкой, нарисованной в студии текстур.
 * Холст — лицо места, каким его видит человек у банкомата (пропорция острова
 * листа из описи, 2048 по длинной стороне); основа — то, что сейчас лежит на
 * этом месте в листе игры игрока (`islandImage`), а без игры — средний цвет
 * места. Итог ложится в работу как своя картинка места («Растянуть» — холст
 * и лицо места одной пропорции, ничего не режется).
 */

import * as THREE from "three";
import { ATMS_INVENTORY, ATM_PICTURE_DEFAULTS, ATM_TEXT_ASPECT } from "@modovik/climb-contract/recolor/atms";
import { normalizeSlotTransform, placeImageInIslands } from "@modovik/climb-contract/recolor/arena-slots";
import { islandImage } from "@modovik/climb-contract/recolor/building-images";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { placeStudioImage } from "../texture-studio/studio-place.js";
import { ATMS_SCENE_URL, atmFrameLook, partLabel, sceneTypeIndex, targetLabel } from "./atms-text.js";
import { atmsFrame } from "./AtmsStage.jsx";
import { tr } from "../../../locales/ui.js";

/** Длинная сторона холста студии у банкомата, px. */
export const ATM_STUDIO_SIDE = 2048;
/** Длинная сторона основы из листа игры: лист мал (256–512), больше читать нечего. */
const BASE_SIDE = 1024;
const SHEET_SIDE = 512;
/* Подписи кнопки «Поставить» — ключи словаря, переводятся в месте отрисовки. */
export const ATM_PLACE_LABELS = Object.freeze({
  screen: "Поставить на экран",
  sign: "Поставить на вывеску",
  strip: "Поставить на полосу",
  keyboard: "Поставить на клавиатуру",
});

/* Места части у моделей вкладки: `[{ type, sheet, area }]`. */
function placesOf(target, part) {
  const types = target === "all" ? ATMS_INVENTORY.types : ATMS_INVENTORY.types.filter((type) => type.id === target);
  const places = [];
  for (const type of types)
    for (const sheet of type.sheets)
      for (const area of sheet.areas) if (area.part === part && area.islands?.length) places.push({ type, sheet, area });
  return places;
}

/** Пропорция лица места: у модели — её остров, у «Все» — средняя по моделям (иначе — привычная). */
export function atmSurfaceAspect(target, part) {
  const aspects = placesOf(target, part)
    .flatMap((place) => place.area.islands.map((island) => island.aspect))
    .filter((value) => value > 0);
  if (!aspects.length) return ATM_TEXT_ASPECT[part] || 1.3;
  return Math.round((aspects.reduce((sum, value) => sum + value, 0) / aspects.length) * 100) / 100;
}

/** Размер холста по пропорции: 2048 по длинной стороне. */
export function atmStudioSize(aspect) {
  return aspect >= 1
    ? { width: ATM_STUDIO_SIDE, height: Math.max(16, Math.round(ATM_STUDIO_SIDE / aspect)) }
    : { width: Math.max(16, Math.round(ATM_STUDIO_SIDE * aspect)), height: ATM_STUDIO_SIDE };
}

/* Лицо места из листа игры (как его видно спереди) или `null`, если листа игры нет. */
async function gameFace(place) {
  const image = await loadSceneImage({ game: place.type.at, texture: place.sheet.name }, SHEET_SIDE).catch(() => null);
  if (!image) return null;
  const width = image.width || place.sheet.width;
  const height = image.height || place.sheet.height;
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const face = islandImage({ rgba: context.getImageData(0, 0, width, height).data, width, height }, place.area.islands[0], { longest: BASE_SIDE });
  return createImageBitmap(new ImageData(new Uint8ClampedArray(face.rgba), face.width, face.height));
}

/* ------------------------------------------------------------------ *
 * Живой 3D-вид: лицо места, нарисованное в студии, — в острова листа
 * ------------------------------------------------------------------ */

const PREVIEW_FACE = 512;

const canvasOf = (width, height) => Object.assign(document.createElement("canvas"), { width, height });

/* Лист места пикселями: лист игры игрока или средние цвета мест (браузер без Astral Desktop). */
async function sheetPixels(place) {
  const image = await loadSceneImage({ game: place.type.at, texture: place.sheet.name }, SHEET_SIDE).catch(() => null);
  const width = image?.width || place.sheet.width;
  const height = image?.height || place.sheet.height;
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (image) context.drawImage(image, 0, 0, width, height);
  else
    for (const area of [...place.sheet.areas].reverse()) {
      const rect = area.rect || [0, 0, 1, 1];
      context.fillStyle = area.colour || "#808080";
      context.fillRect(rect[0] * width, rect[1] * height, (rect[2] - rect[0]) * width, (rect[3] - rect[1]) * height);
    }
  return { rgba: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * Кадр банкомата для плавающего окна студии: холст студии ложится в острова
 * этого места на листах (как соберёт установщик), остальное — как в работе.
 * `view3d.live(preview)` — см. `StudioFloat3D.jsx`.
 */
export function atmView3d({ target, part, project }) {
  const places = placesOf(target, part);
  const index = sceneTypeIndex(target);
  return {
    scene: ATMS_SCENE_URL,
    frame: atmsFrame(target),
    frameKey: target,
    parts: index >= 0 ? [index] : null,
    live() {
      const sheets = new Map();
      let version = 0;
      let lastFace = null;
      let disposed = false;
      let look = null;
      let lookVersion = -1;
      const transform = normalizeSlotTransform({ fit: "stretch" }, ATM_PICTURE_DEFAULTS);

      /* Лист заводится по первому кадру студии: основа читается один раз. */
      async function open(place) {
        const key = `${place.type.id}:${place.sheet.name}`;
        if (sheets.has(key)) return;
        sheets.set(key, null);
        const base = await sheetPixels(place);
        if (disposed) return;
        const canvas = canvasOf(base.width, base.height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.NoColorSpace;
        texture.flipY = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
        sheets.set(key, { place, base, canvas, texture });
        version += 1;
        if (lastFace) paint(sheets.get(key), lastFace);
      }

      function paint(sheet, face) {
        const rgba = new Uint8ClampedArray(sheet.base.rgba);
        for (const area of sheet.place.sheet.areas) if (area.part === part && area.islands?.length) placeImageInIslands(rgba, sheet.base.width, sheet.base.height, area.islands, face, transform);
        sheet.canvas.getContext("2d").putImageData(new ImageData(rgba, sheet.base.width, sheet.base.height), 0, 0);
        sheet.texture.needsUpdate = true;
      }

      return {
        update(canvas) {
          if (disposed || !canvas?.width) return;
          const scale = Math.min(1, PREVIEW_FACE / Math.max(canvas.width, canvas.height));
          const width = Math.max(1, Math.round(canvas.width * scale));
          const height = Math.max(1, Math.round(canvas.height * scale));
          const small = canvasOf(width, height);
          const context = small.getContext("2d", { willReadFrequently: true });
          context.drawImage(canvas, 0, 0, width, height);
          lastFace = { rgba: context.getImageData(0, 0, width, height).data, width, height };
          for (const place of places) open(place);
          for (const sheet of sheets.values()) if (sheet) paint(sheet, lastFace);
        },
        /* Облик меняется, только когда добавился лист: иначе тот же, текстуры обновляются сами. */
        look() {
          if (look && lookVersion === version) return look;
          const composites = new Map([...sheets].filter(([, sheet]) => sheet).map(([key, sheet]) => [key, sheet.texture]));
          look = (_index, info) => atmFrameLook(project, info, { finishes: {}, composites });
          lookVersion = version;
          return look;
        },
        dispose() {
          disposed = true;
          for (const sheet of sheets.values()) sheet?.texture.dispose();
          sheets.clear();
        },
      };
    },
  };
}

/**
 * Описание поверхности для студии: `{ target, part, settings, project }` —
 * вкладка, часть, её облик и работа целиком (для 3D-вида).
 */
export function atmStudioSurface({ target, part, settings, project = null }) {
  const place = placesOf(target, part)[0] || null;
  const current = (settings.mode === "image" || settings.mode === "text") && settings.image?.asset ? { asset: settings.image.asset } : null;
  return {
    id: `atms:${target}:${part}`,
    slug: `atm-${target}-${part}`,
    title: `${tr("Банкоматы")} · ${targetLabel(target)} · ${partLabel(part)}`,
    ...atmStudioSize(atmSurfaceAspect(target, part)),
    base: place ? () => gameFace(place) : null,
    baseColour: place?.area.colour || "#202226",
    view3d: project && place ? atmView3d({ target, part, project }) : null,
    current,
    placeLabel: ATM_PLACE_LABELS[part] || "Поставить",
  };
}

/**
 * Итог студии → облик части: своя картинка, растянутая на лицо места (холст
 * и лицо одной пропорции). Возвращает `{ asset }` — по нему студия помнит,
 * что слои относятся к этой картинке.
 */
export async function placeAtmStudio(blob, { part, settings, onChange }) {
  const saved = await placeStudioImage(blob, `atm-${part}`);
  const transform = normalizeSlotTransform({ ...settings.transform, fit: "stretch", scale: 1, rotate: 0, offsetX: 0, offsetY: 0 }, ATM_PICTURE_DEFAULTS);
  onChange({ mode: "image", image: { ...settings.image, ...saved }, transform }, `${partLabel(part)}: студия`);
  return { asset: saved.asset };
}
