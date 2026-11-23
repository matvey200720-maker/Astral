/*
 * Шрифты в библиотеке Scaleform игры (`font_lib_efigs_pc.gfx`,
 * `font_lib_efigs.gfx`): какие шрифты в файле, под какими именами их
 * отдаёт экспорт (`$Font2`, `$Font2_cond`, `$gtaCash`, `$Font5` — те же
 * имена, что в `fontmap.xml`), и замена записей шрифтов. Номер шрифта и
 * имя остаются прежними, поэтому все ссылки игры на шрифт целы; меняются
 * глифы, ширины, кернинг и интерлиньяж.
 */

import { readCompactedFont } from "./compacted.js";

const COMPACTED_FONT = 1005;
const EXPORT_ASSETS = 56;

function uncompressed(bytes) {
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  if (signature === "GFX" || signature === "FWS") return bytes;
  throw new Error(signature === "CFX" || signature === "CWS" ? "Сжатая библиотека шрифтов — распакуйте её перед правкой." : "Файл не похож на библиотеку шрифтов Scaleform.");
}

/* Начало тегов: после заголовка, рамки кадра, частоты и числа кадров. */
function tagsStart(bytes) {
  const bits = bytes[8] >> 3;
  return 8 + Math.ceil((5 + bits * 4) / 8) + 4;
}

function readTags(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags = [];
  for (let at = tagsStart(bytes); at + 2 <= bytes.length; ) {
    const raw = view.getUint16(at, true);
    const code = raw >> 6;
    let length = raw & 63;
    let header = 2;
    if (length === 63) {
      length = view.getUint32(at + 2, true);
      header = 6;
    }
    tags.push({ code, at, start: at + header, end: at + header + length });
    at += header + length;
    if (code === 0) break;
  }
  return tags;
}

/** Шрифты библиотеки: `[{ id, name, exports: [имя], font }]` (`font` — `readCompactedFont`). */
export function listGfxFonts(input) {
  const bytes = uncompressed(input instanceof Uint8Array ? input : new Uint8Array(input));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags = readTags(bytes);
  const exportsOf = new Map();
  for (const tag of tags.filter((item) => item.code === EXPORT_ASSETS)) {
    let at = tag.start;
    const count = view.getUint16(at, true);
    at += 2;
    for (let k = 0; k < count && at < tag.end; k += 1) {
      const id = view.getUint16(at, true);
      at += 2;
      let end = at;
      while (end < tag.end && bytes[end] !== 0) end += 1;
      const name = new TextDecoder().decode(bytes.subarray(at, end));
      at = end + 1;
      if (!exportsOf.has(id)) exportsOf.set(id, []);
      exportsOf.get(id).push(name);
    }
  }
  return tags
    .filter((tag) => tag.code === COMPACTED_FONT)
    .map((tag) => {
      const font = readCompactedFont(bytes.subarray(tag.start, tag.end));
      return { id: font.id, name: font.name, exports: exportsOf.get(font.id) || [], font };
    });
}

/**
 * Библиотека с новыми записями шрифтов: `replacements` — `Map` номер
 * шрифта → тело тега 1005 (`encodeCompactedFont`). Остальные теги — байт в
 * байт, длина файла в заголовке — новая.
 */
export function replaceGfxFonts(input, replacements) {
  const bytes = uncompressed(input instanceof Uint8Array ? input : new Uint8Array(input));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags = readTags(bytes);
  const parts = [bytes.subarray(0, tagsStart(bytes))];
  const left = new Map(replacements);
  for (const tag of tags) {
    const id = tag.code === COMPACTED_FONT ? view.getUint16(tag.start, true) : -1;
    if (!left.has(id)) {
      parts.push(bytes.subarray(tag.at, tag.end));
      continue;
    }
    const body = left.get(id);
    left.delete(id);
    const header = new Uint8Array(6);
    const headerView = new DataView(header.buffer);
    headerView.setUint16(0, (COMPACTED_FONT << 6) | 63, true);
    headerView.setUint32(2, body.length, true);
    parts.push(header, body);
  }
  if (left.size) throw new Error(`В библиотеке нет шрифтов с номерами ${[...left.keys()].join(", ")}.`);
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  new DataView(out.buffer).setUint32(4, size, true);
  return out;
}
