/*
 * Цветовые эффекты — один словарь у всех редакторов мастерской: зоны, вода,
 * растительность, арены.
 *
 * Эффект — как цвет ложится на поверхность:
 *   solid    — ровный цвет;
 *   gradient — два цвета, плавно вдоль направления;
 *   rainbow  — радуга вдоль направления (сдвиг — с какого цвета начать);
 *   shimmer  — перелив: оттенки вокруг цвета, как у перламутра, вдоль
 *              направления (в игре — неподвижный: живая анимация цвета у
 *              этих моделей невозможна без анимации развёртки);
 *   line     — линия двумя цветами: полосы по `width` метров, как
 *              сигнальная лента.
 * Направление — `along` (вдоль длинной стороны), `across` (поперёк),
 * `height` (снизу вверх).
 *
 * Одна арифметика у кадра и у установщика: `colourEffectStrip` — полоса
 * цветов (RGBA), которую установщик кладёт в текстуру, а кадр — в шейдер;
 * `colourEffectAt` — цвет в доле `t` полосы.
 */

import { hexBytes, normalizeRecolourHex } from "./colour.js";

export const COLOUR_EFFECT_MODES = Object.freeze(["solid", "gradient", "rainbow", "shimmer", "line"]);
export const COLOUR_EFFECT_LABELS = Object.freeze({
  solid: "Цвет",
  gradient: "Градиент",
  rainbow: "Радуга",
  shimmer: "Перелив",
  line: "Линия",
});
export const COLOUR_EFFECT_DIRECTIONS = Object.freeze(["along", "across", "height"]);
export const COLOUR_EFFECT_DIRECTION_LABELS = Object.freeze({
  along: "Вдоль",
  across: "Поперёк",
  height: "Снизу вверх",
});
/* Ширина полосы линии, м. */
export const COLOUR_EFFECT_WIDTH = Object.freeze([0.2, 20]);

const DEFAULT = Object.freeze({ mode: "solid", colour: "#ff0000", colour2: "#ffffff", direction: "along", width: 1, shift: 0 });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Эффект в порядке: режим, два цвета, направление, ширина полосы, сдвиг радуги. */
/**
 * Облик поверхности из записи проекта: `look`, а если его нет — плоский `colour` (`#rrggbb`) как сплошной цвет. Окно мастерской всегда пишет `look`; плоская запись (как у групп разметки) раньше молча теряла цвет и давала цвет по умолчанию
 * (набор захода 21.11.2026: асфальт вышел штатным серым). `look` главнее; цвет не по форме — как раньше, умолчание.
 */
export const lookOf = (source) => (source?.look !== undefined && source.look !== null ? source.look : typeof source?.colour === "string" && /^#[0-9a-f]{6}$/i.test(source.colour.trim()) ? { mode: "solid", colour: source.colour.trim() } : undefined);

export function normalizeColourEffect(input, fallback = {}) {
  const base = { ...DEFAULT, ...plain(fallback) };
  const source = plain(input);
  const width = Number(source.width);
  const shift = Number(source.shift);
  return {
    mode: COLOUR_EFFECT_MODES.includes(source.mode) ? source.mode : base.mode,
    colour: normalizeRecolourHex(source.colour, base.colour),
    colour2: normalizeRecolourHex(source.colour2, base.colour2),
    direction: COLOUR_EFFECT_DIRECTIONS.includes(source.direction) ? source.direction : base.direction,
    width: Number.isFinite(width)
      ? Math.round(Math.min(COLOUR_EFFECT_WIDTH[1], Math.max(COLOUR_EFFECT_WIDTH[0], width)) * 10) / 10
      : base.width,
    shift: Number.isFinite(shift) ? Math.round((((shift % 360) + 360) % 360)) : base.shift,
  };
}

export const colourEffectIsFlat = (effect) => normalizeColourEffect(effect).mode === "solid";

/* HSL ↔ RGB (0…1) — как у тона перекраски. */
function hslToRgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    const x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 0.5) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

const unit = (hex) => hexBytes(hex).map((value) => value / 255);
const toBytes = (rgb) => rgb.map((value) => Math.max(0, Math.min(255, Math.round(value * 255))));

/**
 * Цвет эффекта в доле `t` (0…1) полосы, байты `[r, g, b]`. У линии `t` —
 * доля периода (две полосы): первая половина — первый цвет.
 */
export function colourEffectAt(input, t) {
  const effect = normalizeColourEffect(input);
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  if (effect.mode === "solid") return hexBytes(effect.colour);
  if (effect.mode === "line") return hexBytes(x < 0.5 ? effect.colour : effect.colour2);
  if (effect.mode === "gradient") {
    const a = unit(effect.colour);
    const b = unit(effect.colour2);
    return toBytes(a.map((value, axis) => value + (b[axis] - value) * x));
  }
  if (effect.mode === "rainbow") return toBytes(hslToRgb(effect.shift / 360 + x, 0.9, 0.55));
  /* Перелив: тон гуляет вокруг цвета (±50°), светлота — волной. */
  const [h, s, l] = rgbToHsl(unit(effect.colour));
  const wave = Math.sin(x * Math.PI * 2);
  return toBytes(hslToRgb(h + (wave * 50) / 360, Math.max(0.35, s), Math.min(0.85, Math.max(0.2, l + Math.cos(x * Math.PI * 4) * 0.12))));
}

/**
 * Полоса цветов эффекта — `size` текселей RGBA (альфа 255): у линии — два
 * цвета пополам (полоса повторяется по `width` метров на цвет), у остальных —
 * от начала до конца направления.
 */
export function colourEffectStrip(input, size = 64) {
  const effect = normalizeColourEffect(input);
  const count = effect.mode === "solid" ? 4 : effect.mode === "line" ? 8 : Math.max(4, size);
  const out = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index += 1) {
    const t = effect.mode === "line" ? (index + 0.5) / count : count > 1 ? index / (count - 1) : 0;
    out.set([...colourEffectAt(effect, t), 255], index * 4);
  }
  return out;
}

/**
 * Развёртка эффекта по модели: ось и пределы её рамки (`frame` — опись:
 * `{ axes: { along, across, height }, spans: { along: [мин, макс], … } }`).
 * Возвращает `{ axis, offset, scale }`: u = (точка · axis − offset) × scale —
 * у линии полоса повторяется каждые `2 × width` метров, у остальных — от 0
 * до 1 на всю длину рамки.
 */
export function colourEffectProjection(input, frame) {
  const effect = normalizeColourEffect(input);
  const axis = frame?.axes?.[effect.direction] || [1, 0, 0];
  const [low, high] = frame?.spans?.[effect.direction] || [0, 1];
  if (effect.mode === "line") return { axis, offset: low, scale: 1 / (2 * effect.width) };
  return { axis, offset: low, scale: 1 / Math.max(0.01, high - low) };
}
