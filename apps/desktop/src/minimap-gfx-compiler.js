import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  MINIMAP_ARMOUR_RUNTIME_SCALE,
  MINIMAP_BAR_ICON,
  MINIMAP_FRONTEND_STOCK,
  MINIMAP_INSTALL_LIMITS,
  MINIMAP_NUMBER_BOX,
  MINIMAP_OTHER_PEOPLE_SYMBOLS,
  MINIMAP_OTHERS_STOCK_SIDE,
  MINIMAP_RADAR,
  MINIMAP_RADAR_ASPECT,
  minimapDamageImageBox,
  MINIMAP_SCHEMA_VERSION,
  MINIMAP_STOCK_MARKER_HEIGHT,
  MINIMAP_FILL_VIDEO,
  MINIMAP_OVERLAY_LIMITS,
  extendMinimapFrontend,
  fitMinimapSceneExtent,
  gameEntryRect,
  minimapSceneExtent,
  MINIMAP_TWIPS,
  fillInnerTransform,
  fillOuterTransform,
  fillTile,
  fillTimeline,
  fillVideoTimeline,
  minimapInstallPlan,
  minimapPlacementForGame,
  isStockMinimapPlacement,
  minimapBarAnimated,
  minimapBarsUseStockStrip,
  minimapFillActive,
  minimapFillGeometry,
  minimapFrameRects,
  minimapGameScreen,
  minimapIconRect,
  minimapNeedsIconImages as contractNeedsIconImages,
  minimapNumberCounter,
  minimapNumberFields,
  minimapOpacityToAlpha,
  minimapOthersChanged,
  minimapOverlayBox,
  minimapOverlayCell,
  minimapOverlaySheetPixels,
  minimapOverlayTimeline,
  minimapShowsIndicatorIcons,
  minimapShowsNumbers,
  minimapTierFills,
  minimapUnitsToScene,
  minimapWidgetHalfExtent,
  minimapZoomActive,
  normalizeMinimapLayout,
  placeMinimapFrontend,
  unsupportedMinimapFeatures,
  MINIMAP_DISTANCE_LANGUAGES,
} from "@modovik/minimap-contract";
import { vitalPlateLayout } from "@modovik/minimap-contract/vital-plate-layout";
import {
  minimapBigPlace,
  minimapBigPlaces,
} from "@modovik/minimap-contract/big-map";
import { minimapGpsWaypoint } from "@modovik/minimap-contract/gps-marker";
import { GPS_HUD_TARGET, GPS_ICON_TARGET } from "@modovik/minimap-contract/gps";
import { patchGpsRouteLine } from "./minimap-gps-line.js";
import { MINIMAP_WIDE_SCENE_MARK } from "./minimap-film-damage.js";
import { addPauseGuard, rootScaleMinimapScene } from "./minimap-root-scale.js";
import { RADAR_ZOOM_LEVELS, buildRadarZoomMeta } from "@modovik/vector-map";
import {
  ANY,
  AVM1,
  action,
  assembleActions,
  findMethod,
  findPattern,
  pushAction,
  readProgram,
  register,
  rewriteActions,
} from "./scaleform-avm1.js";
import {
  MINIMAP_VITAL_SMOOTH,
  minimapVitalPlan,
  vitalIconCode,
  vitalIconPlacement,
  vitalSmoothEase,
  vitalSmoothTickSprite,
} from "./minimap-vital-icons.js";
import {
  IDENTITY_MATRIX,
  SWF_TAG,
  allocateCharacterIds,
  alphaOnly,
  characterBounds,
  composeMatrix,
  defineBitmapRectShape,
  defineBitmapShape,
  defineEditText,
  defineLosslessBitmap,
  definePolygonsShape,
  defineRectangleShape,
  defineRectanglesShape,
  defineSprite,
  defineSpriteFrames,
  indexSwf,
  multiplyColor,
  multiplyMatrix,
  parseSwfTags,
  placeObject2,
  readRect,
  readShapeRectangles,
  scaleformHeaderLength,
  writeRect,
  solidColor,
  spritePlacements,
  spriteTimeline,
  swfTag,
  transformRect,
  uncompressedScaleform,
} from "./scaleform-swf.js";

/*
 * Мини-карта игрока: minimap.gfx и frontend.xml из update.rpf.
 *
 * База — файлы из игры самого игрока (`resolveMinimapBase`), а компилятор
 * проверяет не байты, а устройство: символы находятся по именам экспорта
 * (`HEALTH_ARMOUR_ABILITY_SMALL`, `barFrames`, `radar_centre`), экземпляры —
 * по именам, которые читает ActionScript самой игры (`healthArmourMC`,
 * `healthBar`), прямоугольник радара — по размещению `wantedOverlaySP`.
 * Файл, в котором чего-то из этого нет, отвергается с объяснением до записи
 * в игру.
 *
 * До 2026-09-16 компилятор считал полосы в пространстве шириной 5037 твипов
 * от начала координат, которого в файле нет, и полосы «сверху» вставали на 166
 * точек выше кадра мини-карты: в игре их не было видно вовсе. Проверено
 * эмулятором Flash на файле из update.rpf игрока (стенд с вызовами
 * REGISTER_HEALTH_ARMOUR → SETUP_HEALTH_ARMOUR → SET_PLAYER_HEALTH, как их
 * делает игра). Геометрия теперь одна с редактором —
 * `@modovik/minimap-contract`.
 */
export const MINIMAP_GFX_ENTRY =
  "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap.gfx";
export const MINIMAP_FRONTEND_ENTRY = "common/data/ui/frontend.xml";
/* Дальность обзора радара — таблица ступеней, та же, что у большой карты.
   Штатный файл лежит в common.rpf; в update.rpf его кладут поверх. */
export const MINIMAP_ZOOM_ENTRY = "common/data/ui/mapzoomdata.meta";
const GFX_TARGET = `update:/${MINIMAP_GFX_ENTRY}`;
const FRONTEND_TARGET = `update:/${MINIMAP_FRONTEND_ENTRY}`;
const ZOOM_TARGET = `update:/${MINIMAP_ZOOM_ENTRY}`;
const MAX_CUSTOM_IMAGE_BYTES = 1024 * 1024;
/*
 * Дополнительные файлы пакета мини-карты (метка и маршрут GPS, слова
 * расстояния) метят только в свои места update.rpf — закрытый список, а не
 * «любой путь в update.rpf» (проверка границ доверия, ТЗ 17.10.2026): цвета
 * и значок метки, узлы дорог маршрута и таблицы текста тринадцати языков.
 */
const EXTRA_TARGETS = new Set([GPS_HUD_TARGET, GPS_ICON_TARGET]);
const EXTRA_TARGET_PATTERNS = Object.freeze([
  /^update:\/x64\/levels\/gta5\/paths\.rpf\/nodes\d{1,6}\.ynd$/,
  new RegExp(
    `^update:/x64/patch/data/lang/(?:${MINIMAP_DISTANCE_LANGUAGES.join("|")})_rel\\.rpf/global\\.gxt2$`,
  ),
]);

/** Свой ли это файл пакета мини-карты: цель из закрытого списка. */
export const minimapExtraTargetAllowed = (target) =>
  typeof target === "string" &&
  (EXTRA_TARGETS.has(target) ||
    EXTRA_TARGET_PATTERNS.some((pattern) => pattern.test(target)));
/* Картинка человека (метка, урон): 1 МБ сжатого PNG бывает 16000×16000 точек — гигабайт при раскрытии. Предел пикселей — до декодирования. */
const MAX_CUSTOM_IMAGE_PIXELS = 32 * 1024 * 1024;
/* Сторона квадрата, в который ложится своя картинка (64 точки сцены). */
const IMAGE_SIDE = 1280;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function hexToRgb(value) {
  const hex = /^#[0-9a-f]{6}$/i.test(String(value || ""))
    ? String(value)
    : "#ffffff";
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  );
}

/** Проект мини-карты в текущей схеме — та же форма, что у редактора. */
export function normalizeMinimapConfiguration(input = {}) {
  return normalizeMinimapLayout(input);
}

/** Нужны ли пакету картинки значков HP и брони. */
export function minimapNeedsIconImages(rawConfiguration) {
  return contractNeedsIconImages(normalizeMinimapLayout(rawConfiguration));
}

/*
 * ---------------------------------------------------------------------------
 * ActionScript класса MINIMAP.
 * ---------------------------------------------------------------------------
 *
 * `SETUP_HEALTH_ARMOUR` берёт цвета из палитры игры:
 *   Colour.setHudColour(HudColour.HUD_COLOUR_GREEN, this.colourHealth)
 * — и так же броню и «мало здоровья». Вызов меняется на присваивание
 * `this.colourHealth = {r, g, b}`; дальше класс сам красит полосы
 * (`Colour.Colourise` прибавляет r−255 к белой фигуре), и его ветки —
 * обычная полоса, покраснение, мигание — работают с любым цветом.
 *
 * `SET_PLAYER_HEALTH` краснеет полосу, когда здоровье не больше 25, — два
 * `Push register2, 25; Greater`. Вспышка урона — `healthHitMC._alpha = 75`.
 *
 * Цифры HP и брони: в штатном файле их нет вовсе. Раньше компилятор двигал
 * поля глубиномера `depth_bar` (`distanceToSurfaceTF`), которые игра
 * заполняет только под водой, — цифр здоровья не было видно никогда. Теперь
 * поля заводятся в спрайте полос, а текст в них пишут сами методы игры:
 * в конце `SET_PLAYER_HEALTH` / `SET_PLAYER_ARMOUR` и в
 * `SETUP_HEALTH_ARMOUR` сразу после строки, где класс запоминает спрайт
 * полос активного кадра (`BIND_BARS`).
 *
 * Первое значение ставилось не там: после `HEALTH_ARMOUR_ABILITY._visible =
 * true`, а это на тысячу байт раньше привязки — `this.HEALTH_ARMOUR_BAR_MC`
 * там ещё не существует, и запись уходила в никуда. В игре из-за этого цифр
 * не было, пока здоровье не изменится, а у целого игрока не было вовсе
 * (2026-09-20, сообщение владельца).
 *
 * Каждое место обязано найтись ровно столько раз, сколько описано.
 */
const HUD_COLOUR_CALLS = Object.freeze([
  { member: "colourHealth", hud: "HUD_COLOUR_GREEN", effect: "healthColor" },
  { member: "colourArmour", hud: "HUD_COLOUR_BLUE", effect: "armorColor" },
  { member: "colourRed", hud: "HUD_COLOUR_RED", effect: "lowHealthColor" },
]);

const UTILS_PATH = [
  [AVM1.PUSH, ["rockstargames"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["ui"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["utils"]],
  AVM1.GET_MEMBER,
];

const hudColourCall = (member, hud) => [
  [AVM1.PUSH, [register(1), member]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["com"]],
  AVM1.GET_VARIABLE,
  ...UTILS_PATH,
  [AVM1.PUSH, ["HudColour"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [hud]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [2, "com"]],
  AVM1.GET_VARIABLE,
  ...UTILS_PATH,
  [AVM1.PUSH, ["Colour"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["setHudColour"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];

const LOW_HEALTH_COMPARISON = [[AVM1.PUSH, [register(2), 25]], AVM1.GREATER];
/* Твин вспышки `TweenStarLite.to(healthHitMC, r2, …)`: r2 — длительность из
   вызова, а без неё — 1,5 с игры. */
const FLASH_TWEEN = [
  [AVM1.PUSH, [register(2), register(1), "HEALTH_ARMOUR_ABILITY"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["healthHitMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [3, "com"]],
];
const DEFAULT_FLASH_MS = 2100;
/* `this.CONTENT.setMask(this.TIMELINE.mapMask)` в INITIALISE: содержимое
   радара, которое наполняет сама игра. */
const CONTENT_MASKED = [
  [AVM1.PUSH, [1, register(1), "CONTENT"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["setMask"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
];
const DAMAGE_FLASH_ALPHA = [
  [AVM1.PUSH, ["healthHitMC"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_alpha", 75]],
  AVM1.SET_MEMBER,
];
/*
 * Окраска вспышки в SETUP_HEALTH_ARMOUR:
 *   Colour.Colourise(HEALTH_ARMOUR_ABILITY.healthHitMC, c.r, c.g, c.b, 100)
 * где `c` — HUD_COLOUR_DAMAGE (194, 80, 80 в hudcolor.dat). Colourise ставит
 * ColorTransform с множителем 1 и прибавкой `цвет − 255`, то есть белую
 * вспышку игры красит в цвет урона, а всё, что не белое, уводит в тёмно-
 * красный. Своей картинке и своему цвету вспышки он перебивает то, что видно в
 * предпросмотре (2 ноября 2026, владелец: в игре вместо картинки — красный
 * прямоугольник), поэтому у них в вызов уходит белый — прибавка 0.
 * Образец — аргументы вызова до `healthHitMC` включительно; регистр цвета
 * у Rockstar третий, но ищется любой.
 */
const DAMAGE_FLASH_COLOURISE = [
  [AVM1.PUSH, [100, ANY, "b"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [ANY, "g"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [ANY, "r"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [register(1), "HEALTH_ARMOUR_ABILITY"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["healthHitMC"]],
  AVM1.GET_MEMBER,
];
/* Сколько действий образца — аргументы цвета (`100, b, g, r`). */
const DAMAGE_COLOURISE_ARGUMENTS = 6;
export const valueTail = (previous, current) => [
  [AVM1.PUSH, [register(1), previous, register(1), current]],
  AVM1.GET_MEMBER,
  AVM1.SET_MEMBER,
];
/*
 * `this.HEALTH_ARMOUR_BAR_MC = this.HEALTH_ARMOUR_ABILITY.healthArmourMC` —
 * место, где класс запоминает спрайт полос активного кадра.
 *
 * До него `this.HEALTH_ARMOUR_BAR_MC` не существует, и всё, что через него
 * пишут, уходит в никуда. Первое значение цифр ставится сразу после этой
 * строки; раньше оно ставилось после показа контейнера
 * (`HEALTH_ARMOUR_ABILITY._visible = true`), а это на тысячу байт раньше —
 * и в игре цифры не появлялись до первого изменения здоровья, а при полном
 * HP не появлялись вовсе. Та же строка выполняется при каждой смене кадра
 * (малый радар ↔ развёрнутый), поэтому цифры не теряются и там.
 */
const BIND_BARS = [
  [
    AVM1.PUSH,
    [register(1), "HEALTH_ARMOUR_BAR_MC", register(1), "HEALTH_ARMOUR_ABILITY"],
  ],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["healthArmourMC"]],
  AVM1.GET_MEMBER,
  AVM1.SET_MEMBER,
];

/**
 * Прозрачность элемента (`layout.widgets[id].opacity`, 0…1) множителем альфы на размещении: цифры и значки; единица — без
 * преобразования, файл прежний байт в байт (21.11.2026). Полосы красит общая `effects.barOpacity`.
 */
const widgetAlphaTransform = (widget) =>
  Number.isFinite(widget?.opacity) && widget.opacity < 1
    ? {
        mult: [256, 256, 256, Math.max(0, Math.round(widget.opacity * 256))],
      }
    : null;

export const MINIMAP_NUMBER_FIELDS = Object.freeze({
  health: "astralHealthNum",
  armour: "astralArmourNum",
});

const EQUALS2 = 0x49;
const GET_VARIABLE = AVM1.GET_VARIABLE;

export function matchesExactly(program, pattern, count, label, range = {}) {
  const found = findPattern(program, pattern, range);
  if (found.length !== count)
    throw new Error(
      `В minimap.gfx не найдено место «${label}»: совпадений ${found.length}, ожидалось ${count}.`,
    );
  return found.map((index) => ({
    first: program.records[index],
    last: program.records[index + pattern.length - 1],
    records: program.records.slice(index, index + pattern.length),
  }));
}

/** Класс `MINIMAP`: единственный DoInitAction, где объявлены полосы. */
export function minimapClassTag(buffer) {
  const tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  const found = tags.filter((current) => {
    if (current.code !== SWF_TAG.DO_INIT_ACTION || current.length < 2)
      return false;
    try {
      const { pool } = readProgram(
        buffer,
        current.payloadStart + 2,
        current.end,
      );
      return pool.includes("SETUP_HEALTH_ARMOUR") && pool.includes("MINIMAP");
    } catch {
      return false;
    }
  });
  if (found.length !== 1)
    throw new Error(
      `В minimap.gfx класс MINIMAP найден ${found.length} раз, ожидался один.`,
    );
  return found[0];
}

/* this.HEALTH_ARMOUR_BAR_MC.<field>.text = Math.round(this.<value>) */
function numberTextCode(field, value, pool) {
  return Buffer.concat([
    pushAction([register(1), "HEALTH_ARMOUR_BAR_MC"], pool),
    action(AVM1.GET_MEMBER),
    pushAction([field], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["text", register(1), value], pool),
    action(AVM1.GET_MEMBER),
    pushAction([1, "Math"], pool),
    action(GET_VARIABLE),
    pushAction(["round"], pool),
    action(AVM1.CALL_METHOD),
    action(AVM1.SET_MEMBER),
  ]);
}

/*
 * Счётчик цифр (задача 15 ТЗ 10.10.2026, вечер): «у тебя 100 брони и 100 HP,
 * в тебя стреляют — броня отнимается с сотки до нуля, потом HP».
 *
 * Методы игры пишут цель (`astralHpTarget`, `astralArTarget`) в спрайт
 * полос, а спрайт `astralCounter` в нём каждый кадр ведёт показанное
 * значение к цели на `step` (единиц за кадр при 30 кадрах в секунду) и
 * пишет текст в поля цифр. «Сразу» — шаг больше сотни. Одна общая цифра
 * пишет броню, пока она есть, потом HP — в поле цифр HP.
 *
 * Код кадра — свой блок DoAction без пула строк (строки — внутри Push), с
 * регистрами кадра: r0 — спрайт полос (`_parent`), r1 — «что-то изменилось».
 */
export const MINIMAP_COUNTER = Object.freeze({
  instance: "astralCounter",
  depth: 60,
  health: Object.freeze({ target: "astralHpTarget", shown: "astralHpShown" }),
  armour: Object.freeze({ target: "astralArTarget", shown: "astralArShown" }),
});
const STORE_REGISTER = AVM1.STORE_REGISTER;

/* this.HEALTH_ARMOUR_BAR_MC.<target> = this.<value> */
function counterTargetCode(target, value, pool) {
  return Buffer.concat([
    pushAction([register(1), "HEALTH_ARMOUR_BAR_MC"], pool),
    action(AVM1.GET_MEMBER),
    pushAction([target, register(1), value], pool),
    action(AVM1.GET_MEMBER),
    action(AVM1.SET_MEMBER),
  ]);
}

/* r0.<name> на стеке. */
const barsMember = (name) => [
  pushAction([register(0), name]),
  action(AVM1.GET_MEMBER),
];
const storeRegister = (index) => [
  action(STORE_REGISTER, Buffer.from([index])),
  action(AVM1.POP),
];

/* Шаг одной стороны: показанное — к цели, не дальше неё. */
function counterStepCode({ target, shown }, step, label) {
  const assignShown = (valueCode) => [
    pushAction([register(0), shown]),
    ...valueCode,
    action(AVM1.SET_MEMBER),
  ];
  return [
    ...barsMember(target),
    pushAction([undefined]),
    action(EQUALS2),
    { branch: AVM1.IF, to: `${label}-skip` },
    /* Первый кадр после цели — сразу она: цифры не считают от нуля. */
    ...barsMember(shown),
    pushAction([undefined]),
    action(EQUALS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: `${label}-have` },
    ...assignShown(barsMember(target)),
    pushAction([1]),
    ...storeRegister(1),
    { branch: AVM1.JUMP, to: `${label}-skip` },
    { label: `${label}-have` },
    ...barsMember(shown),
    ...barsMember(target),
    action(EQUALS2),
    { branch: AVM1.IF, to: `${label}-skip` },
    pushAction([1]),
    ...storeRegister(1),
    /* Выше цели больше чем на шаг — вниз на шаг. */
    ...barsMember(shown),
    ...barsMember(target),
    pushAction([step]),
    action(ADD2),
    action(AVM1.GREATER),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: `${label}-below` },
    ...assignShown([
      ...barsMember(shown),
      pushAction([step]),
      action(SUBTRACT),
    ]),
    { branch: AVM1.JUMP, to: `${label}-skip` },
    { label: `${label}-below` },
    /* Ниже цели больше чем на шаг (лечение) — вверх на шаг. */
    ...barsMember(shown),
    ...barsMember(target),
    pushAction([step]),
    action(SUBTRACT),
    action(AVM1.LESS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: `${label}-snap` },
    ...assignShown([...barsMember(shown), pushAction([step]), action(ADD2)]),
    { branch: AVM1.JUMP, to: `${label}-skip` },
    { label: `${label}-snap` },
    ...assignShown(barsMember(target)),
    { label: `${label}-skip` },
  ];
}

/* r0.<field>.text = Math.round(r0.<shown>), если показанное уже есть. */
function counterTextCode(field, shown, label) {
  return [
    ...barsMember(shown),
    pushAction([undefined]),
    action(EQUALS2),
    { branch: AVM1.IF, to: label },
    ...barsMember(field),
    pushAction(["text"]),
    ...barsMember(shown),
    pushAction([1, "Math"]),
    action(GET_VARIABLE),
    pushAction(["round"]),
    action(AVM1.CALL_METHOD),
    action(AVM1.SET_MEMBER),
    { label },
  ];
}

/** Код кадра счётчика: шаги сторон и, если что-то сдвинулось, текст. */
export function counterFrameActions(counter) {
  const steps = [
    pushAction(["_parent"]),
    action(GET_VARIABLE),
    ...storeRegister(0),
    pushAction([0]),
    ...storeRegister(1),
  ];
  if (counter.health)
    steps.push(
      ...counterStepCode(
        MINIMAP_COUNTER.health,
        counter.step,
        "astral-count-hp",
      ),
    );
  if (counter.armour)
    steps.push(
      ...counterStepCode(
        MINIMAP_COUNTER.armour,
        counter.step,
        "astral-count-ar",
      ),
    );
  steps.push(pushAction([register(1)]), action(AVM1.NOT), {
    branch: AVM1.IF,
    to: "astral-count-done",
  });
  if (counter.combined) {
    /* Одна общая цифра: пока брони не меньше половины единицы — броня. */
    steps.push(
      ...barsMember(MINIMAP_COUNTER.armour.shown),
      pushAction([undefined]),
      action(EQUALS2),
      { branch: AVM1.IF, to: "astral-count-hp-text" },
      ...barsMember(MINIMAP_COUNTER.armour.shown),
      pushAction([0.5]),
      action(AVM1.LESS2),
      { branch: AVM1.IF, to: "astral-count-hp-text" },
      ...counterTextCode(
        MINIMAP_NUMBER_FIELDS.health,
        MINIMAP_COUNTER.armour.shown,
        "astral-count-ar-written",
      ),
      { branch: AVM1.JUMP, to: "astral-count-done" },
      { label: "astral-count-hp-text" },
      ...counterTextCode(
        MINIMAP_NUMBER_FIELDS.health,
        MINIMAP_COUNTER.health.shown,
        "astral-count-hp-written",
      ),
    );
  } else {
    if (counter.health)
      steps.push(
        ...counterTextCode(
          MINIMAP_NUMBER_FIELDS.health,
          MINIMAP_COUNTER.health.shown,
          "astral-count-hp-written",
        ),
      );
    if (counter.armour)
      steps.push(
        ...counterTextCode(
          MINIMAP_NUMBER_FIELDS.armour,
          MINIMAP_COUNTER.armour.shown,
          "astral-count-ar-written",
        ),
      );
  }
  steps.push({ label: "astral-count-done" }, action(AVM1.END));
  return assembleActions(steps);
}

/* Спрайт счётчика: два кадра с тем же кодом — он идёт каждый кадр игры. */
function counterSprite(counter, allocate, definitions) {
  const [spriteId] = allocate(1);
  const code = swfTag(SWF_TAG.DO_ACTION, counterFrameActions(counter));
  definitions.push(defineSpriteFrames(spriteId, [[code], [code]]));
  return spriteId;
}

/*
 * Присутствие брони (21.11.2026, «броню показывать, только когда она есть»): метод игры пишет запас брони в \`astralPlateTarget\`, а спрайт \`astralPlateTick\` в спрайте полос каждый
 * кадр ведёт долю \`astralPresence\` (0 — брони нет, 1 — есть) к цели на \`step\` и применяет её: значок, цифры, черта и плашка брони гаснут и зажигаются плавно, а общая плашка
 * (спрайт с кадрами \`PLATE_MORPH_FRAMES\`) сжимается до блока HP и растёт обратно. Запас берётся у счётчика цифр (\`astralArShown\`) — плашка уходит, когда на экране доходит до нуля, —
 * а без счётчика у цели. Первое значение ставится сразу (без перехода).
 */
export const MINIMAP_PLATE = Object.freeze({
  tick: "astralPlateTick",
  tickDepth: 61,
  target: "astralPlateTarget",
  presence: "astralPresence",
  applied: "astralPresenceApplied",
  shared: "astralPlate_shared",
  own: "astralPlate_armour",
  divider: "astralPlateDivider",
  icon: "astralArmourIcon",
});
/** Кадров у общей плашки: первый — плашка с бронёй, последний — только вокруг HP. */
export const PLATE_MORPH_FRAMES = 13;
/** Кадров игры на переход «броня есть / нет» при скорости анимации 100 %. */
export const PLATE_PRESENCE_FRAMES = 12;

/** Доля присутствия за кадр при скорости анимации \`speed\` (проценты): 100 — 12 кадров на переход, 200 — вдвое быстрее (6), 50 — вдвое медленнее (24). */
export const platePresenceStep = (speed = 100) =>
  Math.round((Math.max(1, Number(speed) || 100) / 100 / PLATE_PRESENCE_FRAMES) * 1e4) / 1e4;

/**
 * Код кадра тика присутствия. \`nodes\` — \`[{ name, alpha }]\`: клипы спрайта полос, чья прозрачность идёт от 0 до \`alpha\` (единиц, 0…1) вместе с бронёй; \`morph\` — имя спрайта общей
 * плашки с \`PLATE_MORPH_FRAMES\` кадрами или \`null\`.
 */
export function plateTickActions({ step, nodes = [], morph = null }) {
  const steps = [
    pushAction(["_parent"]),
    action(GET_VARIABLE),
    ...storeRegister(0),
    ...barsMember(MINIMAP_COUNTER.armour.shown),
    pushAction([undefined]),
    action(EQUALS2),
    { branch: AVM1.IF, to: "astral-plate-use-target" },
    ...barsMember(MINIMAP_COUNTER.armour.shown),
    ...storeRegister(2),
    { branch: AVM1.JUMP, to: "astral-plate-have" },
    { label: "astral-plate-use-target" },
    ...barsMember(MINIMAP_PLATE.target),
    ...storeRegister(2),
    { label: "astral-plate-have" },
    pushAction([register(2)]),
    pushAction([undefined]),
    action(EQUALS2),
    { branch: AVM1.IF, to: "astral-plate-done" },
    /* r3 — куда идти: брони меньше половины единицы — нет. */
    pushAction([register(2)]),
    pushAction([0.5]),
    action(AVM1.LESS2),
    { branch: AVM1.IF, to: "astral-plate-gone" },
    pushAction([1]),
    ...storeRegister(3),
    { branch: AVM1.JUMP, to: "astral-plate-goal" },
    { label: "astral-plate-gone" },
    pushAction([0]),
    ...storeRegister(3),
    { label: "astral-plate-goal" },
    /* r1 — доля сейчас (у кадра DoAction только регистры 0…3: четвёртого нет); первого значения ещё нет — сразу цель. */
    ...barsMember(MINIMAP_PLATE.presence),
    ...storeRegister(1),
    pushAction([register(1)]),
    pushAction([undefined]),
    action(EQUALS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "astral-plate-known" },
    pushAction([register(3)]),
    ...storeRegister(1),
    { label: "astral-plate-known" },
    pushAction([register(3)]),
    pushAction([register(1)]),
    action(AVM1.GREATER),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "astral-plate-down" },
    pushAction([register(1)]),
    pushAction([step]),
    action(ADD2),
    ...storeRegister(1),
    pushAction([register(1)]),
    pushAction([register(3)]),
    action(AVM1.GREATER),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "astral-plate-set" },
    pushAction([register(3)]),
    ...storeRegister(1),
    { branch: AVM1.JUMP, to: "astral-plate-set" },
    { label: "astral-plate-down" },
    pushAction([register(3)]),
    pushAction([register(1)]),
    action(AVM1.LESS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "astral-plate-set" },
    pushAction([register(1)]),
    pushAction([step]),
    action(SUBTRACT),
    ...storeRegister(1),
    pushAction([register(1)]),
    pushAction([register(3)]),
    action(AVM1.LESS2),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: "astral-plate-set" },
    pushAction([register(3)]),
    ...storeRegister(1),
    { label: "astral-plate-set" },
    /* Применено то же — ничего не трогать. */
    ...barsMember(MINIMAP_PLATE.applied),
    pushAction([register(1)]),
    action(EQUALS2),
    { branch: AVM1.IF, to: "astral-plate-done" },
    pushAction([register(0), MINIMAP_PLATE.presence, register(1)]),
    action(AVM1.SET_MEMBER),
    pushAction([register(0), MINIMAP_PLATE.applied, register(1)]),
    action(AVM1.SET_MEMBER),
  ];
  for (const { name, alpha } of nodes)
    steps.push(
      ...barsMember(name),
      pushAction(["_alpha"]),
      pushAction([register(1)]),
      pushAction([Math.round(alpha * 10000) / 100]),
      action(MULTIPLY),
      action(AVM1.SET_MEMBER),
    );
  if (morph)
    steps.push(
      /* Кадр общей плашки: 1 + round((1 − доля) · (кадров − 1)). */
      pushAction([1]),
      pushAction([register(1)]),
      action(SUBTRACT),
      pushAction([PLATE_MORPH_FRAMES - 1]),
      action(MULTIPLY),
      pushAction([1, "Math"]),
      action(GET_VARIABLE),
      pushAction(["round"]),
      action(AVM1.CALL_METHOD),
      pushAction([1]),
      action(ADD2),
      pushAction([1]),
      ...barsMember(morph),
      pushAction(["gotoAndStop"]),
      action(AVM1.CALL_METHOD),
      action(AVM1.POP),
    );
  steps.push({ label: "astral-plate-done" }, action(AVM1.END));
  return assembleActions(steps);
}

/** Спрайт тика: два кадра с тем же кодом — он идёт каждый кадр игры. */
function plateTickSprite(plan, allocate, definitions) {
  const [spriteId] = allocate(1);
  const code = swfTag(SWF_TAG.DO_ACTION, plateTickActions(plan));
  definitions.push(defineSpriteFrames(spriteId, [[code], [code]]));
  return spriteId;
}

const lerpContours = (from, to, amount) =>
  from.map((contour, at) =>
    contour.map(([x, y], index) => [
      x + (to[at][index][0] - x) * amount,
      y + (to[at][index][1] - y) * amount,
    ]),
  );

/** Контуры одного строения (столько же контуров и точек) — между такими можно вести плашку кадр за кадром. */
const sameOutline = (first, second) =>
  first.length === second.length &&
  first.every((contour, at) => contour.length === second[at].length);

/** Общая плашка с кадрами: \`full\` — вокруг обоих блоков, \`hp\` — только вокруг HP; точки в твипах. Первый кадр останавливает спрайт. */
function plateMorphSprite(full, hp, colour, allocate, definitions) {
  const frames = [];
  for (let step = 0; step < PLATE_MORPH_FRAMES; step += 1) {
    const [shapeId] = allocate(1);
    definitions.push(
      definePolygonsShape(
        shapeId,
        lerpContours(full, hp, step / (PLATE_MORPH_FRAMES - 1)),
        colour,
      ),
    );
    frames.push(
      step === 0
        ? [
            swfTag(SWF_TAG.DO_ACTION, Buffer.from([0x07, 0x00])),
            placeObject2({ depth: 1, characterId: shapeId }),
          ]
        : [placeObject2({ depth: 1, move: true, characterId: shapeId })],
    );
  }
  const [spriteId] = allocate(1);
  definitions.push(defineSpriteFrames(spriteId, frames));
  return spriteId;
}

/** Нужно ли присутствие брони: включено и есть что гасить (значок или цифры брони). */
export function minimapPresenceActive(configuration) {
  const { effects, layout } = configuration;
  return (
    effects.armourOnlyWhenPresent === true &&
    Boolean(layout.widgets.armorIcon.visible || layout.widgets.armorNumber.visible)
  );
}

/* Код, который выполняется, только если значение уже известно: до первого
   SET_PLAYER_* в поле цифр иначе встало бы «NaN». */
function guardedCode(value, code, pool, label) {
  return [
    pushAction([register(1), value], pool),
    action(AVM1.GET_MEMBER),
    pushAction([undefined], pool),
    action(EQUALS2),
    { branch: AVM1.IF, to: label },
    code,
    { label },
  ];
}

/*
 * Анимированная заливка полос (задача 8 ТЗ 05.10.2026).
 *
 * Штатная фигура полосы становится маской анимации (см. `buildFillSprite`),
 * и всё, что игра делает с фигурой, кроме длины, анимации надо повторить:
 *
 *  • видимость: игра прячет полосу (`this.HEALTH._visible = false` при нуле
 *    HP, `this.ARMOUR._visible = false` без брони), а маска прячет только
 *    себя — за каждой такой строкой ставится та же видимость анимации;
 *  • малое HP: игра красит фигуру в `colourRed`, а фигура-маска не видна —
 *    у анимации HP два слоя, обычный и умноженный на цвет малого HP, и в
 *    конце `SET_PLAYER_HEALTH` виден тот, что отвечает здоровью, с тем же
 *    порогом, что у игры.
 */
export const MINIMAP_FILL_INSTANCES = Object.freeze({
  health: "astralHealthFill",
  armour: "astralArmourFill",
  normal: "astralNormal",
  mid: "astralMid",
  low: "astralLow",
});
const MULTIPLY = 0x0c;
const AND = 0x10;
const BAR_MEMBERS = Object.freeze({ health: "HEALTH", armour: "ARMOUR" });

/* this.HEALTH_ARMOUR_BAR_MC.<анимация>[.<слой>] на стеке. */
const fillPath = (fill, layer, pool) => [
  pushAction([register(1), "HEALTH_ARMOUR_BAR_MC"], pool),
  action(AVM1.GET_MEMBER),
  pushAction([fill], pool),
  action(AVM1.GET_MEMBER),
  ...(layer ? [pushAction([layer], pool), action(AVM1.GET_MEMBER)] : []),
];

/*
 * Слои порогов полосы (задача 8): виден слой того порога, в котором сейчас
 * запас, — `_alpha = (условие) × непрозрачность`. У HP малый порог — как у
 * игры (`> порога` — не мало), середина — «ниже стольких процентов»; у брони
 * оба — «ниже». `layers` — какие слои есть в спрайте заливки.
 */
function tierFillCode(side, effects, layers, opacity, pool) {
  const health = side === "health";
  const value = health ? "currentHealthValue" : "currentArmourValue";
  const instance = MINIMAP_FILL_INSTANCES[health ? "health" : "armour"];
  const low = Math.round(
    health ? effects.lowHealthThreshold : effects.armorLowThreshold,
  );
  const mid = Math.round(
    health ? effects.healthMidThreshold : effects.armorMidThreshold,
  );
  /* `prefix` уходит в тот же Push, что и поле, — так пишет и компилятор
     Rockstar (`Push "_alpha", this, "currentHealthValue"`). */
  const compare = (threshold, code, prefix = []) => [
    pushAction([...prefix, register(1), value], pool),
    action(AVM1.GET_MEMBER),
    pushAction([threshold], pool),
    action(code),
  ];
  /* HP: «не мало» — `> порога`; брони: «не мало» — не `< порога`. */
  const notLow = (prefix) =>
    health
      ? compare(low, AVM1.GREATER, prefix)
      : [...compare(low, AVM1.LESS2, prefix), action(AVM1.NOT)];
  const isLow = (prefix) =>
    health
      ? [...compare(low, AVM1.GREATER, prefix), action(AVM1.NOT)]
      : compare(low, AVM1.LESS2, prefix);
  const aboveLow = (prefix) =>
    layers.low ? notLow(prefix) : [pushAction([...prefix, true], pool)];
  const conditions = {
    normal: (prefix) =>
      layers.mid
        ? [
            ...aboveLow(prefix),
            ...compare(mid, AVM1.LESS2),
            action(AVM1.NOT),
            action(AND),
          ]
        : notLow(prefix),
    mid: (prefix) => [
      ...aboveLow(prefix),
      ...compare(mid, AVM1.LESS2),
      action(AND),
    ],
    low: isLow,
  };
  const parts = [];
  for (const name of ["normal", "mid", "low"]) {
    if (!layers[name]) continue;
    parts.push(
      ...fillPath(instance, MINIMAP_FILL_INSTANCES[name], pool),
      ...conditions[name](["_alpha"]),
      pushAction([opacity], pool),
      action(MULTIPLY),
      action(AVM1.SET_MEMBER),
    );
  }
  return Buffer.concat(parts);
}

/*
 * ---------------------------------------------------------------------------
 * Вылетающие цифры урона (задача 8 ТЗ 10.10.2026).
 * ---------------------------------------------------------------------------
 *
 * Дописываются в конец `SET_PLAYER_HEALTH` / `SET_PLAYER_ARMOUR` перед
 * строкой `this.previous… = this.current…`: там «было» ещё прежнее, а «стало»
 * — новое (`this.current… = r2` строкой выше), и урон — их разница.
 *
 * В спрайте полос по три своих спрайта на вид (урон HP, лечение, урон
 * брони) — надпись, которая кадрами вылетает (вверх, вниз, вспышкой или в
 * сторону — `floatStyle`) и гаснет; дописка пишет в следующий по кругу текст
 * и запускает его с кадра 2.
 *
 * Ступеней полос («цвет по запасу») больше нет — сняты в задаче 15 ТЗ
 * 10.10.2026 (вечер): методы игры полосы своим цветом не перекрашивают.
 */
const SUBTRACT = 0x0b;
const ADD2 = 0x47;
const MODULO = 0x3f;
const BIT_OR = 0x61;
export const MINIMAP_FLOAT_SLOTS = 3;
export const MINIMAP_FLOAT_KINDS = Object.freeze({
  damage: Object.freeze({
    prefix: "astralFloatHp",
    sign: "-",
    colorKey: "damageNumberColor",
    widget: "healthBar",
    depth: 40,
  }),
  heal: Object.freeze({
    prefix: "astralFloatHeal",
    sign: "+",
    colorKey: "healNumberColor",
    widget: "healthBar",
    depth: 44,
  }),
  armour: Object.freeze({
    prefix: "astralFloatAr",
    sign: "-",
    colorKey: "armorDamageNumberColor",
    widget: "armorBar",
    depth: 48,
  }),
});

/* Какие цифры вылетают — по выключателям работы. */
export function minimapFloatKinds(effects) {
  if (!effects.damageNumbers) return [];
  return [
    effects.floatingHealthDamage && "damage",
    effects.floatingHeal && "heal",
    effects.floatingArmorDamage && "armour",
  ].filter(Boolean);
}

const member = (name, pool) => [
  pushAction([register(1), name], pool),
  action(AVM1.GET_MEMBER),
];

/* this.HEALTH_ARMOUR_BAR_MC[<prefix> + this.<prefix>Slot] на стеке. */
const floatSlotPath = (prefix, pool) => [
  ...member("HEALTH_ARMOUR_BAR_MC", pool),
  pushAction([prefix], pool),
  ...member(`${prefix}Slot`, pool),
  action(ADD2),
  action(AVM1.GET_MEMBER),
];

/* Следующая надпись по кругу: кадр 2 и текст «знак + число». */
function floatSpawnCode(kind, value, pool) {
  const { prefix, sign } = MINIMAP_FLOAT_KINDS[kind];
  return [
    pushAction([register(1), `${prefix}Slot`], pool),
    ...member(`${prefix}Slot`, pool),
    pushAction([0], pool),
    action(BIT_OR),
    pushAction([1], pool),
    action(ADD2),
    pushAction([MINIMAP_FLOAT_SLOTS], pool),
    action(MODULO),
    action(AVM1.SET_MEMBER),
    pushAction([2, 1], pool),
    ...floatSlotPath(prefix, pool),
    pushAction(["gotoAndPlay"], pool),
    action(AVM1.CALL_METHOD),
    action(AVM1.POP),
    ...floatSlotPath(prefix, pool),
    pushAction(["t"], pool),
    action(AVM1.GET_MEMBER),
    pushAction(["text", sign], pool),
    ...value,
    pushAction([1, "Math"], pool),
    action(GET_VARIABLE),
    pushAction(["round"], pool),
    action(AVM1.CALL_METHOD),
    action(ADD2),
    action(AVM1.SET_MEMBER),
  ];
}

/*
 * Урон и лечение: `this.astralDelta = было − стало`; урон (> 0,5) и лечение
 * (от двух процентов) — каждый своей надписью. До первого значения «было»
 * нет — молчим. Порог лечения — от сюжета: игра сама поднимает HP до
 * половины по проценту, и каждый такой шаг сыпал «+1» (кадры в игре
 * 10.10.2026); аптечка и еда дают десятки.
 */
const FLOAT_DAMAGE_MIN = 0.5;
const FLOAT_HEAL_MIN = 1.5;

function floatCode(kinds, { previous, current, damage, heal, label }, pool) {
  const steps = [
    ...member(previous, pool),
    pushAction([undefined], pool),
    action(EQUALS2),
    { branch: AVM1.IF, to: `${label}-done` },
    pushAction([register(1), "astralDelta"], pool),
    ...member(previous, pool),
    ...member(current, pool),
    action(SUBTRACT),
    action(AVM1.SET_MEMBER),
  ];
  if (damage && kinds.includes(damage))
    steps.push(
      ...member("astralDelta", pool),
      pushAction([FLOAT_DAMAGE_MIN], pool),
      action(AVM1.GREATER),
      action(AVM1.NOT),
      { branch: AVM1.IF, to: `${label}-heal` },
      ...floatSpawnCode(damage, member("astralDelta", pool), pool),
      { branch: AVM1.JUMP, to: `${label}-done` },
    );
  steps.push({ label: `${label}-heal` });
  if (heal && kinds.includes(heal))
    steps.push(
      ...member("astralDelta", pool),
      pushAction([-FLOAT_HEAL_MIN], pool),
      action(AVM1.LESS2),
      action(AVM1.NOT),
      { branch: AVM1.IF, to: `${label}-done` },
      ...floatSpawnCode(
        heal,
        [
          pushAction([0], pool),
          ...member("astralDelta", pool),
          action(SUBTRACT),
        ],
        pool,
      ),
    );
  steps.push({ label: `${label}-done` });
  return steps;
}

/* `this.HEALTH._visible = …` — строка, где игра показывает или прячет полосу. */
const barVisibility = (member) => [
  [AVM1.PUSH, [register(1), member]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_visible", ANY]],
  AVM1.SET_MEMBER,
];

function patchMinimapActionScript(
  buffer,
  configuration,
  { numbers, counter = null, fills = {}, presence = false },
) {
  const classTag = minimapClassTag(buffer);
  const program = readProgram(buffer, classTag.payloadStart + 2, classTag.end);
  const setup = findMethod(program, "SETUP_HEALTH_ARMOUR");
  const health = findMethod(program, "SET_PLAYER_HEALTH");
  const { effects } = configuration;
  const edits = [];
  const original = (match) =>
    buffer.subarray(match.first.offset, match.last.end);

  for (const call of HUD_COLOUR_CALLS) {
    const [match] = matchesExactly(
      program,
      hudColourCall(call.member, call.hud),
      1,
      `цвет ${call.member}`,
      { from: setup.start, to: setup.end },
    );
    const [red, green, blue] = hexToRgb(effects[call.effect]);
    edits.push({
      start: match.first.offset,
      end: match.last.end,
      replacement: Buffer.concat([
        pushAction(
          [register(1), call.member, "r", red, "g", green, "b", blue, 3],
          program.pool,
        ),
        action(AVM1.INIT_OBJECT),
        action(AVM1.SET_MEMBER),
      ]),
    });
  }

  for (const match of matchesExactly(
    program,
    LOW_HEALTH_COMPARISON,
    2,
    "порог низкого здоровья",
    { from: health.start, to: health.end },
  ))
    edits.push({
      start: match.first.offset,
      end: match.first.end,
      replacement: pushAction(
        [register(2), Math.round(effects.lowHealthThreshold)],
        program.pool,
      ),
    });

  const [flash] = matchesExactly(
    program,
    DAMAGE_FLASH_ALPHA,
    1,
    "яркость вспышки урона",
  );
  const alphaPush = flash.records[2];
  edits.push({
    start: alphaPush.offset,
    end: alphaPush.end,
    replacement: pushAction(
      [
        "_alpha",
        effects.damageFlash ? Math.round(effects.damageFlashStrength) : 0,
      ],
      program.pool,
    ),
  });

  /* Своя картинка или свой цвет вспышки — без окраски игры цветом урона
     (`DAMAGE_FLASH_COLOURISE`): в игре то же, что в предпросмотре. Базы без
     такой окраски (чужой minimap.gfx) вспышку не красят — править нечего;
     двух окрасок не бывает, и такой файл честнее не трогать. */
  const colourises = minimapDamageKeepsOwnColour(effects)
    ? findPattern(program, DAMAGE_FLASH_COLOURISE, {
        from: setup.start,
        to: setup.end,
      })
    : [];
  if (colourises.length > 1)
    throw new Error(
      `В minimap.gfx не найдено место «окраска вспышки урона в SETUP_HEALTH_ARMOUR»: совпадений ${colourises.length}, ожидалось одно.`,
    );
  if (colourises.length) {
    const [first] = colourises;
    edits.push({
      start: program.records[first].offset,
      end: program.records[first + DAMAGE_COLOURISE_ARGUMENTS - 1].end,
      replacement: pushAction([100, 255, 255, 255], program.pool),
    });
  }

  /*
   * Цифры патчатся поимённо: с седьмой схемы HP и броню включают порознь, и
   * запись в поле, которого в спрайте нет, — обращение к `undefined` посреди
   * метода игры. Поэтому правится ровно то, что в кадре есть.
   *
   * Со счётчиком (счёт вниз или одна общая цифра — задача 15 ТЗ 10.10.2026,
   * вечер) методы игры пишут не текст, а цель счётчика
   * (`this.HEALTH_ARMOUR_BAR_MC.astralHpTarget = this.currentHealthValue`),
   * а текст ведёт сам счётчик в кадре (`counterSprite`). Одной общей цифре
   * нужны обе цели, хотя поле у неё одно.
   */
  const NUMBER_SIDES = [
    {
      on: counter ? counter.health : numbers.health,
      field: MINIMAP_NUMBER_FIELDS.health,
      target: MINIMAP_COUNTER.health.target,
      value: "currentHealthValue",
      previous: "previousHealthValue",
      method: "SET_PLAYER_HEALTH",
      label: "astral-health-ready",
    },
    {
      on: counter ? counter.armour : numbers.armour,
      field: MINIMAP_NUMBER_FIELDS.armour,
      target: MINIMAP_COUNTER.armour.target,
      value: "currentArmourValue",
      previous: "previousArmourValue",
      method: "SET_PLAYER_ARMOUR",
      label: "astral-armour-ready",
    },
  ]
    .filter((side) => side.on)
    .map((side) => ({
      ...side,
      code: counter
        ? counterTargetCode(side.target, side.value, program.pool)
        : numberTextCode(side.field, side.value, program.pool),
    }));

  /* Хвосты методов: цифры и слой малого HP дописываются в одну правку —
     правки одного места не пересекаются. `lead` — то, что встаёт перед
     `this.previous… = this.current…` (там ещё видно «было»). */
  const tails = new Map();
  const tailOf = (method, previous, value) => {
    if (!tails.has(method))
      tails.set(method, { method, previous, value, code: [], lead: [] });
    return tails.get(method);
  };
  /* Вылетающие цифры (задача 8 ТЗ 10.10.2026). */
  const floatKinds = minimapFloatKinds(effects);
  if (floatKinds.includes("damage") || floatKinds.includes("heal"))
    tailOf(
      "SET_PLAYER_HEALTH",
      "previousHealthValue",
      "currentHealthValue",
    ).lead.push(
      ...floatCode(
        floatKinds,
        {
          previous: "previousHealthValue",
          current: "currentHealthValue",
          damage: "damage",
          heal: "heal",
          label: "astral-float-health",
        },
        program.pool,
      ),
    );
  if (floatKinds.includes("armour"))
    tailOf(
      "SET_PLAYER_ARMOUR",
      "previousArmourValue",
      "currentArmourValue",
    ).lead.push(
      ...floatCode(
        floatKinds,
        {
          previous: "previousArmourValue",
          current: "currentArmourValue",
          damage: "armour",
          heal: null,
          label: "astral-float-armour",
        },
        program.pool,
      ),
    );
  for (const side of NUMBER_SIDES)
    tailOf(side.method, side.previous, side.value).code.push(side.code);
  /* Слои порогов анимированной заливки: у HP всегда есть слой малого HP, у
     брони пороги — со ступенями. Виден слой того порога, где сейчас запас. */
  const fillCodes = [];
  for (const [side, method, previous, current] of [
    [
      "health",
      "SET_PLAYER_HEALTH",
      "previousHealthValue",
      "currentHealthValue",
    ],
    [
      "armour",
      "SET_PLAYER_ARMOUR",
      "previousArmourValue",
      "currentArmourValue",
    ],
  ]) {
    if (!fills[side]) continue;
    const layers = minimapFillLayers(effects, side);
    if (!layers.mid && !layers.low) continue;
    const code = tierFillCode(
      side,
      effects,
      layers,
      Math.round(effects.barOpacity),
      program.pool,
    );
    tailOf(method, previous, current).code.push(code);
    fillCodes.push({ side, value: current, code });
  }

  /* Присутствие брони: запас брони — в `astralPlateTarget` на каждое изменение и после смены кадра радара (как цифры). */
  const presenceCodes = [];
  if (presence) {
    const code = counterTargetCode(
      MINIMAP_PLATE.target,
      "currentArmourValue",
      program.pool,
    );
    tailOf("SET_PLAYER_ARMOUR", "previousArmourValue", "currentArmourValue").code.push(code);
    presenceCodes.push(code);
  }

  /* Значки-шкалы (`minimap-vital-icons.js`): на каждое изменение запаса — кадр значка и видимость ступеней; после смены кадра радара — снова (как цифры). */
  const vitalPlan = minimapVitalPlan(configuration);
  const vitalCodes = [];
  const smoothFill = effects.vitalFillSmooth === true;
  for (const plan of vitalPlan
    ? [vitalPlan.health, vitalPlan.armour].filter(Boolean)
    : []) {
    /* Плавная заливка: кадр значка ведёт тик (`vitalSmoothTickActions`), метод игры пишет только цель. */
    const code = Buffer.concat([
      vitalIconCode(plan, program.pool, { frames: !smoothFill }),
      ...(smoothFill
        ? [
            counterTargetCode(
              MINIMAP_VITAL_SMOOTH.goal[plan.key],
              plan.value,
              program.pool,
            ),
          ]
        : []),
    ]);
    tailOf(plan.method, plan.previous, plan.value).code.push(code);
    vitalCodes.push({ plan, code });
  }

  for (const tailEdit of tails.values()) {
    const body =
      tailEdit.method === "SET_PLAYER_HEALTH"
        ? health
        : findMethod(program, tailEdit.method);
    const [tail] = matchesExactly(
      program,
      valueTail(tailEdit.previous, tailEdit.value),
      1,
      `конец ${tailEdit.method}`,
      { from: body.start, to: body.end },
    );
    edits.push({
      start: tail.first.offset,
      end: tail.last.end,
      replacement: Buffer.concat([
        ...(tailEdit.lead.length ? [assembleActions(tailEdit.lead)] : []),
        original(tail),
        ...tailEdit.code,
      ]),
    });
  }

  /* «Скрыть карту»: значки на радаре (бипы, флаги гонок, зоны банд) игра
     кладёт в `CONTENT` сама, поверх маски из graphics.ytd, — без карты они
     висели в воздухе (кадры в игре 10.10.2026). `CONTENT` прячется сразу,
     как класс накрыл его маской; полосы живут в `healthContainer` и
     остаются. */
  if (configuration.layout.map.hidden) {
    const [masked] = matchesExactly(
      program,
      CONTENT_MASKED,
      1,
      "маска содержимого радара в INITIALISE",
    );
    edits.push({
      start: masked.first.offset,
      end: masked.last.end,
      replacement: Buffer.concat([
        original(masked),
        pushAction([register(1), "CONTENT"], program.pool),
        action(AVM1.GET_MEMBER),
        pushAction(["_visible", false], program.pool),
        action(AVM1.SET_MEMBER),
      ]),
    });
  }

  /* Длительность вспышки урона: 2100 мс работы — вид игры (1,5 с твина и
     0,2 с задержки), остальное умножает длительность твина в той же доле —
     какую бы длительность ни передала игра. */
  if (effects.damageFlashDurationMs !== DEFAULT_FLASH_MS) {
    const flashMethod = findMethod(program, "SET_HEALTH_DAMAGE_VISIBLE");
    const [tween] = matchesExactly(
      program,
      FLASH_TWEEN,
      1,
      "длительность вспышки урона",
      {
        from: flashMethod.start,
        to: flashMethod.end,
      },
    );
    edits.push({
      start: tween.first.offset,
      end: tween.first.end,
      replacement: Buffer.concat([
        pushAction(
          [
            register(2),
            Math.round(
              (effects.damageFlashDurationMs / DEFAULT_FLASH_MS) * 1000,
            ) / 1000,
          ],
          program.pool,
        ),
        action(MULTIPLY),
        pushAction([register(1), "HEALTH_ARMOUR_ABILITY"], program.pool),
      ]),
    });
  }

  if (
    NUMBER_SIDES.length ||
    fillCodes.length ||
    vitalCodes.length ||
    presenceCodes.length
  ) {
    const [bound] = matchesExactly(
      program,
      BIND_BARS,
      1,
      "привязка полос в SETUP_HEALTH_ARMOUR",
      { from: setup.start, to: setup.end },
    );
    edits.push({
      start: bound.first.offset,
      end: bound.last.end,
      replacement: assembleActions([
        original(bound),
        ...NUMBER_SIDES.flatMap((side) =>
          guardedCode(side.value, side.code, program.pool, side.label),
        ),
        ...fillCodes.flatMap((item) =>
          guardedCode(
            item.value,
            item.code,
            program.pool,
            `astral-${item.side}-fill-ready`,
          ),
        ),
        ...vitalCodes.flatMap((item) =>
          guardedCode(
            item.plan.value,
            item.code,
            program.pool,
            `astral-${item.plan.key}-icon-ready`,
          ),
        ),
        ...presenceCodes.flatMap((code) =>
          guardedCode(
            "currentArmourValue",
            code,
            program.pool,
            "astral-plate-target-ready",
          ),
        ),
      ]),
    });
  }

  /* Видимость анимации — за каждой строкой, где игра прячет или
     показывает свою фигуру полосы. Такая строка обязана найтись: без неё
     анимация стояла бы и у пустой полосы. */
  for (const [side, member] of Object.entries(BAR_MEMBERS)) {
    if (!fills[side]) continue;
    const found = findPattern(program, barVisibility(member));
    if (!found.length)
      throw new Error(
        `В minimap.gfx не найдено, где игра прячет полосу ${side === "health" ? "HP" : "брони"} (this.${member}._visible): анимированную заливку не поставить.`,
      );
    for (const index of found) {
      const statement = program.records.slice(index, index + 4);
      const [, visible] = program.pushValues(statement[2]);
      edits.push({
        start: statement[0].offset,
        end: statement[3].end,
        replacement: Buffer.concat([
          buffer.subarray(statement[0].offset, statement[3].end),
          ...fillPath(MINIMAP_FILL_INSTANCES[side], null, program.pool),
          pushAction(["_visible", visible], program.pool),
          action(AVM1.SET_MEMBER),
        ]),
      });
    }
  }

  const actions = rewriteActions(buffer, program.start, program.end, edits, {
    internalBranches:
      NUMBER_SIDES.length > 0 ||
      fillCodes.length > 0 ||
      vitalCodes.length > 0 ||
      presenceCodes.length > 0 ||
      [...tails.values()].some((tail) => tail.lead.length > 0),
  });
  const payload = Buffer.concat([
    buffer.subarray(classTag.payloadStart, classTag.payloadStart + 2),
    actions,
  ]);
  const result = Buffer.concat([
    buffer.subarray(0, classTag.offset),
    swfTag(SWF_TAG.DO_INIT_ACTION, payload),
    buffer.subarray(classTag.end),
  ]);
  result.writeUInt32LE(result.length, 4);
  return result;
}

/*
 * ---------------------------------------------------------------------------
 * Кадр: где что стоит в файле игры.
 * ---------------------------------------------------------------------------
 */

const BAR_INSTANCES = Object.freeze([
  "healthTrough",
  "armourTrough",
  "healthBarRed",
  "healthBar",
  "armourBar",
]);

function exported(index, name) {
  const id = index.exports.get(name);
  const tag = id === undefined ? null : index.definitions.get(id);
  if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error(`В minimap.gfx нет символа «${name}».`);
  return { id, tag };
}

function containerModel(index, sprite, label) {
  const timeline = spriteTimeline(index.buffer, sprite.tag);
  const named = (name) => {
    const found = timeline.filter((tag) => tag.placement?.name === name);
    if (found.length !== 1)
      throw new Error(
        `В minimap.gfx экземпляр «${name}» в ${label} найден ${found.length} раз, ожидался один.`,
      );
    return found[0];
  };
  const wanted = named("wantedOverlaySP");
  const bounds = characterBounds(index, wanted.placement.characterId);
  if (!bounds)
    throw new Error(
      `В minimap.gfx у «wantedOverlaySP» в ${label} нет размера.`,
    );
  const rect = transformRect(
    wanted.placement.matrix || IDENTITY_MATRIX,
    bounds,
  );
  return {
    ...sprite,
    label,
    timeline,
    healthArmour: named("healthArmourMC"),
    barBackground: named("bar_bg"),
    hit: named("healthHitMC"),
    wanted,
    radar: {
      x: rect.xmin,
      y: rect.ymin,
      width: rect.xmax - rect.xmin,
      height: rect.ymax - rect.ymin,
    },
  };
}

/*
 * Чёрная лента под штатными полосами развёрнутого радара (2 ноября 2026, владелец: «при увеличении снизу странная
 * чёрная полоса»).
 *
 * У малого радара лента — своя безымянная фигура под радаром (`strip`), и она прячется вместе со штатными полосами. У
 * развёрнутого её отдельно нет: в minimap.gfx Steam Legacy это вторая заливка той же фигуры, что кладёт светлую плёнку
 * на карту (символ 343: белый 12/255 над радаром 36…153 × 8…128 и чёрный 127/255 на 36,2…153,2 × 124,5…129,5).
 * Полосы уезжали наверх, а лента оставалась внизу поверх карты — 5 точек сцены, на экране 17 точек при 1080p.
 *
 * Находится по сути: безымянная фигура контейнера из одних прямоугольников, один из которых чёрный и лежит у нижнего
 * края радара. Остальные прямоугольники (плёнка) возвращаются одной заливкой; файл другого устройства — `null`, и
 * фигура остаётся как есть.
 */
function bigStripOf(index, big) {
  const radarBottom = big.radar.y + big.radar.height;
  for (const tag of big.timeline) {
    const placement = tag.placement;
    if (!placement || placement.name || placement.characterId === undefined)
      continue;
    const definition = index.definitions.get(placement.characterId);
    const rectangles = definition
      ? readShapeRectangles(index.buffer, definition)
      : null;
    if (!rectangles?.length) continue;
    const isStrip = (item) =>
      item.fill[0] === 0 &&
      item.fill[1] === 0 &&
      item.fill[2] === 0 &&
      item.fill[3] > 0 &&
      item.y >= radarBottom - MINIMAP_TWIPS * 6 &&
      item.height <= MINIMAP_TWIPS * 8;
    const strips = rectangles.filter(isStrip);
    if (!strips.length) continue;
    const kept = rectangles.filter((item) => !isStrip(item));
    const fill = kept[0]?.fill || null;
    if (kept.some((item) => item.fill.join() !== fill.join())) continue;
    return { offset: tag.offset, kept, fill };
  }
  return null;
}

/** Устройство файла, по которому собирается мини-карта. */
export function resolveMinimapModel(buffer) {
  const index = indexSwf(buffer);
  const small = containerModel(
    index,
    exported(index, "HEALTH_ARMOUR_ABILITY_SMALL"),
    "HEALTH_ARMOUR_ABILITY_SMALL",
  );
  const big = containerModel(
    index,
    exported(index, "HEALTH_ARMOUR_ABILITY_BIG"),
    "HEALTH_ARMOUR_ABILITY_BIG",
  );
  /* Под `healthArmourMC` обязан стоять спрайт со штатными экземплярами
     полос — их по именам ищет `SETUP_HEALTH_ARMOUR`. В файле игры это
     `barFrames`, в собранном — спрайт Astral; проверяется суть, а не номер. */
  for (const container of [small, big]) {
    const tag = index.definitions.get(
      container.healthArmour.placement.characterId,
    );
    const names = new Set(
      tag?.code === SWF_TAG.DEFINE_SPRITE
        ? spritePlacements(buffer, tag).map((placement) => placement.name)
        : [],
    );
    for (const name of BAR_INSTANCES)
      if (!names.has(name))
        throw new Error(
          `В minimap.gfx в «healthArmourMC» (${container.label}) нет экземпляра «${name}».`,
        );
  }

  /* Радар малой карты обязан совпасть с геометрией редактора: иначе полосы
     встанут не там, где их видно. Допуск — точка. */
  const expected = {
    x: MINIMAP_RADAR.x * MINIMAP_TWIPS,
    y: MINIMAP_RADAR.y * MINIMAP_TWIPS,
    width: MINIMAP_RADAR.width * MINIMAP_TWIPS,
    height: MINIMAP_RADAR.height * MINIMAP_TWIPS,
  };
  for (const key of Object.keys(expected))
    if (Math.abs(small.radar[key] - expected[key]) > MINIMAP_TWIPS * 1.5)
      throw new Error(
        `В minimap.gfx радар не того размера: ${key} ${Math.round(small.radar[key])} твипов, ожидалось ${expected[key]}.`,
      );

  /* Подложка полос под радаром — безымянная фигура у нижнего края. */
  const radarBottom = small.radar.y + small.radar.height;
  const strip = small.timeline.find((tag) => {
    const placement = tag.placement;
    if (!placement || placement.name || placement.characterId === undefined)
      return false;
    const definition = index.definitions.get(placement.characterId);
    if (!definition || definition.code === SWF_TAG.DEFINE_SPRITE) return false;
    const rect = characterBounds(index, placement.characterId);
    return rect && rect.ymin >= radarBottom - MINIMAP_TWIPS * 2;
  });
  const bigStrip = bigStripOf(index, big);

  /* Пустые символы возможны только в уже собранном файле (спрятанная
     стрелка или N); база для сборки всегда штатная. */
  const pointer = exported(index, "radar_centre");
  const pointerChildren = spritePlacements(buffer, pointer.tag);
  const north = exported(index, "radar_north");
  const northChildren = spritePlacements(buffer, north.tag);

  const damage = index.definitions.get(small.hit.placement.characterId);
  if (!damage || damage.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error("В minimap.gfx вспышка урона «healthHitMC» — не спрайт.");

  const font = index.imports.get("$Font2_cond") || index.imports.get("$Font2");

  return {
    index,
    small,
    big,
    strip,
    bigStrip,
    pointer: { ...pointer, children: pointerChildren },
    north: { ...north, children: northChildren },
    damageSpriteId: small.hit.placement.characterId,
    fontId: font?.id ?? null,
    /* Шрифты HUD, которые фильм игры подключает: узкий цифровой и обычный. */
    fonts: {
      cond: index.imports.get("$Font2_cond")?.id ?? null,
      regular: index.imports.get("$Font2")?.id ?? null,
    },
    stock: {
      smallBarsTop: small.healthArmour.placement.matrix?.ty ?? 0,
      bigBarsTop: big.healthArmour.placement.matrix?.ty ?? 0,
      bigScale: Math.abs(big.healthArmour.placement.matrix?.d ?? 1),
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * Геометрия: доли радара → твипы контейнера.
 * ---------------------------------------------------------------------------
 *
 * Малый радар — ровно то, что видит редактор. Большой (развёрнутый радар)
 * устроен иначе: сам кадр на экране в 2.43 раза крупнее, а радар в нём почти
 * квадратный. Полосы там раскладываются по тем же долям, но толщина и кегль
 * берутся штатным множителем большого радара (у Rockstar это 0.418 — матрица
 * `healthArmourMC`), чтобы на экране они остались той же толщины. Элемент
 * прижимается к тому краю, у которого стоит в малом радаре: полоса «сверху
 * вплотную» и в большом радаре стоит вплотную сверху (вынос за край — в
 * толщинах, а не в долях радара: `@modovik/minimap-contract/big-map`, 10.11.2026,
 * иначе полосы уезжали вверх от карты). Всё, что под радаром
 * (штатная подложка), в большом радаре ложится туда же, где у Rockstar стоят
 * его штатные полосы.
 *
 * Значки и числа (11.11.2026) — не полосы: они в сцене меньше малых в `scale`
 * раз по обеим осям, а те, что в малом радаре лежат вплотную (число в кольце,
 * кольцо над полосой), в большом держатся вместе. Для этого раскладке нужны
 * все элементы сразу: `configuration` и ключ элемента (`key`) в `toTwips`.
 */
function frameFor(model, which, configuration = null) {
  const smallRadar = model.small.radar;
  if (which === "small")
    return {
      radar: smallRadar,
      scale: 1,
      toTwips(widget, { thicknessScale = 1 } = {}) {
        const half = minimapWidgetHalfExtent(widget, thicknessScale);
        return {
          x: smallRadar.x + widget.x * smallRadar.width,
          y: smallRadar.y + widget.y * smallRadar.height,
          length: widget.width * smallRadar.width,
          thickness: widget.height * smallRadar.height * thicknessScale,
          halfX: half.x * smallRadar.width,
          halfY: half.y * smallRadar.height,
        };
      },
    };
  const geometry = {
    small: smallRadar,
    big: model.big.radar,
    scale: model.stock.bigScale,
    smallBarsTop: model.stock.smallBarsTop,
    barsTop: model.stock.bigBarsTop,
  };
  const places = configuration
    ? minimapBigPlaces(configuration.layout.widgets, geometry, {
        thicknessScale: configuration.effects.barThickness / 8,
        /* Места, которые человек поставил на большой карте сам, — главнее правила (`layout.bigPlaces`). */
        custom: configuration.layout.bigPlaces || null,
      })
    : {};
  return {
    radar: model.big.radar,
    scale: model.stock.bigScale,
    /* Одна арифметика с просмотром «большая карта»: `@modovik/minimap-contract/big-map`. */
    toTwips: (widget, { thicknessScale = 1, key = null, kind = "bar" } = {}) =>
      (key && places[key]) ||
      minimapBigPlace(widget, geometry, { thicknessScale, kind }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Спрайт полос.
 * ---------------------------------------------------------------------------
 *
 * Имена экземпляров — штатные: игра сама растягивает заливки (`_xscale` от 0
 * до 100 у HP, до 204.9 у брони в сетевой игре), красит их (`Colourise`) и
 * прячет. Поэтому длина живёт в фигуре, а матрица экземпляра несёт только
 * место и поворот: `_xscale` заменяет масштаб, но поворот сохраняет.
 *
 * Фигуры — как у Rockstar: дорожка серая 204 с прозрачностью 50% (после
 * окраски — тёмный тон цвета полосы), заливка белая, красная полоса урона
 * белая 70%. Прозрачность заливки выбирает человек: штатные 50% — вид самой
 * игры (у Rockstar заливка — белая фигура с альфой 127), 100% — сплошной
 * выбранный цвет. Предпросмотр складывает те же слои, поэтому цвет в
 * редакторе и в игре один.
 *
 * Своя подложка — не штатная дорожка другого цвета. Дорожку игра красит сама
 * (`Colourise` цветом полосы, а при малом здоровье — красным), и любой цвет
 * фигуры она увела бы в тон полосы. Поэтому под штатными именами остаются
 * пустые спрайты — игре есть что красить и растягивать, — а подложку рисует
 * безымянная фигура под ними: её игра не трогает.
 *
 * Контур — тоже безымянная фигура, поверх заливок и во всю длину полосы:
 * заливку игра сжимает (`_xscale`), а рамка полосы стоит на месте. Идёт
 * внутри полосы — см. `minimapFrameRects`.
 *
 * Скрытая полоса — пустой спрайт под тем же именем: прозрачность игра
 * перебивает (`Colourise` ставит `_alpha = 100`), а до пустого спрайта ей
 * дела нет.
 */
const TRACK_FILL = [204, 204, 204, 127];
const DAMAGE_FILL = [255, 255, 255, 180];

/* Порядок слоёв в спрайте полос. Штатные имена игра ищет по имени, а не по
   глубине, поэтому места между ними заняты своими фигурами. */
const BAR_DEPTH = Object.freeze({
  healthTrack: 1,
  armourTrack: 2,
  healthTrough: 3,
  armourTrough: 4,
  healthBarRed: 5,
  healthBar: 7,
  /* Анимированная заливка — сразу над фигурой полосы: та её маска
     (ClipDepth) и открывает ровно эту глубину. */
  healthFill: 8,
  armourBar: 9,
  armourFill: 10,
  healthOutline: 13,
  armourOutline: 14,
  healthIcon: 15,
  armourIcon: 16,
});

function barPieces(frame, widget, thicknessScale, isArmour, key = null) {
  /* `key` — чтобы большая карта взяла место, которое человек поставил на ней сам (`layout.bigPlaces`). */
  const place = frame.toTwips(widget, { thicknessScale, key });
  const shapeLength = isArmour
    ? place.length / MINIMAP_ARMOUR_RUNTIME_SCALE
    : place.length;
  const radians = ((widget.rotation || 0) * Math.PI) / 180;
  const startX = place.x - (place.length / 2) * Math.cos(radians);
  const startY = place.y - (place.length / 2) * Math.sin(radians);
  const matrix = composeMatrix({
    rotation: widget.rotation || 0,
    translateX: startX,
    translateY: startY,
  });
  const height = Math.max(1, place.thickness);
  /* `rectangle` — фигура под штатным именем: игра растягивает её сама, и у
     брони она короче на сетевой множитель. `full` — полоса во всю длину, для
     того, что игра не трогает: своей подложки и контура. */
  const rectangle = {
    x: 0,
    y: -height / 2,
    width: Math.max(1, shapeLength),
    height,
  };
  const full = { ...rectangle, width: Math.max(1, place.length) };
  return { matrix, rectangle, full, place };
}

/*
 * Анимированная заливка полосы (задача 8 ТЗ 05.10.2026).
 *
 * Игра тянет фигуру `healthBar` по `_xscale` и красит её `Colourise`. Эта
 * фигура остаётся на месте и под своим именем, но размещается маской
 * (ClipDepth) на глубину над собой, а там стоит анимация во всю длину
 * полосы: игра сжимает маску — анимация открывается на долю здоровья, сама
 * не сжимаясь. ActionScript игры не меняется, кроме двух дописок
 * (`patchMinimapActionScript`): видимость и слой малого HP.
 *
 * Устройство (`buildFillSprite`):
 *   спрайт «astralHealthFill» (один кадр, на месте полосы)
 *     ├─ «astralNormal»: анимация, два цвета и непрозрачность заливки;
 *     └─ «astralLow» (только HP): та же анимация, умноженная на цвет малого
 *        HP, невидимая, пока здоровье выше порога.
 *   анимация — спрайт на круг кадров: фигура с растром (плитка узора или
 *   лист кадров видео) сдвигается или меняет яркость в каждом кадре.
 *
 * Растр общий у малого и большого радара, фигура и кадры — свои: у них
 * разная длина полосы в твипах.
 */
const FILL_SIDES = Object.freeze([
  Object.freeze({
    side: "health",
    widget: "healthBar",
    effect: "healthFill",
    isArmour: false,
    image: "healthFill",
  }),
  Object.freeze({
    side: "armour",
    widget: "armorBar",
    effect: "armorFill",
    isArmour: true,
    image: "armorFill",
  }),
]);

const contractSide = (side) => (side === "armour" ? "armor" : "health");

/** Какие полосы получают анимацию: видимые, и хоть у одного порога — готовый
    вид или видео (задача 8: у каждого порога своя заливка). */
export function minimapFillSides(configuration) {
  const { widgets } = configuration.layout;
  return FILL_SIDES.filter(
    (item) =>
      widgets[item.widget].visible &&
      minimapBarAnimated(configuration.effects, contractSide(item.side)),
  );
}

/** Слои спрайта заливки: полная всегда; середина и малый запас — когда у
    полосы есть такой порог (у HP малый — всегда, он у игры). */
export function minimapFillLayers(effects, side) {
  const tiers = minimapTierFills(effects, contractSide(side));
  return {
    normal: true,
    mid: Boolean(tiers.mid),
    low: side === "health" || Boolean(tiers.low),
  };
}

/* Цвет порога для слоя ровного цвета. */
function tierColour(effects, side, layer) {
  if (side === "health")
    return {
      normal: effects.healthColor,
      mid: effects.healthMidColor,
      low: effects.lowHealthColor,
    }[layer];
  return {
    normal: effects.armorColor,
    mid: effects.armorMidColor,
    low: effects.armorLowColor,
  }[layer];
}

/* Заливка слоя: полная — заливка полосы, остальные — свои заливки порогов. */
function layerFill(effects, side, layer) {
  const tiers = minimapTierFills(effects, contractSide(side));
  return { normal: tiers.full, mid: tiers.mid, low: tiers.low }[layer];
}

/*
 * Лист кадров видео: кадры сверху вниз, у каждого строка-повтор сверху и
 * снизу. Сглаживание растра на краю кадра берёт соседнюю строку — без
 * повтора по краю полосы проступал бы соседний кадр.
 */
function paddedVideoSheet(sheet, video, label) {
  if (!sheet?.rgba)
    throw new Error(
      `Видео заливки ${label} нет в проекте — загрузите его заново.`,
    );
  if (
    sheet.width !== video.width ||
    sheet.height !== video.height * video.frames
  )
    throw new Error(
      `Лист кадров видео ${label} (${sheet.width}×${sheet.height}) не совпадает с проектом (${video.width}×${video.height} × ${video.frames}).`,
    );
  if (video.width * video.height * video.frames > MINIMAP_FILL_VIDEO.maxPixels)
    throw new RangeError(`Видео заливки ${label} больше предела мини-карты.`);
  const rows = video.height + 2;
  const rowBytes = video.width * 4;
  const source = Buffer.from(
    sheet.rgba.buffer,
    sheet.rgba.byteOffset,
    sheet.rgba.byteLength,
  );
  const out = Buffer.alloc(rowBytes * rows * video.frames);
  for (let frame = 0; frame < video.frames; frame += 1)
    for (let row = 0; row < rows; row += 1) {
      const from =
        frame * video.height + Math.min(video.height - 1, Math.max(0, row - 1));
      source.copy(
        out,
        (frame * rows + row) * rowBytes,
        from * rowBytes,
        (from + 1) * rowBytes,
      );
    }
  return { width: video.width, height: rows * video.frames, rgba: out };
}

/*
 * Растры заливок — по одному на анимированный слой полосы, до спрайтов полос.
 * Слой ровного цвета — фигура цвета порога; слой малого HP с ровным цветом
 * при анимированной полной полосе — та же анимация, умноженная на цвет
 * малого HP (так было с 06.10 и так проверено в игре).
 */
function prepareFillBitmaps(
  model,
  configuration,
  images,
  allocate,
  definitions,
) {
  const { effects } = configuration;
  const thicknessScale = effects.barThickness / 8;
  const plans = {};
  for (const item of minimapFillSides(configuration)) {
    const present = minimapFillLayers(effects, item.side);
    const layers = {};
    for (const name of ["normal", "mid", "low"]) {
      if (!present[name]) continue;
      const fill = layerFill(effects, item.side, name);
      if (!minimapFillActive(fill)) {
        layers[name] =
          name === "low" && item.side === "health" && layers.normal?.fill
            ? { tint: effects.lowHealthColor }
            : { solid: tierColour(effects, item.side, name) };
        continue;
      }
      const [bitmapId] = allocate(1);
      if (fill.mode === "video") {
        const bitmap = paddedVideoSheet(
          images[item.image],
          fill.video,
          item.side === "health" ? "HP" : "брони",
        );
        definitions.push(defineLosslessBitmap(bitmapId, bitmap));
        layers[name] = { fill, bitmapId };
        continue;
      }
      /* Плитке хватает периодов на самую длинную из двух полос (малый и
         большой радар): лишний период ничего не стоит. */
      const periods = Math.max(
        ...["small", "big"].map((which) => {
          const { full } = barPieces(
            frameFor(model, which),
            configuration.layout.widgets[item.widget],
            thicknessScale,
            item.isArmour,
          );
          return minimapFillGeometry(fill.preset, {
            length: full.width,
            thickness: full.height,
          }).periods;
        }),
      );
      const tile = fillTile(fill.preset, periods);
      definitions.push(defineLosslessBitmap(bitmapId, tile));
      layers[name] = { fill, bitmapId, tile };
    }
    plans[item.side] = { ...item, layers };
  }
  return plans;
}

/*
 * Обёртка со слоями порогов — см. комментарий выше. Слои: «astralNormal»
 * (полная полоса), «astralMid» (ниже середины, со ступенями), «astralLow»
 * (малый запас); видимый с начала — только полный, остальные открывает
 * дописка в ActionScript (`tierFillCode`).
 */
function buildFillSprite(plan, pieces, effects, allocate, definitions) {
  const alpha = minimapOpacityToAlpha(effects.barOpacity) / 255;
  const length = pieces.full.width;
  const thickness = pieces.full.height;
  const animations = {};
  const children = [];
  ["normal", "mid", "low"].forEach((name, index) => {
    const layer = plan.layers[name];
    if (!layer) return;
    const shown = name === "normal" ? alpha : 0;
    let characterId;
    let cxform;
    if (layer.fill) {
      characterId = animations[name] = fillAnimation(
        layer,
        pieces,
        allocate,
        definitions,
      );
      cxform = fillOuterTransform(layer.fill, { alpha: shown });
    } else if (layer.tint) {
      characterId = animations.normal;
      cxform = fillOuterTransform(plan.layers.normal.fill, {
        alpha: shown,
        low: layer.tint,
      });
    } else {
      [characterId] = allocate(1);
      definitions.push(
        defineRectangleShape(
          characterId,
          { x: 0, y: -thickness / 2, width: length, height: thickness },
          [...hexToRgb(layer.solid), 255],
        ),
      );
      cxform = alphaOnly(Math.round(shown * 255));
    }
    children.push(
      placeObject2({
        depth: index + 1,
        characterId,
        cxform,
        name: MINIMAP_FILL_INSTANCES[name],
      }),
    );
  });
  const [fillId] = allocate(1);
  definitions.push(defineSprite(fillId, children));
  return fillId;
}

/* Спрайт анимации одного слоя: растр сдвигается или дышит по кадрам. */
function fillAnimation(layer, pieces, allocate, definitions) {
  const length = pieces.full.width;
  const thickness = pieces.full.height;
  const top = -thickness / 2;
  const [shapeId, animationId] = allocate(2);
  const plan = layer;
  let frames;
  if (plan.fill.mode === "video") {
    const { video } = plan.fill;
    const rows = video.height + 2;
    const scaleX = length / video.width;
    const scaleY = thickness / video.height;
    definitions.push(
      defineBitmapRectShape(
        shapeId,
        plan.bitmapId,
        { x: 0, y: top, width: length, height: rows * video.frames * scaleY },
        { a: scaleX, b: 0, c: 0, d: scaleY, tx: 0, ty: top },
      ),
    );
    /* Кадр видео k открывается сдвигом листа вверх на k кадров и строку
       повтора; остальное отрезает маска — сама полоса. */
    const shift = (index) => ({
      ...IDENTITY_MATRIX,
      ty: -(index * rows + 1) * scaleY,
    });
    const order = fillVideoTimeline(video);
    frames = order.map((index, step) => {
      if (step === 0)
        return [
          placeObject2({
            depth: 1,
            characterId: shapeId,
            matrix: shift(index),
          }),
        ];
      return index === order[step - 1]
        ? []
        : [placeObject2({ depth: 1, move: true, matrix: shift(index) })];
    });
  } else {
    const timeline = fillTimeline(plan.fill);
    const { period } = minimapFillGeometry(plan.fill.preset, {
      length,
      thickness,
    });
    const scroll = timeline.kind === "scroll";
    /* Бегущий узор начинается на период раньше полосы: сдвиг к концу на
       период за круг не открывает пустого места. */
    const start = scroll ? -period : 0;
    definitions.push(
      defineBitmapRectShape(
        shapeId,
        plan.bitmapId,
        { x: start, y: top, width: length - start, height: thickness },
        {
          a: period / plan.tile.period,
          b: 0,
          c: 0,
          d: thickness / plan.tile.height,
          tx: start,
          ty: top,
        },
      ),
    );
    frames = timeline.steps.map((step, index) => {
      const matrix = scroll
        ? { ...IDENTITY_MATRIX, tx: step.offset * period }
        : null;
      const cxform =
        timeline.kind === "pulse" ? fillInnerTransform(step.brightness) : null;
      if (index === 0)
        return [
          placeObject2({
            depth: 1,
            characterId: shapeId,
            matrix: matrix || IDENTITY_MATRIX,
            cxform,
          }),
        ];
      return [placeObject2({ depth: 1, move: true, matrix, cxform })];
    });
  }
  definitions.push(defineSpriteFrames(animationId, frames));
  return animationId;
}

function buildBarsSprite(model, frame, configuration, images, allocate) {
  const { widgets } = configuration.layout;
  const { effects } = configuration;
  const thicknessScale = effects.barThickness / 8;
  const definitions = [];
  const children = [];
  const shapeSprite = (rectangle, fill) => {
    const [shapeId, spriteId] = allocate(2);
    definitions.push(
      defineRectangleShape(shapeId, rectangle, fill),
      defineSprite(spriteId, [
        placeObject2({ depth: 1, characterId: shapeId }),
      ]),
    );
    return spriteId;
  };
  const emptySprite = () => {
    const [spriteId] = allocate(1);
    definitions.push(defineSprite(spriteId, []));
    return spriteId;
  };

  const vitalPlan = minimapVitalPlan(configuration);
  const health = barPieces(frame, widgets.healthBar, thicknessScale, false, "healthBar");
  const armour = barPieces(frame, widgets.armorBar, thicknessScale, true, "armorBar");
  const bar = (visible, pieces, fill) =>
    visible ? shapeSprite(pieces.rectangle, fill) : emptySprite();
  const barFill = [255, 255, 255, minimapOpacityToAlpha(effects.barOpacity)];
  const customTrack = effects.trackMode === "custom";
  const bars = [
    {
      visible: widgets.healthBar.visible,
      pieces: health,
      track: BAR_DEPTH.healthTrack,
      outline: BAR_DEPTH.healthOutline,
    },
    {
      visible: widgets.armorBar.visible,
      pieces: armour,
      track: BAR_DEPTH.armourTrack,
      outline: BAR_DEPTH.armourOutline,
    },
  ];

  /* Своя подложка: безымянная фигура во всю длину полосы. Прозрачность 0 —
     фигуры нет вовсе. */
  const trackAlpha = minimapOpacityToAlpha(effects.trackOpacity);
  if (customTrack && trackAlpha > 0)
    for (const { visible, pieces, track } of bars) {
      if (!visible) continue;
      const [shapeId] = allocate(1);
      definitions.push(
        defineRectangleShape(shapeId, pieces.full, [
          ...hexToRgb(effects.trackColor),
          trackAlpha,
        ]),
      );
      children.push(
        placeObject2({
          depth: track,
          characterId: shapeId,
          matrix: pieces.matrix,
        }),
      );
    }

  children.push(
    placeObject2({
      depth: BAR_DEPTH.healthTrough,
      characterId: bar(
        widgets.healthBar.visible && !customTrack,
        health,
        TRACK_FILL,
      ),
      matrix: health.matrix,
      name: "healthTrough",
    }),
    placeObject2({
      depth: BAR_DEPTH.armourTrough,
      characterId: bar(
        widgets.armorBar.visible && !customTrack,
        armour,
        TRACK_FILL,
      ),
      matrix: armour.matrix,
      name: "armourTrough",
    }),
    placeObject2({
      depth: BAR_DEPTH.healthBarRed,
      characterId: bar(widgets.healthBar.visible, health, DAMAGE_FILL),
      matrix: health.matrix,
      name: "healthBarRed",
    }),
    placeObject2({
      depth: BAR_DEPTH.healthBar,
      characterId: bar(widgets.healthBar.visible, health, barFill),
      matrix: health.matrix,
      name: "healthBar",
      clipDepth: images.fills?.health ? BAR_DEPTH.healthFill : 0,
    }),
    placeObject2({
      depth: BAR_DEPTH.armourBar,
      characterId: bar(widgets.armorBar.visible, armour, barFill),
      matrix: armour.matrix,
      name: "armourBar",
      clipDepth: images.fills?.armour ? BAR_DEPTH.armourFill : 0,
    }),
  );
  /* Анимированная заливка — под маской своей полосы (`buildFillSprite`). */
  for (const [side, pieces, depth] of [
    ["health", health, BAR_DEPTH.healthFill],
    ["armour", armour, BAR_DEPTH.armourFill],
  ]) {
    const plan = images.fills?.[side];
    if (!plan) continue;
    children.push(
      placeObject2({
        depth,
        characterId: buildFillSprite(
          plan,
          pieces,
          effects,
          allocate,
          definitions,
        ),
        matrix: pieces.matrix,
        name: MINIMAP_FILL_INSTANCES[side],
      }),
    );
  }

  /* Контур полос: рамка внутри полосы, поверх заливок. В развёрнутом радаре
     линия тоньше на штатный множитель — как и сами полосы. */
  if (effects.barOutline) {
    const line =
      minimapUnitsToScene(effects.barOutlineWidth) *
      MINIMAP_TWIPS *
      frame.scale;
    const fill = [...hexToRgb(effects.barOutlineColor), 255];
    for (const { visible, pieces, outline } of bars) {
      if (!visible) continue;
      const lines = minimapFrameRects(pieces.full, line, {}, "inside");
      if (!lines.length) continue;
      const [shapeId] = allocate(1);
      definitions.push(defineRectanglesShape(shapeId, lines, fill));
      children.push(
        placeObject2({
          depth: outline,
          characterId: shapeId,
          matrix: pieces.matrix,
        }),
      );
    }
  }

  /* Значки на полосах — поверх заливок, в том же спрайте: игра прячет их
     вместе с полосами. Имена свои — игра их не ищет. */
  const iconPlacement = (rect, shapeId, depth, name, color, opacity = 1) => {
    const size = Math.min(rect.width, rect.height);
    return placeObject2({
      depth,
      characterId: shapeId,
      matrix: {
        a: size / IMAGE_SIDE,
        b: 0,
        c: 0,
        d: size / IMAGE_SIDE,
        tx: rect.x - size / 2,
        ty: rect.y - size / 2,
      },
      cxform: solidColor(
        hexToRgb(color),
        opacity < 1 ? Math.round(opacity * 255) : 255,
      ),
      name,
    });
  };
  /* Значок полосы считается от самой полосы в её кадре — у начала, откуда
     растёт заливка, высотой в долю толщины (`MINIMAP_BAR_ICON`). Тот же
     расчёт у предпросмотра (`minimapBarIconRect`). */
  if (effects.barIcons && images.healthIconShape && images.armorIconShape) {
    for (const [key, pieces, shape, depth, name] of [
      [
        "healthBar",
        health,
        images.healthIconShape,
        BAR_DEPTH.healthIcon,
        "astralHealthBarIcon",
      ],
      [
        "armorBar",
        armour,
        images.armorIconShape,
        BAR_DEPTH.armourIcon,
        "astralArmourBarIcon",
      ],
    ]) {
      if (!widgets[key].visible) continue;
      const { place } = pieces;
      const size = place.thickness * MINIMAP_BAR_ICON.size;
      const along =
        -place.length / 2 + place.thickness * MINIMAP_BAR_ICON.inset + size / 2;
      const radians = ((widgets[key].rotation || 0) * Math.PI) / 180;
      children.push(
        iconPlacement(
          {
            x: place.x + along * Math.cos(radians),
            y: place.y + along * Math.sin(radians),
            width: size,
            height: size,
          },
          shape,
          depth,
          name,
          effects.barIconColor,
        ),
      );
    }
  }

  /* Шрифт цифр — один из двух, что фильм игры уже подключает (задача 15 ТЗ
     10.10.2026, вечер): узкий HUD или обычный; нет нужного — тот, что есть. */
  const numberFontId =
    (effects.numberFont === "regular"
      ? model.fonts.regular
      : model.fonts.cond) ?? model.fontId;
  const numberFields = minimapNumberFields(configuration);
  if (minimapShowsNumbers(configuration) && model.fontId !== null) {
    for (const [key, field, colorKey, depth, side] of [
      [
        "healthNumber",
        MINIMAP_NUMBER_FIELDS.health,
        "healthNumberColor",
        20,
        "health",
      ],
      [
        "armorNumber",
        MINIMAP_NUMBER_FIELDS.armour,
        "armorNumberColor",
        21,
        "armour",
      ],
    ]) {
      if (!numberFields[side]) continue;
      const place = frame.toTwips(
        { ...widgets[key], rotation: 0 },
        { key, kind: "mark" },
      );
      const fontHeight =
        minimapUnitsToScene(effects.numberSize) * MINIMAP_TWIPS * frame.scale;
      /* Коробка — из кегля, число по её центру: те же числа рисует редактор,
         и одна работа выглядит одинаково там и в игре. Раньше поле было
         шириной с элемент и прижимало число вправо. */
      const boxHeight =
        fontHeight * MINIMAP_NUMBER_BOX.height +
        4 * MINIMAP_TWIPS * frame.scale;
      const boxWidth = fontHeight * MINIMAP_NUMBER_BOX.width;
      const [textId] = allocate(1);
      definitions.push(
        defineEditText({
          id: textId,
          bounds: {
            xmin: 0,
            xmax: boxWidth,
            ymin: 0,
            ymax: boxHeight,
          },
          fontId: numberFontId,
          fontHeight,
          color: hexToRgb(effects[colorKey]),
          /* По центру коробки — у новых раскладок («Плашка HP»: справа число стояло у края кольца, стенд hpwide12); у прежних вправо, как в beta.108. */
          align: effects.numbersCentred === true ? 2 : 1,
          text: "",
        }),
      );
      children.push(
        placeObject2({
          depth,
          characterId: textId,
          matrix: {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            tx: place.x - boxWidth / 2,
            ty: place.y - boxHeight / 2,
          },
          name: field,
          cxform: widgetAlphaTransform(widgets[key]),
        }),
      );
    }
  }
  if (
    minimapShowsIndicatorIcons(configuration) &&
    images.healthIconShape &&
    images.armorIconShape
  ) {
    for (const [key, shape, colorKey, depth, name] of [
      [
        "healthIcon",
        images.healthIconShape,
        "healthIconColor",
        22,
        "astralHealthIcon",
      ],
      [
        "armorIcon",
        images.armorIconShape,
        "armorIconColor",
        23,
        "astralArmourIcon",
      ],
    ]) {
      if (
        !widgets[key].visible ||
        vitalPlan?.[key === "healthIcon" ? "health" : "armour"]
      )
        continue;
      const rect = minimapIconRect(widgets[key]);
      const place = frame.toTwips(
        { ...rect, rotation: 0 },
        { key, kind: "mark" },
      );
      const sizeTwips =
        Math.min(
          rect.width * MINIMAP_RADAR.width,
          rect.height * MINIMAP_RADAR.height,
        ) *
        MINIMAP_TWIPS *
        frame.scale;
      const iconRect = { x: place.x, y: place.y, width: sizeTwips, height: sizeTwips };
      /* Значок брони-картинка при «броня только когда есть»: именованную фигуру ActionScript не видит, и значок не гас бы вместе с цифрами и плашкой (ревью 22.11, как черта на
         стенде hpwide13). Картинка уходит в клип с тем же именем; прозрачность значка берёт тик (`_alpha`), поэтому внутри она полная. Без этой настройки — как было, байт в байт. */
      if (key === "armorIcon" && frame.scale === 1 && minimapPresenceActive(configuration)) {
        const [spriteId] = allocate(1);
        definitions.push(
          defineSprite(spriteId, [iconPlacement(iconRect, shape, 1, "", effects[colorKey], 1)]),
        );
        children.push(placeObject2({ depth, characterId: spriteId, name }));
        continue;
      }
      children.push(
        iconPlacement(
          iconRect,
          shape,
          depth,
          name,
          effects[colorKey],
          widgets[key].opacity,
        ),
      );
    }
  }

  /* Значки-шкалы вместо картинок (10.11.2026): кадры одного вида у HP и брони общие, место и размер — как у значка-картинки. */
  if (vitalPlan) {
    const cache = new Map();
    for (const [key, side] of [
      ["healthIcon", "health"],
      ["armorIcon", "armour"],
    ]) {
      const plan = vitalPlan[side];
      if (!plan) continue;
      const rect = minimapIconRect(widgets[key]);
      const place = frame.toTwips(
        { ...rect, rotation: 0 },
        { key, kind: "mark" },
      );
      const size =
        Math.min(
          rect.width * MINIMAP_RADAR.width,
          rect.height * MINIMAP_RADAR.height,
        ) *
        MINIMAP_TWIPS *
        frame.scale;
      children.push(
        vitalIconPlacement({
          plan,
          rect: { x: place.x, y: place.y, size },
          track: {
            color: effects.vitalTrackColour,
            opacity: effects.vitalTrackOpacity,
          },
          allocate,
          definitions,
          cache,
          cxform: widgetAlphaTransform(widgets[key]),
        }),
      );
    }
  }

  /* Вылетающие цифры (задача 8 ТЗ 10.10.2026): по три надписи на вид над
     своей полосой; запускает их дописка в методах игры. */
  if (model.fontId !== null)
    for (const kind of minimapFloatKinds(effects)) {
      const spec = MINIMAP_FLOAT_KINDS[kind];
      const place = frame.toTwips({ ...widgets[spec.widget], rotation: 0 });
      const floatId = floatNumberSprite(
        model,
        frame,
        effects,
        kind,
        allocate,
        definitions,
      );
      for (let slot = 0; slot < MINIMAP_FLOAT_SLOTS; slot += 1)
        children.push(
          placeObject2({
            depth: spec.depth + slot,
            characterId: floatId,
            matrix: {
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              tx: place.x,
              ty: place.y - (place.thickness || 0),
            },
            name: `${spec.prefix}${slot}`,
          }),
        );
    }

  /* Плашка под HP и бронёй (21.11.2026, `vital-plate-layout.js`): одна общая или по одной на сторону, черта между блоками. Лежит под значками и цифрами (глубины 11 и 12),
     только на малой карте: на большой места считает `minimapBigPlace`, плашка для неё — отдельный шаг. Без брони (`armourOnlyWhenPresent`) — см. `plateStates`. */
  /* Имя общей плашки с кадрами — для тика присутствия брони (ниже). */
  let morphName = null;
  /* Общая плашка без блока HP: при броне 0 вокруг неё ничего не остаётся — гаснет вместе с бронёй (ревью 22.11). */
  let sharedFadesWithArmour = false;
  if (frame.scale === 1) {
    const layout = vitalPlateLayout(configuration);
    const rgba = (hex, opacity) => [...hexToRgb(hex), Math.round(opacity * 255)];
    const twips = (contours) =>
      contours.map((contour) =>
        contour.map(([x, y]) => [x * MINIMAP_TWIPS, y * MINIMAP_TWIPS]),
      );
    /* «Броня только когда есть» и общая плашка: плашка идёт кадрами от «с бронёй» к «вокруг HP» (`plateMorphSprite`), если контуры того же строения. */
    const presence = minimapPresenceActive(configuration);
    const hpLayout = presence
      ? vitalPlateLayout(configuration, { armour: 0 })
      : null;
    for (const item of layout.plates) {
      const colour = rgba(layout.plate.colour, layout.plate.opacity);
      const hpItem = hpLayout?.plates.find((other) => other.key === item.key);
      if (presence && item.key === "shared" && !hpItem) sharedFadesWithArmour = true;
      let characterId;
      if (
        presence &&
        item.key === "shared" &&
        hpItem &&
        sameOutline(item.contours, hpItem.contours)
      ) {
        characterId = plateMorphSprite(
          twips(item.contours),
          twips(hpItem.contours),
          colour,
          allocate,
          definitions,
        );
        morphName = MINIMAP_PLATE.shared;
      } else {
        /* Фигура в спрайте: по имени из ActionScript достаётся только клип (у фигуры имени нет), а тик присутствия гасит плашку брони через `_alpha`. */
        const [shapeId, spriteId] = allocate(2);
        definitions.push(
          definePolygonsShape(shapeId, twips(item.contours), colour),
          defineSprite(spriteId, [
            placeObject2({ depth: 1, characterId: shapeId }),
          ]),
        );
        characterId = spriteId;
      }
      children.push(
        placeObject2({
          depth: item.side === "armour" ? 12 : 11,
          characterId,
          name: `astralPlate_${item.key}`,
        }),
      );
    }
    if (layout.divider && layout.plate.divider.enabled) {
      const { x1, y1, x2, y2, width } = layout.divider;
      const half = width / 2;
      const [shapeId, spriteId] = allocate(2);
      definitions.push(
        definePolygonsShape(
          shapeId,
          twips([
            layout.divider.vertical
              ? [[x1 - half, y1], [x1 + half, y1], [x2 + half, y2], [x2 - half, y2]]
              : [[x1, y1 - half], [x2, y2 - half], [x2, y2 + half], [x1, y1 + half]],
          ]),
          rgba(layout.plate.divider.colour, layout.plate.divider.opacity),
        ),
        defineSprite(spriteId, [
          placeObject2({ depth: 1, characterId: shapeId }),
        ]),
      );
      /* Клип, а не фигура: именованную фигуру ActionScript не видит, и черта не гасла вместе с броней (стенд hpwide13). */
      children.push(
        placeObject2({ depth: 12, characterId: spriteId, name: MINIMAP_PLATE.divider }),
      );
    }
  }

  /* Плавная заливка значков-шкал: тик ведёт кадр значка к цели (на малой и на большой карте — значки есть в обеих). */
  if (vitalPlan && effects.vitalFillSmooth === true) {
    const plans = [vitalPlan.health, vitalPlan.armour].filter(Boolean);
    children.push(
      placeObject2({
        depth: MINIMAP_VITAL_SMOOTH.tickDepth,
        characterId: vitalSmoothTickSprite(
          plans,
          vitalSmoothEase(effects.vitalAnimSpeed),
          allocate,
          definitions,
        ),
        name: MINIMAP_VITAL_SMOOTH.tick,
      }),
    );
  }

  /* Тик присутствия брони (малая карта): гасит и зажигает значок, цифры, черту и плашку брони, ведёт общую плашку. */
  if (frame.scale === 1 && minimapPresenceActive(configuration)) {
    const layout = vitalPlateLayout(configuration);
    const nodes = [];
    if (widgets.armorIcon.visible)
      nodes.push({
        name: MINIMAP_PLATE.icon,
        alpha: Number.isFinite(widgets.armorIcon.opacity)
          ? widgets.armorIcon.opacity
          : 1,
      });
    if (
      model.fontId !== null &&
      minimapNumberFields(configuration).armour
    )
      nodes.push({
        name: MINIMAP_NUMBER_FIELDS.armour,
        alpha: Number.isFinite(widgets.armorNumber.opacity)
          ? widgets.armorNumber.opacity
          : 1,
      });
    if (layout.divider && layout.plate.divider.enabled)
      nodes.push({ name: MINIMAP_PLATE.divider, alpha: 1 });
    if (layout.plates.some((item) => item.key === "armour"))
      nodes.push({ name: MINIMAP_PLATE.own, alpha: 1 });
    if (sharedFadesWithArmour) nodes.push({ name: MINIMAP_PLATE.shared, alpha: 1 });
    children.push(
      placeObject2({
        depth: MINIMAP_PLATE.tickDepth,
        characterId: plateTickSprite(
          {
            step: platePresenceStep(effects.vitalAnimSpeed),
            nodes,
            morph: morphName,
          },
          allocate,
          definitions,
        ),
        name: MINIMAP_PLATE.tick,
      }),
    );
  }

  /* Счётчик цифр (задача 15 ТЗ 10.10.2026, вечер): невидимый спрайт, чей код
     каждый кадр ведёт цифры к цели. Без полей цифр ему писать некуда. */
  const counter = minimapNumberCounter(configuration);
  if (counter && model.fontId !== null)
    children.push(
      placeObject2({
        depth: MINIMAP_COUNTER.depth,
        characterId: counterSprite(counter, allocate, definitions),
        name: MINIMAP_COUNTER.instance,
      }),
    );

  const [spriteId] = allocate(1);
  definitions.push(defineSprite(spriteId, children));
  return { spriteId, definitions };
}

/* Кадров в секунду у minimap.gfx игры (заголовок SWF, Steam Legacy). */
const MINIMAP_FRAME_RATE = 30;

/*
 * Путь вылетающей цифры по доле полёта `t` (0…1), задача 15 ТЗ 10.10.2026,
 * вечер: смещение в высотах и ширинах надписи, масштаб и прозрачность. Те
 * же движения рисует предпросмотр (`mmc-float-*` в minimap-customizer.css).
 *   rise — вверх на две с небольшим высоты, чуть растёт (как было с утра);
 *   fall — вниз и чуть мельче; pop — вспышкой на месте; side — вправо-вверх.
 */
const FLOAT_PATHS = Object.freeze({
  rise: (t) => ({ dx: 0, dy: -2.2 * (1 - (1 - t) ** 2), scale: 1 + 0.15 * t }),
  fall: (t) => ({ dx: 0, dy: 1.6 * (1 - (1 - t) ** 2), scale: 1 - 0.1 * t }),
  pop: (t) => ({
    dx: 0,
    dy: 0,
    scale: t < 0.2 ? 0.6 + (0.8 * t) / 0.2 : 1.4 - 0.35 * ((t - 0.2) / 0.8),
  }),
  side: (t) => ({
    dx: 0.7 * (1 - (1 - t) ** 2),
    dy: -0.9 * (1 - (1 - t) ** 2),
    scale: 1 + 0.05 * t,
  }),
});

/*
 * Надпись вылетающей цифры: кадр 1 — поле «t» прозрачное и стоп; дальше
 * поле летит своим путём (`floatStyle`) и гаснет за длительность работы;
 * последний кадр снова прозрачный и стоп. Текст пишет дописка после
 * `gotoAndPlay(2)`.
 */
function floatNumberSprite(model, frame, effects, kind, allocate, definitions) {
  const spec = MINIMAP_FLOAT_KINDS[kind];
  const fontHeight =
    minimapUnitsToScene(effects.damageNumberSize) * MINIMAP_TWIPS * frame.scale;
  const width = fontHeight * 3.4;
  const height = fontHeight * 1.35;
  const rise = fontHeight * 2.2;
  const [textId, spriteId] = allocate(2);
  definitions.push(
    defineEditText({
      id: textId,
      bounds: { xmin: 0, xmax: width, ymin: 0, ymax: height },
      fontId: model.fontId,
      fontHeight,
      color: hexToRgb(effects[spec.colorKey]),
      align: 1,
      text: "",
    }),
  );
  const steps = Math.max(
    6,
    Math.min(
      90,
      Math.round((effects.damageNumberDurationMs / 1000) * MINIMAP_FRAME_RATE),
    ),
  );
  const stop = swfTag(SWF_TAG.DO_ACTION, Buffer.from([0x07, 0x00]), false);
  const path = FLOAT_PATHS[effects.floatStyle] || FLOAT_PATHS.rise;
  const placed = (t, first = false) => {
    const alpha =
      t <= 0
        ? 0
        : t < 0.12
          ? t / 0.12
          : Math.max(0, 1 - ((t - 0.12) / 0.88) ** 2);
    const at = path(Math.max(0, t));
    const scale = at.scale;
    return placeObject2({
      depth: 1,
      ...(first ? { characterId: textId, name: "t" } : { move: true }),
      matrix: {
        a: scale,
        b: 0,
        c: 0,
        d: scale,
        tx: (-width / 2) * scale + at.dx * width,
        ty: (-height / 2) * scale + (at.dy * rise) / 2.2,
      },
      cxform: { mult: [256, 256, 256, Math.round(alpha * 256)] },
    });
  };
  const frames = [[placed(0, true), stop]];
  for (let step = 1; step <= steps; step += 1)
    frames.push(step === steps ? [placed(1), stop] : [placed(step / steps)]);
  definitions.push(defineSpriteFrames(spriteId, frames));
  return spriteId;
}

/*
 * Обводка карты — фигура в самом контейнере, а не в спрайте полос: полосы
 * игра умеет прятать отдельно (`SET_HEALTH_ARMOUR_BAR_VISIBLE`,
 * `HIDE_HEALTH_ARMOUR`), а рамка карты обязана остаться. Линии идут снаружи
 * радара, который компилятор нашёл по `wantedOverlaySP`, — по нему же игра
 * кладёт вспышку розыска ровно поверх карты. В развёрнутом радаре линия
 * тоньше на штатный множитель, чтобы на экране остаться той же толщины.
 *
 * Глубина — свободная прямо под полосами: полоса, вынесенная на поле сцены,
 * ложится поверх рамки, а не под неё.
 */
function outlineShape(container, scale, configuration, allocate, definitions) {
  const { outline } = configuration.frame;
  if (!outline.enabled) return null;
  const lines = minimapFrameRects(
    container.radar,
    minimapUnitsToScene(outline.width) * MINIMAP_TWIPS * scale,
    outline,
    "outside",
  );
  if (!lines.length) return null;
  const [shapeId] = allocate(1);
  definitions.push(
    defineRectanglesShape(shapeId, lines, [
      ...hexToRgb(outline.color),
      minimapOpacityToAlpha(outline.opacity),
    ]),
  );
  return shapeId;
}

function freeDepthUnder(container, depth, taken = []) {
  const used = new Set([
    ...container.timeline
      .filter((tag) => tag.placement)
      .map((tag) => tag.placement.depth),
    ...taken,
  ]);
  for (let candidate = depth - 1; candidate >= 1; candidate -= 1)
    if (!used.has(candidate)) return candidate;
  for (let candidate = depth + 1; candidate < 0xffff; candidate += 1)
    if (!used.has(candidate)) return candidate;
  throw new Error(
    `В minimap.gfx в ${container.label} не осталось свободной глубины для обводки.`,
  );
}

/*
 * ---------------------------------------------------------------------------
 * Свои надписи и картинки (задача 1 ТЗ 17.10.2026).
 * ---------------------------------------------------------------------------
 *
 * Слой «astralOverlays» в самом контейнере мини-карты, под полосами: он
 * поверх карты, едет с ней и прячется вместе с радаром, а HP остаются
 * сверху. Надпись — поле текста со шрифтом HUD фильма; картинка — растр в
 * фильме. GIF — лист кадров с полем в точку вокруг каждого кадра (сглаживание
 * растра на краю кадра иначе брало бы соседний) и по фигуре на кадр; спрайт
 * меняет фигуру на своих кадрах фильма (30 в секунду) и крутится сам, как
 * мигающие точки игры.
 */
function paddedOverlaySheet(sheet, image, label) {
  if (!sheet?.rgba)
    throw new Error(`Картинки «${label}» нет в проекте — загрузите её заново.`);
  const rows = Math.ceil(image.frames / image.columns);
  if (
    sheet.width !== image.columns * image.frameWidth ||
    sheet.height !== rows * image.frameHeight
  )
    throw new Error(
      `Лист картинки «${label}» (${sheet.width}×${sheet.height}) не совпадает с проектом (${image.columns}×${rows} кадров по ${image.frameWidth}×${image.frameHeight}).`,
    );
  if (minimapOverlaySheetPixels(image) > MINIMAP_OVERLAY_LIMITS.sheetPixels)
    throw new RangeError(`Картинка «${label}» больше предела мини-карты.`);
  const cellWidth = image.frameWidth + 2;
  const cellHeight = image.frameHeight + 2;
  const width = image.columns * cellWidth;
  const height = rows * cellHeight;
  const source = Buffer.from(
    sheet.rgba.buffer,
    sheet.rgba.byteOffset,
    sheet.rgba.byteLength,
  );
  const out = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < image.frames; frame += 1) {
    const cell = minimapOverlayCell(image, frame);
    const column = frame % image.columns;
    const row = Math.floor(frame / image.columns);
    for (let y = 0; y < cellHeight; y += 1) {
      const fromY =
        cell.y + Math.min(image.frameHeight - 1, Math.max(0, y - 1));
      for (let x = 0; x < cellWidth; x += 1) {
        const fromX =
          cell.x + Math.min(image.frameWidth - 1, Math.max(0, x - 1));
        source.copy(
          out,
          ((row * cellHeight + y) * width + column * cellWidth + x) * 4,
          (fromY * sheet.width + fromX) * 4,
          (fromY * sheet.width + fromX) * 4 + 4,
        );
      }
    }
  }
  return { width, height, rgba: out };
}

/*
 * Растры и анимации картинок — один раз на файл: малый и развёрнутый радар
 * ставят одну и ту же анимацию своим масштабом. Фигура кадра — кадр в точках
 * растра (точка растра — точка сцены) вокруг своей середины.
 */
function prepareOverlayArt(configuration, images, allocate, definitions) {
  const art = {};
  let pixels = 0;
  for (const overlay of configuration.overlays || []) {
    if (!overlay.visible || overlay.kind !== "image") continue;
    const { image } = overlay;
    pixels += minimapOverlaySheetPixels(image);
    if (pixels > MINIMAP_OVERLAY_LIMITS.totalPixels)
      throw new RangeError(
        "Картинок на мини-карте больше предела: уменьшите их или уберите лишние.",
      );
    const label = image.name || overlay.id;
    const padded = paddedOverlaySheet(
      images.overlays?.[overlay.id],
      image,
      label,
    );
    const [bitmapId] = allocate(1);
    definitions.push(defineLosslessBitmap(bitmapId, padded));
    const halfWidth = (image.frameWidth * MINIMAP_TWIPS) / 2;
    const halfHeight = (image.frameHeight * MINIMAP_TWIPS) / 2;
    const shapes = [];
    for (let frame = 0; frame < image.frames; frame += 1) {
      const column = frame % image.columns;
      const row = Math.floor(frame / image.columns);
      const [shapeId] = allocate(1);
      definitions.push(
        defineBitmapRectShape(
          shapeId,
          bitmapId,
          {
            x: -halfWidth,
            y: -halfHeight,
            width: halfWidth * 2,
            height: halfHeight * 2,
          },
          {
            a: MINIMAP_TWIPS,
            b: 0,
            c: 0,
            d: MINIMAP_TWIPS,
            tx:
              -halfWidth -
              (column * (image.frameWidth + 2) + 1) * MINIMAP_TWIPS,
            ty:
              -halfHeight - (row * (image.frameHeight + 2) + 1) * MINIMAP_TWIPS,
          },
        ),
      );
      shapes.push(shapeId);
    }
    if (shapes.length === 1) {
      art[overlay.id] = { characterId: shapes[0] };
      continue;
    }
    const order = minimapOverlayTimeline(image);
    const [spriteId] = allocate(1);
    definitions.push(
      defineSpriteFrames(
        spriteId,
        order.map((frame, step) =>
          step === 0
            ? [placeObject2({ depth: 1, characterId: shapes[frame] })]
            : frame === order[step - 1]
              ? []
              : [
                  placeObject2({
                    depth: 1,
                    move: true,
                    characterId: shapes[frame],
                  }),
                ],
        ),
      ),
    );
    art[overlay.id] = { characterId: spriteId };
  }
  return art;
}

/** Слой надписей и картинок одного радара; `null` — их нет. */
function overlaysSprite(
  model,
  frame,
  configuration,
  art,
  allocate,
  definitions,
) {
  const overlays = (configuration.overlays || []).filter(
    (item) => item.visible,
  );
  if (!overlays.length) return null;
  const children = [];
  overlays.forEach((overlay, index) => {
    const box = minimapOverlayBox(overlay);
    const place = frame.toTwips({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
    });
    const width = box.width * MINIMAP_RADAR.width * MINIMAP_TWIPS * frame.scale;
    const height =
      box.height * MINIMAP_RADAR.height * MINIMAP_TWIPS * frame.scale;
    const cxform =
      overlay.opacity < 100
        ? alphaOnly(Math.round((overlay.opacity * 255) / 100))
        : null;
    if (overlay.kind === "text") {
      const fontId =
        (overlay.font === "cond" ? model.fonts.cond : model.fonts.regular) ??
        model.fontId;
      if (fontId === null || !overlay.text) return;
      const [textId] = allocate(1);
      definitions.push(
        defineEditText({
          id: textId,
          bounds: { xmin: 0, xmax: width, ymin: 0, ymax: height },
          fontId,
          fontHeight:
            minimapUnitsToScene(overlay.size) * MINIMAP_TWIPS * frame.scale,
          color: hexToRgb(overlay.color),
          align: 1,
          text: overlay.text,
        }),
      );
      children.push(
        placeObject2({
          depth: index + 1,
          characterId: textId,
          matrix: {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            tx: place.x - width / 2,
            ty: place.y - height / 2,
          },
          cxform,
          name: `astralOverlay${index}`,
        }),
      );
      return;
    }
    const piece = art[overlay.id];
    if (!piece) return;
    const scale = width / (overlay.image.frameWidth * MINIMAP_TWIPS);
    children.push(
      placeObject2({
        depth: index + 1,
        characterId: piece.characterId,
        matrix: { a: scale, b: 0, c: 0, d: scale, tx: place.x, ty: place.y },
        cxform,
        name: `astralOverlay${index}`,
      }),
    );
  });
  if (!children.length) return null;
  const [spriteId] = allocate(1);
  definitions.push(defineSprite(spriteId, children));
  return spriteId;
}

/*
 * Контейнер HEALTH_ARMOUR_ABILITY_*: `healthArmourMC` указывает на новый
 * спрайт полос в координатах контейнера, штатная подложка прячется, если
 * полосы из неё ушли, обводка карты встаёт своей фигурой. Всё остальное —
 * ability, воздух, вспышки, розыск — переносится байт в байт.
 */
function rewriteContainer(
  model,
  container,
  barsSpriteId,
  hideStrip,
  outlineShapeId = null,
  overlaysSpriteId = null,
  stripCover = null,
) {
  const { buffer } = model.index;
  const header = buffer.subarray(
    container.tag.payloadStart,
    container.tag.payloadStart + 4,
  );
  const children = container.timeline.flatMap((tag) => {
    const raw = buffer.subarray(tag.offset, tag.end);
    const placement = tag.placement;
    if (!placement) return [raw];
    if (placement.name === "healthArmourMC") {
      const outlineDepth =
        outlineShapeId === null
          ? null
          : freeDepthUnder(container, placement.depth);
      return [
        /* Надписи и картинки — под обводкой и под полосами. */
        ...(overlaysSpriteId === null
          ? []
          : [
              placeObject2({
                depth: freeDepthUnder(
                  container,
                  placement.depth,
                  outlineDepth === null ? [] : [outlineDepth],
                ),
                characterId: overlaysSpriteId,
                name: "astralOverlays",
              }),
            ]),
        ...(outlineShapeId === null
          ? []
          : [
              placeObject2({
                depth: outlineDepth,
                characterId: outlineShapeId,
              }),
            ]),
        placeObject2({
          depth: placement.depth,
          characterId: barsSpriteId,
          matrix: IDENTITY_MATRIX,
          name: "healthArmourMC",
        }),
      ];
    }
    if (hideStrip && placement.name === "bar_bg")
      return [
        placeObject2({
          depth: placement.depth,
          characterId: placement.characterId,
          matrix: placement.matrix || IDENTITY_MATRIX,
          cxform: alphaOnly(0),
          name: "bar_bg",
        }),
      ];
    /* Лента развёрнутого радара — заливка внутри общей фигуры с плёнкой: фигура ставится заново без неё (`bigStripOf`). */
    if (hideStrip && stripCover && tag.offset === stripCover.offset)
      return stripCover.characterId === null
        ? []
        : [
            placeObject2({
              depth: placement.depth,
              characterId: stripCover.characterId,
              matrix: placement.matrix || IDENTITY_MATRIX,
            }),
          ];
    if (
      hideStrip &&
      model.strip &&
      container === model.small &&
      tag.offset === model.strip.offset
    )
      return [
        placeObject2({
          depth: placement.depth,
          characterId: placement.characterId,
          matrix: placement.matrix || IDENTITY_MATRIX,
          cxform: alphaOnly(0),
        }),
      ];
    return [raw];
  });
  return swfTag(SWF_TAG.DEFINE_SPRITE, Buffer.concat([header, ...children]));
}

/*
 * Стрелка игрока — символ `radar_centre`: его игра ставит на радар и
 * поворачивает по взгляду. Раньше компилятор правил `radar_pointer`, стрелку,
 * которой на мини-карте нет, — цвет и размер до игры не доходили.
 *
 * Цвет штатной стрелки — умножением: белая заливка становится цветом, а
 * тёмная обводка остаётся обводкой. Своя картинка — силуэтом цвета, как в
 * предпросмотре.
 */
function pointerSprite(model, configuration, images) {
  const { effects } = configuration;
  const color = hexToRgb(effects.playerMarkerColor);
  const scale = effects.playerMarkerScale;
  if (effects.playerMarkerMode === "hidden")
    return defineSprite(model.pointer.id, []);
  if (effects.playerMarkerMode === "custom") {
    if (!images.playerMarkerShape)
      throw new Error("Своя стрелка игрока выбрана, но картинки нет.");
    const side = MINIMAP_STOCK_MARKER_HEIGHT * MINIMAP_TWIPS * scale;
    return defineSprite(model.pointer.id, [
      placeObject2({
        depth: 1,
        characterId: images.playerMarkerShape,
        matrix: {
          a: side / IMAGE_SIDE,
          b: 0,
          c: 0,
          d: side / IMAGE_SIDE,
          tx: -side / 2,
          ty: -side / 2,
        },
        cxform: solidColor(color),
      }),
    ]);
  }
  const white = color.every((channel) => channel === 255);
  if (Math.abs(scale - 1) < 1e-6 && white) return null;
  return defineSprite(
    model.pointer.id,
    model.pointer.children.map((child) =>
      placeObject2({
        depth: child.depth,
        characterId: child.characterId,
        matrix: multiplyMatrix(
          { a: scale, b: 0, c: 0, d: scale, tx: 0, ty: 0 },
          child.matrix || IDENTITY_MATRIX,
        ),
        cxform: white ? null : multiplyColor(color),
        name: child.name || "",
      }),
    ),
  );
}

/*
 * Метки других людей (задача 1 ТЗ 17.10.2026): кружки `radar_level`,
 * `radar_higher`, `radar_lower`, `radar_level_inside`. Экземпляр кружка игра
 * ставит, двигает и красит цветом игрока снаружи — внутрь символа не
 * заглядывает. Поэтому размер — масштаб размещений внутри символа, своя
 * картинка — белый силуэт вместо них (цвет ему даст игра, у каждого игрока
 * свой), «Скрыть» — прозрачные размещения (`transparentSprite`). Своя
 * картинка ложится и на кружки «выше/ниже»: стрелок высоты у них не будет.
 */
function otherPeopleSprites(model, configuration, images) {
  const { effects } = configuration;
  if (!minimapOthersChanged(effects)) return [];
  const { index } = model;
  const found = MINIMAP_OTHER_PEOPLE_SYMBOLS.map((name) => ({
    name,
    id: index.exports.get(name),
  })).filter(
    ({ id }) =>
      id !== undefined &&
      index.definitions.get(id)?.code === SWF_TAG.DEFINE_SPRITE,
  );
  if (!found.length)
    throw new Error(
      "В minimap.gfx нет кружков людей «radar_level» — метки других игроков поменять некуда.",
    );
  if (effects.othersMode === "custom" && !images.othersMarkerShape)
    throw new Error("Своя метка других игроков выбрана, но картинки нет.");
  const scale = effects.othersScale;
  return found.map(({ id }) => {
    if (effects.othersMode === "hidden")
      return { id, tag: transparentSprite(model, id) };
    if (effects.othersMode === "custom") {
      const side = MINIMAP_OTHERS_STOCK_SIDE * MINIMAP_TWIPS * scale;
      return {
        id,
        tag: defineSprite(id, [
          placeObject2({
            depth: 1,
            characterId: images.othersMarkerShape,
            matrix: {
              a: side / IMAGE_SIDE,
              b: 0,
              c: 0,
              d: side / IMAGE_SIDE,
              tx: -side / 2,
              ty: -side / 2,
            },
          }),
        ]),
      };
    }
    return {
      id,
      tag: defineSprite(
        id,
        spritePlacements(index.buffer, index.definitions.get(id)).map((child) =>
          placeObject2({
            depth: child.depth,
            characterId: child.characterId,
            matrix: multiplyMatrix(
              { a: scale, b: 0, c: 0, d: scale, tx: 0, ty: 0 },
              child.matrix || IDENTITY_MATRIX,
            ),
            cxform: child.cxform || null,
            name: child.name || "",
            clipDepth: child.clipDepth || 0,
          }),
        ),
      ),
    };
  });
}

/** Буква N (`radar_north`): спрятать — значит оставить символ пустым. */
function northSprite(model, configuration) {
  if (configuration.effects.showNorth) return null;
  return defineSprite(model.north.id, []);
}

/*
 * Метка GPS (задача 10 ТЗ 10.10.2026, вечер): символ `radar_waypoint` —
 * спрайт 16×16 точек вокруг (0, 0), в нём фигура с клеткой листа значков
 * minimap.ytd. Им игра ставит метку на радар и на карту паузы и красит её
 * строкой HUD_COLOUR_WAYPOINT. Размер — масштаб каждого размещения внутри
 * символа вокруг его середины, прозрачность — множитель альфы: экземпляр
 * игра двигает, красит, масштабирует и прячет снаружи, а внутрь символа не
 * заглядывает. Штатные размер и прозрачность символа не трогают.
 */
export const MINIMAP_WAYPOINT_SYMBOL = "radar_waypoint";

function waypointSprite(model, configuration) {
  const waypoint = minimapGpsWaypoint(configuration.gps);
  if (!waypoint.changed || configuration.layout.map.hidden) return null;
  const id = model.index.exports.get(MINIMAP_WAYPOINT_SYMBOL);
  const tag = id === undefined ? null : model.index.definitions.get(id);
  if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error(
      "В minimap.gfx нет значка метки «radar_waypoint» — размер и прозрачность метки GPS поставить некуда.",
    );
  const children = spritePlacements(model.index.buffer, tag);
  if (!children.length)
    throw new Error("Значок метки «radar_waypoint» в minimap.gfx пуст.");
  const scale = waypoint.size;
  return {
    id,
    tag: defineSprite(
      id,
      children.map((child) =>
        placeObject2({
          depth: child.depth,
          characterId: child.characterId,
          matrix: multiplyMatrix(
            { a: scale, b: 0, c: 0, d: scale, tx: 0, ty: 0 },
            child.matrix || IDENTITY_MATRIX,
          ),
          cxform:
            waypoint.opacity < 1
              ? { mult: [256, 256, 256, Math.round(waypoint.opacity * 256)] }
              : child.cxform || null,
          name: child.name || "",
        }),
      ),
    ),
  };
}

/*
 * Символ, которого не видно: каждому размещению внутри него ставится альфа 0.
 * Игра меняет `_alpha`, цвет и видимость самого экземпляра, а не того, что в
 * нём, — показывать нечего; размер символа (по нему компилятор находит радар)
 * остаётся прежним.
 *
 * Так у скрытой карты пропадают мигание розыска (`wantedOverlay`) и значки
 * радара: бипы игра ставит сама, из символов `radar_*`, `blip_*` и соседей,
 * и не в `CONTENT` под маской карты, а поверх неё, — в игре 10.10.2026 они
 * висели в воздухе без карты.
 */
const MAP_ONLY_SYMBOL =
  /^(radar_|blip_|blipLabel$|stealth_blip|shared_marker$|gang_areas$|sonar|crosshair$|border(texture)?$)/;

function transparentSprite(model, id) {
  const { buffer } = model.index;
  const tag = model.index.definitions.get(id);
  const header = buffer.subarray(tag.payloadStart, tag.payloadStart + 4);
  const children = spriteTimeline(buffer, tag).map((entry) => {
    const placement = entry.placement;
    if (!placement) return buffer.subarray(entry.offset, entry.end);
    return placeObject2({
      depth: placement.depth,
      move: placement.move,
      characterId: placement.characterId ?? null,
      matrix: placement.matrix || null,
      cxform: alphaOnly(0),
      name: placement.name || "",
      clipDepth: placement.clipDepth || 0,
    });
  });
  return swfTag(SWF_TAG.DEFINE_SPRITE, Buffer.concat([header, ...children]));
}

/*
 * Вспышка урона (`healthHitMC`): своя картинка или вспышка игры — 64 точки
 * сцены, которые контейнер растягивает на радар. Размер — масштаб вокруг
 * середины; свой цвет у вспышки игры — силуэт этого цвета (виньетка
 * остаётся виньеткой), у своей картинки — оттенок умножением.
 */
/** Своя картинка или свой цвет вспышки: окраска игры цветом урона им мешает. */
export function minimapDamageKeepsOwnColour(effects) {
  return (
    Boolean(effects?.damageAssetId) || effects?.damageColorMode === "custom"
  );
}

function damageSprite(model, images, effects) {
  const scale = effects.damageScale / 100;
  const colour =
    effects.damageColorMode === "custom" ? hexToRgb(effects.damageColor) : null;
  /* Масштаб вокруг середины: своей картинки — квадрата IMAGE_SIDE, вспышки
     игры — её символа (в файле игры те же 64 точки). */
  const around = (x, y) =>
    scale < 1
      ? {
          a: scale,
          b: 0,
          c: 0,
          d: scale,
          tx: x * (1 - scale),
          ty: y * (1 - scale),
        }
      : null;
  if (images.damageShape)
    return defineSprite(model.damageSpriteId, [
      placeObject2({
        depth: 32,
        characterId: images.damageShape,
        matrix: around(IMAGE_SIDE / 2, IMAGE_SIDE / 2),
        cxform: colour ? multiplyColor(colour) : null,
      }),
    ]);
  const bounds = characterBounds(model.index, model.damageSpriteId);
  const sized =
    bounds &&
    around((bounds.xmin + bounds.xmax) / 2, (bounds.ymin + bounds.ymax) / 2);
  if (!colour && !sized) return null;
  const tag = model.index.definitions.get(model.damageSpriteId);
  return defineSprite(
    model.damageSpriteId,
    spritePlacements(model.index.buffer, tag).map((child) =>
      placeObject2({
        depth: child.depth,
        characterId: child.characterId,
        matrix: sized
          ? multiplyMatrix(sized, child.matrix || IDENTITY_MATRIX)
          : child.matrix || IDENTITY_MATRIX,
        cxform: colour ? solidColor(colour) : null,
        name: child.name || "",
      }),
    ),
  );
}

function patchMinimapDisplayList(buffer, configuration, images) {
  const model = resolveMinimapModel(buffer);
  const { index } = model;
  /* Номеров с запасом: у GIF своя фигура на каждый кадр (до 48 на картинку). */
  const pool = allocateCharacterIds(index, 1200);
  let cursor = 0;
  const allocate = (count) => {
    if (cursor + count > pool.length)
      throw new Error("minimap.gfx: не хватило номеров для новых символов.");
    const ids = pool.slice(cursor, cursor + count);
    cursor += count;
    return ids;
  };

  const definitions = [];
  const shapes = {};
  const bitmap = (image, key) => {
    if (!image) return;
    const [bitmapId, shapeId] = allocate(2);
    definitions.push(
      defineLosslessBitmap(bitmapId, image),
      defineBitmapShape(
        shapeId,
        bitmapId,
        image.width,
        image.height,
        IMAGE_SIDE,
      ),
    );
    shapes[key] = shapeId;
  };
  bitmap(images.healthIcon, "healthIconShape");
  bitmap(images.armorIcon, "armorIconShape");
  bitmap(images.playerMarker, "playerMarkerShape");
  bitmap(images.othersMarker, "othersMarkerShape");
  /* Картинка урона — DefineBitsLossless2, как значки, стрелка и видео
     заливки. JPEG (DefineBitsJPEG2) Scaleform игры не раскрывает: ни один из
     622 .gfx update.rpf его не содержит, а в игре на месте картинки была
     ровная заливка — белый растр, окрашенный в HUD_COLOUR_DAMAGE (кадры
     владельца 2 ноября 2026, вспышка ≈ 200, 90, 90 по всему радару). */
  if (images.damage) {
    const [bitmapId, shapeId] = allocate(2);
    definitions.push(
      defineLosslessBitmap(bitmapId, images.damage),
      defineBitmapShape(
        shapeId,
        bitmapId,
        images.damage.width,
        images.damage.height,
        IMAGE_SIDE,
      ),
    );
    shapes.damageShape = shapeId;
  }
  const overlayArt = prepareOverlayArt(
    configuration,
    images,
    allocate,
    definitions,
  );
  shapes.fills = prepareFillBitmaps(
    model,
    configuration,
    images,
    allocate,
    definitions,
  );

  const smallBars = buildBarsSprite(
    model,
    frameFor(model, "small"),
    configuration,
    shapes,
    allocate,
  );
  const bigBars = buildBarsSprite(
    model,
    frameFor(model, "big", configuration),
    configuration,
    shapes,
    allocate,
  );
  definitions.push(...smallBars.definitions, ...bigBars.definitions);
  const smallOutline = outlineShape(
    model.small,
    1,
    configuration,
    allocate,
    definitions,
  );
  const bigOutline = outlineShape(
    model.big,
    model.stock.bigScale,
    configuration,
    allocate,
    definitions,
  );

  const smallOverlays = overlaysSprite(
    model,
    frameFor(model, "small"),
    configuration,
    overlayArt,
    allocate,
    definitions,
  );
  const bigOverlays = overlaysSprite(
    model,
    frameFor(model, "big"),
    configuration,
    overlayArt,
    allocate,
    definitions,
  );

  const hideStrip = !minimapBarsUseStockStrip(configuration);
  let bigStripCover = null;
  if (hideStrip && model.bigStrip) {
    let characterId = null;
    if (model.bigStrip.kept.length) {
      [characterId] = allocate(1);
      definitions.push(
        defineRectanglesShape(
          characterId,
          model.bigStrip.kept,
          model.bigStrip.fill,
        ),
      );
    }
    bigStripCover = { offset: model.bigStrip.offset, characterId };
  }
  const replacements = new Map([
    [
      model.small.id,
      rewriteContainer(
        model,
        model.small,
        smallBars.spriteId,
        hideStrip,
        smallOutline,
        smallOverlays,
      ),
    ],
    [
      model.big.id,
      rewriteContainer(
        model,
        model.big,
        bigBars.spriteId,
        hideStrip,
        bigOutline,
        bigOverlays,
        bigStripCover,
      ),
    ],
  ]);
  const pointer = pointerSprite(model, configuration, shapes);
  if (pointer) replacements.set(model.pointer.id, pointer);
  const north = northSprite(model, configuration);
  if (north) replacements.set(model.north.id, north);
  const waypoint = waypointSprite(model, configuration);
  if (waypoint) replacements.set(waypoint.id, waypoint.tag);
  const damage = damageSprite(model, shapes, configuration.effects);
  if (damage) replacements.set(model.damageSpriteId, damage);
  for (const item of otherPeopleSprites(model, configuration, shapes))
    replacements.set(item.id, item.tag);

  /* Новые определения — перед первым заменяемым символом: словарь SWF
     читается по порядку, и символ обязан быть объявлен до того, как его
     поставят. */
  const firstReplaced = index.tags.find(
    (tag) =>
      tag.code === SWF_TAG.DEFINE_SPRITE &&
      replacements.has(buffer.readUInt16LE(tag.payloadStart)),
  );
  /* Замены на месте — без новых символов, поэтому порядок им не важен. */
  const inPlace = new Map();
  if (configuration.layout.map.hidden) {
    const hide = (id) => {
      const tag = index.definitions.get(id);
      if (
        tag?.code === SWF_TAG.DEFINE_SPRITE &&
        !replacements.has(id) &&
        !inPlace.has(id)
      )
        inPlace.set(id, transparentSprite(model, id));
    };
    for (const container of [model.small, model.big])
      hide(container.wanted.placement.characterId);
    for (const [name, id] of index.exports)
      if (MAP_ONLY_SYMBOL.test(name)) hide(id);
  }
  const output = [buffer.subarray(0, index.headerLength)];
  for (const tag of index.tags) {
    if (tag === firstReplaced) output.push(...definitions);
    const id =
      tag.code === SWF_TAG.DEFINE_SPRITE
        ? buffer.readUInt16LE(tag.payloadStart)
        : null;
    output.push(
      id !== null && replacements.has(id)
        ? replacements.get(id)
        : id !== null && inPlace.has(id)
          ? inPlace.get(id)
          : buffer.subarray(tag.offset, tag.end),
    );
  }
  const result = Buffer.concat(output);
  result.writeUInt32LE(result.length, 4);
  return result;
}

/*
 * «Скрыть карту» (задача 8 ТЗ 10.10.2026): радар убирает чёрная маска в
 * graphics.ytd (`minimap-blur.js`), а из minimap.gfx уходит то, что стоит
 * поверх карты, — стрелка игрока, буква N, обводка, вспышка урона и мигание
 * розыска (`transparentSprite`): без карты они мигали бы пустым
 * прямоугольником. Полосы, цифры и значки остаются там, где их поставил
 * человек.
 */
function withoutMapParts(configuration) {
  if (!configuration.layout.map.hidden) return configuration;
  return {
    ...configuration,
    frame: {
      ...configuration.frame,
      outline: { ...configuration.frame.outline, enabled: false },
    },
    effects: {
      ...configuration.effects,
      playerMarkerMode: "hidden",
      showNorth: false,
      damageFlash: false,
      damageAssetId: "",
      /* Кружки людей у скрытой карты прячет `transparentSprite` вместе со
         всеми `radar_*`. */
      othersMode: "stock",
      othersScale: 1,
    },
  };
}

/**
 * Сцена фильма шире на `extent` точек с каждой стороны («HP отдельно от карты», группа вышла за кадр).
 *
 * Размер сцены — рамка в заголовке: растёт вправо и вниз на `2·extent` (левый верхний угол остаётся (0, 0), как у всех
 * фильмов игры), а всё содержимое сдвигается на `extent` вправо и вниз — своим кадром 1, `this._x = x; this._y = y` корня, до
 * кода класса MINIMAP. Так прежние 191×136 стоят посередине нового фильма, и когда записи frontend.xml вырастают симметрично
 * (`extendMinimapFrontend`), каждая точка прежней сцены ложится на экран туда же, где лежала. Ноль по обеим осям — тот же буфер.
 *
 * Метка `MINIMAP_WIDE_SCENE_MARK` в том же действии отличает этот фильм от фильма прежней опции: тот записи `pausemap` не
 * растил, его чинит `minimap-film-repair.js` (`minimapFilmDamage`), а этот — работа человека (`minimapWideScene`).
 *
 * Меняются только заголовок и один добавленный тег: остальные теги файла не трогаются.
 */
export function widenMinimapScene(buffer, extent) {
  const x = Math.max(0, Math.round(Number(extent?.x) || 0));
  const y = Math.max(0, Math.round(Number(extent?.y) || 0));
  if (!x && !y) return buffer;
  const headerLength = scaleformHeaderLength(buffer);
  const { rect, end } = readRect(buffer, 8);
  if (rect.xmin !== 0 || rect.ymin !== 0)
    throw new Error(
      "В minimap.gfx сцена начинается не с нуля — расширить её нельзя.",
    );
  const header = Buffer.concat([
    buffer.subarray(0, 8),
    writeRect({
      xmin: 0,
      ymin: 0,
      xmax: rect.xmax + 2 * x * MINIMAP_TWIPS,
      ymax: rect.ymax + 2 * y * MINIMAP_TWIPS,
    }),
    buffer.subarray(end, headerLength),
  ]);
  const tags = parseSwfTags(buffer, headerLength);
  const frameEnd = tags.findIndex((tag) => tag.code === SWF_TAG.SHOW_FRAME);
  if (frameEnd < 0)
    throw new Error("В minimap.gfx нет первого кадра — сдвинуть сцену некуда.");
  const first =
    tags.slice(0, frameEnd).find((tag) => tag.code === SWF_TAG.DO_ACTION) ||
    tags[frameEnd];
  const set = (name, value) =>
    Buffer.concat([
      pushAction(["this"]),
      action(AVM1.GET_VARIABLE),
      pushAction([name, value]),
      action(AVM1.SET_MEMBER),
    ]);
  const code = swfTag(
    SWF_TAG.DO_ACTION,
    Buffer.concat([
      x ? set("_x", x) : Buffer.alloc(0),
      y ? set("_y", y) : Buffer.alloc(0),
      set(MINIMAP_WIDE_SCENE_MARK, 1),
      action(AVM1.END),
    ]),
  );
  const result = Buffer.concat([
    header,
    buffer.subarray(headerLength, first.offset),
    code,
    buffer.subarray(first.offset),
  ]);
  result.writeUInt32LE(result.length, 4);
  return result;
}

/**
 * Сборка minimap.gfx.
 *
 * `images` — уже подготовленные картинки: значки и стрелка —
 * `{ width, height, rgba }` (`prepareLosslessImage`), урон — тоже
 * `{ width, height, rgba }` (`prepareDamageImage`). Выбранная, но не
 * переданная картинка — отказ до сборки.
 */
export function compileMinimapGfx(
  baseBuffer,
  rawConfiguration,
  images = {},
  { sceneExtent = undefined } = {},
) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base minimap GFX must be a Buffer.");
  const base = uncompressedScaleform(baseBuffer);
  const configuration = withoutMapParts(
    normalizeMinimapLayout(rawConfiguration),
  );
  const needsIcons = contractNeedsIconImages(configuration);
  if (configuration.effects.damageAssetId && !images.damage)
    throw new Error("The selected damage image is missing from this project.");
  if (needsIcons && !images.healthIcon)
    throw new Error("The selected HP icon image is missing.");
  if (needsIcons && !images.armorIcon)
    throw new Error("The selected armor icon image is missing.");
  if (
    configuration.effects.playerMarkerMode === "custom" &&
    !images.playerMarker
  )
    throw new Error(
      "The selected player marker image is missing from this project.",
    );
  if (configuration.effects.othersMode === "custom" && !images.othersMarker)
    throw new Error(
      "The selected marker of other players is missing from this project.",
    );
  for (const overlay of configuration.overlays)
    if (
      overlay.visible &&
      overlay.kind === "image" &&
      !images.overlays?.[overlay.id]
    )
      throw new Error(
        `Картинки «${overlay.image.name || overlay.id}» на мини-карте нет в проекте — загрузите её заново.`,
      );
  /* HP и броню включают порознь, и патч ActionScript трогает ровно те поля,
     которые встанут в кадр; одна общая цифра — одно поле на месте HP. */
  const numbers = minimapNumberFields(configuration);
  if (
    minimapShowsNumbers(configuration) &&
    resolveMinimapModel(base).fontId === null
  )
    throw new Error("В minimap.gfx нет шрифта HUD для цифр HP и брони.");
  /* Анимированная заливка: маска на месте фигуры полосы и две дописки в
     ActionScript — видимость и малое HP. */
  const fillSides = new Set(
    minimapFillSides(configuration).map((item) => item.side),
  );
  let compiled = patchMinimapActionScript(base, configuration, {
    numbers,
    counter: minimapNumberCounter(configuration),
    presence: minimapPresenceActive(configuration),
    fills: {
      health: fillSides.has("health"),
      armour: fillSides.has("armour"),
    },
  });
  compiled = patchMinimapDisplayList(compiled, configuration, {
    healthIcon: needsIcons ? images.healthIcon : null,
    armorIcon: needsIcons ? images.armorIcon : null,
    playerMarker:
      configuration.effects.playerMarkerMode === "custom"
        ? images.playerMarker
        : null,
    damage: configuration.effects.damageAssetId ? images.damage : null,
    othersMarker:
      configuration.effects.othersMode === "custom"
        ? images.othersMarker
        : null,
    overlays: images.overlays || {},
    healthFill: images.healthFill || null,
    armorFill: images.armorFill || null,
  });
  /* Линия маршрута GPS (задача 1 ТЗ 11.10.2026, утро): толщина, вид и
     прозрачность — перехватом команд рисования в кадре 1
     (`minimap-gps-line.js`). У скрытой карты маршрута не видно. */
  if (!configuration.layout.map.hidden)
    compiled = patchGpsRouteLine(compiled, configuration.gps);
  /* HP за кадром: сцена шире — то же число точек, что у записей frontend.xml. Установка передаёт число, обрезанное по экрану
     игры (`minimapSceneExtentFor`); без него — по группе HP (`minimapSceneExtent`). */
  /* С 21.11.2026 заголовок сцены остаётся штатным (рост сцены прятал карту паузы), а расширение — масштаб и сдвиг корня плюс сторож паузы
     (`minimap-root-scale.js`). `widenMinimapScene` остаётся для разбора старых фильмов. */
  const extent = sceneExtent ?? minimapSceneExtent(configuration);
  compiled = rootScaleMinimapScene(compiled, extent);
  compiled = addPauseGuard(compiled, extent, { classTag: minimapClassTag });
  if (compiled.readUInt32LE(4) !== compiled.length)
    throw new Error("Compiled minimap.gfx length header is invalid.");
  return { buffer: compiled, configuration, sha256: sha256(compiled) };
}

/*
 * ---------------------------------------------------------------------------
 * frontend.xml.
 * ---------------------------------------------------------------------------
 */

const FRONTEND_COMPONENTS = Object.freeze([
  "minimap",
  "minimap_mask",
  "minimap_blur",
  "bigmap",
  "bigmap_mask",
  "bigmap_blur",
]);
const REQUIRED_COMPONENTS = new Set([
  "minimap",
  "minimap_mask",
  "minimap_blur",
]);

function frontendElement(xml, name) {
  const matcher = new RegExp(`<data\\s+name=["']${name}["'][^>]*/>`, "gi");
  return [...xml.matchAll(matcher)];
}

const attribute = (element, name) => {
  const match = new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(element);
  return match ? match[1] : null;
};

/** Записи мини-карты из frontend.xml игрока. */
export function readFrontendEntries(xml) {
  const entries = {};
  for (const name of FRONTEND_COMPONENTS) {
    const found = frontendElement(xml, name);
    if (found.length !== 1) {
      if (REQUIRED_COMPONENTS.has(name))
        throw new Error(
          `Reviewed frontend.xml entry ${name} was not found exactly once.`,
        );
      continue;
    }
    const element = found[0][0];
    const numbers = ["posX", "posY", "sizeX", "sizeY"].map((key) =>
      Number(attribute(element, key)),
    );
    if (numbers.some((value) => !Number.isFinite(value)))
      throw new Error(`frontend.xml entry ${name} has invalid numbers.`);
    const [posX, posY, sizeX, sizeY] = numbers;
    entries[name] = {
      alignX: attribute(element, "alignX") || "L",
      alignY: attribute(element, "alignY") || "B",
      posX,
      posY,
      sizeX,
      sizeY,
    };
  }
  return entries;
}

/*
 * Положение карты для установки и экраны, на которых оно считается: один расчёт на запись и на расширение сцены.
 * `from` — «Экран» окна с отступом игрока, `screen` — экран игры. Числа идут в игру с пределами установки
 * (`MINIMAP_INSTALL_LIMITS`), а не с узкими пределами ползунков окна: иначе кадр на широком экране молча ужимался бы.
 */
function frontendPlacement(configuration, reference, gameScreen) {
  const from = minimapGameScreen({
    aspect: configuration.targetViewport.aspect,
    inset: gameScreen?.inset,
  });
  const screen =
    gameScreen && configuration.targetViewport.gameAspect !== "screen"
      ? minimapGameScreen(gameScreen)
      : from;
  const placement = minimapPlacementForGame(configuration.layout.map, {
    from,
    to: screen,
    stock: reference,
    limits: MINIMAP_INSTALL_LIMITS,
  });
  return { placement, screen, from };
}

const decimal = (value) => {
  const text = Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
};

/**
 * frontend.xml с положением мини-карты.
 *
 * Штатное положение — файл без единого изменённого байта. Сдвинутое —
 * те же строки с новыми числами: выравнивание, табуляция и комментарий
 * Rockstar («Feed MUST match sizeX») остаются на месте.
 *
 * `gameScreen` — экран игры игрока (форма из settings.xml, ТЗ 11.10.2026,
 * день): на мониторе кадр занимает то же место, что в окне, и в любом случае
 * остаётся на экране игры (`minimapPlacementForGame`). Без него — экран
 * редактора. Отступ один и тот же: окно показывает кадр с отступом игры игрока.
 * Человек указал «в игре как здесь» (`gameAspect`) — форма из окна, а не из файла.
 */
export function compileFrontendXml(
  baseBuffer,
  rawConfiguration,
  { gameScreen = null, sceneExtent = undefined } = {},
) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base frontend.xml must be a Buffer.");
  const configuration = normalizeMinimapLayout(rawConfiguration);
  const xml = baseBuffer.toString("utf8");
  const stock = readFrontendEntries(xml);
  const reference = { ...MINIMAP_FRONTEND_STOCK, ...stock };
  const { placement, screen } = frontendPlacement(
    configuration,
    reference,
    gameScreen,
  );
  const extent = sceneExtent ?? minimapSceneExtent(configuration);
  /* «По центру» двигает развёрнутый радар и при штатной малой карте. */
  const stockPlace =
    isStockMinimapPlacement(placement) && placement.expanded !== "center";
  if (stockPlace && !extent.x && !extent.y) {
    return {
      buffer: baseBuffer,
      configuration,
      sha256: sha256(baseBuffer),
      entries: stock,
      placement,
      screen,
      unchanged: true,
    };
  }
  /* HP за кадром: `minimap` и `bigmap` растут вокруг своего центра, `pausemap` и прочие строки остаются штатными байт в байт.
     Штатное положение — штатные записи как есть: `placeMinimapFrontend` у развёрнутого радара подтягивает кадр к экрану даже при
     нулевом сдвиге, а карта на своём месте двигаться не должна. */
  const placed = extendMinimapFrontend(
    stockPlace
      ? reference
      : placeMinimapFrontend(
          placement,
          reference,
          screen,
          MINIMAP_INSTALL_LIMITS,
        ),
    extent,
  );
  const written = Object.keys(stock);
  let next = xml;
  for (const name of written) {
    const [match] = frontendElement(next, name);
    let element = match[0];
    for (const key of ["posX", "posY", "sizeX", "sizeY"])
      element = element.replace(
        new RegExp(`(\\s${key}=["'])[^"']*(["'])`, "i"),
        `$1${decimal(placed[name][key])}$2`,
      );
    next =
      next.slice(0, match.index) +
      element +
      next.slice(match.index + match[0].length);
  }
  const buffer = Buffer.from(next, "utf8");
  return {
    buffer,
    configuration,
    sha256: sha256(buffer),
    entries: Object.fromEntries(written.map((name) => [name, placed[name]])),
    placement,
    screen,
    unchanged: false,
  };
}

/**
 * Расширение сцены в точках с каждой стороны: по группе HP (`minimapSceneExtent`), но не больше, чем нужно, чтобы кадр дотянулся
 * до дальнего края экрана игры (`fitMinimapSceneExtent`). Одно число на minimap.gfx и frontend.xml: рассчитанные порознь они
 * разошлись бы, и карта съехала бы.
 */
export function minimapSceneExtentFor(
  rawConfiguration,
  baseFrontend,
  { gameScreen = null } = {},
) {
  const configuration = normalizeMinimapLayout(rawConfiguration);
  const wanted = minimapSceneExtent(configuration);
  if (!wanted.x && !wanted.y) return wanted;
  const stock = readFrontendEntries(
    Buffer.isBuffer(baseFrontend)
      ? baseFrontend.toString("utf8")
      : String(baseFrontend),
  );
  const reference = { ...MINIMAP_FRONTEND_STOCK, ...stock };
  const { placement, screen } = frontendPlacement(
    configuration,
    reference,
    gameScreen,
  );
  return fitMinimapSceneExtent(
    wanted,
    gameEntryRect(
      placeMinimapFrontend(placement, reference, screen, MINIMAP_INSTALL_LIMITS)
        .minimap,
      screen,
    ),
  );
}

/**
 * Расчёт установки для журнала сверки с игрой (ТЗ H1, 14.11.2026): тот же `from`, `to` и `stock`, что у записи
 * frontend.xml (`frontendPlacement`), и `minimapInstallPlan` поверх них — положение для файла, кадр на «Экране» окна
 * и на экране игры, зажатые числа. `baseEntries` — строки карты базового файла (до установки).
 */
export function minimapFrontendInstall(
  rawConfiguration,
  baseFrontend,
  { gameScreen = null } = {},
) {
  const configuration = normalizeMinimapLayout(rawConfiguration);
  const baseEntries = readFrontendEntries(
    Buffer.isBuffer(baseFrontend)
      ? baseFrontend.toString("utf8")
      : String(baseFrontend),
  );
  const reference = { ...MINIMAP_FRONTEND_STOCK, ...baseEntries };
  const { screen, from } = frontendPlacement(
    configuration,
    reference,
    gameScreen,
  );
  const plan = minimapInstallPlan(configuration.layout.map, {
    from,
    to: screen,
    stock: reference,
    limits: MINIMAP_INSTALL_LIMITS,
  });
  return { plan, from, to: screen, baseEntries };
}

/*
 * ---------------------------------------------------------------------------
 * Картинки и пакет.
 * ---------------------------------------------------------------------------
 */

/**
 * Картинка человека, приведённая к квадрату с прозрачными полями.
 */
export async function prepareLosslessImage(imageBuffer, size = 128) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError("Custom image must be a Buffer.");
  if (imageBuffer.length > MAX_CUSTOM_IMAGE_BYTES)
    throw new RangeError("Custom image exceeds 1 MB.");
  const { data, info } = await sharp(imageBuffer, {
    failOn: "error",
    limitInputPixels: MAX_CUSTOM_IMAGE_PIXELS,
  })
    .rotate()
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

/**
 * Лист кадров своего видео заливки (PNG из окна): кадры сверху вниз, без
 * пересжатия — размер и кадры уже подогнаны окном под предел мини-карты, а
 * компилятор сверит их с проектом.
 */
export async function prepareFillSheet(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError("Fill video sheet must be a Buffer.");
  if (imageBuffer.length > MAX_CUSTOM_IMAGE_BYTES)
    throw new RangeError("Fill video sheet exceeds 1 MB.");
  const { data, info } = await sharp(imageBuffer, {
    failOn: "error",
    limitInputPixels: MINIMAP_FILL_VIDEO.maxPixels * 2,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

/**
 * Лист кадров своей картинки на карте (PNG из окна): кадры сеткой, без
 * пересжатия — окно уже уложило их в предел мини-карты, компилятор сверит
 * размер с проектом.
 */
export async function prepareOverlaySheet(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError("Overlay picture must be a Buffer.");
  if (imageBuffer.length > MAX_CUSTOM_IMAGE_BYTES)
    throw new RangeError("Overlay picture exceeds 1 MB.");
  const { data, info } = await sharp(imageBuffer, {
    failOn: "error",
    limitInputPixels: MINIMAP_OVERLAY_LIMITS.sheetPixels * 2,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

/** Растр в теге DefineBitsLossless2 — общий с прицелом путь PNG → ARGB. */
export function losslessBitmapTag(bitmapId, image) {
  return defineLosslessBitmap(bitmapId, image);
}

/**
 * Картинка урона для minimap.gfx: холст в пропорциях радара, на нём картинка
 * там, где её поставил человек (`minimapDamageImageBox`: «Заполнить» — по
 * середине с обрезкой краёв, «Целиком» — без обрезки; масштаб и сдвиг),
 * до 1024 точек по большей стороне, RGBA без пересжатия — прозрачное
 * остаётся прозрачным, как в предпросмотре. До 2 ноября 2026 здесь был JPEG
 * на чёрном, которого игра не показывала (`patchMinimapDisplayList`).
 */
export async function prepareDamageImage(
  imageBuffer,
  aspect = MINIMAP_RADAR_ASPECT,
  effects = {},
) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length)
    throw new TypeError("Damage image must be a Buffer.");
  if (imageBuffer.length > MAX_CUSTOM_IMAGE_BYTES)
    throw new RangeError("Damage image exceeds 1 MB.");
  /*
   * Картинка урона ложится на весь радар: символ вспышки растягивает холст в
   * квадрат, а место вспышки — в прямоугольник радара. Поэтому холст — в
   * пропорциях радара, и картинка на нём не сплющивается (бета 15.10, dsanc).
   */
  const upright = await sharp(imageBuffer, {
    failOn: "error",
    limitInputPixels: MAX_CUSTOM_IMAGE_PIXELS,
  })
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const { width: sourceWidth, height: sourceHeight } = upright.info;
  const box = minimapDamageImageBox(effects, sourceWidth, sourceHeight, aspect);
  /* Холст такой, чтобы картинка на нём шла в своём разрешении, но не больше
     1024 по большей стороне: мелкая картинка не раздувается. */
  const needWidth = Math.max(
    sourceWidth / box.width,
    (sourceHeight / box.height) * aspect,
  );
  const longSide = Math.max(
    16,
    Math.min(1024, Math.ceil(aspect >= 1 ? needWidth : needWidth / aspect)),
  );
  const canvasWidth = Math.max(
    1,
    aspect >= 1 ? longSide : Math.round(longSide * aspect),
  );
  const canvasHeight = Math.max(
    1,
    aspect >= 1 ? Math.round(longSide / aspect) : longSide,
  );
  /* Видимая часть картинки на холсте и тот же кусок в исходнике. */
  const left = box.left * canvasWidth;
  const top = box.top * canvasHeight;
  const width = box.width * canvasWidth;
  const height = box.height * canvasHeight;
  const x0 = Math.max(0, Math.round(left));
  const y0 = Math.max(0, Math.round(top));
  const x1 = Math.min(canvasWidth, Math.round(left + width));
  const y1 = Math.min(canvasHeight, Math.round(top + height));
  /* Холст — прозрачный RGBA; видимый кусок кладётся строками как есть, без
     наложения sharp (оно тоже сдвигало полупрозрачные точки). */
  const rgba = Buffer.alloc(canvasWidth * canvasHeight * 4);
  if (x1 > x0 && y1 > y0) {
    const pieceWidth = x1 - x0;
    const pieceHeight = y1 - y0;
    /* Картинка на холсте в своём разрешении (вид по умолчанию: холст под неё)
       — кусок берётся из исходника точка в точку. Иначе — пересчёт размера; он
       умножает цвет на прозрачность и обратно, полупрозрачное может сдвинуться
       на единицу цвета. */
    const nativeX = Math.round(x0 - left);
    const nativeY = Math.round(y0 - top);
    const native =
      Math.abs(sourceWidth / width - 1) < 0.01 &&
      Math.abs(sourceHeight / height - 1) < 0.01 &&
      nativeX >= 0 &&
      nativeY >= 0 &&
      nativeX + pieceWidth <= sourceWidth &&
      nativeY + pieceHeight <= sourceHeight;
    const sourceX0 = Math.max(
      0,
      Math.min(
        sourceWidth - 1,
        Math.floor(((x0 - left) / width) * sourceWidth),
      ),
    );
    const sourceY0 = Math.max(
      0,
      Math.min(
        sourceHeight - 1,
        Math.floor(((y0 - top) / height) * sourceHeight),
      ),
    );
    const sourceX1 = Math.max(
      sourceX0 + 1,
      Math.min(sourceWidth, Math.ceil(((x1 - left) / width) * sourceWidth)),
    );
    const sourceY1 = Math.max(
      sourceY0 + 1,
      Math.min(sourceHeight, Math.ceil(((y1 - top) / height) * sourceHeight)),
    );
    const piece = await (
      native
        ? sharp(upright.data).extract({
            left: nativeX,
            top: nativeY,
            width: pieceWidth,
            height: pieceHeight,
          })
        : sharp(upright.data)
            .extract({
              left: sourceX0,
              top: sourceY0,
              width: sourceX1 - sourceX0,
              height: sourceY1 - sourceY0,
            })
            .resize(pieceWidth, pieceHeight, { fit: "fill" })
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const row = pieceWidth * 4;
    for (let y = y0; y < y1; y += 1)
      piece.copy(
        rgba,
        (y * canvasWidth + x0) * 4,
        (y - y0) * row,
        (y - y0 + 1) * row,
      );
  }
  return { width: canvasWidth, height: canvasHeight, rgba };
}

/**
 * Что из проекта в игру не уходит — с объяснением в плане установки, а не
 * молча.
 */
function unsupportedFeatures(configuration) {
  /* Один источник правды с окном (`unsupportedMinimapFeatures` в контракте): окно помечает то же самое у элемента до «Применить». */
  return unsupportedMinimapFeatures(configuration);
}

/**
 * Пакет мини-карты: minimap.gfx, frontend.xml, — когда размытие убрано —
 * graphics.ytd игрока с чёрными масками (`blurMask` из `minimap-blur.js`:
 * `{ file, target }`) и — когда радар отдалён — mapzoomdata.meta
 * (`zoomBase`: тексты штатного файла из common.rpf и файла из update.rpf,
 * если он там есть). Маску и тексты готовит вызывающий: им нужен архив игры,
 * а сборка пакета остаётся чистой функцией от файлов и настроек.
 */
export async function buildMinimapPatch({
  baseGfx,
  baseFrontend,
  configuration,
  damageImage = null,
  healthIconImage = null,
  armorIconImage = null,
  playerMarkerImage = null,
  /* Своя метка других игроков (задача 1 ТЗ 17.10.2026). */
  othersMarkerImage = null,
  /* Свои картинки на карте: `{ [номер элемента]: PNG листа кадров }`. */
  overlayImages = {},
  healthFillImage = null,
  armorFillImage = null,
  blurMask = null,
  zoomBase = null,
  /* Файлы метки и маршрута GPS (задача 10 ТЗ 10.10.2026, вечер):
     `[{ file, target, bytes }]` из `gpsPatchFiles` — в тот же патч. */
  extraFiles = [],
  /* Экран игры игрока (форма из settings.xml) — `compileFrontendXml`. */
  gameScreen = null,
  cacheRoot,
} = {}) {
  const [gfxBase, frontendBase, graphics] = await Promise.all([
    fs.readFile(path.resolve(String(baseGfx || ""))),
    fs.readFile(path.resolve(String(baseFrontend || ""))),
    blurMask?.file ? fs.readFile(path.resolve(blurMask.file)) : null,
  ]);
  const normalized = normalizeMinimapLayout(configuration);
  const needsIcons = contractNeedsIconImages(normalized);
  const videoSides = new Set(
    minimapFillSides(normalized)
      .filter((item) => normalized.effects[item.effect].mode === "video")
      .map((item) => item.side),
  );
  const [
    damage,
    healthIcon,
    armorIcon,
    playerMarker,
    healthFill,
    armorFill,
    othersMarker,
  ] = await Promise.all([
    normalized.effects.damageAssetId && damageImage
      ? prepareDamageImage(
          damageImage,
          MINIMAP_RADAR_ASPECT,
          normalized.effects,
        )
      : null,
    needsIcons && healthIconImage
      ? prepareLosslessImage(healthIconImage)
      : null,
    needsIcons && armorIconImage ? prepareLosslessImage(armorIconImage) : null,
    normalized.effects.playerMarkerMode === "custom" && playerMarkerImage
      ? prepareLosslessImage(playerMarkerImage)
      : null,
    videoSides.has("health") && healthFillImage
      ? prepareFillSheet(healthFillImage)
      : null,
    videoSides.has("armour") && armorFillImage
      ? prepareFillSheet(armorFillImage)
      : null,
    normalized.effects.othersMode === "custom" && othersMarkerImage
      ? prepareLosslessImage(othersMarkerImage)
      : null,
  ]);
  const overlays = Object.fromEntries(
    await Promise.all(
      normalized.overlays
        .filter(
          (item) =>
            item.visible && item.kind === "image" && overlayImages?.[item.id],
        )
        .map(async (item) => [
          item.id,
          await prepareOverlaySheet(overlayImages[item.id]),
        ]),
    ),
  );
  /* Одно расширение сцены на файл фильма и на записи frontend.xml. */
  const sceneExtent = minimapSceneExtentFor(normalized, frontendBase, {
    gameScreen,
  });
  const gfx = compileMinimapGfx(
    gfxBase,
    normalized,
    {
      damage,
      healthIcon,
      armorIcon,
      playerMarker,
      othersMarker,
      overlays,
      healthFill,
      armorFill,
    },
    { sceneExtent },
  );
  const frontend = compileFrontendXml(frontendBase, normalized, {
    gameScreen,
    sceneExtent,
  });
  /* Дальность радара — отдельным файлом. В штатном update.rpf его нет,
     поэтому действие `Import`: положить, а если мод или большая карта уже
     положили свой — заменить, сохранив в нём всё, кроме ступеней радара. */
  const zoom = minimapZoomActive(normalized.zoom)
    ? buildRadarZoomMeta(zoomBase || {}, normalized.zoom)
    : null;
  const zoomBytes = zoom ? Buffer.from(zoom.xml, "utf8") : null;
  /* Свои файлы метки и маршрута — под своими именами рядом с файлами
     мини-карты: имя — только имя файла, без пути, и без повторов. */
  const OWN_FILES = new Set([
    "minimap.gfx",
    "frontend.xml",
    "graphics.ytd",
    "mapzoomdata.meta",
  ]);
  const extras = (Array.isArray(extraFiles) ? extraFiles : []).map((item) => {
    const file = String(item?.file || "");
    if (!/^[a-z0-9_.-]{1,80}$/i.test(file) || OWN_FILES.has(file.toLowerCase()))
      throw new Error(`Файл «${file}» не годится в пакет мини-карты.`);
    if (!minimapExtraTargetAllowed(item?.target))
      throw new Error(
        `Файл «${file}» метит не в свои файлы мини-карты (${String(item?.target || "").slice(0, 120)}).`,
      );
    const bytes = Buffer.isBuffer(item.bytes)
      ? item.bytes
      : Buffer.from(item.bytes || []);
    return { file, target: String(item.target), bytes };
  });
  if (
    new Set(extras.map((item) => item.file.toLowerCase())).size !==
    extras.length
  )
    throw new Error("В пакете мини-карты два файла с одним именем.");
  const root = path.resolve(
    cacheRoot || path.join(os.tmpdir(), "astral-minimap-patches"),
  );
  const patchDirectory = path.join(root, randomUUID());
  const payloadDirectory = path.join(patchDirectory, "payload");
  await fs.mkdir(payloadDirectory, { recursive: true });
  await Promise.all([
    ...extras.map((item) =>
      fs.writeFile(path.join(payloadDirectory, item.file), item.bytes, {
        flag: "wx",
      }),
    ),
    fs.writeFile(path.join(payloadDirectory, "minimap.gfx"), gfx.buffer, {
      flag: "wx",
    }),
    fs.writeFile(path.join(payloadDirectory, "frontend.xml"), frontend.buffer, {
      flag: "wx",
    }),
    graphics
      ? fs.writeFile(path.join(payloadDirectory, "graphics.ytd"), graphics, {
          flag: "wx",
        })
      : null,
    zoomBytes
      ? fs.writeFile(
          path.join(payloadDirectory, "mapzoomdata.meta"),
          zoomBytes,
          { flag: "wx" },
        )
      : null,
  ]);
  const actions = [
    {
      Type: "Replace",
      TargetPath: GFX_TARGET,
      SourcePath: "payload/minimap.gfx",
      Size: gfx.buffer.length,
      Sha256: gfx.sha256,
      IsWholeReplaceNestedRpf: false,
    },
    {
      Type: "Replace",
      TargetPath: FRONTEND_TARGET,
      SourcePath: "payload/frontend.xml",
      Size: frontend.buffer.length,
      Sha256: frontend.sha256,
      IsWholeReplaceNestedRpf: false,
    },
    ...(graphics
      ? [
          {
            Type: "Replace",
            TargetPath: String(blurMask.target),
            SourcePath: "payload/graphics.ytd",
            Size: graphics.length,
            Sha256: sha256(graphics),
            IsWholeReplaceNestedRpf: false,
          },
        ]
      : []),
    ...(zoomBytes
      ? [
          {
            Type: "Import",
            TargetPath: ZOOM_TARGET,
            SourcePath: "payload/mapzoomdata.meta",
            Size: zoomBytes.length,
            Sha256: sha256(zoomBytes),
            IsWholeReplaceNestedRpf: false,
          },
        ]
      : []),
    ...extras.map((item) => ({
      Type: "Replace",
      TargetPath: item.target,
      SourcePath: `payload/${item.file}`,
      Size: item.bytes.length,
      Sha256: sha256(item.bytes),
      IsWholeReplaceNestedRpf: false,
    })),
  ];
  const manifest = {
    ReduxName: "Astral Majestic / GTA5RP minimap",
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: actions.reduce((sum, item) => sum + item.Size, 0),
    Actions: actions,
  };
  await fs.writeFile(
    path.join(patchDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return {
    patch: patchDirectory,
    target: GFX_TARGET,
    targets: actions.map((item) => item.TargetPath),
    size: manifest.TotalPatchSize,
    sha256: sha256(
      Buffer.concat([
        gfx.buffer,
        frontend.buffer,
        ...(graphics ? [graphics] : []),
        ...(zoomBytes ? [zoomBytes] : []),
        ...extras.map((item) => item.bytes),
      ]),
    ),
    files: actions.map((item) => ({
      target: item.TargetPath,
      size: item.Size,
      sha256: item.Sha256,
    })),
    configuration: gfx.configuration,
    frontendEntries: frontend.entries,
    /* Где кадр встал на экране игры и под какую форму — для плана. */
    placement: { map: frontend.placement, screen: frontend.screen },
    /* Расчёт установки и строки карты базового файла — журнал сверки с игрой (`minimap-customizer.js`). */
    frontendInstall: minimapFrontendInstall(normalized, frontendBase, {
      gameScreen,
    }),
    unsupported: unsupportedFeatures(gfx.configuration),
    /* Что получилось с дальностью — для сводки в окне установки. */
    zoom: zoom
      ? {
          active: true,
          onFoot: normalized.zoom.onFoot,
          inVehicle: normalized.zoom.inVehicle,
          scales: {
            onFoot: zoom.levels[RADAR_ZOOM_LEVELS.onFoot].scale,
            inVehicle: zoom.levels[RADAR_ZOOM_LEVELS.inVehicle].scale,
          },
          base: zoom.source,
        }
      : { active: false },
  };
}

/**
 * Годится ли пара файлов в базу мини-карты.
 *
 * Проверка — сборка с включёнными цифрами, перекрашенной стрелкой,
 * спрятанной буквой N, обводкой карты, своей подложкой и контуром полос и
 * сдвинутой картой: так она проходит через все места ActionScript и все
 * символы, которые трогает настоящая сборка, и разойтись с компилятором не
 * может.
 */
export function verifyMinimapBase(gfxBuffer, frontendBuffer) {
  compileMinimapGfx(gfxBuffer, {
    layoutSchemaVersion: MINIMAP_SCHEMA_VERSION,
    layout: {
      widgets: {
        healthNumber: { visible: true },
        armorNumber: { visible: true },
      },
    },
    frame: { outline: { enabled: true } },
    effects: {
      playerMarkerColor: "#ff0000",
      showNorth: false,
      trackMode: "custom",
      barOutline: true,
    },
  });
  compileFrontendXml(frontendBuffer, {
    layoutSchemaVersion: MINIMAP_SCHEMA_VERSION,
    layout: { map: { offsetX: 0.1, offsetY: -0.1, scale: 1.2 } },
  });
  return {
    gfxSha256: sha256(gfxBuffer),
    frontendSha256: sha256(frontendBuffer),
  };
}
