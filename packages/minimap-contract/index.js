/*
 * Контракт мини-карты: одна геометрия на редактор и на компилятор.
 *
 * Редактор рисует мини-карту, компилятор пишет её в minimap.gfx и
 * frontend.xml, и пока каждый считал «где стоят полосы» по-своему, они
 * разошлись так, что полосы, выставленные в редакторе «сверху», в игре
 * оказывались на 166 точек выше кадра мини-карты — то есть не видны вовсе
 * (2026-09-16, проверено эмулятором Flash на файле из update.rpf игрока).
 * Причина была в системе координат: редактор мерил карту как 180:131, а
 * компилятор — пространством шириной 5037 твипов, которого в файле нет.
 *
 * Здесь записано то, что есть в самом файле игры, и больше ничего:
 *
 *  • Сцена minimap.gfx — 191×136 точек (3820×2720 твипов, заголовок SWF).
 *  • Радар внутри контейнера HEALTH_ARMOUR_ABILITY_SMALL — прямоугольник
 *    179×115 в точке (6, 8): по нему стоят `wantedOverlaySP`,
 *    `minimapFlashMC`, `healthHitMC` и подсветка карты. Игра сама кладёт
 *    сонар в (6, 8) — `SHOW_SONAR_SWEEP` в MINIMAP.as.
 *  • Штатные полосы — под радаром: подложка 123…135, полосы 126…132, HP
 *    89 точек, броня 43 × 2.049 в сетевой игре, зазор 2.
 *
 * Все координаты элементов в проекте — доли радара 179×115: так их видит
 * человек в редакторе и так их переводит компилятор. Выйти за радар можно на
 * поля сцены (сверху 8 точек, снизу 13 — там штатная полоса), дальше игра
 * кадр обрезает.
 *
 * Шестая схема (2026-09-20): новая мини-карта и «Сбросить» — это вид самой
 * игры, снятый с её файлов, а не заводской вид редактора. Полосы под
 * радаром, цвета из `hudcolor.dat`, заливка полупрозрачная, как фигура
 * Rockstar. К проекту добавились рамка карты (`frame`: размытие и обводка по
 * сторонам) и своя подложка с контуром у полос.
 *
 * Седьмая схема (2026-09-20): значок и цифра — два разных элемента. Раньше
 * они делили одну коробку (`healthNumber`), а переключатель `indicatorMode`
 * решал, что в ней нарисовать и как поделить её ширину: подвинуть значок
 * отдельно от цифры было нельзя, а «значок слева от числа» было единственным
 * их взаимным положением. Теперь у значков свои элементы — `healthIcon` и
 * `armorIcon`, — которые двигаются, как всё остальное; `indicatorMode` из
 * проекта ушёл, и прежние проекты переводятся в пару элементов так, чтобы на
 * экране ничего не сдвинулось.
 *
 * Дальность обзора (2026-09-22): блок `zoom` — множители штатного масштаба
 * радара пешком и в машине. Схему не двигает: без блока проект означает «как
 * в игре», и так его и читают.
 *
 * Заливка полос (2026-10-06, задача 8): `effects.healthFill` и
 * `effects.armorFill` — ровный цвет игры, готовая анимация или своё видео
 * (`fills.js`). Схему тоже не двигает: без поля заливка — цвет игры.
 *
 * ТЗ 10.10.2026, вечер (задачи 10 и 15): «цвет по запасу» снят — ступени
 * полос всегда выключены; цифры получили шрифт игры на выбор и способ, каким
 * отнимается HP (`loss*`, `floatStyle`); раскладка помнит, какая полоса стоит
 * у края карты (`vitalsEdge`); метка GPS и маршрут переехали сюда блоком
 * `gps` (`gps-marker.js`). Схему ничто из этого не двигает: без полей — как
 * было.
 */

import {
  MINIMAP_FILL_DEFAULT_COLORS,
  minimapFillActive,
  normalizeMinimapFill,
} from "./fills.js";
import {
  MINIMAP_VITAL_STYLE_IDS,
  MINIMAP_VITAL_STYLE_IMAGE,
  MINIMAP_VITAL_THICKNESS,
} from "./vital-icons.js";
import { normalizeMinimapGps } from "./gps-marker.js";
import { normalizeMinimapOverlays } from "./overlays.js";
import { normalizeMinimapDistance } from "./distance.js";
import { normalizeMinimapVitalPlate } from "./vital-plate.js";
import { normalizeMinimapBigScreen } from "./big-screen.js";
import {
  GAME_SCREEN_FORMS,
  MINIMAP_GAME_SAFE_INSET,
  normalizeScreenResolution,
} from "./game-screen.js";

export * from "./fills.js";
export * from "./vital-icons.js";
export * from "./overlays.js";
export * from "./distance.js";
export * from "./vital-plate.js";
export * from "./big-screen.js";
export * from "./game-screen.js";

export const MINIMAP_SCHEMA_VERSION = 8;

/** Твипов в точке сцены (единица SWF). */
export const MINIMAP_TWIPS = 20;

/** Сцена minimap.gfx в точках. */
export const MINIMAP_SCENE = Object.freeze({ width: 191, height: 136 });

/** Радар внутри контейнера полос в точках сцены. */
export const MINIMAP_RADAR = Object.freeze({
  x: 6,
  y: 8,
  width: 179,
  height: 115,
});

export const MINIMAP_RADAR_ASPECT = MINIMAP_RADAR.width / MINIMAP_RADAR.height;

/**
 * Где на радаре стоит значок игрока — штатная стрелка (пешком, сюжет), в долях радара (`MINIMAP_RADAR`): `x` — по ширине слева,
 * `y` — по высоте СВЕРХУ, то есть ниже центра радара на четверть его высоты. Радар не центрирован на игроке: игра держит
 * стрелку ближе к нижнему краю, чтобы впереди было видно больше карты.
 *
 * ИЗМЕРЕНО (замер H2, 14.11.2026, работа со сдвигом и масштабом 1,2 на двух экранах 1920×1080): на 16:9 центр стрелки в y = 860 px
 * при центре радара 810 (0,742 высоты радара), на растянутом 4:3 — 862 px (0,751); по X — середина (383,5 и 381 px при 385).
 * Допуск замера ±2 px. Окно (предпросмотр: штатная стрелка, своя картинка значка) и стенд (обещание «значок игрока: центр»)
 * берут эту точку отсюда, а не центр кадра.
 */
export const MINIMAP_PLAYER_POINT = Object.freeze({
  x: 0.5,
  y: 0.75,
  source:
    "замер H2 14.11.2026: 16:9 — y 0,742, растянутый 4:3 — y 0,751 высоты радара; x — середина; ±2 px",
});

/** Штатная подложка полос под радаром (фигура на глубине 1), в точках. */
export const MINIMAP_STRIP = Object.freeze({ top: 123, bottom: 135 });

/**
 * Единицы предпросмотра: ширина радара в редакторе — 360 единиц.
 *
 * Кегль цифр и размеры значков в проекте записаны в этих единицах, потому что
 * в них их видит человек. В точки сцены их переводит `minimapUnitsToScene`.
 */
export const MINIMAP_EDITOR_UNITS = 360;

export const minimapUnitsToScene = (units) =>
  (Number(units) * MINIMAP_RADAR.width) / MINIMAP_EDITOR_UNITS;

/**
 * Куда может встать центр элемента, в долях радара. Обычно — поля сцены (`MINIMAP_WIDGET_BOUNDS` их
 * сужает по габариту элемента), при «HP отдельно от карты» у группы HP — весь экран: он целиком
 * умещается в этот ряд, даже если кадр мини-карты у правого верхнего угла (карта в левом нижнем — до
 * угла ≈ 7 ширин радара).
 */
export const MINIMAP_STOCK_WIDGET_RANGE = Object.freeze([-0.5, 1.5]);
export const MINIMAP_SCREEN_WIDGET_RANGE = Object.freeze([-14, 15]);

/** Куда элемент может выйти, в долях радара: поля сцены вокруг него. */
export const MINIMAP_WIDGET_BOUNDS = Object.freeze({
  left: -MINIMAP_RADAR.x / MINIMAP_RADAR.width,
  top: -MINIMAP_RADAR.y / MINIMAP_RADAR.height,
  right: (MINIMAP_SCENE.width - MINIMAP_RADAR.x) / MINIMAP_RADAR.width,
  bottom: (MINIMAP_SCENE.height - MINIMAP_RADAR.y) / MINIMAP_RADAR.height,
});

/*
 * Штатные полосы игры в долях радара.
 *
 * Толщина полосы в проекте — высота элемента при `barThickness` 8; штатные 6
 * точек из 115 — это 0.0522. Длина брони — сетевая: в GTA Online и на RP
 * серверах игра растягивает её на 2.049 (`rescaleAllBars`), и она доходит до
 * правого края радара.
 */
const STOCK_BAR_TOP = 126;
const STOCK_BAR_THICKNESS = 6;
const STOCK_HEALTH_LENGTH = 89;
const STOCK_ARMOUR_START = 91;
export const MINIMAP_ARMOUR_RUNTIME_SCALE = 2.049;
const STOCK_ARMOUR_LENGTH = 43 * MINIMAP_ARMOUR_RUNTIME_SCALE;

export const MINIMAP_STOCK_BARS = Object.freeze({
  healthBar: Object.freeze({
    x: STOCK_HEALTH_LENGTH / 2 / MINIMAP_RADAR.width,
    y:
      (STOCK_BAR_TOP + STOCK_BAR_THICKNESS / 2 - MINIMAP_RADAR.y) /
      MINIMAP_RADAR.height,
    width: STOCK_HEALTH_LENGTH / MINIMAP_RADAR.width,
    height: STOCK_BAR_THICKNESS / MINIMAP_RADAR.height,
    rotation: 0,
  }),
  armorBar: Object.freeze({
    x: (STOCK_ARMOUR_START + STOCK_ARMOUR_LENGTH / 2) / MINIMAP_RADAR.width,
    y:
      (STOCK_BAR_TOP + STOCK_BAR_THICKNESS / 2 - MINIMAP_RADAR.y) /
      MINIMAP_RADAR.height,
    width: STOCK_ARMOUR_LENGTH / MINIMAP_RADAR.width,
    height: STOCK_BAR_THICKNESS / MINIMAP_RADAR.height,
    rotation: 0,
  }),
});

/** Стрелка игрока (`radar_centre`) штатного размера, в точках сцены. */
export const MINIMAP_STOCK_MARKER_HEIGHT = 16;

/*
 * Вид полос самой игры — снят с её файлов (Steam Legacy, update.rpf):
 *
 *  • цвета — `common/data/ui/hudcolor.dat`: HUD_COLOUR_GREEN 114 204 114,
 *    HUD_COLOUR_BLUE 93 182 229, HUD_COLOUR_RED 224 50 50;
 *  • заливка — белая фигура с альфой 127 из 255 (символ 314 штатного
 *    minimap.gfx). После окраски полоса наполовину прозрачна, поэтому в игре
 *    она приглушённая, а не цвета палитры;
 *  • дорожка — серая 204 с той же альфой: `Colourise` прибавляет к ней цвет
 *    полосы минус 255, и выходит тёмный тон того же цвета;
 *  • под полосами — чёрная лента 123…135 с альфой 50% и чёрные подложки
 *    полос (`bar_bg`) с альфой 20%.
 *
 * Прежний «как в игре» был подобран на глаз: зелёный #359a47 сплошной
 * заливкой. На экране он выходил ярче и плотнее настоящего.
 */
export const MINIMAP_GAME_COLORS = Object.freeze({
  health: "#72cc72",
  armor: "#5db6e5",
  lowHealth: "#e03232",
});
export const MINIMAP_GAME_BAR_OPACITY = 50;
export const MINIMAP_GAME_TRACK_OPACITY = 50;
/** Подложки полос `bar_bg` в сетевой игре, в точках от левого края радара. */
export const MINIMAP_STOCK_BAR_PADS = Object.freeze([
  Object.freeze({ x: 0, width: STOCK_HEALTH_LENGTH }),
  Object.freeze({
    x: STOCK_ARMOUR_START,
    width: MINIMAP_RADAR.width - STOCK_ARMOUR_START,
  }),
]);
export const MINIMAP_STOCK_BAR_PAD_OPACITY = 20;

/**
 * Непрозрачность в процентах → альфа фигуры SWF. Вниз, а не к ближайшему:
 * штатные 50% — это 127, а не 128.
 */
export const minimapOpacityToAlpha = (percent) =>
  Math.max(0, Math.min(255, Math.floor((255 * Number(percent)) / 100)));

const clamp = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};

/*
 * ---------------------------------------------------------------------------
 * Рамка: линии вокруг прямоугольника.
 * ---------------------------------------------------------------------------
 *
 * Обводка карты идёт снаружи радара: она обрамляет карту, а не съедает её
 * край, и на полях сцены (6 точек по бокам, 8 сверху) ей есть место. Контур
 * полосы идёт внутри полосы: HP и броня стоят вплотную, и наружный контур
 * одной лёг бы на заливку другой.
 *
 * Линии не перекрываются — иначе полупрозрачная обводка темнела бы в углах, а
 * во Flash перекрытие одной заливки и вовсе вырезает дыру. Угол принадлежит
 * верхней или нижней линии; если соседней стороны нет, линия кончается
 * вровень с краем и хвоста не оставляет.
 *
 * Один расчёт на редактор и компилятор: предпросмотр рисует эти же
 * прямоугольники, и в игру уходят они же.
 */
export const MINIMAP_FRAME_SIDES = Object.freeze([
  "top",
  "right",
  "bottom",
  "left",
]);

export function minimapFrameRects(
  rect,
  thickness,
  sides = {},
  placement = "outside",
) {
  const { x, y, width, height } = rect;
  const on = (side) => sides[side] !== false;
  const line =
    placement === "inside"
      ? Math.min(Number(thickness) || 0, width / 2, height / 2)
      : Number(thickness) || 0;
  if (!(line > 0) || !(width > 0) || !(height > 0)) return [];
  const result = [];
  if (placement === "inside") {
    const top = on("top") ? line : 0;
    const bottom = on("bottom") ? line : 0;
    if (top) result.push({ side: "top", x, y, width, height: top });
    if (bottom)
      result.push({
        side: "bottom",
        x,
        y: y + height - bottom,
        width,
        height: bottom,
      });
    const inner = height - top - bottom;
    if (inner > 0) {
      if (on("left"))
        result.push({
          side: "left",
          x,
          y: y + top,
          width: line,
          height: inner,
        });
      if (on("right"))
        result.push({
          side: "right",
          x: x + width - line,
          y: y + top,
          width: line,
          height: inner,
        });
    }
    return result;
  }
  const leftPad = on("left") ? line : 0;
  const rightPad = on("right") ? line : 0;
  if (on("top"))
    result.push({
      side: "top",
      x: x - leftPad,
      y: y - line,
      width: width + leftPad + rightPad,
      height: line,
    });
  if (on("bottom"))
    result.push({
      side: "bottom",
      x: x - leftPad,
      y: y + height,
      width: width + leftPad + rightPad,
      height: line,
    });
  if (on("left"))
    result.push({ side: "left", x: x - line, y, width: line, height });
  if (on("right"))
    result.push({ side: "right", x: x + width, y, width: line, height });
  return result;
}

/*
 * Габарит элемента с поворотом, в долях радара.
 *
 * Длина элемента — доля ширины радара, толщина — доля высоты. У повёрнутой
 * полосы длина ложится по вертикали, а доля ширины там в 1.557 раза длиннее
 * доли высоты: раньше это не учитывалось, и «вертикальная полоса во всю
 * высоту» уходила за низ карты.
 */
export function minimapWidgetHalfExtent(widget, thicknessScale = 1) {
  const radians = ((Number(widget?.rotation) || 0) * Math.PI) / 180;
  const along = (Number(widget?.width) || 0) * MINIMAP_RADAR.width;
  const across =
    (Number(widget?.height) || 0) * MINIMAP_RADAR.height * thicknessScale;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    x: (along * cosine + across * sine) / 2 / MINIMAP_RADAR.width,
    y: (along * sine + across * cosine) / 2 / MINIMAP_RADAR.height,
  };
}

/** Центр элемента, при котором он целиком остаётся на сцене. */
export function clampMinimapWidgetCenter(widget, x, y, thicknessScale = 1) {
  const half = minimapWidgetHalfExtent(widget, thicknessScale);
  const bounds = MINIMAP_WIDGET_BOUNDS;
  const axis = (value, low, high) =>
    low > high ? (low + high) / 2 : clamp(value, low, high, (low + high) / 2);
  return {
    x: axis(x, bounds.left + half.x, bounds.right - half.x),
    y: axis(y, bounds.top + half.y, bounds.bottom - half.y),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Положение мини-карты на экране — frontend.xml.
 * ---------------------------------------------------------------------------
 *
 * Мини-карту на экран ставят три записи: `minimap` (кадр Scaleform с
 * полосами и значками), `minimap_mask` (где рисуется сама карта) и
 * `minimap_blur` (тёмная подложка). Числа в них — доли экрана от угла,
 * заданного alignX/alignY; у штатных записей это левый нижний угол, и
 * отрицательный posY поднимает запись вверх (так же сдвигает мини-карту в
 * угол alt:V в своей документации).
 *
 * Как именно игра переводит эти доли в точки, для переноса не важно: три
 * записи сдвигаются на одно и то же смещение и масштабируются вокруг одного
 * угла, и всё, что было выровнено между ними у Rockstar, остаётся
 * выровненным. Поэтому в проекте хранится не «где карта», а «насколько её
 * сдвинули и растянули от штатного места», и настройки по умолчанию пишут в
 * игру ровно штатные числа.
 *
 * Раньше в игру уходил пересчёт из центра, размера и пропорции 180:131, и
 * даже не тронутая человеком мини-карта сдвигалась на 10% экрана вправо и 11%
 * вверх и уменьшалась на четверть.
 */

export const MINIMAP_FRONTEND_STOCK = Object.freeze({
  minimap: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: -0.0045,
    posY: 0.002,
    sizeX: 0.15,
    sizeY: 0.188888,
  }),
  minimap_mask: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: 0.02,
    posY: 0.032,
    sizeX: 0.111,
    sizeY: 0.159,
  }),
  minimap_blur: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: -0.03,
    posY: 0.022,
    sizeX: 0.266,
    sizeY: 0.237,
  }),
  bigmap: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: -0.003975,
    posY: 0.022,
    sizeX: 0.364,
    sizeY: 0.460416666,
  }),
  bigmap_mask: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: 0.145,
    posY: 0.015,
    sizeX: 0.176,
    sizeY: 0.395,
  }),
  bigmap_blur: Object.freeze({
    alignX: "L",
    alignY: "B",
    posX: -0.019,
    posY: 0.022,
    sizeX: 0.262,
    sizeY: 0.464,
  }),
});

/*
 * Где в маске `radarmasksm` лежит радар minimap.gfx (2 ноября 2026, владелец: «карта вылезает слева и сверху»).
 *
 * Маску игра растягивает на запись `minimap_blur`, фильм — на запись `minimap`; обе сдвигаются и растут вместе
 * (`placeMinimapFrontend`), поэтому место радара в точках маски одно при любом положении, размере, форме экрана и
 * отступе. У штатных записей и маски 512×256 радар 6…185 × 8…123 сцены — это 58,2…328,8 × 42,4…214,9 точки маски.
 * Край, по которому обрезается размытие (половина яркости площадки, `minimap-blur.js`), у Steam Legacy — 56…328 ×
 * 40…212: на 2,2 точки левее и на 2,4 выше радара и на 2,9 короче снизу. В игре без растушёвки это видно: карта
 * торчит из-под полос и обводки слева и сверху (кадр владельца 02.11, 1920×1080 растянутый 4:3: 3 точки слева, 2–3
 * сверху), а снизу у края радара остаётся щель.
 */
export function minimapRadarMaskBox(
  { width, height },
  stock = MINIMAP_FRONTEND_STOCK,
) {
  const map = stock.minimap;
  const blur = stock.minimap_blur;
  const top = (entry) => entry.posY - entry.sizeY;
  const across = (value) => ((value - blur.posX) / blur.sizeX) * width;
  const down = (value) => ((value - top(blur)) / blur.sizeY) * height;
  return {
    left: across(
      map.posX + (map.sizeX * MINIMAP_RADAR.x) / MINIMAP_SCENE.width,
    ),
    right: across(
      map.posX +
        (map.sizeX * (MINIMAP_RADAR.x + MINIMAP_RADAR.width)) /
          MINIMAP_SCENE.width,
    ),
    top: down(top(map) + (map.sizeY * MINIMAP_RADAR.y) / MINIMAP_SCENE.height),
    bottom: down(
      top(map) +
        (map.sizeY * (MINIMAP_RADAR.y + MINIMAP_RADAR.height)) /
          MINIMAP_SCENE.height,
    ),
  };
}

export const MINIMAP_SMALL_COMPONENTS = Object.freeze([
  "minimap",
  "minimap_mask",
  "minimap_blur",
]);
export const MINIMAP_BIG_COMPONENTS = Object.freeze([
  "bigmap",
  "bigmap_mask",
  "bigmap_blur",
]);

export const MINIMAP_PLACEMENT_LIMITS = Object.freeze({
  /* Вправо — с запасом на самую широкую форму таблицы: у 32:9 игра вдвое ужимает числа frontend.xml (k = 0,5,
     `minimapGameScreen`), и самый маленький кадр (60 % × 70 %) встаёт у правого края при смещении 1,946 (у 21:9 — 1,26).
     Для каждой формы своё «достаточно» считает `minimapPlacementLimits`: у 16:9 хватает 0,95, и свободного хода,
     за которым кадр только уходит с экрана, нет. */
  offsetX: Object.freeze([-0.1, 1.95]),
  offsetY: Object.freeze([-1, 0.1]),
  scale: Object.freeze([0.6, 2]),
  stretch: Object.freeze([0.7, 1.6]),
});

/**
 * Пределы ползунков окна для экрана `screen` (форма и безопасная зона): общие, `MINIMAP_PLACEMENT_LIMITS`, но смещение
 * вправо — ровно столько, чтобы самый маленький кадр дошёл до правого края ЭТОЙ формы (перетаскиванием и пресетом «Справа
 * снизу»). Больше — «мёртвая зона»: число растёт, а кадр уходит за экран. Ими считают перетаскивание, пресеты и размер
 * (`minimapOffsetForRect`); общие пределы остаются верхней планкой для самой широкой формы.
 */
export function minimapPlacementLimits(
  screen = undefined,
  stock = MINIMAP_FRONTEND_STOCK,
) {
  const { aspect, inset } = minimapGameScreen(screen);
  const k = HUD_DESIGN_ASPECT / aspect;
  const anchor = stock.minimap;
  const smallest =
    anchor.sizeX *
    MINIMAP_PLACEMENT_LIMITS.scale[0] *
    MINIMAP_PLACEMENT_LIMITS.stretch[0] *
    k;
  /* Перетаскивание: левый край кадра — (1 − ширина); пресет «Справа снизу»: зазор до края тот же, что у Rockstar слева. */
  const drag = (1 - smallest - inset) / k - anchor.posX;
  const preset = (1 - 2 * inset - smallest) / k - 2 * anchor.posX;
  const reach = Math.ceil(Math.max(drag, preset) * 1000) / 1000;
  const [low, high] = MINIMAP_PLACEMENT_LIMITS.offsetX;
  return Object.freeze({
    ...MINIMAP_PLACEMENT_LIMITS,
    offsetX: Object.freeze([low, Math.min(high, Math.max(0, reach))]),
  });
}

/*
 * Пределы числа frontend.xml при установке (ТЗ H1, 14.11.2026). Окно держит
 * ползунки в `MINIMAP_PLACEMENT_LIMITS`, а в игру числа идут для экрана
 * игрока: у 32:9 те же доли ширины — числа в 2,4 раза больше, чем у 3:2 (игра
 * умножает ширину на k = (16/9) / форма). Узкие пределы окна молча ужимали такой
 * кадр, и «то же место, что в окне» не выходило. Здесь — запас на любую пару форм
 * таблицы; `minimapInstallClamps` называет случай, когда и он не хватил.
 */
export const MINIMAP_INSTALL_LIMITS = Object.freeze({
  offsetX: Object.freeze([-1, 3]),
  offsetY: Object.freeze([-1, 0.1]),
  scale: Object.freeze([0.6, 2]),
  stretch: Object.freeze([0.2, 5]),
});

export const DEFAULT_MINIMAP_PLACEMENT = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  stretch: 1,
  transparentBackground: false,
  /* «Скрыть карту» (задача 8 ТЗ 10.10.2026): радара нет, стрелки и N тоже,
     полосы, цифры и значки стоят на своих местах. */
  hidden: false,
  /* Непрозрачность самой карты в процентах (задача 1 ТЗ 17.10.2026); `null`
     — как в игре, маску игры не трогаем (`MINIMAP_GAME_MAP_OPACITY`). */
  opacity: null,
  /* Где открывается развёрнутый радар (2 ноября 2026, `MINIMAP_EXPANDED_PLACES`). */
  expanded: "left",
});

/*
 * Где открывается развёрнутый радар (2 ноября 2026, владелец: «увеличенный режим открывается по центру и тащит
 * за собой худ Majestic»). До этого записи `bigmap*` ехали за малой картой тем же смещением: малую карту ставят
 * к центру — развёрнутый радар открывался посередине экрана, а HUD сервера, который встаёт по радару, уезжал
 * за ним. «Слева» — X штатной игры (как в ванили), по высоте радар держится у малой карты в пределах экрана;
 * «По центру» — середина развёрнутого радара над серединой малой карты, не за краем экрана.
 */
export const MINIMAP_EXPANDED_PLACES = Object.freeze(["left", "center"]);

/*
 * Непрозрачность карты (задача 1 ТЗ 17.10.2026, владелец: «регулировать
 * прозрачность карты, а не просто вкл/выкл»).
 *
 * Карту на экран кладёт маска `radarmasksm`/`radarmasklg` в graphics.ytd, и
 * её яркость — это и есть непрозрачность карты: чёрная маска убирает карту,
 * тёмно-серая делает её прозрачнее (так устроены «прозрачные мини-карты»
 * сообщества). У Steam Legacy площадка маски малой карты — 187 из 255,
 * развёрнутой — 181: карта игры уже чуть прозрачна, 73 %. В проекте хранится
 * непрозрачность площадки: 100 % — яркость 255, карта без прозрачности; 0 % —
 * карты нет (то же, что «Скрыть карту»).
 */
export const MINIMAP_GAME_MAP_OPACITY = 73;
export const MINIMAP_MAP_OPACITY_LIMITS = Object.freeze([0, 100]);

/** Непрозрачность карты, какую увидит игрок: 0 у скрытой, как в игре — 73. */
export function minimapMapOpacity(placement) {
  const value = normalizeMinimapPlacement(placement);
  if (value.hidden) return 0;
  return value.opacity ?? MINIMAP_GAME_MAP_OPACITY;
}

/** Яркость площадки маски (0…255) для непрозрачности карты в процентах. */
export const minimapMaskLevel = (percent) =>
  Math.max(0, Math.min(255, Math.round((255 * Number(percent)) / 100)));

const rounded = (value, digits = 6) => {
  const factor = 10 ** digits;
  /* `+ 0` — минус нуль в числе положения не нужен: «−0» в записи сверки и сравнении только путает. */
  return Math.round(value * factor) / factor + 0;
};

export function normalizeMinimapPlacement(
  input = {},
  limits = MINIMAP_PLACEMENT_LIMITS,
) {
  const source = input && typeof input === "object" ? input : {};
  const limit = (name) =>
    rounded(
      clamp(
        source[name],
        limits[name][0],
        limits[name][1],
        DEFAULT_MINIMAP_PLACEMENT[name],
      ),
    );
  return {
    offsetX: limit("offsetX"),
    offsetY: limit("offsetY"),
    scale: limit("scale"),
    stretch: limit("stretch"),
    transparentBackground: source.transparentBackground === true,
    hidden: source.hidden === true,
    opacity:
      source.opacity === null ||
      source.opacity === undefined ||
      source.opacity === ""
        ? null
        : Math.round(
            clamp(
              source.opacity,
              1,
              MINIMAP_MAP_OPACITY_LIMITS[1],
              MINIMAP_GAME_MAP_OPACITY,
            ),
          ),
    expanded: MINIMAP_EXPANDED_PLACES.includes(source.expanded)
      ? source.expanded
      : DEFAULT_MINIMAP_PLACEMENT.expanded,
  };
}

/**
 * Что из проекта в игру не уходит (ТЗ H1, 14.11.2026): окно помечает это у самого
 * элемента ДО «Применить», установка называет в плане. Один источник правды для
 * окна и компилятора: ключи `bar-style`, `vitals-animation`, `player-tag`,
 * `transparent-background`. `configuration` — нормализованный проект мини-карты
 * (`effects`, `layout.map`).
 */
export function unsupportedMinimapFeatures(configuration) {
  if (!configuration || typeof configuration !== "object") return [];
  const effects = configuration?.effects || {};
  const map = configuration?.layout?.map || {};
  const result = [];
  if (effects.barBackground !== "#111723" || effects.barRadius !== 0)
    result.push("bar-style");
  if (effects.healthGradient || effects.lowHealthPulse)
    result.push("vitals-animation");
  if (effects.playerTag) result.push("player-tag");
  if (map.transparentBackground) result.push("transparent-background");
  return result;
}

export function isStockMinimapPlacement(placement) {
  const value = normalizeMinimapPlacement(placement);
  return (
    Math.abs(value.offsetX) < 1e-6 &&
    Math.abs(value.offsetY) < 1e-6 &&
    Math.abs(value.scale - 1) < 1e-6 &&
    Math.abs(value.stretch - 1) < 1e-6
  );
}

/** Прямоугольник записи в долях экрана: левый край и верх. */
export function frontendEntryRect(entry) {
  return {
    left: entry.posX,
    top: 1 + entry.posY - entry.sizeY,
    width: entry.sizeX,
    height: entry.sizeY,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Где кадр встаёт в самой игре (ТЗ 11.10.2026, день, задача 1).
 * ---------------------------------------------------------------------------
 *
 * Снято с живой игры стендом (`tools/ingame-qa/runs/tz1110`): кадры мини-
 * карты, маски и размытия игра держит в памяти в долях экрана и считает их
 * из записей frontend.xml (alignX="L", alignY="B") так:
 *
 *   x    = отступ + posX · k,     ширина = sizeX · k,    k = (16/9) / форма экрана
 *   верх = 1 − отступ + posY − sizeY,                    высота = sizeY
 *
 * Отступ — безопасная зона игры, (1 − размер) / 2 с округлением вверх до
 * точки экрана. Размер по умолчанию 0,97 (настройка 212 = 3 во всех профилях
 * игрока) — отступ 1,5 %. Форма экрана — настройка игры (AspectRatio в
 * settings.xml): у растянутого 4:3 на мониторе 1920×1080 игра раскладывает
 * HUD под 4:3, и кадр в 1,33 раза шире, чем при 16:9.
 *
 * До этого окно отступало 3,5 % и сжимало числа в 0,93 экрана. У правого
 * края разница доходила до 6 % экрана: в окне кадр «676» (карта скрыта,
 * полосы справа, 154 %) стоял на экране, а в игре — целиком правее края, и
 * HP с бронёй не было видно вовсе.
 */
const HUD_DESIGN_ASPECT = 16 / 9;

/**
 * Экран игры: форма (число или имя из `MINIMAP_SCREEN_ASPECTS`) и отступ
 * безопасной зоны. Без данных — 16:9 и отступ игры по умолчанию.
 */
export function minimapGameScreen(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const named = MINIMAP_SCREEN_ASPECTS[source.aspect];
  const number = Number(source.aspect);
  const aspect =
    named ||
    (Number.isFinite(number) && number > 0.5 && number < 6
      ? number
      : HUD_DESIGN_ASPECT);
  const inset = Number(source.inset);
  return {
    aspect,
    inset:
      Number.isFinite(inset) && inset >= 0 && inset <= 0.05
        ? inset
        : MINIMAP_GAME_SAFE_INSET,
  };
}

/** Имя формы из `MINIMAP_SCREEN_ASPECTS`, ближайшей к числу. */
export function nearestScreenAspectName(aspect) {
  const value = Number(aspect);
  if (!(value > 0)) return null;
  let best = null;
  let distance = Infinity;
  for (const [name, ratio] of Object.entries(MINIMAP_SCREEN_ASPECTS)) {
    const gap = Math.abs(ratio - value);
    if (gap < distance) {
      best = name;
      distance = gap;
    }
  }
  return best;
}

/** Прямоугольник записи frontend.xml на экране игры, в долях экрана. */
export function gameEntryRect(entry, screen) {
  const { aspect, inset } = minimapGameScreen(screen);
  const k = HUD_DESIGN_ASPECT / aspect;
  return {
    left: inset + entry.posX * k,
    top: 1 - inset + entry.posY - entry.sizeY,
    width: entry.sizeX * k,
    height: entry.sizeY,
  };
}

/**
 * Записи frontend.xml для этого положения.
 *
 * `stock` — штатные записи игры (компилятор читает их из файла игрока,
 * предпросмотр берёт `MINIMAP_FRONTEND_STOCK`). Большая карта (`bigmap*`)
 * по высоте едет за маленькой тем же смещением, по ширине — как выбрано в
 * `expanded` (`MINIMAP_EXPANDED_PLACES`): «Слева» — X игры, «По центру» —
 * над серединой малой карты. Она не масштабируется и не выходит за экран
 * игры `screen` (форма и отступ, `minimapGameScreen`).
 */
export function placeMinimapFrontend(
  placement,
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
  limits = MINIMAP_PLACEMENT_LIMITS,
) {
  const value = normalizeMinimapPlacement(placement, limits);
  const anchor = stock.minimap;
  const result = {};
  for (const name of MINIMAP_SMALL_COMPONENTS) {
    const entry = stock[name];
    result[name] = {
      ...entry,
      posX: rounded(
        anchor.posX +
          value.offsetX +
          (entry.posX - anchor.posX) * value.scale * value.stretch,
      ),
      posY: rounded(
        anchor.posY + value.offsetY + (entry.posY - anchor.posY) * value.scale,
      ),
      sizeX: rounded(entry.sizeX * value.scale * value.stretch),
      sizeY: rounded(entry.sizeY * value.scale),
    };
  }
  const bigAnchor = stock.bigmap;
  if (bigAnchor) {
    /* Пределы — по экрану игры (`gameEntryRect`): x = отступ + posX·k. */
    const { aspect, inset } = minimapGameScreen(screen);
    const k = HUD_DESIGN_ASPECT / aspect;
    /* «По центру»: середина развёрнутого радара — над серединой малой карты. */
    const small = result.minimap;
    const wantX =
      value.expanded === "center"
        ? small.posX + small.sizeX / 2 - (bigAnchor.posX + bigAnchor.sizeX / 2)
        : 0;
    const shiftX = clamp(
      wantX,
      -inset / k - bigAnchor.posX,
      (1 - inset) / k - bigAnchor.sizeX - bigAnchor.posX,
      0,
    );
    const shiftY = clamp(
      value.offsetY,
      bigAnchor.sizeY - 1 + inset - bigAnchor.posY,
      inset - bigAnchor.posY,
      0,
    );
    for (const name of MINIMAP_BIG_COMPONENTS) {
      const entry = stock[name];
      if (!entry) continue;
      result[name] = {
        ...entry,
        posX: rounded(entry.posX + shiftX),
        posY: rounded(entry.posY + shiftY),
        sizeX: entry.sizeX,
        sizeY: entry.sizeY,
      };
    }
  }
  return result;
}

/**
 * Кадр мини-карты (запись `minimap`) на экране игры `screen` при этом
 * положении, в долях экрана (`gameEntryRect`).
 */
export function minimapScreenRect(
  placement,
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
  limits = MINIMAP_PLACEMENT_LIMITS,
) {
  return gameEntryRect(
    placeMinimapFrontend(placement, stock, screen, limits).minimap,
    screen,
  );
}

/**
 * Смещение, при котором кадр мини-карты встаёт левым верхним углом в
 * (left, top) экрана игры — обратная `minimapScreenRect` задача для
 * перетаскивания.
 */
export function minimapOffsetForRect(
  placement,
  { left, top },
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
  limits = minimapPlacementLimits(screen, stock),
) {
  const value = normalizeMinimapPlacement(placement, limits);
  return normalizeMinimapPlacement(
    { ...value, ...rawOffsetsForRect(value, { left, top }, stock, screen) },
    limits,
  );
}

/** Смещения, при которых кадр встаёт левым верхним углом в (left, top), — без пределов. */
function rawOffsetsForRect(value, { left, top }, stock, screen) {
  const { aspect, inset } = minimapGameScreen(screen);
  const k = HUD_DESIGN_ASPECT / aspect;
  const anchor = stock.minimap;
  const sizeY = anchor.sizeY * value.scale;
  return {
    offsetX: (left - inset) / k - anchor.posX,
    offsetY: top - (1 - inset) + sizeY - anchor.posY,
  };
}

/** Левый верхний угол, при котором прямоугольник целиком на экране. */
function onScreen(left, top, width, height) {
  return {
    left: width >= 1 ? (1 - width) / 2 : clamp(left, 0, 1 - width, 0),
    top: height >= 1 ? (1 - height) / 2 : clamp(top, 0, 1 - height, 0),
  };
}

/**
 * Положение для экрана игрока (ТЗ 11.10.2026, день, задача 1).
 *
 * Работу делают под одной формой экрана (`from` — «Экран» редактора), а
 * играют под другой (`to` — настройка игры): растянутый 4:3 на мониторе
 * 16:9 делает кадр шире, и то, что у правого края стояло на экране, в игре
 * уезжало за край. Кадр держится края, к которому он ближе: правая треть
 * экрана — правого (тот же зазор), левая — левого, середина — середины; по
 * высоте форма экрана ничего не меняет. И в любом случае кадр целиком на
 * экране игры — так чинятся и работы, сохранённые до этого дня (в окне
 * числа считались иначе, и правый край там значил «за экраном»).
 * Штатное положение не трогается: его игра ставит сама.
 */
export function fitMinimapPlacementToScreen(
  placement,
  { from = undefined, to = undefined, stock = MINIMAP_FRONTEND_STOCK } = {},
) {
  const value = normalizeMinimapPlacement(placement);
  if (isStockMinimapPlacement(value)) return value;
  const source = minimapScreenRect(value, stock, from);
  const target = minimapScreenRect(value, stock, to);
  const centre = source.left + source.width / 2;
  const left =
    centre > 2 / 3
      ? 1 - (1 - source.left - source.width) - target.width
      : centre < 1 / 3
        ? source.left
        : centre - target.width / 2;
  return minimapOffsetForRect(
    value,
    onScreen(left, source.top, target.width, target.height),
    stock,
    to,
  );
}

/**
 * Положение для установки (ТЗ 02.11.2026: «в Астрале ровно, в игре очень большая и сдвинута»): на мониторе кадр занимает
 * ровно то место, что в окне. `fitMinimapPlacementToScreen` держит только край: числа размера те же, и на растянутом 4:3
 * карта в игре на треть шире, чем в окне. Здесь поправка и в ширине: игра умножает её на k = (16/9) / форма.
 */
export function minimapPlacementForGame(
  placement,
  {
    from = undefined,
    to = undefined,
    stock = MINIMAP_FRONTEND_STOCK,
    limits = MINIMAP_INSTALL_LIMITS,
  } = {},
) {
  return minimapGamePlan(placement, { from, to, stock, limits }).placement;
}

/*
 * Расчёт положения для установки целиком: итоговое положение, прямоугольники на
 * `from` («экран» окна) и на `to` (экран игры) и зажимы — для журнала сверки
 * (ТЗ H1). `minimapPlacementForGame` — только `placement`.
 */
function minimapGamePlan(placement, { from, to, stock, limits }) {
  const value = normalizeMinimapPlacement(placement);
  if (isStockMinimapPlacement(value)) {
    return {
      placement: value,
      stock: true,
      source: minimapScreenRect(value, stock, from),
      target: minimapScreenRect(value, stock, to),
      clamps: [],
      moved: false,
    };
  }
  const wantedStretch =
    (value.stretch * minimapGameScreen(to).aspect) /
    minimapGameScreen(from).aspect;
  const sized = normalizeMinimapPlacement(
    { ...value, stretch: wantedStretch },
    limits,
  );
  const source = minimapScreenRect(value, stock, from);
  const target = minimapScreenRect(sized, stock, to, limits);
  const centre = source.left + source.width / 2;
  /* Ширина упёрлась в предел — кадр держится ближнего края, как при смене экрана. */
  const left =
    centre > 2 / 3
      ? source.left + source.width - target.width
      : centre < 1 / 3
        ? source.left
        : centre - target.width / 2;
  const fitted = onScreen(left, source.top, target.width, target.height);
  const raw = rawOffsetsForRect(sized, fitted, stock, to);
  const result = normalizeMinimapPlacement({ ...sized, ...raw }, limits);
  const clamps = [];
  const note = (field, wanted, used, range) => {
    if (Math.abs(wanted - used) > 1e-6)
      clamps.push({
        field,
        wanted: rounded(wanted),
        used: rounded(used),
        limit: [...range],
      });
  };
  note("stretch", wantedStretch, sized.stretch, limits.stretch);
  note("offsetX", raw.offsetX, result.offsetX, limits.offsetX);
  note("offsetY", raw.offsetY, result.offsetY, limits.offsetY);
  const moved =
    Math.abs(fitted.left - left) > 1e-6 ||
    Math.abs(fitted.top - source.top) > 1e-6;
  return {
    placement: result,
    stock: false,
    source,
    target: minimapScreenRect(result, stock, to, limits),
    clamps,
    moved,
  };
}

/**
 * Что даёт установка для этой работы и экранов — в долях экрана, с зажимами
 * (ТЗ H1): `placement` — положение для frontend.xml, `windowRect` — кадр там,
 * где его видит человек в окне («Экран» `from`), `gameRect` — где он встанет на
 * экране игры `to`, `clamps` — какое число упёрлось в предел, `moved` — кадр не
 * влезал на экран и его подтянули. Совпали ли два кадра — `minimapRectsMatch`.
 */
export function minimapInstallPlan(
  placement,
  {
    from = undefined,
    to = undefined,
    stock = MINIMAP_FRONTEND_STOCK,
    limits = MINIMAP_INSTALL_LIMITS,
  } = {},
) {
  const plan = minimapGamePlan(placement, { from, to, stock, limits });
  return {
    placement: plan.placement,
    stockPlace: plan.stock,
    windowRect: plan.source,
    gameRect: plan.target,
    clamps: plan.clamps,
    moved: plan.moved,
    match: minimapRectsMatch(plan.source, plan.target),
  };
}

/** Один и тот же прямоугольник на экране с точностью `tolerance` (доли экрана). */
export function minimapRectsMatch(a, b, tolerance = 1e-4) {
  return ["left", "top", "width", "height"].every(
    (key) => Math.abs(a[key] - b[key]) <= tolerance,
  );
}

/**
 * Новый размер или ширина кадра в редакторе: кадр растёт от ближнего к нему
 * края экрана — справа снизу влево и вверх, слева снизу как у игры вправо и
 * вверх, из середины — во все стороны — и не выходит за экран игры.
 */
export function resizeMinimapPlacement(
  placement,
  patch,
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
) {
  const before = normalizeMinimapPlacement(placement);
  const after = normalizeMinimapPlacement({ ...before, ...patch });
  const old = minimapScreenRect(before, stock, screen);
  const next = minimapScreenRect(after, stock, screen);
  const centreX = old.left + old.width / 2;
  const centreY = old.top + old.height / 2;
  const left =
    centreX > 2 / 3
      ? old.left + old.width - next.width
      : centreX < 1 / 3
        ? old.left
        : centreX - next.width / 2;
  const top = centreY > 0.5 ? old.top + old.height - next.height : old.top;
  return minimapOffsetForRect(
    after,
    onScreen(left, top, next.width, next.height),
    stock,
    screen,
  );
}

/**
 * Выходит ли кадр за экран игры (с допуском в полточки 1080p) — окно
 * предупреждает, а установка подгоняет (`fitMinimapPlacementToScreen`).
 */
export function minimapOffScreen(
  placement,
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
  limits = MINIMAP_PLACEMENT_LIMITS,
) {
  const rect = minimapScreenRect(placement, stock, screen, limits);
  const slack = 0.0005;
  return (
    rect.left < -slack ||
    rect.top < -slack ||
    rect.left + rect.width > 1 + slack ||
    rect.top + rect.height > 1 + slack
  );
}

/*
 * Положение мини-карты из frontend.xml чужого мода (12.10).
 *
 * Читается только то, что редактор ставит сам: строки `minimap*` и
 * `bigmap*` (`<data name="…" posX posY sizeX sizeY/>`), остальной файл —
 * кнопки меню и прочий интерфейс — не про карту. Моды «положения мини-карты»
 * из редуксов бывают и без неё: у kray, bakugan и emelya в frontend.xml
 * переназначена кнопка перезапуска, а строки карты — как в игре.
 */
const FRONTEND_MAP_ENTRIES = Object.freeze([
  ...MINIMAP_SMALL_COMPONENTS,
  ...MINIMAP_BIG_COMPONENTS,
]);

/** Строки карты из текста frontend.xml: `{ minimap: {…}, … }`. */
export function readMinimapFrontend(xml) {
  const text = String(xml || "").replace(/<!--[\s\S]*?-->/g, "");
  const entries = {};
  for (const name of FRONTEND_MAP_ENTRIES) {
    const found = [
      ...text.matchAll(
        new RegExp(`<data\\s+name=["']${name}["'][^>]*/>`, "gi"),
      ),
    ];
    if (found.length !== 1) continue;
    const element = found[0][0];
    const value = (key) => {
      const match = new RegExp(`\\s${key}=["']([^"']*)["']`, "i").exec(element);
      return match ? Number(match[1]) : NaN;
    };
    const numbers = {
      posX: value("posX"),
      posY: value("posY"),
      sizeX: value("sizeX"),
      sizeY: value("sizeY"),
    };
    if (Object.values(numbers).every(Number.isFinite)) entries[name] = numbers;
  }
  return entries;
}

/**
 * Положение редактора по строкам карты мода: `{ placement, moved, exact,
 * differs }`. `moved` — карта мода стоит не так, как в игре; `exact` —
 * редактор ставит её строки ровно так же; `differs` — что стоит иначе:
 * `"minimap"` (маска и размытие мини-карты) и/или `"bigmap"` (большая карта
 * едет за мини-картой по правилу редактора). `null` — строки `minimap` нет.
 */
export function minimapPlacementFromFrontend(
  entries,
  stock = MINIMAP_FRONTEND_STOCK,
) {
  const own = entries?.minimap;
  const anchor = stock.minimap;
  if (!own || !anchor) return null;
  const scale = own.sizeY / anchor.sizeY;
  const placement = normalizeMinimapPlacement({
    offsetX: own.posX - anchor.posX,
    offsetY: own.posY - anchor.posY,
    scale,
    stretch: own.sizeX / anchor.sizeX / scale,
  });
  const placed = placeMinimapFrontend(placement, stock);
  const near = (a, b) => Math.abs(a - b) <= 1e-4;
  const same = (left, right) =>
    ["posX", "posY", "sizeX", "sizeY"].every((key) =>
      near(left[key], right[key]),
    );
  const moved = FRONTEND_MAP_ENTRIES.some(
    (name) => entries[name] && stock[name] && !same(entries[name], stock[name]),
  );
  const fits = (names) =>
    names.every(
      (name) =>
        !entries[name] || !placed[name] || same(entries[name], placed[name]),
    );
  const differs = [
    ...(fits(MINIMAP_SMALL_COMPONENTS) ? [] : ["minimap"]),
    ...(fits(MINIMAP_BIG_COMPONENTS) ? [] : ["bigmap"]),
  ];
  return { placement, moved, exact: !differs.length, differs };
}

/*
 * Быстрые положения — углы экрана с теми же полями, что у штатной мини-карты:
 * справа она стоит так, как слева стоит у Rockstar, сверху — как снизу.
 */
export const MINIMAP_POSITION_PRESETS = Object.freeze([
  Object.freeze({ id: "stock", label: "Как в игре" }),
  Object.freeze({ id: "bottom-right", label: "Справа снизу" }),
  Object.freeze({ id: "top-left", label: "Слева сверху" }),
  Object.freeze({ id: "top-right", label: "Справа сверху" }),
  Object.freeze({ id: "bottom-center", label: "Снизу по центру" }),
]);

export function minimapPlacementPreset(
  placement,
  id,
  stock = MINIMAP_FRONTEND_STOCK,
  screen = undefined,
) {
  const value = normalizeMinimapPlacement(placement);
  /* Поля — как у штатной карты на экране игры (`gameEntryRect`): справа
     зазор до края тот же, что у Rockstar слева, сверху — что снизу. */
  const stockRect = gameEntryRect(stock.minimap, screen);
  const sized = minimapScreenRect(
    { ...value, offsetX: 0, offsetY: 0 },
    stock,
    screen,
  );
  const width = sized.width;
  const height = sized.height;
  const stockLeft = stockRect.left;
  const stockBottom = stockRect.top + stockRect.height;
  const left = {
    stock: stockLeft,
    "top-left": stockLeft,
    "bottom-right": 1 - stockLeft - width,
    "top-right": 1 - stockLeft - width,
    "bottom-center": 0.5 - width / 2,
  }[id];
  const top = {
    stock: stockBottom - height,
    "bottom-right": stockBottom - height,
    "bottom-center": stockBottom - height,
    "top-left": 1 - stockBottom,
    "top-right": 1 - stockBottom,
  }[id];
  if (left === undefined || top === undefined) return value;
  if (id === "stock")
    return normalizeMinimapPlacement({ ...value, offsetX: 0, offsetY: 0 });
  return minimapOffsetForRect(value, { left, top }, stock, screen);
}

/*
 * ---------------------------------------------------------------------------
 * Рамка карты: размытие вокруг неё и обводка.
 * ---------------------------------------------------------------------------
 *
 * Размытие — не часть minimap.gfx. Игра размывает кадр под картой и ореолом
 * вокруг неё по маске: текстуры `radarmasksm` (малая карта, 512×256) и
 * `radarmasklg` (развёрнутая, 512×512) в `x64/textures/graphics.ytd`. Серый
 * прямоугольник маски — сама карта, мягкий ореол вокруг — то самое размытие
 * за краем. Чёрная маска — размытия нет, край карты чёткий; так его и
 * убирают руками, подменяя текстуру пустой картинкой.
 *
 * По умолчанию размытие убрано (просьба пользователя, 2026-09-20): чёткая
 * карта — то, ради чего мини-карту и правят. «Как в игре» текстуру не трогает
 * вовсе.
 *
 * Обводка — четыре линии снаружи радара, каждую сторону можно выключить:
 * полосы HP по верхнему краю сами закрывают карту сверху, и линия над ними
 * лишняя. Толщина — в единицах предпросмотра (360 на ширину радара), как у
 * толщины полос и кегля цифр.
 */
export const MINIMAP_BLUR_MODES = Object.freeze(["none", "game"]);

export const MINIMAP_BLUR_TEXTURES = Object.freeze([
  "radarmasksm",
  "radarmasklg",
]);

export const MINIMAP_OUTLINE_LIMITS = Object.freeze({
  width: Object.freeze([1, 8]),
  opacity: Object.freeze([10, 100]),
});

export const DEFAULT_MINIMAP_FRAME = Object.freeze({
  blur: "none",
  outline: Object.freeze({
    enabled: false,
    color: "#ffffff",
    width: 2,
    opacity: 100,
    top: true,
    right: true,
    bottom: true,
    left: true,
  }),
});

export function normalizeMinimapFrame(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const outline =
    source.outline && typeof source.outline === "object" ? source.outline : {};
  const fallback = DEFAULT_MINIMAP_FRAME.outline;
  return {
    blur: MINIMAP_BLUR_MODES.includes(source.blur)
      ? source.blur
      : DEFAULT_MINIMAP_FRAME.blur,
    outline: {
      enabled: outline.enabled === true,
      color: /^#[0-9a-f]{6}$/i.test(String(outline.color || ""))
        ? String(outline.color).toLowerCase()
        : fallback.color,
      width: rounded(
        clamp(
          outline.width,
          MINIMAP_OUTLINE_LIMITS.width[0],
          MINIMAP_OUTLINE_LIMITS.width[1],
          fallback.width,
        ),
        2,
      ),
      opacity: Math.round(
        clamp(
          outline.opacity,
          MINIMAP_OUTLINE_LIMITS.opacity[0],
          MINIMAP_OUTLINE_LIMITS.opacity[1],
          fallback.opacity,
        ),
      ),
      ...Object.fromEntries(
        MINIMAP_FRAME_SIDES.map((side) => [side, outline[side] !== false]),
      ),
    },
  };
}

/** Линии обводки карты в точках сцены. Пусто — обводки нет. */
export function minimapOutlineRects(frame, radar = MINIMAP_RADAR, scale = 1) {
  const { outline } = normalizeMinimapFrame(frame);
  if (!outline.enabled) return [];
  return minimapFrameRects(
    radar,
    minimapUnitsToScene(outline.width) * scale,
    outline,
    "outside",
  );
}

/*
 * ---------------------------------------------------------------------------
 * Дальность обзора радара.
 * ---------------------------------------------------------------------------
 *
 * Насколько далеко видит мини-карта, задаёт не minimap.gfx, а таблица
 * ступеней `common/data/ui/mapzoomdata.meta`: пешком игра ставит радар на
 * ступень ZOOM_LEVEL_4, в машине — на ZOOM_LEVEL_3 (какая ступень за что
 * отвечает — `@modovik/vector-map/mapzoom.js`). Моды сообщества «Масштаб
 * мини-карты x0.25 … x0.75» — та же таблица с умноженной пешей ступенью.
 *
 * В проекте хранится множитель штатного масштаба: 1 — как в игре, 0.5 —
 * карта вдвое дальше, то есть видно вдвое больше города. Ниже 0.25 сообщество
 * не ходит: улицы сливаются, значки налезают друг на друга.
 */
export const MINIMAP_ZOOM_RANGE = Object.freeze({
  min: 0.25,
  max: 1,
  step: 0.05,
});
export const MINIMAP_ZOOM_STATES = Object.freeze(["onFoot", "inVehicle"]);
export const DEFAULT_MINIMAP_ZOOM = Object.freeze({ onFoot: 1, inVehicle: 1 });

export function normalizeMinimapZoom(input) {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(
    MINIMAP_ZOOM_STATES.map((state) => [
      state,
      rounded(
        clamp(
          source[state],
          MINIMAP_ZOOM_RANGE.min,
          MINIMAP_ZOOM_RANGE.max,
          DEFAULT_MINIMAP_ZOOM[state],
        ),
        2,
      ),
    ]),
  );
}

/** Дальность меняет игру, только когда хоть одна ступень не штатная. */
export function minimapZoomActive(zoom) {
  const normalized = normalizeMinimapZoom(zoom);
  return MINIMAP_ZOOM_STATES.some((state) => normalized[state] !== 1);
}

/*
 * ---------------------------------------------------------------------------
 * Проект мини-карты: значения по умолчанию и приведение к схеме.
 * ---------------------------------------------------------------------------
 */

export const MINIMAP_MAP_ASPECTS = Object.freeze({
  "180:131": 180 / 131,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "5:4": 5 / 4,
  "5:3": 5 / 3,
  "3:2": 3 / 2,
});

/* Формы экрана — таблица `GAME_SCREEN_FORMS` (`game-screen.js`): те же девять, что в меню игры. */
export const MINIMAP_SCREEN_ASPECTS = Object.freeze(
  Object.fromEntries(GAME_SCREEN_FORMS.map((form) => [form.name, form.ratio])),
);

export const MINIMAP_VITALS_LAYOUT_IDS = Object.freeze([
  "independent",
  "under-map",
  "bottom-row",
  "top-row",
  "bottom-stack",
  "top-stack",
  "left-vertical",
  "right-vertical",
  "left-split",
  "right-split",
]);

export const MINIMAP_HEALTH_ICON_PRESETS = Object.freeze([
  "heart",
  "cross",
  "pulse",
]);
export const MINIMAP_ARMOR_ICON_PRESETS = Object.freeze([
  "shield",
  "shield-check",
  "badge",
]);

/*
 * Значок HP или брони — квадрат в точках сцены.
 *
 * Размер записан в единицах редактора (360 на ширину радара), как и кегль
 * цифр: человек видит их в одной шкале. Доли радара по ширине и высоте
 * разные, поэтому квадрат хранится двумя числами, а считается из одного.
 */
export const MINIMAP_ICON_SIZE_LIMITS = Object.freeze([2, 48]);
export const MINIMAP_DEFAULT_ICON_SIZE = 15;

export function minimapIconWidgetSize(size) {
  const points = minimapUnitsToScene(
    clamp(
      size,
      MINIMAP_ICON_SIZE_LIMITS[0],
      MINIMAP_ICON_SIZE_LIMITS[1],
      MINIMAP_DEFAULT_ICON_SIZE,
    ),
  );
  /* Округление держит приведение идемпотентным: доли считаются из размера, а
     размер обратно из долей, и без него пара пересохранений уводила бы
     последние знаки. */
  return {
    width: rounded(points / MINIMAP_RADAR.width),
    height: rounded(points / MINIMAP_RADAR.height),
  };
}

/** Сторона значка в единицах редактора — по меньшей стороне его коробки. */
export function minimapIconSizeUnits(widget) {
  const points = Math.min(
    (Number(widget?.width) || 0) * MINIMAP_RADAR.width,
    (Number(widget?.height) || 0) * MINIMAP_RADAR.height,
  );
  return (points * MINIMAP_EDITOR_UNITS) / MINIMAP_RADAR.width;
}

/**
 * Коробка значка на сцене — квадрат по меньшей стороне элемента.
 *
 * Элемент хранится долями радара, а они по ширине и высоте разные: стоит
 * сохранённым числам разойтись (старый проект, чужой код), и значок
 * растянулся бы в прямоугольник. Здесь он всегда квадрат.
 */
export function minimapIconRect(widget) {
  const points = Math.min(
    (Number(widget?.width) || 0) * MINIMAP_RADAR.width,
    (Number(widget?.height) || 0) * MINIMAP_RADAR.height,
  );
  return {
    x: Number(widget?.x) || 0,
    y: Number(widget?.y) || 0,
    width: points / MINIMAP_RADAR.width,
    height: points / MINIMAP_RADAR.height,
  };
}

/*
 * Коробка цифр — не настройка, а следствие кегля.
 *
 * Поле цифр в minimap.gfx игра рисует шрифтом высотой `numberSize`, и его
 * ширины хватает на три знака. Раньше коробка была отдельным размером
 * элемента: в редакторе число стояло по её центру, а в игре прижималось к
 * правому краю, и одна и та же работа выглядела по-разному. Теперь коробка
 * считается из кегля, число стоит по центру и там, и там, а человек двигает
 * сами цифры, а не невидимый прямоугольник вокруг них.
 */
export const MINIMAP_NUMBER_SIZE_LIMITS = Object.freeze([2, 40]);
export const MINIMAP_DEFAULT_NUMBER_SIZE = 13;
export const MINIMAP_NUMBER_BOX = Object.freeze({ width: 2.4, height: 1.25 });

export function minimapNumberWidgetSize(numberSize) {
  const points = minimapUnitsToScene(
    clamp(
      numberSize,
      MINIMAP_NUMBER_SIZE_LIMITS[0],
      MINIMAP_NUMBER_SIZE_LIMITS[1],
      MINIMAP_DEFAULT_NUMBER_SIZE,
    ),
  );
  return {
    width: (points * MINIMAP_NUMBER_BOX.width) / MINIMAP_RADAR.width,
    height: (points * MINIMAP_NUMBER_BOX.height) / MINIMAP_RADAR.height,
  };
}

const DEFAULT_ICON_BOX = minimapIconWidgetSize(MINIMAP_DEFAULT_ICON_SIZE);
const DEFAULT_NUMBER_BOX = minimapNumberWidgetSize(MINIMAP_DEFAULT_NUMBER_SIZE);

/*
 * Новая мини-карта — вид самой игры: полосы под радаром на штатных местах.
 * Цифры и значки выключены; их место по умолчанию — у нижнего края радара
 * над полосами, там же, куда их ставит раскладка «Под картой». Значок стоит
 * слева от своей цифры — так их клали прежние схемы одной коробкой.
 */
const WIDGET_DEFAULTS = Object.freeze({
  healthBar: Object.freeze({
    x: MINIMAP_STOCK_BARS.healthBar.x,
    y: MINIMAP_STOCK_BARS.healthBar.y,
    width: MINIMAP_STOCK_BARS.healthBar.width,
    height: MINIMAP_STOCK_BARS.healthBar.height,
    zIndex: 8,
    visible: true,
  }),
  armorBar: Object.freeze({
    x: MINIMAP_STOCK_BARS.armorBar.x,
    y: MINIMAP_STOCK_BARS.armorBar.y,
    width: MINIMAP_STOCK_BARS.armorBar.width,
    height: MINIMAP_STOCK_BARS.armorBar.height,
    zIndex: 8,
    visible: true,
  }),
  healthNumber: Object.freeze({
    x: 0.2,
    y: 0.9475,
    width: DEFAULT_NUMBER_BOX.width,
    height: DEFAULT_NUMBER_BOX.height,
    zIndex: 10,
    visible: false,
  }),
  armorNumber: Object.freeze({
    x: 0.68,
    y: 0.9475,
    width: DEFAULT_NUMBER_BOX.width,
    height: DEFAULT_NUMBER_BOX.height,
    zIndex: 10,
    visible: false,
  }),
  /* Значок — слева от своей цифры, вплотную: так его клали прежние схемы,
     когда значок и число делили одну коробку. */
  healthIcon: Object.freeze({
    x: 0.2 - DEFAULT_NUMBER_BOX.width / 2 - DEFAULT_ICON_BOX.width / 2,
    y: 0.9475,
    width: DEFAULT_ICON_BOX.width,
    height: DEFAULT_ICON_BOX.height,
    zIndex: 11,
    visible: false,
  }),
  armorIcon: Object.freeze({
    x: 0.68 - DEFAULT_NUMBER_BOX.width / 2 - DEFAULT_ICON_BOX.width / 2,
    y: 0.9475,
    width: DEFAULT_ICON_BOX.width,
    height: DEFAULT_ICON_BOX.height,
    zIndex: 11,
    visible: false,
  }),
  damageOverlay: Object.freeze({
    x: 0.5,
    y: 0.5,
    width: 1,
    height: 1,
    zIndex: 6,
    visible: true,
  }),
  playerTag: Object.freeze({
    x: 0.5,
    y: 1.03,
    width: 0.32,
    height: 0.06,
    zIndex: 10,
    visible: false,
  }),
});

export const MINIMAP_WIDGET_IDS = Object.freeze(Object.keys(WIDGET_DEFAULTS));

/* Вылетающие цифры: кегль в единицах редактора и время полёта. */
export const MINIMAP_DAMAGE_NUMBER_LIMITS = Object.freeze({
  size: Object.freeze([2, 48]),
  durationMs: Object.freeze([300, 3000]),
});

/*
 * Как отнимается HP на мини-карте (задача 15 ТЗ 10.10.2026, вечер).
 *
 *  • `lossMode`: «game» — цифры меняются сразу, вместе с полосой игры;
 *    «countdown» — цифры считают вниз до нового значения со скоростью
 *    `lossSpeed` (единиц в секунду): 100 брони тают до нуля, потом HP;
 *  • `lossDisplay`: «separate» — у HP и у брони своя цифра; «combined» — одна
 *    цифра на месте цифр HP: пока есть броня — броня, потом HP;
 *  • `floatStyle`: как вылетает цифра урона (`damageNumbers`) — вверх, вниз,
 *    вспышкой на месте или в сторону.
 *
 * Шрифт цифр (`numberFont`) — один из двух, что minimap.gfx игры уже
 * подключает: «cond» — узкий цифровой HUD (`$Font2_cond`), «regular» —
 * обычный (`$Font2`). Чужих шрифтов в фильм не приносим.
 */
export const MINIMAP_LOSS_MODES = Object.freeze(["game", "countdown"]);
export const MINIMAP_LOSS_DISPLAYS = Object.freeze(["separate", "combined"]);
export const MINIMAP_LOSS_SPEEDS = Object.freeze({
  fast: 150,
  normal: 75,
  slow: 35,
});
export const MINIMAP_FLOAT_STYLES = Object.freeze([
  "rise",
  "fall",
  "pop",
  "side",
]);
export const MINIMAP_NUMBER_FONTS = Object.freeze(["cond", "regular"]);
/* Какая полоса стоит у края карты в раскладках «в две строки» и «в два
   столбика»: та, что у края, не оставляет зазора, когда другая пуста. */
export const MINIMAP_VITALS_EDGES = Object.freeze(["health", "armor"]);

export const MINIMAP_TRACK_MODES = Object.freeze(["game", "custom"]);

export const MINIMAP_BAR_STYLE_LIMITS = Object.freeze({
  barOpacity: Object.freeze([10, 100]),
  trackOpacity: Object.freeze([0, 100]),
  barOutlineWidth: Object.freeze([1, 6]),
});

/* Два цвета готового вида у порогов по умолчанию — тона цвета порога. */
export const MINIMAP_TIER_FILL_COLORS = Object.freeze({
  healthMid: Object.freeze(["#6b5410", "#ffe58a"]),
  healthLow: Object.freeze(["#5e1010", "#ff8d8d"]),
  armorMid: Object.freeze(["#10306b", "#8ab8ff"]),
  armorLow: Object.freeze(["#3d1466", "#d9a8ff"]),
});

export const DEFAULT_MINIMAP_EFFECTS = Object.freeze({
  healthColor: MINIMAP_GAME_COLORS.health,
  armorColor: MINIMAP_GAME_COLORS.armor,
  /* Заливка полос: 50% — фигура Rockstar, 100% — сплошной выбранный цвет. */
  barOpacity: MINIMAP_GAME_BAR_OPACITY,
  /* Подложка полос: «game» — всё, что под полосой рисует игра (лента под
     радаром, `bar_bg` и дорожка тоном цвета полосы); «custom» — одна плоская
     подложка своего цвета и прозрачности, и больше ничего. */
  trackMode: "game",
  trackColor: "#000000",
  trackOpacity: MINIMAP_GAME_TRACK_OPACITY,
  barOutline: false,
  barOutlineColor: "#ffffff",
  barOutlineWidth: 2,
  barBackground: "#111723",
  damageTrailColor: "#ff4d62",
  lowHealthColor: MINIMAP_GAME_COLORS.lowHealth,
  barThickness: 8,
  barRadius: 0,
  healthGradient: false,
  lowHealthPulse: false,
  lowHealthThreshold: 25,
  damageTrail: true,
  damageTrailDelayMs: 220,
  damageTrailDurationMs: 620,
  damageFlash: true,
  damageFlashStrength: 75,
  damageFlashDurationMs: 2100,
  damageAssetId: "",
  floatingHealthDamage: true,
  floatingArmorDamage: true,
  floatingHeal: true,
  /*
   * Вылетающие цифры урона (задача 8 ТЗ 10.10.2026): главный выключатель —
   * в игре их до сих пор не было, и прежние работы без него остаются как
   * были. Три выключателя выше решают, что вылетает: урон HP, урон брони,
   * лечение. Цвета, размер (единицы редактора) и длительность полёта.
   */
  damageNumbers: false,
  damageNumberColor: "#ff4d62",
  armorDamageNumberColor: "#97dcff",
  healNumberColor: "#7dff8a",
  damageNumberSize: 18,
  damageNumberDurationMs: 900,
  /* Как отнимается HP и чем написаны цифры (задача 15 ТЗ 10.10.2026). */
  floatStyle: "rise",
  lossMode: "game",
  lossDisplay: "separate",
  lossSpeed: "normal",
  numberFont: "cond",
  /*
   * Ступени полос (задача 8 ТЗ 10.10.2026): цвет полосы при 100 %, ниже
   * середины и ниже малого порога. Нижняя ступень HP — та, что у игры
   * (`lowHealthColor`, `lowHealthThreshold`).
   */
  healthTiers: false,
  healthMidThreshold: 50,
  healthMidColor: "#f2c94c",
  armorTiers: false,
  armorMidThreshold: 50,
  armorMidColor: "#5aa7ff",
  armorLowThreshold: 25,
  armorLowColor: "#b26bff",
  numberSize: MINIMAP_DEFAULT_NUMBER_SIZE,
  healthNumberColor: "#ffffff",
  armorNumberColor: "#97dcff",
  healthIconColor: "#ffffff",
  armorIconColor: "#97dcff",
  barIcons: false,
  barIconColor: "#ffffff",
  healthIconAssetId: "",
  armorIconAssetId: "",
  healthIconPreset: "heart",
  armorIconPreset: "shield",
  /*
   * Значки HP и брони как шкалы (10.11.2026, `vital-icons.js`): «image» — прежний значок-картинка; иначе вид шкалы (кольцо, сегменты, сердце и щит, капсула,
   * точки, дуга), которая убывает с запасом. Толщина кольца и дуги — доля значка; «цвет по уровню» красит шкалу по порогам HP и брони (`healthMid…`,
   * `lowHealthThreshold`, `armorMid…`, `armorLow…`); мигание — при запасе не выше малого порога; подложка — пустая шкала.
   */
  healthIconStyle: MINIMAP_VITAL_STYLE_IMAGE,
  armorIconStyle: MINIMAP_VITAL_STYLE_IMAGE,
  vitalThickness: MINIMAP_VITAL_THICKNESS.default,
  vitalLevelColours: false,
  vitalBlinkLow: false,
  vitalTrackColor: "#ffffff",
  vitalTrackOpacity: 22,
  /*
   * Плашка с кольцами HP и брони (21.11.2026, `vital-plate.js`): «броню показывать, только когда она есть» (значок, цифры и её часть плашки уходят при нуле и
   * возвращаются с бронёй), цвет пустой части шкалы значка и плавное убывание заливки шкалы (значение догоняет запас, а не скачет по кадрам).
   */
  armourOnlyWhenPresent: false,
  /* Цвет пустой части шкалы значка нынешней схемы: у проекта без поля — цвет его прежнего поля `vitalTrackColor` (прежний вид не меняется); «Плашка HP» ставит серый явно. */
  vitalTrackColour: "#ffffff",
  /* Числа HP и брони по центру своего поля (21.11.2026): у прежних раскладок они прижаты вправо, как в beta.108 (вид выпущенных проектов не меняется); центр — у новых раскладок «Плашка HP» и «Сердце и жилет». */
  numbersCentred: false,
  vitalFillSmooth: false,
  /* Скорость анимации индикатора и демонстрации урона, процентов: 100 — как задумано, 200 — вдвое быстрее (заливка догоняет запас, плашка сжимается, ход демонстрации). */
  vitalAnimSpeed: 100,
  playerMarkerMode: "stock",
  playerMarkerColor: "#ffffff",
  playerMarkerScale: 1,
  playerMarkerAssetId: "",
  /*
   * Метки других людей на радаре (задача 1 ТЗ 17.10.2026): кружки игроков и
   * людей — символы `MINIMAP_OTHER_PEOPLE_SYMBOLS`. «Как в игре», своя
   * картинка (силуэт — цвет даёт игра, у каждого игрока свой) или скрыть;
   * размер — множитель штатного кружка 13 точек.
   */
  othersMode: "stock",
  othersScale: 1,
  othersAssetId: "",
  /* Буква N стоит на мини-карте игры всегда (`radar_north`), и выключатель
     убирает её из игры, а не только из предпросмотра. */
  showNorth: true,
  font: "stock",
  playerTag: "",
  /* Заливка полос: `mode: "solid"` — ровный цвет игры (`healthColor`). */
  healthFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_FILL_DEFAULT_COLORS.health),
  ),
  armorFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_FILL_DEFAULT_COLORS.armor),
  ),
  /*
   * Вид порогов (задача 8 ТЗ 10.10.2026): у полосы ниже середины и при малом
   * запасе своя заливка из той же галереи — ровный цвет порога
   * (`healthMidColor`, `lowHealthColor`, `armorMidColor`, `armorLowColor`)
   * или готовый вид со своими цветами. Своё видео — только у полной полосы.
   */
  healthMidFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_TIER_FILL_COLORS.healthMid),
  ),
  healthLowFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_TIER_FILL_COLORS.healthLow),
  ),
  armorMidFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_TIER_FILL_COLORS.armorMid),
  ),
  armorLowFill: Object.freeze(
    normalizeMinimapFill(null, MINIMAP_TIER_FILL_COLORS.armorLow),
  ),
  /*
   * Вспышка урона (задача 8): цвет — как в игре или свой (у своей картинки
   * урона — оттенок), размер — доля радара вокруг его середины.
   */
  damageColorMode: "game",
  damageColor: "#ff3b3b",
  damageScale: 100,
  /*
   * Своя картинка урона на радаре (ТЗ 05.11.2026): «Заполнить» — как раньше,
   * по середине с обрезкой краёв под пропорции радара; «Целиком» — вся
   * картинка внутри радара, без обрезки. Масштаб — доля от этого вида,
   * сдвиг — середина картинки от середины радара в процентах полуширины и
   * полувысоты. Место считает `minimapDamageImageBox` — одно и в окне, и в игре.
   */
  damageImageFit: "cover",
  damageImageZoom: 100,
  damageImageX: 0,
  damageImageY: 0,
});

export const MINIMAP_DAMAGE_SCALE_LIMITS = Object.freeze([10, 100]);
export const MINIMAP_DAMAGE_IMAGE_LIMITS = Object.freeze({
  zoom: Object.freeze([25, 400]),
  offset: Object.freeze([-100, 100]),
});

/**
 * Место своей картинки урона на радаре: `{ left, top, width, height }` —
 * доли ширины и высоты радара (могут выходить за 0…1: что за краем, не видно).
 * `imageWidth`/`imageHeight` — размер картинки, `aspect` — ширина радара к высоте.
 */
export function minimapDamageImageBox(
  effects,
  imageWidth,
  imageHeight,
  aspect = MINIMAP_RADAR_ASPECT,
) {
  const ratio =
    imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : aspect;
  const wider = ratio > aspect;
  const contain = effects?.damageImageFit === "contain";
  /* В единицах высоты радара: радар — aspect × 1. */
  const fitsByWidth = contain ? wider : !wider;
  const baseWidth = fitsByWidth ? aspect : ratio;
  const baseHeight = fitsByWidth ? aspect / ratio : 1;
  const zoom =
    clamp(effects?.damageImageZoom, ...MINIMAP_DAMAGE_IMAGE_LIMITS.zoom, 100) /
    100;
  const shiftX =
    clamp(effects?.damageImageX, ...MINIMAP_DAMAGE_IMAGE_LIMITS.offset, 0) /
    200;
  const shiftY =
    clamp(effects?.damageImageY, ...MINIMAP_DAMAGE_IMAGE_LIMITS.offset, 0) /
    200;
  const width = (baseWidth * zoom) / aspect;
  const height = baseHeight * zoom;
  return {
    left: 0.5 + shiftX - width / 2,
    top: 0.5 + shiftY - height / 2,
    width,
    height,
  };
}

/*
 * Метки других людей (задача 1 ТЗ 17.10.2026). Чужих игроков и людей игра
 * ставит на радар кружком `radar_level` (номер значка 1), а выше и ниже вас —
 * кружками со стрелкой `radar_higher` / `radar_lower`; в помещении —
 * `radar_level_inside`. Цвет кружку даёт игра (у каждого игрока свой), он
 * красит экземпляр снаружи, поэтому своя картинка — белый силуэт. Тем же
 * кружком игра метит и цели заданий, а на РП-серверах метки игроков ставит
 * скрипт сервера номером значка — обычно тем же кружком; свой спрайт сервера
 * (стрим своей мини-карты, рисунок поверх экрана) файлом игры не меняется.
 */
export const MINIMAP_OTHER_PEOPLE_SYMBOLS = Object.freeze([
  "radar_level",
  "radar_higher",
  "radar_lower",
  "radar_level_inside",
]);
export const MINIMAP_OTHERS_MODES = Object.freeze([
  "stock",
  "custom",
  "hidden",
]);
export const MINIMAP_OTHERS_SCALE_LIMITS = Object.freeze([0.1, 3]);
/** Сторона штатного кружка человека (`radar_level`), в точках сцены. */
export const MINIMAP_OTHERS_STOCK_SIDE = 13;

/** Меняет ли проект метки других людей в игре. */
export const minimapOthersChanged = (effects) =>
  effects.othersMode !== "stock" ||
  Math.abs(Number(effects.othersScale) - 1) > 1e-6;

/*
 * Пороги полосы и их заливки: `full` — полная, `mid` — ниже середины, `low`
 * — малый запас. У HP малый порог есть всегда (он у игры), середина — со
 * ступенями; у брони оба — со ступенями. Неактивный порог — `null`.
 */
export function minimapTierFills(effects, side) {
  if (side === "health")
    return {
      full: effects.healthFill,
      mid: effects.healthTiers ? effects.healthMidFill : null,
      low: effects.healthLowFill,
    };
  return {
    full: effects.armorFill,
    mid: effects.armorTiers ? effects.armorMidFill : null,
    low: effects.armorTiers ? effects.armorLowFill : null,
  };
}

/** Порог полосы при этом запасе (0…100): «full», «mid» или «low». */
export function minimapTierOf(effects, side, percent) {
  if (side === "health") {
    if (percent <= effects.lowHealthThreshold) return "low";
    if (effects.healthTiers && percent < effects.healthMidThreshold)
      return "mid";
    return "full";
  }
  if (!effects.armorTiers) return "full";
  if (percent < effects.armorLowThreshold) return "low";
  if (percent < effects.armorMidThreshold) return "mid";
  return "full";
}

/** Какой-нибудь порог полосы залит готовым видом или видео. */
export const minimapBarAnimated = (effects, side) =>
  Object.values(minimapTierFills(effects, side)).some((fill) =>
    minimapFillActive(fill),
  );

export function createDefaultMinimapLayout() {
  return {
    layoutSchemaVersion: MINIMAP_SCHEMA_VERSION,
    targetViewport: {
      source: "manual",
      renderWidth: 1920,
      renderHeight: 1080,
      aspect: "16:9",
      scalingMode: "native",
    },
    layout: {
      safeZone: { mode: "inherit", insetX: 0, insetY: 0 },
      map: { ...DEFAULT_MINIMAP_PLACEMENT },
      widgets: Object.fromEntries(
        Object.entries(WIDGET_DEFAULTS).map(([key, value]) => [
          key,
          {
            visible: value.visible,
            locked: false,
            anchorTo: "map",
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            rotation: 0,
            opacity: 1,
            zIndex: value.zIndex,
          },
        ]),
      ),
      vitalsLayout: "under-map",
      vitalsEdge: "health",
      vitalsDetached: false,
      vitalsAway: null,
      /* Места индикатора HP на увеличенном радаре (21.11.2026, `big-screen.js`): по умолчанию их нет — как в обычной мини-карте. */
      bigScreen: normalizeMinimapBigScreen(),
    },
    frame: normalizeMinimapFrame(),
    zoom: { ...DEFAULT_MINIMAP_ZOOM },
    effects: { ...DEFAULT_MINIMAP_EFFECTS },
    gps: normalizeMinimapGps(),
    /* Свои надписи и картинки на карте (задача 1 ТЗ 17.10.2026). */
    overlays: [],
    /* Слова расстояния вместо «км» и «м» (задача 1 ТЗ 17.10.2026). */
    distance: normalizeMinimapDistance(),
    /* Плашка под HP и бронёй (21.11.2026): по умолчанию её нет. */
    vitalPlate: normalizeMinimapVitalPlate(),
  };
}

/*
 * Какая полоса у края в проекте, сохранённом до `vitalsEdge`: по тому, где
 * полосы стоят. В раскладке «Справа в два столбика» у края та, что правее, и
 * так далее; в остальных — HP.
 */
function inferVitalsEdge(vitalsLayout, widgets) {
  const health = widgets?.healthBar || {};
  const armor = widgets?.armorBar || {};
  const outer = {
    "right-vertical": () => Number(health.x) > Number(armor.x),
    "left-vertical": () => Number(health.x) < Number(armor.x),
    "top-stack": () => Number(health.y) < Number(armor.y),
    "bottom-stack": () => Number(health.y) > Number(armor.y),
  }[vitalsLayout];
  if (!outer) return "health";
  return outer() ? "health" : "armor";
}

const text = (value, fallback, values) => {
  const candidate = String(value ?? "");
  return values.includes(candidate) ? candidate : fallback;
};

const hexColor = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value || ""))
    ? String(value).toLowerCase()
    : fallback;

function normalizeWidget(input, fallback, range = MINIMAP_STOCK_WIDGET_RANGE) {
  return {
    visible:
      typeof input?.visible === "boolean" ? input.visible : fallback.visible,
    locked: Boolean(input?.locked),
    anchorTo: "map",
    x: clamp(input?.x, range[0], range[1], fallback.x),
    y: clamp(input?.y, range[0], range[1], fallback.y),
    width: clamp(input?.width, 0.01, 2, fallback.width),
    height: clamp(input?.height, 0.005, 2, fallback.height),
    rotation: clamp(input?.rotation, -180, 180, 0),
    opacity: clamp(input?.opacity, 0, 1, 1),
    zIndex: Math.round(clamp(input?.zIndex, 0, 100, fallback.zIndex)),
  };
}

/* Позиции раскладок третьей схемы — ими приводятся проекты старше неё. */
const LEGACY_VITALS_POSITIONS = Object.freeze({
  "bottom-row": {
    healthBar: [0.25, 0.975, 0.5, 0.05, 0],
    armorBar: [0.75, 0.975, 0.5, 0.05, 0],
    healthNumber: [0.16, 0.895, 0.16, 0.065, 0],
    armorNumber: [0.64, 0.895, 0.16, 0.065, 0],
  },
  "top-row": {
    healthBar: [0.25, 0.025, 0.5, 0.05, 0],
    armorBar: [0.75, 0.025, 0.5, 0.05, 0],
    healthNumber: [0.16, 0.105, 0.16, 0.065, 0],
    armorNumber: [0.64, 0.105, 0.16, 0.065, 0],
  },
  "bottom-stack": {
    healthBar: [0.5, 0.925, 1, 0.05, 0],
    armorBar: [0.5, 0.975, 1, 0.05, 0],
    healthNumber: [0.88, 0.915, 0.15, 0.06, 0],
    armorNumber: [0.88, 0.965, 0.15, 0.06, 0],
  },
  "top-stack": {
    healthBar: [0.5, 0.025, 1, 0.05, 0],
    armorBar: [0.5, 0.075, 1, 0.05, 0],
    healthNumber: [0.88, 0.035, 0.15, 0.06, 0],
    armorNumber: [0.88, 0.085, 0.15, 0.06, 0],
  },
  "left-vertical": {
    healthBar: [0.025, 0.5, 1, 0.05, -90],
    armorBar: [0.075, 0.5, 1, 0.05, -90],
    healthNumber: [0.12, 0.18, 0.15, 0.06, 0],
    armorNumber: [0.12, 0.82, 0.15, 0.06, 0],
  },
  "right-vertical": {
    healthBar: [0.925, 0.5, 1, 0.05, -90],
    armorBar: [0.975, 0.5, 1, 0.05, -90],
    healthNumber: [0.88, 0.18, 0.15, 0.06, 0],
    armorNumber: [0.88, 0.82, 0.15, 0.06, 0],
  },
  "left-split": {
    healthBar: [0.025, 0.25, 0.5, 0.05, -90],
    armorBar: [0.025, 0.75, 0.5, 0.05, -90],
    healthNumber: [0.12, 0.25, 0.15, 0.06, 0],
    armorNumber: [0.12, 0.75, 0.15, 0.06, 0],
  },
  "right-split": {
    healthBar: [0.975, 0.25, 0.5, 0.05, -90],
    armorBar: [0.975, 0.75, 0.5, 0.05, -90],
    healthNumber: [0.88, 0.25, 0.15, 0.06, 0],
    armorNumber: [0.88, 0.75, 0.15, 0.06, 0],
  },
});

const COMPACT_RADAR_SCHEMA_VERSION = 3;
const BAR_ICONS_CHOICE_SCHEMA_VERSION = 4;
const SCENE_GEOMETRY_SCHEMA_VERSION = 5;
const GAME_LOOK_SCHEMA_VERSION = 6;
const SPLIT_INDICATORS_SCHEMA_VERSION = 7;

/*
 * Значок и цифра из одной коробки — в два элемента.
 *
 * До седьмой схемы `healthNumber` держал и число, и значок, а `indicatorMode`
 * решал, что из этого рисовать: «number», «icon» или «both». При «both»
 * значок занимал квадрат у левого края коробки, число — остаток. Здесь та же
 * арифметика повторена один раз, чтобы прежние проекты открылись с теми же
 * значками на тех же местах, и больше нигде не жила.
 */
function splitLegacyIndicators({ mode, widgets, showNumbers }) {
  const result = {};
  for (const [numberKey, iconKey] of [
    ["healthNumber", "healthIcon"],
    ["armorNumber", "armorIcon"],
  ]) {
    const box = normalizeWidget(widgets?.[numberKey], {
      ...WIDGET_DEFAULTS[numberKey],
      visible: showNumbers[numberKey],
    });
    const size = Math.min(
      box.height * MINIMAP_RADAR.height,
      box.width * MINIMAP_RADAR.width * 0.42,
    );
    const iconWidth = size / MINIMAP_RADAR.width;
    /* При «значок + цифры» значок занимал квадрат у левого края коробки, а
       число — её остаток; иначе оба стояли по центру коробки. */
    const iconX =
      mode === "both" ? box.x - box.width / 2 + iconWidth / 2 : box.x;
    result[iconKey] = {
      ...widgets?.[iconKey],
      x: iconX,
      y: box.y,
      width: iconWidth,
      height: size / MINIMAP_RADAR.height,
      visible: box.visible && (mode === "icon" || mode === "both"),
      locked: box.locked,
    };
    result[numberKey] = {
      ...box,
      x:
        mode === "both"
          ? (iconX + iconWidth / 2 + box.x + box.width / 2) / 2
          : box.x,
      visible: box.visible && (mode === "number" || mode === "both"),
    };
  }
  return result;
}

const isVertical = (rotation) => {
  const angle = Math.abs(Number(rotation) || 0) % 180;
  return angle > 45 && angle < 135;
};

function detectScreenAspect(width, height) {
  const ratio = width / height;
  let best = "16:9";
  let distance = Infinity;
  for (const [name, value] of Object.entries(MINIMAP_SCREEN_ASPECTS)) {
    const gap = Math.abs(value - ratio);
    if (gap < distance) {
      best = name;
      distance = gap;
    }
  }
  return best;
}

/**
 * Проект мини-карты в текущей схеме.
 *
 * Принимает всё, что когда-либо сохраняли редакторы (плоские поля первых
 * версий, большую карту второй схемы, пропорцию 180:131 четвёртой), и
 * возвращает одну форму. Приведение идемпотентно: проект текущей схемы
 * проходит через него без изменений.
 *
 * Переход на шестую схему (2026-09-20):
 *  • заливка полос у прежних проектов остаётся сплошной — такой их собирал
 *    компилятор, и работа человека не должна побледнеть от обновления;
 *    новая мини-карта берёт штатные 50%;
 *  • рамки у прежних проектов нет: обводка выключена, размытие убрано.
 *
 * Переход на пятую схему (2026-09-16):
 *  • положение и размер карты сбрасываются к штатным — прежние числа
 *    пересчитывались так, что карта в игре уезжала, и выбрать их было
 *    нельзя: вкладку положения тогда убрали;
 *  • длина повёрнутых полос переводится в доли ширины радара (раньше полоса
 *    «во всю высоту» была длиннее самой карты);
 *  • размер стрелки игрока становится множителем штатной стрелки;
 *  • буква N — снова как в игре, видна.
 */
/*
 * Ступени полос (задача 8 ТЗ 10.10.2026): середина HP — выше малого порога
 * игры, у брони свой малый порог ниже её середины. Порог — «ниже стольких
 * процентов».
 *
 * «Цвет по запасу» снят (задача 15 ТЗ 10.10.2026, вечер, владелец: «мне
 * это вообще непонятно, функционал не особо работает, его лучше убрать»):
 * ступени всегда выключены, и прежняя работа со ступенями собирается без
 * них. Числа ступеней читаются по-прежнему — их держат старые коды работ.
 */
function normalizeTiers(effects) {
  const low = Math.round(
    clamp(
      effects.lowHealthThreshold,
      1,
      99,
      DEFAULT_MINIMAP_EFFECTS.lowHealthThreshold,
    ),
  );
  const armorLow = Math.round(
    clamp(
      effects.armorLowThreshold,
      1,
      98,
      DEFAULT_MINIMAP_EFFECTS.armorLowThreshold,
    ),
  );
  const above = (value, floor, fallback) =>
    Math.round(
      clamp(value, Math.min(99, floor + 1), 99, Math.max(floor + 1, fallback)),
    );
  return {
    healthTiers: false,
    healthMidThreshold: above(
      effects.healthMidThreshold,
      low,
      DEFAULT_MINIMAP_EFFECTS.healthMidThreshold,
    ),
    healthMidColor: hexColor(
      effects.healthMidColor,
      DEFAULT_MINIMAP_EFFECTS.healthMidColor,
    ),
    armorTiers: false,
    armorLowThreshold: armorLow,
    armorMidThreshold: above(
      effects.armorMidThreshold,
      armorLow,
      DEFAULT_MINIMAP_EFFECTS.armorMidThreshold,
    ),
    armorMidColor: hexColor(
      effects.armorMidColor,
      DEFAULT_MINIMAP_EFFECTS.armorMidColor,
    ),
    armorLowColor: hexColor(
      effects.armorLowColor,
      DEFAULT_MINIMAP_EFFECTS.armorLowColor,
    ),
  };
}

/**
 * Цвет полосы по ступени (предпросмотр и проверки): `side` — "health" или
 * "armor", `percent` — 0…100. Без ступеней — цвет полосы (у HP ниже малого
 * порога — цвет игры для малого HP).
 */
export function minimapTierColor(effects, side, percent) {
  if (side === "health") {
    if (percent <= effects.lowHealthThreshold) return effects.lowHealthColor;
    if (effects.healthTiers && percent < effects.healthMidThreshold)
      return effects.healthMidColor;
    return effects.healthColor;
  }
  if (effects.armorTiers) {
    if (percent < effects.armorLowThreshold) return effects.armorLowColor;
    if (percent < effects.armorMidThreshold) return effects.armorMidColor;
  }
  return effects.armorColor;
}

/** Пределы места элемента на большом радаре, доли самого большого радара (центр): за краем стоят полосы под радаром и значки у края. */
export const MINIMAP_BIG_PLACE_RANGE = Object.freeze([-0.5, 1.5]);

/**
 * Места элементов на большой карте, поставленные человеком: `{ <элемент>: { x, y } }` — центр в долях большого радара. Лишние ключи и не-числа
 * отбрасываются, числа зажимаются в `MINIMAP_BIG_PLACE_RANGE` и округляются до четырёх знаков.
 */
export function normalizeMinimapBigPlaces(input) {
  const source = input && typeof input === "object" ? input : {};
  const [low, high] = MINIMAP_BIG_PLACE_RANGE;
  const places = {};
  for (const id of MINIMAP_WIDGET_IDS) {
    const entry = source[id];
    if (!entry || typeof entry !== "object") continue;
    const x = Number(entry.x);
    const y = Number(entry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    places[id] = {
      x: Math.round(Math.min(high, Math.max(low, x)) * 10000) / 10000,
      y: Math.round(Math.min(high, Math.max(low, y)) * 10000) / 10000,
    };
  }
  return places;
}

const bigPlacesField = (input) => {
  const bigPlaces = normalizeMinimapBigPlaces(input);
  return Object.keys(bigPlaces).length ? { bigPlaces } : {};
};

export function normalizeMinimapLayout(config = {}) {
  const defaults = createDefaultMinimapLayout();
  const source = config && typeof config === "object" ? config : {};
  const storedSchema = Number(source.layoutSchemaVersion || 1);
  const viewport = source.targetViewport || {};
  const storedLayout =
    source.layout && typeof source.layout === "object" ? source.layout : {};
  const storedMap = storedLayout.map || {};
  const storedWidgets = storedLayout.widgets || {};
  const effects = source.effects || {};

  const legacyVitalsLayout = {
    "one-row": "bottom-row",
    "two-rows": "bottom-stack",
    vertical: "left-vertical",
    split: "bottom-row",
  }[storedLayout.vitalsLayout];
  const vitalsLayout = text(
    legacyVitalsLayout || storedLayout.vitalsLayout,
    defaults.layout.vitalsLayout,
    MINIMAP_VITALS_LAYOUT_IDS,
  );
  /* «HP отдельно от карты»: группа HP ходит по всему экрану, поэтому её центры не обрезаются по полям сцены. Отдельного
     режима нет: `vitalsScreen` проб 19.10.2026 читать незачем, у таких работ `vitalsDetached` уже стоит, а места лежат в
     том же ряду. Без выключателя HP при карте, и ряд прежний. */
  const vitalRange =
    storedLayout.vitalsDetached === true
      ? MINIMAP_SCREEN_WIDGET_RANGE
      : MINIMAP_STOCK_WIDGET_RANGE;
  const needsCompactMigration = storedSchema < COMPACT_RADAR_SCHEMA_VERSION;
  const migratedPositions =
    legacyVitalsLayout ||
    (needsCompactMigration && vitalsLayout !== "independent")
      ? LEGACY_VITALS_POSITIONS[vitalsLayout]
      : null;

  const numberSize = Math.round(
    clamp(
      effects.numberSize,
      MINIMAP_NUMBER_SIZE_LIMITS[0],
      MINIMAP_NUMBER_SIZE_LIMITS[1],
      DEFAULT_MINIMAP_EFFECTS.numberSize,
    ),
  );
  const numberBox = minimapNumberWidgetSize(numberSize);
  /* Прежний `indicatorMode` — единственное, что осталось от общей коробки:
     он решает, что было видно в проекте старой схемы. */
  const splitIndicators =
    storedSchema < SPLIT_INDICATORS_SCHEMA_VERSION
      ? splitLegacyIndicators({
          mode: text(effects.indicatorMode, "none", [
            "none",
            "number",
            "icon",
            "both",
          ]),
          widgets: storedWidgets,
          showNumbers: {
            healthNumber: Boolean(source.showHealthNumbers),
            armorNumber: Boolean(source.showArmorNumbers),
          },
        })
      : null;

  const widgets = Object.fromEntries(
    MINIMAP_WIDGET_IDS.map((key) => {
      const fallback = {
        ...WIDGET_DEFAULTS[key],
        visible:
          key === "healthNumber"
            ? Boolean(source.showHealthNumbers)
            : key === "armorNumber"
              ? Boolean(source.showArmorNumbers)
              : WIDGET_DEFAULTS[key].visible,
      };
      const legacy = migratedPositions?.[key];
      const stored = legacy
        ? {
            ...storedWidgets[key],
            x: legacy[0],
            y: legacy[1],
            width: legacy[2],
            height: legacy[3],
            rotation: legacy[4],
          }
        : splitIndicators?.[key] || storedWidgets[key];
      const widget = normalizeWidget(
        stored,
        fallback,
        MINIMAP_VITAL_GROUP.includes(key)
          ? vitalRange
          : MINIMAP_STOCK_WIDGET_RANGE,
      );
      if (
        storedSchema < SCENE_GEOMETRY_SCHEMA_VERSION &&
        isVertical(widget.rotation)
      )
        widget.width = clamp(
          (widget.width * MINIMAP_RADAR.height) / MINIMAP_RADAR.width,
          0.01,
          2,
          widget.width,
        );
      /* Коробка цифр считается из кегля, значок — всегда квадрат: размер у
         них один на обе доли радара, и хранить его двумя числами, которые
         могут разойтись, незачем. */
      if (key === "healthNumber" || key === "armorNumber")
        Object.assign(widget, numberBox);
      if (key === "healthIcon" || key === "armorIcon")
        Object.assign(
          widget,
          minimapIconWidgetSize(minimapIconSizeUnits(widget)),
        );
      return [key, widget];
    }),
  );

  const monitor = normalizeScreenResolution(viewport.monitor);
  const renderWidth = Math.round(
    clamp(viewport.renderWidth, 800, 7680, defaults.targetViewport.renderWidth),
  );
  const renderHeight = Math.round(
    clamp(
      viewport.renderHeight,
      600,
      4320,
      defaults.targetViewport.renderHeight,
    ),
  );

  const map =
    storedSchema < SCENE_GEOMETRY_SCHEMA_VERSION
      ? normalizeMinimapPlacement({
          transparentBackground: storedMap.transparentBackground,
        })
      : normalizeMinimapPlacement(storedMap);

  const storedMarkerScale =
    storedSchema < SCENE_GEOMETRY_SCHEMA_VERSION
      ? Number(effects.playerMarkerSize ?? 16) / 16
      : effects.playerMarkerScale;

  /* Работа, сохранённая, пока центры группы обрезались по полям сцены: разводим полосы один раз, дальше — как поставил человек. */
  if (
    storedLayout.vitalsDetached === true &&
    storedSchema < VITALS_APART_SCHEMA_VERSION
  )
    Object.assign(widgets, separateMinimapVitals(widgets, effects));

  /* Прежний цвет пустой части шкалы значка; новое поле `vitalTrackColour` без записи берёт его (прежний вид проекта не меняется). */
  const trackColour = hexColor(
    effects.vitalTrackColor,
    DEFAULT_MINIMAP_EFFECTS.vitalTrackColor,
  );

  return {
    layoutSchemaVersion: MINIMAP_SCHEMA_VERSION,
    targetViewport: {
      source: text(viewport.source, "manual", ["detected", "manual"]),
      renderWidth,
      renderHeight,
      aspect: text(
        viewport.aspect,
        detectScreenAspect(renderWidth, renderHeight),
        Object.keys(MINIMAP_SCREEN_ASPECTS),
      ),
      scalingMode: text(viewport.scalingMode, "native", [
        "native",
        "stretch",
        "letterbox",
      ]),
      /* «В игре у меня как здесь»: настройки игры расходятся с тем, что на экране у человека, — ставим под «Экран» окна. */
      ...(viewport.gameAspect === "screen" ? { gameAspect: "screen" } : {}),
      /* Разрешение монитора, указанное человеком (22.11.2026): для предпросмотра и растяжения; в фильм не попадает. Нет поля — экран берётся из игры, как раньше. */
      ...(monitor ? { monitor } : {}),
    },
    layout: {
      safeZone: { mode: "inherit", insetX: 0, insetY: 0 },
      map,
      widgets,
      vitalsLayout,
      vitalsEdge: MINIMAP_VITALS_EDGES.includes(storedLayout.vitalsEdge)
        ? storedLayout.vitalsEdge
        : inferVitalsEdge(vitalsLayout, widgets),
      /* HP отдельно от карты (задача 1 ТЗ 17.10.2026): включено — HP
         тянутся по всему экрану сами; `vitalsAway` — где они стояли, когда
         выключатель выключили, чтобы вернуть их туда же. */
      vitalsDetached: storedLayout.vitalsDetached === true,
      vitalsAway: separateOldAway(
        normalizeVitalsAway(storedLayout.vitalsAway),
        widgets,
        effects,
        storedSchema,
      ),
      /* «Большая карта» отдельно (владелец, 16.11.2026): места элементов на развёрнутом радаре, которые человек поставил сам; без записи — по правилу
         большой карты от малой. Ключ есть, только когда хоть одно место поставлено. */
      ...bigPlacesField(storedLayout.bigPlaces),
      /* Индикатор HP на увеличенном радаре (21.11.2026): свои места в долях экрана; без них — как в обычной мини-карте. Ключ есть всегда: пустой — «как в стандартной». */
      bigScreen: normalizeMinimapBigScreen(storedLayout.bigScreen),
    },
    frame: normalizeMinimapFrame(source.frame),
    zoom: normalizeMinimapZoom(source.zoom),
    gps: normalizeMinimapGps(source.gps),
    overlays: normalizeMinimapOverlays(source.overlays),
    distance: normalizeMinimapDistance(source.distance),
    vitalPlate: normalizeMinimapVitalPlate(source.vitalPlate),
    effects: {
      healthColor: hexColor(
        effects.healthColor || source.healthColor,
        DEFAULT_MINIMAP_EFFECTS.healthColor,
      ),
      armorColor: hexColor(
        effects.armorColor || source.armorColor,
        DEFAULT_MINIMAP_EFFECTS.armorColor,
      ),
      barOpacity: Math.round(
        clamp(
          storedSchema < GAME_LOOK_SCHEMA_VERSION ? 100 : effects.barOpacity,
          MINIMAP_BAR_STYLE_LIMITS.barOpacity[0],
          MINIMAP_BAR_STYLE_LIMITS.barOpacity[1],
          DEFAULT_MINIMAP_EFFECTS.barOpacity,
        ),
      ),
      trackMode: text(
        effects.trackMode,
        DEFAULT_MINIMAP_EFFECTS.trackMode,
        MINIMAP_TRACK_MODES,
      ),
      trackColor: hexColor(
        effects.trackColor,
        DEFAULT_MINIMAP_EFFECTS.trackColor,
      ),
      trackOpacity: Math.round(
        clamp(
          effects.trackOpacity,
          MINIMAP_BAR_STYLE_LIMITS.trackOpacity[0],
          MINIMAP_BAR_STYLE_LIMITS.trackOpacity[1],
          DEFAULT_MINIMAP_EFFECTS.trackOpacity,
        ),
      ),
      barOutline: effects.barOutline === true,
      barOutlineColor: hexColor(
        effects.barOutlineColor,
        DEFAULT_MINIMAP_EFFECTS.barOutlineColor,
      ),
      barOutlineWidth: rounded(
        clamp(
          effects.barOutlineWidth,
          MINIMAP_BAR_STYLE_LIMITS.barOutlineWidth[0],
          MINIMAP_BAR_STYLE_LIMITS.barOutlineWidth[1],
          DEFAULT_MINIMAP_EFFECTS.barOutlineWidth,
        ),
        2,
      ),
      barBackground: hexColor(
        effects.barBackground,
        DEFAULT_MINIMAP_EFFECTS.barBackground,
      ),
      damageTrailColor: DEFAULT_MINIMAP_EFFECTS.damageTrailColor,
      lowHealthColor: hexColor(
        effects.lowHealthColor,
        DEFAULT_MINIMAP_EFFECTS.lowHealthColor,
      ),
      barThickness: clamp(
        effects.barThickness ?? source.barThickness,
        2,
        24,
        DEFAULT_MINIMAP_EFFECTS.barThickness,
      ),
      barRadius: clamp(effects.barRadius, 0, 20, 0),
      healthGradient: Boolean(effects.healthGradient ?? source.healthGradient),
      lowHealthPulse: Boolean(effects.lowHealthPulse ?? source.lowHealthPulse),
      lowHealthThreshold: Math.round(
        clamp(
          effects.lowHealthThreshold,
          1,
          99,
          DEFAULT_MINIMAP_EFFECTS.lowHealthThreshold,
        ),
      ),
      damageTrail: true,
      damageTrailDelayMs: DEFAULT_MINIMAP_EFFECTS.damageTrailDelayMs,
      damageTrailDurationMs: DEFAULT_MINIMAP_EFFECTS.damageTrailDurationMs,
      damageFlash:
        typeof (effects.damageFlash ?? source.damageFlash) === "boolean"
          ? (effects.damageFlash ?? source.damageFlash)
          : DEFAULT_MINIMAP_EFFECTS.damageFlash,
      damageFlashStrength: Math.round(
        clamp(
          effects.damageFlashStrength,
          0,
          100,
          DEFAULT_MINIMAP_EFFECTS.damageFlashStrength,
        ),
      ),
      damageFlashDurationMs: Math.round(
        clamp(
          effects.damageFlashDurationMs,
          100,
          5000,
          DEFAULT_MINIMAP_EFFECTS.damageFlashDurationMs,
        ),
      ),
      damageAssetId: String(effects.damageAssetId || "").slice(0, 160),
      floatingHealthDamage: effects.floatingHealthDamage !== false,
      floatingArmorDamage: effects.floatingArmorDamage !== false,
      floatingHeal: effects.floatingHeal !== false,
      damageNumbers: effects.damageNumbers === true,
      damageNumberColor: hexColor(
        effects.damageNumberColor,
        DEFAULT_MINIMAP_EFFECTS.damageNumberColor,
      ),
      armorDamageNumberColor: hexColor(
        effects.armorDamageNumberColor,
        DEFAULT_MINIMAP_EFFECTS.armorDamageNumberColor,
      ),
      healNumberColor: hexColor(
        effects.healNumberColor,
        DEFAULT_MINIMAP_EFFECTS.healNumberColor,
      ),
      damageNumberSize: Math.round(
        clamp(
          effects.damageNumberSize,
          MINIMAP_DAMAGE_NUMBER_LIMITS.size[0],
          MINIMAP_DAMAGE_NUMBER_LIMITS.size[1],
          DEFAULT_MINIMAP_EFFECTS.damageNumberSize,
        ),
      ),
      damageNumberDurationMs: Math.round(
        clamp(
          effects.damageNumberDurationMs,
          MINIMAP_DAMAGE_NUMBER_LIMITS.durationMs[0],
          MINIMAP_DAMAGE_NUMBER_LIMITS.durationMs[1],
          DEFAULT_MINIMAP_EFFECTS.damageNumberDurationMs,
        ),
      ),
      floatStyle: text(
        effects.floatStyle,
        DEFAULT_MINIMAP_EFFECTS.floatStyle,
        MINIMAP_FLOAT_STYLES,
      ),
      lossMode: text(
        effects.lossMode,
        DEFAULT_MINIMAP_EFFECTS.lossMode,
        MINIMAP_LOSS_MODES,
      ),
      lossDisplay: text(
        effects.lossDisplay,
        DEFAULT_MINIMAP_EFFECTS.lossDisplay,
        MINIMAP_LOSS_DISPLAYS,
      ),
      lossSpeed: text(
        effects.lossSpeed,
        DEFAULT_MINIMAP_EFFECTS.lossSpeed,
        Object.keys(MINIMAP_LOSS_SPEEDS),
      ),
      numberFont: text(
        effects.numberFont,
        DEFAULT_MINIMAP_EFFECTS.numberFont,
        MINIMAP_NUMBER_FONTS,
      ),
      ...normalizeTiers(effects),
      numberSize,
      healthNumberColor: hexColor(
        effects.healthNumberColor,
        DEFAULT_MINIMAP_EFFECTS.healthNumberColor,
      ),
      armorNumberColor: hexColor(
        effects.armorNumberColor,
        DEFAULT_MINIMAP_EFFECTS.armorNumberColor,
      ),
      healthIconColor: hexColor(
        effects.healthIconColor,
        DEFAULT_MINIMAP_EFFECTS.healthIconColor,
      ),
      armorIconColor: hexColor(
        effects.armorIconColor,
        DEFAULT_MINIMAP_EFFECTS.armorIconColor,
      ),
      barIcons:
        storedSchema >= BAR_ICONS_CHOICE_SCHEMA_VERSION &&
        effects.barIcons === true,
      barIconColor: hexColor(
        effects.barIconColor,
        DEFAULT_MINIMAP_EFFECTS.barIconColor,
      ),
      healthIconAssetId: String(effects.healthIconAssetId || "").slice(0, 160),
      armorIconAssetId: String(effects.armorIconAssetId || "").slice(0, 160),
      healthIconPreset: text(
        effects.healthIconPreset,
        DEFAULT_MINIMAP_EFFECTS.healthIconPreset,
        [...MINIMAP_HEALTH_ICON_PRESETS, "custom"],
      ),
      armorIconPreset: text(
        effects.armorIconPreset,
        DEFAULT_MINIMAP_EFFECTS.armorIconPreset,
        [...MINIMAP_ARMOR_ICON_PRESETS, "custom"],
      ),
      healthIconStyle: text(
        effects.healthIconStyle,
        DEFAULT_MINIMAP_EFFECTS.healthIconStyle,
        MINIMAP_VITAL_STYLE_IDS,
      ),
      armorIconStyle: text(
        effects.armorIconStyle,
        DEFAULT_MINIMAP_EFFECTS.armorIconStyle,
        MINIMAP_VITAL_STYLE_IDS,
      ),
      vitalThickness: clamp(
        effects.vitalThickness,
        MINIMAP_VITAL_THICKNESS.min,
        MINIMAP_VITAL_THICKNESS.max,
        DEFAULT_MINIMAP_EFFECTS.vitalThickness,
      ),
      vitalLevelColours: effects.vitalLevelColours === true,
      vitalBlinkLow: effects.vitalBlinkLow === true,
      vitalTrackColor: trackColour,
      vitalTrackOpacity: Math.round(
        clamp(
          effects.vitalTrackOpacity,
          0,
          100,
          DEFAULT_MINIMAP_EFFECTS.vitalTrackOpacity,
        ),
      ),
      armourOnlyWhenPresent: effects.armourOnlyWhenPresent === true,
      vitalTrackColour: hexColor(effects.vitalTrackColour, trackColour),
      numbersCentred: effects.numbersCentred === true,
      vitalFillSmooth: effects.vitalFillSmooth === true,
      vitalAnimSpeed: Math.round(
        clamp(
          effects.vitalAnimSpeed,
          25,
          400,
          DEFAULT_MINIMAP_EFFECTS.vitalAnimSpeed,
        ),
      ),
      playerMarkerMode: text(
        effects.playerMarkerMode,
        DEFAULT_MINIMAP_EFFECTS.playerMarkerMode,
        ["stock", "custom", "hidden"],
      ),
      playerMarkerColor: hexColor(
        effects.playerMarkerColor,
        DEFAULT_MINIMAP_EFFECTS.playerMarkerColor,
      ),
      playerMarkerScale: rounded(clamp(storedMarkerScale, 0.1, 3, 1), 3),
      playerMarkerAssetId: String(effects.playerMarkerAssetId || "").slice(
        0,
        160,
      ),
      othersMode: text(
        effects.othersMode,
        DEFAULT_MINIMAP_EFFECTS.othersMode,
        MINIMAP_OTHERS_MODES,
      ),
      othersScale: rounded(
        clamp(
          effects.othersScale,
          MINIMAP_OTHERS_SCALE_LIMITS[0],
          MINIMAP_OTHERS_SCALE_LIMITS[1],
          1,
        ),
        3,
      ),
      othersAssetId: String(effects.othersAssetId || "").slice(0, 160),
      showNorth:
        storedSchema < SCENE_GEOMETRY_SCHEMA_VERSION
          ? true
          : effects.showNorth !== false,
      font: text(effects.font || source.minimapFont, "stock", [
        "stock",
        "compact",
        "wide",
        "mono",
      ]),
      playerTag: String(effects.playerTag ?? source.minimapText ?? "").slice(
        0,
        32,
      ),
      healthFill: normalizeMinimapFill(
        effects.healthFill,
        MINIMAP_FILL_DEFAULT_COLORS.health,
      ),
      armorFill: normalizeMinimapFill(
        effects.armorFill,
        MINIMAP_FILL_DEFAULT_COLORS.armor,
      ),
      healthMidFill: tierFill(
        effects.healthMidFill,
        MINIMAP_TIER_FILL_COLORS.healthMid,
      ),
      healthLowFill: tierFill(
        effects.healthLowFill,
        MINIMAP_TIER_FILL_COLORS.healthLow,
      ),
      armorMidFill: tierFill(
        effects.armorMidFill,
        MINIMAP_TIER_FILL_COLORS.armorMid,
      ),
      armorLowFill: tierFill(
        effects.armorLowFill,
        MINIMAP_TIER_FILL_COLORS.armorLow,
      ),
      damageColorMode: effects.damageColorMode === "custom" ? "custom" : "game",
      damageColor: hexColor(
        effects.damageColor,
        DEFAULT_MINIMAP_EFFECTS.damageColor,
      ),
      damageScale: Math.round(
        clamp(
          effects.damageScale,
          MINIMAP_DAMAGE_SCALE_LIMITS[0],
          MINIMAP_DAMAGE_SCALE_LIMITS[1],
          DEFAULT_MINIMAP_EFFECTS.damageScale,
        ),
      ),
      damageImageFit:
        effects.damageImageFit === "contain" ? "contain" : "cover",
      damageImageZoom: Math.round(
        clamp(
          effects.damageImageZoom,
          ...MINIMAP_DAMAGE_IMAGE_LIMITS.zoom,
          DEFAULT_MINIMAP_EFFECTS.damageImageZoom,
        ),
      ),
      damageImageX: Math.round(
        clamp(
          effects.damageImageX,
          ...MINIMAP_DAMAGE_IMAGE_LIMITS.offset,
          DEFAULT_MINIMAP_EFFECTS.damageImageX,
        ),
      ),
      damageImageY: Math.round(
        clamp(
          effects.damageImageY,
          ...MINIMAP_DAMAGE_IMAGE_LIMITS.offset,
          DEFAULT_MINIMAP_EFFECTS.damageImageY,
        ),
      ),
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * HP отдельно от карты (задача 1 ТЗ 17.10.2026).
 * ---------------------------------------------------------------------------
 *
 * Владелец: «хп отсоединялось от самой карты и человек мог миникарту оставить
 * на своём месте, а хп перетянуть в другое; отключил — они возвращаются в
 * нормальное положение». HP, броня, их цифры и значки двигаются одной группой
 * — так их взаимное место не ломается. Двигать группу можно только в кадре
 * мини-карты: здоровье знает лишь её фильм, и за кадром записи `minimap`
 * игра его не рисует (опыт 10.10.2026). В любое место экрана — с картой на
 * 0 % (тогда весь кадр — одни HP).
 */
export const MINIMAP_VITAL_GROUP = Object.freeze([
  "healthBar",
  "armorBar",
  "healthNumber",
  "armorNumber",
  "healthIcon",
  "armorIcon",
]);

function normalizeVitalsAway(input) {
  if (!input || typeof input !== "object") return null;
  const result = {};
  for (const id of MINIMAP_VITAL_GROUP) {
    const place = input[id];
    if (!place || typeof place !== "object") continue;
    const x = Number(place.x);
    const y = Number(place.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const [low, high] = MINIMAP_SCREEN_WIDGET_RANGE;
    result[id] = {
      x: rounded(clamp(x, low, high, 0.5)),
      y: rounded(clamp(y, low, high, 0.5)),
    };
  }
  return Object.keys(result).length ? result : null;
}

/** Половины габарита элемента группы HP в долях радара. */
function vitalHalf(id, widget, effects) {
  if (id.endsWith("Icon")) {
    const rect = minimapIconRect(widget);
    return { x: rect.width / 2, y: rect.height / 2 };
  }
  return minimapWidgetHalfExtent(
    id.endsWith("Bar") ? widget : { ...widget, rotation: 0 },
    id.endsWith("Bar") ? (Number(effects?.barThickness) || 8) / 8 : 1,
  );
}

/**
 * Рамка видимых элементов группы HP в долях радара: `{ left, top, right,
 * bottom }`; `null` — на карте нет ни одного.
 */
export function minimapVitalsBox(config) {
  const { widgets } = config.layout;
  let box = null;
  for (const id of MINIMAP_VITAL_GROUP) {
    const widget = widgets[id];
    if (!widget?.visible) continue;
    const half = vitalHalf(id, widget, config.effects);
    const next = {
      left: widget.x - half.x,
      top: widget.y - half.y,
      right: widget.x + half.x,
      bottom: widget.y + half.y,
    };
    box = box
      ? {
          left: Math.min(box.left, next.left),
          top: Math.min(box.top, next.top),
          right: Math.max(box.right, next.right),
          bottom: Math.max(box.bottom, next.bottom),
        }
      : next;
  }
  return box;
}

/**
 * Группа HP, сдвинутая на (dx, dy) долей радара так, чтобы её рамка не вышла за `bounds`: `{ widgets, dx, dy }` — новые
 * элементы и сдвиг, который на деле случился. Без `bounds` — кадр мини-карты; при «HP отдельно от карты» окно передаёт
 * экран (`minimapScreenBounds`).
 */
export function shiftMinimapVitals(
  config,
  dx,
  dy,
  bounds = MINIMAP_WIDGET_BOUNDS,
) {
  const box = minimapVitalsBox(config);
  const { widgets } = config.layout;
  if (!box) return { widgets, dx: 0, dy: 0 };
  const axis = (delta, low, high, min, max) =>
    high - low > max - min
      ? (min + max) / 2 - (low + high) / 2
      : clamp(delta, min - low, max - high, 0);
  const x = axis(
    Number(dx) || 0,
    box.left,
    box.right,
    bounds.left,
    bounds.right,
  );
  const y = axis(
    Number(dy) || 0,
    box.top,
    box.bottom,
    bounds.top,
    bounds.bottom,
  );
  const next = { ...widgets };
  for (const id of MINIMAP_VITAL_GROUP) {
    const widget = widgets[id];
    if (!widget) continue;
    next[id] = {
      ...widget,
      x: rounded(widget.x + x),
      y: rounded(widget.y + y),
    };
  }
  return { widgets: next, dx: x, dy: y };
}

/*
 * ---------------------------------------------------------------------------
 * Наезд HP на броню (снимок владельца 02.11.2026).
 * ---------------------------------------------------------------------------
 *
 * С 31.10.2026 центры группы HP обрезались рядом -0,5…1,5. У работы с HP далеко на экране все шесть центров падали в одну
 * точку (у владельца в проекте healthBar и armorBar обе 1,5 / -0,5), после записи так и оставались, а `shiftMinimapVitals`
 * двигает группу целиком: разойтись им было неоткуда. `vitalsAway` прошёл через тот же ряд и возвращал стопку при каждом
 * включении выключателя. В файл игры уходили те же числа.
 */

const VITALS_APART_SCHEMA_VERSION = 8;
/* Наезд — другая полоса накрывает больше этой доли меньшей. Касание и «крест» вертикальной с горизонтальной (≈ 7 %) — выбор человека. */
const VITALS_OVERLAP_SHARE = 0.1;
/* Зазор между полосами и от полосы до подписи — как у штатных (2 точки сцены). */
const VITAL_GAP_POINTS = STOCK_ARMOUR_START - STOCK_HEALTH_LENGTH;
const VITAL_LABELS = Object.freeze({
  healthBar: Object.freeze({ number: "healthNumber", icon: "healthIcon" }),
  armorBar: Object.freeze({ number: "armorNumber", icon: "armorIcon" }),
});

function barsOverlap(health, armor, effects) {
  const a = vitalHalf("healthBar", health, effects);
  const b = vitalHalf("armorBar", armor, effects);
  const across =
    Math.min(health.x + a.x, armor.x + b.x) -
    Math.max(health.x - a.x, armor.x - b.x);
  const down =
    Math.min(health.y + a.y, armor.y + b.y) -
    Math.max(health.y - a.y, armor.y - b.y);
  if (across <= 0 || down <= 0) return false;
  return (
    across * down > VITALS_OVERLAP_SHARE * 4 * Math.min(a.x * a.y, b.x * b.y)
  );
}

/* Полосы рядом вдоль своей длины: HP левее или выше, середина пары на месте. Как у штатных и у «Слева раздельно». */
function barsApart(health, armor, effects) {
  const a = vitalHalf("healthBar", health, effects);
  const b = vitalHalf("armorBar", armor, effects);
  const centre = { x: (health.x + armor.x) / 2, y: (health.y + armor.y) / 2 };
  if (a.x * MINIMAP_RADAR.width >= a.y * MINIMAP_RADAR.height) {
    const gap = VITAL_GAP_POINTS / MINIMAP_RADAR.width;
    const start = centre.x - (2 * a.x + gap + 2 * b.x) / 2;
    return {
      healthBar: { ...health, x: start + a.x, y: centre.y },
      armorBar: { ...armor, x: start + 2 * a.x + gap + b.x, y: centre.y },
    };
  }
  const gap = VITAL_GAP_POINTS / MINIMAP_RADAR.height;
  const start = centre.y - (2 * a.y + gap + 2 * b.y) / 2;
  return {
    healthBar: { ...health, x: centre.x, y: start + a.y },
    armorBar: { ...armor, x: centre.x, y: start + 2 * a.y + gap + b.y },
  };
}

/* Значок и цифра полосы рядом с ней: над горизонтальной (нет места — под), сбоку от вертикальной. */
function labelsBesideBar(id, bar, widgets, effects) {
  const { number, icon } = VITAL_LABELS[id];
  const half = vitalHalf(id, bar, effects);
  const gapX = VITAL_GAP_POINTS / MINIMAP_RADAR.width;
  const gapY = VITAL_GAP_POINTS / MINIMAP_RADAR.height;
  const iconWidth = widgets[icon].width;
  const numberWidth = widgets[number].width;
  const total = iconWidth + gapX + numberWidth;
  const halfHeight = Math.max(widgets[icon].height, widgets[number].height) / 2;
  let centreX = bar.x;
  let centreY;
  if (half.x * MINIMAP_RADAR.width >= half.y * MINIMAP_RADAR.height) {
    const above = bar.y - half.y - gapY - halfHeight;
    centreY =
      above - halfHeight >= MINIMAP_WIDGET_BOUNDS.top
        ? above
        : bar.y + half.y + gapY + halfHeight;
  } else {
    centreY = bar.y;
    centreX = bar.x + (bar.x < 0.5 ? 1 : -1) * (half.x + gapX + total / 2);
  }
  return {
    [icon]: {
      ...widgets[icon],
      x: centreX - total / 2 + iconWidth / 2,
      y: centreY,
    },
    [number]: {
      ...widgets[number],
      x: centreX + total / 2 - numberWidth / 2,
      y: centreY,
    },
  };
}

/**
 * Разводит группу HP, у которой наехали полосы или слиплись цифры и значки. Что стоит раздельно, не меняется, так что вызов
 * над работой без наезда ничего не делает. Разведённые полосы остаются у той же середины, но в кадре мини-карты: место
 * стопки — обрезка, а не выбор человека, и сцену ради него растить незачем.
 */
export function separateMinimapVitals(widgets, effects) {
  const { healthBar, armorBar } = widgets;
  if (!healthBar || !armorBar) return widgets;
  const overlap = barsOverlap(healthBar, armorBar, effects);
  const next = {
    ...widgets,
    ...(overlap ? barsApart(healthBar, armorBar, effects) : {}),
  };
  const labelIds = Object.values(VITAL_LABELS).flatMap(({ number, icon }) => [
    number,
    icon,
  ]);
  const stuck = (id) =>
    labelIds.some(
      (other) =>
        other !== id &&
        widgets[other] &&
        Math.abs(widgets[other].x - widgets[id].x) < 1e-3 &&
        Math.abs(widgets[other].y - widgets[id].y) < 1e-3,
    );
  for (const [id, labels] of Object.entries(VITAL_LABELS)) {
    if (!widgets[labels.number] || !widgets[labels.icon]) continue;
    if (stuck(labels.number) || stuck(labels.icon)) {
      Object.assign(next, labelsBesideBar(id, next[id], widgets, effects));
    } else if (overlap) {
      /* Подписи, что стоят сами по себе, едут со своей полосой. */
      for (const label of [labels.number, labels.icon])
        next[label] = {
          ...widgets[label],
          x: widgets[label].x + next[id].x - widgets[id].x,
          y: widgets[label].y + next[id].y - widgets[id].y,
        };
    }
  }
  if (overlap)
    return shiftMinimapVitals({ layout: { widgets: next }, effects }, 0, 0)
      .widgets;
  for (const id of MINIMAP_VITAL_GROUP)
    if (next[id] !== widgets[id])
      next[id] = {
        ...next[id],
        x: rounded(next[id].x),
        y: rounded(next[id].y),
      };
  return next;
}

/* `vitalsAway` старой работы — те же места: разводятся так же, чтобы выключатель не вернул стопку. */
function separateOldAway(away, widgets, effects, storedSchema) {
  if (!away || storedSchema >= VITALS_APART_SCHEMA_VERSION) return away;
  const placed = { ...widgets };
  for (const [id, place] of Object.entries(away))
    placed[id] = { ...placed[id], ...place };
  const apart = separateMinimapVitals(placed, effects);
  return Object.fromEntries(
    Object.keys(away).map((id) => [id, { x: apart[id].x, y: apart[id].y }]),
  );
}

/*
 * ---------------------------------------------------------------------------
 * HP по всему экрану при видимой карте.
 * ---------------------------------------------------------------------------
 *
 * Игра рисует фильм мини-карты только в окне записи `minimap` frontend.xml (опыт 10.10.2026): полоса за краем сцены 191×136
 * не видна. Шире окно — полоса видна, но радар раскладывается по центру записи, и карта уезжает на половину добавленной
 * ширины. Значит, окно надо растить вокруг ЕГО ЖЕ центра: на столько же влево и вправо, вверх и вниз, а содержимое сцены
 * поставить в середину нового фильма. Тогда каждая точка прежней сцены ложится на экран туда же, где лежала, а HP можно
 * поставить в любое место расширенной сцены.
 *
 * Растёт только `minimap` (`MINIMAP_GROWN_ENTRIES`); `bigmap` остаётся штатной (21.11.2026, по кадрам hpwide10c/11: в развёрнутом радаре корень смещён, и всё, что ставилось по расчёту малой карты, — наши элементы и штатные полоски — падало за экран; теперь в развёрнутом радаре корень штатный и вид как у штатной игры, а группа HP за кадром в нём не показывается). Фильм вписывается целиком и в `pausemap`, поэтому при HP за
 * кадром карта паузы сжимается и сдвигается: стенд 31.10.2026, при сцене 1211×416 — в 6,34 и 3,06 раза и на 0,421 и 0,336 экрана.
 * Запись `pausemap` не растёт намеренно: расчётные -2,670157 / -1,029412 / 6,340314 / 3,058824 на том же стенде и с `I/I`, и с
 * `L/T` спрятали карту паузы целиком. Окно предупреждает об этом, пока группа за кадром. Следующий опыт — масштаб внутри фильма,
 * на стенде (`docs/MINIMAP-CUSTOMIZER.md`).
 */

/** Запас вокруг группы HP в точках сцены: вылетающие цифры поднимаются на 2,2 кегля, обводки, вспышка. */
export const MINIMAP_SCENE_EXTENT_PADDING = 12;

/**
 * Записи frontend.xml, которые растут вместе со сценой. `pausemap`, `gallery`, `golf_courses`, маски и размытие не меняются.
 */
export const MINIMAP_GROWN_ENTRIES = Object.freeze(["minimap"]);

/** Ходит ли группа HP по всему экрану (`normalizeMinimapLayout().layout`). Отдельного режима нет: это «HP отдельно от карты». */
export const minimapScreenHpActive = (layout) =>
  layout?.vitalsDetached === true;

/**
 * Границы центра элемента в долях радара, пока он остаётся на экране: `frame` — кадр мини-карты на экране игры
 * в долях экрана (`minimapScreenRect`: `{ left, top, width, height }`).
 */
export function minimapScreenBounds(frame) {
  const [low, high] = MINIMAP_SCREEN_WIDGET_RANGE;
  const toRadarX = (fraction) =>
    (((fraction - frame.left) / frame.width) * MINIMAP_SCENE.width -
      MINIMAP_RADAR.x) /
    MINIMAP_RADAR.width;
  const toRadarY = (fraction) =>
    (((fraction - frame.top) / frame.height) * MINIMAP_SCENE.height -
      MINIMAP_RADAR.y) /
    MINIMAP_RADAR.height;
  return {
    left: Math.max(low, toRadarX(0)),
    right: Math.min(high, toRadarX(1)),
    top: Math.max(low, toRadarY(0)),
    bottom: Math.min(high, toRadarY(1)),
  };
}

/**
 * На сколько точек сцены надо вырастить фильм с каждой стороны, чтобы группа HP уместилась: `{ x, y }`, целые точки. Ноль —
 * выключатель выключен или группа и так внутри сцены: файлы как у обычной работы. Запас (`MINIMAP_SCENE_EXTENT_PADDING`)
 * кладётся только по той оси, где группа вышла.
 */
export function minimapSceneExtent(config) {
  const layout = config?.layout;
  const none = { x: 0, y: 0 };
  if (!minimapScreenHpActive(layout)) return none;
  const box = minimapVitalsBox(config);
  if (!box) return none;
  const left = MINIMAP_RADAR.x + box.left * MINIMAP_RADAR.width;
  const right = MINIMAP_RADAR.x + box.right * MINIMAP_RADAR.width;
  const top = MINIMAP_RADAR.y + box.top * MINIMAP_RADAR.height;
  const bottom = MINIMAP_RADAR.y + box.bottom * MINIMAP_RADAR.height;
  const overflowX = Math.max(0, -left, right - MINIMAP_SCENE.width);
  const overflowY = Math.max(0, -top, bottom - MINIMAP_SCENE.height);
  /* Сотая точки — погрешность округления долей: группа у самой кромки сцены за неё не вышла. */
  return {
    x:
      overflowX > 0.01
        ? Math.ceil(overflowX + MINIMAP_SCENE_EXTENT_PADDING)
        : 0,
    y:
      overflowY > 0.01
        ? Math.ceil(overflowY + MINIMAP_SCENE_EXTENT_PADDING)
        : 0,
  };
}

/**
 * Расширение не больше, чем нужно, чтобы кадр с центром в центре записи дотянулся до самого далёкого края экрана: дальше
 * экрана фильм растить незачем. `frame` — кадр до расширения в долях экрана.
 */
export function fitMinimapSceneExtent(extent, frame) {
  const centreX = frame.left + frame.width / 2;
  const centreY = frame.top + frame.height / 2;
  const perPointX = frame.width / MINIMAP_SCENE.width;
  const perPointY = frame.height / MINIMAP_SCENE.height;
  const reachX = Math.max(
    0,
    Math.ceil(
      Math.max(centreX, 1 - centreX) / perPointX - MINIMAP_SCENE.width / 2,
    ),
  );
  const reachY = Math.max(
    0,
    Math.ceil(
      Math.max(centreY, 1 - centreY) / perPointY - MINIMAP_SCENE.height / 2,
    ),
  );
  return { x: Math.min(extent.x, reachX), y: Math.min(extent.y, reachY) };
}

/**
 * Записи frontend.xml с расширенным фильмом: каждая из `MINIMAP_GROWN_ENTRIES`, что есть в `entries`, растёт вокруг своего
 * центра на `extent` точек сцены с каждой стороны, в своём масштабе: точка сцены на экране весит столько же, сколько раньше.
 * Левый край уходит влево на `dx`, размер растёт на `2·dx`. По высоте зависит от выравнивания: у `alignY="B"` `posY` — низ от
 * нижнего края (больший — ниже, поэтому `+dy`), у `T` и `I` — верх от верхнего (`-dy`). Прежняя сцена 191×136 ложится ровно
 * в прежний прямоугольник записи.
 *
 * @param {Record<string, { alignY?: string, posX: number, posY: number, sizeX: number, sizeY: number }>} entries
 * @param {{ x: number, y: number }} extent — точки сцены с каждой стороны
 */
export function extendMinimapFrontend(entries, extent) {
  const extra = {
    x: Math.max(0, Number(extent?.x) || 0),
    y: Math.max(0, Number(extent?.y) || 0),
  };
  if (!extra.x && !extra.y) return entries;
  const result = { ...entries };
  for (const name of MINIMAP_GROWN_ENTRIES) {
    const entry = entries[name];
    if (!entry) continue;
    const dx = (extra.x * entry.sizeX) / MINIMAP_SCENE.width;
    const dy = (extra.y * entry.sizeY) / MINIMAP_SCENE.height;
    result[name] = {
      ...entry,
      posX: rounded(entry.posX - dx),
      posY: rounded(entry.alignY === "B" ? entry.posY + dy : entry.posY - dy),
      sizeX: rounded(entry.sizeX + 2 * dx),
      sizeY: rounded(entry.sizeY + 2 * dy),
    };
  }
  return result;
}

/* Заливка порога: та же, что у полосы, но без своего видео — видео одно,
   у полной полосы. */
function tierFill(input, colors) {
  const fill = normalizeMinimapFill(input, colors);
  return fill.mode === "video" ? { ...fill, mode: "solid", video: null } : fill;
}

/*
 * ---------------------------------------------------------------------------
 * Что из проекта на самом деле видно.
 * ---------------------------------------------------------------------------
 */

/** Показаны ли цифры HP и брони. */
export function minimapShowsNumbers(config) {
  const { widgets } = config.layout;
  return widgets.healthNumber.visible || widgets.armorNumber.visible;
}

/**
 * Какие поля цифр встают в кадр (задача 15 ТЗ 10.10.2026, вечер). В режиме
 * «одна общая» поле одно — на месте цифр HP, и пишет броню, пока она есть,
 * потом HP; поле брони тогда не ставится.
 */
export function minimapNumberFields(config) {
  const { widgets } = config.layout;
  const combined = config.effects.lossDisplay === "combined";
  return {
    health: widgets.healthNumber.visible,
    armour: !combined && widgets.armorNumber.visible,
    combined: combined && widgets.healthNumber.visible,
  };
}

/**
 * Цифры пишет счётчик в кадре, а не методы игры напрямую: при счёте вниз и
 * при одной общей цифре. Какие значения он ведёт — `health` / `armour`.
 * `null` — счётчик не нужен.
 */
export function minimapNumberCounter(config) {
  const fields = minimapNumberFields(config);
  const { effects } = config;
  if (!fields.health && !fields.armour) return null;
  if (effects.lossMode !== "countdown" && !fields.combined) return null;
  return {
    health: fields.health || fields.combined,
    armour: fields.armour || fields.combined,
    combined: fields.combined,
    /* Единиц за кадр при 30 кадрах в секунду; «сразу» — один шаг. */
    step:
      effects.lossMode === "countdown"
        ? (MINIMAP_LOSS_SPEEDS[effects.lossSpeed] ||
            MINIMAP_LOSS_SPEEDS.normal) / 30
        : 1000,
  };
}

/** Показаны ли отдельные значки HP и брони. */
export function minimapShowsIndicatorIcons(config) {
  const { widgets } = config.layout;
  return widgets.healthIcon.visible || widgets.armorIcon.visible;
}

/** Нужны ли картинки значков HP и брони — цифрам со значком или полосам. */
export function minimapNeedsIconImages(config) {
  const { effects, layout } = config;
  const { widgets } = layout;
  /* Значок-шкала (`vital-icons.js`) картинки не просит: она нужна, пока хоть один видимый значок остался картинкой. */
  const imageIcon =
    (widgets.healthIcon.visible &&
      effects.healthIconStyle === MINIMAP_VITAL_STYLE_IMAGE) ||
    (widgets.armorIcon.visible &&
      effects.armorIconStyle === MINIMAP_VITAL_STYLE_IMAGE);
  return (
    imageIcon ||
    (effects.barIcons &&
      (widgets.healthBar.visible || widgets.armorBar.visible))
  );
}

/**
 * Лежит ли видимая полоса в штатной подложке под радаром.
 *
 * Подложка — тёмная полоса 123…135 под картой. Пока в ней стоит хотя бы одна
 * полоса, она нужна; когда полосы переехали на карту, от неё остаётся пустая
 * чёрная лента, и компилятор её прячет.
 *
 * Своя подложка полос заменяет штатную целиком: человек, который поставил
 * подложке прозрачность 0, ждёт увидеть одну заливку HP, а не её же на чёрной
 * ленте игры.
 */
export function minimapBarsUseStockStrip(config) {
  const { layout, effects } = config;
  if (effects.trackMode === "custom") return false;
  const top = (MINIMAP_STRIP.top - MINIMAP_RADAR.y) / MINIMAP_RADAR.height;
  const bottom =
    (MINIMAP_STRIP.bottom - MINIMAP_RADAR.y) / MINIMAP_RADAR.height;
  return ["healthBar", "armorBar"].some((key) => {
    const widget = layout.widgets[key];
    if (!widget.visible) return false;
    const half = minimapWidgetHalfExtent(widget, effects.barThickness / 8);
    return (
      widget.y - half.y >= top - 1e-3 && widget.y + half.y <= bottom + 1e-3
    );
  });
}

/**
 * Где стоит значок полосы — центр и размер в долях радара.
 *
 * Значок квадратный, высотой в долю толщины полосы, у её начала (откуда растёт
 * заливка), без поворота. Считается в точках сцены: доли ширины и высоты у
 * радара разные, и квадрат в долях квадратом бы не остался.
 */
export const MINIMAP_BAR_ICON = Object.freeze({ size: 0.76, inset: 0.12 });

export function minimapBarIconRect(widget, thickness) {
  const barLength = widget.width * MINIMAP_RADAR.width;
  const barThickness = widget.height * MINIMAP_RADAR.height * (thickness / 8);
  const size = barThickness * MINIMAP_BAR_ICON.size;
  const along =
    -barLength / 2 + barThickness * MINIMAP_BAR_ICON.inset + size / 2;
  const radians = ((Number(widget.rotation) || 0) * Math.PI) / 180;
  const width = size / MINIMAP_RADAR.width;
  const height = size / MINIMAP_RADAR.height;
  const bounds = MINIMAP_WIDGET_BOUNDS;
  return {
    x: clamp(
      widget.x + (along * Math.cos(radians)) / MINIMAP_RADAR.width,
      bounds.left + width / 2,
      bounds.right - width / 2,
    ),
    y: clamp(
      widget.y + (along * Math.sin(radians)) / MINIMAP_RADAR.height,
      bounds.top + height / 2,
      bounds.bottom - height / 2,
    ),
    width,
    height,
  };
}
