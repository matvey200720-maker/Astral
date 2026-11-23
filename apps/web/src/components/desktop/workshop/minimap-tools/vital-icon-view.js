import {
  MINIMAP_DEFAULT_NUMBER_SIZE,
  MINIMAP_ICON_SIZE_LIMITS,
  MINIMAP_NUMBER_SIZE_LIMITS,
  MINIMAP_VITAL_BLINK_FRAMES,
  MINIMAP_VITAL_STYLE_IMAGE,
  MINIMAP_VITAL_THICKNESS,
  VITAL_NUMBER_DIGIT,
  minimapIconRect,
  minimapIconSizeUnits,
  minimapIconWidgetSize,
  minimapVitalBlinks,
  minimapVitalColour,
  minimapVitalFrame,
  minimapVitalStyle,
  vitalDoubleRingPreset,
  vitalFillIconSizeForNumber,
  vitalFillNumberFit,
  vitalFillNumberSpot,
  vitalIconShapes,
} from "@modovik/minimap-contract";

/*
 * Значки HP и брони как шкалы: всё, что окну нужно считать (10.11.2026, данные — Хелпер 28, договор `packages/minimap-contract/vital-icons.js`).
 *
 * Предпросмотр не рисует свою шкалу: он берёт те же контуры и тот же кадр, что игра ставит на этот запас, и тот же цвет. Поэтому здесь нет арифметики фигур — только
 * выбор кадра, перевод контуров в путь SVG, место числа и заготовка «двойное кольцо».
 */

/** Фильм игры — 30 кадров в секунду; мигание — 12 кадров на вспышку (`MINIMAP_VITAL_BLINK_FRAMES`). */
export const MINIMAP_MOVIE_FPS = 30;
export const VITAL_BLINK_SECONDS = MINIMAP_VITAL_BLINK_FRAMES / MINIMAP_MOVIE_FPS;

/** Игра до сих пор мигает «вполсилы»: внутренний клип проседает до четверти яркости на 6-м кадре из 12. */
export const VITAL_BLINK_DIM = 0.25;

/** Какому элементу какая сторона: `healthIcon` → HP, `armorIcon` → броня. */
export const VITAL_ICON_SIDES = Object.freeze({ healthIcon: "health", armorIcon: "armour" });

/** Поле эффектов с видом значка. */
const STYLE_FIELD = Object.freeze({ health: "healthIconStyle", armour: "armorIconStyle" });

/** Вид значка стороны: id шкалы или `null`, если значок — картинка (прежний путь). */
export function vitalIconStyle(effects, side) {
  const id = effects?.[STYLE_FIELD[side]];
  return id && id !== MINIMAP_VITAL_STYLE_IMAGE && minimapVitalStyle(id) ? id : null;
}

/** Значок-шкала виден и рисуется шкалой — так же решает сборка (`minimapVitalPlan`). */
export function vitalIconShown(config, side) {
  const widget = config.layout.widgets[side === "health" ? "healthIcon" : "armorIcon"];
  return Boolean(widget?.visible && vitalIconStyle(config.effects, side));
}

/** Хоть один из двух значков — шкала. */
export const anyVitalIcon = (config) => vitalIconShown(config, "health") || vitalIconShown(config, "armour");

/* Фигуры вида стоят дорого (сотни точек): считаем один раз на вид, сторону (у «сердца и щита» они разные) и толщину. */
const SHAPE_CACHE = new Map();

export function vitalShapesOf(styleId, side, thickness) {
  const key = `${styleId}|${styleId === "fill" ? side : "any"}|${thickness}`;
  let shapes = SHAPE_CACHE.get(key);
  if (!shapes) {
    shapes = vitalIconShapes(styleId, { kind: side, thickness });
    SHAPE_CACHE.set(key, shapes);
    if (SHAPE_CACHE.size > 80) SHAPE_CACHE.delete(SHAPE_CACHE.keys().next().value);
  }
  return shapes;
}

const COORDINATE = (value) => String(Math.round(value * 1e4) / 1e4);

/** Контуры (замкнутые ломаные в квадрате ±0,5) → строка пути SVG; заливка по чётности, как в игре. */
export function contoursPath(contours) {
  return (contours || [])
    .filter((contour) => contour.length >= 3)
    .map((contour) => `M${contour.map(([x, y]) => `${COORDINATE(x)} ${COORDINATE(y)}`).join("L")}Z`)
    .join("");
}

/**
 * Что нарисовать на запасе `percent`: путь шкалы, путь подложки, цвет и мигание.
 * Кадр — тот же номер, что игра ставит командой `gotoAndStop` (`minimapVitalFrame`), цвет — по ступеням порогов (`minimapVitalColour`).
 */
export function vitalIconView(effects, side, percent) {
  const styleId = vitalIconStyle(effects, side);
  if (!styleId) return null;
  const shapes = vitalShapesOf(styleId, side, effects.vitalThickness);
  const frame = minimapVitalFrame(styleId, percent);
  return {
    styleId,
    frame,
    steps: shapes.steps,
    fill: contoursPath(shapes.frames[frame - 1]),
    track: contoursPath(shapes.track),
    colour: minimapVitalColour(effects, side, percent),
    blinks: minimapVitalBlinks(effects, side, percent),
  };
}

/** Какие виды шкал берут толщину из настройки: кольцо, сегменты и дуга. Остальные фигуры фиксированные. */
export const THICKNESS_STYLES = Object.freeze(["ring", "segments", "arc"]);

export const usesThickness = (styleId) => THICKNESS_STYLES.includes(styleId);

/** Пределы ползунка толщины в процентах значка (в настройке — доля 0,08…0,3). */
export const THICKNESS_PERCENT = Object.freeze({
  min: Math.round(MINIMAP_VITAL_THICKNESS.min * 100),
  max: Math.round(MINIMAP_VITAL_THICKNESS.max * 100),
});

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Число: внутри значка или рядом                                                                                                             */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

/** Зазор между значком и числом рядом, в долях сцены по ширине. */
const NUMBER_GAP = 0.006;

/**
 * Как у вида значка стоит число: `"hole"` — по центру значка, в отверстии (кольцо, сегменты); `"shape"` — внутри контура сердца и щита (`fill`), выше середины, где они шире
 * всего; `null` — рядом со значком (остальные виды и картинка). Решает флаг `numberInside` договора.
 * @param {string | null} styleId
 * @returns {"hole" | "shape" | null}
 */
export function vitalNumberPlace(styleId) {
  if (!styleId || !minimapVitalStyle(styleId)?.numberInside) return null;
  return styleId === "fill" ? "shape" : "hole";
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Где встаёт число (`healthNumber` / `armorNumber`) при виде значка: «кольцо» и «сегменты» (`numberInside`) — по центру значка, «сердце и щит» — в безопасном прямоугольнике
 * внутри контура (`vitalFillNumberSpot` договора), остальные виды и картинка — справа от значка. Возвращает центр числа в долях сцены, как хранит раскладка.
 * @param {object} icon элемент значка (`layout.widgets.healthIcon`)
 * @param {object} number элемент цифр (`layout.widgets.healthNumber`)
 * @param {string | null} styleId вид шкалы или `null` — картинка
 * @param {"health" | "armour"} [side] сторона шкалы: у «сердца и щита» сердце — HP, щит — броня
 */
export function vitalNumberSpot(icon, number, styleId, side = "health") {
  const box = minimapIconRect(icon);
  const place = vitalNumberPlace(styleId);
  if (place === "shape") {
    const offset = vitalFillNumberSpot(side);
    return { x: round6(box.x + offset.x * box.width), y: round6(box.y + offset.y * box.height) };
  }
  if (place === "hole") return { x: box.x, y: box.y };
  return { x: box.x + box.width / 2 + NUMBER_GAP + (Number(number?.width) || 0) / 2, y: box.y };
}

/*
 * Число влезает в отверстие шкалы (11.11.2026, замечание ведущей по галерее: «кольцо с 58 внутри»). Кегль цифр общий на оба числа и стоит с запасом на любой значок, поэтому
 * внутри кольца число вылезало за его край: на значке 24 при кегле 13 «58» не помещалось, а «100» не помещалось и на 34. Мерка — «100» (самое широкое число запаса):
 * замер в окне — три цифры шириной 1,72 кегля, высота цифр 0,72 кегля; надпись — прямоугольник, он входит в круг, пока его диагональ не больше диаметра отверстия
 * (`размер × (1 − 2 × толщина)`: у кольца и сегментов внутренний радиус один).
 *
 * У «сердца и щита» (`fill`) круглой дырки нет: число меряется по безопасному прямоугольнику внутри контура (`vitalFillNumberFit` договора) — по ширине и по высоте. Те же функции
 * принимают последним параметром `{ style, side }`: без него — кольцо, как было.
 */
const DIGIT_WIDTH = VITAL_NUMBER_DIGIT.width;
const DIGIT_HEIGHT = VITAL_NUMBER_DIGIT.height;

/** Наименьший значок-кольцо, в котором число стоит внутри без выхода за край: при предельно малом кегле (8) «100» влезает с 24. */
export const VITAL_RING_MIN_SIZE = 24;

/** Наименьший кегль, под который считают самый маленький значок с числом внутри (как у кольца: 8). */
const MIN_INSIDE_NUMBER_SIZE = 8;

/**
 * Наибольший кегль, при котором число из `digits` знаков помещается внутри шкалы размера `iconSize` (единицы редактора) с толщиной `thickness`; не меньше предела кегля.
 * У «сердца и щита» (`{ style: "fill", side }`) толщина не нужна — число идёт по безопасному прямоугольнику стороны (`side`: `health` — сердце, `armour` — щит).
 * @param {{ style?: string | null, side?: "health" | "armour" }} [place]
 */
export function vitalNumberFit(iconSize, thickness, digits = 3, { style = null, side = "health" } = {}) {
  const [low, high] = MINIMAP_NUMBER_SIZE_LIMITS;
  const fit =
    style === "fill"
      ? vitalFillNumberFit(side, iconSize, digits)
      : Math.floor((Number(iconSize) * (1 - 2 * Number(thickness))) / Math.hypot(digits * DIGIT_WIDTH, DIGIT_HEIGHT));
  return Math.min(high, Math.max(low, fit));
}

/**
 * Наименьший значок, в котором число из `digits` знаков стоит внутри шкалы кеглем `numberSize` (обратное к `vitalNumberFit`): «58» кеглем 13 при обычной толщине — от 26, «100» — от 36.
 * Кегль 13 — привычный: в игре меньше он мелкий (11.11.2026, стенд: кольцо ≈ 26 px на 1080p, цифры в нём при кегле 8 ≈ 7 px), поэтому подсказка у «Цифр» называет значок под кегль 13.
 * У «сердца и щита» — `{ style: "fill", side }` (`vitalFillIconSizeForNumber` договора): значок может выйти за предел размера значка (48) — тогда число такого кегля в него не поместится.
 * @param {{ style?: string | null, side?: "health" | "armour" }} [place]
 */
export function vitalIconSizeForNumber(numberSize, thickness, digits = 3, { style = null, side = "health" } = {}) {
  if (style === "fill") return vitalFillIconSizeForNumber(side, numberSize, digits);
  return Math.ceil((Number(numberSize) * Math.hypot(digits * DIGIT_WIDTH, DIGIT_HEIGHT)) / (1 - 2 * Number(thickness)));
}

/**
 * Наименьший значок, в котором число стоит внутри без выхода за край (кегль не меньше 8, «100»): у кольца и сегментов — `VITAL_RING_MIN_SIZE`, у сердца — 32, у щита — 22; не больше
 * предела размера значка.
 * @param {string | null} styleId
 * @param {"health" | "armour"} side
 */
export function vitalIconMinSize(styleId, side, thickness = MINIMAP_VITAL_THICKNESS.default) {
  if (styleId !== "fill") return VITAL_RING_MIN_SIZE;
  return Math.min(MINIMAP_ICON_SIZE_LIMITS[1], vitalIconSizeForNumber(MIN_INSIDE_NUMBER_SIZE, thickness, 3, { style: "fill", side }));
}

/** Кегль числа внутри значка: тот, что помещается, но не крупнее привычного (прежний кегль или 13) — чтобы значок побольше не раздувал число, а поменьше сжимал. */
const insideNumberSize = (current, iconSize, thickness, place = {}) => Math.min(vitalNumberFit(iconSize, thickness, 3, place), Math.max(Number(current) || 0, MINIMAP_DEFAULT_NUMBER_SIZE));

const ICON_OF_NUMBER = Object.freeze({ healthNumber: ["healthIcon", "health"], armorNumber: ["armorIcon", "armour"] });

/** Числа, что сейчас стоят внутри своих значков-шкал: видимый значок, вид с числом внутри (кольцо, сегменты, сердце и щит), видимое число на месте внутри значка. */
function insideNumbers(config) {
  const { widgets } = config.layout;
  return Object.entries(ICON_OF_NUMBER).flatMap(([numberId, [iconId, side]]) => {
    const style = vitalIconStyle(config.effects, side);
    if (!vitalNumberPlace(style) || !widgets[iconId].visible || !widgets[numberId].visible || !numberIsInside(config, numberId)) return [];
    return [{ numberId, iconId, side, style }];
  });
}

/** Есть ли видимое число, которое стоит внутри видимого значка-шкалы с числом внутри (кольцо, сегменты, сердце и щит): тогда у «Цифр» нужна подсказка про размер. */
export const numbersInsideVital = (config) => insideNumbers(config).length > 0;

/** То же, но только у кольца и сегментов (число в отверстии): подсказка «Число в кольце…». */
export const numbersInsideHole = (config) => insideNumbers(config).some((item) => item.style !== "fill");

/** Стоит ли число на своём месте внутри значка: по центру (кольцо, сегменты — место, куда ставит вид с `numberInside`) или в безопасном прямоугольнике («сердце и щит»). */
export function numberIsInside(config, numberId) {
  const [iconId, side] = ICON_OF_NUMBER[numberId] || [];
  if (!iconId) return false;
  const { widgets } = config.layout;
  const style = vitalIconStyle(config.effects, side);
  const spot = vitalNumberPlace(style) === "shape" ? vitalNumberSpot(widgets[iconId], widgets[numberId], style, side) : minimapIconRect(widgets[iconId]);
  return Math.abs(widgets[numberId].x - spot.x) < SAME * 10 && Math.abs(widgets[numberId].y - spot.y) < SAME * 10;
}

/**
 * Кегль числа внутри значка `own` (`{ numberId, style, side, size }`). Кегль в проекте общий на оба числа, а у сердца и щита помещается разное: когда у одного из двух чисел
 * (этого или второго, что тоже стоит внутри своего значка) вид «сердце и щит», берётся то, что помещается в оба, иначе второе число вылезло бы за контур. У кольца и сегментов —
 * прежнее правило: по своему значку.
 */
function sharedInsideNumberSize(config, own) {
  const thickness = config.effects.vitalThickness;
  const others = insideNumbers(config)
    .filter((item) => item.numberId !== own.numberId)
    .map((item) => ({ style: item.style, side: item.side, size: minimapIconSizeUnits(config.layout.widgets[item.iconId]) }));
  const entries = [own, ...others];
  if (!entries.some((entry) => entry.style === "fill")) return insideNumberSize(config.effects.numberSize, own.size, thickness, { style: own.style, side: own.side });
  const current = Math.max(Number(config.effects.numberSize) || 0, MINIMAP_DEFAULT_NUMBER_SIZE);
  return Math.min(current, ...entries.map((entry) => vitalNumberFit(entry.size, thickness, 3, { style: entry.style, side: entry.side })));
}

/**
 * Число встаёт внутрь значка-шкалы, если у значка вид с числом внутри (кольцо, сегменты, сердце и щит), и значок, и число видны: центр числа — центр значка (у сердца и щита —
 * безопасный прямоугольник внутри контура), кегль — не больше того, что помещается («100»), значок — не меньше наименьшего (`vitalIconMinSize`: у кольца `VITAL_RING_MIN_SIZE`).
 * Иначе конфигурация возвращается как была. Одна функция на выбор вида, включение цифр и двойное кольцо.
 */
export function placeNumberInside(config, numberId) {
  const [iconId, side] = ICON_OF_NUMBER[numberId] || [];
  if (!iconId) return config;
  const { widgets } = config.layout;
  const style = vitalIconStyle(config.effects, side);
  const icon = widgets[iconId];
  const number = widgets[numberId];
  if (!vitalNumberPlace(style) || !icon.visible || !number.visible) return config;
  const smallest = vitalIconMinSize(style, side, config.effects.vitalThickness);
  const grown = minimapIconSizeUnits(icon) < smallest ? { ...icon, ...minimapIconWidgetSize(smallest) } : icon;
  const spot = vitalNumberSpot(grown, number, style, side);
  const numberSize = sharedInsideNumberSize(config, { numberId, style, side, size: minimapIconSizeUnits(grown) });
  return {
    ...config,
    effects: { ...config.effects, numberSize },
    layout: { ...config.layout, widgets: { ...widgets, [iconId]: grown, [numberId]: { ...number, x: spot.x, y: spot.y } } },
  };
}

/**
 * Правки кегля при смене размера значка, пока число стоит внутри него: кегль не больше того, что помещается в новом размере. Без числа внутри — `null`.
 * @param {object} config
 * @param {"healthIcon" | "armorIcon"} iconId
 * @param {number} size новый размер значка, единицы редактора
 */
export function numberFitForIconSize(config, iconId, size) {
  const numberId = iconId === "healthIcon" ? "healthNumber" : "armorNumber";
  const side = VITAL_ICON_SIDES[iconId];
  const style = vitalIconStyle(config.effects, side);
  if (!vitalNumberPlace(style) || !config.layout.widgets[numberId].visible || !numberIsInside(config, numberId)) return null;
  return { numberSize: sharedInsideNumberSize(config, { numberId, style, side, size }) };
}

/**
 * Где встанет число после смены размера значка `iconId` на `icon` (новый элемент значка): у «сердца и щита» число стоит не в центре, а выше, и от размера значка зависит, насколько
 * выше, — оно идёт за значком. Без «сердца и щита» или без числа внутри (по прежней раскладке) — `null`: у кольца число и так в центре.
 * @param {object} config раскладка до смены размера
 * @returns {{ x: number, y: number } | null}
 */
export function insideNumberSeat(config, iconId, icon) {
  const numberId = iconId === "healthIcon" ? "healthNumber" : "armorNumber";
  const side = VITAL_ICON_SIDES[iconId];
  const style = vitalIconStyle(config.effects, side);
  const number = config.layout.widgets[numberId];
  if (vitalNumberPlace(style) !== "shape" || !number.visible || !numberIsInside(config, numberId)) return null;
  return vitalNumberSpot(icon, number, style, side);
}

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Двойное кольцо                                                                                                                             */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

const SAME = 1e-4;

/**
 * Заготовка «двойное кольцо» поверх раскладки: оба значка — кольца с общим центром, броня снаружи, HP внутри (`vitalDoubleRingPreset`). Центр и размер берутся с брони
 * (если она видна), иначе с HP; размер — по меньшей стороне коробки, как у всех значков. `size` задаёт размер внешнего кольца (единицы редактора), иначе остаётся прежний.
 * Возвращает новую конфигурацию.
 */
export function applyDoubleRing(config, { size = null } = {}) {
  const { widgets } = config.layout;
  const base = widgets.armorIcon.visible ? widgets.armorIcon : widgets.healthIcon.visible ? widgets.healthIcon : widgets.armorIcon;
  /* Число HP стоит внутри внутреннего кольца: ему нужно отверстие значка `VITAL_RING_MIN_SIZE`, значит, внешнее — не меньше `doubleRingMinimumSize`. */
  const wanted = Math.max(size ?? minimapIconSizeUnits(base), widgets.healthNumber.visible ? doubleRingMinimumSize(VITAL_RING_MIN_SIZE, config.effects.vitalThickness) : 0);
  const outer = size == null && wanted === minimapIconSizeUnits(base) ? { width: base.width, height: base.height } : minimapIconWidgetSize(wanted);
  const preset = vitalDoubleRingPreset({ x: base.x, y: base.y, width: outer.width, height: outer.height, thickness: config.effects.vitalThickness });
  const armorIcon = { ...widgets.armorIcon, ...preset.widgets.armorIcon };
  const healthIcon = { ...widgets.healthIcon, ...preset.widgets.healthIcon };
  let next = {
    ...config,
    effects: { ...config.effects, ...preset.effects },
    layout: { ...config.layout, widgets: { ...widgets, armorIcon, healthIcon } },
  };
  /* Числа: HP — по центру внутреннего кольца, броня — справа от внешнего (в одном центре они легли бы друг на друга); кегль — по отверстию внутреннего кольца. */
  const placed = { ...next.layout.widgets };
  if (placed.healthNumber.visible) {
    const spot = vitalNumberSpot(healthIcon, placed.healthNumber, "ring");
    placed.healthNumber = { ...placed.healthNumber, x: spot.x, y: spot.y };
    next = { ...next, effects: { ...next.effects, numberSize: insideNumberSize(next.effects.numberSize, minimapIconSizeUnits(healthIcon), next.effects.vitalThickness) } };
  }
  if (placed.armorNumber.visible && next.effects.lossDisplay !== "combined") {
    const spot = vitalNumberSpot(armorIcon, placed.armorNumber, null);
    placed.armorNumber = { ...placed.armorNumber, x: spot.x, y: spot.y };
  }
  return { ...next, layout: { ...next.layout, widgets: placed } };
}

/**
 * Стоят ли значки двойным кольцом: оба видны, оба «кольцо», один центр, внутреннее меньше внешнего в `innerScale` раз (с запасом на округление раскладки).
 */
export function isDoubleRing(config) {
  const { effects, layout } = config;
  const { armorIcon, healthIcon } = layout.widgets;
  if (!armorIcon.visible || !healthIcon.visible) return false;
  if (effects.armorIconStyle !== "ring" || effects.healthIconStyle !== "ring") return false;
  if (Math.abs(armorIcon.x - healthIcon.x) > SAME || Math.abs(armorIcon.y - healthIcon.y) > SAME) return false;
  const preset = vitalDoubleRingPreset({ x: armorIcon.x, y: armorIcon.y, width: armorIcon.width, height: armorIcon.height, thickness: effects.vitalThickness });
  const want = preset.widgets.healthIcon;
  return Math.abs(healthIcon.width - want.width) <= want.width * 0.03 + SAME && Math.abs(healthIcon.height - want.height) <= want.height * 0.03 + SAME;
}

/** Наименьший размер внешнего кольца, при котором внутреннее ещё не меньше предела значка: `minimum / innerScale`. */
export function doubleRingMinimumSize(minimum, thickness) {
  const preset = vitalDoubleRingPreset({ thickness });
  return Math.ceil(minimum / preset.innerScale);
}
