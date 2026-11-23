/*
 * Место мира по координатам — сцена 3D-кадра из игры игрока (ТЗ владельца 01.11.2026: «чтобы там рисовалось это здание, этот ландшафт, и человек мог
 * пролетать… один в один, без размазанных и дырявых текстур»).
 *
 * Прежде кусок местности собирал скрипт подготовки в поставку (`prepare-zones-territory.mjs`, по мегабайту на место) и ужимал сетки: здания рассыпались на
 * осколки с чёрными дырами. Здесь — как у «Интерьеров» (`recolor-shops-scene.js`): сцену собирает Astral Desktop на машине игрока, из его файлов и целиком,
 * без ужатия, и держит в своём кэше; в поставке Rockstar нет ни сетки, ни листа. Ответ — тот же файл `ARS1`, что читает общий кадр.
 *
 *   1. Какие карты задевают круг — оглавление `world-place-table.js` (имя и рамка; читать все десять тысяч карт — минуты).
 *   2. Карты и типы читаются действующей копией по имени (`game-file-index.js`: правка дополнения → дополнение → update → база) — так, как их видит игра.
 *   3. Сущности — HD и ORPHANHD (`world-place-rules.js`), крупные плиты земли ищутся дальше круга; экземпляры интерьеров у середины — с их вещами.
 *   4. Сетки — высший уровень детализации, материал — как его рисует игра (`shopMaterialClass`, земля — четыре слоя с маской), лист — где его ищет игра:
 *      зашитый в модель, её `+hidr`, словарь архетипа и выше по `gtxd`, у каждого — `+hi` раньше обычного.
 *   5. Сетки одного материала клеятся по клеткам плана: кадр не рисует то, что вне взгляда, и не платит вызовом за каждую сущность.
 *   6. Вода — плоскости `water.xml`: у моря в игре моделей нет, и подпись кадра говорит, что поверхность показана плоскостью.
 *   7. Обвод бизвара, ВЗХ или порта (`outline`) — обе линии целиком, из файлов набора рядом с приложением: в сцене зон поставки лежит только его угол.
 *   8. План (`plan`, `top`; ТЗ владельца 02.11.2026: «в двух метрах от зелёной зоны уже можешь делать черноту») — только сущности и треугольники, что задевают многоугольник
 *      и не выше потолка: у зелёной зоны это десятки моделей вместо тысяч сущностей круга. Дальше режет кадр.
 *
 * Дыры в кварталах (02.11.2026): их давало прежнее ужатие сцены — высокие сетки у края круга выбрасывались, треугольник судился по середине. Покрытие сверху на круге магазина: пусто 12,8 % клеток
 * до, 0,0 % после. Ни сеток, ни треугольников, что задевают сцену, сборка больше не выбрасывает.
 *
 * Начало сцены — точка `origin`, что дала просьба: так кадр знает, куда положить зоны, не читая ответ.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { decodeTextureRef, joaat, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { TERRAIN_WEIGHTS, terrainWeights } from "@modovik/rage-drawable/terrain-weights";
import { inflateResource } from "@modovik/native-rs";
import { isShadowProxy, mloInstanceTransform, placementRotation, placementTransform } from "@modovik/climb-contract/recolor/placement";
import { ZONES } from "@modovik/climb-contract/recolor/zones";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { openGameIndex } from "./game-file-index.js";
import { mloEntities, readMapData, readMapTypes } from "./project-interiors/meta.js";
import { diffuseOf, drawableRootAt, encodeShopScene, entityDrawnInView, shaderFileName, shaderVectors, shopMaterialClass } from "./recolor-shops-scene.js";
import { BIG_LOD_DIST, entityInReach, entityKey, entityTouchesPlan, mapsForPlace, modelInFrame, nearLevel, parseTxdParents, parseWorldMaps, planPoints, planShape, triangleTouchesPlan } from "./world-place-rules.js";
import { WORLD_MAPS, WORLD_TXD_PARENTS, WORLD_TYPES } from "./world-place-table.js";

/* Меняется, когда меняется сборка места: кэш у игроков собирается заново. */
export const WORLD_PLACE_BUILDER = 8;

const inflateRaw = inflateResource;
/* Круг места: предел запроса, м (самая большая зона — 770 м в длину; у зоны с планом круг — только рамка плана). */
export const PLACE_REACH = Object.freeze([3, 720]);
/* Карта игры с запасом: дальше просить нечего. */
const WORLD_LIMIT = 9000;
/* Треугольник берётся, если его рамка задевает круг на столько шире (м): край круга кадр гасит сам. */
const TRIM = 16;
/* План: метро и подвалы на столько ниже зоны (м) с земли не видны, а вершин в них, как в квартале. */
const PLAN_BELOW = 30;
/* Клетка склейки сеток (м) и предел вершин одной сетки кадра. */
const CELL = 96;
const MESH_VERTICES = 60_000;
/* Предел вершин сцены: дальше — вещи мельче и дальше от середины уступают (плиты земли, дома и дороги — никогда). */
const VERTEX_BUDGET = 4_500_000;
/* Интерьеры: вещи внутри — только у экземпляров не дальше стольких метров от середины и не больше стольких экземпляров: сквозь стёкла и двери. */
const INTERIOR_REACH = 180;
const INTERIOR_LIMIT = 12;
const INTERIOR_HEIGHT = 30;
/* Реквизит: модель повторяется столько раз и стоит дальше стольких метров от середины — дальним уровнем игры. */
const REPEATED_MODEL = 6;
const PROP_NEAR = 110;
/* Сколько сцен помнит кэш: одна сцена — десятки мегабайт. */
const CACHE_SCENES = 14;

/* Самплеры слоёв земли и маски смешения (`TextureSampler_layer1…3`, `lookupSampler`). */
const LAYER_SAMPLERS = Object.freeze([606121937, 831736502, 2025281789]);
const MASK_SAMPLER = 2295086480;
const PALETTE_SAMPLER = joaat("TintPaletteSampler") >>> 0;
const UV0 = joaat("globalAnimUV0") >>> 0;
const UV1 = joaat("globalAnimUV1") >>> 0;
/* «Изолента» Rockstar прячет свет в щелях, ночные наклейки днём не видны. */
const HIDDEN_TEXTURE = /ducttape/;
const NIGHT_ONLY = /^(decal_emissive_only|decal_emissivenight_only|emissive_additive_alpha|emissive_additive_uv_alpha)$/;
/* Шейдеры, что кадр не рисует (трава-мех, биллборды, персонажи). Хеши незнакомых шейдеров сюда не попадают: их решает корзина. */
const NOT_SHADER = /(grass|fur|billboard|ped_)/i;

const WATER_ARCHIVE = "common.rpf";
const WATER_FILE = "data/levels/gta5/water.xml";
const WATER_COLOUR = "#2f6f95";
const WATER_OPACITY = 0.6;

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function meanColour(rgba) {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = Math.max(1, rgba.length / 4);
  for (let at = 0; at < rgba.length; at += 4) {
    r += rgba[at];
    g += rgba[at + 1];
    b += rgba[at + 2];
  }
  return `#${[r, g, b].map((value) => Math.round(value / count).toString(16).padStart(2, "0")).join("")}`;
}

/* Матрица места сущности: точка модели → мир (3×4), `turn` — поворот нормали (3×3). Точка на вершину через функцию здесь стоила бы миллионов массивов. */
function matrixOf(place) {
  const o = place([0, 0, 0]);
  const x = place([1, 0, 0]);
  const y = place([0, 1, 0]);
  const z = place([0, 0, 1]);
  return [x[0] - o[0], y[0] - o[0], z[0] - o[0], o[0], x[1] - o[1], y[1] - o[1], z[1] - o[1], o[1], x[2] - o[2], y[2] - o[2], z[2] - o[2], o[2]];
}
function turnOf(turn) {
  const x = turn([1, 0, 0]);
  const y = turn([0, 1, 0]);
  const z = turn([0, 0, 1]);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/**
 * Сетка модели на месте сущности, в осях сцены (Y-вверх `rage-drawable` → Z-вверх игры, минус начало сцены). Вершины вне места отсекаются по треугольникам:
 * `area` — радиус круга или план (`planShape`), `floor` и `top` — ниже и выше этих высот треугольник не берётся.
 * Ответ — `{ positions, normals, uvs, uvs1, colours, colours1, indices, centre }` или `null`, если на месте ничего нет.
 */
export function placeMesh(mesh, matrix, turn, origin, area, floor = -Infinity, top = Infinity) {
  const count = mesh.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const source = mesh.positions;
  const sourceNormals = mesh.normals;
  for (let at = 0; at < count; at += 1) {
    const mx = source[at * 3];
    const my = -source[at * 3 + 2];
    const mz = source[at * 3 + 1];
    positions[at * 3] = matrix[0] * mx + matrix[1] * my + matrix[2] * mz + matrix[3] - origin[0];
    positions[at * 3 + 1] = matrix[4] * mx + matrix[5] * my + matrix[6] * mz + matrix[7] - origin[1];
    positions[at * 3 + 2] = matrix[8] * mx + matrix[9] * my + matrix[10] * mz + matrix[11] - origin[2];
    /* У листвы игры нормалей часто нет (её свет — свой шейдер): без нормали вершина смотрит вверх, а не чернеет. */
    normals[at * 3 + 2] = 1;
    if (sourceNormals) {
      const nx = sourceNormals[at * 3];
      const ny = -sourceNormals[at * 3 + 2];
      const nz = sourceNormals[at * 3 + 1];
      const wx = turn[0] * nx + turn[1] * ny + turn[2] * nz;
      const wy = turn[3] * nx + turn[4] * ny + turn[5] * nz;
      const wz = turn[6] * nx + turn[7] * ny + turn[8] * nz;
      const size = Math.hypot(wx, wy, wz);
      if (size > 1e-4) {
        normals[at * 3] = wx / size;
        normals[at * 3 + 1] = wy / size;
        normals[at * 3 + 2] = wz / size;
      }
    }
  }
  /* Отсечение — по всему треугольнику, не по середине: большой треугольник земли или стены с серединой снаружи оставлял дыру внутри. Лишнее гасит кадр. */
  const indices = mesh.indices;
  const plan = typeof area === "number" ? null : area;
  const limit = plan ? 0 : area * area;
  const kept = [];
  const used = new Int32Array(count).fill(-1);
  let vertices = 0;
  let sumX = 0;
  let sumY = 0;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at];
    const b = indices[at + 1];
    const c = indices[at + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    if (positions[a * 3 + 2] < floor && positions[b * 3 + 2] < floor && positions[c * 3 + 2] < floor) continue;
    if (positions[a * 3 + 2] > top && positions[b * 3 + 2] > top && positions[c * 3 + 2] > top) continue;
    if (plan) {
      if (!triangleTouchesPlan(plan, ax, ay, bx, by, cx, cy)) continue;
    } else {
      const dx = Math.max(Math.min(ax, bx, cx), 0, -Math.max(ax, bx, cx));
      const dy = Math.max(Math.min(ay, by, cy), 0, -Math.max(ay, by, cy));
      if (dx * dx + dy * dy > limit) continue;
    }
    for (const index of [a, b, c]) {
      if (used[index] < 0) {
        used[index] = vertices;
        vertices += 1;
        sumX += positions[index * 3];
        sumY += positions[index * 3 + 1];
      }
      kept.push(used[index]);
    }
  }
  if (!kept.length) return null;
  const whole = vertices === count;
  const pick = (array, size) => {
    if (!array) return null;
    const type = array instanceof Float32Array ? Float32Array : array.constructor;
    if (whole) return new type(array);
    const out = new type(vertices * size);
    for (let index = 0; index < count; index += 1) {
      const slot = used[index];
      if (slot < 0) continue;
      for (let part = 0; part < size; part += 1) out[slot * size + part] = array[index * size + part];
    }
    return out;
  };
  return {
    positions: whole ? positions : pick(positions, 3),
    normals: whole ? normals : pick(normals, 3),
    uvs: pick(mesh.uvs, 2),
    uvs1: pick(mesh.uvs1, 2),
    colours: pick(mesh.colours, 4),
    colours1: pick(mesh.colours1, 4),
    indices: Uint32Array.from(kept),
    centre: [sumX / vertices, sumY / vertices],
  };
}

/* Сетки одной клетки — одной: индексы со сдвигом, недостающие развёртки и цвета — нули и белый. */
export function joinMeshes(list) {
  if (list.length === 1) return list[0];
  const vertices = list.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const indexCount = list.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = list.some((mesh) => mesh.uvs) ? new Float32Array(vertices * 2) : null;
  const uvs1 = list.some((mesh) => mesh.uvs1) ? new Float32Array(vertices * 2) : null;
  const colours = list.some((mesh) => mesh.colours) ? new Float32Array(vertices * 4).fill(1) : null;
  const indices = new Uint32Array(indexCount);
  let vertex = 0;
  let index = 0;
  for (const mesh of list) {
    positions.set(mesh.positions, vertex * 3);
    normals.set(mesh.normals, vertex * 3);
    if (uvs && mesh.uvs) uvs.set(mesh.uvs, vertex * 2);
    if (uvs1 && mesh.uvs1) uvs1.set(mesh.uvs1, vertex * 2);
    if (colours && mesh.colours) colours.set(mesh.colours, vertex * 4);
    for (let at = 0; at < mesh.indices.length; at += 1) indices[index + at] = mesh.indices[at] + vertex;
    vertex += mesh.positions.length / 3;
    index += mesh.indices.length;
  }
  return { positions, normals, uvs, uvs1, colours, indices };
}

function boundsOf(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let at = 0; at < mesh.positions.length; at += 1) {
      const axis = at % 3;
      if (mesh.positions[at] < min[axis]) min[axis] = mesh.positions[at];
      if (mesh.positions[at] > max[axis]) max[axis] = mesh.positions[at];
    }
  return Number.isFinite(min[0]) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Квады воды `water.xml`: `[{ minX, maxX, minY, maxY, z }]`. */
export function parseWaterQuads(text) {
  const quads = [];
  for (const block of String(text || "").match(/<Item>[\s\S]*?<\/Item>/g) || []) {
    const value = (name) => Number(new RegExp(`<${name} value="([^"]+)"`).exec(block)?.[1]);
    const quad = { minX: value("minX"), maxX: value("maxX"), minY: value("minY"), maxY: value("maxY"), z: value("z") };
    if (Object.values(quad).every(Number.isFinite) && !/<IsInvisible value="true"/.test(block)) quads.push(quad);
  }
  return quads;
}

/* Плоскости воды в круге: квад обрезается по рамке круга. Вершины — углы квадов и сетка в 24 м, чтобы круг кадра обрезал край плавно. */
export function waterMesh(quads, origin, reach) {
  const positions = [];
  const indices = [];
  for (const quad of quads) {
    const x0 = Math.max(quad.minX - origin[0], -reach);
    const x1 = Math.min(quad.maxX - origin[0], reach);
    const y0 = Math.max(quad.minY - origin[1], -reach);
    const y1 = Math.min(quad.maxY - origin[1], reach);
    if (x1 <= x0 || y1 <= y0) continue;
    const z = quad.z - origin[2];
    const base = positions.length / 3;
    positions.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (!positions.length) return null;
  const normals = new Float32Array(positions.length);
  for (let at = 2; at < normals.length; at += 3) normals[at] = 1;
  return { positions: Float32Array.from(positions), normals, uvs: null, indices: Uint32Array.from(indices) };
}

/**
 * Чтение мира для сборки: оглавление и таблица один раз на поток. `read(адрес)` — байты файла игры.
 * `names` — имена файлов игры (для поиска модели по хешу имени).
 */
export function worldReader(index) {
  const fileNames = new Map();
  for (const name of index.names()) {
    const match = /^(.+)\.(ydr|yft|ydd|ytd|ytyp|ymap)$/.exec(name);
    if (!match) continue;
    const hash = joaat(match[1]) >>> 0;
    const known = fileNames.get(hash) || {};
    known[match[2]] = match[1];
    fileNames.set(hash, known);
  }
  const typeNames = WORLD_TYPES.split("|");
  const maps = parseWorldMaps(WORLD_MAPS);
  const parents = parseTxdParents(WORLD_TXD_PARENTS);
  const parentNames = new Map();
  for (const [child, parent] of parents) {
    parentNames.set(joaat(child) >>> 0, child);
    parentNames.set(joaat(parent) >>> 0, parent);
  }
  return {
    index,
    typeNames,
    maps,
    parents,
    nameOf: (hash, ext) => fileNames.get(hash >>> 0)?.[ext] || null,
    txdNameOf: (hash) => fileNames.get(hash >>> 0)?.ytd || parentNames.get(hash >>> 0) || null,
  };
}

/**
 * Сцена места: `{ origin: [x, y, z], reach, plan?, top? }` в осях игры; с `plan` — только то, что задевает этот многоугольник (`world-place-rules.js`) и лежит не выше `top` м над началом сцены. Ответ — `{ bounds, parts, materials, textures, meshes, report }` как у `recolor-shops-scene.js`.
 */
export async function buildWorldPlaceMeshes({ origin, reach, plan = null, top = Infinity, outline = "", zonesRoot = "" }, world, { log = () => {} } = {}) {
  const { index, nameOf, txdNameOf, parents, typeNames } = world;
  const started = Date.now();
  const lap = (label, since) => log(`${label}: ${Date.now() - since} мс`);
  const centre = [origin[0], origin[1]];
  const shape = plan ? planShape(plan) : null;
  const area = shape || reach + TRIM;
  const floor = shape ? -PLAN_BELOW : -Infinity;
  const report = { maps: 0, types: 0, entities: 0, interiors: 0, models: 0, missingModels: 0, noColour: 0, sheets: 0, missingSheets: 0, dropped: 0, vertices: 0, triangles: 0, meshes: 0, water: false, ms: {} };

  /* Карты и типы — действующими копиями. */
  let since = Date.now();
  const wanted = mapsForPlace(world.maps, centre, reach);
  const types = new Map();
  const typeFiles = new Set();
  for (const map of wanted) for (const id of map.types) typeFiles.add(typeNames[id]);
  for (const name of typeFiles) {
    const at = index.lookup(`${name}.ytyp`);
    if (!at) continue;
    try {
      const bytes = await index.read(at);
      if (!bytes) continue;
      for (const archetype of readMapTypes(bytes).archetypes) {
        const key = archetype.name >>> 0;
        if (!types.has(key)) types.set(key, archetype);
      }
      report.types += 1;
    } catch {
      /* чужой файл типов — без него */
    }
  }
  report.ms.types = Date.now() - since;
  lap("типы", since);

  since = Date.now();
  const picked = new Map();
  const interiors = [];
  const take = (entity, archetype, place, turn, tint) => {
    const hash = entity.archetype >>> 0;
    const name = nameOf(archetype?.assetName || hash, "ydr") || nameOf(archetype?.assetName || hash, "yft") || nameOf(hash, "ydr") || nameOf(hash, "yft");
    if (!name || !modelInFrame(name)) return;
    if (!entityDrawnInView(entity.flags)) return;
    if (isShadowProxy(archetype)) return;
    const worldPoint = place([0, 0, 0]);
    if (shape && !entityTouchesPlan(shape, origin, archetype, place, worldPoint)) return;
    const key = entityKey(name, worldPoint);
    const previous = picked.get(key);
    if (previous && !(name.startsWith("hei_") && !previous.name.startsWith("hei_"))) return;
    picked.set(key, { name, archetype, matrix: matrixOf(place), turn: turnOf(turn), tint, lodDist: archetype?.lodDist || 0, distance: Math.hypot(worldPoint[0] - centre[0], worldPoint[1] - centre[1]) });
  };
  for (const map of wanted) {
    const at = index.lookup(`${map.name}.ymap`);
    if (!at) continue;
    let data = null;
    try {
      data = readMapData(await index.read(at));
    } catch {
      continue;
    }
    report.maps += 1;
    for (const entity of data.entities) {
      if (!nearLevel(entity.lodLevel)) continue;
      const archetype = types.get(entity.archetype >>> 0) || null;
      if (!entityInReach(entity.position, archetype?.lodDist || 0, centre, reach)) continue;
      if (archetype?.mlo) {
        if (shape && !entityTouchesPlan(shape, origin, archetype, mloInstanceTransform(entity), entity.position)) continue;
        interiors.push({ entity, archetype, distance: Math.hypot(entity.position[0] - centre[0], entity.position[1] - centre[1]) });
        continue;
      }
      take(entity, archetype, placementTransform(entity), placementRotation(entity), entity.tintValue);
    }
  }
  /* Интерьеры у середины: сквозь витрины и двери видно, что внутри (без них — чёрная пустота за стеклом). */
  interiors.sort((a, b) => a.distance - b.distance);
  for (const { entity: instance, archetype, distance } of interiors.slice(0, INTERIOR_LIMIT)) {
    if (distance > INTERIOR_REACH) break;
    /* Подземные и подвешенные интерьеры дополнений (склады и бункеры под портом на глубине −39 м) с улицы не видны. */
    if (Math.abs(instance.position[2] - origin[2]) > INTERIOR_HEIGHT) continue;
    report.interiors += 1;
    const outer = mloInstanceTransform(instance);
    for (const child of mloEntities(archetype)) {
      const childType = types.get(child.archetype >>> 0) || null;
      const inner = placementTransform(child);
      const turnInner = placementRotation(child);
      const turnOuter = placementRotation({ ...instance, rotation: instance.rotation[3] === 1 && !instance.rotation[0] && !instance.rotation[1] && !instance.rotation[2] ? [0, 0, 0, 1] : [-instance.rotation[0], -instance.rotation[1], -instance.rotation[2], instance.rotation[3]] });
      take(child, childType, (point) => outer(inner(point)), (vector) => turnOuter(turnInner(vector)), child.tintValue);
    }
  }
  report.entities = picked.size;
  report.ms.maps = Date.now() - since;
  lap(`карты ${report.maps}, сущностей ${picked.size}, интерьеров ${report.interiors}`, since);

  /* Модели: все места одной модели подряд — модель читается один раз и сразу отпускается. */
  since = Date.now();
  const byModel = new Map();
  for (const item of picked.values()) {
    if (!byModel.has(item.name)) byModel.set(item.name, []);
    byModel.get(item.name).push(item);
  }
  /* Словари: кэш на сборку. */
  const dictionaries = new Map();
  const dictionary = async (file) => {
    if (dictionaries.has(file)) return dictionaries.get(file);
    const at = index.lookup(file);
    let found = null;
    if (at)
      try {
        const refs = readTextureDictionary(openResourceWith(new Uint8Array(await index.read(at)), inflateRaw));
        found = { at, refs: new Map(refs.map((ref) => [ref.name.toLowerCase(), ref])) };
      } catch {
        found = null;
      }
    dictionaries.set(file, found);
    return found;
  };
  /* Лист — где его ищет игра; у каждого словаря сперва его `+hi`: без него лист в разы мельче, и кадр «мылит». */
  const locateCache = new Map();
  const locate = async (texture, model) => {
    const key = `${model.name}|${model.txd}|${texture}`;
    if (locateCache.has(key)) return locateCache.get(key);
    let result = null;
    for (const suffix of ["+hidr", "+hifr"]) {
      const hi = await dictionary(`${model.name}${suffix}.ytd`);
      const ref = hi?.refs.get(texture);
      if (ref) {
        result = { at: hi.at, ref };
        break;
      }
    }
    if (!result) {
      const embedded = model.embedded?.get(texture);
      if (embedded) result = { at: model.at, ref: embedded };
    }
    if (!result) {
      let txd = model.txd ? txdNameOf(model.txd) : null;
      const seen = new Set();
      while (txd && !seen.has(txd) && !result) {
        seen.add(txd);
        for (const file of [`${txd}+hi.ytd`, `${txd}.ytd`]) {
          const found = await dictionary(file);
          const ref = found?.refs.get(texture);
          if (ref) {
            result = { at: found.at, ref };
            break;
          }
        }
        txd = parents.get(txd) || null;
      }
    }
    locateCache.set(key, result);
    return result;
  };
  const textures = [];
  const textureIndex = new Map();
  const colours = new Map();
  const colourOf = (where) => {
    const key = `${where.at}|${where.ref.name}`;
    if (!colours.has(key)) {
      let value = "#8b7d61";
      try {
        value = meanColour(decodeTextureRef(where.ref, { maxSize: 32 }).rgba);
      } catch {
        /* лист не прочитался: кадр покажет средний цвет земли */
      }
      colours.set(key, value);
    }
    return colours.get(key);
  };
  const textureOf = (where, name) => {
    const key = `${where.at}|${name}`;
    if (!textureIndex.has(key)) {
      textureIndex.set(key, textures.length);
      textures.push({ name: `g:${where.at.split("/").pop()}:${name}`, game: where.at, texture: name });
    }
    return textureIndex.get(key);
  };

  const materials = [];
  const materialIndex = new Map();
  /* Материал → клетка → сетки. */
  const cells = new Map();
  let spent = 0;

  /* Сначала плиты земли, дома и дороги, потом реквизит от середины наружу: предел вершин, если и случится, заберёт дальнюю мелочь, а не землю. */
  const order = [...byModel.entries()].sort((a, b) => {
    const big = (list) => Math.max(...list.map((item) => item.lodDist));
    const near = (list) => Math.min(...list.map((item) => item.distance));
    return big(b[1]) >= BIG_LOD_DIST === big(a[1]) >= BIG_LOD_DIST ? near(a[1]) - near(b[1]) : big(b[1]) - big(a[1]);
  });

  const palettes = new Map();
  const paletteOf = async (where) => {
    const key = `${where.at}|${where.ref.name}`;
    if (!palettes.has(key)) {
      let pixels = null;
      try {
        pixels = decodeTextureRef(where.ref, { level: 0 });
      } catch {
        pixels = null;
      }
      palettes.set(key, pixels);
    }
    return palettes.get(key);
  };

  for (const [name, list] of order) {
    let model = null;
    for (const ext of ["ydr", "yft"]) {
      const at = index.lookup(`${name}.${ext}`);
      if (!at) continue;
      try {
        const bytes = await index.read(at);
        if (!bytes) continue;
        const resource = openResourceWith(new Uint8Array(bytes), inflateRaw);
        const drawable = readDrawable(resource, { inflateRaw, kind: ext }).drawables[0];
        if (drawable) {
          /* Реквизит, что стоит сотнями (контейнеры порта: 2,8 млн вершин у одной модели), вдали — его дальним уровнем игры: это модель художника, а не ужатие, и дыр в ней нет. */
          const repeated = list.length >= REPEATED_MODEL || /^(prop_|p_|v_)/.test(name);
          const far = repeated && list.some((item) => item.distance > PROP_NEAR) ? readDrawable(resource, { inflateRaw, kind: ext, lod: "low" }).drawables[0] : null;
          model = {
            name,
            at,
            drawable,
            far,
            txd: list[0].archetype?.textureDictionary >>> 0 || 0,
            embedded: new Map((drawable.embeddedTextures || []).map((ref) => [ref.name.toLowerCase(), ref])),
            vectors: shaderVectors(resource, drawableRootAt(resource, ext)),
          };
          break;
        }
      } catch {
        /* модель не прочиталась — в кадре её не будет */
      }
    }
    if (!model) {
      report.missingModels += 1;
      continue;
    }
    report.models += 1;
    /* Материалы модели — один раз на все её места. */
    const looks = new Map();
    const lookOf = async (mesh) => {
      if (looks.has(mesh.shaderIndex)) return looks.get(mesh.shaderIndex);
      const material = mesh.material;
      const vectors = model.vectors[mesh.shaderIndex] || {};
      const shader = shaderFileName(material);
      const named = `${material?.shader || ""} ${material?.shaderFile || ""}`;
      let look = null;
      const kind = NIGHT_ONLY.test(shader) || NOT_SHADER.test(named) ? null : shopMaterialClass(material, vectors);
      const samplers = new Map((material?.samplers || []).filter((sampler) => sampler.texture).map((sampler) => [sampler.sampler >>> 0, sampler.texture.toLowerCase()]));
      const diffuse = diffuseOf(material);
      if (kind && !HIDDEN_TEXTURE.test(diffuse) && diffuse) {
        const layerNames = LAYER_SAMPLERS.map((hash) => samplers.get(hash) || null);
        const maskName = samplers.get(MASK_SAMPLER) || null;
        const terrain = layerNames.some(Boolean);
        const sheet = async (texture) => {
          if (!texture) return null;
          const where = await locate(texture, model);
          if (!where) {
            report.missingSheets += 1;
            return null;
          }
          return { where, slot: textureOf(where, texture) };
        };
        const base = await sheet(diffuse);
        const paletteName = kind.tint ? samplers.get(PALETTE_SAMPLER) : null;
        const paletteAt = paletteName ? await locate(paletteName, model) : null;
        const pixels = paletteAt ? await paletteOf(paletteAt) : null;
        if (terrain) {
          const layers = [base?.slot ?? null];
          for (const layer of layerNames) layers.push((await sheet(layer))?.slot ?? null);
          const mask = await sheet(maskName);
          const key = `t|${layers.join(",")}|${mask?.slot ?? ""}`;
          if (!materialIndex.has(key)) {
            materialIndex.set(key, materials.length);
            materials.push({ id: key, name: diffuse, alpha: "opaque", group: "terrain", doubleSided: false, colour: base ? colourOf(base.where) : "#8b7d61", texture: base?.slot ?? null, terrain: { layers, mask: mask?.slot ?? null, weights: TERRAIN_WEIGHTS } });
          }
          look = { slot: materialIndex.get(key), terrain: true, mask: Boolean(mask), vectors };
        } else {
          /* Ночное свечение днём не горит: окна — обычным листом. */
          const emission = /night/.test(shader) ? 0 : kind.emission;
          const vertex = Boolean(pixels) || kind.vertexAlpha;
          const key = [base?.slot ?? `c:${diffuse}`, kind.alpha, kind.decal ? 1 : 0, kind.dirt ? 1 : 0, kind.mirror ? 1 : 0, emission, vertex ? 1 : 0].join("|");
          if (!materialIndex.has(key)) {
            materialIndex.set(key, materials.length);
            materials.push({
              id: key,
              name: diffuse,
              alpha: kind.alpha,
              ...(kind.decal ? { decal: true } : {}),
              ...(kind.dirt ? { dirt: true } : {}),
              ...(kind.mirror ? { mirror: true } : {}),
              ...(emission ? { emissive: true, emission } : {}),
              ...(vertex ? { vertex: true } : {}),
              ...(kind.decal || kind.dirt || kind.glass ? { through: true } : {}),
              doubleSided: kind.alpha === "blend" && !kind.decal,
              colour: base ? colourOf(base.where) : "#9a958c",
              texture: base && !kind.mirror ? base.slot : null,
            });
          }
          look = { slot: materialIndex.get(key), vertex, tinted: Boolean(pixels), pixels, vertexAlpha: kind.vertexAlpha, vectors };
        }
      } else report.noColour += 1;
      looks.set(mesh.shaderIndex, look);
      return look;
    };
    for (const item of list) {
      if (spent > VERTEX_BUDGET && item.lodDist < BIG_LOD_DIST && !nearLarge(item)) {
        report.dropped += 1;
        continue;
      }
      const level = model.far && item.distance > PROP_NEAR ? model.far : model.drawable;
      for (const mesh of level.meshes) {
        if (!mesh.indices?.length) continue;
        const look = await lookOf(mesh);
        if (!look) continue;
        const placed = placeMesh(mesh, item.matrix, item.turn, origin, area, floor, top);
        if (!placed) continue;
        materials[look.slot].area = (materials[look.slot].area || 0) + surfaceOf(mesh);
        applyGlobalUv(placed, look.vectors);
        if (look.terrain) {
          if (!look.mask) placed.uvs1 = null;
          /* Веса слоёв — из второго цвета вершины (ТЗ 10.11.2026, земля как в игре): в сцену они идут в цветах вершин (`terrainWeights`). */
          placed.colours = terrainWeights(placed);
        } else {
          placed.uvs1 = null;
          placed.colours = look.vertex ? vertexColours(placed.colours, look, item.tint, placed.positions.length / 3) : null;
        }
        spent += placed.positions.length / 3;
        const cell = `${Math.floor(placed.centre[0] / CELL)},${Math.floor(placed.centre[1] / CELL)}`;
        let byCell = cells.get(look.slot);
        if (!byCell) {
          byCell = new Map();
          cells.set(look.slot, byCell);
        }
        if (!byCell.has(cell)) byCell.set(cell, []);
        byCell.get(cell).push(placed);
      }
    }
  }
  report.ms.models = Date.now() - since;
  lap(`модели ${report.models}, вершин ${spent}`, since);

  since = Date.now();
  const meshes = [];
  for (const [slot, byCell] of cells) {
    for (const list of byCell.values()) {
      let group = [];
      let count = 0;
      const flush = () => {
        if (!group.length) return;
        const joined = joinMeshes(group);
        meshes.push({ positions: joined.positions, normals: joined.normals, uvs: joined.uvs, ...(joined.uvs1 ? { uvs1: joined.uvs1 } : {}), ...(joined.colours ? { colours: joined.colours } : {}), indices: joined.indices, material: slot, part: 0 });
        group = [];
        count = 0;
      };
      for (const mesh of list) {
        const size = mesh.positions.length / 3;
        if (count + size > MESH_VERTICES) flush();
        group.push(mesh);
        count += size;
      }
      flush();
    }
    byCell.clear();
  }
  cells.clear();

  /* Вода — плоскостями квадов, если они в круге: у моря в игре моделей нет. */
  let water = false;
  try {
    const text = await world.readWater?.();
    const mesh = text ? waterMesh(parseWaterQuads(text), origin, reach) : null;
    if (mesh) {
      water = true;
      materials.push({ id: "water", name: "water", alpha: "blend", colour: WATER_COLOUR, opacity: WATER_OPACITY, doubleSided: true });
      meshes.push({ ...mesh, material: materials.length - 1, part: 0 });
    }
  } catch {
    /* файла воды нет — кадр без неё */
  }
  report.water = water;
  /* Обвод: линии — материалы зон, как у сцены зон: кадр красит их так же. */
  const zoneParts = [];
  if (outline && zonesRoot) {
    for (const { zone, meshes: lines } of await outlineMeshes(outline, origin, zonesRoot)) {
      let part = zoneParts.findIndex((item) => item.id === zone.part);
      if (part < 0) {
        part = zoneParts.length;
        zoneParts.push({ id: zone.part });
      }
      materials.push({ id: zone.id, name: zone.id, alpha: "blend", colour: zone.modColour, opacity: zone.modAlpha / 255, shader: "default", texture: null });
      for (const line of lines) meshes.push({ ...line, material: materials.length - 1, part: part + 1 });
    }
  }
  report.sheets = textures.length;
  report.meshes = meshes.length;
  for (const mesh of meshes) {
    report.vertices += mesh.positions.length / 3;
    report.triangles += mesh.indices.length / 3;
  }
  const bounds = boundsOf(meshes);
  const roundedBox = (box) => ({ min: box.min.map((value) => round(value)), max: box.max.map((value) => round(value)) });
  report.ms.total = Date.now() - started;
  return {
    bounds,
    parts: [
      { id: WORLD_PLACE_PART, bounds: roundedBox(bounds), ...(water ? { water: true } : {}) },
      ...zoneParts.map((part, index) => ({ id: part.id, bounds: roundedBox(boundsOf(meshes.filter((mesh) => mesh.part === index + 1))) })),
    ],
    materials,
    textures,
    meshes,
    report,
  };

  function nearLarge(item) {
    return item.distance <= reach * 0.45;
  }
}

/* Y-вверх `rage-drawable` → Z-вверх игры. */
const toGameInto = (source, target, at, shift) => {
  target[at] = source[at] + shift[0];
  target[at + 1] = -source[at + 2] + shift[1];
  target[at + 2] = source[at + 1] + shift[2];
};

/**
 * Обе линии обвода целиком (`outline` — часть сцены зон: `bizvar`, `vzhzone`, `porta`) в осях сцены: `[{ zone, meshes }]`. Файлы — модели набора Astral; нет файла — линии
 * нет, а кадр покажет её угол из сцены зон.
 */
export async function outlineMeshes(outline, origin, zonesRoot, read = fs.readFile) {
  const out = [];
  for (const zone of ZONES.filter((item) => item.part === outline && item.line)) {
    const meshes = [];
    for (const target of zone.targets) {
      const bytes = await read(path.join(zonesRoot, target.file)).catch(() => null);
      if (!bytes) continue;
      const shift = [0, 1, 2].map((axis) => zone.position[axis] + target.origin[axis] - origin[axis]);
      const drawable = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: "ydr" }).drawables[0];
      for (const mesh of drawable?.meshes || []) {
        const names = (mesh.material?.samplers || []).map((sampler) => String(sampler.texture || "").toLowerCase());
        if (!names.includes(String(target.texture).toLowerCase())) continue;
        const positions = new Float32Array(mesh.positions.length);
        const normals = new Float32Array(mesh.positions.length);
        for (let at = 0; at + 2 < positions.length; at += 3) {
          toGameInto(mesh.positions, positions, at, shift);
          normals[at + 2] = 1;
        }
        meshes.push({ positions, normals, uvs: mesh.uvs ? new Float32Array(mesh.uvs) : null, indices: Uint32Array.from(mesh.indices) });
      }
    }
    if (meshes.length) out.push({ zone, meshes });
  }
  return out;
}

/* Часть сцены места: по ней кадр отличает её от сцены зон. */
export const WORLD_PLACE_PART = "world-place";

/* Поверхность сетки модели, м²: материал по ней просит лист нужного размера. Считается один раз на сетку модели, масштаб сущности не считается. */
const surfaces = new WeakMap();
function surfaceOf(mesh) {
  if (surfaces.has(mesh)) return surfaces.get(mesh);
  const { positions, indices } = mesh;
  let area = 0;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at] * 3;
    const b = indices[at + 1] * 3;
    const c = indices[at + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  surfaces.set(mesh, area);
  return area;
}

function applyGlobalUv(mesh, vectors) {
  const a = vectors?.[UV0];
  const b = vectors?.[UV1];
  const uvs = mesh.uvs;
  if (!uvs || !a || !b || (a[0] === 1 && a[1] === 0 && a[2] === 0 && b[0] === 0 && b[1] === 1 && b[2] === 0)) return;
  for (let at = 0; at < uvs.length; at += 2) {
    const u = uvs[at];
    const v = uvs[at + 1];
    uvs[at] = a[0] * u + a[1] * v + a[2];
    uvs[at + 1] = b[0] * u + b[1] * v + b[2];
  }
}

/* Цвета вершин материала: палитра тинта (столбец — синий канал вершины, строка — `tintValue` сущности) и альфа вершины. */
function vertexColours(source, look, tint, count) {
  const colours = new Float32Array(count * 4).fill(1);
  const pixels = look.pixels;
  const row = pixels ? Math.max(0, Math.min(pixels.height - 1, Number(tint) || 0)) : 0;
  for (let at = 0; at < count; at += 1) {
    if (pixels && source) {
      const column = Math.max(0, Math.min(pixels.width - 1, Math.round(source[at * 4 + 2] * 255)));
      const pixel = (row * pixels.width + column) * 4;
      colours[at * 4] = pixels.rgba[pixel] / 255;
      colours[at * 4 + 1] = pixels.rgba[pixel + 1] / 255;
      colours[at * 4 + 2] = pixels.rgba[pixel + 2] / 255;
    }
    if (look.vertexAlpha && source) colours[at * 4 + 3] = source[at * 4 + 3];
  }
  return colours;
}

/* Части обводов, чьи линии может попросить кадр. */
const OUTLINES = new Set(ZONES.filter((zone) => zone.line).map((zone) => zone.part));

/** Просьба окна — проверенная: `{ origin, reach, outline, plan?, top? }` или `null`. */
export function placeRequest(input) {
  const origin = Array.isArray(input?.origin) ? input.origin.map(Number) : [];
  const reach = Number(input?.reach);
  if (origin.length !== 3 || !origin.every((value) => Number.isFinite(value) && Math.abs(value) <= WORLD_LIMIT)) return null;
  if (!Number.isFinite(reach) || reach < PLACE_REACH[0] || reach > PLACE_REACH[1]) return null;
  const outline = OUTLINES.has(String(input?.outline || "")) ? String(input.outline) : "";
  const plan = input?.plan === undefined || input?.plan === null ? null : planPoints(input.plan, PLACE_REACH[1] * 2);
  if (input?.plan && !plan) return null;
  const top = Number(input?.top);
  return { origin: origin.map((value) => round(value, 1)), reach: Math.round(reach), outline, ...(plan ? { plan } : {}), ...(plan && Number.isFinite(top) && Math.abs(top) <= WORLD_LIMIT ? { top: round(top, 1) } : {}) };
}

const sha = (text) => createHash("sha256").update(text).digest("hex");

/* Отпечаток игры: все архивы, что читает оглавление. Другая версия игры — другая сцена. */
async function gameStamp(gameRoot) {
  const parts = [];
  const top = await fs.readdir(gameRoot).catch(() => []);
  for (const name of top.filter((item) => /^x64[a-z]?\.rpf$/i.test(item)).sort()) {
    const stat = await fs.stat(path.join(gameRoot, name)).catch(() => null);
    if (stat) parts.push(`${name}:${stat.size}:${Math.round(stat.mtimeMs)}`);
  }
  const update = await fs.stat(path.join(gameRoot, "update", "update.rpf")).catch(() => null);
  if (update) parts.push(`update:${update.size}:${Math.round(update.mtimeMs)}`);
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  for (const pack of (await fs.readdir(packs).catch(() => [])).filter((item) => !/^astral_/i.test(item)).sort()) {
    const stat = await fs.stat(path.join(packs, pack, "dlc.rpf")).catch(() => null);
    if (stat) parts.push(`${pack}:${stat.size}:${Math.round(stat.mtimeMs)}`);
  }
  return parts.join("|");
}

/**
 * Сборка из файлов игры — то, что тяжело. Её зовёт поток (`world-place-worker.js`) и, в песочнице и тестах, сам `readWorldPlaceScene`.
 * `task = { origin, reach, plan?, gameRoot, keys, indexFile }`. Ответ — `{ bytes, report }` или `{ reason }`.
 */
export async function buildWorldPlaceBytes({ origin, reach, plan = null, top = Infinity, outline = "", zonesRoot = "", gameRoot, keys, indexFile }, { log = () => {} } = {}) {
  const started = Date.now();
  const rpfKeys = await keysFromDirectory(keys || "");
  const index = await openGameIndex(gameRoot, { keys: rpfKeys, cacheFile: indexFile || null, log });
  log(`оглавление: ${Date.now() - started} мс`);
  try {
    const world = worldReader(index);
    world.readWater = async () => {
      const rpf = await openRpfFile(path.join(gameRoot, WATER_ARCHIVE), { keys: rpfKeys });
      try {
        return Buffer.from(await rpf.read(WATER_FILE)).toString("utf8");
      } finally {
        await rpf.close?.();
      }
    };
    const built = await buildWorldPlaceMeshes({ origin, reach, plan, top, outline, zonesRoot }, world, { log });
    if (!built.meshes.length) return { reason: WORLD_PLACE_EMPTY };
    const since = Date.now();
    const bytes = encodeShopScene(built, { level: 4 });
    built.report.ms.encode = Date.now() - since;
    built.report.bytes = bytes.length;
    return { bytes, report: built.report };
  } finally {
    await index.close?.().catch(() => {});
  }
}

/**
 * Обновить файл оглавления игры (`openGameIndex` пишет его сам, если архивы изменились) и закрыть оглавление. Это делает поток перед сборкой движком (`world-place-engine.js`):
 * движок читает файл, но сам его не строит. `task = { gameRoot, keys, indexFile }`.
 */
export async function indexWorldPlaceGame({ gameRoot, keys, indexFile }) {
  const index = await openGameIndex(gameRoot, { keys: await keysFromDirectory(keys || ""), cacheFile: indexFile || null });
  await index.close?.().catch(() => {});
}

export const WORLD_PLACE_EMPTY = "В этом месте файлов игры не нашлось — проверьте GTA V.";

export const WORLD_PLACE_OUT_OF_MEMORY ="Место не собралось из файлов вашей игры: не хватило памяти. Astral попробует снова, когда файлы игры изменятся.";

const building = new Map();

async function defaultZonesRoot() {
  const { recolorResourceRoot } = await import("./recolor-customizer.js");
  return recolorResourceRoot("zones");
}

/**
 * Сцена места для 3D-кадра: `input = { origin: [x, y, z], reach, plan?, gameRoot, keys? }` в осях игры. Ответ — `{ scene: ArrayBuffer, report?, cached? }` или
 * `{ scene: null, reason }`. Сцена держится в кэше Astral по месту, версии сборки и отпечатку игры: второе открытие — без сборки.
 */
export async function readWorldPlaceScene(input, stateDir, tools = {}) {
  const request = placeRequest(input);
  if (!request) return { scene: null, reason: "Такого места нет на карте игры." };
  const gameRoot = String(input?.gameRoot || "").trim();
  if (!gameRoot || !path.isAbsolute(gameRoot)) return { scene: null, reason: "Подключите GTA V: кадр собирается из файлов вашей игры." };
  const root = path.join(stateDir || os.tmpdir(), "world-place-scenes");
  const stamp = await gameStamp(gameRoot);
  if (!stamp) return { scene: null, reason: "Архивов игры нет в её папке — проверьте GTA V." };
  const key = sha(JSON.stringify([WORLD_PLACE_BUILDER, request, gameRoot.toLowerCase(), stamp])).slice(0, 32);
  const cacheFile = path.join(root, `${key}.bin`);
  const failedFile = path.join(root, `${key}.oom`);
  const cached = await fs.readFile(cacheFile).catch(() => null);
  if (cached) {
    /* Свежая сцена уходит из кэша последней. */
    const now = new Date();
    await fs.utimes(cacheFile, now, now).catch(() => {});
    return { scene: cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength), cached: true };
  }
  if (await fs.stat(failedFile).catch(() => null)) return { scene: null, reason: WORLD_PLACE_OUT_OF_MEMORY };
  if (building.has(cacheFile)) return building.get(cacheFile);
  const job = (async () => {
    const keys = await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: tools.archiveSupport || provisionArchiveSupport });
    /* Файлы набора зон рядом с приложением: путь знает главный процесс, поток его только читает. */
    const zonesRoot = request.outline ? await (tools.zonesRoot || defaultZonesRoot)().catch(() => "") : "";
    /* `cacheFile` — куда движок кладёт сцену сам (`world-place-engine.js`, `ASTRAL_RUST_PLACE_SCENE=1`); сборка потоком JS его не читает. */
    const task = { ...request, zonesRoot, gameRoot, keys, indexFile: path.join(root, "game-index.json"), cacheFile };
    await fs.mkdir(root, { recursive: true }).catch(() => {});
    const built = tools.build ? await tools.build(task) : await buildWorldPlaceBytes(task);
    if (built.outOfMemory) {
      await fs.writeFile(failedFile, "").catch(() => {});
      return { scene: null, reason: WORLD_PLACE_OUT_OF_MEMORY };
    }
    if (built.skipped) return { scene: null, reason: "", skipped: true };
    if (built.empty) return { scene: null, reason: WORLD_PLACE_EMPTY };
    if (built.file) {
      /* Сцену собрал и записал движок: файл уже в кэше. */
      const written = await fs.readFile(cacheFile).catch(() => null);
      if (written) {
        await trimCache(root, cacheFile);
        return { scene: written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength), report: built.report, engine: built.timings ?? null };
      }
      return { scene: null, reason: WORLD_PLACE_EMPTY };
    }
    if (!built.bytes) return { scene: null, reason: built.reason || WORLD_PLACE_EMPTY };
    await fs.writeFile(cacheFile, built.bytes).catch(() => {});
    await trimCache(root, cacheFile);
    const bytes = built.bytes;
    return { scene: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), report: built.report };
  })();
  building.set(cacheFile, job);
  try {
    return await job;
  } finally {
    building.delete(cacheFile);
  }
}

/* Кэш мест — с пределом: новые вытесняют давно не открытые (сцена — десятки мегабайт, у игрока может быть мало места). */
async function trimCache(root, keep) {
  const names = (await fs.readdir(root).catch(() => [])).filter((name) => name.endsWith(".bin"));
  if (names.length <= CACHE_SCENES) return;
  const stats = await Promise.all(names.map(async (name) => ({ name, time: (await fs.stat(path.join(root, name)).catch(() => null))?.mtimeMs || 0 })));
  stats.sort((a, b) => a.time - b.time);
  for (const { name } of stats.slice(0, names.length - CACHE_SCENES)) {
    const file = path.join(root, name);
    if (file !== keep) await fs.rm(file, { force: true }).catch(() => {});
  }
}
