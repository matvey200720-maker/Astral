/*
 * «Расписание» (ТЗ 10.10.2026, вечер, задача 11: «Добавить расписание в
 * отдельную вкладочку… менять картинку, текст, время у этого готового
 * расписания… цвет, прозрачность, непрозрачность»).
 *
 * Табло сервера Majestic (`maj_info.rpf`, опись — `inventory/schedule.js`,
 * `scripts/prepare-schedule.mjs`): щит 0,70 × 0,39 м модели, на карте
 * двадцать штук с масштабом 4,75…6,43. Листа с картинкой у табло нет —
 * буквы, цифры, квадраты значков и рамка у сервера объёмные сетки
 * (`default`, белая клетка 4×4), плашки строк — сетки с тёмной клеткой,
 * значки — квадраты `decal` со своими листами. Поэтому своё табло — своя
 * модель: плашка во весь щит с листом 2048 × 1024, который рисует окно по
 * работе (заголовок, шестнадцать строк — время, название, значок, —
 * цвета, прозрачность, шрифт), шейдер с альфой (`alpha.sps`) или со
 * свечением (`emissive`, `emissive_alpha.sps`).
 *
 * Как оно встаёт в игре. Пак сервера Majestic (alt:V) главнее файлов игры
 * с теми же именами — табло сервера своим не подменить. Своё встаёт своими
 * именами (`astral_schedule_<размер>`, типы и карта `astral_schedule`) на
 * местах табло сервера: та же точка, тот же поворот и размер, лицо — на
 * `SCHEDULE_FRONT` метров модели впереди лица сервера. Непрозрачный лист
 * закрывает табло сервера целиком; сквозь прозрачные места своего видно
 * его табло. В одиночной игре табло сервера нет — там только своё.
 *
 * «Как на сервере» — исходная работа: ставить нечего («Применить» снимает
 * установку), кадр показывает облик сервера (`server.png` описи).
 *
 * Полная правка (ТЗ владельца 11.10.2026, утро, задача 4: «создавать свои
 * новые тайники… назвать новый, создать и подписать время… эту таблицу
 * дополнять и расписывать… менять значки, время, название»). Схема 2:
 * строк сколько угодно до `SCHEDULE_MAX_ROWS` — свои добавляются, лишние
 * удаляются, порядок любой; табло раскладывает их в колонки
 * (`scheduleGrid`): до шестнадцати — ровно как у сервера, больше — строки
 * ниже и буквы мельче, третья колонка. Значок строки — значок сервера,
 * значок Astral (`schedule-icons.js`, рисунки свои), своя картинка или
 * ничего. Работы схемы 1 (ровно шестнадцать мест сервера) открываются как
 * есть.
 */

import { normalizeRecolourHex } from "./colour.js";
import { EMBLEM_ASSET, EMBLEM_FONT_ASSET, EMBLEM_TEXT_FONTS } from "./emblems.js";
import SCHEDULE_INVENTORY from "./inventory/schedule.js";
import { SCHEDULE_ASTRAL_ICONS, SCHEDULE_ASTRAL_ICON_GRID, findScheduleAstralIcon } from "./schedule-icons.js";

export { SCHEDULE_INVENTORY, SCHEDULE_ASTRAL_ICONS, SCHEDULE_ASTRAL_ICON_GRID, findScheduleAstralIcon };

export const SCHEDULE_SCHEMA = 2;
export const SCHEDULE_SLOT = "schedule";
/* Свои имена в игре: модель на размер щита, общие типы и карта. */
export const SCHEDULE_MODEL_PREFIX = "astral_schedule_";
export const SCHEDULE_TYPES = "astral_schedule";
export const SCHEDULE_MAP = "astral_schedule";
/* Насколько лицо своего табло впереди лица табло сервера, м модели (×4,75 ≈ 2,6 см). */
export const SCHEDULE_FRONT = 0.006;
/* Модель — без своей дальности (как у сервера, 9998): видимость решает сущность. */
export const SCHEDULE_MODEL_LOD = 9998;

export const SCHEDULE_SHEET = SCHEDULE_INVENTORY.sheet;
export const SCHEDULE_BOARD = SCHEDULE_INVENTORY.board;
export const SCHEDULE_PLACES = SCHEDULE_INVENTORY.places;
export const SCHEDULE_SIZES = SCHEDULE_INVENTORY.sizes;
/*
 * Инфотабло занятий того же файла сервера (13 видов): не листы, а объёмные
 * светящиеся фигуры (`emissive` ×10) — числа со значками, маски тайников,
 * рамки дилеров на земле. Здесь они только для справки: см. «Где стоят».
 */
export const SCHEDULE_INFO_BOARDS = SCHEDULE_INVENTORY.info;

const NAME_LIMIT = 60;
/*
 * Строк на табло — до 48: три колонки по шестнадцать. Дальше буквы на щите
 * 3,3 м стали бы меньше 3 см (вдвое мельче сервера), а лист 2048 × 1024 —
 * меньше 15 точек на букву: в игре это уже не читается.
 */
export const SCHEDULE_MAX_ROWS = 48;
/* Строк в колонке — не больше шестнадцати: дальше табло берёт ещё колонку. */
export const SCHEDULE_MAX_LINES = 16;
export const SCHEDULE_LIMITS = Object.freeze({
  title: 32,
  text: 24,
  /* Время — «18:00», «12:00–14:00», «10:00, 14:00, 18:00», «24/7». */
  time: 32,
  rows: SCHEDULE_MAX_ROWS,
  glow: Object.freeze([0, 8]),
  letters: Object.freeze([70, 150]),
  opacity: Object.freeze([0, 100]),
});

/* ------------------------------------------------------------------ *
 * Строки и значки
 * ------------------------------------------------------------------ */

/** Значки сервера: `{ id, label, url, width, height }`. */
export const SCHEDULE_ICONS = Object.freeze(SCHEDULE_INVENTORY.icons.map((icon) => Object.freeze({ ...icon })));
const SERVER_ICON_IDS = new Set(SCHEDULE_ICONS.map((icon) => icon.id));
const ICON_IDS = new Set([...SERVER_ICON_IDS, ...SCHEDULE_ASTRAL_ICONS.map((icon) => icon.id)]);
export const findScheduleIcon = (id) => SCHEDULE_ICONS.find((icon) => icon.id === id) || null;
/* Что может стоять в квадрате строки: значок сервера, значок Astral, своя картинка, ничего. */
export const SCHEDULE_ICON_NONE = "none";
export const SCHEDULE_ICON_IMAGE = "image";
/** Откуда значок строки: `server`, `astral`, `image` или `none`. */
export function scheduleIconKind(id) {
  if (id === SCHEDULE_ICON_IMAGE) return "image";
  if (SERVER_ICON_IDS.has(id)) return "server";
  if (findScheduleAstralIcon(id)) return "astral";
  return "none";
}

/**
 * Шестнадцать мест строк: колонка, номер в колонке, раскладка сервера и
 * что на месте у сервера (`stock`). Левая колонка сверху вниз, потом правая.
 */
export const SCHEDULE_ROWS = Object.freeze(
  SCHEDULE_INVENTORY.rows.map((row, index) =>
    Object.freeze({
      id: `${row.column ? "r" : "l"}${(index % 8) + 1}`,
      index,
      column: row.column,
      line: index % 8,
      box: row.box,
      plate: row.plate,
      centre: row.centre,
      stock: Object.freeze({ text: row.text, time: row.at, icon: row.icon }),
    }),
  ),
);
export const SCHEDULE_ROW_COUNT = SCHEDULE_ROWS.length;
export const SCHEDULE_COLUMN_LABELS = Object.freeze(["Левая колонка", "Правая колонка"]);
/*
 * Колонки табло: «Авто» — две, как у сервера, а с 29-й строки — три (при
 * двух колонках строк в каждой было бы больше четырнадцати, буквы — меньше
 * 3,6 см); своё число — если человеку так читается лучше. Колонок всегда
 * столько, чтобы в каждой было не больше шестнадцати строк.
 */
export const SCHEDULE_COLUMN_CHOICES = Object.freeze(["auto", 1, 2, 3]);
const AUTO_THREE_FROM = 29;
/* Новая строка: слова и время — чтобы сразу переписать, значок — сундук сервера. */
export const SCHEDULE_NEW_ROW = Object.freeze({ text: "Новое событие", time: "12:00", icon: "chest" });
const BLANK_ROW = Object.freeze({ text: "", time: "", icon: SCHEDULE_ICON_NONE });

/* ------------------------------------------------------------------ *
 * Облик
 * ------------------------------------------------------------------ */

/*
 * Цвета: заголовок, названия, время, плашки строк, выделенные строки
 * (акцент), квадраты значков, значки сервера, фон щита, рамка. У сервера —
 * белые буквы и квадраты, тёмные плашки (#211c21 его клетки), чёрные
 * значки; фона нет.
 */
export const SCHEDULE_COLOUR_KEYS = Object.freeze(["title", "text", "time", "plate", "accent", "box", "icon", "background", "outline"]);
export const SCHEDULE_SERVER_COLOURS = Object.freeze({
  title: SCHEDULE_INVENTORY.look.text,
  text: SCHEDULE_INVENTORY.look.text,
  time: SCHEDULE_INVENTORY.look.text,
  plate: SCHEDULE_INVENTORY.look.plate,
  accent: "#d9a21b",
  box: SCHEDULE_INVENTORY.look.box,
  icon: "#000000",
  background: "#121418",
  outline: SCHEDULE_INVENTORY.look.outline,
});
/*
 * Непрозрачность частей, %: всё табло (множитель на всё), фон щита, плашки,
 * квадраты значков, рамка. У сервера фона нет — между строк видно мир.
 */
export const SCHEDULE_OPACITY_KEYS = Object.freeze(["board", "background", "plates", "boxes", "outline"]);
export const SCHEDULE_SERVER_OPACITY = Object.freeze({ board: 100, background: 0, plates: 100, boxes: 100, outline: 100 });
/* Шрифт: системные шрифты окна и свой файл — как у надписей мастерской. */
export const SCHEDULE_FONTS = EMBLEM_TEXT_FONTS;
export const SCHEDULE_SERVER_FONT = Object.freeze({ font: "block", letters: 115, upper: true });

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
function clamp(value, [low, high], fallback, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
}
/* Строка без служебных знаков и переводов строк, не длиннее `limit`. */
const cleanText = (value, limit) =>
  Array.from(String(value ?? ""))
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .slice(0, limit);

function normalizeImage(input) {
  const source = plain(input);
  if (!EMBLEM_ASSET.test(String(source.asset || ""))) return null;
  return {
    asset: String(source.asset),
    name: cleanText(source.name, 60).trim() || "Своя картинка",
    width: clamp(source.width, [1, 8192], 0),
    height: clamp(source.height, [1, 8192], 0),
  };
}

/* Строка в порядке; `stock` — чем заполнить пропущенное (строка сервера на этом месте или пустая). */
function normalizeRow(input, stock = BLANK_ROW) {
  const source = input === undefined || input === null ? stock : plain(input);
  const image = normalizeImage(source.image);
  let icon = source.icon;
  if (icon === SCHEDULE_ICON_IMAGE) icon = image ? icon : stock.icon;
  else if (icon !== SCHEDULE_ICON_NONE && !ICON_IDS.has(icon)) icon = stock.icon;
  return {
    text: cleanText(source.text ?? stock.text, SCHEDULE_LIMITS.text),
    time: cleanText(source.time ?? stock.time, SCHEDULE_LIMITS.time),
    icon,
    ...(icon === SCHEDULE_ICON_IMAGE ? { image } : {}),
    hidden: source.hidden === true,
    accent: source.accent === true,
  };
}

function normalizeColours(input) {
  const source = plain(input);
  return Object.fromEntries(SCHEDULE_COLOUR_KEYS.map((key) => [key, normalizeRecolourHex(source[key], SCHEDULE_SERVER_COLOURS[key])]));
}

function normalizeOpacity(input) {
  const source = plain(input);
  return Object.fromEntries(SCHEDULE_OPACITY_KEYS.map((key) => [key, clamp(source[key], SCHEDULE_LIMITS.opacity, SCHEDULE_SERVER_OPACITY[key])]));
}

export function createScheduleProject() {
  return normalizeScheduleProject({});
}

/* Строка сервера на месте `index` (или пустая — за шестнадцатой). */
const stockRowAt = (index) => SCHEDULE_ROWS[index]?.stock || BLANK_ROW;

/*
 * Строки работы. Схема 1 — ровно шестнадцать мест сервера: недостающие —
 * строки сервера, лишние отбрасываются (так работы вчерашнего редактора
 * открываются как были). Схема 2 — сколько строк, столько и есть (до
 * `SCHEDULE_MAX_ROWS`); без списка строк — строки сервера.
 */
function normalizeRows(source) {
  if (!Array.isArray(source.rows)) return SCHEDULE_ROWS.map((slot) => normalizeRow(slot.stock, slot.stock));
  if (!(Number(source.schema) >= 2)) return SCHEDULE_ROWS.map((slot) => normalizeRow(source.rows[slot.index], slot.stock));
  return source.rows.slice(0, SCHEDULE_MAX_ROWS).map((row, index) => normalizeRow(row, stockRowAt(index)));
}

const normalizeColumns = (value) => ((typeof value === "number" || typeof value === "string") && SCHEDULE_COLUMN_CHOICES.includes(Number(value)) ? Number(value) : "auto");

/** Работа в порядке; лишние поля отбрасываются молча. Без строк — строки сервера. */
export function normalizeScheduleProject(input) {
  const source = plain(input);
  const fontAsset = EMBLEM_FONT_ASSET.test(String(source.fontAsset || "")) ? String(source.fontAsset) : "";
  const font = SCHEDULE_FONTS.includes(source.font) && (source.font !== "custom" || fontAsset) ? source.font : SCHEDULE_SERVER_FONT.font;
  return {
    schema: SCHEDULE_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    title: cleanText(source.title ?? SCHEDULE_INVENTORY.heading.text, SCHEDULE_LIMITS.title),
    rows: normalizeRows(source),
    columns: normalizeColumns(source.columns),
    colours: normalizeColours(source.colours),
    opacity: normalizeOpacity(source.opacity),
    glow: clamp(source.glow, SCHEDULE_LIMITS.glow, 0, 1),
    font,
    ...(font === "custom" ? { fontAsset, fontName: cleanText(source.fontName, 60).trim() || "Свой шрифт" } : {}),
    letters: clamp(source.letters, SCHEDULE_LIMITS.letters, SCHEDULE_SERVER_FONT.letters),
    upper: source.upper !== false,
  };
}

export const serializeScheduleProject = (project) => JSON.stringify(normalizeScheduleProject(project));

export function parseScheduleProject(text) {
  try {
    return normalizeScheduleProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createScheduleProject();
  }
}

/** Отпечаток для очереди «Применить»: та же работа — тот же отпечаток. */
export function scheduleSignature(input) {
  const { name: _name, schema: _schema, ...rest } = normalizeScheduleProject(input);
  return JSON.stringify(rest);
}

/** «Как на сервере»: табло сервера как есть — ставить нечего. */
export const scheduleIsStock = (input) => scheduleSignature(input) === scheduleSignature(createScheduleProject());

/** «Как на сервере» целиком; имя работы остаётся. */
export const resetScheduleProject = (input) => normalizeScheduleProject({ name: normalizeScheduleProject(input).name });
export const applyScheduleStandard = resetScheduleProject;

/*
 * Строки, что отличаются от строки сервера на том же месте (слова, время,
 * значок, скрыта, выделена); свои строки сверх шестнадцати — все.
 */
export function changedScheduleRows(input) {
  const project = normalizeScheduleProject(input);
  const stock = createScheduleProject();
  return project.rows.map((row, index) => (index < stock.rows.length && JSON.stringify(row) === JSON.stringify(stock.rows[index]) ? -1 : index)).filter((index) => index >= 0);
}

/* ------------------------------------------------------------------ *
 * Правка строк: добавить, удалить, копия, порядок, правка одной
 * ------------------------------------------------------------------ */

/* Новые строки — к работе схемы 2: схема 1 обрезала бы их до шестнадцати. */
function withRows(input, update) {
  const project = normalizeScheduleProject(input);
  return normalizeScheduleProject({ ...project, rows: update(project.rows) });
}

/** Строка в работу: в конец или на место `at`; больше `SCHEDULE_MAX_ROWS` не добавляется. */
export function addScheduleRow(input, row = SCHEDULE_NEW_ROW, at = undefined) {
  return withRows(input, (rows) => {
    if (rows.length >= SCHEDULE_MAX_ROWS) return rows;
    const index = at === undefined ? rows.length : Math.max(0, Math.min(rows.length, Math.round(Number(at) || 0)));
    return [...rows.slice(0, index), normalizeRow(row, SCHEDULE_NEW_ROW), ...rows.slice(index)];
  });
}

export const removeScheduleRow = (input, index) => withRows(input, (rows) => rows.filter((_, at) => at !== index));

/** Копия строки — сразу под ней. */
export const duplicateScheduleRow = (input, index) => {
  const project = normalizeScheduleProject(input);
  return project.rows[index] ? addScheduleRow(project, project.rows[index], index + 1) : project;
};

/** Строка на `step` мест в порядке чтения (−1 — выше, 1 — ниже). */
export function moveScheduleRow(input, index, step) {
  return withRows(input, (rows) => {
    const target = index + step;
    if (!rows[index] || target < 0 || target >= rows.length) return rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

export const patchScheduleRow = (input, index, values) => withRows(input, (rows) => rows.map((row, at) => (at === index ? { ...row, ...values } : row)));

/** Строка сервера на этом месте (у своих строк сверх шестнадцати её нет — `null`). */
export const scheduleStockRow = (index) => SCHEDULE_ROWS[index]?.stock || null;

/** Свои картинки работы (ключи хранилища окна) — в код для друга они не едут. */
export function scheduleImageAssets(input) {
  const project = normalizeScheduleProject(input);
  return [...new Set(project.rows.filter((row) => row.icon === SCHEDULE_ICON_IMAGE).map((row) => row.image.asset))];
}

/*
 * Код для друга: без своих картинок и без своего шрифта. Вместо картинки —
 * значок сервера на этом месте (у своих строк сверх шестнадцати — без
 * значка); значки Astral едут — они у друга в окне те же.
 */
export function shareableScheduleProject(input) {
  const project = normalizeScheduleProject(input);
  const rows = project.rows.map((row, index) => {
    if (row.icon !== SCHEDULE_ICON_IMAGE) return row;
    const { image: _image, ...rest } = row;
    return { ...rest, icon: stockRowAt(index).icon };
  });
  const { fontAsset: _asset, fontName: _name, ...rest } = project;
  return normalizeScheduleProject({ ...rest, rows, font: project.font === "custom" ? SCHEDULE_SERVER_FONT.font : project.font });
}
export const scheduleLostInCode = (input) => {
  const project = normalizeScheduleProject(input);
  return project.font === "custom" || project.rows.some((row) => row.icon === SCHEDULE_ICON_IMAGE);
};

/* ------------------------------------------------------------------ *
 * Раскладка листа
 * ------------------------------------------------------------------ */

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
/* Отступы сервера, одинаковые у всех строк: название — за квадратом, время — до края плашки. */
const TEXT_GAP = median(SCHEDULE_INVENTORY.rows.map((row) => row.name - row.box[2]));
const TIME_PAD = median(SCHEDULE_INVENTORY.rows.map((row) => row.plate[2] - row.time));
const ROW_CAP = median(SCHEDULE_INVENTORY.rows.map((row) => row.cap));
/* Скругление плашек и квадратов у сервера — около 3 мм модели. */
const PLATE_RADIUS = 0.003;

/*
 * Сетка строк сервера, м модели: поле строк (от верха первой до низа
 * последней, от левого края квадратов до правого края плашек), шаг и высота
 * строки, ширина квадрата значка, насколько плашка заходит под квадрат,
 * просвет между колонками.
 */
const SERVER_GRID = (() => {
  const rows = SCHEDULE_INVENTORY.rows;
  const height = median(rows.map((row) => row.box[3] - row.box[1]));
  const top = Math.min(...rows.map((row) => row.box[1]));
  const bottom = Math.max(...rows.map((row) => row.box[3]));
  const left = Math.min(...rows.map((row) => row.box[0]));
  const right = Math.max(...rows.map((row) => row.plate[2]));
  const lines = Math.max(...SCHEDULE_ROWS.map((slot) => slot.line)) + 1;
  const firstRight = Math.max(...rows.filter((row) => row.column === 0).map((row) => row.plate[2]));
  const secondLeft = Math.min(...rows.filter((row) => row.column === 1).map((row) => row.box[0]));
  return Object.freeze({
    top,
    bottom,
    left,
    right,
    lines,
    height,
    pitch: (bottom - top - height) / (lines - 1),
    box: median(rows.map((row) => row.box[2] - row.box[0])),
    overlap: median(rows.map((row) => row.box[2] - row.plate[0])),
    gap: secondLeft - firstRight,
  });
})();

/** Сколько колонок у табло работы: выбор человека, но не меньше, чем нужно на все строки. */
export function scheduleColumnCount(input) {
  const project = normalizeScheduleProject(input);
  const count = project.rows.length;
  const chosen = project.columns === "auto" ? (count >= AUTO_THREE_FROM ? 3 : 2) : project.columns;
  return Math.max(1, chosen, Math.ceil(count / SCHEDULE_MAX_LINES));
}

/**
 * Места строк на щите, м модели от левого верхнего угла: `[{ column, line,
 * box, plate, centre, cap, size }]` в порядке чтения — колонка сверху вниз,
 * потом следующая. Две колонки по восемь и меньше — ровно места сервера;
 * больше восьми строк в колонке — строка ниже (всё поле строк делится
 * поровну), квадрат, буквы и отступы — в той же пропорции (`size` — доля
 * от сервера); колонки делят ширину поля поровну.
 */
export function scheduleGrid(count, columns = 2) {
  const total = Math.max(0, Math.min(SCHEDULE_MAX_ROWS, Math.round(Number(count) || 0)));
  const cols = Math.max(1, Math.round(Number(columns) || 1));
  const lines = Math.max(1, Math.ceil(total / cols));
  const grid = SERVER_GRID;
  const server = cols === 2 && lines <= grid.lines;
  const pitch = lines <= grid.lines ? grid.pitch : (grid.bottom - grid.top) / (lines - 1 + grid.height / grid.pitch);
  const size = lines <= grid.lines ? 1 : pitch / grid.pitch;
  const height = grid.height * size;
  const gap = cols === 2 ? grid.gap : grid.gap * 0.6;
  const span = (grid.right - grid.left - (cols - 1) * gap) / cols;
  const out = [];
  for (let index = 0; index < total; index += 1) {
    const column = Math.floor(index / lines);
    const line = index % lines;
    if (server) {
      const slot = SCHEDULE_ROWS[column * grid.lines + line];
      out.push({ column, line, box: [...slot.box], plate: [...slot.plate], centre: slot.centre, cap: ROW_CAP, size: 1 });
      continue;
    }
    const x0 = grid.left + column * (span + gap);
    const y0 = grid.top + line * pitch;
    const boxRight = x0 + grid.box * size;
    out.push({
      column,
      line,
      box: [x0, y0, boxRight, y0 + height],
      plate: [boxRight - grid.overlap * size, y0, x0 + span, y0 + height],
      centre: y0 + height / 2,
      cap: ROW_CAP * size,
      size,
    });
  }
  return out;
}

/**
 * Раскладка листа в «точках листа по ширине» (`width` — 2048): лист щита
 * 1,8 : 1 ложится на лист 2 : 1, поэтому рисунок идёт в пространстве
 * точек ширины, а по высоте сжимается на `squash` (окно ставит
 * `setTransform(1, 0, 0, squash, 0, 0)`). Буквы так остаются ровными на
 * щите, а лист — степенью двойки со всеми мипами.
 *
 * Строки — по работе (`scheduleGrid`); без работы — шестнадцать мест
 * сервера. Скрытая строка место держит: на щите там пусто.
 */
export function scheduleLayout(input = null) {
  const project = normalizeScheduleProject(input || {});
  const columns = scheduleColumnCount(project);
  const grid = scheduleGrid(project.rows.length, columns);
  const px = SCHEDULE_SHEET.width / SCHEDULE_BOARD.width;
  const scale = (value) => value * px;
  const rect = (box) => box.map(scale);
  return {
    width: SCHEDULE_SHEET.width,
    height: scale(SCHEDULE_BOARD.height),
    sheet: SCHEDULE_SHEET,
    squash: SCHEDULE_SHEET.height / scale(SCHEDULE_BOARD.height),
    columns,
    lines: Math.max(1, Math.ceil(project.rows.length / columns)),
    outline: { width: scale(SCHEDULE_INVENTORY.outline.width), radius: scale(SCHEDULE_INVENTORY.outline.radius) },
    heading: {
      x: scale(SCHEDULE_INVENTORY.heading.centre[0]),
      y: scale(SCHEDULE_INVENTORY.heading.centre[1]),
      cap: scale(SCHEDULE_INVENTORY.heading.cap),
      width: scale(SCHEDULE_BOARD.width - 2 * (SCHEDULE_INVENTORY.outline.radius + SCHEDULE_INVENTORY.outline.width)),
    },
    rows: grid.map((slot, index) => ({
      id: `row-${index + 1}`,
      index,
      column: slot.column,
      line: slot.line,
      plate: rect(slot.plate),
      box: rect(slot.box),
      radius: scale(PLATE_RADIUS * slot.size),
      nameX: scale(slot.box[2] + TEXT_GAP * slot.size),
      timeX: scale(slot.plate[2] - TIME_PAD * slot.size),
      centreY: scale(slot.centre),
      cap: scale(slot.cap),
      gap: scale(TEXT_GAP * slot.size),
    })),
  };
}

/*
 * Высота букв строк в игре, см: на самом частом табло (3,3 м, 17 из 20) и
 * у сервера. По ней панель честно говорит, как читается табло.
 */
const COMMON_SCALE = SCHEDULE_INVENTORY.sizes[0];
const capCentimetres = (cap) => Math.round(cap * COMMON_SCALE * 1000) / 10;
export const SCHEDULE_SERVER_LETTERS = capCentimetres(ROW_CAP);

/** Как табло читается: `{ rows, columns, lines, letters (см), server (см), ratio, smaller }`. */
export function scheduleReadability(input) {
  const project = normalizeScheduleProject(input);
  const columns = scheduleColumnCount(project);
  const grid = scheduleGrid(Math.max(1, project.rows.length), columns);
  const letters = capCentimetres(grid[0].cap);
  return {
    rows: project.rows.length,
    columns,
    lines: Math.max(1, Math.ceil(project.rows.length / columns)),
    letters,
    server: SCHEDULE_SERVER_LETTERS,
    ratio: Math.round((letters / SCHEDULE_SERVER_LETTERS) * 100) / 100,
    smaller: letters < SCHEDULE_SERVER_LETTERS - 0.05,
  };
}

/** Слова строки, как они встанут на щит (заглавными, если так выбрано). */
export const scheduleShownText = (value, project) => {
  const text = String(value ?? "").trim();
  return normalizeScheduleProject(project).upper ? text.toLocaleUpperCase("ru-RU") : text;
};

/* ------------------------------------------------------------------ *
 * Модели и места
 * ------------------------------------------------------------------ */

/** Модель табло размера `scale` (масштаб сущности сервера): своя на каждый размер. */
export const scheduleModelOf = (scale) => `${SCHEDULE_MODEL_PREFIX}${SCHEDULE_SIZES.indexOf(scale) + 1}`;
export const SCHEDULE_MODELS = Object.freeze(SCHEDULE_SIZES.map((scale) => scheduleModelOf(scale)));

/**
 * Плашка табло размера `scale` в осях модели сервера (Z вверх, лицо в −Y):
 * прямоугольник щита, умноженный на масштаб сущности (у своей сущности
 * масштаба нет), на `SCHEDULE_FRONT` впереди лица сервера. Развёртка — лист
 * целиком, v сверху вниз, как у листов игры.
 */
export function scheduleBoardMesh(scale) {
  const left = SCHEDULE_BOARD.minX * scale;
  const right = (SCHEDULE_BOARD.minX + SCHEDULE_BOARD.width) * scale;
  const top = SCHEDULE_BOARD.maxZ * scale;
  const bottom = (SCHEDULE_BOARD.maxZ - SCHEDULE_BOARD.height) * scale;
  const y = (SCHEDULE_BOARD.front - SCHEDULE_FRONT) * scale;
  const positions = new Float32Array([left, y, top, right, y, top, right, y, bottom, left, y, bottom]);
  const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  /* Обход — лицом в −Y: (b − a) × (c − a) смотрит туда же, куда нормаль. */
  const indices = new Uint32Array([0, 3, 2, 0, 2, 1]);
  return { positions, normals, uvs, indices, bounds: { min: [left, y, bottom], max: [right, y, top] }, width: right - left, height: top - bottom };
}

/**
 * Шейдер своего табло: без свечения — `default` (табло освещает мир, как у
 * сервера), со свечением — `emissive`; лист с прозрачными местами — их
 * варианты с альфой (`alpha.sps`, `emissive_alpha.sps`).
 */
export function scheduleShader(glow, transparent) {
  if (glow > 0) return { name: "emissive", file: transparent ? "emissive_alpha.sps" : "emissive.sps", emissive: glow };
  return { name: "default", file: transparent ? "alpha.sps" : "default.sps" };
}

/**
 * Что уходит в игру: модель на каждый размер табло (плашка и лист), места
 * двадцати табло сервера (точка, поворот, флаги и дальность — как у него).
 * «Как на сервере» — `null`: ставить нечего.
 */
export function scheduleBuildPlan(input) {
  const project = normalizeScheduleProject(input);
  if (scheduleIsStock(project)) return null;
  return {
    glow: project.glow,
    models: SCHEDULE_SIZES.map((scale) => ({ name: scheduleModelOf(scale), scale, mesh: scheduleBoardMesh(scale) })),
    entities: SCHEDULE_PLACES.map((place) => ({
      id: place.id,
      archetype: scheduleModelOf(place.scale),
      position: place.position,
      rotation: place.rotation,
      lodDist: place.lodDist,
      flags: place.flags,
    })),
    archetypeFlags: SCHEDULE_INVENTORY.archetype.flags,
  };
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

/*
 * Готовый вид меняет цвета, прозрачность и свечение; строки, заголовок и
 * шрифт остаются работы.
 */
const look = (colours, opacity = {}, glow = 0) =>
  Object.freeze({ colours: Object.freeze({ ...SCHEDULE_SERVER_COLOURS, ...colours }), opacity: Object.freeze({ ...SCHEDULE_SERVER_OPACITY, ...opacity }), glow });
export const SCHEDULE_PRESETS = Object.freeze([
  Object.freeze({ id: "server", label: "Как на сервере", description: "Белые буквы на тёмных плашках, между строк — мир.", ...look({}) }),
  Object.freeze({ id: "night", label: "Ночное свечение", description: "Как на сервере, но светится само — читается ночью.", ...look({}, {}, 2) }),
  Object.freeze({
    id: "board",
    label: "На щите",
    description: "Тёмный щит под строками — табло видно на любом фоне.",
    ...look({ background: "#121418" }, { background: 92 }),
  }),
  Object.freeze({
    id: "neon",
    label: "Неон",
    description: "Бирюзовые время и рамка на чёрном, светится.",
    ...look({ title: "#3ff2ff", time: "#3ff2ff", plate: "#08161d", box: "#3ff2ff", icon: "#05080b", background: "#05080b", outline: "#3ff2ff", accent: "#ff3fb4" }, { background: 88 }, 3),
  }),
  Object.freeze({
    id: "light",
    label: "Светлое",
    description: "Белый щит, тёмные буквы, красное время.",
    ...look(
      { title: "#15171c", text: "#15171c", time: "#c4302b", plate: "#e9ebef", box: "#15171c", icon: "#ffffff", background: "#ffffff", outline: "#15171c", accent: "#ffd25a" },
      { background: 100 },
    ),
  }),
  Object.freeze({
    id: "gold",
    label: "Золото",
    description: "Тёмные плашки, золотые заголовок, время и значки.",
    ...look({ title: "#e5b647", time: "#e5b647", text: "#f1e6c8", plate: "#1c1710", box: "#e5b647", icon: "#1c1710", background: "#0d0b08", outline: "#e5b647", accent: "#6b4a12" }, { background: 85 }),
  }),
  Object.freeze({
    id: "red",
    label: "Красное",
    description: "Красные плашки и белые буквы — заметно издалека.",
    ...look({ plate: "#9e1b1f", box: "#ffffff", icon: "#9e1b1f", outline: "#ffffff", accent: "#ffcc00" }),
  }),
  Object.freeze({
    id: "glass",
    label: "Стекло",
    description: "Полупрозрачный щит и плашки — сквозь табло видно город.",
    ...look({ background: "#0d1117", plate: "#0d1117" }, { background: 45, plates: 60, boxes: 80, outline: 70 }),
  }),
  Object.freeze({
    id: "plain",
    label: "Только текст",
    description: "Без плашек и квадратов: буквы, время и белые значки висят в воздухе.",
    ...look({ icon: "#ffffff" }, { plates: 0, boxes: 0, outline: 0 }),
  }),
]);
export const findSchedulePreset = (id) => SCHEDULE_PRESETS.find((preset) => preset.id === id) || null;

export function applySchedulePreset(input, presetId) {
  const project = normalizeScheduleProject(input);
  const preset = findSchedulePreset(presetId);
  if (!preset) return project;
  return normalizeScheduleProject({ ...project, colours: preset.colours, opacity: preset.opacity, glow: preset.glow });
}

/** Готовый вид, с которым совпадает облик работы (строки и шрифт не в счёт). */
export function matchingSchedulePreset(input) {
  const project = normalizeScheduleProject(input);
  const own = JSON.stringify([project.colours, project.opacity, project.glow]);
  return SCHEDULE_PRESETS.find((preset) => JSON.stringify([normalizeColours(preset.colours), normalizeOpacity(preset.opacity), preset.glow]) === own)?.id || null;
}
