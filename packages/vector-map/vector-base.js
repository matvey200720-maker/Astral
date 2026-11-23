import { hexToRgb, rgbToHex } from "./color.js";
import { paintPackGeometry } from "./pack-geometry.js";
import { paintTerrain, terrainStyle } from "./terrain.js";
import { fullPath, viewWindow, visiblePath } from "./triangle-window.js";
import ZONE_CELLS from "./zone-cells.json" with { type: "json" };

const DEFAULTS = { land: "#14171b", roads: "#3d444e", water: "#0a1018", sea: "#000206" };

// Запас окна отсечения на размытие, свечение и обводку: точки канвы плюс метры мира.
const VIEW_MARGIN_PIXELS = 220;
const VIEW_MARGIN_METERS = 20;
const WATER_BLUR_MAX = 48;
const BIOMES_BLUR_MAX = 160;
const BIOMES_BLUR_FACTOR = 380;
const GLOW_BLUR_MAX = 90;
const GLOW_BLUR_FACTOR = 160;
const OUTLINE_WIDTH_FACTOR = 6;
const VEGETATION_EDGE_MIN = 0.012;
const VEGETATION_EDGE_MAX = 0.06;
const VEGETATION_THRESHOLD = 0.52;
const VEGETATION_MAX_GRID = 1536;

const BIOME_CODES = {
  desert: ["Desrt", "Sandy", "Harmo", "Slab", "RTRAK", "zQ_UAR", "Jail", "WindF", "LDam", "Alamo"],
  dry: ["Greatc", "TongvaH", "TongvaV", "BhamCa", "Tatamo", "MTJose", "CHIL", "Baytre", "BradP", "Noose", "Galfish", "ArmyB", "Galli", "Observ", "PBluff"],
  forest: ["MTChil", "PalFor", "CANNY", "CCreak", "MTGordo", "NCHU", "CHU", "PalCov", "Paleto", "ProcoB", "Zancudo", "LAGO", "GrapeS"],
};

// Слой подложки, в котором живёт роль (глаз слоя прячет все его роли сразу).
const LAYER_BY_ROLE = { blocks: "buildings", paths: "roads", freeway: "roads", roads: "roads", rail: "roads" };

// Порядок отрисовки биомов: от сухих холмов к пустыне.
const BIOME_ORDER = ["dry", "forest", "desert"];

const cellsOfCodes = (codes) => codes.flatMap((code) => ZONE_CELLS[code] ?? []);

export const BIOME_CELLS = Object.freeze(
  Object.keys(BIOME_CODES).reduce((table, biome) => ({ ...table, [biome]: cellsOfCodes(BIOME_CODES[biome]) }), {}),
);

/* ---------- Проигрыватель рисования ---------- */

// Отложенный аргумент: считается в момент вызова метода, после всех предыдущих записей канвы
// (так путь строится, а отсутствующая фабрика путей срабатывает в том же месте рисования, что и раньше).
class Late {
  constructor(make) {
    this.make = make;
  }
}

const late = (make) => new Late(make);

// Шаг — объект (присваивания свойств по порядку ключей), массив [метод, ...аргументы],
// функция (вызов на месте) или пустое значение (пропуск).
const play = (target, steps) => {
  for (const step of steps) {
    if (!step) continue;
    if (typeof step === "function") step();
    else if (Array.isArray(step)) target[step[0]](...step.slice(1).map((arg) => (arg instanceof Late ? arg.make() : arg)));
    else Object.assign(target, step);
  }
};

const scoped = (target, steps) => {
  target.save();
  play(target, steps);
  target.restore();
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/* ---------- Цвета подложки ---------- */

const LUMA = [0.2126, 0.7152, 0.0722];

const lightness = (hex) => hexToRgb(hex).reduce((total, channel, at) => total + LUMA[at] * channel, 0) / 255;

const stepToward = (channel, target, share) => channel + (target - channel) * share;

const mix = (left, right, share) => {
  const [from, to] = [hexToRgb(left), hexToRgb(right)];
  return rgbToHex(from.map((channel, at) => stepToward(channel, to[at], share)));
};

const listOf = (value) => (Array.isArray(value) ? value : []);

// Кромка дорог: на светлых дорогах — к чёрному, на тёмных — к белому.
const CASING_TINT = [["#ffffff", 0.35], ["#000000", 0.45]];

const percent = (value, fallback) => Number(value ?? fallback) / 100;

// Поля стиля по порядку; каждое считается из сводки env (опорные цвета и исходная база src).
const STYLE_SCHEMA = [
  ["land", (env) => env.land],
  ["forest", (env) => env.forest],
  ["desert", (env) => env.desert],
  ["dry", (env) => mix(env.forest, env.desert, 0.55)],
  ["shallow", ({ src, water }) => src.shallow || mix(water, "#ffffff", 0.35)],
  ["water", (env) => env.water],
  ["sea", (env) => env.sea],
  ["blocks", ({ src, land }) => src.buildings || land],
  ["paths", ({ src, roads, land }) => src.paths || mix(roads, land, 0.45)],
  ["freeway", (env) => env.freeway],
  ["roads", (env) => env.roads],
  ["rail", ({ src, roads, freeway }) => src.rail || mix(roads, freeway, 0.5)],
  ["outline", ({ src, land }) => src.outline || land],
  ["outlineWidth", ({ src }) => Number(src.outlineWidth ?? 1.2)],
  ["glow", ({ src }) => percent(src.edgeGlow, 0)],
  ["glowColor", ({ src, sea }) => src.edgeGlowColor || sea],
  ["biomes", ({ src }) => percent(src.biomes, 0)],
  ["relief", ({ src }) => percent(src.relief, 0)],
  ["reliefLight", ({ land }) => lightness(land) < 0.4],
  ["casing", ({ src }) => percent(src.roadCasing, 0)],
  ["casingColor", ({ roads, land }) => mix(roads, ...CASING_TINT[Number(lightness(roads) > lightness(land))])],
  ["freewayCasing", ({ src }) => src.highwayCasing || ""],
  ["waterSmooth", ({ src }) => percent(src.waterSmooth, 60)],
  ["shallowReach", ({ src }) => Math.max(percent(src.shallowReach, 35), 0.03)],
  ["hidden", ({ src }) => new Set(listOf(src.hidden))],
];

export const vectorBaseStyle = (base) => {
  const src = base || {};
  const [land, roads, water, sea] = [src.land || DEFAULTS.land, src.roads || DEFAULTS.roads, src.water || DEFAULTS.water, src.sea || DEFAULTS.sea];
  const env = { src, land, roads, water, sea, forest: src.terrain || land, desert: src.sand || land, freeway: src.highways || roads };
  return Object.fromEntries(STYLE_SCHEMA.map(([key, make]) => [key, make(env)]));
};

export const waterColorAt = (style, depth) => {
  const edge = Math.min(style.shallowReach ?? 0.35, 0.9);
  const shoal = depth <= edge;
  const progress = shoal ? depth / edge : (depth - edge) / (1 - edge);
  return mix(shoal ? style.shallow : style.water, shoal ? style.water : style.sea, progress);
};

/* ---------- Шум растительности ---------- */

const LATTICE_MULTIPLIERS = [374761393, 668265263, 1442695041];

const fold = (hash, shift) => hash ^ (hash >>> shift);

// Значение шума в узле целочисленной решётки: хеш трёх чисел -> [0, 1].
const lattice = (i, j, layer) => {
  const seeded = [i, j, layer].reduce((acc, value, at) => acc ^ Math.imul(value, LATTICE_MULTIPLIERS[at]), 0);
  const scrambled = Math.imul(fold(seeded, 13), 1274126177);
  return (fold(scrambled, 16) >>> 0) / 4294967295;
};

const smoothStep = (fraction) => {
  const square = fraction * fraction;
  return square * (3 - 2 * fraction);
};

// Углы клетки в порядке a, b, c, d: (0,0), (1,0), (0,1), (1,1).
const CORNER_SHIFTS = [[0, 0], [1, 0], [0, 1], [1, 1]];

const noise = (u, v, layer) => {
  const [x0, y0] = [Math.floor(u), Math.floor(v)];
  const [fx, fy] = [smoothStep(u - x0), smoothStep(v - y0)];
  const [a, b, c, d] = CORNER_SHIFTS.map(([dx, dy]) => lattice(x0 + dx, y0 + dy, layer));
  const alongX = (b - a) * fx;
  const alongY = (c - a) * fy;
  const twist = (a - b - c + d) * fx * fy;
  return a + alongX + alongY + twist;
};

// Три слоя шума: [частота, вес, номер слоя].
const VEGETATION_LAYERS = [[1, 0.5, 11], [2.3, 0.3, 12], [5.1, 0.2, 13]];

export const vegetationAt = (x, y) => {
  const [u, v] = [x / 300, y / 300];
  return VEGETATION_LAYERS.map(([frequency, weight, layer]) => noise(u * frequency, v * frequency, layer) * weight).reduce((sum, term) => sum + term);
};

// Покрытие пятном: 0 до порога, 1 после перехода, между ними — плавная ступень (NaN остаётся NaN).
const vegetationCoverage = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const eased = t * t;
  return eased * (3 - 2 * t);
};

/* ---------- Цвета вершин радара ---------- */

const HEX_DIGITS = "0123456789ABCDEF";

const isRgba8 = (text) => text.length === 8 && [...text].every((symbol) => HEX_DIGITS.includes(symbol));

// Цвет роли: вода — по глубине, суша — цвет суши, прочее — поле стиля с именем роли, иначе цвет дорог.
function roleColour(style, role, depth) {
  if (role === "water") return waterColorAt(style, depth);
  if (role === "land") return style.land;
  return style[role] || style.roads;
}

export const vectorRadarColours = (base, palette, classify) => {
  const style = vectorBaseStyle(base);
  return (Array.isArray(palette) ? palette : []).flatMap((entry) => {
    const source = String(entry?.rgba ?? "").toUpperCase();
    if (!isRgba8(source)) return [];
    const channels = [source.slice(0, 2), source.slice(2, 4), source.slice(4, 6)].map((pair) => parseInt(pair, 16));
    const { role, depth } = classify(...channels, 0);
    const color = roleColour(style, role, depth);
    const target = `${color.slice(1).toUpperCase()}FF`;
    return target === source ? [] : [`${source}=${target}`];
  });
};

/* ---------- Рисование ---------- */

// Память: путь одной группы (по группе) и общий путь роли (по геометрии, внутри — по роли).
const groupPaths = new WeakMap();
const rolePaths = new WeakMap();

const remember = (store, key, make) => {
  if (!store.has(key)) store.set(key, make());
  return store.get(key);
};

const newPath = () => new Path2D();

const defaultLayer = (width, height) =>
  typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });

class Frame {
  constructor(context, geometry, options) {
    const { world, width, height } = options;
    Object.assign(this, {
      context,
      geometry,
      world,
      width,
      height,
      base: options.base,
      createPath: options.createPath || null,
      makeLayer: options.createCanvas || defaultLayer,
      style: vectorBaseStyle(options.base),
    });
    const span = world.x1 - world.x0;
    this.scale = width / span;
    this.pixel = 1 / this.scale;
    this.matrix = [this.scale, 0, 0, -this.scale, -world.x0 * this.scale, world.y0 * this.scale];
    this.view = options.cull === false ? null : viewWindow(world, VIEW_MARGIN_PIXELS / this.scale + VIEW_MARGIN_METERS);
  }

  /* --- пути --- */

  groupsOf(role) {
    return this.geometry.groups.filter(({ role: kind }) => kind === role);
  }

  groupPath(group) {
    return remember(groupPaths, group, () => fullPath(group, this.createPath));
  }

  stepPath(group) {
    const seen = this.view ? visiblePath([group], this.view, this.createPath) : null;
    return seen ? seen.path : this.groupPath(group);
  }

  joinGroups(groups) {
    const path = (this.createPath || newPath)();
    groups.forEach((group) => path.addPath(this.groupPath(group)));
    return path;
  }

  sharedPath(role, groups) {
    const table = remember(rolePaths, this.geometry, () => new Map());
    return remember(table, role, () => (groups.length > 0 ? this.joinGroups(groups) : null));
  }

  rolePath(role) {
    const groups = this.groupsOf(role);
    const seen = this.view && groups.length > 0 ? visiblePath(groups, this.view, this.createPath) : null;
    return seen ? seen.path : this.sharedPath(role, groups);
  }

  pathIfVisible(role) {
    return this.style.hidden.has(LAYER_BY_ROLE[role] ?? role) ? null : this.rolePath(role);
  }

  fillRoles(pairs) {
    for (const [role, color] of pairs) {
      const path = this.pathIfVisible(role);
      if (path) play(this.context, [{ fillStyle: color }, ["fill", path]]);
    }
  }

  /* --- слои --- */

  paintWater() {
    const { context, style } = this;
    const waterHidden = style.hidden.has("water");
    const groups = waterHidden ? [] : this.groupsOf("water");
    if (groups.length === 0) return;
    const blur = clamp(style.waterSmooth * 70 * this.scale, 0, WATER_BLUR_MAX);
    const layer = blur >= 1 ? this.makeLayer(this.width, this.height) : null;
    const target = layer?.getContext("2d") ?? context;
    scoped(target, [
      ["setTransform", ...this.matrix],
      ...groups.flatMap((group) => [{ fillStyle: waterColorAt(style, group.depth) }, ["fill", late(() => this.stepPath(group))]]),
    ]);
    if (!layer) return;
    // Размытый слой кладётся поверх, а чёткий — под низ: цвет у края кадра не светлеет.
    for (const props of [{ filter: `blur(${blur.toFixed(2)}px)` }, { globalCompositeOperation: "destination-over" }]) {
      scoped(context, [props, ["drawImage", layer, 0, 0]]);
    }
  }

  paintBiomes() {
    const { context, style, scale, matrix } = this;
    const blur = clamp(BIOMES_BLUR_FACTOR * scale, 1, BIOMES_BLUR_MAX);
    const margin = Math.ceil(2 * blur);
    const layer = this.makeLayer(this.width + 2 * margin, this.height + 2 * margin);
    const cells = BIOME_ORDER.flatMap((biome) => [
      { fillStyle: style[biome] },
      ...BIOME_CELLS[biome].map(({ minX, minY, maxX, maxY }) => ["fillRect", minX, minY, maxX - minX, maxY - minY]),
    ]);
    play(layer.getContext("2d"), [["setTransform", scale, 0, 0, -scale, matrix[4] + margin, matrix[5] + margin], ...cells]);
    scoped(context, [
      ["setTransform", 1, 0, 0, 1, 0, 0],
      { globalAlpha: Math.min(1, style.biomes), filter: `blur(${blur.toFixed(1)}px)` },
      ["drawImage", layer, -margin, -margin],
    ]);
    context.setTransform(...matrix);
  }

  paintVegetation() {
    const { context, style, world } = this;
    const divisor = Math.max(Math.ceil(Math.max(this.width, this.height) / VEGETATION_MAX_GRID), 1);
    const gridSize = [this.width, this.height].map((side) => Math.max(1, Math.ceil(side / divisor)));
    const [gridWidth, gridHeight] = gridSize;
    const layer = this.makeLayer(...gridSize);
    const [target, tone, density] = [layer.getContext("2d"), ...(style.reliefLight ? [255, 0.16] : [0, 0.22])];
    const image = target.createImageData(...gridSize);
    const strength = Math.min(1, style.relief) * density;
    const [stepX, stepY] = [(world.x1 - world.x0) / gridWidth, (world.y0 - world.y1) / gridHeight];
    const edge = clamp(stepX / 400, VEGETATION_EDGE_MIN, VEGETATION_EDGE_MAX);
    const alphaAt = (cell) => {
      const [row, column] = [Math.floor(cell / gridWidth), cell % gridWidth];
      const noiseValue = vegetationAt(world.x0 + (column + 0.5) * stepX, world.y0 - (row + 0.5) * stepY);
      return Math.round(vegetationCoverage((noiseValue - VEGETATION_THRESHOLD) / edge) * strength * 255);
    };
    image.data.fill(tone);
    for (let cell = 0; cell < gridWidth * gridHeight; cell += 1) image.data[cell * 4 + 3] = alphaAt(cell);
    target.putImageData(image, 0, 0);
    scoped(context, [
      ["setTransform", 1, 0, 0, 1, 0, 0],
      { imageSmoothingEnabled: true, imageSmoothingQuality: "high" },
      ["drawImage", layer, 0, 0, gridWidth * divisor, gridHeight * divisor],
    ]);
  }

  paintLand(path) {
    const { context, style, scale, pixel } = this;
    const edgeEffects = [
      [
        style.glow > 0,
        [
          { shadowColor: style.glowColor, shadowBlur: Math.min(GLOW_BLUR_MAX, style.glow * GLOW_BLUR_FACTOR * scale), fillStyle: style.glowColor },
          ["fill", path],
        ],
      ],
      [
        style.outlineWidth > 0,
        [
          { strokeStyle: style.outline, lineJoin: "round", lineWidth: Math.max(pixel * 1.2, style.outlineWidth * OUTLINE_WIDTH_FACTOR) },
          ["stroke", path],
        ],
      ],
    ];
    for (const [enabled, steps] of edgeEffects) if (enabled) scoped(context, steps);
    play(context, [{ fillStyle: style.land }, ["fill", path]]);
    if (style.biomes > 0 || style.relief > 0) {
      scoped(context, [
        ["clip", path],
        style.biomes > 0 && (() => this.paintBiomes()),
        style.relief > 0 && (() => this.paintVegetation()),
        ["setTransform", ...this.matrix],
      ]);
      context.setTransform(...this.matrix);
    }
    const relief = terrainStyle(this.base, style.land);
    if (relief) {
      scoped(context, [["clip", path], () => paintTerrain(context, relief, { createPath: this.createPath || newPath, pixel })]);
    }
  }

  paintRoads() {
    const { context, style, pixel } = this;
    this.fillRoles([["blocks", style.blocks], ["paths", style.paths]]);
    const [roads, freeway] = ["roads", "freeway"].map((role) => this.pathIfVisible(role));
    const casings = [
      [
        style.casing > 0 && (roads || freeway),
        [
          { strokeStyle: style.casingColor, globalAlpha: Math.min(1, style.casing * 1.2), lineJoin: "round", lineWidth: Math.max(pixel, 1.6) },
          freeway && ["stroke", freeway],
          roads && ["stroke", roads],
        ],
      ],
      [
        freeway && style.freewayCasing,
        [{ strokeStyle: style.freewayCasing, lineJoin: "round", lineWidth: Math.max(pixel * 2.4, 5) }, ["stroke", freeway]],
      ],
    ];
    for (const [enabled, steps] of casings) if (enabled) scoped(context, steps);
    this.fillRoles([["freeway", style.freeway], ["roads", style.roads]]);
    if (pixel > 1) {
      // Кадр отдалён: тонкие дороги дублируются обводкой, чтобы не терялись.
      const outlines = [[freeway, style.freeway, 1.5], [roads, style.roads, 1]];
      scoped(context, [
        { lineJoin: "round" },
        ...outlines.flatMap(([path, color, factor]) => (path ? [{ strokeStyle: color, lineWidth: pixel * factor }, ["stroke", path]] : [])),
      ]);
    }
    this.fillRoles([["rail", style.rail]]);
  }

  run() {
    const { context, style } = this;
    play(context, [
      ["save"],
      ["clearRect", 0, 0, this.width, this.height],
      () => this.paintWater(),
      ["setTransform", ...this.matrix],
      () => {
        const land = style.hidden.has("land") ? null : this.rolePath("land");
        if (land) this.paintLand(land);
        this.paintRoads();
      },
      ["restore"],
    ]);
  }
}

const drawFrame = (context, geometry, options) => {
  new Frame(context, geometry, options).run();
};

export const paintVectorBase = (context, geometry, options) =>
  (geometry?.kind === "pack" ? paintPackGeometry : drawFrame)(context, geometry, options);
