/*
 * «Банкоматы» — облик банкоматов всей карты (задача 4 ТЗ 17.10.2026:
 * «добавь редактор банкоматов как отдельный инструмент и добавь возможность
 * чтобы их можно было редактировать по всему миру»).
 *
 * Банкоматы GTA V — реквизит игры (`inventory/atms.js`,
 * `scripts/prepare-atms.mjs`): тумба (`prop_atm_01`), настенные синий и
 * красный (`prop_atm_02/03`) и банкомат Fleeca (`prop_fleeca_atm`) — 121 на
 * карте, на улицах, в магазинах, на заправках и в банке. Листы и палитры
 * зашиты в сами модели (копии высокой чёткости — в `+hifr/+hidr.ytd`
 * рядом), других вещей у этих файлов нет: правка банкомата видна только на
 * банкоматах — сразу на всех банкоматах этой модели по всему миру.
 *
 * Части банкомата и что с ними можно:
 *   body   — корпус: «Стандарт» или свой цвет. У настенных и Fleeca цвет
 *            корпуса — палитра тинта игры (металл × цвет столбца палитры), у
 *            тумбы — тон листа;
 *   frame  — рамка вокруг (серые и белые столбцы палитры) — так же;
 *   panel  — панель с клавиатурой: общая отделка (свой цвет эффектом, «Без
 *            текстуры», узор, картинка, градиент);
 *   screen — экран, sign — вывеска, strip — полоса логотипов под козырьком:
 *            «Стандарт», свой цвет (тоном листа), ровный цвет, своя
 *            картинка — она встаёт в лицо места прямо и в его пропорциях — или
 *            свой текст (слова, шрифт, цвет и фон: та же картинка, что рисует
 *            окно, как у надписей мест);
 *   keyboard — клавиатура тумбы (место атласа): как у экрана, без текста;
 *   metal  — металл Fleeca (отдельный лист хромированных деталей), lamp —
 *            лампочка у щели карты: «Стандарт», свой цвет тоном листа или
 *            ровный цвет;
 *   glass  — стекло тумбы над экраном: «Стандарт» или свой оттенок нужной
 *            силы. Шейдер стекла у игры непрозрачный (лист DXT1), поэтому
 *            «прозрачность» здесь — сила оттенка: 0 % — стекло как есть,
 *            100 % — оттенок целиком.
 * И свечение: экран и вывеска светятся сами (шейдер игры `emissive` —
 * днём и ночью), сила — множитель шейдера, 100 % — как в игре.
 *
 * Работа: облик «Все банкоматы» (`all`) и у каждой модели — свой, если
 * включён (`types[модель].own`): синие, красные, тумбы и Fleeca можно
 * править вместе или по отдельности. Исходный облик — «Стандарт»: ставить
 * нечего, «Применить» снимает установку.
 */

import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { normalizeEmblemText } from "./emblems.js";
import { hexBytes, bytesHex, hslToRgb, normalizeRecolourHex, rgbToHsl } from "./colour.js";
import { finishImageAssets, finishSignature, normalizeFinishFields, normalizeFinishImage } from "./finish.js";
import { normalizeSlotTransform } from "./arena-slots.js";
import ATMS_INVENTORY from "./inventory/atms.js";

export { ATMS_INVENTORY };

export const ATMS_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/* Модели банкоматов — по описи; имена — для окна. */
const TYPE_LABELS = Object.freeze({
  kiosk: { label: "Банкомат-тумба", short: "Тумба", note: "Стоит отдельно: магазины 24/7, заправки, улицы" },
  blue: { label: "Настенный синий", short: "Синий", note: "В стене: улицы, банк Pacific Standard" },
  red: { label: "Настенный красный", short: "Красный", note: "В стене: деловой центр и Маленький Сеул" },
  fleeca: { label: "Банкомат Fleeca", short: "Fleeca", note: "Зелёный, у отделений банка Fleeca" },
});
export const ATM_TYPES = Object.freeze(
  ATMS_INVENTORY.types.map((type) =>
    Object.freeze({
      id: type.id,
      model: type.model,
      label: TYPE_LABELS[type.id]?.label || type.model,
      short: TYPE_LABELS[type.id]?.short || type.model,
      note: TYPE_LABELS[type.id]?.note || "",
      placements: type.placements,
      inside: type.inside,
      districts: type.districts || [],
      parts: Object.freeze([...type.parts]),
      glows: (type.glow || []).length > 0,
    }),
  ),
);
export const ATM_TYPE_IDS = Object.freeze(ATM_TYPES.map((type) => type.id));
export const findAtmType = (id) => ATM_TYPES.find((type) => type.id === id) || null;
const inventoryType = (id) => ATMS_INVENTORY.types.find((type) => type.id === id) || null;

/* Части банкомата: `kind` — какие у части облики. */
export const ATM_PARTS = Object.freeze([
  Object.freeze({ id: "body", label: "Корпус", kind: "colour", colour: "#2f80ed" }),
  Object.freeze({ id: "frame", label: "Рамка", kind: "colour", colour: "#c9ccd1" }),
  Object.freeze({ id: "metal", label: "Металл", kind: "paint", colour: "#9aa0a6" }),
  Object.freeze({ id: "panel", label: "Панель", kind: "finish", colour: "#8a8f96" }),
  Object.freeze({ id: "keyboard", label: "Клавиатура", kind: "picture", colour: "#656973" }),
  Object.freeze({ id: "screen", label: "Экран", kind: "picture", colour: "#2f80ed" }),
  Object.freeze({ id: "sign", label: "Вывеска", kind: "picture", colour: "#f4f5f7" }),
  Object.freeze({ id: "strip", label: "Полоса логотипов", kind: "picture", colour: "#f4f5f7" }),
  Object.freeze({ id: "lamp", label: "Лампа", kind: "paint", colour: "#2fc85a" }),
  Object.freeze({ id: "glass", label: "Стекло", kind: "glass", colour: "#7fb3d5" }),
]);
export const ATM_PART_IDS = Object.freeze(ATM_PARTS.map((part) => part.id));
export const findAtmPart = (id) => ATM_PARTS.find((part) => part.id === id) || null;

export const ATM_SURFACE_MODES = Object.freeze({
  colour: Object.freeze(["standard", "colour"]),
  finish: Object.freeze(["standard", "colour", "flat", "pattern", "image", "gradient"]),
  picture: Object.freeze(["standard", "colour", "flat", "image"]),
  paint: Object.freeze(["standard", "colour", "flat"]),
  glass: Object.freeze(["standard", "colour"]),
});
/* Свой текст — у частей, что показывают слова: экран, вывеска, полоса логотипов. */
export const ATM_TEXT_PARTS = Object.freeze(["screen", "sign", "strip"]);
export const ATM_SURFACE_LABELS = Object.freeze({
  standard: "Стандарт",
  colour: "Свой цвет",
  flat: "Без текстуры",
  pattern: "Узор",
  image: "Картинка",
  text: "Свой текст",
  gradient: "Градиент",
});

/** Облики части: по её роду; «Свой текст» — после «Картинки» у экрана, вывески и полосы. */
export function atmSurfaceModes(partId) {
  const part = findAtmPart(partId);
  if (!part) return [];
  const modes = ATM_SURFACE_MODES[part.kind] || [];
  if (!ATM_TEXT_PARTS.includes(partId)) return modes;
  const after = modes.indexOf("image") + 1;
  return [...modes.slice(0, after), "text", ...modes.slice(after)];
}

/* Сила оттенка стекла, %: 0 — стекло как есть, 100 — оттенок целиком. */
export const ATM_GLASS_STRENGTH = Object.freeze({ min: 0, max: 100, standard: 100 });

/* Текст части: слова, шрифт, цвет и фон (плашка — как у надписей мест). */
export const ATM_TEXT_DEFAULTS = Object.freeze({ value: "", font: "modern", colour: "#ffffff", outline: "none", backdrop: "#0a1c3a" });
/* Сила свечения экрана и вывески, %: 100 — как в игре, 0 — не светятся. */
export const ATM_GLOW = Object.freeze({ min: 0, max: 300, standard: 100 });
/* Своя картинка по умолчанию заполняет место без полей, фон — чёрный. */
export const ATM_PICTURE_DEFAULTS = Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#000000" });

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);

function clampStrength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return ATM_GLASS_STRENGTH.standard;
  return Math.round(Math.min(ATM_GLASS_STRENGTH.max, Math.max(ATM_GLASS_STRENGTH.min, number)));
}

/** Свой текст части: слова, шрифт, цвет и фон — фон всегда есть (текст на плашке). */
export function normalizeAtmText(input) {
  const source = plain(input);
  return normalizeEmblemText({ ...ATM_TEXT_DEFAULTS, ...source, backdrop: normalizeRecolourHex(source.backdrop, ATM_TEXT_DEFAULTS.backdrop) });
}

function clampGlow(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return ATM_GLOW.standard;
  return Math.round(Math.min(ATM_GLOW.max, Math.max(ATM_GLOW.min, number)));
}

function normalizeSurface(id, input) {
  const part = findAtmPart(id);
  const source = plain(input);
  const mode = choice(source.mode, atmSurfaceModes(id), "standard");
  if (part.kind === "colour" || part.kind === "paint") return { mode, colour: normalizeRecolourHex(source.colour, part.colour) };
  if (part.kind === "glass") return { mode, colour: normalizeRecolourHex(source.colour, part.colour), strength: clampStrength(source.strength) };
  if (part.kind === "finish")
    return { mode, look: normalizeColourEffect(lookOf(source), { colour: part.colour, colour2: "#ffffff", direction: "height" }), ...normalizeFinishFields(source) };
  return {
    mode,
    colour: normalizeRecolourHex(source.colour, part.colour),
    ...normalizeFinishFields(source),
    transform: normalizeSlotTransform(source.transform, ATM_PICTURE_DEFAULTS),
    ...(ATM_TEXT_PARTS.includes(id) ? { text: normalizeAtmText(source.text) } : {}),
  };
}

/* Облик банкоматов: части и свечение. */
function normalizeLook(input) {
  const source = plain(input);
  return {
    parts: Object.fromEntries(ATM_PART_IDS.map((id) => [id, normalizeSurface(id, plain(source.parts)[id])])),
    glow: clampGlow(source.glow),
  };
}

export function normalizeAtmsProject(input) {
  const source = plain(input);
  const types = plain(source.types);
  return {
    schema: ATMS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    all: normalizeLook(source.all),
    types: Object.fromEntries(
      ATM_TYPE_IDS.map((id) => {
        const item = plain(types[id]);
        return [id, { own: item.own === true, ...normalizeLook(item) }];
      }),
    ),
  };
}

export const createAtmsProject = () => normalizeAtmsProject({});
export const serializeAtmsProject = (project) => JSON.stringify(normalizeAtmsProject(project));

export function parseAtmsProject(text) {
  try {
    return normalizeAtmsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createAtmsProject();
  }
}

/** Облик модели, который уйдёт в игру: свой, если включён, иначе общий. */
export function atmLookOf(input, typeId) {
  const project = normalizeAtmsProject(input);
  const own = project.types[typeId];
  return own?.own ? { parts: own.parts, glow: own.glow } : project.all;
}

/**
 * Часть как в игре: «Стандарт» — или «Картинка» и «Свой текст» без картинки
 * (красить нечем, как в кадре): текст — та же картинка, окно рисует её и кладёт
 * в хранилище; пока слов нет или картинка не нарисована — часть штатная.
 */
export const atmSurfaceIsStock = (surface) =>
  !surface || surface.mode === "standard" || ((surface.mode === "image" || surface.mode === "text") && !normalizeFinishImage(surface.image).asset);

/** Часть с готовой картинкой: своей или нарисованной из текста. */
export const atmSurfaceHasPicture = (surface) => (surface?.mode === "image" || surface?.mode === "text") && Boolean(normalizeFinishImage(surface.image).asset);

/**
 * Как картинка части встаёт в острова: у своей — как выбрал человек, у текста —
 * вписана целиком на фоне цвета плашки (поля вокруг слов — того же цвета, швов
 * нет), одинаково в кадре окна и в листе установщика.
 */
export function atmSurfaceTransform(surface) {
  if (surface?.mode !== "text") return surface?.transform;
  return normalizeSlotTransform({ fit: "contain", scale: 1, background: "colour", backgroundColour: normalizeAtmText(surface.text).backdrop }, ATM_PICTURE_DEFAULTS);
}

/* Пропорция плашки текста по части: слова рисуются на ней и встают в остров, не растягиваясь. */
export const ATM_TEXT_ASPECT = Object.freeze({ screen: 1.3, sign: 3.7, strip: 3.7 });

/** Облик модели как в игре: части, что у неё есть, и свечение (если ей есть чему светиться). */
export function atmLookIsStock(look, typeId) {
  const type = findAtmType(typeId);
  const parts = type?.parts || ATM_PART_IDS;
  return parts.every((part) => atmSurfaceIsStock(look.parts[part])) && (!type?.glows || look.glow === ATM_GLOW.standard);
}

/** Модели, что работа меняет. */
export const changedAtmTypes = (input) => ATM_TYPE_IDS.filter((id) => !atmLookIsStock(atmLookOf(input, id), id));

/** Все банкоматы как в игре: ставить нечего. */
export const atmsProjectIsStock = (input) => changedAtmTypes(input).length === 0;

/** Сколько банкоматов на карте изменит работа (по описи мира). */
export const changedAtmCount = (input) => changedAtmTypes(input).reduce((sum, id) => sum + (findAtmType(id)?.placements || 0), 0);
/** Сколько банкоматов этих моделей на карте всего. */
export const atmPlacementTotal = (ids = ATM_TYPE_IDS) => ids.reduce((sum, id) => sum + (findAtmType(id)?.placements || 0), 0);

/* Что из облика части меняет файлы. */
function surfaceSignature(id, surface) {
  if (atmSurfaceIsStock(surface)) return null;
  const kind = findAtmPart(id)?.kind;
  if (kind === "colour" || kind === "paint") return { mode: surface.mode, colour: surface.colour };
  if (kind === "glass") return { mode: surface.mode, colour: surface.colour, strength: surface.strength };
  if (kind === "finish") {
    if (surface.mode === "colour" || surface.mode === "flat") return { mode: surface.mode, look: surface.look };
    return finishSignature(surface) || { mode: surface.mode };
  }
  if (surface.mode === "image" || surface.mode === "text")
    return { mode: surface.mode, image: { ...surface.image, name: undefined }, transform: surface.transform, ...(surface.mode === "text" ? { text: surface.text } : {}) };
  return { mode: surface.mode, colour: surface.colour };
}

/** Отпечаток для очереди «Применить»: тот же облик банкоматов — тот же отпечаток. */
export function atmsProjectSignature(input) {
  return JSON.stringify(
    Object.fromEntries(
      ATM_TYPE_IDS.map((id) => {
        const look = atmLookOf(input, id);
        const type = findAtmType(id);
        return [
          id,
          {
            glow: type?.glows ? look.glow : ATM_GLOW.standard,
            parts: Object.fromEntries((type?.parts || ATM_PART_IDS).map((part) => [part, surfaceSignature(part, look.parts[part])])),
          },
        ];
      }),
    ),
  );
}

/** «Стандарт»: всё как в игре; цвета и картинки помнятся. */
export function applyAtmsStandard(input) {
  const project = normalizeAtmsProject(input);
  const stock = (look) => ({
    ...look,
    glow: ATM_GLOW.standard,
    parts: Object.fromEntries(ATM_PART_IDS.map((id) => [id, { ...look.parts[id], mode: "standard" }])),
  });
  return {
    ...project,
    all: stock(project.all),
    types: Object.fromEntries(ATM_TYPE_IDS.map((id) => [id, { ...stock(project.types[id]), own: false }])),
  };
}

export const resetAtmsProject = (input) => ({ ...createAtmsProject(), name: normalizeAtmsProject(input).name });

const ownLooks = (project) => [project.all, ...ATM_TYPE_IDS.filter((id) => project.types[id].own).map((id) => project.types[id])];

/* Картинки человека в код не едут: часть с картинкой становится «Стандартом». */
export function shareableAtmsProject(input) {
  const project = normalizeAtmsProject(input);
  const strip = (look) => ({
    ...look,
    parts: Object.fromEntries(
      ATM_PART_IDS.map((id) => {
        const surface = look.parts[id];
        if (surface.mode === "image" && surface.image) return [id, { ...surface, mode: "standard", image: { ...surface.image, asset: null, name: "" } }];
        /* Слова — не личное: текст едет в код, картинку из него окно нарисует заново. */
        if (surface.mode === "text" && surface.image) return [id, { ...surface, image: { ...surface.image, asset: null, name: "", width: 0, height: 0 } }];
        return [id, surface];
      }),
    ),
  });
  return { ...project, all: strip(project.all), types: Object.fromEntries(ATM_TYPE_IDS.map((id) => [id, { ...project.types[id], ...strip(project.types[id]) }])) };
}

export function atmsLostInCode(input) {
  const project = normalizeAtmsProject(input);
  return [project.all, ...Object.values(project.types)].some((look) => Object.values(look.parts).some((surface) => surface.mode === "image" && surface.image?.asset))
    ? "свои картинки (остаются на этом компьютере)"
    : "";
}

/** Свои картинки работы, которые нужны установщику (`Map` ключ → имя): облик всех и заведённые облики моделей. */
export function atmsImageAssets(input) {
  const project = normalizeAtmsProject(input);
  return finishImageAssets(
    ownLooks(project)
      .flatMap((look) => Object.values(look.parts))
      .map((surface) => (surface.mode === "text" ? { ...surface, mode: "image" } : surface)),
  );
}

/* ------------------------------------------------------------------ *
 * Корпус и рамка — палитра тинта
 * ------------------------------------------------------------------ */

const unit = (hex) => hexBytes(hex).map((value) => value / 255);
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/*
 * Свой цвет столбца палитры. Опорный столбец части (у кого больше
 * треугольников) встаёт ровно в выбранный цвет, остальные — с теми же
 * отношениями к нему: тон сдвинут так же, насыщенность и светлота — в той
 * же доле. У Fleeca корпус — четыре оттенка зелёного: в красном он станет
 * четырьмя оттенками красного, а не одним пятном. Нейтральные столбцы
 * (серый и белый рамки) берут тон и насыщенность цвета, светлоту — в доле.
 */
export function atmPaletteColour(stock, dominant, target) {
  const goal = normalizeRecolourHex(target, "#808080");
  if (normalizeRecolourHex(stock) === normalizeRecolourHex(dominant)) return goal;
  const s = rgbToHsl(...unit(stock));
  const d = rgbToHsl(...unit(dominant));
  const t = rgbToHsl(...unit(goal));
  const neutral = d[1] < 0.05 || s[1] < 0.05;
  const hue = neutral ? t[0] : t[0] + (s[0] - d[0]);
  const saturation = neutral ? t[1] : clamp01(t[1] * (s[1] / Math.max(1e-3, d[1])));
  const lightness = clamp01(t[2] * (s[2] / Math.max(1e-3, d[2])));
  return bytesHex(hslToRgb(hue, saturation, lightness).map((value) => value * 255));
}

/**
 * Новые цвета палитр модели по облику: `Map` имя палитры → `Map` столбец →
 * `#rrggbb`. Части «Стандарт» не трогают своих столбцов.
 */
export function atmPaletteChanges(typeId, look) {
  const type = inventoryType(typeId);
  const out = new Map();
  for (const palette of type?.palettes || []) {
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

/**
 * Цвет столбца палитры первого уровня модели в облике — для кадра окна:
 * свой (тем же расчётом, что у установщика) или как в игре; `null` — столбца нет.
 */
export function atmColumnColour(typeId, column, look) {
  const palette = inventoryType(typeId)?.palettes.find((item) => item.lod === "high");
  const entry = palette?.columns[column];
  if (!entry) return null;
  const surface = look.parts[entry.part];
  if (atmSurfaceIsStock(surface)) return entry.colour;
  return atmPaletteColour(entry.colour, palette.columns[palette.dominant?.[entry.part]]?.colour || entry.colour, surface.colour);
}

/** Множитель свечения шейдера: штатный × сила облика. */
export const atmGlowMultiplier = (stock, glow) => Math.round(Number(stock) * (clampGlow(glow) / 100) * 10000) / 10000;

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const colour = (hex) => ({ mode: "colour", colour: hex });
const flatPicture = (hex) => ({ mode: "flat", colour: hex });
const flatPanel = (hex) => ({ mode: "flat", look: { mode: "solid", colour: hex, colour2: "#ffffff", direction: "height", width: 2, shift: 0 } });

export const ATMS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Банкоматы Rockstar", all: {} },
    {
      id: "graphite",
      label: "Графит",
      description: "Тёмный корпус и рамка, экран и вывеска — как в игре",
      all: { parts: { body: colour("#2b2f36"), frame: colour("#1b1d22") } },
    },
    {
      id: "gold",
      label: "Золото",
      description: "Золотой корпус в чёрной рамке",
      all: { parts: { body: colour("#d4a72c"), frame: colour("#1b1d22") } },
    },
    {
      id: "white",
      label: "Белые",
      description: "Белый корпус и рамка, панель ровным светлым",
      all: { parts: { body: colour("#f4f5f7"), frame: colour("#f4f5f7"), panel: flatPanel("#d9dce1") } },
    },
    {
      id: "neon",
      label: "Неон",
      description: "Фиолетовый корпус, синяя рамка, экран и вывеска светятся ярче",
      all: { parts: { body: colour("#9b51e0"), frame: colour("#2f80ed") }, glow: 220 },
    },
    {
      id: "off",
      label: "Выключенные",
      description: "Экраны чёрные, экран и вывеска не светятся",
      all: { parts: { screen: flatPicture("#050607") }, glow: 0 },
    },
  ].map((item) => Object.freeze(item)),
);

/** Работа с готовым видом: облик всех банкоматов, свои облики моделей выключены. */
export function applyAtmsPreset(input, presetId) {
  const project = normalizeAtmsProject(input);
  const preset = ATMS_PRESETS.find((item) => item.id === presetId);
  if (!preset) return project;
  const stock = applyAtmsStandard(project);
  const all = normalizeLook({
    ...stock.all,
    ...preset.all,
    parts: Object.fromEntries(ATM_PART_IDS.map((id) => [id, { ...stock.all.parts[id], ...(preset.all.parts?.[id] || {}) }])),
  });
  return normalizeAtmsProject({ ...stock, all });
}

/** Готовый вид, с которым работа совпадает, или `null`. */
export function matchingAtmsPreset(input) {
  const current = atmsProjectSignature(input);
  return ATMS_PRESETS.find((item) => atmsProjectSignature(applyAtmsPreset(input, item.id)) === current)?.id || null;
}
