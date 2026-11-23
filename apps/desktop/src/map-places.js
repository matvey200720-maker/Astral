import { openResourceWith } from "@modovik/ypt/resource-core";
import { inflateRawNode } from "@modovik/rpf7/node";
import * as vegetation from "@modovik/climb-contract/recolor/vegetation";
import * as mapEntities from "./map-entities-append.js";

const OBJECT_LIMIT = 6000;
const LIGHT_LIMIT = 24000;
const WHITE = 0xffffffff;
const COLOUR_SHIFTS = [16, 8, 0];
const GRASS_MAP_NAME = /_grass_\d+\.ymap$/;

// Смещения Meta: поля корня и записи таблицы блоков.
const ROOT = { mapBlock: 0x1c, table: 0x30, blocks: 0x4c };
const BLOCK_ENTRY = { size: 16, data: 8 };

// Массивы CMapData: [смещение указателя, смещение счётчика].
const ARRAY_AT = {
  grass: [0xd0, 0xd8],
  spots: [0x190, 0x198],
  tints: [0x1a0, 0x1a8],
};
const RECORD = { batch: 96, batchGrass: 80, spot: 12, tint: 4 };

// Открывает ресурс и сразу разрешает все блоки таблицы: смещение -1 (at не нашёл) остаётся в списке.
function openMeta(bytes) {
  const resource = openResourceWith(new Uint8Array(bytes), inflateRawNode);
  const { view } = resource;
  const root = resource.at(resource.root);
  const table = resource.at(view.getBigUint64(root + ROOT.table, true));
  const count = view.getInt16(root + ROOT.blocks, true);
  const entryOf = (i) => view.getBigUint64(table + i * BLOCK_ENTRY.size + BLOCK_ENTRY.data, true);
  const blocks = Array.from({ length: count }, (_, i) => resource.at(entryOf(i)));
  return { view, blocks, base: blocks[view.getInt32(root + ROOT.mapBlock, true) - 1] };
}

// Внутренний указатель: блок — младшие 12 бит, сдвиг в нём — следующие 20; блока нет — -1.
function follow(meta, pointer) {
  const slot = Number(pointer & 0xfffn) - 1;
  const shift = Number((pointer >> 12n) & 0xfffffn);
  return meta.blocks[slot] === undefined ? -1 : meta.blocks[slot] + shift;
}

// Где лежит массив CMapData и сколько в нём записей; null, если массива нет.
function locateArray(meta, [pointerAt, countAt]) {
  const length = meta.base === undefined ? 0 : meta.view.getUint16(meta.base + countAt, true);
  if (length === 0) return null;
  const from = follow(meta, meta.view.getBigUint64(meta.base + pointerAt, true));
  return from < 0 ? null : { from, length };
}

// Цвет пятна света: три байта из упакованного числа.
const unpackColour = (tint) => COLOUR_SHIFTS.map((shift) => (tint >>> shift) & 255);

export function readDistantLights(bytes) {
  const meta = openMeta(bytes);
  const spots = locateArray(meta, ARRAY_AT.spots);
  if (!spots) return [];
  const tints = locateArray(meta, ARRAY_AT.tints);
  const tintOf = (i) => (tints && i < tints.length ? meta.view.getUint32(tints.from + i * RECORD.tint, true) : WHITE);
  return Array.from({ length: spots.length }, (_, i) => {
    const tint = tintOf(i);
    const at = spots.from + i * RECORD.spot;
    return [meta.view.getFloat32(at, true), meta.view.getFloat32(at + 4, true), ...unpackColour(tint)];
  });
}

export function grassInstanceCount(bytes) {
  const meta = openMeta(bytes);
  const batches = locateArray(meta, ARRAY_AT.grass);
  if (!batches) return 0;
  let total = 0;
  for (let i = 0; i < batches.length; i += 1) {
    total += meta.view.getUint16(batches.from + i * RECORD.batch + RECORD.batchGrass, true);
  }
  return total;
}

// Имя файла без каталогов, строчными.
const plainName = (file) => {
  const full = String(file?.name || "");
  return full.split(/[\\/]/).pop().toLowerCase();
};

// Не больше `limit` точек, равномерно: k-я взятая — целая часть k × (длина ÷ предел).
function thin(points, limit) {
  const stride = points.length / limit;
  return stride > 1 ? Array.from({ length: limit }, (_, k) => points[Math.floor(k * stride)]) : points;
}

function bothFinite(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

// Складывает в target те элементы источника, у которых оба числа положения конечны (по одному, по порядку).
function collectFinite(target, source, positionOf, shapeOf) {
  for (const item of source) {
    const [x, y] = positionOf(item);
    if (bothFinite(x, y)) target.push(shapeOf(item, x, y));
  }
}

// Вклад одной карты: что успело попасть в итог до сбоя, то и остаётся.
function placesOfMap(file) {
  const objects = [];
  const lights = [];
  try {
    collectFinite(objects, mapEntities.readMapEntityPlaces(new Uint8Array(file.bytes)), (entity) => entity.position, (entity, x, y) => [x, y]);
    collectFinite(lights, readDistantLights(file.bytes), (light) => light, (light) => light);
  } catch {
    // нечитаемая карта
  }
  return { objects, lights };
}

// Вклады всех карт с расширением .ymap, по порядку файлов.
function placesPerMap(files) {
  return [...files].filter((file) => plainName(file).endsWith(".ymap")).map((file) => placesOfMap(file));
}

export function mappingPlaces(files) {
  const parts = placesPerMap(files);
  const objects = thin(parts.flatMap((part) => part.objects), OBJECT_LIMIT);
  const lights = thin(parts.flatMap((part) => part.lights), LIGHT_LIMIT);
  return { objects, lights, maps: parts.length };
}

// Травинки карты или null, если её не удалось прочитать.
function grassOrNull(file) {
  try {
    return grassInstanceCount(file.bytes);
  } catch {
    return null;
  }
}

// По карте травы: район (до чтения карты) и счёт травинок.
function grassMaps(files) {
  return [...files]
    .map((file) => ({ file, name: plainName(file) }))
    .filter(({ name }) => GRASS_MAP_NAME.test(name))
    .map(({ file, name }) => ({ area: vegetation.areaOfMapName(name), grass: grassOrNull(file) }));
}

export function grassAreas(files) {
  const maps = grassMaps(files);
  const counted = maps.map((map) => map.grass).filter((grass) => grass !== null);
  const empty = counted.filter((grass) => grass === 0).length;
  return {
    areas: [...new Set(maps.map((map) => map.area).filter(Boolean))],
    removed: maps.length > 0 && counted.length === maps.length && empty === counted.length,
    maps: maps.length,
    empty,
  };
}
