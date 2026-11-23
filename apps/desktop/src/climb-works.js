// Свои залазы Astral для каталога: список вариантов, модуль мастерской «Залазы» для варианта,
// запрос обложки у окна-съёмщика и заявка варианта для «Входящих».
import * as climb from "@modovik/climb-contract";

export const VARIANT_AUTHOR = "Astral";
export const VARIANT_COVER_CAPTION = "";

// ---- варианты

// Готовые виды редактора: пресет контракта целиком, кроме «Как в игре».
function fromPreset(preset) {
  const { id, label, description } = preset;
  return { id, preset: id, name: label, description };
}

// Свои сочетания цветов: пресет-основа задаёт формы меток, отличия стиля накладываются поверх.
const flat = (fill, outline, glow) => ({ fill, outline, glow });
const gradient = (fill, fill2, outline, glow) => ({ gradient: true, fill, fill2, outline, glow });

function fromRow(row) {
  const [id, preset, name, description, style] = row;
  return { id, preset, name, description, style };
}

const OWN_VARIANT_ROWS = [
  [
    "violet",
    "neon",
    "Фиолетовый неон",
    "Фиолетовое свечение, шевроны и надписи с клавишей.",
    flat("#b388ff", "#120a24", 55),
  ],
  [
    "orange",
    "signal",
    "Оранжевый",
    "Оранжевые метки с тёмным краем — видно на любом фоне.",
    flat("#ff9100", "#1a0d00", 30),
  ],
  ["mint", "minimal", "Мятный", "Тонкие мятные метки с мягким свечением.", flat("#64ffda", "#00261e", 40)],
  [
    "sunset",
    "neon",
    "Закат",
    "Градиент от кораллового к золотому, тёплое свечение.",
    gradient("#ff5f6d", "#ffc371", "#1d0710", 45),
  ],
  [
    "ocean",
    "ice",
    "Океан",
    "Градиент от бирюзы к синему, холодное свечение.",
    gradient("#00c6ff", "#0072ff", "#00111f", 45),
  ],
  [
    "toxic",
    "acid",
    "Токсичный",
    "Градиент от лимонного к зелёному, яркое свечение.",
    gradient("#d4fc79", "#56e39f", "#0b1a05", 60),
  ],
];

// Замораживается сам массив и каждый вариант; вложенный style остаётся изменяемым.
function listVariants() {
  const variants = [];
  for (const preset of climb.CLIMB_PRESETS) {
    if (preset.id !== "mod") variants.push(Object.freeze(fromPreset(preset)));
  }
  for (const row of OWN_VARIANT_ROWS) variants.push(Object.freeze(fromRow(row)));
  return variants;
}

export const CLIMB_VARIANTS = Object.freeze(listVariants());

// ---- модуль варианта

function presetOf(variant) {
  return climb.CLIMB_PRESETS.find((preset) => preset.id === variant.preset) ?? {};
}

// Проект собирается шагами: пустой проект → формы и цвета пресета → отличия стиля варианта.
export function variantModule(variant) {
  let design = climb.normalizeClimbDesign({});
  design = climb.applyClimbPreset(design, presetOf(variant));
  if (variant.style) {
    design = climb.normalizeClimbDesign({ ...design, style: { ...design.style, ...variant.style } });
  }
  return climb.normalizeClimbModule({ design });
}

// ---- обложка

function encodeCoverFile(module) {
  const document = { kind: "climbs", modules: { climbs: module } };
  return new TextEncoder().encode(JSON.stringify(document));
}

function shotRequest(name, module) {
  const files = [{ name: "cover.json", bytes: encodeCoverFile(module) }];
  return { kind: "redux-part", partKind: "workshop-cover", name, files };
}

// Из ответа съёмщика читается только png; кадр без длины (или без самого png) — null.
function coverFrom(shot) {
  return shot?.png?.length ? { cover: shot.png } : null;
}

export async function climbVariantMedia(request) {
  const { module, name, render } = request;
  if (typeof render !== "function") return null;
  const shot = await render(shotRequest(name, module));
  return coverFrom(shot);
}

// ---- заявка

const CARD_TAIL =
  " Открывается в мастерской: цвет, обводку, свечение и вид каждой метки можно поменять как в своей работе.";

// Поля карточки, одинаковые у всех вариантов, в порядке заявки.
const CARD_CONSTANTS = [
  ["author", VARIANT_AUTHOR],
  ["category", "world"],
  ["categoryLabel", "Залазы"],
  ["section", "other"],
  ["slot", "climbing"],
  ["catalogCategory", "improvements"],
  ["catalogSubcategory", "Залазы"],
];

function cardOf(variant) {
  const card = { name: `Залазы «${variant.name}» · Astral`, description: variant.description + CARD_TAIL };
  for (const [field, value] of CARD_CONSTANTS) card[field] = value;
  return card;
}

function mediaOf(media) {
  if (!media) return {};
  const origin = { kind: "render", note: "обложка мастерской" };
  return { cover: { bytes: media.cover, origin, caption: VARIANT_COVER_CAPTION } };
}

export function variantDraft(variant, work, media) {
  return {
    id: "astral-climbs-" + variant.id,
    kind: "climbs",
    delivery: "work",
    work,
    card: cardOf(variant),
    media: mediaOf(media),
  };
}
