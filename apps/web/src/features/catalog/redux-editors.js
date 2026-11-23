import { isWorkshopEditorHidden } from "../workshop/hidden-editors.js";

export const OTHER_EDITOR = "other";

// Редакторы в порядке полки мастерской: id и подписи идут параллельно. Скрытые отсеиваются при загрузке.
const EDITOR_IDS =
  "minimap large-map hit-effects tracers kill-effects fire-explosions wheel-smoke crosshair target-hp group-markers fonts timecycle lights climbing wallbang forbidden-zones capt-zones factory hangar mapping water vegetation arenas mega-mall ashan shops project-interiors majestic-interiors vinewood busstops billboards banners schedule flags atms msl-zones float-logo airships roads screen-hits animals".split(
    " ",
  );
const EDITOR_LABELS =
  "Мини-карта|Большая карта|Эффекты попадания|Трейсеры|Килл-эффект|Огонь и взрывы|Настройка автомобиля|Прицел|Полоска HP|Групповые метки|Шрифты|Таймциклы|Фонари|Залазы|Прострелы|Зоны|Зоны каптов|Завод|Ангар|Маппинг|Вода|Растительность|Арены|Мегамолл|Ашан / Икея|Интерьеры магазинов|Интерьеры проектов|Интерьеры Majestic RP|Вайнвуд|Остановки|Билборды|Баннеры на зданиях|Расписание|Флаги|Банкоматы|МСЛ-зоны|Летающее лого|Дирижабли|Дороги|Эффекты попадания на экране|Животные|Прочее".split(
    "|",
  );

const shown = (ids) => ids.filter((id) => !isWorkshopEditorHidden(id));

export const REDUX_EDITORS = Object.freeze(
  [...EDITOR_IDS, OTHER_EDITOR].flatMap((id, at) => (isWorkshopEditorHidden(id) ? [] : [Object.freeze({ id, label: EDITOR_LABELS[at] })])),
);

// Группы колонки: id, подпись, значок и редакторы группы по порядку.
const GROUP_ROWS = [
  ["map", "Карта", "large-map", "minimap large-map target-hp group-markers forbidden-zones capt-zones msl-zones fonts"],
  ["effects", "Эффекты", "hit-effects", "hit-effects tracers kill-effects fire-explosions screen-hits"],
  ["vehicle", "Настройка автомобиля", "wheel-smoke", "wheel-smoke"],
  ["crosshair", "Прицел", "crosshair", "crosshair"],
  [
    "mapping",
    "Маппинг",
    "arenas",
    "arenas hangar factory mega-mall ashan shops project-interiors majestic-interiors vinewood busstops lights wallbang billboards banners schedule flags atms float-logo airships",
  ],
  ["world", "Мир", "vegetation", "timecycle vegetation water roads climbing animals"],
];

export const EDITOR_GROUPS = Object.freeze(
  GROUP_ROWS.map(([id, label, face, editors]) => Object.freeze({ id, label, face, editors: Object.freeze(shown(editors.split(" "))) })),
);

const GROUP_OF = new Map();
EDITOR_GROUPS.forEach((group) => group.editors.forEach((editor) => GROUP_OF.set(editor, group.id)));

export function editorGroupOf(editor) {
  return GROUP_OF.get(editor) ?? "";
}

// Таблицы «значение → редакторы»: Map «ключ → редактор» собирается из «редактор: ключи».
const invert = (table, split) => new Map(Object.entries(table).flatMap(([editor, keys]) => keys.split(split).map((key) => [key, editor])));

// Соседние полки мастерской. Пакеты «Эффектов» автора (слоты `component-groups.js`) — все на полке попаданий, привязки следа пули (`tracer-bindings`) — на полке трейсеров.
const SHELF_EDITOR = invert(
  {
    minimap: "minimap-zoom minimap-position blips",
    "large-map": "large-map-zoom world-map",
    "hit-effects": "blood-routing particle-effects effects-tables effects-core",
    tracers: "tracer-bindings",
    crosshair: "sniper-crosshair",
    "fire-explosions": "explosions",
    "wheel-smoke": "vehicle-smoke drift-smoke",
    shops: "interior gas-stations",
  },
  " ",
);

// Подписи подраздела и разбора: собственная подпись редактора (у перечисленных) и добавочные подписи.
const OWN_LABELED =
  "roads mapping billboards busstops flags atms project-interiors majestic-interiors vinewood float-logo schedule shops mega-mall ashan factory hangar arenas forbidden-zones capt-zones msl-zones climbing wallbang lights vegetation water tracers kill-effects hit-effects minimap crosshair large-map".split(
    " ",
  );

const LABEL_EDITOR = new Map([
  ...OWN_LABELED.map((editor) => [EDITOR_LABELS[EDITOR_IDS.indexOf(editor)], editor]),
  ...invert(
    {
      mapping: "Объекты|Здания",
      shops: "Интерьеры|Заправки",
      arenas: "Арена",
      lights: "Сирены",
      vegetation: "Деревья|Трава и кусты|Поверхность земли",
      "wheel-smoke": "Дым",
      "hit-effects": "Попадания",
      timecycle: "Освещение|Погода|Таймцикл",
      minimap: "Мини-карты|Положение мини-карты",
      crosshair: "Прицелы|Снайперские прицелы",
      "large-map": "Отдаление карты",
    },
    "|",
  ),
]);

const LISTED = new Set(REDUX_EDITORS.map(({ id }) => id));

// Первый найденный: полка (сама или соседняя), подпись подраздела, подпись разбора; скрытый или ненайденный — «Прочее».
export function reduxEditorOf({ slot = "", subcategory = "", categoryLabel = "", menuButtons = false } = {}) {
  if (menuButtons) return OTHER_EDITOR;
  const shelf = String(slot || "");
  const own = shelf !== OTHER_EDITOR && LISTED.has(shelf) ? shelf : SHELF_EDITOR.get(shelf);
  const found = own ?? LABEL_EDITOR.get(String(subcategory).trim()) ?? LABEL_EDITOR.get(String(categoryLabel).trim());
  return LISTED.has(found) ? found : OTHER_EDITOR;
}

const frozenSet = (list) => Object.freeze(new Set(list.split(" ")));

export const UNLISTED_PART_EDITORS = frozenSet("mapping climbing vegetation");
export const COLUMN_HIDDEN_EDITORS = frozenSet("mapping");
export const COLUMN_LABELS = Object.freeze({ fonts: "Другое" });

// Таблица подписей — обычный объект: имя из прототипа даёт значение прототипа.
export function columnLabelOf(editor, label) {
  return COLUMN_LABELS[editor] || label;
}

export function columnEditorOf(editor) {
  return COLUMN_HIDDEN_EDITORS.has(editor) ? OTHER_EDITOR : editor;
}
