import {
  DAMAGE_BUMP_FRAMES,
  DAMAGE_BUMP_SCALE,
  DAMAGE_FADE_FRAMES,
  DAMAGE_FIELD_SIZE,
  DAMAGE_FIELD_WIDTH,
  DAMAGE_RAINBOW,
  DAMAGE_RAINBOW_STEPS,
  damageCounterScale,
  damageFieldTop,
  damageFont,
  damageHoldFrames,
  damageOutlineOffsets,
  damageRainbowStep,
  hexToRgb,
} from "@modovik/reticle-contract";
import {
  AVM1,
  action,
  assembleActions,
  pushAction,
  register,
} from "./scaleform-avm1.js";
import { defineFunction2 } from "./minimap-gps-line.js";
import { importFont } from "./target-health-gfx-compiler.js";
import {
  IDENTITY_MATRIX,
  SWF_TAG,
  TWIPS,
  defineEditText,
  defineSprite,
  placeObject2,
  swfTag,
} from "./scaleform-swf.js";

/*
 * Счётчик урона в `hud_reticle.gfx` (`@modovik/reticle-contract/damage-counter.js`).
 *
 * Игра сообщает прицелу только факт попадания, поэтому в файле две правки
 * класса `HUD_RETICLE` и один свой клип:
 *
 *   1. `SET_RETICLE_TYPE`: за `this.weaponID = params[0]` — цепочка сравнений,
 *      которая кладёт в `this.astralDmg` урон этого ствола. Хеш ствола приходит
 *      своим именем `ASTRAL_RETICLE_<рисунок>__<стиль>__<ствол>`
 *      (`reticle-weapons.js`): у штатного стиля он один на целый класс.
 *      Имя с номером 0 — ствол без своего рисунка: дальше он идёт штатным
 *      стилем, как и было бы без счётчика. Хеш без своего имени — значение по
 *      штатному стилю (сравнение с константами самого класса), незнакомый —
 *      запасное: класс ведёт его как пистолет.
 *   2. `SHOW_HITMARKER` и `SHOW_SNIPER_HIT`: первым действием метода — вызов
 *      `astralDamageHit`. Цепляться надо к методу, а не к клипу: при выключенной
 *      «Отметке попадания» клип `hitmarker` пустой, а у знака на килле это
 *      другое тело. `SHOW_HITMARKER_EXTERNAL` идёт через `SHOW_HITMARKER`, так
 *      что счёта дважды там нет. Сами методы дальше работают как работали.
 *   3. Свой клип `astralDamageCounter` появляется на первом попадании: на корне
 *      фильма (`this.TIMELINE`), выше `CONTENT`. Игра прячет прицел, выставляя
 *      `CONTENT._visible` и `reticle._alpha`, — счётчика это не касается, а
 *      чёрная маска окуляра оказывается под ним.
 *
 * Перелив, толчок и таймер — в `onEnterFrame` своего клипа. Его ставит только
 * попадание и снимает конец срока: пока числа нет на экране, код не работает.
 * `TweenStarLite` в этом же файле устроен так же.
 *
 * Знает ли игра о `SHOW_SNIPER_HIT` вместо `SHOW_HITMARKER` или вместе с ним, в
 * файле не видно. Поэтому оба считаются одним попаданием, если пришли за один
 * кадр фильма (`hn`, `sn`, `n` на клипе): одно выстрел — одна прибавка.
 *
 * Логика та же, что у `damageCounterHit` и `damageCounterTick` контракта: их
 * исполняет кадр редактора, а тест прогоняет этот код AVM1 и сверяет с ними.
 *
 * Всё это появляется только при включённом счётчике: без него файл байт в байт
 * прежний. Символы — 64750…64771, ниже рисунков стволов.
 */

export const DAMAGE_SYMBOL = "astralDamageCounter";
export const DAMAGE_IDS = Object.freeze({
  first: 64750,
  fontImport: 64750,
  field: 64751,
  outline: 64752,
  sprite: 64753,
  last: 64771,
});

const OP = Object.freeze({
  SUBTRACT: 0x0b,
  MULTIPLY: 0x0c,
  DIVIDE: 0x0d,
  DELETE: 0x3a,
  RETURN: 0x3e,
  MODULO: 0x3f,
  ADD2: 0x47,
  EQUALS2: 0x49,
  STRICT_EQUALS: 0x66,
  GREATER: 0x67,
});

/* Шрифт файла: узкий игра подключает под именем без игрока. */
const FONT_IMPORT_NAME = Object.freeze({ condensed: "$Font2_cond_NOT_GAMERNAME" });

const round2 = (value) => Math.round(value * 100) / 100;

/* -------------------------------- символы -------------------------------- */

/**
 * Клип счётчика: чёрные копии строки (обводка) и над ними основное поле. Шрифт
 * — из библиотеки шрифтов игры: `$Font2` в файле уже есть, остальные
 * подключаются ещё одним `ImportAssets2`, как в hud.gfx.
 */
export function damageCounterDefinitions(index, counter) {
  const fontName = FONT_IMPORT_NAME[counter.font] || damageFont(counter.font).face;
  const known = index.imports.get(fontName);
  const fontId = known ? known.id : DAMAGE_IDS.fontImport;
  const top = damageFieldTop(counter.font);
  const bounds = {
    xmin: Math.round((-DAMAGE_FIELD_WIDTH / 2) * TWIPS),
    xmax: Math.round((DAMAGE_FIELD_WIDTH / 2) * TWIPS),
    ymin: Math.round(top * TWIPS),
    ymax: Math.round((top + DAMAGE_FIELD_SIZE * 1.5) * TWIPS),
  };
  const field = (id, color) =>
    defineEditText({ id, bounds, fontId, fontHeight: DAMAGE_FIELD_SIZE * TWIPS, color, align: 2 });
  const offsets = damageOutlineOffsets(counter);
  const main =
    counter.colorMode === "rainbow"
      ? [DAMAGE_RAINBOW[0] >> 16, (DAMAGE_RAINBOW[0] >> 8) & 255, DAMAGE_RAINBOW[0] & 255]
      : hexToRgb(counter.color);
  const children = offsets.map(([x, y], position) =>
    placeObject2({
      depth: position + 1,
      characterId: DAMAGE_IDS.outline,
      matrix: { ...IDENTITY_MATRIX, tx: Math.round(x * TWIPS), ty: Math.round(y * TWIPS) },
      name: `o${position}`,
    }),
  );
  children.push(
    placeObject2({
      depth: offsets.length + 1,
      characterId: DAMAGE_IDS.field,
      matrix: IDENTITY_MATRIX,
      name: "tf",
    }),
  );
  const exported = Buffer.alloc(4);
  exported.writeUInt16LE(1, 0);
  exported.writeUInt16LE(DAMAGE_IDS.sprite, 2);
  return [
    ...(known ? [] : [importFont(fontId, fontName)]),
    field(DAMAGE_IDS.field, [...main, 255]),
    ...(offsets.length ? [field(DAMAGE_IDS.outline, [0, 0, 0, 255])] : []),
    defineSprite(DAMAGE_IDS.sprite, children),
    swfTag(SWF_TAG.EXPORT_ASSETS, Buffer.concat([exported, Buffer.from(`${DAMAGE_SYMBOL}\0`, "latin1")])),
  ];
}

/* ------------------------------- код AVM1 ------------------------------- */

export function coderFor(pool) {
  let labels = 0;
  const push = (...values) => pushAction(values, pool);
  const op = (code) => action(code);
  /* <регистр>.a.b… на стеке */
  const get = (slot, ...path) => [
    push(register(slot), path[0]),
    op(AVM1.GET_MEMBER),
    ...path.slice(1).flatMap((name) => [push(name), op(AVM1.GET_MEMBER)]),
  ];
  /* <регистр>.a.b… = значение */
  const set = (slot, path, value) => [
    ...(path.length > 1 ? get(slot, ...path.slice(0, -1)) : [push(register(slot))]),
    push(path.at(-1)),
    ...value,
    op(AVM1.SET_MEMBER),
  ];
  const label = (name) => `${name}${(labels += 1)}`;
  /* if (условие) {…}; условие уже посчитано кодом `test`. */
  const when = (test, body) => {
    const skip = label("skip");
    return [...test, op(AVM1.NOT), { branch: AVM1.IF, to: skip }, ...body, { label: skip }];
  };
  const store = (slot, value) => [...value, action(AVM1.STORE_REGISTER, Buffer.from([slot])), op(AVM1.POP)];
  const math = (name, value) => [...value, push(1, "Math"), op(AVM1.GET_VARIABLE), push(name), op(AVM1.CALL_METHOD)];
  const leave = () => [push(undefined), op(OP.RETURN)];
  return { push, op, get, set, label, when, store, math, leave };
}

const CLIP = 3;
const THIS = 1;
const KIND = 2;

/* Флаги метода Rockstar: `this` — в регистре 1, без super и arguments. */
const METHOD_FLAGS = 0x29;

/**
 * `this.astralDamageHit = function(kind) {…}`: 1 — убийство, 2 — попадание,
 * 3 — попадание снайперки (`SHOW_SNIPER_HIT`).
 */
function hitFunction(pool, counter) {
  const c = coderFor(pool);
  const scale = damageCounterScale(counter.size);
  const equalsKind = (value) => [c.push(register(KIND), value), c.op(OP.EQUALS2)];
  const bumped = round2(scale * (1 + DAMAGE_BUMP_SCALE));
  const line = 4;
  const known = c.label("known");
  /* Прочие значения метод игры и сам не показывает. */
  const steps = [
    ...equalsKind(1),
    { branch: AVM1.IF, to: known },
    ...equalsKind(2),
    { branch: AVM1.IF, to: known },
    ...equalsKind(3),
    { branch: AVM1.IF, to: known },
    ...c.leave(),
    { label: known },
    /* Ствол без числа в таблице сервера: попадание не считается. */
    ...c.when([...c.get(THIS, "astralDmg"), c.push(0), c.op(OP.EQUALS2)], c.leave()),
    ...c.store(CLIP, c.get(THIS, "astralCounter")),
    ...c.when(
      [c.push(register(CLIP), undefined), c.op(OP.EQUALS2)],
      [
        /* this.TIMELINE.attachMovie(символ, имя, this.TIMELINE.getNextHighestDepth()) */
        c.push(0),
        ...c.get(THIS, "TIMELINE"),
        c.push("getNextHighestDepth"),
        c.op(AVM1.CALL_METHOD),
        c.push(DAMAGE_SYMBOL, DAMAGE_SYMBOL, 3),
        ...c.get(THIS, "TIMELINE"),
        c.push("attachMovie"),
        c.op(AVM1.CALL_METHOD),
        action(AVM1.STORE_REGISTER, Buffer.from([CLIP])),
        c.op(AVM1.POP),
        ...c.set(THIS, ["astralCounter"], [c.push(register(CLIP))]),
        ...c.set(CLIP, ["_x"], [c.push(counter.x)]),
        ...c.set(CLIP, ["_y"], [c.push(counter.y)]),
        ...c.set(CLIP, ["_xscale"], [c.push(scale)]),
        ...c.set(CLIP, ["_yscale"], [c.push(scale)]),
        ...c.set(CLIP, ["total"], [c.push(0)]),
        ...c.set(CLIP, ["frames"], [c.push(0)]),
        ...c.set(CLIP, ["bump"], [c.push(0)]),
        ...c.set(CLIP, ["hue"], [c.push(0)]),
        ...c.set(CLIP, ["killed"], [c.push(false)]),
        ...c.set(CLIP, ["n"], [c.push(0)]),
        ...c.set(CLIP, ["sn"], [c.push(-1)]),
        ...c.set(CLIP, ["hn"], [c.push(-1)]),
        ...(counter.colorMode === "rainbow"
          ? c.set(CLIP, ["pal"], [c.push(...[...DAMAGE_RAINBOW].reverse(), DAMAGE_RAINBOW.length), c.op(AVM1.INIT_ARRAY)])
          : []),
      ],
    ),
    /* Снайперка: оба сообщения за один кадр — одно попадание. */
    ...c.when(equalsKind(3), [
      ...c.when([...c.get(CLIP, "hn"), ...c.get(CLIP, "n"), c.op(OP.EQUALS2)], c.leave()),
      ...c.set(CLIP, ["sn"], c.get(CLIP, "n")),
    ]),
    ...c.when(
      [...equalsKind(3), c.op(AVM1.NOT)],
      [
        ...c.set(CLIP, ["hn"], c.get(CLIP, "n")),
        ...c.when(
          [...c.get(CLIP, "sn"), ...c.get(CLIP, "n"), c.op(OP.EQUALS2)],
          [
            ...(counter.resetOnKill ? c.when(equalsKind(1), c.set(CLIP, ["killed"], [c.push(true)])) : []),
            ...c.leave(),
          ],
        ),
      ],
    ),
    /* После убийства с «Сбросить после убийства» — новая сумма. */
    ...c.when(c.get(CLIP, "killed"), [
      ...c.set(CLIP, ["total"], [c.push(0)]),
      ...c.set(CLIP, ["killed"], [c.push(false)]),
    ]),
    ...c.set(CLIP, ["total"], [...c.get(CLIP, "total"), ...c.get(THIS, "astralDmg"), c.op(OP.ADD2)]),
    ...(counter.resetOnKill ? c.when(equalsKind(1), c.set(CLIP, ["killed"], [c.push(true)])) : []),
    ...c.set(CLIP, ["frames"], [c.push(0)]),
    ...c.set(CLIP, ["_alpha"], [c.push(counter.opacity)]),
    ...c.set(CLIP, ["_visible"], [c.push(true)]),
    ...(counter.bump
      ? [
          ...c.set(CLIP, ["bump"], [c.push(DAMAGE_BUMP_FRAMES)]),
          ...c.set(CLIP, ["_xscale"], [c.push(bumped)]),
          ...c.set(CLIP, ["_yscale"], [c.push(bumped)]),
        ]
      : []),
    ...c.store(line, [c.push(counter.minus ? "-" : ""), ...c.math("round", c.get(CLIP, "total")), c.op(OP.ADD2)]),
    ...c.set(CLIP, ["tf", "text"], [c.push(register(line))]),
    ...damageOutlineOffsets(counter).flatMap((_, position) =>
      c.set(CLIP, [`o${position}`, "text"], [c.push(register(line))]),
    ),
    ...c.set(CLIP, ["onEnterFrame"], c.get(THIS, "astralDamageTick")),
  ];
  return defineFunction2({
    params: [[KIND, "kind"]],
    registers: 5,
    flags: METHOD_FLAGS,
    steps,
  });
}

/** Функция кадра своего клипа: `this` — сам клип. */
function tickFunction(pool, counter) {
  const c = coderFor(pool);
  const scale = damageCounterScale(counter.size);
  const hold = damageHoldFrames(counter.resetSeconds);
  const increment = (name) => c.set(THIS, [name], [...c.get(THIS, name), c.push(1), c.op(OP.ADD2)]);
  const framesPast = (limit) => [...c.get(THIS, "frames"), c.push(limit), c.op(OP.GREATER)];
  const steps = [
    ...increment("n"),
    ...increment("frames"),
    ...(counter.colorMode === "rainbow"
      ? [
          ...c.set(THIS, ["hue"], [
            ...c.get(THIS, "hue"),
            c.push(damageRainbowStep(counter.rainbowSpeed)),
            c.op(OP.ADD2),
            c.push(DAMAGE_RAINBOW_STEPS),
            c.op(OP.MODULO),
          ]),
          ...c.set(THIS, ["tf", "textColor"], [
            ...c.get(THIS, "pal"),
            ...c.math("floor", c.get(THIS, "hue")),
            c.op(AVM1.GET_MEMBER),
          ]),
        ]
      : []),
    ...(counter.bump
      ? c.when(
          [...c.get(THIS, "bump"), c.push(0), c.op(OP.GREATER)],
          [
            ...c.set(THIS, ["bump"], [...c.get(THIS, "bump"), c.push(1), c.op(OP.SUBTRACT)]),
            /* scale * (1 + K * bump / B) */
            ...c.store(2, [
              c.push(scale),
              c.push(1),
              c.push(DAMAGE_BUMP_SCALE),
              ...c.get(THIS, "bump"),
              c.op(OP.MULTIPLY),
              c.push(DAMAGE_BUMP_FRAMES),
              c.op(OP.DIVIDE),
              c.op(OP.ADD2),
              c.op(OP.MULTIPLY),
            ]),
            ...c.set(THIS, ["_xscale"], [c.push(register(2))]),
            ...c.set(THIS, ["_yscale"], [c.push(register(2))]),
          ],
        )
      : []),
    /* Конец срока: frames >= hold + fade — обнулить и снять код кадра. */
    ...c.when(framesPast(hold + DAMAGE_FADE_FRAMES - 1), [
      ...c.set(THIS, ["total"], [c.push(0)]),
      ...c.set(THIS, ["killed"], [c.push(false)]),
      ...c.set(THIS, ["frames"], [c.push(0)]),
      ...c.set(THIS, ["bump"], [c.push(0)]),
      ...c.set(THIS, ["_visible"], [c.push(false)]),
      ...increment("n"),
      c.push(register(THIS), "onEnterFrame"),
      c.op(OP.DELETE),
      c.op(AVM1.POP),
      ...c.leave(),
    ]),
    /* Затухание: alpha = opacity * (1 - (frames - hold) / fade) */
    ...c.when(framesPast(hold), [
      ...c.set(THIS, ["_alpha"], [
        c.push(counter.opacity),
        c.push(1),
        ...c.get(THIS, "frames"),
        c.push(hold),
        c.op(OP.SUBTRACT),
        c.push(DAMAGE_FADE_FRAMES),
        c.op(OP.DIVIDE),
        c.op(OP.SUBTRACT),
        c.op(OP.MULTIPLY),
      ]),
    ]),
  ];
  return defineFunction2({ registers: 3, flags: METHOD_FLAGS, steps });
}

/** Конец конструктора: урон по умолчанию и функции счётчика. */
export function damageConstructorCode(pool, counter, table) {
  const c = coderFor(pool);
  return assembleActions([
    ...c.set(THIS, ["astralDmg"], [c.push(table.fallback)]),
    ...c.set(THIS, ["astralDamageHit"], [hitFunction(pool, counter)]),
    ...c.set(THIS, ["astralDamageTick"], [tickFunction(pool, counter)]),
  ]);
}

/**
 * Цепочка за `this.weaponID = params[0]`: `this.astralDmg` по хешу ствола, а
 * ствол со своим именем без своего рисунка получает штатный стиль.
 */
export function damageWeaponCode(pool, table) {
  const c = coderFor(pool);
  const steps = [...c.set(THIS, ["astralDmg"], [c.push(table.fallback)])];
  const done = c.label("damage-done");
  for (const item of table.own) {
    const next = c.label("damage-next");
    steps.push(
      ...c.get(THIS, "weaponID"),
      c.push(item.hash),
      c.op(OP.STRICT_EQUALS),
      c.op(AVM1.NOT),
      { branch: AVM1.IF, to: next },
      ...c.set(THIS, ["astralDmg"], [c.push(item.value)]),
      ...(item.alias ? c.set(THIS, ["weaponID"], c.get(THIS, item.alias)) : []),
      { branch: AVM1.JUMP, to: done },
      { label: next },
    );
  }
  for (const item of table.styles) {
    const next = c.label("damage-next");
    steps.push(
      ...c.get(THIS, "weaponID"),
      ...c.get(THIS, item.style),
      c.op(OP.STRICT_EQUALS),
      c.op(AVM1.NOT),
      { branch: AVM1.IF, to: next },
      ...c.set(THIS, ["astralDmg"], [c.push(item.value)]),
      { branch: AVM1.JUMP, to: done },
      { label: next },
    );
  }
  steps.push({ label: done });
  return assembleActions(steps);
}

/** Первое действие `SHOW_HITMARKER`: `this.astralDamageHit(params[0])`. */
export function damageHitmarkerSteps(pool, paramsRegister) {
  const c = coderFor(pool);
  return [
    c.push(register(paramsRegister), 0),
    c.op(AVM1.GET_MEMBER),
    c.push(1, register(THIS), "astralDamageHit"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ];
}

/** Первое действие `SHOW_SNIPER_HIT`: `this.astralDamageHit(3)`. */
export function damageSniperSteps(pool) {
  const c = coderFor(pool);
  return [
    c.push(3, 1, register(THIS), "astralDamageHit"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ];
}
