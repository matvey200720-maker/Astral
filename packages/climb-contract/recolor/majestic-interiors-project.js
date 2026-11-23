/*
 * «Интерьеры Majestic RP» — работа редактора (Хелпер 7, 25.10.2026).
 *
 * Корень работы один на все двенадцать интерьеров сервера (`majestic-interiors.js`); у каждого интерьера своя часть. Казино — `casino`
 * (покрытия и подсветка, `majestic-casino.js`); остальные десять интерьеров — `colour` (цвет и блеск поверхностей по номеру интерьера,
 * `majestic-colour.js`); у любого интерьера, казино тоже, ещё `sheets` — правка по самим листам (`majestic-sheets.js`, ТЗ 29.10.2026-e); без части
 * работа прежних версий читается как «как в игре». «Стандарт» — ставить нечего, «Применить» снимает установку.
 *
 * Договор набора (`RECOLOR_PROJECTS.majesticinteriors`): пустая работа, разбор, строка для хранилища, отпечаток очереди «Применить», «как в игре» ли,
 * кнопка «Стандарт», «код для друга» и что в код не едет.
 */

import { applyCasinoStandard, casinoProjectIsStock, casinoProjectSignature, normalizeCasinoProject } from "./majestic-casino.js";
import { applyColourStandard, colourPartIsStock, colourPartSignature, normalizeColourPart } from "./majestic-colour.js";
import { applySheetsStandard, normalizeSheetsPart, shareableSheetsPart, sheetsPartHasPictures, sheetsPartIsStock, sheetsPartSignature } from "./majestic-sheets.js";

export const MAJESTIC_INTERIORS_SCHEMA = 1;
export const MAJESTIC_INTERIORS_SET = "majesticinteriors";
const NAME_LIMIT = 60;

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Часть казино без шапки (`schema`, `name` держит корень). */
function casinoPart(input) {
  const { coverings, glow } = normalizeCasinoProject(input);
  return { coverings, glow };
}

export function createMajesticInteriors() {
  return normalizeMajesticInteriors({});
}

/** Приводит работу в порядок; лишнее отбрасывается молча. */
export function normalizeMajesticInteriors(input) {
  const source = plain(input);
  return {
    schema: MAJESTIC_INTERIORS_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    casino: casinoPart(source.casino),
    colour: normalizeColourPart(source.colour),
    sheets: normalizeSheetsPart(source.sheets),
  };
}

export function parseMajesticInteriors(text) {
  try {
    return normalizeMajesticInteriors(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createMajesticInteriors();
  }
}

export const serializeMajesticInteriors = (project) => JSON.stringify(normalizeMajesticInteriors(project));

/** «Стандарт»: ни один интерьер не правлен — ставить нечего. */
export const majesticInteriorsIsStock = (input) => {
  const project = normalizeMajesticInteriors(input);
  return casinoProjectIsStock(project.casino) && colourPartIsStock(project.colour) && sheetsPartIsStock(project.sheets);
};

/** Отпечаток очереди «Применить»: что меняет файлы, по интерьерам. */
export function majesticInteriorsSignature(input) {
  const project = normalizeMajesticInteriors(input);
  return JSON.stringify({
    casino: casinoProjectIsStock(project.casino) ? null : casinoProjectSignature(project.casino),
    colour: colourPartIsStock(project.colour) ? null : colourPartSignature(project.colour),
    sheets: sheetsPartIsStock(project.sheets) ? null : sheetsPartSignature(project.sheets),
  });
}

/** Кнопка «Стандарт»: правки сняты, имя остаётся. */
export function applyMajesticInteriorsStandard(input) {
  const project = normalizeMajesticInteriors(input);
  return { ...project, casino: casinoPart(applyCasinoStandard(project.casino)), colour: applyColourStandard(project.colour), sheets: applySheetsStandard() };
}

/** «Как было» целиком (кнопка «Сбросить»): пустая работа с тем же именем. */
export const resetMajesticInteriors = (input) => ({ ...createMajesticInteriors(), name: normalizeMajesticInteriors(input).name });

/**
 * Код для друга: в нём только настройки; сами файлы интерьеров у друга свои (из каталога Astral или из его папки). Свои картинки листов лежат в хранилище окна владельца
 * и в код не едут: лист со своей картинкой у друга станет «как в игре».
 */
export function shareableMajesticInteriors(input) {
  const project = normalizeMajesticInteriors(input);
  return { ...project, sheets: shareableSheetsPart(project.sheets) };
}

/** Что не едет в код работы, словами; пусто — всё едет. */
export function majesticInteriorsLostInCode(input) {
  if (majesticInteriorsIsStock(input)) return "";
  const files = "сами файлы интерьеров (их скачивают из каталога Astral или берут из своих папок — у друга они должны быть свои)";
  return sheetsPartHasPictures(normalizeMajesticInteriors(input).sheets) ? `${files}; свои картинки листов (они лежат в вашем окне — у друга эти листы станут «как в игре»)` : files;
}
