/*
 * Что делает лаунчер Rockstar рядом с файлами игры (05.11.2026).
 *
 * Лаунчер сверяет файлы игры и, если они не те, перекачивает их: сначала во
 * временный файл рядом (`.part`, `.partial`, `.download`, `.rgl_tmp`), потом
 * подменяет. Подставлять моды или возвращать чистый файл под идущую докачку
 * нельзя: докачка допишет поверх, и игра получит недописанный архив. Поэтому
 * перед подстановкой и возвратом режим смотрит:
 *
 *   — свежие временные файлы в тех папках, где лежат архивы подмены
 *     (`scanPartials`) — быстрый вызов, он стоит и на «горячем» пути между
 *     стартом игры и чтением архива;
 *   — процессы лаунчера (`snapshotProcesses`) — медленнее (список процессов),
 *     поэтому он нужен для журнала и предупреждения, а не для решения «ставить».
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Процессы Rockstar, которые могут перекачивать файлы игры. */
export const LAUNCHER_PROCESS_NAMES = Object.freeze(["Launcher.exe", "LauncherPatcher.exe", "RockstarService.exe", "SocialClubHelper.exe", "RockstarErrorHandler.exe", "PlayGTAV.exe"]);
/** Процессы, мешающие вернуть файлы (для способа «как ReplaceX» — их гасят перед возвратом). */
export const RETURN_BLOCKER_NAMES = Object.freeze(["GTA5.exe", "GTA5_Enhanced.exe", "GTA5_Enhanced_BE.exe", "SocialClubHelper.exe", "Launcher.exe", "RockstarService.exe", "PlayGTAV.exe", "LauncherPatcher.exe"]);
export const PARTIAL_SUFFIXES = Object.freeze([".part", ".partial", ".download", ".rgl_tmp"]);
/* Временный файл свежий, пока он не лежит дольше этого. */
export const PARTIAL_FRESH_MS = 10 * 60_000;

const lowerSet = (names) => new Set(names.map((name) => name.toLowerCase()));

/**
 * Свежие временные файлы докачки рядом с архивами. `rels` — пути архивов в
 * игре; смотрятся их папки (не вглубь). Имена своих временных файлов Astral
 * (`.astral-*`, `*.stage`) не считаются.
 */
export async function scanPartials(gameRoot, rels, { now = Date.now, freshMs = PARTIAL_FRESH_MS } = {}) {
  const root = path.resolve(String(gameRoot || ""));
  const folders = new Set();
  for (const rel of rels) folders.add(path.dirname(path.join(root, ...String(rel).split("/"))));
  const found = [];
  for (const folder of folders) {
    let names = [];
    try {
      names = await fs.readdir(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      if (lower.includes(".astral-") || lower.endsWith(".stage") || !PARTIAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) continue;
      const stat = await fs.stat(path.join(folder, name)).catch(() => null);
      if (stat?.isFile() && now() - stat.mtimeMs <= freshMs) found.push(name);
    }
  }
  return found;
}

/** Процессы Rockstar на этот миг: `[{ name, pid }]`. `list` — источник процессов (`[{ name, pid }]`). */
export async function snapshotProcesses(list, names = LAUNCHER_PROCESS_NAMES) {
  const wanted = lowerSet(names);
  try {
    return (await list()).filter((item) => wanted.has(String(item?.name || "").toLowerCase()));
  } catch {
    return [];
  }
}

/** Процессы человеку: `Launcher.exe (PID 12), …` или пустая строка. */
export const describeProcesses = (processes) => processes.map((item) => (item.pid ? `${item.name} (PID ${item.pid})` : item.name)).join(", ");

/** Среди процессов есть сам лаунчер Rockstar (а не только вспомогательные)? */
export const launcherAlive = (processes) => processes.some((item) => /^(launcher|launcherpatcher)\.exe$/i.test(item.name || ""));
