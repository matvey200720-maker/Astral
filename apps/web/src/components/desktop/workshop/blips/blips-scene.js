/*
 * Сцена, на которой смотрят значки, и геометрия радара.
 *
 * Значки нельзя настроить на пустом месте: размер, цвет и обводка читаются
 * только вместе с тем, что под ними, и только рядом друг с другом. Поэтому
 * сцена здесь одна и настоящая — центр Лос-Сантоса вокруг Легиона, с
 * заправками, заданиями, машинами и проложенным до метки маршрутом.
 *
 * Точки неподвижных мест — мировые координаты самой игры. Они взяты из
 * каталога большой карты этого же проекта (`packages/vector-map/catalog.js`,
 * заправки и ориентиры), поэтому значок ложится на настоящую заправку
 * настоящей карты, а не «примерно туда». Машина и метка маршрута поставлены
 * рядом с игроком руками: машина стоит там, где её оставили, и настоящих
 * координат у неё не бывает.
 *
 * Вся математика здесь чистая и без React: она отвечает на два вопроса — где
 * на экране радар и куда внутри него попала мировая точка, — и оба ответа
 * должны проверяться числами, а не разглядыванием картинки.
 *
 * Кусок карты считается через общую проекцию атласа (`@modovik/vector-map`), а
 * место радара на экране — тем же способом, что кадр мини-карты: запись
 * `minimap` из frontend.xml на экране игрока (`placeMinimapFrontend`,
 * `gameEntryRect`). Своей проекции и своих зашитых координат угла здесь нет
 * намеренно: и то, и другое уже посчитано один раз для большой карты и для
 * мини-карты, и третья копия означала бы третье мнение о том, где у экрана
 * левый нижний угол (ТЗ H1, 14.11.2026: прежний расчёт брал безопасную зону
 * 0,035 и поле 0,06 — ни того, ни другого у мини-карты в игре нет).
 */

import { DEFAULT_ATLAS, atlasSize, worldToMap } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { DEFAULT_ROUTE } from "./blips-model.js";
import {
  HUD_DEFAULT_DESIGN,
  hudSafeRect,
  hudSize,
} from "../hud-preview/hud-frame.js";
import {
  DEFAULT_MINIMAP_PLACEMENT,
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_GAME_SAFE_INSET,
  MINIMAP_RADAR,
  MINIMAP_RADAR_ASPECT,
  MINIMAP_SCENE,
  gameEntryRect,
  placeMinimapFrontend,
} from "../minimap-layout.js";

/* Пропорция радара GTA V — прямоугольник 179×115 внутри minimap.gfx. Значение
   из контракта мини-карты, а не написанное заново: радар у игры один. */
export const RADAR_ASPECT = MINIMAP_RADAR_ASPECT;

/*
 * Своих полей между радаром и краем экрана здесь нет: радар стоит там же, где
 * штатная мини-карта, — от безопасной зоны игрока (`inset`, по умолчанию
 * `MINIMAP_GAME_SAFE_INSET`) и в долях экрана его формы (`radarPlacement`).
 */

/** Во сколько раз крупнее радар под лупой. */
export const RADAR_MAGNIFY = 2.4;

/**
 * Во сколько раз квадрат подложки шире радара.
 *
 * Радар в игре повёрнут по направлению взгляда, и подложка под ним крутится.
 * Повёрнутый прямоугольник свои же углы не накрывает, поэтому кусок карты
 * берётся квадратом по диагонали радара: такой квадрат накрывает радар при
 * ЛЮБОМ угле, и масштаб при этом не трогается — метров на пиксель остаётся
 * ровно столько же, сколько было. Число выведено из пропорции радара, а не
 * подобрано: у прямоугольника со сторонами 1 и 1/aspect диагональ равна
 * гипотенузе этих сторон.
 */
export const RADAR_COVER = Math.hypot(1, 1 / RADAR_ASPECT);

/** Насколько мельче значок, прижатый к краю режимом «уменьшить». */
export const EDGE_SHRINK = 0.66;

/**
 * Насколько широкий кусок карты показывать.
 *
 * Метры — настоящие: единица мира GTA V равна метру, а размер атласа известен
 * из проекции. Названия нарочно про кусок карты, а не про игру: в игре радар
 * отъезжает сам, от скорости, и обещать «столько видно пешком» редактор не
 * может.
 */
export const RADAR_ZOOMS = Object.freeze([
  Object.freeze({ id: "near", label: "Близко", metres: 800 }),
  Object.freeze({ id: "usual", label: "Обычно", metres: 1600 }),
  Object.freeze({ id: "far", label: "Далеко", metres: 3200 }),
]);

export const DEFAULT_ZOOM = "usual";

const blip = (id, kind, label, x, y) =>
  Object.freeze({ id, kind, label, x, y });
const at = (x, y) => Object.freeze({ x, y });

/*
 * Места, на которых смотрят значки.
 *
 * Одной сцены не хватало по существу, а не по разнообразию: ночной квартал
 * даунтауна тёмный весь, и белый значок игрока на нём не проверишь никак —
 * равно как зелёный магазин на траве и жёлтое задание на песке. Поэтому мест
 * три, и выбраны они по цвету подложки, а не по красоте: тёмный центр, светлый
 * песок с водой, выжженная пустыня.
 *
 * Неподвижные точки — мировые координаты самой игры из каталога большой карты
 * (`packages/vector-map/catalog.js`): заправки взяты из `FUEL_STATIONS`,
 * задания — из ориентиров и сервисов. Машина и метка маршрута поставлены рядом
 * с игроком руками: машина стоит там, где её оставили, и настоящих координат у
 * неё не бывает.
 *
 * Часть точек при обычном масштабе оказывается за краем радара — это не
 * оплошность раскладки, а единственный способ увидеть, что делает «поведение
 * на краю».
 */
export const BLIP_SCENES = Object.freeze([
  Object.freeze({
    id: "legion",
    label: "Легион",
    hint: "тёмный центр Лос-Сантоса",
    centre: at(200, -930),
    blips: Object.freeze([
      blip("player", "player", "Ты", 200, -930),
      blip("shop-1", "shop", "АЗС", 266, -1261),
      blip("shop-2", "shop", "АЗС", -526, -1211),
      blip("shop-3", "shop", "АЗС", 820, -1029),
      blip("shop-4", "shop", "АЗС", -70, -1762),
      blip("mission-1", "mission", "Задание", -75, -818),
      blip("mission-2", "mission", "Казино", 925, 46),
      blip("vehicle-1", "vehicle", "Машина", 330, -800),
      blip("vehicle-2", "vehicle", "Мотоцикл", 96, -1010),
      blip("waypoint", "waypoint", "Метка", -260, -690),
    ]),
    route: Object.freeze([
      at(200, -930),
      at(205, -845),
      at(60, -790),
      at(-140, -730),
      at(-260, -690),
    ]),
  }),
  Object.freeze({
    id: "vespucci",
    label: "Веспуччи",
    hint: "светлый песок и вода",
    centre: at(-1200, -1500),
    blips: Object.freeze([
      blip("player", "player", "Ты", -1200, -1500),
      blip("shop-1", "shop", "АЗС", -1437, -2185),
      blip("shop-2", "shop", "АЗС", -725, -935),
      blip("shop-3", "shop", "АЗС", -319, -1472),
      blip("mission-1", "mission", "Пирс", -1850, -1240),
      blip("mission-2", "mission", "Участок", -1108, -809),
      blip("vehicle-1", "vehicle", "Машина", -1120, -1420),
      blip("vehicle-2", "vehicle", "Мотоцикл", -1310, -1610),
      blip("waypoint", "waypoint", "Метка", -1560, -1090),
    ]),
    route: Object.freeze([
      at(-1200, -1500),
      at(-1265, -1420),
      at(-1330, -1290),
      at(-1450, -1180),
      at(-1560, -1090),
    ]),
  }),
  Object.freeze({
    id: "sandy",
    label: "Песчанка",
    hint: "выжженная пустыня",
    centre: at(1900, 3700),
    blips: Object.freeze([
      blip("player", "player", "Ты", 1900, 3700),
      blip("shop-1", "shop", "АЗС", 2005, 3774),
      blip("shop-2", "shop", "АЗС", 1785, 3330),
      blip("shop-3", "shop", "АЗС", 1687, 4929),
      blip("mission-1", "mission", "Больница", 1839, 3672),
      blip("mission-2", "mission", "Аэродром", 1700, 3250),
      blip("vehicle-1", "vehicle", "Машина", 1950, 3660),
      blip("vehicle-2", "vehicle", "Мотоцикл", 1820, 3760),
      blip("waypoint", "waypoint", "Метка", 2130, 3520),
    ]),
    route: Object.freeze([
      at(1900, 3700),
      at(1965, 3665),
      at(2040, 3600),
      at(2090, 3560),
      at(2130, 3520),
    ]),
  }),
]);

export const DEFAULT_SCENE = "legion";

const SCENE_MAP = new Map(BLIP_SCENES.map((scene) => [scene.id, scene]));

/** Место по имени. Незнакомое имя — Легион, а не пустой радар. */
export function blipScene(id) {
  return SCENE_MAP.get(id) || BLIP_SCENES[0];
}

/* Штатное место остаётся Легионом и остаётся доступным под своими прежними
   именами: по ним живут тесты геометрии и по ним же считается кусок карты в
   тесте редактора. Набор мест добавлен рядом, а не вместо. */
export const SCENE_CENTRE = BLIP_SCENES[0].centre;
export const SCENE_BLIPS = BLIP_SCENES[0].blips;
export const SCENE_ROUTE = BLIP_SCENES[0].route;

/**
 * Кто рисуется поверх кого.
 *
 * Порядка не было вовсе — только порядок в разметке, а игрок стоял в списке
 * первым и уходил под машину, стоящую в ста восьмидесяти метрах. В игре
 * приоритет обратный: стрелка игрока и метка маршрута видны всегда, а лавка
 * уступает всем. Больше — выше.
 */
export const BLIP_ORDER = Object.freeze({
  shop: 0,
  vehicle: 1,
  mission: 2,
  waypoint: 3,
  player: 4,
});

/**
 * Кегль подписи.
 *
 * Доля от размера значка оставалась без нижнего порога, и на значке в 12
 * пикселей подпись выходила в 5.3 — то есть её не было. Порог поставлен по
 * тому, с какого кегля кириллица на тёмном фоне ещё читается.
 */
export const BLIP_LABEL_MIN = 11;
export const BLIP_LABEL_RATIO = 0.42;

/*
 * Ширина знака кириллицы полужирного начертания долей кегля.
 *
 * Число нарочно ВЕРХНЕЕ, а не среднее: у гротесков средний знак укладывается
 * примерно в половину кегля, самые широкие («ш», «щ», «ж») — примерно в
 * восемь десятых, и взята граница ближе к широким. Точная ширина берётся
 * только замером в документе, а раскладка обязана считаться без него — по ней
 * живут тесты. Ошибиться можно в обе стороны, и стороны эти не равны: коробка
 * шире настоящей подписи сдвигает её на пару точек, а уже́ настоящей —
 * выпускает подпись за радар и режет её многоточием там, где место было.
 */
export const BLIP_LABEL_EM = 0.64;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Где на экране стоит радар.
 *
 * Тем же способом, что кадр мини-карты (`calculateMinimapRect`): штатная запись
 * `minimap` из frontend.xml на экране игрока (`placeMinimapFrontend`,
 * `gameEntryRect`), а радар — прямоугольник 179×115 внутри её сцены 191×136.
 * Форма экрана — пропорция `design`, отступ безопасной зоны — `inset`
 * (`describeGameScreen().inset`). «Крупно» (`magnify`) растит радар от его
 * левого нижнего угла и не даёт выйти за край экрана.
 *
 * Возвращаются координаты в системе слоя (пиксели холста формы экрана) и они же
 * долями: первое нужно разметке, второе — вёрстке.
 */
export function radarPlacement({
  design = HUD_DEFAULT_DESIGN,
  magnify = 1,
  inset = MINIMAP_GAME_SAFE_INSET,
} = {}) {
  const box = hudSize(design, HUD_DEFAULT_DESIGN);
  const screen = { aspect: box.width / box.height, inset };
  const entry = gameEntryRect(
    placeMinimapFrontend(
      DEFAULT_MINIMAP_PLACEMENT,
      MINIMAP_FRONTEND_STOCK,
      screen,
    ).minimap,
    screen,
  );
  const baseLeft =
    entry.left + (MINIMAP_RADAR.x / MINIMAP_SCENE.width) * entry.width;
  const baseWidth = (MINIMAP_RADAR.width / MINIMAP_SCENE.width) * entry.width;
  const baseHeight =
    (MINIMAP_RADAR.height / MINIMAP_SCENE.height) * entry.height;
  const bottom =
    entry.top +
    (MINIMAP_RADAR.y / MINIMAP_SCENE.height) * entry.height +
    baseHeight;
  /* Растёт вверх и вправо от левого нижнего угла: не выше верха экрана и не правее его края. */
  const grow = Math.max(
    0.1,
    Math.min(
      Number(magnify) || 1,
      (1 - baseLeft) / baseWidth,
      bottom / baseHeight,
    ),
  );
  const width = baseWidth * grow;
  const height = baseHeight * grow;
  const top = bottom - height;
  return {
    anchor: "bottom-left",
    x: baseLeft * box.width,
    y: top * box.height,
    width: width * box.width,
    height: height * box.height,
    safe: hudSafeRect(box, inset),
    left: baseLeft,
    top,
    widthFraction: width,
    heightFraction: height,
  };
}

/**
 * Кусок карты под радаром.
 *
 * Возвращается прямоугольник в координатах атласа (доли, u слева направо, v
 * сверху вниз) — той самой системе, в которой лежит подложка из плиток игры.
 * Поперёк радара укладывается `metres` метров мира; по вертикали — во столько
 * же раз меньше, во сколько радар шире, чем выше.
 */
export function radarView({
  centre = SCENE_CENTRE,
  metres = 1600,
  aspect = RADAR_ASPECT,
  atlas = DEFAULT_ATLAS,
} = {}) {
  const size = atlasSize(atlas);
  const middle = worldToMap(centre, atlas);
  const du = Math.max(1e-6, metres / size.width);
  const dv = Math.max(1e-6, metres / aspect / size.height);
  return {
    u: middle.u - du / 2,
    v: middle.v - dv / 2,
    du,
    dv,
    metres,
    atlas,
  };
}

/**
 * Поворот радара по курсу.
 *
 * В игре мини-карта повёрнута по направлению взгляда, и север у неё почти
 * никогда не сверху; радар, у которого север всегда вверху, читается как схема
 * лаунчера, а не как экран игры. Поворот считается ЗДЕСЬ, а не поручается
 * вёрстке, ровно по одной причине: значок, ушедший за край, обязан прижиматься
 * к настоящему краю радара, а не к краю квадрата подложки, — и прижимать его
 * можно только после поворота.
 *
 * `cover` и `aspect` по умолчанию единичны: без них преобразование ничего не
 * делает, и вся геометрия, посчитанная без курса, остаётся прежней числом в
 * число.
 */
export function radarTurn({
  heading = 0,
  cover = RADAR_COVER,
  aspect = RADAR_ASPECT,
} = {}) {
  const angle = (-(Number(heading) || 0) * Math.PI) / 180;
  return { cos: Math.cos(angle), sin: Math.sin(angle), cover, aspect };
}

const STILL_TURN = Object.freeze({ cos: 1, sin: 0, cover: 1, aspect: 1 });

/**
 * Точка квадрата подложки в доли радара.
 *
 * Квадрат крутится вокруг центра радара, поэтому смещение от центра сначала
 * поворачивается, а потом делится на стороны радара — по вертикали радар ниже
 * во столько раз, во сколько он шире, отсюда множитель пропорции.
 */
function toRadar(point, turn) {
  const dx = point.x - 0.5;
  const dy = point.y - 0.5;
  return {
    x: 0.5 + turn.cover * (dx * turn.cos - dy * turn.sin),
    y: 0.5 + turn.cover * turn.aspect * (dx * turn.sin + dy * turn.cos),
  };
}

/**
 * Мировая точка в доли атласа.
 *
 * Тонкая обёртка над общей проекцией, и нужна она затем, чтобы проекция
 * приходила в редактор из ОДНОГО места: проверке контраста нужны те же доли
 * атласа, что и подложке, а второй импорт `@modovik/vector-map` рядом означал
 * бы второе мнение о том, где у карты север.
 */
export function atlasPoint(point, atlas = DEFAULT_ATLAS) {
  return worldToMap(point, atlas);
}

/** Мировая точка в доли радара. Значения вне 0..1 — это «за краем». */
export function projectPoint(point, view, turn = STILL_TURN) {
  const mapped = worldToMap(point, view.atlas || DEFAULT_ATLAS);
  return toRadar(
    {
      x: (mapped.u - view.u) / view.du,
      y: (mapped.v - view.v) / view.dv,
    },
    turn,
  );
}

/**
 * Куда встаёт значок и что с ним сделал край.
 *
 * `margin` — половина значка в долях радара: значок, прижатый к краю, обязан
 * остаться внутри целиком, иначе «прижать к краю» превращается в «свесить
 * наполовину наружу». Поэтому поле считается от размера значка, а не берётся
 * постоянным.
 *
 * `bearing` — куда от прижатого значка лежит его настоящая точка, в градусах
 * экрана (ноль — вправо, вниз положительный). Подсказка в редакторе обещает,
 * что прижатый значок «показывает направление», и до сих пор это было
 * неправдой: значок просто зажимался координатой. Угол считается в пикселях
 * экрана, а не в долях, — радар шире, чем выше, и в долях стрелка смотрела бы
 * мимо.
 */
export function placeBlip(
  point,
  view,
  { edge = "edge", margin = 0, turn = STILL_TURN, aspect = RADAR_ASPECT } = {},
) {
  const { x, y } = projectPoint(point, view, turn);
  const gap = clamp(Number(margin) || 0, 0, 0.45);
  const outside = x < gap || x > 1 - gap || y < gap || y > 1 - gap;
  if (!outside)
    return { x, y, outside: false, visible: true, scale: 1, bearing: null };
  if (edge === "hide")
    return { x, y, outside: true, visible: false, scale: 1, bearing: null };
  const held = { x: clamp(x, gap, 1 - gap), y: clamp(y, gap, 1 - gap) };
  return {
    ...held,
    outside: true,
    visible: true,
    scale: edge === "shrink" ? EDGE_SHRINK : 1,
    bearing: (Math.atan2((y - held.y) / aspect, x - held.x) * 180) / Math.PI,
  };
}

/**
 * Раскладка всей сцены разом.
 *
 * Считается одним проходом и целиком, потому что и меняется целиком: сдвинулся
 * масштаб — переехали все значки сразу. `radar` — размер радара в пикселях
 * экрана; он нужен, чтобы половину значка (её задают в пикселях) перевести в
 * доли радара.
 */
export function placeScene({
  blips = SCENE_BLIPS,
  kinds,
  view,
  radar,
  hidden = [],
  magnify = 1,
  turn = STILL_TURN,
}) {
  const width = Math.max(1, Number(radar?.width) || 1);
  const height = Math.max(1, Number(radar?.height) || 1);
  const aspect = width / height;
  const placed = blips
    .filter((item) => !hidden.includes(item.kind))
    .map((item) => {
      const style = kinds?.[item.kind];
      if (!style) return null;
      const size = style.size * magnify;
      /* Поле берётся по большей стороне значка в долях: радар шире, чем выше,
         и одна и та же половина значка по вертикали занимает большую долю. */
      const spot = placeBlip(item, view, {
        edge: style.edge,
        margin: Math.max(size / 2 / width, size / 2 / height),
        turn,
        aspect,
      });
      if (!spot.visible) return null;
      const drawn = size * spot.scale;
      /* Наружу уходит уже точка радара, а не мировая: мировые координаты
         нужны были только здесь, и оставлять рядом два разных `x` — верный
         способ однажды нарисовать значок в трёх километрах от радара. */
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        style,
        x: spot.x,
        y: spot.y,
        outside: spot.outside,
        bearing: spot.bearing,
        size: drawn,
        /* Обводка уезжает наружу вместе с размером и в тех же единицах: она
           задана пикселями макета, значок растёт от лупы и мельчает у края, и
           рисунку нужна обводка НАРИСОВАННОГО значка, а не настроенного.
           Пока наружу уходил один размер, кант считался от исходных пикселей и
           превращался в постоянную величину экрана. */
        outline: style.outline * magnify * spot.scale,
        order: BLIP_ORDER[item.kind] ?? 0,
      };
    })
    .filter(Boolean);

  /* Подписи расставляются ВТОРЫМ проходом, когда известны все значки: обходить
     нужно и соседнюю подпись, и соседний значок, а половина значков в первом
     проходе ещё не поставлена. */
  spreadLabels(placed, { width, height, magnify });
  /* Настройки типа нужны были только раскладке подписей. Наружу уходит готовая
     точка кадра, а не ссылка на проект: разметка обязана читать проект сама,
     иначе однажды сцена начнёт отдавать одно, а инспектор править другое. */
  for (const blip of placed) delete blip.style;

  /* Порядок отрисовки, а не порядок списка: игрок и метка обязаны лежать
     поверх соседей, иначе стрелка игрока уходит под машину, стоящую в ста
     восьмидесяти метрах. Сортировка устойчивая, поэтому одинаковые типы
     остаются в порядке сцены. */
  return placed.sort((left, right) => left.order - right.order);
}

/**
 * Куда встанут подписи.
 *
 * При 1600 метрах на 221 точку это 7.2 метра на пиксель, и подписи двух точек
 * в полутора сотнях метров налезают друг на друга гарантированно. Занятое
 * место под значком уводит подпись НАВЕРХ, а не вбок: отъехавшая вбок подпись
 * перестаёт быть подписью этого значка. Вбок она сдвигается только у самого
 * края радара — там она иначе просто обрезается рамкой.
 */
function spreadLabels(placed, { width, height, magnify }) {
  const taken = placed.map((blip) => ({
    x: blip.x,
    y: blip.y,
    w: blip.size / width,
    h: blip.size / height,
  }));
  const hits = (candidate) =>
    taken.some(
      (other) =>
        Math.abs(other.x - candidate.x) < (other.w + candidate.w) / 2 &&
        Math.abs(other.y - candidate.y) < (other.h + candidate.h) / 2,
    );
  for (const blip of placed) {
    if (!blip.style.labels || !blip.label) {
      blip.labelled = false;
      blip.font = 0;
      blip.labelAbove = false;
      blip.labelGap = 0;
      blip.labelShift = 0;
      blip.labelWidth = 0;
      continue;
    }
    const font =
      Math.max(BLIP_LABEL_MIN, blip.style.size * BLIP_LABEL_RATIO) * magnify;
    /* Коробка подписи в долях радара. Ширина оценивается по средней ширине
       знака кириллицы: точная требует замера в документе, а раскладка обязана
       считаться без него — по ней живут тесты. Оценка нарочно щедрая: коробка
       уже́ настоящей подписи означала бы, что подпись вылезет за радар, а
       шире — что она просто сдвинется на пару точек. */
    const span = Math.min(
      width * 0.9,
      tr(blip.label).length * font * BLIP_LABEL_EM,
    );
    const w = span / width;
    const h = (font * 1.35) / height;
    const x = clamp(blip.x, w / 2, 1 - w / 2);
    const gap = blip.size / 2 / height + h * 0.35;
    /* Четыре места по очереди: под значком, над ним и на строку дальше в обе
       стороны. Свободного может не оказаться вовсе — тогда подпись остаётся
       под значком: подпись, уехавшая на треть радара от своей точки, хуже
       наложившейся. */
    const spots = [
      { x, y: blip.y + gap + h / 2, w, h },
      { x, y: blip.y - gap - h / 2, w, h },
      { x, y: blip.y + gap + h * 1.7, w, h },
      { x, y: blip.y - gap - h * 1.7, w, h },
    ];
    const chosen = spots.find((spot) => !hits(spot)) || spots[0];
    taken.push(chosen);
    blip.labelled = true;
    blip.font = font;
    blip.labelAbove = chosen.y < blip.y;
    /* Отступ отдаётся долей высоты значка и от его края, а не от центра:
       подпись висит на коробке значка, и координат радара она не знает. */
    const edge = blip.labelAbove
      ? blip.y - blip.size / 2 / height - (chosen.y + h / 2)
      : chosen.y - h / 2 - (blip.y + blip.size / 2 / height);
    blip.labelGap = (edge * height) / blip.size;
    /* Сдвиг наружу и ширина коробки — в пикселях экрана: по ним подпись
       обрезается многоточием ровно там, где кончается отведённое ей место. */
    blip.labelShift = (x - blip.x) * width;
    blip.labelWidth = span;
  }
}

/**
 * Маршрут в долях радара.
 *
 * Точки не обрезаются по краю: линия уходит за границу радара и обрезается уже
 * вёрсткой. Обрезать её числами значило бы придумывать место, где маршрут
 * «кончается», — а он не кончается, он просто дальше, чем видно.
 */
export function routeShape(points = SCENE_ROUTE, view, turn = STILL_TURN) {
  return points.map((point) => projectPoint(point, view, turn));
}

/** Ломаная маршрута как путь SVG в долях радара (viewBox 0 0 1 1). */
export function routePath(points, view, turn = STILL_TURN) {
  const shape = routeShape(points, view, turn);
  if (shape.length < 2) return "";
  return shape
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(5)} ${point.y.toFixed(5)}`,
    )
    .join(" ");
}

/*
 * Шеврон направления: размер и шаг.
 *
 * Доля от толщины линии меньше единицы, потому что шеврон обязан читаться
 * ВНУТРИ неё: вылезший за края он выглядит повреждением линии, а не
 * указателем. Пол в четыре пикселя — предел различимости: на линии в два
 * пикселя шеврон в два с половиной превращается в точку.
 *
 * Шаг — в ширинах самого шеврона, а не в пикселях радара: см. `routeArrows`.
 */
export const ARROW_SHARE = 1.15;
export const ARROW_MIN = 4;
export const ARROW_STEP = 7.5;

/**
 * Размер шеврона в пикселях макета.
 *
 * Считается здесь, а не в разметке: по этому же числу идёт шаг между
 * шевронами, и два расчёта одного размера рано или поздно разошлись бы —
 * стрелки поехали бы гуще или реже, чем задумано.
 */
export function routeArrowSize({
  width = DEFAULT_ROUTE.width,
  magnify = 1,
} = {}) {
  return Math.max(ARROW_MIN, (Number(width) || 0) * ARROW_SHARE) * magnify;
}

/**
 * Шевроны направления вдоль маршрута.
 *
 * По самой линии не видно, куда идти: начало и конец у неё одинаковые. Стрелки
 * SVG-маркерами тут не годятся — коробка маршрута растянута на радар
 * неравномерно (он шире, чем выше), и маркер вышел бы скошенным. Поэтому места
 * и углы считаются здесь, в ПИКСЕЛЯХ экрана, а рисуются отдельными значками
 * поверх линии.
 *
 * Шаг задан в пикселях, а не долями длины: на коротком маршруте доля дала бы
 * стрелки вплотную, на длинном — две штуки на весь радар. И считается он от
 * размера самого шеврона, а не отдельным числом: цепочку читает глаз, а глаз
 * меряет просвет между стрелками их же шириной — постоянный шаг на толстой
 * линии даёт гребёнку, на тонкой — редкий пунктир из стрелок.
 */
export function routeArrows({
  points = SCENE_ROUTE,
  view,
  radar,
  turn = STILL_TURN,
  arrow = routeArrowSize(),
}) {
  const width = Math.max(1, Number(radar?.width) || 1);
  const height = Math.max(1, Number(radar?.height) || 1);
  const shape = routeShape(points, view, turn).map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  if (shape.length < 2) return [];
  /* Нижняя граница шага — предохранитель, а не настройка: нулевой шаг увёл бы
     обход отрезка в бесконечный цикл. */
  const step = Math.max(12, arrow * ARROW_STEP);
  const arrows = [];
  /* Первая стрелка отступает на полшага: посаженная в самое начало, она
     накрывается значком игрока, из которого маршрут и выходит. */
  let carry = step * 0.5;
  for (let index = 1; index < shape.length; index += 1) {
    const from = shape[index - 1];
    const to = shape[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    if (span < 1e-6) continue;
    /* Ноль угла смотрит вверх — так же, как нарисован сам шеврон. */
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    let along = carry;
    for (; along < span; along += step) {
      const t = along / span;
      const x = (from.x + dx * t) / width;
      const y = (from.y + dy * t) / height;
      if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) continue;
      arrows.push({ id: `${index}-${along.toFixed(1)}`, x, y, angle });
    }
    carry = along - span;
  }
  return arrows;
}

/**
 * Ложится ли подложка на мировые координаты.
 *
 * Плитки из игры — это тот же атлас, в котором считаются точки, и на них
 * значок попадает на настоящую заправку. Рисованная подложка — просто
 * картинка: её пропорции другие, мировых координат у неё нет, и растягивать
 * под неё проекцию нельзя — тогда «настоящие координаты» превратятся в
 * подгонку под рисунок. Поэтому такая подложка показывается как есть, а
 * человеку сказано, что под значками рисунок.
 *
 * Пропорция проверяется, а не берётся на слово: чужая большая карта может
 * лежать другой сеткой плиток, и тогда мир под значками уедет.
 */
export function fieldAligned(field, atlas = DEFAULT_ATLAS) {
  if (!field || field.source !== "game") return false;
  const size = field.size;
  if (!size?.width || !size?.height) return false;
  const map = atlasSize(atlas);
  return Math.abs(size.width / size.height - map.width / map.height) < 0.01;
}

/**
 * Как поставить подложку внутри радара, чтобы мир совпал.
 *
 * Кусок карты — прямоугольник `view` в долях атласа, а картинка атласа лежит
 * целиком. Значит, картинку нужно растянуть во столько раз, во сколько кусок
 * меньше целого, и сдвинуть на начало куска. Проценты — от размера радара,
 * поэтому пересчитывать их при изменении окна не нужно: вёрстка сделает это
 * сама.
 */
export function fieldFrame(view) {
  return {
    width: `${(100 / view.du).toFixed(4)}%`,
    height: `${(100 / view.dv).toFixed(4)}%`,
    left: `${((-view.u / view.du) * 100).toFixed(4)}%`,
    top: `${((-view.v / view.dv) * 100).toFixed(4)}%`,
  };
}

/**
 * Коробка, в которой лежит подложка, в процентах от радара.
 *
 * Это тот самый квадрат по диагонали радара, который крутится вместе с курсом:
 * он больше радара, зато накрывает его при любом угле. Числа постоянные —
 * зависят только от пропорции радара, а не от масштаба и не от места, — и
 * считаются один раз на модуль.
 */
/** Какую долю полустороны радара занимает обод с меткой севера. */
export const NORTH_RIM = 0.86;

/**
 * Где на радаре стоит метка севера.
 *
 * Считается здесь, а не поворотом квадрата в вёрстке. Квадрат по высоте радара
 * — это окружность радиусом в 0.43 его высоты, и на прямоугольном радаре
 * 220×160 буква уезжала с обода на середину карты: сверху она стояла в
 * одиннадцати точках от кромки, а на курсе 90° — в сорока одной от боковой.
 * Обод прямоугольника — эллипс по его сторонам, и доли по каждой оси свои.
 *
 * Ноль курса смотрит вверх, а карта крутится против часовой: на курсе 90°
 * (взгляд на восток) север уходит налево — как и подложка под ним.
 */
export function northMark({ heading = 0, rim = NORTH_RIM } = {}) {
  const angle = ((Number(heading) || 0) * Math.PI) / 180;
  const reach = rim / 2;
  return {
    x: 0.5 - reach * Math.sin(angle),
    y: 0.5 - reach * Math.cos(angle),
  };
}

export function fieldBox(cover = RADAR_COVER) {
  const width = cover * 100;
  const height = cover * RADAR_ASPECT * 100;
  return {
    width: `${width.toFixed(4)}%`,
    height: `${height.toFixed(4)}%`,
    left: `${((100 - width) / 2).toFixed(4)}%`,
    top: `${((100 - height) / 2).toFixed(4)}%`,
  };
}
