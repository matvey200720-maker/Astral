/*
 * Картинки работы «Дороги» для «Применить»: свои текстуры частей — из
 * хранилища окна, base64 в главный процесс. Нет своих текстур — `null`.
 */

import { roadsImageAssets } from "@modovik/climb-contract/recolor/roads";
import { finishImagesPayload } from "../finish/finish-assets.js";

export async function roadsImages(project) {
  const assets = [...roadsImageAssets(project).keys()];
  if (!assets.length) return null;
  return { finishes: await finishImagesPayload(assets) };
}
