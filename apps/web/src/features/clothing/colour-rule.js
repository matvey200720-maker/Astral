/*
 * Правило расцветок окна «На что поставить?» (25.10.2026): каждый цвет вещи
 * получает свою расцветку мода по буквам автора, а цвет без пары — выбранную в
 * окне. Те же пары считает установщик (`@modovik/clothing/colour-pairs`), так
 * что полоска в окне — это то, что ляжет в игру.
 */

import {
  colourLetters,
  colourPairs,
  colourSummary,
  normalizeModColours,
} from "@modovik/clothing/colour-pairs";

/** Расцветки выбранного набора мода — как их ждёт установщик (`colours` запроса). */
export function modColoursOf(variants, variant) {
  return normalizeModColours(
    variants
      .filter((item) => item.setId === variant?.setId)
      .map((item) => ({ letter: item.letter, letters: item.letters.join("") })),
  );
}

/**
 * Правило для вещи с `count` цветами: пары, сводка и картинка расцветки на
 * каждом цвете. `count` неизвестен (0) — сводки нет, только слова.
 */
export function colourRuleOf(variants, variant, count) {
  if (!variant) return null;
  const colours = modColoursOf(variants, variant);
  const total = Math.max(0, Math.min(26, Number(count) || 0));
  const pairs = total
    ? colourPairs({
        targets: colourLetters(total),
        colours,
        fallback: variant.letter,
      })
    : [];
  const look = (letter) =>
    variants.find(
      (item) => item.setId === variant.setId && item.letter === letter,
    ) || variant;
  return {
    variant,
    colours,
    summary: pairs.length ? colourSummary(pairs) : null,
    pairs: pairs.map((pair) => ({
      ...pair,
      swatch: look(pair.source).swatch || null,
      image: look(pair.source).image || null,
    })),
  };
}
