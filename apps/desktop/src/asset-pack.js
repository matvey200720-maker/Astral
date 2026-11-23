/*
 * Склад ресурсов Astral (ASP1): много файлов RAGE одним сжатым архивом, а
 * одинаковые текстуры — один раз.
 *
 * Зачем. Моды деревьев и земли везут одну и ту же текстуру в десятках
 * моделей: у «Реалистичных деревьев» 68 МБ из 239 — копии (плющ, ветки,
 * кора). Файлы RAGE (RSC7) сжаты каждый сам по себе, поэтому общий архив
 * копий не видит. Склад раскрывает ресурс, вырезает байты текстур (их
 * место — нули, сжимаются в ничто), кладёт каждую текстуру один раз и жмёт
 * всё вместе zstd. При установке файл собирается обратно: те же данные
 * ресурса байт в байт, сжатые заново тем же deflate, что у игры.
 *
 *   packResources([{ name, bytes }]) → { bytes, stats }
 *   openAssetPack(bytes) → { names, has(name), read(name) → RSC7 }
 *
 * Части. GitHub не принимает файлы больше 100 МБ, поэтому склад на диске —
 * части по `PART_BYTES` (`<имя>.asp.000`, `.001`…); `readAssetPackParts`
 * склеивает их обратно.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith, RSC7_HEADER_BYTES } from "@modovik/ypt/resource-core";
import { deflateRaw, inflateResource } from "@modovik/native-rs";

const MAGIC = Buffer.from("ASP1", "latin1");
export const ASSET_PACK_VERSION = 1;
export const PART_BYTES = 48 * 1024 * 1024;
/* Окно zstd 128 МБ: дальние повторы (одна кора в разных концах склада). */
const WINDOW_LOG = 27;

const inflateRaw = inflateResource;

const isResource = (bytes) => bytes.length > RSC7_HEADER_BYTES && bytes.subarray(0, 4).toString("latin1") === "RSC7";
const kindOf = (name) => String(name || "").toLowerCase().split(".").pop();

/* Текстуры ресурса без перекрытий: `[{ dataAt, bytes }]` по возрастанию. */
function textureRanges(resource, kind) {
  let refs = [];
  try {
    refs =
      kind === "ytd"
        ? readTextureDictionary(resource)
        : ["ydr", "ydd", "yft"].includes(kind)
          ? readDrawable(resource, { inflateRaw, kind }).drawables.flatMap((drawable) => drawable.embeddedTextures || [])
          : [];
  } catch {
    refs = [];
  }
  const ranges = refs
    .filter((ref) => ref.complete && ref.dataAt >= 0 && ref.bytes > 0 && ref.dataAt + ref.bytes <= resource.data.length)
    .map((ref) => ({ dataAt: ref.dataAt, bytes: ref.bytes }))
    .sort((a, b) => a.dataAt - b.dataAt || b.bytes - a.bytes);
  /* Общий хвост mip у двух текстур — берём только первую: место второй
     частично занято, а склад обязан вернуть ресурс байт в байт. */
  const out = [];
  let end = -1;
  for (const range of ranges) {
    if (range.dataAt < end) continue;
    out.push(range);
    end = range.dataAt + range.bytes;
  }
  return out;
}

/**
 * Склад из файлов `[{ name, bytes }]`. Имена — строчными, без папок; повтор
 * имени — отказ. Ответ: `{ bytes, stats }`, где `stats` — сколько было, сколько
 * текстур повторялось и сколько вышло.
 */
export function packResources(files, { level = 19 } = {}) {
  const seenNames = new Set();
  const payloads = [];
  const payloadIndex = new Map();
  const entries = [];
  const chunks = [];
  let offset = 0;
  const stats = { files: 0, sourceBytes: 0, textureBytes: 0, duplicateBytes: 0, packedBytes: 0 };
  const push = (buffer) => {
    chunks.push(buffer);
    const at = offset;
    offset += buffer.length;
    return at;
  };
  for (const file of files) {
    const name = String(file.name || "").toLowerCase();
    if (!name || name.includes("/") || name.includes("\\")) throw new Error(`Склад: имя «${file.name}» — без папок.`);
    if (seenNames.has(name)) throw new Error(`Склад: имя «${name}» дважды.`);
    seenNames.add(name);
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes);
    stats.files += 1;
    stats.sourceBytes += bytes.length;
    if (!isResource(bytes)) {
      entries.push({ name, raw: true, at: push(bytes), size: bytes.length });
      continue;
    }
    const resource = openResourceWith(new Uint8Array(bytes), inflateRaw);
    const data = Buffer.from(resource.data);
    const refs = [];
    for (const range of textureRanges(resource, kindOf(name))) {
      const payload = data.subarray(range.dataAt, range.dataAt + range.bytes);
      const key = createHash("sha256").update(payload).digest("hex");
      let id = payloadIndex.get(key);
      stats.textureBytes += range.bytes;
      if (id === undefined) {
        id = payloads.length;
        payloads.push(Buffer.from(payload));
        payloadIndex.set(key, id);
      } else stats.duplicateBytes += range.bytes;
      refs.push([range.dataAt, range.bytes, id]);
      data.fill(0, range.dataAt, range.dataAt + range.bytes);
    }
    entries.push({
      name,
      header: bytes.subarray(0, RSC7_HEADER_BYTES).toString("hex"),
      at: push(data),
      size: data.length,
      refs,
    });
  }
  const payloadTable = payloads.map((payload) => ({ at: push(payload), size: payload.length }));
  const index = Buffer.from(JSON.stringify({ version: ASSET_PACK_VERSION, entries, payloads: payloadTable }), "utf8");
  const head = Buffer.alloc(8);
  MAGIC.copy(head, 0);
  head.writeUInt32LE(index.length, 4);
  const plain = Buffer.concat([head, index, ...chunks]);
  const packed = zlib.zstdCompressSync(plain, {
    params: {
      [zlib.constants.ZSTD_c_compressionLevel]: level,
      [zlib.constants.ZSTD_c_windowLog]: WINDOW_LOG,
      [zlib.constants.ZSTD_c_enableLongDistanceMatching]: 1,
    },
  });
  stats.packedBytes = packed.length;
  return { bytes: packed, stats };
}

/*
 * Размер распакованного из заголовка кадра zstd (Frame_Content_Size), если
 * сжиматель его записал; иначе `null`.
 */
export function zstdContentSize(bytes) {
  if (bytes.length < 6 || bytes.readUInt32LE(0) !== 0xfd2fb528) return null;
  const descriptor = bytes[4];
  const sizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const at = 5 + (singleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 3];
  const width = sizeFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][sizeFlag];
  if (!width || bytes.length < at + width) return null;
  if (width === 1) return bytes[at];
  if (width === 2) return bytes.readUInt16LE(at) + 256;
  if (width === 4) return bytes.readUInt32LE(at);
  const size = bytes.readBigUInt64LE(at);
  return size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : null;
}

/* Без размера в заголовке — крупными кусками, а не по 16 КБ. */
const FALLBACK_CHUNK = 64 * 1024 * 1024;

/*
 * Распаковка склада одним буфером (фикс 1 ТЗ 07.10.2026). zlib по умолчанию
 * отдаёт вывод кусками по 16 КБ: склад «Реалистичных деревьев» (784 МБ)
 * давал ~48 тыс. буферов-однодневок. В Electron (V8 со сжатыми указателями и
 * песочницей памяти) после этого каждое новое выделение буфера шло так
 * медленно, что распаковка следующего склада (22 МБ) стояла 69 с, а
 * главный поток — до 140 с: Windows считала Astral зависшим и закрывала
 * окно. Буфер на байт больше вывода — чтобы zlib не заводил второй.
 */
function zstdDecompressWhole(bytes) {
  const size = zstdContentSize(bytes);
  return zlib.zstdDecompressSync(bytes, {
    chunkSize: size ? size + 1 : FALLBACK_CHUNK,
    params: { [zlib.constants.ZSTD_d_windowLogMax]: WINDOW_LOG },
  });
}

/**
 * Ресурс из заголовка RSC7 и данных: заголовок и данные, сжатые тем же
 * deflate, что у игры (большой ресурс — шестым уровнем, как правка текстур на
 * месте). Склад отдаёт так `read`, а тот, кто получил `readPlain`, — сам.
 */
export function compressResource(header, data) {
  const compressed = deflateRaw(data, { level: data.length > 8 * 1024 * 1024 ? 6 : zlib.constants.Z_BEST_COMPRESSION });
  return Buffer.concat([header, compressed]);
}

/**
 * Открытый склад: `names` — имена файлов, `read(name)` — файл, собранный
 * обратно (RSC7 с прежним заголовком; данные ресурса байт в байт как у
 * исходного), или `null`, если имени нет.
 *
 * `readPlain(name)` — тот же файл без последнего сжатия (13.10.2026):
 * `{ plain: true, bytes }`, где bytes — 16 байт заголовка RSC7 и сразу за
 * ними данные ресурса. Работа над файлом всё равно разжимала его заново, а
 * сжатие в `read` шло девятым уровнем подряд в одном потоке — на «Реалистичных
 * деревьях» это две трети времени чтения склада. Не ресурс (`raw`) отдаётся
 * как есть: `{ plain: false, bytes }`. `compressResource(заголовок, данные)` даёт
 * те же байты, что `read`.
 */
export function openAssetPack(bytes) {
  const plain = zstdDecompressWhole(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  if (!plain.subarray(0, 4).equals(MAGIC)) throw new Error("Склад ресурсов повреждён: нет метки ASP1.");
  const indexLength = plain.readUInt32LE(4);
  const index = JSON.parse(plain.subarray(8, 8 + indexLength).toString("utf8"));
  if (index.version !== ASSET_PACK_VERSION) throw new Error(`Склад ресурсов версии ${index.version} — эта версия Astral его не знает.`);
  const base = 8 + indexLength;
  const byName = new Map(index.entries.map((entry) => [entry.name, entry]));
  const slice = (at, size) => plain.subarray(base + at, base + at + size);
  const entryOf = (name) => byName.get(String(name || "").toLowerCase()) || null;
  /* Данные ресурса без сжатия (для проверок и правки текстур на месте). */
  const data = (name) => {
    const entry = entryOf(name);
    if (!entry) return null;
    const out = Buffer.from(slice(entry.at, entry.size));
    for (const [dataAt, size, id] of entry.refs || []) {
      const payload = index.payloads[id];
      if (payload.size !== size) throw new Error(`Склад ресурсов повреждён: текстура ${id} у ${entry.name}.`);
      out.set(slice(payload.at, payload.size), dataAt);
    }
    return out;
  };
  return {
    names: index.entries.map((entry) => entry.name),
    has: (name) => Boolean(entryOf(name)),
    /* Размер файла без сжатия (у ресурса — заголовок и данные), по описи склада: для оценки пакета до сборки, без чтения. */
    sizeOf(name) {
      const entry = entryOf(name);
      if (!entry) return null;
      return entry.raw ? entry.size : entry.size + 16;
    },
    data,
    read(name) {
      const entry = entryOf(name);
      if (!entry) return null;
      if (entry.raw) return Buffer.from(slice(entry.at, entry.size));
      return compressResource(Buffer.from(entry.header, "hex"), data(entry.name));
    },
    readPlain(name) {
      const entry = entryOf(name);
      if (!entry) return null;
      if (entry.raw) return { plain: false, bytes: Buffer.from(slice(entry.at, entry.size)) };
      const resource = data(entry.name);
      const header = Buffer.from(entry.header, "hex");
      return { plain: true, bytes: Buffer.concat([header, resource]) };
    },
  };
}

/** Части склада на диске: `<base>.asp.000`, `.001`… */
export async function writeAssetPackParts(base, bytes, { partBytes = PART_BYTES } = {}) {
  const directory = path.dirname(base);
  const prefix = `${path.basename(base)}.asp.`;
  await fs.mkdir(directory, { recursive: true });
  for (const name of await fs.readdir(directory)) if (name.startsWith(prefix)) await fs.rm(path.join(directory, name), { force: true });
  const parts = [];
  for (let at = 0, index = 0; at < bytes.length; at += partBytes, index += 1) {
    const file = path.join(directory, `${prefix}${String(index).padStart(3, "0")}`);
    await fs.writeFile(file, bytes.subarray(at, Math.min(bytes.length, at + partBytes)));
    parts.push(path.basename(file));
  }
  return parts;
}

/** Склад из частей на диске; частей нет — `null`. */
export async function readAssetPackParts(base) {
  const directory = path.dirname(base);
  const prefix = `${path.basename(base)}.asp.`;
  const names = (await fs.readdir(directory).catch(() => []))
    .filter((name) => name.startsWith(prefix) && /^\d{3}$/.test(name.slice(prefix.length)))
    .sort();
  if (!names.length) return null;
  /* Части читаются сразу в один буфер (ОЗУ 15.10): прежде части и их
     склейка жили в памяти вместе — у склада деревьев 127 МБ лишних на пике
     «Применить», поверх ~770 МБ распакованного склада. */
  const files = names.map((name) => path.join(directory, name));
  const sizes = [];
  for (const file of files) sizes.push((await fs.stat(file)).size);
  const whole = Buffer.allocUnsafe(sizes.reduce((sum, size) => sum + size, 0));
  let at = 0;
  for (const [index, file] of files.entries()) {
    const handle = await fs.open(file, "r");
    try {
      let read = 0;
      while (read < sizes[index]) {
        const { bytesRead } = await handle.read(whole, at + read, sizes[index] - read, read);
        if (!bytesRead) break;
        read += bytesRead;
      }
      at += read;
      /* Часть короче, чем была (её меняют прямо сейчас), — склад отдаётся
         как прочитан: сверка суммы и разбор назовут его повреждённым. */
      if (read !== sizes[index]) break;
    } finally {
      await handle.close();
    }
  }
  return at === whole.length ? whole : whole.subarray(0, at);
}
