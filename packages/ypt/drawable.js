/*
 * Модель (.ydr) без .NET: встроенный словарь текстур и треугольники.
 *
 * Словарь: Drawable → ShaderGroup (указатель 0x10) → TextureDictionary
 * (указатель 0x08 внутри группы) → список текстур (0x30 внутри словаря).
 * Сами блоки Texture такие же, как в отдельных словарях `.ytd`, только
 * словарь лежит в модели. Разметка снята с живых файлов мода залазов.
 *
 * Правка нарочно узкая: подменяются байты пикселей на месте. Ни размер, ни
 * формат, ни число mip-уровней меняться не могут — это перекладка страниц
 * ресурса, а её честно делает только нативный хост. Собрать модель заново —
 * тоже его работа (`compile-climb-markers`); здесь геометрию только читают.
 */

import zlib from "node:zlib";
import { levelBytes } from "@modovik/dds";
import { openResource, readCString, readPointerList } from "./resource.js";
import { deflateRaw } from "@modovik/native-rs";

const SHADER_GROUP_POINTER = 0x10;
const TEXTURE_DICTIONARY_POINTER = 0x08;
const TEXTURE_LIST_OFFSET = 0x30;
const MAX_TEXTURES = 256;
const TEXTURE = Object.freeze({
  namePointer: 0x28,
  width: 0x50,
  height: 0x52,
  depth: 0x54,
  stride: 0x56,
  format: 0x58,
  levels: 0x5d,
  dataPointer: 0x70,
});
const FORMATS = new Map([
  [0x31545844, "DXT1"],
  [0x33545844, "DXT3"],
  [0x35545844, "DXT5"],
  [21, "A8R8G8B8"],
  /* Зелёные зоны (`gz.rpf`): несжатая RGBA-клетка 4×4. */
  [32, "A8B8G8R8"],
]);

function mipSpans(format, width, height, levels) {
  const spans = [];
  let offset = 0;
  for (let level = 0; level < levels; level += 1) {
    const bytes = levelBytes(
      format,
      Math.max(1, width >> level),
      Math.max(1, height >> level),
    );
    spans.push({ offset, bytes });
    offset += bytes;
  }
  return spans;
}

function textureList(resource) {
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) throw new Error("Корень модели недоступен.");
  const groupAt = resource.at(
    resource.view.getBigUint64(rootAt + SHADER_GROUP_POINTER, true),
  );
  if (groupAt < 0) throw new Error("У модели нет группы шейдеров.");
  const dictionaryAt = resource.at(
    resource.view.getBigUint64(groupAt + TEXTURE_DICTIONARY_POINTER, true),
  );
  if (dictionaryAt < 0) return [];
  const list = readPointerList(resource, dictionaryAt + TEXTURE_LIST_OFFSET);
  if (list.count > MAX_TEXTURES)
    throw new RangeError(
      "Словарь текстур модели заявляет слишком много записей.",
    );
  const entriesAt = resource.at(list.entries);
  if (entriesAt < 0) return [];
  const textures = [];
  for (let index = 0; index < list.count; index += 1) {
    const at = resource.at(
      resource.view.getBigUint64(entriesAt + index * 8, true),
    );
    if (at < 0) continue;
    const name = readCString(
      resource,
      resource.view.getBigUint64(at + TEXTURE.namePointer, true),
    );
    const width = resource.view.getUint16(at + TEXTURE.width, true);
    const height = resource.view.getUint16(at + TEXTURE.height, true);
    const levels = resource.data[at + TEXTURE.levels];
    const format =
      FORMATS.get(resource.view.getUint32(at + TEXTURE.format, true)) || null;
    if (!name || !width || !height || !levels || !format) continue;
    const dataAt = resource.at(
      resource.view.getBigUint64(at + TEXTURE.dataPointer, true),
    );
    const spans = mipSpans(format, width, height, levels);
    const bytes = spans.at(-1).offset + spans.at(-1).bytes;
    if (dataAt < 0 || dataAt + bytes > resource.data.length) continue;
    textures.push({
      name,
      width,
      height,
      levels,
      format,
      bytes,
      dataAt,
      spans,
    });
  }
  /*
   * Сколько байт с начала текстуры принадлежат ей одной.
   *
   * В `panika4z.ydr` из мода два указателя стоят в 32 байтах друг от друга,
   * хотя каждая текстура заявляет 48: последний mip-уровень тёмной метки —
   * это первый уровень светлой. Файл живой и в игре работает, и задача не
   * «починить» его, а не испортить: запись обрывается там, где начинается
   * соседняя текстура.
   */
  const starts = textures
    .map((texture) => texture.dataAt)
    .sort((left, right) => left - right);
  return textures.map((texture) => {
    const next = starts.find((start) => start > texture.dataAt);
    return {
      ...texture,
      writable:
        next === undefined
          ? texture.bytes
          : Math.min(texture.bytes, next - texture.dataAt),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Геометрия старшего уровня детализации
 *
 * Разметка Legacy-модели проверена на 22 моделях игры
 * (`scripts/verify-ypt-drawable.mjs`, см. MARKUP.md): указатель на список
 * моделей High лежит в 0x50, у модели — список
 * геометрий (0x08) и номера шейдеров (0x20), у геометрии — буферы вершин
 * (0x18) и индексов (0x38).
 * ------------------------------------------------------------------ */

const DRAWABLE_MODELS_HIGH = 0x50;
const MAX_MODELS = 64;
const MAX_GEOMETRIES = 256;
const MAX_VERTICES = 65536;
const MAX_INDICES = 3 * 1024 * 1024;
/* Биты раскладки вершины: позиция, веса и кости скина, нормаль. */
const VERTEX_POSITION = 1 << 0;
const VERTEX_SKIN = (1 << 1) | (1 << 2);
const VERTEX_NORMAL = 1 << 3;

function pointerAt(resource, offset) {
  return resource.at(resource.view.getBigUint64(offset, true));
}

function readGeometry(resource, at) {
  const vertexBufferAt = pointerAt(resource, at + 0x18);
  const indexBufferAt = pointerAt(resource, at + 0x38);
  if (vertexBufferAt < 0 || indexBufferAt < 0) return null;
  const stride = resource.view.getUint16(vertexBufferAt + 0x08, true);
  const count = resource.view.getUint32(vertexBufferAt + 0x18, true);
  let dataAt = pointerAt(resource, vertexBufferAt + 0x10);
  if (dataAt < 0) dataAt = pointerAt(resource, vertexBufferAt + 0x20);
  const declarationAt = pointerAt(resource, vertexBufferAt + 0x30);
  if (dataAt < 0 || declarationAt < 0) return null;
  const flags = resource.view.getUint32(declarationAt, true);
  if (!(flags & VERTEX_POSITION))
    throw new Error("Геометрия модели без позиций вершин.");
  /* Скинованные модели сюда не ходят: у меток залазов скина нет, а сдвиг
     нормали после весов и костей пришлось бы выводить из типов раскладки. */
  if (flags & VERTEX_SKIN)
    throw new Error("Скинованная геометрия здесь не читается.");
  if (
    count > MAX_VERTICES ||
    stride < 12 ||
    dataAt + count * stride > resource.data.length
  )
    throw new RangeError("Буфер вершин модели заявляет лишнее.");
  const indexCount = resource.view.getUint32(indexBufferAt + 0x08, true);
  const indicesAt = pointerAt(resource, indexBufferAt + 0x10);
  if (
    indicesAt < 0 ||
    indexCount > MAX_INDICES ||
    indicesAt + indexCount * 2 > resource.data.length
  )
    throw new RangeError("Буфер индексов модели заявляет лишнее.");
  const positions = new Float32Array(count * 3);
  const normals = flags & VERTEX_NORMAL ? new Float32Array(count * 3) : null;
  for (let index = 0; index < count; index += 1) {
    const vertex = dataAt + index * stride;
    for (let axis = 0; axis < 3; axis += 1) {
      positions[index * 3 + axis] = resource.view.getFloat32(
        vertex + axis * 4,
        true,
      );
      if (normals)
        normals[index * 3 + axis] = resource.view.getFloat32(
          vertex + 12 + axis * 4,
          true,
        );
    }
  }
  const indices = new Uint16Array(indexCount);
  for (let index = 0; index < indexCount; index += 1)
    indices[index] = resource.view.getUint16(indicesAt + index * 2, true);
  for (const index of indices)
    if (index >= count) throw new RangeError("Индекс вершины вне буфера.");
  return { flags, stride, positions, normals, indices };
}

/**
 * Треугольники старшего уровня детализации модели.
 *
 * Возвращает модели High, у каждой — геометрии с номером шейдера, позициями,
 * нормалями и индексами. Нужна там, где форму модели надо увидеть, а не
 * поправить: так снят силуэт меток залазов для вида «Как в моде».
 */
export function readDrawableGeometry(input) {
  const resource = openResource(input);
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) throw new Error("Корень модели недоступен.");
  const listAt = pointerAt(resource, rootAt + DRAWABLE_MODELS_HIGH);
  if (listAt < 0) return { models: [] };
  const list = readPointerList(resource, listAt);
  if (list.count > MAX_MODELS)
    throw new RangeError("Модель заявляет слишком много частей.");
  const entriesAt = resource.at(list.entries);
  const models = [];
  for (let index = 0; index < list.count && entriesAt >= 0; index += 1) {
    const modelAt = pointerAt(resource, entriesAt + index * 8);
    if (modelAt < 0) continue;
    const count = resource.view.getUint16(modelAt + 0x10, true);
    if (count > MAX_GEOMETRIES)
      throw new RangeError("Часть модели заявляет слишком много геометрий.");
    const geometriesAt = pointerAt(resource, modelAt + 0x08);
    const shadersAt = pointerAt(resource, modelAt + 0x20);
    const geometries = [];
    for (let slot = 0; slot < count && geometriesAt >= 0; slot += 1) {
      const geometryAt = pointerAt(resource, geometriesAt + slot * 8);
      if (geometryAt < 0) continue;
      const geometry = readGeometry(resource, geometryAt);
      if (!geometry) continue;
      geometries.push({
        shader:
          shadersAt >= 0
            ? resource.view.getUint16(shadersAt + slot * 2, true)
            : 0,
        ...geometry,
      });
    }
    models.push({
      renderMask: resource.view.getUint16(modelAt + 0x2c, true),
      geometries,
    });
  }
  return { models };
}

/** Текстуры, зашитые в модель: имя, размер, формат, mip-уровни и байты. */
export function readDrawableTextures(input) {
  const resource = openResource(input);
  return textureList(resource).map((texture) => ({
    ...texture,
    payload: Buffer.from(
      resource.data.subarray(texture.dataAt, texture.dataAt + texture.bytes),
    ),
  }));
}

/* Все mip-уровни одинаковы — то есть картинка ровного цвета и обрезать её
   хвост безопасно: любой уровень читается теми же байтами. */
const flatColour = (payload, spans) =>
  spans.every((span) =>
    payload
      .subarray(span.offset, span.offset + span.bytes)
      .every((byte, index) => byte === payload[index % spans[0].bytes]),
  );

/* ------------------------------------------------------------------ *
 * Шейдеры и дальности
 *
 * Разметка — группа шейдеров, ShaderFX и блок параметров
 * Legacy-ресурса: в группе указатель на список шейдеров (0x10) и их число
 * (0x18); у шейдера — указатель на блок параметров (0x00), имя (0x08), число
 * параметров (0x10), корзина (0x11) и имя файла `.sps` (0x18). Блок
 * параметров: по 16 байт на параметр (тип, указатель на данные), следом
 * данные векторов (тип — сколько `Vector4`), следом хеши имён параметров.
 * Дальности уровней детализации — четыре float в 0x70 у корня модели.
 * ------------------------------------------------------------------ */

const SHADER_LIST_POINTER = 0x10;
const SHADER_COUNT = 0x18;
const SHADER = Object.freeze({
  parameters: 0x00,
  name: 0x08,
  parameterCount: 0x10,
  bucket: 0x11,
  fileName: 0x18,
});
const PARAMETER_BYTES = 16;
const MAX_SHADERS = 64;
const MAX_PARAMETERS = 64;
const MAX_VECTORS = 16;
const LOD_DISTANCES = 0x70;
const LOD_NAMES = Object.freeze(["high", "med", "low", "vlow"]);

/* Хеш имени, как его считает игра (Jenkins one-at-a-time, строчными). */
export function jenkinsHash(text) {
  let hash = 0;
  for (const char of String(text).toLowerCase()) {
    hash = (hash + char.charCodeAt(0)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

function shaderList(resource) {
  const rootAt = resource.at(resource.root);
  if (rootAt < 0) throw new Error("Корень модели недоступен.");
  const groupAt = pointerAt(resource, rootAt + SHADER_GROUP_POINTER);
  if (groupAt < 0) throw new Error("У модели нет группы шейдеров.");
  const listAt = pointerAt(resource, groupAt + SHADER_LIST_POINTER);
  const count = resource.view.getUint16(groupAt + SHADER_COUNT, true);
  if (count > MAX_SHADERS)
    throw new RangeError("Группа шейдеров заявляет слишком много шейдеров.");
  const shaders = [];
  for (let index = 0; index < count && listAt >= 0; index += 1) {
    const at = pointerAt(resource, listAt + index * 8);
    if (at < 0) continue;
    const parametersAt = pointerAt(resource, at + SHADER.parameters);
    const parameterCount = resource.data[at + SHADER.parameterCount];
    if (parameterCount > MAX_PARAMETERS)
      throw new RangeError("Шейдер модели заявляет слишком много параметров.");
    const parameters = [];
    if (parametersAt >= 0) {
      let dataBytes = 0;
      const raw = [];
      for (let slot = 0; slot < parameterCount; slot += 1) {
        const entry = parametersAt + slot * PARAMETER_BYTES;
        const type = resource.data[entry];
        if (type > MAX_VECTORS)
          throw new RangeError(
            "Параметр шейдера заявляет слишком много векторов.",
          );
        dataBytes += type * 16;
        raw.push({
          type,
          dataAt: pointerAt(resource, entry + 8),
        });
      }
      const hashesAt =
        parametersAt + parameterCount * PARAMETER_BYTES + dataBytes;
      if (hashesAt + parameterCount * 4 > resource.data.length)
        throw new RangeError("Имена параметров шейдера лежат за ресурсом.");
      raw.forEach((parameter, slot) => {
        const hash = resource.view.getUint32(hashesAt + slot * 4, true);
        const vectors = [];
        if (parameter.type > 0) {
          if (
            parameter.dataAt < 0 ||
            parameter.dataAt + parameter.type * 16 > resource.data.length
          )
            throw new RangeError("Данные параметра шейдера лежат за ресурсом.");
          for (let vector = 0; vector < parameter.type; vector += 1)
            vectors.push(
              [0, 1, 2, 3].map((axis) =>
                resource.view.getFloat32(
                  parameter.dataAt + vector * 16 + axis * 4,
                  true,
                ),
              ),
            );
        }
        parameters.push({
          hash,
          type: parameter.type,
          dataAt: parameter.dataAt,
          vectors,
        });
      });
    }
    shaders.push({
      index,
      at,
      parametersAt,
      nameHash: resource.view.getUint32(at + SHADER.name, true),
      fileHash: resource.view.getUint32(at + SHADER.fileName, true),
      bucket: resource.data[at + SHADER.bucket],
      parameters,
    });
  }
  return shaders;
}

function lodDistances(resource) {
  const rootAt = resource.at(resource.root);
  return Object.fromEntries(
    LOD_NAMES.map((name, index) => [
      name,
      resource.view.getFloat32(rootAt + LOD_DISTANCES + index * 4, true),
    ]),
  );
}

/**
 * Шейдеры модели с числовыми параметрами и дальности уровней детализации.
 *
 * Параметр — хеш имени (`jenkinsHash("emissivemultiplier")`), тип и векторы;
 * у текстурных параметров векторов нет. Нужен там, где модель проверяют
 * после правки: что свечение и дальности стали ровно заказанными.
 */
export function readDrawableShaders(input) {
  const resource = openResource(input);
  return {
    shaders: shaderList(resource).map(({ parameters, at: _at, parametersAt: _parametersAt, ...shader }) => ({
      ...shader,
      parameters: parameters.map(
        ({ dataAt: _dataAt, ...parameter }) => parameter,
      ),
    })),
    lodDistances: lodDistances(resource),
  };
}

function writeTextures(resource, replacements) {
  const textures = textureList(resource);
  const wanted = new Map(
    Object.entries(replacements || {}).map(([name, bytes]) => [
      name.toLowerCase(),
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0),
    ]),
  );
  const patched = [];
  for (const texture of textures) {
    const payload = wanted.get(texture.name.toLowerCase());
    if (!payload) continue;
    if (payload.length !== texture.bytes)
      throw new Error(
        `Текстура ${texture.name}: ${payload.length} байт вместо ${texture.bytes} (${texture.width}×${texture.height}, ${texture.format}, ${texture.levels} mip).`,
      );
    if (texture.writable < texture.spans[0].bytes)
      throw new Error(
        `Текстура ${texture.name} перекрыта соседней уже на первом уровне — правка испортила бы модель.`,
      );
    if (
      texture.writable < payload.length &&
      !flatColour(payload, texture.spans)
    )
      throw new Error(
        `Текстура ${texture.name} делит байты с соседней: на месте можно заменить только ровный цвет.`,
      );
    resource.data.set(payload.subarray(0, texture.writable), texture.dataAt);
    patched.push({ name: texture.name, bytes: texture.writable });
  }
  for (const name of wanted.keys())
    if (!patched.some((item) => item.name.toLowerCase() === name))
      throw new Error(`В модели нет текстуры ${name}.`);
  return patched;
}

/*
 * Числовые параметры шейдеров: `{ имя: [x, y, z, w] }`. Правится только
 * первый вектор параметра из одного вектора — у свечения, силы и цвета так
 * у всех моделей игры; параметр из нескольких векторов (массив) здесь не
 * меняют. Параметра нет ни у одного шейдера — отказ: правка, которой модель
 * не заметит, хуже явной ошибки.
 */
function writeVectors(resource, vectors, only = null) {
  const wanted = Object.entries(vectors || {}).map(([name, value]) => {
    const values = (Array.isArray(value) ? value : [value]).map(Number);
    if (!values.length || values.length > 4 || !values.every(Number.isFinite))
      throw new RangeError(
        `Параметр ${name}: нужно от одного до четырёх чисел.`,
      );
    return { name, hash: jenkinsHash(name), values };
  });
  if (!wanted.length) return [];
  const shaders = shaderList(resource);
  const patched = [];
  for (const { name, hash, values } of wanted) {
    let touched = 0;
    for (const shader of shaders)
      for (const parameter of shader.parameters) {
        /* `only` — номера шейдеров, что правятся (свечение одного щита в модели района). */
        if (parameter.hash !== hash || (only && !only.has(shader.index))) continue;
        if (parameter.type !== 1)
          throw new Error(
            `Параметр ${name} шейдера ${shader.index} — массив из ${parameter.type} векторов; правка на месте его не меняет.`,
          );
        values.forEach((component, axis) =>
          resource.view.setFloat32(
            parameter.dataAt + axis * 4,
            component,
            true,
          ),
        );
        touched += 1;
        patched.push({ name, shader: shader.index, values });
      }
    if (!touched) throw new Error(`В шейдерах модели нет параметра ${name}.`);
  }
  return patched;
}

/* Дальности уровней: `{ high, med, low, vlow }`, метры, как в модели. */
function writeLodDistances(resource, distances) {
  if (!distances) return null;
  const rootAt = resource.at(resource.root);
  const next = {};
  LOD_NAMES.forEach((name, index) => {
    if (!Object.hasOwn(distances, name)) return;
    const value = Number(distances[name]);
    if (!Number.isFinite(value) || value < 0 || value > 20000)
      throw new RangeError(`Дальность уровня ${name}: ${distances[name]}.`);
    resource.view.setFloat32(rootAt + LOD_DISTANCES + index * 4, value, true);
    next[name] = value;
  });
  return next;
}

/**
 * Правка модели на месте: пиксели текстур, числовые параметры шейдеров и
 * дальности уровней детализации — одной пересборкой.
 *
 * `textures` — `{ имя: байты }`; длина обязана совпасть с той, что модель
 * заявляет сама. Если текстура делит хвост с соседней, пишется только своя
 * часть — и лишь когда прислан ровный цвет, иначе обрезка молча изменила бы
 * дальние mip-уровни. `vectors` — `{ имяПараметра: [x, y, z, w] }` (можно
 * короче: недостающие компоненты остаются прежними). `lodDistances` —
 * `{ high, med, low, vlow }`, любые из четырёх. `shaders` — номера шейдеров,
 * чьи параметры правятся (по умолчанию — все).
 *
 * Ни размер, ни раскладка страниц не меняются, поэтому заголовок RSC7
 * копируется как есть; поток сжимается тем же deflate без обёртки, которым
 * он и был сжат.
 */
export function patchDrawable(input, { textures, vectors, lodDistances, shaders = null } = {}) {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const resource = openResource(raw);
  const patched = {
    textures: writeTextures(resource, textures),
    vectors: writeVectors(resource, vectors, shaders ? new Set(shaders) : null),
    lodDistances: writeLodDistances(resource, lodDistances),
  };
  const compressed = deflateRaw(resource.data, {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });
  const bytes = Buffer.alloc(16 + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, 16).copy(bytes, 0);
  compressed.copy(bytes, 16);
  return { bytes, patched };
}

/** Подменяет пиксели названных текстур — `patchDrawable` только с `textures`. */
export function patchDrawableTextures(input, replacements) {
  const { bytes, patched } = patchDrawable(input, { textures: replacements });
  return { bytes, patched: patched.textures };
}

/* ------------------------------------------------------------------ *
 * Блеск поверхностей (ТЗ 12.10.2026, задача 2: «чтобы плитка была более
 * яркая, как будто бы зеркалила, идеально чистая»)
 *
 * Блеск в игре — сила, резкость и френель блика шейдера материала: игра
 * отражает в блике окружение, и пол с сильным резким бликом выглядит
 * зеркальным. У шейдеров с бликом (`normal`, `spec`, `normal_spec`,
 * `default_spec`, `*_reflect`) параметры правятся на месте. У `default`
 * (плитка 24/7, ковры Fleeca) блика нет вовсе — он переводится на
 * `default_spec` тоже на месте: у `default_spec` пять параметров против
 * семи, и новый блок (записи, векторы, хеши имён) ложится в старый. Порядок
 * параметров — как у штатных моделей игры (пол Pacific Standard).
 * ------------------------------------------------------------------ */

const DEFAULT_SHADER = jenkinsHash("default");
const DEFAULT_SPEC_SHADER = jenkinsHash("default_spec");
const DEFAULT_SPEC_FILE = jenkinsHash("default_spec.sps");
const DIFFUSE_SAMPLER = jenkinsHash("DiffuseSampler");
const SHINE_PARAMETERS = Object.freeze({
  intensity: jenkinsHash("specularIntensityMult"),
  falloff: jenkinsHash("specularFalloffMult"),
  fresnel: jenkinsHash("specularFresnel"),
  reflect: jenkinsHash("reflectivePower"),
});
/* Поля ShaderFX: размер записей с векторами и данных блока, число текстур (см. MARKUP.md). */
const SHADER_PARAMETER_SIZE = 0x14;
const SHADER_PARAMETER_DATA_SIZE = 0x16;
const SHADER_TEXTURE_COUNT = 0x27;

/* Размеры блока параметров, как их пишет игра: записи и векторы; с хешами и хвостом в 32 байта — по 16. */
function parameterSizes(count, vectors) {
  const size = count * PARAMETER_BYTES + vectors * 16;
  const base = 32 + size + count * 4;
  return { size, data: Math.ceil(base / 16) * 16, base };
}

function writeVector(resource, at, values) {
  [0, 1, 2, 3].forEach((axis) => resource.view.setFloat32(at + axis * 4, values[axis] ?? 0, true));
}

/* `default` → `default_spec` на месте: текстура цвета та же, блик — заказанный. Ответ — почему нельзя, или `null`. */
function convertDefaultToSpec(resource, shader, values) {
  const textures = shader.parameters.filter((parameter) => parameter.type === 0);
  const vectors = shader.parameters.filter((parameter) => parameter.type === 1);
  if (textures.length !== 1 || textures[0].hash !== DIFFUSE_SAMPLER || vectors.length + 1 !== shader.parameters.length)
    return "у шейдера default не та раскладка параметров";
  const view = resource.view;
  const count = shader.parameters.length;
  const old = parameterSizes(count, vectors.length);
  const next = parameterSizes(5, 4);
  if (old.base < next.base) return "блок параметров шейдера мал для блика";
  if (view.getUint16(shader.at + SHADER_PARAMETER_SIZE, true) !== old.size || view.getUint16(shader.at + SHADER_PARAMETER_DATA_SIZE, true) !== old.data)
    return "размер блока параметров не тот, что пишет игра";
  const block = shader.parametersAt;
  const pointer = view.getBigUint64(shader.at + SHADER.parameters, true);
  const textureSlot = shader.parameters.findIndex((parameter) => parameter.type === 0);
  const vectorSlot = shader.parameters.findIndex((parameter) => parameter.type === 1);
  /* Копии записей, а не виды: у Buffer `slice` делит память, и очистка блока стёрла бы их. */
  const textureEntry = new Uint8Array(resource.data.subarray(block + textureSlot * PARAMETER_BYTES, block + (textureSlot + 1) * PARAMETER_BYTES));
  const vectorEntry = new Uint8Array(resource.data.subarray(block + vectorSlot * PARAMETER_BYTES, block + (vectorSlot + 1) * PARAMETER_BYTES));
  /* Старый блок — до конца хешей и хвоста: новый короче и целиком ложится в него. */
  resource.data.fill(0, block, block + old.base);
  resource.data.set(textureEntry, block);
  const layout = [
    ["useTessellation", [0, 0, 0, 0]],
    ["specularIntensityMult", [values.intensity, 0, 0, 0]],
    ["specularFalloffMult", [values.falloff, 0, 0, 0]],
    ["specularFresnel", [values.fresnel, 0, 0, 0]],
  ];
  const dataAt = block + 5 * PARAMETER_BYTES;
  layout.forEach(([, vector], slot) => {
    const entry = block + (slot + 1) * PARAMETER_BYTES;
    resource.data.set(vectorEntry, entry);
    /* Второй байт записи вектора — номер его слота с конца от 0xA0, как у
       штатного `default_spec` (A3, A2, A1, A0) и как в штатных словарях. */
    resource.data[entry + 1] = 0xa0 + (layout.length - 1 - slot);
    view.setBigUint64(entry + 8, pointer + BigInt(5 * PARAMETER_BYTES + slot * 16), true);
    writeVector(resource, dataAt + slot * 16, vector);
  });
  const hashesAt = dataAt + layout.length * 16;
  [DIFFUSE_SAMPLER, ...layout.map(([name]) => jenkinsHash(name))].forEach((hash, slot) => view.setUint32(hashesAt + slot * 4, hash, true));
  view.setUint32(shader.at + SHADER.name, DEFAULT_SPEC_SHADER, true);
  view.setUint32(shader.at + SHADER.fileName, DEFAULT_SPEC_FILE, true);
  resource.data[shader.at + SHADER.parameterCount] = 5;
  view.setUint16(shader.at + SHADER_PARAMETER_SIZE, next.size, true);
  view.setUint16(shader.at + SHADER_PARAMETER_DATA_SIZE, next.data, true);
  resource.data[shader.at + SHADER_TEXTURE_COUNT] = 1;
  return null;
}

/* Поднять параметр блика до заказанного (не ниже, чем было у игры). */
function raiseParameter(resource, shader, hash, value) {
  const parameter = shader.parameters.find((item) => item.hash === hash && item.type === 1);
  if (!parameter || !Number.isFinite(value)) return null;
  const before = resource.view.getFloat32(parameter.dataAt, true);
  const after = Math.max(before, value);
  resource.view.setFloat32(parameter.dataAt, after, true);
  return after;
}

/**
 * Блеск материалов модели: `shaders` — номера шейдеров, `intensity`,
 * `falloff`, `fresnel` — сила, резкость и френель блика, `reflect` — сила
 * отражения у шейдеров `*_reflect`. Параметры только растут: матовее, чем у
 * игры, не становится. `default` переводится на `default_spec`. Ответ —
 * `{ bytes, shaders: [{ index, converted, values }], skipped: [{ index, why }] }`;
 * заголовок RSC7 и раскладка страниц — прежние.
 */
export function shineDrawable(input, { shaders = [], intensity = 1, falloff = 200, fresnel = 0.97, reflect = 0 } = {}) {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const resource = openResource(raw);
  const list = shaderList(resource);
  const wanted = new Set(shaders.map(Number));
  const done = [];
  const skipped = [];
  for (const shader of list) {
    if (!wanted.has(shader.index)) continue;
    const hasShine = shader.parameters.some((parameter) => parameter.hash === SHINE_PARAMETERS.intensity && parameter.type === 1);
    if (hasShine) {
      const values = {
        intensity: raiseParameter(resource, shader, SHINE_PARAMETERS.intensity, intensity),
        falloff: raiseParameter(resource, shader, SHINE_PARAMETERS.falloff, falloff),
        fresnel: raiseParameter(resource, shader, SHINE_PARAMETERS.fresnel, fresnel),
        reflect: raiseParameter(resource, shader, SHINE_PARAMETERS.reflect, reflect),
      };
      done.push({ index: shader.index, converted: false, values });
      continue;
    }
    if (shader.nameHash === DEFAULT_SHADER) {
      const why = convertDefaultToSpec(resource, shader, { intensity, falloff, fresnel });
      if (why) skipped.push({ index: shader.index, why });
      else done.push({ index: shader.index, converted: true, values: { intensity, falloff, fresnel, reflect: null } });
      continue;
    }
    skipped.push({ index: shader.index, why: "у шейдера нет блика, а перевод на блестящий без перекладки модели не ложится" });
  }
  for (const index of wanted) if (!list.some((shader) => shader.index === index)) skipped.push({ index, why: "в модели нет такого шейдера" });
  if (!done.length) return { bytes: Buffer.from(raw), shaders: done, skipped };
  const compressed = deflateRaw(resource.data, { level: zlib.constants.Z_BEST_COMPRESSION });
  const bytes = Buffer.alloc(16 + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, 16).copy(bytes, 0);
  compressed.copy(bytes, 16);
  return { bytes, shaders: done, skipped };
}
