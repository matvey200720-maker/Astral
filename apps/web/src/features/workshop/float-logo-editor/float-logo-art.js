/*
 * Летающее лого в 3D-кадре и картинки для установки — одна картинка лого.
 *
 * Картинка — своя (хранилище окна) или надпись общей системы надписей
 * (`renderEmblemText`, тот же холст, что у эмблем). Кадр строит ту же
 * объёмную фигуру, что соберёт установщик (`floatLogoMesh`), с теми же
 * пикселями (`floatLogoPixels`: цвет и прозрачность), и двигает её тем же
 * движением (`floatLogoMotion`): поворот вокруг вертикали и подъём.
 * Свечение — яркостью материала: у игры `emissive` светится сам.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  FLOAT_LOGO_LIMITS,
  floatLogoMesh,
  floatLogoMotion,
  floatLogoPixels,
  normalizeFloatLogoProject,
} from "@modovik/climb-contract/recolor/float-logo";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { drawEmblemText, ensureEmblemFont, renderEmblemText } from "../emblem/emblem-items.js";
import { useHangarEmblemUrl } from "../hangar-editor/hangar-emblem.js";
import { FLOAT_LOGO_PICK } from "./float-logo-aim.js";

/* Картинка кадра — не больше 512 px по длинной стороне: сетке хватает. */
const PREVIEW_SIDE = 512;

/* Сцена кадра и обложки: площадка и статуя орла под лого (задача 3 ТЗ 11.10.2026, утро). */
export const FLOAT_LOGO_SCENE = "/assets/workshop/float-logo/scene.bin";
/** Облик сцены: площадка — тёмная плашка, статуя — листами игры (в браузере — средним цветом листа). */
export const floatLogoSceneLook = (index, info) => (info?.id === "ground" ? { colour: "#2a2c30" } : { colour: info?.colour || "#8a8a8a" });

/** Пиксели картинки или холста, вписанные в 512 px: `{ rgba, width, height }` или `null`. */
export function canvasPixels(source, width, height) {
  if (typeof document === "undefined" || !width || !height) return null;
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    context = null;
  }
  if (!context) return null;
  context.drawImage(source, 0, 0, w, h);
  return { rgba: new Uint8ClampedArray(context.getImageData(0, 0, w, h).data), width: w, height: h };
}

/** Пиксели лого работы для кадра: `{ rgba, width, height }` или `null`. */
export function useFloatLogoPixels(project) {
  const normal = normalizeFloatLogoProject(project);
  const url = useHangarEmblemUrl(normal.mode === "image" ? normal.image?.asset : "");
  const [image, setImage] = useState(null);
  const textKey = normal.mode === "text" ? JSON.stringify(normal.text) : "";
  useEffect(() => {
    if (normal.mode !== "image" || !url) {
      setImage(null);
      return undefined;
    }
    let cancelled = false;
    const element = new Image();
    element.onload = () => !cancelled && setImage(canvasPixels(element, element.naturalWidth, element.naturalHeight));
    element.onerror = () => !cancelled && setImage(null);
    element.src = url;
    return () => {
      cancelled = true;
    };
  }, [normal.mode, url]);
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!textKey) {
      setText(null);
      return undefined;
    }
    let cancelled = false;
    const draw = () => {
      const drawn = renderEmblemText(normal.text);
      if (!cancelled) setText(drawn ? canvasPixels(drawn.canvas, drawn.canvas.width, drawn.canvas.height) : null);
    };
    /* Свой шрифт — сначала в набор шрифтов документа. */
    if (normal.text.font === "custom") ensureEmblemFont(normal.text.fontAsset).then(draw, draw);
    else draw();
    return () => {
      cancelled = true;
    };
    // Надпись перерисовывается по её смыслу (`textKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey]);
  return normal.mode === "image" ? image : normal.mode === "text" ? text : null;
}

/*
 * Подсветка выбранного лого (задача 10Б 18.10.2026): штрихи и контур самой фигуры, как у всего выбранного, а не
 * белая коробка вокруг. Фигура висит и качается — подсветка едет вместе с ней (`follow`).
 */
export const FLOAT_LOGO_HIGHLIGHT = Object.freeze({ objects: true, follow: true, where: (_info, mesh) => mesh.userData.floatLogo === true });

/** Объект кадра: фигура лого с движением, или `null`. */
export function floatLogoObject(pixels, input) {
  if (!pixels) return null;
  const project = normalizeFloatLogoProject(input);
  const shaded = floatLogoPixels(pixels.rgba, pixels.width, pixels.height, project);
  const mesh = floatLogoMesh(shaded, pixels.width, pixels.height, project);
  if (!mesh) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const map = new THREE.DataTexture(new Uint8Array(shaded), pixels.width, pixels.height, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  /* Развёртка договора — v сверху вниз, как у листа игры. */
  map.flipY = false;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  /* Свечение — яркостью: 0 — как днём без света, у мода (3,3) — ярко. */
  const glow = 0.55 + 0.45 * Math.min(1, project.glow / (FLOAT_LOGO_LIMITS.glow[1] / 3));
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: project.opacity >= 100 });
  material.color.setScalar(glow);
  const figure = new THREE.Mesh(geometry, material);
  figure.userData.floatLogo = true;
  const group = new THREE.Group();
  group.name = "float-logo";
  group.add(figure);
  /* Фигура называет себя правимой: щелчок кадра по ней отдаёт редактору `hit.pick` (сетки сцены под ней может и не быть — лого висит в воздухе). */
  group.userData.pick = { ...FLOAT_LOGO_PICK };
  const base = project.height + mesh.half;
  group.position.set(0, 0, base);
  const motion = floatLogoMotion(project);
  return {
    object: group,
    update(seconds) {
      const sample = motion.at(seconds || 0);
      group.position.z = base + sample.lift;
      group.rotation.z = sample.angle;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
    reach: { size: project.size, top: base + mesh.half + 2 },
  };
}

/** Объекты кадра: пересобираются по смыслу работы и картинке. */
export function useFloatLogoObjects(project, pixels) {
  const normal = normalizeFloatLogoProject(project);
  const key = JSON.stringify([normal.mode, normal.size, normal.height, normal.depth, normal.motion, normal.speed, normal.ownColour, normal.look, normal.glow, normal.opacity]);
  const item = useMemo(
    () => floatLogoObject(pixels, normal),
    // Сетка пересобирается по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pixels, key],
  );
  useEffect(() => () => item?.dispose(), [item]);
  return useMemo(() => (item ? [item] : []), [item]);
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/**
 * Картинка лого для главного процесса: своя — исходный файл из хранилища
 * окна, надпись — нарисованная общей системой надписей. `null` — лого нет.
 * Без кадра редактора: так ставит и «Применить», и работа из «Моих работ».
 */
export async function floatLogoImages(input) {
  const project = normalizeFloatLogoProject(input);
  let asset = "";
  if (project.mode === "image") asset = project.image?.asset || "";
  if (project.mode === "text") asset = (await drawEmblemText(project.text))?.asset || "";
  if (!asset) return null;
  const blob = await getWorkshopAsset(asset);
  if (!blob) throw new Error("Картинка лого пропала из хранилища окна — загрузите её или впишите надпись ещё раз.");
  return { logo: { data: await blobBase64(blob) } };
}
