import {
  Bank, Buildings, Door, Factory, Storefront, Warehouse, Wall, Ladder, Cube,
  Airplane, Bus, Car, RoadHorizon,
  Sun, CloudSun, Snowflake, Leaf, Tree, Mountains, Drop, Wind, Fire,
  Compass, MapPin, MapTrifold, Flag, FlagBanner, Polygon, LineSegments,
  Crosshair, CrosshairSimple, Target, ShootingStar, Knife, Baseball, Skull, Package, Wrench,
  Monitor, Presentation, FilmStrip, TextAa, Palette, Tag, Bell, Waveform, Sparkle, Lamp, Lightbulb,
  Gauge, Heartbeat, DotsThree, CalendarBlank, ShoppingBag, ShoppingCart, Trophy, TShirt, CoatHanger, UsersThree,
  Beard, Eyeglasses, Scissors,
} from "../../components/ui/icons.jsx";
import Paw from "../workshop/animals-editor/AnimalGlyph.jsx";

// Значки колонки каталога для рядов без снимка. Данные записаны литералами, чтобы
// shelfIcon работал с первого вызова, когда catalog-shelves.js собирает полки при загрузке.

const PACKS_SHELVES = {
  "packs/redux": Palette,
  "packs/seasons": Leaf,
  "packs/themes": Tag,
};

const IMPROVEMENTS_SHELVES = {
  "improvements/city": Buildings,
  "improvements/places": Storefront,
  "improvements/zones": Polygon,
  "improvements/lights": Lamp,
  "improvements/nature": Tree,
  "improvements/optimization": Gauge,
};

const EFFECTS_SHELVES = {
  "effects/tracers": ShootingStar,
  "effects/smoke": Wind,
  "effects/hits": Target,
  "effects/lighting": Lightbulb,
  "effects/weather": CloudSun,
};

const INTERFACE_SHELVES = {
  "interface/minimaps": Compass,
  "interface/reticles": Crosshair,
  "interface/scopes": CrosshairSimple,
  "interface/hud": Monitor,
  "interface/world-map": MapTrifold,
};

const SOUNDS_SHELVES = {
  "sounds/weapons": Waveform,
  "sounds/vehicles": Car,
  "sounds/ambience": Wind,
  "sounds/ui": Bell,
};

const SKINS_SHELVES = {
  "skins/gunpacks": Package,
  "skins/melee": Knife,
  "skins/attachments": Wrench,
};

const CLOTHING_SHELVES = {
  "clothing/packs": TShirt,
  /* Очки — свой знак (не картинка «Аксессуаров», 14.11.2026, ревью №11); причёска и борода — знаки набора Astral. */
  "clothing/glasses": Eyeglasses,
  "clothing/hair": Scissors,
  "clothing/beards": Beard,
};

const FOR_REDUX_SHELVES = {
  "for-redux/minimap": Compass,
  "for-redux/large-map": MapTrifold,
  "for-redux/hit-effects": Target,
  "for-redux/tracers": ShootingStar,
  "for-redux/kill-effects": Skull,
  "for-redux/fire-explosions": Fire,
  "for-redux/wheel-smoke": Wind,
  "for-redux/crosshair": Crosshair,
  "for-redux/target-hp": Heartbeat,
  "for-redux/group-markers": MapPin,
  "for-redux/fonts": TextAa,
  "for-redux/timecycle": CloudSun,
  "for-redux/lights": Lamp,
  "for-redux/climbing": Ladder,
  "for-redux/wallbang": Wall,
  "for-redux/animals": Paw,
  "for-redux/forbidden-zones": Polygon,
  "for-redux/capt-zones": FlagBanner,
  "for-redux/factory": Factory,
  "for-redux/hangar": Warehouse,
  "for-redux/mapping": Cube,
  "for-redux/water": Drop,
  "for-redux/vegetation": Tree,
  "for-redux/arenas": Trophy,
  "for-redux/mega-mall": ShoppingBag,
  "for-redux/ashan": ShoppingCart,
  "for-redux/shops": Storefront,
  "for-redux/vinewood": Mountains,
  "for-redux/busstops": Bus,
  "for-redux/billboards": Presentation,
  "for-redux/banners": Buildings,
  "for-redux/schedule": CalendarBlank,
  "for-redux/flags": Flag,
  "for-redux/atms": Bank,
  "for-redux/project-interiors": Door,
  "for-redux/majestic-interiors": Door,
  "for-redux/msl-zones": LineSegments,
  "for-redux/float-logo": Sparkle,
  "for-redux/airships": Airplane,
  "for-redux/roads": RoadHorizon,
  "for-redux/screen-hits": Monitor,
  "for-redux/other": DotsThree,
};

// Ключ "раздел/полка". Порядок разделов и полок - часть контракта.
export const SHELF_ICONS = Object.freeze({
  ...PACKS_SHELVES,
  ...IMPROVEMENTS_SHELVES,
  ...EFFECTS_SHELVES,
  ...INTERFACE_SHELVES,
  ...SOUNDS_SHELVES,
  ...SKINS_SHELVES,
  ...CLOTHING_SHELVES,
  ...FOR_REDUX_SHELVES,
});

// Запасной значок раздела: полка без собственной записи получает его.
const SECTION_FALLBACK = { clothing: CoatHanger };

// Подписи подразделов: пары "подпись, значок"; объект собирается при первом обращении.
const LABEL_PAIRS = [
  ["Весна и лето", Sun],
  ["Осень", Leaf],
  ["Зима", Snowflake],
  ["Семейные", UsersThree],
  ["Гетто", Sparkle],
  ["Медиа", FilmStrip],
  ["Дороги", RoadHorizon],
  ["Маппинг", Cube],
  ["Билборды", Presentation],
  ["Баннеры на зданиях", Buildings],
  ["Остановки", Bus],
  ["Флаги", Flag],
  ["Вайнвуд", Mountains],
  ["Летающее лого", Sparkle],
  ["Расписание", CalendarBlank],
  ["Интерьеры магазинов", Storefront],
  ["Мегамолл", ShoppingBag],
  ["Ашан / Икея", ShoppingCart],
  ["Завод", Factory],
  ["Ангар", Warehouse],
  ["Арены", Trophy],
  ["Зоны", Polygon],
  ["Зоны каптов", FlagBanner],
  ["МСЛ-зоны", LineSegments],
  ["Залазы", Ladder],
  ["Прострелы", Wall],
  ["Растительность", Tree],
  ["Вода", Drop],
  ["Фонари", Lamp],
  ["Оптимизация", Gauge],
  ["Трейсеры", ShootingStar],
  ["Дым", Wind],
  ["Попадания", Target],
  ["Освещение", Lightbulb],
  ["Погода", CloudSun],
  ["Мини-карты", Compass],
  ["Прицелы", Crosshair],
  ["Снайперские прицелы", CrosshairSimple],
  ["HUD", Monitor],
  ["Большая карта", MapTrifold],
  ["Оружие", Waveform],
  ["Транспорт", Car],
  ["Окружение", Wind],
  ["Интерфейс", Bell],
  ["Нож", Knife],
  ["Бита", Baseball],
];

let labelTable = null;

export function shelfIcon(section, id) {
  // Раздел читается дважды: текстом в ключе и как имя свойства запасной таблицы.
  return SHELF_ICONS[`${section}/${id}`] ?? SECTION_FALLBACK[section] ?? null;
}

export function labelIcon(label) {
  if (labelTable === null) labelTable = Object.fromEntries(LABEL_PAIRS);
  return labelTable[label] ?? null;
}
