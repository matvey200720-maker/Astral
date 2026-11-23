/*
 * Картинки работы «Остановки» для «Применить»: свои картинки отделки частей
 * (облик всех остановок и заведённые облики видов) — из хранилища окна,
 * base64 в главный процесс. Нет своих картинок — `null`.
 */

import { busStopsImageAssets } from "@modovik/climb-contract/recolor/busstops";
import { finishImagesPayload } from "../finish/finish-assets.js";

export async function busStopsImages(project) {
  const assets = [...busStopsImageAssets(project).keys()];
  if (!assets.length) return null;
  return { finishes: await finishImagesPayload(assets) };
}
