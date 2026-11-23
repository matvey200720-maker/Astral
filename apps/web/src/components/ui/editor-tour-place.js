export const GAP = 14;
export const MARGIN = 12;

const INSET = 16;
const ARROW_EDGE = 18;

// Откуда считается и на сколько тянется карточка по каждой оси.
const SPAN = { x: ["left", "width"], y: ["top", "height"] };

/** Зажим в [low, high]; если high меньше low (карточка больше окна), остаётся low. */
const between = (low, value, high) => Math.max(low, Math.min(value, high));
const keepInView = (value, high) => between(MARGIN, value, high);
const roomFor = (view, card, extent) => view[extent] - MARGIN - card[extent];

// Карточка по центру цели вдоль оси, но не выходя за окно.
function centeredOn(axis, target, card, view) {
  const [start, extent] = SPAN[axis];
  return keepInView(target[start] + target[extent] / 2 - card[extent] / 2, roomFor(view, card, extent));
}

// Внутрь цели, в левый нижний угол.
const cornerSpot = (target, card, view) => ({
  side: "inside",
  x: keepInView(target.left + INSET, roomFor(view, card, "width")),
  y: keepInView(target.bottom - card.height - INSET, roomFor(view, card, "height")),
});

// Карточка за гранью цели (справа или снизу) и перед гранью (слева или сверху).
const after = (side, mainAxis, edge, extent) => ({
  side,
  mainAxis,
  spot: (t) => t[edge] + GAP,
  fits: (t, c, v) => t[edge] + GAP + c[extent] <= v[extent] - MARGIN,
});
const before = (side, mainAxis, edge, extent) => ({
  side,
  mainAxis,
  spot: (t, c) => t[edge] - GAP - c[extent],
  fits: (t, c) => t[edge] - GAP - c[extent] >= MARGIN,
});

// Стороны в порядке проб.
const SIDES = [
  after("right", "x", "right", "width"),
  before("left", "x", "left", "width"),
  after("bottom", "y", "bottom", "height"),
  before("top", "y", "top", "height"),
];

// Нужная сторона идёт первой, остальные — в прежнем порядке.
const probeOrder = (preferred) => [
  ...SIDES.filter((entry) => entry.side === preferred),
  ...SIDES.filter((entry) => entry.side !== preferred),
];

function settle(entry, target, card, view) {
  const along = (axis) =>
    axis === entry.mainAxis ? entry.spot(target, card) : centeredOn(axis, target, card, view);
  return { side: entry.side, x: along("x"), y: along("y") };
}

/** Где встать карточке: первая подошедшая сторона, иначе внутрь цели, в левый нижний угол. */
export function placeCard(target, card, view, preferred = "") {
  const inside = cornerSpot(target, card, view);
  if (preferred === "inside") {
    return inside;
  }

  const chosen = probeOrder(preferred).find((entry) => entry.fits(target, card, view));
  return chosen ? settle(chosen, target, card, view) : inside;
}

// Вдоль какой оси карточки смещается стрелка для каждой стороны.
const ARROW_AXES = new Map([
  ["right", "y"],
  ["left", "y"],
  ["top", "x"],
  ["bottom", "x"],
]);

/** Смещение стрелки вдоль грани карточки, чтобы она указывала на середину цели. */
export function arrowOffset(side, target, card, position) {
  const axis = ARROW_AXES.get(side);
  if (!axis) return 0;
  const [start, extent] = SPAN[axis];
  return between(ARROW_EDGE, target[start] + target[extent] / 2 - position[axis], card[extent] - ARROW_EDGE);
}
