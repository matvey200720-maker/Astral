/*
 * Настройки прицела: одно описание полей на редактор, проверку проекта и
 * компилятор.
 *
 * Поле описано один раз — тип, значение по умолчанию, границы, шаг и
 * подпись. Из этой таблицы берутся значения нового проекта, границы
 * ползунков, проверка проекта мастерской и зажим значений перед сборкой
 * `hud_reticle.gfx`. Раньше границы жили в трёх местах, и компилятор
 * однажды резал толщину, которую ползунок ещё разрешал.
 *
 * Размеры — в точках сцены прицела (1280×720, см. `stage.js`): на экране
 * 1920×1080 точка — полтора пикселя. Шаг полточки: тоньше игра рисует, но
 * ползунок тоньше не нужен.
 *
 * СТАРЫЕ ПРОЕКТЫ. Поля добавлялись, а проекты мастерской дополняются
 * значениями по умолчанию при загрузке, поэтому «поля нет» и «поле по
 * умолчанию» здесь не различить. Всё, что у старого проекта надо вывести из
 * прежних полей, выводит `upgradeLegacyReticle` — её зовёт загрузка проекта
 * до того, как проект дополнится, и компилятор для сырых настроек.
 */

const field = (key, type, fallback, extra = {}) =>
  Object.freeze({ key, type, default: fallback, ...extra });
const range = (key, fallback, min, max, step, unit, label) =>
  field(key, "range", fallback, { min, max, step, unit, label });
const toggle = (key, fallback, label) =>
  field(key, "toggle", fallback, { label });
const colour = (key, fallback, label) =>
  field(key, "color", fallback, { label });
const choice = (key, fallback, options, label) =>
  field(key, "select", fallback, { options: Object.freeze(options), label });

const ARM_FIELDS = (prefix = "arm") => [
  toggle(`${prefix}Top`, true, "Линия сверху"),
  toggle(`${prefix}Right`, true, "Линия справа"),
  toggle(`${prefix}Bottom`, true, "Линия снизу"),
  toggle(`${prefix}Left`, true, "Линия слева"),
];

const RING_FIELDS = (size, thickness, sizeMax) => [
  range("circleSize", size, 4, sizeMax, 1, " px", "Диаметр кольца"),
  range("ringThickness", thickness, 0.5, 10, 0.5, " px", "Толщина кольца"),
  range("ringSegments", 1, 1, 8, 1, "", "Части кольца"),
  range("ringGap", 30, 5, 80, 1, "°", "Промежуток между частями"),
  range("ringRotation", 45, -180, 180, 1, "°", "Поворот частей"),
];

export const DOT_SHAPES = Object.freeze([
  Object.freeze({ id: "circle", label: "Круг" }),
  Object.freeze({ id: "square", label: "Квадрат" }),
  Object.freeze({ id: "diamond", label: "Ромб" }),
]);

export const VISIBILITY_MODES = Object.freeze([
  Object.freeze({
    id: "game",
    label: "Как в GTA",
    description: "Игра сама показывает и гасит прицел",
  }),
  Object.freeze({
    id: "delayed",
    label: "Своя задержка",
    description: "Держит прицел ярким выбранное время",
  }),
  Object.freeze({
    id: "persistent",
    label: "Не затухает",
    description: "Прицел остаётся ярким, пока виден",
  }),
]);

export const TICK_STYLES = Object.freeze([
  Object.freeze({ id: "line", label: "Риски" }),
  Object.freeze({ id: "dot", label: "Точки" }),
]);

export const HOLDOVER_SHAPES = Object.freeze([
  Object.freeze({ id: "bar", label: "Черты" }),
  Object.freeze({ id: "chevron", label: "Шевроны" }),
]);

/** Обычный прицел: пистолеты, ПП, винтовки, дробовики, метательное. */
export const ORDINARY_RETICLE_FIELDS = Object.freeze([
  colour("color", "#f4fff4", "Основной цвет"),
  range("opacity", 100, 10, 100, 1, "%", "Непрозрачность"),
  toggle("targetColorEnabled", true, "Цвет на цели"),
  colour("targetColor", "#ff6b7d", "Цвет цели"),
  toggle("outlineEnabled", true, "Обводка"),
  range("outlineWidth", 2, 0, 6, 0.5, " px", "Толщина обводки"),
  colour("outlineColor", "#101419", "Цвет обводки"),
  range("outlineOpacity", 100, 10, 100, 1, "%", "Непрозрачность обводки"),
  toggle("linesEnabled", true, "Линии"),
  range("length", 14, 0, 40, 0.5, " px", "Длина линий"),
  range("thickness", 3, 0, 10, 0.5, " px", "Толщина линий"),
  range("gap", 7, 0, 30, 0.5, " px", "Отступ от центра"),
  ...ARM_FIELDS(),
  toggle("showCenterDot", true, "Точка"),
  range("dotSize", 3, 0, 16, 0.5, " px", "Размер точки"),
  choice(
    "dotShape",
    "circle",
    DOT_SHAPES.map(({ id, label }) => [id, label]),
    "Форма точки",
  ),
  toggle("ring", false, "Кольцо"),
  ...RING_FIELDS(28, 3, 120),
  toggle("bracketsEnabled", false, "Уголки"),
  range("bracketSize", 12, 3, 50, 0.5, " px", "Размер рамки"),
  range("bracketLength", 6, 1, 50, 0.5, " px", "Длина уголка"),
  range("bracketThickness", 2, 0.5, 8, 0.5, " px", "Толщина уголков"),
  toggle("chevronEnabled", false, "Шеврон"),
  range("chevronWidth", 9, 2, 40, 0.5, " px", "Ширина шеврона"),
  range("chevronHeight", 7, 2, 40, 0.5, " px", "Высота шеврона"),
  range("chevronThickness", 2, 0.5, 8, 0.5, " px", "Толщина шеврона"),
  range("chevronOffset", 0, -30, 30, 0.5, " px", "Сдвиг шеврона"),
  range("scale", 100, 10, 180, 1, "%", "Масштаб"),
  range("rotation", 0, -180, 180, 1, "°", "Поворот"),
  choice(
    "visibilityMode",
    "game",
    VISIBILITY_MODES.map(({ id, label }) => [id, label]),
    "Видимость",
  ),
  range("fadeDelaySeconds", 5, 1, 15, 1, " с", "Задержка затухания"),
  toggle("hitMarker", true, "Отметка попадания"),
]);

/** Снайперский прицел: большой и продвинутый прицел снайперских винтовок. */
export const SNIPER_RETICLE_FIELDS = Object.freeze([
  colour("reticle", "#d7ecff", "Цвет сетки"),
  range("opacity", 92, 10, 100, 1, "%", "Непрозрачность"),
  range("glowWidth", 1, 0, 6, 0.5, " px", "Обводка"),
  colour("glowColor", "#b9d7ff", "Цвет обводки"),
  range("glowOpacity", 40, 10, 100, 1, "%", "Непрозрачность обводки"),
  toggle("centerColorEnabled", false, "Свой цвет центра"),
  colour("centerColor", "#ff3b3b", "Цвет центра"),
  toggle("lensEnabled", true, "Чёрные края оптики"),
  toggle("linesEnabled", true, "Перекрестие"),
  ...ARM_FIELDS(),
  range("horizontalLength", 92, 5, 100, 1, "%", "Длина по горизонтали"),
  range("verticalLength", 92, 5, 100, 1, "%", "Длина по вертикали"),
  range("thickness", 2, 0.5, 8, 0.5, " px", "Толщина линий"),
  range("centerGap", 3, 0, 80, 0.5, " px", "Разрыв в центре"),
  toggle("postsEnabled", false, "Толстые края"),
  range("postThickness", 6, 1, 20, 0.5, " px", "Толщина краёв"),
  range("postStart", 60, 5, 95, 1, "%", "Начало краёв"),
  range("divisions", 8, 0, 20, 1, "", "Количество делений"),
  range("tickSize", 7, 1, 24, 0.5, " px", "Размер делений"),
  choice(
    "tickStyle",
    "line",
    TICK_STYLES.map(({ id, label }) => [id, label]),
    "Вид делений",
  ),
  range("dotSize", 2, 0, 16, 0.5, " px", "Центральная точка"),
  toggle("showCircle", false, "Кольцо"),
  ...RING_FIELDS(24, 2, 240),
  toggle("chevronEnabled", false, "Шеврон"),
  range("chevronWidth", 10, 2, 60, 0.5, " px", "Ширина шеврона"),
  range("chevronHeight", 8, 2, 60, 0.5, " px", "Высота шеврона"),
  range("chevronThickness", 2, 0.5, 8, 0.5, " px", "Толщина шеврона"),
  toggle("holdoverEnabled", false, "Шкала поправок"),
  range("holdoverCount", 3, 1, 8, 1, "", "Отметок в шкале"),
  range("holdoverSpacing", 14, 4, 60, 0.5, " px", "Шаг шкалы"),
  range("holdoverWidth", 8, 1, 60, 0.5, " px", "Ширина отметки"),
  range("holdoverGrowth", 0, -10, 10, 0.5, " px", "Прирост ширины"),
  choice(
    "holdoverShape",
    "bar",
    HOLDOVER_SHAPES.map(({ id, label }) => [id, label]),
    "Вид отметок",
  ),
  range("rotation", 0, -180, 180, 1, "°", "Поворот сетки"),
  toggle("hitMarker", true, "Отметка попадания"),
  toggle("zoomMarker", true, "Отметка кратности"),
]);

const defaultsOf = (fields) =>
  Object.freeze(
    Object.fromEntries(fields.map((item) => [item.key, item.default])),
  );

export const ORDINARY_RETICLE_DEFAULTS = defaultsOf(ORDINARY_RETICLE_FIELDS);
export const SNIPER_RETICLE_DEFAULTS = defaultsOf(SNIPER_RETICLE_FIELDS);

const FIELD_MAPS = {
  ordinary: new Map(ORDINARY_RETICLE_FIELDS.map((item) => [item.key, item])),
  sniper: new Map(SNIPER_RETICLE_FIELDS.map((item) => [item.key, item])),
};

/** Описание поля: `reticleField("ordinary", "gap")`. */
export const reticleField = (kind, key) => FIELD_MAPS[kind]?.get(key) || null;

const snapToStep = (value, { min, max, step }) => {
  const bounded = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return bounded;
  const snapped = min + Math.round((bounded - min) / step) * step;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(3));
};

function normalizeValue(item, value) {
  if (item.type === "range") {
    const number = Number(value);
    return snapToStep(Number.isFinite(number) ? number : item.default, item);
  }
  if (item.type === "toggle")
    return typeof value === "boolean" ? value : item.default;
  if (item.type === "color") {
    const text = String(value || "");
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : item.default;
  }
  if (item.type === "select")
    return item.options.some(([option]) => option === value)
      ? value
      : item.default;
  return value ?? item.default;
}

/**
 * Выводит новые поля старого проекта из прежних, пока проект не дополнен
 * значениями по умолчанию. Возвращает новый объект; своих полей не теряет.
 */
export function upgradeLegacyReticle(kind, input = {}) {
  const value = input && typeof input === "object" ? { ...input } : {};
  if (kind === "ordinary") {
    /* Кольцо прежде рисовалось толщиной линий, а «круг» и «кольцо» были
       формами. */
    if (value.ringThickness === undefined && value.thickness !== undefined)
      value.ringThickness = Math.max(0.5, Number(value.thickness) || 0);
    if (["circle", "ring"].includes(value.shape) && value.ring === undefined)
      value.ring = true;
    if (["always"].includes(value.visibilityMode))
      value.visibilityMode = "persistent";
    return value;
  }
  /* Снайперка: форма «крест / T / точка» стала сторонами и перекрестием,
     свечение 0…24 — обводкой в точках (прежде в игру уходила треть). */
  if (value.armTop === undefined && value.reticleShape !== undefined) {
    const shape = ["cross", "t", "dot"].includes(value.reticleShape)
      ? value.reticleShape
      : "cross";
    value.linesEnabled = shape !== "dot";
    value.armTop = shape === "cross";
  }
  if (value.ringThickness === undefined && value.thickness !== undefined)
    value.ringThickness = Math.max(0.5, Number(value.thickness) || 0);
  if (value.glowWidth === undefined && value.glow !== undefined) {
    const glow = Math.max(0, Number(value.glow) || 0);
    value.glowWidth = Math.round(Math.min(5, glow / 3) * 2) / 2;
  }
  return value;
}

/** Настройки прицела в границах полей; неизвестные поля отбрасываются. */
export function normalizeReticle(kind, input = {}) {
  const fields =
    kind === "sniper" ? SNIPER_RETICLE_FIELDS : ORDINARY_RETICLE_FIELDS;
  const source = upgradeLegacyReticle(kind, input);
  return Object.fromEntries(
    fields.map((item) => [item.key, normalizeValue(item, source[item.key])]),
  );
}

export const normalizeOrdinaryReticle = (input) =>
  normalizeReticle("ordinary", input);
export const normalizeSniperReticle = (input) =>
  normalizeReticle("sniper", input);
