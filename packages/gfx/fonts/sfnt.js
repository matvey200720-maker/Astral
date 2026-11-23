/*
 * Чтение файла шрифта: TrueType (`glyf`), OpenType с CFF (`OTTO`),
 * коллекция (`ttcf`, берётся первый шрифт) и WOFF 1.0 (таблицы под zlib).
 * WOFF2 не читается: его таблицы сжаты Brotli с пересборкой `glyf` — такой
 * шрифт человек пересохраняет в TTF.
 *
 * Ответ — шрифт для «Шрифтов» мастерской: метрики, номер глифа по символу,
 * ширина, контуры (точки TrueType: `{ x, y, on }`, ось Y вверх, единицы
 * шрифта) и кернинг (GPOS, иначе таблица `kern`). Чтение — только нужное,
 * без зависимостей: тот же модуль у окна (предпросмотр) и установщика.
 */

import { unzlibSync } from "fflate";
import { readCff } from "./cff.js";

const tagOf = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/* Таблицы шрифта: тег → `{ bytes, view }` (у WOFF — уже распакованные). */
function tablesOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = tagOf(view, 0);
  const tables = new Map();
  const slice = (start, length) => {
    if (start < 0 || start + length > bytes.length) throw new Error("Шрифт обрезан: таблица выходит за конец файла.");
    return bytes.subarray(start, start + length);
  };
  if (signature === "wOFF") {
    const flavor = view.getUint32(4);
    const count = view.getUint16(12);
    for (let index = 0; index < count; index += 1) {
      const at = 44 + index * 20;
      const tag = tagOf(view, at);
      const offset = view.getUint32(at + 4);
      const compressed = view.getUint32(at + 8);
      const original = view.getUint32(at + 12);
      const raw = slice(offset, compressed);
      const data = compressed < original ? unzlibSync(raw) : raw;
      if (data.length !== original) throw new Error(`Шрифт WOFF: таблица ${tag} распаковалась не той длины.`);
      tables.set(tag, data);
    }
    return { tables, cff: flavor === 0x4f54544f };
  }
  if (signature === "wOF2") throw new Error("WOFF2 не читается — пересохраните шрифт в TTF или OTF.");
  let start = 0;
  if (signature === "ttcf") {
    if (view.getUint32(8) < 1) throw new Error("Коллекция шрифтов пуста.");
    start = view.getUint32(12);
  }
  const version = view.getUint32(start);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(version)) throw new Error("Это не шрифт TTF, OTF, TTC или WOFF.");
  const count = view.getUint16(start + 4);
  for (let index = 0; index < count; index += 1) {
    const at = start + 12 + index * 16;
    tables.set(tagOf(view, at), slice(view.getUint32(at + 8), view.getUint32(at + 12)));
  }
  return { tables, cff: version === 0x4f54544f };
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/* Символ → номер глифа: формат 12 (весь Юникод) или 4 (BMP). */
function readCmap(bytes) {
  const view = viewOf(bytes);
  const count = view.getUint16(2);
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const at = 4 + index * 8;
    records.push({ platform: view.getUint16(at), encoding: view.getUint16(at + 2), offset: view.getUint32(at + 4) });
  }
  const rank = (record) => {
    const format = view.getUint16(record.offset);
    if (record.platform === 3 && record.encoding === 10 && format === 12) return 0;
    if (record.platform === 0 && format === 12) return 1;
    if (record.platform === 3 && record.encoding === 1 && format === 4) return 2;
    if (record.platform === 0 && format === 4) return 3;
    return 9;
  };
  const best = records.filter((record) => rank(record) < 9).sort((a, b) => rank(a) - rank(b))[0];
  const map = new Map();
  if (!best) return map;
  const at = best.offset;
  const format = view.getUint16(at);
  if (format === 12) {
    const groups = view.getUint32(at + 12);
    for (let group = 0; group < groups; group += 1) {
      const g = at + 16 + group * 12;
      const first = view.getUint32(g);
      const last = view.getUint32(g + 4);
      const glyph = view.getUint32(g + 8);
      for (let code = first; code <= last && code <= 0x10ffff; code += 1) map.set(code, glyph + code - first);
    }
    return map;
  }
  const segments = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment += 1) {
    const end = view.getUint16(ends + segment * 2);
    const startCode = view.getUint16(starts + segment * 2);
    const delta = view.getInt16(deltas + segment * 2);
    const rangeAt = ranges + segment * 2;
    const rangeOffset = view.getUint16(rangeAt);
    for (let code = startCode; code <= end && code !== 0xffff; code += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const where = rangeAt + rangeOffset + (code - startCode) * 2;
        if (where + 2 > bytes.length) continue;
        glyph = view.getUint16(where);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) map.set(code, glyph);
    }
  }
  return map;
}

/* Название шрифта: семейство (16 или 1) и начертание (17 или 2). */
function readNames(bytes) {
  if (!bytes) return { family: "", subfamily: "" };
  const view = viewOf(bytes);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const found = {};
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = storage + view.getUint16(at + 10);
    if (![1, 2, 16, 17].includes(id) || offset + length > bytes.length) continue;
    let text = "";
    if (platform === 3 || platform === 0) {
      for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(view.getUint16(offset + k));
    } else if (platform === 1 && encoding === 0) {
      for (let k = 0; k < length; k += 1) text += String.fromCharCode(bytes[offset + k]);
    } else continue;
    /* Английское имя Windows — первым, остальные — если его нет. */
    const score = platform === 3 && language === 0x409 ? 0 : platform === 3 ? 1 : 2;
    if (!found[id] || score < found[id].score) found[id] = { text, score };
  }
  const pick = (a, b) => (found[a] || found[b])?.text?.trim() || "";
  return { family: pick(16, 1), subfamily: pick(17, 2) };
}

/* Простой глиф TrueType: контуры точками. */
function simpleGlyph(view, at, contours) {
  const ends = [];
  for (let index = 0; index < contours; index += 1) ends.push(view.getUint16(at + 10 + index * 2));
  const total = contours ? ends[contours - 1] + 1 : 0;
  let pos = at + 10 + contours * 2;
  pos += 2 + view.getUint16(pos);
  const flags = new Uint8Array(total);
  for (let index = 0; index < total; ) {
    const flag = view.getUint8(pos++);
    flags[index++] = flag;
    if (flag & 8) {
      let repeat = view.getUint8(pos++);
      while (repeat-- > 0 && index < total) flags[index++] = flag;
    }
  }
  const xs = new Int32Array(total);
  const ys = new Int32Array(total);
  let value = 0;
  for (let index = 0; index < total; index += 1) {
    const flag = flags[index];
    if (flag & 2) value += (flag & 16 ? 1 : -1) * view.getUint8(pos++);
    else if (!(flag & 16)) {
      value += view.getInt16(pos);
      pos += 2;
    }
    xs[index] = value;
  }
  value = 0;
  for (let index = 0; index < total; index += 1) {
    const flag = flags[index];
    if (flag & 4) value += (flag & 32 ? 1 : -1) * view.getUint8(pos++);
    else if (!(flag & 32)) {
      value += view.getInt16(pos);
      pos += 2;
    }
    ys[index] = value;
  }
  const out = [];
  let first = 0;
  for (const end of ends) {
    const contour = [];
    for (let index = first; index <= end; index += 1) contour.push({ x: xs[index], y: ys[index], on: Boolean(flags[index] & 1) });
    if (contour.length) out.push(contour);
    first = end + 1;
  }
  return out;
}

const F2DOT14 = (view, at) => view.getInt16(at) / 16384;

/**
 * Шрифт из байт файла. Бросает словами, если формат не тот или файл битый.
 */
export function readFontFile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { tables, cff } = tablesOf(bytes);
  const need = (tag) => {
    const table = tables.get(tag);
    if (!table) throw new Error(`В шрифте нет таблицы ${tag}.`);
    return table;
  };
  const head = viewOf(need("head"));
  const hhea = viewOf(need("hhea"));
  const maxp = viewOf(need("maxp"));
  const unitsPerEm = head.getUint16(18) || 1000;
  const longLoca = head.getInt16(50) === 1;
  const numGlyphs = maxp.getUint16(4);
  const metricCount = hhea.getUint16(34);
  const hmtx = viewOf(need("hmtx"));
  const advanceOf = (glyph) => hmtx.getUint16(Math.min(glyph, metricCount - 1) * 4);
  const cmap = readCmap(need("cmap"));
  const names = readNames(tables.get("name"));
  const os2Bytes = tables.get("OS/2");
  const os2 = os2Bytes ? viewOf(os2Bytes) : null;
  const os2Version = os2 ? os2.getUint16(0) : -1;
  const metrics = {
    ascender: os2 ? os2.getInt16(68) : hhea.getInt16(4),
    descender: os2 ? os2.getInt16(70) : hhea.getInt16(6),
    lineGap: os2 ? os2.getInt16(72) : hhea.getInt16(8),
    capHeight: os2 && os2Version >= 2 && os2Bytes.length >= 90 ? os2.getInt16(88) : 0,
    xHeight: os2 && os2Version >= 2 && os2Bytes.length >= 88 ? os2.getInt16(86) : 0,
    weightClass: os2 ? os2.getUint16(4) : 400,
  };

  let outlineOf;
  if (cff) {
    const font = readCff(need("CFF "));
    outlineOf = (glyph) => font.outline(glyph);
  } else {
    const loca = viewOf(need("loca"));
    const glyfBytes = need("glyf");
    const glyf = viewOf(glyfBytes);
    const span = (glyph) => {
      const start = longLoca ? loca.getUint32(glyph * 4) : loca.getUint16(glyph * 2) * 2;
      const end = longLoca ? loca.getUint32(glyph * 4 + 4) : loca.getUint16(glyph * 2 + 2) * 2;
      return { start, end };
    };
    const cache = new Map();
    const read = (glyph, depth = 0) => {
      if (glyph < 0 || glyph >= numGlyphs || depth > 8) return [];
      if (cache.has(glyph)) return cache.get(glyph);
      const { start, end } = span(glyph);
      let contours = [];
      if (end > start && end <= glyfBytes.length) {
        const count = glyf.getInt16(start);
        if (count >= 0) contours = simpleGlyph(glyf, start, count);
        else {
          /* Составной глиф: детали со сдвигом и матрицей. */
          let pos = start + 10;
          for (;;) {
            const flags = glyf.getUint16(pos);
            const part = glyf.getUint16(pos + 2);
            pos += 4;
            let dx;
            let dy;
            if (flags & 1) {
              dx = glyf.getInt16(pos);
              dy = glyf.getInt16(pos + 2);
              pos += 4;
            } else {
              dx = glyf.getInt8(pos);
              dy = glyf.getInt8(pos + 1);
              pos += 2;
            }
            let [a, b, c, d] = [1, 0, 0, 1];
            if (flags & 8) {
              a = d = F2DOT14(glyf, pos);
              pos += 2;
            } else if (flags & 0x40) {
              a = F2DOT14(glyf, pos);
              d = F2DOT14(glyf, pos + 2);
              pos += 4;
            } else if (flags & 0x80) {
              a = F2DOT14(glyf, pos);
              b = F2DOT14(glyf, pos + 2);
              c = F2DOT14(glyf, pos + 4);
              d = F2DOT14(glyf, pos + 6);
              pos += 8;
            }
            /* Сдвиг точками опоры (ARGS_ARE_XY_VALUES снят) — редкость; без сдвига. */
            if (!(flags & 2)) dx = dy = 0;
            for (const contour of read(part, depth + 1))
              contours.push(contour.map((point) => ({ x: Math.round(a * point.x + c * point.y + dx), y: Math.round(b * point.x + d * point.y + dy), on: point.on })));
            if (!(flags & 0x20)) break;
          }
        }
      }
      cache.set(glyph, contours);
      return contours;
    };
    outlineOf = (glyph) => read(glyph);
  }

  /* Кернинг из `kern` (формат 0): пара номеров глифов → поправка. */
  const kerning = new Map();
  const kern = tables.get("kern");
  if (kern && kern.length >= 4) {
    const view = viewOf(kern);
    if (view.getUint16(0) === 0) {
      let pos = 4;
      for (let table = 0; table < view.getUint16(2) && pos + 6 <= kern.length; table += 1) {
        const length = view.getUint16(pos + 2);
        const coverage = view.getUint16(pos + 4);
        if (coverage >> 8 === 0 && coverage & 1) {
          const pairs = view.getUint16(pos + 6);
          for (let pair = 0; pair < pairs; pair += 1) {
            const at = pos + 14 + pair * 6;
            if (at + 6 > kern.length) break;
            kerning.set(view.getUint16(at) * 65536 + view.getUint16(at + 2), view.getInt16(at + 4));
          }
        }
        pos += length;
      }
    }
  }

  /* Кернинг современных шрифтов живёт в GPOS (Segoe UI, Bahnschrift): он
     главнее таблицы `kern`, как у любого движка вёрстки OpenType. */
  const gpos = tables.get("GPOS") ? readGposKerning(tables.get("GPOS")) : null;
  const kerningOf = gpos || ((left, right) => kerning.get(left * 65536 + right) || 0);

  const glyphOf = (code) => cmap.get(code) || 0;
  /* Высота заглавных: из OS/2, иначе по букве H. */
  if (!metrics.capHeight) {
    const contours = outlineOf(glyphOf(0x48));
    let top = 0;
    for (const contour of contours) for (const point of contour) top = Math.max(top, point.y);
    metrics.capHeight = top || Math.round(unitsPerEm * 0.7);
  }
  return {
    family: names.family,
    subfamily: names.subfamily,
    format: cff ? "otf" : "ttf",
    unitsPerEm,
    numGlyphs,
    ...metrics,
    codes: () => [...cmap.keys()],
    glyphOf,
    advance: (glyph) => advanceOf(glyph),
    outline: (glyph) => outlineOf(glyph),
    kerning: kerningOf,
  };
}

/* ------------------------------------------------------------------ *
 * GPOS: парный кернинг (`kern`, поиск типа 2 и он же внутри расширения 9)
 * ------------------------------------------------------------------ */

/* Покрытие: глиф → номер в списке. */
function readCoverage(view, at) {
  const map = new Map();
  const format = view.getUint16(at);
  const count = view.getUint16(at + 2);
  if (format === 1) for (let k = 0; k < count; k += 1) map.set(view.getUint16(at + 4 + k * 2), k);
  else if (format === 2)
    for (let k = 0; k < count; k += 1) {
      const record = at + 4 + k * 6;
      const first = view.getUint16(record);
      const last = view.getUint16(record + 2);
      const start = view.getUint16(record + 4);
      for (let glyph = first; glyph <= last; glyph += 1) map.set(glyph, start + glyph - first);
    }
  return map;
}

/* Классы глифов: глиф → класс (нет в списке — класс 0). */
function readClassDef(view, at) {
  const map = new Map();
  const format = view.getUint16(at);
  if (format === 1) {
    const first = view.getUint16(at + 2);
    const count = view.getUint16(at + 4);
    for (let k = 0; k < count; k += 1) map.set(first + k, view.getUint16(at + 6 + k * 2));
  } else if (format === 2) {
    const count = view.getUint16(at + 2);
    for (let k = 0; k < count; k += 1) {
      const record = at + 4 + k * 6;
      const cls = view.getUint16(record + 4);
      for (let glyph = view.getUint16(record); glyph <= view.getUint16(record + 2); glyph += 1) map.set(glyph, cls);
    }
  }
  return map;
}

/* Длина записи значения и смещение XAdvance в ней (или −1). */
function valueLayout(format) {
  let size = 0;
  let advance = -1;
  for (let bit = 0; bit < 8; bit += 1) {
    if (!(format & (1 << bit))) continue;
    if (bit === 2) advance = size;
    size += 2;
  }
  return { size, advance };
}

/* Подтаблица парного кернинга → `(left, right) => поправка | undefined`. */
function pairSubtable(view, at) {
  const format = view.getUint16(at);
  const coverage = readCoverage(view, at + view.getUint16(at + 2));
  const first = valueLayout(view.getUint16(at + 4));
  const second = valueLayout(view.getUint16(at + 6));
  if (format === 1) {
    const sets = view.getUint16(at + 8);
    const cache = new Map();
    return (left, right) => {
      const index = coverage.get(left);
      if (index === undefined || index >= sets) return undefined;
      let pairs = cache.get(index);
      if (!pairs) {
        pairs = new Map();
        const set = at + view.getUint16(at + 10 + index * 2);
        const count = view.getUint16(set);
        const step = 2 + first.size + second.size;
        for (let k = 0; k < count; k += 1) {
          const record = set + 2 + k * step;
          pairs.set(view.getUint16(record), first.advance < 0 ? 0 : view.getInt16(record + 2 + first.advance));
        }
        cache.set(index, pairs);
      }
      return pairs.get(right);
    };
  }
  if (format === 2) {
    const classes1 = readClassDef(view, at + view.getUint16(at + 8));
    const classes2 = readClassDef(view, at + view.getUint16(at + 10));
    const count1 = view.getUint16(at + 12);
    const count2 = view.getUint16(at + 14);
    const step = first.size + second.size;
    return (left, right) => {
      if (!coverage.has(left)) return undefined;
      const class1 = classes1.get(left) || 0;
      const class2 = classes2.get(right) || 0;
      if (class1 >= count1 || class2 >= count2 || first.advance < 0) return 0;
      return view.getInt16(at + 16 + (class1 * count2 + class2) * step + first.advance);
    };
  }
  return () => undefined;
}

/** Кернинг из GPOS: `(left, right) => поправка` или `null`, если его там нет. */
function readGposKerning(bytes) {
  try {
    const view = viewOf(bytes);
    const features = view.getUint16(6);
    const lookups = view.getUint16(8);
    const lookupIndices = new Set();
    for (let k = 0; k < view.getUint16(features); k += 1) {
      const record = features + 2 + k * 6;
      if (tagOf(view, record) !== "kern") continue;
      const feature = features + view.getUint16(record + 4);
      for (let n = 0; n < view.getUint16(feature + 2); n += 1) lookupIndices.add(view.getUint16(feature + 4 + n * 2));
    }
    const groups = [];
    for (const index of [...lookupIndices].sort((a, b) => a - b)) {
      if (index >= view.getUint16(lookups)) continue;
      const lookup = lookups + view.getUint16(lookups + 2 + index * 2);
      const type = view.getUint16(lookup);
      const subtables = [];
      for (let n = 0; n < view.getUint16(lookup + 4); n += 1) {
        let at = lookup + view.getUint16(lookup + 6 + n * 2);
        let kind = type;
        if (type === 9) {
          kind = view.getUint16(at + 2);
          at += view.getUint32(at + 4);
        }
        if (kind === 2) subtables.push(pairSubtable(view, at));
      }
      if (subtables.length) groups.push(subtables);
    }
    if (!groups.length) return null;
    /* В одном поиске действует первая подходящая подтаблица; поиски складываются. */
    return (left, right) => {
      let total = 0;
      for (const subtables of groups)
        for (const subtable of subtables) {
          const value = subtable(left, right);
          if (value !== undefined) {
            total += value;
            break;
          }
        }
      return total;
    };
  } catch {
    return null;
  }
}
