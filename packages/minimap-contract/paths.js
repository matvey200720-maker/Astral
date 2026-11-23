/*
 * Узлы дорог GTA V (`x64/levels/gta5/paths.rpf/nodes*.ynd`) — точность
 * маршрута GPS (задача 9 ТЗ 10.10.2026).
 *
 * Файл узлов — ресурс RSC7 (версия 1): заголовок и сжатые deflate данные, а
 * в них словарь узлов (`NodeDictionary`): узлы по 40 байт и связи по 8.
 * Здесь узлы читаются и правятся на месте: меняются только байты флагов,
 * размер данных и заголовок ресурса остаются прежними, поэтому собранный
 * файл — тот же ресурс с другими флагами. Устройство — по CodeWalker
 * (`YndFile.cs`, `Node.cs`), сверено разбором всех 274 файлов игры.
 *
 * Флаги, от которых зависит маршрут GPS:
 *   узел Flags0: 1 — ?, 2 — общий у всех дорог, 8 — бездорожье, 32 — без
 *                больших машин, 128 — нельзя налево;
 *   узел Flags2: 1 — «нет GPS», 4 — перекрёсток, 16 и 128 — «отключён»
 *                (у CodeWalker — догадка; это 57 % узлов машин, и GPS игры
 *                по ним ходит), 32 — ?, 64 — трасса;
 *   связь Flags2: 1 — у CodeWalker «не для навигации», но GPS игры ходит и
 *                по ним (без них центр города — остров в 54 узла), 2 — срез,
 *                биты 2–4 — полос назад, 5–7 — полос вперёд.
 *
 * `paths.rpf` владельца (рабочий стол, 10.10.2026) — те же узлы, где у всех
 * узлов Flags0 = 2 и Flags2 ∈ {4, 0}, а у всех связей Flags2 = 36: каждая
 * дорога двусторонняя по полосе, ни одного запрета. Уровень «direct» — флаги
 * ровно как в том файле. В игре (10.10.2026, шесть маршрутов от площади
 * Легион) с ним все маршруты найдены и не длиннее штатных: Форт-Занкудо
 * 7,10 → 6,01 км, Палето-Бэй 10,53 → 9,48 км, остальные ±0,02 км. Мягкий
 * уровень «снять только запреты GPS, полосы оставить» в игре два маршрута
 * из шести не нашёл — его нет. Геометрия, связи и названия улиц всегда
 * остаются теми, что у игрока.
 */

import { GPS_ACCURACY_LEVELS } from "./gps-marker.js";

export { GPS_ACCURACY_LEVELS };
export const GPS_PATHS_ARCHIVE = "x64/levels/gta5/paths.rpf";

const RSC7_MAGIC = 0x37435352;
const SYSTEM_BASE = 0x50000000;
const NODE_SIZE = 40;
const LINK_SIZE = 8;

/* Флаги узлов и связей по уровню точности (`stock` — без правки). */
export function gpsNodeFlags(level, flags0, flags2) {
  /* Как в файле владельца: любой непустой Flags2 становится 4. */
  if (level === "direct") return { flags0: 2, flags2: flags2 ? 4 : 0 };
  return { flags0, flags2 };
}

export function gpsLinkFlags(level, flags2) {
  if (level === "direct") return 36;
  return flags2;
}

/** Заголовок RSC7: `{ version, systemFlags, graphicsFlags }` или ошибка. */
export function readRsc7Header(bytes) {
  if (bytes.length < 16 || bytes.readUInt32LE(0) !== RSC7_MAGIC)
    throw new Error("Узлы дорог: это не ресурс RSC7.");
  return {
    version: bytes.readUInt32LE(4),
    systemFlags: bytes.readUInt32LE(8),
    graphicsFlags: bytes.readUInt32LE(12),
  };
}

const offsetOf = (pointer, size) => {
  const value = Number(pointer);
  if (value < SYSTEM_BASE || value >= SYSTEM_BASE + 0x10000000)
    throw new Error("Узлы дорог: указатель вне системной части ресурса.");
  const offset = value - SYSTEM_BASE;
  if (offset > size) throw new Error("Узлы дорог: указатель за концом данных.");
  return offset;
};

/**
 * Словарь узлов из разжатых данных ресурса: где лежат узлы и связи и
 * сколько их. Узлы машин — первые `vehicleCount`.
 */
export function readNodeDictionary(data) {
  if (data.length < 112) throw new Error("Узлы дорог: данные короче словаря.");
  const nodesCount = data.readUInt32LE(24);
  const linksCount = data.readUInt32LE(48);
  const nodesAt = nodesCount ? offsetOf(data.readBigUInt64LE(16), data.length) : 0;
  const linksAt = linksCount ? offsetOf(data.readBigUInt64LE(40), data.length) : 0;
  if (nodesAt + nodesCount * NODE_SIZE > data.length || linksAt + linksCount * LINK_SIZE > data.length)
    throw new Error("Узлы дорог: узлы или связи выходят за данные.");
  return {
    nodesCount,
    vehicleCount: data.readUInt32LE(28),
    pedCount: data.readUInt32LE(32),
    linksCount,
    nodesAt,
    linksAt,
  };
}

/** Узел словаря по номеру: положение в метрах, флаги и его связи. */
export function readNode(data, dictionary, index) {
  const at = dictionary.nodesAt + index * NODE_SIZE;
  return {
    area: data.readUInt16LE(at + 16),
    id: data.readUInt16LE(at + 18),
    street: data.readUInt32LE(at + 20),
    linkId: data.readUInt16LE(at + 26),
    x: data.readInt16LE(at + 28) / 4,
    y: data.readInt16LE(at + 30) / 4,
    flags0: data[at + 32],
    flags1: data[at + 33],
    z: data.readInt16LE(at + 34) / 32,
    flags2: data[at + 36],
    linkCount: data[at + 37] >> 3,
    flags3: data[at + 38],
    flags4: data[at + 39],
  };
}

export function readLink(data, dictionary, index) {
  const at = dictionary.linksAt + index * LINK_SIZE;
  return {
    area: data.readUInt16LE(at),
    id: data.readUInt16LE(at + 2),
    flags0: data[at + 4],
    flags1: data[at + 5],
    flags2: data[at + 6],
    length: data[at + 7],
  };
}

/**
 * Правка флагов на месте: `data` — разжатые данные одного файла узлов.
 * Возвращает число изменённых узлов и связей.
 */
export function applyGpsAccuracy(data, level) {
  if (!GPS_ACCURACY_LEVELS.includes(level)) throw new RangeError(`Неизвестная точность маршрута «${level}».`);
  const dictionary = readNodeDictionary(data);
  let nodes = 0;
  let links = 0;
  if (level === "stock") return { nodes, links };
  for (let index = 0; index < dictionary.nodesCount; index += 1) {
    const at = dictionary.nodesAt + index * NODE_SIZE;
    const next = gpsNodeFlags(level, data[at + 32], data[at + 36]);
    if (next.flags0 !== data[at + 32] || next.flags2 !== data[at + 36]) nodes += 1;
    data[at + 32] = next.flags0;
    data[at + 36] = next.flags2;
  }
  for (let index = 0; index < dictionary.linksCount; index += 1) {
    const at = dictionary.linksAt + index * LINK_SIZE + 6;
    const next = gpsLinkFlags(level, data[at]);
    if (next !== data[at]) links += 1;
    data[at] = next;
  }
  return { nodes, links };
}

/**
 * Файл узлов с другой точностью: тот же заголовок RSC7, данные сжаты
 * заново. `inflateRaw` / `deflateRaw` — сжатие окружения (в главном
 * процессе — zlib).
 */
export function transformYnd(bytes, level, { inflateRaw, deflateRaw }) {
  readRsc7Header(bytes);
  const data = Buffer.from(inflateRaw(bytes.subarray(16)));
  const changed = applyGpsAccuracy(data, level);
  return {
    bytes: Buffer.concat([bytes.subarray(0, 16), Buffer.from(deflateRaw(data))]),
    ...changed,
  };
}

/* --------------------------------------------------------------- граф */

/**
 * Узлы машин одного файла — для графа маршрута в окне: положения, флаги и
 * связи компактными числами. Пешеходные узлы GPS машины не ходит.
 */
export function yndRoadGraph(data) {
  const dictionary = readNodeDictionary(data);
  const nodes = [];
  for (let index = 0; index < dictionary.vehicleCount; index += 1) {
    const node = readNode(data, dictionary, index);
    const links = [];
    for (let k = 0; k < node.linkCount; k += 1) {
      const link = readLink(data, dictionary, node.linkId + k);
      links.push([link.area, link.id, link.flags2, link.length]);
    }
    nodes.push([node.area, node.id, Math.round(node.x * 4) / 4, Math.round(node.y * 4) / 4, node.flags0, node.flags2, links]);
  }
  return nodes;
}

const keyOf = (area, id) => area * 65536 + id;

/*
 * Маршрут по графу узлов — приближение к GPS игры для предпросмотра: A* по
 * длине связей; узлы «нет GPS» — мимо, односторонка — по полосам вперёд,
 * трасса чуть выгоднее. Правила подобраны по шести маршрутам в игре
 * (10.10.2026): длины отходят от спутникового расстояния радара на 2–5 %.
 * Игра считает маршрут своим алгоритмом — числа близкие, не равные.
 */
export function findGpsRoute(graph, from, to, level = "stock") {
  const index = new Map();
  for (const node of graph) index.set(keyOf(node[0], node[1]), node);
  const usable = (node) => !(gpsNodeFlags(level, node[4], node[5]).flags2 & 1);
  const forward = (flags2) => ((gpsLinkFlags(level, flags2) >> 5) & 7) > 0;
  /* Начало и конец — ближайший узел, из которого можно уехать. */
  const leaves = (node) =>
    node[6].some(([area, id, flags2]) => forward(flags2) && index.has(keyOf(area, id)) && usable(index.get(keyOf(area, id))));
  const nearest = (point) => {
    let best = null;
    let bestDistance = Infinity;
    for (const node of graph) {
      if (!usable(node) || !leaves(node)) continue;
      const distance = Math.hypot(node[2] - point.x, node[3] - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  };
  const start = nearest(from);
  const goal = nearest(to);
  if (!start || !goal) return null;
  const goalKey = keyOf(goal[0], goal[1]);
  const startKey = keyOf(start[0], start[1]);
  const cost = new Map([[startKey, 0]]);
  const came = new Map();
  /* Простая двоичная куча по f = g + h. */
  const heap = [];
  const push = (key, f) => {
    heap.push([f, key]);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const heuristic = (node) => Math.hypot(node[2] - goal[2], node[3] - goal[3]) * 0.8;
  push(startKey, heuristic(start));
  const closed = new Set();
  while (heap.length) {
    const [, key] = pop();
    if (closed.has(key)) continue;
    closed.add(key);
    if (key === goalKey) break;
    const node = index.get(key);
    const highway = gpsNodeFlags(level, node[4], node[5]).flags2 & 64;
    for (const [area, id, flags2] of node[6]) {
      if (!forward(flags2)) continue;
      const targetKey = keyOf(area, id);
      const target = index.get(targetKey);
      if (!target || !usable(target)) continue;
      const weight = Math.hypot(target[2] - node[2], target[3] - node[3]) * (highway ? 0.85 : 1);
      const next = cost.get(key) + weight;
      if (next < (cost.get(targetKey) ?? Infinity)) {
        cost.set(targetKey, next);
        came.set(targetKey, key);
        push(targetKey, next + heuristic(target));
      }
    }
  }
  if (!came.has(goalKey) && goalKey !== startKey) return null;
  const points = [];
  let distance = 0;
  for (let key = goalKey; key !== undefined; key = came.get(key)) {
    const node = index.get(key);
    if (points.length) distance += Math.hypot(points.at(-1)[0] - node[2], points.at(-1)[1] - node[3]);
    points.push([node[2], node[3]]);
    if (key === startKey) break;
  }
  points.reverse();
  return { points, distance: Math.round(distance) };
}
