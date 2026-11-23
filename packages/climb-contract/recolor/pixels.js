/*
 * Перекраска пикселей текстуры — то, что установщик пишет в игру.
 *
 * Вход — уровень текстуры RGBA (байты 0…255), выход — новый массив того же
 * размера. Кадр редактора делает то же самое шейдером
 * (`features/workshop/model-stage/recolor-material.js`) по тем же формулам
 * `colour.js`; тест держит их равенство на образцах.
 *
 * Операция перекраски (`op`):
 *   { kind: "tint", colour, ref, brightness, strength, rainbow, emblem }
 *     — светотень текстуры остаётся, тон и насыщенность — от цвета;
 *       `rainbow` — `{ scale, phase }` или `null`; `emblem` — своя картинка
 *       поверх перекраски в прямоугольнике развёртки (см. `compositeEmblem`);
 *   { kind: "flat", colour, alpha } — ровная заливка (текстуры 4×4 модов),
 *     её пишет `flat.js` без разбора пикселей.
 */

import { rainbowHue, tintPixel, tintTarget } from "./colour.js";

const clampByte = (value) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/**
 * Перекраска уровня RGBA по операции `tint`. Прозрачность пикселя не
 * трогается: декали и линии остаются декалями.
 */
export function tintRgba(rgba, width, height, op) {
  const out = new Uint8ClampedArray(rgba.length);
  const target = tintTarget(op.colour);
  const options = {
    ref: Number(op.ref) > 0 ? Number(op.ref) : 0.5,
    brightness: Number.isFinite(Number(op.brightness)) ? Number(op.brightness) : 1,
    strength: Number.isFinite(Number(op.strength)) ? Number(op.strength) : 1,
    hue: null,
  };
  const rainbow = op.rainbow || null;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (rainbow) options.hue = rainbowHue((x + 0.5) / width, v, rainbow);
      const [r, g, b] = tintPixel(rgba[at] / 255, rgba[at + 1] / 255, rgba[at + 2] / 255, target, options);
      out[at] = clampByte(r * 255);
      out[at + 1] = clampByte(g * 255);
      out[at + 2] = clampByte(b * 255);
      out[at + 3] = rgba[at + 3];
    }
  }
  return out;
}

/*
 * ЭМБЛЕМА
 *
 * Картинка человека ложится поверх перекраски в прямоугольник развёртки
 * `rect: [u0, v0, u1, v1]` (доли листа, v — вниз, как у DirectX). `turn` —
 * поворот картинки в этом прямоугольнике четвертями (0…3): острова развёртки
 * лежат в листе как им удобно, и «верх» стены не всегда «верх» листа.
 * `mirror` — отражение по горизонтали (остров развёрнут зеркально).
 * `opacity` — 0…1. Картинка вписана с сохранением пропорций и отступом
 * `margin` (доля меньшей стороны прямоугольника).
 */
function sampleBilinear(image, u, v) {
  const { rgba, width, height } = image;
  const fx = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const fy = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const out = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = rgba[(y0 * width + x0) * 4 + channel] * (1 - tx) + rgba[(y0 * width + x1) * 4 + channel] * tx;
    const bottom = rgba[(y1 * width + x0) * 4 + channel] * (1 - tx) + rgba[(y1 * width + x1) * 4 + channel] * tx;
    out[channel] = top * (1 - ty) + bottom * ty;
  }
  return out;
}

/** Точка прямоугольника (доли 0…1) → точка картинки с учётом поворота и отражения. */
export function emblemLocal(s, t, { turn = 0, mirror = false } = {}) {
  let a = mirror ? 1 - s : s;
  let b = t;
  for (let step = 0; step < (((turn % 4) + 4) % 4); step += 1) [a, b] = [b, 1 - a];
  return [a, b];
}

/**
 * Вписывание картинки в прямоугольник с сохранением пропорций: доли
 * прямоугольника `[s0, t0, s1, t1]`, где лежит картинка.
 */
export function emblemBox(rectAspect, imageAspect, margin = 0.08) {
  const inner = 1 - margin * 2;
  let width = inner;
  let height = inner;
  if (imageAspect > rectAspect) height = (inner * rectAspect) / imageAspect;
  else width = (inner * imageAspect) / rectAspect;
  const s0 = (1 - width) / 2;
  const t0 = (1 - height) / 2;
  return [s0, t0, s0 + width, t0 + height];
}

/**
 * Эмблема поверх уровня RGBA (на месте). `slot` — `{ rect, turn, mirror,
 * aspect }` (aspect — ширина к высоте стены в метрах), `image` —
 * `{ rgba, width, height }`, `opacity` — 0…1.
 */
export function compositeEmblem(rgba, width, height, slot, image, { opacity = 1, margin = 0.08 } = {}) {
  if (!image || !slot) return rgba;
  const [u0, v0, u1, v1] = slot.rect;
  const turned = ((slot.turn || 0) % 2) === 1;
  const imageAspect = turned ? image.height / image.width : image.width / image.height;
  const box = emblemBox(slot.aspect || (u1 - u0) / Math.max(1e-6, v1 - v0), imageAspect, margin);
  const xStart = Math.max(0, Math.floor(u0 * width));
  const xEnd = Math.min(width, Math.ceil(u1 * width));
  const yStart = Math.max(0, Math.floor(v0 * height));
  const yEnd = Math.min(height, Math.ceil(v1 * height));
  for (let y = yStart; y < yEnd; y += 1) {
    const t = ((y + 0.5) / height - v0) / (v1 - v0);
    if (t < box[1] || t > box[3]) continue;
    for (let x = xStart; x < xEnd; x += 1) {
      const s = ((x + 0.5) / width - u0) / (u1 - u0);
      if (s < box[0] || s > box[2]) continue;
      const [a, b] = emblemLocal((s - box[0]) / (box[2] - box[0]), (t - box[1]) / (box[3] - box[1]), slot);
      const [r, g, bl, alpha] = sampleBilinear(image, a, b);
      const cover = (alpha / 255) * opacity;
      if (cover <= 0) continue;
      const at = (y * width + x) * 4;
      rgba[at] = clampByte(rgba[at] + (r - rgba[at]) * cover);
      rgba[at + 1] = clampByte(rgba[at + 1] + (g - rgba[at + 1]) * cover);
      rgba[at + 2] = clampByte(rgba[at + 2] + (bl - rgba[at + 2]) * cover);
    }
  }
  return rgba;
}

/**
 * Операция целиком над уровнем RGBA: перекраска и, если есть, эмблема.
 * `images` — картинки эмблем по отпечатку (`{ [asset]: { rgba, width,
 * height } }`), их приносит установщик.
 */
export function recolourRgba(rgba, width, height, op, images = {}) {
  if (!op || op.kind !== "tint") return new Uint8ClampedArray(rgba);
  const out = op.colour ? tintRgba(rgba, width, height, op) : new Uint8ClampedArray(rgba);
  for (const emblem of op.emblems || []) {
    const image = images[emblem.asset];
    if (image) compositeEmblem(out, width, height, emblem.slot, image, emblem);
  }
  return out;
}
