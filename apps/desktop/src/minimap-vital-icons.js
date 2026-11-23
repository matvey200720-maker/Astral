import {
  MINIMAP_VITAL_BLINK_FRAMES,
  MINIMAP_VITAL_STYLE_IMAGE,
  minimapVitalColours,
  minimapVitalStyle,
  vitalIconShapes,
} from "@modovik/minimap-contract";
import { AVM1, action, assembleActions, pushAction, register } from "./scaleform-avm1.js";
import {
  SWF_TAG,
  definePolygonsShape,
  defineSprite,
  defineSpriteFrames,
  placeObject2,
  solidColor,
  swfTag,
} from "./scaleform-swf.js";

/*
 * Значки HP и брони как шкалы в minimap.gfx (10.11.2026, договор — `packages/minimap-contract/vital-icons.js`).
 *
 * РАЗВЕДКА (по разобранному штатному скрипту, Steam Legacy `minimap.gfx` b83c49da…):
 *  • число. `SET_PLAYER_HEALTH(newHealthValue, wasAdded, capacity, showDamage)` и `SET_PLAYER_ARMOUR` получают запас от игры сразу в процентах (при `capacity` ≤ 100 приводят к
 *    процентам сами: `r2 = r2 · 100 / capacity`), штатная полоса — `HEALTH._xscale = r2` (0…100). К концу метода значение лежит в `this.currentHealthValue` / `this.currentArmourValue`,
 *    а прежнее — в `this.previous…`. Методы зовутся при изменении запаса, а не каждый кадр; тот же метод и в обычном радаре, и в развёрнутом (после смены кадра
 *    `SETUP_HEALTH_ARMOUR` перепривязывает спрайт полос и дописки «цифры» исполняются снова — туда же встаёт обновление значка), и в машине.
 *  • чем рисовать. Дугу кодом на каждое число (`lineTo`/`curveTo`) этот фильм умеет (линия маршрута GPS), но для шкалы это лишний код AVM1 на каждый запас. Вместо этого
 *    — спрайт из готовых кадров (как вылетающие цифры): кадр 1 пуст, кадр 1 + n — «заполнено на n шагов», на изменение запаса одна команда `gotoAndStop`. Цвет — не в
 *    фигурах (они белые), а в месте: один спрайт кадров ставится по ступеням (обычный, средний и малый запас), и виден тот, чей порог сейчас.
 *  • цена. Кольцо и дуга — 61 кадр, около 12 и 9 КБ фигур; сегменты и точки — по 11 кадров (3–4 КБ); сердце, щит и капсула — 41 кадр (2–5 КБ). Кадры общие для HP и
 *    брони, если вид и фигура те же (кольцо и дуга — всегда, «сердце и щит» — нет). В кадре одна фигура: стоимость кадра отрисовки — как у штатной полосы.
 */

/** Единица значка в твипах: фигуры рисуются в квадрате ±UNIT/2, на месте масштабируются на размер значка. */
const UNIT = 4000;
const REMOVE = (depth) => {
  const body = Buffer.alloc(2);
  body.writeUInt16LE(depth);
  return swfTag(SWF_TAG.REMOVE_OBJECT2, body);
};
const STOP = () => swfTag(SWF_TAG.DO_ACTION, Buffer.from([0x07, 0x00]), false);
const DIVIDE = 0x0d;
const MULTIPLY = 0x0c;
const AND = 0x10;
const ADD2 = 0x47;
const GET_VARIABLE = AVM1.GET_VARIABLE;
const SUBTRACT = 0x0b;
const EQUALS2 = 0x49;

const rgbOf = (hex) => [1, 3, 5].map((at) => Number.parseInt(String(hex).slice(at, at + 2), 16) || 0);

/** Имена значков в спрайте полос (те же, что у значков-картинок: игра их не ищет). */
export const MINIMAP_VITAL_INSTANCES = Object.freeze({ health: "astralHealthIcon", armour: "astralArmourIcon" });
export const MINIMAP_VITAL_DEPTHS = Object.freeze({ health: 22, armour: 23 });
/** Ступени значка: имя места и фильм-обёртка с кадрами внутри (`f`). */
export const MINIMAP_VITAL_TIERS = Object.freeze({ normal: "n", mid: "m", low: "l" });

/**
 * Что собирать: по сторонам HP и брони — вид, ступени и пороги, либо `null` (значок — картинка или его нет). Одну эту функцию читают и сборка спрайта, и дописки в ActionScript.
 * @param {object} configuration `normalizeMinimapLayout(...)`
 */
export function minimapVitalPlan(configuration) {
  const { effects, layout } = configuration;
  const side = (key, widgetKey, styleKey) => {
    const style = effects[styleKey];
    if (!layout.widgets[widgetKey].visible || style === MINIMAP_VITAL_STYLE_IMAGE || !minimapVitalStyle(style)) return null;
    const colours = minimapVitalColours(effects, key);
    const levels = effects.vitalLevelColours === true;
    const blink = effects.vitalBlinkLow === true;
    /* Ступени: цвета по уровню — три; одно мигание — обычная и малая (та же окраска); иначе одна. */
    const tiers = levels ? ["normal", "mid", "low"] : blink ? ["normal", "low"] : ["normal"];
    return {
      key,
      style,
      thickness: effects.vitalThickness,
      steps: minimapVitalStyle(style).steps,
      instance: MINIMAP_VITAL_INSTANCES[key],
      depth: MINIMAP_VITAL_DEPTHS[key],
      tiers,
      blink,
      colours: {
        normal: colours.normal,
        mid: levels ? colours.mid : colours.normal,
        low: levels ? colours.low : colours.normal,
      },
      lowAt: Math.round(colours.lowAt),
      midBelow: Math.round(colours.midBelow),
      lowInclusive: colours.lowInclusive,
      value: key === "health" ? "currentHealthValue" : "currentArmourValue",
      method: key === "health" ? "SET_PLAYER_HEALTH" : "SET_PLAYER_ARMOUR",
      previous: key === "health" ? "previousHealthValue" : "previousArmourValue",
    };
  };
  const plan = {
    health: side("health", "healthIcon", "healthIconStyle"),
    armour: side("armour", "armorIcon", "armorIconStyle"),
  };
  return plan.health || plan.armour ? plan : null;
}

/** Фигуры вида (белые) в твипах: контуры единичного квадрата, умноженные на `UNIT`. */
const toTwips = (contours) => contours.map((contour) => contour.map(([x, y]) => [x * UNIT, y * UNIT]));

/** Спрайт кадров вида: кадр 1 пуст (и `stop`), кадр 1 + n — фигура «заполнено на n шагов». Возвращает его id. */
function framesSprite(shapes, allocate, definitions) {
  const white = [255, 255, 255, 255];
  const frames = [[STOP()]];
  let previous = false;
  for (let level = 1; level <= shapes.steps; level += 1) {
    const contours = toTwips(shapes.frames[level]).filter((contour) => contour.length >= 3);
    const tags = [];
    if (previous) tags.push(REMOVE(1));
    if (contours.length) {
      const [shapeId] = allocate(1);
      definitions.push(definePolygonsShape(shapeId, contours, white));
      tags.push(placeObject2({ depth: 1, characterId: shapeId }));
      previous = true;
    } else previous = false;
    frames.push(tags);
  }
  const [spriteId] = allocate(1);
  definitions.push(defineSpriteFrames(spriteId, frames));
  return spriteId;
}

/** Обёртка ступени: внутри `f` — спрайт кадров; у мигающей ступени — кадры, на которых `f` то гаснет до четверти, то возвращается. */
function tierWrapper(framesId, blink, allocate, definitions) {
  const [wrapperId] = allocate(1);
  if (!blink) {
    definitions.push(defineSprite(wrapperId, [placeObject2({ depth: 1, characterId: framesId, name: "f" })]));
    return wrapperId;
  }
  const half = Math.max(1, Math.floor(MINIMAP_VITAL_BLINK_FRAMES / 2));
  const frames = [];
  for (let at = 0; at < MINIMAP_VITAL_BLINK_FRAMES; at += 1) {
    if (at === 0) frames.push([placeObject2({ depth: 1, characterId: framesId, name: "f" })]);
    else if (at === half) frames.push([placeObject2({ depth: 1, move: true, cxform: { mult: [256, 256, 256, 64] } })]);
    else frames.push([]);
  }
  definitions.push(defineSpriteFrames(wrapperId, frames));
  return wrapperId;
}

/**
 * Значок стороны: контейнер с подложкой и ступенями. Возвращает тег размещения (в спрайт полос).
 * @param {{ plan: object, rect: { x: number, y: number, size: number }, track: { color: string, opacity: number }, allocate: Function, definitions: Buffer[], cache: Map<string, number> }} input
 *   `rect` — центр и сторона значка в твипах; `cache` — общий на сборку спрайта полос: одни и те же кадры у HP и брони строятся один раз.
 */
export function vitalIconPlacement({ plan, rect, track, allocate, definitions, cache, cxform = null }) {
  const kindKey = plan.style === "fill" ? plan.key : "any";
  const shapes = vitalIconShapes(plan.style, { kind: plan.key, thickness: plan.thickness });
  const cacheKey = `${plan.style}|${kindKey}|${plan.thickness}`;
  let framesId = cache.get(cacheKey);
  if (framesId === undefined) {
    framesId = framesSprite(shapes, allocate, definitions);
    cache.set(cacheKey, framesId);
  }
  const children = [];
  const trackContours = toTwips(shapes.track).filter((contour) => contour.length >= 3);
  if (trackContours.length && track.opacity > 0) {
    const [trackId] = allocate(1);
    definitions.push(definePolygonsShape(trackId, trackContours, [255, 255, 255, 255]));
    children.push(placeObject2({ depth: 1, characterId: trackId, cxform: solidColor(rgbOf(track.color), Math.round((track.opacity * 255) / 100)) }));
  }
  plan.tiers.forEach((tier, at) => {
    const wrapperId = tierWrapper(framesId, plan.blink && tier === "low", allocate, definitions);
    children.push(
      placeObject2({
        depth: 2 + at,
        characterId: wrapperId,
        name: MINIMAP_VITAL_TIERS[tier],
        cxform: solidColor(rgbOf(plan.colours[tier])),
      }),
    );
  });
  const [containerId] = allocate(1);
  definitions.push(defineSprite(containerId, children));
  const scale = rect.size / UNIT;
  return placeObject2({
    depth: plan.depth,
    characterId: containerId,
    matrix: { a: scale, b: 0, c: 0, d: scale, tx: rect.x, ty: rect.y },
    name: plan.instance,
    ...(cxform ? { cxform } : {}),
  });
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* ActionScript: на каждое изменение запаса — кадр и видимость ступеней                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

/** this.HEALTH_ARMOUR_BAR_MC.<значок>[.<ступень>[.f]] на стеке. */
const iconPath = (plan, pool, tier = null, inner = false) => [
  pushAction([register(1), "HEALTH_ARMOUR_BAR_MC"], pool),
  action(AVM1.GET_MEMBER),
  pushAction([plan.instance], pool),
  action(AVM1.GET_MEMBER),
  ...(tier ? [pushAction([MINIMAP_VITAL_TIERS[tier]], pool), action(AVM1.GET_MEMBER)] : []),
  ...(inner ? [pushAction(["f"], pool), action(AVM1.GET_MEMBER)] : []),
];

/** Номер кадра: Math.min(шагов, Math.ceil(запас · шагов / 100)) + 1 — то же считает `minimapVitalFrame`. */
const frameNumber = (plan, pool) => [
  pushAction([register(1), plan.value], pool),
  action(AVM1.GET_MEMBER),
  pushAction([plan.steps], pool),
  action(MULTIPLY),
  pushAction([100], pool),
  action(DIVIDE),
  pushAction([1, "Math"], pool),
  action(GET_VARIABLE),
  pushAction(["ceil"], pool),
  action(AVM1.CALL_METHOD),
  pushAction([plan.steps, 2, "Math"], pool),
  action(GET_VARIABLE),
  pushAction(["min"], pool),
  action(AVM1.CALL_METHOD),
  pushAction([1], pool),
  action(ADD2),
];

/** Запас выше малого порога (у HP — «не мало» = `запас > порога`, у брони — `не (запас < порога)`). */
const aboveLow = (plan, pool) =>
  plan.lowInclusive
    ? [pushAction([register(1), plan.value], pool), action(AVM1.GET_MEMBER), pushAction([plan.lowAt], pool), action(AVM1.GREATER)]
    : [pushAction([register(1), plan.value], pool), action(AVM1.GET_MEMBER), pushAction([plan.lowAt], pool), action(AVM1.LESS2), action(AVM1.NOT)];

const belowMid = (plan, pool) => [pushAction([register(1), plan.value], pool), action(AVM1.GET_MEMBER), pushAction([plan.midBelow], pool), action(AVM1.LESS2)];

/** Условие видимости ступени. */
function tierCondition(plan, tier, pool) {
  const levels = plan.tiers.includes("mid");
  if (tier === "low") return [...aboveLow(plan, pool), action(AVM1.NOT)];
  if (tier === "mid") return [...aboveLow(plan, pool), ...belowMid(plan, pool), action(AND)];
  /* Обычная: выше малого и (если есть средняя) не ниже середины. */
  return levels ? [...aboveLow(plan, pool), ...belowMid(plan, pool), action(AVM1.NOT), action(AND)] : aboveLow(plan, pool);
}

/**
 * Дописка в метод игры и в привязку после смены кадра радара: на каждую ступень — кадр её спрайта, затем видимость ступеней.
 * @param {{ frames?: boolean }} [options] `frames: false` — кадр значка не ставится (его ведёт тик плавной заливки, `vitalSmoothTickActions`), остаётся видимость ступеней
 * @returns {Buffer} действия без ветвлений (охрана «значение ещё не пришло» — снаружи, `guardedCode`)
 */
export function vitalIconCode(plan, pool, { frames = true } = {}) {
  const parts = [];
  for (const tier of frames ? plan.tiers : []) {
    parts.push(
      ...frameNumber(plan, pool),
      pushAction([1], pool),
      ...iconPath(plan, pool, tier, true),
      pushAction(["gotoAndStop"], pool),
      action(AVM1.CALL_METHOD),
      action(AVM1.POP),
    );
  }
  if (plan.tiers.length > 1)
    for (const tier of plan.tiers) {
      parts.push(...iconPath(plan, pool, tier), pushAction(["_visible"], pool), ...tierCondition(plan, tier, pool), action(AVM1.SET_MEMBER));
    }
  return Buffer.concat(parts);
}

/*
 * Плавная заливка значков-шкал (21.11.2026, `effects.vitalFillSmooth`): запас идёт к кадру значка не скачком, а за несколько десятых секунды — как предпросмотр
 * (`useSmoothFill`: постоянная времени 0,18 с при скорости 100 %). Метод игры пишет в спрайт полос только цель (`astralHpGoal` / `astralArGoal`), спрайт `astralVitalTick`
 * каждый кадр ведёт показанное значение (`astralHpFill` / `astralArFill`) к цели на долю разницы и, когда оно сдвинулось, ставит кадр каждой ступени значка. Первое значение —
 * сразу. Ближе чем на четверть процента — ровно цель.
 */
export const MINIMAP_VITAL_SMOOTH = Object.freeze({
  tick: "astralVitalTick",
  tickDepth: 62,
  goal: Object.freeze({ health: "astralHpGoal", armour: "astralArGoal" }),
  shown: Object.freeze({ health: "astralHpFill", armour: "astralArFill" }),
  applied: Object.freeze({
    health: "astralHpFillApplied",
    armour: "astralArFillApplied",
  }),
});

/** Постоянная времени заливки при скорости 100 %, секунды (та же, что у предпросмотра). */
export const MINIMAP_VITAL_SMOOTH_SECONDS = 0.18;

/** Доля пути к цели за кадр игры (30 кадров в секунду) при скорости анимации `speed` (проценты). */
export const vitalSmoothEase = (speed = 100) =>
  Math.round(
    (1 -
      Math.exp(
        -1 / (30 * ((MINIMAP_VITAL_SMOOTH_SECONDS * 100) / Math.max(1, Number(speed) || 100))),
      )) *
      1e4,
  ) / 1e4;

/** r0.<имя> на стеке. */
const member = (name) => [pushAction([register(0), name]), action(AVM1.GET_MEMBER)];
const store = (index) => [action(AVM1.STORE_REGISTER, Buffer.from([index])), action(AVM1.POP)];

/**
 * Код кадра тика плавной заливки. `plans` — `[{ key, steps, instance, tiers }]` (из `minimapVitalPlan`), `ease` — доля пути за кадр.
 */
export function vitalSmoothTickActions(plans, ease) {
  const steps = [pushAction(["_parent"]), action(GET_VARIABLE), ...store(0)];
  plans.forEach((plan, at) => {
    const goal = MINIMAP_VITAL_SMOOTH.goal[plan.key];
    const shown = MINIMAP_VITAL_SMOOTH.shown[plan.key];
    const applied = MINIMAP_VITAL_SMOOTH.applied[plan.key];
    const skip = `astral-vs-skip-${at}`;
    steps.push(
      ...member(goal),
      ...store(2),
      pushAction([register(2)]),
      pushAction([undefined]),
      action(EQUALS2),
      { branch: AVM1.IF, to: skip },
      ...member(shown),
      ...store(3),
      pushAction([register(3)]),
      pushAction([undefined]),
      action(EQUALS2),
      action(AVM1.NOT),
      { branch: AVM1.IF, to: `astral-vs-have-${at}` },
      pushAction([register(2)]),
      ...store(3),
      { label: `astral-vs-have-${at}` },
      /* r1 — разница (у кадра DoAction только регистры 0…3); меньше четверти — ровно цель, иначе доля пути. */
      pushAction([register(2)]),
      pushAction([register(3)]),
      action(SUBTRACT),
      ...store(1),
      pushAction([register(1), 1, "Math"]),
      action(GET_VARIABLE),
      pushAction(["abs"]),
      action(AVM1.CALL_METHOD),
      pushAction([0.25]),
      action(AVM1.LESS2),
      { branch: AVM1.IF, to: `astral-vs-snap-${at}` },
      pushAction([register(3)]),
      pushAction([register(1)]),
      pushAction([ease]),
      action(MULTIPLY),
      action(ADD2),
      ...store(3),
      { branch: AVM1.JUMP, to: `astral-vs-set-${at}` },
      { label: `astral-vs-snap-${at}` },
      pushAction([register(2)]),
      ...store(3),
      { label: `astral-vs-set-${at}` },
      ...member(applied),
      pushAction([register(3)]),
      action(EQUALS2),
      { branch: AVM1.IF, to: skip },
      pushAction([register(0), shown, register(3)]),
      action(AVM1.SET_MEMBER),
      pushAction([register(0), applied, register(3)]),
      action(AVM1.SET_MEMBER),
    );
    for (const tier of plan.tiers)
      steps.push(
        /* Номер кадра: Math.min(шагов, Math.ceil(показанное · шагов / 100)) + 1. */
        pushAction([register(3), plan.steps]),
        action(MULTIPLY),
        pushAction([100]),
        action(DIVIDE),
        pushAction([1, "Math"]),
        action(GET_VARIABLE),
        pushAction(["ceil"]),
        action(AVM1.CALL_METHOD),
        pushAction([plan.steps, 2, "Math"]),
        action(GET_VARIABLE),
        pushAction(["min"]),
        action(AVM1.CALL_METHOD),
        pushAction([1]),
        action(ADD2),
        pushAction([1]),
        ...member(plan.instance),
        pushAction([MINIMAP_VITAL_TIERS[tier]]),
        action(AVM1.GET_MEMBER),
        pushAction(["f"]),
        action(AVM1.GET_MEMBER),
        pushAction(["gotoAndStop"]),
        action(AVM1.CALL_METHOD),
        action(AVM1.POP),
      );
    steps.push({ label: skip });
  });
  steps.push(action(AVM1.END));
  return assembleActions(steps);
}

/** Спрайт тика: два кадра с тем же кодом — он идёт каждый кадр игры. Возвращает его id. */
export function vitalSmoothTickSprite(plans, ease, allocate, definitions) {
  const [spriteId] = allocate(1);
  const code = swfTag(SWF_TAG.DO_ACTION, vitalSmoothTickActions(plans, ease));
  definitions.push(defineSpriteFrames(spriteId, [[code], [code]]));
  return spriteId;
}
