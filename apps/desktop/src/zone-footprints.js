import * as dds from "@modovik/dds";
import * as rage from "@modovik/rage-drawable";
import * as rpf from "@modovik/rpf7/node";
import * as placement from "@modovik/climb-contract/recolor/placement";
import * as ypt from "@modovik/ypt";
import * as mapEntities from "./map-entities-append.js";

// Лист зоны — крошечная ровная текстура: больше этой стороны не бывает.
export const ZONE_SHEET_MAX = 16;

const AXES = [0, 1, 2];
const FAILED = Symbol("failed");

// Попытка без последствий: сбой даёт запасное значение.
const attempt = (task, fallback) => {
  try {
    return task();
  } catch {
    return fallback;
  }
};

const nameOf = (file) => (file?.name ? String(file.name) : "").toLowerCase();

// Зелёный лист: канал G не ниже 120 и опережает R и B не меньше чем на 40.
const isGreen = ([red, green, blue]) => green >= 120 && [red, blue].every((other) => green >= other + 40);

const hexByte = (value) => value.toString(16).padStart(2, "0");
const hexOf = ([red, green, blue]) => "#" + [red, green, blue].map(hexByte).join("");

// Среднее по пикселям RGBA, целые; пустая картинка считается за один пиксель.
function meanColour(rgba) {
  const pixels = rgba.length / 4 || 1;
  return [0, 1, 2, 3].map((channel) => {
    let total = 0;
    for (let at = 0; at < rgba.length; at += 4) total += rgba[at + channel];
    return Math.round(total / pixels);
  });
}

// Поворот трёх точек: знак смотрим только в сравнении `<= 0`, NaN его не проходит.
function turn(origin, first, second) {
  const across = (first[0] - origin[0]) * (second[1] - origin[1]);
  const along = (first[1] - origin[1]) * (second[0] - origin[0]);
  return across - along;
}

// Одна цепь выпуклой оболочки по списку; последняя точка общая с другой цепью и отбрасывается.
function sweep(list) {
  const chain = [];
  for (const point of list) {
    while (chain.length > 1 && turn(chain.at(-2), chain.at(-1), point) <= 0) chain.pop();
    chain.push(point);
  }
  chain.pop();
  return chain;
}

const byCorner = (a, b) => a[0] - b[0] || a[1] - b[1];

function convexHull(points) {
  const sorted = [...points].sort(byCorner);
  if (sorted.length <= 2) return sorted;
  return [...sweep(sorted), ...sweep([...sorted].reverse())];
}

// Все вершины моделей: тройки подряд, хвост короче тройки тоже читается.
const verticesOf = (geometry) =>
  [...(geometry.models || [])].flatMap((model) =>
    [...(model.geometries || [])].flatMap(({ positions }) => {
      const triples = [];
      for (let at = 0; at < positions.length; at += 3) triples.push([positions[at], positions[at + 1], positions[at + 2]]);
      return triples;
    }),
  );

function extentAlong(vertices, axis) {
  let low = Infinity;
  let high = -Infinity;
  for (const vertex of vertices) {
    low = Math.min(low, vertex[axis]);
    high = Math.max(high, vertex[axis]);
  }
  return high - low;
}

// Цвет одного уровня текстуры; байты уровня берутся отложенно, уже после чтения формата.
function paintLevel(texture, levelBytes) {
  const format = texture.format;
  const pixels = dds.decodeTexture(format, levelBytes(), texture.width, texture.height);
  return meanColour(pixels);
}

// Первая встроенная текстура модели; сбой чтения — как будто текстур нет.
const firstTexture = (bytes) => attempt(() => ypt.readDrawableTextures(bytes)[0], undefined);

// Лист модели: сбой декодера здесь не гасится.
function embeddedSheet(bytes) {
  const texture = firstTexture(bytes);
  const level = texture?.spans?.[0];
  if (!level) return null;
  const colour = paintLevel(texture, () => texture.payload.subarray(level.offset, level.offset + level.bytes));
  return { colour, size: [texture.width, texture.height] };
}

export function modelShellOf(bytes) {
  const geometry = attempt(() => ypt.readDrawableGeometry(bytes), FAILED);
  if (geometry === FAILED) return null;
  const vertices = verticesOf(geometry);
  if (!vertices.length) return null;
  const sheet = embeddedSheet(bytes);
  return {
    size: AXES.map((axis) => extentAlong(vertices, axis)),
    hull: convexHull(vertices.map((vertex) => [vertex[0], vertex[1]])),
    colour: sheet ? sheet.colour : null,
    sheet: sheet ? sheet.size : null,
  };
}

export function zoneSheetOf(bytes) {
  const dictionary = attempt(() => rage.readTextureDictionary(new Uint8Array(bytes), { inflateRaw: rpf.inflateRawNode }), FAILED);
  if (dictionary === FAILED) return null;
  for (const texture of dictionary?.textures || dictionary || []) {
    const level = texture?.spans?.[0];
    if (!level || Math.max(texture.width, texture.height) > ZONE_SHEET_MAX) continue;
    // эту текстуру не прочитать — пробуем следующую
    const colour = attempt(() => {
      const from = texture.dataAt + level.offset;
      return paintLevel(texture, () => texture.resource.data.subarray(from, from + level.bytes));
    }, null);
    if (colour) return colour;
  }
  return null;
}

// Файлы с нужным расширением вместе с их именем в нижнем регистре.
const withExtension = (files, extension) =>
  [...files].map((file) => [file, nameOf(file)]).filter(([, name]) => name.endsWith(extension));

// Пары «хэш имени -> оболочка»; повторный хэш перезаписывает прежнюю запись.
function shellPairs(files) {
  const pairs = [];
  for (const [file, name] of withExtension(files, ".ydr")) {
    if (!file.bytes) continue;
    const shell = modelShellOf(new Uint8Array(file.bytes));
    if (shell && shell.hull.length >= 3) pairs.push([rage.joaat(name.slice(0, -4)) >>> 0, { ...shell, model: name }]);
  }
  return pairs;
}

const dictionarySheet = (files) =>
  withExtension(files, ".ytd").reduce((found, [file]) => found || (file.bytes ? zoneSheetOf(file.bytes) : null), null) || null;

// Цвет для моделей без своего листа: выбирается один раз, сразу после сборки оболочек.
function sharedColour(table, files) {
  const painted = [...table.values()].filter((shell) => shell.colour);
  const [green, plain] = [true, false].map((wanted) => painted.filter((shell) => isGreen(shell.colour) === wanted));
  const side = green.length * 2 >= painted.length ? green : plain;
  const majority = side.length ? side[0].colour : null;
  if (painted.length * 2 >= table.size) return majority;
  return dictionarySheet(files) || majority;
}

const scaleAt = (place, slot) => place.scale?.[slot] || 1;
const groundOf = (point) => [point[0], point[1]];

function placeToRecord(shell, place, colour) {
  const move = placement.placementTransform({
    position: place.position,
    rotation: place.rotation || [0, 0, 0, 1],
    scaleXY: scaleAt(place, 0),
    scaleZ: scaleAt(place, 1),
  });
  return {
    model: shell.model,
    points: shell.hull.map((corner) => groundOf(move([corner[0], corner[1], 0]))),
    colour: hexOf(colour),
    alpha: colour[3],
    kind: isGreen(colour) ? "green" : "forbidden",
  };
}

// Записи по картам и по местам в карте; карта, которую не прочитать, пропускается.
function recordsOnMaps(files, table, common) {
  return withExtension(files, ".ymap").flatMap(([file]) => {
    const places = attempt(() => mapEntities.readMapEntityPlaces(new Uint8Array(file.bytes)), FAILED);
    if (places === FAILED) return [];
    return [...places].flatMap((place) => {
      const shell = table.get(place.archetype >>> 0);
      const colour = shell && (shell.colour || common);
      return colour ? [placeToRecord(shell, place, colour)] : [];
    });
  });
}

export function zoneFootprints(files = []) {
  const table = new Map(shellPairs(files));
  if (table.size === 0) return [];
  const common = sharedColour(table, files);
  return recordsOnMaps(files, table, common);
}
