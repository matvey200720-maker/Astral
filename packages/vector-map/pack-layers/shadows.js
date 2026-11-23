import { boxGrid } from "./parts.js";

const GRID_CELL = 30;
const MIN_SHIFT = 0.05;
const MIN_PAIRS = 3;
const AXES = [0, 1];

const ascending = (a, b) => a - b;
const longerFirst = (a, b) => b.length - a.length;

const median = (values) => values.slice().sort(ascending).at(Math.floor(values.length / 2));
const centreOf = (part) => [part.cx, part.cy];
const offset = (to, from) => AXES.map((axis) => to[axis] - from[axis]);
const lengthOf = (vector) => Math.hypot(...vector);
const reachOf = ({ long }) => Math.max(0.35 * long, 1.5);

// Признак → допустимое расхождение «своё / чужое». Порядок строк — порядок проверок.
const SIMILARITY = [
  [(part) => part.groupIndex, (own, other) => other !== own],
  [(part) => part.group.height, (own, other) => Math.abs(other - own) <= 1.01],
  [(part) => part.tris.length, (own, other) => other === own],
  [(part) => part.area, (own, other) => Math.abs(other - own) <= 0.04 * Math.max(own, 0.5)],
  [(part) => part.long, (own, other) => Math.abs(other - own) <= 0.05 * own + 0.3],
];

const alike = (part, copy) => SIMILARITY.every(([read, close]) => close(read(part), read(copy)));

const neighbours = (grid, part, reach) => {
  const found = [];
  grid.near(part, reach, found.push.bind(found));
  return found;
};

/** Пары «оригинал → копия» в порядке обхода кусков и клеток сетки. */
const findPairs = (parts, grid) =>
  Array.from({ length: parts.length }, (_, index) => {
    const part = parts[index];
    const reach = reachOf(part);
    return neighbours(grid, part, reach)
      .filter((other) => other !== index)
      .map((other) => parts[other])
      .filter((copy) => alike(part, copy))
      .map((copy) => ({ part, copy, shift: offset(centreOf(copy), centreOf(part)) }))
      .filter(({ shift }) => lengthOf(shift) <= reach && lengthOf(shift) >= MIN_SHIFT);
  }).flat();

/** Списки пар по ключу «группа оригинала>группа копии», самые длинные первыми. */
const listsOf = (pairs) => {
  const byKey = pairs.reduce((lists, pair) => {
    const key = `${pair.part.groupIndex}>${pair.copy.groupIndex}`;
    const bucket = lists.get(key) ?? [];
    bucket.push(pair);
    return lists.set(key, bucket);
  }, new Map());
  return Array.from(byKey.values()).sort(longerFirst);
};

const tally = (items, keyOf) => items.reduce((counts, item) => counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1), new Map());

// Выше тот, у кого больше высота; при равной высоте — у кого больше номер группы (рисуется позже).
const outranks = ([height, order], [otherHeight, otherOrder]) => height > otherHeight || (height === otherHeight && order > otherOrder);

/** Оригинал выше копии, а пар хватает по сравнению с меньшей из групп. */
const leads = (pairs, sizes) => {
  const [{ part, copy }] = pairs;
  const [upper, lower] = [part, copy].map((item) => [item.group.height, item.groupIndex]);
  const smaller = Math.min(...[part, copy].map((item) => sizes.get(item.groupIndex)));
  const floors = [MIN_PAIRS, 0.5 * smaller];
  return outranks(upper, lower) && !floors.some((floor) => pairs.length < floor);
};

/** Общий сдвиг списка (медиана по осям) и «ровные» пары; null, если ровных меньше 70 %. */
const steadyOf = (pairs) => {
  const shift = AXES.map((axis) => median(pairs.map((pair) => pair.shift[axis])));
  const limit = 0.15 * lengthOf(shift) + 0.1;
  const steady = pairs.filter((pair) => lengthOf(offset(pair.shift, shift)) <= limit);
  return steady.length < 0.7 * pairs.length ? null : { shift, steady };
};

const attach = ({ shift: [dx, dy], steady }, { color, alpha }, removed) =>
  steady.forEach(({ part, copy }) => {
    if (removed.has(copy) || part.shadow) return;
    Object.assign(part, { shadow: { color, alpha, dx, dy, part: copy } });
    removed.add(copy);
  });

/**
 * Находит куски-тени (те же буквы чуть ниже и в стороне), записывает тень в поле shadow
 * оригинала и убирает тени из списка.
 */
export const pairShadows = (parts) => {
  const grid = boxGrid(parts, GRID_CELL);
  const lists = listsOf(findPairs(parts, grid));
  const sizes = tally(parts, (part) => part.groupIndex);
  const removed = new Set();
  lists
    .filter((pairs) => leads(pairs, sizes))
    .map((pairs) => [steadyOf(pairs), pairs[0].copy.group])
    .filter(([found]) => found)
    .forEach(([found, shade]) => attach(found, shade, removed));
  const survivors = parts.filter((part) => !removed.has(part));
  return { parts: survivors, shadows: removed.size };
};
