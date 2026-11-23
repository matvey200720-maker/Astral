/*
 * Зоны детали — части ствола по его собственной форме (ТЗ 04.10.2026,
 * задача 4: «шаблоны под конкретный ган учитывают его UV и форму»).
 *
 * Шаблон знает не пиксели развёртки, а смысл: «затвор чёрный, рамка песочная»,
 * «полоса вдоль ствола». Где у этого ствола затвор, решает его геометрия:
 * треугольник развёртки попадает в зону по тому, где он лежит на модели —
 * выше или ниже середины, ближе к дулу или к прикладу. Маска зоны — растр в
 * пикселях развёртки детали: им слой шаблона обрезается, как маской слоя у
 * человека, и правится той же кистью «Скрыть/Показать».
 *
 * Координаты — модели, до кадрирования сценой (как у `gun-fit.js`). Ось
 * ствола — самая длинная сторона габарита; дуло — тот её конец, где модель
 * тоньше по высоте (у рукояти и приклада высота больше, у ствола — меньше).
 */

import * as THREE from "three";

export const ZONES = Object.freeze(["top", "bottom", "front", "rear", "stripe"]);

/* Доли габарита: «верх» — выше 58 % высоты, «полоса» — пояс 46…62 %. */
const ZONE_RULES = Object.freeze({
  top: ({ h }) => h > 0.58,
  bottom: ({ h }) => h <= 0.58,
  front: ({ l }) => l > 0.62,
  rear: ({ l }) => l < 0.38,
  stripe: ({ h }) => h > 0.46 && h < 0.62,
});

const component = (vector, axis) =>
  axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z;

function eachTriangle(meshes, visit) {
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uvs = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  for (const { mesh, groups } of meshes || []) {
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    const uv = geometry?.attributes?.uv;
    if (!position) continue;
    const index = geometry.index;
    const total = index ? index.count : position.count;
    const ranges = groups?.length
      ? groups.map((group) => [group.start, Math.min(total, group.start + group.count)])
      : [[0, total]];
    for (const [start, end] of ranges)
      for (let at = start; at + 2 < end; at += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = index ? index.getX(at + corner) : at + corner;
          points[corner].fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
          if (uv) uvs[corner].fromBufferAttribute(uv, vertex);
        }
        visit(points, uv ? uvs : null);
      }
  }
}

/**
 * Каркас зон модели: габарит, ось ствола и где дуло. `entries` — детали
 * сцены (`{ meshes }`), корень уже посчитан в начале координат.
 */
export function measureZones(root, entries, axis) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const length = component(size, axis) || 1;
  const min = component(box.min, axis);
  /* Высота модели у каждого конца оси: в крайних 15 % длины. */
  const ends = [
    { low: Infinity, high: -Infinity },
    { low: Infinity, high: -Infinity },
  ];
  for (const entry of entries)
    eachTriangle(entry.meshes, (points) => {
      for (const point of points) {
        const share = (component(point, axis) - min) / length;
        const end = share < 0.15 ? ends[0] : share > 0.85 ? ends[1] : null;
        if (!end) continue;
        end.low = Math.min(end.low, point.y);
        end.high = Math.max(end.high, point.y);
      }
    });
  const height = (end) => (end.high > end.low ? end.high - end.low : Infinity);
  /* Дуло — тонкий конец: +1 — в сторону роста координаты оси. */
  const muzzle = height(ends[1]) <= height(ends[0]) ? 1 : -1;
  return { box, size, axis, muzzle };
}

/**
 * Маска зоны детали — холст размером с её развёртку, белый там, где лежат
 * треугольники зоны. `null` — у детали нет развёртки или зона пуста.
 */
export function rasterizeZone(entry, frame, zone, createCanvas) {
  const rule = ZONE_RULES[zone];
  if (!rule || !frame || !entry?.meshes?.length) return null;
  const width = entry.width || 512;
  const height = entry.height || 512;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  const matrix = entry.mapper?.matrix || new THREE.Matrix3();
  const { box, size, axis, muzzle } = frame;
  const along = component(size, axis) || 1;
  const centre = new THREE.Vector3();
  const mapped = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  let drawn = 0;
  eachTriangle(entry.meshes, (points, uvs) => {
    if (!uvs) return;
    centre.copy(points[0]).add(points[1]).add(points[2]).divideScalar(3);
    const h = size.y > 0 ? (centre.y - box.min.y) / size.y : 0.5;
    const share = (component(centre, axis) - component(box.min, axis)) / along;
    const l = muzzle > 0 ? share : 1 - share;
    if (!rule({ h, l })) return;
    for (let corner = 0; corner < 3; corner += 1)
      mapped[corner].copy(uvs[corner]).applyMatrix3(matrix);
    /* Развёртка бывает за краем [0,1] (плитка): треугольник сдвигается
       целым шагом туда, где лежит его середина. */
    const shiftU = Math.floor((mapped[0].x + mapped[1].x + mapped[2].x) / 3);
    const shiftV = Math.floor((mapped[0].y + mapped[1].y + mapped[2].y) / 3);
    context.beginPath();
    mapped.forEach((point, corner) => {
      const x = (point.x - shiftU) * width;
      const y = (point.y - shiftV) * height;
      if (corner === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
    /* Обводка закрывает щели между соседними треугольниками зоны. */
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.stroke();
    drawn += 1;
  });
  return drawn ? canvas : null;
}
