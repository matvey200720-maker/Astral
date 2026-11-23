/*
 * Остров Кайо-Перико на большой карте (19.10.2026, задача 34).
 *
 * Чем игра рисует остров. Не растром (плитки паузы `minimap_sea_*` кончаются на
 * X 4860 и Y −5100, а остров лежит на X 3705…5695, Y −6142…−4148) и не
 * векторными плитками радара (`minimap_X_Y.ydd` — только штат, до Y −4146).
 * Остров — отдельный фильм Scaleform, «радар интерьера»:
 *
 *   update.rpf → x64/patch/data/cdimages/scaleform_minimap.rpf/int3232302352.gfx
 *
 * 3232302352 — `joaat("h4_fake_islandx")`: скрипты острова зовут
 * `SET_RADAR_AS_INTERIOR_THIS_FRAME(h4_fake_islandx, 4700, -5145, …)`, и этот
 * фильм встаёт на радар и на карту паузы, пока игра включает радар острова
 * (игрок на острове). Внутри только векторные заливки: суша, дороги, здания и
 * вода ступенями глубины; ни растров, ни внешних текстур.
 *
 * Привязка к миру (сверена по 1797 узлам дорог `pathsheistisland.ipl`: 1511 из
 * них легли на дороги фильма): один пиксель сцены — одна игровая единица,
 * центр сцены — точка (4700, −5145), ось Y сцены смотрит вниз.
 *
 * Модуль чистый: ни файлов, ни Scaleform-разбора, только числа и роли цветов.
 * Читает и красит фильм `@modovik/gfx` (`fills.js`).
 */

import { classifyRadarColour } from "./radar-geometry.js";
import { DEFAULT_ATLAS, worldToMap } from "./projection.js";

/** Имя символа в фильме (то же, что хэш в имени файла). */
export const ISLAND_MAP_NAME = "h4_fake_islandx";
/** `joaat("h4_fake_islandx")` — число в имени `int<…>.gfx`. */
export const ISLAND_MAP_HASH = 3232302352;
/** Запись фильма в `update.rpf`. */
export const ISLAND_MAP_ENTRY = `x64/patch/data/cdimages/scaleform_minimap.rpf/int${ISLAND_MAP_HASH}.gfx`;

/** Мировая точка, на которую игра ставит начало координат сцены фильма. */
export const ISLAND_CENTRE = Object.freeze({ x: 4700, y: -5145 });
/** Игровых единиц на пиксель сцены. */
export const ISLAND_UNITS_PER_PIXEL = 1;
/** Сцена острова: квадрат со стороной 2000 пикселей вокруг начала координат. */
export const ISLAND_STAGE = Object.freeze({ min: -1000, max: 1000, side: 2000 });

/** Точка сцены (пиксели, Y вниз) → мир игры. */
export function islandStageToWorld({ x, y }) {
  return {
    x: ISLAND_CENTRE.x + x * ISLAND_UNITS_PER_PIXEL,
    y: ISLAND_CENTRE.y - y * ISLAND_UNITS_PER_PIXEL,
  };
}

/** Мировая точка игры → пиксель сцены острова. */
export function worldToIslandStage({ x, y }) {
  return {
    x: (x - ISLAND_CENTRE.x) / ISLAND_UNITS_PER_PIXEL,
    y: (ISLAND_CENTRE.y - y) / ISLAND_UNITS_PER_PIXEL,
  };
}

/** Прямоугольник сцены острова в мире игры: `{ minX, maxX, minY, maxY }`. */
export function islandWorldBounds() {
  const a = islandStageToWorld({ x: ISLAND_STAGE.min, y: ISLAND_STAGE.min });
  const b = islandStageToWorld({ x: ISLAND_STAGE.max, y: ISLAND_STAGE.max });
  return { minX: a.x, maxX: b.x, minY: b.y, maxY: a.y };
}

/**
 * Остров на большой карте штата (задача 42Б, 20.10.2026): прямоугольник его сцены в координатах атласа, доли атласа —
 * `u` и `v` левого верхнего угла, ширина и высота. Остров лежит на юго-востоке за краем атласа (X до 5700 при краю 4860,
 * Y до −6145 при краю −5100), поэтому `u + width` и `v + height` больше единицы.
 */
export function islandAtlasRect(atlas = DEFAULT_ATLAS) {
  const bounds = islandWorldBounds();
  const corner = worldToMap({ x: bounds.minX, y: bounds.maxY }, atlas);
  const far = worldToMap({ x: bounds.maxX, y: bounds.minY }, atlas);
  return { u: corner.u, v: corner.v, width: far.u - corner.u, height: far.v - corner.v };
}

/**
 * Во сколько раз кадр карты с островом больше самого атласа по ширине и высоте: атлас от левого верхнего угла до
 * дальнего края острова, не меньше единицы. Кадр, что держит остров, шире и выше атласа на столько.
 */
export function islandExtent(atlas = DEFAULT_ATLAS) {
  const rect = islandAtlasRect(atlas);
  return { width: Math.max(1, rect.u + rect.width), height: Math.max(1, rect.v + rect.height) };
}

/*
 * Роль цвета заливки острова. У радара штата цвета ролей — одна яркость на
 * роль (суша 1d, кварталы 41, пути 63, магистрали 82, дороги b4, железная
 * дорога dc), у фильма острова свои: суша 28, здания 43…70, магистрали 96,
 * дороги e6 и ffffff, — поэтому роль узнаётся по своим порогам. Вода — по
 * оттенку: ступени глубины голубовато-серые, как у радара штата.
 */
const LAND_UP_TO = 0x30;
const BLOCKS_UP_TO = 0x80;
const FREEWAY_UP_TO = 0xa0;

/**
 * Роль цвета заливки фильма острова.
 *
 * @returns {{role: "water"|"land"|"blocks"|"freeway"|"roads", depth: number}}
 *   `depth` 0…1 — только у воды (0 — мелководье, 1 — глубина)
 */
export function islandRoleOf(red, green, blue) {
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  if (spread > 4) return classifyRadarColour(red, green, blue, 0);
  const grey = (red + green + blue) / 3;
  if (grey <= LAND_UP_TO) return { role: "land", depth: 0 };
  if (grey <= BLOCKS_UP_TO) return { role: "blocks", depth: 0 };
  if (grey <= FREEWAY_UP_TO) return { role: "freeway", depth: 0 };
  return { role: "roads", depth: 0 };
}

/*
 * Цвета-заместители ролей: те, что у радара штата. Цвета проекта считает
 * `radarReport` по палитре радара и по ней же узнаёт роль, а у острова роли
 * другие. Поэтому цвет заливки острова на время расчёта заменяется штатным
 * цветом своей роли, пары считаются как для радара, а затем возвращаются на
 * настоящие цвета острова. Вода идёт как есть: её роль и глубина читаются
 * одинаково у обоих.
 */
const STAND_IN = Object.freeze({
  land: [0x1d, 0x1d, 0x1d],
  blocks: [0x41, 0x41, 0x41],
  freeway: [0x82, 0x82, 0x82],
  roads: [0xb4, 0xb4, 0xb4],
});

const hex2 = (value) => value.toString(16).padStart(2, "0").toUpperCase();

/**
 * Палитра острова для расчёта цветов проекта.
 *
 * @param {{rgba: string}[]} palette цвета заливок фильма (`RRGGBBAA`)
 * @returns {{palette: {rgba: string}[], origin: Map<string, string[]>}}
 *   `palette` — те же цвета, где суша, здания и дороги заменены штатными
 *   цветами ролей радара; `origin` — какие настоящие цвета за каждым из них
 */
export function islandStandIn(palette) {
  const stand = new Map();
  const origin = new Map();
  for (const item of Array.isArray(palette) ? palette : []) {
    const from = String(item?.rgba || "").toUpperCase();
    if (!/^[0-9A-F]{8}$/.test(from)) continue;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(from.slice(at, at + 2), 16));
    const { role } = islandRoleOf(r, g, b);
    const replacement = STAND_IN[role];
    const to = replacement ? `${replacement.map(hex2).join("")}${from.slice(6, 8)}` : from;
    if (!stand.has(to)) stand.set(to, { rgba: to });
    origin.set(to, [...(origin.get(to) || []), from]);
  }
  return { palette: [...stand.values()], origin };
}

/**
 * Пары радара по заместителям → пары по настоящим цветам острова. Заливка,
 * чей цвет-заместитель не изменился (карта в этой роли осталась штатной),
 * в пары не попадает и остаётся такой, какой нарисовал Rockstar.
 *
 * @param {string[]} pairs `RRGGBBAA=RRGGBBAA` по палитре из `islandStandIn`
 * @param {Map<string, string[]>} origin `origin` из `islandStandIn`
 * @returns {string[]}
 */
export function islandPairsFrom(pairs, origin) {
  const result = [];
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const match = /^([0-9A-F]{8})=([0-9A-F]{8})$/.exec(String(pair || "").toUpperCase());
    if (!match) continue;
    for (const from of origin.get(match[1]) || [])
      /* Альфа заливки остаётся своей: пара несёт только цвет. */
      result.push(`${from}=${match[2].slice(0, 6)}${from.slice(6, 8)}`);
  }
  return result;
}
