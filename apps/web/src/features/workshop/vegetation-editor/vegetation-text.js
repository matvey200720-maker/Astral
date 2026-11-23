/*
 * Слова, числа и листы редактора растительности — отдельно от
 * компонентов: их берут кадр, колонка правок, готовые виды и обложка.
 */

import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import {
  BUSH_DIRECTION_LABELS,
  GRASS_DIRECTION_LABELS,
  GRASS_GREEN,
  GRASS_RED,
  GRASS_ZONES,
  TREE_DIRECTION_LABELS,
  bushShare,
  compileVegetationLooks,
  grassZoneCentre,
  grassZoneLook,
  recolourLeafLevel,
  sandyColourAt,
  speciesShare,
} from "@modovik/climb-contract/recolor/vegetation";
import { bytesHex } from "@modovik/climb-contract/recolor/colour";
import { tr } from "../../../locales/ui.js";

export { BUSH_DIRECTION_LABELS, GRASS_DIRECTION_LABELS, GRASS_ZONES, TREE_DIRECTION_LABELS, compileVegetationLooks };

/* Эффекты травы по карте: линия (полосы по метрам) на карте травы ни к чему. */
export const SANDY_EFFECT_MODES = Object.freeze(["solid", "gradient", "rainbow", "shimmer"]);

/* Какую траву красить: зону или обе сразу. */
export const GRASS_ZONE_CHOICES = Object.freeze([
  ...GRASS_ZONES.map((zone) => Object.freeze({ value: zone.id, label: zone.short })),
  Object.freeze({ value: "both", label: "Обе сразу" }),
]);

/**
 * Цвет травы зоны в её середине (`#rrggbb`) — для снимка в окне; `null` —
 * зелень мода или трава как в игре. У радуги и градиента он свой в каждом
 * месте карты.
 */
export function grassPreviewColour(project, zone = "country") {
  const look = grassZoneLook(project, zone);
  const centre = grassZoneCentre(zone);
  return look ? bytesHex(sandyColourAt(look, centre[0], centre[1], 0, zone)) : null;
}

export const LEAF_SWATCHES = Object.freeze(["#d9741e", "#f2c94c", "#b5471b", "#f2a7c3", "#c0392b", "#8e44ad", "#2f80ed", "#4f9a2c", "#f4f7ff"]);
/* Цвета травы: красный из ТЗ, осенние, сине-фиолетовые, снег. */
export const GRASS_SWATCHES = Object.freeze([GRASS_RED, "#d8a73a", "#e67e22", "#7ccf3a", "#2f6b1f", "#8e44ad", "#2f80ed", "#f4f7ff"]);

export const GRASS_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: "mod", label: "Облик мода" }),
  Object.freeze({ value: "colour", label: "Свой цвет" }),
]);

/* Проценты — целыми и с неразрывным пробелом: «50 %» не рвётся на два ряда (п. 3 `design-qa.md`). */
export const percentText = (value) => `${Math.round(value)}${String.fromCharCode(160)}%`;

/** Подсказка под густотой листвы. */
export function foliageHint(foliage) {
  if (foliage >= 100) return tr("Листва как в игре.");
  if (foliage <= 0) return tr("Деревья без листвы: остаются стволы и ветви, вдали — только стволы карточек.");
  return `Остаётся ${Math.round(foliage)} % листьев — кроны реже, сквозь них видно небо.`;
}

/**
 * Лист листвы в облике работы для кадра: та же арифметика, что у
 * установщика (`recolourLeafLevel`), на картинке листа `rgba`.
 */
export function previewLeaf(rgba, width, height, looks, species) {
  return recolourLeafLevel(rgba, width, height, leafParams(looks, species));
}

/**
 * Задание перекраски листа листвы породы `species` (то, что берёт `recolourLeafLevel`): считается в окне,
 * сам цикл — там, где удобно (в потоке, `leaf-recolour.js`). Свой цвет породы — поверх общего облика листвы.
 */
export function leafParams(looks, species) {
  return {
    compiled: looks.trees.bySpecies?.[species] || looks.trees.compiled,
    foliage: looks.trees.foliage,
    species: speciesShare(species),
    salt: species.length * 977,
  };
}

/**
 * Лист куста или изгороди в облике работы (`name` — имя листа): «как
 * листва» — цвет и густота деревьев, порода «Кусты»; свой цвет — по видам
 * кустов, густота как в игре; у изгороди (`opaque`) густоты нет. Тот же
 * лист, если кусты как в игре.
 */
export function previewBushLeaf(rgba, width, height, looks, name, { opaque = false } = {}) {
  const params = bushLeafParams(looks, name, { opaque });
  return params ? recolourLeafLevel(rgba, width, height, params) : rgba;
}

/** Задание перекраски листа куста или изгороди; `null` — кусты как в игре, лист не меняется. */
export function bushLeafParams(looks, name, { opaque = false } = {}) {
  const bushes = looks.bushes;
  if (!bushes) return null;
  return {
    compiled: bushes.compiled,
    foliage: opaque ? 100 : bushes.foliage,
    species: bushes.follow ? speciesShare("bush") : bushShare(name),
    salt: name.length * 977,
  };
}

/* Цвета кустов: тёмная зелень, весенняя зелень, осень, сирень, снег. */
export const BUSH_SWATCHES = Object.freeze(["#2f6b1f", "#7fc449", "#a8431c", "#f2c94c", "#8e44ad", "#f2a7c3", "#2f80ed", "#dfe7ee"]);

/* Наследование и свой цвет — сегментом; «Как в игре» — строкой внизу, когда кусты не как в игре (п. 15 и 16 `design-qa.md`, четвёртый
   круг критика 31.10.2026). */
export const BUSH_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: "foliage", label: "Как у всей листвы" }),
  Object.freeze({ value: "colour", label: "Свой цвет" }),
]);

export const FLOWER_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: "game", label: "Как в игре" }),
  Object.freeze({ value: "add", label: "Больше цветов" }),
  Object.freeze({ value: "none", label: "Без цветов" }),
]);

/* Пустыня без травы — песок; с травой — зелень мода или свой цвет. */
const DESERT = Object.freeze([176, 150, 104]);
const MOD_GRASS = Object.freeze([79, 122, 52]);

/** Цвет земли за городом для плиток и обложки: песок, зелень мода или свой цвет травы (чуть темнее — земля). */
export function sandyGroundColour(project) {
  if (!compileVegetationLooks(project).sandy.zones.country.enabled) return DESERT;
  const own = grassPreviewColour(project, "country");
  return own ? hexBytes(own).map((value) => Math.round(value * 0.8)) : MOD_GRASS;
}

export { GRASS_GREEN, GRASS_RED };
