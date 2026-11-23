/*
 * Слова и числа редактора прострелов — отдельно от компонентов: их берут
 * сцена, колонка правок, очередь установки и обложка, а файлы компонентов
 * держат только компоненты (иначе горячая замена в разработке перезагружает
 * их целиком).
 */

import {
  wallbangEmissive,
  wallbangObjectZones,
} from "@modovik/climb-contract/wallbang";
import { tr } from "../../../locales/ui.js";
import { pluralWord } from "../../../plural.js";

export const WALLBANG_VIEWS = Object.freeze([
  Object.freeze({ value: "object", label: "Укрытие" }),
  Object.freeze({ value: "all", label: "Все укрытия" }),
]);

/* Быстрые цвета: чем подсвечивают прострелы — от синего мода до кислотного
   и жёлтого, который различим при дальтонизме. */
export const WALLBANG_SWATCHES = Object.freeze([
  "#0000ff",
  "#2f8bff",
  "#5cc8ff",
  "#00e5c7",
  "#a6ff00",
  "#ffd400",
  "#ff8a1f",
  "#ff2a2a",
  "#ff2bd6",
  "#8a5cff",
  "#ffffff",
]);

/* «1 место», «4 места», «17 мест». */
export function placesText(count) {
  /* Форма — по правилу языка окна (`plural.js`): у польского после 21 «miejsc», у английского «places», у французского 0 — «emplacement». */
  return `${count} ${pluralWord(count, [tr("место"), tr("места"), tr("мест")])}`;
}

/* «Строберри, Палето-Бэй» — районы укрытия по числу мест. */
export const zonesText = (id) =>
  wallbangObjectZones(id)
    .map((zone) => zone.label)
    .join(", ");

/* «×1», «×0,35», «×2,8» — множитель свечения, как его запишет установка. */
export function glowText(level) {
  const value = wallbangEmissive(level);
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0;
  return `×${value
    .toFixed(digits)
    .replace(/\.?0+$/, "")
    .replace(".", ",")}`;
}
