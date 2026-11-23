/*
 * Сырые блоки листов для сжатого пути мастерской (этап 2 «3D на Rust», шаг A1).
 *
 * Сегодня лист идёт так: читатель разбирает ресурс игры, раскодирует BCn в RGBA, жмёт в WebP, окно раскодирует WebP и заливает RGBA.
 * Здесь — чистые функции, которые вместо этого берут блоки BCn из файла игры как есть и складывают их в один контейнер
 * ASB1 на весь ответ (формат — `docs/perf/speed-3d-rust/asb1-format.md`). Окно читает контейнер `sheet-container.js` и
 * заливает блоки в видеокарту без раскодирования. Модуль ничего не читает с диска и не встроен в приложение: ему дают
 * ссылку на текстуру (`describeTexture` из `@modovik/rage-drawable`) и просят план и блоки.
 *
 * Только целочисленная арифметика и фиксированные правила выбора: ту же функцию позже пишут на Rust, и контейнеры обязаны
 * совпасть байт в байт.
 */

import { decodeBc7, decodeTexture, levelBytes } from "@modovik/dds";

/* ------------------------------------------------------------------ константы формата */

export const ASB1 = Object.freeze({
  MAGIC: 0x31425341, // «ASB1» little-endian
  VERSION: 1,
  HEADER_BYTES: 16,
  ENTRY_BYTES: 32,
  ALIGN: 16,
  STATUS: Object.freeze({ ok: 0, absent: 1, unavailable: 2 }),
  KIND: Object.freeze({ none: 0, bcn: 1, webp: 2, rgba: 3, webpLossless: 4 }),
  FORMAT: Object.freeze({ DXT1: 1, DXT3: 2, DXT5: 3, BC7: 4 }),
  FLAG_ALPHA: 1,
  FLAG_TAIL: 2,
  FLAG_CACHED: 4,
});

export const SHEET_LIMITS = Object.freeze({ maxLevels: 16, maxSide: 8192, tailSide: 4 });

const BLOCK_BYTES = Object.freeze({ DXT1: 8, DXT3: 16, DXT5: 16, BC7: 16 });

/** Причины отказа сжатому пути (короткие коды). */
export const SHEET_REFUSAL = Object.freeze({
  accept: "accept",
  map: "map",
  format: "format",
  incomplete: "incomplete",
  tooLarge: "too-large",
  notMultipleOf4: "not-multiple-of-4",
  shortChain: "short-chain",
});

const levelSide = (side, level) => Math.max(1, side >> level);
/* Полная цепочка: floor(log2(max)) + 1 без плавающей точки — 32 − clz32(max) (в Rust: 32 − leading_zeros). */
const fullLevels = (width, height) => 32 - Math.clz32(Math.max(width, height));
const blocksAlong = (side) => Math.max(1, (side + 3) >> 2);
const blocksOf = (width, height) => blocksAlong(width) * blocksAlong(height);

/* ------------------------------------------------------------------ план: годен ли лист и с какого уровня */

function acceptSet(accept) {
  if (!accept) return new Set();
  const list = accept instanceof Set ? [...accept] : Array.isArray(accept) ? accept : [];
  return new Set(list.map(String));
}

/**
 * Годен ли лист для сжатого пути и какие уровни отправлять. `ref` — как у `describeTexture`; `size` — запрошенная большая
 * сторона (выбор уровня как у `chooseLevel`: первый уровень, у которого большая сторона не больше `size`, иначе последний);
 * `accept` — имена форматов, которые умеет окно (пустой — отказ); `map` — карта нормалей или блеска («normal» / «specular»):
 * всегда отказ.
 */
export function sheetPlan(ref, { size, accept, map } = {}) {
  const refuse = (reason) => ({ ok: false, reason });
  const allowed = acceptSet(accept);
  if (allowed.size === 0) return refuse(SHEET_REFUSAL.accept);
  if (map) return refuse(SHEET_REFUSAL.map);
  if (!ref || !Object.hasOwn(BLOCK_BYTES, String(ref.format)) || !allowed.has(ref.format)) return refuse(SHEET_REFUSAL.format);
  if (!ref.complete) return refuse(SHEET_REFUSAL.incomplete);
  if (ref.levels > SHEET_LIMITS.maxLevels || ref.width > SHEET_LIMITS.maxSide || ref.height > SHEET_LIMITS.maxSide) return refuse(SHEET_REFUSAL.tooLarge);

  const last = ref.levels - 1;
  let firstLevel = 0;
  if (Number(size) > 0) {
    while (firstLevel < last && Math.max(ref.width >> firstLevel, ref.height >> firstLevel) > size) firstLevel += 1;
  }
  const width = levelSide(ref.width, firstLevel);
  const height = levelSide(ref.height, firstLevel);
  if (width % 4 !== 0 || height % 4 !== 0) return refuse(SHEET_REFUSAL.notMultipleOf4);

  /* Уровней в файле бывает больше, чем помещается до 1×1 (повторы 1×1): лишние не берём. */
  const levels = Math.min(ref.levels - firstLevel, fullLevels(width, height));
  const lastWidth = levelSide(width, levels - 1);
  const lastHeight = levelSide(height, levels - 1);
  if (Math.min(lastWidth, lastHeight) > SHEET_LIMITS.tailSide) return refuse(SHEET_REFUSAL.shortChain);
  return { ok: true, firstLevel, levels, width, height, format: ref.format };
}

/* ------------------------------------------------------------------ одноцветный блок */

/*
 * Таблицы концов DXT1 для одноцветного блока. Канал 8 бит → пара кодов (a, b) по 5 бит (красный, синий) или 6 бит (зелёный):
 * цвет концов — расширение кода до 8 бит E5(x) = (x << 3) | (x >> 2), E6(x) = (x << 2) | (x >> 4), индекс 2 даёт (2·E(a) + E(b)) / 3.
 * Видеокарты и разборщики округляют третью по-разному (вниз, до ближайшего, «+1» до ближайшего), поэтому из пары берётся та,
 * у которой хуже всех трёх округлений ошибка наименьшая:
 *   x = 2·E(a) + E(b); низ = x div 3; середина = (x + 1) div 3; верх = (x + 2) div 3 (низ ≤ середина ≤ верх);
 *   первое = наибольшая из |низ − v| и |верх − v|;  второе = |x − 3v|;  третье = |E(a) − E(b)|;  потом меньший a, потом меньший b.
 * Выбор минимален по этой четвёрке. Строится при загрузке модуля (≈ 1,3 млн сравнений).
 */
function buildPairTable(bits) {
  const count = 1 << bits;
  const expand = new Int32Array(count);
  for (let code = 0; code < count; code += 1) expand[code] = bits === 5 ? (code << 3) | (code >> 2) : (code << 2) | (code >> 4);
  const table = new Uint16Array(256);
  for (let target = 0; target < 256; target += 1) {
    let bestKey = Infinity;
    let bestPair = 0;
    for (let a = 0; a < count; a += 1) {
      for (let b = 0; b < count; b += 1) {
        const x = 2 * expand[a] + expand[b];
        const low = Math.floor(x / 3);
        const high = Math.floor((x + 2) / 3);
        const first = Math.max(Math.abs(low - target), Math.abs(high - target));
        const key = (((first * 1024 + Math.abs(x - 3 * target)) * 256 + Math.abs(expand[a] - expand[b])) * 4096) + a * count + b;
        if (key < bestKey) {
          bestKey = key;
          bestPair = (a << 6) | b;
        }
      }
    }
    table[target] = bestPair;
  }
  return table;
}

const PAIRS5 = buildPairTable(5);
const PAIRS6 = buildPairTable(6);

function dxt1ColorBlock(r, g, b) {
  const rp = PAIRS5[r];
  const gp = PAIRS6[g];
  const bp = PAIRS5[b];
  let c0 = ((rp >> 6) << 11) | ((gp >> 6) << 5) | (bp >> 6);
  let c1 = ((rp & 63) << 11) | ((gp & 63) << 5) | (bp & 63);
  let indices = 0xaaaaaaaa; // индекс 2 у всех шестнадцати пикселей: (2·c0 + c1) / 3
  if (c0 < c1) {
    const swap = c0;
    c0 = c1;
    c1 = swap;
    indices = 0xffffffff; // после обмена то же значение — индекс 3: (c0 + 2·c1) / 3
  } else if (c0 === c1) {
    indices = 0; // равные концы: индекс 0 — сам цвет
  }
  return [c0 & 255, c0 >> 8, c1 & 255, c1 >> 8, indices & 255, (indices >>> 8) & 255, (indices >>> 16) & 255, indices >>> 24];
}

/**
 * Блок BC7 режима 6 с равными концами. У канала 7 бит и общий для четырёх каналов p-бит конца (значение = код · 2 + p):
 * p берётся равным младшему биту альфы — альфа точна (непрозрачный лист остаётся непрозрачным), цвет — с ошибкой не больше 1.
 */
function bc7SolidBlock(r, g, b, a) {
  const p = a & 1;
  const block = new Uint8Array(16);
  let at = 0;
  const put = (value, count) => {
    for (let i = 0; i < count; i += 1) {
      if ((value >> i) & 1) block[at >> 3] |= 1 << (at & 7);
      at += 1;
    }
  };
  put(64, 7); // режим 6: шесть нулей и единица
  for (const channel of [r, g, b, a]) {
    put(channel >> 1, 7);
    put(channel >> 1, 7);
  }
  put(p, 1);
  put(p, 1);
  return block; // 63 бита индексов — нули
}

/**
 * Один блок, залитый одним цветом `[r, g, b, a]` (целые 0…255): DXT1 — цвет по таблице концов (альфа не кодируется: блок
 * всегда непрозрачный), DXT3 — альфа ближайшими четырьмя битами (k = (a + 8) div 17, байт k | k << 4), DXT5 — альфа обоими
 * концами, BC7 — режим 6 с равными концами.
 */
export function solidBlock(format, rgba) {
  const [r, g, b, a] = rgba;
  if (!Object.hasOwn(BLOCK_BYTES, format)) throw new TypeError(`Формат ${format} не поддерживается.`);
  if (format === "BC7") return bc7SolidBlock(r, g, b, a);
  const color = dxt1ColorBlock(r, g, b);
  if (format === "DXT1") return Uint8Array.from(color);
  const block = new Uint8Array(16);
  if (format === "DXT3") {
    const nibble = Math.floor((a + 8) / 17);
    block.fill(nibble | (nibble << 4), 0, 8);
  } else {
    block[0] = a;
    block[1] = a;
  }
  block.set(color, 8);
  return block;
}

/* ------------------------------------------------------------------ признак альфы */

/*
 * Есть ли у листа прозрачные или полупрозрачные пиксели. Смотрятся только блоки первого отправляемого уровня, целыми числами:
 *   DXT1  — блок с color0 ≤ color1 и хотя бы одним индексом 3 (прозрачный чёрный);
 *   DXT3  — любой байт альфы блока не равен 255 (какой-то ниббл < 15);
 *   DXT5  — палитра альфы блока (8 значений, промежуточные — ближайшее целое) и 48 бит индексов: есть пиксель со значением < 255;
 *   BC7   — блок режима 0…3 непрозрачен; блок режимов 4…7, у которого все концы альфы полные (255), непрозрачен; в режимах 4 и 5
 *           с поворотом каналов альфа блока — цветовой канал (1 — красный, 2 — зелёный, 3 — синий), блок непрозрачен, если оба
 *           конца этого канала полные; любой другой блок разбирается пакетом @modovik/dds и проверяется по альфе.
 */
function dxt1HasAlpha(data) {
  for (let at = 0; at + 8 <= data.length; at += 8) {
    const c0 = data[at] | (data[at + 1] << 8);
    const c1 = data[at + 2] | (data[at + 3] << 8);
    if (c0 > c1) continue;
    const word = data[at + 4] | (data[at + 5] << 8) | (data[at + 6] << 16) | (data[at + 7] << 24);
    if ((word & (word >>> 1) & 0x55555555) !== 0) return true;
  }
  return false;
}

function dxt3HasAlpha(data) {
  for (let at = 0; at + 16 <= data.length; at += 16) for (let i = 0; i < 8; i += 1) if (data[at + i] !== 255) return true;
  return false;
}

/** Палитра альфы DXT5 как у разборщика: промежуточные — ближайшее целое от дроби. */
function dxt5OpaqueMask(a0, a1) {
  let mask = (a0 === 255 ? 1 : 0) | (a1 === 255 ? 2 : 0);
  if (a0 > a1) {
    for (let i = 1; i < 7; i += 1) if (Math.floor((2 * ((7 - i) * a0 + i * a1) + 7) / 14) === 255) mask |= 1 << (i + 1);
  } else {
    for (let i = 1; i < 5; i += 1) if (Math.floor((2 * ((5 - i) * a0 + i * a1) + 5) / 10) === 255) mask |= 1 << (i + 1);
    mask |= 128; // индекс 7 — 255, индекс 6 — 0
  }
  return mask;
}

function dxt5HasAlpha(data) {
  for (let at = 0; at + 16 <= data.length; at += 16) {
    const mask = dxt5OpaqueMask(data[at], data[at + 1]);
    if (mask === 255) continue;
    for (let half = 0; half < 2; half += 1) {
      const base = at + 2 + half * 3;
      const bits = data[base] | (data[base + 1] << 8) | (data[base + 2] << 16);
      for (let texel = 0; texel < 8; texel += 1) if (((mask >> ((bits >> (texel * 3)) & 7)) & 1) === 0) return true;
    }
  }
  return false;
}

/** `count` бит блока с бита `from`, младшие вперёд (как раскладка BC7). */
function bitsOf(data, base, from, count) {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    const at = from + i;
    value |= ((data[base + (at >> 3)] >> (at & 7)) & 1) << i;
  }
  return value;
}

/** Блок BC7 наверняка непрозрачен по режиму и концам альфы (иначе его надо разбирать). */
function bc7BlockOpaque(data, at) {
  const lead = data[at];
  if (lead === 0) return false;
  const mode = 31 - Math.clz32(lead & -lead);
  if (mode <= 3) return true;
  if (mode === 4) {
    const rotation = bitsOf(data, at, 5, 2);
    if (rotation === 0) return bitsOf(data, at, 38, 6) === 63 && bitsOf(data, at, 44, 6) === 63;
    /* Поворот каналов: альфа блока — цветовой канал rotation − 1 (1 красный, 2 зелёный, 3 синий); концы канала по 5 бит с бита 8 + 10·канал. */
    const from = 8 + (rotation - 1) * 10;
    return bitsOf(data, at, from, 5) === 31 && bitsOf(data, at, from + 5, 5) === 31;
  }
  if (mode === 5) {
    const rotation = bitsOf(data, at, 6, 2);
    if (rotation === 0) return bitsOf(data, at, 50, 8) === 255 && bitsOf(data, at, 58, 8) === 255;
    /* То же для режима 5: концы канала по 7 бит с бита 8 + 14·канал. */
    const from = 8 + (rotation - 1) * 14;
    return bitsOf(data, at, from, 7) === 127 && bitsOf(data, at, from + 7, 7) === 127;
  }
  if (mode === 6) {
    return ((bitsOf(data, at, 49, 7) << 1) | bitsOf(data, at, 63, 1)) === 255 && ((bitsOf(data, at, 56, 7) << 1) | bitsOf(data, at, 64, 1)) === 255;
  }
  for (let point = 0; point < 4; point += 1) if (((bitsOf(data, at, 74 + point * 5, 5) << 1) | bitsOf(data, at, 94 + point, 1)) !== 63) return false;
  return true;
}

function bc7HasAlpha(data) {
  for (let at = 0; at + 16 <= data.length; at += 16) {
    if (bc7BlockOpaque(data, at)) continue;
    const pixels = decodeBc7(data.subarray(at, at + 16), 4, 4);
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return true;
  }
  return false;
}

const ALPHA_SCANS = Object.freeze({ DXT1: dxt1HasAlpha, DXT3: dxt3HasAlpha, DXT5: dxt5HasAlpha, BC7: bc7HasAlpha });

/** Есть ли альфа в блоках `data` формата `format` (один уровень). */
export function blocksHaveAlpha(format, data) {
  return ALPHA_SCANS[format](data);
}

/* ------------------------------------------------------------------ блоки листа */

/**
 * Блоки листа по плану `sheetPlan(...)` (`plan.ok` обязателен). Уровни игры — срезы ресурса байт в байт; если цепочка игры
 * кончается выше 1×1, хвост до 1×1 достраивается: каждый достроенный уровень залит одним блоком одного цвета — средним по
 * последнему уровню игры (каждый из четырёх каналов: s — сумма по пикселям, n — их число, значение = (2·s + n) div (2·n)).
 */
export function sheetBlocks(ref, plan) {
  if (!plan?.ok) throw new TypeError("sheetBlocks: нужен план с ok = true.");
  const { firstLevel, levels: gameLevels, width, height, format } = plan;
  const source = ref.resource.data;
  const sizes = [];
  const slices = [];
  for (let k = 0; k < gameLevels; k += 1) {
    const span = ref.spans[firstLevel + k];
    const start = ref.dataAt + span.offset;
    const w = levelSide(width, k);
    const h = levelSide(height, k);
    sizes.push({ width: w, height: h, bytes: span.bytes });
    slices.push(source.subarray(start, start + span.bytes));
  }

  const total = fullLevels(width, height);
  const synthesized = total - gameLevels;
  let tail = null;
  if (synthesized > 0) {
    const lastW = sizes[gameLevels - 1].width;
    const lastH = sizes[gameLevels - 1].height;
    const pixels = decodeTexture(format, slices[gameLevels - 1], lastW, lastH);
    const n = lastW * lastH;
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 4; c += 1) sums[c] += pixels[i + c];
    const average = sums.map((sum) => Math.floor((2 * sum + n) / (2 * n)));
    tail = solidBlock(format, average);
    for (let k = gameLevels; k < total; k += 1) {
      const w = levelSide(width, k);
      const h = levelSide(height, k);
      sizes.push({ width: w, height: h, bytes: blocksOf(w, h) * tail.length });
    }
  }

  const bytes = sizes.reduce((sum, level) => sum + level.bytes, 0);
  const data = new Uint8Array(bytes);
  let at = 0;
  for (const slice of slices) {
    data.set(slice, at);
    at += slice.length;
  }
  if (tail) {
    for (let k = gameLevels; k < total; k += 1) {
      for (let i = 0; i < blocksOf(sizes[k].width, sizes[k].height); i += 1) {
        data.set(tail, at);
        at += tail.length;
      }
    }
  }
  const alpha = blocksHaveAlpha(format, slices[0]);
  return { format, width, height, levels: sizes, data, alpha, synthesized, firstLevel, gameWidth: ref.width, gameHeight: ref.height, gameLevels };
}

/* ------------------------------------------------------------------ контейнер ASB1 */

const align = (value) => Math.ceil(value / ASB1.ALIGN) * ASB1.ALIGN;

function entryRecord(entry) {
  const empty = { status: ASB1.STATUS.ok, kind: ASB1.KIND.none, format: 0, levels: 0, width: 0, height: 0, gameWidth: 0, gameHeight: 0, firstLevel: 0, flags: 0, payload: null, synthesized: 0 };
  if (entry?.status === "absent") return { ...empty, status: ASB1.STATUS.absent };
  if (entry?.status === "unavailable") return { ...empty, status: ASB1.STATUS.unavailable };
  const cached = entry?.fromCache ? ASB1.FLAG_CACHED : 0;
  if (entry?.webp instanceof Uint8Array) {
    return { ...empty, kind: entry.lossless ? ASB1.KIND.webpLossless : ASB1.KIND.webp, width: entry.width | 0, height: entry.height | 0, flags: cached, payload: entry.webp };
  }
  if (entry?.rgba instanceof Uint8Array) {
    if (entry.rgba.length !== entry.width * entry.height * 4) throw new TypeError("packSheets: размер RGBA не сходится с шириной и высотой.");
    return { ...empty, kind: ASB1.KIND.rgba, width: entry.width, height: entry.height, flags: cached, payload: entry.rgba };
  }
  if (entry?.data instanceof Uint8Array && Object.hasOwn(ASB1.FORMAT, entry.format)) {
    const sum = entry.levels.reduce((acc, level, k) => {
      if (level.width !== levelSide(entry.width, k) || level.height !== levelSide(entry.height, k) || level.bytes !== levelBytes(entry.format, level.width, level.height)) {
        throw new TypeError(`packSheets: уровень ${k} не сходится с размерами и форматом.`);
      }
      return acc + level.bytes;
    }, 0);
    if (sum !== entry.data.length) throw new TypeError("packSheets: байты уровней не сходятся с данными.");
    if (entry.levels.length < 1 || entry.levels.length > SHEET_LIMITS.maxLevels) throw new TypeError("packSheets: число уровней вне 1…16.");
    const flags = (entry.alpha ? ASB1.FLAG_ALPHA : 0) | (entry.synthesized > 0 ? ASB1.FLAG_TAIL : 0) | cached;
    return {
      ...empty,
      kind: ASB1.KIND.bcn,
      format: ASB1.FORMAT[entry.format],
      levels: entry.levels.length,
      width: entry.width,
      height: entry.height,
      gameWidth: entry.gameWidth,
      gameHeight: entry.gameHeight,
      firstLevel: entry.firstLevel,
      flags,
      payload: entry.data,
      synthesized: entry.synthesized,
    };
  }
  throw new TypeError("packSheets: неизвестный вид записи.");
}

/** Контейнер ASB1: заголовок, по записи на лист, нагрузки с выравниванием на 16 нулями. */
export function packSheets(entries) {
  const records = Array.from(entries, entryRecord);
  const payloadStart = ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES * records.length;
  let end = 0;
  for (const record of records) {
    record.offset = record.payload ? end : 0;
    record.length = record.payload ? record.payload.length : 0;
    if (record.payload) end = align(end + record.length);
  }
  const out = new Uint8Array(payloadStart + end);
  const view = new DataView(out.buffer);
  view.setUint32(0, ASB1.MAGIC, true);
  view.setUint16(4, ASB1.VERSION, true);
  view.setUint16(6, ASB1.ENTRY_BYTES, true);
  view.setUint32(8, records.length, true);
  view.setUint32(12, payloadStart, true);
  records.forEach((record, index) => {
    const at = ASB1.HEADER_BYTES + index * ASB1.ENTRY_BYTES;
    view.setUint8(at, record.status);
    view.setUint8(at + 1, record.kind);
    view.setUint8(at + 2, record.format);
    view.setUint8(at + 3, record.levels);
    view.setUint16(at + 4, record.width, true);
    view.setUint16(at + 6, record.height, true);
    view.setUint16(at + 8, record.gameWidth, true);
    view.setUint16(at + 10, record.gameHeight, true);
    view.setUint8(at + 12, record.firstLevel);
    view.setUint8(at + 13, record.flags);
    view.setUint16(at + 14, 0, true);
    view.setUint32(at + 16, record.offset, true);
    view.setUint32(at + 20, record.length, true);
    view.setUint32(at + 24, record.synthesized, true);
    view.setUint32(at + 28, 0, true);
    if (record.payload) out.set(record.payload, payloadStart + record.offset);
  });
  return out;
}

/**
 * Обратное к `packSheets([entry])`: из байт файла кэша (контейнер ASB1 ровно с одной записью) достаёт запись в том виде, который принимает
 * `packSheets` — с `fromCache: true`, чтобы при сборке ответа в записи встал бит «из кэша». Блоки не копируются: `data`, `webp`, `rgba` —
 * виды на те же байты. Файл битый, чужой, оборванный, с другим числом записей, с отказом вместо листа или с рассогласованной нагрузкой —
 * `null` (вызывающий считает «нет в кэше» и удаляет файл), исключений нет.
 */
export function unpackSheet(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadStart = ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES;
  if (view.getUint32(0, true) !== ASB1.MAGIC || view.getUint16(4, true) !== ASB1.VERSION || view.getUint16(6, true) !== ASB1.ENTRY_BYTES) return null;
  if (view.getUint32(8, true) !== 1 || view.getUint32(12, true) !== payloadStart) return null;
  const at = ASB1.HEADER_BYTES;
  const [status, kind, formatCode, levelCount] = [view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)];
  const width = view.getUint16(at + 4, true);
  const height = view.getUint16(at + 6, true);
  const flags = view.getUint8(at + 13);
  const offset = view.getUint32(at + 16, true);
  const length = view.getUint32(at + 20, true);
  if (status !== ASB1.STATUS.ok || kind < ASB1.KIND.bcn || kind > ASB1.KIND.webpLossless || offset !== 0 || length === 0) return null;
  if (bytes.length !== payloadStart + align(length)) return null;
  const payload = bytes.subarray(payloadStart, payloadStart + length);
  if (kind === ASB1.KIND.webp || kind === ASB1.KIND.webpLossless) return { webp: payload, lossless: kind === ASB1.KIND.webpLossless, width, height, fromCache: true };
  if (kind === ASB1.KIND.rgba) return length === width * height * 4 ? { rgba: payload, width, height, fromCache: true } : null;
  const format = Object.keys(ASB1.FORMAT).find((name) => ASB1.FORMAT[name] === formatCode);
  const synthesized = view.getUint32(at + 24, true);
  if (!format || levelCount < 1 || levelCount > SHEET_LIMITS.maxLevels || synthesized > levelCount) return null;
  if (width < 4 || height < 4 || width > SHEET_LIMITS.maxSide || height > SHEET_LIMITS.maxSide || width % 4 !== 0 || height % 4 !== 0) return null;
  const levels = [];
  let sum = 0;
  for (let k = 0; k < levelCount; k += 1) {
    const level = { width: levelSide(width, k), height: levelSide(height, k) };
    level.bytes = levelBytes(format, level.width, level.height);
    sum += level.bytes;
    levels.push(level);
  }
  if (sum !== length) return null;
  return {
    format,
    width,
    height,
    levels,
    data: payload,
    alpha: (flags & ASB1.FLAG_ALPHA) !== 0,
    synthesized,
    firstLevel: view.getUint8(at + 12),
    gameWidth: view.getUint16(at + 8, true),
    gameHeight: view.getUint16(at + 10, true),
    fromCache: true,
  };
}

/*
 * Запись `index` контейнера-пачки (ответ команды движка: один контейнер на пачку) как контейнер с одной записью — те же байты, что дал бы
 * `packSheets([запись])` читателя JS: заголовок на одну запись, нагрузка с начала и нули до кратности 16. Остальное в записи (вид, формат, размеры, флаги,
 * число достроенных уровней) переносится как есть: бит «из кэша» остаётся, каким поставил его движок.
 *
 * `{ status: "ok" | "absent" | "unavailable", kind, flags, container }`; `container` — свой буфер (копия нагрузки), у записи без нагрузки — `null`.
 * `null` — пачка битая: не контейнер ASB1 версии 1, номера нет, нагрузка за пределами контейнера или не кратна 16, запись «ok» без нагрузки или с чужим видом.
 */
export function sheetFromBatch(bytes, index) {
  if (!(bytes instanceof Uint8Array) || bytes.length < ASB1.HEADER_BYTES || !Number.isInteger(index) || index < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ASB1.MAGIC || view.getUint16(4, true) !== ASB1.VERSION || view.getUint16(6, true) !== ASB1.ENTRY_BYTES) return null;
  const count = view.getUint32(8, true);
  const payloadStart = view.getUint32(12, true);
  const tableEnd = ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES * count;
  if (index >= count || tableEnd > bytes.length || payloadStart % ASB1.ALIGN !== 0 || payloadStart < tableEnd || payloadStart > bytes.length) return null;
  const at = ASB1.HEADER_BYTES + index * ASB1.ENTRY_BYTES;
  const status = view.getUint8(at);
  const kind = view.getUint8(at + 1);
  const flags = view.getUint8(at + 13);
  const offset = view.getUint32(at + 16, true);
  const length = view.getUint32(at + 20, true);
  if (status > ASB1.STATUS.unavailable || kind > ASB1.KIND.webpLossless) return null;
  const names = ["ok", "absent", "unavailable"];
  if (status !== ASB1.STATUS.ok) return length === 0 ? { status: names[status], kind, flags, container: null } : null;
  if (kind === ASB1.KIND.none || length === 0 || offset % ASB1.ALIGN !== 0 || payloadStart + offset + length > bytes.length) return null;
  const out = new Uint8Array(ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES + align(length));
  const own = new DataView(out.buffer);
  own.setUint32(0, ASB1.MAGIC, true);
  own.setUint16(4, ASB1.VERSION, true);
  own.setUint16(6, ASB1.ENTRY_BYTES, true);
  own.setUint32(8, 1, true);
  own.setUint32(12, ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES, true);
  out.set(bytes.subarray(at, at + ASB1.ENTRY_BYTES), ASB1.HEADER_BYTES);
  own.setUint32(ASB1.HEADER_BYTES + 16, 0, true);
  out.set(bytes.subarray(payloadStart + offset, payloadStart + offset + length), ASB1.HEADER_BYTES + ASB1.ENTRY_BYTES);
  return { status: "ok", kind, flags, container: out };
}
