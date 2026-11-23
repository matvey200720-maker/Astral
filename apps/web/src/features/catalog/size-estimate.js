import { formatModSize, formatSizeNumber, sizeUnits } from "../../catalog-utils.js";
import { tr } from "../../locales/ui.js";
import { reduxEditorOf } from "./redux-editors.js";

/*
 * Примерный вес мода (ТЗ 29.10.2026-d, п. 1). Облачный каталог v2 размера пакета не носит (точный есть у ганпаков и у того, что
 * опубликовано с манифестом), и пустое место рядом с «загрузками» на карточке выглядело как «веса нет». Где точного размера нет,
 * вместо пустоты — примерный по типу мода, со знаком «≈» и подсказкой «примерно, точный вес после скачивания».
 *
 * Точный вес, если он есть в данных (`modSizeBytes`), всегда главнее: оценка не заменяет и не округляет его. Таблица «тип →
 * диапазон» — ниже, в одном месте: правят её только здесь, показывают её карточки, главная, страница мода и виды каталога.
 *
 *   small — небольшие: прицелы, эффекты, килл-эффекты, трейсеры, попадания, карты, звуки, таймциклы, одежда, оружие и всё
 *           прочее, чему мастерская не даёт тяжёлых файлов;
 *   large — крупные: дороги, растительность и трава, поверхность земли, маппинг мира и редукс целиком (пак из многих частей).
 *
 * Тип тяжёлого мода берётся по редактору мастерской (`reduxEditorOf`: полка, подпись подраздела, подпись разбора) — тем же
 * словарём, по которому мод стоит в колонке «Для редуксов», а не вторым списком слов.
 */

const MB = 1_000_000;
const GB = 1_000_000_000;

/** Диапазоны в байтах: `{ min, max }`, у точного «≈ 3 ГБ» они равны. */
export const SIZE_ESTIMATE = Object.freeze({
  small: Object.freeze({ min: 10 * MB, max: 30 * MB }),
  large: Object.freeze({ min: 3 * GB, max: 3 * GB }),
});

/** Редакторы мастерской, чьи моды крупные: дороги, растительность (трава, деревья, поверхность земли), маппинг мира. */
export const LARGE_EDITORS = Object.freeze(new Set(["roads", "vegetation", "mapping"]));

/** Редукс целиком — его пак, а не часть: `reduxLead` ставит витрина (`catalog-page-mods.js`), `redux-pack` — полка пака. */
const isWholeRedux = (mod) =>
  Boolean(mod?.reduxLead) ||
  mod?.catalogSlot === "redux-pack" ||
  (mod?.catalogMode === "pack" && mod?.catalogSection === "redux");

/** Класс оценки мода: `"small"` или `"large"` — ключ `SIZE_ESTIMATE`. */
export function sizeClassOf(mod) {
  if (isWholeRedux(mod)) return "large";
  const editor = reduxEditorOf({
    slot: mod?.catalogSlot || mod?.slot,
    subcategory: mod?.catalogSubcategory,
    categoryLabel: mod?.categoryLabel,
  });
  return LARGE_EDITORS.has(editor) ? "large" : "small";
}

/* Неразрывные пробелы: «≈ 10–30 МБ» не рвётся на две строки в узкой строке фактов карточки. */
const NBSP = " ";

/** «≈ 10–30 МБ» / «≈ 3 ГБ» на языке окна: числа — `Intl`, единицы — те же, что у точного веса. */
export function formatSizeEstimate(range, locale = "ru-RU") {
  const unit = sizeUnits(locale);
  const inGb = range.max >= GB;
  const divisor = inGb ? GB : MB;
  const low = formatSizeNumber(Math.round(range.min / divisor), locale);
  const high = formatSizeNumber(Math.round(range.max / divisor), locale);
  const span = low === high ? low : `${low}–${high}`;
  return `≈${NBSP}${span}${NBSP}${inGb ? unit.gb : unit.mb}`;
}

/** Подсказка к примерному весу. */
export const sizeEstimateNote = () => tr("Примерно, точный вес после скачивания");

/**
 * Вес мода для показа: `{ text, approximate }`. Точный — как `formatModSize`; нет его — примерный по типу мода (`approximate`
 * истинно, показывать со знаком «≈» и подсказкой `sizeEstimateNote`).
 */
export function modSizeLabel(mod, allMods = [], locale = "ru-RU") {
  const exact = formatModSize(mod, allMods, locale);
  if (exact) return { text: exact, approximate: false };
  return { text: formatSizeEstimate(SIZE_ESTIMATE[sizeClassOf(mod)], locale), approximate: true };
}
