/*
 * Остров Кайо-Перико в «Большой карте» (19.10.2026, задача 34).
 *
 * Остров на радаре и на карте паузы рисует не картинка, а векторный фильм
 * Scaleform из одноцветных фигур (`@modovik/vector-map/island`, откуда он и
 * как привязан к миру). Приложение отдаёт его окну чистым — таким, каким он
 * лежит у игрока, — и палитрой заливок. Окно:
 *
 *   1. считает, в какие цвета карта перекрашивает каждый цвет заливки: теми
 *      же правилами, что и мини-карту штата (`radarReport` — тон, перекраска,
 *      роли, пак, картинка), поэтому остров получает ровно цвета вашей карты;
 *   2. красит заливки на месте (`recolourSolidFills`) и рисует фильм тем же
 *      `@modovik/gfx`, что и превью прицелов, — это не нарисованный остров,
 *      а файл игры игрока с другими цветами, который и уедет в игру.
 *
 * Модуль чистый: без окна и канвы (картинку острова для карты кладёт `useIslandLayer.js`, слой сцены — `withIslandLayer`).
 */

import {
  createRenderer,
  createSurface,
  readGfx,
  recolourSolidFills,
  surfaceToRgba,
} from "@modovik/gfx";
import { PAUSE_MAP_GAME_SEA, pauseMapPlan, worldMapDiffersFromGame } from "@modovik/vector-map";
import {
  ISLAND_MAP_NAME,
  ISLAND_STAGE,
  islandPairsFrom,
  islandStandIn,
} from "@modovik/vector-map/island";

/**
 * В какие цвета карта перекрашивает остров: `{ pairs, reason }`, пары
 * «RRGGBBAA=RRGGBBAA» по палитре заливок фильма. Пар нет — причина
 * (`unchanged`: карта как в игре или цвета ролей прежние; `no-palette`: фильм
 * не прочитался; остальные — от `radarReport`).
 *
 * @param {object} input
 * @param {{radarReport: Function}} input.processor обработчик растра подложки
 * @param {object} input.config конфигурация карты
 * @param {{rgba: string}[]} input.palette палитра заливок (`readWorldMapIsland`)
 */
export function islandColourReport({ processor, config, palette }) {
  const colours = Array.isArray(palette) ? palette : [];
  if (!colours.length) return { pairs: [], reason: "no-palette" };
  /* Остров идёт за картой, как и мини-карта: карта как в игре — остров Rockstar. */
  if (!worldMapDiffersFromGame(config)) return { pairs: [], reason: "unchanged" };
  const stand = islandStandIn(colours);
  const report = processor.radarReport(config.base, stand.palette, {
    sea: pauseMapPlan(config).seaColor || PAUSE_MAP_GAME_SEA,
  });
  return { pairs: islandPairsFrom(report.pairs, stand.origin), reason: report.reason || "" };
}

/**
 * Фильм острова, готовый к рисованию: разобранный файл и номер символа.
 * Цвета — `pairs`; без пар рисуется штатный.
 *
 * @param {Uint8Array} gfx чистый файл из игры
 * @param {string[]} [pairs] пары цветов
 * @returns {{film: object, sprite: number, changed: number}|null} `null` —
 *   файл не фильм острова
 */
export function islandFilm(gfx, pairs = []) {
  try {
    const painted = pairs.length ? recolourSolidFills(gfx, pairs) : { bytes: gfx, changed: 0 };
    const film = readGfx(painted.bytes);
    const sprite = film.exports.get(ISLAND_MAP_NAME);
    return Number.isInteger(sprite) ? { film, sprite, changed: painted.changed } : null;
  } catch {
    return null;
  }
}

/**
 * Слой острова для сцены окна (задача 42Б): остров на своём месте за краем атласа, между подложкой («tint») и краской.
 * Кадр карты держит остров целиком (`scene.extent`) — как только он прочитан из игры, даже пока картинки ещё нет.
 *
 * @param {{width: number, height: number, layers: object[]}} scene сцена окна (единицы — как у проекции)
 * @param {object} place `{ rect, extent }` из `islandAtlasRect` и `islandExtent` в долях атласа
 * @param {string} href адрес картинки острова (`useIslandLayer`); пусто — слой без картинки
 * @returns {object} сцена с слоем `island` и `extent`
 */
export function withIslandLayer(scene, place, href = "") {
  if (!place) return scene;
  const { rect, extent } = place;
  const at = (value) => Math.round(value * 100) / 100;
  const layer = {
    id: "island",
    kind: "group",
    items: href
      ? [
          {
            kind: "image",
            id: "island",
            href,
            x: at(rect.u * scene.width),
            y: at(rect.v * scene.height),
            width: at(rect.width * scene.width),
            height: at(rect.height * scene.height),
            preserveAspectRatio: "none",
          },
        ]
      : [],
  };
  const layers = scene.layers.filter((item) => item.id !== "island");
  const tint = layers.findIndex((item) => item.id === "tint");
  return {
    ...scene,
    extent: { width: at(scene.width * extent.width), height: at(scene.height * extent.height) },
    layers: tint >= 0 ? [...layers.slice(0, tint + 1), layer, ...layers.slice(tint + 1)] : [layer, ...layers],
  };
}

/** Приближение, с которого вся сцена острова целиком влезает в сторону `side`. */
export const fitIslandScale = (side) => side / ISLAND_STAGE.side;

/**
 * Один кадр острова в пикселях.
 *
 * @param {{film: object, sprite: number}} island из `islandFilm`
 * @param {object} view
 * @param {number} view.width ширина кадра, точек
 * @param {number} view.height высота кадра, точек
 * @param {number} view.scale точек на пиксель сцены фильма
 * @param {{x: number, y: number}} view.centre точка сцены в середине кадра
 * @param {[number, number, number]} view.sea цвет моря под фильмом
 * @returns {Uint8ClampedArray} RGBA с непрозрачным морем под фильмом
 */
export function renderIslandPixels(island, { width, height, scale, centre, sea }) {
  const renderer = createRenderer(island.film);
  const surface = createSurface(width, height);
  renderer.renderFrame({
    sprite: island.sprite,
    frame: 0,
    width,
    height,
    transform: {
      a: scale,
      b: 0,
      c: 0,
      d: scale,
      tx: width / 2 - centre.x * scale,
      ty: height / 2 - centre.y * scale,
    },
    surface,
  });
  return new Uint8ClampedArray(surfaceToRgba(surface, sea));
}
