/*
 * Разбор контейнера ASB1 в окне (этап 2 «3D на Rust», шаг A1): ответ читателя листов одним буфером → массив листов по порядку запроса.
 * Формат — `docs/perf/speed-3d-rust/asb1-format.md`. Модуль чистый: ни three, ни DOM; видеокарте отдаётся `mipmaps`
 * (тот же вид, что ждёт `THREE.CompressedTexture`: `{ data, width, height }` от большого уровня к малому).
 *
 * Нагрузку каждого листа копируем (`slice`), а не держим видом на общий буфер ответа: один живой лист иначе удерживал бы
 * весь ответ (десятки мегабайт) до своего конца.
 */

const MAGIC = 0x31425341;
const VERSION = 1;
const HEADER_BYTES = 16;
const ENTRY_BYTES = 32;
const ALIGN = 16;
const MAX_LEVELS = 16;
const MAX_SIDE = 8192;

const STATUS = ["ok", "absent", "unavailable"];
const KIND = ["none", "bcn", "webp", "rgba", "webp-lossless"];
/* Код формата → имя и размер блока. */
const FORMATS = [null, { name: "DXT1", block: 8 }, { name: "DXT3", block: 16 }, { name: "DXT5", block: 16 }, { name: "BC7", block: 16 }];

export const SHEET_FLAGS = Object.freeze({ alpha: 1, tail: 2, cached: 4 });

function broken(code, message) {
  return Object.assign(new Error(`Контейнер листов (ASB1) повреждён: ${message}`), { code });
}

const blocksAlong = (side) => Math.max(1, (side + 3) >> 2);

/** Контейнер ли это: первые четыре байта — «ASB1». Ответ читателя на запись с блоками — контейнер, остальное (старый читатель, запись без блоков) — обычный WebP. */
export function isSheetContainer(buffer) {
  if (!buffer || !(buffer.byteLength >= 4)) return false;
  const head = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, 4) : new Uint8Array(buffer, 0, 4);
  return head[0] === 0x41 && head[1] === 0x53 && head[2] === 0x42 && head[3] === 0x31;
}
/* Копия среза в своей памяти (у Buffer `slice` — вид, поэтому через конструктор). */
const copyOf = (bytes, from, to) => new Uint8Array(bytes.subarray(from, to));

/**
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {Array<{ status: "ok"|"absent"|"unavailable", kind: "none"|"bcn"|"webp"|"rgba"|"webp-lossless", format: string|null,
 *   width: number, height: number, gameWidth: number, gameHeight: number, firstLevel: number, alpha: boolean, tail: boolean,
 *   cached: boolean, synthesized: number, mipmaps?: Array<{ data: Uint8Array, width: number, height: number }>, bytes?: Uint8Array }>}
 * @throws {Error} с полем `code`: ASB1_TOO_SHORT, ASB1_BAD_MAGIC, ASB1_BAD_VERSION, ASB1_BAD_LAYOUT, ASB1_BAD_ENTRY, ASB1_OUT_OF_RANGE, ASB1_LENGTH_MISMATCH
 */
export function parseSheets(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer || 0);
  if (bytes.length < HEADER_BYTES) throw broken("ASB1_TOO_SHORT", `короче заголовка (${bytes.length} байт).`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw broken("ASB1_BAD_MAGIC", "не ASB1 (другая сигнатура).");
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw broken("ASB1_BAD_VERSION", `версия ${version}, разбирается ${VERSION}.`);
  const entrySize = view.getUint16(6, true);
  const count = view.getUint32(8, true);
  const payloadStart = view.getUint32(12, true);
  if (entrySize !== ENTRY_BYTES) throw broken("ASB1_BAD_LAYOUT", `размер записи ${entrySize}, ждали ${ENTRY_BYTES}.`);
  const tableEnd = HEADER_BYTES + ENTRY_BYTES * count;
  if (!Number.isSafeInteger(tableEnd) || tableEnd > bytes.length) throw broken("ASB1_TOO_SHORT", `таблица из ${count} записей не помещается в ${bytes.length} байт.`);
  if (payloadStart % ALIGN !== 0 || payloadStart < tableEnd || payloadStart > bytes.length) throw broken("ASB1_BAD_LAYOUT", `начало нагрузки ${payloadStart} вне ${tableEnd}…${bytes.length} или не кратно ${ALIGN}.`);
  const payloadBytes = bytes.length - payloadStart;

  const sheets = [];
  for (let index = 0; index < count; index += 1) {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    const statusCode = view.getUint8(at);
    const kindCode = view.getUint8(at + 1);
    const formatCode = view.getUint8(at + 2);
    const levels = view.getUint8(at + 3);
    const width = view.getUint16(at + 4, true);
    const height = view.getUint16(at + 6, true);
    const flags = view.getUint8(at + 13);
    const offset = view.getUint32(at + 16, true);
    const length = view.getUint32(at + 20, true);
    const where = `запись ${index}`;
    if (statusCode >= STATUS.length || kindCode >= KIND.length) throw broken("ASB1_BAD_ENTRY", `${where}: статус ${statusCode} или вид ${kindCode} неизвестен.`);
    if (offset + length > payloadBytes) throw broken("ASB1_OUT_OF_RANGE", `${where}: нагрузка ${offset}+${length} выходит за ${payloadBytes} байт.`);
    if (length > 0 && offset % ALIGN !== 0) throw broken("ASB1_BAD_ENTRY", `${where}: смещение ${offset} не кратно ${ALIGN}.`);
    const sheet = {
      status: STATUS[statusCode],
      kind: KIND[kindCode],
      format: null,
      width,
      height,
      gameWidth: view.getUint16(at + 8, true),
      gameHeight: view.getUint16(at + 10, true),
      firstLevel: view.getUint8(at + 12),
      alpha: (flags & SHEET_FLAGS.alpha) !== 0,
      tail: (flags & SHEET_FLAGS.tail) !== 0,
      cached: (flags & SHEET_FLAGS.cached) !== 0,
      synthesized: view.getUint32(at + 24, true),
    };
    const start = payloadStart + offset;
    if (kindCode === 1) {
      const format = FORMATS[formatCode];
      if (!format) throw broken("ASB1_BAD_ENTRY", `${where}: формат ${formatCode} неизвестен.`);
      if (levels < 1 || levels > MAX_LEVELS || sheet.synthesized > levels) throw broken("ASB1_BAD_ENTRY", `${where}: уровней ${levels} (синтетических ${sheet.synthesized}).`);
      if (width < 4 || height < 4 || width > MAX_SIDE || height > MAX_SIDE || width % 4 !== 0 || height % 4 !== 0) throw broken("ASB1_BAD_ENTRY", `${where}: размер ${width}×${height} не годится для блоков.`);
      const mipmaps = [];
      let cursor = start;
      for (let k = 0; k < levels; k += 1) {
        const w = Math.max(1, width >> k);
        const h = Math.max(1, height >> k);
        const size = blocksAlong(w) * blocksAlong(h) * format.block;
        if (cursor + size > start + length) throw broken("ASB1_LENGTH_MISMATCH", `${where}: уровень ${k} (${w}×${h}) не помещается в ${length} байт.`);
        mipmaps.push({ data: copyOf(bytes, cursor, cursor + size), width: w, height: h });
        cursor += size;
      }
      if (cursor !== start + length) throw broken("ASB1_LENGTH_MISMATCH", `${where}: сумма уровней ${cursor - start} не равна длине ${length}.`);
      sheet.format = format.name;
      sheet.mipmaps = mipmaps;
    } else if (kindCode >= 2) {
      if (length === 0) throw broken("ASB1_BAD_ENTRY", `${where}: пустая нагрузка у вида «${KIND[kindCode]}».`);
      if (kindCode === 3 && length !== width * height * 4) throw broken("ASB1_LENGTH_MISMATCH", `${where}: RGBA ${width}×${height} не равен длине ${length}.`);
      sheet.bytes = copyOf(bytes, start, start + length);
    } else if (length !== 0) {
      throw broken("ASB1_BAD_ENTRY", `${where}: у записи без вида есть нагрузка.`);
    }
    sheets.push(sheet);
  }
  return sheets;
}
