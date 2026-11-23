/*
 * Векторная большая карта на обложке — одна для всех (11.10; 27.10.2026 — без подложки и с одним кадром).
 *
 * Векторная карта мода — плитки радара `minimap.rpf/*.ydd`: подписи, зоны и дороги автора — треугольники. Разбор (`apps/desktop/src/part-covers.js`,
 * `scripts/lib/bigmap-source.mjs`) собирает из них геометрию пака (APG1), окно-съёмщик рисует её тем же проходом, что редактор большой карты рисует векторный
 * шаблон (`paintVectorCanvas`). Так рисуются и обложки больших карт каталога (вкладка «Большая карта»), и обложки частей «Большая карта» у редуксов: кадр
 * `BIG_MAP_COVER`, зазор `BIG_MAP_GAP` со всех сторон, остров на прозрачном фоне (30.10.2026: поле `mapCoverField` светилось на тёмной плитке
 * прямоугольником), карта светлее (`mapCoverGamma`).
 *
 * Подложки нет (владелец 27.10.2026): серый «рельеф моря» вокруг суши в геометрию не идёт (`mapWithoutUnderlay`) — иначе на обложке стоял серый срезанный сверху и
 * снизу прямоугольник. Остров — суша и всё, что на ней, по точным краям видимых пикселей (`mapOpaqueBounds`): узкие мысы не срезаются, как срезал бы порог доли строки.
 */

import {
  BIG_MAP_COVER,
  BIG_MAP_GAP,
  DEFAULT_ATLAS,
  atlasSize,
  decodePackGeometry,
  mapCoverGamma,
  mapCoverRect,
  mapIslandRect,
  mapOpaqueBounds,
  mapWithoutUnderlay,
} from "@modovik/vector-map";
import { paintVectorCanvas } from "../../../components/desktop/workshop/world-map-vector-render.js";

const WHOLE_ATLAS = Object.freeze({ u: 0, v: 0, width: 1, height: 1 });

/** Запас вокруг видимых пикселей на вчерне (точек): сглаженный край суши не режется по прямой. */
const EDGE_PAD = 3;

/**
 * APG1 → холст обложки `size` (по умолчанию `BIG_MAP_COVER`) или `null`, если рисовать нечего. `gap` — доля высоты кадра, зазор до острова со всех сторон
 * (по умолчанию `BIG_MAP_GAP`). Первый проход — весь атлас вчерне, ради краёв суши и гаммы тёмной карты; второй рисует только остров в его размере на кадре
 * (без пересчёта пикселей: линии зон остаются тонкими и чёткими). `exact` — без подъёма тёмной карты: цвета как в файлах автора.
 */
export function vectorMapCoverCanvas(bytes, size = BIG_MAP_COVER, { gap = BIG_MAP_GAP, exact = false } = {}) {
  const decoded = decodePackGeometry(bytes);
  const geometry = decoded && mapWithoutUnderlay(decoded);
  if (!geometry?.groups?.length) return null;
  const atlas = atlasSize(DEFAULT_ATLAS);
  const full = mapCoverRect(atlas.width, atlas.height, 1600, 1200);
  const coarse = paintVectorCanvas({ geometry, atlas: DEFAULT_ATLAS }, WHOLE_ATLAS, full.width, full.height, null, { cpu: true });
  if (!coarse) return null;
  const pixels = coarse.getContext("2d").getImageData(0, 0, full.width, full.height);
  const island = mapOpaqueBounds(pixels.data, full.width, full.height) || { x: 0, y: 0, width: full.width, height: full.height };
  /* `exact` — цвета автора как есть (часть редукса): подъём тёмной карты показывал чёрную карту GODMODE серой (владелец 12.11.2026). */
  const gamma = exact ? 1 : mapCoverGamma(pixels.data, full.width, island);
  const x0 = Math.max(0, island.x - EDGE_PAD);
  const y0 = Math.max(0, island.y - EDGE_PAD);
  const bounds = {
    x: x0,
    y: y0,
    width: Math.min(full.width, island.x + island.width + EDGE_PAD) - x0,
    height: Math.min(full.height, island.y + island.height + EDGE_PAD) - y0,
  };
  const rect = mapIslandRect(bounds.width, bounds.height, size.width, size.height, gap);
  const map = paintVectorCanvas(
    { geometry, atlas: DEFAULT_ATLAS },
    { u: bounds.x / full.width, v: bounds.y / full.height, width: bounds.width / full.width, height: bounds.height / full.height },
    rect.width,
    rect.height,
    null,
    { cpu: true },
  );
  if (!map) return null;
  const mapContext = map.getContext("2d");
  if (gamma !== 1) {
    const image = mapContext.getImageData(0, 0, rect.width, rect.height);
    const curve = Uint8ClampedArray.from({ length: 256 }, (_, value) => Math.round(255 * (value / 255) ** (1 / gamma)));
    for (let at = 0; at < image.data.length; at += 4) for (let channel = 0; channel < 3; channel += 1) image.data[at + channel] = curve[image.data[at + channel]];
    mapContext.putImageData(image, 0, 0);
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  context.drawImage(map, rect.left, rect.top);
  return canvas;
}
