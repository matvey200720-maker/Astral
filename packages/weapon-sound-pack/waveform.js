// Обложка звукового мода: форма волны выстрела на тёмном матовом поле. Без canvas — чистый растр,
// поэтому PNG одинаков байт в байт на любой машине.
import { encodePng } from "@modovik/gfx/png";
import { pcmPeaks } from "@modovik/awc";

export const WAVE_COVER = Object.freeze({ width: 1200, height: 800 });

export function encodePngRgb(rgb, width, height) {
  return encodePng(rgb, width, height, 3);
}

// Рисунок строится в растре вдвое крупнее (по два подпикселя на пиксель) и усредняется.
const SUPER = 2;

const BAR = 20;
const GAP = 12;
const PITCH = BAR + GAP;
const CAP = BAR / 2; // радиус закругления столбика
const SIDE_MARGIN = 0.07;
const MID_LINE = 0.4;
const REACH = 0.27;
const QUIET_FLOOR = 0.0001;

const WAVE_COLOR = [238, 240, 243];
const WAVE_OPACITY = 0.94;

const FIELD_BASE = 12;
const GLOW = { strength: 0.07, scale: 243, centerX: 0.5, centerY: 0.38, radiusX: 0.6, radiusY: 0.45, edge: 0.64 };

// Сколько столбиков помещается и где стоит левый (в подпикселях); ряд центрирован.
function barRow(hiWidth) {
  const margin = Math.round(hiWidth * SIDE_MARGIN);
  const count = Math.floor((hiWidth - 2 * margin + GAP) / PITCH);
  const origin = Math.round((hiWidth - (count * PITCH - GAP)) / 2);
  return { count, origin };
}

// Полувысота каждого столбика: пик по корзине, нормированный на самый громкий, но не меньше радиуса.
function halfHeights(pcm, count, reach) {
  const peaks = pcmPeaks(pcm, count);
  let loudest = QUIET_FLOOR;
  for (const peak of peaks) {
    if (peak > loudest) loudest = peak;
  }
  return Array.from(peaks, (peak) => Math.max(CAP, (peak / loudest) * reach));
}

// Столбик — отрезок между центрами скруглений, расширенный на радиус; пишем попавшие подточки в `hits`.
function stamp(hits, hiWidth, hiHeight, left, mid, half) {
  const top = mid - half;
  const bottom = mid + half;
  const spineTop = top + CAP;
  const spineBottom = bottom - CAP;
  const centerX = left + CAP;
  const firstRow = Math.max(0, Math.floor(top));
  const lastRow = Math.min(hiHeight - 1, Math.ceil(bottom));
  const firstCol = Math.max(0, left);
  const lastCol = Math.min(hiWidth, left + BAR);

  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = row + 0.5;
    const rise = y - Math.min(Math.max(y, spineTop), spineBottom);
    for (let col = firstCol; col < lastCol; col += 1) {
      const run = col + 0.5 - centerX;
      if (run * run + rise * rise <= CAP * CAP) hits[row * hiWidth + col] = 1;
    }
  }
}

// Яркость поля с мягким светом сверху; координаты — целые, без сдвига на полпикселя.
function fieldLevel(x, y, width, height) {
  const dx = (x / width - GLOW.centerX) / GLOW.radiusX;
  const dy = (y / height - GLOW.centerY) / GLOW.radiusY;
  const light = GLOW.strength * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / GLOW.edge);
  return FIELD_BASE + light * GLOW.scale;
}

function flatten(hits, width, height) {
  const hiWidth = width * SUPER;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const rowAt = y * SUPER * hiWidth;
    for (let x = 0; x < width; x += 1) {
      const at = rowAt + x * SUPER;
      const coverage = (hits[at] + hits[at + 1] + hits[at + hiWidth] + hits[at + hiWidth + 1]) / 4;
      const opacity = coverage * WAVE_OPACITY;
      const field = fieldLevel(x, y, width, height);
      const out = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        rgb[out + c] = Math.round(WAVE_COLOR[c] * opacity + field * (1 - opacity));
      }
    }
  }
  return rgb;
}

export function waveformPng(pcm, { width = WAVE_COVER.width, height = WAVE_COVER.height } = {}) {
  // Унарный плюс: числа и строки-числа читаются, а BigInt, как и в арифметике, даёт TypeError.
  const w = +width;
  const h = +height;
  const hiWidth = w * SUPER;
  const hiHeight = h * SUPER;
  const hits = new Uint8Array(hiWidth * hiHeight);

  const { count, origin } = barRow(hiWidth);
  const mid = Math.round(hiHeight * MID_LINE);
  const reach = Math.round(hiHeight * REACH);
  halfHeights(pcm, count, reach).forEach((half, index) => {
    stamp(hits, hiWidth, hiHeight, origin + index * PITCH, mid, half);
  });

  return encodePngRgb(flatten(hits, w, h), w, h);
}
