/*
 * Своё место — своими копиями вещей (фикс 2 ТЗ 06.10.2026).
 *
 * Места мастерской правят файлы игры по имени: модель контейнера, забор,
 * банкомат, словарь квартала. Игра ставит те же модели и словари далеко за
 * пределами места — и покраска разъезжалась по всему миру: фиолетовые
 * контейнеры в порту, синий пол в чужом квартале, банкоматы арены по всему
 * городу. Здесь собранные файлы места становятся своими:
 *
 *   • общий словарь (его берут и вещи вне места) едет копией под своим
 *     именем (`astral_<место>_tNN.ytd`); вещам места, что стоят только в
 *     месте, — ссылка на копию правкой их типов (`textureDictionary`);
 *   • общая модель (контейнер, забор, прицеп — их ставят и вне места) и
 *     вещь места, что стоит и снаружи, — копия архетипа под своим именем
 *     (`astral_<место>_cNNN`) со своей моделью; сущности карт района, что
 *     стоят в месте (и вещи интерьера), смотрят на копию — правкой карт по
 *     номеру сущности (с проверкой, что там та же вещь);
 *   • копии архетипов места — в своих постоянных типах
 *     `astral_<место>_local.ytyp` (их держит пакет мест, `DLC_ITYP_REQUEST`,
 *     как пакеты Rockstar — свои пропы): карта района находит копию всегда;
 *   • штатные файлы, что правка общих вещей тронула бы везде, в игру не едут;
 *     как и файлы, чьих вещей в месте нет вовсе (пропы пака мода, что стоят
 *     только в городе): их правку видно было бы только вне места.
 *
 * Где что стоит, считает подготовка по всей карте игры
 * (`scripts/prepare-place-isolation.mjs` → `resources/recolor-local/<место>.json`).
 * Дальние планы (LOD, SLOD) — у общей системы LOD (`recolor-lod.js`): их
 * листы красятся только своим текселям, общие — копией словаря.
 *
 * Чего копия не даёт: словарь высокой чёткости модели (`+hidr`, `+hifr`)
 * игра цепляет к модели по манифесту Rockstar, у копии его нет — вблизи
 * копия рисует свои встроенные листы (тот же цвет, чуть мягче). Копия
 * общего словаря берёт листы высокой чёткости, если они есть.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const inflateRaw = inflateResource;

/* Хеш имени игры (joaat), строчными. */
export function joaatName(text) {
  let hash = 0;
  for (const char of String(text).toLowerCase()) {
    hash = (hash + char.charCodeAt(0)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

const leaf = (address) => String(address).split("/").pop().toLowerCase();
const extensionOf = (name) => String(name).toLowerCase().split(".").pop();

/* ------------------------------------------------------------------ *
 * Правка Meta-ресурсов (карты и типы) на месте
 * ------------------------------------------------------------------ */

/*
 * Meta-ресурс на правку: блоки и адреса как у `readMapData` подготовки.
 * Длина файла та же — меняются только хеши, ресурс пережимается с прежним
 * заголовком (как `patchArchetypeDictionaries`).
 */
function openMeta(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  if (resource.version !== 2) throw new Error("Файл карты или типов — не Meta-ресурс.");
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const rootBlock = view.getInt32(rootAt + 0x1c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * 16;
    blocks.push({ dataAt: resource.at(view.getBigUint64(at + 8, true)) });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? block.dataAt + Number((pointer >> 12n) & 0xfffffn) : -1;
  };
  const rootData = blocks[rootBlock - 1]?.dataAt;
  if (rootData == null || rootData < 0) throw new Error("Корень Meta-ресурса не найден.");
  /* Массив указателей Meta: адрес, число (16 бит). */
  const pointers = (at) => {
    const listAt = resolve(view.getBigUint64(at, true));
    const count = view.getUint16(at + 8, true);
    const out = [];
    for (let index = 0; index < count && listAt >= 0; index += 1) out.push(resolve(view.getBigUint64(listAt + index * 8, true)));
    return out;
  };
  const save = () => {
    const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
    const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
    Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
    compressed.copy(out, RSC7_HEADER_BYTES);
    return out;
  };
  return { view, rootData, pointers, save };
}

/* Сущность (`CEntityDef`): хеш архетипа — по смещению 8, место — 32, родитель LOD — 72. */
const ENTITY_ARCHETYPE = 8;
const ENTITY_POSITION = 32;
const ENTITY_PARENT = 72;

/**
 * Карта на чтение: имя карты-родителя (`CMapData.parent`, +12) и сущности —
 * `{ parent, entities: [{ archetype, position, parentIndex }] }`.
 */
export function readMapEntities(bytes) {
  const meta = openMeta(bytes);
  const { view } = meta;
  return {
    parent: view.getUint32(meta.rootData + 12, true) >>> 0,
    entities: meta.pointers(meta.rootData + 96).map((at) =>
      at < 0
        ? null
        : {
            archetype: view.getUint32(at + ENTITY_ARCHETYPE, true) >>> 0,
            position: [0, 4, 8].map((offset) => view.getFloat32(at + ENTITY_POSITION + offset, true)),
            parentIndex: view.getInt32(at + ENTITY_PARENT, true),
          },
    ),
  };
}
/* Насколько может разойтись место сущности с описью (м): карта мода, где
   номера сущностей сдвинуты, — та же вещь на том же месте. */
const POSITION_SLACK = 0.5;

/*
 * Сущность правки: по номеру из описи, а если там не та вещь (карта мода
 * со своим порядком сущностей) — та же вещь на том же месте. Номер, уже
 * взятый другой правкой, второй раз не берётся.
 */
function findEntity(view, entities, change, index, taken, slack = POSITION_SLACK) {
  const distanceAt = (entityAt) =>
    change.position
      ? Math.hypot(
          view.getFloat32(entityAt + ENTITY_POSITION, true) - change.position[0],
          view.getFloat32(entityAt + ENTITY_POSITION + 4, true) - change.position[1],
          view.getFloat32(entityAt + ENTITY_POSITION + 8, true) - change.position[2],
        )
      : 0;
  const fits = (entityAt, candidate) => entityAt != null && entityAt >= 0 && !taken.has(candidate) && view.getUint32(entityAt + ENTITY_ARCHETYPE, true) === change.from >>> 0;
  if (fits(entities[index], index) && distanceAt(entities[index]) <= slack) return index;
  if (!change.position) return -1;
  let best = -1;
  let bestDistance = slack;
  entities.forEach((entityAt, candidate) => {
    if (!fits(entityAt, candidate)) return;
    const distance = distanceAt(entityAt);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Карта: сущностям по номеру — другой архетип. `changes` — `Map` номер →
 * `{ from, to, position? }`: правится сущность с архетипом `from` — по
 * номеру или, если номер сдвинут (карта мода), по месту `position` (мир).
 * Нет такой — карта игрока не та, сущность остаётся.
 * `{ bytes, patched, mismatched }`; `bytes` — `null`, если не правлено ничего.
 */
export function patchMapEntityArchetypes(bytes, changes) {
  const meta = openMeta(bytes);
  /* `CMapData.entities` — массив указателей по смещению 96. */
  const entities = meta.pointers(meta.rootData + 96);
  const taken = new Set();
  let patched = 0;
  let mismatched = 0;
  for (const [index, change] of changes) {
    const found = findEntity(meta.view, entities, change, index, taken);
    if (found < 0) {
      mismatched += 1;
      continue;
    }
    taken.add(found);
    meta.view.setUint32(entities[found] + ENTITY_ARCHETYPE, change.to >>> 0, true);
    patched += 1;
  }
  return { bytes: patched ? meta.save() : null, patched, mismatched };
}

/*
 * Вещь, убранная из места («Удалить» в «Предметах», ТЗ 26.10.2026): сущность карты прячется дальностью прорисовки 1 см — как вещи
 * зала арены (`recolor-arenas.js`: `HIDDEN_LOD`). Номера сущностей у карты игрока и карты мода могут разойтись, а у описи завода
 * номера карты нет: вещь ищется по архетипу и месту с точностью до сантиметров (`HIDE_SLACK`) — рядом стоящие вещи той же модели
 * (бетонные блоки в ряд) не путаются: берётся ближайшая.
 */
export const HIDDEN_LOD = 0.01;
const ENTITY_LOD_DIST = 76;
const HIDE_SLACK = 0.05;

/**
 * Карта: сущности `hidden` — `[{ archetype, position }]` (хеш архетипа и место в мире) — прячутся. `archetype` — хеш или список хешей:
 * карту места могли править копии архетипов (`patchMapEntityArchetypes`), и вещь стоит уже под копией — берётся любой из списка.
 * Нет такой на месте — карта игрока не та, сущность остаётся. `{ bytes, patched, mismatched, matched }`: `bytes` — `null`, если не правлено ничего; `matched` — номера
 * из `hidden`, что нашлись в этой карте.
 */
export function patchMapEntitiesHidden(bytes, hidden) {
  const meta = openMeta(bytes);
  const entities = meta.pointers(meta.rootData + 96);
  const taken = new Set();
  const matched = new Set();
  let patched = 0;
  for (const [order, item] of hidden.entries()) {
    let found = -1;
    for (const archetype of [].concat(item.archetype)) {
      found = findEntity(meta.view, entities, { from: archetype >>> 0, position: item.position }, -1 - order, taken, HIDE_SLACK);
      if (found >= 0) break;
    }
    if (found < 0) continue;
    taken.add(found);
    matched.add(order);
    meta.view.setFloat32(entities[found] + ENTITY_LOD_DIST, HIDDEN_LOD, true);
    patched += 1;
  }
  return { bytes: patched ? meta.save() : null, patched, mismatched: hidden.length - patched, matched };
}

/**
 * Карта: сущности `repoint` — `[{ archetype, position, to }]` (хеш архетипа или список хешей, место в мире, хеш копии) — встают на копию модели («Цвет», своя
 * модель или картинка у вещи места, ТЗ 27.10.2026). Вещь ищется по архетипу и месту с точностью до сантиметров (`HIDE_SLACK`): ближайшая из той же модели.
 * `{ bytes, patched, mismatched, matched }`: `bytes` — `null`, если не правлено ничего.
 */
export function patchMapEntitiesRepointed(bytes, repoint) {
  const meta = openMeta(bytes);
  const entities = meta.pointers(meta.rootData + 96);
  const taken = new Set();
  const matched = new Set();
  let patched = 0;
  for (const [order, item] of repoint.entries()) {
    let found = -1;
    for (const archetype of [].concat(item.archetype)) {
      found = findEntity(meta.view, entities, { from: archetype >>> 0, position: item.position }, -1 - order, taken, HIDE_SLACK);
      if (found >= 0) break;
    }
    if (found < 0) continue;
    taken.add(found);
    matched.add(order);
    meta.view.setUint32(entities[found] + ENTITY_ARCHETYPE, item.to >>> 0, true);
    patched += 1;
  }
  return { bytes: patched ? meta.save() : null, patched, mismatched: repoint.length - patched, matched };
}

/**
 * Вещи места на копии моделей (`entities` — `[{ archetype, position, to }]`): в каждой карте района из описи изоляции такая сущность встаёт на копию.
 * Карта берётся из уже собранных `files`, иначе из игры; вещь общей модели могла уже перейти на копию набора (`plan.clones`) — ищется и под ней.
 * `{ files, report }`: `repointed` — сколько вещей нашлось хоть в одной карте, `mismatched` — сколько не нашлось нигде.
 */
export async function repointPlaceEntities(files, { plan, game, entities = [] } = {}) {
  const report = { maps: 0, repointed: 0, mismatched: 0, skipped: [] };
  if (!entities.length) return { files, report };
  const out = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const copies = new Map();
  for (const clone of plan?.clones || []) {
    const list = copies.get(clone.archetype >>> 0) || [];
    list.push(joaatName(clone.name));
    copies.set(clone.archetype >>> 0, list);
  }
  const wanted = entities.map((item) => ({ archetype: [item.archetype >>> 0, ...(copies.get(item.archetype >>> 0) || [])], position: item.position, to: item.to }));
  const found = new Set();
  for (const address of plan?.maps || []) {
    const name = leaf(address);
    const bytes = out.get(name)?.bytes || (await game?.read(address).catch(() => null));
    if (!bytes) {
      report.skipped.push(`${name}: карты нет в игре`);
      continue;
    }
    const patched = patchMapEntitiesRepointed(new Uint8Array(bytes), wanted.filter((_, order) => !found.has(order)));
    /* Номера `matched` — среди ещё не найденных: переводим в общие. */
    const remaining = wanted.map((_, order) => order).filter((order) => !found.has(order));
    for (const local of patched.matched) found.add(remaining[local]);
    if (!patched.bytes) continue;
    out.set(name, { name, bytes: patched.bytes });
    report.maps += 1;
  }
  report.repointed = found.size;
  report.mismatched = wanted.length - found.size;
  return { files: [...out.values()], report };
}

/**
 * Типы: архетипам — другой словарь текстур (`rebind`: хеш архетипа → хеш
 * словаря) и сущностям интерьеров — другой архетип (`interiors`: хеш
 * архетипа интерьера → `Map` номер сущности → `{ from, to, position? }`,
 * место — в осях интерьера).
 * `{ bytes, patched, mismatched }`.
 */
export function patchTypesForPlace(bytes, { rebind = new Map(), interiors = new Map() } = {}) {
  const meta = openMeta(bytes);
  /* `CMapTypes.archetypes` — по смещению 24; у архетипа имя — 88, словарь
     текстур — 92; у интерьера (`CMloArchetypeDef`) сущности — 152. */
  let patched = 0;
  let mismatched = 0;
  const seenInteriors = new Set();
  for (const at of meta.pointers(meta.rootData + 24)) {
    if (at < 0) continue;
    const name = meta.view.getUint32(at + 88, true) >>> 0;
    const txd = rebind.get(name);
    if (txd != null) {
      meta.view.setUint32(at + 92, txd >>> 0, true);
      patched += 1;
    }
    const inner = interiors.get(name);
    if (!inner) continue;
    seenInteriors.add(name);
    const entities = meta.pointers(at + 152);
    const taken = new Set();
    for (const [index, change] of inner) {
      const found = findEntity(meta.view, entities, change, index, taken);
      if (found < 0) {
        mismatched += 1;
        continue;
      }
      taken.add(found);
      meta.view.setUint32(entities[found] + ENTITY_ARCHETYPE, change.to >>> 0, true);
      patched += 1;
    }
  }
  for (const [name, inner] of interiors) if (!seenInteriors.has(name)) mismatched += inner.size;
  return { bytes: patched ? meta.save() : null, patched, mismatched };
}

/* ------------------------------------------------------------------ *
 * Опись места
 * ------------------------------------------------------------------ */

/**
 * Опись изоляции места (`resources/recolor-local/<место>.json`) или `null`:
 * без описи место ставится как раньше.
 */
export async function readPlaceIsolation(setId) {
  const candidates = [
    process.env.ASTRAL_RECOLOR_LOCAL && path.join(process.env.ASTRAL_RECOLOR_LOCAL, `${setId}.json`),
    process.resourcesPath && path.join(process.resourcesPath, "recolor-local", `${setId}.json`),
    path.resolve(dirname, "../../../resources/recolor-local", `${setId}.json`),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const text = await fs.readFile(candidate, "utf8").catch(() => null);
    if (!text) continue;
    try {
      const plan = JSON.parse(text);
      if (plan?.set === setId && plan.version === PLACE_ISOLATION_VERSION) return plan;
    } catch {
      /* битая опись — как будто её нет */
    }
  }
  return null;
}

/* Меняется вместе с формой описи (`prepare-place-isolation.mjs`). */
export const PLACE_ISOLATION_VERSION = 2;

/** Имя постоянных типов места: копии архетипов. */
export const placeLocalTypes = (setId) => `astral_${setId}_local`;

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/**
 * Файлы места → свои: копии общих словарей и моделей, правленые типы и
 * карты района, постоянные типы копий. `files` — `[{ name, bytes }]`
 * собранного набора (правленые файлы игры под своими именами, плашки,
 * дальние планы); `plan` — опись (`readPlaceIsolation`); `game.read(адрес)`
 * — файлы игры; `compile(команда, вход)` — нативный хост
 * (`compile-place-types`); `unchanged(имя, байты)` — файл мода как есть,
 * без правки работы. Возвращает `{ files, report }`.
 */
export async function localizePlaceFiles(setId, files, { plan, game, compile, stateDir = os.tmpdir(), unchanged = () => false } = {}) {
  const report = { copies: [], clones: 0, entities: 0, maps: 0, types: 0, mismatched: 0, kept: [], dropped: [], skipped: [] };
  if (!plan) return { files, report };
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const out = new Map(byName);
  const shipped = (name) => (name ? byName.get(String(name).toLowerCase()) || null : null);
  const typesEdits = new Map();
  const mapEdits = new Map();
  const typesEdit = (address) => {
    if (!typesEdits.has(address)) typesEdits.set(address, { rebind: new Map(), interiors: new Map() });
    return typesEdits.get(address);
  };

  /* 0. Файлы, чьих вещей в месте нет вовсе: правка легла бы только на мир. */
  for (const name of plan.drop || []) {
    const key = String(name).toLowerCase();
    const file = out.get(key);
    /* Файл мода без правки (`unchanged`) остаётся — это облик самого мода
       (у ангара — разметка аэропорта), а не покраска Astral. */
    if (!file || unchanged(file.name, file.bytes)) continue;
    out.delete(key);
    report.dropped.push(name);
  }

  /* 1. Общие словари — копией под своим именем. */
  const copyOf = new Map();
  for (const entry of plan.dictionaries || []) {
    const base = shipped(entry.file);
    const hd = shipped(entry.hd);
    if (!base && !hd) continue;
    /* Копия берёт листы высокой чёткости: у копии своей пары `+hi` нет. */
    const bytes = hd?.bytes || base.bytes;
    out.delete(entry.file.toLowerCase());
    if (entry.hd) out.delete(entry.hd.toLowerCase());
    out.set(`${entry.copy}.ytd`, { name: `${entry.copy}.ytd`, bytes });
    copyOf.set(entry.txd, entry.copy);
    for (const rebind of entry.rebind || []) for (const hash of rebind.archetypes || []) typesEdit(rebind.ytyp).rebind.set(hash >>> 0, joaatName(entry.copy));
    report.copies.push(`${entry.copy}.ytd`);
  }

  /* 2. Общие вещи места — копиями архетипов. */
  const clones = [];
  for (const clone of plan.clones || []) {
    const model = shipped(clone.model);
    const hd = shipped(clone.hd);
    const txdCopy = copyOf.get(clone.txd) || null;
    if (!model && !hd && !txdCopy) continue;
    const bytes = model?.bytes || (clone.modelAt ? await game?.read(clone.modelAt).catch(() => null) : null);
    if (!bytes?.length) {
      report.skipped.push(`${clone.archetypeName}: модели нет в игре — копия не делается`);
      continue;
    }
    const fileName = `${clone.name}.${extensionOf(clone.model)}`;
    out.set(fileName, { name: fileName, bytes });
    if (model) out.delete(clone.model.toLowerCase());
    if (hd) out.delete(clone.hd.toLowerCase());
    clones.push({
      source: clone.ytyp,
      archetypeHash: clone.archetype >>> 0,
      name: clone.name,
      assetName: clone.name,
      /* Копия вещи со своим словарём листов (`recolor-place-items.js`: «Цвет» вещи) смотрит на него; иначе — на копию общего словаря. */
      ...(clone.textureDictionary ? { textureDictionary: clone.textureDictionary } : txdCopy ? { textureDictionary: txdCopy } : {}),
    });
    const to = joaatName(clone.name);
    for (const entity of clone.entities || []) {
      if (entity.mlo) {
        const interiors = typesEdit(entity.mlo.ytyp).interiors;
        const inner = interiors.get(entity.mlo.archetype >>> 0) || new Map();
        inner.set(entity.index, { from: clone.archetype >>> 0, to, ...(entity.mlo.local?.length === 3 ? { position: entity.mlo.local } : {}) });
        interiors.set(entity.mlo.archetype >>> 0, inner);
      } else {
        const changes = mapEdits.get(entity.map) || new Map();
        changes.set(entity.index, { from: clone.archetype >>> 0, to, ...(entity.position?.length === 3 ? { position: entity.position } : {}) });
        mapEdits.set(entity.map, changes);
      }
    }
    report.clones += 1;
    report.entities += (clone.entities || []).length;
  }

  /* 3. Постоянные типы копий — нативным хостом из типов игры. */
  if (clones.length) {
    if (typeof compile !== "function") throw new Error("Сборщик копий вещей места не подключён — обновите Astral.");
    const staging = path.join(stateDir, "recolor", setId, "local-types", randomUUID());
    await fs.mkdir(staging, { recursive: true });
    try {
      const sources = [];
      const ids = new Map();
      for (const address of new Set(clones.map((clone) => clone.source))) {
        const bytes = await game?.read(address).catch(() => null);
        if (!bytes) throw new Error(`Типы игры ${leaf(address)} не прочитались — копии вещей места не собрать.`);
        const id = `s${ids.size + 1}`;
        const file = path.join(staging, `${id}.ytyp`);
        await fs.writeFile(file, bytes);
        ids.set(address, id);
        sources.push({ id, file });
      }
      const request = path.join(staging, "request.json");
      const output = path.join(staging, `${placeLocalTypes(setId)}.ytyp`);
      await fs.writeFile(
        request,
        JSON.stringify({
          format: "astral.compile-place-types",
          version: 1,
          typesName: placeLocalTypes(setId),
          sources,
          clones: clones.map(({ source, ...clone }) => ({ source: ids.get(source), ...clone })),
        }),
      );
      await compile("compile-place-types", { input: request, output });
      const bytes = await fs.readFile(output);
      out.set(`${placeLocalTypes(setId)}.ytyp`, { name: `${placeLocalTypes(setId)}.ytyp`, bytes });
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /* 4. Типы района: ссылки на копии словарей и вещи интерьеров. Основа —
     уже правленый набором файл (изоляция LOD, интерьер арены) или штатный. */
  for (const [address, edits] of typesEdits) {
    const name = leaf(address);
    const bytes = out.get(name)?.bytes || (await game?.read(address).catch(() => null));
    if (!bytes) {
      report.skipped.push(`${name}: типов нет в игре`);
      continue;
    }
    const patched = patchTypesForPlace(new Uint8Array(bytes), edits);
    report.mismatched += patched.mismatched;
    if (!patched.bytes) continue;
    out.set(name, { name, bytes: patched.bytes });
    report.types += 1;
  }

  /* 5. Карты района: сущности места — на копии. */
  for (const [address, changes] of mapEdits) {
    const name = leaf(address);
    const bytes = out.get(name)?.bytes || (await game?.read(address).catch(() => null));
    if (!bytes) {
      report.skipped.push(`${name}: карты нет в игре`);
      continue;
    }
    const patched = patchMapEntityArchetypes(new Uint8Array(bytes), changes);
    report.mismatched += patched.mismatched;
    if (!patched.bytes) continue;
    out.set(name, { name, bytes: patched.bytes });
    report.maps += 1;
  }

  /* Что из правленого ушло бы в мир, а не к месту, — в отчёт. */
  for (const name of plan.local || []) if (out.has(name)) report.kept.push(name);
  return { files: [...out.values()], report };
}

/**
 * Вещи места, убранные по одной (`entities` — `[{ archetype, position }]`): в каждой карте района из описи изоляции (`plan.maps`:
 * базовая и карты дополнений, что ставят то же) такая сущность прячется (`patchMapEntitiesHidden`). Карта берётся из уже собранных
 * `files` (там её могли править копии архетипов), иначе из игры. `{ files, report }`: `hidden` — сколько вещей нашлось хоть в одной
 * карте, `mismatched` — сколько не нашлось нигде (файлы игры другой версии), `maps` — карт правлено.
 */
export async function hidePlaceEntities(files, { plan, game, entities = [] } = {}) {
  const report = { maps: 0, hidden: 0, mismatched: 0, skipped: [] };
  if (!entities.length) return { files, report };
  const out = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  /* Вещь общей модели в карте места уже могла перейти на копию (`astral_<место>_cNNN`) — ищется и под ней. */
  const copies = new Map();
  for (const clone of plan?.clones || []) {
    const list = copies.get(clone.archetype >>> 0) || [];
    list.push(joaatName(clone.name));
    copies.set(clone.archetype >>> 0, list);
  }
  const wanted = entities.map((item) => ({ archetype: [item.archetype >>> 0, ...(copies.get(item.archetype >>> 0) || [])], position: item.position }));
  const found = new Set();
  for (const address of plan?.maps || []) {
    const name = leaf(address);
    const bytes = out.get(name)?.bytes || (await game?.read(address).catch(() => null));
    if (!bytes) {
      report.skipped.push(`${name}: карты нет в игре`);
      continue;
    }
    const patched = patchMapEntitiesHidden(new Uint8Array(bytes), wanted);
    for (const order of patched.matched) found.add(order);
    if (!patched.bytes) continue;
    out.set(name, { name, bytes: patched.bytes });
    report.maps += 1;
  }
  report.hidden = found.size;
  report.mismatched = wanted.length - found.size;
  return { files: [...out.values()], report };
}
