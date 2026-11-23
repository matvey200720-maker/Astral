// Чтение архивов RPF7 GTA V: оглавление, вложенные архивы, шифры NONE/OPEN/AES/NG, замки и пределы против «бомб».
// Вход — байты или источник { size, read(offset, length) }; байты записей читаются только по запросу.

import { decryptAes, decryptNg, decryptNgWithKey, ngKeyIndex } from "./crypto.js";

export { ngKeyIndex, ngKeyIndexOfHash, ngNameHash, prepareKeys } from "./crypto.js";

export const RPF7_MAGIC = 1380992567;

export const RPF_LIMITS = Object.freeze({
  maxPathChars: 1024,
  maxTotalEntries: 500000,
  maxTotalArchives: 2000,
  emptyTreeFrom: 1024,
  emptyTreeRatio: 20,
});

export const RPF_ENCRYPTION = Object.freeze({ NONE: 0, OPEN: 1313165391, AES: 268435449, NG: 267386879 });

const DIRECTORY_MARKER = 2147483392;
const BLOCK = 512;
const HEADER_BYTES = 16;
const RECORD_BYTES = 16;
const MAX_ENTRIES = 1048576;
const MAX_NAMES = 67108864;
const MAX_DEPTH = 8;
const MAX_NAME_CHARS = 256;
const ALIAS_MIN_ENTRIES = 16;
const ALIAS_MIN_SHARE = 0.02;
const TRAP_SHARE = 0.25;
const SENTINEL_SIZE = 0xffffff;
const SENTINEL_BYTES = [7, 14, 5, 2];
const RSC7_MAGIC = 0x37435352;
const RECORD_BROKEN = "Запись архива повреждена.";
const GAME_TAIL = "так игра не устроена, похоже на ловушку против распаковщиков.";

const ENCRYPTION_BY_CODE = new Map(Object.keys(RPF_ENCRYPTION).map((name) => [RPF_ENCRYPTION[name], name]));
const PLAIN_FALLBACK_CODES = new Set(["RPF_KEYS_REQUIRED", "RPF_KEY_MISMATCH"]);
const UNUSABLE_NAME_CHARS = new Set([..."<>:\"|?*;\\"]);

const rpfError = (code, message) => Object.assign(new Error(message), { code });
const brokenError = (message) => rpfError("RPF_BROKEN", message);

// Источник байтов: готовый { size, read } возвращается как есть, остальное приводится к байтам.
const asBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input || 0);
};

const isSource = (value) => typeof value?.read === "function" && Number.isFinite(value.size);

export const byteSource = (input) => {
  if (isSource(input)) return input;
  const bytes = asBytes(input);
  const chunk = (offset, length) => bytes.subarray(offset, Math.min(offset + length, bytes.length));
  return { size: bytes.length, read: async (offset, length) => chunk(offset, length) };
};

// Копия диапазона источника: читаемые байты не должны делить память с источником.
// Не `.slice()`: у Buffer он отдаёт вид на ту же память, а не копию.
const copyRange = async (source, offset, length) => new Uint8Array(await source.read(offset, length));

// Окно в родительском источнике: вложенный архив видит родителя со смещением, без копирования.
const windowOf = (parent, base, size) => {
  const room = (offset, length) => Math.max(0, Math.min(length, size - offset));
  return { size, read: async (offset, length) => parent.read(base + offset, room(offset, length)) };
};

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Записи оглавления по 16 байт: раскладка полей каждого вида (имя поля, смещение, тип).
const FIELD_TYPES = {
  u16: (view, at) => view.getUint16(at, true),
  u24: (view, at) => view.getUint16(at, true) | (view.getUint8(at + 2) << 16),
  u23: (view, at) => view.getUint16(at, true) | ((view.getUint8(at + 2) & 0x7f) << 16),
  u32: (view, at) => view.getUint32(at, true),
};

const RECORD_FIELDS = {
  directory: [
    ["nameOffset", 0, "u32"],
    ["first", 8, "u32"],
    ["count", 12, "u32"],
  ],
  binary: [
    ["nameOffset", 0, "u16"],
    ["stored", 2, "u24"],
    ["block", 5, "u24"],
    ["size", 8, "u32"],
    ["cipher", 12, "u32"],
  ],
  resource: [
    ["nameOffset", 0, "u16"],
    ["stored", 2, "u24"],
    ["block", 5, "u23"],
    ["systemFlags", 8, "u32"],
    ["graphicsFlags", 12, "u32"],
  ],
};

const kindAt = (view, base) => {
  const word = view.getUint32(base + 4, true);
  if (word === DIRECTORY_MARKER) return "directory";
  return word >>> 31 ? "resource" : "binary";
};

const readRecord = (view, index) => {
  const base = index * RECORD_BYTES;
  const kind = kindAt(view, base);
  const fields = RECORD_FIELDS[kind].map(([key, at, type]) => [key, FIELD_TYPES[type](view, base + at)]);
  return Object.fromEntries([["kind", kind], ...fields]);
};

// Флаг «замка»: самое частое значение 2…255 в поле шифра двоичных записей, если оно частое.
const lockFlagOf = (view, count) => {
  const tally = new Map();
  for (let i = 0; i < count; i++) {
    if (kindAt(view, i * RECORD_BYTES) !== "binary") continue;
    const cipher = view.getUint32(i * RECORD_BYTES + 12, true);
    if (cipher >= 2 && cipher <= 255) tally.set(cipher, (tally.get(cipher) ?? 0) + 1);
  }
  let [flag, best] = [-1, 0];
  for (const [value, times] of tally) if (times > best) [flag, best] = [value, times];
  return best > ALIAS_MIN_ENTRIES && best >= count * ALIAS_MIN_SHARE ? flag : -1;
};

// Неправдоподобные записи: имя за блоком имён, каталог за оглавлением, чужое поле шифра.
const nameFar = (rec, { namesLength, nameShift }) => rec.nameOffset * 2 ** nameShift >= namesLength;

const IMPLAUSIBLE = {
  directory: (rec, dims) => nameFar(rec, dims) || rec.first > dims.count || rec.first + rec.count > dims.count,
  binary: (rec, dims) => nameFar(rec, dims) || (rec.cipher > 1 && rec.cipher !== dims.flag),
  resource: nameFar,
};

// Проверка расшифрованного (или открытого) оглавления: верный корень и не больше допуска ловушек.
const scanToc = (table, { count, namesLength, nameShift }) => {
  const view = viewOf(table);
  const root = view.getUint32(0, true) === 0 && view.getUint32(4, true) === DIRECTORY_MARKER;
  if (!root) return { root, bad: [], over: false };
  const dims = { count, namesLength, nameShift, flag: lockFlagOf(view, count) };
  const ceiling = Math.floor(count * TRAP_SHARE);
  const bad = [];
  for (let i = 0; i < count && bad.length <= ceiling; i++) {
    const rec = readRecord(view, i);
    if (IMPLAUSIBLE[rec.kind](rec, dims)) bad.push(i);
  }
  return { root, bad, over: bad.length > ceiling };
};

const looksValid = (scan) => scan.root && !scan.over;

// Ловушки открытого оглавления помечаются, только если корень верный и их не больше допуска.
const flaggedTraps = (table, dims) => {
  const scan = scanToc(table, dims);
  return looksValid(scan) ? scan.bad : [];
};

export const chooseTocKey = ({ tableAt, nameIndex, keyCount, entryCount, namesLength, nameShift = 0 }) => {
  const dims = { count: entryCount, namesLength, nameShift };
  const order = [nameIndex, ...Array.from({ length: keyCount }, (_, i) => i).filter((i) => i !== nameIndex)];
  const candidateAt = (index) => {
    const table = tableAt(index);
    const scan = scanToc(table, dims);
    return looksValid(scan) ? { index, table, bad: scan.bad, guessed: index !== nameIndex } : null;
  };
  let namedFallback = null;
  let bestGuess = null;
  for (const index of order) {
    const found = candidateAt(index);
    if (found === null) continue;
    if (found.bad.length === 0) return found;
    if (!found.guessed) {
      namedFallback = found;
    } else if (bestGuess === null || found.bad.length < bestGuess.bad.length) {
      bestGuess = found;
    }
  }
  return namedFallback ?? bestGuess;
};

// Имена: байты до нуля, не больше 256 знаков, каждый байт — знак Latin-1.
const nameAt = (names, offset) => {
  if (offset >= names.length) return "";
  const span = names.subarray(offset, offset + MAX_NAME_CHARS);
  const zero = span.indexOf(0);
  return String.fromCharCode(...span.subarray(0, zero < 0 ? span.length : zero));
};

const hasUnusableChar = (name) => [...name].some((ch) => ch.charCodeAt(0) < 0x20 || UNUSABLE_NAME_CHARS.has(ch));
const usableName = (name) => name !== "" && !hasUnusableChar(name);

const ngKeysComplete = (keys) => Boolean(keys?.ngKeys && keys.ngTables && keys.hashLut);

// Оглавление под NG: ключ по имени и размеру архива, иначе перебор всех ключей.
const decryptTocNg = (raw, { name, size }, keys, dims) => {
  // Без полного набора ключей decryptNg бросает RPF_KEYS_REQUIRED.
  if (!ngKeysComplete(keys)) decryptNg(raw.table, name, size, keys);
  const nameIndex = ngKeyIndex(name, size, keys.hashLut);
  const byNameKey = (bytes) => decryptNg(bytes, name, size, keys);
  const byIndexKey = (bytes, index) => decryptNgWithKey(bytes, keys.ngKeys[index], keys.ngTables);
  const decryptAt = (bytes, index) => (index === nameIndex ? byNameKey : byIndexKey)(bytes, index);
  const request = { tableAt: (index) => decryptAt(raw.table, index), nameIndex, keyCount: keys.ngKeys.length };
  const pick = chooseTocKey({
    ...request,
    entryCount: dims.count,
    namesLength: dims.namesLength,
    nameShift: dims.nameShift,
  });
  if (!pick) {
    throw rpfError(
      "RPF_KEY_MISMATCH",
      `${name}: ни один ключ NG не открывает оглавление — архив повреждён или зашифрован не для GTA V.`,
    );
  }
  return Object.assign(
    { table: pick.table, names: decryptAt(raw.names, pick.index) },
    { keyIndex: pick.index, keyGuessed: pick.guessed, bad: pick.bad },
  );
};

// Выбор оглавления: расшифрованное или, если шапка врёт, открытое как есть.
const resolveToc = (raw, encryption, id, keys, dims) => {
  const asIs = (plain) => ({ ...raw, keyIndex: null, keyGuessed: false, plain });
  if (encryption === "NONE" || encryption === "OPEN") return asIs(false);
  const rawValid = () => looksValid(scanToc(raw.table, dims));
  try {
    if (encryption === "NG") return { ...decryptTocNg(raw, id, keys, dims), plain: false };
    const table = decryptAes(raw.table, keys);
    const names = decryptAes(raw.names, keys);
    const decrypted = { table, names, keyIndex: null, keyGuessed: false, plain: false };
    return looksValid(scanToc(table, dims)) || !rawValid() ? decrypted : asIs(true);
  } catch (error) {
    if (PLAIN_FALLBACK_CODES.has(error.code) && rawValid()) return asIs(true);
    throw error;
  }
};

const readHeader = async (source, name) => {
  if (source.size < HEADER_BYTES) throw brokenError("Архив короче заголовка RPF7.");
  const head = await copyRange(source, 0, HEADER_BYTES);
  const view = viewOf(head);
  const [magic, count, field, code] = [0, 4, 8, 12].map((at) => view.getUint32(at, true));
  if (magic !== RPF7_MAGIC) throw rpfError("RPF_NOT_RPF7", `${name}: это не архив RPF7.`);
  const namesLength = field & 0x0fffffff;
  if (count < 1 || count > MAX_ENTRIES || namesLength > MAX_NAMES) {
    throw brokenError(`${name}: оглавление заявляет невозможные размеры.`);
  }
  return { count, namesLength, nameShift: (field >>> 28) & 7, encryption: ENCRYPTION_BY_CODE.get(code) ?? "NG" };
};

// Таблица записей и блок имён копиями.
const readRawToc = async (source, name, { count, namesLength }) => {
  const raw = { table: await copyRange(source, HEADER_BYTES, count * RECORD_BYTES) };
  raw.names = await copyRange(source, HEADER_BYTES + count * RECORD_BYTES, namesLength);
  if (raw.table.length < count * RECORD_BYTES || raw.names.length < namesLength) {
    throw brokenError(`${name}: архив обрезан на оглавлении.`);
  }
  return raw;
};

const chargeBudget = (budget, limits, name, count) => {
  budget.archives += 1;
  budget.entries += count;
  if (budget.archives > limits.maxTotalArchives) {
    throw rpfError(
      "RPF_TOO_MANY",
      `${name}: в дереве вложенных архивов больше ${limits.maxTotalArchives} архивов — ${GAME_TAIL}`,
    );
  }
  if (budget.entries > limits.maxTotalEntries) {
    throw rpfError("RPF_TOO_MANY", `${name}: во вложенных архивах больше ${limits.maxTotalEntries} записей — ${GAME_TAIL}`);
  }
  return () => {
    budget.archives -= 1;
    budget.entries -= count;
  };
};

// Узлы оглавления: помеченные ловушки пропускаются, остальные разбираются; потом ловушками
// становятся и записи с непригодным именем (кроме корня).
const buildNodes = (view, { count, nameShift }, names, flag, bad) => {
  const traps = new Set(bad);
  const nodes = Array.from({ length: count }, (_, i) => {
    if (traps.has(i)) return undefined;
    const rec = readRecord(view, i);
    if (rec.kind === "binary" && rec.cipher > 1 && rec.cipher !== flag) throw brokenError(RECORD_BROKEN);
    return { rec, name: nameAt(names, rec.nameOffset * 2 ** nameShift) };
  });
  nodes.forEach((node, i) => {
    if (i === 0 || !node || usableName(node.name)) return;
    traps.add(i);
    nodes[i] = undefined;
  });
  return { nodes, traps };
};

// Пустое дерево (почти одни каталоги) и нечитаемый корень отвергаются до построения путей.
const checkTree = (nodes, count, name, limits, refund) => {
  const dirs = nodes.filter((node) => node?.rec.kind === "directory").length;
  if (count >= limits.emptyTreeFrom && (count - dirs) * limits.emptyTreeRatio < count) {
    refund();
    throw rpfError(
      "RPF_EMPTY_TREE",
      `${name}: ${count} записей, и почти все — каталоги без файлов; так настоящий архив не устроен, похоже на ловушку против распаковщиков.`,
    );
  }
  if (nodes[0]?.rec.kind !== "directory") throw brokenError(`${name}: оглавление не читается — архив повреждён.`);
};

// Пути обходом каталогов от корня (по ширине); запись, уже получившая путь, пропускается.
const layOutPaths = (nodes, count, name, prefix, maxPathChars) => {
  const paths = new Array(count);
  paths[0] = "";
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const parent = queue[head];
    const { first, count: span } = nodes[parent].rec;
    if (first + span > count) throw brokenError(`${name}: каталог ссылается за оглавление.`);
    for (let child = first; child < first + span; child++) {
      const node = nodes[child];
      if (!node || paths[child] !== undefined) continue;
      const path = paths[parent] ? `${paths[parent]}/${node.name}` : node.name;
      if (path.length + (prefix ? prefix.length + 1 : 0) > maxPathChars) {
        throw rpfError(
          "RPF_PATH_TOO_LONG",
          `${name}: путь записи длиннее ${maxPathChars} знаков — у настоящих архивов игры такого нет, похоже на ловушку против распаковщиков.`,
        );
      }
      paths[child] = path;
      if (node.rec.kind === "directory") queue.push(child);
    }
  }
  return paths;
};

const ENTRY_FIELDS = {
  directory: () => ({}),
  binary: (rec, flag) => ({
    size: rec.size,
    compressed: rec.stored > 0,
    encrypted: rec.cipher === 1 || rec.cipher === flag,
    storedSize: rec.stored > 0 ? rec.stored : rec.size,
  }),
  resource: (rec) => ({
    systemFlags: rec.systemFlags,
    graphicsFlags: rec.graphicsFlags,
    version: ((rec.systemFlags >>> 28) & 0xf) * 16 + ((rec.graphicsFlags >>> 28) & 0xf),
    storedSize: rec.stored,
  }),
};

// Записи архива: { entry (видимая), rec (сырая запись) } в порядке индексов, без корня и ловушек.
const makeItems = (nodes, paths, flag, name, prefix) =>
  nodes.flatMap((node, i) => {
    if (i === 0 || paths[i] === undefined) return [];
    const { rec } = node;
    const path = prefix ? `${prefix}/${paths[i]}` : paths[i];
    const entry = { path, name: node.name, kind: rec.kind, archive: name, ...ENTRY_FIELDS[rec.kind](rec, flag) };
    return [{ entry, rec }];
  });

// Ресурс с 0xffffff в размере хранения: настоящий размер лежит в первых 16 байтах данных.
const resolveSentinelSizes = async (source, items) => {
  for (const { entry, rec } of items) {
    if (entry.kind !== "resource" || rec.stored !== SENTINEL_SIZE) continue;
    const lead = await source.read(rec.block * BLOCK, 16);
    entry.storedSize = SENTINEL_BYTES.reduce((sum, at, i) => sum | (lead[at] << (8 * i)), 0) >>> 0;
  }
};

// Чтение байтов записей: по виду записи.
const makeReaders = (source, { encryption, keys, inflateRaw }) => {
  const decryptStored = (bytes, entryName, size) =>
    encryption === "AES" ? decryptAes(bytes, keys) : decryptNg(bytes, entryName, size, keys);

  const fetchCopy = async (offset, length, truncatedMessage) => {
    const bytes = await copyRange(source, offset, length);
    if (bytes.length >= length) return bytes;
    throw brokenError(truncatedMessage);
  };

  return {
    directory: ({ entry }) => {
      throw rpfError("RPF_NOT_FILE", `${entry.name} — это папка.`);
    },
    binary: async ({ entry, rec }) => {
      const stored = await fetchCopy(rec.block * BLOCK, entry.storedSize, `${entry.name}: архив обрезан на этом файле.`);
      const bytes = entry.encrypted ? decryptStored(stored, entry.name, entry.size) : stored;
      if (!entry.compressed) return bytes;
      if (typeof inflateRaw !== "function") {
        throw rpfError("RPF_INFLATE_REQUIRED", `${entry.name} сжат: для чтения нужен распаковщик deflate.`);
      }
      return inflateRaw(bytes);
    },
    resource: async ({ entry, rec }) => {
      if (entry.storedSize < 16) throw brokenError(`${entry.name}: запись ресурса пуста.`);
      const body = await fetchCopy(
        rec.block * BLOCK + 16,
        entry.storedSize - 16,
        `${entry.name}: архив обрезан на этом ресурсе.`,
      );
      const isScript = entry.name.toLowerCase().endsWith(".ysc");
      const clear = isScript ? decryptStored(body, entry.name, entry.storedSize) : body;
      const prefix = new DataView(new ArrayBuffer(16));
      [RSC7_MAGIC, entry.version, entry.systemFlags, entry.graphicsFlags].forEach((word, i) => {
        prefix.setUint32(i * 4, word, true);
      });
      const out = new Uint8Array(16 + clear.length);
      out.set(new Uint8Array(prefix.buffer));
      out.set(clear, 16);
      return out;
    },
  };
};

const tocWarnings = ({ label, encryption, plain, flag, trapCount }) =>
  [
    plain && {
      code: "RPF_PLAIN_TOC",
      message: `${label}: шапка называет оглавление зашифрованным (${encryption}), а оно открыто — прочитано как открытое.`,
    },
    flag > 1 && {
      code: "RPF_CIPHER_FLAG",
      message: `${label}: у многих двоичных записей в поле шифра стоит ${flag} — это флаг «зашифровано» (замок; игра читает такие файлы как шифрованные), записи прочитаны, а не пропущены как ловушки.`,
    },
    trapCount > 0 && {
      code: "RPF_LOCKED",
      message: `${label}: в оглавлении ${trapCount} ${trapCount === 1 ? "запись-ловушка пропущена" : "записей-ловушек пропущено"} (с тем, что внутри) — архив «залочен» против распаковщиков (игра его читает), остальное прочитано.`,
    },
  ].filter(Boolean);

const lowerPath = (path) => String(path || "").replaceAll("\\", "/").toLowerCase();

const openArchive = async (source, name, ctx) => {
  const { keys, inflateRaw, limits, budget, depth, prefix } = ctx;
  const header = await readHeader(source, name);
  const { count, encryption } = header;
  const refund = chargeBudget(budget, limits, name, count);

  const raw = await readRawToc(source, name, header);
  const toc = resolveToc(raw, encryption, { name, size: source.size }, keys, header);
  const view = viewOf(toc.table);
  const flag = lockFlagOf(view, count);
  const { nodes, traps } = buildNodes(view, header, toc.names, flag, toc.bad ?? flaggedTraps(toc.table, header));

  checkTree(nodes, count, name, limits, refund);
  let paths;
  try {
    paths = layOutPaths(nodes, count, name, prefix, limits.maxPathChars);
  } catch (error) {
    if (error.code === "RPF_PATH_TOO_LONG") refund();
    throw error;
  }

  const items = makeItems(nodes, paths, flag, name, prefix);
  await resolveSentinelSizes(source, items);

  const lookup = new Map([
    ["", { entry: { name: nodes[0].name, kind: "directory" }, rec: nodes[0].rec }],
    ...items.map((item) => [item.entry.path.toLowerCase(), item]),
  ]);
  const readers = makeReaders(source, { encryption, keys, inflateRaw });

  // Вложенный архив поверх родителя: окно [блок × 512, + размер) с теми же ключами и пределами.
  const openNested = ({ entry, rec }, childBudget) => {
    if (entry.compressed || entry.encrypted) {
      throw brokenError(`${entry.path}: вложенный архив сжат или зашифрован целиком — так игра его не читает.`);
    }
    if (depth + 1 > MAX_DEPTH) throw rpfError("RPF_TOO_DEEP", `${entry.path}: слишком глубокая вложенность архивов.`);
    const child = { ...ctx, budget: childBudget, depth: depth + 1, prefix: entry.path };
    return openArchive(windowOf(source, rec.block * BLOCK, entry.size), entry.name, child);
  };

  const archives = new Map();
  const children = [];
  // Вложенный архив открывается и записывается в запись; при сбое причина остаётся на записи, а результат — null.
  const adopt = async (item) => {
    const { entry } = item;
    try {
      const child = await openNested(item, budget);
      const { encryption: childEncryption, keyIndex, keyGuessed } = child;
      entry.nested = { encryption: childEncryption, entries: child.entries.length, keyIndex, keyGuessed };
      archives.set(entry.path.toLowerCase(), child);
      return child;
    } catch (error) {
      entry.problem = { code: error.code || "RPF_BROKEN", message: error.message };
      return null;
    }
  };
  for (const item of ctx.nested ? items : []) {
    const { entry } = item;
    if (entry.kind !== "binary" || !entry.name.toLowerCase().endsWith(".rpf")) continue;
    const child = await adopt(item);
    if (child !== null) children.push(child);
  }

  const read = async (path) => {
    const key = lowerPath(path).replace(/^\/+/, "");
    const hit = lookup.get(key);
    if (hit) return readers[hit.entry.kind](hit);
    const owner = [...archives].find(([nestedKey]) => key.startsWith(`${nestedKey}/`));
    if (owner) return owner[1].read(path);
    throw rpfError("RPF_NOT_FOUND", `В архиве нет ${path}.`);
  };

  const open = async (path) => {
    const key = lowerPath(path);
    if (archives.has(key)) return archives.get(key);
    const hit = lookup.get(key);
    if (hit?.entry.kind !== "binary") throw rpfError("RPF_NOT_FOUND", `В архиве нет вложенного ${path}.`);
    return openNested(hit, { archives: 0, entries: 0 });
  };

  const warnings = tocWarnings({ label: prefix || name, encryption, plain: toc.plain, flag, trapCount: traps.size });
  const keyFacts = { keyIndex: toc.keyIndex, keyGuessed: toc.keyGuessed };
  return {
    name,
    encryption,
    ...keyFacts,
    size: source.size,
    entries: [...items.map((item) => item.entry), ...children.flatMap((child) => child.entries)],
    archives,
    warnings: [...warnings, ...children.flatMap((child) => child.warnings)],
    tocPlain: toc.plain,
    read,
    open,
  };
};

export const openRpf = async (input, options = {}) => {
  const limits = { ...RPF_LIMITS, ...(options.limits || {}) };
  const { name = "archive.rpf", keys = null, inflateRaw, nested = true } = options;
  const ctx = { keys, inflateRaw, nested, limits, budget: { archives: 0, entries: 0 }, depth: 0, prefix: "" };
  return openArchive(byteSource(input), name, ctx);
};
