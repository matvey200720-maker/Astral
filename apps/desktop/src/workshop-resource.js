import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 256;
const SAFE_RESOURCE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

function archiveBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Архив FiveM должен быть передан как бинарные данные.");
}

function normalizeResourceName(value) {
  const name = String(value || "").toLowerCase();
  if (!SAFE_RESOURCE_NAME.test(name)) {
    throw new Error("Некорректное имя FiveM resource.");
  }
  return name;
}

function safeArchivePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    return false;
  }
  return !normalized
    .split("/")
    .some((part) => !part || part === "." || part === "..");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseStoredResourceZip(raw, expectedResourceName) {
  const bytes = archiveBytes(raw);
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error("Размер архива FiveM выходит за безопасный лимит 128 МБ.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  let totalBytes = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (files.size >= MAX_ENTRIES || offset + 30 > bytes.length) {
      throw new Error("Архив FiveM повреждён или содержит слишком много файлов.");
    }
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const expectedCrc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x08) || compression !== 0) {
      throw new Error("ASTRAL принимает только проверяемые ZIP без сжатия и data descriptor.");
    }
    if (size > MAX_ENTRY_BYTES) throw new Error("Один из файлов resource превышает 64 МБ.");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error("Архив FiveM обрезан.");
    const archivePath = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (!safeArchivePath(archivePath)) throw new Error("Архив содержит небезопасный путь.");
    const [root, ...relativeParts] = archivePath.split("/");
    if (root !== expectedResourceName || !relativeParts.length) {
      throw new Error("Архив пытается записать файл вне выбранного FiveM resource.");
    }
    const relativePath = relativeParts.join("/");
    if (files.has(relativePath)) throw new Error(`Архив содержит дубликат: ${relativePath}`);
    const data = bytes.slice(dataStart, dataEnd);
    if (crc32(data) !== expectedCrc) throw new Error(`Повреждён файл: ${relativePath}`);
    totalBytes += data.length;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error("Распакованный resource превышает 128 МБ.");
    files.set(relativePath, data);
    offset = dataEnd;
  }
  for (const required of ["fxmanifest.lua", "client/astral_workshop.lua", "data/workshop.json"]) {
    if (!files.has(required)) throw new Error(`В resource отсутствует обязательный файл: ${required}`);
  }
  if (!files.size) throw new Error("Архив FiveM не содержит файлов.");
  return { files, totalBytes };
}

function directChild(parent, child) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  if (path.dirname(childPath) !== parentPath) {
    throw new Error("Небезопасный путь операции с FiveM resource.");
  }
  return childPath;
}

async function exists(value) {
  try {
    return await fs.lstat(value);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function directoryBytes(root) {
  const info = await exists(root);
  if (!info) return 0;
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Существующий FiveM resource должен быть обычной папкой.");
  }
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Существующий resource содержит символическую ссылку.");
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
}

async function writeResourceFiles(root, files) {
  for (const [relativePath, bytes] of files) {
    const target = path.resolve(root, ...relativePath.split("/"));
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error("Небезопасный путь файла при распаковке resource.");
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" });
  }
}

async function availableBytes(root) {
  try {
    const stats = await fs.statfs(root, { bigint: true });
    const value = stats.bavail * stats.bsize;
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
  } catch {
    return null;
  }
}

function operationId() {
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

async function appendLog(logPath, step, detail = {}) {
  await fs.appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), step, ...detail })}\n`, "utf8");
}

function recordPath(recordsRoot, id) {
  if (!/^[0-9]{10,}-[a-f0-9]{12}$/.test(String(id || ""))) {
    throw new Error("Некорректный идентификатор установки.");
  }
  return directChild(recordsRoot, path.join(recordsRoot, `${id}.json`));
}

export async function planFiveMResource({ archive, resourceName, resourcesRoot }) {
  const name = normalizeResourceName(resourceName);
  const root = path.resolve(String(resourcesRoot || ""));
  const rootInfo = await exists(root);
  if (!path.isAbsolute(root) || !rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Выберите существующую папку resources FiveM.");
  }
  const parsed = parseStoredResourceZip(archive, name);
  const targetPath = directChild(root, path.join(root, name));
  const targetInfo = await exists(targetPath);
  const currentBytes = await directoryBytes(targetPath);
  const freeBytes = await availableBytes(root);
  const requiredBytes = parsed.totalBytes * 2 + currentBytes;
  return {
    resourceName: name,
    resourcesRoot: root,
    targetPath,
    fileCount: parsed.files.size,
    totalBytes: parsed.totalBytes,
    currentBytes,
    requiredBytes,
    freeBytes,
    existing: Boolean(targetInfo),
    enoughSpace: freeBytes === null || freeBytes >= requiredBytes,
  };
}

export async function applyFiveMResource(input, { backupRoot, recordsRoot, onProgress = () => {} }) {
  const plan = await planFiveMResource(input);
  if (!plan.enoughSpace) throw new Error("Недостаточно свободного места для backup и безопасной установки.");
  const parsed = parseStoredResourceZip(input.archive, plan.resourceName);
  const id = operationId();
  const stagingName = `.astral-stage-${id}`;
  const retiredName = `.astral-previous-${id}`;
  const stagingRoot = directChild(plan.resourcesRoot, path.join(plan.resourcesRoot, stagingName));
  const stagedResource = directChild(stagingRoot, path.join(stagingRoot, plan.resourceName));
  const retiredPath = directChild(plan.resourcesRoot, path.join(plan.resourcesRoot, retiredName));
  const backupDirectory = path.join(path.resolve(backupRoot), plan.resourceName, id);
  const backupResource = path.join(backupDirectory, "resource");
  const logPath = path.join(backupDirectory, "operation.jsonl");
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.mkdir(recordsRoot, { recursive: true });
  await appendLog(logPath, "validated", { fileCount: plan.fileCount, bytes: plan.totalBytes });
  onProgress({ operationId: id, phase: "backup", progress: 18, message: "Создание резервной копии" });
  let movedPrevious = false;
  let installedNew = false;
  try {
    if (plan.existing) {
      await fs.cp(plan.targetPath, backupResource, { recursive: true, errorOnExist: true });
      await appendLog(logPath, "backup-created", { bytes: plan.currentBytes });
    } else {
      await appendLog(logPath, "backup-empty");
    }
    onProgress({ operationId: id, phase: "staging", progress: 42, message: "Подготовка файлов во временной папке" });
    await fs.mkdir(stagedResource, { recursive: true });
    await writeResourceFiles(stagedResource, parsed.files);
    await appendLog(logPath, "staged", { files: [...parsed.files].map(([file, bytes]) => ({ file, size: bytes.length, sha256: sha256(bytes) })) });
    onProgress({ operationId: id, phase: "switch", progress: 72, message: "Атомарное переключение resource" });
    if (plan.existing) {
      await fs.rename(plan.targetPath, retiredPath);
      movedPrevious = true;
    }
    await fs.rename(stagedResource, plan.targetPath);
    installedNew = true;
    const record = {
      format: "astral-workshop-install",
      version: 1,
      installId: id,
      resourceName: plan.resourceName,
      resourcesRoot: plan.resourcesRoot,
      targetPath: plan.targetPath,
      backupResource: plan.existing ? backupResource : null,
      existedBefore: plan.existing,
      logPath,
      createdAt: new Date().toISOString(),
      status: "active",
      files: [...parsed.files].map(([file, bytes]) => ({ file, size: bytes.length, sha256: sha256(bytes) })),
    };
    await appendLog(logPath, "completed", { targetPath: plan.targetPath });
    await fs.writeFile(recordPath(recordsRoot, id), JSON.stringify(record, null, 2), { flag: "wx" });
    if (movedPrevious) await fs.rm(retiredPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    onProgress({ operationId: id, phase: "complete", progress: 100, message: "FiveM resource применён" });
    return record;
  } catch (error) {
    await appendLog(logPath, "failed", { error: String(error?.message || error) }).catch(() => {});
    await fs.rm(recordPath(recordsRoot, id), { force: true }).catch(() => {});
    if (installedNew) await fs.rm(plan.targetPath, { recursive: true, force: true }).catch(() => {});
    if (movedPrevious) await fs.rename(retiredPath, plan.targetPath).catch(() => {});
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    onProgress({ operationId: id, phase: "rolled-back", progress: 100, message: "Ошибка устранена автоматическим откатом" });
    throw error;
  }
}

export async function rollbackFiveMResource({ installId }, { recordsRoot, onProgress = () => {} }) {
  const storedPath = recordPath(recordsRoot, installId);
  const record = JSON.parse(await fs.readFile(storedPath, "utf8"));
  if (record?.format !== "astral-workshop-install" || record.version !== 1 || record.status !== "active") {
    throw new Error("Эта установка уже откачена или её журнал повреждён.");
  }
  const targetPath = directChild(record.resourcesRoot, record.targetPath);
  const currentInfo = await exists(targetPath);
  if (currentInfo?.isSymbolicLink()) throw new Error("Текущий resource заменён символической ссылкой; откат остановлен.");
  const retiredPath = directChild(record.resourcesRoot, path.join(record.resourcesRoot, `.astral-rollback-${record.installId}`));
  const stagedPath = directChild(record.resourcesRoot, path.join(record.resourcesRoot, `.astral-restore-${record.installId}`));
  onProgress({ operationId: record.installId, phase: "rollback", progress: 20, message: "Проверка резервной копии" });
  let movedCurrent = false;
  try {
    if (record.existedBefore) {
      const backupInfo = await exists(record.backupResource);
      if (!backupInfo?.isDirectory() || backupInfo.isSymbolicLink()) throw new Error("Резервная копия недоступна.");
      await fs.cp(record.backupResource, stagedPath, { recursive: true, errorOnExist: true });
    }
    if (currentInfo) {
      await fs.rename(targetPath, retiredPath);
      movedCurrent = true;
    }
    if (record.existedBefore) await fs.rename(stagedPath, targetPath);
    await appendLog(record.logPath, "manual-rollback-complete");
    record.status = "rolled-back";
    record.rolledBackAt = new Date().toISOString();
    await fs.writeFile(storedPath, JSON.stringify(record, null, 2));
    if (movedCurrent) await fs.rm(retiredPath, { recursive: true, force: true }).catch(() => {});
    onProgress({ operationId: record.installId, phase: "complete", progress: 100, message: "Резервная копия восстановлена" });
    return record;
  } catch (error) {
    if (record.existedBefore) await fs.rm(stagedPath, { recursive: true, force: true }).catch(() => {});
    if (movedCurrent && !(await exists(targetPath))) await fs.rename(retiredPath, targetPath).catch(() => {});
    await appendLog(record.logPath, "manual-rollback-failed", { error: String(error?.message || error) }).catch(() => {});
    throw error;
  }
}

export async function resolveFiveMResourcePath(
  { installId, kind },
  { recordsRoot },
) {
  const record = JSON.parse(
    await fs.readFile(recordPath(recordsRoot, installId), "utf8"),
  );
  if (record?.format !== "astral-workshop-install" || record.version !== 1) {
    throw new Error("Журнал установки Мастерской повреждён.");
  }
  const target = kind === "log" ? record.logPath : record.targetPath;
  if (!target || !["resource", "log"].includes(kind)) {
    throw new Error("Неизвестный путь Мастерской.");
  }
  const info = await exists(target);
  if (!info || info.isSymbolicLink()) {
    throw new Error("Файл или папка больше недоступны.");
  }
  return path.resolve(target);
}

export const WORKSHOP_RESOURCE_LIMITS = Object.freeze({
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  maxEntryBytes: MAX_ENTRY_BYTES,
  maxEntries: MAX_ENTRIES,
});
