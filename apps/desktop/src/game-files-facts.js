import { open, stat } from "node:fs/promises";
import { join } from "node:path";

const HEAD_BYTES = 4096;
const RESOURCE_CAP = 16 * 1024 * 1024;
const MIN_IMAGE = 64;
const PE_HEADER_SPAN = 24;
const SECTION_RECORD = 40;
const FIXED_INFO_MIN = 16;
const MAGIC_MZ = 0x5a4d;
const MAGIC_PE = 0x00004550;
const VERSION_SIGNATURE = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);

// Поля заголовков: [смещение от базы, ширина в байтах], числа little-endian без знака.
const DOS_FIELDS = { magic: [0x00, 2], peOffset: [0x3c, 4] };
const PE_FIELDS = { signature: [0x00, 4], sectionCount: [0x06, 2], optionalSize: [0x14, 2] };
const SECTION_FIELDS = { rawSize: [0x10, 4], rawPtr: [0x14, 4] };

async function readChunk(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return { buffer, filled: bytesRead };
}

class HeadReader {
  constructor({ buffer, filled }) {
    this.buffer = buffer;
    this.filled = filled;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  field(base, [offset, width]) {
    const at = base + offset;
    return width === 2 ? this.view.getUint16(at, true) : this.view.getUint32(at, true);
  }

  // Имя раздела — 8 байт латиницей без нулей на конце.
  sectionName(at) {
    return this.buffer.toString("latin1", at, at + 8).replace(/\0+$/, "");
  }
}

const isDosImage = (head) => head.filled >= MIN_IMAGE && head.field(0, DOS_FIELDS.magic) === MAGIC_MZ;
const hasPeHeader = (head, pe) => (
  pe + PE_HEADER_SPAN <= head.filled && head.field(pe, PE_FIELDS.signature) === MAGIC_PE
);

// Записи разделов, целиком уместившиеся в первых 4096 байтах.
const recordOffsets = (tableAt, declared) => Array.from({ length: declared }, (_, i) => tableAt + i * SECTION_RECORD)
  .filter((at) => at + SECTION_RECORD <= HEAD_BYTES);

// Первый раздел .rsrc решает исход: { size, position } или null.
function resourceSpan(head) {
  if (!isDosImage(head)) return null;
  const pe = head.field(0, DOS_FIELDS.peOffset);
  if (!hasPeHeader(head, pe)) return null;

  const tableAt = pe + PE_HEADER_SPAN + head.field(pe, PE_FIELDS.optionalSize);
  const rsrcAt = recordOffsets(tableAt, head.field(pe, PE_FIELDS.sectionCount))
    .find((at) => head.sectionName(at) === ".rsrc");
  if (rsrcAt === undefined) return null;
  return {
    size: Math.min(head.field(rsrcAt, SECTION_FIELDS.rawSize), RESOURCE_CAP),
    position: head.field(rsrcAt, SECTION_FIELDS.rawPtr),
  };
}

// Версия — по первому вхождению подписи VS_FIXEDFILEINFO в сыром разделе.
function fixedFileVersion({ buffer, filled }) {
  const content = buffer.subarray(0, filled);
  const at = content.indexOf(VERSION_SIGNATURE);
  if (at < 0 || content.length - at < FIXED_INFO_MIN) return null;
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const dotted = (word) => `${word >>> 16}.${word & 0xffff}`;
  return `${dotted(view.getUint32(at + 8, true))}.${dotted(view.getUint32(at + 12, true))}`;
}

export async function readExeFileVersion(file) {
  const handle = await open(file, "r");
  try {
    const span = resourceSpan(new HeadReader(await readChunk(handle, HEAD_BYTES, 0)));
    if (span === null) return null;
    return fixedFileVersion(await readChunk(handle, span.size, span.position));
  } finally {
    await handle.close();
  }
}

const describeFile = ({ size, mtimeMs }) => ({ bytes: size, modified: new Date(mtimeMs).toISOString() });
const probeFile = (target) => stat(target).then(describeFile, () => null);

export async function describeGameFiles(gameRoot) {
  const targets = {
    exe: join(gameRoot, "GTA5.exe"),
    enhancedExe: join(gameRoot, "GTA5_Enhanced.exe"),
    update: join(gameRoot, "update", "update.rpf"),
    modsUpdate: join(gameRoot, "mods", "update", "update.rpf"),
  };
  const found = Object.fromEntries(await Promise.all(
    Object.entries(targets).map(async ([key, target]) => [key, await probeFile(target)]),
  ));
  const exeVersion = found.exe === null ? null : await readExeFileVersion(targets.exe).catch(() => null);
  return {
    exe: found.exe,
    exeVersion,
    enhancedExe: found.enhancedExe !== null,
    update: found.update,
    modsUpdate: found.modsUpdate,
  };
}

const rpfText = (label, entry) => (
  entry ? `${label} ${entry.bytes} bytes, modified ${entry.modified}` : `${label} absent`
);

// Части строки по порядку; null — часть пропускается.
const LINE_PARTS = [
  (root) => `game files at ${root}`,
  (root, facts) => (
    facts.exe
      ? `GTA5.exe ${facts.exeVersion || "version unknown"}, ${facts.exe.bytes} bytes`
      : "GTA5.exe absent"
  ),
  (root, facts) => rpfText("update/update.rpf", facts.update),
  (root, facts) => rpfText("mods/update/update.rpf", facts.modsUpdate),
  (root, facts) => (facts.enhancedExe ? "GTA5_Enhanced.exe present" : null),
];

export function gameFilesLine(gameRoot, facts) {
  return LINE_PARTS
    .map((part) => part(gameRoot, facts))
    .filter((text) => text !== null)
    .join("; ");
}

// Состояние на весь сеанс: папка запоминается при первой встрече, ещё до записи в журнал.
class SeenFolders {
  constructor() {
    this.keys = new Set();
  }

  firstTime(path) {
    const key = path.toLowerCase();
    if (!path || this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
}

const seenFolders = new SeenFolders();

function* unseenFolders(games) {
  for (const game of games) {
    const root = typeof game?.path === "string" ? game.path : "";
    if (seenFolders.firstTime(root)) yield root;
  }
}

const logEntry = (level, message) => ({ level, source: "game", message });
const reasonOf = (error) => error?.message || String(error);

async function logFolder(root, record) {
  try {
    const facts = await describeGameFiles(root);
    record(logEntry("info", gameFilesLine(root, facts)));
  } catch (error) {
    record(logEntry("warn", `game files at ${root}: ${reasonOf(error)}`));
  }
}

export async function noteGameFiles(games, record) {
  if (!Array.isArray(games)) return;
  for (const root of unseenFolders(games)) {
    await logFolder(root, record);
  }
}
