// Обвязка RPF7 для Node.js: чтение файла по смещениям, набор ключей из папки ArchiveFix, распаковщик по умолчанию.

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as native from "@modovik/native-rs";
import * as rpf from "./index.js";

export * from "./index.js";

export function inflateRawNode(bytes, size = null) {
  return native.inflateResource(bytes, size);
}

// Чтение открытого дескриптора: нужное число байт добирается рекурсивно, пока файл не кончится.
class HandleReader {
  #handle;
  #size;

  constructor(handle, size) {
    this.#handle = handle;
    this.#size = size;
  }

  async read(offset, length) {
    const wanted = Math.min(length, this.#size - offset);
    const out = new Uint8Array(wanted > 0 ? wanted : 0);
    const filled = await this.#fill(out, offset, 0);
    return filled === out.length ? out : out.slice(0, filled);
  }

  async #fill(out, offset, filled) {
    if (filled >= out.length) return filled;
    const { bytesRead } = await this.#handle.read(out, filled, out.length - filled, offset + filled);
    return bytesRead === 0 ? filled : this.#fill(out, offset, filled + bytesRead);
  }

  close() {
    return this.#handle.close();
  }
}

// `readWrapper(work, bytes)` — необязательная обёртка каждого чтения (приложение ставит сюда очередь диска под регулятором: `install-engine/governed-read.js`); без неё чтение прямое.
export const fileSource = async (file, { readWrapper = null } = {}) => {
  const handle = await fsp.open(file, "r");
  const { size } = await handle.stat();
  const reader = new HandleReader(handle, size);
  const read = (offset, length) => reader.read(offset, length);
  return { size, read: readWrapper ? (offset, length) => readWrapper(() => read(offset, length), length) : read, close: () => reader.close() };
};

// Имена файлов ArchiveFix по полям набора ключей (порядок полей — порядок ключей результата).
const KEY_FILES = {
  aes: "gtav_aes_key.dat",
  ngKeys: "gtav_ng_key.dat",
  ngTables: "gtav_ng_decrypt_tables.dat",
  hashLut: "gtav_hash_lut.dat",
};

const readKeyFile = async (directory, file) => {
  try {
    const data = await fsp.readFile(path.join(directory, file));
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

// Файлы ключей по одному, в порядке полей; первая не-ENOENT ошибка обрывает чтение остальных.
async function* presentKeyFiles(directory) {
  for (const [field, file] of Object.entries(KEY_FILES)) {
    const bytes = await readKeyFile(directory, file);
    if (bytes) yield [field, bytes];
  }
}

export const keysFromDirectory = async (directory) => {
  const parts = {};
  for await (const [field, bytes] of presentKeyFiles(directory)) parts[field] = bytes;
  const keys = rpf.prepareKeys(parts);
  return native.ngDecrypt && keys.ngTables ? { ...keys, ngDecrypt: native.ngDecrypt } : keys;
};

export const openRpfFile = async (file, options = {}) => {
  const { readWrapper = null, ...openOptions } = options;
  const source = await fileSource(file, { readWrapper });
  let opened = false;
  try {
    const defaults = { name: path.basename(file), inflateRaw: inflateRawNode };
    const archive = await rpf.openRpf(source, { ...defaults, ...openOptions });
    opened = true;
    return Object.assign(archive, { close: source.close });
  } finally {
    if (!opened) await source.close();
  }
};
