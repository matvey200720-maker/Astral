import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  archiveKindOf,
  baseName,
  classifyEntryPath,
  isRpfName,
  joinVirtual,
  safeArchiveEntry,
} from "./entry-path.js";
import { parseOivAssembly } from "./oiv.js";
import { readRpfHeader } from "./rpf-header.js";
import { extractArchive, listArchive } from "./seven-zip.js";

export { archiveKindOf, classifyEntryPath, parseOivAssembly, readRpfHeader, safeArchiveEntry };

export const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 4294967296,
  maxUnpackedBytes: 12884901888,
  maxArchiveEntries: 20000,
  maxFiles: 200000,
  maxDepth: 4,
  maxArchives: 100,
  keepCached: 12,
  listTimeoutMs: 120000,
  extractTimeoutMs: 900000,
  timeoutMs: 1800000,
  diskBytesPerSecond: 4194304,
});

const MARKER_NAME = ".astral-intake";
const MIB = 2 ** 20;
const GIB = 2 ** 30;
const HASH_CHUNK = 4 * MIB;
const RPF_HEADER_BYTES = 16;
const RESOURCE_HEADER_BYTES = 16;
const BODY_CHECK_MAX_ARCHIVE = 134217728;
const UNPACK_ID_LENGTH = 24;
const MAX_PASSWORDS = 8;
const MAX_PASSWORD_LENGTH = 256;
const DISK_SLACK_RATIO = 1.05;
const STALE_TMP_MS = 3600000;
const LOCKED_NAMES_SHOWN = 4;

const SKIPPABLE_NESTED = new Set([
  "PACK_ARCHIVE_ENCRYPTED",
  "PACK_PASSWORD",
  "PACK_ARCHIVE_BROKEN",
  "PACK_ARCHIVE_UNSAFE",
  "PACK_ARCHIVE_TOO_BIG",
  "PACK_ARCHIVE_TOO_MANY",
  "PACK_ARCHIVE_TIMEOUT",
]);
const REPAIRABLE_REFUSALS = new Set(["RPF_KEY_MISMATCH", "RPF_BROKEN"]);
const DEFLATE_FAILURE = /^Z_|invalid |incorrect |unexpected end|too far back/i;

const refusal = (code, message) => Object.assign(new Error(message), { code });

const byPath = (a, b) => {
  if (a.path < b.path) return -1;
  return a.path > b.path ? 1 : 0;
};

const byName = (a, b) => a.name.localeCompare(b.name);

// Обычный Uint8Array поверх буфера Node (byteOffset может быть не нулевым).
const plainBytes = (buffer, length = buffer.length) =>
  new Uint8Array(buffer.buffer, buffer.byteOffset, length);

const gib = (bytes) => Math.round(bytes / GIB);

const attempt = async (job) => {
  try {
    return await job();
  } catch {
    return undefined;
  }
};

const removeTree = (path) => attempt(() => fsp.rm(path, { recursive: true, force: true }));

const passwordCandidates = (passwords, password) => {
  const asList = (value) => (Array.isArray(value) ? value : [value]);
  const usable = (value) =>
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_PASSWORD_LENGTH &&
    !/[\0\r\n]/.test(value);
  const unique = new Set([...asList(passwords), ...asList(password)].filter(usable));
  return [...unique].slice(0, MAX_PASSWORDS);
};

export const extractTimeoutFor = (unpackedBytes, limits) => {
  const floor = limits.extractTimeoutMs;
  if (!(floor > 0)) return 0;
  const bytes = Number(unpackedBytes) || 0;
  const byVolume =
    limits.diskBytesPerSecond > 0 ? Math.ceil(bytes / limits.diskBytesPerSecond) * 1000 : 0;
  return Math.max(floor, byVolume);
};

export const openRandomAccess = async (file) => {
  const handle = await fsp.open(file, "r");
  const { size } = await handle.stat();
  const read = async (offset, length) => {
    const start = Math.max(0, Number(offset) || 0);
    const want = Math.max(0, Math.min(Number(length) || 0, size - start));
    const buffer = Buffer.allocUnsafe(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await handle.read(buffer, got, want - got, start + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    return plainBytes(buffer, got);
  };
  return { size, read, close: () => handle.close() };
};

const readHead = async (file) => {
  const handle = await fsp.open(file, "r");
  try {
    const head = Buffer.alloc(RPF_HEADER_BYTES);
    const { bytesRead } = await handle.read(head, 0, RPF_HEADER_BYTES, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

// Объём из метки кэша; null — метки нет или она пуста.
const readCacheMark = async (dir) => {
  const text = await attempt(() => fsp.readFile(join(dir, MARKER_NAME), "utf8"));
  return text ? Number(text) || 0 : null;
};

const diskRecord = (file, path, stats, container, modifiedMs) => ({
  path,
  size: stats.size,
  modifiedMs,
  container,
  origin: { kind: "disk", file },
  read: async () => plainBytes(await fsp.readFile(file)),
  open: () => openRandomAccess(file),
});

const lockedMessage = (name, locked) => {
  const shown = locked.slice(0, LOCKED_NAMES_SHOWN).map(baseName).join(", ");
  const more = locked.length > LOCKED_NAMES_SHOWN ? "…" : "";
  const counted =
    locked.length === 1
      ? "1 запись с испорченным телом пропущена"
      : `${locked.length} записей с испорченным телом пропущено`;
  return (
    `«${name}»: ${counted} (${shown}${more}) — архив «залочен» против распаковщиков: ` +
    "игра читает копии этих файлов из update.rpf, а эти портят для OpenIV. Остальное прочитано."
  );
};

const entryRefusal = (entry, name, canUnlock) => {
  const verdict = classifyEntryPath(entry.path);
  if (verdict.unsafe) {
    /* Имя, которое Windows понимает иначе, чем написано (поток, имя устройства, хвостовая точка), — не «выход наружу», но архив так же не принимается. */
    const what = verdict.badName ? "содержит файл с недопустимым именем" : "пытается записать файл за пределы своей папки";
    return refusal("PACK_ARCHIVE_UNSAFE", `Архив «${name}» ${what} (${verdict.unsafe}). Такой архив не принимается.`);
  }
  if (entry.link) {
    return refusal(
      "PACK_ARCHIVE_UNSAFE",
      `В архиве «${name}» есть ссылка «${entry.path}» — ссылками из пака выходят за пределы папки, такой архив не принимается.`,
    );
  }
  if (entry.encrypted && !canUnlock) {
    return refusal(
      "PACK_ARCHIVE_ENCRYPTED",
      `Архив «${name}» закрыт паролем — пароль к нему знает только автор.`,
    );
  }
  return null;
};

class IntakeRun {
  constructor(name, options, limits) {
    this.name = name;
    this.limits = limits;
    this.workDir = options.workDir ?? null;
    this.onProgress = options.onProgress;
    this.openRpf = options.openRpf;
    this.rpfKeys = options.rpfKeys ?? null;
    this.repairArchive = options.repairArchive;
    this.passwords = passwordCandidates(options.passwords, options.password);
    this.controller = new AbortController();
    this.files = [];
    this.containers = [];
    this.warnings = [];
    this.sources = [];
    this.ownDirs = new Set();
    this.archiveCount = 0;
    this.unpackedTotal = 0;
    this.closed = false;
    this.startedAt = Date.now();
    this.allowedMs = limits.timeoutMs;
    this.timer = undefined;
  }

  // Срок пака: таймер заводится с остатком и пересоздаётся при продлении.
  armDeadline() {
    if (!(this.limits.timeoutMs > 0)) return;
    clearTimeout(this.timer);
    const left = Math.max(0, this.startedAt + this.allowedMs - Date.now());
    this.timer = setTimeout(() => {
      const minutes = Math.round(this.allowedMs / 60000);
      this.controller.abort(
        refusal("PACK_TIMEOUT", `Разбор «${this.name}» не уложился в ${minutes} мин — остановлен.`),
      );
    }, left);
  }

  extendDeadline(extraMs) {
    if (!(this.limits.timeoutMs > 0) || !(extraMs > 0)) return;
    this.allowedMs += extraMs;
    this.armDeadline();
  }

  check() {
    const { signal } = this.controller;
    if (signal.aborted) throw signal.reason || refusal("PACK_ABORTED", "Разбор остановлен.");
  }

  warn(code, path, message) {
    this.warnings.push({ code, path, message });
  }

  report(event) {
    const { onProgress } = this;
    onProgress?.(event);
  }

  get attempts() {
    return this.passwords.length ? this.passwords : [null];
  }

  async ingest(path, stats) {
    if (stats.isDirectory()) {
      this.containers.push({ path: "", kind: "folder", root: path });
      await this.walk(path, "", "", 0);
      return null;
    }
    if (!stats.isFile()) throw refusal("PACK_SOURCE_MISSING", "Это не файл и не папка.");
    if (archiveKindOf(this.name) && !this.workDir) {
      throw refusal("PACK_SOURCE_UNSUPPORTED", "Распаковка архива требует рабочей папки.");
    }
    if (this.workDir) await fsp.mkdir(resolve(this.workDir), { recursive: true });
    return this.accept(path, this.name, "", 0);
  }

  // Обход без рекурсии: файлы папки по порядку, подпапки — со стека, последняя добавленная первой.
  async walk(root, prefix, container, depth) {
    const pending = [{ dir: root, prefix }];
    while (pending.length > 0) {
      const { dir, prefix: here } = pending.pop();
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort(byName)) {
        const virtual = joinVirtual(here, entry.name);
        const file = join(dir, entry.name);
        if (entry.name === MARKER_NAME || classifyEntryPath(entry.name).junk) continue;
        if (entry.isSymbolicLink()) {
          this.warn("PACK_LINK_SKIPPED", virtual, `«${entry.name}» — ссылка, пропущена.`);
        } else if (entry.isDirectory()) {
          pending.push({ dir: file, prefix: virtual });
        } else if (entry.isFile()) {
          await this.accept(file, virtual, container, depth);
        }
      }
    }
  }

  async accept(file, virtual, container, depth) {
    this.check();
    const stats = await fsp.stat(file);
    if (archiveKindOf(virtual)) {
      const digest = await this.acceptArchive(file, virtual, stats, depth);
      if (digest !== null) return digest;
    } else if (isRpfName(virtual)) {
      await this.acceptGameArchive(file, virtual, stats, container);
      return null;
    }
    if (this.files.length >= this.limits.maxFiles) {
      throw refusal("PACK_TOO_MANY_FILES", "В паке больше файлов, чем бывает в паке модов.");
    }
    this.files.push(diskRecord(file, virtual, stats, container, Math.round(stats.mtimeMs)));
    return null;
  }

  // Digest принятого архива; null — файл остаётся обычным файлом.
  async acceptArchive(file, virtual, stats, depth) {
    if (depth >= this.limits.maxDepth) {
      this.warn(
        "PACK_TOO_DEEP",
        virtual,
        `Архив «${basename(file)}» вложен слишком глубоко — оставлен как есть.`,
      );
      return null;
    }
    try {
      return await this.unpack(file, virtual, stats, depth + 1);
    } catch (error) {
      if (depth > 0 && SKIPPABLE_NESTED.has(error?.code)) {
        this.warn(error.code, virtual, `${error.message} Остальной пак разобран без него.`);
        return null;
      }
      throw error;
    }
  }

  // Остановка проверяется перед каждым куском; короткое чтение — последний кусок.
  async hashFile(file) {
    this.check();
    const handle = await fsp.open(file, "r");
    try {
      const hash = createHash("sha256");
      const chunk = Buffer.allocUnsafe(HASH_CHUNK);
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, HASH_CHUNK, null);
        hash.update(chunk.subarray(0, bytesRead));
        if (bytesRead < HASH_CHUNK) return hash.digest("hex");
        this.check();
      }
    } finally {
      await handle.close();
    }
  }

  addUnpacked(bytes) {
    this.unpackedTotal += bytes;
    if (this.unpackedTotal > this.limits.maxUnpackedBytes) {
      throw refusal("PACK_TOO_BIG", "Пак со всеми вложенными архивами больше допустимого размера.");
    }
  }

  async unpack(file, virtual, stats, depth) {
    const { limits } = this;
    const name = basename(file);
    this.archiveCount += 1;
    if (this.archiveCount > limits.maxArchives) {
      throw refusal(
        "PACK_TOO_MANY_ARCHIVES",
        `В паке больше ${limits.maxArchives} архивов, вложенных друг в друга, — так пак модов не устроен.`,
      );
    }
    if (stats.size > limits.maxArchiveBytes) {
      throw refusal("PACK_ARCHIVE_TOO_BIG", `Архив «${name}» больше ${gib(limits.maxArchiveBytes)} ГБ.`);
    }
    this.report({ phase: "hash", path: name });
    const digest = await this.hashFile(file);
    const dir = join(this.workDir, digest.slice(0, UNPACK_ID_LENGTH));
    const cachedBytes = await readCacheMark(dir);
    const unpackedBytes =
      cachedBytes === null
        ? await this.extractFresh(file, name, dir)
        : await this.reuse(dir, cachedBytes);
    this.ownDirs.add(dir);
    const container = {
      path: virtual,
      kind: archiveKindOf(virtual),
      digest,
      cached: cachedBytes !== null,
      unpackedBytes,
    };
    if (container.kind === "oiv") await this.readAssembly(container, dir, name);
    this.containers.push(container);
    await this.walk(dir, virtual, virtual, depth);
    return digest;
  }

  async reuse(dir, cachedBytes) {
    const now = new Date();
    await attempt(() => fsp.utimes(dir, now, now));
    this.addUnpacked(cachedBytes);
    return cachedBytes;
  }

  async readAssembly(container, dir, name) {
    const text = await attempt(() => fsp.readFile(join(dir, "assembly.xml"), "utf8"));
    if (text) {
      container.oiv = parseOivAssembly(text);
      return;
    }
    this.warn(
      "PACK_OIV_WITHOUT_ASSEMBLY",
      container.path,
      `В «${name}» нет assembly.xml — куда ставятся файлы, неизвестно.`,
    );
  }

  async openListing(file) {
    const { attempts } = this;
    for (let at = 0; ; at += 1) {
      try {
        const listing = await listArchive(file, {
          signal: this.controller.signal,
          timeoutMs: this.limits.listTimeoutMs,
          password: attempts[at],
        });
        return { entries: listing.entries, firstGood: at };
      } catch (error) {
        if (error?.code !== "PACK_PASSWORD" || at + 1 >= attempts.length) throw error;
      }
    }
  }

  // Проверки по оглавлению до записи первого байта; возвращает сумму размеров.
  vetEntries(entries, name) {
    const { limits } = this;
    const fileCount = entries.filter((entry) => !entry.folder).length;
    if (fileCount > limits.maxArchiveEntries) {
      throw refusal(
        "PACK_ARCHIVE_TOO_MANY",
        `В архиве «${name}» ${fileCount} файлов — больше, чем бывает в паке модов.`,
      );
    }
    for (const entry of entries) {
      const refused = entryRefusal(entry, name, this.passwords.length > 0);
      if (refused) throw refused;
    }
    const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (bytes > limits.maxUnpackedBytes) {
      throw refusal(
        "PACK_ARCHIVE_TOO_BIG",
        `Архив «${name}» распакуется в ${gib(bytes)} ГБ — больше допустимого.`,
      );
    }
    return bytes;
  }

  async extractFresh(file, name, dir) {
    this.report({ phase: "list", path: name });
    const { entries, firstGood } = await this.openListing(file);
    const bytes = this.vetEntries(entries, name);
    this.addUnpacked(bytes);
    await removeTree(dir);
    const tmp = `${dir}.${process.pid}.${randomUUID()}.tmp`;
    await fsp.mkdir(tmp, { recursive: true });
    try {
      this.report({ phase: "extract", path: name, bytes });
      const extractMs = extractTimeoutFor(bytes, this.limits);
      this.extendDeadline(extractMs - this.limits.extractTimeoutMs);
      await this.extractInto(file, tmp, extractMs, firstGood);
      await this.verifyOnDisk(tmp, bytes, name);
      await fsp.writeFile(join(tmp, MARKER_NAME), `${bytes}\n`);
      await fsp.rename(tmp, dir);
    } catch (error) {
      await removeTree(tmp);
      throw error;
    }
    return bytes;
  }

  async extractInto(file, tmp, timeoutMs, firstGood) {
    const { attempts } = this;
    for (let at = firstGood; ; at += 1) {
      try {
        await extractArchive(file, tmp, {
          signal: this.controller.signal,
          timeoutMs,
          password: attempts[at],
        });
        return;
      } catch (error) {
        if (error?.code !== "PACK_PASSWORD" || at + 1 >= attempts.length) throw error;
        await fsp.rm(tmp, { recursive: true, force: true });
        await fsp.mkdir(tmp, { recursive: true });
      }
    }
  }

  // Что реально легло на диск: только обычные файлы, суммарно не больше обещанного оглавлением.
  async verifyOnDisk(root, promised, name) {
    const unsafe = (message) => refusal("PACK_ARCHIVE_UNSAFE", `Архив «${name}» ${message}`);
    let onDisk = 0;
    const pending = [root];
    while (pending.length > 0) {
      const dir = pending.pop();
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          throw unsafe("оставил после распаковки ссылку — такой архив не принимается.");
        }
        if (entry.isDirectory()) pending.push(full);
        else if (entry.isFile()) onDisk += (await fsp.stat(full)).size;
        else throw unsafe(`оставил после распаковки не обычный файл «${entry.name}».`);
      }
    }
    if (onDisk > promised * DISK_SLACK_RATIO + MIB) {
      throw unsafe(
        `распаковался в ${Math.round(onDisk / MIB)} МБ при ${Math.round(promised / MIB)} МБ в оглавлении — такой архив не принимается.`,
      );
    }
  }

  async track(file) {
    const source = await openRandomAccess(file);
    this.sources.push(source);
    return source;
  }

  openGameSource(source, name) {
    const { openRpf, rpfKeys } = this;
    return openRpf(source, { name, keys: rpfKeys });
  }

  async requestRepair(file, name, size) {
    const { repairArchive } = this;
    try {
      return await repairArchive(file, { name, size, signal: this.controller.signal });
    } catch (error) {
      return { unavailable: true, reason: error?.message || String(error) };
    }
  }

  async acceptGameArchive(file, virtual, stats, container) {
    const name = basename(file);
    const header = readRpfHeader(await readHead(file));
    const record = {
      path: virtual,
      kind: "rpf",
      parent: container,
      size: stats.size,
      encryption: header?.encryption ?? null,
      entryCount: header?.entryCount ?? null,
      opened: false,
    };
    this.containers.push(record);
    this.files.push(diskRecord(file, virtual, stats, container, 0));
    if (!header) {
      this.warn("PACK_RPF_NOT_RPF7", virtual, `«${name}» назван .rpf, но это не архив RPF7.`);
      return;
    }
    if (!this.openRpf) {
      this.warn(
        "PACK_RPF_UNREAD",
        virtual,
        `Содержимое «${name}» не раскрыто: читатель архивов игры не подключён.`,
      );
      return;
    }
    const archive = await this.openGameArchive(file, virtual, stats.size);
    if (!archive) return;
    record.opened = true;
    record.encryption = String(archive.encryption || record.encryption || "").toLowerCase();
    for (const note of archive.warnings ?? []) {
      this.warn(note?.code || "PACK_RPF_NOTE", virtual, note?.message);
    }
    await this.listGameEntries(archive, virtual, name);
  }

  // Открывает архив игры; при отказе пробует починку и пишет замечание. Без архива — null.
  async openGameArchive(file, virtual, size) {
    const name = basename(file);
    const source = await this.track(file);
    let failure;
    try {
      this.report({ phase: "rpf", path: virtual });
      return await this.openGameSource(source, name);
    } catch (error) {
      failure = error;
    }
    let unavailableNote = "";
    if (this.repairArchive && REPAIRABLE_REFUSALS.has(failure?.code)) {
      const repaired = await this.requestRepair(file, name, size);
      if (repaired?.file) {
        try {
          const archive = await this.openGameSource(await this.track(repaired.file), name);
          const note = repaired.note || "оглавление починено на копии";
          this.warn("PACK_RPF_FIXED", virtual, `«${name}»: ${note}.`);
          return archive;
        } catch (error) {
          failure = error;
        }
      } else if (repaired?.unavailable) {
        unavailableNote = ` (починка шапки не вышла: ${repaired.reason})`;
      }
    }
    const reason = failure?.message || failure;
    this.warn(
      failure?.code || "PACK_RPF_UNREAD",
      virtual,
      `«${name}» не открылся: ${reason}${unavailableNote}`,
    );
    return null;
  }

  // Тело записи читается ровно настолько, чтобы заметить «замок» против распаковщиков.
  async bodyIsBroken(archive, entry, inner) {
    try {
      if (entry.kind === "resource" && (Number(archive.size) || 0) <= BODY_CHECK_MAX_ARCHIVE) {
        inflateRawSync((await archive.read(inner)).subarray(RESOURCE_HEADER_BYTES));
      } else if (entry.kind === "binary" && entry.compressed) {
        await archive.read(inner);
      }
      return false;
    } catch (error) {
      return DEFLATE_FAILURE.test(`${error?.code ?? ""} ${error?.message ?? ""}`);
    }
  }

  async listGameEntries(archive, virtual, name) {
    const locked = [];
    for (const entry of archive.entries ?? []) {
      if (entry.kind === "directory" || entry.directory) continue;
      const inner = String(entry.path || "").replaceAll("\\", "/");
      if (!inner) continue;
      if (await this.bodyIsBroken(archive, entry, inner)) {
        locked.push(inner);
        continue;
      }
      const path = joinVirtual(virtual, inner);
      const size = Number(entry.storedSize ?? entry.size ?? 0) || 0;
      if (entry.nested || isRpfName(inner)) {
        this.containers.push({ path, kind: "rpf", parent: virtual, size, opened: !entry.problem });
        if (entry.problem) {
          const { problem } = entry;
          this.warn(
            "PACK_RPF_UNREAD",
            path,
            `«${baseName(inner)}» внутри «${name}» не открылся: ${problem.message || problem.code || problem}`,
          );
        }
      }
      this.files.push({
        path,
        size,
        container: virtual,
        origin: { kind: "rpf", container: virtual, entry: inner },
        resource: entry.kind === "resource" || Boolean(entry.resource),
        ...(entry.version === undefined ? {} : { version: entry.version }),
        read: () => archive.read(inner),
      });
    }
    if (locked.length > 0) {
      this.warnings.push({
        code: "RPF_ENTRY_LOCKED",
        path: virtual,
        lockedEntries: locked,
        message: lockedMessage(name, locked),
      });
    }
  }

  async sweepCache() {
    const root = this.workDir;
    const listed = await attempt(() => fsp.readdir(root, { withFileTypes: true }));
    if (!listed) return;
    const kept = [];
    for (const entry of listed.filter((item) => item.isDirectory())) {
      const path = join(root, entry.name);
      const info = await attempt(() => fsp.stat(path));
      if (!info) continue;
      if (entry.name.endsWith(".tmp")) {
        if (Date.now() - info.mtimeMs > STALE_TMP_MS) await removeTree(path);
      } else if (!this.ownDirs.has(path)) {
        kept.push({ path, mtimeMs: info.mtimeMs });
      }
    }
    kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const spare = Math.max(0, this.limits.keepCached - this.ownDirs.size);
    for (const { path } of kept.slice(spare)) {
      await removeTree(path);
    }
  }

  async closeSources() {
    if (this.closed) return;
    this.closed = true;
    for (const source of this.sources) await attempt(() => source.close());
  }

  outcome(digest) {
    return {
      name: this.name,
      digest,
      files: this.files.sort(byPath),
      containers: this.containers.sort(byPath),
      warnings: this.warnings,
      close: () => this.closeSources(),
    };
  }
}

const locateSource = async (source) => {
  const text = String(source || "");
  if (!text || !isAbsolute(text)) {
    throw refusal("PACK_SOURCE_MISSING", "Нужен абсолютный путь к паку.");
  }
  const path = resolve(text);
  let stats;
  try {
    stats = await fsp.lstat(path);
  } catch {
    throw refusal("PACK_SOURCE_MISSING", "Файл или папка не найдены.");
  }
  if (stats.isSymbolicLink()) {
    throw refusal(
      "PACK_SOURCE_MISSING",
      "Ссылка как источник пака не принимается — покажите сам файл или папку.",
    );
  }
  return { path, stats };
};

export async function intakePack(source, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const { signal } = options;
  const { path, stats } = await locateSource(source);
  const run = new IntakeRun(basename(path), options, limits);
  const forward = () => run.controller.abort(signal.reason);
  try {
    if (signal?.aborted) forward();
    else signal?.addEventListener("abort", forward, { once: true });
    run.armDeadline();
    const digest = await run.ingest(path, stats);
    if (run.files.length === 0) throw refusal("PACK_EMPTY", "В паке нет ни одного файла.");
    if (run.workDir) await run.sweepCache();
    return run.outcome(digest);
  } catch (error) {
    await run.closeSources();
    throw error;
  } finally {
    clearTimeout(run.timer);
    signal?.removeEventListener("abort", forward);
  }
}
