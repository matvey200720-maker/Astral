import { GlyphAll, GlyphClothing, GlyphEffects, GlyphImprovements, GlyphInterface, GlyphPacks, GlyphRedux, GlyphSkins, GlyphSounds } from "@astral/glyphs";

export const REDUX_ADDONS_SECTION = "for-redux";

// Списки подразделов: строки через «|».
const list = (text) => text.split("|");

const IMPROVEMENT_SUBCATEGORIES = Object.freeze(
  list("Дороги|Маппинг|Билборды|Остановки|Флаги|Банкоматы|Интерьеры проектов|Интерьеры Majestic RP|Вайнвуд|Летающее лого|Расписание|Интерьеры магазинов|Мегамолл|Ашан / Икея|Завод|Ангар|Арены|Зоны|Зоны каптов|МСЛ-зоны|Залазы|Прострелы|Фонари|Растительность|Вода|Оптимизация"),
);

const SKIN_SUBCATEGORIES = Object.freeze(
  list(
    "Ганпаки|Обвесы|Revolver MK2|Assault Rifle MK2|Carbine Rifle MK2|Special Carbine MK2|SMG MK2|Service Carbine|Combat PDW|Heavy Shotgun|Gusenberg|Advanced Rifle|Assault SMG|Assault Shotgun|Bullpup Rifle MK2|Compact Rifle|Combat MG MK2|Heavy Pistol|Heavy Sniper MK2|Sniper Rifle|Pump Shotgun MK2|Mini SMG|Micro SMG|MG|Machine Pistol|Military Rifle|Marksman Rifle MK2|Мушкет|Нож|Бита|Тазер|AP Pistol|Battle Rifle|Pistol SMG|Combat Shotgun|Heavy Rifle|Pistol|Pistol MK2|Combat Pistol|Pistol .50|SNS Pistol|SNS Pistol MK2|Vintage Pistol|Marksman Pistol|Heavy Revolver|Double Action Revolver|SMG|Assault Rifle|Carbine Rifle|Special Carbine|Bullpup Rifle|Pump Shotgun|Sawed-Off Shotgun|Bullpup Shotgun|Double Barrel Shotgun|Sweeper Shotgun|Combat MG|Heavy Sniper|Marksman Rifle|Precision Rifle|Grenade Launcher",
  ),
);

const SOUNDS_KIND = Object.freeze({
  id: "sounds",
  label: "Звуки",
  icon: GlyphSounds,
  subcategories: list("Оружие|Транспорт|Окружение|Интерфейс"),
});

// Разделы колонки каталога, по порядку. «Звуки» — копия вида с флагом hideSubcategories.
export const publicCatalogCategories = [
  { id: "all", label: "Все", icon: GlyphAll, subcategories: [] },
  { id: "redux", label: "Редуксы", icon: GlyphRedux, subcategories: [] },
  { id: "skins", label: "Ганпаки", icon: GlyphSkins, subcategories: SKIN_SUBCATEGORIES },
  { ...SOUNDS_KIND, hideSubcategories: true },
  { id: "clothing", label: "Одежда", icon: GlyphClothing, subcategories: [] },
  { id: "for-redux", label: "Для редуксов", icon: GlyphPacks, subcategories: [] },
];

const kind = (id, label, icon, subcategories) => ({ id, label, icon, subcategories });

// Надстройки редуксов: у «Улучшений» список подразделов общий с видом.
export const reduxAddonKinds = Object.freeze([
  kind("improvements", "Улучшения", GlyphImprovements, IMPROVEMENT_SUBCATEGORIES),
  kind("effects", "Эффекты", GlyphEffects, list("Трейсеры|Дым|Попадания|Освещение|Погода")),
  kind("interface", "Интерфейс", GlyphInterface, list("Мини-карты|Прицелы|Снайперские прицелы|HUD|Большая карта")),
]);

export const REDUX_ADDON_KINDS = Object.freeze(list("improvements|effects|interface"));
export const ALL_SECTION_SCOPE = Object.freeze(list("redux|skins|clothing"));
export const ALL_SECTION_PART_KINDS = Object.freeze(list("interface|effects"));

export const catalogKinds = Object.freeze([
  kind("redux", "Редуксы", GlyphRedux, []),
  kind("packs", "Сборки", GlyphPacks, list("Семейные|Гетто|Медиа|Весна и лето|Осень|Зима")),
  kind("improvements", "Улучшения", GlyphImprovements, IMPROVEMENT_SUBCATEGORIES),
  kind("effects", "Эффекты", GlyphEffects, list("Трейсеры|Дым|Попадания|Освещение|Погода")),
  kind("interface", "Интерфейс", GlyphInterface, list("Мини-карты|Прицелы|Снайперские прицелы|HUD|Большая карта")),
  SOUNDS_KIND,
  kind("skins", "Ганпаки", GlyphSkins, SKIN_SUBCATEGORIES),
  kind("clothing", "Одежда", GlyphClothing, []),
]);

// Полка мастерской → подраздел улучшений: полки одной группы через «+» делят подраздел с тем же номером.
export const IMPROVEMENT_SLOT_LABELS = Object.freeze(
  Object.fromEntries(
    "roads mapping billboards busstops flags atms project-interiors majestic-interiors vinewood float-logo schedule shops+gas-stations+interior mega-mall ashan factory hangar arenas forbidden-zones capt-zones msl-zones climbing wallbang lights vegetation water optimization+fast-entry"
      .split(" ")
      .flatMap((group, at) => group.split("+").map((slot) => [slot, IMPROVEMENT_SUBCATEGORIES[at]])),
  ),
);

// Старая подпись разбора → подраздел улучшений («подпись:номер подраздела»).
export const LEGACY_IMPROVEMENT_LABELS = Object.freeze(
  Object.fromEntries(
    "Объекты:1 Здания:1 Интерьеры:11 Заправки:11 Сирены:22 Патчи:25 Внешность:25".split(" ").map((pair) => {
      const [old, at] = pair.split(":");
      return [old, IMPROVEMENT_SUBCATEGORIES[at]];
    }),
  ),
);

// Любой вид, кроме трёх надстроек, возвращается как есть — без проверок.
export const catalogSectionOfKind = (kindId) => (REDUX_ADDON_KINDS.includes(kindId) ? REDUX_ADDONS_SECTION : kindId);

export const catalogSectionOfMod = (mod) => (mod?.catalogUnlisted ? null : catalogSectionOfKind(mod?.catalogCategory));

// Ганпак как набор: подраздел, полка, признак блока оружия или состав.
export const isGunpackMod = (mod) =>
  Boolean(mod?.catalogSubcategory === "Ганпаки" || [mod?.catalogSlot, mod?.slot].includes("gunpack") || mod?.domain?.weapon?.pack === true || mod?.includedModIds?.length);

// Таблицы читаются обычным свойством: ключи прототипа дают функции.
export const catalogSubcategoryOf = (section, mod) => {
  const label = String(mod?.catalogSubcategory || "");
  if (section !== "improvements") return label;
  return IMPROVEMENT_SLOT_LABELS[mod?.slot] || LEGACY_IMPROVEMENT_LABELS[label] || label;
};
