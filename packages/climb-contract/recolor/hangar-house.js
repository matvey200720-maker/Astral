/*
 * Ангар — «Дом» внутри ангара (мастерская ангара, владелец 23.11.2026: «у домика именно сам красился: стены, окна; внутри не нужно… просто назови дом, и чтобы он красился, у него цвет просто»).
 *
 * «Дом» — комната у восточного торца зала (часть `keep` модели нутра: 20×20 м, повёрнута на 45° к осям ангара). Красится только то, что видно из ангара снаружи дома: блочная стенка
 * (`im_wall_brick_38`) и окна (стекло `mh_v_cor_glass01_d`); нутро дома (потолок, стены, пол, ковёр) не настраивается — прежняя «Комната» убрана.
 *
 * Блочный лист лежит в общем словаре района (`hei_ap1_01_c_buildings.ytd`) и носит то же ИМЯ, что цоколь «Снаружи». Его красит приём копии листа (как плитку пола в прежней комнате,
 * `embedSheetCopies` в `recolor-hangar.js`): копия едет в модель нутра под тем же именем и красится на месте, модель корпуса и цоколь «Снаружи» не меняются, соседние здания тоже.
 * Копия идёт только когда у «Стен» дома задан свой цвет.
 *
 * Правила: красятся только листы из описи (`inventory/hangar-house.js`: числа блочного листа те же, что у цоколя в описи ангара; числа стекла снимает с файлов игры
 * `scripts/prepare-hangar-house-sheets.mjs` — пока их нет, строка «Окна» в окне не показывается и ничего не красится: «мастерская = игра», заглушек цветом нет). Работа со старым полем
 * `room` читается без ошибки: поле игнорируется (нутро комнаты больше не красится), у прежних работ отпечаток «Применить» не меняется.
 *
 * Форма поля: `{ mode: "standard" | "colour", paint?: { walls?, windows? } }`, где у каждой тронутой поверхности `{ mode: "standard" | "colour", colour }`. «Как в игре» помнит цвет, но в
 * игру не пишет. Режим дома — «colour», если хоть у одной поверхности «Свой цвет».
 */

import { normalizeHangarPaint } from "./hangar-paint.js";
import HOUSE_INVENTORY from "./inventory/hangar-house.js";

export const HANGAR_HOUSE_SURFACES = Object.freeze(["walls", "windows"]);
/* Цвет по умолчанию у поверхности (пока человек не выбрал): светлые блоки, голубоватое стекло. */
export const HANGAR_HOUSE_COLOURS = Object.freeze({ walls: "#bebcb6", windows: "#7f9bb3" });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** Дом работы: тронутые поверхности и общий режим. */
export function normalizeHangarHouse(input) {
  const paint = plain(plain(input).paint);
  const out = {};
  for (const surface of HANGAR_HOUSE_SURFACES) {
    const source = paint[surface];
    if (source && typeof source === "object" && !Array.isArray(source)) {
      out.paint ||= {};
      out.paint[surface] = normalizeHangarPaint(source, HANGAR_HOUSE_COLOURS[surface]);
    }
  }
  const coloured = HANGAR_HOUSE_SURFACES.some((surface) => out.paint?.[surface]?.mode === "colour");
  return { mode: coloured ? "colour" : "standard", ...out };
}

/* ------------------------------------------------------------------ *
 * Листы дома
 * ------------------------------------------------------------------ */

const finite = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Опись красящихся листов дома: лист строчными → `{ surface, ref, colour, files, copy? }`. Лист без опорной яркости или чужой поверхности в опись не входит. */
export function buildHangarHouseSheets(sheets = HOUSE_INVENTORY.sheets || {}) {
  const out = {};
  for (const [raw, record] of Object.entries(sheets)) {
    const name = String(raw || "").toLowerCase();
    if (!name || !HANGAR_HOUSE_SURFACES.includes(record?.surface) || !finite(record.ref)) continue;
    /* `copy` — лист лежит в общем словаре района: файл и адрес (числа и пути, без пикселей); без него лист встроен в файлы ангара. */
    const copy = record.copy?.file && record.copy?.at ? Object.freeze({ file: String(record.copy.file), at: String(record.copy.at) }) : null;
    out[name] = Object.freeze({ surface: record.surface, ref: record.ref, colour: record.colour || "#808080", files: Object.freeze([...(record.files || [])]), ...(copy ? { copy } : {}) });
  }
  return Object.freeze(out);
}

export const HANGAR_HOUSE_SHEETS = buildHangarHouseSheets();

/* Опись по умолчанию — настоящая; в проверках подставляется заготовка (`overrideHangarHouseSheets`). */
let active = HANGAR_HOUSE_SHEETS;
const sheetsNow = () => active;
/** Только для проверок: подставить опись листов дома (`null` — вернуть настоящую). */
export function overrideHangarHouseSheets(table) {
  active = table || HANGAR_HOUSE_SHEETS;
}

/** Есть ли лист в описи дома. */
export const hangarHouseHasSheet = (sheet, table = sheetsNow()) => Boolean(table[String(sheet || "").toLowerCase()]);

/** Поверхность красится хоть одним листом из описи: органа окна без листа нет. */
export const hangarHouseAvailable = (surface, table = sheetsNow()) => Object.values(table).some((record) => record.surface === surface);

/** Поверхности дома, у которых есть лист в описи, в порядке окна. */
export const hangarHouseSurfaces = (table = sheetsNow()) => HANGAR_HOUSE_SURFACES.filter((surface) => hangarHouseAvailable(surface, table));

/** Листы поверхности из описи. */
export const hangarHouseSurfaceSheets = (surface, table = sheetsNow()) => Object.keys(table).filter((name) => table[name].surface === surface);

const paintOf = (house, surface) => house?.paint?.[surface];

/**
 * Облик листа дома (кадр и установщик одной арифметикой): `null` — не лист дома или «Как в игре»; иначе `{ kind: "tint", colour, ref, brightness: 1, clean: false }` — тон по светотени листа без чистки
 * (чистка задумана для ржавчины и грязи стен ангара, у блоков и стекла дома их нет — рисунок штатного листа остаётся целиком).
 */
export function hangarHouseSheetLook(project, sheet, table = sheetsNow()) {
  const record = table[String(sheet || "").toLowerCase()];
  if (!record || !project) return null;
  const paint = paintOf(project.house, record.surface);
  if (!paint || paint.mode !== "colour") return null;
  return { kind: "tint", colour: paint.colour, ref: record.ref, brightness: 1, clean: false };
}

/**
 * Листы дома, что едут копией из словаря района в файл ангара `fileName`: `[{ name, record }]` (как `sheetCopies` корпуса) — только лист с `copy`, лежащий в этом файле, и только когда у его
 * поверхности задан свой цвет. Без цвета — пусто: файлы набора те же, что без этой части.
 */
export function hangarHouseSheetCopies(project, fileName, table = sheetsNow()) {
  const normalized = { house: normalizeHangarHouse(project?.house) };
  return Object.entries(table)
    .filter(([name, record]) => record.copy && record.files.includes(fileName) && hangarHouseSheetLook(normalized, name, table))
    .map(([name, record]) => ({ name, record }));
}

/** Красит ли поверхность что-то в этой работе: «Свой цвет» и лист в описи. */
export const hangarHouseActive = (house, surface, table = sheetsNow()) => hangarHouseAvailable(surface, table) && paintOf(house, surface)?.mode === "colour";

/** Дом «как в игре» или красить нечего: ставить нечего. */
export const hangarHouseIsStock = (house, table = sheetsNow()) => !HANGAR_HOUSE_SURFACES.some((surface) => hangarHouseActive(house, surface, table));

/** Что дом меняет в отпечатке «Применить»: пусто, пока ничего не красит (отпечаток прежних работ не меняется); иначе цвета красящих поверхностей. */
export function hangarHouseSignatureField(house, table = sheetsNow()) {
  const colours = Object.fromEntries(HANGAR_HOUSE_SURFACES.filter((surface) => hangarHouseActive(house, surface, table)).map((surface) => [surface, paintOf(house, surface).colour]));
  return Object.keys(colours).length ? { house: colours } : {};
}

/** Дом «как в игре» одним шагом: у каждой тронутой поверхности режим «Как в игре», цвета помнятся. */
export function hangarHouseStandard(house) {
  const paint = Object.fromEntries(Object.entries(plain(house?.paint)).map(([surface, item]) => [surface, { ...item, mode: "standard" }]));
  return { mode: "standard", ...(Object.keys(paint).length ? { paint } : {}) };
}
