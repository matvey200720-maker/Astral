/*
 * Контракт залазов.
 *
 * Залазы — метки паркура для RP-серверов: куда лезть, где встать, когда
 * прыгать, от какого лица забираться, где поставить машину. В моде это
 * десять моделей меток (`arrow`, `stay`, `jump`, `firstpov`, `thirdpov`,
 * `rightclick`, `car`, `teamneed`, `hit`, `q`), типы `climbs.ytyp` и
 * расстановка `climbs.ymap` — 1393 места по всей карте, уже развёрнутых как
 * надо (набор владельца 10.10.2026; прежний мод panika с пятью значками
 * снят — его работы открываются переводом, см. `migrateSecondVersion`).
 *
 * Что правит человек. Облик каждой из десяти меток: вид (метка мода, слова
 * своим шрифтом, значок или своя картинка — вписанная или кадрированная),
 * надписи и шрифт, цвет, обводку, ореол, размер, свечение ночью. Чего не
 * правит: места и направления — их задаёт расстановка, и тронуть их значило
 * бы сломать сами залазы.
 *
 * Как облик доезжает до игры. Метки мода выдавлены из контура геометрией, и
 * их белые текстуры 16×16 дают только цвет. Поэтому каждая модель
 * собирается заново — двусторонней плашкой на месте лица и спины метки, с
 * текстурой, в которой нарисована вся метка (`compile-climb-markers`
 * нативного хоста). Раскладку плашки и текстуры считает `climbMarkerLayout`
 * — один раз и для окна, и для сборки, чтобы кадр и игра не разошлись ни на
 * пиксель.
 *
 * Рисунки видов — в `./art.js`: описание модуля нужно всей мастерской, а
 * рисунки только редактору и обложке, и приезжать им лучше порознь.
 */

import { normalizeClimbColour } from "./colour.js";
import { CLIMB_MODELS, climbModelFrame } from "./models.js";

export {
  formatClimbColour,
  normalizeClimbColour,
  parseClimbColour,
} from "./colour.js";
export { CLIMB_FILE_ALIASES, CLIMB_MODELS, CLIMB_SET, climbModelFrame } from "./models.js";

export const CLIMB_MODULE_SCHEMA_VERSION = 3;
export const CLIMB_PRESET_SCHEMA = "astral-climb-preset/v3";
/* Пресеты прежнего набора из пяти меток — переводятся, а не отвергаются. */
const PREVIOUS_PRESET_SCHEMA = "astral-climb-preset/v2";

/**
 * Формат текстуры метки.
 *
 * DXT5, а не DXT1: у метки прозрачный фон и мягкий край ореола, и без
 * восьмибитной альфы край стал бы ступенькой. Все mip-уровни: одна и та же
 * метка висит и в упор, и через улицу.
 */
export const CLIMB_TEXTURE_FORMAT = "DXT5";

/** Сторона текстуры метки. У широких меток высота вдвое-вчетверо меньше. */
export const CLIMB_TEXTURE_SIZES = Object.freeze([256, 512, 1024]);

export const CLIMB_LIMITS = Object.freeze({
  labelLength: 12,
  keyLength: 10,
  scale: Object.freeze({ min: 50, max: 150 }),
  opacity: Object.freeze({ min: 20, max: 100 }),
  /* Своя картинка: увеличение поверх «вписать» или «заполнить» и сдвиг —
     доля свободного хода картинки в рамке. */
  zoom: Object.freeze({ min: 100, max: 400 }),
  offset: Object.freeze({ min: -100, max: 100 }),
});

/*
 * Плашка без толщины (щит `teamneed` — одна плоскость) всё равно
 * двусторонняя: лицо и спину разводят на два миллиметра, чтобы они не
 * спорили за одну глубину.
 */
const MIN_DEPTH = 0.002;

/* ------------------------------------------------------------------ *
 * Десять меток
 * ------------------------------------------------------------------ */

/**
 * Метки в том порядке, в каком их чаще ставит мод, — а «CLICK - Q», самая
 * широкая, последней: в кадре набора ей нужна длинная клетка.
 *
 * `aspect` — пропорция текстуры (лицевая грань модели вписана в неё);
 * `text` — слова метки мода: `label` — первая строка или надпись, `key` —
 * вторая строка или клавиша; `picture` — как ложится принесённая картинка по
 * умолчанию: щит под фотографию её заполняет, остальные метки — вписывают.
 * Места, ось, сторона, лицевая грань — из описи мода (`inventory.js`).
 */
const SLOTS = [
  {
    id: "arrow",
    label: "Стрелка",
    description: "Куда лезть: стрелка вверх на стене.",
    aspect: 1,
  },
  {
    id: "stay",
    label: "Встать здесь",
    description: "STAY HERE — где встать перед залазом.",
    aspect: 1,
    text: { label: "STAY", key: "HERE" },
  },
  {
    id: "jump",
    label: "Прыжок",
    description: "JUMP SPACE — прыгнуть отсюда пробелом.",
    aspect: 2,
    text: { label: "JUMP", key: "SPACE" },
  },
  {
    id: "firstpov",
    label: "1 лицо",
    description: "1 POV CLICK — залаз от первого лица.",
    aspect: 1,
    text: { label: "1 POV", key: "CLICK" },
  },
  {
    id: "thirdpov",
    label: "3 лицо",
    description: "3 POV CLICK — залаз от третьего лица.",
    aspect: 1,
    text: { label: "3 POV", key: "CLICK" },
  },
  {
    id: "rightclick",
    label: "Правая кнопка",
    description: "RIGHT CLICK — нажать правую кнопку мыши.",
    aspect: 1,
    text: { label: "RIGHT", key: "CLICK" },
  },
  {
    id: "car",
    label: "Машина",
    description: "STAY CAR — залаз с машины: поставить её здесь.",
    aspect: 1,
    text: { label: "STAY", key: "CAR" },
  },
  {
    id: "teamneed",
    label: "Напарник",
    description:
      "Щит под фотографию «нужен напарник». В моде он пустой — картинка на нём прозрачная.",
    aspect: 1,
    text: { label: "TEAM", key: "NEED" },
    picture: "cover",
  },
  {
    id: "hit",
    label: "Удар",
    description: "HIT HERE — ударить здесь.",
    aspect: 1,
    text: { label: "HIT", key: "HERE" },
  },
  {
    id: "q",
    label: "Клавиша Q",
    description: "CLICK - Q — нажать Q.",
    aspect: 4,
    text: { label: "CLICK", key: "Q" },
  },
];

export const CLIMB_SLOTS = Object.freeze(
  SLOTS.map((slot) => {
    const model = CLIMB_MODELS[slot.id];
    if (!model) throw new Error(`Метки «${slot.id}» нет в описи мода.`);
    const frame = climbModelFrame(slot.id, slot.aspect);
    return Object.freeze({
      ...slot,
      model: slot.id,
      text: slot.text ? Object.freeze(slot.text) : undefined,
      picture: slot.picture || "contain",
      placements: model.placements,
      blank: model.blank,
      /* Высота рамки метки в мире, метры: лицевая грань в обычном масштабе
         расстановки. По ней кадр «На стене» ставит метку того роста, что в
         игре. */
      worldHeight: Math.round(frame.height * model.scale * 1000) / 1000,
    });
  }),
);

export const CLIMB_SLOT_IDS = Object.freeze(CLIMB_SLOTS.map((slot) => slot.id));

export const findClimbSlot = (id) =>
  CLIMB_SLOTS.find((slot) => slot.id === id) || null;

/** Мест у меток редактора — сумма расстановки по десяти моделям. */
export const CLIMB_PLACEMENT_COUNT = CLIMB_SLOTS.reduce(
  (sum, slot) => sum + slot.placements,
  0,
);

/* ------------------------------------------------------------------ *
 * Виды
 * ------------------------------------------------------------------ */

const variant = (id, label, description, text = null) =>
  Object.freeze({ id, label, description, text });

const ORIGINAL = variant(
  "original",
  "Как в игре",
  "Та самая метка из мода — лицевая грань модели.",
);
const BLANK = variant(
  "original",
  "Как в игре",
  "В моде щит пустой: картинка на нём прозрачная, и в игре его не видно.",
);
const IMAGE = variant(
  "image",
  "Своя картинка",
  "Фото или рисунок: PNG, JPEG, WEBP или DDS — вписать в метку или кадрировать.",
);

/*
 * Виды со словами. `text` — какие слова есть у вида: `both` — надпись и
 * клавиша (или первая и вторая строка), `label` — только надпись, `key` —
 * значок и клавиша под ним.
 */
const LINES = variant(
  "lines",
  "Своим шрифтом",
  "Слова метки, как у мода, — своими словами и своим шрифтом.",
  "both",
);
const LABEL_KEY = variant(
  "label-key",
  "Надпись и клавиша",
  "Надпись и клавиша с искрами.",
  "both",
);
const BADGE = variant(
  "badge",
  "Табличка",
  "Надпись на плашке, под ней клавиша.",
  "both",
);
const LABEL = variant(
  "label",
  "Только надпись",
  "Крупная надпись без клавиши.",
  "label",
);
const KEY = variant(
  "key",
  "Клавиша с надписью",
  "Надпись прямо на клавише.",
  "label",
);

/* Знаки «встань сюда» — у «Встать здесь»; мишень и крест — и у «Удара». */
const TARGET = variant(
  "target",
  "Мишень",
  "Два кольца и точка — видно и сверху, и издалека.",
);
const CROSS = variant("cross", "Крест", "Жирный крест без кольца.");
const SPOT_SIGNS = [
  TARGET,
  variant(
    "crosshair",
    "Прицел",
    "Кольцо с рисками к центру: встать ровно в середину.",
  ),
  variant("footprints", "Следы", "Два следа: «встань сюда» без слов."),
  variant("dot", "Точка", "Сплошной круг в тонком кольце."),
  variant("diamond", "Ромб", "Контур ромба с ромбом внутри."),
  variant("star", "Звезда", "Пятиконечная звезда."),
  CROSS,
  variant("ring", "Кольцо", "Толстое кольцо без знака внутри."),
];

/**
 * Виды каждой метки.
 *
 * Стрелки нарисованы вверх, как стрелка мода: расстановка уже поставила её
 * на стену остриём туда, куда лезть.
 */
export const CLIMB_VARIANTS = Object.freeze({
  arrow: Object.freeze([
    ORIGINAL,
    variant("chevrons-2", "Два шеврона", "Две галки остриём вверх."),
    variant("chevron", "Шеврон", "Одна крупная галка."),
    variant("arrow", "Стрелка", "Древко и остриё."),
    variant(
      "block",
      "Широкая стрелка",
      "Толстая сплошная стрелка — читается издалека.",
    ),
    variant(
      "triangles",
      "Три стрелки",
      "Три сплошных треугольника друг над другом.",
    ),
    variant(
      "dashed",
      "Пунктир",
      "Пунктир к острию: путь, а не только сторона.",
    ),
    IMAGE,
  ]),
  stay: Object.freeze([ORIGINAL, LINES, BADGE, LABEL, ...SPOT_SIGNS, IMAGE]),
  jump: Object.freeze([ORIGINAL, LINES, LABEL_KEY, BADGE, LABEL, KEY, IMAGE]),
  firstpov: Object.freeze([
    ORIGINAL,
    LINES,
    LABEL_KEY,
    BADGE,
    LABEL,
    KEY,
    variant("icon", "Глаз", "Значок взгляда и клавиша под ним.", "key"),
    IMAGE,
  ]),
  thirdpov: Object.freeze([
    ORIGINAL,
    LINES,
    LABEL_KEY,
    BADGE,
    LABEL,
    KEY,
    variant(
      "icon",
      "Камера",
      "Значок камеры со стороны и клавиша под ним.",
      "key",
    ),
    IMAGE,
  ]),
  rightclick: Object.freeze([
    ORIGINAL,
    LINES,
    LABEL_KEY,
    BADGE,
    LABEL,
    variant("mouse", "Мышь", "Мышь с нажатой правой кнопкой."),
    IMAGE,
  ]),
  car: Object.freeze([
    ORIGINAL,
    LINES,
    BADGE,
    LABEL,
    variant("car", "Машина сбоку", "Силуэт машины: подъехать сюда."),
    variant("car-front", "Машина спереди", "Машина анфас с фарами."),
    variant("tire", "Колесо", "Шина с дисками."),
    variant("wheel", "Руль", "Кольцо руля и три спицы."),
    IMAGE,
  ]),
  teamneed: Object.freeze([
    BLANK,
    variant("duo", "Двое", "Два человека: «вдвоём залезем»."),
    LINES,
    BADGE,
    IMAGE,
  ]),
  hit: Object.freeze([ORIGINAL, LINES, BADGE, LABEL, TARGET, CROSS, IMAGE]),
  q: Object.freeze([ORIGINAL, LINES, LABEL_KEY, IMAGE]),
});

export const climbVariant = (slotId, variantId) =>
  (CLIMB_VARIANTS[slotId] || []).find((item) => item.id === variantId) || null;

/* ------------------------------------------------------------------ *
 * Шрифты
 * ------------------------------------------------------------------ */

/**
 * Шрифты надписей.
 *
 * Системные шрифты Windows с кириллицей: GTA V идёт только на Windows, и
 * текстура рисуется там же, где стоит игра. Своих начертаний Astral не
 * возит. Как шрифт называется в CSS, знает окно (`climb-fonts.js`); контракт
 * держит только выбор.
 */
export const CLIMB_FONTS = Object.freeze([
  Object.freeze({ id: "impact", label: "Impact" }),
  Object.freeze({ id: "bahnschrift", label: "Bahnschrift" }),
  Object.freeze({ id: "arial-black", label: "Arial Black" }),
  Object.freeze({ id: "segoe-black", label: "Segoe UI Black" }),
  Object.freeze({ id: "franklin", label: "Franklin Gothic" }),
  Object.freeze({ id: "consolas", label: "Consolas" }),
  Object.freeze({ id: "georgia", label: "Georgia" }),
  Object.freeze({ id: "comic", label: "Comic Sans" }),
  Object.freeze({ id: "ink", label: "Ink Free" }),
  Object.freeze({ id: "script", label: "Segoe Script" }),
]);

const FONT_IDS = CLIMB_FONTS.map((font) => font.id);

/*
 * Свой шрифт человека (ТЗ 23.10.2026, п. F): `font: "custom"` и ключ файла в хранилище окна. Самого файла в макете
 * нет — он лежит на этом компьютере, как у эмблем-надписей. Ключ остаётся в макете и когда выбран шрифт набора:
 * свой можно вернуть одним нажатием.
 */
export const CLIMB_FONT_CUSTOM = "custom";
const FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;

/** Шрифт надписей для рисунка меток: id шрифта набора или `custom:<ключ файла>`. */
export const climbFontKey = (style) =>
  style?.font === CLIMB_FONT_CUSTOM && FONT_ASSET.test(String(style.fontAsset || ""))
    ? `${CLIMB_FONT_CUSTOM}:${style.fontAsset}`
    : FONT_IDS.includes(style?.font)
      ? style.font
      : "impact";

const words = (label, key) =>
  Object.freeze({ label: Object.freeze(label), key: Object.freeze(key) });

/** Быстрые слова: то, что пишут на метках залазов. */
export const CLIMB_TEXT_SUGGESTIONS = Object.freeze({
  stay: words(["STAY", "СТОЙ", "ВСТАНЬ", "ЖДИ"], ["HERE", "ТУТ", "ЗДЕСЬ"]),
  jump: words(["JUMP", "ПРЫЖОК", "ПРЫГАЙ"], ["SPACE", "ПРОБЕЛ", "SHIFT"]),
  firstpov: words(
    ["1 POV", "1 ЛИЦО", "FPV", "1P"],
    ["CLICK", "PRESS", "SPACE", "ПРОБЕЛ"],
  ),
  thirdpov: words(
    ["3 POV", "3 ЛИЦО", "TPV", "3P"],
    ["CLICK", "PRESS", "SPACE", "ПРОБЕЛ"],
  ),
  rightclick: words(["RIGHT", "ПКМ", "ПРАВАЯ"], ["CLICK", "КНОПКА"]),
  car: words(["STAY", "МАШИНА", "CAR"], ["CAR", "ТУТ", "ЗДЕСЬ"]),
  teamneed: words(["TEAM", "НУЖЕН", "ВДВОЁМ"], ["NEED", "НАПАРНИК"]),
  hit: words(["HIT", "БЕЙ", "УДАР"], ["HERE", "ТУТ", "ЗДЕСЬ"]),
  q: words(["CLICK", "PRESS", "ЖМИ"], ["Q", "E", "F"]),
});

/* ------------------------------------------------------------------ *
 * Макет
 * ------------------------------------------------------------------ */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function number(value, { path, min, max, fallback }) {
  const numeric = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(numeric)
  ) {
    if (fallback === undefined) fail(path, "ожидалось число.");
    return fallback;
  }
  return clamp(Math.round(numeric), min, max);
}

function colour(value, path, fallback) {
  try {
    return normalizeClimbColour(value);
  } catch (error) {
    if (fallback === undefined) fail(path, error.message);
    return fallback;
  }
}

function text(value, fallback, maxLength = 80) {
  const string = typeof value === "string" ? value.trim() : "";
  if (!string || string.includes("\0")) return fallback;
  return string.slice(0, maxLength);
}

/*
 * Надпись метки. Управляющие символы и переводы строк выбрасываются: надпись
 * — одна строка на стене. Длина считается символами, а не половинками
 * суррогатных пар, иначе обрезка резала бы эмодзи пополам.
 */
const isControl = (character) => {
  const code = character.codePointAt(0);
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
};

function markerText(value, fallback, maxLength) {
  const string =
    typeof value === "string"
      ? Array.from(value, (character) =>
          isControl(character) ? " " : character,
        )
          .join("")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  if (!string) return fallback;
  return Array.from(string).slice(0, maxLength).join("");
}

const DEFAULT_STYLE = Object.freeze({
  fill: "#ffffff",
  fill2: "#9fdcff",
  gradient: false,
  outline: "#000000",
  outlineWidth: 12,
  glow: 0,
  opacity: 100,
  brightness: 50,
  scale: 100,
  font: "impact",
});

function defaultMarker(slot) {
  return {
    enabled: true,
    variant: "original",
    scale: 100,
    colors: null,
    image: null,
    ...(slot.text ? { label: slot.text.label, key: slot.text.key } : {}),
  };
}

/**
 * Заготовка: метки как в моде — белые надписи и стрелка с тёмным краем,
 * светятся ночью. С неё редактор открывается у всех, кто залазы ещё не
 * правил: первое, что видит человек, — те метки, что ставит мод.
 */
export function createDefaultClimbDesign(
  designId = "design:climbs:new",
  name = "Мои залазы",
) {
  return {
    designId: text(designId, "design:climbs:new", 120),
    name: text(name, "Мои залазы"),
    style: { ...DEFAULT_STYLE },
    markers: Object.fromEntries(
      CLIMB_SLOTS.map((slot) => [slot.id, defaultMarker(slot)]),
    ),
    texture: { size: 512 },
  };
}

/*
 * Своя картинка метки: файл проекта и как он ложится в рамку. `fit` —
 * «вписать» (`contain`, картинка целиком) или «заполнить» (`cover`, рамка
 * целиком, лишнее срезано); `zoom` — увеличение поверх этого; `x`/`y` —
 * где стоит картинка в своём свободном ходе: −100 — у левого (нижнего) края,
 * 100 — у правого (верхнего). Картинка прежних работ — вписанная, по центру.
 */
function normalizeImage(input) {
  if (!input || typeof input !== "object") return null;
  const assetId =
    typeof input.assetId === "string" && input.assetId.trim()
      ? input.assetId.trim().slice(0, 200)
      : null;
  if (!assetId) return null;
  const rotate = Number(input.rotate);
  return {
    assetId,
    tint: number(input.tint, {
      path: "image.tint",
      min: 0,
      max: 100,
      fallback: 0,
    }),
    rotate: [0, 90, 180, 270].includes(rotate) ? rotate : 0,
    keyOut: input.keyOut === true,
    fit: input.fit === "cover" ? "cover" : "contain",
    zoom: number(input.zoom, {
      path: "image.zoom",
      ...CLIMB_LIMITS.zoom,
      fallback: CLIMB_LIMITS.zoom.min,
    }),
    x: number(input.x, {
      path: "image.x",
      ...CLIMB_LIMITS.offset,
      fallback: 0,
    }),
    y: number(input.y, {
      path: "image.y",
      ...CLIMB_LIMITS.offset,
      fallback: 0,
    }),
  };
}

/*
 * Картинка, только что принесённая к метке. Подкраска, поворот, фон и
 * «вписать/заполнить» прежней картинки остаются, а кадр — увеличение и
 * сдвиг — начинается заново: у нового снимка своя композиция. Первая
 * картинка ложится так, как её обычно кладёт метка.
 */
export function climbImageFor(slotId, assetId, previous = null) {
  const slot = findClimbSlot(slotId);
  return normalizeImage({
    tint: 0,
    rotate: 0,
    keyOut: false,
    fit: slot?.picture || "contain",
    ...(previous || {}),
    zoom: CLIMB_LIMITS.zoom.min,
    x: 0,
    y: 0,
    assetId,
  });
}

/* Свой цвет без цвета — это «как у набора», а не отказ открыть проект. */
function normalizeMarkerColours(input) {
  if (!input || typeof input !== "object") return null;
  try {
    return {
      fill: normalizeClimbColour(input.fill),
      outline: normalizeClimbColour(input.outline),
    };
  } catch {
    return null;
  }
}

function normalizeMarker(slot, input, path) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = defaultMarker(slot);
  const image = normalizeImage(source.image);
  const known = climbVariant(slot.id, source.variant);
  /* «Своя картинка» без картинки — это метка мода: иначе метка перенесённого
     без файла проекта встала бы в игру пустой плашкой. */
  const variantId =
    known && (known.id !== "image" || image) ? known.id : defaults.variant;
  const marker = {
    enabled: source.enabled !== false,
    variant: variantId,
    scale: number(source.scale, {
      path: `${path}.scale`,
      ...CLIMB_LIMITS.scale,
      fallback: defaults.scale,
    }),
    colors: normalizeMarkerColours(source.colors),
    image,
  };
  if (slot.text) {
    marker.label = markerText(
      source.label,
      slot.text.label,
      CLIMB_LIMITS.labelLength,
    );
    marker.key = markerText(source.key, slot.text.key, CLIMB_LIMITS.keyLength);
  }
  return marker;
}

function normalizeStyle(input, path) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = DEFAULT_STYLE;
  const fontAsset = FONT_ASSET.test(String(source.fontAsset || "")) ? source.fontAsset : "";
  return {
    fill: colour(source.fill, `${path}.fill`, defaults.fill),
    fill2: colour(source.fill2, `${path}.fill2`, defaults.fill2),
    gradient: source.gradient === true,
    outline: colour(source.outline, `${path}.outline`, defaults.outline),
    outlineWidth: number(source.outlineWidth, {
      path: `${path}.outlineWidth`,
      min: 0,
      max: 100,
      fallback: defaults.outlineWidth,
    }),
    glow: number(source.glow, {
      path: `${path}.glow`,
      min: 0,
      max: 100,
      fallback: defaults.glow,
    }),
    opacity: number(source.opacity, {
      path: `${path}.opacity`,
      ...CLIMB_LIMITS.opacity,
      fallback: defaults.opacity,
    }),
    brightness: number(source.brightness, {
      path: `${path}.brightness`,
      min: 0,
      max: 100,
      fallback: defaults.brightness,
    }),
    scale: number(source.scale, {
      path: `${path}.scale`,
      ...CLIMB_LIMITS.scale,
      fallback: defaults.scale,
    }),
    ...(fontAsset ? { fontAsset, fontName: text(source.fontName, "", 60) } : {}),
    font: FONT_IDS.includes(source.font) ? source.font : source.font === CLIMB_FONT_CUSTOM && fontAsset ? CLIMB_FONT_CUSTOM : defaults.font,
  };
}

/* ------------------------------------------------------------------ *
 * Прежние макеты
 * ------------------------------------------------------------------ */

/*
 * Пять меток прежнего мода panika → метки нового набора. «Точка» (где
 * встать) стала «Встать здесь», надписи от первого и третьего лица —
 * «1 лицо» и «3 лицо», шеврон направления — стрелкой, руль — «Машиной».
 * Виды переезжают, если у новой метки они есть (значки «Точки», надписи,
 * стрелки, машины — есть все), иначе метка встаёт видом мода.
 */
const PREVIOUS_SLOTS = Object.freeze({
  spot: "stay",
  first: "firstpov",
  third: "thirdpov",
  route: "arrow",
  vehicle: "car",
});
/* Слова прежних меток по умолчанию: их сменяют слова нового мода, а свои
   слова человека остаются. */
const PREVIOUS_WORDS = Object.freeze({
  first: Object.freeze({ label: "1 POV", key: "PRESS" }),
  third: Object.freeze({ label: "3 POV", key: "PRESS" }),
});

const isSecondVersion = (source) => {
  const markers = source.markers;
  if (!markers || typeof markers !== "object") return false;
  return (
    Object.keys(PREVIOUS_SLOTS).some((id) => Object.hasOwn(markers, id)) &&
    !CLIMB_SLOT_IDS.some((id) => Object.hasOwn(markers, id))
  );
};

function migrateSecondVersion(source) {
  const markers = {};
  for (const [previous, next] of Object.entries(PREVIOUS_SLOTS)) {
    const marker = source.markers[previous];
    if (!marker || typeof marker !== "object") continue;
    const words = PREVIOUS_WORDS[previous] || {};
    const own = (field) =>
      typeof marker[field] === "string" && marker[field] !== words[field]
        ? marker[field]
        : undefined;
    markers[next] = {
      ...marker,
      variant: climbVariant(next, marker.variant) ? marker.variant : "original",
      label: own("label"),
      key: own("key"),
    };
  }
  return { ...source, markers };
}

/*
 * Макет первой версии: одна стрелка на все модели и два цвета.
 *
 * До игры из него доезжали только цвета — форму значков держала геометрия
 * мода, — поэтому переносятся цвета, обводка, ореол и прозрачность, а виды
 * остаются метками мода. Своя картинка первой версии была одной на всё: она
 * и встаёт на все метки — человек выбирал её именно для них.
 */
function migrateFirstVersion(source) {
  const colors =
    source.colors && typeof source.colors === "object" ? source.colors : {};
  const texture =
    source.texture && typeof source.texture === "object" ? source.texture : {};
  const picture =
    texture.source === "image" &&
    typeof texture.assetId === "string" &&
    texture.assetId.trim()
      ? { assetId: texture.assetId, tint: texture.tint }
      : null;
  const size = Number(texture.size);
  return {
    designId: source.designId,
    name: source.name,
    style: {
      fill: colors.fill,
      outline: colors.edge,
      outlineWidth: colors.outline,
      glow: colors.glow,
      opacity: colors.opacity,
    },
    markers: Object.fromEntries(
      CLIMB_SLOTS.map((slot) => [
        slot.id,
        picture ? { variant: "image", image: picture } : {},
      ]),
    ),
    texture: { size: size && size < 256 ? 256 : size },
  };
}

const isFirstVersion = (source) =>
  !source.style && !source.markers && Boolean(source.arrow || source.colors);

/**
 * Приведение макета к контракту.
 *
 * Неизвестные поля отбрасываются, числа зажимаются в диапазон, цвета
 * приводятся к шестизначному виду. Макет прежнего набора из пяти меток
 * переводится на десять меток нового мода. Пустой или сломанный вход — не
 * ошибка открытия редактора, а «настроек ещё нет»: возвращается заготовка.
 */
export function normalizeClimbDesign(input, path = "design") {
  const raw =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const source = isFirstVersion(raw)
    ? migrateFirstVersion(raw)
    : isSecondVersion(raw)
      ? migrateSecondVersion(raw)
      : raw;
  const defaults = createDefaultClimbDesign();
  const markers =
    source.markers && typeof source.markers === "object" ? source.markers : {};
  const texture =
    source.texture && typeof source.texture === "object" ? source.texture : {};
  const size = Number(texture.size);
  return {
    designId: text(source.designId, defaults.designId, 120),
    name: text(source.name, defaults.name),
    style: normalizeStyle(source.style, `${path}.style`),
    markers: Object.fromEntries(
      CLIMB_SLOTS.map((slot) => [
        slot.id,
        normalizeMarker(slot, markers[slot.id], `${path}.markers.${slot.id}`),
      ]),
    ),
    texture: {
      size: CLIMB_TEXTURE_SIZES.includes(size) ? size : defaults.texture.size,
    },
  };
}

/** Приведение модуля мастерской целиком. */
export function normalizeClimbModule(input, path = "modules.climbs") {
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: CLIMB_MODULE_SCHEMA_VERSION,
    design: normalizeClimbDesign(source.design, `${path}.design`),
  };
}

/* ------------------------------------------------------------------ *
 * Что уходит в игру
 * ------------------------------------------------------------------ */

/** Цвета метки: свои, если заданы, иначе — набора. */
export function climbMarkerColours(design, slotId) {
  const own = design.markers?.[slotId]?.colors;
  return {
    fill: own?.fill || design.style.fill,
    fill2: design.style.fill2,
    gradient: !own && design.style.gradient,
    outline: own?.outline || design.style.outline,
  };
}

/**
 * Свечение ночью.
 *
 * Середина шкалы — множитель 4. Ноль — не «очень тусклое свечение», а
 * другой шейдер: метка освещается миром, как краска на стене, и ночью её
 * видно только под фонарём. (Метки мода светятся шейдером `emissivestrong`
 * с множителем 6,4; у плашек Astral — `emissive_alpha`, прозрачный.)
 */
export function climbMarkerEmission(design) {
  const value = Number(design?.style?.brightness);
  if (!(value > 0)) return { lit: true, multiplier: 0 };
  return { lit: false, multiplier: Math.round((value / 100) * 8 * 100) / 100 };
}

/**
 * Раскладка метки: текстура, поля под обводку и ореол, плашка в модели.
 *
 * Обводка и ореол запекаются в ту же текстуру, и им нужно место вокруг
 * метки: иначе ореол обрубался бы краем текстуры прямым углом. Поэтому метка
 * занимает середину текстуры (`content`), а плашка в модели шире лицевой
 * грани мода ровно на эти поля — метка остаётся того же размера, что была у
 * мода, а обводка ложится вокруг неё, как настоящая.
 *
 * Плашка — в координатах лица (u вправо, v вверх); `axis`/`facing` говорят
 * сборщику, как они ложатся на оси модели, `front`/`back` — где вдоль оси
 * лицо и спина.
 *
 * `size` перекрывает сторону из макета: миниатюрам нужна та же раскладка в
 * 64 точки. Толщины считаются долями стороны, поэтому миниатюра — та же
 * метка, только мельче.
 */
export function climbMarkerLayout(design, slotId, { size = 0 } = {}) {
  const slot = findClimbSlot(slotId);
  if (!slot) throw new Error(`Неизвестная метка залаза: ${slotId}.`);
  const side = size || design.texture.size;
  const width = side;
  const height = Math.max(1, Math.round(side / slot.aspect));
  const short = Math.min(width, height);
  const outline = (design.style.outlineWidth / 100) * 0.08 * short;
  const halo = (design.style.glow / 100) * 0.14 * short;
  const inset = outline + halo + Math.max(1, short / 256);
  const contentHeight = Math.min(
    height - 2 * inset,
    (width - 2 * inset) / slot.aspect,
  );
  const contentWidth = contentHeight * slot.aspect;
  const frame = climbModelFrame(slot.model, slot.aspect);
  const model = CLIMB_MODELS[slot.model];
  const marker = design.markers[slot.id];
  const scale = (design.style.scale / 100) * (marker.scale / 100);
  const unitsPerPixel = frame.height / contentHeight;
  const halfWidth = ((width * unitsPerPixel) / 2) * scale;
  const halfHeight = ((height * unitsPerPixel) / 2) * scale;
  const thin = Math.abs(model.front - model.back) < MIN_DEPTH;
  return {
    slot: slot.id,
    model: slot.model,
    aspect: slot.aspect,
    width,
    height,
    outline,
    halo,
    inset,
    content: {
      x: (width - contentWidth) / 2,
      y: (height - contentHeight) / 2,
      width: contentWidth,
      height: contentHeight,
    },
    frame,
    scale,
    quad: {
      minX: frame.centreX - halfWidth,
      minY: frame.centreY - halfHeight,
      maxX: frame.centreX + halfWidth,
      maxY: frame.centreY + halfHeight,
      front: thin ? model.back + model.facing * MIN_DEPTH : model.front,
      back: model.back,
      axis: model.axis,
      facing: model.facing,
    },
  };
}

/** Метки с принесёнными картинками — их кодом не передать. */
export const climbSlotsWithImages = (design) =>
  CLIMB_SLOTS.filter((slot) => design.markers[slot.id]?.image).map(
    (slot) => slot.id,
  );

/**
 * Макет без своих картинок.
 *
 * Картинки живут в хранилище проекта, и ни код работы, ни копия проекта их
 * не переносят. Метка, рисовавшаяся картинкой, возвращается к метке мода:
 * знакомая метка лучше ссылки в никуда и пустой плашки в игре.
 */
export function stripClimbImages(designInput) {
  const design = normalizeClimbDesign(designInput);
  return normalizeClimbDesign({
    ...design,
    markers: Object.fromEntries(
      CLIMB_SLOTS.map((slot) => {
        const marker = design.markers[slot.id];
        return [
          slot.id,
          {
            ...marker,
            image: null,
            variant: marker.variant === "image" ? "original" : marker.variant,
          },
        ];
      }),
    ),
  });
}

/* ------------------------------------------------------------------ *
 * Готовые наборы
 * ------------------------------------------------------------------ */

const preset = (id, label, description, style, variants) =>
  Object.freeze({
    id,
    label,
    description,
    values: Object.freeze({
      style: Object.freeze(style),
      variants: Object.freeze(variants),
    }),
  });

const allOriginal = Object.fromEntries(
  CLIMB_SLOT_IDS.map((id) => [id, "original"]),
);

/**
 * Готовые залазы — весь набор разом: цвета, обводка, ореол, шрифт и вид
 * каждой из десяти меток. Отправная точка, а не состояние: поправил цвет —
 * это уже свой набор.
 */
export const CLIMB_PRESETS = Object.freeze([
  preset(
    "mod",
    "Как в игре",
    "Белые метки мода с тёмным краем — то, что ставит мод.",
    {
      fill: "#ffffff",
      gradient: false,
      outline: "#000000",
      outlineWidth: 12,
      glow: 0,
      brightness: 50,
      opacity: 100,
      font: "impact",
    },
    allOriginal,
  ),
  preset(
    "neon",
    "Неон",
    "Голубое свечение, шевроны, мишень и надписи с клавишей.",
    {
      fill: "#5ce1ff",
      gradient: false,
      outline: "#03141d",
      outlineWidth: 10,
      glow: 60,
      brightness: 75,
      opacity: 100,
      font: "bahnschrift",
    },
    {
      arrow: "chevrons-2",
      stay: "target",
      jump: "label-key",
      firstpov: "label-key",
      thirdpov: "label-key",
      rightclick: "mouse",
      car: "car",
      teamneed: "duo",
      hit: "target",
      q: "label-key",
    },
  ),
  preset(
    "acid",
    "Кислотный",
    "Кислотно-зелёный: широкие стрелки, прицел и таблички.",
    {
      fill: "#b6ff3d",
      gradient: false,
      outline: "#0b1402",
      outlineWidth: 14,
      glow: 45,
      brightness: 70,
      opacity: 100,
      font: "impact",
    },
    {
      arrow: "block",
      stay: "crosshair",
      jump: "badge",
      firstpov: "badge",
      thirdpov: "badge",
      rightclick: "badge",
      car: "car-front",
      teamneed: "badge",
      hit: "cross",
      q: "label-key",
    },
  ),
  preset(
    "signal",
    "Сигнальный",
    "Жёлтый с толстой чёрной обводкой — как дорожный знак.",
    {
      fill: "#ffcc00",
      gradient: false,
      outline: "#111111",
      outlineWidth: 24,
      glow: 8,
      brightness: 55,
      opacity: 100,
      font: "arial-black",
    },
    {
      arrow: "arrow",
      stay: "diamond",
      jump: "badge",
      firstpov: "badge",
      thirdpov: "badge",
      rightclick: "badge",
      car: "car",
      teamneed: "badge",
      hit: "badge",
      q: "label-key",
    },
  ),
  preset(
    "minimal",
    "Минимализм",
    "Тонкие светлые знаки без ореола — заметно, но не кричит.",
    {
      fill: "#eef1f5",
      gradient: false,
      outline: "#101318",
      outlineWidth: 6,
      glow: 0,
      brightness: 30,
      opacity: 88,
      font: "segoe-black",
    },
    {
      arrow: "chevron",
      stay: "dot",
      jump: "label",
      firstpov: "label",
      thirdpov: "label",
      rightclick: "label",
      car: "tire",
      teamneed: "lines",
      hit: "label",
      q: "lines",
    },
  ),
  preset(
    "danger",
    "Красный",
    "Красные треугольники и кресты с ореолом.",
    {
      fill: "#ff3b3b",
      gradient: false,
      outline: "#1a0000",
      outlineWidth: 12,
      glow: 40,
      brightness: 70,
      opacity: 100,
      font: "impact",
    },
    {
      arrow: "triangles",
      stay: "cross",
      jump: "label-key",
      firstpov: "label-key",
      thirdpov: "label-key",
      rightclick: "label-key",
      car: "original",
      teamneed: "duo",
      hit: "cross",
      q: "label-key",
    },
  ),
  preset(
    "pink",
    "Розовый неон",
    "Розовые звёзды, шевроны и клавиши с сильным свечением.",
    {
      fill: "#ff4fd8",
      gradient: false,
      outline: "#1a0016",
      outlineWidth: 10,
      glow: 65,
      brightness: 80,
      opacity: 100,
      font: "segoe-black",
    },
    {
      arrow: "chevrons-2",
      stay: "star",
      jump: "key",
      firstpov: "key",
      thirdpov: "key",
      rightclick: "mouse",
      car: "car",
      teamneed: "duo",
      hit: "target",
      q: "label-key",
    },
  ),
  preset(
    "gold",
    "Золото",
    "Золотой градиент и таблички с засечками.",
    {
      fill: "#ffe27a",
      fill2: "#ff9d00",
      gradient: true,
      outline: "#2a1600",
      outlineWidth: 12,
      glow: 30,
      brightness: 60,
      opacity: 100,
      font: "georgia",
    },
    {
      arrow: "original",
      stay: "target",
      jump: "badge",
      firstpov: "badge",
      thirdpov: "badge",
      rightclick: "badge",
      car: "wheel",
      teamneed: "badge",
      hit: "badge",
      q: "label-key",
    },
  ),
  preset(
    "graffiti",
    "Граффити",
    "Маркерный шрифт, следы и стрелки — как нарисовано от руки.",
    {
      fill: "#7cf0ff",
      fill2: "#b388ff",
      gradient: true,
      outline: "#0a0a14",
      outlineWidth: 20,
      glow: 18,
      brightness: 55,
      opacity: 100,
      font: "ink",
    },
    {
      arrow: "arrow",
      stay: "footprints",
      jump: "lines",
      firstpov: "lines",
      thirdpov: "lines",
      rightclick: "lines",
      car: "car",
      teamneed: "lines",
      hit: "lines",
      q: "lines",
    },
  ),
  preset(
    "ice",
    "Лёд",
    "Холодный градиент, кольца, шевроны и значки.",
    {
      fill: "#e6f8ff",
      fill2: "#5bb8ff",
      gradient: true,
      outline: "#08182a",
      outlineWidth: 10,
      glow: 50,
      brightness: 65,
      opacity: 100,
      font: "bahnschrift",
    },
    {
      arrow: "chevron",
      stay: "ring",
      jump: "lines",
      firstpov: "icon",
      thirdpov: "icon",
      rightclick: "mouse",
      car: "tire",
      teamneed: "duo",
      hit: "target",
      q: "lines",
    },
  ),
]);

/* Виды пресета прежнего набора — по меткам нового. */
const previousVariants = (variants) =>
  Object.fromEntries(
    Object.entries(PREVIOUS_SLOTS)
      .filter(([previous]) => typeof variants[previous] === "string")
      .map(([previous, next]) => [next, variants[previous]]),
  );

/**
 * Готовый набор поверх макета.
 *
 * Надписи, размеры и свои картинки человека переживают набор: набор
 * описывает облик, а не то, что человек написал и принёс. Метка, которая
 * рисуется своей картинкой, ею и остаётся — иначе одно нажатие «Неон» молча
 * выбрасывало бы принесённый файл.
 */
export function applyClimbPreset(designInput, presetInput) {
  const design = normalizeClimbDesign(designInput);
  const source =
    presetInput && typeof presetInput === "object" ? presetInput : {};
  if (
    source.schema &&
    source.schema !== CLIMB_PRESET_SCHEMA &&
    source.schema !== PREVIOUS_PRESET_SCHEMA
  )
    throw new Error(`Неизвестная схема пресета залаза: ${source.schema}`);
  const values =
    source.values && typeof source.values === "object" ? source.values : {};
  const given =
    values.variants && typeof values.variants === "object"
      ? values.variants
      : {};
  const variants =
    source.schema === PREVIOUS_PRESET_SCHEMA ? previousVariants(given) : given;
  return normalizeClimbDesign({
    ...design,
    style: { ...design.style, ...(values.style || {}) },
    markers: Object.fromEntries(
      CLIMB_SLOTS.map((slot) => {
        const marker = design.markers[slot.id];
        const next = variants[slot.id];
        const keep =
          marker.variant === "image" || !next || !climbVariant(slot.id, next);
        return [
          slot.id,
          { ...marker, colors: null, variant: keep ? marker.variant : next },
        ];
      }),
    ),
  });
}

/** Пресет из макета: облик и виды, без картинок, надписей и имени. */
export function createClimbPreset(designInput) {
  const design = stripClimbImages(designInput);
  return {
    schema: CLIMB_PRESET_SCHEMA,
    values: {
      style: design.style,
      variants: Object.fromEntries(
        CLIMB_SLOTS.map((slot) => [slot.id, design.markers[slot.id].variant]),
      ),
    },
  };
}
