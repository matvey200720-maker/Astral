// Подготовка и чтение картинок, которые кладут на карту.
import { humanFailure } from "../../../../utils/installFailure.js";
import { prepareMapPicture, MAP_PICTURE_NAME } from "../world-map-picture.js";
import { attempt } from "./dom-guards.js";
import { FONT_FILE_NAME } from "./panel-data.js";

// Исход вызова, который мог отказать: { value } либо { failure }
const settle = (job) => Promise.resolve().then(job).then((value) => ({ value }), (failure) => ({ failure }));

const lowerName = (file) => String(file.name || "").toLowerCase();

// Файл -> { file, gif } либо null (причину уже сказали через say)
export async function readyPicture(file, say) {
  const outcome = await settle(() => prepareMapPicture(file));
  if (!("failure" in outcome)) return outcome.value;
  say?.(humanFailure(outcome.failure));
  return null;
}

// Ширина / высота картинки; 1, если прочесть не вышло
export async function imageAspect(file) {
  const outcome = await settle(() => createImageBitmap(file));
  const bitmap = outcome.value;
  if (!bitmap) return 1;
  const ratio = bitmap.width / bitmap.height;
  attempt(() => bitmap.close?.());
  return ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
}

export const isFontFile = (file) => FONT_FILE_NAME.test(lowerName(file));

export const isPictureFile = (file) =>
  String(file.type || "").startsWith("image/") || MAP_PICTURE_NAME.test(lowerName(file));
