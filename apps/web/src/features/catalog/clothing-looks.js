import { clothingOf, coverOf, variantsOf } from "../clothing/clothing-catalog.js";
import { colourFamily, queryColours } from "./search-concepts.js";

// Каждая вещь одежды в сетке — своя карточка, без листалки по расцветкам. Остаётся одна нужда:
// запрос называет цвет, а у вещи он не первый («розовая майка» для белой майки с розовой
// расцветкой) — тогда на карточку надо поставить кадр искомой расцветки.

// Вид собирается по полю за полем; образец читается дважды: сам и для семьи цвета.
function lookOf(variant) {
  const look = { key: variant.key };
  look.image = variant.image;
  look.swatch = variant.swatch;
  look.colour = colourFamily(variant.swatch);
  look.label = variant.setLabel;
  return look;
}

// Кадров нет совсем: один вид — обложка. Образец ей даёт первая расцветка, у которой он есть,
// даже если у той расцветки кадра нет.
function coverLook(item, variants) {
  const swatch = variants.find((variant) => variant.swatch)?.swatch ?? null;
  return { key: "cover", image: coverOf(item), swatch, colour: colourFamily(swatch), label: "" };
}

export function itemLooks(item) {
  const variants = variantsOf(item);
  const framed = variants.filter((variant) => variant.image);
  return framed.length ? framed.map(lookOf) : [coverLook(item, variants)];
}

// Семьи цвета по всем расцветкам вещи (и с кадром, и без) — для текста поиска.
export function itemColours(item) {
  if (!clothingOf(item)) return [];
  const found = [];
  for (const variant of variantsOf(item)) found.push(colourFamily(variant.swatch));
  return [...new Set(found.filter(Boolean))];
}

// Кадр расцветки, которую назвал запрос, если это не первый вид вещи и у него есть кадр.
function swappedImage(mod, wanted) {
  const looks = itemLooks(mod);
  // Берётся первый подошедший вид по порядку видов вещи, а не слов запроса.
  const at = looks.findIndex(({ colour }) => wanted.has(colour));
  return at > 0 && looks[at].image ? looks[at].image : null;
}

export function clothingLooks(list, query = "") {
  const picks = new Map();
  if (!query) return picks;
  const wanted = queryColours(query);
  if (!wanted.size) return picks;

  for (const mod of list) {
    const image = clothingOf(mod) ? swappedImage(mod, wanted) : null;
    if (image) picks.set(mod.id, image);
  }
  return picks;
}
