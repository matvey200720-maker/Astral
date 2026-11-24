/*
 * Картинки работы ангара главному процессу: эмблемы с надписями и свои
 * картинки отделки. Одна функция на «Применить» редактора и установку работы
 * из «Моих работ» без открытого редактора (`install-queue/tasks/recolor.js`).
 */

import { finishImagesFor } from "../finish/finish-assets.js";
import { emblemImages } from "../emblem/emblem-items.js";
import { placeModelImages } from "../models/model-assets.js";

export async function hangarImages(project) {
  const parts = [
    await emblemImages(project?.emblems),
    await finishImagesFor([project?.outside, project?.inside, project?.floor, project?.ceiling]),
    /* Свои модели (задача 1 ТЗ 11.10.2026, вечер). */
    await placeModelImages(project?.models),
  ].filter(Boolean);
  return parts.length ? Object.assign({}, ...parts) : null;
}
