/*
 * Картинки работы «Банкоматы» для «Применить»: свои картинки панели, клавиатуры,
 * экрана, вывески и полосы логотипов и картинки, нарисованные из своих слов
 * (облик всех банкоматов и заведённые облики моделей) — из хранилища окна,
 * base64 в главный процесс. Нет картинок — `null`.
 */

import { atmsImageAssets } from "@modovik/climb-contract/recolor/atms";
import { finishImagesPayload } from "../finish/finish-assets.js";
import { pendingAtmTexts } from "./atms-text-draw.js";

export async function atmsImages(project) {
  /* Слова только что правили, а картинку окно ещё не дорисовало: старая в игру не поедет. */
  if (pendingAtmTexts(project).length) throw new Error("Надпись ещё рисуется — нажмите «Применить» ещё раз.");
  const assets = [...atmsImageAssets(project).keys()];
  if (!assets.length) return null;
  return { finishes: await finishImagesPayload(assets) };
}
