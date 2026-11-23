/*
 * Групповые метки (задача 21 ТЗ 18.10.2026, вечер): договор окна и установщика.
 *
 * На проектах метки, что люди кидают группе, рисует сам сервер — своей картинкой
 * (у Majestic на снимке владельца — золотая маска) и своей подписью расстояния; файлом
 * игры они не меняются. Игра же рисует собственные метки теми листами, что лежат в
 * словарях `x64/textures/script_txds.rpf` у `update.rpf`: скрипты Rockstar берут их
 * через `DRAW_SPRITE`, а серверы, которые не рисуют своего, — тоже их. Список ниже снят
 * с игры игрока 18.10.2026 (Steam Legacy, update.rpf): имя словаря, имя листа, размер
 * и формат — как они лежат в файле, не угаданные.
 *
 * Метка бывает у каждого листа своя: у «Круга-указателя» и «Короны» их несколько на
 * разные размеры (256 и 128) — одна метка меняет их все сразу, картинка вписывается в
 * размер каждого. Лист ytd статичен: анимации у такой метки нет, гифка берётся первым
 * кадром (кадры возможны только у спрайтов Scaleform).
 *
 * Накладки радара — три спрайта Scaleform `radar_overlay_*` в `scaleform_minimap.rpf/minimap.gfx`: значки бизнесов поверх
 * метки на мини-карте и карте паузы («$», «⚠», «⚡»). Это не метка в 3D-мире, но единственное место, где гифка играет:
 * спрайт — многокадровый ролик (`apps/desktop/src/group-marker-overlay-gfx.js`), кадры гифки — его кадры.
 *
 * Работа — какие метки правлены и как:
 *   stock  — как в игре (в работе такой метки нет, если у неё нет и отделки);
 *   colour — штатный рисунок в своём цвете (светлота рисунка сохраняется);
 *   image  — своя картинка (отпечаток SHA-256 — по нему её находит установщик); у гифки есть ещё лента кадров
 *            (`strip` — PNG, кадры друг под другом), их число и задержки: ролик играет только у накладки радара;
 *   text   — своя надпись вместо метки: текст, шрифт, цвет; окно рисует её картинкой (отпечаток — как у `image`),
 *            установщику шрифты не нужны;
 *   hidden — метки нет (лист прозрачный).
 * Отделка (`group-marker-finish.js`) — размер рисунка в листе, непрозрачность, обводка или свечение, тонировка
 * картинки — лежит рядом с видом метки у stock, colour, image и text. У накладок радара её нет: это спрайты, а не листы.
 */

import { normalizeFinish } from "./group-marker-finish.js";

export { GROUP_MARKER_FINISH_LIMITS, GROUP_MARKER_OUTLINE_COLOUR, GROUP_MARKER_OUTLINE_KINDS, finishMark, groupMarkerFinishOf, hasGroupMarkerFinish, normalizeFinish } from "./group-marker-finish.js";

export const GROUP_MARKERS_SCHEMA_VERSION = 1;
export const GROUP_MARKERS_DICT_DIRECTORY = "x64/textures/script_txds.rpf";
/* Как правлена метка (см. выше); в игру уходит лист DXT/RGBA, а не файл картинки. */
export const GROUP_MARKER_MODES = Object.freeze(["stock", "colour", "image", "text", "hidden"]);
/* Надпись вместо метки: шрифты те же системные Windows с кириллицей, что у меток залазов (как их зовёт холст — знает окно). */
export const GROUP_MARKER_FONTS = Object.freeze(["impact", "bahnschrift", "arial-black", "segoe-black", "franklin", "consolas", "georgia", "comic", "ink", "script"]);
export const GROUP_MARKER_DEFAULT_FONT = "impact";
/* Свой шрифт человека (ТЗ 23.10.2026, п. F): `font: "custom"` и ключ файла в хранилище окна. Надпись окно пишет в PNG, файла в работе нет. */
export const GROUP_MARKER_FONT_CUSTOM = "custom";
const FONT_ASSET = /^workshop-font:[a-f0-9]{64}$/;
export const GROUP_MARKER_DEFAULT_TEXT_COLOUR = "#ffffff";
export const GROUP_MARKER_TEXT_LIMITS = Object.freeze({ chars: 60, lines: 3 });
export const GROUP_MARKER_DEFAULT_COLOUR = "#f5c542";
export const GROUP_MARKER_EDGE_LIMIT = 1024;
/* Накладки радара: файл со спрайтами и лист значков, из которого они нарезаны (внешняя картинка Scaleform). */
export const GROUP_MARKER_OVERLAY_ENTRY = "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap.gfx";
export const GROUP_MARKER_OVERLAY_SHEET_ENTRY = "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap.ytd";
export const GROUP_MARKER_OVERLAY_TARGET = `update:/${GROUP_MARKER_OVERLAY_ENTRY}`;
/* Гифка: кадров не больше, сторона кадра в ленте не больше, задержка — в этих пределах (мс). */
export const GROUP_MARKER_GIF_LIMITS = Object.freeze({ frames: 24, edge: 128, minDelay: 20, maxDelay: 5000 });

const mark = (id, group, label, note, targets, extra = {}) =>
  Object.freeze({
    id,
    group,
    label,
    note,
    /* [{ dict, texture, width, height }] — все листы, что правит метка. */
    targets: Object.freeze(targets.map(([dict, texture, width, height]) => Object.freeze({ dict, texture, width, height }))),
    ...extra,
  });

/* Накладка радара: листов ytd у неё нет — спрайт Scaleform с именем экспорта `sprite`. */
const overlay = (id, label, note, sprite) => Object.freeze({ id, group: "radar", label, note, targets: Object.freeze([]), overlay: Object.freeze({ sprite }) });

export const GROUP_MARKER_GROUPS = Object.freeze([
  Object.freeze({ id: "signs", label: "Знаки" }),
  Object.freeze({ id: "pointers", label: "Указатели" }),
  Object.freeze({ id: "missions", label: "Метки заданий" }),
  Object.freeze({ id: "pins", label: "Булавка и флаг" }),
  Object.freeze({ id: "radar", label: "Накладки радара" }),
]);

export const GROUP_MARKERS = Object.freeze([
  mark(
    "warning",
    "signs",
    "Знак «Внимание»",
    "Белый треугольник с «!» — commonmenu, mp_alerttriangle: им игра отмечает тревогу и опасное место.",
    [["commonmenu", "mp_alerttriangle", 64, 64]],
    { standard: true },
  ),
  mark("ring", "pointers", "Круг-указатель", "Зелёный круг со стрелкой под ним — метка «сюда» в мире (mpinventory, inworld_ringpointer).", [["mpinventory", "inworld_ringpointer", 96, 96]]),
  mark("ring-blue", "pointers", "Круг-указатель, синий", "То же, но синий — метка второй стороны (inworld_ringpointer_blue).", [["mpinventory", "inworld_ringpointer_blue", 96, 96]]),
  mark("chevron", "pointers", "Шеврон", "Белая стрелка-«галочка» вниз с чёрной обводкой (mpinventory, mp_arrow).", [["mpinventory", "mp_arrow", 32, 32]]),
  mark(
    "arrow",
    "pointers",
    "Стрелка",
    "Стрелка-галочка вправо: большая и очень большая (mparrow) — меняются обе.",
    [
      ["mparrow", "mp_arrowlarge", 32, 64],
      ["mparrow", "mp_arrowxlarge", 64, 128],
    ],
  ),
  mark(
    "corona",
    "missions",
    "Кольцо",
    "Белое кольцо метки задания — в двух размерах, 256 и 128 (mpmissmarkers).",
    [
      ["mpmissmarkers256", "corona_marker", 256, 256],
      ["mpmissmarkers128", "corona_marker", 128, 128],
    ],
  ),
  mark(
    "skull",
    "missions",
    "Череп",
    "Круг с черепом — метка схватки, в двух размерах (mpmissmarkers).",
    [
      ["mpmissmarkers256", "deathmatch_marker_256", 256, 256],
      ["mpmissmarkers128", "deathmatch_marker_128", 128, 128],
    ],
  ),
  mark("case", "missions", "Чемодан", "Круг с чемоданом — метка груза и «захвата» (mpmissmarkers256, capture_the_flag_icon).", [["mpmissmarkers256", "capture_the_flag_icon", 256, 256]]),
  mark("race-target", "missions", "Финиш", "Круг с флагом-мишенью — финиш гонки (mpmissmarkers256, target_race).", [["mpmissmarkers256", "target_race", 256, 256]]),
  mark("base", "missions", "База", "Круг с домом и чемоданом — метка базы (mponmissmarkers, capture_the_flag_base_icon).", [["mponmissmarkers", "capture_the_flag_base_icon", 256, 256]]),
  mark("pin", "pins", "Булавка", "Белая булавка — метка места в творце заданий (mppublicmissioncreatoricons).", [["mppublicmissioncreatoricons", "mission_creator_entity_location_icon", 64, 64]]),
  mark("flag", "pins", "Флаг", "Белый флажок — метка точки в творце заданий (mppublicmissioncreatoricons).", [["mppublicmissioncreatoricons", "mission_creator_mission_flag_icon", 64, 64]]),
  overlay(
    "overlay-supplies",
    "Припасы на исходе",
    "Значок «⚠» поверх метки бизнеса на мини-карте и карте паузы (minimap.gfx, radar_overlay_missing_supplies). В 3D-мире его нет; гифка здесь играет.",
    "radar_overlay_missing_supplies",
  ),
  overlay(
    "overlay-sell",
    "Готово к продаже",
    "Значок «$» поверх метки бизнеса на мини-карте и карте паузы (minimap.gfx, radar_overlay_ready_for_sell). В 3D-мире его нет; гифка здесь играет.",
    "radar_overlay_ready_for_sell",
  ),
  overlay(
    "overlay-jammed",
    "Заклинило",
    "Значок «⚡» поверх метки бизнеса на мини-карте и карте паузы (minimap.gfx, radar_overlay_jammed). В 3D-мире его нет; гифка здесь играет.",
    "radar_overlay_jammed",
  ),
]);

const BY_ID = new Map(GROUP_MARKERS.map((item) => [item.id, item]));
export const findGroupMarker = (id) => BY_ID.get(String(id || "")) || null;

/* Где у игры лежит словарь: правленный — в update.rpf (его и меняет работа). */
export const groupMarkerDictEntry = (dict) => `${GROUP_MARKERS_DICT_DIRECTORY}/${dict}.ytd`;
export const groupMarkerDictTarget = (dict) => `update:/${groupMarkerDictEntry(dict)}`;
/* Эталон Rockstar, если у словаря он есть в базовых архивах: по порядку, первый найденный. */
export const GROUP_MARKER_STOCK_SOURCES = Object.freeze({
  commonmenu: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/commonmenu.ytd"]]),
  mpinventory: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/mpinventory.ytd"]]),
  mparrow: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/mparrow.ytd"], ["x64a.rpf", "textures/level_design_titleupdate/mparrow.ytd"]]),
  mpmissmarkers128: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/mpmissmarkers128.ytd"]]),
  mpmissmarkers256: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/mpmissmarkers256.ytd"], ["x64a.rpf", "textures/level_design_titleupdate/mpmissmarkers256.ytd"]]),
  mponmissmarkers: Object.freeze([["x64v.rpf", "textures/script_txds.rpf/mponmissmarkers.ytd"], ["x64a.rpf", "textures/level_design_titleupdate/mponmissmarkers.ytd"]]),
  mppublicmissioncreatoricons: Object.freeze([]),
});

/** Все словари каталога — по порядку появления. */
export const GROUP_MARKER_DICTS = Object.freeze([...new Set(GROUP_MARKERS.flatMap((item) => item.targets.map((target) => target.dict)))]);

/* ------------------------------------------------------------------ работа */

const HEX = /^#[0-9a-f]{6}$/i;
const ASSET = /^[0-9a-f]{64}$/;
const hexOf = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);

/* Надпись: строки без хвостовых пробелов, не больше трёх строк и 60 знаков; пустая — «нет надписи». */
export function cleanGroupMarkerText(value) {
  const lines = String(value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .slice(0, GROUP_MARKER_TEXT_LIMITS.lines)
    .map((line) => line.replace(/\s+$/u, ""));
  return lines.join("\n").slice(0, GROUP_MARKER_TEXT_LIMITS.chars).trim();
}

function normalizeMark(input, overlay = false) {
  const source = input && typeof input === "object" ? input : {};
  const mode = GROUP_MARKER_MODES.includes(source.mode) ? source.mode : "stock";
  if (mode === "hidden") return { mode };
  /* Накладка радара — спрайт: цвет, «убрать», картинка и гифка; отделки и надписи у неё нет. */
  if (overlay && (mode === "stock" || mode === "text")) return null;
  const { tint, ...finishRest } = normalizeFinish(source);
  const finish = overlay ? {} : mode === "image" ? { ...finishRest, ...(tint ? { tint } : {}) } : finishRest;
  if (mode === "stock") return Object.keys(finish).length ? { mode, ...finish } : null;
  if (mode === "colour") return { mode, color: hexOf(source.color, GROUP_MARKER_DEFAULT_COLOUR), ...finish };
  const asset = ASSET.test(String(source.asset || "")) ? String(source.asset) : "";
  if (mode === "text") {
    /* Надпись без картинки — только что пришла кодом работы: окно дорисует её на открытии (`asset` появится), а до
       тех пор установщик такую метку не ставит. Текста нет — метка штатная. */
    const text = cleanGroupMarkerText(source.text);
    if (!text) return null;
    const fontAsset = FONT_ASSET.test(String(source.fontAsset || "")) ? String(source.fontAsset) : "";
    return {
      mode,
      text,
      font: GROUP_MARKER_FONTS.includes(source.font) ? source.font : source.font === GROUP_MARKER_FONT_CUSTOM && fontAsset ? GROUP_MARKER_FONT_CUSTOM : GROUP_MARKER_DEFAULT_FONT,
      ...(fontAsset ? { fontAsset, fontName: String(source.fontName ?? "").trim().slice(0, 60) } : {}),
      color: hexOf(source.color, GROUP_MARKER_DEFAULT_TEXT_COLOUR),
      ...(asset ? { asset } : {}),
      name: text.replace(/\s+/gu, " ").slice(0, 80),
      ...finish,
    };
  }
  /* Картинки нет — метка остаётся штатной: ссылке в никуда установщик верить нечему. */
  if (!asset) return null;
  const edit = { mode, asset, name: String(source.name || "").slice(0, 80), animated: source.animated === true };
  /* Гифка кадрами: лента, число кадров и задержка каждого — вместе или никак (метка остаётся неподвижной картинкой). */
  const { frames, minDelay, maxDelay } = GROUP_MARKER_GIF_LIMITS;
  const count = Number(source.frames);
  const delays = Array.isArray(source.delays) ? source.delays.map((value) => Math.min(maxDelay, Math.max(minDelay, Math.round(Number(value) || 0)))) : [];
  if (ASSET.test(String(source.strip || "")) && Number.isInteger(count) && count >= 2 && count <= frames && delays.length === count) {
    edit.strip = String(source.strip);
    edit.frames = count;
    edit.delays = delays;
  }
  return { ...edit, ...finish };
}

export function createGroupMarkersWork() {
  return { schema: GROUP_MARKERS_SCHEMA_VERSION, marks: {} };
}

/** Работа без имени — то, что уходит в главный процесс. */
export function normalizeGroupMarkersWork(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawMarks = source.marks && typeof source.marks === "object" && !Array.isArray(source.marks) ? source.marks : {};
  const marks = {};
  for (const item of GROUP_MARKERS) {
    const own = normalizeMark(rawMarks[item.id], Boolean(item.overlay));
    if (own) marks[item.id] = own;
  }
  return { schema: GROUP_MARKERS_SCHEMA_VERSION, marks };
}

export const groupMarkersWorkIsStock = (work) => Object.keys(normalizeGroupMarkersWork(work).marks).length === 0;

/** Сколько меток правлено, и какие. */
export function changedGroupMarkers(work) {
  const { marks } = normalizeGroupMarkersWork(work);
  return GROUP_MARKERS.filter((item) => marks[item.id]).map((item) => ({ ...item, edit: marks[item.id] }));
}

/** Словари, которых касается работа: у каждого — какие листы чем заменить. */
export function groupMarkerDictionaries(work) {
  const out = new Map();
  for (const item of changedGroupMarkers(work))
    for (const target of item.targets) {
      const list = out.get(target.dict) || [];
      list.push({ ...target, mark: item.id, edit: item.edit });
      out.set(target.dict, list);
    }
  return out;
}

/**
 * Свои картинки работы: отпечаток → имя. Лента кадров гифки нужна только накладке радара — у листа ytd кадров нет,
 * он берёт первый кадр (`asset`).
 */
export function groupMarkerAssets(work) {
  const out = new Map();
  for (const item of changedGroupMarkers(work)) {
    if ((item.edit.mode !== "image" && item.edit.mode !== "text") || !item.edit.asset) continue;
    out.set(item.edit.asset, item.edit.name || "");
    if (item.overlay && item.edit.strip) out.set(item.edit.strip, item.edit.name || "");
  }
  return out;
}

/** Накладки радара, которых касается работа: `[{ mark, sprite, edit }]`. */
export function groupMarkerOverlays(work) {
  return changedGroupMarkers(work)
    .filter((item) => item.overlay)
    .map((item) => ({ mark: item.id, sprite: item.overlay.sprite, edit: item.edit }));
}

const plural = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

/** Короткая строка о работе — для статуса и сводки установки. */
export function describeGroupMarkersWork(work) {
  const changed = changedGroupMarkers(work);
  if (!changed.length) return "как в игре";
  const count = changed.length;
  return `${count} ${plural(count, "метка", "метки", "меток")} из ${GROUP_MARKERS.length}`;
}

/* Подпись для сравнения «поставлено — не поставлено»: то, что меняет игру. */
export function groupMarkersSignature(work) {
  const { marks } = normalizeGroupMarkersWork(work);
  /* Имя картинки и «это гифка» игру не меняют; всё остальное — отделка и надпись — меняет. */
  return JSON.stringify(
    GROUP_MARKERS.filter((item) => marks[item.id]).map((item) => {
      const { name: _name, animated: _animated, ...rest } = marks[item.id];
      return [item.id, rest];
    }),
  );
}

/* ------------------------------------------------------------------ цвет */

const rgbOf = (value) => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Штатный рисунок в своём цвете: светлота каждой точки сохраняется, самая светлая
 * непрозрачная точка листа становится ровно цветом метки, прозрачность — как у игры.
 * Работает на месте и возвращает тот же массив (RGBA, 4 байта на точку).
 */
export function recolourMark(rgba, color) {
  const [cr, cg, cb] = rgbOf(hexOf(color, GROUP_MARKER_DEFAULT_COLOUR));
  /* Опора светлоты — 95-й процент по непрозрачным точкам: одинокий блик не затемняет всё остальное. */
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < 128) continue;
    histogram[Math.min(255, Math.round(lumaOf(rgba[at], rgba[at + 1], rgba[at + 2])))] += 1;
    total += 1;
  }
  let reference = 255;
  if (total) {
    let seen = 0;
    for (let level = 255; level >= 0; level -= 1) {
      seen += histogram[level];
      if (seen >= total * 0.05) {
        reference = Math.max(32, level);
        break;
      }
    }
  }
  for (let at = 0; at < rgba.length; at += 4) {
    const scale = Math.min(1, lumaOf(rgba[at], rgba[at + 1], rgba[at + 2]) / reference);
    rgba[at] = Math.round(cr * scale);
    rgba[at + 1] = Math.round(cg * scale);
    rgba[at + 2] = Math.round(cb * scale);
  }
  return rgba;
}

/** Прозрачный лист — метка убрана совсем. */
export function clearMark(rgba) {
  for (let at = 0; at < rgba.length; at += 4) rgba[at + 3] = 0;
  return rgba;
}
