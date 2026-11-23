import {
  MINIMAP_RADAR,
  MINIMAP_SCENE,
  MINIMAP_VITAL_GROUP,
  minimapIconWidgetSize,
  minimapScreenBounds,
  shiftMinimapVitals,
} from "../minimap-layout.js";
import { normalizeMinimapVitalPlate } from "@modovik/minimap-contract";
import {
  placeNumberInside,
  vitalIconSizeForNumber,
  vitalIconStyle,
} from "./vital-icon-view.js";

/*
 * Индикатор HP на экране игры (владелец, 21.11.2026: «ставить индикатор HP где хочу, в том числе у прицела, и двигать полоски»).
 *
 * Положение элемента группы HP хранится центром в долях радара (`layout.widgets[id].x / y`), а человек думает долями экрана: «правее
 * середины», «на 56 % высоты». Здесь — перевод туда и обратно, тот же, что в `minimapScreenBounds` договора и в пробе
 * `scripts/build-hp-wide-probe.mjs`, и всё, что нужно ручкам кадра «Экран», полям X/Y и готовым раскладкам. Без разметки: окно и тесты
 * берут числа отсюда.
 *
 * `frame` везде — кадр мини-карты (запись `minimap`) на экране игры в долях экрана: `{ left, top, width, height }`
 * (`minimapScreenRect`).
 */

/** Шаг стрелки по экрану — доля ширины и высоты экрана; с Shift — крупнее. */
export const SCREEN_NUDGE = 0.01;
export const SCREEN_NUDGE_LARGE = 0.05;

/**
 * Центр элемента (доли радара) → точка на экране (доли экрана).
 * @param {{left:number, top:number, width:number, height:number}} frame
 */
export const screenPointOf = (frame, x, y) => ({
  x:
    frame.left +
    ((x * MINIMAP_RADAR.width + MINIMAP_RADAR.x) / MINIMAP_SCENE.width) *
      frame.width,
  y:
    frame.top +
    ((y * MINIMAP_RADAR.height + MINIMAP_RADAR.y) / MINIMAP_SCENE.height) *
      frame.height,
});

/** Точка на экране (доли экрана) → центр элемента в долях радара: обратная к `screenPointOf`. */
export const radarPointOf = (frame, fx, fy) => ({
  x:
    (((fx - frame.left) / frame.width) * MINIMAP_SCENE.width -
      MINIMAP_RADAR.x) /
    MINIMAP_RADAR.width,
  y:
    (((fy - frame.top) / frame.height) * MINIMAP_SCENE.height -
      MINIMAP_RADAR.y) /
    MINIMAP_RADAR.height,
});

/**
 * Элементы, у которых есть ручка на экране и строка в списке панели: видимые из группы HP. Цифры брони при одной общей цифре
 * («HP и броня одним числом») на карте не рисуются — ручки у них нет.
 */
export function screenHandleIds(config) {
  const { widgets } = config.layout;
  return MINIMAP_VITAL_GROUP.filter(
    (id) =>
      widgets[id]?.visible &&
      !(id === "armorNumber" && config.effects.lossDisplay === "combined"),
  );
}

/**
 * Центр одного элемента, прижатый так, чтобы он целиком остался на экране. Габарит считает тот же `shiftMinimapVitals`, что двигает
 * всю группу: полоса, цифры и значок — каждый по своей коробке; здесь он получает группу из одного элемента.
 * @param {{x:number, y:number}} point желаемый центр в долях радара
 * @param {{left:number, top:number, right:number, bottom:number}} bounds `minimapScreenBounds(frame)`
 */
export function clampWidgetToScreen(config, id, point, bounds) {
  const widget = config.layout.widgets[id];
  const alone = {
    layout: { widgets: { [id]: { ...widget, visible: true } } },
    effects: config.effects,
  };
  const moved = shiftMinimapVitals(
    alone,
    point.x - widget.x,
    point.y - widget.y,
    bounds,
  ).widgets[id];
  return { x: moved.x, y: moved.y };
}

/**
 * Куда встанет элемент, если его центр поставить в точку экрана `at` (доли экрана): центр в долях радара, зажатый краями экрана.
 */
export function placeWidgetOnScreen(config, id, frame, at) {
  return clampWidgetToScreen(
    config,
    id,
    radarPointOf(frame, at.x, at.y),
    minimapScreenBounds(frame),
  );
}

/** Проект с элементом `place` (`{ id, x, y }`) на новом месте — черновик протяжки ручки. Без места — тот же проект. */
export function withWidgetPlace(config, place) {
  if (!place) return config;
  const widget = config.layout.widgets[place.id];
  if (!widget) return config;
  return {
    ...config,
    layout: {
      ...config.layout,
      widgets: {
        ...config.layout.widgets,
        [place.id]: { ...widget, x: place.x, y: place.y },
      },
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Готовые раскладки                                                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

/** Элементы, которыми занимаются готовые раскладки; полосы они не трогают. */
const LAYOUT_WIDGETS = Object.freeze([
  "healthIcon",
  "armorIcon",
  "healthNumber",
  "armorNumber",
]);

/** Поле вида значка и сторона шкалы у каждого из двух значков. */
const ICON_STYLE = Object.freeze({
  healthIcon: Object.freeze({ field: "healthIconStyle", side: "health" }),
  armorIcon: Object.freeze({ field: "armorIconStyle", side: "armour" }),
});

/**
 * Четыре готовые раскладки индикатора рядом с прицелом (доли экрана: середина — 0,5 / 0,5, прицел стоит там). `numbers` — значок и цифры
 * HP и брони столбцом справа от середины; `gauge` — только значки-шкалы, без цифр; `plate` — два кольца-шкалы в ряд, числа внутри колец,
 * на общей плашке (кадр из TikTok, 21.11.2026); `heartplate` — то же, но значки «сердце и щит» (`fill`): сердце — HP, щит — броня, БЕЗ чисел
 * (решение владельца через ведущую 22.11.2026: на стенде hpwide15 числа внутри контура в игре не видны, поэтому их в этой раскладке нет — ни в окне, ни в фильме).
 * `places` — центры в долях экрана; у «плашки» центр числа — центр его значка. `style` — вид значков раскладки-плашки (без него — кольцо).
 */
export const INDICATOR_LAYOUTS = Object.freeze({
  numbers: Object.freeze({
    visible: Object.freeze([
      "healthIcon",
      "healthNumber",
      "armorIcon",
      "armorNumber",
    ]),
    places: Object.freeze({
      healthIcon: Object.freeze({ x: 0.545, y: 0.5 }),
      healthNumber: Object.freeze({ x: 0.585, y: 0.5 }),
      armorIcon: Object.freeze({ x: 0.545, y: 0.56 }),
      armorNumber: Object.freeze({ x: 0.585, y: 0.56 }),
    }),
    gauge: false,
  }),
  gauge: Object.freeze({
    visible: Object.freeze(["healthIcon", "armorIcon"]),
    places: Object.freeze({
      healthIcon: Object.freeze({ x: 0.555, y: 0.5 }),
      armorIcon: Object.freeze({ x: 0.555, y: 0.57 }),
    }),
    gauge: true,
  }),
  plate: Object.freeze({
    visible: Object.freeze([
      "healthIcon",
      "healthNumber",
      "armorIcon",
      "armorNumber",
    ]),
    places: Object.freeze({
      healthIcon: Object.freeze({ x: 0.56, y: 0.5 }),
      healthNumber: Object.freeze({ x: 0.56, y: 0.5 }),
      armorIcon: Object.freeze({ x: 0.6, y: 0.5 }),
      armorNumber: Object.freeze({ x: 0.6, y: 0.5 }),
    }),
    gauge: true,
    plate: true,
  }),
  heartplate: Object.freeze({
    visible: Object.freeze(["healthIcon", "armorIcon"]),
    places: Object.freeze({
      healthIcon: Object.freeze({ x: 0.56, y: 0.5 }),
      armorIcon: Object.freeze({ x: 0.6, y: 0.5 }),
    }),
    gauge: true,
    plate: true,
    style: "fill",
  }),
});

/** Цвет пустой части шкалы у раскладки «плашка»: серый с кадра из TikTok, полной силы. */
export const PLATE_TRACK_COLOUR = "#4b5058";

/**
 * Кольцо раскладки «плашка» такое, чтобы в нём стояло число из трёх знаков (кегль не меньше привычного 13): тогда «100» не вылезает за край и при полном запасе.
 */
/** Кегль чисел внутри колец раскладки «плашка» (21.11.2026, стенд hpwide12: при 13 цифры в кольце были ≈ 4 px на 1280×720 — нечитаемая каша). */
export const PLATE_NUMBER_SIZE = 24;

const plateIconSize = (effects) =>
  vitalIconSizeForNumber(
    Math.max(Number(effects.numberSize) || 0, PLATE_NUMBER_SIZE),
    effects.vitalThickness,
    3,
  );

/**
 * Кегль, под который раскладка «Сердце и жилет» считает значки: «100» в сердце и щите. Сердце такого кегля не вмещает и на значке 48 (предел размера значка): нужно 80,
 * поэтому значки встают предельными, а кегль берётся по тому, что помещается (`placeNumberInside`: у сердца 12, у щита 17, общий — меньший).
 */
export const HEART_PLATE_NUMBER_SIZE = 20;

/** Размер значка стороны для раскладки: у «сердца и щита» — свой у сердца и щита (контуры разные), у кольца — один (по отверстию). */
const layoutIconSize = (spec, id, effects) =>
  spec.style === "fill"
    ? vitalIconSizeForNumber(
        Math.max(Number(effects.numberSize) || 0, HEART_PLATE_NUMBER_SIZE),
        effects.vitalThickness,
        3,
        { style: "fill", side: ICON_STYLE[id].side },
      )
    : plateIconSize(effects);

/**
 * Проект с готовой раскладкой индикатора: «HP отдельно от карты» включено, значки и цифры стоят на местах раскладки, полосы и размеры
 * не тронуты. У раскладки-шкалы значок, который сейчас картинка, становится кольцом (`ring`) — тем же полем, что меняет вид значка в
 * «Значках»; значок, у которого шкала уже выбрана (капсула, дуга…), остаётся как есть. Цифры при этом выключаются — внутрь кольца
 * они здесь не ставятся.
 *
 * «Плашка» (`plate`): оба значка — кольца (даже если выбрана другая шкала), числа стоят внутри колец, броня показывается только когда она есть, пустая часть шкалы
 * серая (`PLATE_TRACK_COLOUR`, полная сила), подложка — общая «пилюля» с чертой между блоками; её цвет и прозрачность остаются прежними.
 * «Сердце и жилет» (`heartplate`): то же, но значки — «сердце и щит» (`fill`): сердце у HP, щит у брони; чисел нет (в игре внутри контура они не видны); значки предельного размера.
 * @param {"numbers" | "gauge" | "plate" | "heartplate"} kind
 */
export function applyIndicatorLayout(config, kind, frame) {
  const spec = INDICATOR_LAYOUTS[kind];
  if (!spec) return config;
  const widgets = { ...config.layout.widgets };
  for (const id of LAYOUT_WIDGETS) {
    const visible = spec.visible.includes(id);
    widgets[id] = { ...widgets[id], visible };
    /* Кольцо нужного размера — до расстановки: от размера зависит, насколько его прижмёт к краю экрана. */
    if (spec.plate && ICON_STYLE[id])
      widgets[id] = {
        ...widgets[id],
        ...minimapIconWidgetSize(layoutIconSize(spec, id, config.effects)),
      };
    const at = spec.places[id];
    if (visible && at) {
      const place = placeWidgetOnScreen(
        { ...config, layout: { ...config.layout, widgets } },
        id,
        frame,
        at,
      );
      widgets[id] = { ...widgets[id], x: place.x, y: place.y };
    }
  }
  const effects = { ...config.effects };
  if (spec.gauge)
    for (const { field, side } of Object.values(ICON_STYLE))
      if (spec.plate || vitalIconStyle(effects, side) === null)
        effects[field] = spec.style ?? "ring";
  const next = {
    ...config,
    effects,
    layout: { ...config.layout, widgets, vitalsDetached: true },
  };
  return spec.plate ? finishPlateLayout(next, spec) : next;
}

/**
 * Остальное, что делает раскладка «плашка»: числа внутрь значков (колец или контуров сердца и щита), броня «только когда она есть», серая пустая часть шкалы, общая пилюля
 * с чертой.
 */
function finishPlateLayout(config, spec) {
  const effects = {
    ...config.effects,
    numberSize: Math.max(
      Number(config.effects.numberSize) || 0,
      spec.style === "fill" ? HEART_PLATE_NUMBER_SIZE : PLATE_NUMBER_SIZE,
    ),
    armourOnlyWhenPresent: true,
    /* Числа по центру своего поля (у прежних раскладок вправо, как в beta.108). */
    numbersCentred: true,
    vitalTrackColour: PLATE_TRACK_COLOUR,
    /* Прежнее поле того же цвета: сборка игры пока читает его. */
    vitalTrackColor: PLATE_TRACK_COLOUR,
    vitalTrackOpacity: 100,
  };
  let next = { ...config, effects };
  /* Центр числа — центр его значка (у сердца и щита — безопасный прямоугольник контура), кегль — тот, что помещается в значок (при двух значках — в оба). */
  for (const numberId of ["healthNumber", "armorNumber"])
    next = placeNumberInside(next, numberId);
  const plate = normalizeMinimapVitalPlate(config.vitalPlate);
  return {
    ...next,
    vitalPlate: {
      ...plate,
      shape: "pill",
      shared: true,
      divider: { ...plate.divider, enabled: true },
    },
  };
}
