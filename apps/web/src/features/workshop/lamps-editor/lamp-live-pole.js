/*
 * Настоящий столб улицы в кадре «Фонарей» (задача 32 ТЗ 18.10.2026): «У лампы», «Столб» и «Украшения» —
 * не нарисованные модели, а `prop_streetlight_01` той самой дороги из игры игрока, и правка видна на нём
 * на месте — теми числами, что уедут в игру:
 *
 *   краска, блеск, прозрачность — на всех столбах этой модели в кадре. Лист корпуса красит шейдер
 *     сцены (`PAINT_PARS` в `mega-mall-scene.js`) формулой `tintPole` контракта, которой установщик красит
 *     лист (`pole.js`): каждая точка берёт цвет краски при своей яркости относительно средней по листу.
 *     Средняя яркость листа — `poleSheetMean` контракта по картинке листа модели из игры;
 *   стекло лампы — в цвет света работы, той же формулой `tintGlass`, что у установщика (`lamp-studio.js`);
 *   украшение — на одном столбе, на `LIVE_POLE`: сетка контракта (`decorMeshes`) по профилю, снятому с
 *     настоящей модели (`poleProfile`), — той же сетке, что встанет в модель игры.
 *
 * Блеск и прозрачность — приближение: блеск — шероховатость и металличность материала сцены вместо
 * множителя блика шейдера игры, прозрачность — растр по точкам экрана вместо прозрачного шейдера. Подпись
 * кадра говорит об этом. Без игры, без Astral Desktop или пока столб не приехал (бандл пропов едет
 * позже здания) кадр остаётся как есть, а правка применяется, как только столб встал.
 */

import * as THREE from "three";
import {
  POLE_STOCK,
  compileLampModels,
  hexToRgb,
  meshTriangles,
  normalizePoleSection,
  poleBodyShaders,
  poleColourFor,
  poleKindOf,
  poleProfile,
  poleSheetMean,
} from "@modovik/street-light-contract/lamps";
import { decorPreviewFor } from "./lamp-decor-view.js";
import { LIVE_POLE, nearestInstance } from "./lamp-street-views.js";

/* Столб приезжает отдельным бандлом: первые 45 секунд ищем его раз в полсекунды. */
const RETRY_MS = 500;
const WATCH_MS = 45000;
/* Яркость огоньков украшения в HDR кадра квартала: свет сцены на единицу множителя `emissive` из рисованного кадра. */
const GLOW_BOOST = 4;
/* Средняя яркость листа, если картинку прочесть нельзя (тест, стенд): серый корпус фонаря игры. */
const FALLBACK_MEAN = 0.42;

const hexSrgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(String(hex).slice(offset, offset + 2), 16) / 255);

/** Шейдер, лист и корзина меша модели игры — как `poleBodyShaders` ждёт их от `readDrawable`. */
export function partDescriptor(part) {
  const name = String(part?.material?.name || "");
  const cut = name.indexOf("|");
  const shader = cut < 0 ? name : name.slice(0, cut);
  const sheet = cut < 0 ? "" : name.slice(cut + 1);
  const material = part?.material || {};
  /* В GLB корзины нет: прозрачный материал — стекло, вырезанный — корзина 3, остальное — непрозрачное. */
  const renderBucket = material.transparent ? 2 : material.alphaTest > 0 ? 3 : 0;
  return { shader, renderBucket, emissive: false, textures: { diffuse: sheet } };
}

/**
 * Меши корпуса и метки их листов: `Map(часть → 1 | 2)` — метка листа в таблице слоёв партии (у столба лист
 * корпуса и лист плафона, у каждого своя средняя яркость) — и имена листов по меткам.
 */
export function bodySlots(parts) {
  const descriptors = (parts || []).map(partDescriptor);
  const slots = new Map();
  const sheets = [];
  for (const index of poleBodyShaders(descriptors)) {
    const sheet = String(descriptors[index].textures.diffuse).toLowerCase();
    let at = sheets.indexOf(sheet);
    if (at < 0) {
      sheets.push(sheet);
      at = sheets.length - 1;
    }
    slots.set(parts[index], Math.min(at + 1, 2));
  }
  return { slots, sheets };
}

/** Стекло лампы в GLB: светящийся шейдер, которого конвертер не знает по имени (`<unknown…>`), или `emissive`. */
export function isGlassPart(part) {
  return /^(<unknown|emissive)/i.test(partDescriptor(part).shader);
}

/**
 * Цвет стекла столба по работе: единичный цвет `[r, g, b]` (sRGB 0–1, максимум 1 — `unit` у `tintGlass`) или
 * `null`, когда установщик стекло не трогает («как в игре»). Тот же `compileLampModels`, что у установщика.
 */
export function livePoleGlass(models, project) {
  if (!Array.isArray(models) || !models.length) return null;
  const compiled = compileLampModels(models, project).find((item) => item.model === LIVE_POLE.piece);
  if (!compiled?.glass) return null;
  const { r, g, b } = hexToRgb(compiled.glass);
  const target = [r, g, b].map((channel) => channel / 255);
  const peak = Math.max(...target, 1e-6);
  return target.map((channel) => channel / peak);
}

/** Яркость листа 0–1 по его картинке (`poleSheetMean`); без картинки — серый корпус игры. */
export function sheetMean(texture) {
  const image = texture?.image;
  if (!image || !(image.width > 0) || typeof document === "undefined") return FALLBACK_MEAN;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return FALLBACK_MEAN;
    context.drawImage(image, 0, 0);
    return poleSheetMean(context.getImageData(0, 0, canvas.width, canvas.height).data) / 255;
  } catch {
    return FALLBACK_MEAN;
  }
}

/** Профиль столба по мешам модели: оси игры (Z вверх) из осей GLB (Y вверх): (x, y, z) → (x, −z, y). */
export function livePoleProfile(parts) {
  const meshes = [];
  const point = new THREE.Vector3();
  for (const part of parts || []) {
    const source = part.geometry?.attributes?.position;
    if (!source) continue;
    const positions = new Float32Array(source.count * 3);
    for (let index = 0; index < source.count; index += 1) {
      point.fromBufferAttribute(source, index).applyMatrix4(part.local);
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = -point.z;
      positions[index * 3 + 2] = point.y;
    }
    const indices = part.geometry.index ? part.geometry.index.array : Uint32Array.from({ length: source.count }, (_, index) => index);
    meshes.push({ positions, indices });
  }
  return poleProfile(meshTriangles(meshes));
}

/**
 * Краска и блеск столба кадра по разделу «Столб» работы: числа для шейдера сцены или `null`, когда этот
 * вид оставлен «как в игре» или менять нечего. Те же условия, что у `poleJobFor` контракта.
 */
export function livePaint(poleInput, means) {
  const kind = poleKindOf(LIVE_POLE.piece);
  const section = normalizePoleSection(poleInput);
  if (!kind || section.kinds[kind.id] === POLE_STOCK) return null;
  const colour = poleColourFor(section, kind.id);
  if (!colour && section.metal === 100 && section.opacity === 100) return null;
  /* Блеск: 100 — как в игре; меньше — матовее, больше — глянцевее и металличнее. */
  const gloss = Math.max(section.metal, 0) / 100;
  return {
    colour: colour ? hexSrgb(colour) : [1, 1, 1],
    keep: !colour,
    lift: colour ? section.shade / 100 : 1,
    opacity: Math.min(1, Math.max(0, section.opacity / 100)),
    means,
    roughness: 1 / Math.max(gloss, 0.35) ** 0.8,
    metal: Math.max(0, gloss - 1) * 0.25,
  };
}

/** Украшение — когда оно включено, вид столбов с украшениями и не «как в игре»; иначе `null`. */
export function liveDecor(poleInput) {
  const kind = poleKindOf(LIVE_POLE.piece);
  const section = normalizePoleSection(poleInput);
  if (!kind || !kind.decor || section.kinds[kind.id] === POLE_STOCK || !section.decor.on) return null;
  return section.decor;
}

/** Объекты сцены украшения по сетке `decorPreviewFor`: тело и огоньки, оси GLB (Y вверх). */
function decorObjects(preview) {
  const group = new THREE.Group();
  group.name = "lamp-live-pole-decor";
  const owned = [];
  for (const part of preview.parts) {
    const geometry = new THREE.BufferGeometry();
    const count = part.positions.length / 3;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      /* Оси игры (Z вверх) → оси GLB (Y вверх): (x, y, z) → (x, z, −y). */
      positions[index * 3] = part.positions[index * 3];
      positions[index * 3 + 1] = part.positions[index * 3 + 2];
      positions[index * 3 + 2] = -part.positions[index * 3 + 1];
      normals[index * 3] = part.normals[index * 3];
      normals[index * 3 + 1] = part.normals[index * 3 + 2];
      normals[index * 3 + 2] = -part.normals[index * 3 + 1];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(Float32Array.from(part.colours), 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(part.indices), 1));
    let material;
    if (part.role === "glow") {
      material = new THREE.MeshBasicMaterial({ vertexColors: true });
      /* Огоньки светят сами: цвет клетки листа на силу, с какой они светят в нарисованном кадре, в HDR кадра. */
      material.color.setScalar(Math.max(0.6, part.emissive * GLOW_BOOST));
    } else {
      material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = part.role !== "glow";
    mesh.receiveShadow = part.role !== "glow";
    group.add(mesh);
    owned.push(geometry, material);
  }
  return { group, owned };
}

/**
 * Живой столб кадра: `update(pole, glass)` — раздел «Столб» работы (краска, блеск, прозрачность, украшение) и цвет стекла,
 * `dispose()` — вернуть столбы как в игре. `scene` — кадр квартала (`block-scene.js`).
 */
export function createLivePole({ scene }) {
  let wanted = null;
  let disposed = false;
  let timer = 0;
  const started = Date.now();
  /* То, что готово, когда столб приехал: части, метки листов, средние яркости, профиль, номер экземпляра. */
  let ready = null;
  let decorGroup = null;
  let decorOwned = [];
  let decorKey = "";

  function prepare() {
    if (ready) return true;
    const parts = scene.pieceParts(LIVE_POLE.piece);
    if (!parts?.length) return false;
    const { slots, sheets } = bodySlots(parts);
    const means = [0, 1].map((at) => {
      const sheet = sheets[at];
      const part = [...slots.keys()].find((candidate) => String(partDescriptor(candidate).textures.diffuse).toLowerCase() === sheet);
      return part ? sheetMean(part.material.map) : FALLBACK_MEAN;
    });
    ready = {
      parts,
      slots,
      glass: new Set(parts.filter((part) => !slots.has(part) && isGlassPart(part))),
      means,
      profile: livePoleProfile(parts),
      instance: nearestInstance(scene.pieceMatrices(LIVE_POLE.piece)),
    };
    return true;
  }

  function clearDecor() {
    if (decorGroup) scene.removeObject(decorGroup);
    for (const item of decorOwned) item.dispose?.();
    decorGroup = null;
    decorOwned = [];
    decorKey = "";
  }

  function apply() {
    if (disposed || wanted === null || !prepare()) return false;
    const paint = livePaint(wanted.pole, ready.means);
    const glass = wanted.glass && ready.glass.size ? wanted.glass : null;
    scene.setPiecePaint(
      LIVE_POLE.piece,
      paint || glass
        ? { parts: (part) => (paint ? ready.slots.get(part) : 0) || (glass && ready.glass.has(part) ? 3 : 0), instances: "all", paint, glass }
        : null,
    );
    const decor = liveDecor(wanted.pole);
    const matrices = scene.pieceMatrices(LIVE_POLE.piece);
    const matrix = matrices[ready.instance];
    if (!decor || !ready.profile || !matrix) {
      clearDecor();
      return true;
    }
    const preview = decorPreviewFor(decor, ready.profile, `live:${LIVE_POLE.piece}`);
    const key = preview?.key || "";
    if (!preview) {
      clearDecor();
      return true;
    }
    if (key === decorKey && decorGroup) return true;
    clearDecor();
    const { group, owned } = decorObjects(preview);
    group.matrixAutoUpdate = false;
    group.matrix.copy(matrix);
    group.updateMatrixWorld(true);
    scene.addObject(group);
    decorGroup = group;
    decorOwned = owned;
    decorKey = key;
    return true;
  }

  function watch() {
    if (disposed || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      if (disposed) return;
      if (apply()) return;
      if (Date.now() - started < WATCH_MS) watch();
    }, RETRY_MS);
  }

  return {
    /** `pole` — раздел «Столб» работы, `glass` — цвет стекла (`livePoleGlass`) или `null`. */
    update(pole, glass = null) {
      wanted = { pole: pole ?? {}, glass };
      if (!apply()) watch();
    },
    /** Столб приехал и правка на нём применена. */
    get applied() {
      return Boolean(ready);
    },
    get instance() {
      return ready ? ready.instance : -1;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      clearDecor();
      if (ready) scene.setPiecePaint(LIVE_POLE.piece, null);
      ready = null;
    },
  };
}
