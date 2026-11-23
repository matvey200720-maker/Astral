/*
 * Какой цвет заменёнки будет виден на каждом цвете вещи (окно «Какой цвет будет виден в игре», владелец, 25.10.2026).
 *
 * Человек носит на сервере одну вещь, а в игре видит другую — заменёнку мода. У вещи N цветов (картинки сервера), у мода M расцветок.
 * Два способа сопоставить их:
 *   • «на всех цветах вещи» — какого бы цвета ни была вещь, видна одна расцветка мода (выбранная);
 *   • «цвет в цвет» — у каждого цвета вещи свой цвет заменёнки, по порядку; пару можно переставить.
 * Цвет вещи без пары (вещь богаче мода) получает цвет «по умолчанию» — первый: штатная текстура вещи на чужой модели выглядела бы
 * неверно (`colour-pairs.js`).
 *
 * Состояние — чистые данные: `{ mode, assignment, fallback }`, где `assignment[i]` — буква расцветки мода на i-м цвете вещи. Окно
 * рисует по нему пары, а в установщик уходит `toMapping(state)` → `[{ target, source }]` (`mapping` запроса, `clothing-replace.js`).
 * Модуль без React и без словаря: слова итога собирает `colourSummary` из подписей, что дало окно.
 */
import { colourLetters } from "@modovik/clothing/colour-pairs";
import { colourListOf } from "@modovik/clothing/colour-list";
import { colourFamily, colourName } from "../catalog/search-concepts.js";
import { galleryUrl } from "./clothing-catalog.js";

export const MODES = Object.freeze({ ALL: "all", EACH: "each" });

const MAX = 26;

/** Цвета вещи по числу: `[{ index, letter }]`; вещь без числа цветов — один. */
export function itemColours(count) {
  const total = Math.max(1, Math.min(MAX, Number(count) || 1));
  return colourLetters(total).map((letter, index) => ({ index, letter }));
}

/**
 * Расцветки мода подряд, по букве пакета без повторов: `[{ letter, name, image, swatch }]` (`variantsOf`). Имя цвета — название набора, если
 * у каждой расцветки оно своё («Синий», «Хаки»); иначе слово по образцу на языке окна («Тёмно-синий» там, где автор назвал всё «Основной»);
 * одинаковые слова нумеруются: «Чёрный», «Чёрный 2».
 */
export function modColours(variants = [], language = "ru") {
  const seen = new Set();
  const list = [];
  for (const variant of variants) {
    const letter = variant?.letter;
    if (!/^[a-z]$/.test(letter || "") || seen.has(letter)) continue;
    seen.add(letter);
    list.push(variant);
  }
  const ownNames = new Set(list.map((variant) => variant.setLabel)).size === list.length && list.every((variant) => variant.setLabel);
  const counts = new Map();
  return list.map((variant) => {
    const base =
      (ownNames ? variant.setLabel : colourName(colourFamily(variant.swatch), language)) ||
      variant.setLabel ||
      variant.letter.toUpperCase();
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return {
      letter: variant.letter,
      name: n > 1 ? `${base} ${n}` : base,
      image: variant.image || "",
      swatch: variant.swatch || "",
    };
  });
}

const fileOf = (url) => String(url || "").split(/[?#]/)[0].split("/").pop().toLowerCase();

/**
 * Буква цвета мода, чей главный кадр — картинка `src` (кадр на сцене страницы мода); нет такого — пусто. Кадры сравниваются по имени файла:
 * сцена и список цветов берут их из одной галереи, но адрес на пути может стоять разный (`galleryUrl`, облако).
 */
export function colourOfImage(mod, src) {
  const name = fileOf(src);
  if (!name) return "";
  return modColoursOf(mod).find((colour) => colour.image && fileOf(colour.image) === name)?.letter || "";
}

/** Буква первого цвета мода — того, которым нарисована его модель витрины. */
export const firstColourLetter = (mod) => modColoursOf(mod)[0]?.letter || "";

/**
 * Цвета мода по списку без повторов (`colour-list.js`, Хелпер 13): одна расцветка — один цвет, вторая сторона вещи и кадры слитых
 * расцветок цветами не считаются. Картинка цвета — его главный кадр.
 */
export function modColoursOf(mod, language = "ru") {
  const { colours } = colourListOf(mod);
  return modColours(
    colours.map((colour) => ({
      setId: colour.setId,
      setLabel: colour.setLabel,
      letter: colour.letter,
      letters: colour.letters,
      swatch: colour.swatch,
      image: colour.frame ? galleryUrl(mod, colour.frame.source) || colour.frame.url || "" : "",
    })),
    language,
  );
}

/** Первое состояние: «цвет в цвет», если у вещи больше одного цвета и у мода больше одной расцветки, иначе — «на всех». */
export function startState({ itemCount, colours }) {
  const mode = itemCount > 1 && colours.length > 1 ? MODES.EACH : MODES.ALL;
  return withMode({ mode, assignment: [], fallback: colours[0]?.letter || "a" }, itemCount, colours, mode);
}

/** Другой способ: «на всех» — одна расцветка (та, что стоит на первой паре), «цвет в цвет» — по порядку. */
export function withMode(state, itemCount, colours, mode) {
  const total = Math.max(1, Math.min(MAX, Number(itemCount) || 1));
  const first = colours[0]?.letter || state.fallback;
  if (mode === MODES.ALL) {
    const one = state.assignment[0] || state.fallback;
    return { mode, fallback: one || first, assignment: Array.from({ length: total }, () => one || first) };
  }
  return {
    mode,
    fallback: state.fallback || first,
    assignment: Array.from({ length: total }, (_, index) => colours[index]?.letter || state.fallback || first),
  };
}

/** Поставить расцветку `letter` на цвет вещи `index`. «На всех» — на все цвета; «цвет в цвет» — меняет местами с парой, что её держала. */
export function pickColour(state, index, letter) {
  if (!state.assignment.length || !/^[a-z]$/.test(letter || "")) return state;
  if (state.mode === MODES.ALL)
    return { ...state, fallback: letter, assignment: state.assignment.map(() => letter) };
  const assignment = [...state.assignment];
  const previous = assignment[index];
  const holder = assignment.findIndex((value, at) => at !== index && value === letter);
  const uses = (value) => assignment.filter((entry) => entry === value).length;
  /* Расцветку держит ровно одна другая пара, а старая у этой — ничья другая: обмен; иначе — просто замена. */
  if (holder >= 0 && uses(letter) === 1 && uses(previous) === 1) assignment[holder] = previous;
  assignment[index] = letter;
  return { ...state, assignment };
}

/** Пары для установщика: цвет вещи → расцветка мода. */
export const toMapping = (state) =>
  state.assignment.map((source, index) => ({ target: colourLetters(MAX)[index], source }));

/**
 * Сводка для итога одной строкой: что заменится. `names` — подписи расцветок мода по букве. Возвращает данные, а не слова: слова
 * строит окно (словарь, число и падеж).
 *   { kind: "all", total, name }                 — «на всех»: все цвета вещи станут одной расцветкой;
 *   { kind: "each", total }                      — у каждого цвета вещи своя расцветка (мода хватает);
 *   { kind: "rest", total, paired, name }        — вещь богаче мода: `paired` цветов со своей парой, остальные — `name`.
 */
export function colourSummary(state, colours, names = {}) {
  const total = state.assignment.length;
  if (state.mode === MODES.ALL) return { kind: "all", total, name: names[state.assignment[0]] || state.assignment[0] };
  const paired = Math.min(total, colours.length);
  if (paired < total)
    return { kind: "rest", total, paired, name: names[state.fallback] || state.fallback };
  return { kind: "each", total };
}
