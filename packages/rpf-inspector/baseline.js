// Слепок неизменённого пака: пути, размеры и хэши. Ресурс хэшируется по распакованному телу.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip, inflateRawSync } from "node:zlib";

export const BASELINE_SCHEMA = 1;

const RSC7_MAGIC = [0x52, 0x53, 0x43, 0x37]; // «RSC7»
const RSC7_HEADER_SIZE = 16;
const RSC7_FIELDS_START = 4;
const PROGRESS_STEP = 500;
const CANCELLED = "Отменено.";
const SHA256_HEX = /^[0-9a-f]{64}$/;

function sha256Hex(...chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

// Тело ресурса или null: битая запись не роняет разбор, а идёт обычным хэшем.
function resourceBody(view) {
  if (view.length < RSC7_HEADER_SIZE) return null;
  if (RSC7_MAGIC.some((byte, at) => view[at] !== byte)) return null;
  try {
    return inflateRawSync(view.subarray(RSC7_HEADER_SIZE));
  } catch {
    return null;
  }
}

/**
 * Отпечаток СОДЕРЖИМОГО записи — им построены база и опись редукса, и им сравнивается «изменён ли файл против штатной».
 * У ресурса (`.ydr`, `.ytd`, `.ymap`…) это sha256 от полей шапки (байты 4…16) и распакованного тела, а не от байтов файла: один и тот же
 * ресурс, пересжатый другим упаковщиком, даёт тот же отпечаток, а сырой sha256 у него другой. Поэтому отпечаток описи ресурса НЕ равен
 * sha256 файла пакета (`part.json` `covers[].sha256`, он считает сырые байты) — их связывает `covers[].inventory` и проверка
 * `verify-install` (содержимое файла пакета пересчитывается этой функцией и сравнивается с описью). У остальных записей — обычный sha256.
 */
export function entryContentHash(bytes, { resource = false } = {}) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const body = resource ? resourceBody(view) : null;
  return body === null
    ? sha256Hex(view)
    : sha256Hex(view.subarray(RSC7_FIELDS_START, RSC7_HEADER_SIZE), body);
}

/**
 * Два отпечатка одних и тех же байтов `archive.read()`, и опись редукса (`tests/fixtures/redux-anatomy`), штатная база и
 * `covers[].sha256` частей могут нести любой из них:
 *   • «файл» — sha256 самих байтов: так хэшируется файл пакета (`sha256File`) и то, что лежит в игре после установки;
 *   • «содержимое» (`entryContentHash`) — у ресурса sha256 версии и флагов страниц (байты 4…16 шапки RSC7) и **распакованного**
 *     тела, у прочего — тот же sha256 файла. Перепаковка с другим сжатием его не меняет, раскладка страниц — меняет.
 * Для ресурса (`.ydr`, `.ytd`, `.ytyp`…) эти два отпечатка разные по построению: у 5 386 из 5 809 записей трёх редуксов
 * (hallowen, «Грустный», Valorant v3), у остальных (xml, meta, dat) совпадают. Сравнивать отпечаток описи с sha256 байтов
 * напрямую нельзя — ресурс всегда «не равен» (10.11.2026, hallowen: `halloween/1.rpf/arrow.ydr` 2036e8e5… против 89752eb4…);
 * сравнивай через `matchEntryHash`: он отвечает, каким из двух отпечатков совпало, или `null`.
 * @returns {"file" | "content" | null}
 */
export function matchEntryHash(bytes, expected) {
  const want = String(expected ?? "").toLowerCase();
  if (!want) return null;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (sha256Hex(view) === want) return "file";
  return entryContentHash(view, { resource: true }) === want ? "content" : null;
}

function isComparable(entry) {
  return (
    entry.kind !== "directory" &&
    !entry.nested &&
    !String(entry.path ?? "").toLowerCase().endsWith(".rpf")
  );
}

function optionalText(value) {
  return value ? String(value) : "";
}

// Одна запись: строка базы или проблема. Сбой чтения и хэша не прерывает обход.
async function snapshotOf(archive, entry) {
  try {
    const bytes = await archive.read(entry.path);
    return {
      row: {
        path: entry.path,
        size: bytes.length,
        sha256: entryContentHash(bytes, { resource: entry.kind === "resource" }),
      },
    };
  } catch (error) {
    return { problem: { path: entry.path, message: String(error?.message) } };
  }
}

// Записи строго по очереди; отмена проверяется перед каждой.
async function* snapshots(archive, queue, signal) {
  for (const entry of queue) {
    if (signal?.aborted) throw signal.reason || new Error(CANCELLED);
    yield snapshotOf(archive, entry);
  }
}

// Прогресс — после записей с номером, кратным 500 (считая с нуля), и после последней.
class ProgressMeter {
  #total;
  #report;
  #done = 0;

  constructor(total, report) {
    this.#total = total;
    this.#report = report;
  }

  advance() {
    const index = this.#done;
    this.#done += 1;
    if (!this.#report) return;
    if (index % PROGRESS_STEP === 0 || this.#done === this.#total) {
      this.#report({ done: this.#done, total: this.#total });
    }
  }
}

export async function buildPackBaseline(
  archive,
  { name, size = 0, label = "", onProgress = null, signal = null } = {},
) {
  const queue = archive.entries.filter(isComparable);
  const meter = new ProgressMeter(queue.length, onProgress);
  const entries = [];
  const problems = [];

  for await (const { row, problem } of snapshots(archive, queue, signal)) {
    if (row) entries.push(row);
    else problems.push(problem);
    meter.advance();
  }

  return {
    schema: BASELINE_SCHEMA,
    source: { name: optionalText(name), size, label: optionalText(label) },
    entries,
    problems,
  };
}

// Файл базы: JSON без отступов в gzip девятого уровня; при чтении сжатие узнаётся по первым байтам.
const baselineFile = {
  gzipMagic: [0x1f, 0x8b],
  pack: promisify(gzip),
  unpack: promisify(gunzip),

  // Buffer.from отказывает на undefined, а пустое сжатие молча записало бы пустой файл.
  encode(value) {
    return this.pack(Buffer.from(JSON.stringify(value)), { level: 9 });
  },

  async decode(raw) {
    const packed = this.gzipMagic.every((byte, at) => raw[at] === byte);
    return JSON.parse((packed ? await this.unpack(raw) : raw).toString("utf8"));
  },
};

export async function writeBaseline(file, baseline) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await baselineFile.encode(baseline));
}

function isPackBaseline(value) {
  return (
    value?.schema === BASELINE_SCHEMA &&
    Array.isArray(value.entries) &&
    value.entries.every((row) => typeof row?.path === "string" && SHA256_HEX.test(row.sha256))
  );
}

export async function readBaseline(file) {
  const value = await baselineFile.decode(await readFile(file));
  if (!isPackBaseline(value)) {
    throw new Error(`${basename(file)} — не база пака Astral (catalog:baseline, схема 1).`);
  }
  return value;
}
