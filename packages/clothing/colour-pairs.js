/*
 * Какая расцветка мода ляжет на каждый цвет вещи — одно правило для окна «На что
 * поставить?» (оно рисует пары и подписывает правило) и для установщика (он пишет
 * по ним файлы). 25.10.2026: прежде выбранная расцветка ложилась на все цвета
 * вещи, и в игре у вещи с двенадцатью цветами был один.
 *
 * Буква к букве. У расцветки мода в карточке каталога есть `letters` — буквы
 * автора, на которых она стояла в его пакете (у «Ветровки Stone Islet» a=`ao`,
 * b=`bp`, …, i=`j`). Цвет вещи L получает ту расцветку, у которой L в `letters`.
 * Цвету, на который автор расцветки не делал, достаётся выбранная в окне
 * расцветка — так вещь не остаётся наполовину штатной, а правило видно человеку.
 * Мод, у которого одна расцветка «на все цвета», ложится на все цвета, как и
 * прежде.
 */

const LETTER = /^[a-z]$/;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Буквы цвета вещи по числу: `a`, `b`, … — вещь игры без дыр в расцветках. */
export const colourLetters = (count) =>
  [...LETTERS].slice(0, Math.max(0, Math.min(26, Number(count) || 0)));

/**
 * Расцветки мода в виде `{ letter, letters }`: буква в пакете и буквы автора
 * строкой. Негодное отбрасывается; повтор буквы пакета — первая запись.
 */
export function normalizeModColours(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const letter = String(item?.letter || "");
    if (!LETTER.test(letter) || seen.has(letter)) continue;
    const raw = Array.isArray(item.letters)
      ? item.letters.join("")
      : String(item.letters || "");
    const letters = [...new Set([...raw].filter((entry) => LETTER.test(entry)))]
      .sort()
      .join("");
    seen.add(letter);
    out.push({ letter, letters: letters || letter });
    if (out.length >= 26) break;
  }
  return out;
}

/**
 * Явное сопоставление из окна «Какой цвет будет виден в игре» (25.10.2026, владелец): `[{ target, source }]` — буква цвета вещи
 * и буква расцветки мода, которую человек поставил на этот цвет («на всех цветах» — одна и та же на каждом, «цвет в цвет» — своя).
 * Негодное отбрасывается, повтор цвета вещи — первая запись.
 */
export function normalizeColourMapping(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const target = String(item?.target || "");
    const source = String(item?.source || "");
    if (!LETTER.test(target) || !LETTER.test(source) || seen.has(target)) continue;
    seen.add(target);
    out.push({ target, source });
    if (out.length >= 26) break;
  }
  return out;
}

/**
 * Пары по явному сопоставлению: цвет вещи с записью получает её расцветку (`own: true`, если такая расцветка есть в пакете),
 * остальные — выбранную (`fallback`): на чужой модели штатная текстура вещи выглядела бы неверно.
 */
export function mappedPairs({ targets, mapping, fallback, has = () => true }) {
  return targets.map((target) => {
    const entry = mapping.find((item) => item.target === target);
    return entry && has(entry.source)
      ? { target, source: entry.source, own: true }
      : { target, source: fallback, own: false };
  });
}

/**
 * Пары «цвет вещи → расцветка мода».
 * - `targets` — буквы цветов вещи (`colourLetters(n)` или буквы файлов игры);
 * - `colours` — расцветки мода (`normalizeModColours`);
 * - `fallback` — буква выбранной расцветки: её получают цвета без пары;
 * - `has(letter)` — есть ли расцветка с такой буквой в пакете (иначе — выбранная).
 * Возвращает `[{ target, source, own }]`; `own: false` — цвет без пары автора.
 */
export function colourPairs({
  targets,
  colours = [],
  fallback,
  has = () => true,
}) {
  return targets.map((target) => {
    const own = colours.find(
      (colour) => colour.letters.includes(target) && has(colour.letter),
    );
    return own
      ? { target, source: own.letter, own: true }
      : { target, source: fallback, own: false };
  });
}

/** Сводка для подписи: сколько цветов вещи получили свою расцветку и какие — нет. */
export function colourSummary(pairs) {
  const own = pairs.filter((pair) => pair.own);
  const rest = pairs.filter((pair) => !pair.own);
  return {
    total: pairs.length,
    own: own.length,
    rest: rest.map((pair) => pair.target),
    /* Все цвета одной расцветкой — мод «на все цвета». */
    single: new Set(pairs.map((pair) => pair.source)).size <= 1,
  };
}
