/*
 * Картинки работы завода главному процессу: эмблема и свои картинки групп и
 * частей. Одна функция на «Применить» редактора и установку работы из «Моих
 * работ» без открытого редактора (задача очереди `install-queue/tasks/recolor.js`).
 */

import { finishImagesFor } from "../finish/finish-assets.js";
import { emblemImages } from "../emblem/emblem-items.js";
import { placeItemLookModels } from "@modovik/climb-contract/recolor/place-item-looks";
import { placeModelImages } from "../models/model-assets.js";

export const FACTORY_GROUP_IDS = Object.freeze(["buildings", "ground", "containers", "props"]);
export const FACTORY_PART_IDS = Object.freeze(["walls", "roofs", "concrete", "metal", "machinery", "details"]);

export async function factoryImages(project) {
  const parts = [
    await emblemImages(project?.emblems),
    await finishImagesFor([...FACTORY_GROUP_IDS.map((id) => project?.[id]), ...FACTORY_PART_IDS.map((id) => project?.parts?.[id])]),
    /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
    await placeModelImages([...(project?.models || []), ...placeItemLookModels(project?.items)]),
  ].filter(Boolean);
  return parts.length ? Object.assign({}, ...parts) : null;
}
