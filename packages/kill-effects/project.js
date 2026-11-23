// Проект килл-эффекта: значения ручек, сырые строки модификатора и снимок точных чисел мода.
// Здесь же сборка строк модификатора, импорт готового модификатора и работа с тоном.
import {
  KILL_DURATION_RANGE,
  KNOWN_MODIFIER_PARAMETERS,
  UNIT_SECOND_VALUE_PARAMETERS,
  VANILLA_KILL_DURATION,
  VANILLA_KILL_MODIFIER,
} from "./game-contract.js";
import { createKillMarker, describeKillMarker } from "./marker.js";
import {
  KILL_EFFECT_CHANNELS,
  KILL_EFFECT_CHANNEL_MAP,
  channelDefaults,
  channelSilence,
  isChannelNeutral,
  normalizeChannelValue,
  readChannelValue,
  scaleChannelValue,
} from "./parameters.js";

export const KILL_EFFECT_PROJECT_VERSION = 2;

const TONE_PREFIX = "postfx_tonemap_";
const FALLBACK_TITLE = "Килл-эффект";
const TEXT_CAP = 64;
const RAW_ROW_CAP = 128;
const EXACT_ROW_CAP = 16;
const MASTER_REST = 100;

export const VANILLA_KILL_TONE = Object.freeze(
  VANILLA_KILL_MODIFIER.filter(([name]) => name.startsWith(TONE_PREFIX)),
);

// ---------------------------------------------------------------- мелочи

const isRecord = (value) => typeof value === "object" && value !== null;
const to6 = (number) => Math.round(number * 1e6) / 1e6;
const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const numOrZero = (value) => {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
};

// Округлённое целое в границах; нечисло и бесконечность дают запасное значение.
function roundedWithin(value, lo, hi, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(hi, Math.max(lo, Math.round(number))) : fallback;
}

function titleFrom(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return (text.trim().replace(/\s+/g, " ") || FALLBACK_TITLE).slice(0, TEXT_CAP);
}

// ---------------------------------------------------------------- части проекта

function channelSet(raw) {
  const pool = isRecord(raw) ? raw : {};
  return Object.fromEntries(
    KILL_EFFECT_CHANNELS.map((channel) => {
      const stored = pool[channel.id];
      return [channel.id, stored ? normalizeChannelValue(channel, stored) : channelDefaults(channel)];
    }),
  );
}

// Одна сырая строка: годная запись -> [имя, число, число], иначе null.
function rawRowOf(entry) {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const name = String(entry[0] || "").trim();
  const lead = Number(entry[1]);
  if (!KNOWN_MODIFIER_PARAMETERS.has(name) || !Number.isFinite(lead)) return null;
  const tail = Number(entry[2]);
  const tailFallback = UNIT_SECOND_VALUE_PARAMETERS.has(name) ? 1 : 0;
  return [name, to6(lead), to6(Number.isFinite(tail) ? tail : tailFallback)];
}

function rawRowList(list) {
  if (!Array.isArray(list)) return [];
  const rows = [];
  const names = new Set();
  for (const entry of list) {
    if (rows.length >= RAW_ROW_CAP) break;
    const row = rawRowOf(entry);
    if (row && !names.has(row[0])) {
      names.add(row[0]);
      rows.push(row);
    }
  }
  return rows;
}

// Строка снимка: имя берётся без обрезки пробелов, второе число без умолчания в единицу.
function exactRowOf(entry) {
  if (!Array.isArray(entry)) return null;
  const name = String(entry[0] || "");
  const lead = Number(entry[1]);
  if (!KNOWN_MODIFIER_PARAMETERS.has(name) || !Number.isFinite(lead)) return null;
  const tail = Number(entry[2]);
  return [name, to6(lead), to6(Number.isFinite(tail) ? tail : 0)];
}

// Снимок живёт, только пока канал не тронут (сравнение по записи JSON).
function exactSet(raw, channels) {
  if (!isRecord(raw)) return {};
  const kept = [];
  for (const channel of KILL_EFFECT_CHANNELS) {
    const stored = raw[channel.id];
    if (!isRecord(stored) || !Array.isArray(stored.fields)) continue;
    const value = normalizeChannelValue(channel, stored.value);
    if (!sameRecord(value, channels[channel.id])) continue;
    const fields = stored.fields.slice(0, EXACT_ROW_CAP).map((entry) => exactRowOf(entry)).filter(Boolean);
    if (fields.length > 0) kept.push([channel.id, { value, fields }]);
  }
  return Object.fromEntries(kept);
}

// ---------------------------------------------------------------- создание и разбор

export function createKillEffectProject(input = {}) {
  const src = isRecord(input) ? input : {};
  const channels = channelSet(src.channels);
  return {
    version: KILL_EFFECT_PROJECT_VERSION,
    name: titleFrom(src.name),
    template: src.template ? String(src.template).slice(0, TEXT_CAP) : null,
    intensity: roundedWithin(src.intensity, 0, 200, MASTER_REST),
    duration: roundedWithin(src.duration, KILL_DURATION_RANGE.min, KILL_DURATION_RANGE.max, VANILLA_KILL_DURATION),
    channels,
    extras: rawRowList(src.extras),
    exact: exactSet(src.exact, channels),
    marker: createKillMarker(src.marker),
  };
}

export function parseKillEffectProject(input) {
  if (!isRecord(input) || Array.isArray(input)) {
    throw new TypeError("Проект килл-эффекта обязателен.");
  }
  return createKillEffectProject(input);
}

// ---------------------------------------------------------------- значения и строки модификатора

export function resolveChannelValue(project, channelId) {
  // Только свои ключи: «constructor» и «toString» — не каналы.
  const channel = Object.hasOwn(KILL_EFFECT_CHANNEL_MAP, channelId) ? KILL_EFFECT_CHANNEL_MAP[channelId] : null;
  if (!channel) return null;
  const kept = project.channels?.[channelId] ?? channelDefaults(channel);
  const weighted = () => scaleChannelValue(channel, kept, project.intensity);
  if (channel.optional) return kept.enabled ? weighted() : null;
  const result = weighted();
  return isChannelNeutral(channel, result) ? null : result;
}

// Строки одного канала: сохранённые числа мода, пока канал не тронут и мастер-интенсивность 100.
function rowsOfChannel(project, channel, value) {
  const frozen = project.exact?.[channel.id];
  const untouched = frozen && project.intensity === 100 && sameRecord(project.channels?.[channel.id], frozen.value);
  return untouched ? frozen.fields : channel.write(value);
}

export function resolveKillEffectFields(project) {
  const book = new Map();
  const note = (name, lead, tail) => {
    if (!book.has(name)) book.set(name, [to6(lead), to6(tail)]);
  };
  for (const channel of KILL_EFFECT_CHANNELS) {
    const value = resolveChannelValue(project, channel.id);
    if (value === null) continue;
    for (const [name, lead, tail = 0] of rowsOfChannel(project, channel, value)) {
      if (KNOWN_MODIFIER_PARAMETERS.has(name)) note(name, lead, tail);
    }
  }
  for (const [name, lead, tail] of project.extras ?? []) note(name, lead, tail);
  return [...book].map(([name, [lead, tail]]) => [name, lead, tail]);
}

// ---------------------------------------------------------------- импорт модификатора

const closeEnough = (a, b) => to6(a) === to6(b);

// Состояние импорта: пары модификатора, прочитанные каналы, их снимки и забранные имена.
class ModifierDigest {
  constructor(fields) {
    this.pairs = new Map();
    for (const entry of fields ?? []) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const key = String(entry[0] || "").trim();
      if (key) this.pairs.set(key, [numOrZero(entry[1]), numOrZero(entry[2])]);
    }
    this.channels = {};
    this.exact = {};
    this.claimed = new Set();
  }

  // Снимок нужен, если мод хранит не все строки канала или числа лежат между делениями.
  exactPlan(channel, value) {
    const planned = channel.write(value);
    const present = planned.filter(([name]) => this.pairs.has(name));
    if (present.length === 0) return null;
    const complete = present.length === planned.length;
    const matching = present.every(([name, lead, tail]) => {
      const [modLead, modTail] = this.pairs.get(name);
      return closeEnough(lead, modLead) && closeEnough(tail, modTail);
    });
    if (complete && matching) return null;
    return { value, fields: present.map(([name]) => [name, ...this.pairs.get(name)]) };
  }

  absorb(channel) {
    const found = readChannelValue(channel, this.pairs);
    const value = found ? found.value : channelSilence(channel);
    this.channels[channel.id] = value;
    if (!found) return;
    const owns = channel.optional ? value.enabled : !isChannelNeutral(channel, value);
    if (!owns) return;
    found.consumed.forEach((name) => this.claimed.add(name));
    const plan = this.exactPlan(channel, value);
    if (plan) this.exact[channel.id] = plan;
  }

  leftovers() {
    return [...this.pairs]
      .filter(([name]) => !this.claimed.has(name))
      .map(([name, [lead, tail]]) => [name, lead, tail]);
  }
}

export function importKillEffectModifier({ fields, name, duration, template = null } = {}) {
  const digest = new ModifierDigest(fields);
  KILL_EFFECT_CHANNELS.forEach((channel) => digest.absorb(channel));
  return createKillEffectProject({
    name,
    template,
    duration,
    intensity: MASTER_REST,
    channels: digest.channels,
    extras: digest.leftovers(),
    exact: digest.exact,
  });
}

// ---------------------------------------------------------------- тон ванильного модификатора

export function killEffectOverridesTone(project) {
  const rows = project?.extras;
  if (rows === null || rows === undefined) return false;
  return rows.some(([name]) => name.startsWith(TONE_PREFIX));
}

const VANILLA_ORDER = new Map(VANILLA_KILL_MODIFIER.map(([name], at) => [name, at]));
const TONE_START = VANILLA_KILL_MODIFIER.findIndex(([name]) => name.startsWith(TONE_PREFIX));

// Тон встаёт перед первой строкой, чьё ванильное место позже тона, иначе в конец.
function toneInsertion(rows) {
  const at = rows.findIndex(([name]) => (VANILLA_ORDER.get(name) ?? -1) > TONE_START);
  return at < 0 ? rows.length : at;
}

export function withKillEffectTone(project, enabled) {
  const base = project ?? {};
  const rest = (base.extras ?? []).filter(([name]) => !name.startsWith(TONE_PREFIX));
  const extras = enabled ? rest.toSpliced(toneInsertion(rest), 0, ...VANILLA_KILL_TONE) : rest;
  return createKillEffectProject({ ...base, extras });
}

// ---------------------------------------------------------------- описание

export function isFlashlessKillEffect(project) {
  return resolveKillEffectFields(project).length === 0;
}

export function isEmptyKillEffect(project) {
  return isFlashlessKillEffect(project) && !project.marker?.enabled;
}

export function describeKillEffect(project) {
  const lead = `${project.duration} мс`;
  const tint = resolveChannelValue(project, "tint");
  const saturation = resolveChannelValue(project, "saturation");
  const hasGradient = resolveChannelValue(project, "gradient");
  const hasFog = resolveChannelValue(project, "fog");
  const notes = [
    tint && tint.amount > 0 && `оттенок ${tint.color}`,
    saturation && saturation.value !== 100 && `насыщенность ${Math.round(saturation.value)} %`,
    hasGradient && "экранный градиент",
    hasFog && "туман",
    project.intensity !== 100 && `интенсивность ${project.intensity} %`,
  ];
  const headline = isFlashlessKillEffect(project) ? "без вспышки" : lead;
  const sign = describeKillMarker(project.marker);
  return [headline, ...notes, sign && `знак: ${sign}`].filter(Boolean).join(" · ");
}
