// Программа выстрела: дерево звуковых объектов dat54, на которое указывают
// настройки стрельбы игрока, переводится в обычный объект для JSON.
import { hexHash, joaat, readRel } from "./rel-edit.js";
import { VOLUME_OVERRIDE } from "./sound-categories.js";
import { readSoundHeader } from "./sound-header.js";
import { WEAPON_SOUND_FIELDS, weaponAudio } from "./weapon-voice-plan.js";

export const SHOT_PROGRAM_VERSION = 1;

export const SHOT_FIELDS = Object.freeze([
  "FireSound",
  "AutoSound",
  "SuppressedFireSound",
  "ReportSound",
  "EchoSound",
  "SuppressedEchoSound",
]);

const NULL_SOUND = joaat("null_sound");
const WAVE_NAME_MASK = 0x1fffffff;
const DAT16_MARK = 16;
const DAT151_MARK = 151;

// Обычный объект, а не Map: тип ищется как ключ объекта, поэтому «12» строкой
// тоже находится, а «constructor» находит функцию прототипа (так задумано).
const KIND_OF_TYPE = {
  2: "envelope",
  6: "wrapper",
  9: "retrigger",
  12: "simple",
  13: "multitrack",
  14: "random",
  15: "environment",
  18: "synth",
  25: "variables",
  26: "if",
  27: "math",
  28: "transform",
};

const HEADER_KEYS = [
  "volume",
  "volumeVariance",
  "pitch",
  "pitchVariance",
  "pan",
  "preDelay",
  "preDelayVariance",
  "startOffset",
  "startOffsetVariance",
  "attackTime",
  "releaseTime",
  "category",
  "lpfCutoff",
  "lpfCutoffVariance",
  "hpfCutoff",
  "hpfCutoffVariance",
];

const linkOf = (value) => (value === 0 ? null : hexHash(value));
const hashOf = (ref) => Number.parseInt(ref.slice(2), 16);

// Окно в байтах объекта: смещения считаются от base, чтение — little-endian,
// выход за конец бросает RangeError самого Buffer.
class View {
  constructor(bytes, base) {
    this.bytes = bytes;
    this.base = base;
  }

  has(at) {
    return this.base + at < this.bytes.length;
  }

  u8(at) {
    return this.bytes.readUInt8(this.base + at);
  }

  u16(at) {
    return this.bytes.readUInt16LE(this.base + at);
  }

  i16(at) {
    return this.bytes.readInt16LE(this.base + at);
  }

  u32(at) {
    return this.bytes.readUInt32LE(this.base + at);
  }

  i32(at) {
    return this.bytes.readInt32LE(this.base + at);
  }

  f32(at) {
    return this.bytes.readFloatLE(this.base + at);
  }

  link(at) {
    return linkOf(this.u32(at));
  }

  // ссылка, у которой ноль остаётся ссылкой
  name(at) {
    return hexHash(this.u32(at));
  }

  links(at, count, step = 4) {
    return Array.from({ length: count }, (_, i) => this.link(at + i * step));
  }

  span(at) {
    return [this.f32(at), this.f32(at + 4)];
  }

  // конец прочитанного совпадает с концом объекта
  endsAt(at) {
    return this.base + at === this.bytes.length;
  }
}

function readRandom(v) {
  const history = v.u8(1);
  const count = v.u8(2 + history);
  return {
    history,
    children: v.links(3 + history, count, 8),
    weights: Array.from({ length: count }, (_, i) => v.f32(7 + history + i * 8)),
  };
}

function readVariables(v) {
  const children = [v.link(0)];
  const variables = Array.from({ length: v.u8(4) }, (_, i) => {
    const at = 5 + i * 13;
    return { name: v.name(at), value: v.f32(at + 4), variance: v.f32(at + 8), flags: v.u8(at + 12) };
  });
  return { children, variables };
}

function readMath(v) {
  const children = [v.link(0)];
  const operations = Array.from({ length: v.u8(4) }, (_, i) => {
    const at = 5 + i * 29;
    return {
      op: v.u8(at),
      params: [0, 1, 2].map((k) => [v.f32(at + 1 + 8 * k), v.link(at + 5 + 8 * k)]),
      result: v.link(at + 25),
    };
  });
  return { children, operations };
}

function readTransform(v) {
  const children = [v.link(0)];
  const transforms = [];
  let at = 8;
  for (let left = v.u32(4); left > 0; left -= 1) {
    const transform = { input: v.link(at), inputRange: v.span(at + 4), outputs: [] };
    let outputs = v.u32(at + 12);
    at += 16;
    for (; outputs > 0; outputs -= 1) {
      const points = v.u32(at + 20);
      transform.outputs.push({
        destination: v.u32(at + 4),
        variable: v.link(at + 8),
        range: v.span(at + 12),
        points: Array.from({ length: points }, (_, k) => v.span(at + 24 + 8 * k)),
      });
      at += 24 + 8 * points;
    }
    transforms.push(transform);
  }
  if (!v.endsAt(at)) throw new Error("Преобразование параметра устроено иначе, чем у Legacy.");
  return { children, transforms };
}

// Раскладки данных вида от конца заголовка; порядок ключей — порядок в ответе.
const LAYOUTS = new Map([
  [
    "envelope",
    (v) => ({
      attack: v.u16(0),
      attackVariance: v.u16(2),
      decay: v.u16(4),
      decayVariance: v.u16(6),
      sustain: v.u8(8),
      sustainVariance: v.u8(9),
      hold: v.i32(10),
      holdVariance: v.u16(14),
      release: v.i32(16),
      releaseVariance: v.u32(20),
      curves: v.links(24, 3),
      children: [v.link(56)],
      mode: v.u32(60),
      output: v.link(64),
      range: v.span(68),
    }),
  ],
  ["wrapper", (v) => ({ children: [v.link(0), v.link(8)], minRepeat: v.i16(12) })],
  [
    "retrigger",
    (v) => ({
      loopCount: v.i16(0),
      loopCountVariance: v.u16(2),
      delay: v.u16(4),
      delayVariance: v.u16(6),
      loopCountVariable: v.link(8),
      delayVariable: v.link(12),
      children: v.links(16, 3),
    }),
  ],
  ["simple", (v) => ({ container: v.name(0), wave: hexHash(v.u32(4) & WAVE_NAME_MASK), children: [] })],
  ["multitrack", (v) => ({ children: v.links(1, v.has(0) ? v.u8(0) : 0) })],
  ["random", readRandom],
  ["variables", readVariables],
  [
    "if",
    (v) => ({
      children: [v.link(0), v.link(4)],
      variable: v.link(8),
      op: v.u8(12),
      value: v.f32(13),
      rhs: v.link(17),
    }),
  ],
  ["math", readMath],
  ["transform", readTransform],
]);

function headerOf(fields) {
  const h = {};
  for (const key of HEADER_KEYS) {
    if (!fields.has(key)) continue;
    const { value } = fields.get(key);
    h[key] = key === "category" ? hexHash(value) : value;
  }
  return h;
}

export function readSoundNode(object) {
  const { type, bytes } = object;
  const kind = KIND_OF_TYPE[type] ?? "other";
  const { end, fields } = readSoundHeader(bytes);
  const layout = LAYOUTS.get(kind);
  return { kind, type, h: headerOf(fields), ...(layout ? layout(new View(bytes, end)) : { children: [] }) };
}

// Хвосты кривых по виду, данные с @16 объекта.
const CURVE_TAILS = new Map([
  [2, (v) => ({ points: [v.span(16), v.span(24)] })],
  [4, (v) => ({ points: Array.from({ length: v.u32(16) }, (_, i) => v.span(20 + i * 8)) })],
  [5, (v) => ({ flip: v.u32(16) })],
  [8, (v) => ({ scale: v.f32(16) })],
]);

function readCurve(bytes) {
  const v = new View(bytes, 0);
  const type = v.u8(0);
  const curve = { type, input: v.span(8) };
  const tail = CURVE_TAILS.get(type);
  return tail ? Object.assign(curve, tail(v)) : curve;
}

export function readSoundCurves(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes.readUInt32LE(0) !== DAT16_MARK) throw new Error("Это не кривые звука игры (dat16).");
  // контейнер кривых устроен как dat151: подменяем метку и отдаём разбор соседу
  bytes.writeUInt32LE(DAT151_MARK, 0);
  const { objects, data } = readRel(bytes);
  const curves = new Map();
  for (const [hash, { offset, length }] of objects) {
    curves.set(hash >>> 0, readCurve(data.subarray(offset, offset + length)));
  }
  return curves;
}

export function categoryChain(categories, name) {
  // первые два знака («0X») отрезаются всегда, остаток — шестнадцатеричное число
  const start = Number.parseInt(name.slice(2), 16) >>> 0;
  const passed = new Set();
  let total = 0;
  for (let id = start; categories.volume.has(id) && !passed.has(id); id = categories.parent.get(id)) {
    passed.add(id);
    total += categories.volume.get(id);
    if (categories.overrides.get(id) & VOLUME_OVERRIDE) break;
    if (!categories.parent.has(id)) break;
  }
  return total;
}

const HEX_ITEM = /^0X([0-9A-F]{1,8})$/i;

function itemHash(item) {
  if (typeof item === "number") return item >>> 0;
  const text = item == null ? "" : String(item);
  const hex = HEX_ITEM.exec(text);
  return hex ? Number.parseInt(hex[1], 16) : joaat(text);
}

function offsetsOf(fields) {
  return new Map(Array.isArray(fields) ? fields : Object.entries(fields));
}

// Обход дерева звуков в глубину: узел раньше детей, дети по порядку.
class ProgramWalk {
  constructor(merged, curveTable, categoryTables) {
    this.merged = merged;
    this.curveTable = curveTable;
    this.categoryTables = categoryTables;
    this.nodes = {};
    this.curves = {};
    this.categories = {};
    this.waves = [];
    this.waveKeys = new Set();
  }

  from(rootRef) {
    const stack = [rootRef];
    while (stack.length > 0) {
      const ref = stack.pop();
      if (ref === null || Object.hasOwn(this.nodes, ref)) continue;
      const sound = this.merged.sound(hashOf(ref));
      const node = sound ? readSoundNode(sound) : { kind: "missing", type: 0, h: {}, children: [] };
      this.nodes[ref] = node;
      this.noteCategory(node);
      this.noteCurves(node);
      this.noteWave(node);
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
    }
  }

  noteCategory({ h }) {
    if (!h.category || Object.hasOwn(this.categories, h.category)) return;
    this.categories[h.category] = categoryChain(this.categoryTables, h.category);
  }

  noteCurves({ curves = [] }) {
    for (const ref of curves) {
      if (ref === null || Object.hasOwn(this.curves, ref)) continue;
      const hash = hashOf(ref);
      if (this.curveTable.has(hash)) this.curves[ref] = this.curveTable.get(hash);
    }
  }

  noteWave(node) {
    if (node.kind !== "simple") return;
    const { container, wave } = node;
    const key = `${container}:${wave}`;
    if (this.waveKeys.has(key)) return;
    this.waveKeys.add(key);
    this.waves.push({ key, container, wave, bank: this.merged.bankName(hashOf(container)) ?? null });
  }
}

export function buildShotProgram(merged, { item, auto = false, curves, categories }) {
  const audio = weaponAudio(merged, { item: itemHash(item), auto: Boolean(auto) });
  const { settings } = audio;
  const offsets = offsetsOf(WEAPON_SOUND_FIELDS);
  const roots = {};
  for (const field of SHOT_FIELDS) {
    const at = offsets.get(field);
    if (at + 4 > settings.length) continue;
    const value = settings.bytes.readUInt32LE(at);
    if (value !== 0 && value !== NULL_SOUND && merged.sound(value)) roots[field] = hexHash(value);
  }
  const walk = new ProgramWalk(merged, curves, categories);
  for (const ref of Object.values(roots)) walk.from(ref);
  return {
    version: SHOT_PROGRAM_VERSION,
    item: hexHash(audio.item),
    settings: hexHash(settings.hash),
    auto: Boolean(auto),
    roots,
    nodes: walk.nodes,
    curves: walk.curves,
    categories: walk.categories,
    waves: walk.waves,
  };
}
