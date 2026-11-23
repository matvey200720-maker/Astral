/*
 * Сетки сцены — пачками по материалу и части (18.10.2026, Session 2, задача 3).
 *
 * Сцена арены снята по сущностям игры и приходит сотнями мелких сеток: у зала
 * GTA 5 RP — 421 сетка на 109 материалов при медиане 290 треугольников.
 * Каждая сетка — отдельный вызов отрисовки (и ещё один в карте теней), а
 * видеокарте их 160 тысяч треугольников — пустяк. Поэтому сетки одного
 * материала и одной части склеиваются в одну: 421 → 109 вызовов у GTA 5 RP,
 * 419 → 166 у Majestic, фасады — 40 с небольшим.
 *
 * Склейка — только для рисования. Исходные сетки остаются «логическими»:
 * по ним целится щелчок и считаются стены полёта (у каждой своя коробка —
 * луч не тащит за собой всю пачку), а пачки лежат в сцене и рисуются. Всё,
 * что решается по материалу или части (облик, скрытие, подсветка), одинаково
 * у сетки и у её пачки: ключ пачки — материал и часть, ничего другого у сетки
 * сцены нет. Сетки с разным набором атрибутов (с развёрткой и без, с весами
 * земли) в одну пачку не идут: у склейки обязан быть один набор.
 *
 * Большая сцена (зал арены: 780 тысяч треугольников) режется на куски (`chunk`): пачка тяжелее `chunk`
 * треугольников делится по пространству (k-d по центрам сеток), и видеокарта не рисует то, что вне кадра:
 * пачка «все стены зала» одним куском накрывала бы кадр из любой точки и отсечению не поддавалась.
 *
 * Сетки сцены интерьера несут номер сущности игры (`entity`): пачка помнит, какие её индексы чьи
 * (`entityRanges`: `[сущность, с, по)`), и кадр прячет вещь по одной, переписывая индексы пачки на месте
 * (`compactIndices`), а не пересобирая сцену.
 *
 * `keep(mesh)` — какие сетки не склеивать (прозрачные и наклейки: у них порядок
 * рисования идёт от каждой сетки). Чистая функция над разобранной сценой (`scene-asset.js`): массивы не
 * копируются, пока в пачке одна сетка.
 */

/* Больше вершин — индексы u32 (у u16 предел 65 535). */
const U16_LIMIT = 65535;
/* Пачка не растёт без конца: больше стольких вершин — новая пачка (склейка копирует массивы). */
const BATCH_VERTICES = 120_000;

/* Нормали нулевые (у некоторых сеток игры их нет): кадр считает их по граням, но у склейки
   нули одной сетки заразили бы нормали соседних — считаем до склейки. */
function withNormals(mesh) {
  const { normals, positions, indices } = mesh;
  let any = false;
  for (let index = 0; index < normals.length && !any; index += 1) any = normals[index] !== 0;
  if (any) return mesh;
  const out = new Float32Array(normals.length);
  for (let face = 0; face + 2 < indices.length; face += 3) {
    const [a, b, c] = [indices[face] * 3, indices[face + 1] * 3, indices[face + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const at of [a, b, c]) {
      out[at] += nx;
      out[at + 1] += ny;
      out[at + 2] += nz;
    }
  }
  for (let at = 0; at < out.length; at += 3) {
    const size = Math.hypot(out[at], out[at + 1], out[at + 2]) || 1;
    out[at] /= size;
    out[at + 1] /= size;
    out[at + 2] /= size;
  }
  return { ...mesh, normals: out };
}

/* Набор атрибутов: склеиваются сетки только с одинаковым (`planes` — метры стен под свою картинку, `arena-finish-walls.js`). */
const shape = (mesh) => `${mesh.uvs ? "u" : "-"}${mesh.colours ? "c" : "-"}${mesh.uvs1 ? "v" : "-"}${mesh.planes ? "p" : "-"}`;

function concat(arrays, Type) {
  let length = 0;
  for (const array of arrays) length += array.length;
  const out = new Type(length);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

/* Чьи индексы в склейке: `[сущность, с, по)` подряд идущих сеток одной сущности; без сущностей — `undefined`. */
function rangesOf(group) {
  let ranges;
  let at = 0;
  for (const mesh of group) {
    const end = at + mesh.indices.length;
    if (Number.isInteger(mesh.entity)) {
      ranges ||= [];
      const last = ranges[ranges.length - 1];
      if (last && last[0] === mesh.entity && last[2] === at) last[2] = end;
      else ranges.push([mesh.entity, at, end]);
    }
    at = end;
  }
  return ranges;
}

/*
 * Коробка и шар склейки из готовых у сеток (`scene-asset.js` считает их в потоке разбора): коробка — объединение, шар — вокруг середины коробки и накрывает шары всех сеток.
 * Он чуть просторнее тугого шара по вершинам, зато склейка не обходит миллионы вершин на главном потоке; нет границ хоть у одной сетки — `{}`, кадр посчитает сам.
 */
function boundsOf(group) {
  if (!group.every((mesh) => mesh.bounds)) return {};
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const mesh of group)
    for (let axis = 0; axis < 3; axis += 1) {
      bounds[axis] = Math.min(bounds[axis], mesh.bounds[axis]);
      bounds[axis + 3] = Math.max(bounds[axis + 3], mesh.bounds[axis + 3]);
    }
  const centre = [0, 1, 2].map((axis) => (bounds[axis] + bounds[axis + 3]) / 2);
  let radius = 0;
  for (const mesh of group) {
    const own = [0, 1, 2].map((axis) => (mesh.bounds[axis] + mesh.bounds[axis + 3]) / 2);
    radius = Math.max(radius, Math.hypot(own[0] - centre[0], own[1] - centre[1], own[2] - centre[2]) + (mesh.radius || 0));
  }
  return { bounds, radius };
}

function merge(group) {
  if (group.length === 1) return group[0];
  const first = group[0];
  const vertices = group.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const indexTotal = group.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const indices = vertices > U16_LIMIT ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
  let base = 0;
  let at = 0;
  for (const mesh of group) {
    for (let index = 0; index < mesh.indices.length; index += 1) indices[at + index] = mesh.indices[index] + base;
    at += mesh.indices.length;
    base += mesh.positions.length / 3;
  }
  return {
    material: first.material,
    part: first.part,
    positions: concat(group.map((mesh) => mesh.positions), Float32Array),
    normals: concat(group.map((mesh) => mesh.normals), Float32Array),
    uvs: first.uvs ? concat(group.map((mesh) => mesh.uvs), Float32Array) : null,
    indices,
    ...boundsOf(group),
    ...(first.colours ? { colours: concat(group.map((mesh) => mesh.colours), Uint8Array) } : {}),
    ...(first.uvs1 ? { uvs1: concat(group.map((mesh) => mesh.uvs1), Float32Array) } : {}),
    ...(first.planes ? { planes: concat(group.map((mesh) => mesh.planes), Float32Array) } : {}),
  };
}

/**
 * Индексы пачки без спрятанных вещей: видимые отрезки `full` уплотняются в начало `work` (тот же тип и
 * длина), остальное не трогается. Возвращает число оставленных индексов — его кадр ставит в `drawRange`.
 * Отрезки вне `ranges` (сетки без сущности) остаются всегда.
 */
export function compactIndices(full, work, ranges, hidden) {
  let put = 0;
  let at = 0;
  const copy = (from, to) => {
    if (to <= from) return;
    work.set(full.subarray(from, to), put);
    put += to - from;
  };
  for (const [entity, from, to] of ranges) {
    if (!hidden.has(entity)) continue;
    copy(at, from);
    at = to;
  }
  copy(at, full.length);
  /* Хвост — нули: остатки прежнего расклада не должны попасть ни в обводку, ни в расчёт треугольников. */
  work.fill(0, put);
  return put;
}

const trianglesOf = (mesh) => mesh.indices.length / 3;

/* Центр сетки — середина её рамки: по нему сетка попадает в кусок. */
function centreOf(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const { positions } = mesh;
  for (let at = 0; at < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[at + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  return min.map((value, axis) => (value + max[axis]) / 2);
}

/**
 * Делит сетки по пространству пополам по самой длинной оси центров — до кусков не тяжелее `limit`
 * треугольников (или пока делить нечего: сетка неделима). Половины равны по треугольникам, а не по числу сеток.
 */
export function splitSpatially(meshes, limit) {
  const items = meshes.map((mesh) => ({ mesh, centre: centreOf(mesh), tris: trianglesOf(mesh) }));
  const out = [];
  const cut = (list) => {
    const total = list.reduce((sum, item) => sum + item.tris, 0);
    if (list.length < 2 || total <= limit) {
      out.push(list.map((item) => item.mesh));
      return;
    }
    const lows = [0, 1, 2].map((axis) => Math.min(...list.map((item) => item.centre[axis])));
    const highs = [0, 1, 2].map((axis) => Math.max(...list.map((item) => item.centre[axis])));
    const axis = [0, 1, 2].reduce((best, next) => (highs[next] - lows[next] > highs[best] - lows[best] ? next : best), 0);
    const sorted = [...list].sort((a, b) => a.centre[axis] - b.centre[axis]);
    let seen = 0;
    let at = 0;
    while (at < sorted.length - 1 && seen + sorted[at].tris <= total / 2) {
      seen += sorted[at].tris;
      at += 1;
    }
    /* Одна сетка перетянула половину — режем перед ней или после неё, чтобы обе стороны не пустовали. */
    const left = sorted.slice(0, Math.max(1, at));
    const right = sorted.slice(Math.max(1, at));
    if (!right.length) {
      out.push(list.map((item) => item.mesh));
      return;
    }
    cut(left);
    cut(right);
  };
  cut(items);
  return out;
}

/**
 * Пачки сеток сцены: `[{ material, part, positions, normals, uvs, indices,
 * colours?, uvs1?, sources }]` — склейка сеток одного материала, части и набора
 * атрибутов; `sources` — сколько сеток вошло. Порядок пачек — по первому
 * появлению материала в сцене (рисуется так же, как рисовалась бы сцена).
 */
export function batchSceneMeshes(meshes, { keep = () => false, chunk = 0, roomOf = () => null } = {}) {
  const groups = new Map();
  const batches = [];
  for (const source of meshes) {
    /* Прозрачное и наклейки порядок рисования берут от каждой сетки: склеенные, они мерцали бы. */
    if (keep(source)) {
      batches.push({ ...source, sources: 1, ...(Number.isInteger(source.entity) ? { entityRanges: [[source.entity, 0, source.indices.length]] } : {}) });
      continue;
    }
    const mesh = withNormals(source);
    /* Комната (`roomOf`) — отдельная пачка: у её стен можно задать свой облик, не трогая соседние комнаты. */
    const room = roomOf(source);
    const key = `${mesh.material}|${mesh.part}|${shape(mesh)}|${room ?? ""}`;
    const entry = groups.get(key);
    if (entry) entry.list.push(mesh);
    else groups.set(key, { room, list: [mesh] });
  }
  for (const { room, list: group } of groups.values()) {
    /* Тяжёлая пачка — кусками по пространству; лёгкая остаётся одной. */
    const parts = chunk > 0 && group.reduce((sum, mesh) => sum + trianglesOf(mesh), 0) > chunk ? splitSpatially(group, chunk) : [group];
    for (const list of parts) pack(list, room);
  }
  return batches;

  function pack(list, room) {
    let current = [];
    let vertices = 0;
    const flush = () => {
      if (!current.length) return;
      const ranges = rangesOf(current);
      batches.push({ ...merge(current), sources: current.length, ...(ranges ? { entityRanges: ranges } : {}), ...(room ? { room } : {}) });
      current = [];
      vertices = 0;
    };
    for (const mesh of list) {
      const count = mesh.positions.length / 3;
      if (current.length && vertices + count > BATCH_VERTICES) flush();
      current.push(mesh);
      vertices += count;
    }
    flush();
  }
}
