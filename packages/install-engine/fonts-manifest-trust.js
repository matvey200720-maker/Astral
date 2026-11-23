import { createHash } from "node:crypto";

/*
 * Шрифты из мастерской — один пакет движка: библиотеки шрифтов Scaleform
 * игры со своими глифами под штатными именами (`$Font2`, `$Font2_cond`,
 * `$gtaCash`, `$Font5`). Своих файлов шрифты не везут: обе библиотеки
 * берутся у игрока и правятся на месте (`apps/desktop/src/recolor-fonts.js`),
 * а право писать в update.rpf даёт ровно эта форма манифеста.
 *
 *   • `x64/data/cdimages/scaleform_platform_pc.rpf/font_lib_efigs_pc.gfx` —
 *     библиотека, из которой игра на ПК берёт шрифты по `fontmap.xml`;
 *   • `x64/data/cdimages/scaleform_generic.rpf/font_lib_efigs.gfx` — её
 *     общая сестра, из которой шрифты импортируют фильмы интерфейса.
 *
 * Обе записи в update.rpf уже лежат, поэтому действие — замена на своём
 * месте, как у плиток большой карты; контейнера слоя у шрифтов нет: игра
 * читает библиотеки по своему адресу, а не по имени из content.xml.
 */
export const LOCAL_FONTS_TRUST = Symbol("local-fonts-package");
export const FONTS_SCHEMA = 1;
export const FONTS_SLOT = "fonts";

/* Библиотеки шрифтов: имя в пакете → запись в update.rpf. */
export const FONTS_LIBRARY_ENTRIES = Object.freeze({
  "font_lib_efigs_pc.gfx": "x64/data/cdimages/scaleform_platform_pc.rpf/font_lib_efigs_pc.gfx",
  "font_lib_efigs.gfx": "x64/data/cdimages/scaleform_generic.rpf/font_lib_efigs.gfx",
});
/* Имена шрифтов игры, которые пакет вправе заменить. */
export const FONTS_EXPORTS = Object.freeze(["$Font2", "$Font2_cond", "$gtaCash", "$Font5"]);

/* Штатная библиотека — 233 КБ; восемь мегабайт — уже не она. */
const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;
const MOD_ID = /^local-legacy-fonts-([a-f0-9]{12})$/;
const NAME = "Шрифты Astral";
const ENTRIES = new Map(Object.entries(FONTS_LIBRARY_ENTRIES).map(([name, entry]) => [entry, name]));

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "fonts",
  "files",
]);
const FONTS_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "exports", "libraries"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "size", "sha256"]);
const CAPABILITIES = Object.freeze(["rpf-container-entry-v1", "direct-update-entries-v1"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** Хэш содержимого: отсортированные пары `запись\nsha256` и заменённые имена. */
export function fontsSourceDigest(files, exports) {
  const lines = files.map((file) => `${file.entry}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256")
    .update(`fonts\n${[...exports].join(",")}\n${lines.join("\n")}`, "utf8")
    .digest("hex");
}

export const isFontsModId = (value) => MOD_ID.test(String(value || ""));

/**
 * Манифест шрифтов из описи собранных библиотек `{ name, size, sha256 }`
 * (`name` — ключ `FONTS_LIBRARY_ENTRIES`) и заменённых имён шрифтов игры.
 */
export function buildFontsManifest(files, exports) {
  const names = FONTS_EXPORTS.filter((name) => exports.includes(name));
  const described = files.map((file) => {
    const entry = FONTS_LIBRARY_ENTRIES[file.name];
    if (!entry) throw new Error(`Неизвестная библиотека шрифтов: ${file.name}.`);
    return { source: `payload/${file.name}`, target: "update/update.rpf", action: "replace", entry, size: file.size, sha256: file.sha256 };
  });
  const digest = fontsSourceDigest(described, names);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-fonts-${suffix}`,
    version: `${FONTS_SCHEMA}.0.0-${suffix}`,
    name: NAME,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Шрифт — облик текста, а не правила игры.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [FONTS_SLOT],
    fonts: {
      schemaVersion: FONTS_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      exports: names,
      libraries: described.length,
    },
    files: described.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0)),
  };
}

export function isLocalFontsManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.fonts, FONTS_KEYS)) return false;
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== `${FONTS_SCHEMA}.0.0-${suffix}`) return false;
  if (manifest.name !== NAME) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([FONTS_SLOT])) return false;
  if (manifest.fonts.schemaVersion !== FONTS_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.fonts.sourceDigest || "")) return false;
  const exports = manifest.fonts.exports;
  if (!Array.isArray(exports) || exports.length < 1) return false;
  /* Имена — из закрытого списка, без повторов и в его порядке. */
  if (JSON.stringify(exports) !== JSON.stringify(FONTS_EXPORTS.filter((name) => exports.includes(name)))) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > ENTRIES.size) return false;
  const seen = new Set();
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "replace") return false;
    const name = ENTRIES.get(file.entry);
    if (!name || file.source !== `payload/${name}`) return false;
    /* Одна запись — один файл: дубликат означал бы двойную замену. */
    if (seen.has(file.entry)) return false;
    seen.add(file.entry);
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_LIBRARY_BYTES) return false;
  }
  /* Опись обязана говорить правду о том, что внутри. */
  if (manifest.fonts.libraries !== files.length) return false;
  const digest = fontsSourceDigest(files, exports);
  if (manifest.fonts.sourceDigest !== `sha256:${digest}`) return false;
  return suffix === digest.slice(0, 12);
}
