/*
 * Фигуры, из которых собирается прицел.
 *
 * Фигура — массив замкнутых контуров, контур — массив точек `[x, y]` в
 * точках сцены `hud_reticle.gfx` (ось Y вниз, центр прицела — 0,0). Внешний
 * контур обходится по часовой стрелке на экране, дыра — против: так правило
 * `nonzero` в SVG закрашивает ровно объединение фигур, и превью совпадает с
 * тем, что `regionContours` отдаёт игре.
 *
 * Здесь нет ничего про прицел — только примитивы и их обводка. Обводка
 * фигуры — та же фигура, раздутая на ширину: прямоугольник шире, круг
 * больше, дуга толще и длиннее на столько же с каждого конца.
 */

const TAU = Math.PI * 2;
const RADIANS = Math.PI / 180;

/** Подписанная площадь контура: по часовой на экране — положительная. */
export function signedArea(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const [x0, y0] = loop[index];
    const [x1, y1] = loop[(index + 1) % loop.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

/** Контур в нужном обходе: `clockwise` — внешний, иначе дыра. */
export function oriented(loop, clockwise = true) {
  const area = signedArea(loop);
  return area >= 0 === clockwise ? loop : [...loop].reverse();
}

/*
 * Сколько сторон у дуги. Хорда не отходит от окружности дальше двадцатой
 * доли точки — сетки SWF: мельче игра всё равно не нарисует, а крупнее
 * круг на экране 1440p уже читается многоугольником.
 */
export function arcSteps(radius, span) {
  const r = Math.max(0.1, radius);
  const step = 2 * Math.acos(Math.max(-1, 1 - 0.05 / r));
  return Math.max(3, Math.min(128, Math.ceil(Math.abs(span) / step)));
}

export function rectangle(x0, y0, x1, y1) {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return [
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
  ];
}

/** Прямоугольник, раздутый на `amount` со всех сторон. */
export const inflatedRectangle = (x0, y0, x1, y1, amount = 0) =>
  rectangle(
    Math.min(x0, x1) - amount,
    Math.min(y0, y1) - amount,
    Math.max(x0, x1) + amount,
    Math.max(y0, y1) + amount,
  );

function circlePoints(cx, cy, radius) {
  const steps = Math.max(12, arcSteps(radius, TAU));
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * TAU;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

export function disc(cx, cy, radius) {
  return radius > 0 ? [circlePoints(cx, cy, radius)] : [];
}

/** Кольцо целиком: внешний круг и дыра. */
export function annulus(cx, cy, inner, outer) {
  if (outer <= 0) return [];
  if (inner <= 0) return disc(cx, cy, outer);
  return [
    circlePoints(cx, cy, outer),
    [...circlePoints(cx, cy, inner)].reverse(),
  ];
}

/**
 * Часть кольца от угла `from` до `to` (градусы, 0 — вправо, 90 — вниз).
 * Внешняя дуга идёт по ходу угла — по часовой на экране, внутренняя обратно.
 */
export function arcBand(cx, cy, inner, outer, from, to) {
  const start = from * RADIANS;
  const span = (to - from) * RADIANS;
  if (outer <= 0 || span <= 0) return [];
  const outerSteps = arcSteps(outer, span);
  const outerArc = Array.from({ length: outerSteps + 1 }, (_, index) => {
    const angle = start + (span * index) / outerSteps;
    return [cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer];
  });
  if (inner <= 0) return [[...outerArc, [cx, cy]]];
  const innerSteps = arcSteps(inner, span);
  const innerArc = Array.from({ length: innerSteps + 1 }, (_, index) => {
    const angle = start + span - (span * index) / innerSteps;
    return [cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner];
  });
  return [[...outerArc, ...innerArc]];
}

/** Многоугольник по точкам — одним внешним контуром. */
export const polygon = (points) =>
  points.length >= 3 ? [oriented(points, true)] : [];

/**
 * Отрезок толщиной `2 × half`: прямоугольник вдоль отрезка. `extend`
 * продлевает его за оба конца — так обводка закрывает торцы линии.
 */
export function segment([x0, y0], [x1, y1], half, extend = 0) {
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length <= 0 || half <= 0) return [];
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  const nx = -uy * half;
  const ny = ux * half;
  const ax = x0 - ux * extend;
  const ay = y0 - uy * extend;
  const bx = x1 + ux * extend;
  const by = y1 + uy * extend;
  return polygon([
    [ax + nx, ay + ny],
    [bx + nx, by + ny],
    [bx - nx, by - ny],
    [ax - nx, ay - ny],
  ]);
}

/**
 * Галочка «^» толщиной `2 × half`: вершина в `apex`, концы — `left` и
 * `right`. Две руки — отрезками, угол — клином со срезом; острый угол не
 * вытягивается иглой дальше `miterLimit` половин толщины. Возвращает список
 * фигур (руки и клин пересекаются — их объединяет заливка).
 */
export function chevronStroke(
  apex,
  left,
  right,
  half,
  extend = 0,
  miterLimit = 2.6,
) {
  if (half <= 0) return [];
  /* Руки продлеваются только наружу: у вершины их соединяет клин. */
  const arms = [
    segmentFrom(apex, left, half, extend),
    segmentFrom(apex, right, half, extend),
  ].filter((shape) => shape.length);
  const outward = (point) => {
    const length = Math.hypot(point[0] - apex[0], point[1] - apex[1]) || 1;
    return [(point[0] - apex[0]) / length, (point[1] - apex[1]) / length];
  };
  const [lx, ly] = outward(left);
  const [rx, ry] = outward(right);
  /* Внешняя сторона угла — против биссектрисы. */
  const bx = lx + rx;
  const by = ly + ry;
  const bisector = Math.hypot(bx, by) || 1;
  const ox = -bx / bisector;
  const oy = -by / bisector;
  const sideOf = (ux, uy) => {
    const nx = -uy;
    const ny = ux;
    return nx * ox + ny * oy >= 0 ? [nx, ny] : [-nx, -ny];
  };
  const [lnx, lny] = sideOf(lx, ly);
  const [rnx, rny] = sideOf(rx, ry);
  const leftCorner = [apex[0] + lnx * half, apex[1] + lny * half];
  const rightCorner = [apex[0] + rnx * half, apex[1] + rny * half];
  const cosine = lx * rx + ly * ry;
  const miter = half / Math.max(1e-6, Math.sqrt((1 - cosine) / 2));
  const wedge =
    miter <= half * miterLimit
      ? [
          leftCorner,
          [apex[0] + ox * miter, apex[1] + oy * miter],
          rightCorner,
          apex,
        ]
      : [leftCorner, rightCorner, apex];
  return [...arms, polygon(wedge)].filter((shape) => shape.length);
}

/* Отрезок от вершины наружу, продлённый только за дальний конец. */
function segmentFrom([x0, y0], [x1, y1], half, extend) {
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length <= 0) return [];
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  return segment([x0, y0], [x1 + ux * extend, y1 + uy * extend], half, 0);
}

/** Поворот (градусы, по часовой на экране) и масштаб вокруг центра. */
export function transformShape(shape, { scale = 1, rotation = 0 } = {}) {
  const angle = rotation * RADIANS;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  return shape.map((loop) =>
    loop.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]),
  );
}

/*
 * Фигура на сетке SWF — двадцатых долях точки. Превью и компилятор берут
 * одни и те же округлённые точки: иначе совпадение с игрой держалось бы на
 * том, что округление «не видно».
 */
export const snapShape = (shape, scale = 20) =>
  shape.map((loop) =>
    loop.map(([x, y]) => [
      Math.round(x * scale) / scale,
      Math.round(y * scale) / scale,
    ]),
  );

/** Рамка всех точек фигур: `{x, y, width, height}` или `null`. */
export function shapesBounds(shapes) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const shape of shapes)
    for (const loop of shape)
      for (const [x, y] of loop) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  return Number.isFinite(left)
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

const format = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/** Фигуры одним путём SVG: `nonzero` закрашивает их объединение. */
export function shapesPath(shapes) {
  let path = "";
  for (const shape of shapes)
    for (const loop of shape) {
      if (loop.length < 3) continue;
      path += `M${format(loop[0][0])} ${format(loop[0][1])}`;
      for (let index = 1; index < loop.length; index += 1)
        path += `L${format(loop[index][0])} ${format(loop[index][1])}`;
      path += "Z";
    }
  return path;
}
