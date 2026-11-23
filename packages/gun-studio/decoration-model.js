/*
 * Своя модель на стволе (задача 6 ТЗ 17.10.2026): брелок, фигурка,
 * декоративный прицел — маленький `.glb`, который крепится к точке ствола
 * как украшение.
 *
 * Владелец 17.10: «Добавить возможность чтобы люди могли крепить к гану свои
 * модели и они крепились к ганам». Модель встаёт так же, как цветок или
 * брелок (`decorations.js`): точка и нормаль поверхности, поворот вокруг
 * нормали, размер — её наибольшая сторона в сантиметрах; хост
 * (`decorate-drawable`) вешает её на кость ближайшей детали ствола.
 *
 * ОСИ. Модель GLB стоит «Y вверх» — в осях украшения её верх смотрит по
 * нормали поверхности (на верху ствола фигурка стоит, на боку — торчит
 * вбок), середина основания — в точке крепления: x украшения = x модели,
 * y украшения = −z модели, z украшения = y модели.
 *
 * ПРЕДЕЛЫ — как у украшения, а не у ствола (`ATTACHED_MODEL_LIMITS`):
 * в руках до 3 000 треугольников, вдали до 800 (тяжелее — упрощение тем же
 * стягиванием рёбер, что у своей модели ствола), файл до 4 МБ, вершин после
 * разрезки — до 6 000 (предел украшения у хоста).
 *
 * ЛИСТ. У украшения один лист: картинки модели (до трёх) — в клетках 128×128
 * листа 256×256, цвета материалов без картинки — в четвёртой клетке
 * (16 клеток по 32×32). Развёртка картинки зажимается в 0…1 — повтор
 * картинки (тайлинг) в листе не повторяется. Цвет украшения — оттенок,
 * которым лист умножается (белый — как в модели).
 */

import { simplifyMesh, smoothNormals, weld } from "./mesh-simplify.js";

export const ATTACHED_MODEL_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  inputTriangles: 200_000,
  hiTriangles: 3000,
  lowTriangles: 800,
  vertices: 6000,
  images: 3,
  colours: 16,
});
export const ATTACHED_ATLAS_SIZE = 256;
export const ATTACHED_CELL_SIZE = 128;
/* Клетки картинок и клетка цветов в листе 2×2. */
const IMAGE_CELLS = Object.freeze([
  [0, 0],
  [1, 0],
  [0, 1],
]);
const COLOUR_CELL = Object.freeze([1, 1]);
const INSET = 2 / ATTACHED_ATLAS_SIZE;

/**
 * Раскладка листа: какие картинки модели в каких клетках, какие цвета в
 * клетке цветов и куда ложится каждый материал. `alpha` — есть ли
 * прозрачные материалы.
 */
export function attachedModelLayout(model) {
  const images = [];
  const colours = [];
  let alpha = false;
  const slots = model.materials.map((material) => {
    if (material.alpha !== "opaque" || material.colour[3] < 0.999) alpha = true;
    if (material.image !== null && material.image !== undefined) {
      let at = images.findIndex((item) => item.image === material.image && item.colour.join() === material.colour.join());
      if (at < 0 && images.length < ATTACHED_MODEL_LIMITS.images) {
        images.push({ image: material.image, colour: material.colour });
        at = images.length - 1;
      }
      if (at >= 0) return { cell: IMAGE_CELLS[at], colour: null };
    }
    const key = material.colour.map((value) => Math.round(value * 255)).join(",");
    let at = colours.findIndex((colour) => colour.map((value) => Math.round(value * 255)).join(",") === key);
    if (at < 0) {
      if (colours.length < ATTACHED_MODEL_LIMITS.colours) {
        colours.push(material.colour);
        at = colours.length - 1;
      } else at = colours.length - 1;
    }
    return { cell: null, colour: at };
  });
  return { images, colours, slots, alpha, tooManyImages: new Set(model.materials.map((material) => material.image).filter((image) => image !== null && image !== undefined)).size > ATTACHED_MODEL_LIMITS.images };
}

/* Развёртка точки материала в листе: картинка — в своей клетке, цвет — в середине своей клетки цветов. */
function atlasUv(slot, u, v) {
  if (slot.cell) {
    const cu = Math.min(1, Math.max(0, u));
    const cv = Math.min(1, Math.max(0, v));
    const span = 0.5 - 2 * INSET;
    return [slot.cell[0] * 0.5 + INSET + cu * span, slot.cell[1] * 0.5 + INSET + cv * span];
  }
  const x = (slot.colour % 4) + 0.5;
  const y = Math.floor(slot.colour / 4) + 0.5;
  return [COLOUR_CELL[0] * 0.5 + (x / 4) * 0.5, COLOUR_CELL[1] * 0.5 + (y / 4) * 0.5];
}

/** Что будет с моделью: треугольники в руках и вдали, упрощение, отказ (коды для окна). */
export function attachedModelPlan(model) {
  const triangles = model.stats.triangles;
  const layout = attachedModelLayout(model);
  const reasons = [];
  if (triangles > ATTACHED_MODEL_LIMITS.inputTriangles) reasons.push({ code: "triangles", value: triangles, limit: ATTACHED_MODEL_LIMITS.inputTriangles });
  if (layout.tooManyImages) reasons.push({ code: "images", value: layout.images.length, limit: ATTACHED_MODEL_LIMITS.images });
  return {
    ok: reasons.length === 0,
    reasons,
    triangles,
    high: { triangles: Math.min(triangles, ATTACHED_MODEL_LIMITS.hiTriangles), simplified: triangles > ATTACHED_MODEL_LIMITS.hiTriangles },
    low: { triangles: Math.min(triangles, ATTACHED_MODEL_LIMITS.lowTriangles), simplified: triangles > ATTACHED_MODEL_LIMITS.lowTriangles },
  };
}

/**
 * Сетка своей модели в осях украшения (единица — её наибольшая сторона,
 * середина основания — в начале осей, верх модели — по +z): `{ positions,
 * normals, uvs, indices }` обычными массивами, развёртка — в листе модели.
 */
export function attachedModelLocalMesh(model, lod = "high") {
  const layout = attachedModelLayout(model);
  const target = lod === "low" ? ATTACHED_MODEL_LIMITS.lowTriangles : ATTACHED_MODEL_LIMITS.hiTriangles;
  /* Габарит в осях модели. */
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of model.meshes)
    for (let k = 0; k < mesh.positions.length; k += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[k + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[k + axis]);
      }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  /* GLB (x, y, z) → украшение (x, −z, y): верх модели — по нормали. */
  const place = (x, y, z) => [(x - cx) / size, -(z - cz) / size, (y - min[1]) / size];
  const turn = (x, y, z) => [x, -z, y];
  const out = { positions: [], normals: [], uvs: [], indices: [] };
  if (model.stats.triangles <= target) {
    for (const mesh of model.meshes) {
      const slot = layout.slots[mesh.material];
      const base = out.positions.length / 3;
      const normals = mesh.normals || flatNormals(mesh);
      for (let k = 0; k < mesh.positions.length / 3; k += 1) {
        out.positions.push(...place(mesh.positions[k * 3], mesh.positions[k * 3 + 1], mesh.positions[k * 3 + 2]));
        out.normals.push(...turn(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]));
        out.uvs.push(...atlasUv(slot, mesh.uvs ? mesh.uvs[k * 2] : 0, mesh.uvs ? mesh.uvs[k * 2 + 1] : 0));
      }
      for (const index of mesh.indices) out.indices.push(base + index);
    }
    return out;
  }
  /* Тяжёлая — сварка, упрощение, нормали заново; вершины — по углам. */
  const all = [];
  const triangles = [];
  const uvs = [];
  const materials = [];
  for (const mesh of model.meshes) {
    const base = all.length / 3;
    for (let k = 0; k < mesh.positions.length; k += 3) all.push(mesh.positions[k], mesh.positions[k + 1], mesh.positions[k + 2]);
    const slot = layout.slots[mesh.material];
    for (let k = 0; k + 2 < mesh.indices.length; k += 3) {
      for (let j = 0; j < 3; j += 1) {
        const index = mesh.indices[k + j];
        triangles.push(base + index);
        uvs.push(...atlasUv(slot, mesh.uvs ? mesh.uvs[index * 2] : 0, mesh.uvs ? mesh.uvs[index * 2 + 1] : 0));
      }
      materials.push(mesh.material);
    }
  }
  const welded = weld(Float64Array.from(all));
  const reduced = simplifyMesh(
    { positions: welded.positions, triangles: Int32Array.from(triangles, (index) => welded.map[index]), uvs: Float32Array.from(uvs), materials: Int32Array.from(materials) },
    target,
  );
  const normals = smoothNormals(reduced.positions, reduced.triangles);
  const keys = new Map();
  for (let t = 0; t < reduced.triangles.length / 3; t += 1)
    for (let j = 0; j < 3; j += 1) {
      const index = reduced.triangles[t * 3 + j];
      const n = [normals[t * 9 + j * 3], normals[t * 9 + j * 3 + 1], normals[t * 9 + j * 3 + 2]];
      const uv = [reduced.uvs[t * 6 + j * 2], reduced.uvs[t * 6 + j * 2 + 1]];
      const key = `${index}:${n.map((value) => Math.round(value * 1000)).join(",")}:${uv.map((value) => Math.round(value * 1e5)).join(",")}`;
      let at = keys.get(key);
      if (at === undefined) {
        at = out.positions.length / 3;
        keys.set(key, at);
        out.positions.push(...place(reduced.positions[index * 3], reduced.positions[index * 3 + 1], reduced.positions[index * 3 + 2]));
        out.normals.push(...turn(...n));
        out.uvs.push(...uv);
      }
      out.indices.push(at);
    }
  return out;
}

/* Плоские нормали сетки без своих (по граням вокруг вершины). */
function flatNormals(mesh) {
  const normals = new Float32Array(mesh.positions.length);
  for (let k = 0; k + 2 < mesh.indices.length; k += 3) {
    const [a, b, c] = [mesh.indices[k], mesh.indices[k + 1], mesh.indices[k + 2]];
    const e1 = [0, 1, 2].map((axis) => mesh.positions[b * 3 + axis] - mesh.positions[a * 3 + axis]);
    const e2 = [0, 1, 2].map((axis) => mesh.positions[c * 3 + axis] - mesh.positions[a * 3 + axis]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let axis = 0; axis < 3; axis += 1) normals[v * 3 + axis] += n[axis];
  }
  for (let v = 0; v < normals.length / 3; v += 1) {
    const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    for (let axis = 0; axis < 3; axis += 1) normals[v * 3 + axis] /= length;
    if (!Number.isFinite(normals[v * 3])) normals.set([0, 1, 0], v * 3);
  }
  return normals;
}

/**
 * Лист своей модели 256×256: картинки (`pictures` — RGBA 128×128 по
 * порядку `layout.images`, уже вписанные вызывающим) с цветом материала,
 * клетка цветов и оттенок украшения (`tint`, «#rrggbb»).
 */
export function attachedModelAtlas(layout, pictures = [], tint = "#ffffff") {
  const size = ATTACHED_ATLAS_SIZE;
  const cell = ATTACHED_CELL_SIZE;
  const rgba = new Uint8Array(size * size * 4);
  const shade = [1, 3, 5].map((offset) => Number.parseInt(String(tint).slice(offset, offset + 2), 16) / 255 || 1);
  const put = (x, y, r, g, b, a) => {
    const at = (y * size + x) * 4;
    rgba[at] = Math.round(Math.min(255, r * shade[0]));
    rgba[at + 1] = Math.round(Math.min(255, g * shade[1]));
    rgba[at + 2] = Math.round(Math.min(255, b * shade[2]));
    rgba[at + 3] = layout.alpha ? Math.round(a) : 255;
  };
  layout.images.forEach((entry, index) => {
    const [cx, cy] = IMAGE_CELLS[index];
    const picture = pictures[index];
    for (let y = 0; y < cell; y += 1)
      for (let x = 0; x < cell; x += 1) {
        const from = picture && picture.width === cell && picture.height === cell ? (y * cell + x) * 4 : -1;
        const [r, g, b, a] = from >= 0 ? [picture.rgba[from], picture.rgba[from + 1], picture.rgba[from + 2], picture.rgba[from + 3]] : [255, 255, 255, 255];
        put(cx * cell + x, cy * cell + y, r * entry.colour[0], g * entry.colour[1], b * entry.colour[2], a * entry.colour[3]);
      }
  });
  const step = cell / 4;
  layout.colours.forEach((colour, index) => {
    const x0 = COLOUR_CELL[0] * cell + (index % 4) * step;
    const y0 = COLOUR_CELL[1] * cell + Math.floor(index / 4) * step;
    for (let y = y0; y < y0 + step; y += 1)
      for (let x = x0; x < x0 + step; x += 1) put(x, y, colour[0] * 255, colour[1] * 255, colour[2] * 255, colour[3] * 255);
  });
  return { width: size, height: size, rgba };
}
