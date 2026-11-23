/*
 * Свои картинки листов арены мода в кадре (28.10.2026, «замена листа»): лист мода со своей картинкой в зале рисуется этой картинкой, растянутой по развёртке, —
 * тем же, что уедет в игру (`recolor-arena-mod.js`: `{ fit: "stretch", background: "clear" }`).
 *
 * Картинки лежат в хранилище окна под отпечатком (`hangar-emblem:<sha256>`, как у остальной студии арены). Хук читает только листы режима «картинка», держит
 * текстуры по имени листа и освобождает прежние, когда набор меняется.
 */

import { useEffect, useMemo, useState } from "react";
import { arenaModSheetImages } from "@modovik/climb-contract/recolor/arenas";
import { assetPixels, textureOf } from "./arena-composites.js";

/** `Map` имя листа → текстура кадра для листов мода со своей картинкой. */
export function useArenaModTextures(mod) {
  const wanted = useMemo(() => Object.entries(arenaModSheetImages(mod)).sort(([left], [right]) => (left < right ? -1 : 1)), [mod]);
  const signature = JSON.stringify(wanted);
  const [textures, setTextures] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map();
      for (const [sheet, asset] of JSON.parse(signature)) {
        const pixels = await assetPixels(asset);
        const texture = pixels ? textureOf(pixels.rgba, pixels.width, pixels.height) : null;
        if (texture) next.set(sheet, texture);
      }
      if (cancelled) {
        for (const texture of next.values()) texture.dispose?.();
        return;
      }
      setTextures((previous) => {
        for (const texture of previous.values()) texture.dispose?.();
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [signature]);
  return textures;
}
