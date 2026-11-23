import { hexToRgb, rgbToHex } from "./color.js";
import { normalizeWorldMap } from "./model.js";

const PALETTE_ROWS = [
  ["rainbow", "Радуга", ["#ff5d72", "#ffb454", "#ffe066", "#5fd6a8", "#4fd8e8", "#6ea8ff", "#c69bff", "#ff7ad9"]],
  ["neon", "Неон", ["#ff2bd6", "#00e5ff", "#39ff14", "#ffe600", "#ff6b00", "#7a5cff", "#ff3864", "#00ff9c"]],
  ["pastel", "Пастель", ["#ffb3c1", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"]],
  ["gangs", "Банды", ["#2ecc40", "#9b30ff", "#ffd400", "#1e90ff", "#e01e37"]],
  ["fire", "Огонь", ["#ff3b30", "#ff9500", "#c81e1e", "#ffcc4d", "#ff6a00", "#e0402a", "#ffb000", "#ff7849"]],
  ["ice", "Лёд", ["#8ad7ff", "#3d8bfd", "#b3e5fc", "#4dd0e1", "#64b5f6", "#e1f5fe", "#81d4fa", "#90caf9"]],
  ["forest", "Лес", ["#2e7d32", "#9ccc65", "#43a047", "#c5e1a5", "#1b5e20", "#81c784", "#66bb6a", "#a5d6a7"]],
  ["sunset", "Закат", ["#ff4f9a", "#ff8a3d", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#ef476f", "#3a86ff"]],
  ["mono", "Моно", ["#e6e8eb"]],
  ["random", "Случайно", []],
];

const patch = (base, changes) => ({ ...base, ...changes });

const sealPalette = (id, title, colors) => Object.freeze({ id, title, colors: Object.freeze([...colors]) });

export const ZONE_PALETTES = Object.freeze(Array.from(PALETTE_ROWS, (row) => sealPalette(...row)));

export const ZONE_PALETTE_MAP = Object.freeze(Object.assign({}, ...ZONE_PALETTES.map((palette) => ({ [palette.id]: palette }))));

const SWATCH = { random: [6, 3], limit: 8 };
const GOLDEN_STEP = 0.6180339887;
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];

// ---------- генератор с зерном ----------

// xorshift32: для одного зерна числа повторяются бит в бит, ноль в состояние не попадает.
function* xorshift(seed) {
  let state = ((Math.floor(Number(seed) || 1) * 2654435761) >>> 0) || 1;
  while (true) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    yield state / 4294967296;
  }
}

const takeFrom = (iterator) => () => iterator.next().value;

// Индексы 0, 1, 2… пока индекс меньше предела (обычное сравнение: строка, дробь, true).
function* below(limit) {
  let i = 0;
  while (i < limit) yield i++;
}

// Тройка (R, G, B) до сдвига для каждого из шести секторов круга оттенков.
const sectorTriple = (sector, span, middle) =>
  [
    [span, middle, 0],
    [middle, span, 0],
    [0, span, middle],
    [0, middle, span],
    [middle, 0, span],
    [span, 0, middle],
  ][sector];

const chroma = (lightness, saturation) => saturation * (1 - Math.abs(lightness * 2 - 1));
const ramp = (hue, span) => (1 - Math.abs(((6 * hue) % 2) - 1)) * span;
const toByte = (part, lift) => Math.round((part + lift) * 255);

const hslToHex = (hue, saturation, lightness) => {
  const span = chroma(lightness, saturation);
  const triple = sectorTriple(Math.floor(hue * 6) % 6, span, ramp(hue, span));
  return rgbToHex(triple.map((part) => toByte(part, lightness - span / 2)));
};

export const randomColors = (count, seed = 1) => {
  const roll = takeFrom(xorshift(seed));
  const start = roll();
  return [...below(count)].map((i) =>
    hslToHex((start + i * GOLDEN_STEP) % 1, 0.68 + roll() * 0.22, 0.52 + roll() * 0.12),
  );
};

// ---------- палитры ----------

const cycleFrom = (list) => (_, at) => list[at % list.length];

export const paletteColors = (paletteId, count, seed = 1) => {
  const palette = ZONE_PALETTE_MAP[paletteId];
  return !palette
    ? []
    : palette.id === "random"
      ? randomColors(count, seed)
      : Array.from({ length: count }, cycleFrom(palette.colors));
};

export const paletteSwatch = (paletteId) => {
  const palette = ZONE_PALETTE_MAP[paletteId];
  return !palette
    ? []
    : palette.id === "random"
      ? randomColors(...SWATCH.random)
      : palette.colors.slice(0, SWATCH.limit);
};

export const recolorZones = (config, paletteId, { group = null, seed = 1 } = {}) => {
  const project = normalizeWorldMap(config);
  const { items } = project.zones;
  const slots = items.flatMap((zone, at) => (group === null || (zone.group || "") === (group || "") ? [at] : []));
  const colors = paletteColors(paletteId, slots.length, seed);
  const colorAt = new Map(slots.map((at, order) => [at, colors[order]]));
  const painted = items.map((zone, at) => (colorAt.has(at) ? patch(zone, { color: colorAt.get(at) }) : zone));
  return colors.length ? normalizeWorldMap(patch(project, { zones: patch(project.zones, { items: painted }) })) : project;
};

export const colorLuma = (hex) =>
  hexToRgb(hex).reduce((sum, channel, at) => sum + LUMA_WEIGHTS[at] * channel, 0) / 255;
