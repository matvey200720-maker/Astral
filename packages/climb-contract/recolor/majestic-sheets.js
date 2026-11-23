/*
 * «Интерьеры Majestic RP» — листы любого интерьера (ТЗ 29.10.2026-e, п. 3): правка не по классу поверхности (стены, пол, потолок, мебель), а по
 * самому листу — тому, что игра называет текстурой. Щелчок по вещи в кадре выбирает её лист, панель показывает его превью и режим.
 *
 * Работа — `{ <номер интерьера p<hex>>: { <имя листа строчными>: { mode, colour } } }`. Режимы те же, что у покрытий казино
 * (`majestic-casino.js`): «Как в игре» (в работе не хранится), «Перекрасить» (`tint`: тон по светотени листа — узор остаётся) и «Залить»
 * (`fill`: ровный цвет; лист не больше 8 пикселей — плашка — тоже заливка). Список листов не заводится руками, как опись казино, а берётся
 * из самого кадра интерьера: что есть в помещении, то и можно выбрать. Казино правится и так, и так: 27 его покрытий — по описи, остальные листы — отсюда.
 *
 * Четвёртый режим — «Своя картинка» (`picture`, ТЗ 29.10.2026-e, студия текстур): лист заменяется картинкой из студии (`texture-studio/`), что лежит в хранилище окна
 * под отпечатком (`hangar-emblem:<sha256>`, как картинки арены и эмблемы); в работе — ключ, имя и размер, сами байты уходят в установку отдельно (`images`).
 *
 * Установка (`apps/desktop/src/recolor-majestic-interiors.js`) красит эти листы во всех файлах интерьера, где они лежат (словарь и модели со
 * встроенными копиями), и кладёт файлы под теми же именами в пакет Astral: перекрытие по именам. Кадр редактора рисует то же (`sheetFrameLook`).
 */

import { normalizeRecolourHex } from "./colour.js";
import { EMBLEM_ASSET } from "./emblems.js";

export const SHEET_MODES = Object.freeze(["standard", "tint", "fill", "picture"]);
/* Лист не больше 8 пикселей — «плашка»: цвет ей даётся заливкой, как у казино и арены. */
export const SHEET_PLATE_SIDE = 8;
const DEFAULT_COLOUR = "#2f80ed";
const UNIT_ID = /^p[0-9a-f]{8}$/;
/* Имя листа в файлах игры: латиница, цифры, подчёркивание, точка, дефис. */
const SHEET_NAME = /^[a-z0-9_.-]{1,64}$/;
export const SHEETS_PER_UNIT_LIMIT = 400;
export const SHEET_UNITS_LIMIT = 80;
/* Своих картинок в работе — не больше: каждая уходит в установку base64-строкой (до 2048 px по длинной стороне), и вход канала проходит через JSON. */
export const SHEET_PICTURES_LIMIT = 16;
const PICTURE_SIDE_LIMIT = 8192;
/* Картинка лежит на всём листе, растянутая, и заменяет его пиксели целиком (прозрачное в картинке — прозрачное в листе): `placeImageInIslands` арены. */
const WHOLE_SHEET = Object.freeze({ rect: Object.freeze([0, 0, 1, 1]) });
const PICTURE_TRANSFORM = Object.freeze({ fit: "stretch", background: "clear" });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Картинка листа: `{ asset, name, width, height }` или `null` (нет ключа хранилища — картинки нет). */
export function normalizeSheetPicture(input) {
  const source = plain(input);
  if (!EMBLEM_ASSET.test(String(source.asset || ""))) return null;
  const side = (value) => Math.max(0, Math.min(PICTURE_SIDE_LIMIT, Math.floor(Number(value) || 0)));
  return { asset: source.asset, name: String(source.name ?? "").trim().slice(0, 80), width: side(source.width), height: side(source.height) };
}

/**
 * Облик листа: `{ mode, colour }` (у «Своей картинки» ещё `picture`); цвет режима «как в игре» помнится — человек к нему вернётся. Режим «картинка» без
 * ключа хранилища — «как в игре»: ставить нечего.
 */
export function normalizeSheetLook(input) {
  const source = plain(input);
  const colour = normalizeRecolourHex(source.colour, DEFAULT_COLOUR);
  const mode = SHEET_MODES.includes(source.mode) ? source.mode : "standard";
  if (mode !== "picture") return { mode, colour };
  const picture = normalizeSheetPicture(source.picture);
  return picture ? { mode, colour, picture } : { mode: "standard", colour };
}

/**
 * Приводит часть работы в порядок: чужие номера и имена, незнакомые режимы и лишние поля уходят молча; листы «как в игре» не хранятся; интерьер без
 * правленых листов не хранится; потолки (`SHEETS_PER_UNIT_LIMIT`, `SHEET_UNITS_LIMIT`) режут избыток по возрастанию имени.
 */
export function normalizeSheetsPart(input) {
  const out = {};
  const pictures = new Set();
  for (const unit of Object.keys(plain(input)).sort().slice(0, SHEET_UNITS_LIMIT)) {
    if (!UNIT_ID.test(unit)) continue;
    const sheets = {};
    for (const tex of Object.keys(plain(plain(input)[unit])).sort()) {
      const key = tex.toLowerCase();
      if (!SHEET_NAME.test(key) || Object.keys(sheets).length >= SHEETS_PER_UNIT_LIMIT) continue;
      const look = normalizeSheetLook(plain(plain(input)[unit])[tex]);
      if (look.mode === "standard") continue;
      /* Сверх предела своих картинок лист остаётся без правки (картинок, а не листов: одна картинка может лежать на многих листах). */
      if (look.mode === "picture" && !pictures.has(look.picture.asset) && pictures.size >= SHEET_PICTURES_LIMIT) continue;
      if (look.mode === "picture") pictures.add(look.picture.asset);
      sheets[key] = look;
    }
    if (Object.keys(sheets).length) out[unit] = sheets;
  }
  return out;
}

/** Ключи картинок хранилища, что берёт работа, по возрастанию: по ним окно собирает байты для установки. */
export function sheetPicturesOf(part) {
  const assets = new Set();
  for (const sheets of Object.values(normalizeSheetsPart(part))) for (const look of Object.values(sheets)) if (look.mode === "picture") assets.add(look.picture.asset);
  return [...assets].sort();
}

/** Код для друга: картинки хранятся в окне владельца и в код не едут — лист у друга станет «как в игре». */
export function shareableSheetsPart(part) {
  const out = {};
  for (const [unit, sheets] of Object.entries(normalizeSheetsPart(part))) {
    const kept = Object.fromEntries(Object.entries(sheets).filter(([, look]) => look.mode !== "picture"));
    if (Object.keys(kept).length) out[unit] = kept;
  }
  return out;
}

/** Есть ли в части листы со своей картинкой. */
export const sheetsPartHasPictures = (part) => sheetPicturesOf(part).length > 0;

/** Ни у одного интерьера нет правленых листов. */
export const sheetsPartIsStock = (part) => Object.keys(normalizeSheetsPart(part)).length === 0;

/** Интерьеры с правленными листами, по возрастанию номера. */
export const sheetsChangedUnits = (part) => Object.keys(normalizeSheetsPart(part)).sort();

/** Облик листа интерьера; нет — «как в игре» (`standard`, цвет по умолчанию). */
export const sheetLookOf = (part, unit, tex) => normalizeSheetsPart(part)[unit]?.[String(tex || "").toLowerCase()] || normalizeSheetLook({});

/** Правленые листы интерьера: `Map` имя → облик. */
export const sheetsOfUnit = (part, unit) => new Map(Object.entries(normalizeSheetsPart(part)[unit] || {}));

/**
 * Часть с листом `tex` интерьера `unit`, поставленным в `look`; «как в игре» лист из части убирает. Другие листы и интерьеры не меняются.
 */
export function setSheetLook(part, unit, tex, look) {
  const key = String(tex || "").toLowerCase();
  const normal = normalizeSheetsPart(part);
  if (!UNIT_ID.test(unit) || !SHEET_NAME.test(key)) return normal;
  const next = { ...normal, [unit]: { ...(normal[unit] || {}), [key]: normalizeSheetLook(look) } };
  /* «Как в игре» не хранится, но цвет у режима `standard` нормализация сохранила бы — поэтому лист просто убирается. */
  if (next[unit][key].mode === "standard") delete next[unit][key];
  return normalizeSheetsPart(next);
}

/** Листы интерьера «как в игре»: правки интерьера сняты. */
export function clearSheetsOfUnit(part, unit) {
  const normal = normalizeSheetsPart(part);
  delete normal[unit];
  return normal;
}

/** «Стандарт»: правки листов сняты везде. */
export const applySheetsStandard = () => ({});

/** Отпечаток очереди «Применить»: правленые листы по интерьерам в стабильном порядке. */
export function sheetsPartSignature(part) {
  const normal = normalizeSheetsPart(part);
  return JSON.stringify(Object.keys(normal).sort().map((unit) => [unit, Object.keys(normal[unit]).sort().map((tex) => [tex, normal[unit][tex].mode, normal[unit][tex].colour, normal[unit][tex].picture?.asset || ""])]));
}

/**
 * Что делать с листом при установке (формат `sheetPixels`): `{ tint }`, `{ flat }` (три числа) или `{ image, islands, transform }` — ключ картинки хранилища, байты которой установщик
 * подставляет сам (`images`), растянутая на весь лист; `null` — лист как в игре. `plate` — лист не больше 8 пикселей, `rgb` — цвет тремя числами (нужен заливке).
 */
export function sheetOp(look, { plate = false, rgb = null } = {}) {
  const normal = normalizeSheetLook(look);
  if (normal.mode === "standard") return null;
  if (normal.mode === "picture") return { image: normal.picture.asset, islands: [WHOLE_SHEET], transform: PICTURE_TRANSFORM };
  if (normal.mode === "fill" || (plate && rgb)) return rgb ? { flat: rgb } : { tint: normal.colour };
  return { tint: normal.colour };
}

/**
 * Облик материала листа в кадре (формат `ModelStage.look`): `info.name` — игровое имя листа, `info.colour` — его средний цвет, `info.texture` —
 * картинка есть (без неё — плашка). Правки нет — `null`, кадр оставляет облик зала. У «Своей картинки» — `{ picture: <ключ> }`: текстуру из хранилища окна кадр
 * подставляет сам (контракт текстур не строит).
 */
export function sheetFrameLook(part, unit, info) {
  const key = String(info?.name || info?.sheet || "").toLowerCase();
  if (!key) return null;
  const look = normalizeSheetsPart(part)[unit]?.[key];
  if (!look) return null;
  if (look.mode === "picture") return { colour: info.colour, picture: look.picture.asset };
  if (look.mode === "fill" || info.texture == null) return { colour: look.colour, map: false };
  return { colour: info.colour, tint: { colour: look.colour, ref: 0.5, brightness: 1 } };
}
