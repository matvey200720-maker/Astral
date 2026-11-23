/*
 * Грани вывесок станции для названия заправки (задача 5 ТЗ 17.10.2026,
 * вечер): где у станции стоят светящиеся вывески её бренда и какого они
 * размера. Сетку берём у сцены кадра (`loadSceneAsset`, метры, Z вверх, начало
 * сцены — середина площадки): плашка названия встаёт перед гранью и закрывает
 * старую надпись целиком — размером с грань.
 *
 * Лист вывески — часть атласа: одним листом рисуют и столб, и логотип
 * сверху. Поэтому «лист надписи» здесь — грань: отвесная плоскость, где
 * лежат треугольники вывесочного листа станции (светящегося или своего
 * бренда), в рамке по осям плашки. Мелочь (меньше 0,5 м²), потолки и полы не
 * считаются.
 */

import { decalBasis } from "@modovik/climb-contract/recolor/decal";

/* Лист вывески бренда станции — по имени (как `BRANDS` в `scripts/prepare-shop-outside.mjs`). */
const BRAND_SHEET = Object.freeze({
  xero: /xero/,
  ltd: /(^|_)ltd/,
  ron: /(^|_)ron(_|\d|$)/,
  globe: /globe/,
});

/* Станции без известного бренда: лист, что зовётся вывеской или заправкой; окна, щиты кварталов и лампы — не вывеска станции. */
const GENERIC_SHEET = /(gas|sign|fuel|petrol|oil|station|brand|logo)/;
const NOT_SIGN_SHEET = /(window|billboard|tpage|t_page|light|ceiling|carsign|smoking|esm_|interiorfake)/;

const MIN_AREA = 0.5;
const MIN_SIDE = 0.4;
const MAX_WIDTH = 22;
/* Высота плашки — до предела эмблем (`OUTSIDE_EMBLEM_SIZE`). */
const MAX_HEIGHT = 12;
const MAX_FACES = 8;
/* Треугольники одной грани: нормали в пределах 8° и плоскости — в 30 см. */
const COS_TILT = Math.cos((8 * Math.PI) / 180);
const PLANE_TOLERANCE = 0.3;
/* Куски одной плоскости дальше этого друг от друга — разные грани. */
const GAP = 0.6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Лист вывески станции: у станции с известным брендом — лист с его именем;
 * иначе — лист, что зовётся вывеской или заправкой. Окна, щиты кварталов и
 * лампы не вывеска.
 */
export function isSignMaterial(material, brand) {
  if (!material || material.decal || material.part !== "signs") return false;
  const name = String(material.name || "").toLowerCase();
  if (NOT_SIGN_SHEET.test(name)) return false;
  const rule = BRAND_SHEET[brand];
  return rule ? rule.test(name) : GENERIC_SHEET.test(name);
}

/**
 * Грани вывесок: `[{ id, sheet, centre, normal, width, height, area }]`,
 * крупные вперёд. `asset` — сцена места (`loadSceneAsset`), `brand` — бренд
 * станции из описи (`place.brand`).
 */
export function signFaces(asset, brand = null) {
  if (!asset?.meshes?.length) return [];
  const triangles = [];
  for (const mesh of asset.meshes) {
    const material = asset.materials?.[mesh.material];
    if (!isSignMaterial(material, brand)) continue;
    const { positions, normals, indices } = mesh;
    const point = (index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
      const pa = point(a);
      const pb = point(b);
      const pc = point(c);
      const cut = cross(sub(pb, pa), sub(pc, pa));
      const size = length(cut);
      if (size < 1e-5) continue;
      let normal = [cut[0] / size, cut[1] / size, cut[2] / size];
      /* Наружу — по нормалям вершин, а не по обходу: у выгнутых вывесок обход бывает любым. */
      if (normals) {
        const given = [0, 1, 2].map((axis) => normals[a * 3 + axis] + normals[b * 3 + axis] + normals[c * 3 + axis]);
        if (length(given) > 0.1 && dot(normal, given) < 0) normal = normal.map((value) => -value);
      }
      if (Math.abs(normal[2]) > 0.5) continue;
      const flat = Math.hypot(normal[0], normal[1]) || 1;
      triangles.push({ points: [pa, pb, pc], normal: [normal[0] / flat, normal[1] / flat, 0], area: size / 2, sheet: material.name || "" });
    }
  }

  /* Плоскости: нормаль и расстояние до начала. */
  const planes = [];
  for (const triangle of triangles) {
    const centroid = triangle.points[0].map((_, axis) => (triangle.points[0][axis] + triangle.points[1][axis] + triangle.points[2][axis]) / 3);
    const distance = dot(triangle.normal, centroid);
    const plane = planes.find((item) => dot(item.normal, triangle.normal) >= COS_TILT && Math.abs(item.distance - distance) <= PLANE_TOLERANCE);
    if (plane) plane.triangles.push(triangle);
    else planes.push({ normal: triangle.normal, distance, triangles: [triangle] });
  }

  const faces = [];
  for (const plane of planes) {
    const total = plane.triangles.reduce((sum, item) => sum + item.area, 0);
    const weighted = plane.triangles.reduce((sum, item) => [sum[0] + item.normal[0] * item.area, sum[1] + item.normal[1] * item.area], [0, 0]);
    const norm = Math.hypot(weighted[0], weighted[1]) || 1;
    const normal = [weighted[0] / norm, weighted[1] / norm, 0];
    const { right, up } = decalBasis(normal, 0);
    const distance = plane.triangles.reduce((sum, item) => sum + dot(normal, item.points[0]) * item.area, 0) / Math.max(total, 1e-6);
    /* Куски плоскости — связными группами: рамки (по осям плашки) ближе `GAP` — одна грань. */
    const boxes = plane.triangles.map((item) => {
      const s = item.points.map((p) => dot(p, right));
      const t = item.points.map((p) => dot(p, up));
      return { s: [Math.min(...s), Math.max(...s)], t: [Math.min(...t), Math.max(...t)], area: item.area, sheet: item.sheet };
    });
    const parent = boxes.map((_, index) => index);
    const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const near = boxes[i].s[0] - GAP <= boxes[j].s[1] && boxes[j].s[0] - GAP <= boxes[i].s[1] && boxes[i].t[0] - GAP <= boxes[j].t[1] && boxes[j].t[0] - GAP <= boxes[i].t[1];
        if (near) parent[find(i)] = find(j);
      }
    const groups = new Map();
    boxes.forEach((box, index) => {
      const key = find(index);
      const group = groups.get(key) || { s: [Infinity, -Infinity], t: [Infinity, -Infinity], area: 0, sheets: new Map() };
      group.s = [Math.min(group.s[0], box.s[0]), Math.max(group.s[1], box.s[1])];
      group.t = [Math.min(group.t[0], box.t[0]), Math.max(group.t[1], box.t[1])];
      group.area += box.area;
      group.sheets.set(box.sheet, (group.sheets.get(box.sheet) || 0) + box.area);
      groups.set(key, group);
    });
    for (const group of groups.values()) {
      const width = group.s[1] - group.s[0];
      const height = group.t[1] - group.t[0];
      if (group.area < MIN_AREA || width < MIN_SIDE || height < MIN_SIDE || width > MAX_WIDTH || height > MAX_HEIGHT) continue;
      const cs = (group.s[0] + group.s[1]) / 2;
      const ct = (group.t[0] + group.t[1]) / 2;
      const centre = [0, 1, 2].map((axis) => right[axis] * cs + up[axis] * ct + normal[axis] * distance);
      faces.push({
        sheet: [...group.sheets].sort((a, b) => b[1] - a[1])[0][0],
        centre: centre.map((value) => round(value)),
        normal: normal.map((value) => round(value, 3)),
        width: round(width),
        height: round(height),
        area: round(group.area, 1),
      });
    }
  }
  faces.sort((a, b) => b.area - a.area);
  return faces.slice(0, MAX_FACES).map((face, index) => ({ id: `f${index + 1}`, ...face }));
}
