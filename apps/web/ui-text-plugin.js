/*
 * Словарь интерфейса по языкам (ТЗ 18.10.2026, бюджет бандла).
 *
 * Источник правды не менялся: `src/locales/ui-text/index.js` — русская строка → [uk, en, de, pl],
 * по файлу на область экрана; французский (с 29.10.2026) лежит рядом, в `src/locales/ui-text/fr/`:
 * русская строка → французская. Но в окно он больше не едет целиком (1,25 МБ gzip одним куском): эта
 * надстройка Vite собирает из него виртуальные модули, а `src/locales/ui.js` грузит только нужные.
 *
 *   virtual:astral-ui-text/templates            русские ключи со вставками `{0}` — для слоя перевода разметки
 *   virtual:astral-ui-text/pack/<язык>/<номер>  { ключ-хеш: перевод } — один из UI_TEXT_SHARDS кусков языка
 *
 * Какие именно модули грузить, перечислено буквально в `src/locales/ui-text-loader.js` (бандлер делит
 * бандл только по `import()` с литералом).
 *
 * Русское окно словарь не грузит вовсе (языков в окне шесть: ru, uk, en, de, pl, fr). Окно на немецком тянет шаблоны и четыре куска `de` —
 * по ~60–90 КБ gzip каждый вместо общего мегабайта.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { UI_TEXT_SHARDS, uiTextHash, uiTextId, uiTextShard } from "./src/locales/ui-text-hash.js";

const PREFIX = "virtual:astral-ui-text/";
const RESOLVED = `\0${PREFIX}`;
const SOURCE = "src/locales/ui-text/index.js";
const PLACEHOLDER = /\{\d+\}/;

/**
 * Из словаря — куски языков и список шаблонов. Чистая функция: её проверяет тест, а надстройка
 * только отдаёт готовое.
 *
 * @param {Record<string, string[]>} dictionary русская строка → переводы по порядку первых `languages` (`uk, en, de, pl`)
 * @param {string[]} languages коды языков (`uk, en, de, pl, fr`)
 * @param {(text: string) => number} hash хеш ключа; подменяется только в тесте
 * @param {Record<string, Record<string, string>>} extra языки сверх колонок строки: код → русская строка → перевод
 *   (французский, 29.10.2026, лежит отдельно в `ui-text/fr/`, чтобы не трогать четырёхколоночные строки зон)
 */
export function buildUiTextPacks(dictionary, languages, hash = uiTextHash, extra = {}) {
  const seen = new Map();
  const templates = [];
  const packs = Object.fromEntries(languages.map((code) => [code, Array.from({ length: UI_TEXT_SHARDS }, () => ({}))]));
  for (const [key, row] of Object.entries(dictionary)) {
    const number = hash(key);
    const id = uiTextId(number);
    if (seen.has(id)) throw new Error(`Словарь интерфейса: ключи «${seen.get(id)}» и «${key}» дают один хеш — смените любой.`);
    seen.set(id, key);
    if (PLACEHOLDER.test(key)) templates.push(key);
    languages.forEach((language, index) => {
      const value = extra[language] ? extra[language][key] : row?.[index];
      if (typeof value === "string" && value) packs[language][uiTextShard(number)][id] = value;
    });
  }
  return { templates, packs };
}

/**
 * Источник кусков в том же виде, что у `ui-text-loader.js` (`LANGUAGES`, `PACKS`, `TEMPLATES`), но
 * собранный здесь же из словаря: для проверок ядра под Node, где виртуальных модулей Vite нет
 * (`provideUiText` в `ui.js`).
 */
export function uiTextSourceFrom(dictionary, languages, extra = {}) {
  const { templates, packs } = buildUiTextPacks(dictionary, languages, uiTextHash, extra);
  return {
    LANGUAGES: languages,
    PACKS: Object.fromEntries(languages.map((code) => [code, packs[code].map((shard) => () => Promise.resolve({ default: shard }))])),
    TEMPLATES: () => Promise.resolve({ default: templates }),
  };
}

/**
 * Имя куска бандла для `manualChunks`: каждый кусок языка — свой файл `ui-text-<язык>-<номер>`
 * (видно в отчёте гейта, и сборка не склеивает их с соседями).
 */
export function uiTextChunk(id) {
  const match = id.startsWith(RESOLVED) && /pack\/([a-z]+)\/(\d+)$/.exec(id);
  return match ? `ui-text-${match[1]}-${match[2]}` : undefined;
}

export function astralUiText() {
  let server = null;
  let cached = null;
  const root = fileURLToPath(new URL(".", import.meta.url));
  const source = resolve(root, SOURCE);

  /* Сборка читает словарь обычным импортом; dev-сервер и vitest — через свой загрузчик модулей,
     чтобы правка файла словаря подхватывалась без перезапуска. */
  const read = async () => {
    const module = server ? await server.ssrLoadModule(source) : await import(pathToFileURL(source).href);
    const languages = [...module.UI_LANGUAGE_CODES];
    return { ...buildUiTextPacks(module.UI_TEXT, languages, uiTextHash, module.UI_TEXT_EXTRA), languages };
  };
  const data = () => (cached ??= read());

  return {
    name: "astral-ui-text",
    configureServer(devServer) {
      server = devServer;
    },
    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : null;
    },
    async load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const name = id.slice(RESOLVED.length);
      const { templates, packs } = await data();
      if (name === "templates") return `export default ${JSON.stringify(templates)};`;
      const match = /^pack\/([a-z]+)\/(\d+)$/.exec(name);
      const pack = match && packs[match[1]]?.[Number(match[2])];
      if (!pack) throw new Error(`Словарь интерфейса: нет куска «${name}».`);
      return `export default ${JSON.stringify(pack)};`;
    },
    /* Правка файла словаря в dev: куски пересобираются, окно перезагружается целиком. */
    handleHotUpdate({ file, server: devServer }) {
      const normal = file.split("\\").join("/");
      if (!normal.includes("/src/locales/ui-text/") && !normal.endsWith("/src/locales/ui-text-hash.js")) return undefined;
      cached = null;
      for (const module of devServer.moduleGraph.idToModuleMap.values()) {
        if (module.id?.startsWith(RESOLVED)) devServer.moduleGraph.invalidateModule(module);
      }
      devServer.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
