/*
 * Язык, который показал установщик (`Astral.exe --astral-lang=xx`, зовёт `launch({ lang })` установщика; BRIDGE.md).
 * Окно берёт его для нового профиля выше языка системы (правило первого запуска, `apps/web/src/locales/time-zone-language.js`):
 * главный процесс дописывает его адресом окна, `?lang=xx`, а сохранённый выбор человека остаётся главным. Так же — языки системы, `&syslang=…`:
 * они приписываются к адресу окна на КАЖДОМ запуске (безвредно: окно читает их только у пустого профиля, а не на каждом старте).
 * Флаг не `--lang`: тот же ключ у Chromium, он сменил бы язык самого движка.
 */
const FLAG = "--astral-lang=";
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

/** Код языка из аргументов запуска или null: только из шести языков окна, чужое значение не берём. */
export function launchLanguageArgument(argv = []) {
  const value = argv.find((item) => typeof item === "string" && item.startsWith(FLAG))?.slice(FLAG.length);
  return LANGUAGES.includes(value) ? value : null;
}

const TAG = /^[A-Za-z0-9-]{1,35}$/;

/**
 * Языки системы по порядку предпочтения (`app.getPreferredSystemLanguages()`): тег вида `kk-KZ`, не больше 8, остальное отбрасывается.
 * Не `navigator.languages` окна: Chromium при языке Windows, которого у него нет (казахский, белорусский…), откатывается на `en-US`
 * (по документации Electron `getPreferredSystemLanguages` отдаёт настоящий список ОС, в отличие от `getLocale`; в настоящем Electron не проверено).
 */
export function preferredSystemLanguages(app) {
  try {
    return [...(app?.getPreferredSystemLanguages?.() ?? [])].filter((tag) => typeof tag === "string" && TAG.test(tag)).slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Запрос адреса окна с языком установщика (`lang`) и языками системы (`syslang=kk-KZ,ru-RU`; окно берёт их вместо `navigator.languages`):
 * к готовому запросу — через «&», к пустому — через «?». Без того и другого запрос не меняется.
 */
export function withLaunchLanguage(query, language, systems = []) {
  const tags = systems.filter((tag) => typeof tag === "string" && TAG.test(tag)).slice(0, 8);
  const parts = [language && `lang=${language}`, tags.length && `syslang=${tags.join(",")}`].filter(Boolean);
  return parts.reduce((out, part) => `${out}${out ? "&" : "?"}${part}`, query);
}
