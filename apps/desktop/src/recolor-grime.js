/*
 * Потёки грязи поверх покрашенного здания — прочь (05.10.2026).
 *
 * Владелец: «покрасил Мегамолл полностью в синий, но часть текстур осталась
 * чёрной». Чёрная волна над фасадом и тёмные пятна на стенах — наклейки
 * грязи (`im_wall_overlay03`, `im_walloverlay04`, `db_walloverlay02`…), их
 * листы лежат в общих словарях города: перекрасить их нельзя — посерели бы
 * стены по всему штату. Поэтому у покрашенной части здания наклейки её грязи
 * убираются из моделей самого места: каждый их треугольник сводится в точку
 * (все три индекса — первая вершина). Длина файла, буферы, шейдеры и
 * развёртка не меняются — как у снятых плафонов ангара (`recolor-hangar.js`).
 *
 * Тем же путём уходят объёмные буквы, что человек заменяет своими (DAVIS
 * MEGA MALL на фасаде Мегамолла): лист у букв общий со стеной, поэтому
 * треугольники выбираются ещё и местом (`within` — середина треугольника).
 * Правятся все ступени детализации модели — вдали буквы не возвращаются.
 */

import zlib from "node:zlib";
import { readDrawable } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const LEVELS = ["high", "medium", "low", "veryLow"];

const inflateRaw = inflateResource;

function repack(raw, resource) {
  const level = resource.data.length > 8 * 1024 * 1024 ? 6 : zlib.constants.Z_BEST_COMPRESSION;
  const compressed = deflateRaw(resource.data, { level });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return out;
}

/* Y-вверх rage-drawable → Z-вверх игры (как у поля облика зданий). */
const toGame = (positions, index) => [positions[index * 3], -positions[index * 3 + 2], positions[index * 3 + 1]];

/**
 * Модель (`.ydr`, `.ydd`) без треугольников с листами `textures` (имена
 * строчными): `{ bytes, removed }` — новые байты и сколько треугольников
 * сведено. Нечего убирать — `{ bytes: null, removed: 0 }`.
 * `within(centre, uv, normal)` — только треугольники, чья середина (оси игры,
 * место в модели), середина развёртки (`[u, v]` или `null`) и нормаль грани
 * (оси игры, место в модели; направление по намотке) и высота грани по Z
 * (м) подходят;
 * `drawables` — только модели словаря с этими хешами; `shader` — только
 * сетки, чей шейдер подходит (наклейки на листе, что делит стена: у них шейдер
 * `decal*`, у стены — нет).
 */
export function hideGrimeDecals(bytes, textures, { within = null, drawables = null, shader = null } = {}) {
  const wanted = new Set([...textures].map((name) => String(name).toLowerCase()));
  const only = drawables ? new Set([...drawables].map((hash) => hash >>> 0)) : null;
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const data = new DataView(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength);
  const seen = new Set();
  let removed = 0;
  for (const lod of LEVELS)
    for (const drawable of readDrawable(resource, { inflateRaw, lod }).drawables) {
      if (only && !only.has(drawable.hash >>> 0)) continue;
      for (const mesh of drawable.meshes) {
        const diffuse = String(mesh.material?.textures?.diffuse || "").toLowerCase();
        if (!wanted.has(diffuse) || !Number.isInteger(mesh.indicesAt) || seen.has(mesh.indicesAt)) continue;
        if (shader && !shader.test(String(mesh.material?.shader || ""))) continue;
        seen.add(mesh.indicesAt);
        for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
          const first = mesh.indices[at];
          if (mesh.indices[at + 1] === first && mesh.indices[at + 2] === first) continue;
          if (within) {
            const ids = [first, mesh.indices[at + 1], mesh.indices[at + 2]];
            const points = ids.map((index) => toGame(mesh.positions, index));
            const uv = mesh.uvs ? [0, 1].map((axis) => (mesh.uvs[ids[0] * 2 + axis] + mesh.uvs[ids[1] * 2 + axis] + mesh.uvs[ids[2] * 2 + axis]) / 3) : null;
            /* Нормаль грани (оси игры, место в модели): по ней отличают лицо стены от торцов её выступов. */
            const e1 = [0, 1, 2].map((axis) => points[1][axis] - points[0][axis]);
            const e2 = [0, 1, 2].map((axis) => points[2][axis] - points[0][axis]);
            const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            const size = Math.hypot(...cross) || 1;
            const height = Math.max(points[0][2], points[1][2], points[2][2]) - Math.min(points[0][2], points[1][2], points[2][2]);
            if (!within([0, 1, 2].map((axis) => (points[0][axis] + points[1][axis] + points[2][axis]) / 3), uv, cross.map((value) => value / size), height)) continue;
          }
          data.setUint16(mesh.indicesAt + (at + 1) * 2, first, true);
          data.setUint16(mesh.indicesAt + (at + 2) * 2, first, true);
          removed += 1;
        }
      }
    }
  return removed ? { bytes: repack(raw, resource), removed } : { bytes: null, removed: 0 };
}
