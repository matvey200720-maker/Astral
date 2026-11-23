// Текстура следа пули как чистая функция настроек, цвета (#rrggbb), радужный тон и зерно.
// Файл листовой: импортов нет (сборка окна выделяет его отдельным куском). Единственное
// обращение к стандартной математике — одна раздача функций ниже; в пиксельном цикле
// и в кривых видов обращений к ней по имени нет.
const { PI, abs, ceil, cos, floor, imul, max, min, round, sin } = Math;

function clamp(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

const frac = (x) => x - floor(x);
const square = (x) => x * x;
const lerp = (from, to, t) => from + (to - from) * t;

// Сглаженная ступень от a до b; при a > b убывающая, при a = b делитель берётся 1.
function smooth(a, b, x) {
  const span = b - a;
  const ratio = (x - a) / (span === 0 ? 1 : span);
  const t = clamp(ratio);
  const eased = 3 - 2 * t;
  return t * t * eased;
}

// Целочисленный хеш: перемешивание 32 бит.
function avalanche(h) {
  const folded = imul(h ^ (h >>> 13), 1274126177);
  return (folded ^ (folded >>> 16)) >>> 0;
}

// Шум отрезка по двум целым в 0…1.
function cellNoise(i, k) {
  return avalanche((imul(i, 374761393) + imul(k, 668265263)) >>> 0) / 4294967296;
}

const jitter = (i) => (cellNoise(i, 7) - 0.5) * 0.9;

function lightningOffset(v) {
  const p = 12 * v;
  const i = floor(p);
  return lerp(jitter(i), jitter(i + 1), p - i);
}

// Сужение к краю: 1 в центре, 0 на расстоянии `width`.
const taper = (u, width) => 1 - clamp(abs(u) / width);
const thread = (x, spread) => smooth(0.2 * spread, 0, abs(x));

// Яркость поперёк (u в -1…1, spread — полуширина, v вдоль 0…1) и вдоль следа, по виду.
function classicAcross(u, spread) {
  return square(taper(u, spread));
}
function classicAlong(v) {
  return (1 - v) ** 1.4;
}

function beamAcross(u, spread) {
  return smooth(spread, 0.35 * spread, abs(u));
}
function beamAlong(v) {
  return 1 - smooth(0.82, 1, v);
}

function plasmaAcross(u, spread) {
  return taper(u, spread) ** 1.1;
}
function plasmaAlong(v) {
  return 0.35 + 0.65 * (1 - v) ** 0.7;
}

function trailAcross(u, spread, v) {
  return taper(u, spread * (0.45 + 1.1 * v)) ** 1.6;
}
function trailAlong(v) {
  return (1 - v) ** 0.55;
}

function railgunAcross(u, spread) {
  return clamp(square(taper(u, spread)) * 0.45 + smooth(0.22 * spread, 0, abs(u)));
}
function railgunAlong(v) {
  return (0.55 + 0.45 * cos(9 * PI * v)) * (1 - v) ** 0.8;
}

function cometAcross(u, spread, v) {
  return taper(u, spread * (1.15 - 0.7 * v)) ** 1.8;
}
function cometAlong(v) {
  return (1 - v) ** 2.6;
}

function lightningAcross(u, spread, v) {
  const distance = abs(u - lightningOffset(v) * spread);
  return clamp(smooth(0.16 * spread, 0, distance) + square(1 - clamp(distance / spread)) * 0.3);
}
function lightningAlong(v) {
  return 0.5 + 0.5 * (1 - v) ** 0.9;
}

function dashedAcross(u, spread) {
  return smooth(0.55 * spread, 0.25 * spread, abs(u));
}
function dashedAlong(v) {
  return (frac(7 * v) < 0.55 ? 1 : 0.06) * (1 - v) ** 0.5;
}

function twinAcross(u, spread) {
  const gap = 0.42 * spread;
  return clamp(max(thread(u - gap, spread), thread(u + gap, spread)));
}
function twinAlong(v) {
  return 1 - smooth(0.75, 1, v);
}

function helixAcross(u, spread, v) {
  const sway = sin(v * PI * 2 * 3) * spread * 0.55;
  const strands = max(thread(u - sway, spread), 0.75 * thread(u + sway, spread));
  return clamp(strands + square(taper(u, spread)) * 0.25);
}
function helixAlong(v) {
  return (1 - v) ** 0.5;
}

function needleAcross(u, spread, v) {
  const head = spread * (0.09 + 0.08 * v);
  const line = abs(u);
  return clamp(smooth(head, 0, line) + smooth(0.4 * spread, 0, line) * smooth(0.1, 0, v) * 0.9);
}
function needleAlong(v) {
  return 1 - v ** 1.6;
}

// Клетка вдоль следа: искра есть, если шум клетки выше порога; её сдвиг поперёк берётся из второго шума.
const sparkShift = (cell, spread) => (cellNoise(cell, 3) - 0.5) * 1.4 * spread;

function sparksAcross(u, spread, v) {
  const cell = floor(40 * v);
  const lit = cellNoise(cell, 11) > 0.45 ? 1 : 0;
  const spark = lit * smooth(0.12 * spread, 0, abs(u - sparkShift(cell, spread))) * smooth(0.5, 0.15, abs(frac(40 * v) - 0.5));
  return clamp(smooth(0.14 * spread, 0, abs(u)) * 0.5 + spark);
}
function sparksAlong(v) {
  return (1 - v) ** 0.7;
}

function pixelAcross(u, spread, v) {
  const reach = floor(16 * v) % 4 === 1 ? 2 : 1;
  return floor(abs(u) / (spread / 3)) < reach ? 1 : 0;
}
function pixelAlong(v) {
  const level = floor(16 * v) / 16;
  if (!(level < 0.9)) return 0;
  return 1 - 0.75 * level;
}

function waveAcross(u, spread, v) {
  return taper(u, spread * (0.45 + 0.55 * abs(sin(4 * PI * v)))) ** 1.5;
}
function waveAlong(v) {
  return (1 - v) ** 0.9;
}

const CURVES = {
  classic: [classicAcross, classicAlong],
  beam: [beamAcross, beamAlong],
  plasma: [plasmaAcross, plasmaAlong],
  trail: [trailAcross, trailAlong],
  railgun: [railgunAcross, railgunAlong],
  comet: [cometAcross, cometAlong],
  lightning: [lightningAcross, lightningAlong],
  dashed: [dashedAcross, dashedAlong],
  twin: [twinAcross, twinAlong],
  helix: [helixAcross, helixAlong],
  needle: [needleAcross, needleAlong],
  sparks: [sparksAcross, sparksAlong],
  pixel: [pixelAcross, pixelAlong],
  wave: [waveAcross, waveAlong],
};

// id, подпись, описание, доля сердцевины, доля зерна. Подписи и описания — ключи словаря переводов окна.
const STYLE_ROWS = [
  ["classic", "Классический", "Мягкая полоса с раскалённой серединой — как в оригинале.", 0.55, 0.05],
  ["beam", "Луч", "Ровная жёсткая линия одинаковой яркости по всей длине.", 0.85, 0],
  ["plasma", "Плазма", "Широкое свечение с неровным краем.", 0.4, 0.35],
  ["trail", "Дымный след", "Длинный мягкий хвост, расширяющийся к концу.", 0.2, 0.22],
  ["railgun", "Рельсотрон", "Тонкая сердцевина в широком ореоле, разбитая на сегменты.", 0.95, 0.08],
  ["comet", "Комета", "Яркая голова и быстро гаснущий хвост.", 0.75, 0.12],
  ["lightning", "Молния", "Ломаная жила с коленами и слабым ореолом вокруг.", 0.9, 0.1],
  ["dashed", "Пунктир", "Рваная линия из коротких штрихов с просветами.", 0.8, 0],
  ["twin", "Двойной", "Две параллельные нити с тёмным зазором между ними.", 0.9, 0],
  ["helix", "Спираль", "Две жилы вьются друг вокруг друга по всей длине.", 0.85, 0.05],
  ["needle", "Игла", "Тончайшая нить с яркой точкой у самой головы.", 1, 0],
  ["sparks", "Искры", "Слабая нить и россыпь ярких искр вдоль неё.", 0.9, 0],
  ["pixel", "Пиксельный", "Квадратные ступени, как в старых играх.", 0.5, 0],
  ["wave", "Волна", "Полоса, которая дышит шириной по всей длине.", 0.6, 0.05],
];

function makeStyle([id, label, description, core, grain]) {
  const [across, along] = CURVES[id];
  return Object.freeze(Object.assign({ id, label, description }, { across, along }, { core, grain }));
}

export const TRACER_STYLES = Object.freeze(Array.from(STYLE_ROWS, makeStyle));

export const TRACER_STYLES_SHOWN = 6;

const styleById = new Map(Array.from(TRACER_STYLES, (style) => [style.id, style]));

export function findTracerStyle(id) {
  return styleById.get(String(id || "")) ?? null;
}

export const TRACER_COLOUR_MODES = Object.freeze([
  Object.freeze({ id: "solid", label: "Один цвет", description: "Вся полоса одного цвета." }),
  Object.freeze({ id: "gradient", label: "Переход", description: "Цвета сменяют друг друга по длине следа — от головы к хвосту." }),
  Object.freeze({ id: "rainbow", label: "Радуга", description: "След переливается всеми цветами сам — «RGB»." }),
]);

export const TRACER_COLOUR_MODE_IDS = Object.freeze(Array.from(TRACER_COLOUR_MODES, ({ id }) => id));

export const TRACER_COLOUR_LIMIT = 6;

const HEX_COLOUR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseColour(value) {
  const match = HEX_COLOUR.exec(String(value || "").trim());
  if (match === null) throw new Error(`Цвет должен быть в виде #rrggbb: «${value}».`);
  const full = match[1].length === 6 ? match[1] : match[1].replace(/(.)/g, "$1$1");
  return full.match(/../g).map((pair) => parseInt(pair, 16));
}

export function formatColour(rgb) {
  const hexOf = (channel) => round(clamp(channel / 255) * 255).toString(16).padStart(2, "0");
  return "#" + rgb.map(hexOf).join("");
}

export function normalizeColour(value) {
  return formatColour(parseColour(value));
}

// Сектора радужного круга: каналы дробные, f — доля внутри сектора.
const HUE_SECTORS = [
  (f) => [255, f * 255, 0],
  (f) => [(1 - f) * 255, 255, 0],
  (f) => [0, 255, f * 255],
  (f) => [0, (1 - f) * 255, 255],
  (f) => [f * 255, 0, 255],
  (f) => [255, 0, (1 - f) * 255],
];

export function tracerHueColour(hue) {
  const scaled = (hue - floor(hue)) * 6;
  const whole = floor(scaled);
  return HUE_SECTORS[whole % 6]?.(scaled - whole);
}

// Зерно: FNV-1a по кодовым единицам JSON-текста.
export function seedFrom(value) {
  const text = JSON.stringify(value === undefined ? null : value);
  const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  return units.reduce((hash, unit) => imul(hash ^ unit, 0x01000193), 0x811c9dc5) >>> 0;
}

const NOISE_SIDE = 32;

// Генератор Mulberry32; состояние хранится как знаковое 32-битное целое (биты те же, что у беззнакового).
class Mulberry32 {
  #state;

  constructor(seed) {
    this.#state = seed | 0;
  }

  next() {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    const s = this.#state;
    const mixed = imul(s ^ (s >>> 15), s | 1);
    const scrambled = (mixed + imul(mixed ^ (mixed >>> 7), mixed | 61)) ^ mixed;
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
  }
}

// Решётка шума 32×32; значения хранятся как float32.
function noiseGrid(seed) {
  const source = new Mulberry32(seed);
  const grid = new Float32Array(NOISE_SIDE * NOISE_SIDE);
  for (let i = 0; i < grid.length; i += 1) grid[i] = source.next();
  return grid;
}

const PROFILE_SPREAD = 0.8;
const RAINBOW_SPAN = 0.83;
const DEFAULT_STYLE = "classic";
const DEFAULT_COLOUR = "#ff7a1a";
const DEFAULT_MODE = "solid";
const DEFAULT_CORE = "#ffffff";
const DEFAULT_GLOW = 0.5;

function unknownStyle(style) {
  throw new Error(`Неизвестный вид трассера: ${style}`);
}

function parsePalette(colours, colour) {
  const listed = Array.isArray(colours) && colours.length > 0;
  return (listed ? colours : [colour]).slice(0, TRACER_COLOUR_LIMIT).map((entry) => parseColour(entry));
}

const pickMode = (requested) => (TRACER_COLOUR_MODE_IDS.includes(requested) ? requested : DEFAULT_MODE);

/** Как строка получает базовый цвет: функция (приёмник из трёх каналов, положение вдоль следа). */
function rampFor(mode, palette) {
  if (mode === "rainbow") {
    return (target, v) => {
      target.set(tracerHueColour(v * RAINBOW_SPAN));
    };
  }
  if (mode === "gradient" && palette.length >= 2) {
    const last = palette.length - 1;
    return (target, v) => {
      const p = clamp(v) * last;
      const i = min(last - 1, floor(p));
      const k = p - i;
      for (let channel = 0; channel < 3; channel += 1) target[channel] = lerp(palette[i][channel], palette[i + 1][channel], k);
    };
  }
  return (target) => {
    target.set(palette[0]);
  };
}

/** Столбцы не зависят от строки: положение поперёк (-1…1) и номер клетки решётки шума. */
function columnTable(width) {
  const count = width > 0 ? ceil(width) : 0;
  const across = new Float64Array(count);
  const cell = new Uint8Array(count);
  for (let x = 0; x < count; x += 1) {
    across[x] = ((x + 0.5) / width) * 2 - 1;
    cell[x] = min(NOISE_SIDE - 1, floor(((across[x] + 1) / 2) * NOISE_SIDE));
  }
  return { count, across, cell };
}

export function renderTracerTexture({ width, height, ...options }) {
  const { style = DEFAULT_STYLE, colour = DEFAULT_COLOUR, colours = null, colourMode = DEFAULT_MODE, coreColour = DEFAULT_CORE, glow = DEFAULT_GLOW } = options;
  const shape = findTracerStyle(style) ?? unknownStyle(style);
  const palette = parsePalette(colours, colour);
  const mode = pickMode(colourMode);
  const core = Float64Array.from(parseColour(coreColour));
  const alphaScale = 0.55 + 0.75 * clamp(glow);
  const chosen = [style, palette, mode];
  const grid = noiseGrid(seedFrom([...chosen, coreColour, glow, width, height]));

  const data = new Uint8ClampedArray(4 * width * height);
  const columns = columnTable(width);
  const ramp = rampFor(mode, palette);
  const row = new Float64Array(3);
  const { across, along, grain, core: coreShare } = shape;

  for (let y = 0; y < height; y += 1) {
    const v = clamp((y + 0.5) / height);
    const fade = clamp(along(v));
    const noiseRow = min(NOISE_SIDE - 1, floor(NOISE_SIDE * v)) * NOISE_SIDE;
    ramp(row, v);
    for (let x = 0; x < columns.count; x += 1) {
      const damp = grain > 0 ? 1 - grain * (1 - grid[noiseRow + columns.cell[x]]) : 1;
      const profile = clamp(across(columns.across[x], PROFILE_SPREAD, v)) * damp;
      const share = clamp(profile * profile * profile * coreShare);
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) data[at + channel] = round(lerp(row[channel], core[channel], share));
      data[at + 3] = round(255 * clamp(clamp(profile * fade) * alphaScale));
    }
  }
  return data;
}
