import { CATEGORIES, GENDER_LABELS, SERVERS } from "@modovik/clothing/taxonomy";
import { normalizeClothingCard } from "@modovik/clothing/card";

export const PACKS_LABEL = "Комплекты";
export const SHOWCASE_PLACES = Object.freeze([...CATEGORIES.map(({ label }) => label), PACKS_LABEL]);
export const PACKS = "packs";
export const ALL = "all";

// ------------------------------------------------------------ блок одежды

// Вердикт проверки живёт рядом с самой карточкой: правки после первого вызова его не меняют.
const verdicts = new WeakMap();

const judge = (raw) => {
  try {
    return raw ? normalizeClothingCard(raw) : null;
  } catch {
    return null;
  }
};

export function clothingOf(mod) {
  if (mod === null || typeof mod !== "object") return null;
  if (!verdicts.has(mod)) verdicts.set(mod, judge(mod.domain?.clothing || mod.clothing));
  return verdicts.get(mod);
}

// Применяет `read` к блоку карточки или возвращает `fallback`, если блока нет.
function withBlock(mod, fallback, read) {
  const block = clothingOf(mod);
  return block === null ? fallback : read(block);
}

export const isTattooPack = (mod) => withBlock(mod, false, (block) => block.category === "tattoos" && !block.component);

// ------------------------------------------------------------ кадры и расцветки

export function galleryUrl(mod, source) {
  return source ? (mod.gallery || []).find((shot) => shot?.source === source)?.url || null : null;
}

const glyphsOf = ({ letter, letters }) => {
  const glyphs = Array.from(letters);
  return glyphs.length ? glyphs : [letter];
};

// Поля расцветки в том порядке, в каком они видны снаружи.
const VARIANT_FIELDS = [
  ["key", (set, variant) => `${set.id}:${variant.letter}`],
  ["setId", (set) => set.id],
  ["setLabel", (set) => set.label],
  ["letter", (set, variant) => variant.letter],
  ["letters", (set, variant) => glyphsOf(variant)],
  ["swatch", (set, variant) => variant.swatch],
  ["image", (set, variant, mod) => galleryUrl(mod, variant.preview)],
  ["imageAlt", (set, variant, mod) => galleryUrl(mod, variant.previewAlt)],
];

const variantRow = (mod, set, variant) =>
  Object.fromEntries(VARIANT_FIELDS.map(([name, make]) => [name, make(set, variant, mod)]));

export const variantsOf = (mod) =>
  withBlock(mod, [], ({ sets }) => sets.flatMap((set) => set.variants.map((variant) => variantRow(mod, set, variant))));

export function coverOf(mod) {
  const [framed] = variantsOf(mod).filter((variant) => variant.image);
  return framed?.image ?? (mod.cover || null);
}

// ------------------------------------------------------------ «Заменяет»

// Кого выбрать для сервера, по убыванию предпочтения: запись сервера, запись без сервера, первая.
const replacementPicks = (server) => [
  (entry) => server && server !== ALL && entry.server === server,
  (entry) => !entry.server,
  () => true,
];

export function replacementFor(mod, server = ALL) {
  return withBlock(mod, null, ({ replaces }) => {
    for (const pick of replacementPicks(server)) {
      const hit = replaces.find(pick);
      if (hit) return hit;
    }
    return null;
  });
}

// ------------------------------------------------------------ фильтры витрины

// Сервер подходит, если вещь названа на нём; либо она «общая» и карточка не ограничена другими платформами.
function servesOn(mod, block, server) {
  const { replaces } = block;
  if (replaces.some((entry) => entry.server === server)) return true;
  if (replaces.some((entry) => entry.server)) return false;
  const platforms = Array.isArray(mod.platforms) ? mod.platforms : [];
  return platforms.length === 0 || platforms.includes(server);
}

function haystackOf(mod, block) {
  const place = CATEGORIES.find(({ id }) => id === block.category);
  return [mod.name, mod.author, mod.description, place?.label]
    .concat(block.replaces.flatMap(({ name, shop }) => [name, shop]), block.sets.map((set) => set.label))
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru");
}

function wordsHit(mod, block, query) {
  const words = String(query || "").toLocaleLowerCase("ru").match(/\S+/g);
  if (words === null) return true;
  const haystack = haystackOf(mod, block);
  return words.every((word) => haystack.includes(word));
}

// Условия по именам фильтров: значение фильтра, блок и карточка.
const FILTER_TESTS = {
  gender: (wanted, block) => wanted === ALL || !block.gender || block.gender === wanted,
  category: (wanted, block) => wanted === ALL || wanted === block.category,
  server: (wanted, block, mod) => wanted === ALL || servesOn(mod, block, wanted),
  query: (wanted, block, mod) => wordsHit(mod, block, wanted),
};

export function matchesClothing(mod, filters = {}) {
  const { gender = ALL, category = ALL, server = ALL, query = "" } = filters;
  return withBlock(mod, false, (block) =>
    Object.entries({ gender, category, server, query }).every(([name, wanted]) => FILTER_TESTS[name](wanted, block, mod)),
  );
}

// ------------------------------------------------------------ счёт и списки

export function categoryCounts(mods, filters = {}) {
  const widened = { ...filters, category: ALL };
  const byCategory = [...(mods || [])].reduce((tally, mod) => {
    if (!matchesClothing(mod, widened)) return tally;
    const { category } = clothingOf(mod);
    return tally.set(category, (tally.get(category) ?? 0) + 1);
  }, new Map());
  return byCategory.set(ALL, [...byCategory.values()].reduce((sum, count) => sum + count, 0));
}

export function clothingMods(mods) {
  return (mods || []).filter((mod) => clothingOf(mod) !== null);
}

export function clothingPacks(mods) {
  return (mods || []).filter((mod) => clothingOf(mod) === null && [mod.catalogCategory, mod.catalogSection].includes("clothing"));
}

export { CATEGORIES, GENDER_LABELS, SERVERS };
