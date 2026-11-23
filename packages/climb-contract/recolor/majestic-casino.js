/*
 * Казино Majestic RP — работа редактора (Хелпер 7, 25.10.2026): что человек сделал с покрытиями и подсветкой казино.
 *
 * Работа — две вещи. Покрытия (`coverings`, 27 листов стен, пола, потолка, обивки и металла, `inventory/majestic-casino.js`): «Как в игре»,
 * «Перекрасить» (тон по светотени листа — узор остаётся) или «Залить» (ровный цвет; у плашки до 8 пикселей — тоже заливка). Подсветка (`glow`, пять
 * светящихся листов): «Как в игре», свой цвет (тоном по светотени) или «Выключена» (лист чёрный — гаснет и свет ламп). Картины, вывески и предметы
 * зала — следующими шагами; схема 1 их не держит, лишние поля отбрасываются.
 *
 * Установка (`apps/desktop/src/recolor-majestic-interiors.js`) правит те же листы во всех файлах пакетов казино, где они лежат (словарь и его HD-копия), и
 * кладёт файлы под теми же именами в пакет Astral: перекрытие по именам, как у арены мода. Кадр редактора рисует то же (`casinoFrameLook`).
 */

import INVENTORY from "./inventory/majestic-casino.js";
import { normalizeRecolourHex } from "./colour.js";

export const CASINO_PROJECT_SCHEMA = 1;
export const CASINO_COVERING_MODES = Object.freeze(["standard", "tint", "fill"]);
export const CASINO_GLOW_MODES = Object.freeze(["standard", "colour", "off"]);
/* Лист не больше 8 пикселей — «плашка»: цвет ей даётся заливкой (как у арены). */
export const CASINO_PLATE_SIDE = 8;
const NAME_LIMIT = 60;
const DEFAULT_COLOUR = "#2f80ed";

const COVERINGS = new Set(INVENTORY.coverings.map((item) => item.tex));
const GLOW = new Set(INVENTORY.glow.sheets.map((item) => item.tex));

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Покрытие или подсветка: `{ mode, colour }`; у режима без цвета цвет помнится (человек вернётся к нему). */
function normalizeLook(input, modes) {
  const source = plain(input);
  return { mode: modes.includes(source.mode) ? source.mode : "standard", colour: normalizeRecolourHex(source.colour, DEFAULT_COLOUR) };
}

export function createCasinoProject() {
  return normalizeCasinoProject({});
}

/** Приводит работу в порядок; чужие листы, незнакомые режимы и лишние поля отбрасываются молча; «как в игре» без цвета не хранится. */
export function normalizeCasinoProject(input) {
  const source = plain(input);
  const coverings = {};
  for (const [tex, look] of Object.entries(plain(source.coverings))) {
    const key = String(tex).toLowerCase();
    if (!COVERINGS.has(key)) continue;
    const normal = normalizeLook(look, CASINO_COVERING_MODES);
    if (normal.mode !== "standard") coverings[key] = normal;
  }
  return {
    schema: CASINO_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    coverings,
    glow: normalizeLook(source.glow, CASINO_GLOW_MODES),
  };
}

/** «Стандарт»: ни одного покрытия не правлено, подсветка как в игре — ставить нечего. */
export const casinoProjectIsStock = (input) => {
  const project = normalizeCasinoProject(input);
  return !Object.keys(project.coverings).length && project.glow.mode === "standard";
};

/** Отпечаток для очереди «Применить»: правленые листы в стабильном порядке. */
export function casinoProjectSignature(input) {
  const project = normalizeCasinoProject(input);
  return JSON.stringify({
    coverings: Object.keys(project.coverings)
      .sort()
      .map((tex) => [tex, project.coverings[tex].mode, project.coverings[tex].mode === "tint" || project.coverings[tex].mode === "fill" ? project.coverings[tex].colour : ""]),
    glow: project.glow.mode === "standard" ? "standard" : [project.glow.mode, project.glow.mode === "colour" ? project.glow.colour : ""],
  });
}

/** «Как в игре»: правки сняты, имя работы остаётся. */
export const applyCasinoStandard = (input) => ({ ...normalizeCasinoProject(input), coverings: {}, glow: { ...normalizeCasinoProject(input).glow, mode: "standard" } });

/**
 * Что делать с листом при установке (формат `sheetPixels`): `{ tint }`, `{ flat }` (три числа), `{ transparent }` не бывает — убрать лист нельзя.
 * `null` — лист как в игре. `plate` — лист не больше 8 пикселей, `rgb` — цвет тремя числами (нужен заливке).
 */
export function casinoSheetOp(project, tex, { plate = false, rgb = null } = {}) {
  const key = String(tex).toLowerCase();
  const normal = normalizeCasinoProject(project);
  if (COVERINGS.has(key)) {
    const look = normal.coverings[key];
    if (!look) return null;
    if (look.mode === "fill" || (plate && rgb)) return rgb ? { flat: rgb } : { tint: look.colour };
    return { tint: look.colour };
  }
  if (GLOW.has(key)) {
    if (normal.glow.mode === "off") return { flat: [0, 0, 0] };
    if (normal.glow.mode === "colour") return plate && rgb ? { flat: rgb } : { tint: normal.glow.colour };
  }
  return null;
}

/**
 * Цвет, которым работа красит лист (`#rrggbb`), или `null` — лист без цвета (как в игре или подсветка выключена). Установке он нужен, чтобы
 * перевести его в три числа для заливки и плашки.
 */
export function casinoSheetColour(project, tex) {
  const key = String(tex).toLowerCase();
  const normal = normalizeCasinoProject(project);
  if (COVERINGS.has(key)) return normal.coverings[key]?.colour ?? null;
  if (GLOW.has(key)) return normal.glow.mode === "colour" ? normal.glow.colour : null;
  return null;
}

/** Все листы, у которых работа что-то меняет: `[имя листа]` (покрытия и подсветка). */
export function casinoChangedSheets(project) {
  const normal = normalizeCasinoProject(project);
  return [...Object.keys(normal.coverings), ...(normal.glow.mode === "standard" ? [] : [...GLOW])];
}

/**
 * Файлы пака, где лежат правленые листы: `Map` имя файла → `Set` листов, что в нём красятся. У каждого листа в описи записаны все файлы, где он есть
 * (словарь и модели со встроенными копиями), — установка правит их все.
 */
export function casinoFilesToBake(project) {
  const sheets = new Set(casinoChangedSheets(project));
  const files = new Map();
  const add = (tex, names) => {
    if (!sheets.has(tex)) return;
    for (const name of names) {
      if (!files.has(name)) files.set(name, new Set());
      files.get(name).add(tex);
    }
  };
  for (const item of INVENTORY.coverings) add(item.tex, item.files);
  for (const item of INVENTORY.glow.sheets) add(item.tex, item.files);
  return files;
}

/**
 * Облик материала зала в кадре (формат `ModelStage.look`): `info.sheet` — игровое имя листа, `info.colour` — его средний цвет, `info.texture` — картинка
 * есть (без неё — плашка). Правки нет — `null`, кадр оставляет облик зала.
 */
export function casinoFrameLook(project, info) {
  const key = String(info?.sheet || "").toLowerCase();
  if (!key) return null;
  const normal = normalizeCasinoProject(project);
  const plate = info.texture == null;
  if (COVERINGS.has(key)) {
    const look = normal.coverings[key];
    if (!look) return null;
    if (look.mode === "fill" || plate) return { colour: look.colour, map: false };
    return { colour: info.colour, tint: { colour: look.colour, ref: 0.5, brightness: 1 } };
  }
  if (GLOW.has(key)) {
    if (normal.glow.mode === "off") return { colour: "#000000", map: false, emission: 0 };
    if (normal.glow.mode === "colour") return plate ? { colour: normal.glow.colour, map: false } : { colour: info.colour, tint: { colour: normal.glow.colour, ref: 0.5, brightness: 1 } };
  }
  return null;
}
