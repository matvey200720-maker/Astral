/*
 * Картинки работы «Билборды» для «Применить»: свои картинки щитов, что
 * уходят в игру, — из хранилища окна, base64 в главный процесс (ключи — как
 * у картинок отделки); рисунки на полотнах окно делает картинкой само
 * (`billboards-drawing.js`, ключ — `billboardDrawingKey`). Нет своих
 * картинок и рисунков — `null`.
 */

import { billboardsDrawings, billboardsImageAssets, isBillboardDrawingKey } from "@modovik/climb-contract/recolor/billboards";
import { finishImagesPayload } from "../finish/finish-assets.js";
import { drawingPngBase64 } from "./billboards-drawing.js";

export async function billboardsImages(project) {
  const keys = [...billboardsImageAssets(project).keys()];
  if (!keys.length) return null;
  const finishes = await finishImagesPayload(keys.filter((key) => !isBillboardDrawingKey(key)));
  for (const [key, drawing] of billboardsDrawings(project)) {
    const data = await drawingPngBase64(drawing);
    if (!data) throw new Error("Рисунок на щите не получилось сделать картинкой — откройте редактор билбордов в Astral Desktop.");
    finishes[key] = { data };
  }
  return { finishes };
}
