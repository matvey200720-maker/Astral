import {
  AVM1,
  action,
  assembleActions,
  pushAction,
  register,
} from "./scaleform-avm1.js";
import { defineFunction2 } from "./minimap-gps-line.js";

/*
 * Мост здоровья и брони: радар (`minimap.gfx`) → фильм прицела (`hud_reticle.gfx`).
 *
 * ЗАЧЕМ. Живые HP и броня игры приходят только фильму радара (`SET_PLAYER_HEALTH`,
 * `SET_PLAYER_ARMOUR`, в процентах 0…100). Фильму прицела они не приходят, а
 * индикатор у прицела рисует именно он. Мост — это запись чисел в общее место, из
 * которого их прочтёт фильм прицела. Общим местом служит `_global` — им делят
 * свои числа `hud.gfx` и `hud_reticle.gfx` (индикатор перезарядки, проверено в
 * игре 15.11.2026), но для радара это НЕ ПРОВЕРЕНО: он отдельный фильм.
 *
 * ПРОБА. Пока не известно, какой путь живой, писатель кладёт числа сразу в
 * несколько мест (`BRIDGE_CHANNELS`), а читатель (`reticle-hp-gfx.js`) строкой на
 * путь показывает, что нашёл. Живой путь — тот, где у строки есть числа.
 *
 * Здесь — только записывающая сторона и перечень путей; она ничего не знает ни о
 * компиляторе радара, ни о компиляторе прицела (обоим нужен один и тот же
 * перечень, поэтому он лежит отдельно).
 */

/* Имена свойств в общем месте: здоровье, броня, сколько раз писали. */
export const BRIDGE_PROP = Object.freeze({
  health: "astralHp",
  armour: "astralAr",
  count: "astralN",
});

/**
 * Пути проверки. `owner` — путь начинается от `this` (экземпляр класса, у писателя
 * это радар, у читателя — прицел), поэтому у писателя и читателя он свой, но по
 * одному и тому же правилу: `this._parent` и выше.
 * Цвет — строки на кадре (читатель красит каждую своим цветом).
 */
export const BRIDGE_CHANNELS = Object.freeze([
  Object.freeze({
    id: "G",
    name: "_global",
    kind: "variable",
    colour: [255, 64, 64],
    colourName: "красный",
    note: "общий `_global` (как у hud.gfx и hud_reticle.gfx)",
  }),
  Object.freeze({
    id: "R",
    name: "_root",
    kind: "variable",
    colour: [64, 255, 64],
    colourName: "зелёный",
    note: "`_root` своего фильма",
  }),
  Object.freeze({
    id: "L0",
    name: "_level0",
    kind: "variable",
    colour: [90, 140, 255],
    colourName: "синий",
    note: "уровень 0",
  }),
  Object.freeze({
    id: "L1",
    name: "_level1",
    kind: "variable",
    colour: [255, 240, 0],
    colourName: "жёлтый",
    note: "уровень 1",
  }),
  Object.freeze({
    id: "L2",
    name: "_level2",
    kind: "variable",
    colour: [255, 0, 255],
    colourName: "пурпурный",
    note: "уровень 2",
  }),
  Object.freeze({
    id: "P1",
    kind: "parent",
    depth: 1,
    colour: [0, 255, 255],
    colourName: "голубой",
    note: "`this._parent`",
  }),
  Object.freeze({
    id: "P2",
    kind: "parent",
    depth: 2,
    colour: [255, 150, 0],
    colourName: "оранжевый",
    note: "`this._parent._parent`",
  }),
  Object.freeze({
    id: "P3",
    kind: "parent",
    depth: 3,
    colour: [170, 255, 0],
    colourName: "салатовый",
    note: "`this._parent._parent._parent`",
  }),
  Object.freeze({
    id: "Sys",
    name: "System",
    kind: "variable",
    colour: [170, 100, 255],
    colourName: "фиолетовый",
    note: "объект `System`",
  }),
  Object.freeze({
    id: "Stg",
    name: "Stage",
    kind: "variable",
    colour: [255, 120, 190],
    colourName: "розовый",
    note: "объект `Stage`",
  }),
  Object.freeze({
    id: "Mth",
    name: "Math",
    kind: "variable",
    colour: [0, 210, 160],
    colourName: "бирюзовый",
    note: "объект `Math`",
  }),
  Object.freeze({
    id: "Sho",
    kind: "shared",
    colour: [215, 160, 100],
    colourName: "песочный",
    note: '`SharedObject.getLocal("astralhp").data` (только память, без записи на диск)',
  }),
]);

/** Регистры функции-писателя: 1 — this (флаги метода), 2 — имя свойства, 3 — значение, 4 — место, 5 — запас. */
const THIS = 1;
const PROP = 2;
const VALUE = 3;
const PLACE = 4;

/* Флаги метода Rockstar: `this` — в регистре 1, без super и arguments. */
export const BRIDGE_METHOD_FLAGS = 0x29;

const OP = Object.freeze({ GREATER: 0x67 });

/** Небольшой сборщик кода: то, что нужно писателю и читателю. */
export function bridgeCoder(pool) {
  let labels = 0;
  const push = (...values) => pushAction(values, pool);
  const op = (code) => action(code);
  const get = (slot, ...path) => [
    push(register(slot), path[0]),
    op(AVM1.GET_MEMBER),
    ...path.slice(1).flatMap((name) => [push(name), op(AVM1.GET_MEMBER)]),
  ];
  const set = (slot, path, value) => [
    ...(path.length > 1
      ? get(slot, ...path.slice(0, -1))
      : [push(register(slot))]),
    push(path.at(-1)),
    ...value,
    op(AVM1.SET_MEMBER),
  ];
  const store = (slot, value) => [
    ...value,
    action(AVM1.STORE_REGISTER, Buffer.from([slot])),
    op(AVM1.POP),
  ];
  const when = (test, body) => {
    labels += 1;
    const skip = `skip${labels}`;
    return [
      ...test,
      op(AVM1.NOT),
      { branch: AVM1.IF, to: skip },
      ...body,
      { label: skip },
    ];
  };
  return { push, op, get, set, store, when };
}

/**
 * Шаги, после которых на стеке лежит место пути. `owner` — регистр с `this`.
 * У писателя и читателя место называется одинаково, поэтому число, записанное
 * писателем, лежит там же, где его будет искать читатель.
 */
export function bridgePlace(c, channel, owner = THIS) {
  if (channel.kind === "variable")
    return [c.push(channel.name), c.op(AVM1.GET_VARIABLE)];
  if (channel.kind === "parent")
    return [
      c.push(register(owner), "_parent"),
      c.op(AVM1.GET_MEMBER),
      ...Array.from({ length: channel.depth - 1 }).flatMap(() => [
        c.push("_parent"),
        c.op(AVM1.GET_MEMBER),
      ]),
    ];
  if (channel.kind === "shared")
    /* SharedObject.getLocal("astralhp").data: единственный аргумент — имя. */
    return [
      c.push("astralhp", 1, "SharedObject"),
      c.op(AVM1.GET_VARIABLE),
      c.push("getLocal"),
      c.op(AVM1.CALL_METHOD),
      c.push("data"),
      c.op(AVM1.GET_MEMBER),
    ];
  throw new Error(`Мост: неизвестный путь ${channel.id}.`);
}

/**
 * Функция-писатель `this.astralBridge(имя свойства, значение)`: кладёт значение
 * в каждый путь и ведёт счётчик записей. Если пути нет (`_level2` не существует,
 * `SharedObject` не поддерживается) — запись уходит в никуда, как и положено AVM1.
 */
export function bridgeWriterFunction(pool, channels = BRIDGE_CHANNELS) {
  const c = bridgeCoder(pool);
  const steps = channels.flatMap((channel) => [
    ...c.store(PLACE, bridgePlace(c, channel, THIS)),
    ...c.when(
      [
        ...c.get(PLACE, BRIDGE_PROP.count),
        c.push(0),
        c.op(OP.GREATER),
        c.op(AVM1.NOT),
      ],
      [...c.set(PLACE, [BRIDGE_PROP.count], [c.push(0)])],
    ),
    ...c.set(
      PLACE,
      [BRIDGE_PROP.count],
      [...c.get(PLACE, BRIDGE_PROP.count), c.push(1), c.op(0x47)],
    ),
    /* место[имя свойства] = значение */
    c.push(register(PLACE), register(PROP), register(VALUE)),
    c.op(AVM1.SET_MEMBER),
  ]);
  return defineFunction2({
    params: [
      [PROP, "prop"],
      [VALUE, "value"],
    ],
    registers: 6,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/**
 * Код хвоста метода радара: определить писателя (каждый раз заново, это дёшево) и
 * позвать его с текущим значением: `this.astralBridge("astralHp", this.currentHealthValue)`.
 */
export function bridgeTailCode(pool, { property, value }) {
  const c = bridgeCoder(pool);
  return assembleActions([
    ...c.set(THIS, ["astralBridge"], [bridgeWriterFunction(pool)]),
    /* аргументы с конца: значение, имя свойства; затем их число, объект и имя метода */
    c.push(register(THIS), value),
    c.op(AVM1.GET_MEMBER),
    c.push(property, 2, register(THIS), "astralBridge"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ]);
}
