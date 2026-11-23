// Зона Z5, часть 2: отделение общих островов развёртки на свободное место листа,
// согласование отделённого с проектом и геометрия кусков для игры.
// Раскладку и поиск места делают соседние модули (gun-detach.js, gun-uv.js), здесь — оркестровка.

import * as THREE from "three";
import {
  DETACH_MAX_PARTS,
  DETACH_MAX_VERTICES,
  DETACH_SMALL_SCALES,
  DETACH_SPLIT_BASE,
  DETACH_WHOLE_SCALES,
  boxTiled,
  freePlace,
  islandFolded,
  islandLayout,
  islandShared,
  mapUv,
  moveIsland,
  packTriangles,
  partTriangles,
  placeBox,
  reserveRect,
  trianglesBox,
  unmapUv,
  unpackTriangles,
} from "./gun-detach.js";
import {
  afterIslandMove,
  cornersOf,
  entryNamed,
  islandSheet,
  renumberTriangles,
  shiftIsland,
  splitClipKey,
  trianglesOf,
  unshareVertices,
} from "./gun-scene-islands.js";

// Детали, которые не отделяются: магазины («mag» с цифрами на конце) и декали.
const UNDETACHABLE_NAME = /mag\d*$|_decal/i;

const DEFAULT_SHEET = 512;
const BOX_TOLERANCE = 0.002;

const sixDigits = (value) => Math.round(value * 1e6) / 1e6;

// Размеры листа записи; без размеров — 512.
const sheetSizeOf = ({ width, height }) => ({ width: width || DEFAULT_SHEET, height: height || DEFAULT_SHEET });

const idOf = ({ mesh, island }) => `${mesh}:${island}`;

const rectsOf = (record) => {
  const { from, to } = record;
  return { record, rects: { from, to } };
};

const boxMatches = (found, expected) =>
  found.every((value, index) => Math.abs(value - expected[index]) <= BOX_TOLERANCE);

const doNothing = () => {};

// Двигает остров куска: warp — mapUv (на новое место листа) или unmapUv (обратно).
const carryIsland = (ctx, entry, record, warp) =>
  shiftIsland(ctx, entry, record.mesh, record.island, (x, y) => warp(record, x, y));

// ---------------------------------------------------------------------------
// Геометрия кусков
// ---------------------------------------------------------------------------

// Геометрия отделённого куска в осях корня, uv — на новом месте листа.
const pieceGeometry = (entry, record, item, toRoot) => {
  const { geometry, userData } = item.mesh;
  const { position, normal, uv } = geometry.attributes;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toRoot);
  const islands = userData.astralUvIslands;

  const triangles = trianglesOf(item).filter((triangle) => islands[triangle] === record.island);
  const positions = [];
  const normals = [];
  const uvs = [];
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const sheet = new THREE.Vector2();

  for (const vertex of cornersOf(geometry, triangles)) {
    point.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(toRoot);
    positions.push(point.x, point.y, point.z);

    // без атрибута нормалей нормаль смотрит вверх
    if (normal) {
      direction.set(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      direction.applyMatrix3(normalMatrix).normalize();
    } else {
      direction.set(0, 1, 0);
    }
    normals.push(direction.x, direction.y, direction.z);

    sheet.set(uv.getX(vertex), uv.getY(vertex)).applyMatrix3(entry.mapper.matrix);
    uvs.push(sheet.x, sheet.y);
  }
  return { positions, normals, uvs };
};

// Один отделённый кусок для игры; null, если у сетки нет геометрии, номеров островов или вершин куска.
const pieceForGame = (entry, record, rootInverse) => {
  const item = entry.meshes[record.mesh];
  if (!(item?.mesh.geometry && item.mesh.userData.astralUvIslands)) return null;
  const toRoot = rootInverse.clone().multiply(item.mesh.matrixWorld);
  const geometry = pieceGeometry(entry, record, item, toRoot);
  return geometry.positions.length > 0 ? { record, ...geometry } : null;
};

// Отделённые куски записи: геометрия в осях корня и uv на новом месте листа.
const detachedPieces = (ctx, name) => {
  const { root } = ctx;
  const entry = entryNamed(ctx, name);
  const now = ctx.detached.get(name);
  if (!(root && entry && now?.size > 0)) return [];
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const pieces = [];
  for (const record of now.values()) {
    const piece = pieceForGame(entry, record, rootInverse);
    if (piece) pieces.push(piece);
  }
  return pieces;
};

// ---------------------------------------------------------------------------
// Раскладка и учёт отделённого
// ---------------------------------------------------------------------------

// Кусок раскладки для одной сетки записи; null, если у сетки нет uv или островов.
const meshPiece = (item, index, matrix) => {
  const { geometry, userData } = item.mesh;
  const { uv } = geometry.attributes;
  if (!uv || !userData.astralUvIslands) return null;
  const triangles = trianglesOf(item);
  const point = new THREE.Vector2();
  const uvs = cornersOf(geometry, triangles).flatMap((vertex) => {
    point.set(uv.getX(vertex), uv.getY(vertex)).applyMatrix3(matrix);
    return [point.x, point.y];
  });
  return {
    key: index,
    uvs: Float32Array.from(uvs),
    islands: Int32Array.from(triangles, (triangle) => userData.astralUvIslands[triangle]),
  };
};

// Раскладка островов детали на листе; места уже отделённых кусков помечаются занятыми.
const layoutOf = (ctx, entry) => {
  const known = ctx.layouts.get(entry.name);
  if (known) return known;
  const { matrix } = entry.mapper;
  const layout = islandLayout(entry.meshes.map((item, index) => meshPiece(item, index, matrix)).filter(Boolean));
  for (const piece of ctx.detached.get(entry.name)?.values() ?? []) {
    const [width, height] = piece.size;
    reserveRect(layout, piece.to, width, height);
  }
  ctx.layouts.set(entry.name, layout);
  return layout;
};

// Сколько кусков и вершин уже отделено по всем деталям.
const detachedTotals = (ctx) => {
  let pieces = 0;
  for (const records of ctx.detached.values()) pieces += records.size;
  let vertices = 0;
  for (const counts of ctx.detachedVertices.values()) {
    for (const count of counts.values()) vertices += count;
  }
  return { pieces, vertices };
};

// Сколько вершин ещё можно отделить; null, если отделять нельзя (место не просили или кусков уже много).
const vertexSpare = (ctx, room) => {
  const { pieces, vertices } = detachedTotals(ctx);
  return room && pieces < DETACH_MAX_PARTS ? DETACH_MAX_VERTICES - vertices : null;
};

// Запоминает число вершин куска; count === null снимает кусок с учёта.
const noteVertices = (ctx, name, key, count) => {
  const { detachedVertices } = ctx;
  if (!detachedVertices.has(name)) detachedVertices.set(name, new Map());
  const group = detachedVertices.get(name);
  if (count === null) group.delete(key);
  else group.set(key, count);
};

// Берёт кусок на учёт: запись в списке детали и число его вершин.
const trackPiece = (ctx, name, now, record, vertices) => {
  now.set(idOf(record), record);
  noteVertices(ctx, name, idOf(record), vertices);
};

// ---------------------------------------------------------------------------
// Выбор места
// ---------------------------------------------------------------------------

// Номер для вновь выделенной части: больше любого существующего и не меньше базы деления.
const freeIslandNumber = (numbers) => {
  let top = DETACH_SPLIT_BASE - 1;
  for (const number of numbers) {
    if (number > top) top = number;
  }
  return top + 1;
};

// Часть острова вокруг мазка; null, если она совпала бы со всем островом или занимает лист целиком.
const strokePart = (own, hit, reach) => {
  if (!own?.keys) return null;
  const { uvs, keys, triangles } = own;
  const chosen = [...partTriangles({ uvs, keys, start: triangles.indexOf(hit.triangle), u: hit.u, v: hit.v, reach })];
  if (chosen.length === 0 || chosen.length === triangles.length) return null;
  const box = trianglesBox(chosen.flatMap((index) => uvs.slice(index * 6, index * 6 + 6)));
  return boxTiled(box) ? null : { box, triangles: chosen.map((index) => triangles[index]) };
};

// Выбор места: целиком или частью, сначала крупными масштабами, потом мелкими.
const choosePlace = (layout, key, own, hit, sheet, spare, reach) => {
  const { width, height } = sheet;
  const folded = islandFolded(layout, key);
  // у свёрнутого острова сначала пробуют часть без охвата, потом с заданным
  const reaches = folded ? [0, reach] : [reach];
  const parts = [];
  const partAt = (slot) => {
    if (parts[slot] === undefined) parts[slot] = strokePart(own, hit, reaches[slot]);
    return parts[slot];
  };
  const roomy = !folded && own.triangles.length * 3 <= spare;

  // Место для части острова с номером slot; часть в запас вершин не влезла или места нет — null
  const placePart = (slot, scales) => {
    const part = partAt(slot);
    if (!part || part.triangles.length * 3 > spare) return null;
    const place = placeBox(layout, part.box, width, height, scales);
    return place && { ...place, part };
  };

  const placeAt = (scales) => {
    const whole = roomy ? freePlace(layout, key, width, height, scales) : null;
    if (whole) return whole;
    for (let slot = 0; slot < reaches.length; slot += 1) {
      const near = placePart(slot, scales);
      if (near) return near;
    }
    return null;
  };

  return placeAt(DETACH_WHOLE_SCALES) ?? placeAt(DETACH_SMALL_SCALES);
};

// ---------------------------------------------------------------------------
// Отделение и возврат
// ---------------------------------------------------------------------------

// Деталь под мазком, если её можно отделять; null — отделение выключено, острова нет или деталь не из тех.
const detachableEntry = (ctx, hit) => {
  if (!ctx.root || !ctx.detachable || !hit?.island) return null;
  const entry = entryNamed(ctx, hit.material);
  return entry && !UNDETACHABLE_NAME.test(entry.name) ? entry : null;
};

// Остров под мазком: запись, сетка, её номер и номер острова; null — отделять нельзя.
const targetOf = (ctx, hit) => {
  const entry = detachableEntry(ctx, hit);
  if (!entry) return null;
  const [meshId, island] = splitClipKey(hit.island);
  const meshIndex = entry.meshes.findIndex((item) => item.mesh.uuid === meshId);
  if (meshIndex === -1 || !Number.isInteger(island)) return null;
  return { entry, item: entry.meshes[meshIndex], island, meshIndex };
};

// Часть острова получает собственный номер; вершины сетки перестают быть общими.
const splitPart = (ctx, item, island, part) => {
  const { astralUvIslands } = item.mesh.userData;
  unshareVertices(item);
  const id = freeIslandNumber(astralUvIslands);
  renumberTriangles(ctx, item, island, id, part.triangles);
  return id;
};

// Запись об отделённом куске: рамка и прежнее место, новое место и, для части острова, её треугольники.
const makeRecord = (ctx, target, place, box, sheet) => {
  const { item, island, meshIndex } = target;
  const record = {
    mesh: meshIndex,
    island,
    box: box.map(sixDigits),
    from: place.from,
    to: place.to,
    size: [sheet.width, sheet.height],
  };
  const { part } = place;
  if (part) {
    record.island = splitPart(ctx, item, island, part);
    record.part = { of: island, triangles: packTriangles(part.triangles) };
  }
  return record;
};

const detach = (ctx, hit, reach, room) => {
  const target = targetOf(ctx, hit);
  if (!target) return null;
  const { entry, item, island, meshIndex } = target;

  const key = `${meshIndex}:${island}`;
  const now = ctx.detached.get(entry.name) ?? new Map();
  if (now.has(key)) return null;
  const layout = layoutOf(ctx, entry);
  if (!islandShared(layout, key)) return null;

  const spare = vertexSpare(ctx, room);
  if (spare === null) return { crowded: true };
  const own = islandSheet(entry, item, island, { keys: true });
  if (!own) return null;

  const sheet = sheetSizeOf(entry);
  const place = choosePlace(layout, key, own, hit, sheet, spare, reach);
  if (!place) return { crowded: true };

  const { part } = place;
  const box = part?.box ?? layout.islands.get(key).box;
  const record = makeRecord(ctx, target, place, box, sheet);
  // если перенос не удался, часть уже перенумерована и остаётся с новым номером
  if (!carryIsland(ctx, entry, record, mapUv)) return null;

  trackPiece(ctx, entry.name, now, record, (part ?? own).triangles.length * 3);
  ctx.detached.set(entry.name, now);
  if (part) ctx.layouts.delete(entry.name);
  else moveIsland(layout, key, record);
  afterIslandMove(ctx, entry);
  return { material: entry.name, ...rectsOf(record) };
};

// Возвращает кусок на прежнее место; часть острова получает прежний номер.
const giveBack = (ctx, entry, record) => {
  carryIsland(ctx, entry, record, unmapUv);
  if (!record.part) return;
  const { of, triangles } = record.part;
  renumberTriangles(ctx, entry.meshes[record.mesh], record.island, of, [...unpackTriangles(triangles)]);
};

// Берёт треугольники части обратно под номер записи. Возвращает откат (у целого острова он пустой)
// или null, если номера в сетке не те.
const adoptPart = (ctx, item, record) => {
  const { part } = record;
  if (!part) return doNothing;
  const triangles = [...unpackTriangles(part.triangles)];
  const numbers = item.mesh.userData.astralUvIslands;
  if (!numbers || triangles.some((triangle) => numbers[triangle] !== part.of)) return null;
  unshareVertices(item);
  renumberTriangles(ctx, item, part.of, record.island, triangles);
  return () => renumberTriangles(ctx, item, record.island, part.of, triangles);
};

// Ставит недостающий кусок; null — запись чужая или неточная.
const placePiece = (ctx, entry, record) => {
  const { width, height } = sheetSizeOf(entry);
  const item = entry.meshes[record.mesh];
  if (record.size[0] !== width || record.size[1] !== height || !item) return null;

  const rollback = adoptPart(ctx, item, record);
  if (!rollback) return null;

  // развёртка куска должна сойтись с записью, и остров должен переставиться
  const own = islandSheet(entry, item, record.island);
  const fits = own && boxMatches(trianglesBox(own.uvs), record.box);
  if (fits && carryIsland(ctx, entry, record, mapUv)) return own;
  rollback();
  return null;
};

// Приводит кусочки детали к списку из проекта: лишние возвращает, недостающие ставит.
const syncDetached = (ctx, name, records) => {
  const entry = entryNamed(ctx, name);
  if (!entry) return { placed: [], returned: [] };
  const now = ctx.detached.get(name) ?? new Map();
  const wanted = new Map(records.map((record) => [idOf(record), record]));

  // лишние снимаются с последнего поставленного, недостающие ставятся в порядке проекта
  const stale = [...now].filter(([key]) => !wanted.has(key)).reverse();
  const missing = [...wanted.values()].filter((record) => !now.has(idOf(record)));

  const returned = [];
  for (const [key, record] of stale) {
    giveBack(ctx, entry, record);
    now.delete(key);
    noteVertices(ctx, name, key, null);
    returned.push(rectsOf(record));
  }
  const placed = [];
  for (const record of missing) {
    const own = placePiece(ctx, entry, record);
    if (!own) continue;
    trackPiece(ctx, name, now, record, own.triangles.length * 3);
    placed.push(rectsOf(record));
  }

  ctx.detached.set(name, now);
  if (placed.length + returned.length > 0) {
    ctx.layouts.delete(name);
    afterIslandMove(ctx, entry);
  }
  return { placed, returned };
};

export const attachDetachZone = (ctx) => {
  ctx.layouts ??= new Map();
  ctx.detached ??= new Map();
  ctx.detachedVertices ??= new Map();
  ctx.detachable ??= false;
  return Object.assign(ctx.ops, {
    setDetachable(value) {
      ctx.detachable = Boolean(value);
    },
    detachIsland(hit, { reach = 0, room = true } = {}) {
      return detach(ctx, hit, reach, room);
    },
    syncDetached(name, records = []) {
      return syncDetached(ctx, name, records);
    },
    detachedPieces(name) {
      return detachedPieces(ctx, name);
    },
  });
};
