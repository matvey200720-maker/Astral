// Описание правок до установки: что изменится в каждом файле игры.
// Игру запускать и файлы распаковывать не нужно — всё берётся из каталога.
import { OPTIMIZER_TARGETS } from "./targets.js";
import { OPTIMIZER_TWEAK_MAP, localizedText } from "./catalog.js";

// Тексты правил существуют только на ru и en; любой другой язык получает английский.
const WORDS = {
  ru: {
    game: "настройки игры",
    maps: "карты игры",
    remove: "записи россыпи убираются целиком",
    step: "шаг россыпи увеличивается в {n} раза",
    range: "дальность россыпи сокращается до {n}% от исходной",
    scopes: {
      "interior-small-props": "мелкие предметы на полках в картах помещений",
      "interior-clutter": "коробки и ящики в картах помещений",
      "vehicle-dirt": "текстуры грязи кузова, стёкол и арок",
      "vehicle-scratches": "текстуры потёртостей краски",
    },
  },
  en: {
    game: "game settings",
    maps: "game maps",
    remove: "scatter entries are removed entirely",
    step: "the scatter step is increased {n}×",
    range: "the scatter range is cut to {n}% of the original",
    scopes: {
      "interior-small-props": "small shelf props in interior maps",
      "interior-clutter": "boxes and crates in interior maps",
      "vehicle-dirt": "dirt textures for body, glass and arches",
      "vehicle-scratches": "paint scuff textures",
    },
  },
};

const fill = (template, n) => template.replace("{n}", () => String(n));

// Правила россыпи в порядке вывода: поле действия → строка.
const SCATTER_LINES = [
  ["remove", (words) => words.remove],
  ["spacing", (words, factor) => fill(words.step, factor)],
  ["maxDistance", (words, share) => fill(words.range, Math.round(share * 100))],
];

const RECIPE_DESCRIBERS = {
  visualsettings: (recipe) => ({
    file: OPTIMIZER_TARGETS.visualsettings.file,
    lines: Object.entries(recipe.values).map(([key, value]) => `${key}: ${recipe.vanilla[key]} → ${value}`),
  }),
  procedural: (recipe, words) => ({
    file: OPTIMIZER_TARGETS.procedural.file,
    lines: SCATTER_LINES.filter(([field]) => recipe.action[field]).map(([field, line]) =>
      line(words, recipe.action[field]),
    ),
  }),
  game: (recipe, words) => ({
    file: words.game,
    lines: Object.entries(recipe.values).map(([key, value]) => `${key} → ${value}`),
  }),
};

// Вид рецепта, которого нет в каталоге: подпись области из таблицы текстов.
function describeMaps(recipe, words) {
  const text = Object.hasOwn(words.scopes, recipe.scope) ? words.scopes[recipe.scope] : null;
  return { file: words.maps, lines: text === null ? [] : [text] };
}

function describeRecipe(recipe, words) {
  const describer = Object.hasOwn(RECIPE_DESCRIBERS, recipe.kind) ? RECIPE_DESCRIBERS[recipe.kind] : describeMaps;
  return describer(recipe, words);
}

export function describeTweak(tweakId, locale = "ru") {
  const tweak = OPTIMIZER_TWEAK_MAP[tweakId];
  if (!tweak) return null;
  const { file, lines } = describeRecipe(tweak.recipe, locale === "ru" ? WORDS.ru : WORDS.en);
  return { id: tweak.id, title: localizedText(tweak.title, locale), file, lines };
}

export function describeProfile(profile, locale = "ru") {
  const byFile = new Map();
  for (const id of profile?.enabled ?? []) {
    const description = describeTweak(id, locale);
    if (!description) continue;
    if (byFile.has(description.file)) byFile.get(description.file).push(description);
    else byFile.set(description.file, [description]);
  }
  return Array.from(byFile, ([file, tweaks]) => ({ file, tweaks }));
}
