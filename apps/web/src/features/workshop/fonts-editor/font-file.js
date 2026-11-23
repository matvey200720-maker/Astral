/*
 * Свой файл шрифта — в хранилище окна, как своя картинка эмблемы.
 *
 * Файл живёт в IndexedDB мастерской (`workshop-assets.js`) под отпечатком
 * `font-file:<sha256>`; в работе — только этот ключ, имя файла и семейство.
 * Работа остаётся лёгкой строкой, а один и тот же файл не копится дважды.
 * В код для друга файл не едет — у друга встанет шаблон, о чём код и
 * говорит. В главный процесс файл уходит base64-строкой
 * (`images.font.data`): установщик сверяет её с отпечатком из работы.
 */

import { readFontFile } from "@modovik/gfx/fonts";
import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  putWorkshopAsset,
  workshopBlobBytes,
} from "../../../components/desktop/workshop/workshop-assets.js";

/* TTF, OTF, коллекция TTC и WOFF; WOFF2 разбирать нечем — его пересохраняют. */
export const FONT_FILE_EXTENSIONS = new Set(["ttf", "otf", "ttc", "woff"]);
export const FONT_FILE_ACCEPT = ".ttf,.otf,.ttc,.woff";
export const FONT_FILE_LIMIT = 16 * 1024 * 1024;

const CYRILLIC = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const LATIN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Сколько русских и латинских букв и цифр есть в шрифте: `{ cyrillic, latin }` (доли 0…1). */
export function fontCoverage(font) {
  const share = (text) => [...text].filter((char) => font.glyphOf(char.codePointAt(0))).length / [...text].length;
  return { cyrillic: share(CYRILLIC), latin: share(LATIN) };
}

/**
 * Файл человека → шрифт в хранилище: `{ asset, name, family, coverage }`.
 * Бросает словами на файле, который не шрифт или который не разобрать.
 */
export async function saveFontFile(file) {
  if (Number(file?.size || 0) > FONT_FILE_LIMIT) throw new Error("Файл шрифта больше 16 МБ — возьмите поменьше.");
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  if (extension === "woff2") throw new Error("WOFF2 не читается — пересохраните шрифт в TTF или OTF.");
  if (!FONT_FILE_EXTENSIONS.has(extension)) throw new Error("Нужен файл шрифта: TTF, OTF, TTC или WOFF.");
  const { blob, metadata } = await prepareWorkshopAsset(file, { extensions: FONT_FILE_EXTENSIONS });
  const bytes = await workshopBlobBytes(blob);
  let font;
  try {
    font = readFontFile(bytes);
  } catch (error) {
    throw new Error(`Шрифт не читается: ${error.message}`);
  }
  const coverage = fontCoverage(font);
  if (!coverage.latin && !coverage.cyrillic) throw new Error("В шрифте нет ни латинских, ни русских букв — в игре он ничего не заменит.");
  const asset = `font-file:${metadata.hash}`;
  await putWorkshopAsset(asset, blob);
  const family = [font.family, font.subfamily && font.subfamily !== "Regular" ? font.subfamily : ""].filter(Boolean).join(" ");
  return { asset, name: metadata.name, family: family.slice(0, 120), coverage };
}

/** Байты своего файла из хранилища или `null`. */
export async function fontFileBytes(asset) {
  if (!asset) return null;
  const blob = await getWorkshopAsset(asset);
  return blob ? workshopBlobBytes(blob) : null;
}

function base64Of(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

/** Файл работы для «Применить»: `{ font: { data } }` или `null` у шаблона. */
export async function fontsImages(project) {
  if (project?.source?.kind !== "file" || !project.source.file?.asset) return null;
  const bytes = await fontFileBytes(project.source.file.asset);
  if (!bytes) throw new Error("Файл шрифта пропал из хранилища окна — загрузите его ещё раз.");
  return { font: { data: base64Of(bytes) } };
}
