import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { bleedTransparent, fullMipLevels } from "@modovik/dds";
import {
  OWN_MODEL_LIMITS,
  normalizeOwnFit,
  ownModelMeshes,
  readGlb,
  sheetSizes,
  toRageAxes,
} from "@modovik/gun-studio/own-model";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { inflateRawNode as inflateRaw } from "@modovik/rpf7/node";
import { deflateRaw } from "@modovik/native-rs";
import { readDrawable } from "@modovik/rage-drawable";
import { heavyWork } from "./heavy-work.js";
import { decodeBase64Payload } from "./base64-payload.js";

/*
 * Своя модель ствола из `.glb` — в игру (задача 6 ТЗ 17.10.2026).
 *
 * Окно присылает GLB байтами (data URL) и подгонку (`fit`): масштаб,
 * поворот и сдвиг в оси модели ствола. Здесь — то же, что видел кадр:
 * разбор GLB тем же кодом (`@modovik/gun-studio/own-model.js`), пределы,
 * упрощение тяжёлой модели (в потоке-работнике: на миллионе треугольников
 * это секунды), разрезка на куски по 4 368 вершин, листы — DXT5 со всеми
 * мипами по степеням двойки. Дальше хост (`decorate-drawable` версии 3,
 * `replace`) ставит куски в модель ствола из игры игрока вместо его
 * геометрий; скелет и кости — штатные. В руках (`_hi`) — полная модель до
 * 40 000 треугольников, вдали (обычная `.ydr`) — до 10 000.
 *
 * Штатный магазин — своя модель (`<ствол>_mag1.ydr`, кость `WAPClip`): у
 * своей модели магазин обычно свой, и штатный по выбору прячется —
 * треугольники сводятся в точку, как надписи оружия (`weapon-inscriptions`).
 */

const DATA_GLB = /^data:(?:model\/gltf-binary|application\/octet-stream);base64,/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Своя модель в запросе скина: `{ bytes, fit, magazine }` или `null` (её нет).
 * GLB — data URL до 32 МБ; подгонка — в границах; магазин — `hide` / `keep`.
 */
export function normalizeOwnModelRequest(input) {
  if (!input || typeof input !== "object") return null;
  const value = String(input.glb || "");
  if (!DATA_GLB.test(value)) throw refusal("OWN_MODEL_FILE", "Своя модель пришла без файла .glb.");
  /* Длина и запись base64 — до декодирования (`base64-payload.js`). */
  const decoded = decodeBase64Payload(value.replace(DATA_GLB, ""), OWN_MODEL_LIMITS.fileBytes);
  if (decoded.error === "format") throw refusal("OWN_MODEL_FILE", "Файл своей модели пришёл повреждённым (не base64) — выберите его ещё раз.");
  if (decoded.error) throw refusal("OWN_MODEL_FILE", `Файл своей модели больше ${OWN_MODEL_LIMITS.fileBytes / 1024 / 1024} МБ — упрости модель или сожми её картинки.`);
  const { bytes } = decoded;
  return {
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    sha256: `sha256:${sha256(bytes)}`,
    fit: normalizeOwnFit(input.fit),
    magazine: input.magazine === "keep" ? "keep" : "hide",
  };
}

/**
 * Сетки своей модели для детализации `lod` — в потоке-работнике, если он
 * есть: `ownModelMeshes` на тяжёлой модели — секунды.
 */
export async function ownModelMeshesOffThread(bytes, fit, lod, { run = heavyWork.run } = {}) {
  return run("own-model-meshes", { bytes, fit, lod });
}

/* Задача пула: разбор GLB и сетки — без картинок (их кодирует главный процесс). */
export function ownModelMeshesJob({ bytes, fit, lod }) {
  const model = readGlb(bytes, { maxTriangles: OWN_MODEL_LIMITS.inputTriangles });
  const result = ownModelMeshes(model, fit, { lod });
  return {
    pieces: result.pieces,
    sheets: result.sheets,
    triangles: result.triangles,
    vertices: result.vertices,
    simplified: result.simplified,
    bounds: result.bounds,
    images: model.images.map((image) => ({ mimeType: image.mimeType, bytes: image.bytes.slice() })),
  };
}

/* Картинка цвета: GLB → RGBA нужного размера, с цветом материала; прозрачность — только у прозрачных. */
async function imageSheet(image, sheet, size) {
  let pixels;
  try {
    const { data } = await sharp(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength), { failOn: "error" })
      .ensureAlpha()
      .resize(size.width, size.height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch {
    throw refusal("OWN_MODEL_IMAGE", "Картинку своей модели не прочитать — сохрани её в GLB как PNG или JPEG.");
  }
  const [r, g, b, a] = sheet.colour;
  for (let at = 0; at < pixels.length; at += 4) {
    pixels[at] = Math.round(pixels[at] * r);
    pixels[at + 1] = Math.round(pixels[at + 1] * g);
    pixels[at + 2] = Math.round(pixels[at + 2] * b);
    pixels[at + 3] = sheet.alpha ? Math.round(pixels[at + 3] * a) : 255;
  }
  return sheet.alpha ? bleedTransparent(pixels, size.width, size.height) : pixels;
}

/* Лист цветов материалов без картинки: 8×8 клеток по 4×4 точки (`colourCellUv`). */
function colourSheet(sheet) {
  const size = 32;
  const rgba = new Uint8Array(size * size * 4);
  sheet.colours.forEach((colour, cell) => {
    const x0 = (cell % 8) * 4;
    const y0 = Math.floor(cell / 8) * 4;
    for (let y = y0; y < y0 + 4; y += 1)
      for (let x = x0; x < x0 + 4; x += 1) {
        const at = (y * size + x) * 4;
        rgba[at] = Math.round(colour[0] * 255);
        rgba[at + 1] = Math.round(colour[1] * 255);
        rgba[at + 2] = Math.round(colour[2] * 255);
        rgba[at + 3] = sheet.alpha ? Math.round(colour[3] * 255) : 255;
      }
  });
  return rgba;
}

/**
 * Своя модель для запроса хоста: `{ body: { textures, pieces }, report }`.
 * Листы — DDS в `staging`, куски — в осях модели игры (RAGE: x, −z, y).
 */
export async function buildOwnModelBody(
  { own, lod = "high", staging, prefix = "astral_body_", extra = null },
  { meshes = ownModelMeshesOffThread, encode = (options) => heavyWork.run("encode-dds", options) } = {},
) {
  await fs.mkdir(staging, { recursive: true });
  let built;
  try {
    built = await meshes(own.bytes, own.fit, lod);
  } catch (error) {
    if (error?.code) throw error;
    throw refusal("OWN_MODEL_READ", `Свою модель не прочитать: ${error?.message || error}`);
  }
  /* Листы только тех материалов, что остались в кусках; имена — по порядку. */
  const used = built.sheets.map((sheet, index) => ({ sheet, index })).filter((item) => item.sheet.used);
  const imageSizes = [];
  for (const { sheet } of used) {
    if (sheet.kind !== "image") {
      imageSizes.push({ width: 32, height: 32 });
      continue;
    }
    const meta = await sharp(Buffer.from(built.images[sheet.image].bytes)).metadata().catch(() => null);
    imageSizes.push({ width: meta?.width || 256, height: meta?.height || 256 });
  }
  const sizes = sheetSizes(imageSizes, { lod });
  const textures = [];
  const nameOf = new Map();
  for (const [at, { sheet, index }] of used.entries()) {
    /* `prefix` — `astral_part_` у обвесов (задача 6 ТЗ 17.10.2026). */
    const name = `${prefix}${String(at + 1).padStart(2, "0")}`;
    const size = sheet.kind === "image" ? sizes[at] : { width: 32, height: 32 };
    const rgba = sheet.kind === "image" ? await imageSheet(built.images[sheet.image], sheet, size) : colourSheet(sheet);
    const dds = await encode({ width: size.width, height: size.height, format: "DXT5", mipLevels: fullMipLevels(size.width, size.height), rgba });
    const file = path.join(staging, `${name}.dds`);
    await fs.writeFile(file, dds);
    textures.push({ name, texture: file, textureSha256: `sha256:${sha256(dds)}`, width: size.width, height: size.height });
    nameOf.set(index, { name, alpha: Boolean(sheet.alpha) });
  }
  const pieces = built.pieces.map((piece) => ({
    texture: nameOf.get(piece.sheet).name,
    alpha: nameOf.get(piece.sheet).alpha,
    positions: Array.from(toRageAxes(piece.positions)),
    normals: Array.from(toRageAxes(piece.normals)),
    uvs: Array.from(piece.uvs),
    indices: Array.from(piece.indices),
    /* Обвесы: кость куска (`extra`), хост держит его за неё. */
    ...(extra ? extra(piece) : {}),
  }));
  return {
    body: { textures, pieces },
    report: {
      lod,
      triangles: built.triangles,
      vertices: built.vertices,
      pieces: pieces.length,
      textures: textures.map((item) => `${item.width}×${item.height}`),
      simplified: built.simplified,
    },
  };
}

/**
 * Штатный магазин без треугольников: каждый треугольник — в точку (как
 * надписи оружия), буферы, кости и шейдеры те же. `null` — нечего прятать
 * или модель не читается.
 */
export function hideMagazineModel(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let resource;
  try {
    resource = openResourceWith(raw, inflateRaw);
  } catch {
    return null;
  }
  const data = new DataView(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength);
  const seen = new Set();
  let hidden = 0;
  for (const lod of ["high", "medium", "low", "veryLow"]) {
    let parsed;
    try {
      parsed = readDrawable(resource, { inflateRaw, lod });
    } catch {
      continue;
    }
    for (const drawable of parsed.drawables)
      for (const mesh of drawable.meshes) {
        if (!Number.isInteger(mesh.indicesAt) || seen.has(mesh.indicesAt)) continue;
        seen.add(mesh.indicesAt);
        for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
          const first = mesh.indices[triangle * 3];
          data.setUint16(mesh.indicesAt + (triangle * 3 + 1) * 2, first, true);
          data.setUint16(mesh.indicesAt + (triangle * 3 + 2) * 2, first, true);
          hidden += 1;
        }
      }
  }
  if (!hidden) return null;
  const body = deflateRaw(Buffer.from(resource.data.buffer, resource.data.byteOffset, resource.data.byteLength), { level: 9 });
  const out = new Uint8Array(RSC7_HEADER_BYTES + body.length);
  out.set(raw.subarray(0, RSC7_HEADER_BYTES));
  out.set(body, RSC7_HEADER_BYTES);
  return { bytes: out, hidden };
}
