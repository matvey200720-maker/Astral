/*
 * Задачи пула тяжёлой работы (`heavy-work.js`) — чистые функции: байты на
 * входе, байты на выходе. Их считает поток-работник, а если поток не
 * поднялся — главный процесс тем же кодом.
 */

import { BLOCK_FORMATS, encodeDds } from "@modovik/dds";
import { materialPixels } from "@modovik/rage-drawable";
import { transferSkin } from "@modovik/clothing/skin-transfer";
import { CATALOG_V2_DICTIONARIES, readRememberedCatalogFile } from "./cloud-catalog.js";
import { yptTextureFiles } from "./ypt-textures.js";

const bytesOf = (value) =>
  value instanceof Uint8Array ? value : value ? new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength ?? value.length) : null;

/**
 * Пиксели покраски → DDS в раскладке заводской текстуры (часть
 * `bakeTexture` после разбора PNG): альфа заводской текстуры у
 * непрозрачных материалов, материал ствола (стекло, рентген) или ровная
 * альфа прозрачной детали, затем сжатие всей цепочки mip.
 */
export function bakeTexturePixels({ painted, stock = null, opaque = true, layout, alpha = null, material = null }) {
  const pixels = bytesOf(painted);
  const original = bytesOf(stock);
  if (opaque && original) for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = original[offset];
  if (material) {
    const rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length);
    materialPixels(rgba, layout.width, layout.height, { material: material.kind, tint: material.tint, opacity: alpha ?? 1 });
  } else if (alpha !== null) {
    const value = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = value;
  }
  if (!BLOCK_FORMATS.includes(layout.format) && layout.format !== "A8R8G8B8") throw new Error(`формат ${layout.format} не поддерживается`);
  return encodeDds({
    width: layout.width,
    height: layout.height,
    format: layout.format,
    mipLevels: layout.mipLevels,
    rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
  });
}

/** Сжатие DDS (`@modovik/dds` `encodeDds`) с теми же полями. */
export function encodeDdsJob({ width, height, format, mipLevels, rgba }) {
  const pixels = bytesOf(rgba);
  return encodeDds({ width, height, format, mipLevels, rgba: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length) });
}

/*
 * Вода (`water-tiles.js`): плитка тумана и файл реки в облике работы.
 * Облик компилируется из проекта здесь же и помнится на поток — задачи
 * одной сборки идут с одним проектом.
 */
let waterLooksKey = "";
let waterLooksValue = null;
async function waterLooksOf(project) {
  const key = JSON.stringify(project);
  if (key !== waterLooksKey) {
    const { compileWaterLooks } = await import("@modovik/climb-contract/recolor/water");
    waterLooksValue = compileWaterLooks(project);
    waterLooksKey = key;
  }
  return waterLooksValue;
}

const bytesOrNull = (bytes) => (bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice() : null);

export async function waterFogTileJob({ bytes, name, rect, project, lakes }) {
  const { recolourFogTile } = await import("./water-tiles.js");
  return bytesOrNull(recolourFogTile(Buffer.from(bytesOf(bytes)), name, rect, await waterLooksOf(project), lakes));
}

export async function waterRiverJob({ bytes, river, project }) {
  const { recolourRiverFile } = await import("./water-tiles.js");
  return bytesOrNull(recolourRiverFile(Buffer.from(bytesOf(bytes)), river, await waterLooksOf(project)));
}

/* «Билборды» (задача 4 ТЗ 10.10.2026, вечер): листы одного файла района с картинками щитов. */
export async function billboardFileJob(payload) {
  const { paintBillboardFile } = await import("./recolor-billboards-paint.js");
  return paintBillboardFile(payload);
}

/* Своя модель ствола (задача 6 ТЗ 17.10.2026): разбор GLB, упрощение и куски — секунды на тяжёлой модели. */
export async function ownModelMeshesJob(payload) {
  const { ownModelMeshesJob: job } = await import("./weapon-own-model.js");
  return job(payload);
}

/* Разбор .glb украшения на стволе (чужой файл): не в главном процессе (проверка границ доверия, ТЗ 17.10.2026). */
export async function glbReadJob({ bytes, maxTriangles }) {
  const { readGlb } = await import("@modovik/gun-studio/own-model");
  return readGlb(bytes, { maxTriangles });
}

/*
 * Запомненный облачный каталог (`cloud-catalog.js`): файл читается и проверяется
 * страницами в потоке, окно на старте не ждёт главный процесс (21.10.2026: на
 * каталоге 5000 модов разбор держал главный процесс на 0,3 с).
 */
export function rememberedCatalogJob({ file, origin, mediaOrigin }) {
  return readRememberedCatalogFile({ file, origin, mediaOrigin, dictionaries: CATALOG_V2_DICTIONARIES });
}

/* Текстуры словаря YPT (превью трассеров, сборки QA и заблокированных паков): разбор и DDS — в потоке. */
export function yptTexturesJob({ bytes, only = null }) {
  return yptTextureFiles(bytes, only);
}

/*
 * Перенос скина мужской вещи на женскую пару (`clothing-skin-transfer.js`): растеризация женской развёртки и поиск ближайшей мужской поверхности
 * для каждой точки — сотни тысяч запросов, секунды без передышки: в потоке, а не в главном процессе.
 */
export function transferSkinJob({ female, male, options }) {
  const result = transferSkin({ female, male }, options);
  return { rgba: result.rgba, width: result.width, height: result.height, coverage: result.coverage };
}

export const HEAVY_JOBS = Object.freeze({
  "transfer-skin": transferSkinJob,
  "bake-texture-pixels": bakeTexturePixels,
  "encode-dds": encodeDdsJob,
  "water-fog-tile": waterFogTileJob,
  "water-river": waterRiverJob,
  "billboard-file": billboardFileJob,
  "own-model-meshes": ownModelMeshesJob,
  "glb-read": glbReadJob,
  "remembered-catalog": rememberedCatalogJob,
  "ypt-textures": yptTexturesJob,
});
