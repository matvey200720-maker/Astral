/*
 * Плашка в кадре — квадрат с картинкой, как плашка в игре
 * (`compile-emblem-plates`): стороны и щиты зданий, эмблемы, надписи,
 * своё на месте объёмных букв и знаков. Общая у редакторов зданий и арены.
 *
 * Место — `decal` (`{ point, normal, width, height, angle?, opacity? }`,
 * метры сцены): квадрат стоит лицом по нормали, «вправо» и «вверх» — как у
 * наклейки (`decalBasis`), на `offset` метров перед точкой.
 */

import * as THREE from "three";
import { decalBasis } from "@modovik/climb-contract/recolor/decal";

function canvasOf(width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
}

/**
 * Плашка-объект кадра: `{ object, dispose() }` (текстура снимается вместе с
 * ней). `pick` — чья это плашка (`{ id, kind }` эмблемы или надписи): по ней
 * кадр узнаёт, что щёлкнули по ней, и редактор берёт её мышкой.
 */
export function plateObject(decal, texture, { offset = 0.06, pick = null } = {}) {
  const { normal, right, up } = decalBasis(decal.normal, decal.angle || 0);
  const geometry = new THREE.PlaneGeometry(decal.width, decal.height);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: decal.opacity ?? 1,
    alphaTest: 0.02,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...normal));
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.position.set(decal.point[0] + normal[0] * offset, decal.point[1] + normal[1] * offset, decal.point[2] + normal[2] * offset);
  mesh.receiveShadow = true;
  if (pick) mesh.userData.pick = { ...pick, point: [...decal.point] };
  return {
    object: mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/* Пиксели → текстура плашки: строки картинки сверху вниз, как в листе игры. */
export function plateTexture(rgba, width, height) {
  const canvas = canvasOf(width, height);
  const context = context2d(canvas);
  if (!context) return new THREE.Texture();
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
