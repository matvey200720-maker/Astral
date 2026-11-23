// Полки колонки каталога: какие полки у раздела, на какой стоит мод, сколько модов на каждой.
import { tr } from "../../locales/ui.js";
import { REDUX_ADDONS_SECTION, publicCatalogCategories, catalogSectionOfMod } from "../../components/desktop/catalog/catalogSections.js";
import { clothingOf } from "../clothing/clothing-catalog.js";
import { CLOTHING_SECTIONS, clothingSectionOf } from "./clothing-sections.js";
import { REDUX_EDITORS, COLUMN_HIDDEN_EDITORS, columnLabelOf, OTHER_EDITOR } from "./redux-editors.js";
import { shelfIcon as iconFor } from "./catalog-row-icons.js";
import { WEAPONS } from "@modovik/rpf-inspector/weapon-identity";

export const CLOTHING_PACKS_SHELF = "packs";

/* ---------- таблицы данных ----------
   Строки таблицы — по строке текста; поля разделены «|», список внутри поля — «;». */

const rowsOf = (text) => text.trim().split(/\r?\n/).map((line) => line.split("|"));
const listOf = (cell) => cell.split(";");

// Обложки разделов; в «Всех» используются только redux, skins, sounds, clothing, for-redux.
const COVER_TABLE = `
redux|/media/catalog/redux/redux-1.jpg
packs|/media/catalog/redux/redux-2.jpg
improvements|/media/showcase/vegetation-lake.webp
effects|/media/redux/tracers.webp
interface|/media/redux/minimap.png
sounds|
skins|/media/astral-gunpacks.webp
clothing|/media/astral-outfit-packs.webp
for-redux|/media/showcase/vegetation-lake.webp
`;

// Статические разделы: раздел | id полки | подпись | подписи подразделов | картинка.
const STATIC_TABLE = `
packs|seasons|Сезоны|Весна и лето;Осень;Зима|/media/showcase/vegetation-autumn.webp
packs|themes|Тематические|Семейные;Гетто;Медиа|/media/astral-redux-packs.jpg
improvements|city|Город|Дороги;Маппинг;Билборды;Остановки;Флаги;Банкоматы;Интерьеры проектов;Интерьеры Majestic RP;Вайнвуд;Летающее лого;Расписание|/media/showcase/roads-white.webp
improvements|places|Места|Интерьеры магазинов;Мегамолл;Ашан / Икея;Завод;Ангар;Арены|
improvements|zones|Зоны и метки|Зоны;Зоны каптов;МСЛ-зоны;Залазы;Прострелы|
improvements|lights|Фонари|Фонари|/media/showcase/lights-cyan.webp
improvements|nature|Природа|Растительность;Вода|/media/showcase/vegetation-forest.webp
improvements|optimization|Оптимизация|Оптимизация|
effects|tracers|Трейсеры|Трейсеры|/media/redux/tracers.webp
effects|smoke|Дым|Дым|/media/showcase/tires-red-smoke.webp
effects|hits|Попадания|Попадания|/media/redux/hit-effects.png
effects|lighting|Освещение|Освещение|/media/showcase/lights-violet.webp
effects|weather|Погода|Погода|/media/showcase/sky-dawn.webp
interface|minimaps|Мини-карты|Мини-карты|/media/redux/minimap.png
interface|reticles|Прицелы|Прицелы|/media/mod-crosshair-green.png
interface|scopes|Снайперские прицелы|Снайперские прицелы|/media/mod-crosshair-pink.png
interface|hud|HUD|HUD|
interface|world-map|Большая карта|Большая карта|/media/redux/world-map.webp
sounds|weapons|Оружие|Оружие|
sounds|vehicles|Транспорт|Транспорт|
sounds|ambience|Окружение|Окружение|
sounds|ui|Интерфейс|Интерфейс|
`;

// Семейства ганпаков по порядку полок: семейство (оно же id полки) | подпись | кадр полки.
const FAMILY_TABLE = `
pistol|Пистолеты|pistol
smg|Пистолеты-пулемёты|smg
rifle|Винтовки|carbine-rifle
shotgun|Дробовики|pump-shotgun
sniper|Снайперские винтовки|heavy-sniper
machinegun|Пулемёты|combat-mg
launcher|Тяжёлое оружие|grenade-launcher
melee|Холодное|
`;

// Иконки справочника для стволов без полки мастерской: подпись | файл.
const ICON_TABLE = `
SNS Pistol|sns-pistol
SNS Pistol MK2|sns-pistol-mk2
Vintage Pistol|vintage-pistol
Marksman Pistol|marksman-pistol
Revolver MK2|revolver-mk2
Double Action Revolver|double-action-revolver
Machine Pistol|machine-pistol
Pistol SMG|pistol-smg
Assault Rifle MK2|assault-rifle-mk2
Bullpup Rifle MK2|bullpup-rifle-mk2
Compact Rifle|compact-rifle
Military Rifle|military-rifle
Heavy Rifle|heavy-rifle
Battle Rifle|battle-rifle
Мушкет|musket
Pump Shotgun MK2|pump-shotgun-mk2
Sweeper Shotgun|sweeper-shotgun
Combat Shotgun|combat-shotgun
Combat MG MK2|combat-mg-mk2
Marksman Rifle MK2|marksman-rifle-mk2
Precision Rifle|precision-rifle
`;

// Значки-картинки видов одежды: «вид» или «вид=файл», если файл называется иначе.
const PICTURE_LIST =
  "tshirts pants shoes masks hats accessories gloves armor tattoos bags government-clothing";

const WEAPON_FRAMES = "/assets/catalog/weapons";
const WEAPON_ICONS = "/assets/catalog/weapon-icons";
const CLOTHING_ICONS = "/assets/catalog/clothing";

/* ---------- устройство полки ---------- */

const frozen = Object.freeze;
const emptyLabels = () => frozen([]);

// Порядок ключей полки каждого вида — часть контракта.
const LAYOUTS = Object.fromEntries(
  Object.entries({
    plain: "id label labels image thumb icon",
    framed: "id label labels image thumb",
    wardrobe: "id label labels image thumb icon thumbGlyph wear core",
    kit: "id label labels image icon thumbGlyph packs core",
    editor: "id label labels image thumb icon editor core",
    overview: "id label labels image section icon",
    redux: "id label labels image thumb avatar redux group",
    portrait: "src letter",
  }).map(([kind, keys]) => [kind, keys.split(" ")]),
);

const forge = (kind, ...values) =>
  frozen(Object.fromEntries(LAYOUTS[kind].map((key, at) => [key, values[at]])));

const covers = new Map(rowsOf(COVER_TABLE));
const pictures = new Map(
  PICTURE_LIST.split(" ").map((entry) => {
    const [kind, file = kind] = entry.split("=");
    return [kind, `${CLOTHING_ICONS}/${file}.svg`];
  }),
);

/* ---------- полки, собираемые при загрузке ---------- */

const staticShelf = ([section, id, label, labels, image]) =>
  forge("plain", id, label, frozen(listOf(labels)), image || null, null, iconFor(section, id));

// Подписи семейств: уникальные catalog записей таблицы оружия в её порядке.
const catalogOf = new Map();
for (const { family, catalog } of WEAPONS) {
  if (!catalog) continue;
  if (!catalogOf.has(family)) catalogOf.set(family, new Set());
  catalogOf.get(family).add(catalog);
}

const familyShelf = ([family, label, frame]) => {
  const labels = frozen([...(catalogOf.get(family) ?? [])]);
  const picture = frame && `${WEAPON_FRAMES}/${frame}.webp`;
  return picture
    ? forge("framed", family, label, labels, picture, picture)
    : forge("plain", family, label, labels, null, null, iconFor("skins", family));
};

const editorShelves = REDUX_EDITORS.filter(({ id }) => !COLUMN_HIDDEN_EDITORS.has(id)).map(
  ({ id, label }) =>
    forge(
      "editor",
      id,
      columnLabelOf(id, label),
      emptyLabels(),
      null,
      null,
      iconFor(REDUX_ADDONS_SECTION, id),
      id,
      id !== OTHER_EDITOR,
    ),
);

/* «Оптимизация» — пункт меню каталога «2.0»: редактора мастерской у неё нет, полка своя (мод находит её по слоту, `menu/menu-editors.js`). */
editorShelves.push(forge("editor", "optimization", "Оптимизация", emptyLabels(), null, null, iconFor("improvements", "optimization"), "optimization", true));

const staticBySection = new Map();
for (const row of rowsOf(STATIC_TABLE)) {
  if (!staticBySection.has(row[0])) staticBySection.set(row[0], []);
  staticBySection.get(row[0]).push(staticShelf(row));
}

// Обычный объект: имя раздела читается как свойство, в том числе прототипное (так и задумано).
const SECTION_SHELVES = Object.fromEntries([
  [REDUX_ADDONS_SECTION, editorShelves],
  ...staticBySection,
  ["skins", rowsOf(FAMILY_TABLE).map(familyShelf)],
]);

/* ---------- полки, собираемые на каждый вызов ---------- */

const overviewShelves = () =>
  publicCatalogCategories
    .filter(({ id }) => id !== "all")
    .map(({ id, label, icon }) => forge("overview", id, label, emptyLabels(), covers.get(id) || null, id, icon));

/* Подкатегории «Одежды» (14.11.2026, `clothing-sections.js`): по виду вещи сверху вниз по телу; вещь стоит в одной. */
const wardrobeShelf = ({ id, label }) => {
  const picture = pictures.get(id) ?? null;
  return forge(
    "wardrobe",
    id,
    label,
    emptyLabels(),
    picture,
    picture,
    picture ? null : iconFor("clothing", id),
    true,
    id,
    true,
  );
};

const wardrobeShelves = () => [
  ...CLOTHING_SECTIONS.map(wardrobeShelf),
  forge(
    "kit",
    CLOTHING_PACKS_SHELF,
    tr("Комплекты"),
    emptyLabels(),
    covers.get("clothing"),
    iconFor("clothing", CLOTHING_PACKS_SHELF),
    true,
    true,
    true,
  ),
];

const PER_CALL = new Map([
  ["all", overviewShelves],
  ["clothing", wardrobeShelves],
]);

/* ---------- признаки полки: одна таблица правил для проверки и для счёта ----------
   Правило решает, когда у полки задан его признак (decides, по порядку: первое сработавшее),
   как проверяется один мод (fits), что читается у мода для счёта (read) и какие значения
   этого признака ищутся у полки (keys). */

const NOTHING = Symbol("нет значения");
const isLoose = (mod) => mod?.catalogCategory === "clothing" && !clothingOf(mod);
const wearOf = (mod) => clothingSectionOf(mod) ?? NOTHING;

const AXES = [
  {
    axis: "section",
    decides: (shelf) => shelf.section,
    read: (mod) => catalogSectionOfMod(mod),
    keys: (shelf) => [shelf.section],
    fits: (mod, shelf) => catalogSectionOfMod(mod) === shelf.section,
  },
  {
    axis: "editor",
    decides: (shelf) => shelf.editor,
    read: (mod) => mod?.catalogEditor,
    keys: (shelf) => [shelf.editor],
    fits: (mod, shelf) => mod?.catalogEditor === shelf.editor,
  },
  {
    axis: "redux",
    decides: (shelf) => shelf.redux,
    read: (mod) => mod?.reduxGroup,
    keys: (shelf) => [shelf.id],
    fits: (mod, shelf) => mod?.reduxGroup === shelf.id,
  },
  {
    axis: "wear",
    decides: (shelf) => shelf.wear,
    read: wearOf,
    keys: (shelf) => [shelf.wear],
    fits: (mod, shelf) => clothingSectionOf(mod) === shelf.wear,
  },
  {
    axis: "packs",
    decides: (shelf) => shelf.packs,
    read: (mod) => (isLoose(mod) ? true : NOTHING),
    keys: () => [true],
    fits: isLoose,
  },
  {
    // подписи подразделов решают, когда у полки нет других признаков
    axis: "label",
    decides: () => true,
    read: (mod) => mod?.catalogSubcategory,
    keys: (shelf) => new Set(shelf.labels),
    fits: (mod, shelf) => shelf.labels.includes(mod?.catalogSubcategory),
  },
];

const axisOf = (shelf) => AXES.find((rule) => rule.decides(shelf));

/* ---------- публичные функции ---------- */

export const shelvesFor = (section) => PER_CALL.get(section)?.() ?? SECTION_SHELVES[section] ?? [];

// Первая полка раздела, удовлетворяющая проверке; нет такой — null.
// Раздел из имён прототипа даёт не массив: перебор падает TypeError, как и должен.
const firstShelf = (section, test) => {
  for (const item of shelvesFor(section)) if (test(item)) return item;
  return null;
};

export const shelfById = (section, id) => firstShelf(section, (item) => item.id === id);

export const shelfOfLabel = (section, label) =>
  label ? firstShelf(section, (item) => item.labels.includes(label)) : null;

export const modOnShelf = (mod, shelf) => (shelf ? axisOf(shelf).fits(mod, shelf) : true);

export function shelfCountsOf(mods, items) {
  const axes = items.map((shelf) => (shelf ? axisOf(shelf) : null));
  const used = [...new Set(axes.filter(Boolean))];
  const seen = new Map(used.map((rule) => [rule.axis, new Map()]));
  let total = 0;
  for (const mod of mods) {
    total += 1;
    for (const rule of used) {
      const value = rule.read(mod);
      if (value === NOTHING) continue;
      const tally = seen.get(rule.axis);
      tally.set(value, (tally.get(value) ?? 0) + 1);
    }
  }
  const counts = new Map();
  items.forEach((shelf, at) => {
    const rule = axes[at];
    const found = rule
      ? [...rule.keys(shelf)].reduce((sum, key) => sum + (seen.get(rule.axis).get(key) ?? 0), 0)
      : total;
    counts.set(shelf?.id, found);
  });
  return counts;
}

// Порядок строк зависит от языка среды: язык в сравнение не передаётся намеренно.
const NAME_ORDER = { numeric: true, sensitivity: "base" };
const byName = (a, b) => a.name.localeCompare(b.name, undefined, NAME_ORDER);

export function reduxShelves(groups = []) {
  return [...groups]
    .sort(byName)
    .map((group) =>
      forge(
        "redux",
        group.id,
        group.name,
        emptyLabels(),
        group.cover || null,
        null,
        forge("portrait", group.avatar, group.monogram),
        true,
        group,
      ),
    );
}

/* ---------- силуэты стволов ---------- */

// Сначала иконки справочника, потом кадры полок мастерской: при совпадении подписи побеждает второе.
const silhouettes = new Map();
for (const [label, file] of rowsOf(ICON_TABLE)) silhouettes.set(label, `${WEAPON_ICONS}/${file}.png`);
for (const { catalog, shelf } of WEAPONS) {
  if (catalog && shelf) silhouettes.set(catalog, `${WEAPON_FRAMES}/${shelf}.webp`);
}

export const labelThumb = (label) => silhouettes.get(label) ?? null;
