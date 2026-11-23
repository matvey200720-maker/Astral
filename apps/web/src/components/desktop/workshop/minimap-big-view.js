/*
 * Просмотр «большая карта» в редакторе мини-карты (ТЗ 10.11.2026).
 *
 * Радар большой карты — тот же фильм minimap.gfx, но другой контейнер: радар 115×120 точек в (38, 8) вместо 179×115
 * в (6, 8), а элементы встают по правилу `@modovik/minimap-contract/big-map` — той самой арифметике, которой
 * компилятор кладёт их в игру (`frameFor("big")`). Здесь она только переводится в язык просмотра: каждому элементу
 * малой раскладки (доли малого радара) ставится «двойник» в долях малого радара, который при отрисовке малым
 * правилом даёт тот же прямоугольник сцены, что у большого. Так `VitalWidget` и значки на полосах рисуют большую
 * карту прежним кодом, без второго набора формул.
 */

import { MINIMAP_BIG_GEOMETRY, MINIMAP_BIG_STOCK, minimapBigPlace, minimapBigPlaces } from "@modovik/minimap-contract/big-map";
import { MINIMAP_RADAR } from "./minimap-layout.js";

/** Радар большой карты в точках сцены (штатный, разобран с minimap.gfx Legacy). */
export const MINIMAP_BIG_RADAR = MINIMAP_BIG_STOCK.radar;
/** Во сколько раз размеры в сцене меньше малых: на экране большая карта крупнее в 2,43 раза, толщина остаётся той же. */
export const MINIMAP_BIG_SCALE = MINIMAP_BIG_STOCK.scale;

const isBar = (id) => String(id).endsWith("Bar");

/*
 * Толщина полосы в раскладке — доля радара; на экране её множит «толщина полос» (`barThickness` / 8): компилятор
 * передаёт тот же множитель в `thicknessScale`, и тот же стоит в `VitalWidget`.
 */
const thicknessScaleOf = (id, effects) => (isBar(id) ? Number(effects?.barThickness) / 8 || 1 : 1);

/** Прямоугольник сцены → доли малого радара (центр и размеры), как их читает просмотр малой карты. */
const toSmallFractions = (place, widthPoints, heightPoints) => ({
  x: (place.x - MINIMAP_RADAR.x) / MINIMAP_RADAR.width,
  y: (place.y - MINIMAP_RADAR.y) / MINIMAP_RADAR.height,
  width: widthPoints / MINIMAP_RADAR.width,
  height: heightPoints / MINIMAP_RADAR.height,
});

/**
 * Конфиг с раскладкой большой карты: у каждого видимого элемента — двойник по правилу `minimapBigPlaces`
 * (полоса: длина — доля большого радара, толщина — малая × `scale`, центр прижат к ближнему краю; значок и число — малый
 * размер × `scale` по обеим осям, вплотную лежащие соседи держатся вместе). Остальное — как есть.
 */
export function minimapBigViewConfig(config) {
  const widgets = {};
  const barScale = Number(config.effects?.barThickness) / 8 || 1;
  const places = minimapBigPlaces(config.layout.widgets, MINIMAP_BIG_GEOMETRY, {
    thicknessScale: barScale,
    custom: config.layout.bigPlaces || null,
  });
  for (const [id, widget] of Object.entries(config.layout.widgets)) {
    const place = places[id];
    if (!place) {
      widgets[id] = widget;
      continue;
    }
    const thicknessScale = thicknessScaleOf(id, config.effects);
    const fractions = toSmallFractions(place, place.length, place.thickness / thicknessScale);
    widgets[id] = { ...widget, ...fractions };
  }
  return { ...config, layout: { ...config.layout, widgets } };
}

/**
 * Надпись или картинка на карте: центр — по правилу большой карты, размер — малый × `scale` (так
 * `overlaysSprite` компилятора ставит их в `bigmap`). `box` — `minimapOverlayBox` малой карты, доли малого радара.
 */
export function minimapBigOverlayBox(box) {
  const place = minimapBigPlace(
    { x: box.x, y: box.y, width: box.width, height: box.height, rotation: 0 },
    MINIMAP_BIG_GEOMETRY,
  );
  return {
    ...toSmallFractions(place, box.width * MINIMAP_RADAR.width * MINIMAP_BIG_SCALE, box.height * MINIMAP_RADAR.height * MINIMAP_BIG_SCALE),
  };
}
