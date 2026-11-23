/*
 * Картинки работы «Флаги» для «Применить»: свои картинки флагов, что
 * уходят в игру, — из хранилища окна, base64 в главный процесс (ключи — как
 * у картинок отделки). Флаги стран рисует сам установщик тем же кодом, что
 * окно. Нет своих картинок — `null`.
 */

import { flagsImageAssets } from "@modovik/climb-contract/recolor/flags";
import { finishImagesPayload } from "../finish/finish-assets.js";

export async function flagsImages(project) {
  const assets = [...flagsImageAssets(project).keys()];
  if (!assets.length) return null;
  return { finishes: await finishImagesPayload(assets) };
}
