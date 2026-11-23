/*
 * «Интерьеры» в файлах (задача 3 ТЗ 10.10.2026).
 *
 * Основа — помещения игры игрока (опись `shops`): магазин одного вида — одно
 * помещение (архетип интерьера), поэтому правка его файлов ложится на все
 * экземпляры сразу. Пакет везёт только файлы, где что-то поменялось:
 *
 *   • стены, пол, потолок — листы оболочки на месте (`bakeFile`, та же
 *     арифметика, что у остановок и зданий): свой цвет — тоном по
 *     светотени листа. Лист лежит во встроенном словаре модели оболочки
 *     или в словаре помещения — и в их HD-копии (`+hidr`, `+hi`): игра
 *     берёт её вблизи, и без неё правка пропадала бы у самой стены;
 *   • блеск (ТЗ 12.10.2026, задача 2: «плитка — как будто бы зеркалила,
 *     идеально чистая»): чистота — правка пикселей листа (пятна сглажены,
 *     `cleanSheetPixels`), глянец и зеркало — ещё и блик шейдеров
 *     материалов с этим листом в моделях самого помещения
 *     (`shineDrawable`: сила, резкость, френель, отражение; `default` —
 *     на `default_spec`). Модели вне архива помещения не трогаются — блеск
 *     расползся бы по карте; у своих копий вещей блестит копия;
 *   • прилавок, полки, мебель (задача 5 ТЗ 11.10.2026) — их листы так же на
 *     месте; лист модели, что стоит и в других местах (полки 24/7 — и в
 *     LTD), — в своей копии модели помещения (`astral_shops_<помещение>_<модель>`,
 *     архетип — в постоянных типах набора, сущности помещения — на копии):
 *     штатная модель не меняется, и в LTD полки остаются как были;
 *   • убранные вещи — дальностью прорисовки сущности интерьера 1 см
 *     (`patchMloEntities`): комнаты, порталы и номера сущностей остаются
 *     как были. Сущность сверяется с описью по хешу модели: файл игры другой
 *     версии — отказ, а не правка мимо;
 *   • заменённые вещи (проверенные пары и готовые интерьеры, задача 4 ТЗ
 *     11.10.2026, ночь) — той же правкой сущности: модель, место и поворот
 *     (`shopSwapPlace` — та же арифметика, что ставит модель в кадре).
 *
 * Файлы помещений берут только эти помещения (опись проверяет словари на
 * чужих пользователей), поэтому правка не расползается на улицу и в другие
 * интерьеры.
 *
 * Снаружи (второй заход задачи 3) — заправки и фасады магазинов, колонки —
 * `recolor-shops-outside.js`: их файлы едут тем же пакетом.
 *
 * Свои модели (ТЗ 11.10.2026, вечер, задача 1) ставит общий установщик мест
 * (`recolor-place-models.js`) поверх этих файлов: модель изнутри —
 * сущностью MLO помещения (`shopModelInterior`), снаружи — своей картой.
 */

import zlib from "node:zlib";
import { jenkinsHash, shineDrawable } from "@modovik/ypt";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw } from "@modovik/native-rs";
import {
  SHOP_SURFACE_IDS,
  changedShopInteriors,
  normalizeShopsProject,
  shopHiddenItems,
  shopLightIsStock,
  shopLightModels,
  shopSwappedItems,
  shopInterior,
  shopModelScene,
  shopShine,
  shopsProjectIsStock,
} from "@modovik/climb-contract/recolor/shops";
import { shopSwapPlace } from "@modovik/climb-contract/recolor/shops-kits";
import { interiorCopyName } from "@modovik/climb-contract/recolor/shops-local";
import { finishSource } from "./finish-bake.js";
import { bakeFile, inflateRaw } from "./recolor-sheets.js";
import { buildShopOutsideFiles, shopSurfaceOp } from "./recolor-shops-outside.js";

export { shopSurfaceOp };

/* Сущность не видна дальше 1 см — «Убрать» без правки комнат и порталов (как у арены). */
export const HIDDEN_LOD = 0.01;
/* Структура Meta интерьера (`CMloArchetypeDef`) — хеш с регистром, как в `rage-meta.mjs`. */
const MLO_ARCHETYPE = 0x10506455;

/*
 * Интерьеры распакованного ресурса типов: хеш имени → смещения его
 * сущностей (`CEntityDef`, 128 байт). Разметка Meta — как у
 * `scripts/lib/rage-meta.mjs` (CodeWalker `MetaTypes.cs`).
 */
function mloEntityTable(resource) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const rootBlockIndex = view.getInt32(rootAt + 0x1c, true);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ nameHash: view.getUint32(at, true), dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? { at: block.dataAt + Number((pointer >> 12n) & 0xfffffn), structure: block.nameHash } : null;
  };
  const pointers = (at) => {
    const count = view.getUint16(at + 8, true);
    const list = count ? resolve(view.getBigUint64(at, true)) : null;
    const out = [];
    for (let index = 0; index < count && list; index += 1) {
      const item = resolve(view.getBigUint64(list.at + index * 8, true));
      if (item) out.push(item);
    }
    return out;
  };
  const root = blocks[rootBlockIndex - 1];
  if (!root) throw new Error("Типы интерьера не читаются: файл игры повреждён.");
  const table = new Map();
  for (const item of pointers(root.dataAt + 24))
    if (item.structure === MLO_ARCHETYPE) table.set(view.getUint32(item.at + 88, true) >>> 0, pointers(item.at + 152).map((entity) => entity.at));
  return table;
}

/** Сущности интерьеров файла типов: хеш имени интерьера → `[{ archetype, lodDist, z, position, rotation, scale }]` (для проверок). */
export function readMloEntities(bytes) {
  const resource = openResourceWith(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const view = resource.view;
  const floats = (at, count) => Array.from({ length: count }, (_, axis) => view.getFloat32(at + axis * 4, true));
  const out = new Map();
  for (const [hash, entities] of mloEntityTable(resource))
    out.set(
      hash,
      entities.map((at) => ({
        archetype: view.getUint32(at + 8, true) >>> 0,
        lodDist: view.getFloat32(at + 76, true),
        z: view.getFloat32(at + 40, true),
        position: floats(at + 32, 3),
        rotation: floats(at + 48, 4),
        scale: floats(at + 64, 2),
      })),
    );
  return out;
}

/**
 * Правка сущностей интерьеров файла типов на месте: `edits` — `[{ mlo
 * (хеш имени), count (сколько сущностей в описи), entities: [{ index,
 * expect (хеш модели), lodDist?, archetype?, fit?, lift? }] }]`: дальность
 * (убрать вещь), другая модель (заменить вещь — второй заход) и её место:
 * `fit` — сдвиг и доворот проверенной пары (`shopSwapPlace`, та же
 * арифметика, что у кадра: задача 4 ТЗ 11.10.2026, ночь), `lift` — подъём
 * по высоте. Ресурс сжимается заново с прежним заголовком; раскладка и
 * длина данных — прежние.
 */
export function patchMloEntities(bytes, edits) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const view = resource.view;
  const table = mloEntityTable(resource);
  for (const edit of edits) {
    const entities = table.get(edit.mlo >>> 0);
    if (!entities) throw new Error("В типах помещения нет интерьера: файл игры другой версии.");
    if (edit.count !== undefined && entities.length !== edit.count)
      throw new Error(`В помещении ${entities.length} сущностей, а в описи Astral ${edit.count}: файл игры другой версии — обновите Astral.`);
    for (const entity of edit.entities) {
      const at = entities[entity.index];
      if (at === undefined) throw new Error(`В помещении нет сущности ${entity.index}.`);
      if (entity.expect !== undefined && view.getUint32(at + 8, true) >>> 0 !== entity.expect >>> 0)
        throw new Error(`Сущность ${entity.index} помещения — не та модель: файл игры другой версии.`);
      if (entity.lodDist !== undefined) view.setFloat32(at + 76, entity.lodDist, true);
      /* Замена: модель сущности (`archetypeName`, +8), место (`position`, +32) и поворот (`rotation`, +48) — комната, порталы и номер те же. */
      if (entity.archetype !== undefined) view.setUint32(at + 8, entity.archetype >>> 0, true);
      if (entity.fit) {
        const read = (offset, count) => Array.from({ length: count }, (_, axis) => view.getFloat32(at + offset + axis * 4, true));
        const place = shopSwapPlace([...read(32, 3), ...read(48, 4), view.getFloat32(at + 64, true), view.getFloat32(at + 68, true)], entity.fit);
        place.slice(0, 3).forEach((value, axis) => view.setFloat32(at + 32 + axis * 4, value, true));
        place.slice(3, 7).forEach((value, axis) => view.setFloat32(at + 48 + axis * 4, value, true));
      }
      if (entity.lift) view.setFloat32(at + 40, view.getFloat32(at + 40, true) + entity.lift, true);
    }
  }
  const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  Buffer.from(compressed).copy(out, RSC7_HEADER_BYTES);
  return out;
}

/**
 * Помещение для своих моделей сцены «изнутри» (`scene` — помещение,
 * `shop247`): файл типов, MLO и экземпляр. Сцена кадра собрана в осях
 * помещения (`recolor-shops-scene.js` ставит сущности MLO как есть), а
 * экземпляров у помещения много — все 24/7 карты, — поэтому экземпляр
 * единичный: место модели в сцене и есть место сущности в MLO, и модель
 * встаёт во все магазины вида. `game` — читатель игры игрока (файл
 * помещения — только чтение). Не помещение — `null`.
 */
export function shopModelInterior(scene, game) {
  const interior = shopModelScene(scene)?.inside;
  if (!interior) return null;
  return {
    file: interior.ytyp.file,
    mlo: jenkinsHash(interior.mlo) >>> 0,
    instance: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    read: () => (game ? game.read(interior.ytyp.at) : Promise.resolve(null)),
  };
}

/**
 * Правка листа поверхности изнутри: свой цвет (тоном по светотени листа)
 * и чистота блеска (`clean`: сколько пятен убрать, во сколько светлее).
 * «Как в игре» без блеска — `null`.
 */
export function shopInteriorOp(surface) {
  if (!surface) return null;
  const shine = shopShine(surface.shine);
  const base = surface.mode === "colour" ? shopSurfaceOp(surface) : null;
  if (!shine.clean) return base;
  return { ...(base || {}), clean: { amount: shine.clean, lift: shine.lift } };
}

/* Архив помещения: `x64h.rpf:levels/gta5/interiors/v_int_66.rpf/` — его модели меняет только оно. */
export const shopArchiveOf = (interior) => {
  const at = String(interior?.ytyp?.at || "");
  const slash = at.lastIndexOf("/");
  return slash > 0 ? at.slice(0, slash + 1) : "";
};

/*
 * Что правит работа: `ytyps` — файл типов → правки его интерьеров,
 * `sheets` — файл с листами (адрес) → `Map` лист → правка, `shines` —
 * блеск помещения: `{ interior, archive, models, levels: { gloss|mirror:
 * [листы] } }` — модели помещения с листами поверхностей (опись `shine`).
 */
export function shopFilePlan(input) {
  const project = normalizeShopsProject(input);
  const ytyps = new Map();
  const sheets = new Map();
  const shines = [];
  /* Свои копии вещей (задача 5 ТЗ 11.10.2026): `<помещение>|<модель>` → копия и её листы. */
  const copies = new Map();
  for (const id of changedShopInteriors(project)) {
    const interior = shopInterior(id);
    if (!interior) continue;
    const look = project.interiors[id];
    const hidden = shopHiddenItems(project, id);
    /* Замены (второй заход): другая модель на месте вещи, поднятая на разницу низа моделей. */
    const swapped = shopSwappedItems(project, id);
    const levels = {};
    for (const surfaceId of SHOP_SURFACE_IDS) {
      const surface = look.surfaces[surfaceId];
      const shine = shopShine(surface?.shine);
      const op = shopInteriorOp(surface);
      if (!op) continue;
      for (const sheet of interior.surfaces?.[surfaceId] || []) {
        if (shine.shader) (levels[shine.id] ||= []).push(sheet.name.toLowerCase());
        /* Лист модели, что стоит и в других местах, — в своей копии модели этого помещения. */
        if (sheet.copy) {
          const key = `${id}|${sheet.copy.model}`;
          const copy = copies.get(key) || {
            interior: id,
            model: sheet.copy.model,
            name: interiorCopyName(id, sheet.copy.model),
            file: sheet.file,
            at: sheet.at,
            ytyp: sheet.copy.ytyp,
            entities: sheet.copy.entities,
            ops: new Map(),
            shine: new Map(),
          };
          copy.ops.set(sheet.name, op);
          /* Блестит своя копия вещи — штатная модель на карте остаётся как была. */
          if (shine.shader) copy.shine.set(sheet.name.toLowerCase(), shine.id);
          copies.set(key, copy);
          continue;
        }
        for (const target of [{ file: sheet.file, at: sheet.at }, ...(sheet.hd ? [{ file: sheet.hd.file, at: sheet.hd.at }] : [])]) {
          const entry = sheets.get(target.file) || { file: target.file, at: target.at, ops: new Map(), interiors: new Set() };
          entry.ops.set(sheet.name, op);
          entry.interiors.add(id);
          sheets.set(target.file, entry);
        }
      }
    }
    if (Object.keys(levels).length) shines.push({ interior: id, archive: shopArchiveOf(interior), models: interior.shine || [], levels });
    /* Сущности, что смотрят на свою копию: все вещи помещения с этой моделью (заменённые — на замене). */
    const swappedAt = new Set(swapped.map((item) => item.index));
    const retargeted = [...copies.values()]
      .filter((copy) => copy.interior === id)
      .flatMap((copy) => copy.entities.filter((index) => !swappedAt.has(index)).map((index) => ({ index, expect: jenkinsHash(copy.model) >>> 0, archetype: jenkinsHash(copy.name) >>> 0, copy: copy.name })));
    if (hidden.length || swapped.length || retargeted.length) {
      const entry = ytyps.get(interior.ytyp.file) || { file: interior.ytyp.file, at: interior.ytyp.at, edits: [] };
      const byIndex = new Map();
      for (const item of hidden) byIndex.set(item.index, { index: item.index, expect: jenkinsHash(item.model) >>> 0, lodDist: HIDDEN_LOD });
      for (const item of swapped) byIndex.set(item.index, { index: item.index, expect: jenkinsHash(item.model) >>> 0, archetype: jenkinsHash(item.to) >>> 0, fit: item.fit, swap: item.to });
      /* Убранная вещь с копией — и убрана, и на копии: правки одной сущности — одной записью. */
      for (const item of retargeted) byIndex.set(item.index, { ...(byIndex.get(item.index) || {}), ...item });
      entry.edits.push({ interior: id, mlo: jenkinsHash(interior.mlo) >>> 0, count: interior.entities, entities: [...byIndex.values()].sort((a, b) => a.index - b.index) });
      ytyps.set(interior.ytyp.file, entry);
    }
  }
  return { ytyps: [...ytyps.values()], sheets: [...sheets.values()], copies: [...copies.values()], shines };
}

/*
 * Модели помещения, что блестят: `[{ file, at, levels: Map(уровень → номера
 * шейдеров), bytes }]` — модели описи (`shine`: из архива помещения), у чьих
 * материалов лист цвета — лист поверхности с блеском. `read(at)` — байты
 * модели из игры.
 */
export async function shopShineTargets(shine, { read }) {
  if (!shine.archive) return [];
  const byName = new Map();
  for (const [level, names] of Object.entries(shine.levels)) for (const name of names) byName.set(name, level);
  const files = (shine.models || []).map((model) => model.at).filter((at) => typeof at === "string" && at.startsWith(shine.archive) && at.endsWith(".ydr"));
  const out = [];
  for (const at of files) {
    const bytes = await read(at).catch(() => null);
    if (!bytes) continue;
    let materials = [];
    try {
      materials = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: "ydr" }).drawables[0]?.materials || [];
    } catch {
      continue;
    }
    const levels = new Map();
    materials.forEach((material, index) => {
      const level = byName.get(String(material?.textures?.diffuse || "").toLowerCase());
      if (level) levels.set(level, [...(levels.get(level) || []), index]);
    });
    if (levels.size) out.push({ file: at.slice(at.lastIndexOf("/") + 1), at, levels, bytes });
  }
  return out;
}

/* Блеск модели по уровням: `levels` — Map(уровень → номера шейдеров). */
function shineByLevels(bytes, levels, report) {
  let current = bytes;
  for (const [level, shaders] of levels) {
    const values = shopShine(level).shader;
    if (!values || !shaders.length) continue;
    const shined = shineDrawable(current, { shaders, ...values });
    current = shined.bytes;
    report.shined = (report.shined || 0) + shined.shaders.length;
    report.converted = (report.converted || 0) + shined.shaders.filter((item) => item.converted).length;
    for (const item of shined.skipped) (report.unshined ||= []).push(item.why);
  }
  return current;
}

/* Номера шейдеров своей копии вещи по уровню блеска: лист цвета материала — лист с блеском. */
async function copyShineLevels(bytes, copy) {
  const levels = new Map();
  if (!copy.shine?.size || !/\.ydr$/i.test(copy.file)) return levels;
  let materials = [];
  try {
    materials = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: "ydr" }).drawables[0]?.materials || [];
  } catch {
    return levels;
  }
  materials.forEach((material, index) => {
    const level = copy.shine.get(String(material?.textures?.diffuse || "").toLowerCase());
    if (level) levels.set(level, [...(levels.get(level) || []), index]);
  });
  return levels;
}

/**
 * Файлы интерьеров под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `game` — читатель игры игрока, `images` — свои картинки отделки,
 * `compile` — нативный хост (листы квартала в моделях мест снаружи, копии колонок).
 */
export async function buildShopFiles(input, { game = null, images = new Map(), compile = null, stateDir = "", emblems = new Map(), lights = null } = {}) {
  const project = normalizeShopsProject(input);
  if (shopsProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Интерьеры собираются из файлов вашей игры — подключите GTA V.");
  const plan = shopFilePlan(project);
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image, item.gradient]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };
  const files = [];
  const patches = [];
  const report = { interiors: changedShopInteriors(project), hidden: 0, sheets: 0, missing: [] };
  /* Блеск: модели помещения с листами блестящих поверхностей (опись `shine`). */
  const shineFiles = new Map();
  if (plan.shines.length) {
    for (const shine of plan.shines)
      for (const target of await shopShineTargets(shine, { read: (at) => game.read(at) })) {
        const known = shineFiles.get(target.file);
        if (known) for (const [level, shaders] of target.levels) known.levels.set(level, [...new Set([...(known.levels.get(level) || []), ...shaders])]);
        else shineFiles.set(target.file, target);
      }
  }
  for (const entry of plan.ytyps) {
    const base = await game.read(entry.at).catch(() => null);
    if (!base) {
      report.missing.push(entry.file);
      continue;
    }
    files.push({ name: entry.file, bytes: patchMloEntities(base, entry.edits) });
    const entities = entry.edits.reduce((sum, edit) => sum + edit.entities.filter((entity) => entity.lodDist !== undefined).length, 0);
    const swaps = entry.edits.reduce((sum, edit) => sum + edit.entities.filter((entity) => entity.swap).length, 0);
    report.hidden += entities;
    report.swapped = (report.swapped || 0) + swaps;
    patches.push({ file: entry.file, entities, swaps, interiors: entry.edits.map((edit) => edit.interior) });
  }
  for (const entry of plan.sheets) {
    const read = await game.read(entry.at).catch(() => null);
    if (!read) {
      report.missing.push(entry.file);
      continue;
    }
    /* Модель с листом и с блеском — сначала блик шейдеров, потом листы: обе правки на месте. */
    const shine = shineFiles.get(entry.file);
    shineFiles.delete(entry.file);
    const base = shine ? shineByLevels(read, shine.levels, report) : read;
    const baked = await bakeFile(base, entry.file, (texture) => entry.ops.get(texture) || null, { images: {}, sources: sourceOf });
    if (!baked.textures.length && !shine) continue;
    files.push({ name: entry.file, bytes: baked.bytes });
    report.sheets += baked.textures.length;
    patches.push({ file: entry.file, textures: baked.textures, interiors: [...entry.interiors], ...(shine ? { shine: [...shine.levels.keys()] } : {}) });
  }
  /* Модели помещения, где правится только блеск (лист лежит в словаре помещения). */
  for (const shine of shineFiles.values()) {
    files.push({ name: shine.file, bytes: shineByLevels(shine.bytes, shine.levels, report) });
    patches.push({ file: shine.file, textures: [], shine: [...shine.levels.keys()] });
  }
  /*
   * Свои копии вещей (задача 5 ТЗ 11.10.2026): штатная модель с листами облика
   * помещения под своим именем; архетип копии — в постоянных типах набора
   * (вместе с копиями колонок станций), сущности помещения — на копии.
   */
  const clones = [];
  for (const copy of plan.copies) {
    const base = await game.read(copy.at).catch(() => null);
    if (!base) {
      report.missing.push(copy.file);
      continue;
    }
    /* Своя копия вещи блестит сама: штатная модель на карте не меняется. */
    const shineLevels = await copyShineLevels(base, copy);
    const shined = shineLevels.size ? shineByLevels(base, shineLevels, report) : base;
    const baked = await bakeFile(shined, copy.file, (texture) => copy.ops.get(texture) || null, { images: {}, sources: sourceOf });
    const name = `${copy.name}${copy.file.slice(copy.file.lastIndexOf("."))}`;
    files.push({ name, bytes: baked.bytes });
    report.sheets += baked.textures.length;
    report.copies = (report.copies || 0) + 1;
    patches.push({ file: name, textures: baked.textures, interiors: [copy.interior], copyOf: copy.model });
    clones.push({ source: copy.ytyp, archetypeHash: jenkinsHash(copy.model) >>> 0, name: copy.name, assetName: copy.name });
  }
  /*
   * Свет ламп (ТЗ 17.10.2026, вечер): модели помещения, что стоят только в
   * нём (опись `shops-lights`), — с новыми цветом и силой ламп. Модель с
   * листом или блеском уже в `files` — свет ложится на неё; остальные берутся
   * из игры. Правит помощник RPF (`shop-lights.js`).
   */
  for (const id of report.interiors) {
    const light = project.interiors[id]?.light;
    const models = shopLightModels(id);
    if (shopLightIsStock(light) || !models.length) continue;
    if (!lights) throw new Error("Свет ламп правит помощник RPF — в этой сборке его нет.");
    const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
    const batch = [];
    for (const model of models) {
      const known = byName.get(model.file.toLowerCase());
      const bytes = known?.bytes || (await game.read(model.at).catch(() => null));
      if (!bytes) {
        report.missing.push(model.file);
        continue;
      }
      batch.push({ name: model.file, bytes, known });
    }
    const result = await lights.patch(batch.map(({ name, bytes }) => ({ name, bytes })), light);
    let count = 0;
    for (const [index, item] of result.entries()) {
      if (!item.changed) continue;
      const { known, name } = batch[index];
      if (known) known.bytes = item.bytes;
      else files.push({ name, bytes: item.bytes });
      count += item.lights;
      patches.push({ file: name, lights: item.lights, interiors: [id] });
    }
    report.lights = (report.lights || 0) + count;
  }
  /* Снаружи: места, колонки, свои колонки станций — тем же пакетом (и постоянные типы копий). */
  const outside = await buildShopOutsideFiles(project.outside, { game, compile, stateDir: stateDir || undefined, sourceOf, emblems, clones });
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  for (const file of outside.files) {
    if (names.has(file.name.toLowerCase())) throw new Error(`Файл ${file.name} правят и помещение, и место снаружи — обновите опись Astral.`);
    files.push(file);
  }
  patches.push(...outside.patches);
  report.outside = outside.report;
  report.missing.push(...outside.report.missing);
  if (report.missing.length && !files.length) throw new Error(`В игре нет файлов помещений (${report.missing.slice(0, 3).join(", ")}) — проверьте GTA V.`);
  return { files, patches, report };
}
