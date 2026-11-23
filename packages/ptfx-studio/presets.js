// Готовые пресеты редактора эффектов и коды обмена ими.
// Пресет — обычный проект мастерской, собранный из заказа соседа preset-list.js: его можно
// открыть, изменить и сохранить своим. Код обмена — строка ASTRAL-FX1-… с тем же проектом внутри.

import { IMPACT_ZONE_IDS } from "./impact.js";
import { PTFX_PRESET_LIST } from "./preset-list.js";
import {
  createProject,
  defaultTracerProfile,
  parseProject,
  serializeProject,
} from "./project.js";

const CODE_PREFIX = "ASTRAL-FX1-";
const CODE_BYTES_LIMIT = 8 * 1024;
const CODE_BODY_PATTERN = /^[A-Za-z0-9_-]{8,12000}$/;

// ---- сборка проектов пресетов ----

// Накладывает заказ на семейства огня и взрывов проекта; остальные остаются как были.
function mixEnvironment(families, wishes) {
  if (!wishes) return families;
  const mixed = { ...families };
  Object.keys(wishes).forEach((id) => {
    if (!Object.hasOwn(families, id)) throw new Error(`Пресет: неизвестное семейство «${id}».`);
    mixed[id] = { ...families[id], ...wishes[id] };
  });
  return mixed;
}

// Единственный профиль трассера: от профиля по умолчанию, поверх — поля заказа.
const TRACER_OWN_FIELDS = new Set(["colour", "enabled"]);

function singleTracer(order) {
  const base = defaultTracerProfile(0);
  const fields = Object.fromEntries(
    Object.entries(order).filter(([key]) => !TRACER_OWN_FIELDS.has(key)),
  );
  const colours = order.colours || (order.colour ? [order.colour] : base.colours);
  return { profiles: [{ ...base, ...fields, colours, mode: "all", weapons: [] }] };
}

// Зоны попадания — по одному ключу на каждую известную зону, в их порядке.
function mixZones(baseZones, wishes) {
  return IMPACT_ZONE_IDS.reduce(
    (zones, id) => ({ ...zones, [id]: (wishes && wishes[id]) || baseZones[id] }),
    {},
  );
}

function projectOf(spec) {
  const base = createProject(spec.name);
  const environment = mixEnvironment(base.environment, spec.environment);
  const tracer = spec.tracer ? singleTracer(spec.tracer) : base.tracer;
  const impact = { ...base.impact, ...spec.impact, zones: mixZones(base.impact.zones, spec.zones) };
  return serializeProject(Object.assign({}, base, { environment, tracer, impact }));
}

// Записи пресетов и указатель «id -> запись» (при повторе id остаётся первая запись).
const presetList = [];
const presetById = new Map();
for (const order of PTFX_PRESET_LIST) {
  const record = Object.assign({}, order);
  delete record.spec;
  record.project = projectOf(order.spec);
  Object.freeze(record);
  presetList.push(record);
  if (!presetById.has(record.id)) presetById.set(record.id, record);
}

export const PTFX_PRESETS = Object.freeze(presetList);

// ---- поиск и копии ----

export function findPtfxPreset(id) {
  return presetById.get(String(id || "")) ?? null;
}

export function presetProject(id) {
  const preset = findPtfxPreset(id);
  if (preset === null) throw new Error(`Неизвестный пресет эффектов: ${id}`);
  const copy = JSON.parse(JSON.stringify(preset.project));
  return parseProject(copy);
}

// ---- коды обмена ----

const URL_FORM = { "+": "-", "/": "_" };
const STANDARD_FORM = { "-": "+", _: "/" };

// Байты <-> обычный base64: btoa/atob, а там, где их нет, — Buffer.
const bytesToBase64 = (bytes) =>
  typeof btoa === "function"
    ? btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    : Buffer.from(bytes).toString("base64");

const base64ToBytes = (text) =>
  typeof atob === "function"
    ? Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
    : new Uint8Array(Buffer.from(text, "base64"));

export function encodePresetCode(project) {
  const bytes = new TextEncoder().encode(JSON.stringify(serializeProject(project)));
  if (bytes.length > CODE_BYTES_LIMIT) {
    throw new RangeError("Пресет эффектов слишком большой для кода обмена.");
  }
  // «+» -> «-», «/» -> «_», знаки «=» в конце убираются
  return CODE_PREFIX + bytesToBase64(bytes).replace(/[+/]|=+$/g, (piece) => URL_FORM[piece] ?? "");
}

// Порядок проверок кода: сперва префикс, затем алфавит и длина остатка.
const CODE_REFUSALS = [
  [(text) => !text.startsWith(CODE_PREFIX), "Это не код пресета эффектов Astral."],
  [(text) => !CODE_BODY_PATTERN.test(text.slice(CODE_PREFIX.length)), "Код пресета повреждён."],
];

export function decodePresetCode(code) {
  const text = String(code || "").trim();
  const refusal = CODE_REFUSALS.find(([failed]) => failed(text));
  if (refusal) throw new Error(refusal[1]);
  const standard = text.slice(CODE_PREFIX.length).replace(/[-_]/g, (char) => STANDARD_FORM[char]);
  const json = new TextDecoder().decode(base64ToBytes(standard.padEnd(Math.ceil(standard.length / 4) * 4, "=")));
  return parseProject(JSON.parse(json));
}
