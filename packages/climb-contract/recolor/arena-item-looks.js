// Облик вещей зала арены без окна и без файлов: группы работы, части модели, копии моделей
// и описи рамок. Группа — «эти вещи одной модели игры выглядят так»; групп не больше 16.

import { ARENA_ITEM_FRAMES } from "./inventory/arena-item-frames.js";
import { ARENA_ITEM_SOURCES } from "./inventory/arena-item-sources.js";
import { normalizeArenaReplacementModel } from "./arena-replace.js";
import { normalizeItemElements } from "./item-elements.js";

// ---- пределы и виды ----

export const ARENA_ITEM_GROUP_LIMIT = 16;

export const ARENA_ITEM_KINDS = Object.freeze(["model", "colour", "picture", "elements", "removed"]);

export const ARENA_ITEM_LIMITS = Object.freeze({
  scale: Object.freeze([0.2, 3]),
  turn: Object.freeze([-180, 180]),
  offset: Object.freeze([-10, 10]),
});

export const ARENA_ITEM_PART_LIMITS = Object.freeze({ extent: 200, label: 80 });

// Запас рамки части, м.
export const ARENA_ITEM_PART_MARGIN = 0.005;

// ---- общие помощники ----

function ascending(left, right) {
  return left - right;
}

function clampTo(value, [low, high]) {
  return Math.max(low, Math.min(value, high));
}

function roundTo(value, digits) {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

const noModel = () => "";

// ---- сдвиг после протяжки ----

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// Сдвиг сцены (delta) переводится в оси модели обратным поворотом места и делением на его
// масштаб; результат прибавляется к прежнему сдвигу. Значения delta идут в формулы как есть.
export function arenaItemMoveOffset(place, offset, delta) {
  const turned = [...(place?.rotation || [0, 0, 0, 1])];
  const scaled = [...(place?.scale || [1, 1])];
  const [px, py, pz] = delta;

  const inverse = [0, 1, 2].map((axis) => -turned[axis]);
  const moved = [px, py, pz];
  const lever = cross(inverse, moved).map((part) => 2 * part);
  const spin = cross(inverse, lever);
  const qw = turned[3];
  const divisors = [scaled[0], scaled[0], scaled[1]];

  return [0, 1, 2].map((axis) => {
    const rotated = moved[axis] + qw * lever[axis] + spin[axis];
    return (Number(offset && offset[axis]) || 0) + rotated / divisors[axis];
  });
}

// ---- часть модели ----

const isCorner = (value) => value?.length === 3 && Array.isArray(value);

// Подпись: пробелы по краям срезаны, внутри любая серия пробелов — один пробел.
const tidyLabel = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, ARENA_ITEM_PART_LIMITS.label);

const roundCorner = (corner) => corner.map((value) => roundTo(value, 4) + 0);

// Рамка части в осях модели и подпись; всё, что не годится, — null.
export function normalizeArenaItemPart(input) {
  const source = typeof input === "object" && input && !Array.isArray(input) ? input : {};
  const corners = source.box;
  const shaped = Array.isArray(corners) && corners.length === 2 && corners.every(isCorner);
  if (!shaped) return null;

  const numbers = corners.map((corner) => Array.from(corner, Number));
  const { extent: reach } = ARENA_ITEM_PART_LIMITS;
  const usable = (value) => Number.isFinite(value) && Math.abs(value) <= reach;
  if (!numbers.flat().every(usable)) return null;

  const [min, max] = numbers.map(roundCorner);
  if (min.some((value, axis) => value > max[axis])) return null;
  return { box: [min, max], label: tidyLabel(source.label) };
}

// Ключ рамки части; пустая строка — облик на всю модель.
export function arenaItemPartKey(part) {
  return part?.box ? JSON.stringify(part.box) : "";
}

// Забирает ли новый облик (с частью part) вещи у этой группы: облик на всю модель забирает у
// всех, облик части — у групп без части и у групп с той же рамкой. «Есть ли часть» — правда
// самого значения, «та же ли часть» — равенство ключей рамки.
function claims(entry, part) {
  return !part || !entry.part || arenaItemPartKey(entry.part) === arenaItemPartKey(part);
}

// ---- треугольники части ----

// Координата, округлённая до миллиметра: по ней вершины считаются совпавшими.
const snap = (value) => Math.round(value * 1000);

// Склейка вершин в куски: у каждой вершины есть «родитель»; корень ищется с полным сжатием пути.
function rootOf(parent, node) {
  let root = node;
  while (parent[root] !== root) root = parent[root];
  for (let step = node; step !== root; ) {
    const next = parent[step];
    parent[step] = root;
    step = next;
  }
  return root;
}

function join(parent, into, other) {
  parent[rootOf(parent, other)] = rootOf(parent, into);
}

// 1, если середина треугольника (вершины с позиций pa, pb, pc) лежит в рамке по всем трём осям;
// edges — границы рамки с запасом парами «низ, верх» по осям.
function middleWithin(positions, pa, pb, pc, edges) {
  for (let axis = 0; axis < 3; axis += 1) {
    const sum = positions[pa + axis] + positions[pb + axis] + positions[pc + axis];
    const middle = sum / 3;
    if (!(middle >= edges[axis * 2] && middle <= edges[axis * 2 + 1])) return 0;
  }
  return 1;
}

// Сведения о куске лежат в одной таблице: по ряду из STRIDE чисел на кусок —
// [треугольников, «внутренних», низ x y z, верх x y z].
const STRIDE = 8;

function emptyPieces(count) {
  const table = new Float64Array(count * STRIDE).fill(Infinity);
  for (let row = 0; row < table.length; row += STRIDE) {
    table[row] = table[row + 1] = 0;
    table[row + 5] = table[row + 6] = table[row + 7] = -Infinity;
  }
  return table;
}

// Растягивает рамку куска (ряд table с позиции row) вершиной с позиции at; нечисло заражает
// границу, как у стандартных «минимум/максимум».
function growPiece(table, row, positions, at) {
  for (let axis = 0; axis < 3; axis += 1) {
    table[row + 2 + axis] = Math.min(table[row + 2 + axis], positions[at + axis]);
    table[row + 5 + axis] = Math.max(table[row + 5 + axis], positions[at + axis]);
  }
}

// Что делать с куском: 0 — ничего, 1 — взять целиком, 2 — только треугольники с серединой внутри.
function verdictOf(table, row, diagonal) {
  const total = table[row];
  const hits = table[row + 1];
  if (hits === 0) return 0;
  if (hits * 2 >= total) return 1;
  const size = Math.hypot(table[row + 5] - table[row + 2], table[row + 6] - table[row + 3], table[row + 7] - table[row + 4]);
  return size > 2 * diagonal ? 2 : 0;
}

// Маска по треугольникам: 1 — треугольник относится к части. Треугольники склеиваются в
// куски по общим вершинам (точка с точностью до миллиметра); кусок, на который рамка
// накрывает половину и больше, берётся целиком, а кусок много больше рамки — только теми
// треугольниками, чья середина внутри рамки.
export function arenaPartTriangles(positions, indices, box, margin = ARENA_ITEM_PART_MARGIN) {
  const [low, high] = box;
  const { length } = indices;
  const count = Math.floor(length / 3);
  const diagonal = Math.hypot(...[0, 1, 2].map((axis) => high[axis] - low[axis]));
  const edges = [0, 1, 2].flatMap((axis) => [low[axis] - margin, high[axis] + margin]);

  // Вершина -> номер точки (по индексу и по округлённым координатам), точки -> «родители».
  const pointNumber = new Map();
  const numberOfIndex = new Map();
  const parent = new Int32Array(count * 3);
  const pointOf = (index) => {
    let number = numberOfIndex.get(index);
    if (number === undefined) {
      const at = index * 3;
      const label = `${snap(positions[at])},${snap(positions[at + 1])},${snap(positions[at + 2])}`;
      number = pointNumber.get(label);
      if (number === undefined) {
        number = pointNumber.size;
        pointNumber.set(label, number);
        parent[number] = number;
      }
      numberOfIndex.set(index, number);
    }
    return number;
  };

  // Невырожденные треугольники по порядку: склейка вершин, «якорь» и признак «середина внутри».
  const live = new Int32Array(count);
  const anchor = new Int32Array(count);
  const inside = new Uint8Array(count);
  let liveCount = 0;
  for (let tri = 0; tri < count; tri += 1) {
    const base = tri * 3;
    const a = indices[base];
    const b = indices[base + 1];
    const c = indices[base + 2];
    if (a === b && b === c) continue;
    live[liveCount] = tri;
    liveCount += 1;
    const first = pointOf(a);
    join(parent, first, pointOf(b));
    join(parent, first, pointOf(c));
    anchor[tri] = first;
    inside[tri] = middleWithin(positions, a * 3, b * 3, c * 3, edges);
  }

  // По каждому куску: сколько треугольников, сколько «внутренних», рамка куска.
  const pieces = pointNumber.size;
  const table = emptyPieces(pieces);
  for (let k = 0; k < liveCount; k += 1) {
    const tri = live[k];
    anchor[tri] = rootOf(parent, anchor[tri]);
    const row = anchor[tri] * STRIDE;
    table[row] += 1;
    table[row + 1] += inside[tri];
    for (let corner = 0; corner < 3; corner += 1) growPiece(table, row, positions, indices[tri * 3 + corner] * 3);
  }

  // Решение по каждому куску один раз (в том числе «растянутые» куски), затем маска.
  const verdicts = new Uint8Array(pieces);
  for (let piece = 0; piece < pieces; piece += 1) verdicts[piece] = verdictOf(table, piece * STRIDE, diagonal);
  const mask = new Uint8Array(count);
  for (let k = 0; k < liveCount; k += 1) {
    const tri = live[k];
    const verdict = verdicts[anchor[tri]];
    mask[tri] = verdict === 2 ? inside[tri] : verdict;
  }
  return mask;
}

export { arenaPartTriangles as itemPartTriangles };

// ---- нормализация групп работы ----

const COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const offsetAxis = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? roundTo(clampTo(number, ARENA_ITEM_LIMITS.offset), 3) + 0 : 0;
};

function normalizeOffset(raw) {
  if (!(Array.isArray(raw) && raw.length === 3)) return null;
  const axes = raw.map(offsetAxis);
  return axes.some(Boolean) ? axes : null;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Вид группы: «Цвет» — если цвет годный; иначе по форме модели (сетка — своя модель).
function kindOf(source, model, colour) {
  if (colour && source.kind === "colour") return "colour";
  return model.shape === "mesh" ? "model" : "picture";
}

function lookGroup(keys, source, model, part) {
  const colourText = String(source.colour);
  const colour = COLOUR_PATTERN.test(colourText) ? colourText.toLowerCase() : null;
  const kind = kindOf(source, model, colour);
  const offset = kind === "colour" ? null : normalizeOffset(source.offset);
  return {
    keys,
    kind,
    ...(kind === "colour" && { colour }),
    model,
    scale: roundTo(clampTo(finiteOr(source.scale, 1), ARENA_ITEM_LIMITS.scale), 2),
    turn: roundTo(clampTo(finiteOr(source.turn, 0), ARENA_ITEM_LIMITS.turn), 1),
    ...(offset && { offset }),
    ...(part && { part }),
  };
}

// Что несёт запись по её виду: элементы или модель; отказ — null.
function readPayload(source, mode) {
  if (mode === "elements") {
    const elements = normalizeItemElements(source.elements);
    return elements.length === 0 ? null : { elements, model: null };
  }
  const model = mode === "look" && source.model ? normalizeArenaReplacementModel(source.model) : null;
  return mode === "look" && !model ? null : { elements: [], model };
}

// Часть записи: { part } или null, если запись надо отбросить.
function readPart(source, mode) {
  const wanted = source.part;
  const part = mode === "elements" || wanted === undefined || wanted === null ? null : normalizeArenaItemPart(wanted);
  const refused = (mode !== "elements" && !part && wanted) || (mode === "removed" && !part);
  return refused ? null : { part };
}

// Запись работы по порядку проверок; отказ любого шага — null (запись пропускается).
function readEntry(raw, { allowed, modelOf, hidden }) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const mode = source.kind === "removed" || source.kind === "elements" ? source.kind : "look";
  const payload = readPayload(source, mode);
  if (!payload) return null;

  const candidates = Array.isArray(source.keys) ? [...source.keys] : [];
  const known = (key) => Number.isInteger(key) && allowed.has(key);
  const first = candidates.find(known);
  if (first === undefined) return null;
  const modelName = modelOf(first);
  if (!modelName) return null;

  const chosen = readPart(source, mode);
  if (chosen === null) return null;

  const sameModel = (key) => known(key) && !hidden.has(key) && modelOf(key) === modelName;
  const keys = [...new Set(candidates.filter(sameModel))].sort(ascending);
  return keys.length === 0 ? null : { mode, source, ...payload, ...chosen, keys };
}

// Вещи списка keys без тех, что ушли (gone — множество).
const keptKeys = (keys, gone) => keys.filter((key) => !gone.has(key));

// Группа по виду записи: «убрана», «элементы» или обычный облик.
function buildGroup(entry) {
  const { mode, keys, part } = entry;
  if (mode === "look") return lookGroup(keys, entry.source, entry.model, part);
  return mode === "removed" ? { keys, kind: mode, part } : { keys, kind: mode, elements: entry.elements };
}

// Группы из сохранённой работы: годные записи, у каждой вещи один облик на модель или часть
// (более поздняя группа забирает вещи у ранней), не больше 16 последних групп.
export function normalizeArenaItems(input, { allowed, modelOf, removed = [] }) {
  if (!(Array.isArray(input) && allowed)) return [];
  const context = { allowed, modelOf, hidden: new Set(removed) };
  const accepted = input.reduce((groups, raw) => {
    const entry = readEntry(raw, context);
    if (entry) {
      const taken = new Set(entry.keys);
      groups
        .filter((earlier) => claims(earlier, entry.part))
        .forEach((earlier) => {
          earlier.keys = keptKeys(earlier.keys, taken);
        });
      groups.push(buildGroup(entry));
    }
    return groups;
  }, []);
  return accepted.filter((group) => group.keys.length > 0).slice(-ARENA_ITEM_GROUP_LIMIT);
}

// ---- модели для главного процесса ----

const modelRow = (group, labelOf) => ({
  ...group.model,
  label: group.model.label || labelOf(group) || "",
  position: [0, 0, 0],
});

const plateOf = ({ picture }) => ({
  asset: picture.asset,
  shape: "plate",
  width: picture.width,
  height: picture.height,
  position: [0, 0, 0],
});

// Модели групп (с подписью и позицией [0, 0, 0]), затем плашки-картинки элементов.
export function itemLookModels(items, labelOf = () => "") {
  const groups = items || [];
  const own = groups.filter((group) => group.model).map((group) => modelRow(group, labelOf));
  const plates = groups.flatMap((group) =>
    group.kind === "elements" ? group.elements.filter((element) => element.picture).map(plateOf) : [],
  );
  return [...own, ...plates];
}

export function arenaItemsChanged(items) {
  return Array.isArray(items) && items.length > 0;
}

// ---- отпечаток ----

const elementRow = (element) =>
  [element.texture, element.picture?.asset ?? element.colour, element.fit ?? null].concat(
    element.around ? ["around"] : [],
  );

const lookRow = (entry) => {
  const row = [entry.keys, { ...entry.model, name: undefined, label: undefined }, entry.scale, entry.turn];
  if (entry.part) row.push(entry.part.box);
  if (entry.offset) row.push(entry.offset);
  return row;
};

const SIGNATURE_ROWS = {
  removed: (entry) => [entry.keys, "removed", entry.part.box],
  elements: (entry) => [entry.keys, "elements", entry.elements.map(elementRow)],
};

// Отпечаток работы: имя файла модели, подпись и вид группы в него не входят (и цвет «Цвета»),
// рамка части и сдвиг — входят.
export function arenaItemsSignature(items) {
  return (items || []).map((entry) =>
    (Object.hasOwn(SIGNATURE_ROWS, entry.kind) ? SIGNATURE_ROWS[entry.kind] : lookRow)(entry),
  );
}

// Отпечаток одной записи без списка вещей — как строка для сравнения.
const lookShape = (entry) => JSON.stringify(arenaItemsSignature([entry])[0].slice(1));

// ---- установка облика ----

// Список без вещей moving там, где их «забирает» новый облик; опустевшие группы уходят.
function withdraw(items, moving, part) {
  return (items || [])
    .map((entry) => (claims(entry, part) ? { ...entry, keys: keptKeys(entry.keys, moving) } : entry))
    .filter((entry) => entry.keys.length > 0);
}

// Место группы, к которой присоединяются вещи: тот же облик и та же модель первой вещи.
function joinSlot(groups, look, moving, modelOf) {
  const wanted = lookShape(look);
  const [firstMoving] = moving;
  const sameLook = (entry) => lookShape(entry) === wanted && modelOf(entry.keys[0]) === modelOf(firstMoving);
  return groups.findIndex(sameLook);
}

// Ставит облик look вещам keys (null — вернуть к игре). Вещь уходит из групп, у которых её
// «забирают»; затем присоединяется к группе с тем же обликом и той же моделью или добавляется
// новой группой. Мест нет (уже limit групп) — null. Остальные параметры:
// modelOf, part (по умолчанию часть самого облика), limit (по умолчанию 16).
export function setArenaItemLook(items, keys, look, ...rest) {
  const [modelOf = noModel, part = (look && look.part) || null, limit = ARENA_ITEM_GROUP_LIMIT] = rest;
  const moving = new Set(keys);
  const remaining = withdraw(items, moving, part);
  if (!look) return remaining;

  const slot = joinSlot(remaining, look, moving, modelOf);
  if (slot < 0) {
    if (remaining.length >= limit) return null;
    return [...remaining, { keys: [...moving].sort(ascending), ...look }];
  }
  const target = remaining[slot];
  const joined = { ...target, keys: [...target.keys, ...moving].sort(ascending) };
  return remaining.map((entry, at) => (at === slot ? joined : entry));
}

// Вещи по моделям игры в порядке первого появления модели: [[модель, вещи], …].
function groupByModel(keys, modelOf) {
  const batches = [...keys].reduce((found, key) => {
    const model = modelOf(key);
    return found.set(model, [...(found.get(model) ?? []), key]);
  }, new Map());
  return [...batches];
}

// Облик набору вещей разных моделей: по группе на модель игры. look может быть функцией
// (модель, её вещи, прежняя группа первой вещи) — её ответ undefined оставляет вещи модели как
// есть. Облик всегда на всю вещь, без части. Остальные параметры: modelOf, limit.
export function setArenaItemLooks(items, keys, look, ...rest) {
  const [modelOf = noModel, limit = ARENA_ITEM_GROUP_LIMIT] = rest;
  if (!look) return setArenaItemLook(items, keys, null, modelOf, null, limit);

  const batches = groupByModel(keys, modelOf);
  let current = items || [];
  for (let at = 0; at < batches.length && current !== null; at += 1) {
    const [model, modelKeys] = batches[at];
    const wish = wishFor(look, model, modelKeys, current);
    if (wish !== undefined) current = setArenaItemLook(current, modelKeys, wish, modelOf, null, limit);
  }
  return current;
}

// Облик модели: сам look или ответ функции look (её третий аргумент — прежняя группа первой вещи).
function wishFor(look, model, modelKeys, current) {
  if (typeof look !== "function") return look;
  return look(model, modelKeys, arenaItemGroupOf(current, modelKeys[0], null));
}

// Сколько групп стало бы после setArenaItemLooks без предела.
export function arenaItemLooksNeeded(items, keys, look, ...rest) {
  return setArenaItemLooks(items, keys, look, rest[0], Infinity).length;
}

export function removeArenaItemPart(items, keys, part, ...rest) {
  const [modelOf] = rest;
  return setArenaItemLook(items, keys, { kind: "removed", part }, modelOf);
}

// ---- группы вещи ----

// Первая группа, где есть вещь и чья часть — та же рамка (null — облик на всю модель).
export function arenaItemGroupOf(items, key, part = null) {
  const wanted = arenaItemPartKey(part);
  const list = items || [];
  const at = list.findIndex((entry) => entry.keys.includes(key) && arenaItemPartKey(entry.part) === wanted);
  return at < 0 ? null : list[at];
}

export function arenaItemPartRemoved(items, key, part) {
  const group = arenaItemGroupOf(items, key, part);
  return group !== null && group.kind === "removed";
}

// Группы частей вещи — в порядке работы.
export function arenaItemPartGroups(items, key) {
  return (items || []).filter(({ part, keys }) => part && keys.includes(key));
}

// Какие копии модели поедут: по копии на группу «на всю модель» и по копии на каждый
// набор групп частей, общий у нескольких вещей. Список обходится парами из entries(): дыра в нём —
// ошибка, у значения без entries() — тоже, у Set в поле group попадает сама группа.
export function arenaItemCopies(items) {
  const list = items || [];
  const whole = [];
  const partsOf = new Map();
  for (const [index, group] of list.entries()) {
    const { part, keys } = group;
    if (!part) {
      whole.push({ keys: Array.from(keys), group: index, parts: [] });
    } else {
      for (const key of keys) {
        if (!partsOf.has(key)) partsOf.set(key, []);
        partsOf.get(key).push(index);
      }
    }
  }

  const sorted = [...partsOf.keys()].sort(ascending);
  const ids = sorted.map((key) => partsOf.get(key).join(","));
  const bySet = [...new Set(ids)].map((id) => ({
    keys: sorted.filter((_, at) => ids[at] === id),
    group: null,
    parts: partsOf.get(sorted[ids.indexOf(id)]),
  }));
  return [...whole, ...bySet];
}

// ---- имена копий ----

// Копия группы: у Majestic своя на каждый зал, у остальных серверов зал в имя не пишется.
export function arenaItemCopyName(server, group, interior = 0) {
  const serial = group + 1;
  if (server !== "majestic") return `astral_arenas_item_rp_${serial}`;
  return `astral_arenas_item_mj_${serial}_${interior}`;
}

// Все имена, какие может записать установщик: по группам, внутри — по залам.
export function arenaItemCopyNames(server, interiors = server === "majestic" ? [1, 2, 3] : [0]) {
  const halls = [...interiors];
  const names = [];
  for (let group = 0; group < ARENA_ITEM_GROUP_LIMIT; group += 1) {
    for (const interior of halls) names.push(arenaItemCopyName(server, group, interior));
  }
  return names;
}

// ---- описи рамок и источников ----

// Поиск идёт по обычным объектам описей: имена из прототипа Object «находятся».
const section = (server, name) => ARENA_ITEM_FRAMES[server]?.[name];
const entryOf = (table, key) => table && table[key];

const FRAME_BOUNDS = [["min", 0, 3], ["max", 3, 6]];
const PLACE_PARTS = [["position", 0, 3], ["rotation", 3, 7]];

const cutRecord = (record, parts) =>
  Object.fromEntries(parts.map(([name, from, to]) => [name, record.slice(from, to)]));

export function arenaItemModelKey(server, key, name) {
  return entryOf(section(server, "variants"), key) || name;
}

export function arenaItemArchetype(server, modelKey) {
  return entryOf(section(server, "archetypes"), modelKey);
}

export function arenaItemSource(server, modelKey) {
  return entryOf(ARENA_ITEM_SOURCES[server], modelKey) || null;
}

export function arenaItemFrame(server, modelName) {
  const record = entryOf(section(server, "models"), modelName);
  return record ? cutRecord(record, FRAME_BOUNDS) : null;
}

export function arenaItemPlace(server, key) {
  const record = entryOf(section(server, "items"), key);
  return record ? { ...cutRecord(record, PLACE_PARTS), scale: [record[7], record[8]] } : null;
}
