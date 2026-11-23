/*
 * «Интерьеры» — сцена 3D-кадра помещения из игры игрока (задача 5 ТЗ
 * владельца 11.10.2026: «текстурки один в один как в игре»).
 *
 * Прежде сцену собирал скрипт подготовки в поставку (`*.bin`, 13 МБ на 23
 * помещения), и чтобы уложиться, сетки помещения ужимались кластеризацией
 * вершин до 24 000 на помещение — впятеро-вдесятеро: полки, товары, прилавок
 * и стены рассыпались на вытянутые треугольники, а развёртка на них
 * растягивала листы. Плюс кадр не знал, как игра рисует материал: стёкла
 * холодильников без прозрачности вершин стояли серыми плитами, наклейки
 * грязи — вырезанными пятнами, «тинт» мебели (палитра `_pal`) — серым.
 *
 * Теперь сцену собирает главный процесс из файлов игры игрока по плану
 * описи (`@modovik/climb-contract/recolor/inventory/shops-scenes`: какие
 * модели где стоят и где игра берёт каждый их лист), целиком, без ужатия,
 * и держит в своём кэше; Rockstar в поставке нет ни сетки, ни листа.
 * Материал — как его рисует игра:
 *
 *   • корзина шейдера (`renderBucket`): 1 — прозрачное, 2 — наклейка,
 *     3 — вырез по альфе; прозрачность — альфа листа × альфа вершины
 *     (`Colour0.a`) — так стёкла холодильников почти прозрачны, как в игре;
 *   • `decal_dirt` — затенение (запечённые тени под полками, грязь):
 *     красный канал листа × альфа вершины, поверхность под ним темнеет;
 *   • наклейки только нормали, блеска или окружения (`decal_normal_only`,
 *     `spec_decal`…) цвета не рисуют — в кадре их нет; зеркальный пол —
 *     тоже (его рисует отражение, которого у кадра нет); провода `cable`
 *     игра раздувает в шейдере — в кадре их нет;
 *   • зеркала — зеркальным материалом, а не листом нормалей;
 *   • `*_tnt` — цвет из палитры `TintPaletteSampler`: столбец — синий канал
 *     вершины (номер пикселя), строка — `tintValue` сущности; лист × цвет;
 *   • свечение — `emissiveMultiplier` шейдера;
 *   • развёртка — `globalAnimUV0/1` шейдера (у помещений Rockstar везде
 *     единичная, но правило — как у игры).
 *
 * Сущности, которые игра рисует только в тенях или только в отражениях
 * (флаги `fwEntityDef` 23, 25, 27: `*_reflectproxy`, `*_shadow`), в кадр не
 * идут: прежде отражённый двойник зала (`v_66_reflection`) мог стоять
 * поперёк кадра.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { decodeTextureRef, joaat, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateResource } from "@modovik/native-rs";
import { placementRotation, placementTransform } from "@modovik/climb-contract/recolor/placement";
import { shopInterior } from "@modovik/climb-contract/recolor/shops";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { createGameReader } from "./optimization-layers.js";

/* Меняется, когда меняется сборка сцены: кэш у игроков собирается заново. */
export const SHOP_SCENE_BUILDER = 1;
const MAGIC = "ARS1";
const inflateRaw = inflateResource;

/* ------------------------------------------------------------------ *
 * Материал — как его рисует игра
 * ------------------------------------------------------------------ */

/* Шейдеры помещений (имена файлов `.sps`): хеш → имя. */
const SHADER_FILES = new Map(
  [
    "alpha", "cable", "cloth_default", "cloth_normal_spec", "cutout", "decal", "decal_amb_only", "decal_dirt", "decal_emissive_only",
    "decal_emissivenight_only", "decal_glue", "decal_normal_only", "decal_shadow_only", "decal_spec_only", "decal_tnt", "default", "default_detail",
    "default_spec", "default_tnt", "default_um", "emissive", "emissive_additive_alpha", "emissive_additive_uv_alpha", "emissive_alpha",
    "emissive_alpha_tnt", "emissive_clip", "emissive_speclum", "emissive_tnt", "emissivenight", "emissivenight_alpha", "emissivestrong",
    "emissivestrong_alpha", "glass", "glass_breakable", "glass_breakable_screendooralpha", "glass_displacement", "glass_emissive",
    "glass_emissive_alpha", "glass_emissivenight", "glass_emissivenight_alpha", "glass_env", "glass_normal_spec_reflect", "glass_pv",
    "glass_pv_env", "glass_reflect", "glass_spec", "mirror_crack", "mirror_decal", "mirror_default", "normal", "normal_alpha", "normal_cutout",
    "normal_decal", "normal_decal_pxm", "normal_decal_tnt", "normal_detail", "normal_pxm", "normal_reflect", "normal_reflect_alpha",
    "normal_reflect_decal", "normal_screendooralpha", "normal_spec", "normal_spec_alpha", "normal_spec_cutout", "normal_spec_decal",
    "normal_spec_decal_detail", "normal_spec_decal_pxm", "normal_spec_decal_tnt", "normal_spec_detail", "normal_spec_detail_tnt",
    "normal_spec_emissive", "normal_spec_pxm", "normal_spec_reflect", "normal_spec_reflect_alpha", "normal_spec_reflect_decal",
    "normal_spec_reflect_emissivenight", "normal_spec_tnt", "normal_tnt", "normal_um", "reflect", "reflect_alpha", "reflect_decal", "spec",
    "spec_alpha", "spec_const", "spec_decal", "spec_reflect", "spec_reflect_alpha", "spec_reflect_decal", "spec_screendooralpha", "spec_tnt",
    "trees", "trees_normal", "trees_normal_spec", "trees_tnt", "weapon_normal_spec_tnt",
  ].flatMap((name) => [
    [joaat(`${name}.sps`) >>> 0, name],
    [joaat(name) >>> 0, name],
  ]),
);
export const shaderFileName = (material) => SHADER_FILES.get(material?.shaderFileHash >>> 0) || SHADER_FILES.get(material?.shaderHash >>> 0) || "";

const PALETTE_SAMPLER = joaat("TintPaletteSampler") >>> 0;
const PARAMS = Object.freeze({
  emissive: joaat("emissiveMultiplier") >>> 0,
  uv0: joaat("globalAnimUV0") >>> 0,
  uv1: joaat("globalAnimUV1") >>> 0,
});

/*
 * Лист цвета материала: сэмплер `DiffuseSampler` (роль `diffuse`), иначе —
 * первый лист, что по имени не нормаль, не блеск и не палитра.
 */
export function diffuseOf(material) {
  const named = (material?.samplers || []).filter((sampler) => sampler.texture);
  const name =
    material?.textures?.diffuse ||
    named.find((sampler) => sampler.role === "diffuse")?.texture ||
    named.find((sampler) => !sampler.role && sampler.sampler >>> 0 !== PALETTE_SAMPLER && !/(_n|_nm|_nrm|_normal|_s|_spec|_pal)$/i.test(sampler.texture))?.texture ||
    "";
  return String(name).toLowerCase();
}

/* Шейдеры, что цвета не рисуют: только нормаль, блеск, окружение, зеркальный пол, провода. */
const NO_COLOUR = /^(decal_normal_only|decal_spec_only|decal_amb_only|decal_shadow_only|spec_decal|reflect_decal|spec_reflect_decal|normal_reflect_decal|mirror_decal|mirror_crack|cable)$/;

/**
 * Как игра рисует материал сетки: `null` — не рисует цвета (в кадре нет),
 * иначе `{ alpha, decal, dirt, mirror, emission, vertexAlpha, tint, glass }`.
 * `vectors` — числовые параметры шейдера (`shaderVectors`).
 */
export function shopMaterialClass(material, vectors = {}) {
  if (!material) return null;
  const shader = shaderFileName(material);
  if (NO_COLOUR.test(shader)) return null;
  const bucket = material.renderBucket ?? 0;
  const mirror = /^mirror_/.test(shader);
  const dirt = shader === "decal_dirt";
  const decal = bucket === 2 || /decal/.test(shader);
  const cutout = bucket === 3 || /cutout|screendoor|^trees/.test(shader);
  const blend = !cutout && (bucket === 1 || decal || /alpha|^glass/.test(shader));
  const emissive = /emissive/.test(shader) || Boolean(material.emissive);
  const multiplier = vectors[PARAMS.emissive]?.[0];
  return {
    alpha: mirror ? "opaque" : cutout ? "cutout" : blend ? "blend" : "opaque",
    decal,
    dirt,
    mirror,
    glass: /^glass/.test(shader),
    /* Свечение кадра: множитель шейдера (1…16 у помещений) — в долю цвета листа. */
    emission: emissive ? Math.round(Math.min(2.4, 0.35 + 0.12 * (Number.isFinite(multiplier) ? multiplier : 4)) * 100) / 100 : 0,
    /* Альфа вершины — у прозрачного и наклеек (так у игры: стёкла, грязь, тени). */
    vertexAlpha: blend || dirt,
    tint: (material.samplers || []).some((sampler) => sampler.sampler >>> 0 === PALETTE_SAMPLER && sampler.texture),
  };
}

/* ------------------------------------------------------------------ *
 * Параметры шейдеров
 * ------------------------------------------------------------------ */

function pointerAt(resource, at) {
  const value = resource.view.getBigUint64(at, true);
  return value ? resource.at(value) : -1;
}

/** Где в ресурсе модель: у фрагмента — общая модель (`+0x30`), у `.ydr` — корень. */
export function drawableRootAt(resource, kind) {
  const rootAt = resource.at(resource.root);
  return kind === "yft" ? pointerAt(resource, rootAt + 0x30) : rootAt;
}

/**
 * Числовые параметры шейдеров модели (разметка — как у `readShaders`
 * rage-drawable): номер шейдера → `{ хеш параметра: [x, y, z, w] }`.
 */
export function shaderVectors(resource, drawableAt) {
  const out = [];
  if (drawableAt < 0) return out;
  const view = resource.view;
  const groupAt = pointerAt(resource, drawableAt + 0x10);
  if (groupAt < 0) return out;
  const shadersAt = pointerAt(resource, groupAt + 0x10);
  const count = view.getUint16(groupAt + 0x18, true);
  for (let index = 0; index < count && shadersAt >= 0; index += 1) {
    const shaderAt = pointerAt(resource, shadersAt + index * 8);
    const params = {};
    out.push(params);
    if (shaderAt < 0) continue;
    const parameterCount = view.getUint8(shaderAt + 0x10);
    const parametersAt = pointerAt(resource, shaderAt);
    if (parametersAt < 0 || parameterCount > 96) continue;
    let dataBytes = 0;
    const entries = [];
    for (let slot = 0; slot < parameterCount; slot += 1) {
      const at = parametersAt + slot * 16;
      if (at + 16 > resource.data.length) break;
      const dataType = view.getUint8(at);
      entries.push({ dataType, at });
      if (dataType > 0) dataBytes += 16 * dataType;
    }
    const hashesAt = parametersAt + parameterCount * 16 + dataBytes;
    entries.forEach(({ dataType, at }, slot) => {
      if (!dataType || hashesAt + slot * 4 + 4 > resource.data.length) return;
      const dataAt = pointerAt(resource, at + 8);
      if (dataAt < 0 || dataAt + 16 > resource.data.length) return;
      params[view.getUint32(hashesAt + slot * 4, true) >>> 0] = [0, 1, 2, 3].map((k) => view.getFloat32(dataAt + k * 4, true));
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Сборка сетки сцены
 * ------------------------------------------------------------------ */

/* Сущность, которую игра рисует только в тенях или только в отражениях (`fwEntityDef`). */
const ONLY_SHADOWS = 1 << 23;
const ONLY_REFLECTIONS = 1 << 25;
const ONLY_WATER_REFLECTIONS = 1 << 27;
export const entityDrawnInView = (flags) => !((flags >>> 0) & (ONLY_SHADOWS | ONLY_REFLECTIONS | ONLY_WATER_REFLECTIONS));

/* Y-вверх rage-drawable → Z-вверх игры: (x, y, z) → (x, −z, y). */
const toGame = (x, y, z) => [x, -z, y];

/* «Изолента» Rockstar (`*_ducttape`) прячет свет в щелях — в игре её не видно. */
const HIDDEN_TEXTURE = /ducttape/;

/**
 * Сцена помещения по плану: `scene` — запись плана (`entities`, `models`,
 * `textures`), `files` — адреса файлов плана, `interior` — запись описи
 * (`items`, `surfaces`), `read(адрес)` — байты файла игры (или `null`).
 * Ответ — `{ bounds, parts, materials, textures, meshes, report }` в
 * координатах помещения; сетки — с `colours` (RGBA 0…1), где материалу
 * нужны цвет палитры или альфа вершины. У вещей описи часть несёт `place`
 * — место сущности (`[x, y, z, qx, qy, qz, qw, xy, z]`): кадр ставит на него
 * модель замены.
 */
/** Имя модели по адресу файла плана (`p:папка/модель.ydr`, `x64a.rpf:путь/модель.yft`): последнее имя без расширения. */
export const partModelName = (address) => /[^/:]+(?=\.[^./:]+$)/.exec(String(address || ""))?.[0] || "";

/*
 * `names` — части несут имя модели (`model`, без расширения) и откуда она (`own`: файл самого интерьера, а не игры): по ним панель «Предметы»
 * (`features/workshop/items-panel`) называет предмет, группирует «столы, кресла, автоматы» и отличает вещь мода от штатной. Помещения проектов
 * (26.10.2026, ТЗ п. C4); у магазинов части прежние.
 */
export async function buildShopSceneMeshes(scene, files, interior, read, { names = false } = {}) {
  const items = new Map((interior?.items || []).map((item) => [item.index, item]));
  const surfaceOf = new Map();
  for (const [role, list] of Object.entries(interior?.surfaces || {})) for (const sheet of list) surfaceOf.set(`${sheet.at}|${sheet.name.toLowerCase()}`, role);
  const entries = scene.entities.map(([index, slot, px, py, pz, qx, qy, qz, qw, sxy, sz, tint, flags, room, portal]) => {
    const item = items.get(index);
    return {
      part: {
        id: `e${index}`,
        entity: index,
        group: item?.group || "shell",
        ...(names ? { model: partModelName(files[slot]), own: String(files[slot] || "").startsWith("p:") } : {}),
        /* Комната и портал помещения (нет — не названа): по ним разметка выделения режет «материал × закрытая комната». */
        ...(names && Number.isInteger(room) && room >= 0 ? { room } : {}),
        ...(names && Number.isInteger(portal) && portal >= 0 ? { portal } : {}),
        ...(item ? { place: [px, py, pz, qx, qy, qz, qw, sxy, sz] } : {}),
      },
      slot,
      entity: { position: [px, py, pz], rotation: [qx, qy, qz, qw], scaleXY: sxy, scaleZ: sz },
      tint,
      flags,
    };
  });
  return buildEntries(entries, { files, models: scene.models, textureTable: scene.textures, surfaceOf, read });
}

/**
 * Модели каталога замены — каждая своей частью (`id` — имя модели) в своих
 * координатах: кадр ставит их копиями на места заменённых вещей. `catalog`
 * — `{ models: { имя: [файл, { лист: строка }] }, textures }` плана.
 */
export async function buildShopPieceMeshes(catalog, files, names, read) {
  const models = {};
  const entries = [];
  for (const name of names) {
    const record = catalog?.models?.[name];
    if (!record) continue;
    const [slot, lookup] = record;
    models[slot] = lookup;
    entries.push({ part: { id: name, model: name }, slot, entity: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scaleXY: 1, scaleZ: 1 }, tint: 0, flags: 0 });
  }
  return buildEntries(entries, { files, models, textureTable: catalog?.textures || [], surfaceOf: new Map(), read });
}

async function buildEntries(entries, { files, models: lookups, textureTable, surfaceOf, read }) {
  const report = { entities: 0, skippedEntities: 0, meshes: 0, noColour: 0, hiddenTexture: 0, missingModels: [], tinted: 0, vertexAlpha: 0 };
  const models = new Map();
  async function model(slot) {
    if (models.has(slot)) return models.get(slot);
    const at = files[slot];
    const kind = String(at).split(".").pop();
    let found = null;
    try {
      const bytes = await read(at);
      if (bytes) {
        const resource = openResourceWith(new Uint8Array(bytes), inflateRaw);
        const drawable = readDrawable(resource, { inflateRaw, kind }).drawables[0];
        if (drawable) found = { drawable, vectors: shaderVectors(resource, drawableRootAt(resource, kind)) };
      }
    } catch {
      found = null;
    }
    models.set(slot, found);
    return found;
  }

  /* Палитры тинта: пиксели листа по строке таблицы листов плана. */
  const palettes = new Map();
  async function palette(row) {
    if (palettes.has(row)) return palettes.get(row);
    let found = null;
    const entry = textureTable[row];
    if (entry)
      try {
        const bytes = await read(files[entry[0]]);
        const resource = openResourceWith(new Uint8Array(bytes), inflateRaw);
        const refs = files[entry[0]].endsWith(".ytd") ? readTextureDictionary(resource) : readDrawable(resource, { inflateRaw }).drawables.flatMap((item) => item.embeddedTextures || []);
        const ref = refs.find((item) => item.name.toLowerCase() === entry[1]);
        if (ref) found = decodeTextureRef(ref, { level: 0 });
      } catch {
        found = null;
      }
    palettes.set(row, found);
    return found;
  }

  const textures = [];
  const textureIndex = new Map();
  const textureOf = (row) => {
    if (!textureIndex.has(row)) {
      const [file, name] = textureTable[row];
      textureIndex.set(row, textures.length);
      textures.push({ name: `g:${files[file].split("/").pop()}:${name}`, game: files[file], texture: name });
    }
    return textureIndex.get(row);
  };
  const materials = [];
  const materialIndex = new Map();
  const parts = [];
  const meshes = [];

  for (const { part, slot, entity, tint, flags } of entries) {
    if (!entityDrawnInView(flags)) {
      report.skippedEntities += 1;
      continue;
    }
    const loaded = await model(slot);
    if (!loaded) {
      report.missingModels.push(files[slot]);
      continue;
    }
    report.entities += 1;
    const place = placementTransform(entity);
    const turn = placementRotation(entity);
    const lookup = lookups[slot] || {};
    /* Сетки одной сущности с одним материалом — одной сеткой кадра. */
    const merged = new Map();
    for (const mesh of loaded.drawable.meshes) {
      const material = mesh.material;
      const kind = shopMaterialClass(material, loaded.vectors[mesh.shaderIndex] || {});
      if (!kind) {
        report.noColour += 1;
        continue;
      }
      const diffuse = diffuseOf(material);
      if (HIDDEN_TEXTURE.test(diffuse)) {
        report.hiddenTexture += 1;
        continue;
      }
      if (!mesh.indices.length) continue;
      const row = diffuse ? lookup[diffuse] : undefined;
      const entry = row !== undefined ? textureTable[row] : null;
      const surface = entry ? surfaceOf.get(`${files[entry[0]]}|${entry[1]}`) || null : null;
      const paletteName = kind.tint ? String(material.samplers.find((sampler) => sampler.sampler >>> 0 === PALETTE_SAMPLER)?.texture || "").toLowerCase() : "";
      const paletteRow = paletteName ? lookup[paletteName] : undefined;
      const pixels = paletteRow !== undefined ? await palette(paletteRow) : null;
      const tinted = Boolean(pixels);
      const vertex = tinted || kind.vertexAlpha;
      const key = [row ?? "none", kind.alpha, kind.decal ? 1 : 0, kind.dirt ? 1 : 0, kind.mirror ? 1 : 0, kind.emission, vertex ? 1 : 0].join("|");
      if (!materialIndex.has(key)) {
        materialIndex.set(key, materials.length);
        materials.push({
          id: key,
          name: entry ? entry[1] : diffuse,
          alpha: kind.alpha,
          ...(kind.decal ? { decal: true } : {}),
          ...(kind.dirt ? { dirt: true } : {}),
          ...(kind.mirror ? { mirror: true } : {}),
          ...(kind.emission ? { emissive: true, emission: kind.emission } : {}),
          ...(vertex ? { vertex: true } : {}),
          /* Наклейки, тени и стёкла щелчок пропускает: выбирается то, что под ними. */
          ...(kind.decal || kind.dirt || kind.glass ? { through: true } : {}),
          doubleSided: kind.alpha === "blend" && !kind.decal,
          colour: entry?.[2] || "#9a958c",
          texture: entry && !kind.mirror ? textureOf(row) : null,
          surface,
        });
      }
      const materialSlot = materialIndex.get(key);
      const count = mesh.positions.length / 3;
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      for (let at = 0; at < count; at += 1) {
        positions.set(place(toGame(mesh.positions[at * 3], mesh.positions[at * 3 + 1], mesh.positions[at * 3 + 2])), at * 3);
        if (mesh.normals) normals.set(turn(toGame(mesh.normals[at * 3], mesh.normals[at * 3 + 1], mesh.normals[at * 3 + 2])), at * 3);
      }
      /* Развёртка — через globalAnimUV шейдера, как у игры. */
      const uvs = mesh.uvs ? new Float32Array(mesh.uvs) : null;
      const vectors = loaded.vectors[mesh.shaderIndex] || {};
      const a = vectors[PARAMS.uv0];
      const b = vectors[PARAMS.uv1];
      if (uvs && a && b && !(a[0] === 1 && a[1] === 0 && a[2] === 0 && b[0] === 0 && b[1] === 1 && b[2] === 0))
        for (let at = 0; at < uvs.length; at += 2) {
          const u = uvs[at];
          const v = uvs[at + 1];
          uvs[at] = a[0] * u + a[1] * v + a[2];
          uvs[at + 1] = b[0] * u + b[1] * v + b[2];
        }
      let colours = null;
      if (vertex) {
        colours = new Float32Array(count * 4).fill(1);
        const source = mesh.colours;
        const tintRow = pixels ? Math.max(0, Math.min(pixels.height - 1, Number(tint) || 0)) : 0;
        for (let at = 0; at < count; at += 1) {
          if (tinted && source) {
            const column = Math.max(0, Math.min(pixels.width - 1, Math.round(source[at * 4 + 2] * 255)));
            const pixel = (tintRow * pixels.width + column) * 4;
            colours[at * 4] = pixels.rgba[pixel] / 255;
            colours[at * 4 + 1] = pixels.rgba[pixel + 1] / 255;
            colours[at * 4 + 2] = pixels.rgba[pixel + 2] / 255;
          }
          if (kind.vertexAlpha && source) colours[at * 4 + 3] = source[at * 4 + 3];
        }
        if (tinted) report.tinted += 1;
        if (kind.vertexAlpha) report.vertexAlpha += 1;
      }
      const list = merged.get(materialSlot) || [];
      list.push({ positions, normals, uvs, colours, indices: mesh.indices });
      merged.set(materialSlot, list);
      report.meshes += 1;
    }
    if (!merged.size) continue;
    const partSlot = parts.length;
    parts.push({ ...part });
    for (const [materialSlot, list] of merged) meshes.push({ ...concatMeshes(list), material: materialSlot, part: partSlot });
  }
  const bounds = boundsOf(meshes);
  for (const [slot, part] of parts.entries()) {
    const box = boundsOf(meshes.filter((mesh) => mesh.part === slot));
    part.bounds = { min: box.min.map((value) => Math.round(value * 100) / 100), max: box.max.map((value) => Math.round(value * 100) / 100) };
  }
  return { bounds, parts, materials, textures, meshes, report };
}

/* Сетки одного материала — одной: индексы со сдвигом. */
function concatMeshes(list) {
  if (list.length === 1) return list[0];
  const vertices = list.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const indexCount = list.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const uvs = list.every((mesh) => mesh.uvs) ? new Float32Array(vertices * 2) : null;
  const colours = list.some((mesh) => mesh.colours) ? new Float32Array(vertices * 4).fill(1) : null;
  const indices = vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vertex = 0;
  let index = 0;
  for (const mesh of list) {
    const count = mesh.positions.length / 3;
    positions.set(mesh.positions, vertex * 3);
    normals.set(mesh.normals, vertex * 3);
    if (uvs) uvs.set(mesh.uvs, vertex * 2);
    if (colours && mesh.colours) colours.set(mesh.colours, vertex * 4);
    for (let at = 0; at < mesh.indices.length; at += 1) indices[index + at] = mesh.indices[at] + vertex;
    vertex += count;
    index += mesh.indices.length;
  }
  return { positions, normals, uvs, colours, indices };
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

/* ------------------------------------------------------------------ *
 * Файл сцены (ARS1 — читает `apps/web/…/model-stage/scene-asset.js`)
 * ------------------------------------------------------------------ */

/**
 * Сцена → байты `ARS1` (zlib): позиции i16×3 долями рамки, нормали i8×4,
 * развёртка f32×2, индексы u16/u32, цвета вершин u8×4 (`colour`) — тот же
 * формат, что пишет `scripts/lib/scene-encode.mjs`.
 */
/*
 * `entities` — каждой сетке кадра — номер сущности её части (`parts[mesh.part].entity`): кадр по нему узнаёт, какой предмет под щелчком
 * (`model-stage/picked-piece.js`: один стул, один стол, а не все сетки с тем же листом). Так пишутся помещения «Интерьеров проектов»
 * и «Интерьеров Majestic RP» (26.10.2026, ТЗ п. B); у магазинов и мест мода сетки остаются без номеров, как были.
 */
export function encodeShopScene(scene, { level = 6, entities = false } = {}) {
  const chunks = [];
  let offset = 0;
  const push = (bytes) => {
    const at = offset;
    const padded = Math.ceil(bytes.byteLength / 4) * 4;
    const chunk = Buffer.alloc(padded);
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).copy(chunk);
    chunks.push(chunk);
    offset += padded;
    return at;
  };
  const min = scene.bounds.min.map((value) => value - 0.01);
  const max = scene.bounds.max.map((value) => value + 0.01);
  const span = max.map((value, axis) => Math.max(value - min[axis], 1e-3));
  const meshes = scene.meshes.map((mesh) => {
    const count = mesh.positions.length / 3;
    const positions = new Int16Array(count * 3);
    for (let at = 0; at < count * 3; at += 1) {
      const axis = at % 3;
      positions[at] = Math.max(-32768, Math.min(32767, Math.round(((mesh.positions[at] - min[axis]) / span[axis]) * 65535 - 32768)));
    }
    const normals = new Int8Array(count * 4);
    for (let at = 0; at < count; at += 1)
      for (let axis = 0; axis < 3; axis += 1) normals[at * 4 + axis] = Math.max(-127, Math.min(127, Math.round((mesh.normals?.[at * 3 + axis] ?? 0) * 127)));
    const wide = count > 65535;
    const indices = wide ? Uint32Array.from(mesh.indices) : Uint16Array.from(mesh.indices);
    const out = {
      material: mesh.material,
      part: mesh.part,
      vertices: count,
      indices: indices.length,
      wide,
      position: push(positions),
      normal: push(normals),
      uv: mesh.uvs ? push(mesh.uvs instanceof Float32Array ? mesh.uvs : new Float32Array(mesh.uvs)) : -1,
      index: push(indices),
    };
    const entity = entities ? scene.parts?.[mesh.part]?.entity : undefined;
    if (Number.isInteger(entity) && entity >= 0) out.entity = entity;
    if (mesh.colours) {
      const colours = new Uint8Array(count * 4);
      for (let at = 0; at < count * 4; at += 1) colours[at] = Math.max(0, Math.min(255, Math.round(mesh.colours[at] * 255)));
      out.colour = push(colours);
    }
    /* Вторая развёртка (земля: маска смешения слоёв) — как у кодировщика сборщика сцен (`scripts/lib/scene-encode.mjs`). */
    if (mesh.uvs1) out.uv1 = push(mesh.uvs1 instanceof Float32Array ? mesh.uvs1 : new Float32Array(mesh.uvs1));
    return out;
  });
  const header = Buffer.from(
    JSON.stringify({
      version: 1,
      up: "z",
      bounds: { min, max },
      parts: scene.parts,
      /* Таблица комнат помещения (`mloRooms`): имя, порталы, связи; разметка выделения берёт из неё «закрытую комнату». */
      ...(Array.isArray(scene.rooms) && scene.rooms.length ? { rooms: scene.rooms } : {}),
      materials: scene.materials,
      textures: scene.textures,
      /* Лампы (зал арены «игра + мод»): в осях сцены, читаются из заголовка любой версии. */
      ...(Array.isArray(scene.lamps) && scene.lamps.length ? { lamps: scene.lamps } : {}),
      /* Свет кадра без оттенка (зал Majestic: у автора нейтральный таймцикл): окно красит свет белым и серым, а не тёплым светом залов игры. */
      ...(scene.neutralLight ? { neutralLight: true } : {}),
      meshes,
    }),
    "utf8",
  );
  const headerBytes = Math.ceil(header.length / 4) * 4;
  const head = Buffer.alloc(12 + headerBytes, 0x20);
  head.write(MAGIC, 0, "latin1");
  head.writeUInt32LE(1, 4);
  head.writeUInt32LE(headerBytes, 8);
  header.copy(head, 12);
  return zlib.deflateSync(Buffer.concat([head, ...chunks]), { level });
}

/* ------------------------------------------------------------------ *
 * Сцена для окна
 * ------------------------------------------------------------------ */

const ARCHIVE_OF = /^(x64[a-z]\.rpf|update|update\/x64\/dlcpacks\/[a-z0-9_]{1,40}\/dlc\.rpf):/;
const INTERIOR_ID = /^[a-z0-9_]{1,40}$/;
const sha = (text) => createHash("sha256").update(text).digest("hex");

const defaultTools = () => ({
  archiveSupport: provisionArchiveSupport,
  openGame: async (gameRoot, keys) => createGameReader(gameRoot, await keysFromDirectory(keys || "")),
});

/* Отпечаток архивов игры, из которых собирается сцена: другая версия игры — другая сцена. */
async function archiveStamp(gameRoot, files) {
  const labels = [...new Set(files.map((at) => ARCHIVE_OF.exec(at)?.[1]).filter(Boolean))].sort();
  const parts = [];
  for (const label of labels) {
    const file = path.join(gameRoot, label === "update" ? "update/update.rpf" : label);
    const stat = await fs.stat(file).catch(() => null);
    parts.push(`${label}:${stat ? `${stat.size}:${Math.round(stat.mtimeMs)}` : "-"}`);
  }
  return parts.join("|");
}

/* Сборки, что идут прямо сейчас: два запроса одного помещения — одна сборка. */
const building = new Map();

export const SHOP_SCENE_OUT_OF_MEMORY =
  "Помещение не собралось из файлов вашей игры: не хватило памяти. Обычно так бывает с редуксом, который меняет интерьеры. Astral попробует снова, когда файлы игры изменятся.";

/**
 * Сборка сцены из файлов игры — то, что тяжело: открыть архивы, прочитать
 * модели и листы, сшить сетку, сжать. Без кэша и без главного процесса:
 * её зовёт поток (`shop-scene-worker.js`) и, в песочнице и тестах, сам
 * `readShopScene`. `task = { id, pieces, gameRoot, keys }`.
 * Ответ — `{ bytes, report }` или `{ reason }`.
 */
export async function buildShopSceneBytes({ id, pieces = null, gameRoot, keys }, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  const plans = t.plan || (await import("@modovik/climb-contract/recolor/inventory/shops-scenes")).default;
  const scene = plans.scenes?.[id];
  const interior = t.interiorOf ? t.interiorOf(id) : shopInterior(id);
  if (!scene || !interior) return { reason: "Этого помещения нет в описи Astral." };
  const game = await t.openGame(gameRoot, keys);
  try {
    const read = (at) => game.read(at).catch(() => null);
    const built = pieces ? await buildShopPieceMeshes(plans.catalog, plans.files, pieces, read) : await buildShopSceneMeshes(scene, plans.files, interior, read);
    if (!built.meshes.length) return { reason: "Файлов помещения нет в вашей игре — проверьте GTA V." };
    return { bytes: encodeShopScene(built), report: built.report };
  } finally {
    await game?.close?.().catch(() => {});
  }
}

/* Имя модели каталога замены — как у игры. */
const MODEL_NAME = /^[a-z0-9_]{1,64}$/;
const MODELS_LIMIT = 64;

/**
 * Сцена помещения для 3D-кадра: `input = { interior, gameRoot, keys?,
 * models? }`. С `models` — не помещение, а модели каталога замены этого
 * помещения, каждая своей частью (кадр ставит их на места заменённых вещей).
 * Ответ — `{ scene: ArrayBuffer, report }` или `{ scene: null, reason }`.
 * Сцена держится в кэше Astral по помещению (и моделям), плану описи и
 * отпечатку архивов игры: второе открытие — без сборки.
 */
export async function readShopScene(input, stateDir, tools = {}) {
  const t = { ...defaultTools(), ...tools };
  /* План и опись можно дать своими (песочница dev-сервера берёт их свежими с диска). */
  const plans = t.plan || (await import("@modovik/climb-contract/recolor/inventory/shops-scenes")).default;
  const id = String(input?.interior || "");
  const scene = INTERIOR_ID.test(id) ? plans.scenes?.[id] : null;
  const interior = t.interiorOf ? t.interiorOf(id) : shopInterior(id);
  if (!scene || !interior) return { scene: null, reason: "Этого помещения нет в описи Astral." };
  const gameRoot = String(input?.gameRoot || "").trim();
  if (!gameRoot || !path.isAbsolute(gameRoot)) return { scene: null, reason: "Подключите GTA V: кадр собирается из файлов вашей игры." };
  const files = plans.files;
  /* Модели замены — только из каталога этого помещения. */
  const allowed = new Set(Object.values(interior.swaps || {}).flat());
  const pieces = Array.isArray(input?.models)
    ? [...new Set(input.models.map((name) => String(name).toLowerCase()))].filter((name) => MODEL_NAME.test(name) && allowed.has(name) && plans.catalog?.models?.[name]).sort().slice(0, MODELS_LIMIT)
    : null;
  if (pieces && !pieces.length) return { scene: null, reason: "Моделей замены нет в каталоге помещения." };
  const used = pieces
    ? [...new Set(pieces.map((name) => files[plans.catalog.models[name][0]]))]
    : [...new Set([...scene.entities.map((entity) => files[entity[1]]), ...scene.textures.map((entry) => files[entry[0]])])];
  const stamp = await archiveStamp(gameRoot, used);
  const key = sha(
    JSON.stringify([SHOP_SCENE_BUILDER, id, pieces || "", gameRoot.toLowerCase(), stamp, plans.signature || "", sha(JSON.stringify([interior.surfaces || {}, (interior.items || []).length]))]),
  ).slice(0, 32);
  const cacheDir = path.join(stateDir || os.tmpdir(), "shop-scenes");
  const prefix = pieces ? `${id}-pieces-` : `${id}-`;
  const cacheFile = path.join(cacheDir, `${prefix}${key}.bin`);
  /* Сборка на этих файлах игры уже не уложилась в память — не повторять её
     на каждом запуске (печь обложек), пока файлы игры те же. */
  const failedFile = path.join(cacheDir, `${prefix}${key}.oom`);
  const cached = await fs.readFile(cacheFile).catch(() => null);
  if (cached) return { scene: cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength), cached: true };
  if (await fs.stat(failedFile).catch(() => null)) return { scene: null, reason: SHOP_SCENE_OUT_OF_MEMORY };
  if (building.has(cacheFile)) return building.get(cacheFile);
  const job = (async () => {
    const keys = await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: t.archiveSupport });
    const task = { id, pieces, gameRoot, keys };
    /* Сборка из файлов игры — в своём потоке с пределом памяти (`t.build`, главный процесс):
       редукс с тяжёлыми файлами роняет поток, а не Astral (18.10, ssazzy). */
    const built = t.build && !t.plan ? await t.build(task) : await buildShopSceneBytes(task, t);
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
    if (built.outOfMemory) {
      await fs.writeFile(failedFile, "").catch(() => {});
      return { scene: null, reason: SHOP_SCENE_OUT_OF_MEMORY };
    }
    if (!built.bytes) return { scene: null, reason: built.reason || "Файлов помещения нет в вашей игре — проверьте GTA V." };
    const bytes = built.bytes;
    /* Прежние сборки помещения (другая игра, другой план): у помещения — одна, у моделей замены — последние несколько. */
    const stale = (await fs.readdir(cacheDir).catch(() => []))
      .filter((name) => name.endsWith(".bin"))
      .filter((name) => (pieces ? name.startsWith(prefix) : name.startsWith(prefix) && !name.startsWith(`${id}-pieces-`)) && name !== path.basename(cacheFile))
      .slice(0, pieces ? -PIECE_CACHE : undefined);
    for (const name of stale) await fs.rm(path.join(cacheDir, name), { force: true }).catch(() => {});
    await fs.writeFile(cacheFile, bytes).catch(() => {});
    return { scene: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), report: built.report };
  })();
  building.set(cacheFile, job);
  try {
    return await job;
  } finally {
    building.delete(cacheFile);
  }
}

/* Сборок моделей замены помещения в кэше — не больше стольких. */
const PIECE_CACHE = 6;
