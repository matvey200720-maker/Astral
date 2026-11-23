/*
 * Картинки работы маппинга главному процессу — эмблемы мест. Одна функция на
 * «Применить» редактора и установку работы из «Моих работ» без открытого
 * редактора (`install-queue/tasks/recolor.js`).
 */

import { emblemImages } from "../emblem/emblem-items.js";
import { finishImagesFor } from "../finish/finish-assets.js";
import { placeItemLookModels } from "@modovik/climb-contract/recolor/place-item-looks";
import { placeModelImages } from "../models/model-assets.js";

export async function mappingImages(project) {
  /* Эмблемы, свои картинки отделки парковки (ТЗ 17.10.2026) и свои модели (задача 1 ТЗ 11.10.2026, вечер). */
  const parts = [
    await emblemImages(project?.emblems),
    await finishImagesFor(Object.values(project?.locations || {})),
    await placeModelImages([...(project?.models || []), ...placeItemLookModels(project?.items)]),
  ].filter(Boolean);
  return parts.length ? Object.assign({}, ...parts) : null;
}
