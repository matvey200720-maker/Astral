/*
 * Фигуры зон: прямоугольник, круг, звезда, сердечко…
 *
 * Зона на карте — многоугольник, и игра получает её именно им: плитки рисует
 * канва по точкам (`paint.js`). Фигура поэтому не новый вид объекта, а способ
 * получить точки зоны: прямоугольник, растянутый мышью, сердечко пунктиром —
 * всё это та же зона со своим цветом, подписью и подсказкой. Рамка фигуры
 * (`box`) хранится рядом с точками затем, чтобы её можно было растянуть и
 * повернуть без потери формы: точки каждый раз пересчитываются из рамки, и
 * сердечко остаётся сердечком, а не расплывается от правки к правке.
 *
 * Тронул вершину руками — фигура становится своей (`free`): дальше её форма
 * — это её точки, и пересчитывать их из рамки значило бы стереть правку.
 *
 * Координаты фигур заданы в квадрате −0.5…0.5 с осью Y вниз, как на экране:
 * так их удобно рисовать и узнавать. В мире ось Y смотрит вверх (север), и
 * при переносе на карту Y меняет знак — сердечко на карте стоит острием вниз.
 */

/** Сколько точек у кривых фигур: круг и сердечко гладкие на любом приближении. */
const CURVE_STEPS = 72;

const circlePoints = () =>
  Array.from({ length: CURVE_STEPS }, (_, index) => {
    const angle = (index / CURVE_STEPS) * Math.PI * 2;
    return { x: Math.cos(angle) * 0.5, y: Math.sin(angle) * 0.5 };
  });

const regular = (sides, rotation = -Math.PI / 2) =>
  Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return { x: Math.cos(angle) * 0.5, y: Math.sin(angle) * 0.5 };
  });

const starPoints = (rays = 5, inner = 0.42) =>
  Array.from({ length: rays * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / (rays * 2)) * Math.PI * 2;
    const radius = index % 2 ? 0.5 * inner : 0.5;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

/* Скругление прямоугольника — четверти круга в углах, по шесть точек. */
function roundedRect(radius = 0.16) {
  const corners = [
    { cx: 0.5 - radius, cy: -0.5 + radius, from: -Math.PI / 2 },
    { cx: 0.5 - radius, cy: 0.5 - radius, from: 0 },
    { cx: -0.5 + radius, cy: 0.5 - radius, from: Math.PI / 2 },
    { cx: -0.5 + radius, cy: -0.5 + radius, from: Math.PI },
  ];
  const points = [];
  for (const corner of corners)
    for (let step = 0; step <= 6; step += 1) {
      const angle = corner.from + (step / 6) * (Math.PI / 2);
      points.push({
        x: corner.cx + Math.cos(angle) * radius,
        y: corner.cy + Math.sin(angle) * radius,
      });
    }
  return points;
}

/*
 * Сердечко — классическая кривая 16·sin³t, 13·cos t − 5·cos 2t − …,
 * вписанная в квадрат: её размах по X — 32, по Y — около 29.
 */
function heartPoints() {
  const raw = Array.from({ length: CURVE_STEPS }, (_, index) => {
    const t = (index / CURVE_STEPS) * Math.PI * 2;
    return {
      x: 16 * Math.sin(t) ** 3,
      y: -(
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)
      ),
    };
  });
  return fitUnit(raw);
}

/* Вписывает точки в квадрат −0.5…0.5 по большей стороне, по центру. */
function fitUnit(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  return points.map((point) => ({
    x: (point.x - (minX + maxX) / 2) / span,
    y: (point.y - (minY + maxY) / 2) / span,
  }));
}

const UNIT_SHAPES = Object.freeze({
  rect: () => [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ],
  rounded: () => roundedRect(),
  circle: circlePoints,
  triangle: () => [
    { x: 0, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ],
  right: () => [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
  ],
  diamond: () => [
    { x: 0, y: -0.5 },
    { x: 0.5, y: 0 },
    { x: 0, y: 0.5 },
    { x: -0.5, y: 0 },
  ],
  pentagon: () => regular(5),
  hexagon: () => regular(6, 0),
  star: () => starPoints(),
  heart: heartPoints,
  cross: () => {
    const a = 0.17;
    return [
      { x: -a, y: -0.5 },
      { x: a, y: -0.5 },
      { x: a, y: -a },
      { x: 0.5, y: -a },
      { x: 0.5, y: a },
      { x: a, y: a },
      { x: a, y: 0.5 },
      { x: -a, y: 0.5 },
      { x: -a, y: a },
      { x: -0.5, y: a },
      { x: -0.5, y: -a },
      { x: -a, y: -a },
    ];
  },
  arrow: () => [
    { x: -0.5, y: -0.16 },
    { x: 0.08, y: -0.16 },
    { x: 0.08, y: -0.42 },
    { x: 0.5, y: 0 },
    { x: 0.08, y: 0.42 },
    { x: 0.08, y: 0.16 },
    { x: -0.5, y: 0.16 },
  ],
});

/**
 * Фигуры в том порядке, в каком их показывает выбор: сначала простые, потом
 * узнаваемые. `free` — своя фигура, нарисованная пером по точкам.
 */
export const ZONE_SHAPES = Object.freeze([
  Object.freeze({ id: "rect", label: "Прямоугольник" }),
  Object.freeze({ id: "rounded", label: "Скруглённый" }),
  Object.freeze({ id: "circle", label: "Круг" }),
  Object.freeze({ id: "triangle", label: "Треугольник" }),
  Object.freeze({ id: "right", label: "Прямоугольный треугольник" }),
  Object.freeze({ id: "diamond", label: "Ромб" }),
  Object.freeze({ id: "pentagon", label: "Пятиугольник" }),
  Object.freeze({ id: "hexagon", label: "Шестиугольник" }),
  Object.freeze({ id: "star", label: "Звезда" }),
  Object.freeze({ id: "heart", label: "Сердечко" }),
  Object.freeze({ id: "cross", label: "Крест" }),
  Object.freeze({ id: "arrow", label: "Стрелка" }),
]);

export const ZONE_SHAPE_IDS = Object.freeze([
  "free",
  ...ZONE_SHAPES.map((shape) => shape.id),
]);

/*
 * Линия границы. «Контур», «Пунктир», «Точки» и «Заливка» в выборе фигуры —
 * это сочетания линии и заливки: контур — сплошная линия без заливки,
 * заливка — сплошная линия с заливкой.
 */
export const ZONE_LINES = Object.freeze(["solid", "dashed", "dotted"]);

export const ZONE_STYLES = Object.freeze([
  Object.freeze({ id: "outline", label: "Контур", line: "solid", fill: false }),
  Object.freeze({
    id: "dashed",
    label: "Пунктир",
    line: "dashed",
    fill: false,
  }),
  Object.freeze({ id: "dotted", label: "Точки", line: "dotted", fill: false }),
  Object.freeze({ id: "filled", label: "Заливка", line: "solid", fill: true }),
]);

/** Какой стиль выбора соответствует зоне — или `null`, если сочетание своё. */
export function zoneStyleOf(zone) {
  const line = zone?.line || "solid";
  const fill = zone?.fill !== false;
  return (
    ZONE_STYLES.find((style) => style.line === line && style.fill === fill)
      ?.id || null
  );
}

/** Точки фигуры в квадрате −0.5…0.5 (ось Y вниз) — для значков выбора. */
export function unitShapePoints(shape) {
  const make = UNIT_SHAPES[shape];
  return make ? make() : [];
}

/**
 * Точки фигуры на карте.
 *
 * `box` — рамка в мировых единицах: середина `x`, `y`, ширина `w`, высота
 * `h` и поворот `rotation` в градусах по часовой (как у эмблем: на экране
 * ось Y смотрит вниз, поэтому положительный угол крутит по часовой). Точки
 * округлены до единицы мира — та же точность, что у нарисованных пером.
 */
export function shapePoints(shape, box) {
  const unit = unitShapePoints(shape);
  if (!unit.length || !box) return [];
  const angle = ((Number(box.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return unit.map((point) => {
    const dx = point.x * box.w;
    const dy = point.y * box.h;
    /* Поворот в экранной плоскости, затем Y — в мир (вверх). */
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: Math.round(box.x + rx), y: Math.round(box.y - ry) };
  });
}

/**
 * Рамка по двум углам, растянутым мышью. `square` — равные стороны (Shift):
 * круг остаётся кругом, квадрат — квадратом.
 */
export function boxFromCorners(start, end, square = false) {
  let w = Math.abs(end.x - start.x);
  let h = Math.abs(end.y - start.y);
  if (square) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  const signX = end.x >= start.x ? 1 : -1;
  const signY = end.y >= start.y ? 1 : -1;
  return {
    x: Math.round(start.x + (signX * w) / 2),
    y: Math.round(start.y + (signY * h) / 2),
    w: Math.round(w),
    h: Math.round(h),
    rotation: 0,
  };
}

/** Рамка точек в мировых единицах — для своих фигур и старых зон. */
export function boxOfPoints(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2),
    w: Math.round(maxX - minX),
    h: Math.round(maxY - minY),
    rotation: 0,
  };
}

/**
 * Пунктир границы в единицах сцены. Шаг — от толщины линии: тонкая граница
 * с метровым пунктиром читалась бы сплошной, толстая с мелким — рябью. У
 * точек отрезок почти нулевой, а круглый торец делает из него кружок.
 */
export function zoneDash(line, width) {
  const base = Math.max(0.5, Number(width) || 1);
  const step = (value) => Math.round(value * 1000) / 1000;
  if (line === "dashed") return [step(base * 3.4), step(base * 2.4)];
  if (line === "dotted") return [0.001, step(base * 2.2)];
  return null;
}
