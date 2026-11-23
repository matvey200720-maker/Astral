/*
 * Летающее лого в файлах (ТЗ 08.10.2026, задача 4).
 *
 * Картинка лого приходит из окна (своя картинка или нарисованная надпись —
 * общая система надписей), цвет и прозрачность ложатся на её пиксели
 * (`floatLogoPixels` договора). Дальше:
 *   • модель — объёмная фигура по контуру картинки (`arenaStarModel` без
 *     подставки), лист — картинка в квадрате степени двойки (DXT5, все мипы),
 *     шейдер свечения с альфой (`emissive_alpha`): края фигуры — по альфе
 *     листа, а не ступенями клеток контура;
 *   • движение — клип кости фигуры (поворот вокруг вертикали и подъём),
 *     скелет и подписи — как у штатной крутящейся модели игры
 *     (`compile-star-model`);
 *   • расстановка — свой архетип с флагами анимированной модели 0x80200 и
 *     словарём клипов, сущность над кварталом dt1_05 на заданной высоте,
 *     дальность — заданная (до 5 км), у модели — 9998: одна модель высокой
 *     детализации, вблизи и вдали одинаковая (`compile-placements`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { bleedTransparent, encodeDds, fullMipLevels, resample } from "@modovik/dds";
import {
  FLOAT_LOGO_PLACE,
  floatLogoFrames,
  floatLogoIsStock,
  floatLogoMesh,
  floatLogoMotion,
  floatLogoPixels,
  normalizeFloatLogoProject,
} from "@modovik/climb-contract/recolor/float-logo";

export const FLOAT_LOGO_MODEL = "astral_floatlogo";
export const FLOAT_LOGO_CLIPS = "astral_floatlogo_clips";
export const FLOAT_LOGO_TYPES = "astral_floatlogo_types";
export const FLOAT_LOGO_MAP = "astral_floatlogo_map";
const ANIMATED_ARCHETYPE_FLAGS = 0x80200;
const ATLAS = 1024;

/* Картинка в квадратный лист: вписана с сохранением пропорций, края — цветом соседей. */
function atlasOf(rgba, width, height) {
  const scale = Math.min(ATLAS / width, ATLAS / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = new Uint8ClampedArray(resample(new Uint8ClampedArray(rgba), width, height, w, h));
  const bled = bleedTransparent(new Uint8ClampedArray(resized), w, h);
  const out = new Uint8ClampedArray(ATLAS * ATLAS * 4);
  const left = Math.floor((ATLAS - w) / 2);
  const top = Math.floor((ATLAS - h) / 2);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const from = (y * w + x) * 4;
      const to = ((top + y) * ATLAS + left + x) * 4;
      out[to] = bled[from];
      out[to + 1] = bled[from + 1];
      out[to + 2] = bled[from + 2];
      /* Альфа — исходная: прозрачное вокруг лого остаётся прозрачным. */
      out[to + 3] = resized[from + 3];
    }
  return { rgba: out, uv: (u, v) => [(left + u * w) / ATLAS, (top + v * h) / ATLAS] };
}

/**
 * Файлы лого под работу: `{ files, patches, report }`. `image` — картинка
 * лого `{ rgba, width, height }`, `compile` — вызов нативного хоста.
 */
export async function buildFloatLogoFiles(input, { image = null, compile = null, stateDir = "" } = {}) {
  const project = normalizeFloatLogoProject(input);
  if (floatLogoIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!image) throw new Error("Картинка лого не пришла — выберите её или впишите надпись ещё раз.");
  if (typeof compile !== "function") throw new Error("Сборщик модели не подключён — обновите Astral.");
  const pixels = floatLogoPixels(image.rgba, image.width, image.height, project);
  const mesh = floatLogoMesh(pixels, image.width, image.height, project);
  if (!mesh) throw new Error("В картинке лого нет непрозрачных точек — нужна картинка с фигурой.");
  const atlas = atlasOf(pixels, image.width, image.height);
  const uvs = new Float32Array(mesh.uvs.length);
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    const [u, v] = atlas.uv(mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]);
    uvs[index * 2] = Math.round(u * 1e5) / 1e5;
    uvs[index * 2 + 1] = Math.round(v * 1e5) / 1e5;
  }
  const frames = floatLogoFrames(floatLogoMotion(project));
  const dds = encodeDds({ width: ATLAS, height: ATLAS, format: "DXT5", mipLevels: fullMipLevels(ATLAS, ATLAS), rgba: atlas.rgba });
  const staging = path.join(stateDir, "recolor", "floatlogo", "build", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const texture = path.join(staging, "logo.dds");
    await fs.writeFile(texture, dds, { flag: "wx" });
    const round = (value) => Math.round(value * 1e5) / 1e5;
    const modelRequest = path.join(staging, "model.json");
    await fs.writeFile(
      modelRequest,
      JSON.stringify({
        format: "astral.compile-star-model",
        version: 1,
        name: FLOAT_LOGO_MODEL,
        clipDictionary: frames ? FLOAT_LOGO_CLIPS : null,
        texture,
        textureSha256: `sha256:${createHash("sha256").update(dds).digest("hex")}`,
        width: ATLAS,
        height: ATLAS,
        lodDist: project.drawDistance,
        shader: "emissive_alpha",
        emissive: project.glow,
        mesh: {
          positions: Array.from(mesh.positions, round),
          normals: Array.from(mesh.normals, round),
          uvs: Array.from(uvs),
          parts: Array.from(mesh.parts),
          indices: Array.from(mesh.indices),
        },
        motion: frames,
      }),
    );
    const modelOut = path.join(staging, "model");
    const result = await compile("compile-star-model", { input: modelRequest, output: modelOut });
    const files = [{ name: `${FLOAT_LOGO_MODEL}.ydr`, bytes: await fs.readFile(path.join(modelOut, `${FLOAT_LOGO_MODEL}.ydr`)) }];
    if (frames) files.push({ name: `${FLOAT_LOGO_CLIPS}.ycd`, bytes: await fs.readFile(path.join(modelOut, `${FLOAT_LOGO_CLIPS}.ycd`)) });
    if (files.some((file) => !file.bytes?.length)) throw new Error("Сборка модели лого не дала файлов.");
    /* Сущность: ось фигуры (кость скелета) — над точкой мода, низ лого — на
       заданной высоте над землёй (середина модели — в её начале координат). */
    const pivot = Array.isArray(result?.pivot) ? result.pivot.map(Number) : [0, 0, 0];
    const bounds = result?.bounds?.min && result?.bounds?.max ? result.bounds : mesh.bounds;
    const position = [FLOAT_LOGO_PLACE.x - pivot[0], FLOAT_LOGO_PLACE.y - pivot[1], FLOAT_LOGO_PLACE.ground + project.height + mesh.half];
    const placeRequest = path.join(staging, "place.json");
    await fs.writeFile(
      placeRequest,
      JSON.stringify({
        format: "astral.compile-placements",
        version: 1,
        types: FLOAT_LOGO_TYPES,
        map: FLOAT_LOGO_MAP,
        manifest: true,
        archetypes: [
          {
            name: FLOAT_LOGO_MODEL,
            lodDist: project.drawDistance,
            bbMin: bounds.min,
            bbMax: bounds.max,
            flags: frames ? ANIMATED_ARCHETYPE_FLAGS : 0,
            ...(frames ? { clipDictionary: FLOAT_LOGO_CLIPS } : {}),
          },
        ],
        entities: [{ archetype: FLOAT_LOGO_MODEL, position, lodDist: project.drawDistance, flags: 32 }],
      }),
    );
    const placeOut = path.join(staging, "place");
    await compile("compile-placements", { input: placeRequest, output: placeOut });
    for (const name of [`${FLOAT_LOGO_TYPES}.ytyp`, `${FLOAT_LOGO_MAP}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(placeOut, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка лого не дала ${name}.`);
      files.push({ name, bytes });
    }
    return {
      files,
      patches: [{ file: "floatlogo", models: files.map((file) => file.name) }],
      report: { vertices: mesh.positions.length / 3, animated: Boolean(frames), position, lodDist: project.drawDistance, files: files.length },
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
