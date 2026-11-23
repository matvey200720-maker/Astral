/*
 * Вид выстрела в файле оружия: размер вспышки, её свет, накопление дыма из
 * ствола и гильзы — поля блока `<Fx>` ствола в `weapons.meta`, рядом со
 * следом и вспышкой (`tracer-weapons.js`). Пишет их помощник RPF
 * (`weapons-meta-muzzle-look`), здесь — чтение, расчёт и проверка журнала.
 *
 * Свет и размер — числа, у них нет «донора в имени», как у клонов вспышки:
 * что было до Astral, помнит только журнал установки. Поэтому журнал ствола
 * несёт исходные значения ровно тех полей, что Astral сейчас держит своими,
 * а снятие возвращает их поле к полю. Журнала нет (потерян) — числа
 * остаются, какие есть: таблицы штатного света с живой игры у Astral нет, и
 * писать выдуманное хуже, чем оставить.
 */

const EFFECT_NAME = /^[A-Za-z0-9_]{0,96}$/;

/* Поле вида → тег и форма в XML Rockstar. */
const FIELDS = Object.freeze({
  flashScale: { tag: "FlashFxScale", kind: "value", max: 10 },
  lightEnabled: { tag: "FlashFxLightEnabled", kind: "bool" },
  lightRgbMin: { tag: "FlashFxLightRGBAMin", kind: "vector", count: 3, max: 255 },
  lightRgbMax: { tag: "FlashFxLightRGBAMax", kind: "vector", count: 3, max: 255 },
  lightIntensity: {
    tag: "FlashFxLightIntensityMinMax",
    kind: "vector",
    count: 2,
    max: 64,
  },
  lightRange: { tag: "FlashFxLightRangeMinMax", kind: "vector", count: 2, max: 64 },
  smokeIncPerShot: { tag: "MuzzleSmokeFxIncPerShot", kind: "value", max: 1 },
  shellFx: { tag: "ShellFx", kind: "effect" },
  /* Вид от первого лица: свои поля у вспышки, дыма и гильз. */
  flashFxFP: { tag: "FlashFxFP", kind: "effect" },
  smokeFxFP: { tag: "MuzzleSmokeFxFP", kind: "effect" },
  shellFxFP: { tag: "ShellFxFP", kind: "effect" },
});

export const LOOK_FIELDS = Object.freeze(Object.keys(FIELDS));

const round3 = (value) => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function readField(block, { tag, kind, count }) {
  if (kind === "effect") {
    const match = new RegExp(`<${tag}>([^<]*)</${tag}>|<${tag}\\s*/>`).exec(
      block,
    );
    return match ? (match[1] || "").trim() : null;
  }
  const open = new RegExp(`<${tag}\\s([^>]*)/?>`).exec(block);
  if (!open) return null;
  const attribute = (name) => {
    const found = new RegExp(`\\b${name}="([^"]*)"`).exec(open[1]);
    if (!found) return null;
    const number = Number(found[1]);
    return Number.isFinite(number) ? number : null;
  };
  if (kind === "bool") {
    const found = /\bvalue="([^"]*)"/.exec(open[1]);
    if (!found) return null;
    const text = found[1].trim().toLowerCase();
    return text === "true" ? true : text === "false" ? false : null;
  }
  if (kind === "value") return attribute("value");
  const values = ["x", "y", "z"].slice(0, count).map(attribute);
  return values.every((value) => value !== null) ? values : null;
}

/**
 * Нынешний вид выстрела ствола из его блока XML: значение поля или `null`,
 * если поля у ствола нет (у части стволов дополнений блок короче).
 */
export function readMuzzleLook(block) {
  const text = String(block || "");
  return Object.fromEntries(
    LOOK_FIELDS.map((field) => [field, readField(text, FIELDS[field])]),
  );
}

function validField(field, value) {
  const spec = FIELDS[field];
  if (spec.kind === "effect")
    return typeof value === "string" && EFFECT_NAME.test(value.trim());
  if (spec.kind === "bool") return typeof value === "boolean";
  const inRange = (number) =>
    typeof number === "number" &&
    Number.isFinite(number) &&
    number >= 0 &&
    number <= spec.max;
  if (spec.kind === "value") return inRange(value);
  return (
    Array.isArray(value) && value.length === spec.count && value.every(inRange)
  );
}

/**
 * Вид из журнала — каким его принесло окно: неизвестные и кривые поля
 * отбрасываются молча, как и весь журнал. `null` — нечего возвращать.
 */
export function boundedLook(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const result = {};
  for (const field of LOOK_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!validField(field, value)) continue;
    result[field] =
      FIELDS[field].kind === "effect"
        ? value.trim()
        : Array.isArray(value)
          ? value.map(round3)
          : typeof value === "number"
            ? round3(value)
            : value;
  }
  return Object.keys(result).length ? result : null;
}

/*
 * Желаемый вид ствола (`spec`) приходит из сборки проекта:
 *   size        — множитель размера вспышки к штатному;
 *   light       — `{ on, rgb, power, range }`: свет вспышки (цвет 0..255,
 *                 сила и дальность — множители к штатным);
 *   smokeBuild  — множитель накопления дыма за выстрел;
 *   shell       — правило гильз (`eject_*`) или пустое — без гильз.
 * Любое поле может быть `null` — его установка не трогает.
 */

/** Какие поля файла меняет вид. */
export function lookFields(spec) {
  if (!spec) return [];
  const fields = [];
  if (spec.size != null) fields.push("flashScale");
  if (spec.light) {
    fields.push("lightEnabled");
    if (spec.light.on && spec.light.rgb)
      fields.push("lightRgbMin", "lightRgbMax");
    if (spec.light.on && spec.light.power != null && spec.light.power !== 1)
      fields.push("lightIntensity");
    if (spec.light.on && spec.light.range != null && spec.light.range !== 1)
      fields.push("lightRange");
  }
  if (spec.smokeBuild != null) fields.push("smokeIncPerShot");
  if (spec.shell != null) fields.push("shellFx");
  /* Гильзы от первого лица — пара правила «_fp», если она есть в ядре. */
  if (spec.shellFP != null) fields.push("shellFxFP");
  return fields;
}

/* Нижний край света у Rockstar чуть темнее верхнего: вспышка мерцает. */
const LIGHT_MIN_SHARE = 0.85;

/**
 * Значения полей для помощника: `{ look, missing }`. `original` — что было у
 * ствола до Astral (журнал или файл); поле, которого у ствола нет, не
 * пишется и уходит в `missing` — помощник отказал бы на нём.
 */
export function lookValues(spec, original) {
  const look = {};
  const missing = [];
  for (const field of lookFields(spec)) {
    const base = original?.[field];
    if (base === null || base === undefined) {
      missing.push(field);
      continue;
    }
    switch (field) {
      case "flashScale":
        look.flashScale = clamp(round3(base * spec.size), 0.05, 10);
        break;
      case "lightEnabled":
        look.lightEnabled = Boolean(spec.light.on);
        break;
      case "lightRgbMax":
        look.lightRgbMax = spec.light.rgb.map((channel) =>
          clamp(Math.round(channel), 0, 255),
        );
        break;
      case "lightRgbMin":
        look.lightRgbMin = spec.light.rgb.map((channel) =>
          clamp(Math.round(channel * LIGHT_MIN_SHARE), 0, 255),
        );
        break;
      case "lightIntensity":
        look.lightIntensity = base.map((value) =>
          clamp(round3(value * spec.light.power), 0, 64),
        );
        break;
      case "lightRange":
        look.lightRange = base.map((value) =>
          clamp(round3(value * spec.light.range), 0, 64),
        );
        break;
      case "smokeIncPerShot":
        look.smokeIncPerShot = clamp(round3(base * spec.smokeBuild), 0, 1);
        break;
      case "shellFx":
        look.shellFx = String(spec.shell || "");
        break;
      case "shellFxFP":
        look.shellFxFP = String(spec.shellFP || "");
        break;
      default:
        break;
    }
  }
  return { look, missing };
}

/** Поля журнала `look`, которых нет среди `fields`, — их пора вернуть. */
export function lookRestoreFields(journalLook, fields) {
  const keep = new Set(fields);
  return Object.keys(journalLook || {}).filter((field) => !keep.has(field));
}

/*
 * Журнал вида со штатной таблицей (`STUDIO_MUZZLE_STOCK`): исходные значения
 * в нём сняты уже с учётом таблицы, и ему верят. Журналу без метки — из
 * установок до таблицы — верят меньше, чем таблице: 04.10.2026 такой журнал
 * записал «исходными» значения, оставшиеся от пропавшей установки.
 */
export const LOOK_JOURNAL_VERSION = 2;

/** Исходное значение поля: журнал (если ему верят), таблица, журнал, файл. */
export function lookOriginalOf(field, { journal, trusted, stock, current }) {
  const known = journal?.[field];
  const base = stock?.[field];
  const now = current?.[field];
  const has = (value) => value !== undefined && value !== null;
  if (trusted && has(known)) return known;
  if (has(base)) return base;
  if (has(known)) return known;
  return has(now) ? now : null;
}

/**
 * Исходные значения полей (`lookOriginalOf`) — те, что известны. Поля,
 * которого у ствола в файле нет, нет и здесь: писать его некуда.
 */
export function lookOriginals(fields, journalLook, currentLook, options = {}) {
  const result = {};
  for (const field of fields) {
    const now = currentLook?.[field];
    if (now === undefined || now === null) continue;
    const value = lookOriginalOf(field, {
      journal: journalLook,
      trusted: options.trusted ?? true,
      stock: options.stock,
      current: currentLook,
    });
    if (value !== null) result[field] = value;
  }
  return result;
}

/** Одинаковы ли два значения поля вида (числа — с точностью до тысячных). */
export function sameLookValue(left, right) {
  const norm = (value) =>
    Array.isArray(value)
      ? value.map((item) => Math.round(Number(item) * 1000))
      : typeof value === "number"
        ? Math.round(value * 1000)
        : value;
  return JSON.stringify(norm(left)) === JSON.stringify(norm(right));
}

/** Помощнику — в его именах полей (`WeaponMuzzleLook`). */
export function helperLook(look) {
  if (!look || !Object.keys(look).length) return null;
  const result = {};
  if (look.flashScale !== undefined) result.flashScale = look.flashScale;
  if (look.lightEnabled !== undefined) result.lightEnabled = look.lightEnabled;
  if (look.lightRgbMin !== undefined) result.lightRgbMin = look.lightRgbMin;
  if (look.lightRgbMax !== undefined) result.lightRgbMax = look.lightRgbMax;
  if (look.lightIntensity !== undefined)
    result.lightIntensity = look.lightIntensity;
  if (look.lightRange !== undefined) result.lightRange = look.lightRange;
  if (look.smokeFx !== undefined) result.smokeFx = look.smokeFx;
  if (look.smokeIncPerShot !== undefined)
    result.smokeIncPerShot = look.smokeIncPerShot;
  if (look.shellFx !== undefined) result.shellFx = look.shellFx;
  if (look.flashFxFP !== undefined) result.flashFxFP = look.flashFxFP;
  if (look.smokeFxFP !== undefined) result.smokeFxFP = look.smokeFxFP;
  if (look.shellFxFP !== undefined) result.shellFxFP = look.shellFxFP;
  return result;
}
