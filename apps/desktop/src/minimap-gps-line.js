import { minimapGpsLine } from "@modovik/minimap-contract/gps-marker";
import { AVM1, action, assembleActions, pushAction, register } from "./scaleform-avm1.js";
import { SWF_TAG, parseSwfTags, scaleformHeaderLength, swfTag } from "./scaleform-swf.js";

/*
 * Линия маршрута GPS в minimap.gfx (задача 1 ТЗ 11.10.2026, утро).
 *
 * Владелец: «добавить редактор самой линии, чтобы человек мог менять размер
 * и делать линию пунктирной, разрывчатой или другой… шире, тоньше».
 *
 * Где линия в игре. Чисел линии в файлах данных нет: hudcolor.dat даёт ей
 * только цвет (строка метки), в minimap.ymt — сонар, камера и плитки, в
 * mapzoomdata.meta — ступени приближения. Путь рисует код игры прямо в
 * фильме мини-карты: в GTA5.exe (Steam Legacy) строки участка мини-карты
 * идут подряд — слои `asRootContainer`, `asMapContainer`, `asGpsLayer%d`,
 * `asRadiusBlipLayer`… и команды рисования Scaleform `beginFill`, `moveTo`,
 * `lineTo`, `endFill`, `lineStyle`, `clear`. Код игры заводит в фильме
 * слои `asGpsLayer0…N` и чертит в них маршрут этими командами, называя их
 * по имени. Сам код в файле зашифрован — читать его нечем, — но имя команды
 * игра ищет у клипа так же, как ActionScript: сперва у клипа, потом в
 * `MovieClip.prototype`.
 *
 * Поэтому линия правится перехватом. Кадр 1 фильма получает свой DoAction:
 * `lineStyle`, `moveTo`, `lineTo`, `curveTo` и `clear` в `MovieClip.prototype`
 * заменяются функциями, которые для любого клипа, кроме слоёв GPS, зовут
 * штатную команду с теми же аргументами (столько же, сколько пришло: маска
 * радара, звёзды розыска и всё прочее рисуются как раньше). У слоя GPS
 * (`asGpsLayer…` — он сам или его родитель):
 *
 *   `lineStyle(толщина, цвет, альфа, …)` — толщина × множитель, альфа ×
 *     непрозрачность; свой цвет линии ставится, только если игра красит
 *     линию цветом метки (маршруты заданий и сервера — своего цвета);
 *   `lineTo(x, y)` — у пунктира, точек и штрих-пунктира отрезок режется на
 *     штрихи узора (`gpsLinePattern`): «рисуем» — штатный `lineTo`,
 *     «пропускаем» — штатный `moveTo`; узор идёт через стыки отрезков, длины
 *     — в толщинах линии (у `noScale = "none"` — с поправкой на масштаб
 *     слоя), концы штрихов круглые;
 *   `moveTo`, `curveTo`, `clear` — запоминают перо, узор начинается заново.
 *
 * Если игра рисует путь мимо этих команд, перехват просто не срабатывает:
 * линия остаётся штатной, а остальная мини-карта рисуется как без него —
 * все чужие вызовы проходят насквозь с теми же аргументами.
 */

export const GPS_LINE_LAYER_PREFIX = "asGpsLayer";
/* Имена в `MovieClip.prototype`: штатные команды под своими именами и
   настройка линии. Скрыты от `for…in` (ASSetPropFlags), как штатные. */
export const GPS_LINE_MEMBERS = Object.freeze({
  lineStyle: "astralGpsLineStyle",
  moveTo: "astralGpsMoveTo",
  lineTo: "astralGpsLineTo",
  curveTo: "astralGpsCurveTo",
  clear: "astralGpsClear",
  style: "astralGpsStyle",
});
/* Сколько штрихов один `lineTo` режет самое большее: длинный отрезок при
   тонкой линии не должен остановить кадр. Остаток — сплошной. */
export const GPS_LINE_MAX_PIECES = 1000;

const OP = Object.freeze({
  ADD2: 0x47,
  SUBTRACT: 0x0b,
  MULTIPLY: 0x0c,
  DIVIDE: 0x0d,
  MODULO: 0x3f,
  EQUALS2: 0x49,
  BIT_AND: 0x60,
  BIT_RSHIFT: 0x64,
  CALL_FUNCTION: 0x3d,
  RETURN: 0x3e,
});

/* DefineFunction2: r1 — this; параметры — в регистрах после него. */
const PRELOAD_THIS = 0x01;
const PRELOAD_ARGUMENTS = 0x04;
const SUPPRESS_ARGUMENTS = 0x08;
const SUPPRESS_SUPER = 0x20;

const r = register;
const push = (...values) => pushAction(values);
const op = (code) => action(code);
const label = (name) => ({ label: name });
const ifTo = (to) => ({ branch: AVM1.IF, to });
const jumpTo = (to) => ({ branch: AVM1.JUMP, to });
const store = (index) => [action(AVM1.STORE_REGISTER, Buffer.from([index])), op(AVM1.POP)];
const get = () => op(AVM1.GET_MEMBER);
const set = () => op(AVM1.SET_MEMBER);
const call = () => op(AVM1.CALL_METHOD);
const not = () => op(AVM1.NOT);
/* Math.<name>(значение на стеке) */
const math = (name) => [push(1, "Math"), op(AVM1.GET_VARIABLE), push(name), call()];

export function defineFunction2({ params = [], registers, flags, steps }) {
  const body = assembleActions(steps.flat(Infinity));
  const header = [Buffer.from("\0"), Buffer.alloc(2), Buffer.from([registers]), Buffer.alloc(2)];
  header[1].writeUInt16LE(params.length);
  header[3].writeUInt16LE(flags);
  for (const [index, name] of params) header.push(Buffer.from([index]), Buffer.from(`${name}\0`, "utf8"));
  const size = Buffer.alloc(2);
  size.writeUInt16LE(body.length);
  header.push(size);
  return Buffer.concat([action(AVM1.DEFINE_FUNCTION2, Buffer.concat(header)), body]);
}

/* Штатная команда под своим именем с аргументами со стека: `count`
   аргументов уже лежат на стеке (первый — сверху). */
const callStock = (member, count) => [push(count, r(1), member), call()];

/* `this` — слой GPS или его ребёнок? Ответ — переход на `yes`. */
const ownLayer = (yes) => [
  push(10, 0, 2, r(1), "_name"),
  get(),
  push("substr"),
  call(),
  push(GPS_LINE_LAYER_PREFIX),
  op(OP.EQUALS2),
  ifTo(yes),
  push(10, 0, 2, r(1), "_parent"),
  get(),
  push("_name"),
  get(),
  push("substr"),
  call(),
  push(GPS_LINE_LAYER_PREFIX),
  op(OP.EQUALS2),
  ifTo(yes),
];

/* |((rgb >> shift) & 255) − канал метки| */
const channelDistance = (shift, channel) => [
  push(r(6), shift),
  op(OP.BIT_RSHIFT),
  push(255),
  op(OP.BIT_AND),
  push(r(4), channel),
  get(),
  op(OP.SUBTRACT),
  math("abs"),
];

/*
 * lineStyle(…) — r1 this, r2 arguments, r3 сколько аргументов, r4 настройка,
 * r5 толщина, r6 цвет и черновик, r7 шаг узора, r8/r9 точки и счётчик.
 */
function lineStyleFunction() {
  const M = GPS_LINE_MEMBERS;
  return defineFunction2({
    registers: 10,
    flags: PRELOAD_THIS | PRELOAD_ARGUMENTS | SUPPRESS_SUPER,
    steps: [
      push(r(2), "length"), get(), store(3),
      push(r(1), M.style), get(), store(4),
      push(r(3), 0), op(AVM1.GREATER), not(), ifTo("call"),
      push(r(4), undefined), op(OP.EQUALS2), ifTo("call"),
      ownLayer("own"),
      jumpTo("call"),
      label("own"),
      /* толщина × множитель */
      push(r(2), 0, r(2), 0), get(), push(r(4), "w"), get(), op(OP.MULTIPLY),
      action(AVM1.STORE_REGISTER, Buffer.from([5])), set(),
      /* цвет и альфа по умолчанию — как у Flash: чёрный, 100 */
      push(r(3), 2), op(AVM1.LESS2), not(), ifTo("hasColour"),
      push(r(2), 1, 0), set(),
      label("hasColour"),
      push(r(3), 3), op(AVM1.LESS2), not(), ifTo("hasAlpha"),
      push(r(2), 2, 100), set(),
      push(3), store(3),
      label("hasAlpha"),
      push(r(2), 2, r(2), 2), get(), push(r(4), "a"), get(), op(OP.MULTIPLY), set(),
      /* свой цвет — только у линии цвета метки */
      push(r(4), "c"), get(), push(0), op(AVM1.LESS2), ifTo("colourDone"),
      push(r(2), 1), get(), store(6),
      channelDistance(16, "mr"),
      channelDistance(8, "mg"),
      op(OP.ADD2),
      channelDistance(0, "mb"),
      op(OP.ADD2),
      push(12), op(AVM1.GREATER), ifTo("colourDone"),
      push(r(2), 1, r(4), "c"), get(), set(),
      label("colourDone"),
      /* узор: круглые концы и шаг узора */
      push(r(4), "p"), get(), push(undefined), op(OP.EQUALS2), ifTo("call"),
      push(r(3), 4), op(AVM1.LESS2), not(), ifTo("hasHinting"),
      push(r(2), 3, false), set(),
      label("hasHinting"),
      push(r(3), 5), op(AVM1.LESS2), not(), ifTo("hasScaleMode"),
      push(r(2), 4, "normal"), set(),
      label("hasScaleMode"),
      push(r(2), 5, "round"), set(),
      push(r(3), 6), op(AVM1.LESS2), not(), ifTo("sixArguments"),
      push(6), store(3),
      label("sixArguments"),
      push(r(5)), store(7),
      push(r(2), 4), get(), push("none"), op(OP.EQUALS2), not(), ifTo("unit"),
      /* noScale = "none": толщина в точках сцены, а узор — в точках слоя */
      push("x", 0, "y", 0, 2), op(AVM1.INIT_OBJECT), store(8),
      push("x", 1000, "y", 0, 2), op(AVM1.INIT_OBJECT), store(9),
      push(r(8), 1, r(1), "localToGlobal"), call(), op(AVM1.POP),
      push(r(9), 1, r(1), "localToGlobal"), call(), op(AVM1.POP),
      push(r(9), "x"), get(), push(r(8), "x"), get(), op(OP.SUBTRACT),
      action(AVM1.STORE_REGISTER, Buffer.from([6])), push(r(6)), op(OP.MULTIPLY),
      push(r(9), "y"), get(), push(r(8), "y"), get(), op(OP.SUBTRACT),
      action(AVM1.STORE_REGISTER, Buffer.from([6])), push(r(6)), op(OP.MULTIPLY),
      op(OP.ADD2),
      math("sqrt"),
      push(1000), op(OP.DIVIDE), store(6),
      push(r(6), 0), op(AVM1.GREATER), not(), ifTo("unit"),
      push(r(5), r(6)), op(OP.DIVIDE), store(7),
      label("unit"),
      push(r(1), "astralGpsUnit", r(7)), set(),
      push(r(1), "astralGpsLeft"), get(), push(0), op(AVM1.GREATER), ifTo("call"),
      push(r(1), "astralGpsI", 0), set(),
      push(r(1), "astralGpsOn", true), set(),
      push(r(1), "astralGpsLeft", r(4), "p"), get(), push(0), get(), push(r(7)), op(OP.MULTIPLY), set(),
      /* штатный lineStyle с тем же числом аргументов */
      label("call"),
      push(r(3)), store(8),
      label("loop"),
      push(r(8), 0), op(AVM1.GREATER), not(), ifTo("done"),
      push(r(8), 1), op(OP.SUBTRACT), store(8),
      push(r(2), r(8)), get(),
      jumpTo("loop"),
      label("done"),
      push(r(3), r(1), M.lineStyle), call(),
      op(OP.RETURN),
    ],
  });
}

/* Начало узора у пера: «рисуем», первая доля. */
const restartPattern = () => [
  push(r(1), "astralGpsI", 0), set(),
  push(r(1), "astralGpsOn", true), set(),
  push(r(1), "astralGpsLeft", r(1), GPS_LINE_MEMBERS.style), get(),
  push("p"), get(), push(0), get(),
  push(r(1), "astralGpsUnit"), get(), op(OP.MULTIPLY), set(),
];

/* moveTo(x, y) — r3 x, r4 y: перо на новое место, узор сначала. */
function moveToFunction() {
  return defineFunction2({
    params: [[3, "x"], [4, "y"]],
    registers: 5,
    flags: PRELOAD_THIS | SUPPRESS_ARGUMENTS | SUPPRESS_SUPER,
    steps: [
      push(r(1), "astralGpsUnit"), get(), push(0), op(AVM1.GREATER), not(), ifTo("call"),
      push(r(1), "astralGpsX", r(3)), set(),
      push(r(1), "astralGpsY", r(4)), set(),
      restartPattern(),
      label("call"),
      push(r(4), r(3)),
      callStock(GPS_LINE_MEMBERS.moveTo, 2),
      op(OP.RETURN),
    ],
  });
}

/* curveTo(cx, cy, x, y) — r3…r6: кривую игра рисует сама, перо — в её конец. */
function curveToFunction() {
  return defineFunction2({
    params: [[3, "cx"], [4, "cy"], [5, "x"], [6, "y"]],
    registers: 7,
    flags: PRELOAD_THIS | SUPPRESS_ARGUMENTS | SUPPRESS_SUPER,
    steps: [
      push(r(1), "astralGpsUnit"), get(), push(0), op(AVM1.GREATER), not(), ifTo("call"),
      push(r(1), "astralGpsX", r(5)), set(),
      push(r(1), "astralGpsY", r(6)), set(),
      label("call"),
      push(r(6), r(5), r(4), r(3)),
      callStock(GPS_LINE_MEMBERS.curveTo, 4),
      op(OP.RETURN),
    ],
  });
}

/* clear() — перо в (0, 0), узор сначала. */
function clearFunction() {
  return defineFunction2({
    registers: 2,
    flags: PRELOAD_THIS | SUPPRESS_ARGUMENTS | SUPPRESS_SUPER,
    steps: [
      push(r(1), "astralGpsUnit"), get(), push(0), op(AVM1.GREATER), not(), ifTo("call"),
      push(r(1), "astralGpsX", 0), set(),
      push(r(1), "astralGpsY", 0), set(),
      push(r(1), "astralGpsLeft", 0), set(),
      label("call"),
      callStock(GPS_LINE_MEMBERS.clear, 0),
      op(OP.RETURN),
    ],
  });
}

/*
 * lineTo(x, y) — r3 x, r4 y; r5 шаг узора, r6 узор, r7/r8 перо, r9/r10
 * отрезок, r11 его длина, r12 пройдено, r13 остаток доли, r14 «рисуем»,
 * r15 номер доли, r16 доля пути, r17 счётчик штрихов.
 */
function lineToFunction() {
  const M = GPS_LINE_MEMBERS;
  /* Штатная команда «рисуем» или «пропускаем» по r14 — аргументы уже на стеке. */
  const piece = (tag) => [
    push(2, r(1)),
    push(r(14)), not(), ifTo(`${tag}Gap`),
    push(M.lineTo), jumpTo(`${tag}Call`),
    label(`${tag}Gap`),
    push(M.moveTo),
    label(`${tag}Call`),
    call(),
  ];
  return defineFunction2({
    params: [[3, "x"], [4, "y"]],
    registers: 18,
    flags: PRELOAD_THIS | SUPPRESS_ARGUMENTS | SUPPRESS_SUPER,
    steps: [
      push(r(1), "astralGpsUnit"), get(), store(5),
      push(r(5), 0), op(AVM1.GREATER), not(), ifTo("plain"),
      push(r(1), M.style), get(), push("p"), get(), store(6),
      push(r(6), undefined), op(OP.EQUALS2), ifTo("plainStore"),
      push(r(1), "astralGpsX"), get(), store(7),
      push(r(1), "astralGpsY"), get(), store(8),
      push(r(3), r(7)), op(OP.SUBTRACT), store(9),
      push(r(4), r(8)), op(OP.SUBTRACT), store(10),
      push(r(9), r(9)), op(OP.MULTIPLY), push(r(10), r(10)), op(OP.MULTIPLY), op(OP.ADD2),
      math("sqrt"), store(11),
      /* перо неизвестно (NaN) — отрезок целиком, как у игры */
      push(r(11), r(11)), op(OP.EQUALS2), not(), ifTo("plainStore"),
      push(r(1), "astralGpsLeft"), get(), store(13),
      push(r(13), 0), op(AVM1.GREATER), ifTo("leftReady"),
      push(r(1), "astralGpsI", 0), set(),
      push(r(1), "astralGpsOn", true), set(),
      push(r(6), 0), get(), push(r(5)), op(OP.MULTIPLY), store(13),
      label("leftReady"),
      push(r(1), "astralGpsOn"), get(), store(14),
      push(r(1), "astralGpsI"), get(), store(15),
      push(0), store(12),
      push(0), store(17),
      label("loop"),
      push(r(11), r(12)), op(OP.SUBTRACT), push(r(13)), op(AVM1.GREATER), not(), ifTo("tail"),
      push(r(17), GPS_LINE_MAX_PIECES), op(AVM1.LESS2), not(), ifTo("tail"),
      push(r(17), 1), op(OP.ADD2), store(17),
      push(r(12), r(13)), op(OP.ADD2), store(12),
      push(r(12), r(11)), op(OP.DIVIDE), store(16),
      push(r(8), r(10), r(16)), op(OP.MULTIPLY), op(OP.ADD2),
      push(r(7), r(9), r(16)), op(OP.MULTIPLY), op(OP.ADD2),
      piece("loop"),
      op(AVM1.POP),
      push(r(15), 1), op(OP.ADD2), push(r(6), "length"), get(), op(OP.MODULO), store(15),
      push(r(14)), not(), store(14),
      push(r(6), r(15)), get(), push(r(5)), op(OP.MULTIPLY), store(13),
      jumpTo("loop"),
      label("tail"),
      /* хвост отрезка — той долей, что идёт сейчас */
      push(r(4), r(3)),
      piece("tail"),
      op(AVM1.POP),
      push(r(13), r(11), r(12)), op(OP.SUBTRACT), op(OP.SUBTRACT), store(13),
      /* доля кончилась ровно в конце отрезка — со следующего пойдёт новая */
      push(r(13), 0), op(AVM1.GREATER), ifTo("store"),
      push(r(15), 1), op(OP.ADD2), push(r(6), "length"), get(), op(OP.MODULO), store(15),
      push(r(14)), not(), store(14),
      push(r(6), r(15)), get(), push(r(5)), op(OP.MULTIPLY), store(13),
      label("store"),
      push(r(1), "astralGpsLeft", r(13)), set(),
      push(r(1), "astralGpsOn", r(14)), set(),
      push(r(1), "astralGpsI", r(15)), set(),
      push(r(1), "astralGpsX", r(3)), set(),
      push(r(1), "astralGpsY", r(4)), set(),
      push(undefined),
      op(OP.RETURN),
      label("plainStore"),
      push(r(1), "astralGpsX", r(3)), set(),
      push(r(1), "astralGpsY", r(4)), set(),
      label("plain"),
      push(r(4), r(3)),
      callStock(M.lineTo, 2),
      op(OP.RETURN),
    ],
  });
}

const rounded = (value) => Math.round(value * 10000) / 10000;
const rgbOf = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/**
 * Код кадра 1: перехват и настройка линии. `null` — линия как в игре, и
 * фильм не трогается.
 */
export function gpsRouteLineActions(gps) {
  const line = minimapGpsLine(gps);
  if (!line.changed) return null;
  const M = GPS_LINE_MEMBERS;
  const [mr, mg, mb] = rgbOf(line.marker);
  const colour = line.colour ? Number.parseInt(line.colour.slice(1), 16) : -1;
  const pattern = line.pattern
    ? [push(...[...line.pattern].reverse().map(rounded), line.pattern.length), op(AVM1.INIT_ARRAY)]
    : [push(undefined)];
  const hidden = [M.lineStyle, M.moveTo, M.lineTo, M.curveTo, M.clear, M.style, "lineStyle", "moveTo", "lineTo", "curveTo", "clear"];
  return assembleActions(
    [
      /* r0 — MovieClip.prototype */
      push("MovieClip"), op(AVM1.GET_VARIABLE), push("prototype"), get(), store(0),
      push(r(0), M.lineStyle), get(), push(undefined), op(OP.EQUALS2), not(), ifTo("installed"),
      push(r(0), M.lineStyle, r(0), "lineStyle"), get(), set(),
      push(r(0), M.moveTo, r(0), "moveTo"), get(), set(),
      push(r(0), M.lineTo, r(0), "lineTo"), get(), set(),
      push(r(0), M.curveTo, r(0), "curveTo"), get(), set(),
      push(r(0), M.clear, r(0), "clear"), get(), set(),
      push(r(0), "lineStyle"), lineStyleFunction(), set(),
      push(r(0), "moveTo"), moveToFunction(), set(),
      push(r(0), "lineTo"), lineToFunction(), set(),
      push(r(0), "curveTo"), curveToFunction(), set(),
      push(r(0), "clear"), clearFunction(), set(),
      label("installed"),
      push(r(0), M.style),
      push("w", rounded(line.width), "a", rounded(line.opacity), "c", colour, "mr", mr, "mg", mg, "mb", mb, "p"),
      pattern,
      push(7), op(AVM1.INIT_OBJECT),
      set(),
      push(0, 1, hidden.join(","), r(0), 4, "ASSetPropFlags"), op(OP.CALL_FUNCTION), op(AVM1.POP),
      op(AVM1.END),
    ].flat(Infinity),
  );
}

/**
 * minimap.gfx с перехватом линии: свой DoAction встаёт в кадр 1 перед
 * первым DoAction корня (там класс заводит MINIMAP), а без него — перед
 * первым ShowFrame. Линия как в игре — файл возвращается тем же буфером.
 */
export function patchGpsRouteLine(buffer, gps) {
  const actions = gpsRouteLineActions(gps);
  if (!actions) return buffer;
  const tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  const frameEnd = tags.findIndex((tag) => tag.code === SWF_TAG.SHOW_FRAME);
  if (frameEnd < 0) throw new Error("В minimap.gfx нет первого кадра — линию маршрута поставить некуда.");
  const firstAction = tags.slice(0, frameEnd).find((tag) => tag.code === SWF_TAG.DO_ACTION);
  const at = (firstAction || tags[frameEnd]).offset;
  const result = Buffer.concat([buffer.subarray(0, at), swfTag(SWF_TAG.DO_ACTION, actions), buffer.subarray(at)]);
  result.writeUInt32LE(result.length, 4);
  return result;
}
