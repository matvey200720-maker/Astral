/*
 * Зоны со своей формой (задача 23 ТЗ 18.10.2026): ширина линии, высота стенки и неон.
 *
 * Если у вида форма не как у мода (`zonesShapeChanged`), его модели Astral строит заново из сеток мода под теми же
 * именами файлов (хост, `compile-sign-models`; тот же путь, что у зелёных зон при подготовке набора и у МСЛ-зон):
 *
 *   • сетка — `zoneShapeMesh` (`@modovik/climb-contract/recolor/zones`): лента нужной ширины и стенка нужной высоты;
 *     одна функция у кадра редактора и здесь — в игру уходит ровно то, что в кадре;
 *   • лист — свой у каждой зоны вида (у обвода — по листу на линию, имена мода `1` и `2`): ровный цвет — клетка 4×4
 *     с альфой зоны, эффект — полоса цветов с развёрткой по оси зоны (та же проекция, что у `restyle-drawable`);
 *   • шейдер — как у мода (`alpha.sps`) или светящийся (`emissive_alpha.sps` / `emissive.sps`), если у вида неон или у
 *     мода свечение уже есть (запретные: ×6): множитель свечения — у зоны (`zoneLook().emissive`);
 *   • рамки архетипов в типах (`.ytyp` набора) вырастают до новой сетки (`zone-bounds.js`): игра отсекает вещь по
 *     рамке архетипа. Карта не трогается.
 *
 * Вид с формой как у мода сюда не попадает: его файлы — автора (ровный цвет на месте, эффект — `restyle-drawable`).
 * Невидимые зоны (альфа 0) не пересобираются: им хватает прежней правки листа.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import { joaat, readDrawable } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { colourEffectProjection, colourEffectStrip } from "@modovik/climb-contract/recolor/colour-effects";
import {
  ZONES,
  ZONE_KINDS,
  zoneKindHasWidth,
  zoneLook,
  zoneShape,
  zoneShapeMesh,
  zonesShapeChanged,
  normalizeZonesProject,
} from "@modovik/climb-contract/recolor/zones";
import { growArchetypeBounds } from "./zone-bounds.js";

/* Хост собирает до 80 моделей за запуск; индексы у игры 16-битные. */
const MODELS_PER_CALL = 80;
const MAX_VERTICES = 60000;
const LOD_DIST = 9998;
/* Полоса эффекта — четыре одинаковые строки (как у `restyle-drawable`): текстуры в одну строку игра не любит. */
const ROWS = 4;

/* Y-вверх `rage-drawable` → Z-вверх игры: (x, y, z) → (x, −z, y). */
const toGame = (x, y, z) => [x, -z, y];

/* Модель мода: сетки в осях игры с листом (`diffuse` материала). */
function modelMeshes(bytes) {
  const drawable = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRawNode), { inflateRaw: inflateRawNode }).drawables[0];
  return drawable.meshes.map((mesh) => {
    const count = mesh.positions.length / 3;
    const positions = new Float32Array(count * 3);
    for (let vertex = 0; vertex < count; vertex += 1)
      positions.set(toGame(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]), vertex * 3);
    const texture = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    return { positions, indices: Uint32Array.from(mesh.indices), texture };
  });
}

/* Нормали по треугольникам: сетка двусторонняя, шейдеру они почти не нужны, но игра их читает. */
function normalsOf(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const index of [a, b, c]) normals.set([nx, ny, nz], index * 3);
  }
  return normals;
}

/* Сетка → части до 60 000 вершин. */
function splitMesh(mesh) {
  const count = mesh.positions.length / 3;
  if (count <= MAX_VERTICES) return [mesh];
  const parts = [];
  let remap = new Map();
  let positions = [];
  let indices = [];
  const flush = () => {
    if (!indices.length) return;
    parts.push({ positions: new Float32Array(positions), indices: new Uint32Array(indices) });
    remap = new Map();
    positions = [];
    indices = [];
  };
  for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
    if (remap.size + 3 > MAX_VERTICES) flush();
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[at + corner];
      if (!remap.has(index)) {
        remap.set(index, remap.size);
        positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]);
      }
      indices.push(remap.get(index));
    }
  }
  flush();
  return parts;
}

const boundsOf = (list) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const positions of list)
    for (let at = 0; at + 2 < positions.length; at += 3)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], positions[at + axis]);
        max[axis] = Math.max(max[axis], positions[at + axis]);
      }
  return { min, max };
};

/**
 * Файлы зон видов с новой формой: `{ files: Map(имя файла → байты), types: Map(имя типов → байты), report }`.
 * `resources` — файлы набора (`Map`), `compile(команда, вход)` — вызов хоста. Вид с формой как у мода — пусто.
 */
export async function shapeZoneFiles(input, resources, { compile = null, stateDir = "" } = {}) {
  const project = normalizeZonesProject(input);
  const kinds = ZONE_KINDS.filter((kind) => zonesShapeChanged(project, kind));
  const out = { files: new Map(), types: new Map(), report: { kinds, models: 0, vertices: 0, grownArchetypes: 0 } };
  if (!kinds.length) return out;

  /* Модели видов: файл → зоны (у обвода — две линии в одном файле). */
  const models = new Map();
  for (const zone of ZONES.filter((item) => kinds.includes(item.kind))) {
    if (zoneLook(project, zone).alpha === 0) continue;
    for (const target of zone.targets) {
      const entry = models.get(target.file) || { file: target.file, zones: [] };
      entry.zones.push({ zone, target });
      models.set(target.file, entry);
    }
  }
  if (!models.size) return out;
  if (typeof compile !== "function") throw new Error("Сборщик моделей не подключён — обновите Astral.");

  const staging = path.join(stateDir, "recolor", "zones", "shape", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    let fileCount = 0;
    const write = async (name, bytes) => {
      const file = path.join(staging, name);
      await fs.writeFile(file, bytes, { flag: "wx" });
      return file;
    };
    const requests = [];
    const wanted = new Map();
    for (const model of models.values()) {
      const source = resources.get(model.file);
      if (!source) throw new Error(`В наборе нет файла ${model.file}.`);
      const meshes = modelMeshes(source);
      const shaders = [];
      const textures = [];
      const geometries = [];
      const shaped = [];
      for (const [slot, { zone, target }] of model.zones.entries()) {
        const look = zoneLook(project, zone);
        const shape = zoneShape(project, zone.kind);
        const own = meshes.filter((mesh) => mesh.texture === String(target.texture).toLowerCase());
        if (!own.length) throw new Error(`В модели ${model.file} нет сетки с листом ${target.texture}.`);
        /* Лист зоны: клетка 4×4 с альфой или полоса эффекта; имя листа — как у мода. */
        let ddsFile;
        let uAt = () => 0.5;
        if (look.effect.mode === "solid") {
          const rgba = new Uint8ClampedArray(4 * 4 * 4);
          for (let at = 0; at < rgba.length; at += 4) rgba.set([look.rgb[0], look.rgb[1], look.rgb[2], look.alpha], at);
          ddsFile = await write(`${(fileCount += 1)}-flat.dds`, encodeDds({ width: 4, height: 4, format: "DXT5", mipLevels: fullMipLevels(4, 4), rgba }));
        } else {
          const strip = colourEffectStrip(look.effect, 64);
          for (let at = 3; at < strip.length; at += 4) strip[at] = look.alpha;
          const width = strip.length / 4;
          const rgba = new Uint8ClampedArray(width * ROWS * 4);
          for (let row = 0; row < ROWS; row += 1) rgba.set(strip, row * width * 4);
          ddsFile = await write(`${(fileCount += 1)}-strip.dds`, encodeDds({ width, height: ROWS, format: "DXT5", mipLevels: fullMipLevels(width, ROWS), rgba }));
          /* Развёртка по оси зоны: та же проекция, что у `restyle-drawable` (у второй половины обвода начало сдвинуто). */
          const projection = colourEffectProjection(look.effect, zone.frame);
          const origin = target.origin || [0, 0, 0];
          const shift = origin[0] * projection.axis[0] + origin[1] * projection.axis[1] + origin[2] * projection.axis[2];
          uAt = (x, y, z) => (x * projection.axis[0] + y * projection.axis[1] + z * projection.axis[2] - (projection.offset - shift)) * projection.scale;
        }
        const glowing = look.emissive > 0;
        shaders.push(
          glowing
            ? { name: "emissive", file: look.alpha < 255 ? "emissive_alpha.sps" : "emissive.sps", texture: String(target.texture), emissive: look.emissive }
            : { name: "default", file: "alpha.sps", texture: String(target.texture) },
        );
        textures.push({ name: String(target.texture), dds: ddsFile });
        for (const mesh of own) {
          const shapedMesh = zoneShapeMesh(mesh, { width: zoneKindHasWidth(zone.kind) ? shape.width : null, height: shape.height });
          for (const part of splitMesh(shapedMesh)) {
            const count = part.positions.length / 3;
            const normals = normalsOf(part.positions, part.indices);
            const data = new Float32Array(count * 8);
            for (let at = 0; at < count; at += 1) {
              const x = part.positions[at * 3];
              const y = part.positions[at * 3 + 1];
              const z = part.positions[at * 3 + 2];
              data.set([x, y, z, normals[at * 3], normals[at * 3 + 1], normals[at * 3 + 2], uAt(x, y, z), 0.5], at * 8);
            }
            const bytes = Buffer.concat([Buffer.from(data.buffer), Buffer.from(part.indices.buffer, part.indices.byteOffset, part.indices.byteLength)]);
            geometries.push({ shader: slot, data: await write(`${(fileCount += 1)}-geometry.bin`, bytes), vertexCount: count, indexCount: part.indices.length });
            shaped.push(part.positions);
            out.report.vertices += count;
          }
        }
      }
      /* Имя для хоста — строчные буквы, цифры и «_»; у зоны `mcl_kt1_08_bld.model` в имени точка, файл же кладётся под своим именем. */
      const name = model.file.replace(/\.ydr$/i, "");
      const compileName = name.toLowerCase().replace(/[^a-z0-9_+]/g, "_");
      requests.push({ name: compileName, file: model.file, kind: "ydr", drawables: [{ lodDist: LOD_DIST, shaders, textures, geometries }] });
      wanted.set(joaat(name), boundsOf(shaped));
    }

    for (let at = 0; at < requests.length; at += MODELS_PER_CALL) {
      const batch = requests.slice(at, at + MODELS_PER_CALL);
      const request = await write(
        `models-${at}.json`,
        JSON.stringify({ format: "astral.compile-sign-models", version: 1, models: batch.map(({ file: _file, ...model }) => model) }),
      );
      const output = path.join(staging, `models-${at}`);
      await compile("compile-sign-models", { input: request, output });
      for (const model of batch) {
        const bytes = await fs.readFile(path.join(output, `${model.name}.ydr`)).catch(() => null);
        if (!bytes?.length) throw new Error(`Сборка зоны ${model.file} не дала модели.`);
        out.files.set(model.file, bytes);
      }
    }
    out.report.models = out.files.size;

    /* Рамки архетипов — до новой сетки: во всех типах набора, где они есть. */
    for (const [name, bytes] of resources) {
      if (!name.toLowerCase().endsWith(".ytyp")) continue;
      const { bytes: grown, grown: count } = growArchetypeBounds(bytes, wanted);
      if (!count) continue;
      out.types.set(name, grown);
      out.report.grownArchetypes += count;
    }
    return out;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
