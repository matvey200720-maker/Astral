/*
 * Картинки работы «Вайнвуд» для главного процесса: маски букв своего
 * слова (рисует окно шрифтом Windows, `vinewood-glyphs.js`) или исходный
 * файл логотипа из хранилища окна. Без кадра редактора: той же функцией
 * ставит и «Применить» редактора, и работа из сборки или «Моих работ».
 */

import { normalizeVinewoodProject } from "@modovik/climb-contract/recolor/vinewood";
import { getWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { placeModelImages } from "../models/model-assets.js";
import { vinewoodGlyphImages } from "./vinewood-glyphs.js";

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/* Картинки надписи или логотипа. */
async function signImages(project) {
  if (project.mode === "text" && project.text.trim()) return vinewoodGlyphImages(project);
  if (project.mode === "logo" && project.logo.asset) {
    const blob = await getWorkshopAsset(project.logo.asset);
    if (!blob) throw new Error("Картинка логотипа пропала из хранилища окна — загрузите её ещё раз.");
    return { logo: { data: await blobBase64(blob) } };
  }
  return null;
}

/** Картинки работы или `null` — картинок не нужно («Как в игре», «Убрать надпись», без своих моделей). */
export async function vinewoodImages(input) {
  const project = normalizeVinewoodProject(input);
  const parts = [await signImages(project), await placeModelImages(project.models)].filter(Boolean);
  return parts.length ? Object.assign({}, ...parts) : null;
}
