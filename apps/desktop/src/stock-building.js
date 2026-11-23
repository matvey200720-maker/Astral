/*
 * Штатное здание под полотном автора (владелец и ведущая, 13.11.2026: у ENEMY V2 в части мегамолла только полотно, самого здания в файлах нет — «здание штатное, возьми из игры»).
 *
 * Полотно автора (`kitsune_mall.ydr`) — оболочка из стен-картин вокруг штатного здания: карта части ставит её в мир, а здание остаётся игровым. Обложка без здания — одна полоса
 * с рисунком. Здание ищется в файлах игры не по имени («мегамолл»), а по тому, на чём висит полотно:
 *
 *   1. Полотно — оболочка: стен у него много, горизонтальных граней (крыши, пола) нет (`isShell`). Здание, поставленное автором целиком, оболочкой не считается — штатное под него не ищется.
 *   2. Модели игры вокруг места полотна читаются так же, как их читает сборка места (`world-place-scene.js`: карты, типы, высший уровень детализации). Кандидат — сущность, рамка
 *      типа которой в мире накрывает основание полотна.
 *   3. Из кандидатов берётся та модель, на стенах которой полотно висит: у каждой точки полотна ищется стена модели на 0–3 м позади (`wallSupport`). Земля, наклейки и соседи опоры не дают.
 *   4. Вокруг здания собирается мир из игры (`buildWorldPlaceMeshes`: здание, земля, парковка, соседи — как в игре), полотно автора кладётся на своё место (`mergeShopScenes`),
 *      главный фасад — по правилу `building-facade.js` на штатной модели.
 *
 * Чтение игры — только чтение файлов; игра не запускается.
 */

import { keysFromDirectory } from "@modovik/rpf7/node";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { placementTransform } from "@modovik/climb-contract/recolor/placement";
import { facadeOf, samplesOf, trianglesOf } from "./building-facade.js";
import { openGameIndex } from "./game-file-index.js";
import { modelParts, modelsScene } from "./mod-model-scene.js";
import { firstDrawable } from "./mod-place-scene.js";
import { facadeViews } from "./model-cover-plan.js";
import { encodeShopScene } from "./recolor-shops-scene.js";
import { buildWorldPlaceMeshes, worldReader } from "./world-place-scene.js";
import { mapsForPlace, modelInFrame, nearLevel } from "./world-place-rules.js";
import { readMapData, readMapTypes } from "./project-interiors/meta.js";

/** Оболочка: горизонтальных граней меньше этой доли площади стен, а стен не меньше этого числа м². */
const SHELL_FLAT_SHARE = 0.25;
const SHELL_MIN_WALL = 200;
/** Кандидат накрывает основание полотна с таким запасом, м. */
const COVER_SLACK = 2;
/** Сколько кандидатов читается целиком: самые тесные по основанию — первыми. */
const CANDIDATE_LIMIT = 10;
/** Полотно висит на стене модели: стена позади него на таких расстояниях, м (минус — стена чуть впереди, плюс — позади), и стена модели смотрит туда же (косинус). */
const SUPPORT_GAP = Object.freeze([-0.5, 3]);
const SUPPORT_FACING = 0.9;
/** Опора: доля площади полотна, лежащая на стене модели, не меньше этой. */
const SUPPORT_MIN = 0.4;
/** Мир вокруг здания — план-прямоугольник: рамка полотна и этот запас вокруг, м (парковка перед фасадом, соседи по краям); выше полотна берётся не больше этого запаса, м. */
const WORLD_MARGIN = 32;
const WORLD_ABOVE = 30;
/** Коробка кадров «со стороны» и «сверху»: здание с этим запасом вокруг, м. */
const SCOPE_MARGIN = 14;
/** Лист игры для здания и земли — до этой стороны, px (прежние 512 «мылили» стены на крупном кадре). */
export const STOCK_SHEET_SIZE = 1024;

const sizeOf = (box) => box.max.map((value, axis) => value - box.min[axis]);
const centreOf = (box) => box.min.map((value, axis) => (value + box.max[axis]) / 2);

/** Части в мире: вершины каждой сетки через `place` (точка модели → мир) минус `origin`. */
export function placedParts(parts, place, origin = [0, 0, 0]) {
  return parts.map((part) => {
    const positions = new Float32Array(part.positions.length);
    for (let at = 0; at < positions.length; at += 3) {
      const world = place([part.positions[at], part.positions[at + 1], part.positions[at + 2]]);
      positions[at] = world[0] - origin[0];
      positions[at + 1] = world[1] - origin[1];
      positions[at + 2] = world[2] - origin[2];
    }
    return { ...part, positions };
  });
}

/** Рамка частей: `{ min, max }`. */
export function boxOfParts(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts)
    for (let at = 0; at < positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[at + axis]);
        max[axis] = Math.max(max[axis], positions[at + axis]);
      }
  return { min, max };
}

/** Оболочка из стен-картин: стен достаточно, а горизонтальных граней (крыша, пол) почти нет. */
export function isShell(parts) {
  let [walls, flats] = [0, 0];
  for (const tri of trianglesOf(parts)) {
    if (Math.abs(tri.n[2]) < 0.3) walls += tri.area;
    else if (Math.abs(tri.n[2]) > 0.9) flats += tri.area;
  }
  return walls >= SHELL_MIN_WALL && flats < SHELL_FLAT_SHARE * walls;
}

/**
 * Какая доля площади полотна висит на стене модели здания (0…1). `canvas` и `building` — части в одних осях. Точка стены полотна опирается, если позади неё (на `SUPPORT_GAP` м)
 * есть стена здания, смотрящая туда же, и точка лежит в её треугольнике.
 */
export function wallSupport(canvas, building) {
  const walls = (parts) => trianglesOf(parts).filter((tri) => Math.abs(tri.n[2]) < 0.3);
  const behind = walls(building);
  const cell = 8;
  const buckets = new Map();
  for (const tri of behind) {
    const xs = [tri.a[0], tri.b[0], tri.c[0]];
    const ys = [tri.a[1], tri.b[1], tri.c[1]];
    for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i += 1)
      for (let j = Math.floor(Math.min(...ys) / cell); j <= Math.floor(Math.max(...ys) / cell); j += 1) {
        const key = `${i}|${j}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(tri);
      }
  }
  const inside = (tri, point) => {
    const sub = (left, right) => [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
    const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
    const [first, second, from] = [sub(tri.b, tri.a), sub(tri.c, tri.a), sub(point, tri.a)];
    const [d00, d01, d11, d20, d21] = [dot(first, first), dot(first, second), dot(second, second), dot(from, first), dot(from, second)];
    const denominator = d00 * d11 - d01 * d01;
    if (Math.abs(denominator) < 1e-12) return false;
    const [u, v] = [(d11 * d20 - d01 * d21) / denominator, (d00 * d21 - d01 * d20) / denominator];
    const slack = 0.02;
    return u >= -slack && v >= -slack && u + v <= 1 + slack;
  };
  let [held, total] = [0, 0];
  for (const tri of walls(canvas)) {
    const { points, weight } = samplesOf(tri, 3);
    for (const point of points) {
      total += weight;
      const [ci, cj] = [Math.floor(point[0] / cell), Math.floor(point[1] / cell)];
      /* Соседние клетки тоже: стена на границе клетки и точка перед ней могут лежать в разных. */
      const near = [-1, 0, 1].flatMap((di) => [-1, 0, 1].flatMap((dj) => buckets.get(`${ci + di}|${cj + dj}`) || []));
      const rest = near.some((wall) => {
        if (wall.n[0] * tri.n[0] + wall.n[1] * tri.n[1] + wall.n[2] * tri.n[2] < SUPPORT_FACING) return false;
        const gap = (point[0] - wall.a[0]) * wall.n[0] + (point[1] - wall.a[1]) * wall.n[1] + (point[2] - wall.a[2]) * wall.n[2];
        if (gap < SUPPORT_GAP[0] || gap > SUPPORT_GAP[1]) return false;
        return inside(wall, [point[0] - wall.n[0] * gap, point[1] - wall.n[1] * gap, point[2] - wall.n[2] * gap]);
      });
      if (rest) held += weight;
    }
  }
  return total > 0 ? held / total : 0;
}

/** Рамка типа в мире: восемь углов `bbMin`/`bbMax` через место сущности. */
export function worldBox(archetype, place) {
  const [low, high] = [archetype.bbMin, archetype.bbMax];
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((bits) => place([bits & 1 ? high[0] : low[0], bits & 2 ? high[1] : low[1], bits & 4 ? high[2] : low[2]]));
  return { min: [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]))), max: [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]))) };
}

/** Накрывает ли рамка `outer` основание `inner` (по земле с запасом, по высоте — пересекается). */
export const coversBase = (outer, inner, slack = COVER_SLACK) =>
  [0, 1].every((axis) => outer.min[axis] <= inner.min[axis] + slack && outer.max[axis] >= inner.max[axis] - slack) && outer.min[2] < inner.max[2] && outer.max[2] > inner.min[2];

/** Читает drawable высшего уровня модели игры (`name.ydr`/`name.yft`) или `null`. */
async function readModel(index, name) {
  for (const ext of ["ydr", "yft"]) {
    const at = index.lookup(`${name}.${ext}`);
    if (!at) continue;
    try {
      const bytes = await index.read(at);
      if (!bytes) continue;
      const drawable = readDrawable(openResourceWith(new Uint8Array(bytes), inflateResource), { inflateRaw: inflateResource, kind: ext }).drawables[0];
      if (drawable) return drawable;
    } catch {
      /* модель не читается — не кандидат */
    }
  }
  return null;
}

/**
 * Модель игры, на стенах которой висит полотно: `{ name, entity, place, support, parts }` (части — в мире) или `null`. `canvas` — `{ parts, box }` в мире.
 */
export async function findStockBuilding(world, canvas, { log = () => {} } = {}) {
  const { index, typeNames, maps, nameOf } = world;
  const centre = centreOf(canvas.box);
  const reach = Math.hypot(...sizeOf(canvas.box).slice(0, 2)) / 2 + 20;
  const wanted = mapsForPlace(maps, [centre[0], centre[1]], reach);
  const types = new Map();
  for (const name of new Set(wanted.flatMap((map) => map.types.map((id) => typeNames[id])))) {
    const at = index.lookup(`${name}.ytyp`);
    if (!at) continue;
    try {
      for (const archetype of readMapTypes(await index.read(at)).archetypes) if (!types.has(archetype.name >>> 0)) types.set(archetype.name >>> 0, archetype);
    } catch {
      /* чужой файл типов — без него */
    }
  }
  const found = [];
  for (const map of wanted) {
    const at = index.lookup(`${map.name}.ymap`);
    if (!at) continue;
    let data = null;
    try {
      data = readMapData(await index.read(at));
    } catch {
      continue;
    }
    for (const entity of data.entities) {
      if (!nearLevel(entity.lodLevel)) continue;
      const archetype = types.get(entity.archetype >>> 0);
      if (!archetype || archetype.mlo || !archetype.bbMin || !archetype.bbMax) continue;
      const place = placementTransform(entity);
      const box = worldBox(archetype, place);
      if (!coversBase(box, canvas.box)) continue;
      const name = nameOf(archetype.assetName || entity.archetype, "ydr") || nameOf(archetype.assetName || entity.archetype, "yft") || nameOf(entity.archetype, "ydr") || nameOf(entity.archetype, "yft");
      if (!name || !modelInFrame(name)) continue;
      found.push({ name, entity, place, box, base: (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) });
    }
  }
  found.sort((left, right) => left.base - right.base);
  log(`кандидатов под полотном: ${found.length}${found.length ? ` (${found.slice(0, CANDIDATE_LIMIT).map((item) => item.name).join(", ")})` : ""}`);
  let best = null;
  const seen = new Set();
  for (const candidate of found.slice(0, CANDIDATE_LIMIT)) {
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    const drawable = await readModel(index, candidate.name);
    if (!drawable) continue;
    const parts = placedParts(modelParts(drawable), candidate.place);
    const support = wallSupport(canvas.parts, parts);
    log(`  ${candidate.name}: опора ${(support * 100).toFixed(0)} %`);
    if (support >= SUPPORT_MIN && (!best || support > best.support)) best = { name: candidate.name, entity: candidate.entity, place: candidate.place, support, parts };
  }
  return best;
}

/** Две сцены `{ bounds, parts, materials, textures, meshes }` — одной: листы и материалы второй идут следом, её сетки — отдельной частью. */
export function mergeShopScenes(base, extra) {
  const part = base.parts.length;
  const [materialShift, textureShift] = [base.materials.length, base.textures.length];
  const bounds = {
    min: base.bounds.min.map((value, axis) => Math.min(value, extra.bounds.min[axis])),
    max: base.bounds.max.map((value, axis) => Math.max(value, extra.bounds.max[axis])),
  };
  return {
    ...base,
    bounds,
    parts: [...base.parts, ...extra.parts.map((one) => ({ ...one }))],
    materials: [...base.materials, ...extra.materials.map((material) => ({ ...material, id: `mod:${material.id}`, ...(Number.isInteger(material.texture) ? { texture: material.texture + textureShift } : {}) }))],
    textures: [...base.textures, ...extra.textures],
    meshes: [...base.meshes, ...extra.meshes.map((mesh) => ({ ...mesh, material: mesh.material + materialShift, part }))],
  };
}

/**
 * Обложка из файлов игры и полотна автора. `overlay` — `{ name, bytes, entity }`: модель части и место, где её ставит карта (`entity` — `{ position, rotation, scale }`); `files` — файлы
 * моделей части для листов полотна; `source` — `{ root, keys }` игры. Ответ — `null` (нечего показать честно: полотно не оболочка, здание не нашлось) или
 * `{ bytes, textures, sheets, plan, building, report }`: сцена ARS1, записи листов игры (`textures`), готовые листы полотна (`sheets`), план кадров (`view`, `views`, `facade`) и сведения.
 */
export async function stockBuildingCover({ overlay, files, source, indexFile = null, log = () => {} }) {
  const entity = { position: overlay.entity.position, rotation: overlay.entity.rotation, scaleXY: overlay.entity.scale?.[0] ?? 1, scaleZ: overlay.entity.scale?.[1] ?? 1 };
  const identity = entity.rotation.slice(0, 3).every((value) => value === 0) && entity.rotation[3] === 1 && entity.scaleXY === 1 && entity.scaleZ === 1;
  /* Полотно с поворотом или размером кладётся по тем же правилам, но проверено только на прямом: честнее не показывать, чем показать криво. */
  if (!identity) return { reason: "полотно поставлено с поворотом или размером — кадр со зданием из игры для такого не собирается" };
  const drawable = firstDrawable(overlay.bytes);
  if (!drawable) return { reason: "полотно не читается" };
  const place = placementTransform(entity);
  const canvasParts = placedParts(modelParts(drawable), place);
  if (!isShell(canvasParts)) return { reason: "модель части не оболочка-полотно: здание из игры под неё не ищется" };
  const box = boxOfParts(canvasParts);
  const keys = await keysFromDirectory(source.keys || "");
  const index = await openGameIndex(source.root, { keys, cacheFile: indexFile, log });
  try {
    const world = worldReader(index);
    const found = await findStockBuilding(world, { parts: canvasParts, box }, { log });
    if (!found) return { reason: "здание, на стене которого висит полотно, в файлах игры не нашлось" };
    const centre = centreOf(box);
    const origin = [Math.round(centre[0] * 10) / 10, Math.round(centre[1] * 10) / 10, Math.round(box.min[2] * 10) / 10];
    const reach = Math.round(Math.hypot(...sizeOf(box).slice(0, 2)) / 2 + WORLD_MARGIN * 1.5);
    const [x0, y0, x1, y1] = [box.min[0] - WORLD_MARGIN - origin[0], box.min[1] - WORLD_MARGIN - origin[1], box.max[0] + WORLD_MARGIN - origin[0], box.max[1] + WORLD_MARGIN - origin[1]];
    const plan = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const built = await buildWorldPlaceMeshes({ origin, reach, plan, top: box.max[2] - origin[2] + WORLD_ABOVE }, world, { log });
    if (!built.meshes.length) return { reason: "вокруг полотна файлов игры не нашлось" };
    const lifted = await modelsScene({
      files,
      plan: { items: [{ name: overlay.name, at: [entity.position[0] - origin[0], entity.position[1] - origin[1]], ground: -(entity.position[2] - origin[2]), exact: true }] },
      asScene: true,
    });
    if (!lifted?.scene) return { reason: "полотно не собралось в сцену" };
    const merged = mergeShopScenes(built, lifted.scene);
    const bytes = encodeShopScene(merged, { level: 4 });
    const building = placedParts(found.parts, (point) => point, origin);
    const facade = facadeOf(building);
    const around = boxOfParts(building);
    const scope = { min: around.min.map((value) => value - SCOPE_MARGIN), max: around.max.map((value) => value + SCOPE_MARGIN) };
    const views = facade ? facadeViews(facade, 0, { scope }) : null;
    return {
      bytes,
      textures: merged.textures.filter((texture) => texture.game),
      sheets: lifted.sheets,
      plan: { layout: "assembly", items: [], view: { yaw: -0.9, pitch: 0.5, crop: true, zoom: 0.9, bounds: scope }, ...views },
      building: { name: found.name, support: found.support },
      report: built.report,
    };
  } finally {
    await index.close?.().catch(() => {});
  }
}
