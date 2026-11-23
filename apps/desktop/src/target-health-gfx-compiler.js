import { createHash } from "node:crypto";
import {
  TARGET_HP_DIGITS_GAP,
  TARGET_HP_SHADOW,
  TARGET_HP_UNIT,
  TARGET_HP_TROUGH_ALPHA,
  hexToRgb,
  normalizeTargetHealth,
  targetHealthFont,
  targetHealthHasBar,
  targetHealthHasDigits,
  targetHealthLayout,
  targetHealthShadowColour,
} from "@modovik/reticle-contract";
import { AVM1, action, assembleActions, assertActionStream, pushAction, register } from "./scaleform-avm1.js";
import {
  IDENTITY_MATRIX,
  SWF_TAG,
  TWIPS,
  allocateCharacterIds,
  alphaOnly,
  defineRectangleShape,
  defineSprite,
  defineSpriteFrames,
  indexSwf,
  parseSwfTags,
  placeObject2,
  readPlacement,
  scaleformHeaderLength,
  swfTag,
  uncompressedScaleform,
  writeRect,
} from "./scaleform-swf.js";

/*
 * Полоска HP над игроком (задача 2 ТЗ 11.10.2026; с того же дня — свой
 * редактор «Полоска HP», `target-hp-customizer.js`) — метка игрока GTA
 * (`mp_gamer_info.gfx` самого игрока) со своей полоской.
 *
 * Как метка устроена в игре (снято с файла Steam Legacy и GTA5.exe):
 *
 *   • каждая метка над игроком — экземпляр экспортного символа
 *     `MP_GAMER_INFO` (`MP_GAMER_INFO_%d` в `asGamerTagLayerContainer`);
 *     компоненты — клипы по именам, номер компонента = порядок имён в
 *     GTA5.exe: 0 `GAMER_NAME`, 1 `CREW_TAG`, 2 `healthArmour`, …;
 *   • `healthArmour` — два вида полосы: `HealthArmour` (HP и броня рядом) и
 *     `HealthNoArmour` (одно HP), в каждом `healthBar`, `healthBarTrough`,
 *     у первого ещё `armourBar`. Кода у них в фильме нет: длину, вид,
 *     видимость, прозрачность и цвет ставит сама игра по этим именам
 *     (строки `HealthArmour`, `HealthNoArmour`, `healthBar`, `armourBar`,
 *     `healthBarTrough` в GTA5.exe), а показ компонента решает скрипт —
 *     `SET_MP_GAMER_TAG_VISIBILITY`/`_ALPHA` (по умолчанию прозрачность 0).
 *
 * Что меняется:
 *
 *   1. полоса игры прозрачна, но остаётся под своими именами и размерами:
 *      `healthBar`/`healthBarTrough`/`armourBar` стоят копиями своих клипов
 *      с прозрачной фигурой внутри (до неё игра не дотягивается — она
 *      безымянная), рамки видов — прозрачны. Длины и видимость игра пишет
 *      как прежде;
 *   2. в `MP_GAMER_INFO` встаёт своя полоска `astralTargetHp`: тело (`body`)
 *      и клип кадра (`astralTick`) — два кадра с одним кодом, он идёт каждый
 *      кадр (так же устроен счётчик цифр мини-карты). Код читает длины полос
 *      игры (`_xscale` — это доля, 0…100) и её выбор вида, ставит их своему
 *      телу и пишет цифры, когда они поменялись. Пустая часть HP повторяет
 *      длину и видимость `healthBarTrough` игры. Сама полоска каждый кадр
 *      встаёт туда, где сейчас `healthArmour` (если игра его сдвинет — она
 *      за ним), выше на «выше или ниже»;
 *   3. «как в игре» — тело видно, когда видно и непрозрачно `healthArmour`
 *      (его прозрачность повторяется); «всегда» — видно всегда, пока видна
 *      сама метка;
 *   4. шрифт цифр — шрифт игры: узкий уже подключён фильмом (им пишется имя),
 *      остальные подключаются ещё одним `ImportAssets2` из gfxfontlib.swf,
 *      как в hud.gfx;
 *   5. «Одна цифра» — одно поле, в нём сумма долей HP и брони (полные —
 *      200), по желанию с подписью «HP».
 *
 * Файл, где чего-то из этого нет, отвергается до установки.
 */

export const GAMER_INFO_GFX_ENTRY = "x64/data/cdimages/scaleform_generic.rpf/mp_gamer_info.gfx";
export const GAMER_INFO_GFX_TARGET = `update:/${GAMER_INFO_GFX_ENTRY}`;

/** Своя полоска в метке: по этому имени узнаётся своя сборка. */
export const TARGET_HP_INSTANCE = "astralTargetHp";
export const TARGET_HP_TICK = "astralTick";

/** Шрифт, которым игра пишет имя игрока: он в фильме уже есть. */
const NAME_FONT = "$Font2_cond_NOT_GAMERNAME";
const FONT_LIBRARY = "gfxfontlib.swf";
/* Узкий шрифт цифр — тот же шрифт имени; остальные — под своими именами. */
const FONT_IMPORT_NAME = Object.freeze({ condensed: NAME_FONT });

const OP = Object.freeze({ ADD2: 0x47, EQUALS2: 0x49 });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/* ------------------------- разбор фильма ------------------------- */

const isPlacementTag = (tag) => tag.code === SWF_TAG.PLACE_OBJECT2 || tag.code === SWF_TAG.PLACE_OBJECT3;

/* Теги спрайта и размещения первого кадра. */
function spriteParts(buffer, tag) {
  const inner = parseSwfTags(buffer, tag.payloadStart + 4, tag.end);
  const firstFrame = inner.findIndex((item) => item.code === SWF_TAG.SHOW_FRAME);
  if (firstFrame < 0) throw new Error("В mp_gamer_info.gfx у клипа метки нет кадра.");
  const placements = inner
    .slice(0, firstFrame)
    .filter(isPlacementTag)
    .map((item) => ({ tag: item, placement: readPlacement(buffer, item) }));
  return { inner, firstFrame, placements };
}

function spriteOf(index, id, label) {
  const tag = index.definitions.get(id);
  if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error(`В mp_gamer_info.gfx ${label} — не клип.`);
  return tag;
}

/* Ровно один клип с этим именем в первом кадре спрайта. */
function named(buffer, tag, name, label) {
  const found = spriteParts(buffer, tag).placements.filter((item) => item.placement?.name === name);
  if (found.length !== 1)
    throw new Error(`В mp_gamer_info.gfx у ${label} клип ${name} найден ${found.length} раз, ожидался один.`);
  return found[0].placement;
}

/**
 * Где в фильме метка, её полоса и шрифт имени. Бросает с объяснением, если
 * файл устроен не как у игры.
 */
export function resolveGamerInfoModel(gfxBuffer) {
  const buffer = uncompressedScaleform(gfxBuffer);
  const index = indexSwf(buffer);
  const rootId = index.exports.get("MP_GAMER_INFO");
  if (rootId === undefined) throw new Error("В mp_gamer_info.gfx нет символа MP_GAMER_INFO — это не метка игрока игры.");
  const root = spriteOf(index, rootId, "MP_GAMER_INFO");
  const rootParts = spriteParts(buffer, root);
  const installed = rootParts.placements.some((item) => item.placement?.name === TARGET_HP_INSTANCE);
  const component = named(buffer, root, "healthArmour", "метки");
  const componentTag = spriteOf(index, component.characterId, "healthArmour");
  const variants = {};
  for (const [key, name, bars] of [
    ["armoured", "HealthArmour", ["healthBar", "healthBarTrough", "armourBar"]],
    ["plain", "HealthNoArmour", ["healthBar", "healthBarTrough"]],
  ]) {
    const placement = named(buffer, componentTag, name, "healthArmour");
    const tag = spriteOf(index, placement.characterId, name);
    for (const bar of bars) {
      const barPlacement = named(buffer, tag, bar, name);
      spriteOf(index, barPlacement.characterId, `${name}.${bar}`);
    }
    variants[key] = { name, tag };
  }
  const font = index.imports.get(NAME_FONT);
  if (!font || font.url !== FONT_LIBRARY)
    throw new Error(`В mp_gamer_info.gfx нет шрифта имени ${NAME_FONT} из ${FONT_LIBRARY}.`);
  const fontImport = index.tags.find((tag) => {
    if (tag.code !== SWF_TAG.IMPORT_ASSETS2) return false;
    const end = buffer.indexOf(0, tag.payloadStart);
    return buffer.toString("latin1", tag.payloadStart, end) === FONT_LIBRARY;
  });
  /* Где `healthArmour` стоит в метке — от него своя полоска и встаёт. */
  const origin = { x: (component.matrix?.tx || 0) / TWIPS, y: (component.matrix?.ty || 0) / TWIPS };
  return { buffer, index, root, rootParts, installed, variants, font, fontImport, origin };
}

/** Стоит ли в этом mp_gamer_info.gfx полоска Astral. */
export function gamerInfoHasTargetHealth(gfxBuffer) {
  return resolveGamerInfoModel(gfxBuffer).installed;
}

/* ------------------------ свои определения ------------------------ */

/**
 * Поле текста шрифтом игры. Как `defineEditText` из scaleform-swf.js, но с
 * разметкой HTML по желанию: строка вида «Цифры» красит HP и броню своими
 * цветами в одном поле.
 */
function editText({ id, width, height, fontId, fontSize, color: [red, green, blue], html = false }) {
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const flags1 = 0x08 /* ReadOnly */ | 0x04 /* HasTextColor */ | 0x01; /* HasFont */
  const flags2 = 0x20 /* HasLayout */ | 0x10 /* NoSelect */ | (html ? 0x02 : 0) | 0x01; /* UseOutlines */
  const font = Buffer.alloc(4);
  font.writeUInt16LE(fontId, 0);
  font.writeUInt16LE(Math.round(fontSize * TWIPS), 2);
  const layout = Buffer.alloc(9);
  layout[0] = 2; // по центру
  return swfTag(
    SWF_TAG.DEFINE_EDIT_TEXT,
    Buffer.concat([
      idBuffer,
      writeRect({ xmin: 0, xmax: Math.round(width * TWIPS), ymin: 0, ymax: Math.round(height * TWIPS) }),
      Buffer.from([flags1, flags2]),
      font,
      Buffer.from([red, green, blue, 255]),
      layout,
      Buffer.from("\0", "utf8"),
    ]),
  );
}

/* ImportAssets2: шрифт из библиотеки шрифтов игры под новым номером. */
export function importFont(id, name) {
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const count = Buffer.alloc(2);
  count.writeUInt16LE(1);
  return swfTag(
    SWF_TAG.IMPORT_ASSETS2,
    Buffer.concat([Buffer.from(`${FONT_LIBRARY}\0`, "latin1"), Buffer.from([1, 0]), count, idBuffer, Buffer.from(`${name}\0`, "latin1")]),
  );
}

const at = (x, y, scale = 1) => ({ a: scale, b: 0, c: 0, d: scale, tx: Math.round(x * TWIPS), ty: Math.round(y * TWIPS) });
const twipsBox = ({ x, y, width, height }) => ({ x: x * TWIPS, y: y * TWIPS, width: width * TWIPS, height: height * TWIPS });
const rgba = (hex, alpha = 255) => [...hexToRgb(hex), Math.round(alpha)];

/*
 * Тело полоски: виды `armoured`/`plain` (полосы, цифры в них или строки
 * цифр друг под другом) или одно поле `digits` (цифры в строку).
 * `allocate(n)` — свободные номера символов; `definitions` копит теги.
 */
function bodySprite(config, layout, fontId, allocate, definitions) {
  const children = [];
  const withBar = targetHealthHasBar(config.view);
  const fontSize = layout.fontSize;
  const field = (box, color, name, depth, html = false) => {
    const [id] = allocate(1);
    definitions.push(editText({ id, width: box.width, height: box.height, fontId, fontSize, color: hexToRgb(color), html }));
    return placeObject2({ depth, characterId: id, matrix: at(box.x, box.y), name });
  };
  /* Поле с тенью: тень — та же строка противоположной яркости (у светлых
     цифр — чёрная, у тёмных — белая), на точку вправо-вниз. */
  const shadedField = (box, color, name, depth, html = false) => [
    ...(config.shadow
      ? [field({ ...box, x: box.x + TARGET_HP_SHADOW, y: box.y + TARGET_HP_SHADOW }, targetHealthShadowColour(color), `${name}Shade`, depth)]
      : []),
    field(box, color, `${name}Text`, depth + 1, html),
  ];
  const rect = (box, fill, depth) => {
    const [id] = allocate(1);
    definitions.push(defineRectangleShape(id, twipsBox(box), fill));
    return placeObject2({ depth, characterId: id, matrix: IDENTITY_MATRIX });
  };
  /* Заливка части — клип с началом у левого края: код тянет `_xscale`. */
  const fill = (box, fillColour, name, depth) => {
    const [shapeId, spriteId] = allocate(2);
    definitions.push(defineRectangleShape(shapeId, twipsBox({ x: 0, y: 0, width: box.width, height: box.height }), fillColour));
    definitions.push(defineSprite(spriteId, [placeObject2({ depth: 1, characterId: shapeId, matrix: IDENTITY_MATRIX })]));
    return placeObject2({ depth, characterId: spriteId, matrix: at(box.x, box.y), name });
  };
  if (layout.single) {
    /* Строку цифр красит разметка: HP и броня своими цветами в одном поле.
       «Одна цифра» — одним цветом HP, разметка ей не нужна. */
    children.push(...shadedField(layout.digits, config.healthColor, "digits", 1, config.view !== "total"));
  } else {
    for (const key of ["armoured", "plain"]) {
      const view = layout[key];
      if (!view) continue;
      const inner = [];
      let depth = 1;
      if (withBar) for (const back of view.backs) inner.push(rect(back, rgba(config.backColor, (config.backOpacity / 100) * 255), depth++));
      for (const part of ["health", "armour"]) {
        const piece = view[part];
        if (!piece) continue;
        const name = part === "health" ? "hp" : "ar";
        const colour = part === "health" ? config.healthColor : config.armourColor;
        if (piece.fill) {
          /* Пустая часть — у HP, как у игры (у брони её в файле нет). */
          if (part === "health") inner.push(fill(piece.fill, rgba(colour, TARGET_HP_TROUGH_ALPHA * 255), "hpt", depth++));
          inner.push(fill(piece.fill, rgba(colour), name, depth++));
        }
        if (piece.field) {
          /* Цифры в полоске — цветом цифр; строки без полосы — цветом части. */
          inner.push(...shadedField(piece.field, config.view === "bar-digits" ? config.textColor : colour, name, depth));
          depth += 2;
        }
      }
      const [spriteId] = allocate(1);
      definitions.push(defineSprite(spriteId, inner));
      children.push(placeObject2({ depth: key === "armoured" ? 1 : 2, characterId: spriteId, matrix: IDENTITY_MATRIX, name: key }));
    }
  }
  const [bodyId] = allocate(1);
  definitions.push(defineSprite(bodyId, children));
  return bodyId;
}

/* --------------------------- код кадра --------------------------- */

/*
 * Код кадра полоски. Вне функции у AVM1 четыре регистра: r0 — своя полоска
 * (`_parent` клипа кадра), r1 — `healthArmour` игры, r2 и r3 — рабочие.
 * Числа держатся полями своей полоски: `hpv`/`arv`/`htv` — доли HP, брони и
 * пустой части HP сейчас, `kv` — игра показывает вид с бронёй, `ka` — своя
 * полоска показывает броню (выключенная броня — никогда), `hpw`/`arw`/`kw` —
 * что уже написано цифрами, `ch` — «есть что переписать».
 */
export function targetHealthFrameActions(input) {
  const config = normalizeTargetHealth(input);
  const layout = targetHealthLayout(config);
  const withBar = targetHealthHasBar(config.view);
  const withDigits = targetHealthHasDigits(config.view);
  const withVariants = !layout.single;
  const P = (...values) => pushAction(values);
  const GM = action(AVM1.GET_MEMBER);
  const SM = action(AVM1.SET_MEMBER);
  const r = register;
  const store = (slot) => [action(AVM1.STORE_REGISTER, Buffer.from([slot])), action(AVM1.POP)];
  /* rN.a.b… на стеке. */
  const get = (slot, ...path) => [P(r(slot), path[0]), GM, ...path.slice(1).flatMap((name) => [P(name), GM])];
  /* rN.a.b… = значение. */
  const put = (slot, path, value) => [
    ...(path.length > 1 ? get(slot, ...path.slice(0, -1)) : [P(r(slot))]),
    P(path.at(-1)),
    ...value,
    SM,
  ];
  let labels = 0;
  const label = (name) => `astral-hp-${name}-${(labels += 1)}`;
  /* if (не условие) пропустить тело. */
  const unless = (condition, body) => {
    const skip = label("skip");
    return [...condition, { branch: AVM1.IF, to: skip }, ...body, { label: skip }];
  };
  const when = (condition, body) => unless([...condition, action(AVM1.NOT)], body);
  const equal = (left, right) => [...left, ...right, action(OP.EQUALS2)];
  const plus = (value, amount) => (amount ? [...value, P(amount), action(OP.ADD2)] : value);
  const round = (value) => [...value, P(1, "Math"), action(AVM1.GET_VARIABLE), P("round"), action(AVM1.CALL_METHOD)];
  /* Доля полосы игры в r3: невидимая — ноль, не число — ноль, не больше 100. */
  const share = (...path) => [
    ...get(1, ...path, "_xscale"),
    ...store(3),
    ...when(equal(get(1, ...path, "_visible"), [P(false)]), [P(0), ...store(3)]),
    ...unless([P(r(3), -1), action(AVM1.GREATER)], [P(0), ...store(3)]),
    ...when([P(r(3), 100), action(AVM1.GREATER)], [P(100), ...store(3)]),
  ];
  /* Доли вида игры: HP и (у полоски) пустая часть HP. */
  const source = (variant) => [
    ...share(variant, "healthBar"),
    ...put(0, ["hpv"], round([P(r(3))])),
    ...(withBar ? [...share(variant, "healthBarTrough"), ...put(0, ["htv"], round([P(r(3))]))] : []),
  ];
  const done = "astral-hp-done";
  const steps = [
    P("_parent"),
    action(AVM1.GET_VARIABLE),
    ...store(0),
    ...get(0, "_parent", "healthArmour"),
    ...store(1),
    ...equal([P(r(1))], [P(undefined)]),
    { branch: AVM1.IF, to: done },
    /* Место: там, где сейчас `healthArmour`, — середина его вида с бронёй,
       выше на «выше или ниже». */
    ...put(0, ["_x"], plus(get(1, "_x"), layout.anchor.x)),
    ...put(0, ["_y"], plus(get(1, "_y"), -layout.raise)),
    /* Вид игры: `HealthNoArmour` спрятан — значит, полоса с бронёй. */
    ...put(0, ["kv"], equal(get(1, "HealthNoArmour", "_visible"), [P(false)])),
  ];
  /* HP — из того вида, что показывает игра. */
  const plainSource = label("plain-source");
  const sourceDone = label("source-done");
  steps.push(
    ...get(0, "kv"),
    action(AVM1.NOT),
    { branch: AVM1.IF, to: plainSource },
    ...source("HealthArmour"),
    { branch: AVM1.JUMP, to: sourceDone },
    { label: plainSource },
    ...source("HealthNoArmour"),
    { label: sourceDone },
    P(0),
    ...store(3),
    ...when(get(0, "kv"), share("HealthArmour", "armourBar")),
    ...put(0, ["arv"], round([P(r(3))])),
    /* Броня выключена — своя полоска всегда одним HP. */
    ...put(0, ["ka"], config.armour ? get(0, "kv") : [P(false)]),
    ...get(0, "body"),
    ...store(2),
  );
  /* Видимость: «как в игре» — как у полосы игры, с её прозрачностью. */
  if (config.visibility === "always") steps.push(...put(2, ["_visible"], [P(true)]));
  else
    steps.push(
      ...put(2, ["_visible"], get(1, "_visible")),
      ...put(2, ["_alpha"], get(1, "_alpha")),
      ...equal(get(1, "_visible"), [P(false)]),
      { branch: AVM1.IF, to: done },
    );
  if (withVariants) {
    /* r3 — свой вид, что виден. */
    if (layout.armoured) {
      const plainLayout = label("plain-layout");
      const layoutDone = label("layout-done");
      steps.push(
        ...put(2, ["armoured", "_visible"], get(0, "ka")),
        ...put(2, ["plain", "_visible"], [...get(0, "ka"), action(AVM1.NOT)]),
        ...get(0, "ka"),
        action(AVM1.NOT),
        { branch: AVM1.IF, to: plainLayout },
        ...get(2, "armoured"),
        ...store(3),
        ...(withBar ? put(3, ["ar", "_xscale"], get(0, "arv")) : []),
        { branch: AVM1.JUMP, to: layoutDone },
        { label: plainLayout },
        ...get(2, "plain"),
        ...store(3),
        { label: layoutDone },
      );
    } else steps.push(...get(2, "plain"), ...store(3));
    if (withBar) steps.push(...put(3, ["hp", "_xscale"], get(0, "hpv")), ...put(3, ["hpt", "_xscale"], get(0, "htv")));
  }
  if (withDigits) {
    /* Цифры — только когда поменялись: строка не собирается каждый кадр.
       `ch` — «что-то поменялось», без переходов внутрь ветки. */
    const differs = (left, right) => [...equal(get(0, left), get(0, right)), action(AVM1.NOT)];
    steps.push(
      ...put(0, ["ch"], differs("hpv", "hpw")),
      ...unless(get(0, "ch"), put(0, ["ch"], differs("arv", "arw"))),
      ...unless(get(0, "ch"), put(0, ["ch"], differs("ka", "kw"))),
      ...get(0, "ch"),
      action(AVM1.NOT),
      { branch: AVM1.IF, to: done },
      ...put(0, ["hpw"], get(0, "hpv")),
      ...put(0, ["arw"], get(0, "arv")),
      ...put(0, ["kw"], get(0, "ka")),
    );
    if (config.view === "total") {
      /* Одна цифра: HP и броня вместе — сложение чисел, потом подпись. */
      steps.push(
        ...get(0, "hpv"),
        ...store(3),
        ...when(get(0, "ka"), [P(r(3)), ...get(0, "arv"), action(OP.ADD2), ...store(3)]),
        ...(config.unit ? [P(r(3), TARGET_HP_UNIT), action(OP.ADD2), ...store(3)] : []),
        ...put(2, ["digitsText", "text"], [P(r(3))]),
        ...(config.shadow ? put(2, ["digitsShade", "text"], [P(r(3))]) : []),
      );
    } else if (withVariants) {
      /* По части: в каждой — её число (r3 — вид, что виден). */
      const text = (part, value) => [
        ...(config.shadow ? put(3, [`${part}Shade`, "text"], get(0, value)) : []),
        ...put(3, [`${part}Text`, "text"], get(0, value)),
      ];
      steps.push(...text("hp", "hpv"));
      if (layout.armoured) steps.push(...when(get(0, "ka"), text("ar", "arv")));
    } else {
      /* Одна строка: HP цветом HP, броня через промежуток — цветом брони. */
      const colour = (hex) => `#${hex.replace(/^#/, "").toUpperCase()}`;
      const add = (value) => [...value, action(OP.ADD2)];
      steps.push(
        P(`<P ALIGN='CENTER'><FONT COLOR='${colour(config.healthColor)}'>`),
        ...add(get(0, "hpv")),
        ...add([P("</FONT>")]),
        ...store(3),
        ...when(get(0, "ka"), [
          P(r(3), `<FONT COLOR='${colour(config.armourColor)}'>${TARGET_HP_DIGITS_GAP}`),
          action(OP.ADD2),
          ...add(get(0, "arv")),
          ...add([P("</FONT>")]),
          ...store(3),
        ]),
        ...put(2, ["digitsText", "htmlText"], [P(r(3), "</P>"), action(OP.ADD2)]),
      );
      if (config.shadow)
        steps.push(
          P(""),
          ...add(get(0, "hpv")),
          ...store(3),
          ...when(get(0, "ka"), [P(r(3), TARGET_HP_DIGITS_GAP), action(OP.ADD2), ...add(get(0, "arv")), ...store(3)]),
          ...put(2, ["digitsShade", "text"], [P(r(3))]),
        );
    }
  }
  steps.push({ label: done }, action(AVM1.END));
  const code = assembleActions(steps);
  assertActionStream(code);
  return code;
}

/* --------------------------- сборка --------------------------- */

/* Полоса игры прозрачна: копия клипа полосы с прозрачной фигурой внутри. */
function veilSprite(buffer, index, characterId, id) {
  const tag = spriteOf(index, characterId, "полоса игры");
  const { placements } = spriteParts(buffer, tag);
  if (!placements.length) throw new Error("В mp_gamer_info.gfx клип полосы игры пустой.");
  return defineSprite(
    id,
    placements.map(({ placement }) => {
      if (placement.code !== SWF_TAG.PLACE_OBJECT2 || placement.move)
        throw new Error("В mp_gamer_info.gfx клип полосы устроен не как у игры.");
      return placeObject2({
        depth: placement.depth,
        characterId: placement.characterId,
        matrix: placement.matrix || IDENTITY_MATRIX,
        cxform: alphaOnly(0),
        name: placement.name || "",
      });
    }),
  );
}

const BAR_NAMES = new Set(["healthBar", "healthBarTrough", "armourBar"]);

/* Вид полосы игры: полосы — прозрачными копиями, рамка — прозрачной. */
function veiledVariant(buffer, tag, veilOf) {
  const inner = parseSwfTags(buffer, tag.payloadStart + 4, tag.end);
  const body = [buffer.subarray(tag.payloadStart, tag.payloadStart + 4)];
  let frame = 0;
  for (const item of inner) {
    if (item.code === SWF_TAG.SHOW_FRAME) frame += 1;
    if (!isPlacementTag(item) || frame > 0) {
      body.push(buffer.subarray(item.offset, item.end));
      continue;
    }
    const placement = readPlacement(buffer, item);
    if (placement.code !== SWF_TAG.PLACE_OBJECT2 || placement.move || placement.characterId === undefined || placement.clipDepth)
      throw new Error("В mp_gamer_info.gfx вид полосы игры устроен не как у игры.");
    const bar = BAR_NAMES.has(placement.name);
    body.push(
      placeObject2({
        depth: placement.depth,
        characterId: bar ? veilOf(placement.characterId) : placement.characterId,
        matrix: placement.matrix || IDENTITY_MATRIX,
        cxform: bar ? placement.cxform || null : alphaOnly(0),
        name: placement.name || "",
      }),
    );
  }
  return swfTag(SWF_TAG.DEFINE_SPRITE, Buffer.concat(body));
}

/*
 * MP_GAMER_INFO со своей полоской поверх всего, что в нём стоит. Начало —
 * там же, куда его каждый кадр ставит код: от `healthArmour` этого файла.
 */
function rootWithDisplay(model, displayId, layout) {
  const { buffer, root, rootParts, origin } = model;
  const { inner, firstFrame, placements } = rootParts;
  const depth = Math.max(0, ...placements.map((item) => item.placement?.depth || 0)) + 1;
  const placement = placeObject2({
    depth,
    characterId: displayId,
    matrix: at(origin.x + layout.anchor.x, origin.y + layout.anchor.y - layout.raise, layout.place.scale),
    name: TARGET_HP_INSTANCE,
  });
  return swfTag(
    SWF_TAG.DEFINE_SPRITE,
    Buffer.concat([
      buffer.subarray(root.payloadStart, root.payloadStart + 4),
      ...inner.slice(0, firstFrame).map((item) => buffer.subarray(item.offset, item.end)),
      placement,
      ...inner.slice(firstFrame).map((item) => buffer.subarray(item.offset, item.end)),
    ]),
  );
}

/**
 * mp_gamer_info.gfx со своей полоской. `rawConfig` — полоска из
 * `@modovik/reticle-contract` (`normalizeTargetHealth`; работа редактора
 * тоже годится — имя отбрасывается).
 */
export function compileTargetHealthGfx(baseBuffer, rawConfig) {
  if (!Buffer.isBuffer(baseBuffer)) throw new TypeError("Base mp_gamer_info.gfx must be a Buffer.");
  const config = normalizeTargetHealth(rawConfig);
  const model = resolveGamerInfoModel(baseBuffer);
  if (model.installed)
    throw new Error("В mp_gamer_info.gfx уже стоит полоска Astral — база должна быть файлом игры.");
  const { buffer, index } = model;
  const headerLength = scaleformHeaderLength(buffer);
  const layout = targetHealthLayout(config);

  let next = 65000;
  const used = new Set(index.usedIds);
  const allocate = (count) => {
    const ids = allocateCharacterIds({ usedIds: used }, count, next);
    for (const id of ids) used.add(id);
    next = Math.min(...ids) - 1;
    return ids;
  };

  /* Шрифт цифр: узкий — шрифт имени, остальные — новым импортом. */
  const fontName = FONT_IMPORT_NAME[config.font] || targetHealthFont(config.font).face;
  const existing = index.imports.get(fontName);
  let fontId = existing?.url === FONT_LIBRARY ? existing.id : null;
  let fontTag = null;
  if (fontId === null) {
    [fontId] = allocate(1);
    fontTag = importFont(fontId, fontName);
  }

  /* Прозрачные копии клипов полос — по одной на клип. */
  const veils = new Map();
  const veilTags = [];
  const veilOf = (characterId) => {
    if (!veils.has(characterId)) {
      const [id] = allocate(1);
      veils.set(characterId, id);
      veilTags.push(veilSprite(buffer, index, characterId, id));
    }
    return veils.get(characterId);
  };
  const variantTags = new Map();
  for (const variant of Object.values(model.variants))
    variantTags.set(variant.tag.offset, veiledVariant(buffer, variant.tag, veilOf));

  const definitions = [];
  const bodyId = bodySprite(config, layout, fontId, allocate, definitions);
  const [tickId, displayId] = allocate(2);
  const code = swfTag(SWF_TAG.DO_ACTION, targetHealthFrameActions(config));
  definitions.push(defineSpriteFrames(tickId, [[code], [code]]));
  definitions.push(
    defineSprite(displayId, [
      placeObject2({ depth: 1, characterId: bodyId, matrix: IDENTITY_MATRIX, name: "body" }),
      placeObject2({ depth: 2, characterId: tickId, matrix: IDENTITY_MATRIX, name: TARGET_HP_TICK }),
    ]),
  );

  /* Порядок: определение раньше применения. Копии полос — перед первым
     видом полосы; своя полоска — перед MP_GAMER_INFO; шрифт — за шрифтом
     имени. */
  const firstVariant = Math.min(...[...variantTags.keys()]);
  const output = [buffer.subarray(0, headerLength)];
  for (const tag of model.index.tags) {
    if (tag.offset === firstVariant) output.push(...veilTags);
    if (tag.offset === model.root.offset) output.push(...definitions, rootWithDisplay(model, displayId, layout));
    else output.push(variantTags.get(tag.offset) || buffer.subarray(tag.offset, tag.end));
    if (fontTag && tag.offset === model.fontImport?.offset) output.push(fontTag);
  }
  if (fontTag && !model.fontImport) throw new Error("В mp_gamer_info.gfx нет подключения шрифтов игры.");
  if (!model.index.tags.some((tag) => tag.offset === model.root.offset))
    throw new Error("В mp_gamer_info.gfx символ MP_GAMER_INFO лежит не на верхнем уровне файла.");
  if (model.fontImport && model.fontImport.offset > model.root.offset)
    throw new Error("В mp_gamer_info.gfx шрифты подключаются после метки — файл устроен не как у игры.");
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return { buffer: compiled, config, sha256: sha256(compiled) };
}

/**
 * Годится ли файл в базу полоски: та же сборка самыми полными видами —
 * полоски друг под другом с цифрами, тенью и шрифтом, который подключается
 * импортом, и цифры в строку.
 */
export function verifyTargetHealthBase(gfxBuffer) {
  compileTargetHealthGfx(gfxBuffer, { view: "bar-digits", visibility: "game", layout: "stack", font: "cash", shadow: true });
  compileTargetHealthGfx(gfxBuffer, { view: "digits", visibility: "always", layout: "row", font: "condensed", shadow: true });
  return { gfxSha256: sha256(gfxBuffer) };
}
