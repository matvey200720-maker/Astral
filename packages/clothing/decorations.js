// Разбор файла наложений педа (PedDecorationCollection) и поиск их картинок среди записей архивов.

const zone = (id, label) => Object.freeze({ id, label });

export const DECORATION_ZONES = Object.freeze({
  ZONE_HEAD: zone("head", "Голова"),
  ZONE_TORSO: zone("torso", "Торс"),
  ZONE_LEFT_ARM: zone("left-arm", "Левая рука"),
  ZONE_RIGHT_ARM: zone("right-arm", "Правая рука"),
  ZONE_LEFT_LEG: zone("left-leg", "Левая нога"),
  ZONE_RIGHT_LEG: zone("right-leg", "Правая нога"),
});

// Объект обычный: имя наследуемого свойства как пол даёт функцию намеренно.
const GENDERS = { GENDER_MALE: "male", GENDER_FEMALE: "female" };

const COLLECTION_TAG = /<PedDecorationCollection[\s>]/;
const COMMENT = /<!--[\s\S]*?-->/g;
const PRESETS_BLOCK = /<presets\s*>([\s\S]*?)<\/presets>/;
const MEDALS_BLOCK = /<medalLocations\s*>[\s\S]*?<\/medalLocations>/;
const ITEM_BLOCK = /<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/g;

function asText(value) {
  return String(value || "");
}

// Открывающий тег узнаётся и в самозакрытом виде: следующий настоящий тег тогда попадает в текст.
function tagText(source, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(source);
  return match?.[1].trim() || null;
}

function attribute(source, tag, name) {
  const attributes = new RegExp(`<${tag}\\s([^>]*)>`).exec(source)?.[1];
  if (attributes === undefined) return null;
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)?.[1] ?? null;
}

function numberAttribute(source, tag, name, fallback) {
  const value = Number.parseFloat(attribute(source, tag, name));
  return Number.isFinite(value) ? value : fallback;
}

function isTrueAttribute(source, tag) {
  return attribute(source, tag, "value") === "true";
}

function pairAttribute(source, tag, fallback) {
  return {
    x: numberAttribute(source, tag, "x", fallback),
    y: numberAttribute(source, tag, "y", fallback),
  };
}

function readPreset(body) {
  const name = tagText(body, "nameHash");
  const txd = tagText(body, "txdHash");
  if (!name || !txd) return null;
  const zoneName = tagText(body, "zone");
  const type = tagText(body, "type");
  return {
    name,
    txd,
    texture: tagText(body, "txtHash"),
    zone: DECORATION_ZONES[zoneName]?.id ?? null,
    zoneName,
    type: type === null ? null : type.replace(/^TYPE_/, "").toLowerCase(),
    gender: GENDERS[tagText(body, "gender")] ?? null,
    faction: tagText(body, "faction"),
    garment: tagText(body, "garment"),
    uv: pairAttribute(body, "uvPos", 0.5),
    scale: pairAttribute(body, "scale", 1),
    rotation: numberAttribute(body, "rotation", "value", 0),
    tint: isTrueAttribute(body, "usesTintColor"),
  };
}

export function decorationZone(id) {
  return Object.values(DECORATION_ZONES).find((entry) => entry.id === id) ?? null;
}

export function isDecorationCollection(text) {
  return COLLECTION_TAG.test(asText(text));
}

export function parseDecorationCollection(text) {
  const source = asText(text).replace(COMMENT, "");
  if (!COLLECTION_TAG.test(source)) return null;

  const block = PRESETS_BLOCK.exec(source)?.[1] ?? "";
  const presets = [];
  for (const [, body] of block.matchAll(ITEM_BLOCK)) {
    const preset = readPreset(body);
    if (preset) presets.push(preset);
  }
  return {
    name: tagText(source.replace(PRESETS_BLOCK, "").replace(MEDALS_BLOCK, ""), "nameHash"),
    requiredForSync: isTrueAttribute(source, "bRequiredForSync"),
    presets,
  };
}

export function tattoosOf(collection) {
  return (collection?.presets || []).filter((row) => row.type === "tattoo" && row.zone);
}

export function linkDecorationTextures(presets, paths) {
  const entries = new Map();
  for (const path of paths) {
    const file = asText(path).split(/[\\/]/).pop().toLowerCase();
    if (file.endsWith(".ytd") && !entries.has(file)) entries.set(file, path);
  }
  return presets.map((preset) => ({
    ...preset,
    entry: entries.get(`${String(preset.txd).toLowerCase()}.ytd`) ?? null,
  }));
}

export function decorationKey({ collection, name }) {
  return `${asText(collection).toLowerCase()}|${asText(name).toLowerCase()}`;
}
