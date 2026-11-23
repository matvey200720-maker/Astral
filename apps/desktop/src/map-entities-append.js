/*
 * Новые сущности в карте игры (`*.ymap`) — для засаженности «Растительности»
 * (задача 2 ТЗ 10.10.2026, вечер): деревья добавляются в ту же карту района,
 * где стоят деревья Rockstar, а не в новую карту. Новая карта в пакете
 * дополнения игре неизвестна (её рамки читаются при регистрации данных
 * карты), а замену своей карты пакет растительности уже делает — так же, как
 * с картами травы и перемешкой деревьев.
 *
 * Карта — Meta-ресурс RSC7 (версия 2): корень `Meta` (0x70 байт) с таблицей
 * блоков данных; у блока — хеш структуры, длина и адрес; указатели внутри
 * данных — номер блока и смещение в нём, а не адрес. Поэтому прежний
 * системный сегмент остаётся на своих местах байт в байт (все адреса и
 * указатели те же), новое ложится следом:
 *
 *   • блоки сущностей (`CEntityDef`, 128 байт) — по 128 штук, как у Rockstar;
 *   • новый массив указателей сущностей (прежние + новые) — прежний остаётся
 *     мёртвым грузом: в том же блоке указателей бывают и другие массивы;
 *   • новая таблица блоков (прежние + новые), на неё смотрит корень;
 *   • у `CMapData` — массив сущностей и рамки (сущностей и стриминга).
 *
 * Сегмент — одной страницей наименьшего подходящего размера (у Rockstar
 * страниц несколько, и блок не переходит границу страницы; у одной страницы
 * границ внутри нет). Структуры (`StructureInfos`) и перечисления карты те
 * же — новых типов не появляется. Так же собирает CodeWalker: ссылки на
 * строки (`EncryptedStrings`) он отбрасывает, здесь они остаются на месте.
 */

import zlib from "node:zlib";
import { openResourceWith, readResourceHeader, RSC7_HEADER_BYTES, SYSTEM_BASE } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const ENTITY_BYTES = 128;
/* Сущностей в блоке — как у Rockstar (16 КБ). */
const ENTITIES_PER_BLOCK = 128;
const BLOCK_BYTES = 16;
const PAGE_BASE = 0x200;

/* Поля `CEntityDef` (CodeWalker `MetaTypes.cs`). */
const E = Object.freeze({
  archetype: 8,
  flags: 12,
  guid: 16,
  position: 32,
  rotation: 48,
  scaleXY: 64,
  scaleZ: 68,
  parentIndex: 72,
  lodDist: 76,
  childLodDist: 80,
  lodLevel: 84,
  numChildren: 88,
  priority: 92,
  extensions: 96,
  tint: 120,
});
/* `CMapData`: рамки стриминга и сущностей, массив сущностей. */
const MAP_STREAMING_MIN = 32;
const MAP_STREAMING_MAX = 48;
const MAP_ENTITIES_MIN = 64;
const MAP_ENTITIES_MAX = 80;
const MAP_ENTITIES = 96;
/* Уровень дальности «самостоятельная» (без родителя LOD). */
export const LOD_ORPHAN_HD = 5;

const align = (value, step = 16) => Math.ceil(value / step) * step;
const metaPointer = (blockIndex, offset) => (BigInt(offset) << 12n) | BigInt(blockIndex + 1);

/*
 * Флаги страниц RSC7 для одной страницы `size` байт (степень двойки от 512):
 * до 128 КБ — база 512 и один класс страницы, дальше — класс ×256 и база
 * крупнее (`pageFlagSize` в `resource-core.js` — обратная формула).
 */
export function singlePageFlags(size, versionNibble = 0) {
  const units = Math.max(1, Math.ceil(size / PAGE_BASE));
  const power = Math.ceil(Math.log2(units));
  let flags;
  if (power <= 8) {
    const classBit = [1 << 27, 1 << 26, 1 << 25, 1 << 24, 1 << 17, 1 << 11, 1 << 7, 1 << 5, 1 << 4][power];
    flags = classBit;
  } else flags = (1 << 4) | (power - 8);
  return { flags: ((versionNibble & 0xf) << 28) | flags, size: PAGE_BASE << power };
}

function openMetaParts(resource) {
  const { view } = resource;
  const rootAt = resource.at(resource.root);
  const blocksAt = resource.at(view.getBigUint64(rootAt + 0x30, true));
  const blockCount = view.getInt16(rootAt + 0x4c, true);
  const rootBlock = view.getInt32(rootAt + 0x1c, true);
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const at = blocksAt + index * BLOCK_BYTES;
    blocks.push({
      name: view.getUint32(at, true) >>> 0,
      length: view.getInt32(at + 4, true),
      address: view.getBigUint64(at + 8, true),
      dataAt: resource.at(view.getBigUint64(at + 8, true)),
    });
  }
  const resolve = (pointer) => {
    const block = blocks[Number(pointer & 0xfffn) - 1];
    return block ? block.dataAt + Number((pointer >> 12n) & 0xfffffn) : -1;
  };
  const blockOf = (pointer) => blocks[Number(pointer & 0xfffn) - 1] || null;
  return { rootAt, blocks, rootBlock, resolve, blockOf };
}

/**
 * Сущности карты для засаженности: `[{ archetype, position, rotation, scale }]`
 * — где они стоят, как повёрнуты (кватернион карты как есть: игра хранит
 * обратный поворот) и какого размера (у деревьев Rockstar размер ≈ 0,7).
 */
export function readMapEntityPlaces(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateResource);
  const { view } = resource;
  const { blocks, rootBlock, resolve } = openMetaParts(resource);
  const mapAt = blocks[rootBlock - 1]?.dataAt ?? -1;
  if (mapAt < 0) return [];
  const listAt = resolve(view.getBigUint64(mapAt + MAP_ENTITIES, true));
  const count = view.getUint16(mapAt + MAP_ENTITIES + 8, true);
  const out = [];
  for (let index = 0; index < count && listAt >= 0; index += 1) {
    const at = resolve(view.getBigUint64(listAt + index * 8, true));
    if (at < 0) continue;
    out.push({
      archetype: view.getUint32(at + E.archetype, true) >>> 0,
      position: [0, 4, 8].map((offset) => view.getFloat32(at + E.position + offset, true)),
      rotation: [0, 4, 8, 12].map((offset) => view.getFloat32(at + E.rotation + offset, true)),
      scale: [view.getFloat32(at + E.scaleXY, true), view.getFloat32(at + E.scaleZ, true)],
    });
  }
  return out;
}

/**
 * Карта с новыми сущностями: `entities` — `[{ archetype, position: [x, y, z],
 * rotation: [x, y, z, w], scale: [xy, z], lodDist, flags?, lodLevel?,
 * priority? }]`. Остальные поля — как у первой сущности карты (её байты —
 * заготовка), без родителя LOD, детей и расширений. Возвращает новые байты
 * файла (RSC7) или `null`, если в карте нет сущностей.
 */
export function appendMapEntities(bytes, entities) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = readResourceHeader(raw);
  if (header.version !== 2 || header.graphicsSize) throw new Error("Карта — не Meta-ресурс.");
  const resource = openResourceWith(raw, inflateResource);
  const { view } = resource;
  const { rootAt, blocks, rootBlock, resolve, blockOf } = openMetaParts(resource);
  const mapAt = blocks[rootBlock - 1]?.dataAt ?? -1;
  if (mapAt < 0) throw new Error("Корень карты не найден.");
  const oldPointer = view.getBigUint64(mapAt + MAP_ENTITIES, true);
  const oldCount = view.getUint16(mapAt + MAP_ENTITIES + 8, true);
  if (!oldCount || !entities.length) return null;
  const listAt = resolve(oldPointer);
  const pointers = [];
  for (let index = 0; index < oldCount; index += 1) pointers.push(view.getBigUint64(listAt + index * 8, true));
  const firstAt = resolve(pointers[0]);
  const entityStruct = blockOf(pointers[0])?.name;
  const pointerStruct = blockOf(oldPointer)?.name;
  if (firstAt < 0 || !entityStruct || !pointerStruct) throw new Error("Сущности карты не прочитаны.");
  const template = resource.data.slice(firstAt, firstAt + ENTITY_BYTES);

  /* Новое — следом за прежним сегментом. */
  const chunks = [];
  for (let at = 0; at < entities.length; at += ENTITIES_PER_BLOCK) chunks.push(entities.slice(at, at + ENTITIES_PER_BLOCK));
  let cursor = align(resource.systemSize);
  const placed = [];
  chunks.forEach((chunk, index) => {
    placed.push({ index: blocks.length + index, at: cursor, chunk });
    cursor = align(cursor + chunk.length * ENTITY_BYTES);
  });
  const pointerBlockIndex = blocks.length + chunks.length;
  const pointerAt = cursor;
  const total = oldCount + entities.length;
  cursor = align(pointerAt + total * 8);
  const tableAt = cursor;
  const tableCount = blocks.length + chunks.length + 1;
  cursor = align(tableAt + tableCount * BLOCK_BYTES);
  const page = singlePageFlags(cursor, header.systemFlags >>> 28);
  const data = new Uint8Array(page.size);
  data.set(resource.data.subarray(0, resource.systemSize), 0);
  const out = new DataView(data.buffer);

  /* Сущности: заготовка — первая сущность карты, поля — свои. */
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const streaming = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const { at, chunk } of placed)
    chunk.forEach((entity, item) => {
      const base = at + item * ENTITY_BYTES;
      data.set(template, base);
      out.setUint32(base + E.archetype, entity.archetype >>> 0, true);
      out.setUint32(base + E.flags, (entity.flags ?? 0x00180005) >>> 0, true);
      out.setUint32(base + E.guid, 0, true);
      entity.position.forEach((value, axis) => out.setFloat32(base + E.position + axis * 4, value, true));
      out.setFloat32(base + E.position + 12, 0, true);
      entity.rotation.forEach((value, axis) => out.setFloat32(base + E.rotation + axis * 4, value, true));
      out.setFloat32(base + E.scaleXY, entity.scale[0], true);
      out.setFloat32(base + E.scaleZ, entity.scale[1], true);
      out.setInt32(base + E.parentIndex, -1, true);
      out.setFloat32(base + E.lodDist, entity.lodDist, true);
      out.setFloat32(base + E.childLodDist, 0, true);
      out.setUint32(base + E.lodLevel, entity.lodLevel ?? LOD_ORPHAN_HD, true);
      out.setUint32(base + E.numChildren, 0, true);
      out.setUint32(base + E.priority, entity.priority ?? 0, true);
      for (let offset = 0; offset < 16; offset += 4) out.setUint32(base + E.extensions + offset, 0, true);
      out.setUint32(base + E.tint, 0, true);
      for (let axis = 0; axis < 3; axis += 1) {
        const value = entity.position[axis];
        const reach = axis < 2 ? entity.lodDist : entity.lodDist / 2;
        box.min[axis] = Math.min(box.min[axis], value - 6);
        box.max[axis] = Math.max(box.max[axis], value + (axis === 2 ? 30 : 6));
        streaming.min[axis] = Math.min(streaming.min[axis], value - reach);
        streaming.max[axis] = Math.max(streaming.max[axis], value + reach);
      }
    });

  /* Массив указателей: прежние, затем новые. */
  pointers.forEach((pointer, index) => out.setBigUint64(pointerAt + index * 8, pointer, true));
  let next = oldCount;
  for (const { index, chunk } of placed)
    chunk.forEach((_, item) => {
      out.setBigUint64(pointerAt + next * 8, metaPointer(index, item * ENTITY_BYTES), true);
      next += 1;
    });

  /* Таблица блоков: прежние как были, затем новые. */
  const writeBlock = (slot, name, length, at) => {
    const entry = tableAt + slot * BLOCK_BYTES;
    out.setUint32(entry, name >>> 0, true);
    out.setInt32(entry + 4, length, true);
    out.setBigUint64(entry + 8, BigInt(SYSTEM_BASE + at), true);
  };
  blocks.forEach((block, slot) => {
    const entry = tableAt + slot * BLOCK_BYTES;
    out.setUint32(entry, block.name, true);
    out.setInt32(entry + 4, block.length, true);
    out.setBigUint64(entry + 8, block.address, true);
  });
  for (const { index, at, chunk } of placed) writeBlock(index, entityStruct, chunk.length * ENTITY_BYTES, at);
  writeBlock(pointerBlockIndex, pointerStruct, total * 8, pointerAt);

  /* Корень: таблица блоков; страниц — одна. */
  out.setBigUint64(rootAt + 0x30, BigInt(SYSTEM_BASE + tableAt), true);
  out.setInt16(rootAt + 0x4c, tableCount, true);
  const pagesAt = resource.at(view.getBigUint64(rootAt + 8, true));
  if (pagesAt >= 0) {
    out.setUint8(pagesAt + 8, 1);
    out.setUint8(pagesAt + 9, 0);
  }

  /* `CMapData`: массив сущностей и рамки. */
  out.setBigUint64(mapAt + MAP_ENTITIES, metaPointer(pointerBlockIndex, 0), true);
  out.setUint16(mapAt + MAP_ENTITIES + 8, total, true);
  out.setUint16(mapAt + MAP_ENTITIES + 10, total, true);
  const grow = (minAt, maxAt, extent) => {
    for (let axis = 0; axis < 3; axis += 1) {
      out.setFloat32(minAt + axis * 4, Math.min(out.getFloat32(minAt + axis * 4, true), extent.min[axis]), true);
      out.setFloat32(maxAt + axis * 4, Math.max(out.getFloat32(maxAt + axis * 4, true), extent.max[axis]), true);
    }
  };
  grow(mapAt + MAP_ENTITIES_MIN, mapAt + MAP_ENTITIES_MAX, box);
  grow(mapAt + MAP_STREAMING_MIN, mapAt + MAP_STREAMING_MAX, streaming);

  const compressed = deflateRaw(data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const file = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(file, 0);
  file.writeUInt32LE(page.flags >>> 0, 8);
  compressed.copy(file, RSC7_HEADER_BYTES);
  return file;
}

/* ------------------------------------------------------------------ *
 * Посадка: клумбы — новые пачки травы в карте травы района
 * ------------------------------------------------------------------ */

/* Пачка травы (`rage__fwGrassInstanceListDef`, 96 байт) и травинка (16 байт). */
const BATCH_BYTES = 96;
const INSTANCE_BYTES = 16;
const MAP_GRASS = 208;

/**
 * Карта травы с новыми пачками — клумбами засаженности (ТЗ 11.10.2026).
 * `batches` — `[{ archetype, scale: [мин., макс., разброс], lodDist,
 * instances: [{ x, y, z, scale (0…1), colour: [r, g, b] }] }]`.
 *
 * Прежние пачки — массив структур подряд (не указатели), поэтому массив
 * пишется заново: прежние пачки байт в байт (их указатели на травинки —
 * номер блока и смещение — те же), затем новые; у каждой новой — свой блок
 * травинок. Как и у сущностей (`appendMapEntities`), прежний сегмент
 * остаётся на месте, новое ложится следом одной страницей. Поля, которых
 * клумба не задаёт (затухание, наклон по земле), — как у первой пачки
 * карты. Возвращает байты файла или `null`, если в карте нет пачек.
 */
export function appendGrassBatches(bytes, batches) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = readResourceHeader(raw);
  if (header.version !== 2) throw new Error("Карта травы — не Meta-ресурс.");
  const resource = openResourceWith(raw, inflateResource);
  const { view } = resource;
  const { rootAt, blocks, rootBlock, resolve, blockOf } = openMetaParts(resource);
  const mapAt = blocks[rootBlock - 1]?.dataAt ?? -1;
  if (mapAt < 0) throw new Error("Корень карты травы не найден.");
  const listPointer = view.getBigUint64(mapAt + MAP_GRASS, true);
  const oldCount = view.getUint16(mapAt + MAP_GRASS + 8, true);
  const wanted = batches.filter((batch) => batch.instances?.length);
  if (!oldCount || !wanted.length) return null;
  const listAt = resolve(listPointer);
  const batchStruct = blockOf(listPointer)?.name;
  const firstItems = view.getBigUint64(listAt + 72, true);
  const instanceStruct = blockOf(firstItems)?.name;
  if (listAt < 0 || !batchStruct || !instanceStruct) throw new Error("Пачки карты травы не прочитаны.");
  const template = resource.data.slice(listAt, listAt + BATCH_BYTES);

  /* Раскладка: массив пачек (прежние + новые), блоки травинок, таблица блоков. */
  let cursor = align(resource.systemSize);
  const arrayIndex = blocks.length;
  const arrayAt = cursor;
  const total = oldCount + wanted.length;
  cursor = align(arrayAt + total * BATCH_BYTES);
  const items = wanted.map((batch, index) => {
    const at = cursor;
    cursor = align(cursor + batch.instances.length * INSTANCE_BYTES);
    return { index: blocks.length + 1 + index, at, batch };
  });
  const tableAt = cursor;
  const tableCount = blocks.length + 1 + wanted.length;
  cursor = align(tableAt + tableCount * BLOCK_BYTES);
  /* Травинки карт травы лежат и в графической части ресурса: она остаётся
     как была (те же страницы и адреса), заново пишется только системная. */
  const page = singlePageFlags(cursor, header.systemFlags >>> 28);
  const graphics = resource.data.subarray(resource.systemSize, resource.systemSize + header.graphicsSize);
  const data = new Uint8Array(page.size + header.graphicsSize);
  data.set(resource.data.subarray(0, resource.systemSize), 0);
  data.set(graphics, page.size);
  const out = new DataView(data.buffer);

  /* Прежние пачки — байт в байт. */
  data.set(resource.data.subarray(listAt, listAt + oldCount * BATCH_BYTES), arrayAt);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const streaming = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  items.forEach(({ index, at, batch }, slot) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const item of batch.instances)
      [item.x, item.y, item.z].forEach((value, axis) => {
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      });
    /* Рамка с запасом: травинка не ложится на самую границу квантования. */
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.floor((min[axis] - 0.5) * 100) / 100;
      max[axis] = Math.ceil((max[axis] + (axis === 2 ? 1.5 : 0.5)) * 100) / 100;
    }
    const base = arrayAt + (oldCount + slot) * BATCH_BYTES;
    data.set(template, base);
    min.forEach((value, axis) => out.setFloat32(base + axis * 4, value, true));
    out.setFloat32(base + 12, 0, true);
    max.forEach((value, axis) => out.setFloat32(base + 16 + axis * 4, value, true));
    out.setFloat32(base + 28, 0, true);
    batch.scale.forEach((value, axis) => out.setFloat32(base + 32 + axis * 4, value, true));
    out.setUint32(base + 48, batch.archetype >>> 0, true);
    out.setUint32(base + 52, Math.round(batch.lodDist) >>> 0, true);
    out.setBigUint64(base + 72, metaPointer(index, 0), true);
    out.setUint16(base + 80, batch.instances.length, true);
    out.setUint16(base + 82, batch.instances.length, true);
    batch.instances.forEach((item, number) => {
      const p = at + number * INSTANCE_BYTES;
      const quantize = (value, axis) => Math.max(0, Math.min(65535, Math.round(((value - min[axis]) / (max[axis] - min[axis])) * 65535)));
      out.setUint16(p, quantize(item.x, 0), true);
      out.setUint16(p + 2, quantize(item.y, 1), true);
      out.setUint16(p + 4, quantize(item.z, 2), true);
      /* Нормаль — вверх (128, 128), цвет — средний цвет травинки вида. */
      data[p + 6] = 128;
      data[p + 7] = 128;
      data[p + 8] = item.colour[0];
      data[p + 9] = item.colour[1];
      data[p + 10] = item.colour[2];
      data[p + 11] = Math.max(0, Math.min(255, Math.round(item.scale * 255)));
      data[p + 12] = 255;
    });
    for (let axis = 0; axis < 3; axis += 1) {
      box.min[axis] = Math.min(box.min[axis], min[axis]);
      box.max[axis] = Math.max(box.max[axis], max[axis]);
      const reach = axis < 2 ? batch.lodDist : 0;
      streaming.min[axis] = Math.min(streaming.min[axis], min[axis] - reach);
      streaming.max[axis] = Math.max(streaming.max[axis], max[axis] + reach);
    }
  });

  /* Таблица блоков: прежние как были, затем массив пачек и травинки. */
  const writeBlock = (slot, name, length, at) => {
    const entry = tableAt + slot * BLOCK_BYTES;
    out.setUint32(entry, name >>> 0, true);
    out.setInt32(entry + 4, length, true);
    out.setBigUint64(entry + 8, BigInt(SYSTEM_BASE + at), true);
  };
  blocks.forEach((block, slot) => {
    const entry = tableAt + slot * BLOCK_BYTES;
    out.setUint32(entry, block.name, true);
    out.setInt32(entry + 4, block.length, true);
    out.setBigUint64(entry + 8, block.address, true);
  });
  writeBlock(arrayIndex, batchStruct, total * BATCH_BYTES, arrayAt);
  for (const { index, at, batch } of items) writeBlock(index, instanceStruct, batch.instances.length * INSTANCE_BYTES, at);
  out.setBigUint64(rootAt + 0x30, BigInt(SYSTEM_BASE + tableAt), true);
  out.setInt16(rootAt + 0x4c, tableCount, true);
  const pagesAt = resource.at(view.getBigUint64(rootAt + 8, true));
  if (pagesAt >= 0 && pagesAt < resource.systemSize) out.setUint8(pagesAt + 8, 1);

  /* `CMapData`: массив пачек и рамки. */
  out.setBigUint64(mapAt + MAP_GRASS, metaPointer(arrayIndex, 0), true);
  out.setUint16(mapAt + MAP_GRASS + 8, total, true);
  out.setUint16(mapAt + MAP_GRASS + 10, total, true);
  const grow = (minAt, maxAt, extent) => {
    for (let axis = 0; axis < 3; axis += 1) {
      out.setFloat32(minAt + axis * 4, Math.min(out.getFloat32(minAt + axis * 4, true), extent.min[axis]), true);
      out.setFloat32(maxAt + axis * 4, Math.max(out.getFloat32(maxAt + axis * 4, true), extent.max[axis]), true);
    }
  };
  grow(mapAt + MAP_ENTITIES_MIN, mapAt + MAP_ENTITIES_MAX, box);
  grow(mapAt + MAP_STREAMING_MIN, mapAt + MAP_STREAMING_MAX, streaming);

  const compressed = deflateRaw(data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const file = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(file, 0);
  file.writeUInt32LE(page.flags >>> 0, 8);
  compressed.copy(file, RSC7_HEADER_BYTES);
  return file;
}
