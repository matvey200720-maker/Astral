import { openResourceWith, pointerAt, readCString, readPointerList } from "@modovik/ypt/resource-core";
import { alphaModeOf, isEmissiveShader, joaat, samplerRole, shaderName } from "./shaders.js";
import { readTextureDictionaryAt } from "./texture.js";
import { SEMANTIC, readComponents, vertexLayout } from "./vertex.js";

export const DRAWABLE_VERSION_LEGACY = 165;
export const FRAGMENT_VERSION_LEGACY = 162;

const ENHANCED = new Set([154, 159, 171]);

const LIMIT = {
  parts: 4096,
  geometries: 1024,
  vertices: 1 << 20,
  indices: 3 << 21,
  shaders: 512,
  bones: 1024,
  models: 4096,
  minStride: 12,
};

const TEXT = {
  parts: "Модель заявляет слишком много частей.",
  geometries: "Часть модели заявляет слишком много геометрий.",
  vertexBuffer: "Буфер вершин модели заявляет больше, чем есть в файле.",
  noPositions: "Геометрия модели без позиций вершин.",
  indexBuffer: "Буфер индексов модели заявляет больше, чем есть в файле.",
  indexRange: "Индекс вершины вне буфера.",
  ring: "Кольцо в скелете модели.",
  noRoot: "Корень модели недоступен.",
  models: "Словарь заявляет слишком много моделей.",
  noFragmentModel: "У фрагмента нет модели.",
};

const fail = (code, text) => Object.assign(new Error(text), { code });

// Отказ «модель повреждена» с текстом из таблицы, если условие выполнено.
const refuseIf = (condition, key) => {
  if (condition) throw fail("RAGE_BROKEN", TEXT[key]);
};

const MULTIPLIER_HASH = joaat("emissiveMultiplier");
const REFLECT_HASH = joaat("reflectivePower");

// Смещения уровней детализации в корне модели; незнакомое имя даёт undefined, а с ним NaN в сумме.
const LEVEL_AT = new Map([
  ["high", 0x50],
  ["medium", 0x58],
  ["low", 0x60],
  ["veryLow", 0x68],
]);
const LEVEL_ORDER = [...LEVEL_AT.keys()];

// ---- структуры файла: поле → [смещение, вид] ----

const floats = (width) => (view, at) => Array.from({ length: width }, (_, step) => view.getFloat32(at + step * 4, true));

const KIND = {
  u8: (view, at) => view.getUint8(at),
  u16: (view, at) => view.getUint16(at, true),
  i16: (view, at) => view.getInt16(at, true),
  u32: (view, at) => view.getUint32(at, true),
  u64: (view, at) => view.getBigUint64(at, true),
  f32x3: floats(3),
  f32x4: floats(4),
};

// Вид "ptr" разыменовывается: смещение в данных или -1.
const readStruct = (resource, at, schema) =>
  Object.fromEntries(
    Object.entries(schema).map(([field, [offset, kind]]) => [
      field,
      kind === "ptr" ? pointerAt(resource, at + offset) : KIND[kind](resource.view, at + offset),
    ]),
  );

const DRAWABLE = { group: [0x10, "ptr"], skeleton: [0x18, "ptr"] };
const GROUP = { dictionary: [0x08, "ptr"], array: [0x10, "ptr"], count: [0x18, "u16"] };
const SHADER = {
  block: [0x00, "ptr"],
  nameHash: [0x08, "u32"],
  count: [0x10, "u8"],
  bucket: [0x11, "u8"],
  fileHash: [0x18, "u32"],
};
const SKELETON = { array: [0x20, "ptr"], count: [0x5e, "u16"] };
const BONE = {
  rotation: [0x00, "f32x4"],
  translation: [0x10, "f32x3"],
  scale: [0x20, "f32x3"],
  parent: [0x32, "i16"],
  namePointer: [0x38, "u64"],
  tag: [0x44, "u16"],
};
const BONE_SIZE = 0x50;
const PART_HEAD = { geometryCount: [0x10, "u16"] };
const PART = { geometries: [0x08, "ptr"], shaders: [0x20, "ptr"], binding: [0x28, "u32"] };
const GEOMETRY = { vertexBuffer: [0x18, "ptr"], indexBuffer: [0x38, "ptr"] };
const VERTEX_BUFFER = {
  stride: [0x08, "u16"],
  data: [0x10, "ptr"],
  altData: [0x20, "ptr"],
  count: [0x18, "u32"],
  declaration: [0x30, "ptr"],
};
const DECLARATION = { flags: [0, "u32"], stride: [4, "u16"], types: [8, "u64"] };
const INDEX_BUFFER = { count: [0x08, "u32"], at: [0x10, "ptr"] };
const DICTIONARY = {
  hashes: [0x20, "ptr"],
  hashCount: [0x28, "u16"],
  list: [0x30, "ptr"],
  count: [0x38, "u16"],
};

const hex32 = (hash) => `0x${hash.toString(16).padStart(8, "0")}`;

// ---- материалы ----

const NO_BLOCK = { textures: {}, samplers: [], floatFor: () => undefined };

// Блок параметров шейдера: типы записей читаются, пока записи помещаются в данные.
function parameterBlock(resource, blockAt, declared) {
  const { view, data } = resource;
  const fitting = Math.max(0, Math.min(declared, Math.floor((data.length - blockAt) / 16)));
  const types = Array.from({ length: fitting }, (_, index) => view.getUint8(blockAt + index * 16));
  const sizes = types.map((type) => type * 16);
  const hashesAt = blockAt + declared * 16 + sizes.reduce((sum, size) => sum + size, 0);
  const hashAt = (index) => hashesAt + index * 4;
  const dataStarts = sizes.reduce((line, size) => [...line, line[line.length - 1] + size], [blockAt + fitting * 16]);

  const hashInside = (index) => hashAt(index) + 4 <= data.length;
  const readable = (index) => hashInside(index) && dataStarts[index] + 4 <= data.length;
  const withVectors = types.flatMap((type, index) => (type > 0 ? [index] : []));

  // Первое число первого вектора записи с нужным хэшем; выход за данные обрывает поиск.
  const floatFor = (wanted) => {
    const stop = withVectors.find((index) => !readable(index) || view.getUint32(hashAt(index), true) === wanted);
    return stop !== undefined && readable(stop) ? view.getFloat32(dataStarts[stop], true) : undefined;
  };

  const samplers = types
    .flatMap((type, index) => (type === 0 && hashInside(index) ? [index] : []))
    .map((index) => {
      const sampler = view.getUint32(hashAt(index), true);
      const textureAt = resource.at(view.getBigUint64(blockAt + index * 16 + 8, true));
      const texture = textureAt < 0 ? null : readCString(resource, view.getBigUint64(textureAt + 0x28, true));
      return { sampler, role: samplerRole(sampler), texture };
    });
  // В textures роль занимает первое непустое имя.
  const textures = samplers.reduce(
    (found, { role, texture }) => (role !== null && texture && found[role] === undefined ? { ...found, [role]: texture } : found),
    {},
  );
  return { textures, samplers, floatFor };
}

function readMaterial(resource, shaderAt) {
  const shader = readStruct(resource, shaderAt, SHADER);
  const emissive = isEmissiveShader(shader.nameHash, shader.fileHash);
  const block = shader.block < 0 ? NO_BLOCK : parameterBlock(resource, shader.block, shader.count);
  const measured = [
    ["emissiveMultiplier", emissive ? block.floatFor(MULTIPLIER_HASH) : undefined],
    ["reflectivePower", block.floatFor(REFLECT_HASH)],
  ].filter(([, value]) => Number.isFinite(value));

  return {
    shader: shaderName(shader.nameHash) ?? hex32(shader.nameHash),
    shaderHash: shader.nameHash,
    shaderFile: shaderName(shader.fileHash),
    shaderFileHash: shader.fileHash,
    renderBucket: shader.bucket,
    alphaMode: alphaModeOf(shader.nameHash, shader.fileHash),
    emissive,
    ...Object.fromEntries(measured),
    textures: block.textures,
    samplers: block.samplers,
  };
}

const materialsOf = (resource, group) =>
  group.array < 0 || group.count > LIMIT.shaders
    ? []
    : Array.from({ length: group.count }, (_, index) => {
        const shaderAt = pointerAt(resource, group.array + index * 8);
        return shaderAt < 0 ? null : readMaterial(resource, shaderAt);
      });

// ---- скелет ----

const multiply = (a, b) =>
  Array.from({ length: 16 }, (_, cell) => {
    const column = cell >> 2;
    const row = cell & 3;
    return [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + row] * b[column * 4 + k], 0);
  });

const diagonal = (a, b) => 1 - (a + b);
const plus = (a, b) => a + b;
const minus = (a, b) => a - b;

// Столбцы поворотной части: операция и два произведения кватерниона на каждый элемент.
const ROTATION_COLUMNS = [
  [[diagonal, "yy", "zz"], [plus, "xy", "wz"], [minus, "xz", "wy"]],
  [[minus, "xy", "wz"], [diagonal, "xx", "zz"], [plus, "yz", "wx"]],
  [[plus, "xz", "wy"], [minus, "yz", "wx"], [diagonal, "xx", "yy"]],
];

function localMatrix([x, y, z, w], [tx, ty, tz], scale) {
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const products = {
    xx: x * x2,
    xy: x * y2,
    xz: x * z2,
    yy: y * y2,
    yz: y * z2,
    zz: z * z2,
    wx: w * x2,
    wy: w * y2,
    wz: w * z2,
  };
  const rotated = ROTATION_COLUMNS.flatMap((column, at) => [
    ...column.map(([operation, a, b]) => operation(products[a], products[b]) * scale[at]),
    0,
  ]);
  return [...rotated, tx, ty, tz, 1];
}

// Абсолютные матрицы с памятью: цепочка предков считается от корня вниз, кольцо — отказ.
function absoluteMatrices(locals, parents) {
  const count = locals.length;
  const solved = locals.map(() => null);
  const parentOf = (index) => {
    const parent = parents[index];
    return parent >= 0 && parent < count && parent !== index ? parent : -1;
  };
  const lineage = (start) => {
    const line = [];
    for (let at = start; at >= 0 && solved[at] === null; at = parentOf(at)) {
      line.push(at);
      refuseIf(line.length > LIMIT.bones, "ring");
    }
    return line.reverse();
  };
  locals.forEach((_, start) => {
    lineage(start).forEach((index) => {
      const parent = parentOf(index);
      solved[index] = parent < 0 ? locals[index] : multiply(solved[parent], locals[index]);
    });
  });
  return solved;
}

function readSkeleton(resource, skeletonAt) {
  const none = { bones: [], matrices: [] };
  if (skeletonAt < 0) return none;
  const { array, count } = readStruct(resource, skeletonAt, SKELETON);
  if (count === 0 || count > LIMIT.bones || array < 0 || array + count * BONE_SIZE > resource.data.length) return none;

  const raw = Array.from({ length: count }, (_, index) => {
    const bone = readStruct(resource, array + index * BONE_SIZE, BONE);
    const scale = bone.scale.map((value) => value || 1);
    return { ...bone, scale, local: localMatrix(bone.rotation, bone.translation, scale) };
  });
  const matrices = absoluteMatrices(
    raw.map(({ local }) => local),
    raw.map(({ parent }) => parent),
  );
  const bones = raw.map(({ parent, namePointer, tag, rotation, translation, scale }, index) => ({
    name: readCString(resource, namePointer) ?? "",
    parent,
    tag,
    matrix: Array.from(matrices[index]),
    rotation,
    translation,
    scale,
  }));
  return { bones, matrices };
}

// ---- вершины ----

// Сумма произведений строки матрицы на вектор: ((m0·x + m4·y) + m8·z).
const rowDot = (m, row, [x, y, z]) => m[row] * x + m[row + 4] * y + m[row + 8] * z;

const transformPoint = (m, vector) => [0, 1, 2].map((row) => rowDot(m, row, vector) + m[12 + row]);

const transformDirection = (m, vector) => {
  const turned = [0, 1, 2].map((row) => rowDot(m, row, vector));
  const length = Math.hypot(...turned) || 1;
  return turned.map((value) => value / length);
};

// Оси RAGE (Z вверх) → оси glTF: (x, y, z) → (x, z, −y).
const putYUp = (out, at, [x, y, z]) => {
  out[at] = x;
  out[at + 1] = z;
  out[at + 2] = -y;
};

// Номера костей вершины: байт из вершины, а при наличии таблицы номеров — запись из неё.
function jointReader(resource, geometryAt) {
  const { view, data } = resource;
  const tableAt = pointerAt(resource, geometryAt + 0x68);
  const tableCount = view.getUint16(geometryAt + 0x72, true);
  const hasTable = tableAt >= 0 && tableCount !== 0 && tableAt + tableCount * 2 <= data.length;
  return (at) => {
    const byte = view.getUint8(at);
    if (!hasTable) return byte;
    return byte < tableCount ? view.getUint16(tableAt + byte * 2, true) : 0;
  };
}

// Выходные массивы: имя, семантика, число компонент на вершину.
const CHANNELS = [
  ["positions", SEMANTIC.position, 3],
  ["normals", SEMANTIC.normal, 3],
  ["uvs", SEMANTIC.uv0, 2],
  ["uvs1", SEMANTIC.uv1, 2],
  ["colours", SEMANTIC.colour0, 4],
  /* Второй набор цвета вершины: у земли (`terrain_cb_*`) в нём веса слоёв — G и B (ТЗ 10.11.2026, терраин). */
  ["colours1", SEMANTIC.colour1, 4],
];

function decodeVertices(resource, { layout, dataAt, count, stride, matrix, skinGeometryAt }) {
  const view = resource.view;
  const scratch = new Float32Array(4);
  const buffers = Object.fromEntries(
    CHANNELS.map(([name, semantic, width]) => [name, layout.has(semantic) ? new Float32Array(count * width) : null]),
  );

  // Позиция и нормаль проходят через общий рабочий массив.
  const through = (out, semantic, convert) => {
    const { offset, type } = layout.get(semantic);
    return (index, base) => {
      readComponents(view, base + offset, type, scratch, 0, 3);
      putYUp(out, index * 3, matrix ? convert(matrix, scratch) : scratch);
    };
  };
  const direct = (out, semantic, width) => {
    const { offset, type } = layout.get(semantic);
    return (index, base) => readComponents(view, base + offset, type, out, index * width, width);
  };

  const skinned = skinGeometryAt !== undefined && layout.has(SEMANTIC.blendWeights) && layout.has(SEMANTIC.blendIndices);
  const weights = skinned ? new Float32Array(count * 4) : null;
  const joints = skinned ? new Uint16Array(count * 4) : null;
  const jointAt = skinned ? jointReader(resource, skinGeometryAt) : null;

  const jointPuller = () => {
    const { offset } = layout.get(SEMANTIC.blendIndices);
    return (index, base) => joints.set([0, 1, 2, 3].map((slot) => jointAt(base + offset + slot)), index * 4);
  };

  const pullers = [
    through(buffers.positions, SEMANTIC.position, transformPoint),
    buffers.normals && through(buffers.normals, SEMANTIC.normal, transformDirection),
    buffers.uvs && direct(buffers.uvs, SEMANTIC.uv0, 2),
    buffers.uvs1 && direct(buffers.uvs1, SEMANTIC.uv1, 2),
    buffers.colours && direct(buffers.colours, SEMANTIC.colour0, 4),
    buffers.colours1 && direct(buffers.colours1, SEMANTIC.colour1, 4),
    skinned && direct(weights, SEMANTIC.blendWeights, 4),
    skinned && jointPuller(),
  ].filter(Boolean);

  for (let index = 0; index < count; index += 1) {
    const base = dataAt + index * stride;
    pullers.forEach((pull) => pull(index, base));
  }
  return { ...buffers, weights, joints };
}

function readIndices(resource, indexBufferAt, vertexCount) {
  const view = resource.view;
  const { count, at } = readStruct(resource, indexBufferAt, INDEX_BUFFER);
  refuseIf(at < 0 || count > LIMIT.indices || at + count * 2 > resource.data.length, "indexBuffer");
  const indices = new Uint16Array(count);
  for (const slot of indices.keys()) {
    indices[slot] = view.getUint16(at + slot * 2, true);
    refuseIf(indices[slot] >= vertexCount, "indexRange");
  }
  return { indices, indicesAt: at };
}

// Одна геометрия части; null, если в ней нечего читать.
function readGeometry(resource, geometryAt, { matrix, wantSkin }) {
  const { vertexBuffer, indexBuffer } = readStruct(resource, geometryAt, GEOMETRY);
  if (vertexBuffer < 0 || indexBuffer < 0) return null;

  const buffer = readStruct(resource, vertexBuffer, VERTEX_BUFFER);
  const dataAt = buffer.data < 0 ? buffer.altData : buffer.data;
  if (dataAt < 0 || buffer.declaration < 0 || buffer.count === 0) return null;

  const declaration = readStruct(resource, buffer.declaration, DECLARATION);
  const { layout, stride: computedStride } = vertexLayout(declaration.flags, declaration.types);
  const stride = buffer.stride || declaration.stride || computedStride;
  const { count } = buffer;
  refuseIf(count > LIMIT.vertices || stride < LIMIT.minStride || dataAt + count * stride > resource.data.length, "vertexBuffer");
  refuseIf(!layout.has(SEMANTIC.position), "noPositions");

  const vertices = decodeVertices(resource, {
    layout,
    dataAt,
    count,
    stride,
    matrix,
    skinGeometryAt: wantSkin ? geometryAt : undefined,
  });
  const { indices, indicesAt } = readIndices(resource, indexBuffer, count);

  const { positions, normals, uvs, uvs1, colours, colours1, weights, joints } = vertices;
  return {
    positions,
    normals,
    uvs,
    uvs1,
    colours,
    colours1,
    indices,
    skinned: layout.has(SEMANTIC.blendWeights),
    ...(wantSkin && { skin: weights ? { weights, joints } : null }),
    vertexFlags: declaration.flags,
    indicesAt,
    vertexDataAt: dataAt,
    vertexStride: stride,
  };
}

// ---- части и уровни ----

function meshesOfPart(resource, partAt, model, { bones, matrices, materials, wantSkin }) {
  const { geometryCount } = readStruct(resource, partAt, PART_HEAD);
  refuseIf(geometryCount > LIMIT.geometries, "geometries");
  const part = readStruct(resource, partAt, PART);
  const boneIndex = part.binding >>> 24;
  const skinFlag = (part.binding >>> 8) & 0xff;
  const matrix = skinFlag === 0 && boneIndex < bones.length ? matrices[boneIndex] : null;

  return Array.from({ length: part.geometries < 0 ? 0 : geometryCount }, (_, slot) => ({
    slot,
    geometryAt: pointerAt(resource, part.geometries + slot * 8),
  }))
    .filter(({ geometryAt }) => geometryAt >= 0)
    .flatMap(({ slot, geometryAt }) => {
      const geometry = readGeometry(resource, geometryAt, { matrix, wantSkin: wantSkin && skinFlag !== 0 });
      if (!geometry) return [];
      const shaderIndex = part.shaders < 0 ? 0 : resource.view.getUint16(part.shaders + slot * 2, true);
      return [
        {
          ...geometry,
          shaderIndex,
          model,
          slot,
          boneIndex: skinFlag !== 0 ? null : boneIndex,
          material: materials[shaderIndex] ?? null,
        },
      ];
    });
}

// Действительные части уровня; пусто, если список или массив недействительны.
function partsAtLevel(resource, listAt) {
  if (listAt < 0) return [];
  const { entries, count } = readPointerList(resource, listAt);
  const arrayAt = resource.at(entries);
  if (count === 0 || arrayAt < 0) return [];
  refuseIf(count > LIMIT.parts, "parts");
  return Array.from({ length: count }, (_, index) => pointerAt(resource, arrayAt + index * 8)).filter(
    (partAt) => partAt >= 0,
  );
}

// Уровни по очереди: запрошенный, потом остальные из ряда; отдаются только уровни с частями.
function* levelCandidates(resource, drawableAt, wanted) {
  for (const level of [wanted, ...LEVEL_ORDER.filter((name) => name !== wanted)]) {
    const parts = partsAtLevel(resource, pointerAt(resource, drawableAt + LEVEL_AT.get(level)));
    if (parts.length > 0) yield { level, parts };
  }
}

function* axisValues(meshes, axis) {
  for (const { positions } of meshes) {
    for (let at = axis; at < positions.length; at += 3) yield positions[at];
  }
}

const extremum = (values, beats, start) => {
  let best = start;
  for (const value of values) {
    if (beats(value, best)) best = value;
  }
  return best;
};

function boundsOf(meshes) {
  const axes = [0, 1, 2];
  const min = axes.map((axis) => extremum(axisValues(meshes, axis), (value, best) => value < best, Infinity));
  const max = axes.map((axis) => extremum(axisValues(meshes, axis), (value, best) => value > best, -Infinity));
  return meshes.length && Number.isFinite(min[0]) ? { min, max } : null;
}

function readName(resource, view, drawableAt) {
  if (!(drawableAt + 0xb0 <= resource.data.length)) return null;
  return readCString(resource, view.getBigUint64(drawableAt + 0xa8, true)) || null;
}

export function readDrawableAt(resource, drawableAt, { lod = "high", hash = null, skin = false } = {}) {
  const view = resource.view;
  const root = readStruct(resource, drawableAt, DRAWABLE);
  const group = root.group < 0 ? null : readStruct(resource, root.group, GROUP);

  const materials = group ? materialsOf(resource, group) : [];
  const embeddedTextures = group ? readTextureDictionaryAt(resource, group.dictionary) : [];
  const skeleton = readSkeleton(resource, root.skeleton);
  const [chosen = { level: null, parts: [] }] = levelCandidates(resource, drawableAt, lod);

  const scene = { ...skeleton, materials, wantSkin: Boolean(skin) };
  const meshes = chosen.parts.flatMap((partAt, model) => meshesOfPart(resource, partAt, model, scene));
  return {
    name: readName(resource, view, drawableAt),
    hash,
    lod: chosen.level,
    hasShaderGroup: group !== null,
    meshes,
    materials,
    embeddedTextures,
    bones: skeleton.bones,
    bounds: boundsOf(meshes),
  };
}

export function drawableKindOf(resource) {
  const version = resource.version;
  if (version !== DRAWABLE_VERSION_LEGACY) return version === FRAGMENT_VERSION_LEGACY ? "yft" : null;
  const root = resource.at(resource.root);
  if (root < 0) return null;
  return resource.view.getBigUint64(root + 0x18, true) === 1n ? "ydd" : "ydr";
}

// ---- файл целиком ----

// Словарь моделей: записи с недействительным указателем пропускаются, номера не сдвигаются.
function readDictionary(resource, root, options) {
  const dictionary = readStruct(resource, root, DICTIONARY);
  refuseIf(dictionary.count > LIMIT.models, "models");
  const entries = dictionary.list < 0 ? [] : Array.from({ length: dictionary.count }, (_, index) => index);
  return entries
    .map((index) => ({ index, entryAt: pointerAt(resource, dictionary.list + index * 8) }))
    .filter(({ entryAt }) => entryAt >= 0)
    .map(({ index, entryAt }) => {
      const hashed = dictionary.hashes >= 0 && index < dictionary.hashCount;
      const hash = hashed ? resource.view.getUint32(dictionary.hashes + index * 4, true) : null;
      return readDrawableAt(resource, entryAt, { ...options, hash });
    });
}

function readFragment(resource, root, options) {
  const bodyAt = pointerAt(resource, root + 0x30);
  refuseIf(bodyAt < 0, "noFragmentModel");
  return [readDrawableAt(resource, bodyAt, { ...options, hash: null })];
}

const readSingle = (resource, root, options) => [readDrawableAt(resource, root, { ...options, hash: null })];

const KIND_READERS = new Map([
  ["ydd", readDictionary],
  ["yft", readFragment],
]);

export function readDrawable(input, { inflateRaw, kind, lod = "high", skin = false } = {}) {
  const resource = input?.view && input?.at ? input : openResourceWith(input, inflateRaw);
  const version = resource.version;
  if (ENHANCED.has(version)) {
    throw fail("RAGE_ENHANCED", `Модель из GTA V Enhanced (версия ${version}) — Astral читает модели Legacy.`);
  }
  const resolved = kind || drawableKindOf(resource);
  if (!resolved) throw fail("RAGE_VERSION", `Это не модель GTA V Legacy (версия ресурса ${version}).`);

  const root = resource.at(resource.root);
  refuseIf(root < 0, "noRoot");
  const read = KIND_READERS.get(resolved) ?? readSingle;
  return { kind: resolved, version, drawables: read(resource, root, { lod, skin }), resource };
}
