// Латинские слаги, подписи паков, id пака и ключи снимков студии.

const CYRILLIC_TO_LATIN = new Map(
  Object.entries({
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  }),
);

const ARCHIVE_SUFFIX = /\.(?:zip|7z|rar|oiv|rpf)$/i;
const SUFFIX_WORD = "gunpack";
const LABEL_SLUG_LIMIT = 32;
const VARIANT_SLUG_LIMIT = 16;
const PACK_ID_LIMIT = 80;

const transliterate = (text) =>
  Array.from(text, (char) => CYRILLIC_TO_LATIN.get(char) ?? char).join("");

export function slugify(value, limit = 40) {
  const latin = transliterate((value ? String(value) : "").toLowerCase());
  return latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit)
    .replace(/-+$/, "");
}

export function packLabel(name) {
  return (name ? String(name) : "").replace(ARCHIVE_SUFFIX, "").replace(/_+/g, " ").trim();
}

export function packId(label, variant = "") {
  const parts = [
    slugify(label, LABEL_SLUG_LIMIT) || SUFFIX_WORD,
    slugify(variant, VARIANT_SLUG_LIMIT),
    SUFFIX_WORD,
  ];
  return parts.filter(Boolean).join("-").replace(/-+/g, "-").slice(0, PACK_ID_LIMIT);
}

export function shotKey(variant, model) {
  const label = slugify(variant?.label || variant?.key || "", 40) || "pack";
  return `${label}--${model}`;
}

export function cardKey(variant, model) {
  return `${shotKey(variant, model)}.card`;
}

export function coverKey(variant) {
  return shotKey(variant, "cover");
}
