/*
 * Сцена набора для 3D-кадра: модели мода на своих местах.
 *
 * Файл `/assets/workshop/<набор>/scene.bin` снят с моделей мода
 * (`scripts/prepare-recolor-sets.mjs`): сетки уже стоят туда, куда их ставит
 * игра (у завода — здания и контейнеры на своих местах, у зон — каждая зона в
 * своих координатах), у каждой — материал с тем, что знает о нём опись.
 * Координаты — как у игры: метры, Z вверх.
 *
 *   zlib( "ARS1" · u32 версия · u32 длина заголовка · заголовок JSON ·
 *         позиции i16×3 · нормали i8×4 · развёртка f32×2 · индексы u16/u32
 *         [· цвета вершин u8×4 · вторая развёртка f32×2] )
 *
 * Версия 2 — то же плюс `lamps` в заголовке (лампы моделей в осях сцены) и
 * `entity` у сетки (номер сущности интерьера).
 *
 * Версия 3 (11.11.2026) — то же плюс `models`: сетка, что стоит в сцене несколько раз (дом из каптов), записана один раз в своей рамке (`frame`),
 * а места — матрицами 3 × 4 (`matrices`, двенадцать f32 на копию, `scripts/lib/scene-encode.mjs`). Читатель отдаёт `asset.models` (одна сетка, `copies`, `matrices`)
 * и по описанию на каждую копию в `asset.meshes` (`instance: { model, matrix, index }`): общие индексы, развёртка и цвета, коробка и шар в осях сцены, `area`;
 * `positions` и `normals` копии — в осях сцены и считаются при первом обращении (кадр рисует копии матрицами и их не трогает), на сетку сцены снаппятся ровно так,
 * как лёг бы в файл версии 1–2 тот же мир. Файлы версий 1–2 читаются как прежде.
 *
 * Карта нормалей — необязательное поле материала `normal` (номер записи
 * `textures[]`, у неё `normal: true`). Сцены без него читаются как прежде:
 * материал без карт нормалей — гладкий, как и был.
 *
 * Цвета вершин и вторая развёртка есть только у сцены земли
 * (`scripts/prepare-sandy-scene.mjs`): веса четырёх слоёв и маска смешения.
 * У сцен арен цвета вершин — затенение игры (`vertexAmbient: { channel,
 * mean }` в заголовке, план графики, п. 2): канал гасит рассеянный свет.
 *
 * Сцена грузится один раз за жизнь окна: кадр и обложка берут её из кэша.
 */

import { unzlibSync } from "fflate";
import { sceneBoxOf } from "./edge-field.js";

const MAGIC = "ARS1";
const cache = new Map();

/** Радиус шара вокруг середины коробки `bounds` (`[минимум x y z, максимум x y z]`), что накрывает все вершины: как `computeBoundingSphere` у three.js. */
function sphereRadius(positions, bounds) {
  const cx = (bounds[0] + bounds[3]) / 2;
  const cy = (bounds[1] + bounds[4]) / 2;
  const cz = (bounds[2] + bounds[5]) / 2;
  let far = 0;
  for (let at = 0; at < positions.length; at += 3) {
    const dx = positions[at] - cx;
    const dy = positions[at + 1] - cy;
    const dz = positions[at + 2] - cz;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance > far) far = distance;
  }
  return Math.sqrt(far);
}

/** Сетка файла: позиции по рамке (`min`, `span`) — сцены или своей рамке модели. */
function decodeMesh(mesh, { bytes, view, data }, min, span) {
  const count = mesh.vertices;
  const end = (offset, length) => {
    if (data + offset + length > bytes.length) throw new Error("Файл сцены обрезан.");
    return data + offset;
  };
  const positionAt = end(mesh.position, count * 6);
  const positions = new Float32Array(count * 3);
  /* Коробка и шар сетки — здесь же, в потоке разбора: кадр ставит их геометрии готовыми, а не обходит все вершины на главном потоке (`meshGeometry`: 5 468 сеток Majestic — 1,8 с на ×4). */
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count * 3; index += 1) {
    const share = (view.getInt16(positionAt + index * 2, true) + 32768) / 65535;
    positions[index] = min[index % 3] + share * span[index % 3];
    /* Из массива, а не из расчёта: у Float32 значение округляется, и коробка должна совпасть с вершинами. */
    const value = positions[index];
    const axis = index % 3;
    if (value < low[axis]) low[axis] = value;
    if (value > high[axis]) high[axis] = value;
  }
  const bounds = count ? [...low, ...high] : null;
  const radius = bounds ? sphereRadius(positions, bounds) : 0;
  const normalAt = end(mesh.normal, count * 4);
  const normals = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1)
    for (let axis = 0; axis < 3; axis += 1) normals[index * 3 + axis] = view.getInt8(normalAt + index * 4 + axis) / 127;
  const uvs =
    mesh.uv >= 0
      ? new Float32Array(bytes.buffer.slice(bytes.byteOffset + end(mesh.uv, count * 8), bytes.byteOffset + data + mesh.uv + count * 8))
      : null;
  const indexAt = end(mesh.index, mesh.indices * (mesh.wide ? 4 : 2));
  const indices = mesh.wide
    ? new Uint32Array(bytes.buffer.slice(bytes.byteOffset + indexAt, bytes.byteOffset + indexAt + mesh.indices * 4))
    : new Uint16Array(bytes.buffer.slice(bytes.byteOffset + indexAt, bytes.byteOffset + indexAt + mesh.indices * 2));
  for (const index of indices) if (index >= count) throw new Error("Индекс вершины вне сетки сцены.");
  /* Земля: веса слоёв в цветах вершин и вторая развёртка (маска смешения). */
  const colours = mesh.colour >= 0 ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset + end(mesh.colour, count * 4), bytes.byteOffset + data + mesh.colour + count * 4)) : null;
  const uvs1 = mesh.uv1 >= 0 ? new Float32Array(bytes.buffer.slice(bytes.byteOffset + end(mesh.uv1, count * 8), bytes.byteOffset + data + mesh.uv1 + count * 8)) : null;
  return { material: mesh.material, part: mesh.part, positions, normals, uvs, indices, ...(bounds ? { bounds, radius } : {}), ...(colours ? { colours } : {}), ...(uvs1 ? { uvs1 } : {}), ...(Number.isInteger(mesh.entity) ? { entity: mesh.entity } : {}) };
}

/** Площадь сетки, м² (по треугольникам): у модели с копиями — одна на все копии (масштаб матриц единичный). */
function meshArea({ positions, indices }) {
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
  return area;
}

/**
 * Разбор файла сцены на части: всё, что стоит один раз (`meshes`), и модели с копиями (`models`: сетка, `copies`, `matrices`). Части — простые массивы без вычисляемых полей:
 * их можно отдать из потока разбора без копии и без разворота копий (`assembleScene` на стороне окна).
 */
export function decodeSceneParts(input) {
  const packed = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bytes = unzlibSync(packed);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC || (version !== 1 && version !== 2 && version !== 3))
    throw new Error("Файл сцены — не ARS1.");
  const headerBytes = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerBytes)));
  const data = 12 + headerBytes;
  const [minX, minY, minZ] = header.bounds.min;
  const [maxX, maxY, maxZ] = header.bounds.max;
  const min = [minX, minY, minZ];
  const span = [maxX - minX, maxY - minY, maxZ - minZ];
  const source = { bytes, view, data };
  const meshes = header.meshes.map((mesh) => decodeMesh(mesh, source, min, span));
  const models = (header.models || []).map((model) => {
    const mesh = decodeMesh(model, source, model.frame.min, model.frame.span);
    const at = data + model.matrices;
    if (at + model.copies * 48 > bytes.length) throw new Error("Файл сцены обрезан.");
    const matrices = new Float32Array(bytes.buffer.slice(bytes.byteOffset + at, bytes.byteOffset + at + model.copies * 48));
    return { ...mesh, copies: model.copies, matrices, area: meshArea(mesh) };
  });
  return {
    bounds: header.bounds,
    parts: header.parts || [],
    /* Комнаты помещения (`mloRooms`: имя, порталы, связи) — у помещений проектов; части ссылаются на них номером `room`. */
    ...(Array.isArray(header.rooms) && header.rooms.length ? { rooms: header.rooms } : {}),
    materials: header.materials || [],
    ...(Array.isArray(header.uvClips) && header.uvClips.length ? { uvClips: header.uvClips } : {}),
    textures: header.textures || [],
    ...(Array.isArray(header.lamps) && header.lamps.length ? { lamps: header.lamps } : {}),
    ...(header.neutralLight === true ? { neutralLight: true } : {}),
    ...(header.vertexAmbient && Number.isInteger(header.vertexAmbient.channel) && header.vertexAmbient.mean > 0 ? { vertexAmbient: header.vertexAmbient } : {}),
    meshes,
    ...(models.length ? { models } : {}),
  };
}

/**
 * Позиции и нормали копии в осях сцены — как легли бы в файл версии 1–2 те же вершины: точка модели × матрица, округление до Float32, затем на сетку i16 рамки сцены
 * (`encodeScene`/`decodeSceneAsset`); нормаль — вращение матрицы, на сетку i8. Сцену версии 3 и ту же сцену версии 1–2 разворот даёт байт в байт.
 */
export function expandCopy(model, matrix, bounds) {
  const min = bounds.min;
  const span = bounds.max.map((value, axis) => value - min[axis]);
  const encodeSpan = span.map((value) => Math.max(value, 1e-3));
  const count = model.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] = matrix;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = model.positions[vertex * 3];
    const y = model.positions[vertex * 3 + 1];
    const z = model.positions[vertex * 3 + 2];
    const world = [m0 * x + m1 * y + m2 * z + m3, m4 * x + m5 * y + m6 * z + m7, m8 * x + m9 * y + m10 * z + m11];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = Math.fround(world[axis]);
      const step = Math.max(-32768, Math.min(32767, Math.round(((value - min[axis]) / encodeSpan[axis]) * 65535 - 32768)));
      positions[vertex * 3 + axis] = min[axis] + ((step + 32768) / 65535) * span[axis];
    }
    const nx = model.normals[vertex * 3];
    const ny = model.normals[vertex * 3 + 1];
    const nz = model.normals[vertex * 3 + 2];
    const turned = [m0 * nx + m1 * ny + m2 * nz, m4 * nx + m5 * ny + m6 * nz, m8 * nx + m9 * ny + m10 * nz];
    for (let axis = 0; axis < 3; axis += 1) normals[vertex * 3 + axis] = (Math.max(-127, Math.min(127, Math.round(Math.fround(turned[axis]) * 127))) | 0) / 127;
  }
  return { positions, normals };
}

/* Коробка копии в осях сцены: углы коробки модели через матрицу (чуть шире тугой коробки по вершинам — как шар склейки, зато без обхода вершин). */
function copyBounds(box, matrix) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const x = box[corner & 1 ? 3 : 0];
    const y = box[corner & 2 ? 4 : 1];
    const z = box[corner & 4 ? 5 : 2];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = matrix[axis * 4] * x + matrix[axis * 4 + 1] * y + matrix[axis * 4 + 2] * z + matrix[axis * 4 + 3];
      if (value < low[axis]) low[axis] = value;
      if (value > high[axis]) high[axis] = value;
    }
  }
  return [...low, ...high];
}

/* Часть-круг мира вокруг места (`scripts/prepare-world-ring.mjs`). */
export const SURROUND_PART = "surround";

/* Сетка круга — двойник сетки самого места: то же число треугольников и габариты до 2 см. */
const TWIN_TOLERANCE = 0.02;

function boxOf(mesh) {
  if (Array.isArray(mesh.bounds) && mesh.bounds.length === 6) return mesh.bounds;
  const positions = mesh.positions;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let at = 0; at < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      if (positions[at + axis] < box[axis]) box[axis] = positions[at + axis];
      if (positions[at + axis] > box[axis + 3]) box[axis + 3] = positions[at + axis];
    }
  return box;
}

/**
 * Какие сетки круга мира лежат на сетках самого места (номера в `meshes`). Круг собирают из файлов игры вокруг места, и если модель места попала в него под другим именем, то же здание
 * стоит в сцене дважды в одной плоскости: у ангара — `ap1_01_c_sthbld3` рядом с `hei_ap1_01_c_sthbld3`, пол с листом ангара и тот же пол с листом «неба» (28 сеток, 4941 треугольник). Два слоя на одной глубине
 * видеочип решает по округлению, и при полёте вдоль взгляда победитель меняется от кадра к кадру: по всему полу мерцали тёмные пятна (12.11.2026).
 * @returns {Set<number>}
 */
export function ringTwins(parts) {
  const ids = (parts.parts || []).map((part) => part?.id ?? part);
  const ring = new Set(ids.flatMap((id, index) => (id === SURROUND_PART ? [index] : [])));
  const twins = new Set();
  if (!ring.size) return twins;
  const hall = new Map();
  parts.meshes.forEach((mesh, index) => {
    if (ring.has(mesh.part) || mesh.instance) return;
    const triangles = mesh.indices.length / 3;
    (hall.get(triangles) || hall.set(triangles, []).get(triangles)).push(index);
  });
  parts.meshes.forEach((mesh, index) => {
    if (!ring.has(mesh.part) || mesh.instance) return;
    const candidates = hall.get(mesh.indices.length / 3);
    if (!candidates) return;
    const box = boxOf(mesh);
    if (candidates.some((other) => boxOf(parts.meshes[other]).every((value, axis) => Math.abs(value - box[axis]) <= TWIN_TOLERANCE))) twins.add(index);
  });
  return twins;
}

/** Метит двойники круга (`mesh.twin`): кадр их не рисует, а луч пропускает. Возвращает их число. */
export function markRingTwins(parts) {
  const twins = ringTwins(parts);
  for (const index of twins) parts.meshes[index].twin = true;
  return twins.size;
}

/** Сетки, что кадру рисовать: без копий моделей (их рисуют пачкой матриц) и без двойников круга. */
export const meshesToDraw = (asset) => asset.meshes.filter((mesh) => !mesh.twin && !(asset.models?.length && mesh.instance));

/**
 * Сцена из частей `decodeSceneParts`: к `meshes` добавляются описания копий (по одной на копию, в порядке моделей и матриц). Описание делит с моделью индексы, развёртку и цвета;
 * `positions` и `normals` — вычисляемые, при первом обращении, и держатся за копией.
 */
export function assembleScene(parts) {
  markRingTwins(parts);
  if (!parts.models?.length) return parts;
  const meshes = parts.meshes.slice();
  for (const model of parts.models) {
    for (let index = 0; index < model.copies; index += 1) {
      const matrix = model.matrices.subarray(index * 12, index * 12 + 12);
      let expanded = null;
      const world = () => (expanded ||= expandCopy(model, matrix, parts.bounds));
      const copy = {
        material: model.material,
        part: model.part,
        uvs: model.uvs,
        indices: model.indices,
        ...(model.colours ? { colours: model.colours } : {}),
        ...(model.uvs1 ? { uvs1: model.uvs1 } : {}),
        ...(model.bounds ? { bounds: copyBounds(model.bounds, matrix), radius: model.radius } : {}),
        area: model.area,
        instance: { model, matrix, index },
      };
      Object.defineProperties(copy, {
        positions: { get: () => world().positions, enumerable: true, configurable: true },
        normals: { get: () => world().normals, enumerable: true, configurable: true },
      });
      meshes.push(copy);
    }
  }
  return { ...parts, meshes };
}

/** Разбор файла сцены. Бросает на чужом или обрезанном файле. */
export function decodeSceneAsset(input) {
  return assembleScene(decodeSceneParts(input));
}

/*
 * Разбор — в своём потоке (`scene-asset-worker.js`, ТЗ 06.10.2026, вечер):
 * сцена в несколько мегабайт держала поток окна сотни миллисекунд в момент
 * открытия редактора. Нет потоков (тесты, старое окно) — разбор здесь же.
 */
let decoder = null;
let decodeId = 0;
const decoding = new Map();

function workerDecoder() {
  if (decoder !== null) return decoder;
  decoder = false;
  if (typeof Worker !== "function") return decoder;
  try {
    const worker = new Worker(new URL("./scene-asset-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, asset, field, error } = event.data || {};
      const task = decoding.get(id);
      if (!task) return;
      decoding.delete(id);
      if (error) task.reject(new Error(error));
      else if (task.field) task.resolve(field || null);
      else {
        /* Из потока приходят части (`decodeSceneParts`): описания копий моделей собираются здесь, без разворота вершин. */
        const whole = assembleScene(asset);
        /* Поле контура потока — этих сеток: у урезанной копии сцены мягкий край посчитает своё (`edge-fade.js`). */
        if (whole?.footprint) whole.footprint.source = whole.meshes;
        task.resolve(whole);
      }
    };
    worker.onerror = () => {
      /* Поток не поднялся: ждущие разбираются здесь, дальше — без потока. */
      decoder = false;
      for (const task of decoding.values()) {
        /* Поле контура без потока — его посчитает мягкий край в окне. */
        if (task.field) {
          task.resolve(null);
          continue;
        }
        try {
          task.resolve(decodeSceneAsset(new Uint8Array(task.copy)));
        } catch (failure) {
          task.reject(failure);
        }
      }
      decoding.clear();
    };
    decoder = worker;
  } catch {
    decoder = false;
  }
  return decoder;
}

function decodeOffThread(buffer, footprint = false) {
  const worker = workerDecoder();
  if (!worker) return decodeSceneAsset(new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const id = ++decodeId;
    /* Копия на случай, если поток не поднимется: свой буфер уходит в него. */
    decoding.set(id, { resolve, reject, copy: buffer.slice(0) });
    worker.postMessage({ id, buffer, footprint }, [buffer]);
  });
}

/*
 * Поле контура для сцены, что уже в кэше без него (её первой взяла обложка полки или «мир» за окнами зала): поток
 * считает его по копии вершин, кадр ждёт поле, а не считает его сам (`edge-fade.js`). Нет потока — сцена как есть.
 */
const footprints = new WeakMap();
function withFootprint(asset) {
  if (!asset?.meshes?.length || asset.footprint) return asset;
  if (footprints.has(asset)) return footprints.get(asset);
  const worker = workerDecoder();
  const box = sceneBoxOf(asset.bounds);
  if (!worker || !box) return asset;
  const meshes = asset.meshes.map((mesh) => ({ positions: mesh.positions, indices: mesh.indices }));
  const pending = new Promise((resolve) => {
    const id = ++decodeId;
    decoding.set(id, {
      field: true,
      resolve: (field) => {
        if (field && !asset.footprint) asset.footprint = { ...field, source: asset.meshes };
        resolve(asset);
      },
      reject: () => resolve(asset),
    });
    worker.postMessage({ id, field: { box, meshes } });
  });
  footprints.set(asset, pending);
  return pending;
}

/* Разобранная сцена — десятки мегабайт массивов вершин; помнятся последние
   несколько (кадр редактора и снимки плиток берут одну и ту же). */
const ASSET_LIMIT = 4;

/**
 * Сцена по адресу (обещание из кэша окна). `footprint` — поток заодно считает поле контура для мягкого края
 * (`edge-field.js`, `edgeFieldWanted`); у сцены из кэша без поля поток досчитывает его по копии вершин.
 */
export function loadSceneAsset(url, { fetchImpl = globalThis.fetch, footprint = false } = {}) {
  if (cache.has(url)) {
    const known = cache.get(url);
    cache.delete(url);
    cache.set(url, known);
    if (!footprint) return known;
    const derived = known.then(withFootprint);
    derived.settled = known.settled;
    return derived;
  }
  /* `settled` — сцена уже разобрана и лежит в кэше окна (повторный вход): по нему `ModelStage` знает, что читать нечего и карточка загрузки по короткому сроку не нужна. */
  let tracked = null;
  tracked =
    /* `fetch` стартует сразу, в этом же вызове: прежний `Promise.resolve().then(...)` откладывал его на конец слоя эффектов, а там стоит создание кадра на полсекунды. Сбой синхронного `fetch` — отказ обещания, как и раньше. */
    new Promise((resolve) => resolve(fetchImpl(url)))
      .then((response) => {
        if (!response.ok) throw new Error(`Сцена не загрузилась (${response.status}).`);
        return response.arrayBuffer();
      })
      .then((buffer) => decodeOffThread(buffer, footprint))
      .then((asset) => {
        tracked.settled = true;
        return asset;
      })
      .catch((error) => {
        /* Неудача не остаётся в кэше: следующая попытка — заново. */
        cache.delete(url);
        throw error;
      });
  tracked.settled = false;
  cache.set(url, tracked);
  while (cache.size > ASSET_LIMIT) cache.delete(cache.keys().next().value);
  return cache.get(url);
}

/* Для тестов: кэш окна живёт весь сеанс, тестам нужен чистый. */
export function forgetSceneAssets() {
  cache.clear();
}
