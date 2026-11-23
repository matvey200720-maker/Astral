/*
 * МСЛ-зоны в файлах (ТЗ 08.10.2026, задача 3) — свои модели линий зон.
 *
 * Основа — геометрия моделей мода (`resources/msl-zones/msl-zones.bin`,
 * собирает `scripts/prepare-msl-zones.mjs`): ленты по рельефу, развёртка в
 * палитру. Из неё по работе человека (`@modovik/climb-contract/recolor/
 * msl-zones`):
 *   • лента нужной ширины и стенки нужной высоты (`mslZonesMesh`): стенка —
 *     по оси ленты, сплошная (исправление 10.10.2026);
 *   • плитки (`mslZonesTiles`) со стороной по дальности (`mslZonesTilePlan`:
 *     25 м на ближней дальности, 400 м — от 400 м; моделей на все районы не
 *     больше 2000): у каждой своя модель `astral_msl_<район>_<NN>.ydr` и
 *     своя сущность с точкой в центре плитки и дальностью «заданная +
 *     радиус плитки» — линия видна с выбранной дистанции до самой дальней
 *     своей точки и появляется, когда к ней подъезжаешь;
 *   • текстура — полоса на каждый цвет мода (свой цвет, общий облик или
 *     как в моде), альфа — прозрачность; шейдер `emissive` (непрозрачный,
 *     как у мода, или `emissive_alpha` при прозрачности меньше 100 %).
 * Модели собирает нативный хост (`compile-sign-models`), расстановку —
 * `compile-placements`: типы `astral_mslzones.ytyp`, карта
 * `astral_mslzones.ymap` и манифест контейнера. Имена — свои: у игрока может
 * стоять сам мод (`adxnis_jokerci_*`), и чужие архетипы не перекрываются.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodeDds, fullMipLevels, resample } from "@modovik/dds";
import {
  MSL_DISTRICTS,
  MSL_TILES_PER_DISTRICT,
  MSL_ZONES_INVENTORY,
  mslZonesAlpha,
  mslZonesIsHidden,
  mslZonesMesh,
  mslZonesTexture,
  mslZonesTilePlan,
  mslZonesTiles,
  normalizeMslZonesProject,
} from "@modovik/climb-contract/recolor/msl-zones";

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const MSL_TYPES = "astral_mslzones";
export const MSL_MAP = "astral_mslzones";
const MAX_VERTICES = 60000;
const MODELS_PER_CALL = 60;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function mslZonesResourceRoot(env = process.env) {
  const candidates = [
    env.ASTRAL_MSL_ZONES_RESOURCES,
    process.resourcesPath && path.join(process.resourcesPath, "msl-zones"),
    path.resolve(dirname, "../../../resources/msl-zones"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, MSL_ZONES_INVENTORY.geometry.file));
      return candidate;
    } catch {
      /* следующий */
    }
  }
  throw new Error("Геометрии МСЛ-зон нет рядом с приложением — переустановите Astral.");
}

/**
 * Геометрия районов из файла поставки: сумма сверяется (битый файл в игру не
 * едет), ответ — `district(id) → { positions, uvs, indices }` (оси игры, от
 * точки сущности района).
 */
export async function readMslGeometry({ root = null, env = process.env } = {}) {
  const folder = root || (await mslZonesResourceRoot(env));
  const packed = await fs.readFile(path.join(folder, MSL_ZONES_INVENTORY.geometry.file));
  if (sha256(packed) !== MSL_ZONES_INVENTORY.geometry.sha256) throw new Error("Геометрия МСЛ-зон повреждена — переустановите Astral.");
  const bytes = zlib.inflateSync(packed);
  if (bytes.subarray(0, 4).toString("latin1") !== "AMZ1") throw new Error("Геометрия МСЛ-зон повреждена: нет метки AMZ1.");
  const headerBytes = bytes.readUInt32LE(8);
  const header = JSON.parse(bytes.subarray(12, 12 + headerBytes).toString("utf8"));
  const totalVertices = header.districts.reduce((sum, item) => sum + item.vertices, 0);
  const totalIndices = header.districts.reduce((sum, item) => sum + item.indices, 0);
  const base = 12 + headerBytes;
  const copy = (offset, length, Type) => {
    const out = new Type(length);
    Buffer.from(out.buffer).set(bytes.subarray(offset, offset + length * Type.BYTES_PER_ELEMENT));
    return out;
  };
  const positions = copy(base, totalVertices * 3, Float32Array);
  const uvs = copy(base + totalVertices * 12, totalVertices * 2, Float32Array);
  const indices = copy(base + totalVertices * 20, totalIndices, Uint32Array);
  return (id) => {
    const item = header.districts.find((district) => district.id === id);
    if (!item) return null;
    const local = indices.slice(item.indexOffset, item.indexOffset + item.indices);
    return {
      position: item.position,
      positions: positions.slice(item.vertexOffset * 3, (item.vertexOffset + item.vertices) * 3),
      uvs: uvs.slice(item.vertexOffset * 2, (item.vertexOffset + item.vertices) * 2),
      indices: local,
    };
  };
}

/* Сетка плитки → части до 60 000 вершин (индексы у игры 16-битные). */
function splitTile(tile) {
  const count = tile.positions.length / 3;
  if (count <= MAX_VERTICES) return [tile];
  const parts = [];
  let remap = new Map();
  let positions = [];
  let uvs = [];
  let indices = [];
  const flush = () => {
    if (!indices.length) return;
    parts.push({ positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
    remap = new Map();
    positions = [];
    uvs = [];
    indices = [];
  };
  for (let t = 0; t + 2 < tile.indices.length; t += 3) {
    if (remap.size + 3 > MAX_VERTICES) flush();
    for (let k = 0; k < 3; k += 1) {
      const i = tile.indices[t + k];
      if (!remap.has(i)) {
        remap.set(i, remap.size);
        positions.push(tile.positions[i * 3], tile.positions[i * 3 + 1], tile.positions[i * 3 + 2]);
        uvs.push(tile.uvs[i * 2], tile.uvs[i * 2 + 1]);
      }
      indices.push(remap.get(i));
    }
  }
  flush();
  return parts;
}

/* Нормаль треугольника: лента — вверх, стенка — вбок; шейдеру свечения
   она почти не нужна, но игра её читает. */
function normalsOf(part) {
  const normals = new Float32Array(part.positions.length);
  for (let t = 0; t + 2 < part.indices.length; t += 3) {
    const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]];
    const ux = part.positions[b * 3] - part.positions[a * 3];
    const uy = part.positions[b * 3 + 1] - part.positions[a * 3 + 1];
    const uz = part.positions[b * 3 + 2] - part.positions[a * 3 + 2];
    const vx = part.positions[c * 3] - part.positions[a * 3];
    const vy = part.positions[c * 3 + 1] - part.positions[a * 3 + 1];
    const vz = part.positions[c * 3 + 2] - part.positions[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const i of [a, b, c]) normals.set([nx, ny, nz], i * 3);
  }
  return normals;
}

/**
 * Модели и расстановка МСЛ-зон под работу: `{ files: [{ name, bytes }],
 * patches, report }`. `compile` — вызов нативного хоста.
 */
export async function buildMslZonesFiles(input, { compile = null, stateDir = "", geometry = null } = {}) {
  const project = normalizeMslZonesProject(input);
  if (typeof compile !== "function") throw new Error("Сборщик моделей не подключён — обновите Astral.");
  const read = geometry || (await readMslGeometry());
  const staging = path.join(stateDir, "recolor", "mslzones", "build", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    let fileCount = 0;
    const writeFile = async (name, bytes) => {
      const file = path.join(staging, name);
      await fs.writeFile(file, bytes, { flag: "wx" });
      return file;
    };
    /* Текстура линий: полоса на каждый цвет мода (4×64, с эффектом — 64×64);
       DXT5 со всеми мипами (DXT5 держит альфу прозрачности). */
    const picture = mslZonesTexture(project);
    const width = Math.max(4, picture.width);
    const height = Math.max(4, picture.height);
    const rgba =
      picture.height === height && picture.width === width
        ? new Uint8ClampedArray(picture.rgba)
        : new Uint8ClampedArray(resample(new Uint8ClampedArray(picture.rgba), picture.width, picture.height, width, height));
    const dds = encodeDds({ width, height, format: "DXT5", mipLevels: fullMipLevels(width, height), rgba });
    const textureFile = await writeFile("astral_msl_lines.dds", dds);
    const texture = { name: "astral_msl_lines", dds: textureFile, sha256: `sha256:${sha256(dds)}` };
    const alpha = mslZonesAlpha(project);
    const shaderFile = alpha < 255 ? "emissive_alpha.sps" : "emissive.sps";
    /* Свечение: у мода emissiveMultiplier 1. Невидимые — 0, иначе шейдер
       сложил бы свет мимо альфы. */
    const glow = mslZonesIsHidden(project) ? 0 : 1;

    const models = [];
    const archetypes = [];
    const entities = [];
    let vertices = 0;
    /* Сетки всех районов, потом сторона плиток на всех сразу: по дальности,
       но не больше бюджета моделей. */
    const districts = MSL_DISTRICTS.map((district) => {
      const source = read(district.id);
      if (!source) throw new Error(`В геометрии МСЛ-зон нет района ${district.label}.`);
      return { district, source, mesh: mslZonesMesh(source, project) };
    });
    const plan = mslZonesTilePlan(
      districts.map((item) => item.mesh),
      project,
    );
    const round3 = (values) => values.map((value) => Math.round(value * 1000) / 1000);
    for (const { district, source, mesh } of districts) {
      const tiles = mslZonesTiles(mesh, source.position, project, plan.side);
      if (tiles.length > MSL_TILES_PER_DISTRICT) throw new Error(`МСЛ-зоны: у района ${district.label} ${tiles.length} кусков — больше ${MSL_TILES_PER_DISTRICT}.`);
      for (const [index, tile] of tiles.entries()) {
        const name = `astral_msl_${district.id}_${String(index + 1).padStart(2, "0")}`;
        const geometries = [];
        for (const part of splitTile(tile)) {
          const count = part.positions.length / 3;
          const normals = normalsOf(part);
          const data = new Float32Array(count * 8);
          for (let at = 0; at < count; at += 1) {
            data.set(part.positions.subarray(at * 3, at * 3 + 3), at * 8);
            data.set(normals.subarray(at * 3, at * 3 + 3), at * 8 + 3);
            data.set(part.uvs.subarray(at * 2, at * 2 + 2), at * 8 + 6);
          }
          const bytes = Buffer.concat([Buffer.from(data.buffer), Buffer.from(part.indices.buffer, part.indices.byteOffset, part.indices.byteLength)]);
          geometries.push({ shader: 0, data: await writeFile(`geometry-${(fileCount += 1)}.bin`, bytes), vertexCount: count, indexCount: part.indices.length });
          vertices += count;
        }
        models.push({
          name,
          kind: "ydr",
          drawables: [
            {
              lodDist: tile.lodDist,
              shaders: [{ name: "emissive", file: shaderFile, texture: texture.name, emissive: glow }],
              textures: [texture],
              geometries,
            },
          ],
        });
        /* Рамка — с запасом в миллиметр (округление не режет сетку). */
        const bbMin = round3(tile.bounds.min.map((value) => value - 0.001));
        const bbMax = round3(tile.bounds.max.map((value) => value + 0.001));
        archetypes.push({ name, lodDist: tile.lodDist, bbMin, bbMax, flags: 0 });
        entities.push({ archetype: name, position: round3(tile.position), lodDist: tile.lodDist, flags: 32 });
      }
    }

    const files = [];
    for (let at = 0; at < models.length; at += MODELS_PER_CALL) {
      const batch = models.slice(at, at + MODELS_PER_CALL);
      const output = path.join(staging, `models-${at}`);
      const request = await writeFile(`models-${at}.json`, JSON.stringify({ format: "astral.compile-sign-models", version: 1, models: batch }));
      await compile("compile-sign-models", { input: request, output });
      for (const model of batch) {
        const name = `${model.name}.ydr`;
        const bytes = await fs.readFile(path.join(output, name)).catch(() => null);
        if (!bytes?.length) throw new Error(`Сборка МСЛ-зон не дала ${name}.`);
        files.push({ name, bytes });
      }
    }
    const placements = path.join(staging, "placements");
    const request = await writeFile(
      "placements.json",
      JSON.stringify({ format: "astral.compile-placements", version: 1, types: MSL_TYPES, map: MSL_MAP, manifest: true, archetypes, entities }),
    );
    await compile("compile-placements", { input: request, output: placements });
    const placementBytes = {};
    for (const name of [`${MSL_TYPES}.ytyp`, `${MSL_MAP}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(placements, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка МСЛ-зон не дала ${name}.`);
      files.push({ name, bytes });
      placementBytes[name] = bytes.length;
    }
    const report = {
      models: models.length,
      vertices,
      drawDistance: project.drawDistance,
      tileSide: plan.side,
      minLodDist: Math.min(...entities.map((entity) => entity.lodDist)),
      maxLodDist: Math.max(...entities.map((entity) => entity.lodDist)),
      shader: shaderFile,
      texture: `${width}×${height}`,
      files: files.length,
      modelBytes: files.filter((file) => file.name.endsWith(".ydr")).reduce((sum, file) => sum + file.bytes.length, 0),
      typesBytes: placementBytes[`${MSL_TYPES}.ytyp`],
      mapBytes: placementBytes[`${MSL_MAP}.ymap`],
    };
    return { files, patches: [{ file: "mslzones", models: models.map((model) => `${model.name}.ydr`) }], report };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
