/*
 * Столбы фонарей в файлах: краска корпуса, блеск, прозрачность, украшения.
 *
 * Работа говорит, какими быть столбам (`pole` в работе фонарей,
 * `@modovik/street-light-contract/lamps`: `pole.js`, `decor.js`), а здесь это
 * раскладывается на модели игрока — те же `.yft`, что уже правит свет ламп:
 *
 *   • столб находится по самой модели (`poleProfile` — срезы сетки), им же
 *     меряется украшение: спираль обвивает каждый столб по его толщине и
 *     высоте — от основания до консоли;
 *   • листы корпуса (шейдеры корпуса — `poleBodyShaders`) берутся из модели
 *     или из словаря её архетипа, крупнейшие из найденных (словарь высокой
 *     чёткости `+hifr` у фрагмента), красятся `tintPole` (общий лист мачты
 *     и сигналов светофора — только областью мачты, `POLE_SHEET_AREAS`) и уходят хосту
 *     копиями под именами Astral (вблизи словарь высокой чёткости подменяет
 *     лист по имени — копию под своим именем он не тронет);
 *   • сетки украшения — `decorMeshes` на три уровня детализации, лист цветов
 *     — `decorAtlas`;
 *   • всё это встаёт в модель нативным хостом (`lamp-pole`,
 *     `LampPoleCommands.cs`): он же проверяет, что лампы, кости и физика
 *     модели не изменились.
 *
 * Файлы — копии из игры игрока; уезжают тем же пакетом, что и фонари, в
 * `x64/astral/astral_lights.rpf`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import { encodeDdsPooled } from "./dds-pool.js";
import {
  DECOR_LODS,
  DECOR_TEXTURE,
  POLE_ALPHA_PRESETS,
  decorAtlas,
  decorEmissive,
  decorMeshes,
  meshTriangles,
  poleBodyShaders,
  poleProfile,
  poleSheetArea,
  tintPole,
} from "@modovik/street-light-contract/lamps";

/* Лист корпуса не крупнее этого по стороне: столб в игре — полоса шириной
   в ладонь, и 1024 точки по высоте хватает с запасом. */
const MAX_SHEET_EDGE = 1024;

const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Сетки модели в осях RAGE (Z вверх): `readDrawable` отдаёт оси glTF. */
export function rageMeshes(drawable) {
  return (drawable?.meshes || []).map((mesh) => {
    const source = mesh.positions;
    const positions = new Float32Array(source.length);
    for (let at = 0; at < source.length; at += 3) {
      positions[at] = source[at];
      positions[at + 1] = -source[at + 2];
      positions[at + 2] = source[at + 1];
    }
    return {
      positions,
      indices: mesh.indices,
      boneIndex: mesh.boneIndex,
      shaderIndex: mesh.shaderIndex,
      skin: mesh.skin || null,
    };
  });
}

/* Кость вершины: у модели без кожи — кость модели, с кожей — самый тяжёлый вес. */
function vertexBone(mesh, vertex) {
  if (Number.isInteger(mesh.boneIndex)) return mesh.boneIndex;
  const skin = mesh.skin;
  if (!skin) return null;
  let best = 0;
  for (let slot = 1; slot < 4; slot += 1)
    if (skin.weights[vertex * 4 + slot] > skin.weights[vertex * 4 + best]) best = slot;
  return skin.joints[vertex * 4 + best];
}

/*
 * Кость столба: та, у чьей сетки больше всего высоты рядом с осью столба
 * (у моделей с кожей — по весам вершин). Украшение вблизи встаёт на неё —
 * сбитый машиной фонарь уносит его с собой. Не нашлась — корень.
 */
export function poleBone(meshes, profile) {
  if (!profile) return 0;
  const [ax, ay] = profile.axis;
  const reach = profile.radius * 1.8 + 0.05;
  const ranges = new Map();
  for (const mesh of meshes)
    for (let vertex = 0; vertex * 3 < mesh.positions.length; vertex += 1) {
      const at = vertex * 3;
      const z = mesh.positions[at + 2];
      if (z < profile.bottom - 0.2 || z > profile.top + 0.2) continue;
      if (Math.hypot(mesh.positions[at] - ax, mesh.positions[at + 1] - ay) > reach) continue;
      const bone = vertexBone(mesh, vertex);
      if (!Number.isInteger(bone)) continue;
      const range = ranges.get(bone) || [Infinity, -Infinity];
      ranges.set(bone, [Math.min(range[0], z), Math.max(range[1], z)]);
    }
  const spans = new Map([...ranges].map(([bone, [low, high]]) => [bone, high - low]));
  let best = 0;
  let bestSpan = 0;
  for (const [bone, span] of spans)
    if (span > bestSpan) {
      best = bone;
      bestSpan = span;
    }
  return best;
}

/*
 * Пиксели листа по имени: из модели и из словарей (архетип, высокая
 * чёткость), крупнейшие; не крупнее `MAX_SHEET_EDGE`.
 */
function sheetPixels(name, sources) {
  const wanted = String(name || "").toLowerCase();
  let best = null;
  for (const ref of sources) {
    if (String(ref?.name || "").toLowerCase() !== wanted || !ref.complete || !ref.format) continue;
    if (!best || ref.width * ref.height > best.width * best.height) best = ref;
  }
  if (!best) return null;
  try {
    return decodeTextureRef(best, { maxSize: MAX_SHEET_EDGE });
  } catch {
    return null;
  }
}

const hasAlpha = (rgba) => {
  for (let at = 3; at < rgba.length; at += 4) if (rgba[at] < 250) return true;
  return false;
};

const floats = (values) => Array.from(values, (value) => Math.round(value * 1e5) / 1e5);

async function writeDds(directory, name, dds) {
  const file = path.join(directory, `${name}.dds`);
  await fs.writeFile(file, dds, { flag: "wx" });
  return { name, dds: file, sha256: `sha256:${sha(dds)}` };
}

/**
 * Модель-столб под заказ `job` (`poleJobFor`): `{ bytes, report }` или
 * `null`, если в этой модели менять нечего. `dictionaries` — байты словарей
 * текстур, где могут лежать листы корпуса (`[{ name, bytes }]`),
 * `compile(команда, вход)` — нативный хост.
 */
/**
 * Модель игры для столба: разбор окна (`readDrawable`, уровень вблизи, с
 * весами кожи) и пиксели листов по имени — из модели и словарей.
 */
export function readPoleModel(bytes, dictionaries = []) {
  const { drawables } = readDrawable(bytes, { inflateRaw: zlib.inflateRawSync, kind: "yft", skin: true });
  const drawable = drawables[0] || null;
  const sources = [...(drawable?.embeddedTextures || [])];
  for (const dictionary of dictionaries) {
    try {
      sources.push(...readTextureDictionary(dictionary.bytes, { inflateRaw: zlib.inflateRawSync }));
    } catch {
      /* словарь не читается — листы ищутся в остальных */
    }
  }
  return { drawable, sheet: (name) => sheetPixels(name, sources) };
}

export async function buildPoleModel({ job, bytes, dictionaries = [], directory, compile, read = readPoleModel }) {
  if (typeof compile !== "function") throw new Error("Сборщик столбов не подключён — обновите Astral.");
  const { drawable, sheet } = read(bytes, dictionaries);
  if (!drawable) return null;
  const meshes = rageMeshes(drawable);
  const profile = poleProfile(meshTriangles(meshes));
  const body = poleBodyShaders(drawable.materials);
  const report = {
    model: job.model,
    sheets: 0,
    /* Из них — листов, крашенных только своей областью (мачта светофора). */
    areas: 0,
    transparent: 0,
    shine: false,
    decorated: false,
    pole: Boolean(profile),
    missing: [],
  };

  await fs.mkdir(directory, { recursive: true });
  const textures = [];
  const shaders = [];
  const repaint = Boolean(job.colour) || job.opacity < 100;
  const renamed = new Map();
  for (const index of body) {
    const material = drawable.materials[index];
    const diffuse = String(material.textures.diffuse).toLowerCase();
    const change = { index };
    if (repaint) {
      if (!renamed.has(diffuse)) {
        const pixels = sheet(diffuse);
        if (!pixels) {
          report.missing.push(diffuse);
          renamed.set(diffuse, null);
        } else {
          /* Лист, общий с тем, что красить нельзя (мачта и сигналы светофора),
             красится только своей областью — какого бы размера он ни пришёл. */
          const area = poleSheetArea(diffuse);
          const rgba = tintPole(pixels.rgba, job.colour, {
            shade: job.shade,
            opacity: job.opacity,
            width: pixels.width,
            area,
          });
          if (area) report.areas += 1;
          const name = `astral_pole_${sha(`${job.model}|${diffuse}|${job.colour}|${job.shade}|${job.opacity}`).slice(0, 12)}`;
          const format = job.opacity < 100 || hasAlpha(pixels.rgba) ? "DXT5" : "DXT1";
          const dds = await encodeDdsPooled({
            width: pixels.width,
            height: pixels.height,
            format,
            mipLevels: fullMipLevels(pixels.width, pixels.height),
            rgba: rgba,
          });
          textures.push(await writeDds(directory, name, dds));
          renamed.set(diffuse, name);
          report.sheets += 1;
        }
      }
      const name = renamed.get(diffuse);
      if (name) change.diffuse = name;
      /* Прозрачность — только у шейдера с листом в альфе: без листа
         прозрачный пресет показал бы корпус, как он есть. */
      const alpha = POLE_ALPHA_PRESETS[String(material.shader).toLowerCase()];
      if (name && job.opacity < 100 && alpha) {
        change.preset = alpha.preset;
        if (alpha.swap) change.swap = alpha.swap;
        report.transparent += 1;
      }
    }
    if (job.metal !== 100) {
      change.specular = Math.round((job.metal / 100) * 1000) / 1000;
      report.shine = true;
    }
    if (Object.keys(change).length > 1) shaders.push(change);
  }

  let decorations = null;
  if (job.decor && profile) {
    const parts = [];
    for (const lod of DECOR_LODS) {
      const lodMeshes = decorMeshes(job.decor, profile, lod);
      for (const role of ["body", "glow"]) {
        const mesh = lodMeshes[role];
        if (!mesh) continue;
        parts.push({
          lod,
          role,
          positions: floats(mesh.positions),
          normals: floats(mesh.normals),
          uvs: floats(mesh.uvs),
          indices: Array.from(mesh.indices),
        });
      }
    }
    if (parts.length) {
      const atlas = decorAtlas(job.decor);
      const dds = encodeDds({
        width: atlas.width,
        height: atlas.height,
        format: "DXT1",
        mipLevels: fullMipLevels(atlas.width, atlas.height),
        rgba: atlas.rgba,
      });
      decorations = {
        texture: await writeDds(directory, DECOR_TEXTURE, dds),
        glow: decorEmissive(job.decor.glow),
        bone: poleBone(meshes, profile),
        parts,
      };
      report.decorated = true;
      report.bone = decorations.bone;
    }
  }

  if (!shaders.length && !decorations) return null;
  const request = path.join(directory, "request.json");
  const input = path.join(directory, "model.yft");
  const output = path.join(directory, `${job.model}.yft`);
  await fs.writeFile(input, bytes, { flag: "wx" });
  await fs.writeFile(
    request,
    JSON.stringify({
      format: "astral.lamp-pole",
      version: 1,
      model: input,
      textures,
      shaders,
      ...(decorations ? { decorations } : {}),
    }),
  );
  const result = await compile("lamp-pole", { input: request, output });
  const built = await fs.readFile(output).catch(() => null);
  if (!built?.length) throw new Error(`Сборка столба ${job.model} не дала файла.`);
  report.semantic = result?.semantic || null;
  return { bytes: built, output, report };
}

/**
 * Все столбы работы: `jobs` — заказы (`poleJobFor`), `sourceOf(model)` —
 * путь к модели (правленой светом или из игры), `dictionaries(job)` —
 * словари, где могут лежать листы корпуса. Возвращает файлы для пакета
 * фонарей (`{ name, source }`) и сводку по моделям.
 */
export async function buildPoleFiles({ jobs, sourceOf, dictionaries = async () => [], directory, compile, read = readPoleModel }) {
  const files = [];
  const reports = [];
  for (const job of jobs || []) {
    const source = sourceOf(job.model);
    if (!source) continue;
    const bytes = await fs.readFile(source);
    const built = await buildPoleModel({
      job,
      bytes,
      dictionaries: await dictionaries(job),
      directory: path.join(directory, job.model),
      compile,
      read,
    });
    if (!built) continue;
    files.push({ name: `${job.model}.yft`, source: built.output });
    reports.push(built.report);
  }
  return { files, reports };
}
