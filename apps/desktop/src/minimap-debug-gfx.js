import { createHash } from "node:crypto";
import { bridgeCoder, BRIDGE_METHOD_FLAGS } from "./hp-bridge-code.js";
import { defineFunction2 } from "./minimap-gps-line.js";
import { prologueEdit } from "./hud-ammo-gfx-compiler.js";
import { minimapClassTag } from "./minimap-gfx-compiler.js";
import { importFont } from "./target-health-gfx-compiler.js";
import {
  AVM1,
  action,
  assertActionStream,
  findMethod,
  readProgram,
  register,
  rewriteActions,
} from "./scaleform-avm1.js";
import {
  IDENTITY_MATRIX,
  SWF_TAG,
  TWIPS,
  allocateCharacterIds,
  definePolygonsShape,
  defineSprite,
  indexSwf,
  placeObject2,
  swfTag,
  uncompressedScaleform,
  writeRect,
} from "./scaleform-swf.js";

/*
 * Отладочная строка в фильме радара (проба «признак режима карты паузы», 21.11.2026).
 *
 * ЗАЧЕМ. Один и тот же фильм `minimap.gfx` рисует радар, развёрнутый радар и карту паузы (записи `minimap`, `bigmap`, `pausemap`
 * frontend.xml). Когда сцена фильма растёт («HP отдельно от карты»), карта паузы сжимается и едет. Чтобы обойти это изнутри фильма,
 * ему нужен признак «меня сейчас рисуют как карту паузы»; какой метод или значение его даёт, из файлов не видно.
 *
 * ЧТО ДЕЛАЕТ. В начало КАЖДОГО метода класса `MINIMAP` встаёт запись `this.astralDbgLog("ИМЯ")` — десять последних вызовов (по порядку)
 * и счётчики. Поверх стоит текстовое поле, которое каждый кадр показывает: `mapType` (то, что игра передала в `SETUP_HEALTH_ARMOUR`),
 * `Stage.width × Stage.height`, `Stage.scaleMode`, сдвиг и масштаб корня, десять последних вызовов и счётчики нескольких методов.
 * На кадре игры и на кадре паузы видно, чем они различаются.
 *
 * Только для пробного листа: в приложение не идёт, файл радара человека не меняется.
 */

export const DEBUG_SYMBOL = "astralDbg";
/** Сколько последних вызовов держит журнал (строка `last:` и параллельная `at:`). */
const JOURNAL_LENGTH = 14;
const THIS = 1;
const NAME = 2;
const REGISTERS = 10;
/** Строка рисуется функцией с большим числом регистров (обход дерева клипов). */
const DRAW_REGISTERS = 22;
/** Грубый признак режима (hpwide6): ширина содержимого корня без масштаба меньше предела — карта паузы; в игре у корня огромные плитки (≈ 7366). */
const WIDTH_LIMIT = 3000;
const WIDTH_FRAMES = 5;
/** Окна «горячих» вызовов в десятых секунды: звали за последние 3 с / впервые звали за последние 10 с. */
const HOT_WINDOW = 30;
const NEW_WINDOW = 100;
const SUBTRACT = 0x0b;
const OP = Object.freeze({
  ADD2: 0x47,
  DIVIDE: 0x0d,
  TO_INTEGER: 0x18,
  GET_TIME: 0x34,
  GREATER: 0x67,
  STRICT_EQUALS: 0x66,
  RETURN: 0x3e,
  CALL_FUNCTION: 0x3d,
  ENUMERATE2: 0x55,
  MULTIPLY: 0x0c,
  INIT_ARRAY: 0x42,
  INIT_OBJECT: 0x43,
});

/** Счётчики, которые показывает строка: методы, где вероятнее всего видно режим. */
export const DEBUG_COUNTED = Object.freeze([
  "SETUP_HEALTH_ARMOUR",
  "SET_MASK",
  "MOVE_MAPMASKSQUARE",
  "SHOW_CROSSHAIR",
  "SET_BLIP_LABEL",
  "REGISTER_TERRITORY",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/* Многострочное поле: как `defineEditText`, но с Multiline и WordWrap. */
function defineMultilineText({ id, bounds, fontId, fontHeight, color }) {
  const idBuffer = Buffer.alloc(2);
  idBuffer.writeUInt16LE(id);
  const flags1 =
    0x40 /* WordWrap */ |
    0x20 /* Multiline */ |
    0x08 /* ReadOnly */ |
    0x04 /* HasTextColor */ |
    0x01; /* HasFont */
  const flags2 =
    0x20 /* HasLayout */ | 0x10 /* NoSelect */ | 0x01; /* UseOutlines */
  const font = Buffer.alloc(4);
  font.writeUInt16LE(fontId, 0);
  font.writeUInt16LE(Math.round(fontHeight), 2);
  const layout = Buffer.alloc(9);
  layout[0] = 0;
  return swfTag(
    SWF_TAG.DEFINE_EDIT_TEXT,
    Buffer.concat([
      idBuffer,
      writeRect(bounds),
      Buffer.from([flags1, flags2]),
      font,
      Buffer.from([...color, 255]),
      layout,
      Buffer.from("\0", "utf8"),
    ]),
  );
}

/** `this.astralDbgLog = function(name) {…}`: последние десять вызовов и счётчики по именам. */
export function logFunction(pool) {
  const c = bridgeCoder(pool);
  const COUNTS = 3;
  const LAST_AT = 4;
  const FIRST_AT = 5;
  const steps = [
    ...c.when(
      [...c.get(THIS, "astralDbgL"), c.push(undefined), c.op(OP.STRICT_EQUALS)],
      [
        ...c.set(THIS, ["astralDbgL"], [c.push(0), c.op(OP.INIT_ARRAY)]),
        ...c.set(THIS, ["astralDbgT"], [c.push(0), c.op(OP.INIT_ARRAY)]),
        ...c.set(THIS, ["astralDbgC"], [c.push(0), c.op(OP.INIT_OBJECT)]),
        ...c.set(THIS, ["astralDbgLT"], [c.push(0), c.op(OP.INIT_OBJECT)]),
        ...c.set(THIS, ["astralDbgFT"], [c.push(0), c.op(OP.INIT_OBJECT)]),
      ],
    ),
    /* Журнал: подряд идущие одинаковые имена не пишутся; astralDbgL.push(name); длиннее десяти — shift() */
    ...c.when(
      [
        ...c.get(THIS, "astralDbgLast"),
        c.push(register(NAME)),
        c.op(OP.STRICT_EQUALS),
        c.op(AVM1.NOT),
      ],
      [
        ...c.set(THIS, ["astralDbgLast"], [c.push(register(NAME))]),
        c.push(register(NAME), 1),
        ...c.get(THIS, "astralDbgL"),
        c.push("push"),
        c.op(AVM1.CALL_METHOD),
        c.op(AVM1.POP),
        /* Время вызова в десятых секунды от старта фильма — в параллельный массив. */
        c.op(OP.GET_TIME),
        c.push(100),
        c.op(OP.DIVIDE),
        c.op(OP.TO_INTEGER),
        c.push(1),
        ...c.get(THIS, "astralDbgT"),
        c.push("push"),
        c.op(AVM1.CALL_METHOD),
        c.op(AVM1.POP),
        ...c.when(
          [
            ...c.get(THIS, "astralDbgL", "length"),
            c.push(JOURNAL_LENGTH),
            c.op(OP.GREATER),
          ],
          [
            c.push(0),
            ...c.get(THIS, "astralDbgL"),
            c.push("shift"),
            c.op(AVM1.CALL_METHOD),
            c.op(AVM1.POP),
            c.push(0),
            ...c.get(THIS, "astralDbgT"),
            c.push("shift"),
            c.op(AVM1.CALL_METHOD),
            c.op(AVM1.POP),
          ],
        ),
      ],
    ),
    /* Время последнего и первого вызова по имени (десятые секунды от старта фильма). */
    ...c.store(LAST_AT, c.get(THIS, "astralDbgLT")),
    c.push(register(LAST_AT), register(NAME)),
    c.op(OP.GET_TIME),
    c.push(100),
    c.op(OP.DIVIDE),
    c.op(OP.TO_INTEGER),
    c.op(AVM1.SET_MEMBER),
    ...c.store(FIRST_AT, c.get(THIS, "astralDbgFT")),
    ...c.when(
      [
        c.push(register(FIRST_AT), register(NAME)),
        c.op(AVM1.GET_MEMBER),
        c.push(undefined),
        c.op(OP.STRICT_EQUALS),
      ],
      [
        c.push(register(FIRST_AT), register(NAME)),
        c.op(OP.GET_TIME),
        c.push(100),
        c.op(OP.DIVIDE),
        c.op(OP.TO_INTEGER),
        c.op(AVM1.SET_MEMBER),
      ],
    ),
    /* counts[name] = (counts[name] > 0 ? counts[name] : 0) + 1 */
    ...c.store(COUNTS, c.get(THIS, "astralDbgC")),
    c.push(register(COUNTS), register(NAME)),
    c.op(AVM1.GET_MEMBER),
    c.push(0),
    c.op(OP.GREATER),
    { branch: AVM1.IF, to: "has" },
    c.push(register(COUNTS), register(NAME), 0),
    c.op(AVM1.SET_MEMBER),
    { label: "has" },
    c.push(register(COUNTS), register(NAME), register(COUNTS), register(NAME)),
    c.op(AVM1.GET_MEMBER),
    c.push(1),
    c.op(OP.ADD2),
    c.op(AVM1.SET_MEMBER),
  ];
  return defineFunction2({
    params: [[NAME, "name"]],
    registers: REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/** `this.astralDbgDraw = function() {…}`: тик клипа, `this` — клип, радар — в `owner`. */
export function drawFunction(pool, fix = null, methods = []) {
  const c = bridgeCoder(pool);
  const OWNER = 2;
  const HOT = 3;
  const NEW = 4;
  const NOW = 5;
  const BOUNDS = 6;
  const INDEX = 7;
  const NAME_AT = 8;
  const STAMP = 9;
  const KEY = 10;
  const VAL = 11;
  const TREE = 12;
  const BEST = 13;
  const BEST_AT = 14;
  const AREA = 15;
  const KIDS = 16;
  const ANCESTORS = 17;
  const OWN = 18;
  const RAW_AT = 19;
  const add = (parts) =>
    parts.flatMap((part, position) => [
      ...part,
      ...(position ? [c.op(OP.ADD2)] : []),
    ]);
  const stage = (member) => [
    c.push("Stage"),
    c.op(AVM1.GET_VARIABLE),
    c.push(member),
    c.op(AVM1.GET_MEMBER),
  ];
  const of = (...path) => c.get(OWNER, ...path);
  const counted = DEBUG_COUNTED.flatMap((name) => [
    [
      c.push(
        ` ${name.replace(/^SET_|^SHOW_|^REGISTER_|^MOVE_/, "").slice(0, 9)}=`,
      ),
    ],
    [...c.get(OWNER, "astralDbgC"), c.push(name), c.op(AVM1.GET_MEMBER)],
  ]);
  const line = [
    [c.push("mt=")],
    of("mapType"),
    [c.push(" st=")],
    stage("width"),
    [c.push("x")],
    stage("height"),
    [c.push(" sm=")],
    stage("scaleMode"),
    [c.push("\nroot x=")],
    of("TIMELINE", "_x"),
    [c.push(" y=")],
    of("TIMELINE", "_y"),
    [c.push(" xs=")],
    of("TIMELINE", "_xscale"),
    [c.push(" ys=")],
    of("TIMELINE", "_yscale"),
    [c.push("\nlast: ")],
    /* astralDbgL.join(" "): аргумент, их число, массив, имя метода */
    [
      c.push(" ", 1),
      ...c.get(OWNER, "astralDbgL"),
      c.push("join"),
      c.op(AVM1.CALL_METHOD),
    ],
    [c.push("\n")],
    ...counted,
    [c.push("\nat: ")],
    [
      c.push(" ", 1),
      ...c.get(OWNER, "astralDbgT"),
      c.push("join"),
      c.op(AVM1.CALL_METHOD),
    ],
    [c.push("\nnow=")],
    [c.op(OP.GET_TIME), c.push(100), c.op(OP.DIVIDE), c.op(OP.TO_INTEGER)],
    /* Признак режима: полоса HP/брони (игра прячет её в паузе), карта (CONTENT) и её маска, габариты корня. */
    [c.push("\nbar vis=")],
    of("HEALTH_ARMOUR_BAR_MC", "_visible"),
    [c.push(" a=")],
    of("HEALTH_ARMOUR_BAR_MC", "_alpha"),
    [c.push(" abil vis=")],
    of("ABILITY_BAR_MC", "_visible"),
    [c.push(" tl vis=")],
    of("TIMELINE", "_visible"),
    [c.push(" a=")],
    of("TIMELINE", "_alpha"),
    [c.push(" w=")],
    of("TIMELINE", "_width"),
    [c.push(" h=")],
    of("TIMELINE", "_height"),
    [c.push("\nCONTENT x=")],
    of("TIMELINE", "CONTENT", "_x"),
    [c.push(" y=")],
    of("TIMELINE", "CONTENT", "_y"),
    [c.push(" w=")],
    of("TIMELINE", "CONTENT", "_width"),
    [c.push(" h=")],
    of("TIMELINE", "CONTENT", "_height"),
    [c.push(" vis=")],
    of("TIMELINE", "CONTENT", "_visible"),
    [c.push(" a=")],
    of("TIMELINE", "CONTENT", "_alpha"),
    [c.push("\nmask x=")],
    of("TIMELINE", "mapMask", "_x"),
    [c.push(" y=")],
    of("TIMELINE", "mapMask", "_y"),
    [c.push(" w=")],
    of("TIMELINE", "mapMask", "_width"),
    [c.push(" h=")],
    of("TIMELINE", "mapMask", "_height"),
    [c.push(" vis=")],
    of("TIMELINE", "mapMask", "_visible"),
    /* Клип карты глубже: поворот, масштаб, габариты в координатах корня; невидимая рамка BOUNDING_BOX; _root. */
    [c.push("\nCONTENT rot=")],
    of("TIMELINE", "CONTENT", "_rotation"),
    [c.push(" xs=")],
    of("TIMELINE", "CONTENT", "_xscale"),
    [c.push(" ys=")],
    of("TIMELINE", "CONTENT", "_yscale"),
    [c.push(" bnd=")],
    c.get(BOUNDS, "xMin"),
    [c.push(" ")],
    c.get(BOUNDS, "xMax"),
    [c.push(" ")],
    c.get(BOUNDS, "yMin"),
    [c.push(" ")],
    c.get(BOUNDS, "yMax"),
    [c.push("\nBOX x=")],
    of("TIMELINE", "BOUNDING_BOX", "_x"),
    [c.push(" y=")],
    of("TIMELINE", "BOUNDING_BOX", "_y"),
    [c.push(" w=")],
    of("TIMELINE", "BOUNDING_BOX", "_width"),
    [c.push(" h=")],
    of("TIMELINE", "BOUNDING_BOX", "_height"),
    [c.push(" rt xs=")],
    [
      c.push("_root"),
      c.op(AVM1.GET_VARIABLE),
      c.push("_xscale"),
      c.op(AVM1.GET_MEMBER),
    ],
    /* Обход паузы: драйверы (кадр клипа nf, таймер ni), срабатывания, _xscale сразу после записи, возвраты, признак на корне. */
    [c.push("\npf nf=")],
    of("astralPfClip", "nf"),
    [c.push(" ni=")],
    of("astralPfClip", "ni"),
    [c.push(" done=")],
    of("astralPfClip", "done"),
    [c.push(" init=")],
    of("astralPfInit"),
    [c.push(" hit=")],
    of("astralPfHits"),
    [c.push(" back=")],
    of("astralPfBack"),
    [c.push(" rest=")],
    of("astralPfRest"),
    [c.push(" raw=")],
    of("astralPfRaw"),
    [c.push(" lo=")],
    of("astralPfLo"),
    [c.push(" hi=")],
    of("astralPfHi"),
    [c.push(" paused=")],
    of("TIMELINE", "astralPause"),
    [c.push("\ngrd n=")],
    of("astralMgN"),
    [c.push(" lo=")],
    of("astralMgLo"),
    [c.push(" hi=")],
    of("astralMgHi"),
    [c.push(" paused=")],
    of("astralMgPaused"),
    [c.push(" traw=")],
    [c.push(register(RAW_AT))],
    [c.push(" hc vis=")],
    of("TIMELINE", "asRootContainerBlips", "asHealthContainer", "_visible"),
    [c.push(" a=")],
    of("TIMELINE", "asRootContainerBlips", "asHealthContainer", "_alpha"),
    [c.push(" ac w=")],
    of("TIMELINE", "asRootContainer", "_width"),
    [c.push("\nself s0=")],
    of("astralPfS0"),
    [c.push(" s1=")],
    of("astralPfS1"),
    [c.push("\nkids:")],
    [c.push(register(TREE))],
    [c.push("\nbig=")],
    [c.push(register(BEST_AT))],
    [c.push(" in:")],
    [c.push(register(KIDS))],
    [c.push("\nanc:")],
    [c.push(register(ANCESTORS))],
    [c.push("\nown:")],
    [c.push(register(OWN))],
    [c.push("\nhot3s:")],
    [c.push(register(HOT))],
    [c.push("\nnew10s:")],
    [c.push(register(NEW))],
  ];
  /* С обходом паузы корень в режиме паузы растянут: строка встаёт обратным масштабом и своей точкой (доли экрана → точки сцены). */
  /* Состояние «пауза»: у отладочного сторожа флаг на корне, у боевого (`minimap-root-scale.js`) — на его клипе. */
  const pausedRef = fix?.productionGuard
    ? of("astralMgPaused")
    : of("TIMELINE", "astralPause");
  const place = fix
    ? [
        ...c.when(
          [...pausedRef, c.push(true), c.op(OP.STRICT_EQUALS)],
          [
            ...c.set(
              THIS,
              ["_xscale"],
              [c.push(Math.round((10000 / fix.sx) * 100) / 100)],
            ),
            ...c.set(
              THIS,
              ["_yscale"],
              [c.push(Math.round((10000 / fix.sy) * 100) / 100)],
            ),
            ...c.set(
              THIS,
              ["_x"],
              [
                c.push(
                  Math.round(
                    ((fix.pauseAt[0] * fix.width * 100) / fix.sx) * 100,
                  ) / 100,
                ),
              ],
            ),
            ...c.set(
              THIS,
              ["_y"],
              [
                c.push(
                  Math.round(
                    ((fix.pauseAt[1] * fix.height * 100) / fix.sy) * 100,
                  ) / 100,
                ),
              ],
            ),
          ],
        ),
        ...c.when(
          [...pausedRef, c.push(true), c.op(OP.STRICT_EQUALS), c.op(AVM1.NOT)],
          [
            ...c.set(THIS, ["_xscale"], [c.push(100)]),
            ...c.set(THIS, ["_yscale"], [c.push(100)]),
            ...c.set(THIS, ["_x"], [c.push(fix.radarAt[0])]),
            ...c.set(THIS, ["_y"], [c.push(fix.radarAt[1])]),
          ],
        ),
      ]
    : [];
  const stamp = [
    c.op(OP.GET_TIME),
    c.push(100),
    c.op(OP.DIVIDE),
    c.op(OP.TO_INTEGER),
  ];
  /* Списки без цикла: по одному условию на метод (методы известны при сборке). */
  /* Списки циклом по массиву имён `astralDbgNames` (собран при загрузке): код в фильме короткий, а не по условию на каждый метод.
     Метод, которого ни разу не звали (`undefined`), в списки не попадает: сравнение с неопределённым в игре неизвестно как работает. */
  const defined = [
    c.push(register(STAMP)),
    c.push(undefined),
    c.op(OP.STRICT_EQUALS),
    c.op(AVM1.NOT),
  ];
  const within = (window) => [
    c.push(register(STAMP)),
    c.push(register(NOW)),
    c.push(window),
    c.op(SUBTRACT),
    c.op(OP.GREATER),
  ];
  const lists = methods.length
    ? [
        ...c.store(INDEX, [c.push(0)]),
        { label: "dbgLoop" },
        c.push(register(INDEX)),
        ...c.get(OWNER, "astralDbgNames", "length"),
        c.op(AVM1.LESS2),
        c.op(AVM1.NOT),
        { branch: AVM1.IF, to: "dbgEnd" },
        ...c.store(NAME_AT, [
          ...c.get(OWNER, "astralDbgNames"),
          c.push(register(INDEX)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.store(STAMP, [
          ...c.get(OWNER, "astralDbgLT"),
          c.push(register(NAME_AT)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.when(
          defined,
          c.when(
            within(HOT_WINDOW),
            c.store(HOT, [
              c.push(register(HOT)),
              c.push(" "),
              c.op(OP.ADD2),
              c.push(register(NAME_AT)),
              c.op(OP.ADD2),
            ]),
          ),
        ),
        ...c.store(STAMP, [
          ...c.get(OWNER, "astralDbgFT"),
          c.push(register(NAME_AT)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.when(
          defined,
          c.when(
            within(NEW_WINDOW),
            c.store(NEW, [
              c.push(register(NEW)),
              c.push(" "),
              c.op(OP.ADD2),
              c.push(register(NAME_AT)),
              c.op(OP.ADD2),
              c.push("@"),
              c.op(OP.ADD2),
              c.push(register(STAMP)),
              c.op(OP.ADD2),
            ]),
          ),
        ),
        ...c.store(INDEX, [c.push(register(INDEX)), c.push(1), c.op(OP.ADD2)]),
        { branch: AVM1.JUMP, to: "dbgLoop" },
        { label: "dbgEnd" },
      ]
    : [];
  /* for (key in object): метка конца `null`, имена читаются с вершины стека. */
  const forIn = (objectSteps, body, id) => [
    ...objectSteps,
    c.op(OP.ENUMERATE2),
    { label: `${id}Top` },
    action(AVM1.STORE_REGISTER, Buffer.from([KEY])),
    c.push(null),
    c.op(OP.STRICT_EQUALS),
    { branch: AVM1.IF, to: `${id}End` },
    ...body,
    { branch: AVM1.JUMP, to: `${id}Top` },
    { label: `${id}End` },
  ];
  const round = (value) => [
    ...value,
    c.push(1),
    c.push("Math"),
    c.op(AVM1.GET_VARIABLE),
    c.push("round"),
    c.op(AVM1.CALL_METHOD),
  ];
  const isClip = [
    ...c.get(VAL, "_width"),
    c.push(undefined),
    c.op(OP.STRICT_EQUALS),
    c.op(AVM1.NOT),
  ];
  /* Строка про ребёнка: имя, видимость, прозрачность, положение, размер. */
  const entry = [
    c.push(" "),
    c.push(register(KEY)),
    c.op(OP.ADD2),
    c.push(":"),
    c.op(OP.ADD2),
    ...c.get(VAL, "_visible"),
    c.op(OP.ADD2),
    c.push("/"),
    c.op(OP.ADD2),
    ...round(c.get(VAL, "_alpha")),
    c.op(OP.ADD2),
    c.push("/"),
    c.op(OP.ADD2),
    ...round(c.get(VAL, "_x")),
    c.op(OP.ADD2),
    c.push(","),
    c.op(OP.ADD2),
    ...round(c.get(VAL, "_y")),
    c.op(OP.ADD2),
    c.push("/"),
    c.op(OP.ADD2),
    ...round(c.get(VAL, "_width")),
    c.op(OP.ADD2),
    c.push("x"),
    c.op(OP.ADD2),
    ...round(c.get(VAL, "_height")),
    c.op(OP.ADD2),
  ];
  const append = (target, limit) =>
    c.when(
      [
        c.push(register(target)),
        c.push("length"),
        c.op(AVM1.GET_MEMBER),
        c.push(limit),
        c.op(AVM1.LESS2),
      ],
      c.store(target, [c.push(register(target)), ...entry, c.op(OP.ADD2)]),
    );
  const tree = [
    ...c.store(TREE, [c.push("")]),
    ...c.store(BEST, [c.push(0)]),
    ...c.store(BEST_AT, [c.push("-")]),
    ...c.store(KIDS, [c.push("")]),
    ...c.store(ANCESTORS, [c.push("")]),
    ...c.store(OWN, [c.push("")]),
    /* Дети корня: имя, видимость/прозрачность/положение/размер, самый крупный по площади запоминается. */
    ...forIn(
      c.get(OWNER, "TIMELINE"),
      [
        ...c.store(VAL, [
          ...c.get(OWNER, "TIMELINE"),
          c.push(register(KEY)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.when(isClip, [
          ...append(TREE, 700),
          ...c.store(AREA, [
            ...c.get(VAL, "_width"),
            ...c.get(VAL, "_height"),
            c.op(OP.MULTIPLY),
          ]),
          ...c.when(
            [c.push(register(AREA)), c.push(register(BEST)), c.op(OP.GREATER)],
            [
              ...c.store(BEST, [c.push(register(AREA))]),
              ...c.store(BEST_AT, [c.push(register(KEY))]),
            ],
          ),
        ]),
      ],
      "kid",
    ),
    /* Дети самого крупного ребёнка. */
    ...forIn(
      [
        ...c.get(OWNER, "TIMELINE"),
        c.push(register(BEST_AT)),
        c.op(AVM1.GET_MEMBER),
      ],
      [
        ...c.store(VAL, [
          ...c.get(OWNER, "TIMELINE"),
          c.push(register(BEST_AT)),
          c.op(AVM1.GET_MEMBER),
          c.push(register(KEY)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.when(isClip, append(KIDS, 600)),
      ],
      "grand",
    ),
    /* Цепочка предков полосы HP: имя, видимость, прозрачность — до корня. */
    ...c.store(VAL, c.get(OWNER, "HEALTH_ARMOUR_BAR_MC")),
    ...c.store(INDEX, [c.push(0)]),
    { label: "ancTop" },
    c.push(register(VAL)),
    c.push(undefined),
    c.op(OP.STRICT_EQUALS),
    { branch: AVM1.IF, to: "ancEnd" },
    c.push(register(INDEX)),
    c.push(7),
    c.op(OP.GREATER),
    { branch: AVM1.IF, to: "ancEnd" },
    ...c.store(ANCESTORS, [
      c.push(register(ANCESTORS)),
      c.push(" "),
      c.op(OP.ADD2),
      ...c.get(VAL, "_name"),
      c.op(OP.ADD2),
      c.push(":"),
      c.op(OP.ADD2),
      ...c.get(VAL, "_visible"),
      c.op(OP.ADD2),
      c.push("/"),
      c.op(OP.ADD2),
      ...round(c.get(VAL, "_alpha")),
      c.op(OP.ADD2),
    ]),
    ...c.store(VAL, c.get(VAL, "_parent")),
    ...c.store(INDEX, [c.push(register(INDEX)), c.push(1), c.op(OP.ADD2)]),
    { branch: AVM1.JUMP, to: "ancTop" },
    { label: "ancEnd" },
    /* Клипы в самом экземпляре фильма (владельце): имена тех, что есть. */
    ...forIn(
      [c.push(register(OWNER))],
      [
        ...c.store(VAL, [
          c.push(register(OWNER)),
          c.push(register(KEY)),
          c.op(AVM1.GET_MEMBER),
        ]),
        ...c.when(
          isClip,
          c.when(
            [
              c.push(register(OWN)),
              c.push("length"),
              c.op(AVM1.GET_MEMBER),
              c.push(400),
              c.op(AVM1.LESS2),
            ],
            c.store(OWN, [
              c.push(register(OWN)),
              c.push(" "),
              c.op(OP.ADD2),
              c.push(register(KEY)),
              c.op(OP.ADD2),
            ]),
          ),
        ),
      ],
      "own",
    ),
  ];
  const steps = [
    /* Сторож паузы шагает от рисования строки: оно в игре живое каждый кадр. */
    ...(fix
      ? [
          c.push(0, register(THIS), "astralPfStep"),
          c.op(AVM1.CALL_METHOD),
          c.op(AVM1.POP),
        ]
      : []),
    ...c.store(OWNER, c.get(THIS, "owner")),
    ...c.store(NOW, stamp),
    ...c.store(RAW_AT, [
      ...of("TIMELINE", "_width"),
      c.push(100),
      c.op(OP.MULTIPLY),
      ...of("TIMELINE", "_xscale"),
      c.op(OP.DIVIDE),
    ]),
    ...tree,
    ...c.store(HOT, [c.push("")]),
    ...c.store(NEW, [c.push("")]),
    ...lists,
    /* getBounds клипа карты в координатах корня: объект остаётся в регистре. */
    ...c.store(BOUNDS, [
      ...c.get(OWNER, "TIMELINE"),
      c.push(1),
      ...c.get(OWNER, "TIMELINE", "CONTENT"),
      c.push("getBounds"),
      c.op(AVM1.CALL_METHOD),
    ]),
    ...place,
    /* Развёрнутый радар (hpwide11): строка стоит и масштабируется отдельно, чтобы быть на экране и читаться (корень там сжат иначе, чем у малой карты). */
    ...(fix?.bigText
      ? c.when(
          [...of("mapType"), c.push(2), c.op(OP.STRICT_EQUALS)],
          [
            ...c.set(THIS, ["_xscale"], [c.push(fix.bigText.xs)]),
            ...c.set(THIS, ["_yscale"], [c.push(fix.bigText.ys)]),
            ...c.set(THIS, ["_x"], [c.push(fix.bigText.x)]),
            ...c.set(THIS, ["_y"], [c.push(fix.bigText.y)]),
          ],
        )
      : []),
    ...c.set(THIS, ["tf", "text"], add(line)),
  ];
  return defineFunction2({
    registers: DRAW_REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/**
 * Обход сжатия карты паузы (проба hpwide3, 21.11.2026). Один и тот же фильм рисуют как радар и как карту паузы; пока сцена выросла
 * («HP отдельно от карты»), карта паузы — это прежний прямоугольник сцены, вписанный в запись `pausemap` в долях выросшей сцены, и
 * от неё остаётся пятно. Признак «меня рисуют как карту паузы» заранее неизвестен; гипотеза — у такого экземпляра фильма `SETUP_HEALTH_ARMOUR`
 * не зовут (`mapType` не задан). Поэтому через `PAUSE_WAIT` кадров после `INITIALISE` корень растягивается на всю сцену
 * (`_xscale = W/191`, `_yscale = H/136`, без сдвига), а первый же `SETUP_HEALTH_ARMOUR` возвращает радарный вид (сдвиг на меру
 * расширения, масштаб 100). Если гипотеза неверна, обход молчит, и отладочная строка скажет, почему.
 * `fix`: `{ sx, sy }` — проценты растяжения, `extent` — мера расширения, `width`, `height` — сцена в точках.
 */
export const PAUSE_WAIT = 10;

export function pauseTickFunction(pool, fix, counter = "n") {
  const c = bridgeCoder(pool);
  const OWNER = 2;
  const ROOT = 3;
  const unset = [
    ...c.get(OWNER, "mapType"),
    c.push(undefined),
    c.op(OP.STRICT_EQUALS),
  ];
  const stretch = [
    ...c.store(ROOT, c.get(OWNER, "TIMELINE")),
    ...c.set(ROOT, ["_xscale"], [c.push(fix.sx)]),
    ...c.set(ROOT, ["_yscale"], [c.push(fix.sy)]),
    ...c.set(ROOT, ["_x"], [c.push(0)]),
    ...c.set(ROOT, ["_y"], [c.push(0)]),
    ...c.set(ROOT, ["astralPause"], [c.push(true)]),
    ...hitCounters(c, OWNER, ROOT, "astralPfHits"),
  ];
  const steps = [
    ...c.set(
      THIS,
      [counter],
      [...c.get(THIS, counter), c.push(1), c.op(OP.ADD2)],
    ),
    ...c.when(
      [...c.get(THIS, counter), c.push(PAUSE_WAIT - 1), c.op(OP.GREATER)],
      c.when(
        [...c.get(THIS, "done"), c.op(AVM1.NOT)],
        [
          ...c.set(THIS, ["done"], [c.push(true)]),
          ...c.store(OWNER, c.get(THIS, "owner")),
          /* `always`: проба без признака режима — растянуть корень в любом случае (в игре радар будет огромным). */
          ...(fix.always ? stretch : c.when(unset, stretch)),
        ],
      ),
    ),
  ];
  return defineFunction2({
    registers: REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/** Счётчик срабатывания растяжения/возврата на радаре-владельце и значение _xscale корня, прочитанное сразу после записи. */
function hitCounters(c, OWNER, ROOT, name) {
  return [
    ...c.set(OWNER, [name], [...c.get(OWNER, name), c.push(1), c.op(OP.ADD2)]),
    ...c.set(OWNER, ["astralPfBack"], c.get(ROOT, "_xscale")),
  ];
}

/**
 * Обход паузы по признаку (hpwide4, 21.11.2026). Игра прячет полосу HP и брони (`HEALTH_ARMOUR_BAR_MC._visible`) на карте паузы: на кадрах
 * hpwide2 полос в паузе нет. Пока полоса скрыта, корень растянут на всю сцену (карта паузы — на весь экран), пока видна — радарный вид.
 * Работает каждый кадр после `PAUSE_WAIT` кадров от запуска; полосы ещё нет (`undefined`) — не трогает.
 */
export function pauseFlagTickFunction(pool, fix, counter = "n") {
  const c = bridgeCoder(pool);
  const OWNER = 2;
  const ROOT = 3;
  const BAR = 4;
  const paused = [
    ...c.get(ROOT, "astralPause"),
    c.push(true),
    c.op(OP.STRICT_EQUALS),
  ];
  const stretchStock = [
    ...c.set(ROOT, ["_xscale"], [c.push(fix.sx)]),
    ...c.set(ROOT, ["_yscale"], [c.push(fix.sy)]),
    ...c.set(ROOT, ["_x"], [c.push(0)]),
    ...c.set(ROOT, ["_y"], [c.push(0)]),
    ...c.set(ROOT, ["astralPause"], [c.push(true)]),
    ...hitCounters(c, OWNER, ROOT, "astralPfHits"),
  ];
  const restoreStock = [
    ...c.set(ROOT, ["_xscale"], [c.push(100)]),
    ...c.set(ROOT, ["_yscale"], [c.push(100)]),
    ...c.set(ROOT, ["_x"], [c.push(fix.extent.x)]),
    ...c.set(ROOT, ["_y"], [c.push(fix.extent.y)]),
    ...c.set(ROOT, ["astralPause"], [c.push(false)]),
    ...hitCounters(c, OWNER, ROOT, "astralPfRest"),
  ];
  /* Сцена штатного размера (hpwide7): в игре корень сжат и сдвинут обратно (xs = 191/W), в паузе — штатный (x=y=0, xs=100). `stretch` = состояние паузы, `restore` = игровое. */
  const stretch = fix.rootScale
    ? [
        ...c.set(ROOT, ["_xscale"], [c.push(100)]),
        ...c.set(ROOT, ["_yscale"], [c.push(100)]),
        ...c.set(ROOT, ["_x"], [c.push(0)]),
        ...c.set(ROOT, ["_y"], [c.push(0)]),
        ...c.set(ROOT, ["astralPause"], [c.push(true)]),
        ...hitCounters(c, OWNER, ROOT, "astralPfHits"),
      ]
    : stretchStock;
  const restore = fix.rootScale
    ? [
        ...c.set(ROOT, ["_xscale"], [c.push(fix.gxs)]),
        ...c.set(ROOT, ["_yscale"], [c.push(fix.gys)]),
        ...c.set(ROOT, ["_x"], [c.push(fix.gx)]),
        ...c.set(ROOT, ["_y"], [c.push(fix.gy)]),
        ...c.set(ROOT, ["astralPause"], [c.push(false)]),
        ...hitCounters(c, OWNER, ROOT, "astralPfRest"),
      ]
    : restoreStock;
  /* Самопроверка (hpwide5): на 40-м кадре клипа корень растягивается ×3 и читается обратно, на 42-м читается снова и возвращается к 100: видно, держится ли запись. */
  const selfTest =
    fix.selfTest && counter === "nf"
      ? [
          ...c.when(
            [...c.get(THIS, counter), c.push(40), c.op(OP.STRICT_EQUALS)],
            [
              ...c.store(OWNER, c.get(THIS, "owner")),
              ...c.store(ROOT, c.get(OWNER, "TIMELINE")),
              ...c.set(ROOT, ["_xscale"], [c.push(300)]),
              ...c.set(ROOT, ["_yscale"], [c.push(300)]),
              ...c.set(OWNER, ["astralPfS0"], c.get(ROOT, "_xscale")),
            ],
          ),
          ...c.when(
            [...c.get(THIS, counter), c.push(42), c.op(OP.STRICT_EQUALS)],
            [
              ...c.store(OWNER, c.get(THIS, "owner")),
              ...c.store(ROOT, c.get(OWNER, "TIMELINE")),
              ...c.set(OWNER, ["astralPfS1"], c.get(ROOT, "_xscale")),
              ...c.set(ROOT, ["_xscale"], [c.push(100)]),
              ...c.set(ROOT, ["_yscale"], [c.push(100)]),
            ],
          ),
        ]
      : [];
  const RAW = 4;
  const flagGate = [
    ...c.store(OWNER, c.get(THIS, "owner")),
    ...c.store(ROOT, c.get(OWNER, "TIMELINE")),
    ...c.store(BAR, c.get(OWNER, "HEALTH_ARMOUR_BAR_MC")),
    ...c.when(
      [
        c.push(register(BAR)),
        c.push(undefined),
        c.op(OP.STRICT_EQUALS),
        c.op(AVM1.NOT),
      ],
      [
        ...c.when(
          [...c.get(BAR, "_visible"), c.op(AVM1.NOT)],
          c.when([...paused, c.op(AVM1.NOT)], stretch),
        ),
        ...c.when([...c.get(BAR, "_visible")], c.when(paused, restore)),
      ],
    ),
  ];
  /* Грубый признак: ширина содержимого корня без учёта его масштаба. В игре у корня огромные плитки карты (≈ 7366), в паузе их нет (≈ 1237). */
  const widthGate = [
    ...c.store(OWNER, c.get(THIS, "owner")),
    ...c.store(ROOT, c.get(OWNER, "TIMELINE")),
    ...c.store(RAW, [
      ...c.get(ROOT, "_width"),
      c.push(100),
      c.op(OP.MULTIPLY),
      ...c.get(ROOT, "_xscale"),
      c.op(OP.DIVIDE),
    ]),
    ...c.set(OWNER, ["astralPfRaw"], [c.push(register(RAW))]),
    ...c.when(
      [c.push(register(RAW)), c.push(WIDTH_LIMIT), c.op(AVM1.LESS2)],
      [
        ...c.set(
          OWNER,
          ["astralPfLo"],
          [...c.get(OWNER, "astralPfLo"), c.push(1), c.op(OP.ADD2)],
        ),
        ...c.set(OWNER, ["astralPfHi"], [c.push(0)]),
      ],
    ),
    ...c.when(
      [
        c.push(register(RAW)),
        c.push(WIDTH_LIMIT),
        c.op(AVM1.LESS2),
        c.op(AVM1.NOT),
      ],
      [
        ...c.set(
          OWNER,
          ["astralPfHi"],
          [...c.get(OWNER, "astralPfHi"), c.push(1), c.op(OP.ADD2)],
        ),
        ...c.set(OWNER, ["astralPfLo"], [c.push(0)]),
      ],
    ),
    ...c.when(
      [...c.get(OWNER, "astralPfLo"), c.push(WIDTH_FRAMES), c.op(OP.GREATER)],
      c.when([...paused, c.op(AVM1.NOT)], stretch),
    ),
    ...c.when(
      [...c.get(OWNER, "astralPfHi"), c.push(WIDTH_FRAMES), c.op(OP.GREATER)],
      c.when(paused, restore),
    ),
  ];
  const steps = [
    ...c.set(
      THIS,
      [counter],
      [...c.get(THIS, counter), c.push(1), c.op(OP.ADD2)],
    ),
    ...selfTest,
    ...c.when(
      [...c.get(THIS, counter), c.push(PAUSE_WAIT - 1), c.op(OP.GREATER)],
      fix.rawWidth ? widthGate : flagGate,
    ),
  ];
  return defineFunction2({
    registers: REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps,
  });
}

/** Шаги в `INITIALISE`: сторож на пустом клипе — через `PAUSE_WAIT` кадров решает, растягивать ли корень. */
function pauseBootSteps(pool, fix) {
  const c = bridgeCoder(pool);
  const CLIP = 4;
  const tick = (counter) =>
    fix.flag || fix.rawWidth || fix.rootScale
      ? pauseFlagTickFunction(pool, fix, counter)
      : pauseTickFunction(pool, fix, counter);
  return [
    ...c.set(THIS, ["astralPfHits"], [c.push(0)]),
    ...c.set(THIS, ["astralPfRest"], [c.push(0)]),
    ...c.set(THIS, ["astralPfLo"], [c.push(0)]),
    ...c.set(THIS, ["astralPfHi"], [c.push(0)]),
    ...c.set(THIS, ["astralPfInit"], [c.push(1)]),
    /* hpwide5: createEmptyMovieClip клипа не дал (nf=undefined), поэтому сторож живёт на клипе строки, который игра рисует каждый кадр. */
    ...c.store(CLIP, c.get(THIS, "astralDbgClip")),
    ...c.set(THIS, ["astralPfClip"], [c.push(register(CLIP))]),
    ...c.set(CLIP, ["nf"], [c.push(0)]),
    ...c.set(CLIP, ["ni"], [c.push(0)]),
    ...c.set(CLIP, ["done"], [c.push(false)]),
    ...c.set(CLIP, ["astralPfStep"], [tick("nf")]),
    /* Второй драйвер — таймер на том же клипе. */
    ...c.set(CLIP, ["astralPfRun"], [tick("ni")]),
    c.push(100, "astralPfRun", register(CLIP), 3, "setInterval"),
    c.op(OP.CALL_FUNCTION),
    c.op(AVM1.POP),
  ];
}

/** Шаги в `SETUP_HEALTH_ARMOUR`: радарный вид корня (если корень был растянут как карта паузы). */
function pauseRevertSteps(pool, fix) {
  const c = bridgeCoder(pool);
  const ROOT = 3;
  return [
    ...c.store(ROOT, c.get(THIS, "TIMELINE")),
    ...c.when(
      [...c.get(ROOT, "astralPause"), c.push(true), c.op(OP.STRICT_EQUALS)],
      [
        ...c.set(ROOT, ["_xscale"], [c.push(100)]),
        ...c.set(ROOT, ["_yscale"], [c.push(100)]),
        ...c.set(ROOT, ["_x"], [c.push(fix.extent.x)]),
        ...c.set(ROOT, ["_y"], [c.push(fix.extent.y)]),
        ...c.set(ROOT, ["astralPause"], [c.push(false)]),
      ],
    ),
  ];
}

/** Цвет метки по умолчанию — красный, непрозрачный. */
const MARK_RED = [255, 0, 0, 255];
/** Имена экспортов клипов с метками и сеткой калибровки. */
export const DEBUG_MARKS_SYMBOL = "astralDbgMk";
export const DEBUG_GRID_SYMBOL = "astralDbgGr";

const colourKey = (colour) => colour.join(",");
const colourOf = (mark) => mark.colour ?? MARK_RED;
/** Сколько разных цветов в метках: по шейпу на цвет. */
const colourCount = (marks) =>
  new Set(marks.map((mark) => colourKey(colourOf(mark)))).size;

/**
 * Метки пробы «где фильм рисуется» (hpwide10c/11): непрозрачные квадраты в точках КОРНЯ фильма (`marks`: `{ at: [x, y], size, colour? }` в точках,
 * `colour` — [r, g, b, 255], по умолчанию красный). Квадраты одного цвета — один шейп (контуры не пересекаются), по шейпу на цвет. Рёбра коротки:
 * у прямого ребра SWF предел ±65535 твипов, а прежний прямоугольник на ±30000 точек его превышал и не рисовался вовсе (стенд 21.11, hpwide9c).
 * Возвращает `{ tags, ids }`: теги шейпов и их номера для спрайта.
 */
function marksShapes(shapeIds, marks) {
  const groups = new Map();
  for (const { at, size, colour } of marks) {
    const key = colourKey(colour ?? MARK_RED);
    if (!groups.has(key))
      groups.set(key, { colour: colour ?? MARK_RED, polygons: [] });
    const half = (size / 2) * TWIPS;
    const cx = at[0] * TWIPS;
    const cy = at[1] * TWIPS;
    groups.get(key).polygons.push([
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
    ]);
  }
  const list = [...groups.values()];
  return {
    ids: list.map((_, position) => shapeIds[position]),
    tags: list.map((group, position) =>
      definePolygonsShape(shapeIds[position], group.polygons, group.colour),
    ),
  };
}

/** Спрайт из шейпов: каждый шейп на своей глубине. */
const marksSprite = (spriteId, shapeIds) =>
  defineSprite(
    spriteId,
    shapeIds.map((shapeId, position) =>
      placeObject2({
        depth: position + 1,
        characterId: shapeId,
        matrix: IDENTITY_MATRIX,
      }),
    ),
  );

/** Теги отладочной строки: шрифт (если не подключён), поле, спрайт `{ tf }`, спрайты с метками и сеткой и экспорты. */
function definitions(
  index,
  { width, height, fontSize, marker = null, grid = null },
) {
  const font = index.imports.get("$Font2") || index.imports.get("$Font2_cond");
  const markMarks = marker?.marks ?? [];
  const gridMarks = grid?.marks ?? [];
  const shapeCount =
    (markMarks.length ? colourCount(markMarks) : 0) +
    (gridMarks.length ? colourCount(gridMarks) : 0);
  const ids = allocateCharacterIds(index, 5 + shapeCount);
  const [fieldId, spriteId, fontImportId, markSpriteId, gridSpriteId] = ids;
  const shapeIds = ids.slice(5);
  const fontId = font ? font.id : fontImportId;
  const bounds = {
    xmin: 0,
    xmax: Math.round(width * TWIPS),
    ymin: 0,
    ymax: Math.round(height * TWIPS),
  };
  const markShapes = markMarks.length
    ? marksShapes(shapeIds, markMarks)
    : { tags: [], ids: [] };
  const gridShapes = gridMarks.length
    ? marksShapes(shapeIds.slice(markShapes.ids.length), gridMarks)
    : { tags: [], ids: [] };
  const exports = [[spriteId, DEBUG_SYMBOL]];
  if (markMarks.length) exports.push([markSpriteId, DEBUG_MARKS_SYMBOL]);
  if (gridMarks.length) exports.push([gridSpriteId, DEBUG_GRID_SYMBOL]);
  const exported = Buffer.concat([
    (() => {
      const count = Buffer.alloc(2);
      count.writeUInt16LE(exports.length, 0);
      return count;
    })(),
    ...exports.map(([id, name]) => {
      const head = Buffer.alloc(2);
      head.writeUInt16LE(id, 0);
      return Buffer.concat([head, Buffer.from(name + "\0", "latin1")]);
    }),
  ]);
  return [
    ...(font ? [] : [importFont(fontId, "$Font2")]),
    defineMultilineText({
      id: fieldId,
      bounds,
      fontId,
      fontHeight: fontSize * TWIPS,
      color: [255, 255, 0],
    }),
    ...markShapes.tags,
    ...(markMarks.length ? [marksSprite(markSpriteId, markShapes.ids)] : []),
    ...gridShapes.tags,
    ...(gridMarks.length ? [marksSprite(gridSpriteId, gridShapes.ids)] : []),
    defineSprite(spriteId, [
      placeObject2({
        depth: 1,
        characterId: fieldId,
        matrix: IDENTITY_MATRIX,
        name: "tf",
      }),
    ]),
    swfTag(SWF_TAG.EXPORT_ASSETS, exported),
  ];
}

/**
 * Тик сетки калибровки (hpwide12): таймер на экземпляре фильма раз в 100 мс показывает сетку, пока `mapType` = 2. Как сторож карты паузы, не зависит ни от кадров клипа,
 * ни от рисующей функции строки (на стенде hpwide11 строка в обычном радаре не нарисовалась, а сторож на экземпляре работает).
 */
export function gridTickFunction(pool) {
  const c = bridgeCoder(pool);
  const GRID = 3;
  return defineFunction2({
    registers: REGISTERS,
    flags: BRIDGE_METHOD_FLAGS,
    steps: [
      ...c.store(GRID, c.get(THIS, "astralDbgGr")),
      ...c.set(
        GRID,
        ["_visible"],
        [...c.get(THIS, "mapType"), c.push(2), c.op(OP.STRICT_EQUALS)],
      ),
    ],
  });
}

/** Шаги в начале `INITIALISE`: функции, клип на корне и первая запись. */
function bootSteps(
  pool,
  { x, y },
  fix = null,
  methodNames = [],
  extras = { marks: false, grid: false },
) {
  const c = bridgeCoder(pool);
  const HOST = 3;
  const CLIP = 4;
  const SPARE = 5;
  /* Клип с метками на корне: глубже клипа строки, чтобы строка шла поверх. */
  const attach = (symbol, instance, field) => [
    c.push(0, register(HOST), "getNextHighestDepth"),
    c.op(AVM1.CALL_METHOD),
    c.push(instance, symbol, 3, register(HOST), "attachMovie"),
    c.op(AVM1.CALL_METHOD),
    action(AVM1.STORE_REGISTER, Buffer.from([SPARE])),
    c.op(AVM1.POP),
    ...c.set(THIS, [field], [c.push(register(SPARE))]),
  ];
  return [
    ...c.set(THIS, ["astralDbgLog"], [logFunction(pool)]),
    ...c.set(
      THIS,
      ["astralDbgNames"],
      methodNames.length
        ? [
            c.push(...[...methodNames].reverse(), methodNames.length),
            c.op(OP.INIT_ARRAY),
          ]
        : [c.push(0), c.op(OP.INIT_ARRAY)],
    ),
    ...c.set(THIS, ["astralDbgDraw"], [drawFunction(pool, fix, methodNames)]),
    ...c.when(
      [
        ...c.get(THIS, "astralDbgClip"),
        c.push(undefined),
        c.op(OP.STRICT_EQUALS),
      ],
      [
        ...c.store(HOST, c.get(THIS, "TIMELINE")),
        ...(extras.marks
          ? attach(DEBUG_MARKS_SYMBOL, "astralDbgMkMc", "astralDbgMk")
          : []),
        ...(extras.grid
          ? [
              ...attach(DEBUG_GRID_SYMBOL, "astralDbgGrMc", "astralDbgGr"),
              ...c.set(THIS, ["astralDbgGridTick"], [gridTickFunction(pool)]),
              c.push(
                100,
                "astralDbgGridTick",
                register(THIS),
                3,
                "setInterval",
              ),
              c.op(OP.CALL_FUNCTION),
              c.op(AVM1.POP),
            ]
          : []),
        c.push(0, register(HOST), "getNextHighestDepth"),
        c.op(AVM1.CALL_METHOD),
        c.push("astralDbgMc", DEBUG_SYMBOL, 3, register(HOST), "attachMovie"),
        c.op(AVM1.CALL_METHOD),
        action(AVM1.STORE_REGISTER, Buffer.from([CLIP])),
        c.op(AVM1.POP),
        ...c.set(THIS, ["astralDbgClip"], [c.push(register(CLIP))]),
        ...c.set(CLIP, ["_x"], [c.push(x)]),
        ...c.set(CLIP, ["_y"], [c.push(y)]),
        ...c.set(CLIP, ["owner"], [c.push(register(THIS))]),
        ...c.set(CLIP, ["onEnterFrame"], c.get(THIS, "astralDbgDraw")),
        /* Тот же ход строки таймером на клипе: если кадры клипа не идут, строка всё равно обновляется. */
        ...c.set(CLIP, ["astralDbgDrawT"], c.get(THIS, "astralDbgDraw")),
        c.push(100, "astralDbgDrawT", register(CLIP), 3, "setInterval"),
        c.op(OP.CALL_FUNCTION),
        c.op(AVM1.POP),
      ],
    ),
  ];
}

/** Запись в журнал: `this.astralDbgLog("ИМЯ")`. */
const logSteps = (pool, name) => {
  const c = bridgeCoder(pool);
  return [
    c.push(name, 1, register(THIS), "astralDbgLog"),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ];
};

/**
 * Фильм радара с отладочной строкой. `x`, `y` — где стоит строка в координатах корня фильма (корень сдвинут расширением сцены).
 * Возвращает `{ buffer, sha256, methods }`: `methods` — какие методы получили запись, `skipped` — какие нельзя было править.
 */
export function instrumentMinimapDebug(
  baseBuffer,
  {
    x = 0,
    y = 0,
    width = 620,
    height = 400,
    fontSize = 20,
    bootMethod = "INITIALISE",
    /* Обход сжатия карты паузы: `{ extent: {x, y}, pauseAt: [доля, доля], radarAt: [x, y] }` — см. `pauseBootSteps`. */
    pauseFix = null,
    /* Метки пробы «где фильм рисуется»: `{ marks: [{ at, size }], origin }` (см. `markerShape`). */
    marker = null,
    /* Сетка калибровки развёрнутого радара: `{ marks }`, клип виден только при `mapType` = 2 (`fix.gridProbe`). */
    grid = null,
  } = {},
) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("minimap.gfx must be a Buffer.");
  const base = uncompressedScaleform(baseBuffer);
  const classTag = minimapClassTag(base);
  const program = readProgram(base, classTag.payloadStart + 2, classTag.end);
  assertActionStream(base, program.start, program.end);
  const fix = pauseFix
    ? (() => {
        const width = 191 + 2 * pauseFix.extent.x;
        const height = 136 + 2 * pauseFix.extent.y;
        return {
          ...pauseFix,
          width,
          height,
          sx: Math.round((width / 191) * 10000) / 100,
          sy: Math.round((height / 136) * 10000) / 100,
          radarAt: pauseFix.radarAt ?? [x, y],
          /* Сцена штатного размера: игровое состояние корня (проценты и сдвиг в точках штатной сцены). */
          gxs: Math.round((19100 / width) * 100) / 100,
          gys: Math.round((13600 / height) * 100) / 100,
          gx: Math.round(((pauseFix.extent.x * 191) / width) * 100) / 100,
          gy: Math.round(((pauseFix.extent.y * 136) / height) * 100) / 100,
        };
      })()
    : null;
  const names = [...new Set(program.pool)];
  /* Имена методов, которые получат запись: по ним строка в кадре строит списки «звали за 3 с» и «впервые звали за 10 с». */
  const instrumentable = names.filter((name) => {
    try {
      const method = findMethod(program, name);
      const header = program.records.find(
        (record) =>
          record.end === method.start && record.code === AVM1.DEFINE_FUNCTION2,
      );
      if (!header) return false;
      const flagsAt = base.indexOf(0, header.bodyStart) + 1 + 2 + 1;
      return (base.readUInt16LE(flagsAt) & 0x01) !== 0;
    } catch {
      return false;
    }
  });
  const methods = [];
  const skipped = [];
  const edits = [];
  for (const name of names) {
    let method;
    try {
      method = findMethod(program, name);
    } catch {
      continue;
    }
    const header = program.records.find(
      (record) =>
        record.end === method.start && record.code === AVM1.DEFINE_FUNCTION2,
    );
    if (!header) continue;
    const flagsAt = base.indexOf(0, header.bodyStart) + 1 + 2 + 1;
    const flags = base.readUInt16LE(flagsAt);
    if (!(flags & 0x01)) {
      skipped.push(`${name}: this не в регистре`);
      continue;
    }
    try {
      const steps =
        name === bootMethod
          ? [
              ...bootSteps(program.pool, { x, y }, fix, instrumentable, {
                marks: Boolean(marker?.marks?.length),
                grid: Boolean(grid?.marks?.length),
              }),
              ...(fix && !fix.productionGuard
                ? pauseBootSteps(program.pool, fix)
                : []),
              ...logSteps(program.pool, name),
            ]
          : [
              ...(fix &&
              !fix.always &&
              !fix.flag &&
              !fix.rawWidth &&
              !fix.rootScale &&
              !fix.productionGuard &&
              name === "SETUP_HEALTH_ARMOUR"
                ? pauseRevertSteps(program.pool, fix)
                : []),
              ...logSteps(program.pool, name),
            ];
      edits.push(prologueEdit(base, program, { ...method, name }, steps));
      methods.push(name);
    } catch (error) {
      skipped.push(`${name}: ${error.message}`);
    }
  }
  if (!methods.includes(bootMethod))
    throw new Error(
      `В minimap.gfx нет метода ${bootMethod} — отладочную строку некуда подвесить. Пропущено: ${skipped.join("; ")}; найдено: ${methods.join(", ")}`,
    );
  const actions = rewriteActions(base, program.start, program.end, edits, {
    internalBranches: true,
    internalFunctions: true,
  });
  const payload = Buffer.concat([
    base.subarray(classTag.payloadStart, classTag.payloadStart + 2),
    actions,
  ]);
  const defs = definitions(indexSwf(base), {
    width,
    height,
    fontSize,
    marker,
    grid,
  });
  const compiled = Buffer.concat([
    base.subarray(0, classTag.offset),
    ...defs,
    swfTag(SWF_TAG.DO_INIT_ACTION, payload),
    base.subarray(classTag.end),
  ]);
  compiled.writeUInt32LE(compiled.length, 4);
  return { buffer: compiled, sha256: sha256(compiled), methods, skipped };
}
