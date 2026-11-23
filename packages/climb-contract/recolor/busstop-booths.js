/*
 * «Будки» — парковочные будки «24 HRS. PARK» в редакторе «Остановки» (задача
 * 11 ТЗ 18.10.2026: «добавь к остановкам вот такие будки, чтобы люди могли их
 * красить»).
 *
 * Будки GTA V — реквизит игры (`inventory/busstop-booths.js`,
 * `scripts/prepare-busstop-booths.mjs`): два фрагмента одной формы,
 * `prop_parking_hut_2` («Будка 1», синий козырёк) и `prop_parking_hut_2b`
 * («Будка 2», красный). Листы и палитры зашиты в сами модели (копии высокой
 * чёткости — в `+hifr.ytd` рядом), других вещей у этих файлов нет: правка
 * будки видна только на будках, сразу на всех будках модели.
 *
 * Части будки и что с ними можно:
 *   body    — корпус: стены плиткой. Цвет в игре — палитра тинта (лист ×
 *             цвет столбца палитры): «Стандарт» или свой цвет;
 *   canopy  — козырёк и цоколь: цветная полоса сверху и снизу (один цветной
 *             столбец палитры на оба) — так же;
 *   frame   — рамы окон и двери, ребристая отделка — так же;
 *   roof    — крыша и потолок под козырьком: общая отделка (свой цвет
 *             эффектом, «Без текстуры», узор, картинка, градиент);
 *   signs   — крупные надписи «24 HRS.» и «PARKING» на козырьке: «Стандарт»,
 *             свой цвет тоном листа, ровный цвет или своя картинка — она
 *             встаёт в лицо надписи прямо и в её пропорциях;
 *   notices — листки NOTICE (красный), WARNING (синий) и табличка «только для
 *             клиентов» — так же;
 *   glass   — стёкла окон и двери: «Стандарт» или свой оттенок нужной силы
 *             (шейдер стекла у игры непрозрачный для цвета — «прозрачность»
 *             здесь сила оттенка);
 *   floor   — пол плиткой: общая отделка, как у крыши.
 * Остальное (замок, постеры на стенах, грязь, лампа, стойка внутри) остаётся
 * как в игре.
 *
 * Работа: облик «Обе будки» (`all`) и у каждой — свой, если включён
 * (`types[вид].own`). Исходный облик — «Стандарт»: ставить нечего.
 *
 * Будки живут в работе «Остановки» (`busstops.js`, поле `booths`) и ставятся
 * тем же ходом, что и остановки.
 */

import { normalizeSlotTransform } from "./arena-slots.js";
import { atmPaletteColour, atmSurfaceIsStock } from "./atms.js";
import { normalizeRecolourHex } from "./colour.js";
import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { finishImageAssets, finishSignature, normalizeFinishFields } from "./finish.js";
import BOOTHS_INVENTORY from "./inventory/busstop-booths.js";

export { BOOTHS_INVENTORY };

/* Виды будок — по описи; имена — для окна. */
const TYPE_LABELS = Object.freeze({
  hut1: { label: "Будка 1", note: "Синий козырёк и цоколь" },
  hut2: { label: "Будка 2", note: "Красный козырёк и цоколь" },
});
export const BOOTH_TYPES = Object.freeze(
  BOOTHS_INVENTORY.types.map((type) =>
    Object.freeze({
      id: type.id,
      model: type.model,
      label: TYPE_LABELS[type.id]?.label || type.model,
      note: TYPE_LABELS[type.id]?.note || "",
      placements: type.placements,
      parts: Object.freeze([...type.parts]),
    }),
  ),
);
export const BOOTH_TYPE_IDS = Object.freeze(BOOTH_TYPES.map((type) => type.id));
export const findBoothType = (id) => BOOTH_TYPES.find((type) => type.id === id) || null;
const inventoryType = (id) => BOOTHS_INVENTORY.types.find((type) => type.id === id) || null;

/* Части будки: `kind` — какие у части облики. */
export const BOOTH_PARTS = Object.freeze([
  Object.freeze({ id: "body", label: "Корпус", kind: "colour", colour: "#bdbdbd" }),
  Object.freeze({ id: "canopy", label: "Козырёк и цоколь", kind: "colour", colour: "#4560a8" }),
  Object.freeze({ id: "frame", label: "Рамы и дверь", kind: "colour", colour: "#666666" }),
  Object.freeze({ id: "roof", label: "Крыша", kind: "finish", colour: "#6d6a63" }),
  Object.freeze({ id: "signs", label: "Надписи", kind: "picture", colour: "#c9ccd1" }),
  Object.freeze({ id: "notices", label: "Листки", kind: "picture", colour: "#c0392b" }),
  Object.freeze({ id: "glass", label: "Стекло", kind: "glass", colour: "#7fb3d5" }),
  Object.freeze({ id: "floor", label: "Пол", kind: "finish", colour: "#8b7f6c" }),
]);
export const BOOTH_PART_IDS = Object.freeze(BOOTH_PARTS.map((part) => part.id));
export const findBoothPart = (id) => BOOTH_PARTS.find((part) => part.id === id) || null;

export const BOOTH_SURFACE_MODES = Object.freeze({
  colour: Object.freeze(["standard", "colour"]),
  finish: Object.freeze(["standard", "colour", "flat", "pattern", "image", "gradient"]),
  picture: Object.freeze(["standard", "colour", "flat", "image"]),
  glass: Object.freeze(["standard", "colour"]),
});
export const BOOTH_SURFACE_LABELS = Object.freeze({
  standard: "Стандарт",
  colour: "Свой цвет",
  flat: "Без текстуры",
  pattern: "Узор",
  image: "Картинка",
  gradient: "Градиент",
});

/** Облики части: по её роду. */
export const boothSurfaceModes = (partId) => BOOTH_SURFACE_MODES[findBoothPart(partId)?.kind] || [];

/* Сила оттенка стекла, %: 0 — стекло как есть, 100 — оттенок целиком. */
export const BOOTH_GLASS_STRENGTH = Object.freeze({ min: 0, max: 100, standard: 100 });
/* Своя картинка по умолчанию заполняет место без полей, фон — чёрный. */
export const BOOTH_PICTURE_DEFAULTS = Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#000000" });

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function clampStrength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return BOOTH_GLASS_STRENGTH.standard;
  return Math.round(Math.min(BOOTH_GLASS_STRENGTH.max, Math.max(BOOTH_GLASS_STRENGTH.min, number)));
}

function normalizeSurface(id, input) {
  const part = findBoothPart(id);
  const source = plain(input);
  const mode = choice(source.mode, boothSurfaceModes(id), "standard");
  if (part.kind === "colour") return { mode, colour: normalizeRecolourHex(source.colour, part.colour) };
  if (part.kind === "glass") return { mode, colour: normalizeRecolourHex(source.colour, part.colour), strength: clampStrength(source.strength) };
  if (part.kind === "finish")
    return { mode, look: normalizeColourEffect(lookOf(source), { colour: part.colour, colour2: "#ffffff", direction: "height" }), ...normalizeFinishFields(source) };
  return {
    mode,
    colour: normalizeRecolourHex(source.colour, part.colour),
    ...normalizeFinishFields(source),
    transform: normalizeSlotTransform(source.transform, BOOTH_PICTURE_DEFAULTS),
  };
}

function normalizeLook(input) {
  const source = plain(input);
  return { parts: Object.fromEntries(BOOTH_PART_IDS.map((id) => [id, normalizeSurface(id, plain(source.parts)[id])])) };
}

/** Будки работы: облик «Обе» и свой облик каждой. */
export function normalizeBooths(input) {
  const source = plain(input);
  const types = plain(source.types);
  return {
    all: normalizeLook(source.all),
    types: Object.fromEntries(
      BOOTH_TYPE_IDS.map((id) => {
        const item = plain(types[id]);
        return [id, { own: item.own === true, ...normalizeLook(item) }];
      }),
    ),
  };
}

export const createBooths = () => normalizeBooths({});

/** Облик будки, который уйдёт в игру: свой, если включён, иначе общий. */
export function boothLookOf(input, typeId) {
  const booths = normalizeBooths(input);
  const own = booths.types[typeId];
  return own?.own ? { parts: own.parts } : booths.all;
}

/** Будка как в игре: все её части — «Стандарт» (картинка без картинки — тоже). */
export const boothLookIsStock = (look, typeId) => (findBoothType(typeId)?.parts || BOOTH_PART_IDS).every((part) => atmSurfaceIsStock(look.parts[part]));

/** Будки, что работа меняет. */
export const changedBoothTypes = (input) => BOOTH_TYPE_IDS.filter((id) => !boothLookIsStock(boothLookOf(input, id), id));

/** Обе будки как в игре: ставить нечего. */
export const boothsAreStock = (input) => changedBoothTypes(input).length === 0;

/** Сколько будок на карте изменит работа (по описи мира). */
export const changedBoothCount = (input) => changedBoothTypes(input).reduce((sum, id) => sum + (findBoothType(id)?.placements || 0), 0);

/* Что из облика части меняет файлы. */
function surfaceSignature(id, surface) {
  if (atmSurfaceIsStock(surface)) return null;
  const kind = findBoothPart(id)?.kind;
  if (kind === "colour") return { mode: surface.mode, colour: surface.colour };
  if (kind === "glass") return { mode: surface.mode, colour: surface.colour, strength: surface.strength };
  if (kind === "finish") {
    if (surface.mode === "colour" || surface.mode === "flat") return { mode: surface.mode, look: surface.look };
    return finishSignature(surface) || { mode: surface.mode };
  }
  if (surface.mode === "image") return { mode: surface.mode, image: { ...surface.image, name: undefined }, transform: surface.transform };
  return { mode: surface.mode, colour: surface.colour };
}

/** Отпечаток будок для очереди «Применить»: тот же облик — тот же отпечаток; `null`, если будки как в игре. */
export function boothsSignature(input) {
  if (boothsAreStock(input)) return null;
  return Object.fromEntries(
    BOOTH_TYPE_IDS.map((id) => {
      const look = boothLookOf(input, id);
      return [id, Object.fromEntries((findBoothType(id)?.parts || BOOTH_PART_IDS).map((part) => [part, surfaceSignature(part, look.parts[part])]))];
    }),
  );
}

/** «Стандарт» будок: всё как в игре; цвета и картинки помнятся, свои облики видов выключены. */
export function applyBoothsStandard(input) {
  const booths = normalizeBooths(input);
  const stock = (look) => ({ ...look, parts: Object.fromEntries(BOOTH_PART_IDS.map((id) => [id, { ...look.parts[id], mode: "standard" }])) });
  return {
    all: stock(booths.all),
    types: Object.fromEntries(BOOTH_TYPE_IDS.map((id) => [id, { ...stock(booths.types[id]), own: false }])),
  };
}

const ownLooks = (booths) => [booths.all, ...BOOTH_TYPE_IDS.filter((id) => booths.types[id].own).map((id) => booths.types[id])];

/* Картинки человека в код не едут: часть с картинкой становится «Стандартом». */
export function shareableBooths(input) {
  const booths = normalizeBooths(input);
  const strip = (look) => ({
    ...look,
    parts: Object.fromEntries(
      BOOTH_PART_IDS.map((id) => {
        const surface = look.parts[id];
        return [id, surface.mode === "image" && surface.image ? { ...surface, mode: "standard", image: { ...surface.image, asset: null, name: "" } } : surface];
      }),
    ),
  });
  return { all: strip(booths.all), types: Object.fromEntries(BOOTH_TYPE_IDS.map((id) => [id, { ...booths.types[id], ...strip(booths.types[id]) }])) };
}

/** Есть ли у будок свои картинки, что не поедут в код. */
export function boothsHavePictures(input) {
  const booths = normalizeBooths(input);
  return [booths.all, ...Object.values(booths.types)].some((look) => Object.values(look.parts).some((surface) => surface.mode === "image" && surface.image?.asset));
}

/** Свои картинки будок, что нужны установщику (`Map` ключ → имя): облик «Обе» и заведённые облики видов. */
export function boothsImageAssets(input) {
  return finishImageAssets(ownLooks(normalizeBooths(input)).flatMap((look) => Object.values(look.parts)));
}

/* ------------------------------------------------------------------ *
 * Корпус, козырёк и рамы — палитра тинта
 * ------------------------------------------------------------------ */

/**
 * Новые цвета палитр будки по облику: `Map` имя палитры → `Map` столбец →
 * `#rrggbb`. Части «Стандарт» не трогают своих столбцов. Опорный столбец
 * части встаёт ровно в выбранный цвет, остальные — с теми же отношениями к
 * нему (`atmPaletteColour`).
 */
export function boothPaletteChanges(typeId, look) {
  const out = new Map();
  for (const palette of inventoryType(typeId)?.palettes || []) {
    const columns = new Map();
    for (const [column, entry] of Object.entries(palette.columns)) {
      const surface = look.parts[entry.part];
      if (atmSurfaceIsStock(surface)) continue;
      const dominant = palette.columns[palette.dominant?.[entry.part]]?.colour || entry.colour;
      columns.set(Number(column), atmPaletteColour(entry.colour, dominant, surface.colour));
    }
    if (columns.size) out.set(palette.name, columns);
  }
  return out;
}

/** Цвет столбца палитры первого уровня будки в облике — для кадра окна: свой или как в игре; `null` — столбца нет. */
export function boothColumnColour(typeId, column, look) {
  const palette = inventoryType(typeId)?.palettes.find((item) => item.lod === "high");
  const entry = palette?.columns[column];
  if (!entry) return null;
  const surface = look.parts[entry.part];
  if (atmSurfaceIsStock(surface)) return entry.colour;
  return atmPaletteColour(entry.colour, palette.columns[palette.dominant?.[entry.part]]?.colour || entry.colour, surface.colour);
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const colour = (hex) => ({ mode: "colour", colour: hex });
const flatLook = (hex) => ({ mode: "flat", look: { mode: "solid", colour: hex, colour2: "#ffffff", direction: "height", width: 2, shift: 0 } });

export const BOOTHS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Будки Rockstar", all: {} },
    {
      id: "black",
      label: "Чёрные",
      description: "Чёрные корпус, козырёк и рамы; надписи и листки — как в игре",
      all: { parts: { body: colour("#17181c"), canopy: colour("#0f1013"), frame: colour("#2a2c31"), floor: flatLook("#2b2724") } },
    },
    {
      id: "white",
      label: "Белые",
      description: "Белый корпус, светлые рамы и козырёк",
      all: { parts: { body: colour("#f4f5f7"), canopy: colour("#e6e8ec"), frame: colour("#c9ccd1") } },
    },
    {
      id: "red",
      label: "Красные",
      description: "Красный корпус и козырёк, чёрные рамы",
      all: { parts: { body: colour("#b3202a"), canopy: colour("#e30613"), frame: colour("#1b1d22") } },
    },
    {
      id: "gold",
      label: "Золото",
      description: "Золотой корпус и козырёк в чёрных рамах",
      all: { parts: { body: colour("#d4a72c"), canopy: colour("#f2c94c"), frame: colour("#1b1d22") } },
    },
    {
      id: "neon",
      label: "Неон",
      description: "Фиолетовый корпус, голубой козырёк, тёмный пол",
      all: { parts: { body: colour("#7a3fd0"), canopy: colour("#2fb8ff"), frame: colour("#15171b"), floor: flatLook("#1b1630") } },
    },
  ].map((item) => Object.freeze(item)),
);

/** Работа с готовым видом: облик «Обе будки», свои облики видов выключены. */
export function applyBoothsPreset(input, presetId) {
  const booths = normalizeBooths(input);
  const preset = BOOTHS_PRESETS.find((item) => item.id === presetId);
  if (!preset) return booths;
  const stock = applyBoothsStandard(booths);
  const all = normalizeLook({
    ...stock.all,
    parts: Object.fromEntries(BOOTH_PART_IDS.map((id) => [id, { ...stock.all.parts[id], ...(preset.all.parts?.[id] || {}) }])),
  });
  return normalizeBooths({ ...stock, all });
}

/** Готовый вид, с которым будки работы совпадают, или `null`. */
export function matchingBoothsPreset(input) {
  const current = JSON.stringify(boothsSignature(input));
  return BOOTHS_PRESETS.find((item) => JSON.stringify(boothsSignature(applyBoothsPreset(input, item.id))) === current)?.id || null;
}
