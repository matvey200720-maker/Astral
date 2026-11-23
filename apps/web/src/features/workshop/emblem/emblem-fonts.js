/*
 * Свои шрифты мастерской: файл TTF, OTF или WOFF человека лежит в хранилище
 * окна (`workshop-font:<sha256>`), окно регистрирует его в наборе шрифтов
 * документа, и холст пишет им по имени семейства.
 *
 * Общее у эмблем-надписей «Завода», «Ангара», «Маппинга» и «Арены»
 * (`emblem-items.js`, задача 1 ТЗ 05.10.2026) и у надписей мастерской
 * оружия и одежды (задача 3 ТЗ 05.10.2026). Отдельным модулем — чтобы
 * мастерской не тянуть за шрифтами разбор эмблем и декалей.
 */

import { FONT_ASSET_EXTENSIONS, getWorkshopAsset, prepareWorkshopAsset, putWorkshopAsset } from "../../../components/desktop/workshop/workshop-assets.js";
import { tr } from "../../../locales/ui.js";

/** Имя семейства своего шрифта в наборе шрифтов документа. */
export const emblemFontFamily = (fontAsset) => `astral-emblem-font-${String(fontAsset || "").slice(-16)}`;

/** Ключ своего шрифта в хранилище окна — только такого вида. */
export const isWorkshopFontAsset = (value) => /^workshop-font:[a-f0-9]{64}$/.test(String(value || ""));

const loadedFonts = new Map();
/* Шрифты, что уже в наборе шрифтов документа: холст пишет своим шрифтом только после этого. */
const readyFonts = new Set();

/** Свой шрифт уже можно рисовать (надпись в кэше до этого вышла бы запасным). */
export const isEmblemFontReady = (fontAsset) => readyFonts.has(fontAsset);

/**
 * Свой шрифт в наборе шрифтов документа (один раз на файл): `true`, если
 * им можно писать. Файла нет в хранилище — `false` (надпись — рубленым).
 */
export function ensureEmblemFont(fontAsset) {
  if (!fontAsset) return Promise.resolve(false);
  if (loadedFonts.has(fontAsset)) return loadedFonts.get(fontAsset);
  const pending = (async () => {
    if (typeof FontFace === "undefined" || !globalThis.document?.fonts) return false;
    const blob = await getWorkshopAsset(fontAsset).catch(() => null);
    if (!blob) return false;
    const face = new FontFace(emblemFontFamily(fontAsset), await blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    readyFonts.add(fontAsset);
    return true;
  })().catch(() => false);
  loadedFonts.set(fontAsset, pending);
  pending.then((ok) => {
    if (!ok) loadedFonts.delete(fontAsset);
  });
  return pending;
}

/**
 * Свой шрифт из файла человека: проверка (TTF, OTF, WOFF, WOFF2 по подписи
 * файла), хранилище окна и набор шрифтов документа. `{ fontAsset, fontName }`.
 */
export async function saveEmblemFont(file) {
  const prepared = await prepareWorkshopAsset(file, { extensions: FONT_ASSET_EXTENSIONS });
  const fontAsset = `workshop-font:${prepared.metadata.hash}`;
  await putWorkshopAsset(fontAsset, prepared.blob);
  if (!(await ensureEmblemFont(fontAsset))) throw new Error("Этот шрифт окно прочитать не смогло — попробуйте другой файл (TTF, OTF или WOFF).");
  const fontName = String(file?.name || tr("Свой шрифт")).replace(/\.[^.]+$/, "").slice(0, 60);
  return { fontAsset, fontName };
}
