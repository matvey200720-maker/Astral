import { AVM1, action, assembleActions, register } from "./scaleform-avm1.js";
import { defineFunction2 } from "./minimap-gps-line.js";
import { importFont } from "./target-health-gfx-compiler.js";
import {
  BRIDGE_CHANNELS,
  BRIDGE_METHOD_FLAGS,
  BRIDGE_PROP,
  bridgeCoder,
  bridgePlace,
} from "./hp-bridge-code.js";
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
 * Индикатор HP и брони в `hud_reticle.gfx` — читающая сторона моста
 * (`hp-bridge-code.js`: радар кладёт числа, прицел читает).
 *
 * СЕЙЧАС ЗДЕСЬ ТОЛЬКО ПРОБА (`hpProbe`, 21.11.2026): клип с колонкой строк, по строке
 * на каждый путь моста. Строка выглядит так: `<путь> <HP> <броня> <сколько раз писали>`,
 * «-» — по этому пути ничего нет. Живой путь — тот, где в строке числа, они
 * меняются вместе со здоровьем и бронёй игрока. Первая строка (`K`) — счётчик
 * срабатываний самого читателя: если её нет или число стоит, клип не работает,
 * и остальные строки ничего не доказывают.
 *
 * Клип создаётся сразу и не ждёт ни прицеливания, ни попадания: код вызывается
 * из конструктора `HUD_RETICLE` и дальше двумя независимыми способами — раз в
 * 100 мс через `setInterval` и каждым кадром самого клипа (`onEnterFrame`):
 * неизвестно, какой из них в игре работает, а проба не должна молчать из-за этого.
 *
 * Выключено — файл байт в байт прежний.
 * Символы — 64700…64729 (свободны; в `refuseAstralCharacters` их нет в штатном файле).
 */

export const HP_PROBE_SYMBOL = "astralHpProbe";
export const HP_IDS = Object.freeze({
  first: 64700,
  /** Строки: 64700 + номер строки (0 — `K`, 1… — пути моста). */
  row: (index) => 64700 + index,
  fontImport: 64720,
  sprite: 64721,
  last: 64729,
});

/** Строки пробы: счётчик читателя и по строке на путь. */
export const HP_PROBE_ROWS = Object.freeze([
  Object.freeze({ id: "K", colour: [255, 255, 255] }),
  ...BRIDGE_CHANNELS.map((channel) =>
    Object.freeze({ id: channel.id, colour: channel.colour, channel }),
  ),
]);

/** Колонка стоит справа от середины экрана: прицел (середина сцены 1280×720) не закрывает. */
export const HP_PROBE_LAYOUT = Object.freeze({
  x: 700,
  y: 96,
  rowHeight: 28,
  fontSize: 24,
  width: 560,
});

const THIS = 1;
const CLIP = 2;
const HOST = 3;
const PLACE = 4;
const FIRST_VALUE = 5;
const OP = Object.freeze({
  ADD2: 0x47,
  STRICT_EQUALS: 0x66,
  RETURN: 0x3e,
  CALL_FUNCTION: 0x3d,
});

/* Шрифт игры `$Font2` в штатном файле уже подключён. */
const FONT_NAME = "$Font2";

/** Теги пробы: шрифт (если не подключён), строки и клип. */
export function hpProbeDefinitions(index) {
  const known = index.imports.get(FONT_NAME);
  const fontId = known ? known.id : HP_IDS.fontImport;
  const { rowHeight, fontSize, width } = HP_PROBE_LAYOUT;
  const bounds = {
    xmin: 0,
    xmax: Math.round(width * TWIPS),
    ymin: 0,
    ymax: Math.round(rowHeight * TWIPS),
  };
  const rows = HP_PROBE_ROWS.map((row, position) =>
    defineEditText({
      id: HP_IDS.row(position),
      bounds,
      fontId,
      fontHeight: fontSize * TWIPS,
      color: [...row.colour, 255],
      align: 0,
    }),
  );
  const children = HP_PROBE_ROWS.map((_, position) =>
    placeObject2({
      depth: position + 1,
      characterId: HP_IDS.row(position),
      matrix: {
        ...IDENTITY_MATRIX,
        ty: Math.round(position * rowHeight * TWIPS),
      },
      name: `r${position}`,
    }),
  );
  const exported = Buffer.alloc(4);
  exported.writeUInt16LE(1, 0);
  exported.writeUInt16LE(HP_IDS.sprite, 2);
  return [
    ...(known ? [] : [importFont(fontId, FONT_NAME)]),
    ...rows,
    defineSprite(HP_IDS.sprite, children),
    swfTag(
      SWF_TAG.EXPORT_ASSETS,
      Buffer.concat([exported, Buffer.from(`${HP_PROBE_SYMBOL}\0`, "latin1")]),
    ),
  ];
}

/** `this.astralHpTick = function() {…}`: прикрепить клип (один раз), обновить строки. */
function tickFunction(pool) {
  const c = bridgeCoder(pool);
  const isUndefined = (slot) => [
    c.push(register(slot), undefined),
    c.op(OP.STRICT_EQUALS),
  ];
  const attach = [
    ...c.store(HOST, c.get(THIS, "TIMELINE")),
    ...c.set(THIS, ["astralHpMark"], [c.push("T")]),
    ...c.when(isUndefined(HOST), [
      ...c.store(HOST, [c.push(register(THIS))]),
      ...c.set(THIS, ["astralHpMark"], [c.push("I")]),
    ]),
    /* host.attachMovie(символ, имя, host.getNextHighestDepth()) */
    c.push(0, register(HOST), "getNextHighestDepth"),
    c.op(AVM1.CALL_METHOD),
    c.push(
      "astralHpProbeMc",
      HP_PROBE_SYMBOL,
      3,
      register(HOST),
      "attachMovie",
    ),
    c.op(AVM1.CALL_METHOD),
    action(AVM1.STORE_REGISTER, Buffer.from([CLIP])),
    c.op(AVM1.POP),
    ...c.set(THIS, ["astralHpClip"], [c.push(register(CLIP))]),
    ...c.set(CLIP, ["_x"], [c.push(HP_PROBE_LAYOUT.x)]),
    ...c.set(CLIP, ["_y"], [c.push(HP_PROBE_LAYOUT.y)]),
    /* Второй источник тиков — кадр клипа: `this` в нём клип, прицел — в `owner`. */
    ...c.set(CLIP, ["owner"], [c.push(register(THIS))]),
    ...c.set(CLIP, ["onEnterFrame"], c.get(THIS, "astralHpFrame")),
  ];
  const join = (...parts) =>
    parts.flatMap((part, position) => [
      ...part,
      ...(position ? [c.op(OP.ADD2)] : []),
    ]);
  const text = (row, parts) => c.set(CLIP, [`r${row}`, "text"], join(...parts));
  const steps = [
    ...c.set(
      THIS,
      ["astralHpF"],
      [...c.get(THIS, "astralHpF"), c.push(1), c.op(OP.ADD2)],
    ),
    ...c.store(CLIP, c.get(THIS, "astralHpClip")),
    ...c.when(isUndefined(CLIP), attach),
    /* Не прикрепился — рисовать нечего. */
    ...c.when(isUndefined(CLIP), [c.push(undefined), c.op(OP.RETURN)]),
    ...text(0, [
      [c.push("K ")],
      c.get(THIS, "astralHpF"),
      [c.push(" ")],
      c.get(THIS, "astralHpMark"),
    ]),
    ...HP_PROBE_ROWS.slice(1).flatMap((row, position) => [
      ...c.store(PLACE, bridgePlace(c, row.channel, THIS)),
      ...[BRIDGE_PROP.health, BRIDGE_PROP.armour, BRIDGE_PROP.count].flatMap(
        (property, order) => [
          ...c.store(FIRST_VALUE + order, c.get(PLACE, property)),
          ...c.when(
            isUndefined(FIRST_VALUE + order),
            c.store(FIRST_VALUE + order, [c.push("-")]),
          ),
        ],
      ),
      ...text(position + 1, [
        [c.push(`${row.id} `)],
        [c.push(register(FIRST_VALUE))],
        [c.push(" ")],
        [c.push(register(FIRST_VALUE + 1))],
        [c.push(" ")],
        [c.push(register(FIRST_VALUE + 2))],
      ]),
    ]),
  ];
  return defineFunction2({
    registers: FIRST_VALUE + 3,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/** `this.astralHpFrame = function() { this.owner.astralHpTick(); }`: тик по кадру клипа. */
function frameFunction(pool) {
  const c = bridgeCoder(pool);
  return defineFunction2({
    registers: 2,
    flags: BRIDGE_METHOD_FLAGS,
    steps: [
      c.push(0),
      ...c.get(THIS, "owner"),
      c.push("astralHpTick"),
      c.op(AVM1.CALL_METHOD),
      c.op(AVM1.POP),
    ],
  });
}

/** Конец конструктора `HUD_RETICLE`: функции пробы, первый вызов и таймер. */
export function hpProbeConstructorCode(pool) {
  const c = bridgeCoder(pool);
  return assembleActions([
    ...c.set(THIS, ["astralHpF"], [c.push(0)]),
    ...c.set(THIS, ["astralHpTick"], [tickFunction(pool)]),
    ...c.set(THIS, ["astralHpFrame"], [frameFunction(pool)]),
    c.push(0, register(THIS), "astralHpTick"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
    /* setInterval(this, "astralHpTick", 100) */
    c.push(100, "astralHpTick", register(THIS), 3, "setInterval"),
    c.op(OP.CALL_FUNCTION),
    c.op(AVM1.POP),
  ]);
}
