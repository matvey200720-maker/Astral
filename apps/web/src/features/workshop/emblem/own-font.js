import { useEffect, useState } from "react";
import { emblemFontFamily, ensureEmblemFont, isEmblemFontReady, isWorkshopFontAsset } from "./emblem-fonts.js";

/*
 * Свой шрифт в местах, где надпись рисует холст окна (ТЗ 23.10.2026, п. F: «свои шрифты везде»).
 *
 * Редактор хранит в правке `{ font: "custom", fontAsset, fontName }` — как эмблемы-надписи. Холст пишет своим шрифтом
 * по имени семейства, а оно появляется в наборе шрифтов документа не сразу: файл читается из хранилища окна. Три
 * вещи на каждое такое место:
 *   • `ownFontStack` — имя семейства для `context.font` и CSS, с запасными шрифтами на случай, если файла нет;
 *   • `useOwnFontReady` — перерисовать, когда шрифт стал доступен (открыли проект, где шрифт выбран раньше);
 *   • `prepareOwnFonts` — дождаться шрифта перед тем, как картинка уедет в игру, чтобы в текстуре не оказалось
 *     запасного шрифта вместо выбранного.
 */

/** Ключ своего шрифта из правки: `fontAsset`, если `font === "custom"` и файл указан, иначе `""`. */
export const ownFontAssetOf = (style) => (style?.font === "custom" && isWorkshopFontAsset(style.fontAsset) ? style.fontAsset : "");

/** Имя семейства своего шрифта с запасными: `"astral-emblem-font-…", <fallback>`. */
export const ownFontStack = (fontAsset, fallback = "sans-serif") => `"${emblemFontFamily(fontAsset)}", ${fallback}`;

/** Дождаться своих шрифтов: файл не прочитался — запасной (так же, как у эмблем-надписей). */
export async function prepareOwnFonts(...assets) {
  const wanted = [...new Set(assets.filter(isWorkshopFontAsset))];
  await Promise.all(wanted.map((asset) => ensureEmblemFont(asset)));
  return wanted.every((asset) => isEmblemFontReady(asset));
}

/**
 * Хук: загружает свои шрифты и сообщает, все ли готовы. Когда шрифт стал доступен, компонент отрисуется ещё раз —
 * кэши картинок, чьи ключи содержат это значение, пересчитаются заново.
 */
export function useOwnFontReady(...assets) {
  const wanted = [...new Set(assets.filter(isWorkshopFontAsset))];
  const key = wanted.join("|");
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    void Promise.all(key.split("|").map((asset) => ensureEmblemFont(asset))).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [key]);
  return wanted.every((asset) => isEmblemFontReady(asset));
}
