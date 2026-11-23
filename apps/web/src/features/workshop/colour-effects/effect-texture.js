/*
 * Цветовой эффект в 3D-кадре: та же полоса цветов, что уедет в игру
 * (`colourEffectStrip`), текстурой, и та же проекция по оси модели
 * (`colourEffectProjection`) — матрицей отделки «по миру» общего материала
 * перекраски (`recolor-material.js`, `finish.mode: "world"`).
 *
 * Текстуры полос кэшируются по эффекту: плитки готовых видов и кадр берут
 * одну и ту же.
 */

import * as THREE from "three";
import {
  colourEffectProjection,
  colourEffectStrip,
  normalizeColourEffect,
} from "@modovik/climb-contract/recolor/colour-effects";

const strips = new Map();

function stripTexture(effect) {
  const key = JSON.stringify(effect);
  if (strips.has(key)) return strips.get(key);
  const rgba = colourEffectStrip(effect, 64);
  const width = rgba.length / 4;
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = effect.mode === "line" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  if (strips.size > 96) strips.delete(strips.keys().next().value);
  strips.set(key, texture);
  return texture;
}

/**
 * Отделка материала для эффекта на модели с рамкой `frame` (опись:
 * `{ axes, spans }` в осях модели): `{ texture, mode: "world", world }` —
 * или `null` у ровного цвета (его рисует тон материала).
 */
export function effectFinish(input, frame) {
  const effect = normalizeColourEffect(input);
  if (effect.mode === "solid" || !frame) return null;
  const { axis, offset, scale } = colourEffectProjection(effect, frame);
  const world = new THREE.Matrix4().set(
    axis[0] * scale,
    axis[1] * scale,
    axis[2] * scale,
    -offset * scale,
    0,
    0,
    0,
    0.5,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
  );
  return { texture: stripTexture(effect), mode: "world", world, shade: 0 };
}
