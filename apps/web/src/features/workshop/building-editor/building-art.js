/*
 * Картинки редактора зданий: надписи и таблички текстом, составные листы
 * кадра, плашки сторон, эмблем и надписей общей системы и названия — и то,
 * что уезжает главному процессу по «Применить».
 *
 * Текст рисует окно — шрифтами Windows этого компьютера (`BUILDING_FONTS`),
 * одной функцией для кадра и для игры (`renderBuildingText`): главный
 * процесс получает готовые картинки островов и кладёт их в листы той же
 * `placeImageInIslands`, что и кадр. Стороны и логотипы главный процесс
 * собирает сам из исходных картинок (`fitImagePixels`, `sideColourPixels` —
 * одна арифметика с кадром).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BUILDING_BILLBOARD_OFFSET,
  BUILDING_SIDE_IDS,
  buildingWallDecals,
  buildingWallOffset,
  buildingBillboardDecal,
  buildingBillboards,
  buildingCoverJobs,
  buildingFont,
  buildingFontAssets,
  buildingImageAssets,
  buildingEmblemDecals,
  buildingEmblemOffset,
  buildingInventory,
  buildingSide,
  buildingSideDecal,
  buildingSidePrints,
  buildingSigns,
  buildingClearedRegions,
  buildingTextJobs,
  buildingTextPlates,
  buildingTitle,
  normalizeBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
import { clearOnPlate, fitImagePixels, islandImage, maskSidePlate, printOnPlate, sideBannerPixels, sidePlateSize, sideColourPixels } from "@modovik/climb-contract/recolor/building-images";
import { placeImageInIslands } from "@modovik/climb-contract/recolor/arena-slots";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { finishImagesFor } from "../finish/finish-assets.js";
import { emblemImages } from "../emblem/emblem-items.js";
import { ownFontStack, prepareOwnFonts, useOwnFontReady } from "../emblem/own-font.js";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import { useImagePixels } from "../arena-editor/arena-composites.js";
import { loadSceneImage, textureKey } from "../model-stage/scene-textures.js";
import { plateObject, plateTexture } from "../model-stage/plate-object.js";
import { sceneOffset } from "../model-stage/scene-clearance.js";
import { placeModelImages } from "../models/model-assets.js";
import { placeItemLookModels } from "@modovik/climb-contract/recolor/place-item-looks";

/* ------------------------------------------------------------------ *
 * Холсты
 * ------------------------------------------------------------------ */

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

const hexRgb = (hex) => {
  const value = parseInt(String(hex || "#000000").slice(1), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const shadeHex = (hex, factor) => {
  const [r, g, b] = hexRgb(hex).map((value) => Math.max(0, Math.min(255, Math.round(value * factor))));
  return `rgb(${r}, ${g}, ${b})`;
};

/* ------------------------------------------------------------------ *
 * Текст
 * ------------------------------------------------------------------ */

/**
 * Текст надписи или таблички на холсте: `settings` — раздел работы
 * (`lines`, `font`, `style`, `colour`, `outline`, `background`,
 * `backgroundColour`), `lines` — какие строки рисовать (по умолчанию все
 * непустые), `aspect` — пропорция места (ширина к высоте), `height` —
 * высота холста, `opaque` — у листа нет прозрачности (фон всегда цветом).
 * Возвращает холст или `null` (окно без холста — тесты).
 */
export function renderBuildingText(settings, { aspect = 4, height = 256, lines = null, opaque = false, vertical = false } = {}) {
  /* Высокое узкое место (флаг) — текст снизу вверх, как у флагов игры:
     рисуется в повёрнутую рамку и поворачивается на место. */
  if (vertical && aspect < 0.8) {
    const turned = renderBuildingText(settings, { aspect: 1 / Math.max(0.05, aspect), height: Math.max(16, Math.round(height * Math.max(0.05, aspect))), lines, opaque });
    if (!turned) return null;
    const canvas = canvasOf(turned.height, turned.width);
    const context = context2d(canvas);
    if (!context) return null;
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
    context.drawImage(turned, 0, 0);
    return canvas;
  }
  const width = Math.max(16, Math.round(height * Math.min(16, Math.max(0.2, aspect))));
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return null;
  const text = (lines || settings.lines).map((line) => String(line || "").trim()).filter(Boolean);
  const background = opaque || settings.background === "colour";
  if (background) {
    context.fillStyle = settings.backgroundColour;
    context.fillRect(0, 0, width, height);
  }
  if (!text.length) return canvas;
  /* Свой шрифт человека — по имени семейства в наборе шрифтов документа; пока его там нет, пишется рубленым. */
  const font = settings.font === "custom" && settings.fontAsset ? { weight: 700, family: ownFontStack(settings.fontAsset, buildingFont("block").family) } : buildingFont(settings.font);
  const padX = width * 0.06;
  const padY = height * 0.12;
  const rows = text.length;
  const rowHeight = (height - padY * 2) / rows;
  /* Кегль — чтобы самая длинная строка влезла по ширине и строки — по высоте. */
  let size = rowHeight * 0.86;
  context.font = `${font.weight} ${size}px ${font.family}`;
  const widest = Math.max(...text.map((line) => context.measureText(line).width), 1);
  size = Math.max(4, Math.min(size, (size * (width - padX * 2)) / widest));
  context.font = `${font.weight} ${size}px ${font.family}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  text.forEach((line, index) => {
    const x = width / 2;
    const y = padY + rowHeight * (index + 0.5);
    if (settings.style === "neon") {
      context.shadowColor = settings.colour;
      context.shadowBlur = size * 0.35;
      context.strokeStyle = settings.colour;
      context.lineWidth = size * 0.09;
      context.strokeText(line, x, y);
      context.shadowBlur = size * 0.12;
      context.fillStyle = shadeHex(settings.colour, 1.6);
      context.fillText(line, x, y);
      context.shadowBlur = 0;
      return;
    }
    if (settings.style === "classic") {
      /* Объём: тень букв вниз-вправо и обводка, заливка — светлее сверху. */
      context.fillStyle = shadeHex(settings.outline, 0.85);
      context.fillText(line, x + size * 0.05, y + size * 0.07);
      context.strokeStyle = settings.outline;
      context.lineWidth = size * 0.1;
      context.strokeText(line, x, y);
      const gradient = context.createLinearGradient(0, y - size / 2, 0, y + size / 2);
      gradient.addColorStop(0, shadeHex(settings.colour, 1.18));
      gradient.addColorStop(0.55, settings.colour);
      gradient.addColorStop(1, shadeHex(settings.colour, 0.72));
      context.fillStyle = gradient;
      context.fillText(line, x, y);
      return;
    }
    context.strokeStyle = settings.outline;
    context.lineWidth = size * 0.05;
    context.strokeText(line, x, y);
    context.fillStyle = settings.colour;
    context.fillText(line, x, y);
  });
  return canvas;
}

/** Пиксели холста: `{ rgba, width, height }`. */
function pixelsOf(canvas) {
  const context = context2d(canvas);
  return context ? { rgba: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height } : null;
}

/* Лист без прозрачности (DXT1) — буквы встают на плашку цветом. */
const opaqueFormat = (format) => /DXT1|BC1/i.test(String(format || ""));

/*
 * Строки острова: у вывески из нескольких строк по островам (две строки —
 * два острова) каждая строка — в свой остров, иначе весь текст — в каждый.
 */
export function islandLines(settings, lineCount, islandCount, islandIndex) {
  const split = (lineCount || 1) > 1 && islandCount === lineCount;
  return split ? [settings.lines[islandIndex] || ""] : settings.lines;
}

/**
 * Работа текста по островам: `[{ key, texture, island, lines, opaque,
 * settings }]` — какую картинку куда класть. Строки таблички раскладываются
 * по её островам (у вывески из двух строк — два острова), остальное — весь
 * текст в каждый остров.
 */
export function buildingTextPieces(project, place) {
  const inventory = buildingInventory(place)?.building;
  const textures = new Map((inventory?.textures || []).map((record) => [record.name, record]));
  const pieces = [];
  for (const job of buildingTextJobs(project, place)) {
    for (const [regionIndex, region] of (job.regions || []).entries()) {
      const record = textures.get(region.texture);
      const opaque = opaqueFormat(record?.format);
      region.islands.forEach((island, islandIndex) => {
        pieces.push({
          key: `text:${job.key}:${regionIndex}:${islandIndex}`,
          group: job.key,
          texture: region.texture,
          island,
          lines: islandLines(job.settings, job.lines, region.islands.length, islandIndex),
          opaque,
          vertical: Boolean(job.vertical),
          settings: job.settings,
        });
      });
    }
  }
  return pieces;
}

/*
 * «Убрать» и острова, разошедшиеся по плашкам мест (`buildingClearedRegions`
 * договора, как у установщика): прозрачные (или пустая плашка у листа без
 * прозрачности).
 */
function hiddenPieces(project, place) {
  return buildingClearedRegions(project, place).map((region) => ({ group: region.key, texture: region.texture, islands: region.islands, opaque: region.opaque, colour: region.colour }));
}

/* Картинка плашки места: текст человека или плашка цветом. */
export function markCanvas(mark, height = 256) {
  if (mark.kind === "blank") return renderBuildingText({ ...mark.settings, lines: [""], background: "colour", backgroundColour: mark.colour }, { aspect: mark.width / Math.max(0.05, mark.height), height, opaque: true });
  return renderBuildingText(mark.settings, {
    aspect: mark.width / Math.max(0.05, mark.height),
    height,
    lines: mark.lines,
    opaque: mark.opaque || mark.settings.background === "colour",
    vertical: mark.vertical,
  });
}

/*
 * Рамка стороны (ТЗ 26.10.2026): тонкий жёлтый контур ровно по плашке стороны — по синей стене от угла до угла и от цоколя до
 * карниза, — чтобы человек видел, докуда дойдёт картинка. Прозрачная внутри; стоит перед плашкой стороны (7,5 см против 6).
 * `ids` — стороны, у которых нужна рамка (выбранная или все четыре).
 */
const FRAME_SIDE = 2048;
const FRAME_COLOUR = [255, 210, 63];
export function sideFrameObjects(place, ids) {
  const out = [];
  for (const id of ids || []) {
    const side = buildingSides(place).find((item) => item.id === id);
    if (!side) continue;
    const width = FRAME_SIDE;
    const height = Math.max(64, Math.round((FRAME_SIDE * side.height) / side.width));
    /* Толщина — около 10 см стены, не тоньше трёх пикселей. */
    const line = Math.max(3, Math.round((width / side.width) * 0.1));
    const rgba = new Uint8ClampedArray(width * height * 4);
    const tick = Math.round(Math.min(width, height) * 0.12);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const edge = x < line || y < line || x >= width - line || y >= height - line;
        /* Засечки внутрь у углов — по ним угол читается и издалека. */
        const corner = (x < tick || x >= width - tick) && (y < line * 2 || y >= height - line * 2);
        if (edge || corner) rgba.set([...FRAME_COLOUR, 255], (y * width + x) * 4);
      }
    const decal = { point: side.point, normal: side.normal, width: side.width, height: side.height, angle: 0, opacity: 1 };
    out.push(plateObject(decal, plateTexture(rgba, width, height), { offset: 0.075 }));
  }
  return out;
}

/** Рамки сторон как объекты кадра: `[{ object }]` (освобождаются сами при смене). */
export function useSideFrames({ place, sides }) {
  const key = (sides || []).join(",");
  const frames = useMemo(() => sideFrameObjects(place, key ? key.split(",") : []), [place, key]);
  useEffect(() => () => frames.forEach((item) => item.dispose()), [frames]);
  return useMemo(() => frames.map((item) => ({ object: item.object })), [frames]);
}

/* Плашки мест кадра: штатный кусок листа (`restore`), свой текст, плашка цветом.
   Перед деталями стены — как в игре (`sceneOffset`, задача 11). */
function markPlateObjects(project, place, sheets, height, asset = null) {
  const out = [];
  for (const mark of buildingTextPlates(project, place)) {
    let image = null;
    if (mark.kind === "restore") {
      const sheet = sheets?.get?.(mark.texture);
      image = sheet ? islandImage(sheet, mark.island, { longest: 512 }) : null;
    } else {
      const canvas = markCanvas(mark, height);
      image = canvas ? pixelsOf(canvas) : null;
    }
    if (!image) continue;
    const decal = { point: mark.point, normal: mark.normal, width: mark.width, height: mark.height, angle: 0, opacity: 1 };
    /* `pick` — щелчок по плашке открывает её цель (`building-aim.js`); `id` не называем: он у эмблем. */
    out.push(plateObject(decal, plateTexture(image.rgba, image.width, image.height), { offset: sceneOffset(asset, decal, 0.09), pick: { kind: "mark", target: mark.target, source: mark.source } }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Составные листы кадра
 * ------------------------------------------------------------------ */

const SHEET_SIDE = 1024;
const bases = new Map();
async function basePixels(entry) {
  const key = textureKey(entry, SHEET_SIDE) || "blank";
  if (bases.has(key)) return bases.get(key);
  const pending = (async () => {
    const image = entry ? await loadSceneImage(entry, SHEET_SIDE).catch(() => null) : null;
    const width = image?.width || 512;
    const height = image?.height || 256;
    const canvas = canvasOf(width, height);
    const context = context2d(canvas);
    if (!context) return null;
    if (image) context.drawImage(image, 0, 0, width, height);
    else {
      context.fillStyle = "#3a3a3a";
      context.fillRect(0, 0, width, height);
    }
    return { rgba: context.getImageData(0, 0, width, height).data, width, height, real: Boolean(image) };
  })();
  bases.set(key, pending);
  const value = await pending;
  if (!value?.real) bases.delete(key);
  return value;
}

function sheetTexture(rgba, width, height) {
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Составные листы кадра: `Map` имя листа → текстура (лист игры с текстом
 * надписи и табличек в их островах). `asset` — сцена кадра.
 */
export function useBuildingComposites({ asset, project, place }) {
  /* Свой шрифт открылся из хранилища окна — листы с надписями пересобираются им. */
  const fontReady = useOwnFontReady(...buildingFontAssets(project));
  const pieces = useMemo(() => buildingTextPieces(project, place), [project, place]);
  const hidden = useMemo(() => hiddenPieces(project, place), [project, place]);
  const signature = useMemo(() => JSON.stringify([pieces.map((piece) => [piece.key, piece.lines, piece.settings]), hidden, fontReady]), [pieces, hidden, fontReady]);
  const [composites, setComposites] = useState(() => new Map());
  const made = useRef(new Map());
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;
    (async () => {
      const sheets = new Map();
      for (const piece of pieces) sheets.set(piece.texture, [...(sheets.get(piece.texture) || []), { kind: "text", ...piece }]);
      for (const piece of hidden) sheets.set(piece.texture, [...(sheets.get(piece.texture) || []), { kind: "hide", ...piece }]);
      const next = new Map();
      /* Основы всех листов просятся разом (читатель склеивает их в пачки), а не по одному после ответа на прежний: поздние запросы держали заставку. */
      const entries = [...sheets.keys()].map((name) => {
        const info = asset.materials.find((item) => item.name === name && item.texture != null);
        return info ? asset.textures?.[info.texture] : null;
      });
      const bases = await Promise.all(entries.map((entry) => basePixels(entry)));
      if (cancelled) return;
      let order = -1;
      for (const [name, jobs] of sheets) {
        order += 1;
        const base = bases[order];
        if (!base) continue;
        const rgba = new Uint8ClampedArray(base.rgba);
        for (const job of jobs) {
          if (job.kind === "hide") {
            placeImageInIslands(rgba, base.width, base.height, job.islands, null, { background: job.opaque ? "colour" : "clear", backgroundColour: job.colour });
            continue;
          }
          const canvas = renderBuildingText(job.settings, { aspect: job.island.aspect, lines: job.lines, opaque: job.opaque, vertical: job.vertical });
          const image = canvas ? pixelsOf(canvas) : null;
          if (!image) continue;
          const clear = !job.opaque && job.settings.background !== "colour";
          placeImageInIslands(rgba, base.width, base.height, [job.island], image, { fit: "stretch", background: clear ? "clear" : "colour", backgroundColour: job.settings.backgroundColour });
        }
        const texture = sheetTexture(rgba, base.width, base.height);
        if (texture) next.set(name, texture);
      }
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
    // Листы пересобираются по смыслу работы (`signature`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, signature]);
  useEffect(
    () => () => {
      for (const texture of made.current.values()) texture.dispose();
      made.current = new Map();
    },
    [],
  );
  return composites;
}

/* ------------------------------------------------------------------ *
 * Плашки кадра: стороны, логотипы, надпись
 * ------------------------------------------------------------------ */

/* Листы надписи и табличек пикселями (для печати на плашках сторон). */
function useSignSheets(asset, place) {
  const [sheets, setSheets] = useState(() => new Map());
  const names = useMemo(() => {
    const out = new Set();
    for (const region of buildingTitle(place)?.regions || []) out.add(region.texture);
    for (const sign of buildingSigns(place)) for (const region of sign.regions || []) out.add(region.texture);
    return [...out];
  }, [place]);
  useEffect(() => {
    if (!asset || !names.length) return undefined;
    let cancelled = false;
    (async () => {
      const next = new Map();
      /* Все листы надписей — разом, в одну пачку чтения; в `next` они ложатся в прежнем порядке имён. */
      const bases = await Promise.all(
        names.map((name) => {
          const info = asset.materials.find((item) => item.name === name && item.texture != null);
          return info ? basePixels(asset.textures?.[info.texture]) : null;
        }),
      );
      if (cancelled) return;
      names.forEach((name, order) => {
        if (bases[order]?.real) next.set(name, bases[order]);
      });
      setSheets(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [asset, names]);
  return sheets;
}

/*
 * Надпись и таблички стены — поверх плашки стороны: свой текст — картинкой
 * текста, стандартный — островом листа как он есть. Та же раскладка у
 * установщика (`buildingSidePrints`).
 */
export function printSidePlate(pixels, project, place, id, { sheets = new Map(), textImage = null } = {}) {
  const prints = buildingSidePrints(project, place, id);
  if (!prints.length) return pixels;
  const rgba = new Uint8ClampedArray(pixels.rgba);
  for (const print of prints) {
    if (print.hole) {
      clearOnPlate(rgba, pixels.width, pixels.height, print.rect);
      continue;
    }
    const item = print.group === "title" ? project.title : project.signs[print.group.slice(5)];
    let image = null;
    if (item?.mode === "text" && item.lines.some((line) => line.trim())) image = textImage?.(print, item) || null;
    else {
      const sheet = sheets.get(print.texture);
      if (sheet) image = islandImage(sheet, print.island);
    }
    if (image) printOnPlate(rgba, pixels.width, pixels.height, print.rect, image);
  }
  return { ...pixels, rgba };
}

/* Картинка своего текста острова для печати на плашке (окно). */
function textImageOf(place) {
  return (print, item) => {
    const sign = print.group === "title" ? null : buildingSigns(place).find((entry) => `sign:${entry.id}` === print.group);
    const region = (print.group === "title" ? buildingTitle(place)?.regions : sign?.regions)?.[print.regionIndex];
    const lines = islandLines(item, sign?.lines || 1, region?.islands.length || 1, print.islandIndex);
    const canvas = renderBuildingText(item, { aspect: print.island.aspect, height: 256, lines, opaque: false });
    return canvas ? pixelsOf(canvas) : null;
  };
}

/* Рельефы сторон (листы стен из игры игрока) пикселями: `Map` лист → пиксели. */
function useReliefPixels(asset, place) {
  const [pixels, setPixels] = useState(() => new Map());
  const entries = useMemo(() => {
    const out = new Map();
    for (const side of buildingSides(place)) {
      const entry = side.relief && asset ? asset.textures?.[side.relief.scene] : null;
      if (entry) out.set(side.relief.texture, entry);
    }
    return out;
  }, [asset, place]);
  useEffect(() => {
    if (!entries.size) return undefined;
    let cancelled = false;
    (async () => {
      const next = new Map();
      for (const [name, entry] of entries) {
        const image = await loadSceneImage(entry, 512).catch(() => null);
        if (cancelled) return;
        if (!image) continue;
        const canvas = canvasOf(image.width, image.height);
        const context = context2d(canvas);
        if (!context) continue;
        context.drawImage(image, 0, 0);
        next.set(name, { rgba: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height });
      }
      if (!cancelled) setPixels(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);
  return pixels;
}

/* Лист плашки кадра — вдвое меньше, чем в игре: кадру хватает. */
const PREVIEW_SIDE = 1024;

/** Картинка стороны (RGBA) — та же, что соберёт установщик. */
export function sidePlatePixels(item, side, { banner = null, relief = null, longest = PREVIEW_SIDE } = {}) {
  const [width, height] = sidePlateSize(side.width, side.height, longest);
  if (item.mode === "banner") {
    if (!banner) return null;
    /* До краёв своей рамки, как у установщика (`sideBannerPixels`). */
    return { rgba: sideBannerPixels(banner, width, height, side, { fit: item.fit, background: item.background }), width, height };
  }
  const repeat = side.relief ? side.width / Math.max(0.5, side.relief.metres[0]) : 1;
  const pixels = sideColourPixels(item.look, width, height, {
    relief: item.relief && relief && side.relief ? { ...relief, repeat, vertical: side.relief.vertical, swap: side.relief.swap } : null,
  });
  return { rgba: pixels, width, height };
}

/**
 * Объекты кадра — плашки сторон, логотипов и надписи-плашки:
 * `[{ object }]` (освобождаются сами при смене). `asset` — сцена (листы
 * рельефа сторон).
 */
export function useBuildingPlates({ asset, project, place }) {
  const fontReady = useOwnFontReady(...buildingFontAssets(project));
  const urls = {
    front: useHangarEmblemUrl(project.sides.front?.mode === "banner" ? project.sides.front.image.asset : ""),
    right: useHangarEmblemUrl(project.sides.right?.mode === "banner" ? project.sides.right.image.asset : ""),
    rear: useHangarEmblemUrl(project.sides.rear?.mode === "banner" ? project.sides.rear.image.asset : ""),
    left: useHangarEmblemUrl(project.sides.left?.mode === "banner" ? project.sides.left.image.asset : ""),
  };
  const banners = {
    front: useImagePixels(urls.front),
    right: useImagePixels(urls.right),
    rear: useImagePixels(urls.rear),
    left: useImagePixels(urls.left),
  };
  const decals = useMemo(() => buildingEmblemDecals(project, place), [project, place]);
  const pictures = useEmblemPictures(decals.map((decal) => decal.asset));
  const reliefs = useReliefPixels(asset, place);
  const sheets = useSignSheets(asset, place);
  const signKey = JSON.stringify([project.title, project.signs, fontReady]);

  const sideKey = JSON.stringify(BUILDING_SIDE_IDS.map((id) => project.sides[id]));
  const sides = useMemo(() => {
    const out = [];
    for (const id of BUILDING_SIDE_IDS) {
      const side = buildingSide(place, id);
      const decal = buildingSideDecal(project, place, id);
      if (!side || !decal) continue;
      const plain = sidePlatePixels(project.sides[id], side, { banner: banners[id], relief: side.relief ? reliefs.get(side.relief.texture) || null : null });
      if (!plain) continue;
      const pixels = printSidePlate(plain, project, place, id, { sheets, textImage: textImageOf(place) });
      /* Строго по стене: где у стороны нет стены, плашка прозрачна. */
      const rgba = maskSidePlate(new Uint8ClampedArray(pixels.rgba), pixels.width, pixels.height, side.mask);
      /* Плашка стороны — сама стена, баннер и «Покрасить» одинаково: вплотную (6 см), детали перед стеной остаются перед ней, как в игре. */
      out.push(plateObject(decal, plateTexture(rgba, pixels.width, pixels.height), { offset: 0.06, pick: { kind: "side", side: id } }));
    }
    return out;
    // Плашки пересобираются по сторонам работы и их картинкам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideKey, signKey, place, banners.front, banners.right, banners.rear, banners.left, reliefs, sheets, asset]);
  useEffect(() => () => sides.forEach((item) => item.dispose()), [sides]);

  /* Фото на щитах крыши — плашками перед гранями щитов, как в игре. */
  const boardAssets = buildingBillboards(place)
    .filter((board) => buildingBillboardDecal(project, place, board.id))
    .map((board) => project.billboards[board.id].image.asset);
  const boardPictures = useEmblemPictures(boardAssets);
  const boardKey = JSON.stringify(project.billboards);
  const boardObjects = useMemo(() => {
    const out = [];
    for (const board of buildingBillboards(place)) {
      const decal = buildingBillboardDecal(project, place, board.id);
      const item = project.billboards[board.id];
      const image = decal ? boardPictures.get(item.image.asset) : null;
      if (!image) continue;
      const [width, height] = sidePlateSize(board.width, board.height, PREVIEW_SIDE);
      const rgba = fitImagePixels(image, width, height, { fit: item.fit, background: item.background, aspect: board.width / board.height });
      out.push(plateObject(decal, plateTexture(rgba, width, height), { offset: sceneOffset(asset, decal, BUILDING_BILLBOARD_OFFSET), pick: { kind: "billboard", billboard: board.id } }));
    }
    return out;
    // Плашки пересобираются по щитам работы и их фото, а не по новому объекту работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, place, boardPictures, asset]);
  useEffect(() => () => boardObjects.forEach((item) => item.dispose()), [boardObjects]);

  /* Эмблемы и надписи — плашками перед стеной, как в игре (каждая следующая на сантиметр дальше). */
  const emblemKey = JSON.stringify(decals);
  const logoObjects = useMemo(() => {
    const out = [];
    decals.forEach((decal, index) => {
      const image = pictures.get(decal.asset);
      if (!image) return;
      const texture = plateTexture(image.rgba, image.width, image.height);
      /* `pick` — по плашке в кадре эмблему берут мышкой и тащат по стене. */
      out.push(plateObject(decal, texture, { offset: sceneOffset(asset, decal, buildingEmblemOffset(index)), pick: { id: decal.id, kind: decal.kind } }));
    });
    return out;
    // Плашки пересобираются по списку эмблем и их картинкам, а не по новому массиву.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emblemKey, pictures, asset]);
  useEffect(() => () => logoObjects.forEach((item) => item.dispose()), [logoObjects]);

  /* Картинки на стенах (3В) — плашками, прилегающими к своим стенам, как в игре: выступы перед стеной остаются перед плашкой. */
  const wallDecals = useMemo(() => buildingWallDecals(project, place), [project, place]);
  const wallPictures = useEmblemPictures(wallDecals.map((decal) => decal.asset), WALL_SIDE);
  const wallKey = JSON.stringify(wallDecals);
  const wallObjects = useMemo(() => {
    const out = [];
    wallDecals.forEach((decal, index) => {
      const image = wallPictures.get(decal.asset);
      if (!image) return;
      /* Без `pick`: щелчок сквозь плашку попадает в саму стену — её можно открыть в студии снова. */
      out.push(plateObject(decal, plateTexture(image.rgba, image.width, image.height), { offset: buildingWallOffset(index) }));
    });
    return out;
    // Плашки пересобираются по стенам работы и их картинкам, а не по новому массиву.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallKey, wallPictures]);
  useEffect(() => () => wallObjects.forEach((item) => item.dispose()), [wallObjects]);

  /* Надпись-плашка — у здания без своей надписи (Ашан). */
  const title = buildingTitle(place);
  const titleKey = title?.kind === "plate" ? JSON.stringify(project.title) : "";
  const titleObject = useMemo(() => {
    if (title?.kind !== "plate" || project.title.mode !== "text" || !project.title.lines.some((line) => line.trim())) return null;
    const aspect = titleAspect(project.title);
    const canvas = renderBuildingText(project.title, { aspect, height: 256 });
    const image = canvas ? pixelsOf(canvas) : null;
    if (!image) return null;
    const height = project.title.size;
    const decal = { point: project.title.point, normal: project.title.normal, width: height * aspect, height, angle: 0, opacity: 1 };
    return plateObject(decal, plateTexture(image.rgba, image.width, image.height), { offset: sceneOffset(asset, decal, 0.1), pick: { kind: "title" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleKey, place, asset]);
  useEffect(() => () => titleObject?.dispose(), [titleObject]);

  /* Плашки поверх объёмных букв (название You Tool, ENTRANCE над входом). */
  // Плашки пересобираются по надписи и табличкам работы (`signKey`), а не по новому объекту.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coverObjects = useMemo(() => coverPlateObjects(project, place, 256), [signKey, place]);
  useEffect(() => () => coverObjects.forEach((item) => item.dispose()), [coverObjects]);

  /* Места разошедшихся надписей и табличек — своими плашками. */
  // Плашки пересобираются по надписи и табличкам работы (`signKey`) и листам.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const markObjects = useMemo(() => markPlateObjects(project, place, sheets, 256, asset), [signKey, place, sheets, asset]);
  useEffect(() => () => markObjects.forEach((item) => item.dispose()), [markObjects]);

  return useMemo(
    () => [...sides, ...boardObjects, ...wallObjects, ...logoObjects, ...(titleObject ? [titleObject] : []), ...coverObjects, ...markObjects].map((item) => ({ object: item.object })),
    [sides, boardObjects, wallObjects, logoObjects, titleObject, coverObjects, markObjects],
  );
}

/* Картинки эмблем и надписей из хранилища окна: `Map(asset → { rgba, width, height })` (до 1024 px; у стен — до 2048, лист плашки). */
const EMBLEM_SIDE = 1024;
const WALL_SIDE = 2048;
function useEmblemPictures(assets, side = EMBLEM_SIDE) {
  const key = [...new Set(assets)].join("|");
  const [pictures, setPictures] = useState(() => new Map());
  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!list.length) {
      setPictures(new Map());
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      list.map(async (asset) => {
        const blob = await getWorkshopAsset(asset).catch(() => null);
        if (!blob || cancelled) return null;
        const url = URL.createObjectURL(blob);
        try {
          const image = await new Promise((resolve) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => resolve(null);
            element.src = url;
          });
          if (!image) return null;
          const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = canvasOf(width, height);
          const context = context2d(canvas);
          if (!context) return null;
          context.drawImage(image, 0, 0, width, height);
          return [asset, { rgba: context.getImageData(0, 0, width, height).data, width, height }];
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    ).then((entries) => {
      if (!cancelled) setPictures(new Map(entries.filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
  }, [key, side]);
  return pictures;
}

/*
 * Картинка плашки поверх букв: текст на плашке цветом или одна плашка
 * («Убрать»). Буквы, убранные из модели (`erase`), — только буквы человека,
 * фон — как он выбрал.
 */
export function coverCanvas(job, height = 256) {
  const settings = job.hidden ? { ...job.settings, lines: [""] } : job.settings;
  return renderBuildingText(settings, { aspect: job.aspect, height, opaque: !job.erase || settings.background === "colour" });
}

function coverPlateObjects(project, place, height) {
  const out = [];
  for (const job of buildingCoverJobs(project, place)) {
    const canvas = coverCanvas(job, height);
    const image = canvas ? pixelsOf(canvas) : null;
    if (image) out.push(plateObject({ ...job.cover, angle: 0, opacity: 1 }, plateTexture(image.rgba, image.width, image.height), { offset: 0, pick: { kind: "cover", group: job.group } }));
  }
  return out;
}

const buildingSides = (place) => buildingInventory(place)?.building?.sides || [];

/*
 * Пропорция надписи-плашки: по длине самой длинной строки (буквы рубленого
 * шрифта — около 0,62 высоты) — плашка не растягивает текст.
 */
export function titleAspect(settings) {
  const lines = settings.lines.map((line) => line.trim()).filter(Boolean);
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return Math.min(12, Math.max(1.5, (longest * 0.62 + 0.8) / Math.max(1, lines.length)));
}

/* ------------------------------------------------------------------ *
 * «Применить»: картинки главному процессу
 * ------------------------------------------------------------------ */

async function assetData(asset, label) {
  const blob = await getWorkshopAsset(asset);
  if (!blob) throw new Error(`${label} пропала из хранилища окна — загрузите её ещё раз.`);
  return blobBase64(blob);
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

async function canvasData(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Картинку текста не собрать в этом окне.");
  return blobBase64(blob);
}

/**
 * Картинки работы для главного процесса: баннеры сторон и логотипы
 * (исходные файлы), текст надписи и табличек — картинками островов,
 * надпись-плашка — картинкой, свои картинки отделки. `{ key: { data } }`
 * или `null`.
 */
export async function buildingImages(input, place) {
  const project = normalizeBuildingProject(place, input);
  /* Свои шрифты — в набор шрифтов документа до холста: в картинках для игры не должно оказаться запасного. */
  await prepareOwnFonts(...buildingFontAssets(project));
  const out = {};
  const { emblems: _emblems, walls = [], ...banners } = buildingImageAssets(project, place);
  for (const [key, asset] of Object.entries(banners)) out[key] = { data: await assetData(asset, "Картинка баннера") };
  /* Развёрнутые стены (3В): по отпечатку, до 2048 px — лист плашки. */
  if (walls.length) {
    out.walls = {};
    for (const asset of walls) out.walls[asset] = { data: await assetData(asset, "Картинка стены") };
  }
  /* Эмблемы и надписи — по отпечатку, одна картинка на несколько эмблем едет раз. */
  const emblems = await emblemImages(project.emblems);
  if (emblems) Object.assign(out, emblems);
  for (const piece of buildingTextPieces(project, place)) {
    const canvas = renderBuildingText(piece.settings, { aspect: piece.island.aspect, height: 512, lines: piece.lines, opaque: piece.opaque, vertical: piece.vertical });
    if (canvas) out[piece.key] = { data: await canvasData(canvas) };
  }
  for (const job of buildingCoverJobs(project, place)) {
    const canvas = coverCanvas(job, 512);
    if (canvas) out[job.key] = { data: await canvasData(canvas) };
  }
  /* Плашки мест со своим текстом (штатные куски листа берёт установщик). */
  for (const mark of buildingTextPlates(project, place)) {
    if (mark.kind !== "text") continue;
    const canvas = markCanvas(mark, 512);
    if (canvas) out[mark.key] = { data: await canvasData(canvas) };
  }
  const title = buildingTitle(place);
  if (title?.kind === "plate" && project.title.mode === "text" && project.title.lines.some((line) => line.trim())) {
    const canvas = renderBuildingText(project.title, { aspect: titleAspect(project.title), height: 512 });
    if (canvas) out.title = { data: await canvasData(canvas), aspect: titleAspect(project.title) };
  }
  const finishes = await finishImagesFor([project.building, ...Object.values(project.parts)]);
  if (finishes) Object.assign(out, finishes);
  /* Свои модели (задача 1 ТЗ 11.10.2026, вечер) и облик вещей здания: своя модель или картинка, сетка «Цвета», картинки на элементах. Без вещей
     «Применить» у здания отказывало «картинка не пришла» (вещи не попадали в список, 31.10.2026). */
  const models = await placeModelImages([...(project.models || []), ...placeItemLookModels(project.items)]);
  if (models) Object.assign(out, models);
  return Object.keys(out).length ? out : null;
}

/**
 * Плашки для снимков (плитки готовых видов, обложка): стороны цветом без
 * рельефа и надпись-плашка — сразу, без загрузок. Баннеры и логотипы —
 * картинки человека: они есть только в кадре редактора.
 */
export function buildingPlateObjectsNow(input, place) {
  const project = normalizeBuildingProject(place, input);
  const out = [];
  for (const id of BUILDING_SIDE_IDS) {
    const side = buildingSide(place, id);
    const decal = buildingSideDecal(project, place, id);
    if (!side || !decal || project.sides[id].mode !== "colour") continue;
    const plain = sidePlatePixels(project.sides[id], side, { longest: 256 });
    const pixels = plain ? printSidePlate(plain, project, place, id, { textImage: textImageOf(place) }) : null;
    if (pixels) out.push(plateObject(decal, plateTexture(pixels.rgba, pixels.width, pixels.height), { offset: 0.06 }));
  }
  const title = buildingTitle(place);
  if (title?.kind === "plate" && project.title.mode === "text" && project.title.lines.some((line) => line.trim())) {
    const aspect = titleAspect(project.title);
    const canvas = renderBuildingText(project.title, { aspect, height: 128 });
    const image = canvas ? pixelsOf(canvas) : null;
    const height = project.title.size;
    if (image) out.push(plateObject({ point: project.title.point, normal: project.title.normal, width: height * aspect, height, angle: 0, opacity: 1 }, plateTexture(image.rgba, image.width, image.height), { offset: 0.1 }));
  }
  out.push(...coverPlateObjects(project, place, 128));
  return out.map((item) => ({ object: item.object, dispose: item.dispose }));
}
