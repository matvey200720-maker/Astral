/*
 * Названия вещей на языках игры (17.11.2026, решение владельца: названия вещей показываются на языке интерфейса, теми словами, какими вещь называет сама GTA V).
 *
 * Название вещи — строка `global.gxt2` языка игры по ярлыку вещи из магазинного файла (`textLabel`, `game-clothing-index.js`). Язык интерфейса Astral → язык игры:
 * русский, английский, немецкий, французский и польский у игры есть, украинского нет. Своих таблиц названий в репозитории и в поставке нет: строки читаются из игры человека и
 * лежат в оглавлении у него же. Здесь — только выбор строки: чистые функции без чтения файлов, их зовут и поток чтения игры, и окно.
 */

/** Языки игры, из которых читаются названия, — коды интерфейса Astral. */
export const GAME_NAME_LANGUAGES = Object.freeze(["ru", "en", "de", "fr", "pl"]);

/** Код языка Astral → имя языка в файлах игры (`x64/patch/data/lang/<имя>_rel.rpf`, `x64/data/lang/<имя>dlc.rpf`). */
export const GAME_LANGUAGE_FILES = Object.freeze({ ru: "russian", en: "american", de: "german", fr: "french", pl: "polish" });

/*
 * Что берёт окно на языке `язык`: строки игры по порядку, первая непустая. Свой язык игры; нет строки — английская (язык, на котором Rockstar пишет названия, остальные —
 * переводы); русскую строку нерусское окно не берёт: кириллица в немецком, французском и польском окне хуже запасного названия по типу и номеру вещи.
 * Украинского у игры нет (`x64b.rpf/data/lang` — 12 языков, украинского среди них нет): английское название, а русское — только если английского нет вовсе; так в украинском окне не появляется
 * русский текст там, где есть английский, и вещь не остаётся без названия. Чтобы показать украинскому окну русские названия вместо английских, достаточно поменять местами две
 * строки в `uk`.
 */
export const NAME_CHAINS = Object.freeze({
  ru: Object.freeze(["ru", "en"]),
  uk: Object.freeze(["en", "ru"]),
  en: Object.freeze(["en"]),
  de: Object.freeze(["de", "en"]),
  fr: Object.freeze(["fr", "en"]),
  pl: Object.freeze(["pl", "en"]),
});

/** Предел названия вещи в строке окна — тот же, что у вещи ассортимента (`LIMITS.name`). */
const NAME_LIMIT = 120;

const textOf = (value) => (typeof value === "string" ? value.trim() : "");

/** Строки по языкам игры без лишнего: только `ru`, `en`, `de`, `fr`, `pl`, только непустые строки; ничего нет — `null`. */
export function cleanGameNames(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean = {};
  for (const language of GAME_NAME_LANGUAGES) {
    const text = textOf(raw[language]).slice(0, NAME_LIMIT);
    if (text) clean[language] = text;
  }
  return Object.keys(clean).length ? Object.freeze(clean) : null;
}

/** Название на языке окна по цепочке языка; пусто — у игры строки нет, окно ставит запасное название по типу и номеру. */
export function pickGameName(names, language) {
  if (!names || typeof names !== "object") return "";
  const chain = Object.hasOwn(NAME_CHAINS, language) ? NAME_CHAINS[language] : NAME_CHAINS.en;
  for (const code of chain) {
    const text = textOf(names[code]);
    if (text) return text;
  }
  return "";
}

/** Все строки игры для поиска: вещь находят по названию на любом языке игры. Без повторов, по порядку языков. */
export function searchableGameNames(names) {
  if (!names || typeof names !== "object") return [];
  const found = GAME_NAME_LANGUAGES.map((code) => textOf(names[code])).filter(Boolean);
  return [...new Set(found)];
}
