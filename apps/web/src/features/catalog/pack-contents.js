import { catalogCategoryForMod, isCatalogBundle, packMembers, postMates } from "../../catalog-utils.js";
import { packWeaponRows } from "./pack-weapons.js";
import { packContentsCopy } from "./pack-contents-copy.js";
import { soundPackMembers, soundRow } from "./sound-packs.js";
import { isMappingPiece, mappingSetOf } from "./mapping-sets.js";
import { conflictingMods } from "../../utils/catalogConflicts.js";
import { REDUX_BASE_SLOT, isReduxBase } from "./bundles/component-groups.js";
import { partKindOf } from "./part-kind.js";

// Строки таблиц: «ключ:значения через пробел»; пары «a:b» собираются в Map.
const rowsOf = (lines) => lines.map((line) => line.split(":"));
const pairsOf = (text) => new Map(text.split(" ").map((pair) => pair.split(":")));

// Группы по порядку заметности. От этого порядка зависит порядок плиток.
export const CONTENT_GROUPS = Object.freeze(
  rowsOf([
    "sky:timecycle weather graphics",
    "map:large-map large-map-zoom minimap",
    "world:mapping roads vegetation interior arenas climbing water lights",
    "weapons:gunpack weapon-sounds",
    "effects:tracers kill-effects hit-effects blood blood-routing muzzle-flash",
    "interface:crosshair sniper-crosshair hud",
    "sounds:",
    "clothing:",
    "carries:forbidden-zones capt-zones msl-zones",
    "optimization:optimization",
    "other:",
  ]).map(([id, slots]) => ({ id, slots: slots ? slots.split(" ") : [] })),
);

// Разделы окна «Компоненты»; звуки стоят с оружием.
export const CONTENT_SECTIONS = Object.freeze(
  rowsOf(["sky:sky", "map:map", "interface:interface", "world:world", "weapons:weapons sounds", "clothing:clothing", "effects:effects", "carries:carries", "optimization:optimization", "other:other"]).map(([id, groups]) =>
    Object.freeze({ id, groups: groups.split(" ") }),
  ),
);

const GROUP_OF_SLOT = new Map(CONTENT_GROUPS.flatMap(({ id, slots }) => slots.map((slot) => [slot, id])));
const SECTION_OF_GROUP = new Map(CONTENT_SECTIONS.flatMap(({ id, groups }) => groups.map((group) => [group, id])));
const GROUP_RANK = new Map(CONTENT_GROUPS.map(({ id }, at) => [id, at]));
const GROUP_OF_SECTION = pairsOf("gunpacks:weapons clothing:clothing");
const GROUP_OF_CATEGORY = pairsOf("timecycle:sky optimization:optimization world:world");
// Вид каталога → группа и добавочные имена части по виду — обычные объекты: имя из прототипа даёт значение прототипа.
const GROUP_OF_KIND = Object.fromEntries(pairsOf("skins:weapons sounds:sounds clothing:clothing effects:effects interface:interface"));
const EXTRA_NAMES = { vegetation: ["Трава и россыпь", "Трава", "Россыпь"] };
// Слоты, которые не указывают на конкретное место в игре.
const COMMON_SLOTS = new Set(["", "gunpack", "redux-pack", "outfit-pack", "mapping"]);

// Слот перебивает раздел, раздел — категорию, категория — вид каталога; первый найденный отвечает.
const GROUP_FINDERS = [
  /* «Основа редукса» лежит на полке маппинга (нарочно), но к миру не относится: её файлы без своего раздела — в «Прочем», а не в «Мире» рядом с настоящим маппингом. */
  (mod) => (isReduxBase(mod) ? "other" : undefined),
  (mod) => GROUP_OF_SLOT.get(mod.catalogSlot || ""),
  (mod) => GROUP_OF_SECTION.get(mod.catalogSection),
  (mod) => GROUP_OF_CATEGORY.get(mod.category),
  (mod) => GROUP_OF_KIND[mod.catalogCategory || catalogCategoryForMod(mod)],
];

export const contentGroupOf = (mod) => {
  for (const find of GROUP_FINDERS) {
    const group = find(mod);
    if (group != null) return group;
  }
  return "other";
};

export const contentSectionOf = (mod) => SECTION_OF_GROUP.get(contentGroupOf(mod)) ?? "other";

export { partKindOf };

const RUSSIAN_KINDS = packContentsCopy("ru").kinds;

export const partNamePrefixes = (part) => {
  const kind = partKindOf(part);
  const extras = EXTRA_NAMES[kind] ?? [];
  return [part?.categoryLabel, RUSSIAN_KINDS[kind], ...extras].filter(Boolean);
};

// Плитки одного списка в порядке групп; внутри группы — прежний порядок.
const byGroup = (tiles) =>
  tiles
    .map((tile) => [GROUP_RANK.get(contentGroupOf(tile.mod)) ?? -1, tile])
    .sort((a, b) => a[0] - b[0])
    .map(([, tile]) => tile);

// Части сборки: кусок маппинга из набора заменяется одной плиткой набора (первое появление).
const bundleTiles = (parts, allMods) =>
  parts.reduce((tiles, part) => {
    const pieces = isMappingPiece(part) ? mappingSetOf(part, allMods) : [];
    if (pieces.length < 2) return [...tiles, { mod: part, separate: false }];
    const shown = tiles.some((tile) => tile.pieces?.some((one) => one.id === part.id));
    return shown ? tiles : [...tiles, { mod: pieces[0], separate: false, pieces }];
  }, []);

// Сборка: части по группам, затем моды того же поста вне сборки (не сборки) — тоже по группам.
const bundleContents = (bundle, allMods) => {
  const parts = byGroup(bundleTiles(packMembers(bundle, allMods), allMods));
  const taken = new Set(parts.flatMap((tile) => (tile.pieces ?? [tile.mod]).map((one) => one.id)));
  const mates = postMates(bundle, allMods).filter((mate) => !taken.has(mate.id) && !isCatalogBundle(mate));
  return [...parts, ...byGroup(mates.map((mate) => ({ mod: mate, separate: true })))];
};

// Страница куска маппинга: весь его набор, текущий отмечен.
const pieceContents = (mod, allMods) => {
  const pieces = isMappingPiece(mod) ? mappingSetOf(mod, allMods) : [];
  return pieces.map((piece) => ({ mod: piece, separate: false, piece: true, current: piece.id === mod.id }));
};

export const packContents = (mod, allMods = [], language = "ru") => {
  if (!mod) return [];
  const sounds = soundPackMembers(mod, allMods);
  if (sounds.length > 0) return sounds.map((sound) => ({ mod: sound, separate: false, sound: soundRow(sound) }));
  if (isCatalogBundle(mod)) return bundleContents(mod, allMods);
  const pieces = pieceContents(mod, allMods);
  return pieces.length > 0 ? pieces : packWeaponRows(packMembers(mod, allMods), allMods, language).map((row) => ({ mod: row.mod, separate: false, weapon: row }));
};

// Предварительная подсказка: кого часть вытеснит — по месту в игре и по общему слоту с разделом.
export const partReplaces = (part, installed = [], allMods = []) => {
  if (!part || installed.includes(part.id)) return [];
  const sameSlot = (one) => one.id !== part.id && installed.includes(one.id) && one.catalogSlot === part.catalogSlot && one.catalogSection === part.catalogSection;
  const rivals = conflictingMods(part, installed, allMods).concat(COMMON_SLOTS.has(part.catalogSlot || "") ? [] : allMods.filter(sameSlot));
  const byId = new Map();
  rivals.forEach((one) => byId.set(one.id, one));
  return Array.from(byId.values());
};
