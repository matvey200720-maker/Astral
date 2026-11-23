/*
 * «Интерьеры Majestic RP» — текстуры кадра для листов со своей картинкой (ТЗ 29.10.2026-e): `Map` ключ хранилища → текстура. Картинка читается из хранилища окна один раз
 * на ключ; убранная из работы отпускается (`dispose`), на выходе из редактора отпускаются все. Пока текстура не пришла, лист рисуется как в игре.
 */

import { useEffect, useRef, useState } from "react";
import { loadSheetPictureTexture } from "./majestic-sheet-pictures.js";

/** `assets` — ключи картинок работы (`sheetPicturesOf`); результат — `Map` с теми, что уже прочитаны (новая `Map` на каждое изменение). */
export function useSheetPictureTextures(assets) {
  const cache = useRef(new Map());
  const [textures, setTextures] = useState(() => new Map());
  const key = assets.join("|");

  useEffect(() => {
    let alive = true;
    const wanted = new Set(assets);
    let changed = false;
    for (const [asset, texture] of cache.current) {
      if (wanted.has(asset)) continue;
      texture.dispose();
      cache.current.delete(asset);
      changed = true;
    }
    if (changed) setTextures(new Map(cache.current));
    (async () => {
      let arrived = false;
      for (const asset of assets) {
        if (cache.current.has(asset)) continue;
        const texture = await loadSheetPictureTexture(asset).catch(() => null);
        if (!alive) {
          texture?.dispose();
          return;
        }
        if (!texture) continue;
        cache.current.set(asset, texture);
        arrived = true;
      }
      if (arrived) setTextures(new Map(cache.current));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ключи собраны в `key`: состав списка тот же, пока строка та же
  }, [key]);

  useEffect(
    () => () => {
      for (const texture of cache.current.values()) texture.dispose();
      cache.current.clear();
    },
    [],
  );
  return textures;
}
