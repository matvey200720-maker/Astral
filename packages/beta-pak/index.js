// Форматы web.bundle (ASTRBUN1) и astral-web.pak (ASTRPAK1) для веб-интерфейса бета-лаунчера.
// Только Node.js: нужны node:crypto и node:fs.
// crypto и fs берутся из объектов модулей в момент вызова: стенды подменяют их свойства.

import crypto from "node:crypto";
import fs from "node:fs";
import { extname, join } from "node:path";
import { Transform } from "node:stream";

export const BUNDLE_MAGIC = "ASTRBUN1";
export const PAK_MAGIC = "ASTRPAK1";
export const PAK_HEADER_SIZE = 32;
export const PAK_CHUNK_SIZE = 1048576;
export const PAK_TAG_SIZE = 16;

const SEALED_CHUNK_SIZE = PAK_CHUNK_SIZE + PAK_TAG_SIZE;
const BUNDLE_HEAD_SIZE = 12;
const MIN_INDEX_BYTES = 2;
const MAX_INDEX_BYTES = 16777216;
const MAX_PATH_LENGTH = 512;
const MAX_VERSION_LENGTH = 64;
const KEY_BYTES = 32;
const FILE_ID_BYTES = 16;
const DEFAULT_CACHE_BYTES = 67108864;
const DEFAULT_BATCH = 4;
const DEFAULT_TYPE = "application/octet-stream";
const CIPHER = "aes-256-gcm";

const CODE_BACKSLASH = 0x5c;
const CODE_SLASH = 0x2f;
const CODE_DOT = 0x2e;

const MESSAGES = Object.freeze({
  bundleVersion: "bundle version is required",
  bundleHeader: "bundle header is invalid",
  bundleRange: "bundle index is out of range",
  bundleIndex: "bundle index is invalid",
  bundleEntry: "bundle entry is invalid",
  pakKey: "pak key must contain 32 bytes",
  pakHeader: "pak header is invalid",
  pakTruncated: "pak chunk is truncated",
  pakAuth: "pak chunk failed authentication",
});

// Типы содержимого: тип и все расширения, которым он соответствует.
const MIME_GROUPS = [
  ["image/avif", ".avif"],
  ["application/octet-stream", ".bin"],
  ["text/css; charset=utf-8", ".css"],
  ["image/gif", ".gif"],
  ["model/gltf-binary", ".glb"],
  ["model/gltf+json", ".gltf"],
  ["text/html; charset=utf-8", ".html"],
  ["image/x-icon", ".ico"],
  ["image/jpeg", ".jpeg", ".jpg"],
  ["text/javascript; charset=utf-8", ".js", ".mjs"],
  ["application/json; charset=utf-8", ".json", ".map"],
  ["image/ktx2", ".ktx2"],
  ["audio/mpeg", ".mp3"],
  ["video/mp4", ".mp4"],
  ["audio/ogg", ".ogg"],
  ["font/otf", ".otf"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["font/ttf", ".ttf"],
  ["text/plain; charset=utf-8", ".txt"],
  ["application/wasm", ".wasm"],
  ["audio/wav", ".wav"],
  ["video/webm", ".webm"],
  ["image/webp", ".webp"],
  ["font/woff", ".woff"],
  ["font/woff2", ".woff2"],
];
const MIME_BY_EXTENSION = new Map(
  MIME_GROUPS.flatMap(([type, ...extensions]) => extensions.map((extension) => [extension, type])),
);

// ---------------------------------------------------------------------------
// Общие примитивы
// ---------------------------------------------------------------------------

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

const hasLength = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max;

const u32be = (number) => Buffer.from([24, 16, 8, 0].map((shift) => (number >>> shift) & 0xff));

// Сигнатуры сверяются как «ascii»: старший бит каждого байта не учитывается.
const hasMagic = (bytes, magic) => Array.from(magic).every((letter, i) => (bytes[i] & 0x7f) === letter.charCodeAt(0));

const isPakKey = (key) => Buffer.isBuffer(key) && key.length === KEY_BYTES;

function requireKey(key) {
  ensure(isPakKey(key), MESSAGES.pakKey);
}

function digestHex(...parts) {
  const hash = crypto.createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest("hex");
}

export function sha256Hex(data) {
  return digestHex(data);
}

export function mimeType(filePath) {
  const lowered = extname(filePath).toLowerCase();
  const known = MIME_BY_EXTENSION.has(lowered);
  return known ? MIME_BY_EXTENSION.get(lowered) : DEFAULT_TYPE;
}

// Часть пути испорчена, если в ней не больше двух знаков и все они точки (пустая часть — тоже).
const spoiledPart = (length, onlyDots) => onlyDots && length <= 2;

export function validBundlePath(value) {
  if (!hasLength(value, 1, MAX_PATH_LENGTH)) return false;
  let partLength = 0;
  let onlyDots = true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === CODE_BACKSLASH || code < 0x20) return false;
    if (code !== CODE_SLASH) {
      partLength += 1;
      onlyDots = onlyDots && code === CODE_DOT;
      continue;
    }
    if (spoiledPart(partLength, onlyDots)) return false;
    partLength = 0;
    onlyDots = true;
  }
  return !spoiledPart(partLength, onlyDots);
}

function isHexDigest(text) {
  if (text.length !== 64) return false;
  for (let i = 0; i < 64; i += 1) {
    const code = text.charCodeAt(i);
    const digit = code >= 0x30 && code <= 0x39;
    const lower = code >= 0x61 && code <= 0x66;
    if (!digit && !lower) return false;
  }
  return true;
}

export function encryptedPakSize(plainBytes) {
  if (plainBytes === 0) return PAK_HEADER_SIZE + PAK_TAG_SIZE;
  return PAK_HEADER_SIZE + plainBytes + PAK_TAG_SIZE * Math.ceil(plainBytes / PAK_CHUNK_SIZE);
}

// ---------------------------------------------------------------------------
// web.bundle: упаковка
// ---------------------------------------------------------------------------

function comparePaths(a, b) {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

const toBuffer = (data) => (Buffer.isBuffer(data) ? data : Buffer.from(data));

// Проверяет записи по одной в порядке сортировки: сначала путь, потом данные.
function* checkedEntries(ordered) {
  const claimed = new Set();
  for (const entry of ordered) {
    const path = entry.path;
    const acceptable = validBundlePath(path) && !claimed.has(path);
    if (!acceptable) throw new Error(`invalid or duplicate bundle path: ${path}`);
    claimed.add(path);
    yield { path, data: toBuffer(entry.data), type: entry.type ?? mimeType(path) };
  }
}

export function packBundle(files, { version }) {
  ensure(hasLength(version, 1, MAX_VERSION_LENGTH), MESSAGES.bundleVersion);
  const items = [...checkedEntries([...files].sort(comparePaths))];

  let cursor = 0;
  const records = items.map(({ path, data, type }) => {
    const record = { path, offset: cursor, size: data.length, type, sha256: sha256Hex(data) };
    cursor += data.length;
    return record;
  });
  const index = Buffer.from(JSON.stringify({ version, files: records }), "utf8");
  const preamble = Buffer.concat([Buffer.from(BUNDLE_MAGIC, "ascii"), u32be(index.length)]);
  return Buffer.concat([preamble, index, ...items.map((item) => item.data)]);
}

function* walkDirectory(directory, prefix) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const location = join(directory, item.name);
    if (item.isDirectory()) {
      yield* walkDirectory(location, `${prefix}${item.name}/`);
    } else if (item.isFile()) {
      yield { path: `${prefix}${item.name}`, data: fs.readFileSync(location) };
    }
  }
}

export function packBundleFromDirectory(root, { version }) {
  // Сначала читаются все файлы, и только потом проверяется версия.
  const files = [...walkDirectory(root, "")];
  return packBundle(files, { version });
}

// ---------------------------------------------------------------------------
// web.bundle: чтение
// ---------------------------------------------------------------------------

function expectBundleBuffer(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length >= BUNDLE_HEAD_SIZE) return buffer;
  throw new Error(MESSAGES.bundleHeader);
}

// По первым 12 байтам находит, где кончается индекс и начинаются данные.
function indexPreamble(head, totalLength) {
  ensure(hasMagic(head, BUNDLE_MAGIC), MESSAGES.bundleHeader);
  const indexLength = head.readUInt32BE(8);
  const outside = indexLength < MIN_INDEX_BYTES
    || indexLength > MAX_INDEX_BYTES
    || BUNDLE_HEAD_SIZE + indexLength > totalLength;
  ensure(!outside, MESSAGES.bundleRange);
  return { dataStart: BUNDLE_HEAD_SIZE + indexLength };
}

const isByteCount = (value) => Number.isSafeInteger(value) && value >= 0;

// Условия, при которых запись индекса допустима; нужны все.
const ENTRY_RULES = [
  (entry, { taken }) => validBundlePath(entry.path) && !taken.has(entry.path),
  (entry) => isByteCount(entry.offset) && isByteCount(entry.size),
  (entry, { dataStart, plainLength }) => dataStart + entry.offset + entry.size <= plainLength,
  (entry) => typeof entry.type === "string",
  (entry) => isHexDigest(String(entry.sha256)),
];

function parseIndex(text, dataStart, plainLength) {
  const index = JSON.parse(text);
  const shapeOk = index !== null && typeof index === "object"
    && typeof index.version === "string" && Array.isArray(index.files);
  ensure(shapeOk, MESSAGES.bundleIndex);

  const context = { taken: new Set(), dataStart, plainLength };
  for (const entry of index.files) {
    const object = entry !== null && typeof entry === "object";
    ensure(object && ENTRY_RULES.every((rule) => rule(entry, context)), MESSAGES.bundleEntry);
    context.taken.add(entry.path);
  }
  return { version: index.version, entries: index.files };
}

function fileView(buffer, dataStart, { offset, size, type, sha256 }) {
  const from = dataStart + offset;
  return { data: buffer.subarray(from, from + size), type, sha256 };
}

export function readBundle(buffer, { verify = false } = {}) {
  const bytes = expectBundleBuffer(buffer);
  const { dataStart } = indexPreamble(bytes, bytes.length);
  const { version, entries } = parseIndex(bytes.toString("utf8", BUNDLE_HEAD_SIZE, dataStart), dataStart, bytes.length);

  const files = new Map(entries.map((entry) => [entry.path, fileView(bytes, dataStart, entry)]));
  const damaged = verify ? [...files].find(([, file]) => sha256Hex(file.data) !== file.sha256) : undefined;
  if (damaged) throw new Error(`bundle file is damaged: ${damaged[0]}`);
  return { version, files };
}

// ---------------------------------------------------------------------------
// astral-web.pak: чанки AES-256-GCM
// ---------------------------------------------------------------------------

// nonce — id файла и номер чанка; AAD — весь заголовок, номер и признак последнего чанка.
function chunkContext(header, index, last) {
  const nonce = Buffer.concat([header.subarray(8, 16), u32be(index)]);
  const aad = Buffer.concat([header.subarray(0, PAK_HEADER_SIZE), u32be(index), Buffer.from([last ? 1 : 0])]);
  return { nonce, aad };
}

function gcmSeal(key, { nonce, aad }, plain) {
  const cipher = crypto.createCipheriv(CIPHER, key, nonce);
  cipher.setAAD(aad);
  const sealed = [cipher.update(plain), cipher.final()];
  sealed.push(cipher.getAuthTag());
  return Buffer.concat(sealed);
}

// sealed — шифртекст с тегом в конце (не короче тега).
function gcmOpen(key, { nonce, aad }, sealed) {
  const decipher = crypto.createDecipheriv(CIPHER, key, nonce);
  const boundary = sealed.length - PAK_TAG_SIZE;
  try {
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(boundary));
    const plain = decipher.update(sealed.subarray(0, boundary));
    decipher.final();
    return plain;
  } catch {
    throw new Error(MESSAGES.pakAuth);
  }
}

const sealChunk = (key, header, index, last, plain) => gcmSeal(key, chunkContext(header, index, last), plain);
const unsealChunk = (key, header, index, last, sealed) => gcmOpen(key, chunkContext(header, index, last), sealed);

function checkPakHeader(header) {
  const intact = hasMagic(header, PAK_MAGIC) && header.subarray(24, 28).equals(u32be(PAK_CHUNK_SIZE));
  ensure(intact, MESSAGES.pakHeader);
}

export function encryptPak(plain, key) {
  requireKey(key);
  const header = Buffer.concat([
    Buffer.from(PAK_MAGIC, "ascii"),
    crypto.randomBytes(FILE_ID_BYTES),
    u32be(PAK_CHUNK_SIZE),
    Buffer.alloc(4),
  ]);

  const total = plain.length;
  const chunkCount = Math.max(1, Math.ceil(total / PAK_CHUNK_SIZE));
  const sealed = Array.from({ length: chunkCount }, (_, index) => {
    const from = index * PAK_CHUNK_SIZE;
    const piece = plain.subarray(from, Math.min(total, from + PAK_CHUNK_SIZE));
    return sealChunk(key, header, index, index === chunkCount - 1, piece);
  });
  return Buffer.concat([header, ...sealed]);
}

function pakHeaderOf(pak) {
  ensure(Buffer.isBuffer(pak) && pak.length >= PAK_HEADER_SIZE + PAK_TAG_SIZE, MESSAGES.pakHeader);
  const header = pak.subarray(0, PAK_HEADER_SIZE);
  checkPakHeader(header);
  return header;
}

// Запечатанные чанки pak по порядку; последним считается тот, что доходит до конца буфера.
function* pakChunks(pak) {
  let position = PAK_HEADER_SIZE;
  for (let index = 0; ; index += 1) {
    const remaining = pak.length - position;
    ensure(remaining >= PAK_TAG_SIZE, MESSAGES.pakTruncated);
    const length = Math.min(remaining, SEALED_CHUNK_SIZE);
    const last = length === remaining;
    yield { index, last, sealed: pak.subarray(position, position + length) };
    if (last) return;
    position += length;
  }
}

export function decryptPak(pak, key) {
  requireKey(key);
  const header = pakHeaderOf(pak);
  const opened = Array.from(pakChunks(pak), ({ index, last, sealed }) => unsealChunk(key, header, index, last, sealed));
  const plain = Buffer.concat(opened);
  return { plain, sha256: sha256Hex(plain) };
}

// Очередь байтов: куски копятся без склейки, склеивается только то, что берут.
class ByteQueue {
  #parts = [];
  size = 0;

  push(bytes) {
    if (bytes.length === 0) return;
    this.#parts.push(bytes);
    this.size += bytes.length;
  }

  take(count) {
    const taken = [];
    let need = count;
    while (need > 0) {
      const head = this.#parts[0];
      if (head.length <= need) {
        taken.push(head);
        this.#parts.shift();
        need -= head.length;
      } else {
        taken.push(head.subarray(0, need));
        this.#parts[0] = head.subarray(need);
        need = 0;
      }
    }
    this.size -= count;
    return taken.length === 1 ? taken[0] : Buffer.concat(taken);
  }
}

// Потоковый разбор pak. Все чанки, кроме замыкающего, открываются, когда за ними
// накоплен хотя бы один лишний байт; замыкающий — в finish().
class PakStreamReader {
  #key;
  #queue = new ByteQueue();
  #hash = crypto.createHash("sha256");
  #header = null;
  #index = 0;

  constructor(key) {
    this.#key = key;
  }

  *feed(bytes) {
    this.#queue.push(bytes);
    if (this.#header === null && this.#queue.size >= PAK_HEADER_SIZE) {
      const header = Buffer.from(this.#queue.take(PAK_HEADER_SIZE));
      checkPakHeader(header);
      this.#header = header;
    }
    while (this.#header !== null && this.#queue.size > SEALED_CHUNK_SIZE) {
      yield this.#open(this.#queue.take(SEALED_CHUNK_SIZE), false);
    }
  }

  *finish() {
    ensure(this.#header !== null, MESSAGES.pakHeader);
    const rest = this.#queue.size;
    ensure(rest >= PAK_TAG_SIZE, MESSAGES.pakTruncated);
    const plain = this.#open(this.#queue.take(rest), true);
    if (plain.length > 0) yield plain;
  }

  digest() {
    return this.#hash.digest("hex");
  }

  #open(sealed, last) {
    const plain = unsealChunk(this.#key, this.#header, this.#index, last, sealed);
    this.#index += 1;
    this.#hash.update(plain);
    return plain;
  }
}

// Выполняет шаг потока и сообщает о результате через done.
function settle(done, step) {
  try {
    step();
  } catch (error) {
    done(error);
    return;
  }
  done();
}

export function createPakDecryptor(key) {
  requireKey(key);
  const reader = new PakStreamReader(key);
  const relay = (pieces) => {
    for (const piece of pieces) stream.push(piece);
  };
  const stream = new Transform({
    transform(bytes, _encoding, done) {
      settle(done, () => relay(reader.feed(bytes)));
    },
    flush(done) {
      settle(done, () => {
        relay(reader.finish());
        stream.sha256 = reader.digest();
      });
    },
  });
  return Object.assign(stream, { sha256: null });
}

async function drainPakFile(filePath, key) {
  const decryptor = createPakDecryptor(key);
  const source = fs.createReadStream(filePath, { highWaterMark: PAK_CHUNK_SIZE });
  source.once("error", (error) => decryptor.destroy(error));
  source.pipe(decryptor);

  const pieces = [];
  try {
    for await (const piece of decryptor) pieces.push(piece);
  } finally {
    source.destroy();
  }
  return { plain: Buffer.concat(pieces), sha256: decryptor.sha256 };
}

export function decryptPakFile(filePath, key) {
  return drainPakFile(filePath, key);
}

// ---------------------------------------------------------------------------
// Проход проверки и ленивое чтение
// ---------------------------------------------------------------------------

// Читает ровно length байт с позиции position; ответ нулевой длины раньше срока — файл усох.
async function readFully(handle, buffer, length, position) {
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    ensure(bytesRead !== 0, MESSAGES.pakTruncated);
    done += bytesRead;
  }
}

// Планы чтения кусками по batch чанков. Арифметика с batch сохранена как в прежнем коде:
// при 0 и null счётчик не продвигается, строка и дробь сбивают разбивку на чанки.
function* readPlans(count, batch, fileSize) {
  let first = 0;
  while (first < count) {
    const take = Math.min(batch, count - first);
    const position = PAK_HEADER_SIZE + first * SEALED_CHUNK_SIZE;
    yield { first, take, position, want: Math.min(take * SEALED_CHUNK_SIZE, fileSize - position) };
    first += batch;
  }
}

// Чанки одного прочитанного куска: границы внутри окна и признак последнего чанка файла.
function* planSlices(plan, count, window) {
  for (let i = 0; i < plan.take; i += 1) {
    const offset = i * SEALED_CHUNK_SIZE;
    const length = Math.min(SEALED_CHUNK_SIZE, plan.want - offset);
    ensure(length >= PAK_TAG_SIZE, MESSAGES.pakTruncated);
    const index = plan.first + i;
    yield { index, last: index === count - 1, sealed: window.subarray(offset, offset + length) };
  }
}

async function scanOpenFile(handle, key, hashPlain, batch) {
  const { size } = await handle.stat();
  ensure(size >= PAK_HEADER_SIZE + PAK_TAG_SIZE, MESSAGES.pakHeader);

  const header = Buffer.alloc(PAK_HEADER_SIZE);
  await readFully(handle, header, PAK_HEADER_SIZE, 0);
  checkPakHeader(header);

  const count = Math.ceil((size - PAK_HEADER_SIZE) / SEALED_CHUNK_SIZE);
  const digest = hashPlain ? crypto.createHash("sha256") : null;
  const absorb = digest === null ? () => {} : (plain) => digest.update(plain);
  const window = Buffer.allocUnsafe(SEALED_CHUNK_SIZE * batch);

  for (const plan of readPlans(count, batch, size)) {
    await readFully(handle, window, plan.want, plan.position);
    for (const { index, last, sealed } of planSlices(plan, count, window)) {
      absorb(unsealChunk(key, header, index, last, sealed));
    }
  }

  return {
    header: new Uint8Array(header),
    fileSize: size,
    count,
    plainLength: size - PAK_HEADER_SIZE - PAK_TAG_SIZE * count,
    sha256: digest === null ? null : digest.digest("hex"),
  };
}

export async function scanPak(filePath, key, { hashPlain = false, batch = DEFAULT_BATCH } = {}) {
  requireKey(key);
  const handle = await fs.promises.open(filePath, "r");
  try {
    return await scanOpenFile(handle, key, hashPlain, batch);
  } finally {
    await handle.close();
  }
}

// Кэш открытых чанков: вытесняется давнее по обращению, но последний добавленный остаётся всегда.
class ChunkCache {
  #limit;
  #items = new Map();
  #bytes = 0;

  constructor(limit) {
    this.#limit = limit;
  }

  touch(index) {
    const chunk = this.#items.get(index);
    if (chunk !== undefined) {
      this.#items.delete(index);
      this.#items.set(index, chunk);
    }
    return chunk;
  }

  add(index, chunk) {
    this.#items.set(index, chunk);
    this.#bytes += chunk.length;
    for (const [oldIndex, oldChunk] of this.#items) {
      // Сравнение записано так, чтобы NaN в пределе вытеснял всё, кроме последнего.
      if (this.#items.size <= 1 || this.#bytes <= this.#limit) break;
      this.#items.delete(oldIndex);
      this.#bytes -= oldChunk.length;
    }
  }
}

// Чтение открытого текста bundle из pak по месту. Файл между чтениями не держится:
// на каждый чанк он открывается заново и сразу закрывается.
class PakReader {
  #filePath;
  #key;
  #header;
  #fileSize;
  #chunkCount;
  #cache;
  #jobs = new Map();

  constructor({ filePath, key, header, fileSize, count, cacheBytes }) {
    this.#filePath = filePath;
    this.#key = key;
    this.#header = header;
    this.#fileSize = fileSize;
    this.#chunkCount = count;
    this.#cache = new ChunkCache(cacheBytes);
  }

  static fromScan(filePath, key, scanned, cacheBytes) {
    const { fileSize, count, header } = scanned;
    return new PakReader({ filePath, key, header: Buffer.from(header), fileSize, count, cacheBytes });
  }

  // Байты открытого текста [from, to) — целые числа внутри текста, from < to.
  async range(from, to) {
    const pieces = [];
    for await (const piece of this.#slices(from, to)) pieces.push(piece);
    return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
  }

  // Куски диапазона по чанкам: чанк целиком читается и проверяется, потом следующий.
  async *#slices(from, to) {
    const lastChunk = Math.floor((to - 1) / PAK_CHUNK_SIZE);
    for (let index = Math.floor(from / PAK_CHUNK_SIZE); index <= lastChunk; index += 1) {
      const chunk = await this.#chunk(index);
      const base = index * PAK_CHUNK_SIZE;
      yield chunk.subarray(Math.max(from - base, 0), Math.min(to - base, chunk.length));
    }
  }

  async #chunk(index) {
    const cached = this.#cache.touch(index);
    if (cached !== undefined) return cached;

    let job = this.#jobs.get(index);
    if (job === undefined) {
      job = this.#fetch(index).finally(() => this.#jobs.delete(index));
      this.#jobs.set(index, job);
    }
    return job;
  }

  async #fetch(index) {
    const last = index === this.#chunkCount - 1;
    const position = PAK_HEADER_SIZE + index * SEALED_CHUNK_SIZE;
    const length = last ? this.#fileSize - position : SEALED_CHUNK_SIZE;

    const handle = await fs.promises.open(this.#filePath, "r");
    try {
      const sealed = Buffer.allocUnsafe(length);
      await readFully(handle, sealed, length, position);
      const plain = unsealChunk(this.#key, this.#header, index, last, sealed);
      this.#cache.add(index, plain);
      return plain;
    } finally {
      await handle.close();
    }
  }
}

function verifiedFile(data, expected, path) {
  if (sha256Hex(data) === expected) return data;
  throw new Error(`bundle file is damaged: ${path}`);
}

function lazyEntry(reader, dataStart, { path, offset, size, type, sha256 }) {
  const start = dataStart + offset;
  // Границы [from, to] включительно; from не проверяется, to обрезается по размеру файла.
  const read = async (from, to) => {
    const first = Math.trunc(start + from);
    const last = Math.trunc(start + Math.min(to, size - 1));
    return last >= first ? reader.range(Math.max(first, 0), last + 1) : Buffer.alloc(0);
  };
  const load = () => (size === 0
    ? Promise.resolve(Buffer.alloc(0))
    : reader.range(start, start + size).then((data) => verifiedFile(data, sha256, path)));
  return { type, sha256, size, read, load };
}

// Читает начало bundle через кэш читателя и разбирает индекс.
async function readBundleIndex(reader, plainLength) {
  ensure(!(plainLength < BUNDLE_HEAD_SIZE), MESSAGES.bundleHeader);
  const { dataStart } = indexPreamble(await reader.range(0, BUNDLE_HEAD_SIZE), plainLength);
  const indexBytes = await reader.range(BUNDLE_HEAD_SIZE, dataStart);
  return { ...parseIndex(indexBytes.toString("utf8"), dataStart, plainLength), dataStart };
}

export async function openPakFile(
  filePath,
  key,
  { cacheBytes = DEFAULT_CACHE_BYTES, hashPlain = false, batch = DEFAULT_BATCH, scan = scanPak } = {},
) {
  requireKey(key);
  const ownKey = Buffer.from(key);
  const scanned = await scan(filePath, ownKey, { hashPlain, batch });
  const reader = PakReader.fromScan(filePath, ownKey, scanned, cacheBytes);

  const { version, entries, dataStart } = await readBundleIndex(reader, scanned.plainLength);
  const files = new Map(entries.map((entry) => [entry.path, lazyEntry(reader, dataStart, entry)]));
  return { version, files, sha256: scanned.sha256, plainLength: scanned.plainLength };
}
