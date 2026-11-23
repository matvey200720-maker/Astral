import { isCustomLabelFont } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";

// Русские ключи словаря; перевод берётся при каждом вызове, по языку окна на этот момент.
const WEIGHT_ROWS = [
  ["", "Как у шрифта"],
  ["regular", "Обычный"],
  ["semibold", "Полужирный"],
  ["bold", "Жирный"],
  ["black", "Чёрный"],
];

// Третий столбец: истина — название не переводится.
const FONT_ROWS = [
  ["astral", "Astral", true],
  ["golos", "Golos", true],
  ["inter", "Inter", true],
  ["manrope", "Manrope", true],
  ["unbounded", "Unbounded", true],
  ["condensed", "Узкий", false],
  ["heavy", "Плотный", false],
  ["display", "Плакатный", false],
  ["stock", "Как в игре", false],
  ["wide", "Широкий", false],
];

export function labelWeightOptions() {
  return Object.freeze(WEIGHT_ROWS.map(([value, word]) => [value, tr(word)]));
}

export function customFontOptions(fonts = [], current = "") {
  const owned = fonts.map((font) => ["custom:" + font.id, font.name]);
  const orphan =
    Boolean(current) && isCustomLabelFont(current) && owned.every(([value]) => value !== current);
  return orphan ? [...owned, [current, tr("Свой шрифт")]] : owned;
}

export function labelFontOptions(emptyLabel, extra = []) {
  const stock = FONT_ROWS.map(([value, word, plain]) => [value, plain ? word : tr(word)]);
  return Object.freeze([["", tr(emptyLabel)], ...stock, ...extra]);
}
