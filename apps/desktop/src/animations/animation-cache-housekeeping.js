/*
 * Уборка кэшей «Анимаций» (ревью 14.11.2026, п. 7; диск ПК владельца почти полон): словари проектов, дорожки клипов и временные папки слоёв не должны расти без предела.
 *
 *   — `animations/project/<sha256>.ycd` — скачанные словари проектов: потолок 128 МБ, уходят самые давние; обрывки `*.part.ycd` после упавшей загрузки старше часа — сразу;
 *   — `animations/<хэш игры>/tracks/*.bin` — готовые дорожки клипов: потолок 256 МБ на все игры, уходят самые давние (клип снимется заново за секунду);
 *   — `%TEMP%/astral-anim-layers-*` — временные папки слоёв (копии словарей с корневым движением), оставшиеся от убитого потока чтения: старше суток — удалить.
 *
 * Вызывается из `tidyAstralCache` (`cache-housekeeping.js`) после каждой записи в игру и при запуске. Всё, что открывалось недавно, остаётся: уборка не мешает окну, что читает сейчас.
 * Отчёт — той же формы, что у остальных частей: `{ removed: [{ path, bytes }], failed, bytes, skipped }`.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROJECT_CACHE_CAP_BYTES = 128 * 1024 * 1024;
export const TRACKS_CAP_BYTES = 256 * 1024 * 1024;
/** Недавно открытое не убирается, даже если кэш выше потолка. */
export const RECENT_MS = 10 * 60 * 1000;
export const ORPHAN_PART_MS = 60 * 60 * 1000;
export const ORPHAN_TEMP_MS = 24 * 60 * 60 * 1000;

const reasonOf = (error) => String(error?.code || error?.message || error);
const touched = (info) => Math.max(info.atimeMs, info.mtimeMs);

async function listFiles(directory, accept) {
  const names = await fs.readdir(directory).catch(() => []);
  const out = [];
  for (const name of names) {
    if (!accept(name)) continue;
    const file = path.join(directory, name);
    const info = await fs.stat(file).catch(() => null);
    if (info?.isFile())
      out.push({ file, bytes: info.size, usedAt: touched(info) });
  }
  return out;
}

async function removeFile(entry, report, dryRun) {
  try {
    if (!dryRun) await fs.rm(entry.file, { force: true });
    report.removed.push({ path: entry.file, bytes: entry.bytes });
    report.bytes += entry.bytes;
  } catch (error) {
    report.failed.push({
      path: entry.file,
      bytes: entry.bytes,
      code: reasonOf(error),
    });
  }
}

/** Что убрать из набора файлов, чтобы он влез в `cap`: самые давние первыми, недавние остаются. */
export function planTrim(
  entries,
  { cap, now = Date.now(), recentMs = RECENT_MS },
) {
  let left = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const remove = [];
  for (const entry of [...entries].sort(
    (a, b) => a.usedAt - b.usedAt || a.file.localeCompare(b.file),
  )) {
    if (left <= cap || now - entry.usedAt < recentMs) break;
    remove.push(entry);
    left -= entry.bytes;
  }
  return { remove, keptBytes: left };
}

async function trimFolder(entries, cap, { isBusy, now, dryRun }, report) {
  for (const entry of planTrim(entries, { cap, now }).remove) {
    if (isBusy()) {
      report.skipped = "busy";
      return;
    }
    await removeFile(entry, report, dryRun);
  }
}

/** Папки с дорожками всех игр: `animations/<хэш игры>/tracks`. */
async function trackFolders(stateDir) {
  const root = path.join(stateDir, "animations");
  const names = await fs.readdir(root).catch(() => []);
  return names.map((name) => path.join(root, name, "tracks"));
}

export async function tidyAnimationCaches({
  stateDir,
  isBusy = () => false,
  now = Date.now(),
  dryRun = false,
  tempRoot = os.tmpdir(),
}) {
  const report = { removed: [], failed: [], bytes: 0, skipped: null };
  const options = { isBusy, now, dryRun };
  /* Словари проектов: обрывки загрузок и потолок. */
  const projectFolder = path.join(stateDir, "animations", "project");
  for (const part of await listFiles(projectFolder, (name) =>
    /\.part\.ycd$/.test(name),
  ))
    if (now - part.usedAt > ORPHAN_PART_MS)
      await removeFile(part, report, dryRun);
  await trimFolder(
    await listFiles(projectFolder, (name) => /^[0-9a-f]{64}\.ycd$/.test(name)),
    PROJECT_CACHE_CAP_BYTES,
    options,
    report,
  );
  /* Дорожки: один потолок на все игры. */
  const tracks = [];
  for (const folder of await trackFolders(stateDir))
    tracks.push(...(await listFiles(folder, (name) => /\.bin$/.test(name))));
  await trimFolder(tracks, TRACKS_CAP_BYTES, options, report);
  /* Временные папки слоёв: старше суток — сирота убитого потока. */
  for (const name of await fs.readdir(tempRoot).catch(() => [])) {
    if (!/^astral-anim-layers-/.test(name) || isBusy()) continue;
    const folder = path.join(tempRoot, name);
    const info = await fs.stat(folder).catch(() => null);
    if (!info?.isDirectory() || now - touched(info) < ORPHAN_TEMP_MS) continue;
    const bytes = (await listFiles(folder, () => true)).reduce(
      (sum, item) => sum + item.bytes,
      0,
    );
    try {
      if (!dryRun) await fs.rm(folder, { recursive: true, force: true });
      report.removed.push({ path: folder, bytes });
      report.bytes += bytes;
    } catch (error) {
      report.failed.push({ path: folder, bytes, code: reasonOf(error) });
    }
  }
  return report;
}
