/*
 * Полоска HP над игроком — отдельный редактор мастерской «Полоска HP»
 * (задача 2 ТЗ 11.10.2026: утром — инструмент прицела, днём владелец
 * вынес её в свой редактор). Одно описание на редактор, кадр и компилятор
 * `mp_gamer_info.gfx`.
 *
 * ЧТО ЭТО В ИГРЕ. Имя игрока, значки и полоску HP над головой рисует метка
 * игрока GTA (gamer tag, натив `CREATE_MP_GAMER_TAG`, как в GTA Online) —
 * фильм `mp_gamer_info.gfx` в update.rpf (scaleform_generic.rpf). Каждая
 * метка — экземпляр символа `MP_GAMER_INFO`; полоска — его компонент 2
 * `healthArmour` с двумя видами: `HealthArmour` (HP и броня рядом, 55×5
 * точек) и `HealthNoArmour` (одно HP, 28×5). Кода у полоски в фильме нет:
 * длину (`healthBar`, `armourBar`), вид, видимость и прозрачность ставит
 * сама игра (имена найдены в GTA5.exe рядом с `mp_gamer_info`), а когда
 * полоску показать — решает скрипт (`SET_MP_GAMER_TAG_VISIBILITY`/`_ALPHA`
 * компонента 2; в GTA Online — при наведении).
 *
 * КАКАЯ ОНА В ИГРЕ. Полосы HP и её «пустой части» в файле — одна белая
 * фигура (255, 255, 255), полоса брони — #2F5C73, рамка видов — чёрная.
 * Красить HP игра начинает, только если скрипт позовёт
 * `SET_MP_GAMER_TAG_HEALTH_BAR_COLOUR`, — поэтому штатная полоска белая.
 * Значения по умолчанию здесь — ровно она.
 *
 * ЧТО ДЕЛАЕТ ASTRAL. Штатная полоска остаётся на месте и под своими
 * именами — игра пишет в неё как прежде, — но становится прозрачной. Рядом
 * встаёт своя полоска Astral: каждый кадр она читает длины полос игры и
 * рисует их своим видом — размер, толщина, цвета, раскладка, цифры, место
 * над головой. «Всегда» показывает её, даже когда скрипт полоску игры
 * прячет.
 *
 * ЦИФРЫ — доля полосы, как её шлёт игра: 0…100 у HP и у брони. Настоящих
 * единиц здоровья в фильме нет. «Одна цифра» — их сумма (владелец,
 * 11.10.2026, вечер: «если у него и броник и фул хп, то там было бы 200»):
 * полное HP и полная броня — 200, без брони — до 100.
 *
 * ЕДИНИЦЫ — точки метки (координаты `MP_GAMER_INFO`, 20 твипов): имя
 * игрока — кегль 18, штатная полоска — 5 точек высотой. На экране игра
 * уменьшает всю метку с расстоянием, поэтому пикселей тут нет.
 */

import { AMMO_FONTS } from "./ammo.js";

/**
 * Штатная полоска в точках метки — снята с mp_gamer_info.gfx Steam Legacy:
 * компонент `healthArmour` стоит в MP_GAMER_INFO на (−560, −460) твипов;
 * вид с бронёй (`HealthArmour`) — рамка 55×5 от его начала, HP с x 1, броня
 * с x 28, части 26×3; вид без брони (`HealthNoArmour`) сдвинут на 290
 * твипов — рамка 28×5, HP с x 15,5.
 */
export const TARGET_HP_STOCK_BAR = Object.freeze({
  x: -28,
  top: -23,
  wide: 55,
  plainX: 14.5,
  narrow: 28,
  segment: 26,
  inset: 1,
  thickness: 3,
});

/** Середина вида с бронёй от начала `healthArmour`: вокруг неё полоска растёт. */
export const TARGET_HP_ANCHOR = TARGET_HP_STOCK_BAR.wide / 2;
/** Зазор между полосами HP и брони в раскладке «Друг под другом». */
export const TARGET_HP_STACK_GAP = 1;

/** Кегль цифр вида «Цифры» при 100 % — чуть больше половины имени (18). */
export const TARGET_HP_DIGITS_SIZE = 10;
/** Кегль «Одной цифры»: число одно и стоит вместо полоски — крупнее. */
export const TARGET_HP_TOTAL_SIZE = 14;
/** Шаг строк вида «Цифры» друг под другом. */
export const TARGET_HP_DIGITS_LINE = 12;
/** Меньше этой толщины цифры в полоску не влезают. */
export const TARGET_HP_DIGITS_MIN_THICKNESS = 8;
/** Высота заглавных цифр в полоске — доля её толщины. */
export const TARGET_HP_DIGITS_FILL = 0.72;
/** Промежуток между HP и бронёй в виде «Цифры» в строку. */
export const TARGET_HP_DIGITS_GAP = "  ";
/** Ширина поля цифр вида «Цифры». */
export const TARGET_HP_DIGITS_FIELD = 120;
/** Тень цифр: сдвиг вправо-вниз в точках метки. */
export const TARGET_HP_SHADOW = 1;

/**
 * Цвет тени цифр — противоположный по яркости: у светлых цифр тень чёрная,
 * у тёмных — белая. Цифры в полоске стоят то на заливке, то на пустой части,
 * и тень одного цвета с цифрами там бы их не выручила.
 */
export function targetHealthShadowColour(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? String(hex) : "#ffffff";
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.5 ? "#000000" : "#ffffff";
}
/**
 * «Пустая часть» полосы HP — тот же цвет, приглушённый. У игры это клип
 * `healthBarTrough` той же белой фигуры, прозрачность ему ставит она сама;
 * своя пустая часть повторяет его длину и видимость, а прозрачность — эта.
 */
export const TARGET_HP_TROUGH_ALPHA = 0.3;
/** Поле Flash: по 2 точки полей с каждой стороны текста. */
export const TARGET_HP_FIELD_GUTTER = 2;

export const TARGET_HP_VIEWS = Object.freeze([
  Object.freeze({ id: "bar", label: "Полоска", short: "полоска", note: "белая полоска HP и брони, как в игре" }),
  Object.freeze({ id: "digits", label: "Цифры HP и брони", short: "цифры", note: "два числа без полоски: 100 и 100" }),
  Object.freeze({ id: "total", label: "Одна цифра", short: "одна цифра", note: "HP + броня одним числом, до 200" }),
  Object.freeze({ id: "bar-digits", label: "Цифры в полоске", short: "цифры в полоске", note: "полоска, в каждой части — её цифры" }),
]);

export const TARGET_HP_VISIBILITY = Object.freeze([
  Object.freeze({ id: "game", label: "Как в игре", note: "видна, когда её показывает игра или сервер — например, при наведении" }),
  Object.freeze({ id: "always", label: "Всегда", note: "видна над каждым игроком, у которого есть метка игры" }),
]);

export const TARGET_HP_LAYOUTS = Object.freeze([
  Object.freeze({ id: "row", label: "Одна полоса", note: "как в игре: HP слева, броня справа" }),
  Object.freeze({ id: "stack", label: "Две полоски", note: "две полосы: HP сверху, броня под ней" }),
]);

/** Подпись после числа вида «Одна цифра»: «200 HP». */
export const TARGET_HP_UNIT = " HP";

/* Шрифты — те же шрифты игры, что у счётчика патронов. Узкий — тот, каким
   игра пишет имя игрока в метке. */
export const TARGET_HP_FONTS = AMMO_FONTS;

/** Пределы ползунков: у каждого — поле числом с теми же пределами. Размер — от 10 % (владелец, 16.11.2026), шаг 1: прежние значения остаются как были. */
export const TARGET_HP_LIMITS = Object.freeze({
  size: Object.freeze({ min: 10, max: 300, step: 1, unit: "%", label: "Размер" }),
  thickness: Object.freeze({ min: 2, max: 12, step: 1, unit: " пт", label: "Толщина" }),
  raise: Object.freeze({ min: -20, max: 40, step: 1, unit: " пт", label: "Выше или ниже" }),
  backOpacity: Object.freeze({ min: 0, max: 100, step: 5, unit: "%", label: "Плотность фона" }),
});

/*
 * По умолчанию — штатная полоска игры (владелец, 11.10.2026: «по
 * умолчанию как в GTA — белая»): полоска при наведении, HP белое, броня
 * #2F5C73 (HUD_COLOUR_BLUEDARK из файла), чёрная рамка, 100 %, толщина 3.
 * Шрифт, тень и цвет цифр нужны только видам с цифрами; цифры в полоске по
 * умолчанию чёрные с белой тенью — на белой заливке белые цифры не видны.
 */
export const TARGET_HP_DEFAULTS = Object.freeze({
  view: "bar",
  visibility: "game",
  layout: "row",
  armour: true,
  size: 100,
  thickness: TARGET_HP_STOCK_BAR.thickness,
  raise: 0,
  healthColor: "#ffffff",
  armourColor: "#2f5c73",
  backColor: "#000000",
  backOpacity: 100,
  textColor: "#000000",
  font: "condensed",
  shadow: true,
  unit: false,
});

/** «Как в игре» — то же, что по умолчанию: штатная полоска. */
export const TARGET_HP_STOCK = TARGET_HP_DEFAULTS;

const ids = (list) => new Set(list.map((item) => item.id));
const VIEW_IDS = ids(TARGET_HP_VIEWS);
const VISIBILITY_IDS = ids(TARGET_HP_VISIBILITY);
const LAYOUT_IDS = ids(TARGET_HP_LAYOUTS);
const FONT_IDS = ids(TARGET_HP_FONTS);
const HEX = /^#[0-9a-f]{6}$/i;

const pick = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
const bounded = (value, { min, max, step }, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const stepped = Math.round(number / step) * step;
  return Math.min(max, Math.max(min, Math.round(stepped * 100) / 100));
};
const colour = (value, fallback) =>
  HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback;
const round2 = (value) => Math.round(value * 100) / 100;

/** Полоска в границах договора; чужие поля отбрасываются. */
export function normalizeTargetHealth(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const base = TARGET_HP_DEFAULTS;
  return {
    view: pick(source.view, VIEW_IDS, base.view),
    visibility: pick(source.visibility, VISIBILITY_IDS, base.visibility),
    layout: pick(source.layout, LAYOUT_IDS, base.layout),
    armour: source.armour !== false,
    size: bounded(source.size, TARGET_HP_LIMITS.size, base.size),
    thickness: bounded(source.thickness, TARGET_HP_LIMITS.thickness, base.thickness),
    raise: bounded(source.raise, TARGET_HP_LIMITS.raise, base.raise),
    healthColor: colour(source.healthColor, base.healthColor),
    armourColor: colour(source.armourColor, base.armourColor),
    backColor: colour(source.backColor, base.backColor),
    backOpacity: bounded(source.backOpacity, TARGET_HP_LIMITS.backOpacity, base.backOpacity),
    textColor: colour(source.textColor, base.textColor),
    font: pick(source.font, FONT_IDS, base.font),
    shadow: source.shadow !== false,
    unit: source.unit === true,
  };
}

/** Шрифт цифр: запись из `TARGET_HP_FONTS`. */
export const targetHealthFont = (id) =>
  TARGET_HP_FONTS.find((item) => item.id === id) || TARGET_HP_FONTS.find((item) => item.id === "condensed");

/** Есть ли у вида полоса и цифры. */
export const targetHealthHasBar = (view) => view !== "digits" && view !== "total";
export const targetHealthHasDigits = (view) => view !== "bar";
/** Раскладка HP и брони есть у видов, где они порознь: у «Одной цифры» её нет. */
export const targetHealthHasLayout = (view) => view !== "total";

/* Поля, которые меняют облик при этом виде: шрифт, тень и цвет цифр у
   полоски без цифр не видны и «как в игре» не сбивают. */
function visibleFields(config) {
  const fields = ["view", "visibility", "armour", "size", "raise", "healthColor"];
  if (targetHealthHasLayout(config.view)) fields.push("layout", "armourColor");
  if (targetHealthHasBar(config.view)) fields.push("thickness", "backColor", "backOpacity");
  if (targetHealthHasDigits(config.view)) fields.push("font", "shadow");
  if (config.view === "bar-digits") fields.push("textColor");
  if (config.view === "total") fields.push("unit");
  return fields;
}

/** Совпадает ли вид со штатной полоской игры (кнопка «Как в игре» тогда неактивна). */
export function targetHealthIsStock(input) {
  const config = normalizeTargetHealth(input);
  return visibleFields(config).every((key) => config[key] === TARGET_HP_STOCK[key]);
}

/** Толщина полосы с учётом цифр внутри: им нужно место. */
export function targetHealthThickness(input) {
  const config = normalizeTargetHealth(input);
  return config.view === "bar-digits"
    ? Math.max(config.thickness, TARGET_HP_DIGITS_MIN_THICKNESS)
    : config.thickness;
}

/** Кегль цифр в точках метки (до размера всей полоски). */
export function targetHealthFontSize(input) {
  const config = normalizeTargetHealth(input);
  if (config.view === "total") return TARGET_HP_TOTAL_SIZE;
  if (config.view !== "bar-digits") return TARGET_HP_DIGITS_SIZE;
  const { metrics } = targetHealthFont(config.font);
  const cap = metrics.cap / metrics.nominal;
  return round2((targetHealthThickness(config) * TARGET_HP_DIGITS_FILL) / cap);
}

/**
 * Верх поля строки относительно середины цифр: середина заглавных — в
 * точке `centre` (поле 2 точки + подъём шрифта до линии строки).
 */
export function targetHealthFieldTop(input, centre) {
  const config = normalizeTargetHealth(input);
  const { metrics } = targetHealthFont(config.font);
  const scale = targetHealthFontSize(config) / metrics.nominal;
  return round2(centre - (TARGET_HP_FIELD_GUTTER + metrics.ascent * scale - (metrics.cap * scale) / 2));
}

const box = (x, y, width, height) => Object.freeze({ x, y, width, height });

/**
 * Где что лежит, в точках метки до размера. Начало — середина верха вида с
 * бронёй (`anchor` от начала `healthArmour`), ось y вниз. Два вида, как у
 * игры: `armoured` — когда игра показывает HP с бронёй, `plain` — одно HP.
 * У вида — рамки (`backs`, по одной на полосу) и части (`health`,
 * `armour`): заливка `fill` (нет у вида «Цифры») и поле цифр `field` (нет у
 * полоски без цифр). Вид «Цифры» в строку — одно поле `digits` на оба
 * числа, видов у него нет.
 *
 * Раскладки: «Рядом» — ровно штатная полоса (с бронёй 55×5, без — 28×5 со
 * сдвигом, как у игры); «Друг под другом» — две полосы во всю ширину вида с
 * бронёй, HP сверху. Броня выключена — `armoured` нет: полоска всегда
 * одним HP, какой бы вид ни показывала игра. «Одна цифра» — одно поле
 * `digits`, как у цифр в строку: в нём сумма HP и брони.
 *
 * `place` — где встаёт начало в MP_GAMER_INFO и масштаб у неподвижной метки;
 * в игре своя полоска каждый кадр идёт за `healthArmour` (`anchor`,
 * `raise`) — та же арифметика у кадра и у файла.
 */
export function targetHealthLayout(input) {
  const config = normalizeTargetHealth(input);
  const { segment, inset, wide, narrow, plainX, x: originX, top } = TARGET_HP_STOCK_BAR;
  const withBar = targetHealthHasBar(config.view);
  const thickness = targetHealthThickness(config);
  const height = thickness + inset * 2;
  const fontSize = targetHealthFontSize(config);
  const fieldHeight = round2(fontSize * 1.6 + TARGET_HP_FIELD_GUTTER * 2);
  const single = config.view === "total" || (config.view === "digits" && config.layout === "row");
  /* Часть полосы: заливка и, у «Цифр в полоске», поле её числа. */
  const barPart = (x, y, width) =>
    Object.freeze({
      fill: box(x, y + inset, width, thickness),
      field:
        config.view === "bar-digits"
          ? box(x - 2, targetHealthFieldTop(config, y + inset + thickness / 2), width + 4, fieldHeight)
          : null,
    });
  /* Строка вида «Цифры» друг под другом: HP — первая, броня — вторая. */
  const linePart = (line) =>
    Object.freeze({
      fill: null,
      field: box(
        -TARGET_HP_DIGITS_FIELD / 2,
        targetHealthFieldTop(config, TARGET_HP_DIGITS_SIZE / 2 + line * TARGET_HP_DIGITS_LINE),
        TARGET_HP_DIGITS_FIELD,
        fieldHeight,
      ),
    });
  const variant = (backs, health, armour = null) =>
    Object.freeze({ backs: Object.freeze(backs), health, ...(armour ? { armour } : {}) });

  let armoured = null;
  let plain = null;
  if (!withBar) {
    if (!single) {
      plain = variant([], linePart(0));
      if (config.armour) armoured = variant([], linePart(0), linePart(1));
    }
  } else if (config.layout === "stack") {
    const left = -wide / 2;
    const second = height + TARGET_HP_STACK_GAP;
    const inner = wide - inset * 2;
    plain = variant([box(left, 0, wide, height)], barPart(left + inset, 0, inner));
    if (config.armour)
      armoured = variant(
        [box(left, 0, wide, height), box(left, second, wide, height)],
        barPart(left + inset, 0, inner),
        barPart(left + inset, second, inner),
      );
  } else {
    const left = -TARGET_HP_ANCHOR;
    const plainLeft = plainX - TARGET_HP_ANCHOR;
    plain = variant([box(plainLeft, 0, narrow, height)], barPart(plainLeft + inset, 0, segment));
    if (config.armour)
      armoured = variant(
        [box(left, 0, wide, height)],
        barPart(left + inset, 0, segment),
        barPart(left + inset * 2 + segment, 0, segment),
      );
  }
  return Object.freeze({
    anchor: Object.freeze({ x: TARGET_HP_ANCHOR, y: 0 }),
    place: Object.freeze({ x: originX + TARGET_HP_ANCHOR, y: top - config.raise, scale: config.size / 100 }),
    raise: config.raise,
    thickness,
    fontSize,
    single,
    armoured,
    plain,
    digits: single
      ? box(
          -TARGET_HP_DIGITS_FIELD / 2,
          targetHealthFieldTop(config, fontSize / 2),
          TARGET_HP_DIGITS_FIELD,
          fieldHeight,
        )
      : null,
  });
}

/**
 * Куски строки вида «Цифры» в строку: `[{ text, role }]` — HP, и броня
 * через промежуток, если она есть. Числа — доли полос, как их шлёт игра.
 */
export function targetHealthDigits({ health = 0, armour = 0, armoured = false } = {}) {
  const round = (value) => String(Math.round(Math.min(100, Math.max(0, Number(value) || 0))));
  const parts = [{ text: round(health), role: "health" }];
  if (armoured) {
    parts.push({ text: TARGET_HP_DIGITS_GAP, role: "gap" });
    parts.push({ text: round(armour), role: "armour" });
  }
  return parts;
}

/**
 * Число вида «Одна цифра»: HP и броня вместе (до 200), без брони — одно HP.
 * Подпись «HP» — по желанию.
 */
export function targetHealthTotal({ health = 0, armour = 0, armoured = false } = {}, { unit = false } = {}) {
  const share = (value) => Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
  const total = share(health) + (armoured ? share(armour) : 0);
  return `${total}${unit ? TARGET_HP_UNIT : ""}`;
}

/** Полоска словами — для строки состояния и записи установки. */
export function describeTargetHealth(input) {
  const config = normalizeTargetHealth(input);
  if (targetHealthIsStock(config)) return "как в игре";
  const stacked = config.armour && config.layout === "stack" && targetHealthHasLayout(config.view);
  const parts = [
    stacked && config.view === "bar" ? "две полоски" : TARGET_HP_VIEWS.find((item) => item.id === config.view)?.short || "",
  ];
  if (!config.armour) parts.push("без брони");
  else if (stacked && config.view !== "bar") parts.push(targetHealthHasBar(config.view) ? "две полоски" : "друг под другом");
  if (config.visibility === "always") parts.push("всегда");
  if (config.size !== 100) parts.push(`${config.size} %`);
  return parts.join(" · ");
}

/* ---------------------------- работа редактора ---------------------------- */

export const TARGET_HP_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 80;

/**
 * Работа редактора «Полоска HP»: имя и полоска. Полоска лежит в работе
 * плоско — её поля и есть данные кода работы.
 */
export function normalizeTargetHpProject(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    schema: TARGET_HP_PROJECT_SCHEMA,
    name: String(source.name || "").trim().slice(0, NAME_LIMIT),
    ...normalizeTargetHealth(source),
  };
}

export const createTargetHpProject = (input = {}) => normalizeTargetHpProject(input);

export const serializeTargetHpProject = (project) => JSON.stringify(normalizeTargetHpProject(project));

export function parseTargetHpProject(value) {
  try {
    return normalizeTargetHpProject(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return createTargetHpProject();
  }
}

/** Отпечаток для «Применить»: только то, что уходит в игру (без имени). */
export const targetHpSignature = (project) => JSON.stringify(normalizeTargetHealth(project));

/**
 * Полоска из модуля прицела прежних работ (утро 11.10.2026 она жила в
 * `modules.crosshair.targetHealth`): включённая — данные для новой работы с
 * выбором человека, выключенная или её нет — `null`.
 */
export function targetHealthFromReticleModule(module) {
  const saved = module?.targetHealth;
  if (!saved || typeof saved !== "object" || saved.enabled !== true) return null;
  return normalizeTargetHealth(saved);
}
