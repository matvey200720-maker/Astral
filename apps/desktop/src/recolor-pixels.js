/*
 * Пиксели листов A8R8G8B8 — общее у ангара и маппинга.
 *
 * Листы авторов этих модов — картинки без сжатия со всеми мип-уровнями: в
 * памяти B, G, R, A. Тон кладётся на первый уровень, остальные
 * пересчитываются из него (иначе издалека стена была бы серой, а вблизи —
 * цветной).
 *
 * Тон — `tintPixel` из `@modovik/climb-contract/recolor` при полной силе:
 * тогда итог зависит только от яркости пикселя, и он считается таблицей на
 * 1024 ступени — лист 2048×2048 это четыре миллиона пикселей, формула на
 * каждый стоила бы секунд.
 */

import { tintPixel, tintTarget } from "@modovik/climb-contract/recolor";

/* A8R8G8B8 в памяти — B, G, R, A → RGBA. */
export function bgraToRgba(payload, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = payload[at + 2];
    rgba[at + 1] = payload[at + 1];
    rgba[at + 2] = payload[at];
    rgba[at + 3] = payload[at + 3];
  }
  return rgba;
}

/* Уровень вдвое меньше — среднее четырёх соседей. */
export function halve(rgba, width, height) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const top = Math.min(height - 1, y * 2) * width;
    const bottom = Math.min(height - 1, y * 2 + 1) * width;
    for (let x = 0; x < w; x += 1) {
      const left = Math.min(width - 1, x * 2) * 4;
      const right = Math.min(width - 1, x * 2 + 1) * 4;
      const a = top * 4 + left;
      const b = top * 4 + right;
      const c = bottom * 4 + left;
      const d = bottom * 4 + right;
      const at = (y * w + x) * 4;
      for (let channel = 0; channel < 4; channel += 1)
        out[at + channel] = (rgba[a + channel] + rgba[b + channel] + rgba[c + channel] + rgba[d + channel] + 2) >> 2;
    }
  }
  return { rgba: out, width: w, height: h };
}

/** Все уровни A8R8G8B8 из нового первого — байт в байт той длины, что у файла. */
export function argbPayload(rgba, texture) {
  const out = new Uint8Array(texture.bytes);
  let level = { rgba, width: texture.width, height: texture.height };
  let offset = 0;
  for (let index = 0; index < texture.levels; index += 1) {
    const length = level.width * level.height * 4;
    for (let at = 0; at < length; at += 4) {
      out[offset + at] = level.rgba[at + 2];
      out[offset + at + 1] = level.rgba[at + 1];
      out[offset + at + 2] = level.rgba[at];
      out[offset + at + 3] = level.rgba[at + 3];
    }
    offset += length;
    if (index + 1 < texture.levels) level = halve(level.rgba, level.width, level.height);
  }
  if (offset !== out.length) throw new Error(`Текстура ${texture.name}: уровни не сошлись с длиной (${offset} из ${out.length}).`);
  return out;
}

const LUT_STEPS = 1024;

/** Таблица тона: яркость (ступень) → RGB. */
export function tintTable(tint) {
  const target = tintTarget(tint.colour);
  const options = { ref: tint.ref, brightness: tint.brightness, strength: 1, lift: tint.lift || 0 };
  const table = new Uint8ClampedArray(LUT_STEPS * 3);
  for (let step = 0; step < LUT_STEPS; step += 1) {
    const grey = step / (LUT_STEPS - 1);
    const [r, g, b] = tintPixel(grey, grey, grey, target, options);
    table[step * 3] = r * 255;
    table[step * 3 + 1] = g * 255;
    table[step * 3 + 2] = b * 255;
  }
  return table;
}

/** Тон одного цвета (ровный лист) — та же таблица, что у пикселей листа. */
export function tintedColour(tint, [r, g, b]) {
  const table = tintTable(tint);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const step = Math.min(LUT_STEPS - 1, Math.round(luma * (LUT_STEPS - 1))) * 3;
  return [table[step], table[step + 1], table[step + 2]];
}

/**
 * Тон по меткам текселей: `tints` — метка → тон (или нет); без `labels` —
 * у всех текселей метка 1. Прозрачность пикселя не трогается.
 */
export function tintByLabels(rgba, labels, tints) {
  const tables = Object.fromEntries(
    Object.entries(tints)
      .filter(([, tint]) => tint)
      .map(([label, tint]) => [label, tintTable(tint)]),
  );
  const out = new Uint8ClampedArray(rgba);
  for (let at = 0, texel = 0; at < rgba.length; at += 4, texel += 1) {
    const table = tables[labels ? labels[texel] : 1];
    if (!table) continue;
    const luma = (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
    const step = Math.min(LUT_STEPS - 1, Math.round(luma * (LUT_STEPS - 1))) * 3;
    out[at] = table[step];
    out[at + 1] = table[step + 1];
    out[at + 2] = table[step + 2];
  }
  return out;
}
