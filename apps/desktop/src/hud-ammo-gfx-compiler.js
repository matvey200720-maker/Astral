import { createHash } from "node:crypto";
import {
  AMMO_ICON,
  AMMO_ICON_GAP,
  AMMO_ICON_WIDTH,
  AMMO_GAME_GAP,
  AMMO_SEPARATOR,
  ammoAlignShift,
  ammoFieldTop,
  ammoFont,
  ammoIconPolygons,
  ammoPlateGeometry,
  hexToRgb,
  normalizeAmmoCounter,
} from "@modovik/reticle-contract";
import {
  AVM1,
  action,
  assembleActions,
  assertActionStream,
  findMethod,
  findPattern,
  pushAction,
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
  defineScalingGrid,
  defineSprite,
  indexSwf,
  parseSwfTags,
  placeObject2,
  readPlacement,
  scaleformHeaderLength,
  swfTag,
  uncompressedScaleform,
} from "./scaleform-swf.js";

/*
 * Счётчик патронов (задача 12 ТЗ 10.10.2026) — блок оружия `HUD_WEAPON_ICON`
 * в hud.gfx самого игрока, собранный заново правкой AVM1 по смыслу.
 *
 * Как блок устроен в игре (снято с hud.gfx Steam Legacy):
 *
 *   • числа шлёт игра: `SET_AMMO_COUNT([запас, в обойме, размер обоймы,
 *     тип])` на каждый выстрел, перезарядку и смену ствола. Метод кладёт их
 *     в поля `ammo` и `clipCounter` (`setTextFields(params[0].toString(),
 *     params[1].toString(), params[2])`: запас — в `ammoText`, обойма — в
 *     `clipCountText`, и только при размере обоймы больше 1; запас — патроны
 *     ВНЕ обоймы), под ними — поля
 *     обводки того же текста (`outline = 15`), рядом — значок типа патронов
 *     (`setAmmoIcon`). У холодного оружия, кулака и техники поля пустые;
 *   • блок стоит в списке правого верхнего угла (`listId` 1 frontend.xml):
 *     контейнер `reorderList` ставит его `_y` под деньгами и розыском.
 *     Положение и список приходят из frontend.xml через
 *     `BaseContainer.SET_COMPONENT_VALUES`; frontend.xml уже целиком пишет
 *     мини-карта, поэтому счётчик правит не его, а то, что из него пришло;
 *   • блок гаснет сам: `STAY_ON_SCREEN` через 5 с (`ON_SCREEN_DURATION`)
 *     зовёт `HIDE` → `REMOVE` → `REMOVE_HUD_ITEM`, пока игрок не целится;
 *   • скрыть блок игра (и скрипт сервера `HIDE_HUD_COMPONENT_THIS_FRAME(2)`)
 *     просит у `NEW_HUD.HIDE(2)`; пока он скрыт, вызовы его методов копятся
 *     в очереди контейнера (`CONTAINER_METHOD`) и цифры не меняются.
 *
 * Что меняется:
 *
 *   1. `SET_COMPONENT_VALUES`: у блока 2 — своё место (выравнивание «I»:
 *      доля экрана без безопасной зоны) и выход из списка (`listId` −1);
 *   2. `READY`: масштаб блока, поле запаса — с разметкой HTML, поле обоймы
 *      и его обводка — скрыты (строка счётчика — одно поле), метка Astral;
 *   3. после `setAmmoIcon` в `SET_AMMO_COUNT`: строка `<FONT FACE COLOR>` из
 *      чисел, что игра только что положила в поля, тем же текстом — обводка,
 *      значок до/после/нет и выравнивание у точки. Вторая цифра порядка
 *      «обойма / всего» — всего патронов: обойма плюс запас (`astralT`), как
 *      показывают серверы; нет обоймы — один запас, он и есть всё; Значок — свой
 *      (`astralIcon`, три пули в клипе блока): штатный `ammoIcon` в hud.gfx
 *      пустой. Там, где игра гасит цифры (холодное оружие, полоса заряда),
 *      гаснет и он; цвета — без приглушения «белым HUD» (240 из 255);
 *   3а. подложка (задача 7 ТЗ 17.10.2026, вечер): клип `astralPlate` под
 *      цифрами внутри `CONTENT` — скруглённый прямоугольник с цветом и
 *      прозрачностью в заливке (DefineShape3) и сеткой масштабирования
 *      (DefineScalingGrid, 9-slice): строка раскладки ставит ему `_x` и
 *      `_width` по ширине цифр со значком, а сетка растягивает только середину —
 *      углы не плывут и стыков, что давали бы три куска, нет. Той же сеткой
 *      пользуется hud.gfx игры (два спрайта). Лежит под полями: штатный
 *      невидимый `clipCounterStroke` с нижней глубины уходит наверх;
 *   4. «пока в руках ствол»: `STAY_ON_SCREEN` не запускает гашение;
 *   5. «поверх скрытия»: `NEW_HUD.HIDE` не прячет блок 2.
 *
 * Числа по-прежнему считает игра — счётчик видит то же, что её блок, для
 * любого ствола. Файл, где чего-то из этого нет, отвергается до установки.
 */

export const HUD_GFX_ENTRY = "x64/data/cdimages/scaleform_generic.rpf/hud.gfx";
export const HUD_GFX_TARGET = `update:/${HUD_GFX_ENTRY}`;

/** Номер блока оружия в HUD — тот же, что у `HIDE_HUD_COMPONENT_THIS_FRAME`. */
export const HUD_WEAPON_ICON_ID = 2;

/** Метка счётчика Astral в классе блока: по ней узнаётся своя сборка. */
export const HUD_AMMO_MARKER = "astralAmmo";

const OP = Object.freeze({
  SUBTRACT: 0x0b,
  MULTIPLY: 0x0c,
  DIVIDE: 0x0d,
  RETURN: 0x3e,
  ADD2: 0x47,
  EQUALS2: 0x49,
  TO_NUMBER: 0x4a,
  TO_STRING: 0x4b,
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/* ------------------------- поиск классов ------------------------- */

function programOf(buffer, tag) {
  try {
    return readProgram(buffer, tag.payloadStart + 2, tag.end);
  } catch {
    return null;
  }
}

/* Метод класса или отказ со словами о hud.gfx, а не о байт-коде. */
function methodOf(program, name, label) {
  try {
    return findMethod(program, name);
  } catch {
    throw new Error(
      `В hud.gfx у класса ${label} нет одного метода ${name} — файл устроен не как у игры.`,
    );
  }
}

const defines = (program, name) => {
  try {
    findMethod(program, name);
    return true;
  } catch {
    return false;
  }
};

function classTag(buffer, tags, label, names) {
  const found = [];
  for (const tag of tags) {
    if (tag.code !== SWF_TAG.DO_INIT_ACTION || tag.length < 2) continue;
    const program = programOf(buffer, tag);
    if (!program || !names.every((name) => program.pool.includes(name)))
      continue;
    if (names.every((name) => defines(program, name)))
      found.push({ tag, program });
  }
  if (found.length !== 1)
    throw new Error(
      `В hud.gfx класс ${label} найден ${found.length} раз, ожидался один.`,
    );
  return found[0];
}

/** Стоит ли в этом hud.gfx счётчик Astral. */
export function hudHasAstralAmmo(gfxBuffer) {
  const buffer = uncompressedScaleform(gfxBuffer);
  const tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  for (const tag of tags) {
    if (tag.code !== SWF_TAG.DO_INIT_ACTION || tag.length < 2) continue;
    const program = programOf(buffer, tag);
    if (!program?.pool.includes("SET_WEAPONS_AND_AMMO_FOREVER")) continue;
    for (const record of program.records)
      if (
        record.code === AVM1.PUSH &&
        program.pushValues(record).includes(HUD_AMMO_MARKER)
      )
        return true;
  }
  return false;
}

/* --------------------------- код AVM1 --------------------------- */

/*
 * Маленький набор для своих строк кода: `this.a.b` на стеке, присваивание,
 * вызов, условие. Метки — свои у каждого куска (`assembleActions`).
 */
function coder(pool) {
  let labels = 0;
  const push = (...values) => pushAction(values, pool);
  const op = (code) => action(code);
  /* this.a.b… на стеке. */
  const self = (...path) => [
    push(register(1), path[0]),
    op(AVM1.GET_MEMBER),
    ...path.slice(1).flatMap((name) => [push(name), op(AVM1.GET_MEMBER)]),
  ];
  /* this.a.b… = значение. */
  const set = (path, value) => [
    ...(path.length > 1 ? self(...path.slice(0, -1)) : [push(register(1))]),
    push(path.at(-1)),
    ...value,
    op(AVM1.SET_MEMBER),
  ];
  const literal = (value) => [push(value)];
  const label = (name) => `${name}${(labels += 1)}`;
  /* if (a == b) {…} */
  const ifEqual = (left, right, body) => {
    const skip = label("skip");
    return [
      ...left,
      ...right,
      op(OP.EQUALS2),
      op(AVM1.NOT),
      { branch: AVM1.IF, to: skip },
      ...body,
      { label: skip },
    ];
  };
  /* if (a != b) {…} */
  const ifNotEqual = (left, right, body) => {
    const skip = label("skip");
    return [
      ...left,
      ...right,
      op(OP.EQUALS2),
      { branch: AVM1.IF, to: skip },
      ...body,
      { label: skip },
    ];
  };
  /* this.method(…) без результата. */
  const call = (path, method, args = []) => [
    ...[...args].reverse().flat(),
    push(args.length),
    ...(path.length ? self(...path) : [push(register(1))]),
    push(method),
    op(AVM1.CALL_METHOD),
    op(AVM1.POP),
  ];
  return { push, op, self, set, literal, ifEqual, ifNotEqual, call, label };
}

/* Код до первого действия метода: [код…, первое действие]. */
export function prologueEdit(buffer, program, method, steps) {
  const first = program.records.find(
    (record) => record.offset === method.start,
  );
  if (!first) throw new Error(`В hud.gfx у метода ${method.name} нет тела.`);
  for (const record of program.records) {
    if (record.code !== AVM1.IF && record.code !== AVM1.JUMP) continue;
    const target = record.end + buffer.readInt16LE(record.bodyStart);
    if (target === method.start)
      throw new Error(
        `В hud.gfx в начало метода ${method.name} ведёт переход — правка там небезопасна.`,
      );
  }
  return {
    start: first.offset,
    end: first.end,
    replacement: assembleActions([
      ...steps,
      buffer.subarray(first.offset, first.end),
    ]),
  };
}

/* Код после последнего действия метода: [последнее действие, код…]. */
function epilogueEdit(buffer, program, method, steps) {
  const inside = program.records.filter(
    (record) => record.offset >= method.start && record.end <= method.end,
  );
  const last = inside.at(-1);
  if (!last || last.end !== method.end)
    throw new Error(`В hud.gfx у метода ${method.name} нет тела.`);
  for (const record of inside) {
    if (record.code !== AVM1.IF && record.code !== AVM1.JUMP) continue;
    const target = record.end + buffer.readInt16LE(record.bodyStart);
    if (target === method.end)
      throw new Error(
        `В hud.gfx из метода ${method.name} есть выход в обход конца — правка там небезопасна.`,
      );
  }
  if (last.code === OP.RETURN)
    throw new Error(`В hud.gfx метод ${method.name} кончается возвратом.`);
  return {
    start: last.offset,
    end: last.end,
    replacement: assembleActions([
      buffer.subarray(last.offset, last.end),
      ...steps,
    ]),
  };
}

const rgbHex = (value) => `#${String(value).replace(/^#/, "").toUpperCase()}`;

/* Строка счётчика: куски `<FONT>` из чисел, что игра положила в поля. */
function counterTextSteps(c, counter) {
  const face = ammoFont(counter.font).face;
  const open = (colour) => `<FONT FACE='${face}' COLOR='${rgbHex(colour)}'>`;
  const strokeOpen = `<FONT FACE='${face}' COLOR='#000000'>`;
  const close = "</FONT>";
  const clip = { field: "clipCountText", colour: counter.clipColor };
  /* «Обойма / всего»: вторая цифра — `astralT` (обойма плюс запас), в «как в игре» — штатный запас. */
  const total = counter.format !== "game";
  const reserve = {
    field: "ammoText",
    colour: counter.reserveColor,
    ...(total ? { value: c.self("astralT") } : {}),
  };
  const [first, second] =
    counter.format === "game" ? [reserve, clip] : [clip, reserve];
  const separator = counter.format === "game" ? AMMO_GAME_GAP : AMMO_SEPARATOR;
  /* this.astralH += open + this.<поле>.text + close (и то же — обводке). */
  const valueOf = (part) => part.value ?? c.self(part.field, "text");
  const appendField = (part) => [
    ...c.set(
      ["astralH"],
      [
        ...c.self("astralH"),
        c.push(open(part.colour)),
        c.op(OP.ADD2),
        ...valueOf(part),
        c.op(OP.ADD2),
        c.push(close),
        c.op(OP.ADD2),
      ],
    ),
    ...c.set(
      ["astralS"],
      [
        ...c.self("astralS"),
        c.push(strokeOpen),
        c.op(OP.ADD2),
        ...valueOf(part),
        c.op(OP.ADD2),
        c.push(close),
        c.op(OP.ADD2),
      ],
    ),
  ];
  const appendSeparator = [
    ...c.set(
      ["astralH"],
      [
        ...c.self("astralH"),
        c.push(`${open(counter.reserveColor)}${separator}${close}`),
        c.op(OP.ADD2),
      ],
    ),
    ...c.set(
      ["astralS"],
      [
        ...c.self("astralS"),
        c.push(`${strokeOpen}${separator}${close}`),
        c.op(OP.ADD2),
      ],
    ),
  ];
  const empty = (part) => [c.self(part.field, "text"), [c.push("")]];
  /* this.astralT = запас; есть и обойма, и запас — обойма + запас (числом, потом строкой). */
  const totalSteps = total
    ? [
        ...c.set(["astralT"], c.self("ammoText", "text")),
        ...c.ifNotEqual(
          ...empty(clip),
          c.ifNotEqual(
            ...empty(reserve),
            c.set(
              ["astralT"],
              [
                ...c.self("clipCountText", "text"),
                c.op(OP.TO_NUMBER),
                ...c.self("ammoText", "text"),
                c.op(OP.TO_NUMBER),
                c.op(OP.ADD2),
                c.op(OP.TO_STRING),
              ],
            ),
          ),
        ),
      ]
    : [];
  return [
    ...c.set(["astralH"], c.literal("")),
    ...c.set(["astralS"], c.literal("")),
    ...totalSteps,
    ...c.ifNotEqual(...empty(first), [
      ...appendField(first),
      ...c.ifNotEqual(...empty(second), appendSeparator),
    ]),
    ...c.ifNotEqual(...empty(second), appendField(second)),
    ...c.set(["ammoText", "htmlText"], c.self("astralH")),
    ...c.set(["ammoStrokeTF", "htmlText"], c.self("astralS")),
  ];
}

/* Свой значок патронов — экземпляр в клипе блока. */
export const HUD_AMMO_ICON = "astralIcon";
const ICON = ["CONTENT", HUD_AMMO_ICON];

/* Значок и строка у точки: та же арифметика, что `ammoCounterLayout`. */
function counterLayoutSteps(c, counter) {
  const shift = ammoAlignShift(counter.align);
  const withIcon = counter.icon !== "none";
  const steps = [...c.set(["astralI"], c.literal(0))];
  /* Значок — только при цифрах: у ствола без цифр ему не к чему стоять. */
  if (withIcon)
    steps.push(
      ...c.ifNotEqual(
        c.self("ammoText", "textWidth"),
        [c.push(0)],
        c.set(["astralI"], c.literal(AMMO_ICON_WIDTH + AMMO_ICON_GAP)),
      ),
    );
  steps.push(
    ...c.set(
      ["astralW"],
      [...c.self("ammoText", "textWidth"), ...c.self("astralI"), c.op(OP.ADD2)],
    ),
    /* this.astralX = 0 - this.astralW * доля выравнивания */
    ...c.set(
      ["astralX"],
      [
        c.push(0),
        ...c.self("astralW"),
        c.push(shift),
        c.op(OP.MULTIPLY),
        c.op(OP.SUBTRACT),
      ],
    ),
  );
  /* Поле на 2 точки шире текста с каждой стороны — начало букв в точке. */
  if (counter.icon === "before")
    steps.push(
      ...c.set([...ICON, "_x"], c.self("astralX")),
      ...c.set(
        ["ammoText", "_x"],
        [
          ...c.self("astralX"),
          ...c.self("astralI"),
          c.op(OP.ADD2),
          c.push(2),
          c.op(OP.SUBTRACT),
        ],
      ),
    );
  else {
    steps.push(
      ...c.set(
        ["ammoText", "_x"],
        [...c.self("astralX"), c.push(2), c.op(OP.SUBTRACT)],
      ),
    );
    if (withIcon)
      steps.push(
        ...c.set(
          [...ICON, "_x"],
          [
            ...c.self("astralX"),
            ...c.self("ammoText", "textWidth"),
            c.op(OP.ADD2),
            c.push(AMMO_ICON_GAP),
            c.op(OP.ADD2),
          ],
        ),
      );
  }
  const fieldTop = Math.round(ammoFieldTop(counter.font) * 100) / 100;
  steps.push(
    ...c.set(["ammoStrokeTF", "_x"], c.self("ammoText", "_x")),
    /* Середина цифр — в точке: верх поля по меркам шрифта. */
    ...c.set(["ammoText", "_y"], c.literal(fieldTop)),
    ...c.set(["ammoStrokeTF", "_y"], c.literal(fieldTop)),
    ...c.set(["ammoIcon", "_visible"], c.literal(false)),
    ...c.set(["clipCountText", "_visible"], c.literal(false)),
    ...c.set(["clipCountStrokeTF", "_visible"], c.literal(false)),
  );
  if (withIcon)
    steps.push(
      ...c.set([...ICON, "_y"], c.literal(0)),
      ...c.set([...ICON, "_visible"], c.literal(false)),
      ...c.ifNotEqual(
        c.self("astralI"),
        [c.push(0)],
        c.set([...ICON, "_visible"], c.literal(true)),
      ),
    );
  if (counter.plate) steps.push(...plateLayoutSteps(c, counter));
  return steps;
}

export const HUD_AMMO_PLATE = "astralPlate";
const PLATE = ["CONTENT", HUD_AMMO_PLATE];

/*
 * Подложка у строки: пока цифр нет, она скрыта и её размеры не трогаем
 * (`_width = 0` не вернуть); есть цифры — от `astralX − отступ` шириной
 * `astralW + 2 × отступ`; середина по вертикали — на точке, как у цифр.
 */
function plateLayoutSteps(c, counter) {
  const { padX } = ammoPlateGeometry(counter);
  return [
    ...c.set([...PLATE, "_visible"], c.literal(false)),
    ...c.ifNotEqual(
      c.self("ammoText", "textWidth"),
      [c.push(0)],
      [
        ...c.set(
          [...PLATE, "_x"],
          [...c.self("astralX"), c.push(padX), c.op(OP.SUBTRACT)],
        ),
        ...c.set([...PLATE, "_y"], c.literal(0)),
        ...c.set(
          [...PLATE, "_width"],
          [...c.self("astralW"), c.push(2 * padX), c.op(OP.ADD2)],
        ),
        ...c.set([...PLATE, "_visible"], c.literal(true)),
      ],
    ),
  ];
}

/* Где игра гасит цифры (`this.ammoIcon._visible = false`), гаснет и значок. */
const AMMO_ICON_HIDDEN = Object.freeze([
  [AVM1.PUSH, [register(1), "ammoIcon"]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, ["_visible", false]],
  AVM1.SET_MEMBER,
]);

/*
 * Значок патронов: три пули цвета обоймы, под ними — те же пули чёрным
 * чуть шире (обводка, если она включена). Начало — у левого края по
 * середине высоты, как у `ammoIconPolygons`.
 */
function iconDefinitions(ids, counter) {
  if (counter.icon === "none") return null;
  const [fillId, outlineId, spriteId] = ids;
  const twips = (polygons) =>
    polygons.map((points) => points.map(([x, y]) => [x * TWIPS, y * TWIPS]));
  const [red, green, blue] = hexToRgb(counter.clipColor);
  const shapes = [];
  const placements = [];
  if (counter.outline) {
    shapes.push(
      definePolygonsShape(
        outlineId,
        twips(ammoIconPolygons(AMMO_ICON.outline)),
        [0, 0, 0, 255],
      ),
    );
    placements.push(
      placeObject2({
        depth: 1,
        characterId: outlineId,
        matrix: IDENTITY_MATRIX,
      }),
    );
  }
  shapes.push(
    definePolygonsShape(fillId, twips(ammoIconPolygons(0)), [
      red,
      green,
      blue,
      255,
    ]),
  );
  placements.push(
    placeObject2({ depth: 2, characterId: fillId, matrix: IDENTITY_MATRIX }),
  );
  return { spriteId, tags: [...shapes, defineSprite(spriteId, placements)] };
}

/* Дуг на угол подложки: при скруглении до 16 точек (24 px на 1080p) ломаной не видно. */
const PLATE_ARC_STEPS = 8;
/* Ширина середины рисунка подложки (точки): её растягивает сетка масштабирования. */
const PLATE_BASE_MIDDLE = 24;

/**
 * Контур скруглённого прямоугольника: `[[x, y]…]` по часовой, левый край — в
 * `left`, верх — в `top`; `radius` не больше половины меньшей стороны.
 */
export function roundedRectPolygon(
  left,
  top,
  width,
  height,
  radius,
  steps = PLATE_ARC_STEPS,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const right = left + width;
  const bottom = top + height;
  if (r === 0)
    return [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ];
  const corner = (cx, cy, from) =>
    Array.from({ length: steps + 1 }, (_, step) => {
      const angle = from + (step / steps) * (Math.PI / 2);
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    });
  return [
    ...corner(right - r, top + r, -Math.PI / 2),
    ...corner(right - r, bottom - r, 0),
    ...corner(left + r, bottom - r, Math.PI / 2),
    ...corner(left + r, top + r, Math.PI),
  ];
}

/*
 * Подложка: один скруглённый прямоугольник цвета и прозрачности работы в
 * клипе, ширину которого строка раскладки задаёт по цифрам; сетка
 * масштабирования держит углы. Нарисована от левого края (`x = 0`),
 * середина по высоте — в нуле, как у строки.
 */
function plateDefinitions(ids, counter) {
  if (!counter.plate) return null;
  const [shapeId, spriteId] = ids;
  const { top, height, radius } = ammoPlateGeometry(counter);
  const width = 2 * radius + PLATE_BASE_MIDDLE;
  const twips = (value) => Math.round(value * TWIPS);
  const polygon = roundedRectPolygon(0, top, width, height, radius).map(
    ([x, y]) => [twips(x), twips(y)],
  );
  const [red, green, blue] = hexToRgb(counter.plateColor);
  const alpha = Math.round((counter.plateOpacity / 100) * 255);
  const tags = [
    definePolygonsShape(shapeId, [polygon], [red, green, blue, alpha]),
    defineSprite(spriteId, [
      placeObject2({ depth: 1, characterId: shapeId, matrix: IDENTITY_MATRIX }),
    ]),
  ];
  /* Без скругления сетка не нужна: прямоугольник растягивается как есть. */
  if (radius > 0)
    tags.push(
      defineScalingGrid(spriteId, {
        xmin: twips(radius),
        xmax: twips(width - radius),
        ymin: twips(top + radius),
        ymax: twips(top + height - radius),
      }),
    );
  return { spriteId, tags };
}

const isPlacementTag = (tag) =>
  tag.code === SWF_TAG.PLACE_OBJECT2 || tag.code === SWF_TAG.PLACE_OBJECT3;

/*
 * Клип блока (`CONTENT` экспорта HUD_WEAPON_ICON) со значком и подложкой.
 * Значок — над всеми полями; подложка — под ними: она встаёт на нижнюю глубину
 * (в игре там невидимый `clipCounterStroke`), а он уходит наверх.
 */
function contentWithAstral(
  buffer,
  index,
  { iconSprite = null, plateSprite = null },
) {
  const component = index.definitions.get(index.exports.get("HUD_WEAPON_ICON"));
  if (!component || component.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error("В hud.gfx нет клипа HUD_WEAPON_ICON.");
  const content = parseSwfTags(
    buffer,
    component.payloadStart + 4,
    component.end,
  )
    .filter(isPlacementTag)
    .map((tag) => readPlacement(buffer, tag))
    .filter((placement) => placement?.name === "CONTENT");
  if (content.length !== 1)
    throw new Error("В hud.gfx у блока оружия нет одного клипа CONTENT.");
  const tag = index.definitions.get(content[0].characterId);
  if (!tag || tag.code !== SWF_TAG.DEFINE_SPRITE)
    throw new Error("В hud.gfx клип CONTENT блока оружия — не спрайт.");
  const inner = parseSwfTags(buffer, tag.payloadStart + 4, tag.end);
  const placed = inner
    .filter(isPlacementTag)
    .map((item) => ({ item, placement: readPlacement(buffer, item) }))
    .filter((entry) => entry.placement);
  const placements = placed.map((entry) => entry.placement);
  if (placements.some((placement) => placement.name === HUD_AMMO_ICON))
    throw new Error("В hud.gfx значок счётчика уже стоит.");
  if (placements.some((placement) => placement.name === HUD_AMMO_PLATE))
    throw new Error("В hud.gfx подложка счётчика уже стоит.");
  const top = Math.max(0, ...placements.map((placement) => placement.depth));
  const firstFrame = inner.findIndex(
    (item) => item.code === SWF_TAG.SHOW_FRAME,
  );
  if (firstFrame < 0) throw new Error("В hud.gfx у клипа CONTENT нет кадра.");
  /* Подложка: нижняя глубина — у штатного невидимого `clipCounterStroke`, он уходит наверх. */
  let moved = null;
  let plateDepth = 0;
  let iconDepth = top + 1;
  if (plateSprite !== null) {
    const lowest = placed.reduce((low, entry) =>
      entry.placement.depth < low.placement.depth ? entry : low,
    );
    if (lowest.placement.name !== "clipCounterStroke")
      throw new Error(
        "В hud.gfx под полями цифр не clipCounterStroke — подложке не найти места под ними.",
      );
    plateDepth = lowest.placement.depth;
    const bytes = Buffer.from(
      buffer.subarray(lowest.item.offset, lowest.item.end),
    );
    bytes.writeUInt16LE(
      top + 1,
      lowest.item.payloadStart -
        lowest.item.offset +
        (lowest.item.code === SWF_TAG.PLACE_OBJECT3 ? 2 : 1),
    );
    moved = { item: lowest.item, bytes };
    iconDepth = top + 2;
  }
  const raw = (item) =>
    moved && item === moved.item
      ? moved.bytes
      : buffer.subarray(item.offset, item.end);
  const added = [
    ...(plateSprite !== null
      ? [
          placeObject2({
            depth: plateDepth,
            characterId: plateSprite,
            matrix: IDENTITY_MATRIX,
            name: HUD_AMMO_PLATE,
          }),
        ]
      : []),
    ...(iconSprite !== null
      ? [
          placeObject2({
            depth: iconDepth,
            characterId: iconSprite,
            matrix: IDENTITY_MATRIX,
            name: HUD_AMMO_ICON,
          }),
        ]
      : []),
  ];
  const body = Buffer.concat([
    buffer.subarray(tag.payloadStart, tag.payloadStart + 4),
    ...inner.slice(0, firstFrame).map(raw),
    ...added,
    ...inner.slice(firstFrame).map(raw),
  ]);
  return { tag, replacement: swfTag(SWF_TAG.DEFINE_SPRITE, body) };
}

/* Цвета без приглушения: игра красит блок «белым HUD» (240) — счётчику
   нужен тот цвет, что выбран, — «чистым белым» (255). */
const HUD_WHITE = Object.freeze([[AVM1.PUSH, ["HUD_COLOUR_WHITE"]]]);

/*
 * Полоса заряда (электрошокер, таймер гранаты) у игры стоит у правого края
 * блока шириной 256 точек; у счётчика — под строкой, по выравниванию точки.
 * Полоса повёрнута: занимает 80 точек влево от своего места.
 */
const PROGRESS_BAR_WIDTH = 80;
const PROGRESS_BAR_BELOW = 14;

/**
 * Числа блока оружия, что уходят в hud.gfx: место у `BaseContainer.SET_COMPONENT_VALUES` (выравнивание «I» — доля
 * экрана без безопасной зоны, выход из списка) и масштаб `CONTENT` в процентах. Одно место на сборку и на журнал
 * сверки с игрой (ТЗ H1, 14.11.2026): запись называет ровно те числа, что поставлены в файл.
 */
export function hudAmmoFileValues(rawCounter) {
  const counter = normalizeAmmoCounter(rawCounter);
  return Object.freeze({
    componentId: HUD_WEAPON_ICON_ID,
    alignX: "I",
    alignY: "I",
    posX: counter.x,
    posY: counter.y,
    listId: -1,
    listPriority: -1,
    xscale: counter.size,
    yscale: counter.size,
  });
}

function readySteps(c, counter) {
  const barX = PROGRESS_BAR_WIDTH * (1 - ammoAlignShift(counter.align));
  const values = hudAmmoFileValues(counter);
  return [
    ...c.set(["CONTENT", "_xscale"], c.literal(values.xscale)),
    ...c.set(["CONTENT", "_yscale"], c.literal(values.yscale)),
    ...c.set(["ammoText", "html"], c.literal(true)),
    ...c.set(["ammoStrokeTF", "html"], c.literal(true)),
    ...c.set(["clipCountText", "_visible"], c.literal(false)),
    ...c.set(["clipCountStrokeTF", "_visible"], c.literal(false)),
    ...c.set(["ammoStrokeTF", "_visible"], c.literal(counter.outline)),
    ...c.set(["ammoIcon", "_visible"], c.literal(false)),
    ...(counter.icon !== "none"
      ? c.set([...ICON, "_visible"], c.literal(false))
      : []),
    ...(counter.plate ? c.set([...PLATE, "_visible"], c.literal(false)) : []),
    ...c.set(["WEAPON_ICONS", "ProgressBarMC", "_x"], c.literal(barX)),
    ...c.set(
      ["WEAPON_ICONS", "ProgressBarMC", "_y"],
      c.literal(PROGRESS_BAR_BELOW),
    ),
    ...c.set([HUD_AMMO_MARKER], c.literal(true)),
  ];
}

/* «Пока в руках ствол»: показаться и не запускать гашение. */
function stayOnScreenSteps(c) {
  return [
    ...c.call([], "setAsActive"),
    ...c.set(["CONTENT", "_alpha"], c.literal(100)),
    ...c.set(["isAnimating"], c.literal(false)),
    c.push(undefined),
    c.op(OP.RETURN),
  ];
}

/* Регистр параметра метода по имени — из заголовка DefineFunction2. */
export function parameterRegisters(buffer, program, method) {
  const header = program.records.find(
    (record) =>
      record.end === method.start && record.code === AVM1.DEFINE_FUNCTION2,
  );
  if (!header)
    throw new Error(`В hud.gfx у метода ${method.name} нет заголовка.`);
  let offset = header.bodyStart;
  offset = buffer.indexOf(0, offset) + 1;
  const count = buffer.readUInt16LE(offset);
  offset += 5;
  const registers = {};
  for (let index = 0; index < count; index += 1) {
    const slot = buffer[offset];
    const end = buffer.indexOf(0, offset + 1);
    registers[buffer.toString("latin1", offset + 1, end)] = slot;
    offset = end + 1;
  }
  return registers;
}

function storeRegister(c, slot, value) {
  return [
    ...value,
    action(AVM1.STORE_REGISTER, Buffer.from([slot])),
    c.op(AVM1.POP),
  ];
}

/* Место и выход из списка блока 2 — до того, как контейнер их запомнит. */
function componentValuesSteps(c, registers, counter) {
  const need = [
    "componentID",
    "alignX",
    "alignY",
    "posX",
    "posY",
    "listId",
    "listPriority",
  ];
  for (const name of need)
    if (!Number.isInteger(registers[name]))
      throw new Error(
        `В hud.gfx у SET_COMPONENT_VALUES нет параметра ${name} в регистре.`,
      );
  const values = hudAmmoFileValues(counter);
  return c.ifEqual(
    [c.push(register(registers.componentID))],
    [c.push(values.componentId)],
    [
      ...storeRegister(c, registers.alignX, [c.push(values.alignX)]),
      ...storeRegister(c, registers.alignY, [c.push(values.alignY)]),
      ...storeRegister(c, registers.posX, [c.push(values.posX)]),
      ...storeRegister(c, registers.posY, [c.push(values.posY)]),
      ...storeRegister(c, registers.listId, [c.push(values.listId)]),
      ...storeRegister(c, registers.listPriority, [
        c.push(values.listPriority),
      ]),
    ],
  );
}

/* «Поверх скрытия»: HIDE(2) не прячет блок. */
function hideSteps(c, registers) {
  if (!Number.isInteger(registers.componentID))
    throw new Error(
      "В hud.gfx у NEW_HUD.HIDE нет параметра componentID в регистре.",
    );
  return c.ifEqual(
    [c.push(register(registers.componentID))],
    [c.push(HUD_WEAPON_ICON_ID)],
    [c.push(undefined), c.op(OP.RETURN)],
  );
}

const AMMO_ICON_CALL = Object.freeze([
  [AVM1.PUSH, [register(2), 3]],
  AVM1.GET_MEMBER,
  [AVM1.PUSH, [1, register(1), "setAmmoIcon"]],
  AVM1.CALL_METHOD,
  AVM1.POP,
]);

function rewriteClass(buffer, found, edits) {
  const { tag, program } = found;
  assertActionStream(buffer, program.start, program.end);
  const stream = rewriteActions(buffer, program.start, program.end, edits, {
    internalBranches: true,
  });
  assertActionStream(stream);
  return swfTag(
    SWF_TAG.DO_INIT_ACTION,
    Buffer.concat([
      buffer.subarray(tag.payloadStart, tag.payloadStart + 2),
      stream,
    ]),
  );
}

/**
 * hud.gfx со счётчиком. `rawCounter` — настройки из `@modovik/reticle-contract`
 * (`normalizeAmmoCounter`); выключенный счётчик собирается так же — проверка
 * базы проходит через все места при любых настройках.
 */
export function compileHudAmmoGfx(baseBuffer, rawCounter) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base hud.gfx must be a Buffer.");
  const buffer = uncompressedScaleform(baseBuffer);
  const counter = normalizeAmmoCounter(rawCounter);
  const headerLength = scaleformHeaderLength(buffer);
  const tags = parseSwfTags(buffer, headerLength);
  if (hudHasAstralAmmo(buffer))
    throw new Error(
      "В hud.gfx уже стоит счётчик патронов Astral — база должна быть файлом игры.",
    );
  if (hudHasAstralReload(buffer))
    throw new Error(
      "В hud.gfx уже стоит перехват перезарядки Astral — база должна быть файлом игры.",
    );

  const container = classTag(buffer, tags, "BaseContainer", [
    "SET_COMPONENT_VALUES",
    "SET_COMPONENT_POSITION",
  ]);
  const hud = classTag(buffer, tags, "NEW_HUD", [
    "SET_WEAPON_WHEEL_ACTIVE",
    "reorderList",
    "HIDE",
  ]);
  const icon = classTag(buffer, tags, "HUD_WEAPON_ICON", [
    "SET_WEAPONS_AND_AMMO_FOREVER",
    "SET_AMMO_COUNT",
    "setAmmoIcon",
    "STAY_ON_SCREEN",
    "READY",
  ]);

  /* Номер блока оружия у игры — 2 (`HudComponentConstants`). */
  const constants = tags.filter((tag) => {
    if (tag.code !== SWF_TAG.DO_INIT_ACTION || tag.length < 2) return false;
    const program = programOf(buffer, tag);
    return Boolean(
      program &&
      findPattern(program, [
        [AVM1.PUSH, [register(1), "HUD_WEAPON_ICON", HUD_WEAPON_ICON_ID]],
        AVM1.SET_MEMBER,
      ]).length === 1,
    );
  });
  if (constants.length !== 1)
    throw new Error(
      "В hud.gfx номер блока оружия HUD_WEAPON_ICON — не 2 или найден не один раз.",
    );

  const values = methodOf(
    container.program,
    "SET_COMPONENT_VALUES",
    "BaseContainer",
  );
  const hide = methodOf(hud.program, "HIDE", "NEW_HUD");
  const ready = methodOf(icon.program, "READY", "HUD_WEAPON_ICON");
  const stay = methodOf(icon.program, "STAY_ON_SCREEN", "HUD_WEAPON_ICON");
  const ammo = methodOf(icon.program, "SET_AMMO_COUNT", "HUD_WEAPON_ICON");
  const iconCalls = findPattern(icon.program, AMMO_ICON_CALL, {
    from: ammo.start,
    to: ammo.end,
  });
  if (iconCalls.length !== 1)
    throw new Error(
      `В hud.gfx место «значок патронов после цифр» найдено ${iconCalls.length} раз, ожидался один.`,
    );
  const iconPop =
    icon.program.records[iconCalls[0] + AMMO_ICON_CALL.length - 1];
  const hiddenIcons = findPattern(icon.program, AMMO_ICON_HIDDEN, {
    from: ammo.start,
    to: ammo.end,
  });
  if (hiddenIcons.length !== 2)
    throw new Error(
      `В hud.gfx место «игра гасит цифры» найдено ${hiddenIcons.length} раз, ожидалось два.`,
    );
  const grenade = methodOf(
    icon.program,
    "setAmmoStateForGrenade",
    "HUD_WEAPON_ICON",
  );
  const whites = findPattern(icon.program, HUD_WHITE, {
    from: grenade.start,
    to: grenade.end,
  });
  if (whites.length !== 1)
    throw new Error(
      `В hud.gfx место «белый HUD блока оружия» найдено ${whites.length} раз, ожидался один.`,
    );
  const index = indexSwf(buffer);
  const ids = allocateCharacterIds(index, 5);
  const iconTags = iconDefinitions(ids.slice(0, 3), counter);
  const plateTags = plateDefinitions(ids.slice(3, 5), counter);
  const content =
    iconTags || plateTags
      ? contentWithAstral(buffer, index, {
          iconSprite: iconTags?.spriteId ?? null,
          plateSprite: plateTags?.spriteId ?? null,
        })
      : null;

  const containerCode = coder(container.program.pool);
  const hudCode = coder(hud.program.pool);
  const iconCode = coder(icon.program.pool);

  const containerEdits = [
    prologueEdit(
      buffer,
      container.program,
      values,
      componentValuesSteps(
        containerCode,
        parameterRegisters(buffer, container.program, values),
        counter,
      ),
    ),
  ];
  const hudEdits = counter.showOverHide
    ? [
        prologueEdit(
          buffer,
          hud.program,
          hide,
          hideSteps(hudCode, parameterRegisters(buffer, hud.program, hide)),
        ),
      ]
    : [];
  const iconEdits = [
    epilogueEdit(buffer, icon.program, ready, readySteps(iconCode, counter)),
    {
      start: iconPop.offset,
      end: iconPop.end,
      replacement: assembleActions([
        buffer.subarray(iconPop.offset, iconPop.end),
        ...counterTextSteps(iconCode, counter),
        ...counterLayoutSteps(iconCode, counter),
      ]),
    },
    ...(counter.visibility === "armed"
      ? [prologueEdit(buffer, icon.program, stay, stayOnScreenSteps(iconCode))]
      : []),
    {
      start: icon.program.records[whites[0]].offset,
      end: icon.program.records[whites[0]].end,
      replacement: pushAction(["HUD_COLOUR_PURE_WHITE"], icon.program.pool),
    },
    ...(counter.icon !== "none" || counter.plate
      ? hiddenIcons.map((at) => {
          const last = icon.program.records[at + AMMO_ICON_HIDDEN.length - 1];
          return {
            start: last.offset,
            end: last.end,
            replacement: assembleActions([
              buffer.subarray(last.offset, last.end),
              ...(counter.icon !== "none"
                ? iconCode.set([...ICON, "_visible"], iconCode.literal(false))
                : []),
              ...(counter.plate
                ? iconCode.set([...PLATE, "_visible"], iconCode.literal(false))
                : []),
            ]),
          };
        })
      : []),
  ];

  /* По смещению тега: оглавление (`indexSwf`) разбирает файл своими тегами. */
  const replaced = new Map([
    [container.tag.offset, rewriteClass(buffer, container, containerEdits)],
    [icon.tag.offset, rewriteClass(buffer, icon, iconEdits)],
    ...(hudEdits.length
      ? [[hud.tag.offset, rewriteClass(buffer, hud, hudEdits)]]
      : []),
    /* Значок — до клипа, в который он встал: определение раньше применения. */
    ...(content
      ? [
          [
            content.tag.offset,
            Buffer.concat([
              ...(iconTags?.tags || []),
              ...(plateTags?.tags || []),
              content.replacement,
            ]),
          ],
        ]
      : []),
  ]);
  const output = [buffer.subarray(0, headerLength)];
  for (const tag of tags)
    output.push(
      replaced.get(tag.offset) || buffer.subarray(tag.offset, tag.end),
    );
  if (content && !tags.some((tag) => tag.offset === content.tag.offset))
    throw new Error(
      "В hud.gfx клип CONTENT блока оружия лежит не на верхнем уровне файла.",
    );
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return {
    buffer: compiled,
    counter,
    sha256: sha256(compiled),
    file: hudAmmoFileValues(counter),
  };
}

/**
 * Годится ли файл в базу счётчика: та же сборка со всеми правками сразу.
 * Бросает с объяснением, чего не нашлось.
 */
export function verifyHudAmmoBase(gfxBuffer) {
  compileHudAmmoGfx(gfxBuffer, {
    enabled: true,
    visibility: "armed",
    showOverHide: true,
  });
  return { gfxSha256: sha256(gfxBuffer) };
}

/* ------------------- индикатор перезарядки прицела ------------------- */

/*
 * Перехват для индикатора перезарядки (`reticle-reload-gfx.js`, владелец
 * 14.11.2026). Слова «перезарядка» игра HUD не шлёт, но числа патронов идут
 * блоку оружия через диспетчер контейнера: `CONTAINER_METHOD(2,
 * "SET_AMMO_COUNT", запас, в обойме, размер, тип)` и `CONTAINER_METHOD(2,
 * "SET_PLAYER_WEAPON", хеш, …)`. Диспетчер получает их при любом состоянии
 * блока — и когда сервер его прячет (тогда вызов копится в очереди или
 * пропадает), — поэтому перехват стоит первым действием диспетчера, а не в
 * самом блоке. Числа уходят классу прицела через общий для фильмов HUD
 * `_global.astralReloadHud`; нет прицела Astral — перехват молчит. Блок
 * оружия при этом не меняется: штатный счётчик игры остаётся каким был.
 */

/** Имя в `_global`, через которое hud.gfx говорит с прицелом; оно же метка перехвата. */
export const HUD_RELOAD_MARKER = "astralReloadHud";

/** Стоит ли в этом hud.gfx перехват индикатора перезарядки Astral. */
export function hudHasAstralReload(gfxBuffer) {
  const buffer = uncompressedScaleform(gfxBuffer);
  const tags = parseSwfTags(buffer, scaleformHeaderLength(buffer));
  for (const tag of tags) {
    if (tag.code !== SWF_TAG.DO_INIT_ACTION || tag.length < 2) continue;
    const program = programOf(buffer, tag);
    if (!program?.pool.includes("CONTAINER_METHOD")) continue;
    for (const record of program.records)
      if (
        record.code === AVM1.PUSH &&
        program.pushValues(record).includes(HUD_RELOAD_MARKER)
      )
        return true;
  }
  return false;
}

/* Регистр `arguments` метода — из флагов DefineFunction2 (порядок: this, arguments). */
function argumentsRegister(buffer, program, method) {
  const header = program.records.find(
    (record) =>
      record.end === method.start && record.code === AVM1.DEFINE_FUNCTION2,
  );
  if (!header)
    throw new Error(`В hud.gfx у метода ${method.name} нет заголовка.`);
  const offset = buffer.indexOf(0, header.bodyStart) + 1;
  const flags = buffer.readUInt16LE(offset + 3);
  if (!(flags & 0x04))
    throw new Error(
      `В hud.gfx диспетчер ${method.name} не держит arguments в регистре — устроен не как у игры.`,
    );
  return flags & 0x01 ? 2 : 1;
}

function reloadHookSteps(c, args) {
  const skip = c.label("reload-skip");
  const argument = (index) => [
    c.push(register(args), index),
    c.op(AVM1.GET_MEMBER),
  ];
  const hud = () => [
    c.push("_global"),
    c.op(AVM1.GET_VARIABLE),
    c.push(HUD_RELOAD_MARKER),
    c.op(AVM1.GET_MEMBER),
  ];
  const call = (method, values) => [
    ...[...values].reverse().flat(),
    c.push(values.length),
    ...hud(),
    c.push(method),
    c.op(AVM1.CALL_METHOD),
    c.op(AVM1.POP),
  ];
  return [
    ...argument(0),
    c.push(HUD_WEAPON_ICON_ID),
    c.op(OP.EQUALS2),
    c.op(AVM1.NOT),
    { branch: AVM1.IF, to: skip },
    ...hud(),
    c.push(undefined),
    c.op(OP.EQUALS2),
    { branch: AVM1.IF, to: skip },
    ...c.ifEqual(
      argument(1),
      [c.push("SET_AMMO_COUNT")],
      call("astralReloadAmmo", [argument(2), argument(3), argument(4)]),
    ),
    ...c.ifEqual(
      argument(1),
      [c.push("SET_PLAYER_WEAPON")],
      call("astralReloadWeapon", [argument(2)]),
    ),
    { label: skip },
  ];
}

/**
 * hud.gfx с перехватом для индикатора перезарядки. База — файл игры или уже
 * собранный счётчиком патронов (`compileHudAmmoGfx`): перехват ложится поверх.
 */
export function compileHudReloadGfx(baseBuffer) {
  if (!Buffer.isBuffer(baseBuffer))
    throw new TypeError("Base hud.gfx must be a Buffer.");
  const buffer = uncompressedScaleform(baseBuffer);
  const headerLength = scaleformHeaderLength(buffer);
  const tags = parseSwfTags(buffer, headerLength);
  if (hudHasAstralReload(buffer))
    throw new Error(
      "В hud.gfx уже стоит перехват перезарядки Astral — база должна быть файлом игры.",
    );
  const container = classTag(buffer, tags, "BaseContainer", [
    "SET_COMPONENT_VALUES",
    "SET_COMPONENT_POSITION",
  ]);
  const dispatcher = methodOf(
    container.program,
    "CONTAINER_METHOD",
    "BaseContainer",
  );
  const steps = reloadHookSteps(
    coder(container.program.pool),
    argumentsRegister(buffer, container.program, dispatcher),
  );
  const replacement = rewriteClass(buffer, container, [
    prologueEdit(buffer, container.program, dispatcher, steps),
  ]);
  const output = [buffer.subarray(0, headerLength)];
  for (const tag of tags)
    output.push(
      tag === container.tag
        ? replacement
        : buffer.subarray(tag.offset, tag.end),
    );
  const compiled = Buffer.concat(output);
  compiled.writeUInt32LE(compiled.length, 4);
  return { buffer: compiled, sha256: sha256(compiled) };
}
