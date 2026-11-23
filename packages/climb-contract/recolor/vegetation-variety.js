/*
 * «В разнобой» (задача 7 ТЗ 17.10.2026): деревья одного вида по миру —
 * разными цветами палитры: одно жёлтое, соседнее розовое, третье белое.
 *
 * Как это сделано в игре (исследовано по файлам игры 17.10.2026):
 *
 *  • У всех сущностей одного архетипа общая модель и общий словарь
 *    текстур — перекраска листа красит все такие деревья мира разом.
 *  • Тинт сущности (`CEntityDef.tintValue`, строка палитры `<модель>_pal`)
 *    красит листву только у моделей с шейдером `trees_*_tnt`: это часть
 *    кустов и пальм, но не кедры, сосны, дубы, берёзы, фикусы и клёны — у
 *    них листва на `trees_normal_spec` без палитры. Тинтом «в разнобой» не
 *    сделать.
 *  • Поэтому у каждого цвета палитры, кроме первого, — свои копии: копия
 *    архетипа `astral_vm<N>_<имя>` со своей моделью (копия модели игры с
 *    листвой этого цвета) и, если лист лежит в словаре архетипа, со своим
 *    словарём (`astral_vm<N>_<словарь>`). У модели один родительский
 *    словарь на все архетипы (`ydd-one-txd-and-dormant-pack-archives`) —
 *    поэтому копия модели, а не только словаря. Копии архетипов — в своих
 *    постоянных типах (`astral_vegmix*.ytyp`, запрос
 *    `DLC_ITYP_REQUEST`, как у копий мест), сущности карт районов — на
 *    копии по месту (`varietyArchetypeChooser`).
 *  • Первый цвет (или «Как в игре») — сами модели игры: их перекрашивает
 *    листва, как прежде, и копий им не нужно. Карточки деревьев вдали —
 *    общие на группу деревьев (дальний план района): они первого цвета.
 *  • Вид со своим цветом («Виды деревьев», `trees.species`) палитру побеждает
 *    (решение 24.10.2026): его деревья — сами модели игры, перекрашенные цветом
 *    вида, без копий и без места палитры; остальные виды идут по палитре, как
 *    прежде (`compileVegetationLooks`, `varietyPainted`). Общий «Свой цвет листвы»
 *    при разнобое не действует.
 *  • Трава — без копий: у каждой травинки карт травы свой цвет экземпляра,
 *    цвет палитры ложится пятнами по клеткам `VARIETY_GRASS_CELL` метров.
 *
 * Решения детерминированы: место дерева и «сид» дают один и тот же цвет у
 * кадра, установщика и пересборки.
 */

import { normalizeRecolourHex } from "./colour.js";
import { joaatName, placeShare } from "./vegetation-world.js";
import VEGETATION_VARIETY from "./inventory/vegetation-variety.js";

export { VEGETATION_VARIETY };

/* Палитра: от двух до трёх цветов — первый и до двух копий на архетип. Три, а не шесть: копия модели весит
   как сама модель (22.10: клон — полная копия с листвой), и пакет растёт линейно от числа цветов. */
export const VARIETY_MIN_COLOURS = 2;
export const VARIETY_MAX_COLOURS = 3;
export const VARIETY_MAX_SLOTS = VARIETY_MAX_COLOURS - 1;
/* «Как в игре» в палитре: часть деревьев остаётся зелёной Rockstar. */
export const VARIETY_GAME = "game";
export const VARIETY_SEED_MAX = 9999;
/* Пятно травы одного цвета — клетка этих метров. */
export const VARIETY_GRASS_CELL = 6;

/*
 * Постоянные типы копий: по 512 копий в файле (предел сборщика типов,
 * `compile-place-types`) — цвета 1–3 в первом, 4–5 во втором. Имена
 * выбраны так, что оба файла ложатся в первый пакет растительности.
 */
export const VARIETY_TYPES = Object.freeze(["astral_vegmix", "astral_vegmix_2"]);
export const varietyTypesOf = (slot) => VARIETY_TYPES[slot <= 3 ? 0 : 1];

/** Имя копии архетипа, модели или словаря для цвета `slot` (1…5). */
export const varietyCloneName = (name, slot) => `astral_vm${slot}_${String(name).toLowerCase()}`;

const SALT_VARIETY = 0x7a11;
const SALT_VARIETY_GRASS = 0x7a12;

const clampWeight = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(100, Math.max(5, number)) / 5) * 5;
};

/* Палитра по умолчанию — слова владельца: жёлтое, розовое, белое. */
export const DEFAULT_VARIETY_COLOURS = Object.freeze([
  Object.freeze({ colour: "#f2c94c", weight: 35 }),
  Object.freeze({ colour: "#f2a7c3", weight: 35 }),
  Object.freeze({ colour: "#f4f1ea", weight: 30 }),
]);

function coloursOf(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  let game = false;
  for (const item of list) {
    if (out.length >= VARIETY_MAX_COLOURS) break;
    const source = item && typeof item === "object" ? item : {};
    const weight = clampWeight(source.weight, 50);
    if (source.colour === VARIETY_GAME) {
      /* «Как в игре» — один раз. */
      if (game) continue;
      game = true;
      out.push({ colour: VARIETY_GAME, weight });
      continue;
    }
    const colour = normalizeRecolourHex(source.colour, null);
    if (colour) out.push({ colour, weight });
  }
  return out.length >= VARIETY_MIN_COLOURS ? out : DEFAULT_VARIETY_COLOURS.map((item) => ({ ...item }));
}

/*
 * Сколько цветов сохранённой палитры не влезло в предел (`VARIETY_MAX_COLOURS`): проект, открытый после
 * сокращения палитры, говорит об этом одной строкой, а не молча. Считает так же, как `coloursOf`.
 */
export function varietyDroppedColours(input) {
  const list = Array.isArray(input?.variety?.colours) ? input.variety.colours : [];
  let game = false;
  let valid = 0;
  for (const item of list) {
    const source = item && typeof item === "object" ? item : {};
    if (source.colour === VARIETY_GAME) {
      if (game) continue;
      game = true;
      valid += 1;
      continue;
    }
    if (normalizeRecolourHex(source.colour, null)) valid += 1;
  }
  return Math.max(0, valid - VARIETY_MAX_COLOURS);
}

/**
 * «В разнобой» работы: включён ли, палитра (цвет или «как в игре» и доля
 * 5…100), сид и что красится — деревья, кусты, трава.
 */
export function normalizeVariety(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const seed = Number(source.seed);
  return {
    enabled: source.enabled === true,
    colours: coloursOf(source.colours),
    seed: Number.isFinite(seed) ? Math.round(Math.min(VARIETY_SEED_MAX, Math.max(0, seed))) : 1,
    trees: source.trees !== false,
    bushes: source.bushes === true,
    grass: source.grass === true,
  };
}

/** Разнобой что-то меняет: включён и красит хоть одну группу. */
export const varietyActive = (variety) => Boolean(variety?.enabled && (variety.trees || variety.bushes || variety.grass));

/**
 * Места палитры: нулевое — модели игры (цвет или `null` у «как в игре»),
 * остальные — копии. «Как в игре» всегда нулевое: зелень Rockstar копий не
 * требует. `[{ colour: "#rrggbb" | null, weight }]`.
 */
export function varietySlots(input) {
  const variety = normalizeVariety(input);
  const game = variety.colours.find((item) => item.colour === VARIETY_GAME);
  const rest = variety.colours.filter((item) => item.colour !== VARIETY_GAME);
  const ordered = game ? [game, ...rest] : rest;
  return ordered.map((item) => ({ colour: item.colour === VARIETY_GAME ? null : item.colour, weight: item.weight }));
}

/* Номер места по доле 0…1 и весам. */
function pick(slots, share) {
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
  let edge = 0;
  for (let index = 0; index < slots.length; index += 1) {
    edge += slots[index].weight / total;
    if (share < edge) return index;
  }
  return slots.length - 1;
}

const saltOf = (base, seed) => (base + Math.imul(seed + 1, 0x9e3779b1)) | 0;

/** Место палитры дерева в точке `(x, y)` мира: `(x, y) → номер`. */
export function varietySlotChooser(input) {
  const variety = normalizeVariety(input);
  const slots = varietySlots(variety);
  const salt = saltOf(SALT_VARIETY, variety.seed);
  return (x, y) => pick(slots, placeShare(x, y, salt));
}

/** Место палитры травинки: одно на клетку `VARIETY_GRASS_CELL` м — трава пятнами. */
export function varietyGrassChooser(input) {
  const variety = normalizeVariety(input);
  const slots = varietySlots(variety);
  const salt = saltOf(SALT_VARIETY_GRASS, variety.seed);
  return (x, y) => pick(slots, placeShare(Math.floor(x / VARIETY_GRASS_CELL), Math.floor(y / VARIETY_GRASS_CELL), salt));
}

/*
 * Архетипы с копиями (опись `prepare-vegetation-variety.mjs`): хеш имени →
 * `{ name, group }`. Одни у кадра, установщика и проверки доверия.
 */
const ARCHETYPES = new Map((VEGETATION_VARIETY.archetypes || []).map(([name, group]) => [joaatName(name), { name, group }]));

/** Архетип с копиями: `{ name, group }` или `null`. */
export const varietyArchetypeOf = (hash) => ARCHETYPES.get(hash >>> 0) || null;

/**
 * Решение по сущностям карт: `(архетип, x, y) → хеш копии | null`. Дерево
 * (куст) включённой группы получает место палитры по своей точке; нулевое
 * место — сам архетип игры (`null`). `painted(item)` — архетип вида со своим
 * цветом (`varietyPainted`): он палитру не берёт, его деревья остаются
 * моделями игры, перекрашенными цветом вида.
 */
export function varietyArchetypeChooser(input, { painted = null } = {}) {
  const variety = normalizeVariety(input);
  if (!varietyActive(variety) || !(variety.trees || variety.bushes)) return () => null;
  const slots = varietySlots(variety);
  if (slots.length < 2) return () => null;
  const slotAt = varietySlotChooser(variety);
  const clones = new Map();
  const cloneOf = (name, slot) => {
    const key = `${name}|${slot}`;
    if (!clones.has(key)) clones.set(key, joaatName(varietyCloneName(name, slot)));
    return clones.get(key);
  };
  return (archetype, x, y) => {
    const item = ARCHETYPES.get(archetype >>> 0);
    if (!item || !(item.group === "bush" ? variety.bushes : variety.trees)) return null;
    if (painted?.(item)) return null;
    const slot = slotAt(x, y);
    return slot > 0 ? cloneOf(item.name, slot) : null;
  };
}

/* ------------------------------------------------------------------ *
 * Готовые палитры
 * ------------------------------------------------------------------ */

/*
 * Готовые палитры разнобоя — меняют только палитру, а не что красится и
 * не сид. «Как в игре» в палитре — часть деревьев остаётся зелёной.
 */
export const VARIETY_TEMPLATES = Object.freeze(
  [
    {
      id: "sakura",
      label: "Сакура",
      note: "Розовые и белые кроны, часть — зелёные",
      colours: [
        { colour: "#f2a7c3", weight: 45 },
        { colour: "#fbe3ee", weight: 35 },
        { colour: VARIETY_GAME, weight: 20 },
      ],
    },
    {
      id: "autumn",
      label: "Осень",
      note: "Жёлтые, оранжевые и красные кроны",
      colours: [
        { colour: "#f2c94c", weight: 35 },
        { colour: "#e67e22", weight: 35 },
        { colour: "#c0392b", weight: 30 },
      ],
    },
    {
      id: "rainbow",
      label: "Радуга",
      note: "Три цвета радуги поровну",
      colours: ["#e53935", "#fdd835", "#1e88e5"].map((colour) => ({ colour, weight: 20 })),
    },
    {
      id: "blossom",
      label: "Цветущая весна",
      note: "Белые и розовые среди зелени Rockstar",
      colours: [
        { colour: VARIETY_GAME, weight: 50 },
        { colour: "#f7f4ef", weight: 25 },
        { colour: "#f2a7c3", weight: 25 },
      ],
    },
    {
      id: "owner",
      label: "Жёлтое, розовое, белое",
      note: "Три цвета поровну",
      colours: DEFAULT_VARIETY_COLOURS,
    },
  ].map((item) => Object.freeze({ ...item, colours: Object.freeze(item.colours.map((entry) => Object.freeze({ ...entry }))) })),
);

/** Палитра готового вида или `null`. */
export const varietyTemplateOf = (id) => VARIETY_TEMPLATES.find((item) => item.id === id) || null;

/** Готовый вид, чья палитра совпадает с палитрой работы, или `null`. */
export function matchingVarietyTemplate(input) {
  const variety = normalizeVariety(input);
  const key = JSON.stringify(variety.colours);
  return VARIETY_TEMPLATES.find((item) => JSON.stringify(normalizeVariety({ colours: item.colours }).colours) === key)?.id || null;
}
