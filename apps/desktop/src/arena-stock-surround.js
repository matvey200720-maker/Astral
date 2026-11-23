/*
 * Окружение арены снаружи из штатной сцены (25.10.2026): дороги, развязки, земля и соседние кварталы лежат в сцене «снаружи»
 * (`<сервер>-outside.bin`) частью `surround` (`scripts/prepare-arena-surround.mjs`). Кадр каталога строит «снаружи» из фасада
 * мода (`arena-hall-cover.js`), и без этой части вокруг был бы чёрный фон — здесь она читается из той же сцены и ложится в
 * сборку зала теми же сетками (оси и начало сцены общие).
 *
 * Читается только часть `surround`: сетки, материалы с их листами (записи листов игры `game`: кадр берёт картинки из игры игрока),
 * без разбора всей сцены. Формат — ARS1 (`recolor-shops-scene.js`, `encodeShopScene`), как у окна (`scene-asset.js`).
 */

import fs from "node:fs/promises";
import { inflateSync } from "node:zlib";

export const SURROUND_PART = "surround";

const SCENES = new URL("../../web/public/assets/workshop/arenas/", import.meta.url);

/**
 * Часть `surround` сцены ARS1 (сжатые байты файла): `{ materials, textures, meshes }` или `null`, если части нет.
 * Сетки в метрах сцены (Float32), цвета вершин — доли 0…1; материалы и листы — только те, что нужны части, с новыми номерами.
 */
export function surroundOf(file, id = SURROUND_PART) {
  const bytes = inflateSync(Buffer.from(file));
  if (bytes.toString("latin1", 0, 4) !== "ARS1") throw new Error("Файл сцены — не ARS1.");
  const headerBytes = bytes.readUInt32LE(8);
  const header = JSON.parse(bytes.subarray(12, 12 + headerBytes).toString("utf8"));
  const part = (header.parts || []).findIndex((item) => (item.id ?? item) === id);
  if (part < 0) return null;
  const data = 12 + headerBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { min, max } = header.bounds;
  const span = max.map((value, axis) => value - min[axis]);
  const floats = (offset, count) => {
    const copy = new Uint8Array(count * 4);
    copy.set(bytes.subarray(data + offset, data + offset + count * 4));
    return new Float32Array(copy.buffer);
  };

  const materials = [];
  const textures = [];
  const materialAt = new Map();
  const textureAt = new Map();
  const texture = (number) => {
    if (!Number.isInteger(number)) return null;
    if (!textureAt.has(number)) {
      textureAt.set(number, textures.length);
      textures.push({ ...header.textures[number] });
    }
    return textureAt.get(number);
  };
  const material = (number) => {
    if (!materialAt.has(number)) {
      const source = header.materials[number];
      materialAt.set(number, materials.length);
      materials.push({
        ...source,
        texture: texture(source.texture),
        ...(source.terrain ? { terrain: { ...source.terrain, layers: (source.terrain.layers || []).map(texture), mask: texture(source.terrain.mask) } } : {}),
      });
    }
    return materialAt.get(number);
  };

  const meshes = [];
  for (const mesh of header.meshes.filter((item) => item.part === part)) {
    const count = mesh.vertices;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count * 3; index += 1)
      positions[index] = min[index % 3] + ((view.getInt16(data + mesh.position + index * 2, true) + 32768) / 65535) * span[index % 3];
    const normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1)
      for (let axis = 0; axis < 3; axis += 1) normals[index * 3 + axis] = view.getInt8(data + mesh.normal + index * 4 + axis) / 127;
    const indices = new (mesh.wide ? Uint32Array : Uint16Array)(mesh.indices);
    for (let index = 0; index < mesh.indices; index += 1)
      indices[index] = mesh.wide ? view.getUint32(data + mesh.index + index * 4, true) : view.getUint16(data + mesh.index + index * 2, true);
    const colours = mesh.colour >= 0 && mesh.colour !== undefined ? Float32Array.from(bytes.subarray(data + mesh.colour, data + mesh.colour + count * 4), (value) => value / 255) : null;
    meshes.push({
      material: material(mesh.material),
      positions,
      normals,
      uvs: mesh.uv >= 0 ? floats(mesh.uv, count * 2) : null,
      indices,
      ...(colours ? { colours } : {}),
      ...(mesh.uv1 >= 0 && mesh.uv1 !== undefined ? { uvs1: floats(mesh.uv1, count * 2) } : {}),
    });
  }
  return { materials, textures, meshes };
}

/** Окружение арены сервера из его сцены «снаружи» (`null` — сцены или части нет: кадр без окружения, как прежде). */
export async function stockSurround(server) {
  try {
    return surroundOf(await fs.readFile(new URL(`${server}-outside.bin`, SCENES)));
  } catch {
    return null;
  }
}
