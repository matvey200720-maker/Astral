/*
 * Текстовое поле Scaleform (`DefineEditText`) и шрифты, которые подключает
 * фильм (25.10.2026, превью мини-карты «как в игре»).
 *
 * Поле — это рамка, в которую игра пишет текст: положение, кегль, цвет,
 * выравнивание и шрифт лежат в файле, а число или слово кладёт код. Рисовальщик
 * кадра (`render.js`) текст не рисует; здесь поле только читается, чтобы
 * превью поставило надпись туда, где её поставит игра.
 *
 * Шрифт в поле — номер, а имя шрифта игры (`$Font2_cond`) стоит в тегах
 * импорта `gfxfontlib.swf`: без них не сказать, найдёт ли игра этот шрифт.
 */

import { SwfReader } from "./bits.js";
import { TAG, TWIPS } from "./file.js";

/** Теги импорта символов из другого фильма (`ImportAssets`, `ImportAssets2`). */
const IMPORT_TAGS = new Set([57, TAG.IMPORT_ASSETS2]);

/** Выравнивание текста в поле (`TextLayout.align`). */
export const EDIT_TEXT_ALIGN = Object.freeze({
  0: "left",
  1: "right",
  2: "center",
  3: "justify",
});

/**
 * Поле по тегу определения:
 * `{ id, bounds: {xmin, ymin, xmax, ymax} в точках, fontId, fontClass,
 *   size (точки или null), color: [r, g, b, a] или null, align, readOnly,
 *   initialText }`.
 */
export function readEditText(bytes, tag) {
  const reader = new SwfReader(bytes, tag.start, tag.end);
  const id = reader.u16();
  const rect = reader.rect();
  const flags = reader.u8();
  const flags2 = reader.u8();
  const field = {
    id,
    bounds: {
      xmin: rect.xmin / TWIPS,
      ymin: rect.ymin / TWIPS,
      xmax: rect.xmax / TWIPS,
      ymax: rect.ymax / TWIPS,
    },
    fontId: null,
    fontClass: "",
    size: null,
    color: null,
    align: "left",
    readOnly: Boolean(flags & 0x08),
    initialText: "",
  };
  if (flags & 0x01) field.fontId = reader.u16();
  if (flags2 & 0x80) field.fontClass = reader.string();
  if (flags & 0x01 || flags2 & 0x80) field.size = reader.u16() / TWIPS;
  if (flags & 0x04)
    field.color = [reader.u8(), reader.u8(), reader.u8(), reader.u8()];
  if (flags & 0x02) reader.u16(); // предел длины
  if (flags2 & 0x20) {
    field.align = EDIT_TEXT_ALIGN[reader.u8()] || "left";
    reader.u16(); // левое поле
    reader.u16(); // правое поле
    reader.u16(); // отступ
    reader.u16(); // межстрочный
  }
  reader.string(); // имя переменной
  if (flags & 0x80) field.initialText = reader.string();
  return field;
}

/**
 * Имена символов, которые фильм берёт из других файлов: Map номер → имя.
 * Для `gfxfontlib.swf` это шрифты (`33` → `$Font2_cond`).
 */
export function importedNames(gfx) {
  const names = new Map();
  for (const tag of gfx.tags) {
    if (!IMPORT_TAGS.has(tag.code)) continue;
    try {
      const reader = new SwfReader(gfx.bytes, tag.start, tag.end);
      reader.string(); // откуда
      if (tag.code === TAG.IMPORT_ASSETS2) {
        reader.u8();
        reader.u8();
      }
      const count = reader.u16();
      for (let index = 0; index < count; index += 1) {
        const id = reader.u16();
        const name = reader.string();
        if (!names.has(id)) names.set(id, name);
      }
    } catch {
      /* битый тег импорта — без него */
    }
  }
  return names;
}
