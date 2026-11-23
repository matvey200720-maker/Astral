/*
 * Отделка поверхности — общая система текстур «Ангара» и «Завода».
 *
 * У поверхности (каркас снаружи, внутри, пол; корпуса, земля, контейнеры,
 * реквизит) один режим:
 *
 *   standard — «Стандарт»: штатные листы GTA, как без модов;
 *   mod      — «Как в моде»: листы автора мода;
 *   colour   — свой цвет (светотень листа остаётся);
 *   pattern  — узор из каталога (`FINISH_PATTERNS`), у каждого свои цвета;
 *   image    — своя картинка человека: растянуть на стену или замостить,
 *              цвет можно подкрутить;
 *   gradient — градиент из 2–4 цветов, как небо в «Тайм-циклах».
 *
 * Здесь — договор и пиксели: разбор работы, каталог узоров и сами узоры,
 * градиенты, раскладка картинки и проекция по миру. Одни и те же функции
 * зовут окно (кадр, плитки) и установщик (листы игры), поэтому в кадре ровно
 * то, что уедет в игру.
 *
 * Все узоры бесшовные: плитка узора повторяется без стыков — и в листах
 * завода, которые игра сама повторяет по модели, и по стенам ангара.
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { normalizePlaceModelAnimation } from "./place-models.js";
import { finishWallCoords } from "./finish-walls.js";

export const FINISH_MODES = Object.freeze(["standard", "mod", "colour", "pattern", "image", "gradient"]);
export const FINISH_MODE_LABELS = Object.freeze({
  standard: "Стандарт",
  mod: "Как в моде",
  colour: "Свой цвет",
  pattern: "Узор",
  image: "Картинка",
  gradient: "Градиент",
});

export const FINISH_FITS = Object.freeze(["stretch", "tile"]);
export const FINISH_FIT_LABELS = Object.freeze({ stretch: "Растянуть", tile: "Замостить" });
export const GRADIENT_DIRECTIONS = Object.freeze(["vertical", "horizontal", "diagonal"]);
export const GRADIENT_DIRECTION_LABELS = Object.freeze({
  vertical: "Снизу вверх",
  horizontal: "Вдоль",
  diagonal: "Наискось",
});
export const FINISH_LIMITS = Object.freeze({ scale: [25, 400], strength: [0, 100], shade: [0, 100] });
export const GRADIENT_STOPS = Object.freeze([2, 4]);

const IMAGE_ASSET = /^finish-image:[a-f0-9]{64}$/;

/* ------------------------------------------------------------------ *
 * Бесшовный шум
 * ------------------------------------------------------------------ */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (value, period) => ((value % period) + period) % period;

/* Хеш ячейки → [0, 1): целочисленный, одинаковый везде. */
function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = (h + Math.imul(seed + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* Шум с периодом ячеек по осям (`px`, `py`) — края плитки сходятся. */
function periodicNoise2(x, y, px, py, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const sx = smooth(x - ix);
  const sy = smooth(y - iy);
  const a = hash(mod(ix, px), mod(iy, py), seed);
  const b = hash(mod(ix + 1, px), mod(iy, py), seed);
  const c = hash(mod(ix, px), mod(iy + 1, py), seed);
  const d = hash(mod(ix + 1, px), mod(iy + 1, py), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const periodicNoise = (x, y, period, seed) => periodicNoise2(x, y, period, period, seed);

/* Сумма октав; у каждой октавы период вдвое больше — шов не появляется. */
function periodicFbm(u, v, period, seed, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let frequency = period;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * periodicNoise(u * frequency, v * frequency, frequency, seed + octave * 31);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

/* Ячейки Вороного с периодом: расстояния до двух ближайших и номер ячейки. */
function periodicCells(u, v, period, seed) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy += 1)
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = ix + ox;
      const gy = iy + oy;
      const wx = mod(gx, period);
      const wy = mod(gy, period);
      const px = gx + hash(wx, wy, seed);
      const py = gy + hash(wx, wy, seed + 17);
      const distance = Math.hypot(px - x, py - y);
      if (distance < f1) {
        f2 = f1;
        f1 = distance;
        id = hash(wx, wy, seed + 5);
      } else if (distance < f2) f2 = distance;
    }
  return { f1, f2, id };
}

/* ------------------------------------------------------------------ *
 * Узоры
 * ------------------------------------------------------------------ *
 *
 * Художник узора получает точку плитки (u, v ∈ [0, 1)) и отвечает долями
 * трёх цветов — основы, узора и деталей — в сумме 1. Цвета смешивает общий
 * код, поэтому любой узор перекрашивается любыми тремя цветами.
 */

const weights = [0, 0, 0];
function paint(a, b, c) {
  const sum = a + b + c || 1;
  weights[0] = a / sum;
  weights[1] = b / sum;
  weights[2] = c / sum;
  return weights;
}

const smoothstep = (edge0, edge1, value) => smooth(clamp01((value - edge0) / (edge1 - edge0)));

const PAINTERS = {
  /* Пятнистый камень — как розовый пример владельца: тёплые пятна и тёмные
     разводы по светлой основе. */
  stone(u, v) {
    const base = periodicFbm(u, v, 4, 11, 6);
    const detail = periodicFbm(u, v, 16, 19, 4);
    const dark = smoothstep(0.46, 0.74, base * 0.72 + detail * 0.28) * 0.92;
    const light = smoothstep(0.52, 0.8, periodicFbm(u + 0.37, v + 0.11, 6, 23, 5)) * (1 - dark) * 0.75;
    return paint(1 - dark - light, dark, light);
  },
  marble(u, v) {
    const warp = periodicFbm(u, v, 3, 3, 6);
    const band = Math.abs(Math.sin((u * 3 + v * 2 + warp * 4.5) * Math.PI));
    const soft = 1 - smoothstep(0.0, 0.45, band);
    const fine = 1 - smoothstep(0.0, 0.08, Math.abs(Math.sin((u * 5 - v * 3 + warp * 6) * Math.PI)));
    const vein = Math.min(0.92, soft * soft * 0.75 + fine * 0.35);
    const cloud = smoothstep(0.4, 0.8, periodicFbm(u, v, 3, 9, 5)) * 0.45 * (1 - vein);
    return paint(1 - vein - cloud, vein, cloud);
  },
  concrete(u, v) {
    const grain = periodicFbm(u, v, 24, 5, 3);
    const stain = smoothstep(0.55, 0.75, periodicFbm(u, v, 4, 8, 4));
    const pore = smoothstep(0.82, 0.86, periodicNoise(u * 96, v * 96, 96, 13));
    return paint(1 - 0.5 * grain - stain * 0.4, 0.5 * grain + stain * 0.4, pore);
  },
  brushed(u, v) {
    /* Штрихи вдоль: по u шум редкий, по v — частый; периоды целые. */
    let streak = 0;
    for (let octave = 0; octave < 3; octave += 1) {
      const px = 2 << octave;
      const py = 48 << octave;
      streak += periodicNoise2(u * px, v * py, px, py, 21 + octave) / (1 << octave);
    }
    streak /= 1.75;
    const line = periodicNoise2(u * 2, v * 256, 2, 256, 7);
    const light = 0.35 + 0.4 * streak + 0.25 * line;
    return paint(light, 1 - light, 0);
  },
  carbon(u, v) {
    const cells = 16;
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const fx = x - cx;
    const fy = y - cy;
    const across = (cx + cy) % 2 === 0;
    const fibre = across ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    const sheen = across ? 0.5 + 0.5 * Math.sin(fx * Math.PI) : 0.5 + 0.5 * Math.sin(fy * Math.PI);
    return paint(1 - fibre * 0.8, fibre * 0.8 * (1 - sheen * 0.4), fibre * sheen * 0.35);
  },
  camo(u, v) {
    const a = periodicFbm(u, v, 4, 41, 4);
    const b = periodicFbm(u + 0.5, v, 4, 43, 4);
    const first = smoothstep(0.5, 0.53, a);
    const second = smoothstep(0.55, 0.58, b) * (1 - first);
    return paint(1 - first - second, first, second);
  },
  digital(u, v) {
    const cells = 48;
    const qu = (Math.floor(u * cells) + 0.5) / cells;
    const qv = (Math.floor(v * cells) + 0.5) / cells;
    const a = periodicFbm(qu, qv, 4, 51, 4);
    const b = periodicFbm(qu, qv + 0.5, 4, 53, 4);
    const first = a > 0.52 ? 1 : 0;
    const second = b > 0.56 && !first ? 1 : 0;
    return paint(1 - first - second, first, second);
  },
  hex(u, v) {
    /* Соты: 6 рядов по 6 ячеек сходятся на краях плитки. */
    const width = 1 / 6;
    const height = width * 0.866;
    const rows = Math.round(1 / height / 2) * 2;
    const rowHeight = 1 / rows;
    const row = Math.floor(v / rowHeight);
    const shift = row % 2 ? width / 2 : 0;
    const x = mod(u + shift, width) / width - 0.5;
    const y = (v - row * rowHeight) / rowHeight - 0.5;
    const edge = Math.max(Math.abs(x) * 1.15 + Math.abs(y) * 0.3, Math.abs(y) * 0.9);
    const line = smoothstep(0.4, 0.46, edge);
    const inner = hash(Math.floor(mod(u + shift, 1) / width), row, 61) > 0.7 ? 0.35 : 0;
    return paint(1 - line - inner, line, inner);
  },
  stripes(u, v) {
    const band = mod((u + v) * 6, 1);
    const stripe = smoothstep(0.48, 0.52, band) * (1 - smoothstep(0.96, 1, band));
    return paint(1 - stripe, stripe, 0);
  },
  checker(u, v) {
    const on = (Math.floor(u * 8) + Math.floor(v * 8)) % 2;
    const grain = periodicFbm(u, v, 16, 71, 2) * 0.2;
    return paint(on ? 0 : 1 - grain, on ? 1 - grain : 0, grain);
  },
  bricks(u, v) {
    const rows = 12;
    const row = Math.floor(v * rows);
    const y = v * rows - row;
    const x = mod(u * 6 + (row % 2) * 0.5, 1);
    const mortar = Math.max(1 - smoothstep(0.0, 0.08, y), smoothstep(0.92, 1, y), 1 - smoothstep(0, 0.035, x), smoothstep(0.965, 1, x));
    const brick = Math.floor(mod(u * 6 + (row % 2) * 0.5, 6));
    const tone = hash(brick, row, 81) * 0.45;
    return paint((1 - mortar) * (1 - tone), (1 - mortar) * tone, mortar);
  },
  planks(u, v) {
    const planks = 8;
    const index = Math.floor(u * planks);
    const x = u * planks - index;
    const grain = periodicFbm(u * 0.5, v * 4 + index * 0.37, 8, 91 + index, 4);
    const ring = Math.abs(Math.sin((grain * 12 + x * 1.5) * Math.PI));
    const seam = 1 - smoothstep(0.0, 0.05, Math.min(x, 1 - x));
    const tone = hash(index, 0, 93) * 0.3;
    return paint((1 - seam) * (1 - ring * 0.5 - tone), (1 - seam) * (ring * 0.5 + tone), seam);
  },
  diamond(u, v) {
    const cells = 10;
    const x = mod(u * cells, 1) - 0.5;
    const y = mod(v * cells, 1) - 0.5;
    const along = Math.abs(x + y);
    const across = Math.abs(x - y);
    const bump = smoothstep(0.08, 0.02, Math.abs(along - 0.25)) * smoothstep(0.35, 0.2, across) + smoothstep(0.08, 0.02, Math.abs(across - 0.25)) * smoothstep(0.35, 0.2, along);
    const light = clamp01(bump);
    return paint(1 - light, 0, light);
  },
  terrazzo(u, v) {
    const big = periodicCells(u, v, 9, 101);
    const small = periodicCells(u, v, 22, 103);
    const chip = big.f1 < 0.2 ? (big.id > 0.5 ? 1 : 2) : small.f1 < 0.12 ? (small.id > 0.5 ? 1 : 2) : 0;
    return paint(chip === 0 ? 1 : 0, chip === 1 ? 1 : 0, chip === 2 ? 1 : 0);
  },
  waves(u, v) {
    const wave = Math.sin((v * 8 + Math.sin(u * Math.PI * 4) * 0.35) * Math.PI * 2);
    const line = smoothstep(0.7, 0.9, wave);
    const shade = smoothstep(-0.2, 0.6, wave) * 0.3;
    return paint(1 - line - shade, line, shade);
  },
  dots(u, v) {
    const cells = 8;
    const row = Math.floor(v * cells);
    const x = mod(u * cells + (row % 2) * 0.5, 1) - 0.5;
    const y = mod(v * cells, 1) - 0.5;
    const dot = smoothstep(0.3, 0.26, Math.hypot(x, y));
    return paint(1 - dot, dot, 0);
  },
  rust(u, v) {
    const patch = smoothstep(0.48, 0.62, periodicFbm(u, v, 5, 111, 5));
    const pit = smoothstep(0.66, 0.72, periodicFbm(u, v, 20, 113, 3)) * patch;
    return paint(1 - patch, patch - pit, pit);
  },
  tiles(u, v) {
    const cells = 6;
    const x = mod(u * cells, 1);
    const y = mod(v * cells, 1);
    const grout = Math.max(1 - smoothstep(0, 0.05, x), smoothstep(0.95, 1, x), 1 - smoothstep(0, 0.05, y), smoothstep(0.95, 1, y));
    const tone = hash(Math.floor(u * cells), Math.floor(v * cells), 121) * 0.35;
    return paint((1 - grout) * (1 - tone), (1 - grout) * tone, grout);
  },
};

const pattern = (id, label, colours) => Object.freeze({ id, label, colours: Object.freeze(colours) });

/* Каталог: порядок — порядок плиток в колонке. Цвета — заводские: основа,
   узор, детали. */
export const FINISH_PATTERNS = Object.freeze([
  pattern("stone", "Пятнистый камень", ["#b98aa0", "#5a3048", "#e9c7d6"]),
  pattern("marble", "Мрамор", ["#ece8e3", "#6d6a70", "#c9c4bf"]),
  pattern("concrete", "Бетон", ["#9a9894", "#6c6a66", "#3b3a38"]),
  pattern("brushed", "Шлифованный металл", ["#c9ced4", "#7d848c", "#ffffff"]),
  pattern("carbon", "Карбон", ["#121316", "#2c2f35", "#6a707a"]),
  pattern("camo", "Камуфляж", ["#4f5a36", "#2d3322", "#8a7a52"]),
  pattern("digital", "Цифровой камуфляж", ["#6e7563", "#3e4436", "#a6a58b"]),
  pattern("hex", "Соты", ["#1f2330", "#f2b21f", "#343b52"]),
  pattern("stripes", "Сигнальные полосы", ["#f2c200", "#1b1b1d", "#f2c200"]),
  pattern("checker", "Шахматка", ["#f0f0f0", "#1d1d1f", "#9a9a9a"]),
  pattern("bricks", "Кирпич", ["#9c4a32", "#6e2f1f", "#cfc6b8"]),
  pattern("planks", "Доски", ["#8a5a36", "#5a3920", "#2a1a0f"]),
  pattern("diamond", "Рифлёный лист", ["#8d949c", "#8d949c", "#d8dde2"]),
  pattern("terrazzo", "Терраццо", ["#e8e2d6", "#c0563b", "#2f5d7c"]),
  pattern("waves", "Волны", ["#1f5fae", "#bfe3ff", "#3f7fce"]),
  pattern("dots", "Горошек", ["#1d1d1f", "#ff5cb0", "#1d1d1f"]),
  pattern("rust", "Ржавчина", ["#6f7478", "#8a4a22", "#3a1e10"]),
  pattern("tiles", "Плитка", ["#f4f1ea", "#dcd3c2", "#8f8a80"]),
]);

export const findFinishPattern = (id) => FINISH_PATTERNS.find((item) => item.id === id) || FINISH_PATTERNS[0];

/*
 * Готовые градиенты — как готовые небеса «Тайм-циклов»: снизу вверх.
 */
const gradient = (id, label, colours) => Object.freeze({ id, label, colours: Object.freeze(colours) });
export const FINISH_GRADIENTS = Object.freeze([
  gradient("sunset", "Закат", ["#2b1055", "#d53369", "#ffb36b"]),
  gradient("ocean", "Океан", ["#0b2545", "#1f5fae", "#8ecae6"]),
  gradient("neon", "Неон", ["#7b2cff", "#ff2e97", "#2ee6ff"]),
  gradient("fire", "Огонь", ["#3a0a00", "#d9431e", "#ffcc33"]),
  gradient("forest", "Лес", ["#1b2d1b", "#4b7a3c", "#c9d98a"]),
  gradient("steel", "Сталь", ["#1c1f24", "#5b636e", "#d7dde4"]),
  gradient("candy", "Карамель", ["#ff9ec8", "#ffe0f0", "#9ee7ff"]),
  gradient("dusk", "Сумерки", ["#141e30", "#243b55", "#8e9eab"]),
]);

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampNumber = (value, [low, high], fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, Math.round(number))) : fallback;
};

function normalizeColours(input, fallback, count) {
  const list = Array.isArray(input) ? input : [];
  return Array.from({ length: count }, (_, index) => normalizeRecolourHex(list[index], fallback[index % fallback.length]));
}

/** Узор поверхности: `{ id, colours: [3], scale }`. */
export function normalizeFinishPattern(input) {
  const source = plain(input);
  const found = findFinishPattern(source.id);
  return {
    id: found.id,
    colours: normalizeColours(source.colours, found.colours, 3),
    scale: clampNumber(source.scale, FINISH_LIMITS.scale, 100),
  };
}

/**
 * Своя картинка: ключ хранилища, размер, как лечь и чем подкрасить.
 * Гифка (постер остановки, задача 6 ТЗ 17.10.2026): `asset` — лист кадров,
 * `width`/`height` — размер кадра, `animation` — сетка и задержки; на листе
 * поверхности лежит первый кадр, остальные играет плашка (`busstops.js`).
 */
export function normalizeFinishImage(input) {
  const source = plain(input);
  const asset = IMAGE_ASSET.test(String(source.asset || "")) ? source.asset : null;
  const animation = asset ? normalizePlaceModelAnimation(source.animation) : null;
  return {
    ...(animation ? { animation } : {}),
    asset,
    name: asset ? String(source.name || "").slice(0, 120) : "",
    width: asset ? clampNumber(source.width, [1, 16384], 1) : 0,
    height: asset ? clampNumber(source.height, [1, 16384], 1) : 0,
    fit: FINISH_FITS.includes(source.fit) ? source.fit : "stretch",
    scale: clampNumber(source.scale, FINISH_LIMITS.scale, 100),
    tint: normalizeRecolourHex(source.tint, "#ffffff"),
    strength: clampNumber(source.strength, FINISH_LIMITS.strength, 0),
  };
}

/** Градиент: 2–4 цвета снизу вверх (или вдоль) и направление. */
export function normalizeFinishGradient(input) {
  const source = plain(input);
  const fallback = FINISH_GRADIENTS[0].colours;
  const count = Math.min(GRADIENT_STOPS[1], Math.max(GRADIENT_STOPS[0], Array.isArray(source.colours) ? source.colours.length : 3));
  return {
    colours: normalizeColours(source.colours, fallback, count),
    direction: GRADIENT_DIRECTIONS.includes(source.direction) ? source.direction : "vertical",
  };
}

/**
 * Поля отделки поверхности (узор, картинка, градиент, светотень) — всегда
 * все: смена режима не теряет прежних настроек.
 */
export function normalizeFinishFields(input) {
  const source = plain(input);
  return {
    pattern: normalizeFinishPattern(source.pattern),
    image: normalizeFinishImage(source.image),
    gradient: normalizeFinishGradient(source.gradient),
    shade: clampNumber(source.shade, FINISH_LIMITS.shade, 70),
  };
}

/** Что из отделки меняет файлы (для отпечатка работы). */
export function finishSignature(settings) {
  const mode = settings.mode;
  if (mode === "pattern") return { mode, pattern: settings.pattern, shade: settings.shade };
  if (mode === "image") return { mode, image: { ...settings.image, name: undefined }, shade: settings.shade };
  if (mode === "gradient") return { mode, gradient: settings.gradient, shade: settings.shade };
  return null;
}

/*
 * Поверхность с общей отделкой — та, что несёт поля `normalizeFinishFields`
 * (узор, картинка, градиент). Режим «Картинка» выбирается селектом до
 * загрузки файла, и работа спокойно живёт с `mode: "image"` без картинки:
 * кадр редактора в этом состоянии рисует штатный облик, красить нечем.
 */
const isFinishSurface = (item) =>
  Boolean(item) && typeof item.image === "object" && item.image !== null && "pattern" in item && "gradient" in item;

/** «Картинка» без картинки: файл не загружен или ключ не прошёл разбор. */
export const finishIsBlank = (item) => item?.mode === "image" && !normalizeFinishImage(item.image).asset;

/**
 * Работа без пустых «Картинок»: каждая поверхность с отделкой «Картинка» без
 * файла встаёт в режим `fallback` — то, что у раздела значит «не менять»
 * («Стандарт», у завода — как в моде или как весь корпус). Установщик так
 * собирает ровно то, что показывает кадр, а не отказывает «Своя картинка
 * отделки не пришла» (журнал 14.10.2026). `fallback` — строка или
 * `(поверхность, путь) → режим`; работа не меняется на месте, нетронутые
 * ветки возвращаются теми же объектами.
 */
export function settleBlankFinishes(project, fallback = "standard") {
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      let out = null;
      node.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const next = walk(item, [...path, index]);
        if (next !== item) (out ||= node.slice())[index] = next;
      });
      return out || node;
    }
    if (!node || typeof node !== "object" || Object.getPrototypeOf(node) !== Object.prototype) return node;
    let out = null;
    for (const [key, item] of Object.entries(node)) {
      if (!item || typeof item !== "object") continue;
      const next = walk(item, [...path, key]);
      if (next !== item) (out ||= { ...node })[key] = next;
    }
    const settled = out || node;
    if (!isFinishSurface(settled) || !finishIsBlank(settled)) return settled;
    return { ...settled, mode: typeof fallback === "function" ? fallback(settled, path) : fallback };
  };
  return walk(project, []);
}

/** Картинки отделки, которые нужны установщику: ключ → имя. */
export function finishImageAssets(settingsList) {
  const out = new Map();
  for (const settings of settingsList)
    if (settings?.mode === "image" && settings.image?.asset) out.set(settings.image.asset, settings.image.name);
  return out;
}

/* ------------------------------------------------------------------ *
 * Пиксели
 * ------------------------------------------------------------------ */

const bytes = (hex) => hexBytes(hex);

/** Плитка узора `size × size` (RGBA) в цветах узора. Бесшовная. */
export function patternTile(settings, size) {
  const spec = normalizeFinishPattern(settings);
  const weights = patternWeights(spec.id, size);
  const [first, second, third] = spec.colours.map(bytes);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let pixel = 0, count = size * size; pixel < count; pixel += 1) {
    const w0 = weights[pixel * 3];
    const w1 = weights[pixel * 3 + 1];
    const w2 = weights[pixel * 3 + 2];
    const at = pixel * 4;
    out[at] = w0 * first[0] + w1 * second[0] + w2 * third[0];
    out[at + 1] = w0 * first[1] + w1 * second[1] + w2 * third[1];
    out[at + 2] = w0 * first[2] + w1 * second[2] + w2 * third[2];
    out[at + 3] = 255;
  }
  return out;
}

/*
 * Доли трёх цветов узора по пикселям — от цветов не зависят и считаются раз на узор и размер: протяжка по палитре меняет только смешение. Шум камня на плитке 256 px —
 * 60–100 мс на кадр на слабом процессоре, и цвет узора фризил окно (замер 31.10.2026). Double, а не float: байты плитки те же, что без кэша, — кадр и установщик сходятся.
 */
const PATTERN_WEIGHT_CACHE = new Map();
const PATTERN_WEIGHT_ENTRIES = 16;
const PATTERN_WEIGHT_MAX_SIZE = 512;
function patternWeights(id, size) {
  const key = `${id}|${size}`;
  const known = PATTERN_WEIGHT_CACHE.get(key);
  if (known) return known;
  const painter = PAINTERS[id];
  const weights = new Float64Array(size * size * 3);
  for (let row = 0; row < size; row += 1)
    for (let column = 0; column < size; column += 1) {
      const w = painter((column + 0.5) / size, (row + 0.5) / size);
      const at = (row * size + column) * 3;
      weights[at] = w[0];
      weights[at + 1] = w[1];
      weights[at + 2] = w[2];
    }
  /* Большие плитки (запекание листа) помнить незачем: они считаются один раз за установку. */
  if (size <= PATTERN_WEIGHT_MAX_SIZE) {
    PATTERN_WEIGHT_CACHE.set(key, weights);
    while (PATTERN_WEIGHT_CACHE.size > PATTERN_WEIGHT_ENTRIES) PATTERN_WEIGHT_CACHE.delete(PATTERN_WEIGHT_CACHE.keys().next().value);
  }
  return weights;
}

/** Цвет градиента в доле `t ∈ [0, 1]` (0 — низ или начало). */
export function gradientColour(settings, t) {
  return colourAlong(normalizeFinishGradient(settings).colours.map(bytes), t);
}

function colourAlong(colours, t) {
  const x = clamp01(t) * (colours.length - 1);
  const index = Math.min(colours.length - 2, Math.floor(x));
  const f = x - index;
  return [0, 1, 2].map((channel) => colours[index][channel] + (colours[index + 1][channel] - colours[index][channel]) * f);
}

/*
 * Полоса градиента `size × size` для листа: вертикальный — снизу вверх по
 * листу (v растёт вниз, как у игры), вдоль — слева направо, наискось — из
 * угла в угол.
 */
export function gradientTile(settings, size) {
  const spec = normalizeFinishGradient(settings);
  /* Цвета приводятся раз на плитку, а не на каждый пиксель: протяжка по палитре считает плитку на каждый кадр. */
  const colours = spec.colours.map(bytes);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row += 1)
    for (let column = 0; column < size; column += 1) {
      const u = (column + 0.5) / size;
      const v = (row + 0.5) / size;
      const t = spec.direction === "vertical" ? 1 - v : spec.direction === "horizontal" ? u : (u + 1 - v) / 2;
      const colour = colourAlong(colours, t);
      const at = (row * size + column) * 4;
      out[at] = colour[0];
      out[at + 1] = colour[1];
      out[at + 2] = colour[2];
      out[at + 3] = 255;
    }
  return out;
}

/*
 * Своя картинка, подкрашенная: `rgba` (width × height) → копия, где каждый
 * пиксель смешан с цветом подкраски на долю `strength` (яркость пикселя
 * остаётся — подкрашивается тон).
 */
export function tintImagePixels(rgba, settings) {
  const spec = normalizeFinishImage(settings);
  const out = new Uint8ClampedArray(rgba);
  if (!spec.strength) return out;
  const tint = bytes(spec.tint);
  const share = spec.strength / 100;
  for (let at = 0; at < out.length; at += 4) {
    const luma = (0.2126 * out[at] + 0.7152 * out[at + 1] + 0.0722 * out[at + 2]) / 255;
    for (let channel = 0; channel < 3; channel += 1)
      out[at + channel] = out[at + channel] + (tint[channel] * luma * 1.25 - out[at + channel]) * share;
  }
  return out;
}

/*
 * Сколько раз плитка отделки ложится на лист (завод: листы игры сами
 * повторяются по модели). Узор — масштаб 100 % = 2 плитки на лист;
 * картинка «растянуть» — одна на лист, «замостить» — по масштабу.
 */
export function finishRepeats(settings) {
  if (settings.mode === "pattern") return Math.max(0.25, (2 * normalizeFinishPattern(settings.pattern).scale) / 100);
  if (settings.mode === "image") {
    const image = normalizeFinishImage(settings.image);
    return image.fit === "tile" ? Math.max(0.25, (2 * image.scale) / 100) : 1;
  }
  return 1;
}

/* ------------------------------------------------------------------ *
 * Проекция по миру (ангар)
 * ------------------------------------------------------------------ *
 *
 * У ангара листы автора — уникальная развёртка: каждый тексель — своя точка
 * стены. Поэтому узор, картинка и градиент ложатся по миру: грань смотрит
 * вдоль X, Y или Z — берётся своя плоскость, и картинка на стене стоит
 * прямо, если смотреть на стену (снаружи — снаружи, изнутри — изнутри).
 * Эта же функция в шейдере кадра (`recolor-material.js`, `rcBoxProjection`).
 */

/** Метров на плитку узора при масштабе 100 %. */
export const FINISH_TILE_METRES = 6;

/**
 * Точка стены → (s, t): `box` — рамка поверхности `{ min, max }`;
 * `fit` — `stretch` (доли рамки, картинка на всю стену) или `metres`
 * (метры / `metres`, для узоров и замощения).
 */
export function boxProjection(point, normal, box, { fit = "stretch", metres = FINISH_TILE_METRES } = {}) {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  /* Плоскость — по главной оси нормали (ничья — Z, потом X); метры от угла рамки — те же, что у стен Majestic (`finish-walls.js`). */
  const cls = az >= ax && az >= ay ? (normal[2] < 0 ? 5 : 4) : ax >= ay ? (normal[0] < 0 ? 1 : 0) : normal[1] < 0 ? 3 : 2;
  const [s, t, width, height] = finishWallCoords(point, cls, box);
  return fit === "metres" ? [s / metres, t / metres] : [s / width, t / height];
}

/**
 * Метров на плитку отделки по стенам (0 — растянуть на стену): узор —
 * `FINISH_TILE_METRES` × масштаб, картинка «замостить» — вдвое крупнее.
 */
export function finishWallMetres(settings) {
  if (settings.mode === "pattern") return (FINISH_TILE_METRES * normalizeFinishPattern(settings.pattern).scale) / 100;
  if (settings.mode === "image") {
    const image = normalizeFinishImage(settings.image);
    return image.fit === "tile" ? (FINISH_TILE_METRES * 2 * image.scale) / 100 : 0;
  }
  return 0;
}

/** Доля высоты или длины для градиента по миру. */
export function gradientShare(point, box, direction) {
  const size = [0, 1, 2].map((axis) => Math.max(1e-3, box.max[axis] - box.min[axis]));
  const local = [0, 1, 2].map((axis) => (point[axis] - box.min[axis]) / size[axis]);
  if (direction === "vertical") return clamp01(local[2]);
  const along = size[0] >= size[1] ? local[0] : local[1];
  if (direction === "horizontal") return clamp01(along);
  return clamp01((along + local[2]) / 2);
}

/* Выборка из плитки (RGBA size × size) с повтором, билинейно. */
export function sampleTile(tile, size, s, t) {
  const x = mod(s, 1) * size - 0.5;
  const y = mod(t, 1) * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  for (let dy = 0; dy <= 1; dy += 1)
    for (let dx = 0; dx <= 1; dx += 1) {
      const px = mod(x0 + dx, size);
      const py = mod(y0 + dy, size);
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const at = (py * size + px) * 4;
      out[0] += tile[at] * w;
      out[1] += tile[at + 1] * w;
      out[2] += tile[at + 2] * w;
    }
  return out;
}

/* Выборка из картинки (RGBA width × height), растянутой на [0, 1]². */
export function sampleImage(rgba, width, height, s, t, repeat = false) {
  const u = repeat ? mod(s, 1) : clamp01(s);
  const v = repeat ? mod(t, 1) : clamp01(t);
  const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
  const at = (y * width + x) * 4;
  return [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]];
}
