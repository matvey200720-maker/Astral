// Словари текстур RAGE Legacy (.ytd и словари внутри моделей, версия ресурса 13):
// описание каждой текстуры без копирования пикселей и расшифровка одного уровня по запросу.
import { decodeTexture, levelBytes } from "@modovik/dds";
import { pointerAt, readCString, readPointerList } from "@modovik/ypt/resource-core";

// Первые шесть — четыре буквы имени как u32 little-endian, остальные — номера D3DFMT.
export const TEXTURE_FORMATS = new Map([
  [0x31545844, "DXT1"],
  [0x33545844, "DXT3"],
  [0x35545844, "DXT5"],
  [0x31495441, "ATI1"],
  [0x32495441, "ATI2"],
  [0x20374342, "BC7"],
  [21, "A8R8G8B8"],
  [22, "X8R8G8B8"],
  [28, "A8"],
  [32, "A8B8G8R8"],
  [50, "L8"],
]);

export const YTD_VERSION_LEGACY = 13;

const TEXTURE_LIST_AT = 0x30;
const MAX_TEXTURES = 4096;
const POINTER_SIZE = 8;

// Поля текстуры Legacy от её начала.
const FIELD = Object.freeze({ name: 0x28, width: 0x50, height: 0x52, format: 0x58, levels: 0x5d, data: 0x70 });

function levelSize(width, height, level) {
  return [Math.max(1, width >> level), Math.max(1, height >> level)];
}

function levelSpans(format, width, height, levels) {
  const spans = [];
  let total = 0;
  for (let level = 0; level < levels; level++) {
    const bytes = levelBytes(format, ...levelSize(width, height, level));
    spans.push({ offset: total, bytes });
    total += bytes;
  }
  return { spans, total };
}

// Описание текстуры по её смещению или null, если записи нечего показать (нет имени, размера, уровней).
function describeTexture(resource, at) {
  const { view } = resource;
  const name = readCString(resource, Number(view.getBigUint64(at + FIELD.name, true)));
  const width = view.getUint16(at + FIELD.width, true);
  const height = view.getUint16(at + FIELD.height, true);
  const formatCode = view.getUint32(at + FIELD.format, true);
  const levels = view.getUint8(at + FIELD.levels);
  const dataAt = pointerAt(resource, at + FIELD.data);
  if (!name || width === 0 || height === 0 || levels === 0) return null;

  // Неизвестный формат остаётся в списке — проверка мода должна его увидеть.
  const format = TEXTURE_FORMATS.get(formatCode) ?? null;
  const { spans, total } = format ? levelSpans(format, width, height, levels) : { spans: [], total: 0 };
  const complete = format !== null && dataAt !== -1 && dataAt + total <= resource.data.length;
  return { name, width, height, levels, format, formatCode, bytes: total, complete, resource, dataAt, spans };
}

export function readTextureDictionaryAt(resource, dictionaryAt) {
  if (dictionaryAt < 0) return [];
  // Строковое смещение не приводится: «0» + 0x30 склеивается в «048» — так и задумано повторять.
  const listAt = dictionaryAt + TEXTURE_LIST_AT;
  const { count } = readPointerList(resource, listAt);
  if (count > MAX_TEXTURES) throw new RangeError("Словарь текстур заявляет слишком много записей.");
  const arrayAt = pointerAt(resource, listAt);
  if (arrayAt === -1) return [];

  const textures = [];
  for (let i = 0; i < count; i++) {
    const textureAt = pointerAt(resource, arrayAt + i * POINTER_SIZE);
    if (textureAt === -1) continue;
    const texture = describeTexture(resource, textureAt);
    if (texture) textures.push(texture);
  }
  return textures;
}

export function readTextureDictionaryResource(resource) {
  return readTextureDictionaryAt(resource, resource.at(resource.root));
}

// Имя с ложным значением (0, "", false, NaN, null, undefined) печатается пустым, истинное — строкой.
function textureError(code, ref, problem) {
  return Object.assign(new Error(`Текстура ${ref?.name || ""}: ${problem}`), { code });
}

// Номер уровня: целый `level` важнее всего; иначе первый, чья большая сторона влезает в `maxSize`.
function chooseLevel(ref, level, maxSize) {
  const last = ref.levels - 1;
  let chosen = 0;
  if (Number.isInteger(level)) {
    chosen = level;
  } else if (maxSize) {
    while (chosen < last && Math.max(ref.width >> chosen, ref.height >> chosen) > maxSize) chosen++;
  }
  return Math.min(Math.max(chosen, 0), last);
}

export function decodeTextureRef(ref, { level, maxSize } = {}) {
  if (!ref?.format) throw textureError("RAGE_TEXTURE_FORMAT", ref, "формат не поддерживается.");
  if (!ref.complete) throw textureError("RAGE_TEXTURE_BROKEN", ref, "байты обрезаны — файл повреждён.");

  const chosen = chooseLevel(ref, level, maxSize);
  const [width, height] = levelSize(ref.width, ref.height, chosen);
  const span = ref.spans[chosen];
  const start = ref.dataAt + span.offset;
  const bytes = ref.resource.data.subarray(start, start + span.bytes);
  return { width, height, level: chosen, rgba: decodeTexture(ref.format, bytes, width, height) };
}
