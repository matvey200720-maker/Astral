import { workshopFallbackMediaBySlot } from "../../../workshop-visuals.js";
import { paintAreaMap } from "../../workshop/vegetation-editor/AreaMap.jsx";
import { paintWorkshopMatte } from "@modovik/gfx/workshop-matte";
import { VEGETATION_WORLD } from "@modovik/climb-contract/recolor/vegetation";
import {
  DEFAULT_ATLAS,
  MAP_COVER,
  WORLD_DISTRICTS,
  atlasSize,
  mapCoverRect as coverRectOfMap,
  normalizeAtlas,
  worldToMap,
} from "@modovik/vector-map";

const FULL_TURN = Math.PI * 2;
const PLACE_COLOR = "#ffd166";

// Запас вокруг суши, доля «места по всему острову», поля и наименьшая сторона кадра;
// выбросы по краям режутся, если мест хотя бы trimFromCount.
const LIMITS = {
  landSlack: 500,
  wholeIsland: 0.6,
  framePad: 0.3,
  shortestSide: 1500,
  trimFromCount: 20,
  trimShare: 0.02,
};

// Врезка «где это на острове»: доли высоты кадра, ширина — доля высоты врезки.
const LOCATOR = { box: 0.3, aspect: 0.75, pad: 0.03, corner: 16 };

// Рамка суши по зонам игры: считается один раз при загрузке.
const LAND = (() => {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const everyPoint = Object.values(WORLD_DISTRICTS).flatMap((zone) => zone.points ?? []);
  for (const { x, y } of everyPoint) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
})();

/* ---------- кадр по местам ---------- */

// Нечисла и бесконечности отпадают сами: сравнения с ними ложны.
const withinReach = (value, low, high) =>
  value >= low - LIMITS.landSlack && value <= high + LIMITS.landSlack;

// Места и огни одним списком: пары [x, y] в числах, только внутри суши с запасом.
const reachableSpots = (places) =>
  [places?.objects, places?.lights].flatMap((list) =>
    [...(list ?? [])].flatMap(([x, y]) => {
      const spot = [Number(x), Number(y)];
      const inside =
        withinReach(spot[0], LAND.minX, LAND.maxX) && withinReach(spot[1], LAND.minY, LAND.maxY);
      return inside ? [spot] : [];
    }),
  );

function quantile(sorted, share) {
  const last = sorted.length - 1;
  const index = Math.round(share * last);
  return sorted[index < 0 ? 0 : Math.min(index, last)];
}

// Наименьшее и наибольшее значения после обрезки выбросов.
const trimmedRange = (values, trim) => {
  const ordered = Float64Array.from(values).sort();
  return [quantile(ordered, trim), quantile(ordered, 1 - trim)];
};

// Сдвиг отрезка внутрь [origin, origin + span]; больший отрезок встаёт по центру.
function tuckInside(start, length, origin, span) {
  if (length >= span) return origin + (span - length) / 2;
  return Math.min(Math.max(start, origin), origin + span - length);
}

function frameAround(spots, size, atlas) {
  if (spots.length === 0) return null;

  const trim = spots.length >= LIMITS.trimFromCount ? LIMITS.trimShare : 0;
  const [[minX, maxX], [minY, maxY]] = [0, 1].map((axis) =>
    trimmedRange(
      spots.map((spot) => spot[axis]),
      trim,
    ),
  );
  const spreadX = maxX - minX;
  const spreadY = maxY - minY;
  const islandX = LAND.maxX - LAND.minX;
  const islandY = LAND.maxY - LAND.minY;
  if (spreadX > LIMITS.wholeIsland * islandX || spreadY > LIMITS.wholeIsland * islandY) return null;

  const aspect = size.width / size.height;
  const margin = 1 + 2 * LIMITS.framePad;
  const width = Math.max(spreadX * margin, spreadY * margin * aspect, LIMITS.shortestSide * Math.max(1, aspect));
  const height = width / aspect;

  const grid = normalizeAtlas(atlas);
  const { height: gridHeight, width: gridWidth } = atlasSize(grid);
  const left = tuckInside((minX + maxX) / 2 - width / 2, width, grid.originX, gridWidth);
  const bottom = tuckInside((minY + maxY) / 2 - height / 2, height, grid.originY - gridHeight, gridHeight);
  return { height, left, top: bottom + height, width };
}

export function placesFrame(places, size = MAP_COVER, atlas = DEFAULT_ATLAS) {
  return frameAround(reachableSpots(places), size, atlas);
}

/* ---------- холсты и шаги рисования ---------- */

const blankCanvas = (width, height) =>
  Object.assign(document.createElement("canvas"), { width, height });

function mattedCanvas({ width, height }) {
  const canvas = blankCanvas(width, height);
  const painted = canvas.getContext("2d");
  paintWorkshopMatte(painted, width, height);
  return [canvas, painted];
}

// Шаг — [метод, ...аргументы] или ["=свойство", значение]; порядок шагов — порядок вызовов.
function play(context, steps) {
  for (const [name, ...args] of steps) {
    if (name.startsWith("=")) context[name.slice(1)] = args[0];
    else context[name](...args);
  }
}

// Карта мира; не загрузилась — вернётся null, и обложка идёт без неё.
function loadWorldMap() {
  const picture = new Image();
  return new Promise((resolve, reject) => {
    Object.assign(picture, {
      onload: () => resolve(picture),
      onerror: () => reject(new Error("Карта мира не загрузилась.")),
    });
    picture.src = workshopFallbackMediaBySlot["large-map"][0];
  }).catch(() => null);
}

const disc = ([x, y], radius) => [
  ["beginPath"],
  ["arc", x, y, radius, 0, FULL_TURN],
];

// Позиция точки мира на холсте: карта лежит в прямоугольнике view.
function canvasPoint(view, x, y) {
  const { u, v } = worldToMap({ x, y });
  return [view.left + u * view.width, view.top + v * view.height];
}

/* ---------- две манеры рисования: приближенный кадр и весь остров ---------- */

const LOOKS = {
  framed: {
    halo: true,
    mapAlpha: 0.5,
    lightAlpha: 0.5,
    glow: ({ width }) => Math.max(3, width / 300),
    // До 12 мест точка полного размера, дальше мельче; огни в счёт не идут.
    radius: ({ width }, view, count) => {
      const crowd = Math.min(1, 12 / Math.max(1, count));
      return Math.max(width / 240, (width / 60) * Math.sqrt(crowd));
    },
    outline: (radius) => Math.max(1.5, radius / 4),
  },
  island: {
    halo: false,
    mapAlpha: 0.75,
    lightAlpha: 0.35,
    glow: (size, view) => Math.max(1, view.width / 420),
    radius: (size, view) => Math.max(2, (view.width / 1000) * 9),
    outline: () => 0,
  },
};

// Где на холсте лежит вся карта мира, если смотреть в кадр.
function viewOfFrame(frame, size, dims) {
  const scale = size.width / (frame.width / dims.width);
  const ratio = dims.height / dims.width;
  const { u, v } = worldToMap({ x: frame.left, y: frame.top });
  return { left: -u * scale, top: -v * scale * ratio, width: scale, height: scale * ratio };
}

function viewpoint(places, size) {
  const dims = atlasSize(DEFAULT_ATLAS);
  const island = coverRectOfMap(dims.width, dims.height, size.width, size.height);
  const frame = placesFrame(places, size);
  if (!frame) return { dims, frame, look: LOOKS.island, view: island };
  return { dims, frame, look: LOOKS.framed, view: viewOfFrame(frame, size, dims) };
}

const backdropSteps = (picture, view, alpha) => [
  ["=globalAlpha", alpha],
  ["=imageSmoothingQuality", "high"],
  ["drawImage", picture, view.left, view.top, view.width, view.height],
  ["=globalAlpha", 1],
];

// Дальше рисуется только в пределах карты: за атласом лежат служебные места.
const clipSteps = ({ left, top, width, height }) => [
  ["save"],
  ["beginPath"],
  ["rect", left, top, width, height],
  ["clip"],
];

function lightSteps(lights, spotOn, look, glow) {
  return lights.flatMap(([x, y, r, g, b]) => {
    const [px, py] = spotOn(x, y);
    return [
      ["=fillStyle", `rgba(${r}, ${g}, ${b}, ${look.lightAlpha})`],
      ["fillRect", px - glow / 2, py - glow / 2, glow, glow],
    ];
  });
}

function placeSteps(objects, spotOn, look, radius) {
  const spots = [...objects].map(([x, y]) => spotOn(x, y));
  const halo = look.halo
    ? [
        ["=fillStyle", "rgba(255, 209, 102, 0.22)"],
        ...spots.flatMap((at) => [...disc(at, radius * 2), ["fill"]]),
      ]
    : [];
  const strokeStep = look.halo ? [["stroke"]] : [];
  return [
    ...halo,
    ["=fillStyle", PLACE_COLOR],
    ["=strokeStyle", "rgba(0, 0, 0, 0.6)"],
    ["=lineWidth", look.outline(radius)],
    ["=globalAlpha", 0.95],
    ...spots.flatMap((at) => [...disc(at, radius), ...strokeStep, ["fill"]]),
    ["=globalAlpha", 1],
  ];
}

// Геометрия врезки в левом нижнем углу кадра.
function locatorBox(size) {
  const { box, aspect, pad, corner } = LOCATOR;
  const boxH = Math.round(size.height * box);
  const gap = Math.round(size.height * pad);
  return {
    left: gap,
    top: size.height - boxH - gap,
    boxW: Math.round(boxH * aspect),
    boxH,
    corner: Math.round(boxH / corner),
  };
}

// Подписи района на врезке нет: она была бы словом одного языка в картинке.
function locatorSteps(hasRoundRect, picture, frame, size, dims) {
  const { left, top, boxW, boxH, corner } = locatorBox(size);
  const backing = hasRoundRect
    ? ["roundRect", left, top, boxW, boxH, corner]
    : ["rect", left, top, boxW, boxH];
  const fit = coverRectOfMap(dims.width, dims.height, boxW, boxH);
  const island = [left + fit.left, top + fit.top, fit.width, fit.height];
  const [islandLeft, islandTop, islandW, islandH] = island;
  const origin = worldToMap({ x: frame.left, y: frame.top });
  return [
    ["save"],
    ["=fillStyle", "rgba(10, 10, 12, 0.82)"],
    ["beginPath"],
    backing,
    ["fill"],
    ["=globalAlpha", 0.85],
    ["drawImage", picture, ...island],
    ["=globalAlpha", 1],
    ["=strokeStyle", PLACE_COLOR],
    ["=lineWidth", Math.max(2, size.height / 300)],
    [
      "strokeRect",
      islandLeft + origin.u * islandW,
      islandTop + origin.v * islandH,
      Math.max(4, (frame.width / dims.width) * islandW),
      Math.max(3, (frame.height / dims.height) * islandH),
    ],
    ["restore"],
  ];
}

/* ---------- обложки ---------- */

export async function placesCoverCanvas(places, size = MAP_COVER) {
  const [canvas, context] = mattedCanvas(size);
  const { dims, frame, look, view } = viewpoint(places, size);

  const worldMap = await loadWorldMap();
  if (worldMap) play(context, backdropSteps(worldMap, view, look.mapAlpha));
  play(context, clipSteps(view));

  const spotOn = (x, y) => canvasPoint(view, x, y);
  const lights = [...(places.lights ?? [])];
  const glow = look.glow(size, view);
  play(context, [
    ["=globalCompositeOperation", "lighter"],
    ...lightSteps(lights, spotOn, look, glow),
    ["=globalCompositeOperation", "source-over"],
  ]);

  const objects = [...(places.objects ?? [])];
  const radius = look.radius(size, view, objects.length);
  play(context, [...placeSteps(objects, spotOn, look, radius), ["restore"]]);

  if (frame && worldMap) {
    const rounded = typeof context.roundRect === "function";
    play(context, locatorSteps(rounded, worldMap, frame, size, dims));
  }
  return canvas;
}

// Один шаг: временный холст с картой районов ложится в кадр обложки.
function regionStamp(grid, size, areas) {
  const fit = coverRectOfMap(grid.cols, grid.rows, size.width, size.height);
  const layer = blankCanvas(fit.width, fit.height);
  paintAreaMap(layer, new Set(areas));
  return ["drawImage", layer, fit.left, fit.top];
}

export function grassCoverCanvas({ areas = [] } = {}, size = MAP_COVER) {
  const [canvas, context] = mattedCanvas(size);
  const { grid } = VEGETATION_WORLD;
  if (grid) play(context, [regionStamp(grid, size, areas)]);
  return canvas;
}
