/*
 * Надпись на холме в кадре: буквы, леса и логотип — сетками договора
 * (`vinewood.js`), той же арифметикой, что у установщика: маски глифов
 * окна → контур → лист металла; лист слова — цвет работы по рисунку листа
 * металла игры (его кадр берёт из сцены описи).
 *
 * Сцена описи — склон вокруг надписи и штатная надпись (буквы, леса, свет):
 * в своём облике штатная надпись в кадре прячется, и вместо неё встают
 * сетки работы. Сетки работы называются кадру (`userData.pick`, `vinewood-aim.js`):
 * по щелчку он знает, что взяли — букву, леса или логотип; взятое обводится
 * рамкой (`vinewoodSelectionObject`).
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  VINEWOOD_INVENTORY,
  normalizeVinewoodProject,
  vinewoodLayout,
  vinewoodLetterMesh,
  vinewoodLogoLayout,
  vinewoodLogoMesh,
  vinewoodProjectIsStock,
  vinewoodScaffold,
  vinewoodWorldPoint,
  vinewoodWordPixels,
} from "@modovik/climb-contract/recolor/vinewood";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { useOwnFontReady } from "../emblem/own-font.js";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import { shapeProxy } from "../model-stage/selection-highlight.js";
import { VINEWOOD_PICK, VINEWOOD_SIGN_GROUPS } from "./vinewood-aim.js";
import { vinewoodGlyphMasks } from "./vinewood-glyphs.js";

const SIGN = VINEWOOD_INVENTORY.vinewood;
/* Ноль сцены — место модели букв: сетки договора — от него же. */
const SCENE_ORIGIN = VINEWOOD_INVENTORY.scenes?.[0]?.origin || SIGN.position;

/* Части штатной надписи в сцене — прячутся в своём облике работы (`vinewood-aim.js`). */
export { VINEWOOD_SIGN_GROUPS };

/** Облик материала сцены: склон — как есть, штатная надпись — только «Как в игре». */
export function vinewoodFrameLook(project, info) {
  const normal = normalizeVinewoodProject(project);
  if (!VINEWOOD_SIGN_GROUPS.includes(info.group) || vinewoodProjectIsStock(normal)) return { colour: info.colour };
  /* Прожекторы остаются при своей подсветке слова. */
  if (info.group === "lights" && normal.mode === "text" && normal.lights) return { colour: info.colour };
  return { colour: info.colour, visible: false };
}

/* Пиксели → холст → текстура кадра. */
function textureFrom(rgba, width, height, { repeat = false } = {}) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  /* Развёртка договора — как у листов игры: v сверху вниз. */
  texture.flipY = false;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* Пиксели картинки; `max` — предел большей стороны (кадру огромный лист не нужен). */
async function imagePixels(image, max = 0) {
  if (!image || typeof document === "undefined") return null;
  const scale = max && Math.max(image.width, image.height) > max ? max / Math.max(image.width, image.height) : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return { rgba: context.getImageData(0, 0, width, height).data, width, height };
}

/* Картинка из хранилища окна → пиксели. */
async function blobPixels(blob, max) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      return await imagePixels(bitmap, max);
    } finally {
      bitmap.close?.();
    }
  }
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    return await imagePixels(image, max);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Лист сцены по имени (листы металла букв и лесов из игры игрока). */
function sceneEntry(asset, name) {
  const material = asset?.materials?.find((item) => item.name === name && item.texture != null);
  return material ? asset.textures?.[material.texture] || null : null;
}

/** Листы игры для кадра: рисунок металла букв и лист лесов (пиксели). */
export function useVinewoodSheets(asset) {
  const [sheets, setSheets] = useState({ metal: null, scaffold: null });
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;
    (async () => {
      const metal = await imagePixels(await loadSceneImage(sceneEntry(asset, SIGN.textures.metal.name), 256).catch(() => null));
      const scaffold = await imagePixels(await loadSceneImage(sceneEntry(asset, SIGN.textures.scaffold.name), 128).catch(() => null));
      if (!cancelled) setSheets({ metal, scaffold });
    })();
    return () => {
      cancelled = true;
    };
  }, [asset]);
  return sheets;
}

/* Сетка договора → геометрия three (оси сцены: Z вверх, как у кадра). */
function geometryOf(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function meshObject(mesh, material) {
  const geometry = geometryOf(mesh);
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return {
    object,
    dispose() {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}

/*
 * Слово — группа букв, каждая своей сеткой (те же `vinewoodLetterMesh`, что склеивает
 * `vinewoodWordMesh`, и тот же лист на всех). Так буква называется кадру сама
 * (`userData.pick.letter`): щелчок узнаёт её, не гадая по точке — а точка попадания
 * приходит со склона за буквами, не с самих букв.
 */
function vinewoodWordObject(shape, material, options) {
  const group = new THREE.Group();
  const geometries = [];
  for (const letter of shape.layout.letters) {
    const mask = shape.masks[letter.index];
    if (!mask) continue;
    const geometry = geometryOf(vinewoodLetterMesh(letter, mask, options));
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = true;
    part.receiveShadow = true;
    part.userData.pick = { kind: VINEWOOD_PICK.word, letter: letter.index };
    group.add(part);
    geometries.push(geometry);
  }
  if (!geometries.length) return null;
  /* Раскладка букв — для рамки вокруг буквы или всей надписи. */
  group.userData.pick = { kind: VINEWOOD_PICK.word, letters: shape.layout.letters };
  return {
    object: group,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
  };
}

/** Раскладка работы и маски (слово) или раскладка логотипа: `{ layout, masks }` или `null`. */
export function vinewoodShape(project) {
  const normal = normalizeVinewoodProject(project);
  if (vinewoodProjectIsStock(normal) || normal.mode === "hidden") return null;
  if (normal.mode === "logo") return { layout: vinewoodLogoLayout(normal), masks: [] };
  const result = vinewoodGlyphMasks(normal);
  if (!result) return null;
  return { layout: vinewoodLayout(normal, result.glyphs), masks: result.masks };
}

/**
 * Объекты кадра: буквы (или логотип) и леса работы — `[{ object, dispose }]`.
 * `sheets` — листы игры (`useVinewoodSheets`), `logo` — пиксели логотипа.
 */
export function vinewoodObjects(project, { sheets = {}, logo = null, detail = "full" } = {}) {
  const normal = normalizeVinewoodProject(project);
  const shape = vinewoodShape(normal);
  if (!shape) return [];
  const out = [];
  const origin = SCENE_ORIGIN;
  if (normal.mode === "logo") {
    if (!logo) return [];
    const map = textureFrom(logo.rgba, logo.width, logo.height);
    const material = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.05, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    const logoMesh = meshObject(vinewoodLogoMesh(shape.layout, { origin }), material);
    logoMesh.object.userData.pick = { kind: VINEWOOD_PICK.logo, letters: shape.layout.letters };
    out.push(logoMesh);
  } else {
    const size = detail === "full" ? [2048, 256] : [512, 64];
    const pixels = vinewoodWordPixels(normal, { width: size[0], height: size[1], metal: sheets.metal || null, layout: shape.layout });
    const map = textureFrom(pixels, size[0], size[1]);
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.15, side: THREE.FrontSide });
    const word = vinewoodWordObject(shape, material, { origin, simplify: detail === "full" ? 0.45 : 1.2, sides: detail === "full" });
    if (word) out.push(word);
    else {
      material.map?.dispose();
      material.dispose();
    }
  }
  const scaffold = vinewoodScaffold(shape.layout, { origin, full: detail === "full" });
  if (scaffold) {
    const map = sheets.scaffold ? textureFrom(sheets.scaffold.rgba, sheets.scaffold.width, sheets.scaffold.height, { repeat: true }) : null;
    const material = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x8a8d90, roughness: 0.7, metalness: 0.35 });
    const scaffoldMesh = meshObject(scaffold, material);
    scaffoldMesh.object.userData.pick = { kind: VINEWOOD_PICK.scaffold };
    out.push(scaffoldMesh);
  }
  return out;
}

/**
 * Свой логотип работы из хранилища окна: `{ pixels, status }`. `status` —
 * `none` (картинки в работе нет), `loading`, `ready`, `missing` (в
 * хранилище этого окна её нет — работа пришла с другого компьютера или
 * хранилище очистили: тогда логотип не встанет ни в кадр, ни в игру) или
 * `failed` (файл есть, а окно его не разобрало — установщик берёт файл сам).
 * Логотип нужен и кадру редактора, и обложке на полке: на обложке — ровно
 * то, что человек поставил (05.10.2026, владелец: «поставил свой логотип —
 * на предпросмотре видна просто гора»). `max` — предел стороны, px.
 */
export function useVinewoodLogo(asset, { max = 2048 } = {}) {
  const [read, setRead] = useState({ asset: "", pixels: null, missing: false });
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;
    getWorkshopAsset(asset)
      .catch(() => null)
      .then(async (blob) => (blob ? { asset, pixels: await blobPixels(blob, max).catch(() => null), missing: false } : { asset, pixels: null, missing: true }))
      .then((next) => {
        if (!cancelled) setRead(next);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, max]);
  return useMemo(() => {
    if (!asset) return { pixels: null, status: "none" };
    if (read.asset !== asset) return { pixels: null, status: "loading" };
    if (read.pixels) return { pixels: read.pixels, status: "ready" };
    return { pixels: null, status: read.missing ? "missing" : "failed" };
  }, [asset, read]);
}

/**
 * Объекты кадра редактора: пересобираются по смыслу работы и листам.
 * `logo` — пиксели логотипа (`useVinewoodLogo`).
 */
export function useVinewoodObjects({ asset, project, logo = null }) {
  const sheets = useVinewoodSheets(asset);
  const normal = normalizeVinewoodProject(project);
  /* Свой шрифт открылся из хранилища окна — буквы пересобираются им. */
  const fontReady = useOwnFontReady(normal.font === "custom" ? normal.fontAsset : "");
  const key = JSON.stringify([normal.mode, normal.text, normal.font, normal.fontAsset, fontReady, normal.height, normal.width, normal.spacing, normal.look, normal.letters, normal.relief, normal.logo.asset, normal.logoHeight]);
  const objects = useMemo(
    () => vinewoodObjects(normal, { sheets, logo }),
    // Сетки пересобираются по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sheets, logo],
  );
  useEffect(() => () => objects.forEach((item) => item.dispose()), [objects]);
  return objects;
}

/* Рамка чуть шире буквы, м, и сдвиг к городу, чтобы не лечь в металл. */
const FRAME_MARGIN = 0.5;
const FRAME_FRONT = 0.4;

/**
 * Что обвести вокруг букв работы: `letters` — раскладка (`pick.letters` слова или
 * логотипа), `only` — номера знаков слова (`null` — все: вокруг всей
 * надписи, у логотипа — вокруг него). `origin` — ноль сцены. Описание подсветки кадра
 * (`{ proxies }`): штрихи и контур, как у всего выбранного (задача 10Б 18.10.2026 — прежде
 * белая рамка). Лучи подсветку не видят: щелчок берёт сетку под ней.
 */
export function vinewoodSelectionSpec(letters, { only = null, origin = SCENE_ORIGIN } = {}) {
  const chosen = (letters || []).filter((letter) => !only || only.includes(letter.index));
  if (!chosen.length) return null;
  const proxies = [];
  for (const letter of chosen) {
    const half = letter.width / 2 + FRAME_MARGIN;
    const corner = (along, z) => {
      const world = vinewoodWorldPoint(along, letter.depth + FRAME_FRONT, z);
      return [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
    };
    const corners = [
      corner(letter.along - half, letter.bottom - FRAME_MARGIN),
      corner(letter.along + half, letter.bottom - FRAME_MARGIN),
      corner(letter.along + half, letter.bottom + letter.height + FRAME_MARGIN),
      corner(letter.along - half, letter.bottom + letter.height + FRAME_MARGIN),
    ];
    proxies.push(shapeProxy(corners));
  }
  return { proxies };
}
