/*
 * Картинки работы «Интерьеры» для «Применить»: свои картинки частей мест
 * снаружи (изнутри картинок нет — только цвет и блеск) — из хранилища окна,
 * base64 в главный процесс; эмблемы и надписи на фасадах и вывесках —
 * общей системой мест; картинки и сетки своих моделей (ТЗ 11.10.2026,
 * вечер, задача 1). Нет своих картинок — `null`.
 */

import { normalizeShopsProject, shopsImageAssets } from "@modovik/climb-contract/recolor/shops";
import { emblemImages } from "../emblem/emblem-items.js";
import { finishImagesPayload } from "../finish/finish-assets.js";
import { placeModelImages } from "../models/model-assets.js";

export async function shopsImages(project) {
  const normalized = normalizeShopsProject(project);
  const assets = [...shopsImageAssets(normalized).keys()];
  const emblems = await emblemImages([...normalized.outside.emblems, ...normalized.outside.names]);
  const models = await placeModelImages(normalized.models);
  if (!assets.length && !emblems && !models) return null;
  return { ...(assets.length ? { finishes: await finishImagesPayload(assets) } : {}), ...(emblems || {}), ...(models || {}) };
}
