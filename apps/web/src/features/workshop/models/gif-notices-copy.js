/*
 * Заметки при загрузке гифки в «Модели» и на поверхности (щиты, остановки, арены) на шести языках окна: ru, uk, en, de, pl, fr.
 * В заметках — число кадров, а после числа у языков разные формы слова («53 кадра», «5 кадров», «21 кадр»), поэтому строки — функции
 * (как `features/reshade/reshade-copy.js`): форму выбирает `Intl.PluralRules` языка (у французского `one` — 0 и 1).
 *
 *   reduced(total, kept) — «В гифке 90 кадров — в игру едут 64, круг той же длины.»
 *   cut(kept)            — «Гифка длиннее 20 с — живая картинка крутит первые 53 кадра.»
 */

const rulesByLanguage = {};
function plural(language, count, forms) {
  const rules = (rulesByLanguage[language] ||= new Intl.PluralRules(language));
  return forms[rules.select(Number(count) || 0)] ?? forms.other;
}
const counted = (language, count, forms) => `${new Intl.NumberFormat(language).format(Number(count) || 0)} ${plural(language, count, forms)}`;

const FRAMES = {
  ru: { one: "кадр", few: "кадра", many: "кадров", other: "кадра" },
  uk: { one: "кадр", few: "кадри", many: "кадрів", other: "кадру" },
  pl: { one: "klatka", few: "klatki", many: "klatek", other: "klatki" },
  en: { one: "frame", other: "frames" },
  de: { one: "Bild", other: "Bilder" },
  fr: { one: "image", other: "images" },
};

const COPY = {
  ru: {
    reduced: (total, kept, frames) => `В гифке ${frames(total)} — в игру едут ${kept}, круг той же длины.`,
    cut: (kept, frames) => `Гифка длиннее 20 с — живая картинка крутит первые ${frames(kept)}.`,
  },
  uk: {
    reduced: (total, kept, frames) => `У гіфці ${frames(total)} — у гру їде ${kept}, коло тієї самої тривалості.`,
    cut: (kept, frames) => `Гіфка довша за 20 с — жива картинка крутить перші ${frames(kept)}.`,
  },
  en: {
    reduced: (total, kept, frames) => `The GIF has ${frames(total)} — ${kept} go into the game, the loop keeps the same length.`,
    cut: (kept, frames) => `The GIF is longer than 20 s — the live picture plays the first ${frames(kept)}.`,
  },
  de: {
    reduced: (total, kept, frames) => `Das GIF hat ${frames(total)} — ${kept} kommen ins Spiel, die Schleife bleibt gleich lang.`,
    cut: (kept, frames) => `Das GIF ist länger als 20 s — das lebendige Bild spielt die ersten ${frames(kept)}.`,
  },
  pl: {
    reduced: (total, kept, frames) => `GIF ma ${frames(total)} — do gry trafia ${kept}, pętla trwa tyle samo.`,
    cut: (kept, frames) => `GIF jest dłuższy niż 20 s — żywy obraz odtwarza pierwsze ${frames(kept)}.`,
  },
  fr: {
    reduced: (total, kept, frames) => `Le GIF compte ${frames(total)} — ${kept} sont transférées dans le jeu, la boucle garde la même durée.`,
    cut: (kept, frames, word) => `Le GIF dure plus de 20 s — l’image animée joue les ${kept} premières ${word(kept)}.`,
  },
};

/** Заметки гифки на языке `language` (неизвестный — английский): `{ reduced(total, kept), cut(kept) }`. */
export function gifNoticeCopy(language) {
  const code = COPY[language] ? language : "en";
  const frames = (count) => counted(code, count, FRAMES[code]);
  const word = (count) => plural(code, count, FRAMES[code]);
  return {
    reduced: (total, kept) => COPY[code].reduced(total, kept, frames, word),
    cut: (kept) => COPY[code].cut(kept, frames, word),
  };
}
