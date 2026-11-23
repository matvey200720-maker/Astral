import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_PROJECT_ARCHIVE_BYTES = 192 * 1024 * 1024;
const SAFE_PROJECT_ID = /^astral-[a-z0-9][a-z0-9-]{1,90}$/;
const SAFE_MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SUPPORTED_TARGETS = new Set(["gta5-legacy-story", "gta5-enhanced-story", "fivem"]);

function archiveBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Снимок проекта должен быть передан как бинарные данные.");
}

function directChild(parent, name) {
  const root = path.resolve(parent);
  const child = path.resolve(root, name);
  if (path.dirname(child) !== root) throw new Error("Небезопасный путь папки проекта.");
  return child;
}

async function info(value) {
  try {
    return await fs.lstat(value);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function hasZipEnd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 4; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return true;
  }
  return false;
}

function normalizeMetadata(input) {
  const projectId = String(input?.projectId || "").toLowerCase();
  if (!SAFE_PROJECT_ID.test(projectId)) throw new Error("Некорректный идентификатор проекта Мастерской.");
  const projectName = String(input?.projectName || "").trim();
  if (!projectName || projectName.length > 100 || [...projectName].some((character) => character.charCodeAt(0) < 32)) throw new Error("Некорректное название проекта Мастерской.");
  const target = String(input?.target || "");
  if (!SUPPORTED_TARGETS.has(target)) throw new Error("Неизвестная платформа проекта Мастерской.");
  const moduleIds = Array.isArray(input?.moduleIds) ? [...new Set(input.moduleIds.map(String))] : [];
  if (!moduleIds.length || moduleIds.length > 32 || moduleIds.some((id) => !SAFE_MODULE_ID.test(id))) throw new Error("Некорректный список модулей проекта Мастерской.");
  const assetCount = Number(input?.assetCount || 0);
  if (!Number.isInteger(assetCount) || assetCount < 0 || assetCount > 512) throw new Error("Некорректное количество assets проекта Мастерской.");
  return { projectId, projectName, target, moduleIds, assetCount };
}

export async function syncWorkshopProjectFolder(input, { projectsRoot }) {
  const metadata = normalizeMetadata(input);
  const bytes = archiveBytes(input?.archive);
  if (bytes.length < 22 || bytes.length > MAX_PROJECT_ARCHIVE_BYTES) throw new Error("Размер снимка проекта выходит за безопасный лимит 192 МБ.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || !hasZipEnd(bytes)) throw new Error("Снимок проекта не является корректным astralpack ZIP.");

  const root = path.resolve(String(projectsRoot || ""));
  await fs.mkdir(root, { recursive: true });
  const rootInfo = await info(root);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Хранилище проектов ASTRAL недоступно.");

  const nonce = crypto.randomBytes(6).toString("hex");
  const targetPath = directChild(root, metadata.projectId);
  const stagingPath = directChild(root, `.stage-${metadata.projectId}-${nonce}`);
  const retiredPath = directChild(root, `.previous-${metadata.projectId}-${nonce}`);
  const existing = await info(targetPath);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error("Папка проекта ASTRAL заменена небезопасным объектом.");

  const archiveHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    format: "astral-workshop-folder",
    version: 1,
    projectId: metadata.projectId,
    name: metadata.projectName,
    target: metadata.target,
    modules: metadata.moduleIds,
    assetCount: metadata.assetCount,
    archive: "project.astralpack",
    archiveBytes: bytes.length,
    archiveSha256: archiveHash,
    syncedAt: new Date().toISOString(),
  };
  let retired = false;
  try {
    await fs.mkdir(stagingPath);
    await fs.writeFile(path.join(stagingPath, "project.astralpack"), bytes, { flag: "wx" });
    await fs.writeFile(path.join(stagingPath, "manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
    await fs.writeFile(path.join(stagingPath, "README.txt"), [
      "ASTRAL Workshop project folder",
      "",
      "project.astralpack is the complete portable project snapshot, including validated assets and checksums.",
      "Import it through ASTRAL Workshop. Files in this folder are never executed automatically.",
    ].join("\n"), { encoding: "utf8", flag: "wx" });
    if (existing) {
      await fs.rename(targetPath, retiredPath);
      retired = true;
    }
    await fs.rename(stagingPath, targetPath);
    if (retired) await fs.rm(retiredPath, { recursive: true, force: true }).catch(() => {});
    return {
      projectPath: targetPath,
      archivePath: path.join(targetPath, "project.astralpack"),
      manifest,
    };
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    if (retired && !(await info(targetPath))) await fs.rename(retiredPath, targetPath).catch(() => {});
    throw error;
  }
}

export const WORKSHOP_PROJECT_FOLDER_LIMITS = Object.freeze({
  maxArchiveBytes: MAX_PROJECT_ARCHIVE_BYTES,
});
