// Растр подложки и всё, что от него зависит: резкий кусок, цвета карты,
// миниатюры видов. Тяжёлую работу делают соседи, здесь только их запуск.
import { useEffect, useMemo, useState } from "react";
import { MOD_PACK_TEMPLATE } from "@modovik/vector-map";
import { baseRasterKey } from "../world-map-base.js";
import { useModPackThumb } from "../world-map-pack-thumb.js";
import { useMapBaseRaster } from "../useMapBaseRaster.js";
import { useVectorDetail } from "../useVectorDetail.js";
import useThumbsOfStyles from "../world-map/useStyleThumbs.js";
import { currentLook } from "../world-map/MapLooks.jsx";

// Миниатюры видов: к виду «Как в игре» добавляется текущий вид-стиль
function styleIdsFor(lookId) {
  const ids = ["original"];
  if (lookId) ids.push(lookId);
  return ids;
}

// Номер вида-стиля; у других видов (шаблон, игра) его нет
function styleIdOf(look) {
  return look.kind === "style" ? look.id : "";
}

function withPackThumb(styles, packThumb) {
  if (!packThumb) return styles;
  const merged = { ...styles };
  merged[MOD_PACK_TEMPLATE] = packThumb;
  return merged;
}

// Штамп подложки только будит пересчёт: цвета читаются после него
function colorsAt(_stamp, processor, base) {
  return processor.sourcesFor(base);
}

// Защёлка: после первого «да» остаётся «да» до закрытия окна
function useLatch(wanted) {
  const [latched, setLatched] = useState(false);
  function latchOn() {
    if (wanted) setLatched(true);
  }
  useEffect(latchOn, [wanted]);
  return latched;
}

export function useBaseRaster(input) {
  const { config, source } = input;
  const { base } = config;
  const { processor, baseStamp } = source;

  function makeKey() {
    return baseRasterKey(base);
  }
  const rasterKey = useMemo(makeKey, [base]);
  const rasterState = useMapBaseRaster(processor, base, rasterKey, baseStamp);
  const cut = useVectorDetail(processor, base, rasterKey, baseStamp, source.sceneSize);

  const thumbsWanted = useLatch(input.mapPage === "look" || input.tool === "templates");
  const lookId = styleIdOf(currentLook(config));
  function listStyles() {
    return styleIdsFor(lookId);
  }
  const styleIds = useMemo(listStyles, [lookId]);
  const styleThumbs = useThumbsOfStyles(
    processor,
    source.baseGeometry,
    source.atlas,
    thumbsWanted,
    styleIds,
  );
  const packThumb = useModPackThumb(rasterState.raster, base, source.packKey);
  function mergeThumbs() {
    return withPackThumb(styleThumbs, packThumb);
  }
  const thumbs = useMemo(mergeThumbs, [styleThumbs, packThumb]);

  // Цвета карты для панели «Карта»: по объекту подложки и штампу
  function readColors() {
    return colorsAt(baseStamp, processor, base);
  }
  const mapColors = useMemo(readColors, [baseStamp, processor, base]);

  return {
    rasterKey,
    baseRaster: rasterState.raster,
    rasterPending: rasterState.pending,
    detail: cut.detail,
    onFrame: cut.onFrame,
    thumbs,
    mapColors,
  };
}
