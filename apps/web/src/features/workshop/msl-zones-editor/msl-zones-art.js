/*
 * Линии МСЛ-зон в 3D-кадре — та же сетка, что уедет в игру.
 *
 * Сцена описи (`scene.bin`) везёт ленты мода по районам; кадр берёт ленты
 * выбранного района и строит из них сетку работы тем же
 * `mslZonesMesh` договора, что и установщик: ширина ленты, стенки по оси,
 * развёртка в полосы цветов (у каждого цвета мода — свой облик). Материал —
 * без света (у игры `emissive`: линии светятся сами), прозрачность —
 * альфой текстуры, как у шейдера `emissive_alpha`.
 */

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
  MSL_DISTRICTS,
  MSL_PALETTE,
  MSL_ZONES_INVENTORY,
  mslAppearance,
  mslColourLook,
  mslLookHex,
  mslPaletteCell,
  mslZonesMesh,
  mslZonesTexture,
  mslZonesTilePlan,
  normalizeMslZonesProject,
} from "@modovik/climb-contract/recolor/msl-zones";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { mslZonesMeshAsync } from "./msl-zones-mesh-client.js";
import { createSelectionHighlight } from "../model-stage/selection-highlight.js";
import { MSL_PICK_WIDTH, mslColourPick, mslLinesPick, splitMslByColour } from "./msl-zones-aim.js";

/* Ленты района из сцены описи: `{ positions, uvs, indices }` — один объект
   на сцену и район (разбор ленты договора кэшируется по нему). */
const sources = new WeakMap();
export function districtSource(asset, districtId) {
  if (!asset) return null;
  if (!sources.has(asset)) sources.set(asset, new Map());
  const known = sources.get(asset);
  if (known.has(districtId)) return known.get(districtId);
  const part = asset.parts.findIndex((item) => item.id === districtId);
  const meshes = part < 0 ? [] : asset.meshes.filter((mesh) => mesh.part === part);
  let source = null;
  if (meshes.length === 1) source = { positions: meshes[0].positions, uvs: meshes[0].uvs, indices: Uint32Array.from(meshes[0].indices) };
  else if (meshes.length > 1) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (const mesh of meshes) {
      const base = positions.length / 3;
      positions.push(...mesh.positions);
      uvs.push(...(mesh.uvs || new Float32Array((mesh.positions.length / 3) * 2)));
      for (const index of mesh.indices) indices.push(base + index);
    }
    source = { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
  }
  known.set(districtId, source);
  return source;
}

/** Текстура линий работы — полоса на каждый цвет мода, альфа прозрачности. */
export function linesTexture(project) {
  const picture = mslZonesTexture(project);
  const texture = new THREE.DataTexture(new Uint8Array(picture.rgba), picture.width, picture.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  /* Развёртка V — середина полосы цвета: соседние полосы не смешиваются. */
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/* Куски сетки с одним цветом мода: свои геометрии на общих вершинах (нужны лучу, а не отрисовке). */
function colourPieces(positions, indicesByColour, sphere) {
  return indicesByColour.map((indices) => {
    if (!indices) return null;
    const piece = new THREE.BufferGeometry();
    /* Свой атрибут на каждый кусок: освобождение одного не трогает буфер соседа. */
    piece.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    piece.setIndex(new THREE.BufferAttribute(indices, 1));
    piece.boundingSphere = sphere.clone();
    return piece;
  });
}

/*
 * Мишени цветов района: лента шире ленты мода (`MSL_PICK_WIDTH`) по тем же
 * звеньям — в неё можно попасть, когда лента мода тоньше пикселя. Зависят
 * только от района, поэтому считаются один раз на источник; в отрисовку идёт
 * лишь подсветка выбранного цвета (`mslColourHalo`).
 */
const colourTargets = new WeakMap();
/* Мишени по цветам из готовой сетки шириной выбора (её может посчитать фоновый поток). */
function targetsFromMesh(source, mesh) {
  const whole = new THREE.BufferGeometry();
  whole.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  whole.computeBoundingSphere();
  const made = colourPieces(mesh.positions, splitMslByColour(mesh), whole.boundingSphere);
  whole.dispose();
  colourTargets.set(source, made);
  return made;
}
function targetsOf(source) {
  return colourTargets.get(source) || targetsFromMesh(source, mslZonesMesh(source, { width: MSL_PICK_WIDTH, height: 0 }));
}
/* Мишени района — в фоновом потоке: подсветка выбранного цвета не ждёт сетку на главном потоке. */
export async function primeColourTargets(source) {
  if (!source || colourTargets.has(source)) return;
  const mesh = await mslZonesMeshAsync(source, { width: MSL_PICK_WIDTH, height: 0 });
  if (!colourTargets.has(source)) targetsFromMesh(source, mesh);
}

/**
 * Объект кадра: сетка работы для района `districtId` (или `null`). Сетку
 * можно выбирать щелчком (18.10.2026): под ней — невидимые куски по цветам
 * мода (точные) и мишени шире ленты, каждый называет свой цвет в
 * `userData.pick`; сама сетка в лучах не участвует.
 */
export function mslZonesObject(source, input) {
  if (!source) return null;
  const project = normalizeMslZonesProject(input);
  return mslZonesObjectFromMesh(source, project, mslZonesMesh(source, project));
}

/* Объект из готовой сетки: сетку может посчитать фоновый поток (`msl-zones-mesh-client.js`). */
export function mslZonesObjectFromMesh(source, project, mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  const map = linesTexture(project);
  const transparent = project.opacity < 100;
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent,
    depthWrite: !transparent,
    side: THREE.DoubleSide,
    /* Лента лежит на земле кадра — чуть выше, чтобы не мерцала. */
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = "msl-zones";
  object.visible = project.opacity > 0;

  /* Выбор щелчком: сама сетка лучу не нужна — цвета целятся своими кусками и мишенями под ней. */
  object.userData.pick = mslLinesPick();
  object.raycast = () => {};
  const aim = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const exact = colourPieces(mesh.positions, splitMslByColour(mesh), geometry.boundingSphere);
  const wide = targetsOf(source);
  MSL_PALETTE.forEach((colour, index) => {
    if (exact[index]) {
      const piece = new THREE.Mesh(exact[index], aim);
      piece.userData.pick = mslColourPick(colour.id);
      object.add(piece);
    }
    if (wide[index]) {
      const target = new THREE.Mesh(wide[index], aim);
      target.userData.pick = mslColourPick(colour.id);
      /* Чуть ниже сетки: где мишень соседнего цвета накрывает чужую ленту, ближе к камере оказывается лента. */
      target.position.z = -0.02;
      object.add(target);
    }
  });

  return {
    object,
    dispose() {
      geometry.dispose();
      for (const piece of exact) piece?.dispose();
      aim.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

/**
 * Подсветка линий цвета мода `colourId` в районе (штрихами кадра, тем же
 * слоем, что у сеток сцены): мишень цвета — лента шире ленты мода, чтобы
 * подсветку было видно и с высоты района. `null` — у района нет такого цвета.
 */
export function mslColourHalo(source, colourId) {
  const index = MSL_PALETTE.findIndex((item) => item.id === colourId);
  const geometry = source && index >= 0 ? targetsOf(source)[index] : null;
  if (!geometry) return null;
  const group = new THREE.Group();
  group.name = "msl-zones-selection";
  /* Слою нужны геометрия и мировая матрица: мишень лежит в координатах района, как и сетка. */
  const layer = createSelectionHighlight({ parent: group, invalidate: () => {} });
  layer.set("select", [{ geometry, matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} }]);
  return {
    object: group,
    dispose() {
      layer.dispose();
      geometry.dispose();
    },
  };
}

/**
 * Объекты кадра: пересобираются по смыслу работы и району. `selected` — цвет
 * мода, чьи линии подсвечены (`null` — никакой): подсветка идёт отдельным
 * объектом, и смена выбора не пересобирает сетку.
 */
export function useMslZonesObjects({ asset, districtId, project, selected = null }) {
  const normal = normalizeMslZonesProject(project);
  const key = JSON.stringify([districtId, normal.opacity, normal.ownColour, normal.look, normal.colours, normal.width, normal.height]);
  const source = useMemo(() => districtSource(asset, districtId), [asset, districtId]);
  /* Сетка ленты считается в фоновом потоке: выбор района не замораживает окно (замер 20.10: 2,2 с на главном). Мишени
     цветов района — тоже там (`primeColourTargets`): иначе объект досчитывал их сам на главном потоке — вторая сетка
     района шириной выбора, ~90 мс на выбор района (Mac ×4, 22.10), первый — 0,8 с. */
  const [built, setBuilt] = useState(null);
  useEffect(() => {
    if (!source) return undefined;
    let cancelled = false;
    Promise.all([mslZonesMeshAsync(source, normal), primeColourTargets(source)]).then(([mesh]) => {
      if (!cancelled) setBuilt({ source, key, item: mslZonesObjectFromMesh(source, normal, mesh) });
    });
    return () => {
      cancelled = true;
    };
    // Сетка пересобирается по смыслу работы (`key`), а не по новому объекту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);
  /* Пока сетка работы пересобирается, видна прежняя: линии не пропадают на время фонового расчёта; при смене района — ничего до готовности. */
  const item = built && built.source === source ? built.item : null;
  useEffect(() => () => built?.item?.dispose(), [built]);
  /* Подсветка выбранного цвета — после того, как мишени района посчитаны в фоне (`primeColourTargets`). */
  const [haloReady, setHaloReady] = useState(null);
  useEffect(() => {
    if (!source || !selected) return undefined;
    let cancelled = false;
    primeColourTargets(source).then(() => {
      if (!cancelled) setHaloReady({ source, selected });
    });
    return () => {
      cancelled = true;
    };
  }, [source, selected]);
  const halo = useMemo(
    () => (haloReady && haloReady.source === source && haloReady.selected === selected ? mslColourHalo(source, selected) : null),
    [source, selected, haloReady],
  );
  useEffect(() => () => halo?.dispose(), [halo]);
  return useMemo(() => [...(item ? [item] : []), ...(halo ? [halo] : [])], [item, halo]);
}

/* Сцена описи — одна на окно (кэш `loadSceneAsset`). */
export function useMslScene() {
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSceneAsset(MSL_ZONES_INVENTORY.scene.url)
      .then((loaded) => {
        if (!cancelled) setAsset(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return asset;
}

/**
 * Куски в игре при этой дальности — по лентам всех районов из сцены описи
 * (у установщика — по сетке со стенками; число кусков то же с точностью до
 * десятка): `{ plan, look }` или `null`, пока сцена едет.
 */
export function useMslTilePlan(asset, drawDistance) {
  return useMemo(() => {
    if (!asset) return null;
    const meshes = MSL_DISTRICTS.map((district) => districtSource(asset, district.id)).filter(Boolean);
    if (!meshes.length) return null;
    const project = { drawDistance };
    const plan = mslZonesTilePlan(meshes, project);
    return { plan, look: mslAppearance(meshes, project, plan.side) };
  }, [asset, drawDistance]);
}

/*
 * Плитка и обложка — линии района сверху, наклонно: ось каждой ленты своим
 * цветом (облик её цвета мода), толщина — по ширине работы, стенка — тем же
 * цветом над линией. Рисуется из той же сцены описи, что кадр: это схема
 * настоящих линий мода, а не кадр из игры.
 */
export function paintMslZones(context, source, input, { width, height, tilt = 0.55, background = null } = {}) {
  if (!source) return;
  const project = normalizeMslZonesProject(input);
  const { positions, uvs, indices } = source;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
  }
  const margin = 8;
  const scale = Math.min((width - margin * 2) / Math.max(1, maxX - minX), (height - margin * 2) / Math.max(1, (maxY - minY) * tilt));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale * tilt) / 2;
  const at = (x, y, z = 0) => [ox + (x - minX) * scale, oy + (maxY - y) * scale * tilt - z * scale * (1 - tilt) * 6];
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  const looks = MSL_PALETTE.map((item) => mslColourLook(project, item.id));
  const alpha = Math.max(0.15, project.opacity / 100);
  context.globalAlpha = 1;
  context.lineCap = "round";
  const line = Math.max(1, Math.min(4, project.width * 1.6));
  for (let t = 0; t + 2 < indices.length; t += 9) {
    const a = indices[t];
    const b = indices[t + 1];
    const [x1, y1] = at(positions[a * 3], positions[a * 3 + 1]);
    const [x2, y2] = at(positions[b * 3], positions[b * 3 + 1]);
    const look = looks[uvs ? mslPaletteCell(uvs[a * 2], uvs[a * 2 + 1]) : 0];
    /* Доля облика: вдоль района (запад → восток), у линии — через звено. */
    const share = look.mode === "line" ? (t / 9) % 2 : (positions[a * 3] - minX) / Math.max(1, maxX - minX);
    context.strokeStyle = mslLookHex(look, share);
    context.globalAlpha = alpha;
    context.lineWidth = line;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    if (project.height > 0) {
      const [, y1top] = at(positions[a * 3], positions[a * 3 + 1], project.height);
      const lift = y1 - y1top;
      context.globalAlpha = alpha * 0.45;
      context.beginPath();
      context.moveTo(x1, y1 - lift);
      context.lineTo(x2, y2 - lift);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

/** Картинка плитки (data URL) района в облике работы. */
export function mslZonesImage(asset, districtId, project, { width = 200, height = 96 } = {}) {
  if (typeof document === "undefined") return "";
  const source = districtSource(asset, districtId);
  if (!source) return "";
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  paintMslZones(context, source, project, { width, height });
  return canvas.toDataURL?.() || "";
}
