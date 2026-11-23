/*
 * Плашка под HP и бронёй (владелец, 21.11.2026: кадр из TikTok — тёмная скруглённая «пилюля», в ней кольцо-шкала с числом, тонкая черта и второе кольцо;
 * без брони плашка короче).
 *
 * Один договор на окно и (позже) фильм игры, как `vital-icons.js`: окно рисует плашку по этим контурам, а сборка `minimap.gfx` возьмёт те же. Здесь только данные и
 * геометрия, разметки нет:
 *
 *   — `normalizeMinimapVitalPlate` — блок `vitalPlate` проекта: вид (`shape`), цвет и прозрачность, общая плашка на оба блока или своя у каждого (`shared`,
 *     `plateHealth`, `plateArmour`) и черта между блоками (`divider`);
 *   — `vitalPlateShape` — контур вида в единичной системе, как у `vitalIconShapes`: центр в нуле, x вправо, y вниз, по контурам заливка по чётности;
 *   — `vitalPlateFit` / `vitalPlateOutline` — какой величины и где встанет плашка вокруг блока (значок и цифры), чтобы блок целиком лежал внутри фигуры;
 *   — `vitalPlateDivider` — отрезок черты между двумя блоками.
 *
 * «Сердце» годится только плашке HP, «щит» — только плашке брони (это те же контуры, что у вида значка `fill`): у общей плашки на оба блока их нет, нормализатор
 * заменяет их на «пилюлю». Без полей в проекте — вида нет, всё как было.
 */

import { VITAL_ICON_SAFE_RECT, vitalIconShapes } from "./vital-icons.js";

/** Виды плашки; «none» — без плашки (умолчание). */
export const MINIMAP_VITAL_PLATE_SHAPES = Object.freeze([
  "none",
  "pill",
  "rect",
  "square",
  "triangle",
  "heart",
  "shield",
]);

/** Виды, которые годятся только одной стороне: сердце — HP, щит — броне. */
export const MINIMAP_VITAL_PLATE_SIDE_ONLY = Object.freeze({
  heart: "health",
  shield: "armour",
});

export const DEFAULT_MINIMAP_VITAL_PLATE = Object.freeze({
  shape: "none",
  colour: "#0b0d10",
  opacity: 0.78,
  shared: true,
  divider: Object.freeze({ enabled: true, colour: "#ffffff", opacity: 0.35 }),
  plateHealth: "none",
  plateArmour: "none",
});

/** Запас вокруг блока — доля меньшей стороны блока. */
export const VITAL_PLATE_PADDING = 0.22;

/** Запас вокруг блока `{ width, height }` в его единицах: с ним плашка встаёт вокруг блока, по нему же окно отмеряет, где идёт черта. */
export const vitalPlatePadding = (content) =>
  VITAL_PLATE_PADDING *
  Math.min(Number(content?.width) || 0, Number(content?.height) || 0);

/** Черта не доходит до краёв: отступ с каждого конца — доля высоты (для горизонтальной — ширины) блока вместе с запасом вокруг него. */
export const VITAL_PLATE_DIVIDER_INSET = 0.18;

/** Толщина черты — доля высоты плашки (в тех же единицах, что блок). */
export const VITAL_PLATE_DIVIDER_WIDTH = 0.045;

/** Точек на четверть дуги пилюли: на полукруг выходит 25. Число точек у пилюли одно на любую пропорцию — окно плавно ведёт контур от одной величины к другой. */
const PILL_ARC_STEPS = 12;

const hex = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value || ""))
    ? String(value).toLowerCase()
    : fallback;

const unitInterval = (value, fallback) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  )
    return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(0, Math.min(1, number)) * 100) / 100;
};

/** Какие виды годятся: `shared` — общей плашке на оба блока, `health` / `armour` — плашке своей стороны. */
export function vitalPlateShapesFor(target) {
  if (target === "health")
    return MINIMAP_VITAL_PLATE_SHAPES.filter(
      (shape) => MINIMAP_VITAL_PLATE_SIDE_ONLY[shape] !== "armour",
    );
  if (target === "armour")
    return MINIMAP_VITAL_PLATE_SHAPES.filter(
      (shape) => MINIMAP_VITAL_PLATE_SIDE_ONLY[shape] !== "health",
    );
  return MINIMAP_VITAL_PLATE_SHAPES.filter(
    (shape) => !MINIMAP_VITAL_PLATE_SIDE_ONLY[shape],
  );
}

/** Вид стороны: чужой стороне вид не годится («сердце» у брони, «щит» у HP) — вместо него «пилюля»; неизвестный вид — «none». */
function sideShape(value, side) {
  const shape = MINIMAP_VITAL_PLATE_SHAPES.includes(value) ? value : "none";
  const only = MINIMAP_VITAL_PLATE_SIDE_ONLY[shape];
  return only && only !== side ? "pill" : shape;
}

export function normalizeMinimapVitalPlate(input) {
  const source = input && typeof input === "object" ? input : {};
  const divider =
    source.divider && typeof source.divider === "object" ? source.divider : {};
  const shared = source.shared !== false;
  const shape = MINIMAP_VITAL_PLATE_SHAPES.includes(source.shape)
    ? source.shape
    : DEFAULT_MINIMAP_VITAL_PLATE.shape;
  return {
    /* Общая плашка на оба блока: «сердце» и «щит» ей не годятся. Когда плашки у каждого блока свои, общий вид не используется и остаётся как записан. */
    shape: shared && MINIMAP_VITAL_PLATE_SIDE_ONLY[shape] ? "pill" : shape,
    colour: hex(source.colour, DEFAULT_MINIMAP_VITAL_PLATE.colour),
    opacity: unitInterval(source.opacity, DEFAULT_MINIMAP_VITAL_PLATE.opacity),
    shared,
    divider: {
      enabled: divider.enabled !== false,
      colour: hex(divider.colour, DEFAULT_MINIMAP_VITAL_PLATE.divider.colour),
      opacity: unitInterval(
        divider.opacity,
        DEFAULT_MINIMAP_VITAL_PLATE.divider.opacity,
      ),
    },
    plateHealth: sideShape(source.plateHealth, "health"),
    plateArmour: sideShape(source.plateArmour, "armour"),
  };
}

/** Вид плашки стороны проекта: у общей — общий, иначе свой у HP или у брони. */
export function vitalPlateShapeOf(plate, side) {
  const value = normalizeMinimapVitalPlate(plate);
  if (value.shared) return value.shape;
  return side === "armour" ? value.plateArmour : value.plateHealth;
}

/** Рисует ли проект хоть какую-то плашку. */
export const vitalPlateActive = (plate) =>
  ["health", "armour"].some(
    (side) => vitalPlateShapeOf(plate, side) !== "none",
  );

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Контуры                                                                                                                                    */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

const round = (value) => Math.round(value * 10000) / 10000;
const copy = (contour) => contour.map(([x, y]) => [x, y]);

/**
 * Пилюля: прямоугольник со скруглёнными краями — многоугольник с четвертями дуг по 12 шагов. Радиус дуги — половина меньшей стороны плашки, поэтому в единичной системе он
 * разный по осям и зависит от пропорции `aspect` (ширина к высоте плашки): после растяжения контура на плашку края получаются круглыми. Четыре угла, по 13 точек, на любую
 * пропорцию (у «круга» стороны вырождаются в точку и точки совпадают — число их не меняется).
 */
function pillContour(aspect) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const rx = ratio >= 1 ? 0.5 / ratio : 0.5;
  const ry = ratio >= 1 ? 0.5 : 0.5 * ratio;
  const corners = [
    [0.5 - rx, -(0.5 - ry), -Math.PI / 2],
    [0.5 - rx, 0.5 - ry, 0],
    [-(0.5 - rx), 0.5 - ry, Math.PI / 2],
    [-(0.5 - rx), -(0.5 - ry), Math.PI],
  ];
  const points = [];
  for (const [cx, cy, from] of corners)
    for (let step = 0; step <= PILL_ARC_STEPS; step += 1) {
      const angle = from + ((Math.PI / 2) * step) / PILL_ARC_STEPS;
      points.push([
        round(cx + rx * Math.cos(angle)),
        round(cy + ry * Math.sin(angle)),
      ]);
    }
  return points;
}

const RECT = Object.freeze([
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]);

/** Треугольник вершиной вверх: вершина в середине верха, основание — весь низ. */
const TRIANGLE = Object.freeze([
  [0, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]);

/* Контуры сердца и щита — те же, что у вида значка `fill`: считаются один раз. */
const OUTLINES = new Map();
function iconOutline(kind) {
  let contour = OUTLINES.get(kind);
  if (!contour) {
    contour = vitalIconShapes("fill", { kind }).track[0];
    OUTLINES.set(kind, contour);
  }
  return contour;
}

/**
 * Контуры вида плашки: список замкнутых ломаных `[x, y]` в единичной системе (центр в нуле, x вправо, y вниз), как `vitalIconShapes(...).track`. `aspect` — ширина к высоте
 * плашки: от неё зависит только пилюля (круглые края). «none» и неизвестный вид — пустой список.
 * @param {string} shape
 * @param {number} [aspect]
 */
export function vitalPlateShape(shape, aspect = 1) {
  if (shape === "pill") return [pillContour(Number(aspect))];
  if (shape === "rect" || shape === "square") return [copy(RECT)];
  if (shape === "triangle") return [copy(TRIANGLE)];
  if (shape === "heart") return [copy(iconOutline("health"))];
  if (shape === "shield") return [copy(iconOutline("armour"))];
  return [];
}

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Величина и место                                                                                                                           */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

/** Равносторонний треугольник: основание к высоте. */
const TRIANGLE_RATIO = 2 / Math.sqrt(3);

/**
 * Прямоугольник внутри контура (в единичной системе), куда ляжет блок: центр и половины сторон. Подобран по контуру значка и проверяется тестом (углы и середины сторон
 * внутри фигуры с запасом); сердце и щит держат свои пропорции, поэтому блок встаёт в этот прямоугольник, а фигура растёт вокруг него равномерно. Прямоугольник общий
 * с числом внутри значка вида `fill` (`VITAL_ICON_SAFE_RECT` в `vital-icons.js`).
 */
const SAFE = VITAL_ICON_SAFE_RECT;

export const VITAL_PLATE_SAFE_RECT = SAFE;

/** Пилюля вокруг блока: длинная сторона получает полукруглые концы, угол блока не выходит за дугу. */
function pillFit(width, height, pad) {
  const horizontal = width >= height;
  const long = horizontal ? width : height;
  const short = horizontal ? height : width;
  const radius = short / 2 + pad;
  const cap = Math.max(
    pad,
    radius - Math.sqrt(Math.max(0, radius * radius - (short / 2) ** 2)),
  );
  const along = long + 2 * cap;
  const across = short + 2 * pad;
  return horizontal
    ? { width: along, height: across, dx: 0, dy: 0 }
    : { width: across, height: along, dx: 0, dy: 0 };
}

/**
 * Какой величины будет плашка вида `shape` вокруг блока `content` (`{ width, height }`, любые единицы — окно считает в точках сцены) и насколько её центр сдвинут от центра
 * блока: `{ width, height, dx, dy }`. Блок целиком лежит внутри фигуры с запасом `VITAL_PLATE_PADDING`. `null` — вида нет или блока нет.
 */
export function vitalPlateFit(shape, content) {
  const width = Number(content?.width);
  const height = Number(content?.height);
  if (!MINIMAP_VITAL_PLATE_SHAPES.includes(shape) || shape === "none")
    return null;
  if (!(width > 0) || !(height > 0)) return null;
  const pad = vitalPlatePadding(content);
  const padded = { width: width + 2 * pad, height: height + 2 * pad };
  if (shape === "pill") return pillFit(width, height, pad);
  if (shape === "rect") return { ...padded, dx: 0, dy: 0 };
  if (shape === "square") {
    const side = Math.max(padded.width, padded.height);
    return { width: side, height: side, dx: 0, dy: 0 };
  }
  if (shape === "triangle") {
    /* Блок стоит на основании: наверху он ровно ложится в ширину треугольника на своей высоте. */
    const tall = padded.height + padded.width / TRIANGLE_RATIO;
    return {
      width: tall * TRIANGLE_RATIO,
      height: tall,
      dx: 0,
      dy: -(tall - padded.height) / 2,
    };
  }
  const safe = SAFE[shape];
  const scale = Math.max(
    padded.width / (2 * safe.hw),
    padded.height / (2 * safe.hh),
  );
  return {
    width: scale,
    height: scale,
    dx: -safe.cx * scale,
    dy: -safe.cy * scale,
  };
}

/**
 * Плашка вокруг блока: коробка и контуры в тех же единицах, что блок. `content` — `{ x, y, width, height }`, x и y — центр блока.
 * Возвращает `{ box: { x, y, width, height }, contours }` (x и y — центр плашки) или `null`.
 */
export function vitalPlateOutline(shape, content) {
  const fit = vitalPlateFit(shape, content);
  if (!fit) return null;
  const box = {
    x: Number(content.x) + fit.dx,
    y: Number(content.y) + fit.dy,
    width: fit.width,
    height: fit.height,
  };
  const contours = vitalPlateShape(shape, box.width / box.height).map(
    (contour) =>
      contour.map(([ux, uy]) => [
        round(box.x + ux * box.width),
        round(box.y + uy * box.height),
      ]),
  );
  return { box, contours };
}

/**
 * Черта между двумя блоками. Блоки — коробки `{ left, top, right, bottom }`; `span` — коробка обоих блоков вместе с запасом вокруг них (`vitalPlatePadding`): по ней идёт черта,
 * а не по плашке — у треугольника, сердца и щита плашка выше блоков, и черта вылезала бы в пустоту. Блоки стоят рядом — черта вертикальная, на середине щели между ними; стоят
 * один над другим — горизонтальная. Концы отступают от краёв `span` на `VITAL_PLATE_DIVIDER_INSET`.
 * @returns {{ vertical: boolean, x1: number, y1: number, x2: number, y2: number }}
 */
export function vitalPlateDivider(first, second, span) {
  const centreX = (box) => (box.left + box.right) / 2;
  const centreY = (box) => (box.top + box.bottom) / 2;
  const vertical =
    Math.abs(centreX(first) - centreX(second)) >=
    Math.abs(centreY(first) - centreY(second));
  if (vertical) {
    const [near, far] =
      centreX(first) <= centreX(second) ? [first, second] : [second, first];
    const x = round((near.right + far.left) / 2);
    const inset = (span.bottom - span.top) * VITAL_PLATE_DIVIDER_INSET;
    return {
      vertical,
      x1: x,
      y1: round(span.top + inset),
      x2: x,
      y2: round(span.bottom - inset),
    };
  }
  const [near, far] =
    centreY(first) <= centreY(second) ? [first, second] : [second, first];
  const y = round((near.bottom + far.top) / 2);
  const inset = (span.right - span.left) * VITAL_PLATE_DIVIDER_INSET;
  return {
    vertical,
    x1: round(span.left + inset),
    y1: y,
    x2: round(span.right - inset),
    y2: y,
  };
}
