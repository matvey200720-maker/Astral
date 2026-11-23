// Словарь текстур в корне core.ypt (RSC7 версии 68): имена, размеры, формат и байты пикселей.

import { readCString, readPointerList, openResource, YPT_VERSION_LEGACY } from "./resource.js";
import { levelBytes } from "@modovik/dds";

export { openResource, YPT_VERSION_LEGACY, resourceVersion, pageFlagSize } from "./resource.js";
export {
  shineDrawable,
  patchDrawable,
  patchDrawableTextures,
  jenkinsHash,
  readDrawableShaders,
  readDrawableTextures,
  readDrawableGeometry,
} from "./drawable.js";

export const DECODABLE_FORMATS = Object.freeze("DXT1 DXT3 DXT5 A8R8G8B8".split(" "));

const LIMITS = { textures: 4096, nameChars: 128 };
const POINTERS = { dictionary: 0x20, list: 0x30 };

// Коды формата в ресурсе: строка пар «код=имя».
const FORMAT_NAMES = new Map(
  "827611204=DXT1 861165636=DXT3 894720068=DXT5 826889281=ATI1 843666497=ATI2 540492610=BC7 21=A8R8G8B8 22=X8R8G8B8 28=A8 32=A8B8G8R8 50=L8"
    .split(" ")
    .map((pair) => pair.split("="))
    .map(([code, name]) => [Number(code), name]),
);

// Поля блока текстуры: [смещение, тип].
const TEXTURE_FIELDS = {
  namePointer: [0x28, "u64"],
  width: [0x50, "u16"],
  height: [0x52, "u16"],
  depth: [0x54, "u16"],
  stride: [0x56, "u16"],
  format: [0x58, "u32"],
  levels: [0x5d, "u8"],
  dataPointer: [0x70, "u64"],
};

const FIELD_READERS = {
  u8: (view, at) => view.getUint8(at),
  u16: (view, at) => view.getUint16(at, true),
  u32: (view, at) => view.getUint32(at, true),
  u64: (view, at) => view.getBigUint64(at, true),
};

const readFields = (view, block, names) =>
  Object.fromEntries(
    names.map((field) => {
      const [at, type] = TEXTURE_FIELDS[field];
      return [field, FIELD_READERS[type](view, block + at)];
    }),
  );

const demand = (ok, ErrorClass, message) => {
  if (!ok) throw new ErrorClass(message);
};

// Указатель (u64) по смещению → смещение в данных ресурса или -1.
const followPointer = (resource, offset) => resource.at(FIELD_READERS.u64(resource.view, offset));

const isBetween = (ch, low, high) => ch >= low && ch <= high;
const isWordChar = (ch) => isBetween(ch, "a", "z") || isBetween(ch, "A", "Z") || isBetween(ch, "0", "9") || ch === "_";
const isNameChar = (ch) => isWordChar(ch) || ".+-".includes(ch);

const validName = (name) => name.length <= LIMITS.nameChars && isWordChar(name[0]) && [...name].every(isNameChar);

// Байты всех уровней: сторона уровня max(1, размер >> уровень), сдвиг 32-битный.
const textureBytes = (format, width, height, levels) =>
  format === null
    ? 0
    : Array.from({ length: levels }, (_, level) =>
        levelBytes(format, Math.max(1, width >> level), Math.max(1, height >> level)),
      ).reduce((sum, bytes) => sum + bytes, 0);

const readTexture = (resource, block) => {
  const { view, data, at } = resource;
  const head = readFields(view, block, ["namePointer", "width", "height", "levels"]);
  const name = readCString(resource, head.namePointer);
  if (!(name && validName(name) && head.width && head.height && head.levels)) return null;
  const rest = readFields(view, block, ["depth", "stride", "format", "dataPointer"]);
  const format = FORMAT_NAMES.get(rest.format) ?? null;
  const { width, height, levels } = head;
  const bytes = textureBytes(format, width, height, levels);
  const start = at(rest.dataPointer);
  const end = start + bytes;
  return {
    name,
    width,
    height,
    depth: rest.depth || 1,
    stride: rest.stride,
    format,
    levels,
    bytes,
    decodable: DECODABLE_FORMATS.includes(format),
    payload: start < 0 || end > data.length ? null : data.subarray(start, end),
  };
};

// Блоки текстур списка по порядку; нулевые и внешние указатели пропускаются.
function* textureBlocks(resource, list, count) {
  for (let i = 0; i < count; i++) {
    const block = followPointer(resource, list + i * 8);
    if (block >= 0) yield block;
  }
}

export const readYptTextures = (input) => {
  const resource = openResource(input);
  demand(
    resource.version === YPT_VERSION_LEGACY,
    Error,
    `core.ypt версии ${resource.version} не поддерживается; ожидается Legacy 68.`,
  );
  const root = resource.at(resource.root);
  demand(root >= 0, Error, "Корень ресурса недоступен.");
  const dictionary = followPointer(resource, root + POINTERS.dictionary);
  demand(dictionary >= 0, Error, "В core.ypt нет словаря текстур.");
  const { entries, count } = readPointerList(resource, dictionary + POINTERS.list);
  demand(count <= LIMITS.textures, RangeError, "Словарь текстур заявляет слишком много записей.");
  const list = resource.at(entries);
  demand(list >= 0 || count === 0, Error, "Список текстур недоступен.");
  return Array.from(textureBlocks(resource, list, count), (block) => readTexture(resource, block)).filter(Boolean);
};

export const findYptTexture = (input, name) => {
  const wanted = String(name || "").toLowerCase();
  const byName = new Map();
  for (const texture of readYptTextures(input)) {
    const key = texture.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, texture);
  }
  return byName.get(wanted) ?? null;
};
