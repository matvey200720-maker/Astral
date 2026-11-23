/*
 * Слои студии — файлом (задача 6Б ТЗ 18.10.2026, п. 5): документ слоёв и растры
 * лежат не только в хранилище окна. «Слои в файл» собирает один архив —
 * описание документа, PNG каждого слоя и вставленные в слои картинки, — а «Слои
 * из файла» открывает его в другой сессии окна, на другом компьютере, после
 * очистки хранилища: работа продолжается со слоями, а не с плоской картинкой.
 *
 * Архив (`.astral-layers`, обычный zip):
 *   studio.json        — { format, version, surface: { id, width, height }, doc, meta, layers, assets }
 *   layers/<слой>.png  — растры слоёв (и основы)
 *   assets/<n>         — картинки, вставленные в слои (`documentAssets`), под своими ключами из `assets`
 *
 * Холст у слоёв — своего размера: в студию другой поверхности они не открываются
 * (слои на 8178 × 1389 в холст 2048 × 2048 не лягут), об этом говорится сразу.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { getWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { documentAssets, parseDocument } from "./engine/document.js";
import { tr } from "../../../locales/ui.js";

export const STUDIO_FILE_FORMAT = "astral-layers";
export const STUDIO_FILE_EXTENSION = "astral-layers";
const STUDIO_FILE_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

const layerFile = (key) => `layers/${String(key).replace(/[^a-zA-Z0-9_.-]/g, "_")}.png`;
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * Архив слоёв: `saved` — `session.save()` (`{ doc, rasters }`), `surface` —
 * `{ id, width, height }`, `meta` — что ещё помнить (`asset`, `baseKind`).
 * `Blob` zip (растры — уже PNG, поэтому без сжатия).
 */
export async function packStudioFile(saved, surface, meta = {}) {
  const doc = parseDocument(saved.doc);
  if (!doc) throw new Error(tr("Документ слоёв не читается — сохранить его в файл нельзя."));
  const files = {};
  const layers = {};
  for (const [key, blob] of Object.entries(saved.rasters || {})) {
    layers[key] = layerFile(key);
    files[layers[key]] = await bytesOf(blob);
  }
  const assets = {};
  for (const [index, asset] of documentAssets(doc).entries()) {
    const blob = await getWorkshopAsset(asset).catch(() => null);
    if (!blob) continue;
    assets[asset] = { file: `assets/${index}`, type: blob.type || "image/png" };
    files[assets[asset].file] = await bytesOf(blob);
  }
  files["studio.json"] = strToU8(
    JSON.stringify({ format: STUDIO_FILE_FORMAT, version: STUDIO_FILE_VERSION, surface: { id: surface.id, width: surface.width, height: surface.height }, doc: saved.doc, meta, layers, assets }),
  );
  return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
}

/**
 * Открыть архив слоёв для холста `{ width, height }`: `{ doc, rasters, meta }` —
 * как у `loadStudioDocument`. Картинки, вставленные в слои, возвращаются в
 * хранилище окна под своими ключами. Бросает понятной ошибкой: не тот файл,
 * не та версия, холст другого размера.
 */
export async function unpackStudioFile(blob, { width, height }) {
  if (Number(blob?.size || 0) > MAX_FILE_BYTES) throw new Error(tr("Файл слоёв слишком большой."));
  let entries;
  try {
    entries = unzipSync(await bytesOf(blob));
  } catch {
    throw new Error(tr("Это не файл слоёв Astral."));
  }
  let manifest = null;
  try {
    manifest = JSON.parse(strFromU8(entries["studio.json"]));
  } catch {
    manifest = null;
  }
  if (manifest?.format !== STUDIO_FILE_FORMAT || typeof manifest.doc !== "string") throw new Error(tr("Это не файл слоёв Astral."));
  if (manifest.version > STUDIO_FILE_VERSION) throw new Error(tr("Файл слоёв сделан более новой версией Astral — обновите приложение."));
  const doc = parseDocument(manifest.doc);
  if (!doc) throw new Error(tr("Документ слоёв в файле не читается."));
  if (doc.width !== width || doc.height !== height) throw new Error(`${tr("Слои из файла — на холсте")} ${doc.width} × ${doc.height}, ${tr("а здесь холст")} ${width} × ${height}.`);
  const rasters = {};
  for (const [key, file] of Object.entries(manifest.layers || {})) if (entries[file]) rasters[key] = new Blob([entries[file]], { type: "image/png" });
  for (const [asset, item] of Object.entries(manifest.assets || {})) if (entries[item.file]) await putWorkshopAsset(asset, new Blob([entries[item.file]], { type: item.type || "image/png" }));
  return { doc: manifest.doc, rasters, meta: manifest.meta || {} };
}

/** Имя файла слоёв: `<поверхность>.astral-layers`. */
export const studioFileName = (surface) => `${String(surface.slug || surface.id || "texture").replace(/[^a-zA-Z0-9._-]+/g, "-")}.${STUDIO_FILE_EXTENSION}`;
