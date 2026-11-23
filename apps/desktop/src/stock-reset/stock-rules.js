/*
 * «Сбросить GTA до стандартной»: что в папке игры чьё.
 *
 * Сервер файлов игры не раздаёт (CLAUDE.md: файлы Rockstar на наш CDN не
 * кладём), он отдаёт только опись: путь, размер и sha256 каждого штатного
 * файла (`stock-manifest.js`). Здесь — правила, которые работают и без описи:
 * что заведомо принесли моды (загрузчики, плагины, папка `mods`, ScriptHookV,
 * ReShade и ENB), что своё у Astral и что трогать нельзя вовсе (файлы
 * магазина, которые появляются и меняются сами).
 *
 * Порядок решения один для сканера и для генератора описи:
 *   1. Astral (`.astral…` в пути, файлы, которыми управляет движок установки);
 *   2. штатный файл из описи;
 *   3. «не трогать» (`ignore`): метаданные магазина, журналы краша, commandline.txt;
 *   4. «не штатный» (`nonStock`) — по правилам ниже;
 *   5. остальное: при доверенной описи — лишний файл, без неё — «не проверен».
 *
 * Шаблон — путь от корня игры в нижнем регистре с `/`. `*` — любые знаки
 * внутри одного имени, `**` — любая глубина, шаблон на `/` — папка целиком.
 */

/* Своё у Astral: временные и служебные имена движка (`.astral-swap`,
   `.astral-vanilla`, `update.rpf.astral-stage-…`) и метка второй копии. */
const ASTRAL_SEGMENT = /\.astral/;
const ASTRAL_FILES = new Set(["astral-linked-copy.json"]);
/* Кроме одного: `*.astral-parked` — чужой плагин, который Astral отложил
   (`foreign-loaders.js`). Он не Astral, он лишний. */
const PARKED = /\.astral-parked(\.\d+)?$/;

/*
 * Правила «не штатный» по умолчанию. Опись с сервера может их дополнить
 * (`nonStock`), но не убрать: эти имена штатными не бывают ни в одной сборке.
 * `kind` — чем это назвать человеку (`stock-reset-copy.js` в окне).
 */
export const DEFAULT_NON_STOCK = Object.freeze([
  { pattern: "mods/", kind: "mods-folder" },
  { pattern: "newmods/", kind: "mods-folder" },
  { pattern: "openiv.asi", kind: "archive-plugin" },
  { pattern: "openrpf.asi", kind: "archive-plugin" },
  { pattern: "closediv.asi", kind: "archive-plugin" },
  { pattern: "rageopenv.asi", kind: "astral-loader" },
  { pattern: "dinput8.dll", kind: "asi-loader" },
  { pattern: "xinput1_4.dll", kind: "asi-loader" },
  { pattern: "dsound.dll", kind: "asi-loader" },
  { pattern: "version.dll", kind: "asi-loader" },
  { pattern: "*.asi", kind: "plugin" },
  { pattern: "scripthookv.dll", kind: "scripts" },
  { pattern: "scripthookvdotnet*.dll", kind: "scripts" },
  { pattern: "scripts/", kind: "scripts" },
  { pattern: "plugins/", kind: "scripts" },
  { pattern: "dxgi.dll", kind: "graphics" },
  { pattern: "d3d11.dll", kind: "graphics" },
  { pattern: "d3d9.dll", kind: "graphics" },
  { pattern: "reshade.ini", kind: "graphics" },
  { pattern: "reshadepreset.ini", kind: "graphics" },
  { pattern: "reshade-shaders/", kind: "graphics" },
  { pattern: "enbseries/", kind: "graphics" },
  { pattern: "enbseries.ini", kind: "graphics" },
  { pattern: "enblocal.ini", kind: "graphics" },
  { pattern: "d3dcompiler_46e.dll", kind: "graphics" },
  { pattern: "*.log", kind: "leftover" },
  { pattern: "openiv/", kind: "leftover" },
]);

/*
 * Не трогать и не считать: файлы магазина и самой игры, которые меняются
 * сами (опись их не держит, иначе на каждой второй машине они были бы
 * «изменены»), и настройки запуска игрока.
 */
export const DEFAULT_IGNORE = Object.freeze([
  ".egstore/",
  "installscript.vdf",
  "steam_appid.txt",
  "commandline.txt",
  "*.dmp",
  "crashpad/",
]);

export const posixRelative = (value) =>
  String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const escape = (value) => value.replace(/[.+^${}()|[\]\\?]/g, "\\$&");

/* Шаблон → проверка пути (нижний регистр, `/`). Без `/` в шаблоне — только корень. */
export function compileRule(pattern) {
  const raw = String(pattern || "").toLowerCase().replace(/\\/g, "/");
  if (!raw || raw.includes("..")) throw new Error(`Плохой шаблон описи: ${pattern}`);
  const folder = raw.endsWith("/");
  const body = folder ? raw.slice(0, -1) : raw;
  const source = body
    .split("/")
    .map((part) =>
      part === "**"
        ? ".*"
        : escape(part).replace(/\*/g, "[^/]*"),
    )
    .join("/");
  const re = new RegExp(folder ? `^${source}(?:/.*)?$` : `^${source}$`);
  return (relative) => re.test(relative);
}

function compileList(list) {
  return (list || []).map((item) => {
    const rule = typeof item === "string" ? { pattern: item } : item;
    return { ...rule, test: compileRule(rule.pattern) };
  });
}

/**
 * Правила одной сверки: умолчания + то, что добавила опись.
 * @param {{ nonStock?: Array, ignore?: string[] }} [manifest]
 */
export function createRules(manifest = null) {
  const nonStock = compileList([
    ...DEFAULT_NON_STOCK,
    ...(Array.isArray(manifest?.nonStock) ? manifest.nonStock : []),
  ]);
  const ignore = compileList([
    ...DEFAULT_IGNORE,
    ...(Array.isArray(manifest?.ignore) ? manifest.ignore : []),
  ]);
  return {
    /** Своё у Astral: не трогается сбросом (его снимает «Вернуть GTA V без модов»). */
    astral(relative) {
      const lower = relative.toLowerCase();
      if (PARKED.test(lower)) return false;
      return ASTRAL_FILES.has(lower) || lower.split("/").some((part) => ASTRAL_SEGMENT.test(part));
    },
    parked: (relative) => PARKED.test(relative.toLowerCase()),
    ignored: (relative) => ignore.some((rule) => rule.test(relative.toLowerCase())),
    /** Чем это назвать, если это заведомо не штатный файл; иначе `null`. */
    nonStock(relative) {
      const lower = relative.toLowerCase();
      if (PARKED.test(lower)) return "parked";
      return nonStock.find((rule) => rule.test(lower))?.kind || null;
    },
  };
}
