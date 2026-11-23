// Данные панели: таблица инструментов, группа колонки, строки управления,
// виды по умолчанию. Русские подписи здесь сырые — переводятся там, где рисуются.
import {
  Cursor as SelectGlyph,
  MapPinSimple,
  TextT as TextGlyph,
  PaintBrush,
  Shapes as ShapesGlyph,
  Eraser as EraserGlyph,
  ImageSquare,
  TextAa as FontGlyph,
  CalendarBlank,
  Polygon as MapGlyph,
  MapPinArea,
  GameController as PadGlyph,
  MapPin,
  Swatches as SwatchGlyph,
  Stack,
} from "../../../ui/icons.jsx";
import { LineToolIcon, ArrowToolIcon } from "../world-map/MapDrawMenu.jsx";

// Таблица: id, значок, подпись, буква, группа колонки, строка под заголовком,
// карточка первого взятия
const ROW_FIELDS = ["id", "icon", "label", "letter", "group", "note", "hint"];
function rowOf(cells) {
  const row = {};
  ROW_FIELDS.forEach((field, at) => {
    row[field] = cells[at];
  });
  return row;
}

export const TOOL_ROWS = [
  [
    "select",
    SelectGlyph,
    "Выбор",
    "v",
    "edit",
    "Объекты на карте",
    "Щёлкните по зоне, значку или подписи — выделится, и её можно тянуть. Пустое место тянет карту",
  ],
  [
    "markers",
    MapPinSimple,
    "Значки",
    "m",
    "draw",
    "Значки мест: АЗС, больницы, свои точки",
    "Выберите значок справа и щёлкайте по карте — номер в подписи растёт сам. Esc закончит",
  ],
  [
    "text",
    TextGlyph,
    "Текст",
    "t",
    "draw",
    "Надписи и готовые стили",
    "Щёлкните по карте и печатайте прямо на ней. Enter — новая строка, Esc или щелчок мимо — готово. Двойной щелчок по надписи — править",
  ],
  [
    "brush",
    PaintBrush,
    "Кисть",
    "b",
    "draw",
    "Маршрут от руки: сплошной, пунктир или точки",
    "Ведите мышью по карте — линия сглаживается и ложится кривыми. Толщина и цвет — справа",
  ],
  [
    "line",
    LineToolIcon,
    "Линия",
    "n",
    "draw",
    "Прямая от начала до конца: сплошная, пунктиром или точками",
    "Тяните от начала до конца — получится прямая. Shift — под углом 45°. Толщина и цвет — справа",
  ],
  [
    "arrow",
    ArrowToolIcon,
    "Стрелка",
    "a",
    "draw",
    "Прямая со стрелкой на конце или с двух концов",
    "Тяните от начала к острию стрелки. Shift — под углом 45°. «Две стрелки», толщина и цвет — справа",
  ],
  [
    "zones",
    ShapesGlyph,
    "Фигуры",
    "u",
    "draw",
    "Свои фигуры: контур, пунктир, точки, заливка",
    "Растяните фигуру по карте — хоть внутри другой, с Shift ровно. Готовую двигают за линию",
  ],
  [
    "eraser",
    EraserGlyph,
    "Ластик",
    "e",
    "draw",
    "Стирает то, чего коснётся",
    "Проведите по карте — значки, надписи, картинки и мазки, которых коснулся ластик, удалятся. Фигуру и зону — проведите по её границе",
  ],
  [
    "images",
    ImageSquare,
    "Картинки",
    "p",
    "draw",
    "Логотипы, PNG и GIF поверх карты",
    "Щёлкните по карте и выберите файл, перетащите картинку на карту или вставьте {mod}+V",
  ],
  [
    "labels",
    FontGlyph,
    "Подписи",
    "l",
    "sets",
    "Наборы подписей, шрифт и цвет",
    "Щёлкните по подписи на карте — откроется её экран: текст, шрифт, размер, цвет. Наборы — справа",
  ],
  [
    "schedule",
    CalendarBlank,
    "Расписание",
    "k",
    "sets",
    "Табло событий сервера на карте",
    "Табло встало на карту: тяните его, размер — за уголки, поворот — за ручку сверху. Двойной щелчок по тексту — правка прямо на табло, плюс под строками — новая строка",
  ],
  [
    "areas",
    MapGlyph,
    "Зоны",
    "z",
    "sets",
    "Территории и районы: заливка, граница, цвета",
    "Щёлкните по зоне или по её подписи на карте — откроется её экран. Наборы зон и их вид — справа",
  ],
  [
    "majestic",
    MapPinArea,
    "Метки Majestic",
    "j",
    "sets",
    "Тайники, ВЗА, зоны, рыбалка и другое с вики сервера",
    "Включайте нужные категории — они лягут на карту и уйдут в игру. У каждой — цвет, заливка зон, контур и размер значков",
  ],
  [
    "game",
    PadGlyph,
    "Карта в игре",
    "g",
    "sets",
    "Отдаление, чёткость и размытие за картой",
    "Как карта ведёт себя в самой игре: насколько отдаляется, насколько чёткая и размыта ли игра за ней",
  ],
  [
    "icons",
    MapPin,
    "Иконки",
    "o",
    "sets",
    "Значки карты игры: заменить, скрыть, своя картинка",
    "Выберите значок слева — справа его можно заменить значком игры, поставить свою картинку или скрыть. Значок меняется и на мини-карте, и на карте паузы",
  ],
  [
    "templates",
    SwatchGlyph,
    "Шаблоны",
    "i",
    "ready",
    "Разметка под сервер поверх вашей карты",
    "Выберите шаблон — зоны, круги и подписи сервера лягут на карту того вида, что выбран в «Карте». Смена шаблона не теряет ваших правок",
  ],
  [
    "layers",
    Stack,
    "Слои",
    "y",
    "layers",
    "Всё на карте списком: порядок, группы, скрыть, закрепить",
    "Щелчок по строке выделяет объект на карте, правый щелчок — «Изменить», скрыть, закрепить. Порядок — перетаскиванием",
  ],
].map(rowOf);

export const TOOL_IDS = Array.from(TOOL_ROWS, ({ id }) => id);

// Инструменты, закреплённые в конце колонки
export const PINNED_TOOLS = { layers: "end" };

// Группа колонки «Карта»: значок один, пункты — в переключателе над панелью
export const MAP_GROUP = Object.fromEntries([
  ["id", "map"],
  ["ids", ["labels", "schedule", "areas", "majestic", "game", "icons"]],
  ["label", "Карта"],
  ["icon", MapGlyph],
  ["group", "sets"],
  ["demo", "zone"],
]);

// Три кисти используют один холст
export const BRUSH_TOOLS = new Set(["brush", "line", "arrow"]);

// Строки управления: [клавиши, текст]; массив клавиш — несколько клавиш подряд
const WHEEL_ROW = ["Колесо", "приближение"];
const PAN_ROW = ["ПКМ", "двигать карту"];
const UNDO_ROW = [["Ctrl", "Z"], "отменить"];
const ANGLE_ROW = ["Shift", "линия и стрелка под 45°"];

export const GUIDE_BY_TOOL = {
  select: [
    ["Del", "удалить выбранное"],
    ["Shift", "поворот по 15°"],
  ],
  eraser: [[["[", "]"], "толщина"]],
  line: [ANGLE_ROW],
  arrow: [ANGLE_ROW],
  zones: [
    ["Shift", "ровная фигура"],
    ["Enter", "замкнуть свою"],
  ],
  markers: [["Esc", "закончить"]],
  schedule: [
    ["Двойной щелчок", "править текст на табло"],
    [["Shift", "Enter"], "вторая строчка названия"],
  ],
  text: [
    ["Enter", "новая строка"],
    ["Esc", "готово"],
  ],
};

export const GUIDE_COMMON = [WHEEL_ROW, PAN_ROW, UNDO_ROW];

// Вид следующей фигуры и следующей надписи
export const SHAPE_DEFAULT = Object.fromEntries([
  ["shape", "rect"],
  ["line", "solid"],
  ["fill", true],
  ["color", ""],
  ["width", null],
]);

export const TEXT_STYLE_DEFAULT = Object.fromEntries([
  ["font", "golos"],
  ["fontAssetId", ""],
  ["fontName", ""],
  ["weight", "black"],
  ["color", "#ffffff"],
  ["width", 1400],
  ["letterSpacing", 0],
  ["rotation", 0],
  ["opacity", 100],
  ["outline", 0],
  ["outlineColor", "#04060a"],
  ["glow", 0],
  ["glowColor", "#ffffff"],
]);

// Рабочий слой, с которого «Выбор» начинает поиск, по инструменту
export const LAYER_BY_TOOL = Object.fromEntries([
  ["zones", "zones"],
  ["markers", "markers"],
  ["text", "emblems"],
  ["images", "emblems"],
]);

// Константы острова Кайо-Перико и прочее
export const GAME_PREVIEW_KEY = "astral.worldMap.gamePreview.v2";
export const CLIPBOARD_MARK = "application/x-astral-map-object";
export const ERASER_MIN = 8;
export const ERASER_MAX = 4000;
export const ERASER_START = 160;
export const NOTICE_MS = 4000;
export const FRAME_DELAY_MS = 200;
export const ISLAND_DELAY_MS = 220;
export const FONT_PROBE_TEXT = "Аа Aa";
export const FONT_FILE_NAME = /\.(ttf|otf|woff2?)$/;
