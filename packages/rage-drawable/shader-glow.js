import { pointerAt, readCString } from "@modovik/ypt/resource-core";
import { isEmissiveShader, joaat, shaderName } from "./shaders.js";

export const GLOW_SHADERS = Object.freeze({ always: "emissive", night: "emissivenight" });
export const GLOW_INTENSITY = Object.freeze({ min: 0.5, max: 8, standard: 2 });
export const DECORATION_TEXTURE_PREFIX = "astral_deco_";

// Чтение и запись чисел файла: вид → [чтение, запись] (порядок байт little-endian).
const CODEC = {
  u8: ["getUint8", "setUint8"],
  u16: ["getUint16", "setUint16"],
  u32: ["getUint32", "setUint32"],
  u64: ["getBigUint64", "setBigUint64"],
};

// Поля структуры ShaderFX: имя, смещение, вид.
const FX_FIELDS = [
  ["parameters", 0, "u64"],
  ["name", 8, "u32"],
  ["count", 16, "u8"],
  ["bucket", 17, "u8"],
  ["flags", 18, "u16"],
  ["parameterSize", 20, "u16"],
  ["parameterDataSize", 22, "u16"],
  ["file", 24, "u32"],
  ["bucketMask", 32, "u32"],
  ["textureCount", 39, "u8"],
];
export const FX = Object.freeze(Object.fromEntries(FX_FIELDS.map(([field, offset]) => [field, offset])));
const FX_KIND = Object.fromEntries(FX_FIELDS.map(([field, , kind]) => [field, kind]));

const fxRead = (view, shaderAt, field) => view[CODEC[FX_KIND[field]][0]](shaderAt + FX[field], true);
const fxWrite = (view, shaderAt, field, value) => view[CODEC[FX_KIND[field]][1]](shaderAt + FX[field], value, true);

const readFields = (view, at, schema) =>
  Object.fromEntries(Object.entries(schema).map(([key, [offset, kind]]) => [key, view[CODEC[kind][0]](at + offset, true)]));

const RECORD = { type: [0, "u8"], pointer: [8, "u64"] };

const LIMIT = { shaders: 256, parameters: 64 };
const CELL = { record: 16, vector: 16, hash: 4 };
const TEXTURE_NAME_AT = 0x28;
const GLOW_FLAGS = 0x8000;

// Параметры раскладки по порядку: имя и значение вектора (null — текстура, функция — по силе свечения).
const PARAMETERS = [
  ["DiffuseSampler", null],
  ["matMaterialColorScale", [1, 0, 0, 1]],
  ["HardAlphaBlend", [1, 0, 0, 0]],
  ["useTessellation", [0, 0, 0, 0]],
  ["emissiveMultiplier", (power) => [power, 0, 0, 0]],
  ["globalAnimUV1", [0, 1, 0, 0]],
  ["globalAnimUV0", [1, 0, 0, 0]],
].map(([name, fallback]) => ({ name, hash: joaat(name), fallback }));

const LAYOUTS = {
  [GLOW_SHADERS.always]: PARAMETERS,
  [GLOW_SHADERS.night]: PARAMETERS.slice(0, 5),
};
const KNOWN_HASHES = new Set(PARAMETERS.map(({ hash }) => hash));
const DIFFUSE_SAMPLER = PARAMETERS[0].hash;
const EMISSIVE_MULTIPLIER = PARAMETERS[4].hash;

const REASON = {
  noShader: "нет шейдера",
  unreadable: "параметры не читаются",
  noTexture: "у детали нет текстуры цвета — светиться нечему",
  noPower: "деталь уже светится, силы у её шейдера нет",
  nightOnly: "деталь светится только ночью, и «всегда» в её блок не помещается — осталась ночной",
  stayAsIs: "режим детали на месте не сменить — осталась как была",
  noPart: "в модели нет детали с такой текстурой",
  tooShort: (have, need) => `блок параметров детали короче нужного (${have} из ${need} байт) — на месте не перешить`,
};

const lowerText = (value) => String(value || "").toLowerCase();

export const isDecorationTexture = (name) => lowerText(name).startsWith(DECORATION_TEXTURE_PREFIX);

export const bucketMaskOf = (bucket) => (1 << bucket) | 0xff00;

// Размеры блока раскладки: записи с векторами, хэши и данные, округлённые вверх до 16.
export const blockSizes = (layout) => {
  const length = layout.length;
  const size = length * CELL.record + (length - 1) * CELL.vector;
  const bytes = size + length * CELL.hash;
  return { bytes, size, dataSize: Math.ceil((32 + bytes) / 16) * 16 };
};

// ---- чтение модели ----

export function shaderList(resource) {
  const view = resource.view;
  const groupAt = pointerAt(resource, resource.at(resource.root) + 0x10);
  const [arrayAt, count] =
    groupAt < 0 ? [-1, 0] : [pointerAt(resource, groupAt + 0x10), view.getUint16(groupAt + 0x18, true)];
  if (arrayAt < 0 || count > LIMIT.shaders) return [];
  return Array.from({ length: count }, (_, index) => pointerAt(resource, arrayAt + index * 8));
}

export function readParameters(resource, shaderAt) {
  const view = resource.view;
  const count = fxRead(view, shaderAt, "count");
  const at = pointerAt(resource, shaderAt + FX.parameters);
  if (at < 0 || count > LIMIT.parameters) return null;

  const records = Array.from({ length: count }, (_, index) => readFields(view, at + index * CELL.record, RECORD));
  // Векторы лежат подряд за таблицей записей: у записи типа n их n штук; хэши — за последним.
  const starts = records.reduce((line, { type }) => [...line, line[line.length - 1] + type * CELL.vector], [
    at + count * CELL.record,
  ]);
  const hashesAt = starts[count];

  const entries = records.map((record, index) => ({
    ...record,
    hash: view.getUint32(hashesAt + index * CELL.hash, true),
    ...(record.type > 0 && { values: [0, 4, 8, 12].map((step) => view.getFloat32(starts[index] + step, true)) }),
  }));
  return { at, count, entries, bytes: hashesAt + count * CELL.hash - at };
}

const findDiffuse = (entries) => entries.find((entry) => entry.type === 0 && entry.hash === DIFFUSE_SAMPLER);

export function diffuseName(resource, entries) {
  const pointer = findDiffuse(entries)?.pointer;
  const textureAt = pointer ? resource.at(pointer) : -1;
  return textureAt < 0
    ? null
    : readCString(resource, resource.view.getBigUint64(textureAt + TEXTURE_NAME_AT, true));
}

const hexName = (hash) => `0x${hash.toString(16).padStart(8, "0")}`;

function describeShader(resource, shaderAt, index) {
  if (shaderAt < 0) return { index, texture: null, reason: REASON.noShader };
  const view = resource.view;
  const nameHash = fxRead(view, shaderAt, "name");
  const shader = shaderName(nameHash) ?? hexName(nameHash);
  const parameters = readParameters(resource, shaderAt);
  if (!parameters) return { index, shader, texture: null, reason: REASON.unreadable };

  const texture = diffuseName(resource, parameters.entries);
  return {
    index,
    shader,
    texture,
    glows: isEmissiveShader(nameHash, fxRead(view, shaderAt, "file")),
    room: parameters.bytes,
    ...(!texture && { reason: REASON.noTexture }),
  };
}

export const glowCandidates = (resource) =>
  shaderList(resource).map((shaderAt, index) => describeShader(resource, shaderAt, index));

// ---- перешивка ----

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

const intensityOf = (value) =>
  clamp(Number(value) || GLOW_INTENSITY.standard, GLOW_INTENSITY.min, GLOW_INTENSITY.max);

const isNight = (name) => name === GLOW_SHADERS.night;

// Новый блок параметров целиком: записи, векторы и хэши по раскладке.
function composeBlock({ layout, sizes, oldBytes, base, texturePointer, saved, power }) {
  const block = new Uint8Array(oldBytes);
  const out = new DataView(block.buffer);
  const vectorsAt = layout.length * CELL.record;

  layout.forEach(({ hash, fallback }, index) => {
    out.setUint32(sizes.size + index * CELL.hash, hash, true);
    if (index === 0) {
      out.setBigUint64(8, texturePointer, true);
      return;
    }
    const vectorAt = vectorsAt + (index - 1) * CELL.vector;
    const vector = typeof fallback === "function" ? fallback(power) : (saved.get(hash) ?? fallback);
    out.setUint8(index * CELL.record, 1);
    out.setBigUint64(index * CELL.record + 8, base + BigInt(vectorAt), true);
    vector.forEach((value, step) => out.setFloat32(vectorAt + step * 4, value, true));
  });
  return block;
}

function reflow({ resource, shaderAt, index, parameters, texture, intensity, shader, sizes }) {
  const { view, data } = resource;
  const layout = LAYOUTS[shader];
  const saved = new Map(
    parameters.entries
      .filter((entry) => entry.type > 0 && KNOWN_HASHES.has(entry.hash))
      .map((entry) => [entry.hash, entry.values]),
  );
  const block = composeBlock({
    layout,
    sizes,
    oldBytes: parameters.bytes,
    base: fxRead(view, shaderAt, "parameters"),
    texturePointer: findDiffuse(parameters.entries).pointer,
    saved,
    power: intensity,
  });
  data.set(block, parameters.at);

  const edits = {
    name: joaat(shader),
    file: joaat(`${shader}.sps`),
    count: layout.length,
    flags: GLOW_FLAGS,
    parameterSize: sizes.size,
    parameterDataSize: sizes.dataSize,
    textureCount: 1,
  };
  Object.entries(edits).forEach(([field, value]) => fxWrite(view, shaderAt, field, value));
  return { changed: [{ index, texture, shader, intensity }], skipped: [] };
}

const refuseWith = (texture, reason) => ({ changed: [], skipped: [{ texture, reason }] });

// Деталь уже светится и менять её блок не нужно или нельзя: правится только сила.
function retune({ resource, index, parameters, texture, intensity, current, sameKind }) {
  const multiplier = parameters.entries.find((entry) => entry.hash === EMISSIVE_MULTIPLIER);
  if (!multiplier) return refuseWith(texture, REASON.noPower);
  resource.view.setFloat32(resource.at(multiplier.pointer), intensity, true);
  return {
    changed: [{ index, texture, shader: current, intensity, kept: true }],
    skipped: sameKind ? [] : refuseWith(texture, isNight(current) ? REASON.nightOnly : REASON.stayAsIs).skipped,
  };
}

const tooShort = ({ texture, parameters, sizes }) =>
  refuseWith(texture, REASON.tooShort(parameters.bytes, sizes.bytes));

// Правила по порядку: первое подошедшее решает судьбу детали.
const RULES = [
  [({ glowing, sameKind, fits }) => glowing && (sameKind || !fits), retune],
  [({ fits }) => !fits, tooShort],
  [() => true, reflow],
];

function glowPart(job) {
  const { resource, shaderAt, parameters, target } = job;
  const intensity = intensityOf(target.intensity);
  const shader = GLOW_SHADERS[target.mode] || GLOW_SHADERS.always;
  const sizes = blockSizes(LAYOUTS[shader]);

  const nameHash = fxRead(resource.view, shaderAt, "name");
  const current = shaderName(nameHash) ?? GLOW_SHADERS.always;
  const facts = {
    glowing: isEmissiveShader(nameHash, fxRead(resource.view, shaderAt, "file")),
    sameKind: isNight(current) === isNight(shader),
    fits: sizes.bytes <= parameters.bytes,
  };
  const [, act] = RULES.find(([applies]) => applies(facts));
  return act({ ...job, ...facts, intensity, shader, sizes, current });
}

export function glowShaders(resource, targets = []) {
  // Цели по имени текстуры без учёта регистра: значение от последней, место от первой.
  const wanted = new Map(targets.map((target) => [lowerText(target.texture), target]));

  const handled = shaderList(resource).flatMap((shaderAt, index) => {
    const parameters = readParameters(resource, shaderAt);
    if (!parameters) return [];
    const texture = diffuseName(resource, parameters.entries);
    const target = texture ? wanted.get(texture.toLowerCase()) : undefined;
    if (!target) return [];
    return [{ key: texture.toLowerCase(), ...glowPart({ resource, shaderAt, index, parameters, texture, target }) }];
  });

  const found = new Set(handled.map(({ key }) => key));
  const missing = [...wanted]
    .filter(([key]) => !found.has(key))
    .map(([, target]) => ({ texture: target.texture, reason: REASON.noPart }));
  return {
    changed: handled.flatMap(({ changed }) => changed),
    skipped: [...handled.flatMap(({ skipped }) => skipped), ...missing],
  };
}
