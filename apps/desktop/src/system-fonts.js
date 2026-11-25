/*
 * Шрифты, установленные на компьютере: список названий и чтение одного файла (ТЗ 23.10.2026, п. F: «свои шрифты
 * везде» — загрузить файл или взять из установленных).
 *
 * Окно не читает папки само. Главный процесс отдаёт только названия и непрозрачные номера, а байты — по номеру из
 * последнего списка: путь окну не отдаётся и не принимается, читается лишь файл из папок шрифтов системы и
 * человека, с расширением шрифта и не больше `MAX_FONT_BYTES`. Прочитанный файл окно сохраняет как свой шрифт
 * (`saveEmblemFont`) — дальше он ничем не отличается от файла, который человек загрузил сам.
 *
 * Windows: названия и файлы — из реестра шрифтов (`HKLM` и `HKCU`, `…\Windows NT\CurrentVersion\Fonts`), плюс папка
 * шрифтов человека. Остальные системы (разработка) — папки шрифтов по именам файлов.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* Что FontFace окна читает: TTC и «сырые» наборы не берём. */
const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
export const MAX_FONT_BYTES = 30 * 1024 * 1024;
const LIST_TTL_MS = 5 * 60 * 1000;
const REGISTRY_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
];

/** «Arial Bold (TrueType)» → «Arial Bold». */
export function fontNameOf(valueName) {
  return String(valueName || "")
    .replace(/\s*\((?:TrueType|OpenType|All res)\)\s*$/i, "")
    .trim();
}

/** Строки вывода `reg query`: `    Имя (TrueType)    REG_SZ    файл.ttf`; коллекции («Cambria & Cambria Math») помечены. */
export function parseRegistryFonts(output) {
  const rows = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s{2,}REG_SZ\s{2,}(.+?)\s*$/);
    if (!match) continue;
    rows.push({ name: fontNameOf(match[1]), file: match[2], collection: /&/.test(match[1]) });
  }
  return rows;
}

/* Выгрузка UTF-16 (`registry-export.js`): файлы шрифтов профиля с кириллицей. */
const defaultRunRegistry = async (key) => (await import("@modovik/game-discovery/registry-export.js")).readRegistryKeyText(key);

/**
 * Средство списка и чтения. Всё внешнее приходит параметрами (реестр, папки, файловая система) — модуль проверяется
 * тестом без Windows.
 */
export function createSystemFonts({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  readDirectory = (directory) => fs.readdir(directory),
  statFile = (file) => fs.stat(file),
  readFile = (file) => fs.readFile(file),
  runRegistry = defaultRunRegistry,
  now = () => Date.now(),
} = {}) {
  let cache = null;
  /* Пути — того же вида, что у системы, на которой работаем (в тесте Windows-пути читаются и на другой). */
  const pathLib = platform === "win32" ? path.win32 : path;
  const inside = (root, file) => {
    const relative = pathLib.relative(root, file);
    return Boolean(relative) && !relative.startsWith("..") && !pathLib.isAbsolute(relative);
  };

  const roots = () => {
    if (platform === "win32") {
      const windows = env.WINDIR || env.SystemRoot || "C:\\Windows";
      const local = env.LOCALAPPDATA || pathLib.join(home, "AppData", "Local");
      return { system: pathLib.join(windows, "Fonts"), user: pathLib.join(local, "Microsoft", "Windows", "Fonts") };
    }
    if (platform === "darwin") return { system: "/Library/Fonts", user: pathLib.join(home, "Library", "Fonts") };
    return { system: "/usr/share/fonts", user: pathLib.join(home, ".fonts") };
  };

  const fromDirectory = async (directory) => {
    const names = await Promise.resolve(readDirectory(directory)).catch(() => []);
    return names
      .filter((name) => FONT_EXTENSIONS.has(pathLib.extname(name).toLowerCase()))
      .map((name) => ({ name: pathLib.basename(name, pathLib.extname(name)).replace(/[-_]+/g, " "), file: pathLib.join(directory, name) }));
  };

  async function build() {
    const where = roots();
    const found = [];
    if (platform === "win32") {
      for (const key of REGISTRY_KEYS) {
        for (const row of parseRegistryFonts(await runRegistry(key))) {
          if (row.collection) continue;
          found.push({ name: row.name, file: pathLib.isAbsolute(row.file) ? row.file : pathLib.join(where.system, row.file) });
        }
      }
      found.push(...(await fromDirectory(where.user)));
    } else {
      found.push(...(await fromDirectory(where.system)), ...(await fromDirectory(where.user)));
    }
    const seen = new Set();
    const entries = [];
    for (const item of found) {
      const key = item.file.toLowerCase();
      if (!FONT_EXTENSIONS.has(pathLib.extname(item.file).toLowerCase()) || !item.name || seen.has(key)) continue;
      /* Файл вне папок шрифтов системы и человека (запись реестра с чужим путём) в список не попадает. */
      if (![where.system, where.user].some((root) => inside(root, item.file))) continue;
      seen.add(key);
      entries.push({ name: item.name, file: item.file });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    return entries.map((item, index) => ({ ...item, id: String(index) }));
  }

  async function listing() {
    if (cache && now() - cache.at < LIST_TTL_MS) return cache.entries;
    cache = { at: now(), entries: await build() };
    return cache.entries;
  }

  return {
    /** Названия шрифтов: `[{ id, name }]`, без путей. */
    async list() {
      return (await listing()).map(({ id, name }) => ({ id, name }));
    },
    /** Файл шрифта по номеру из списка: `{ name, extension, data }`. Чужой номер — ошибка. */
    async read(id) {
      const entries = await listing();
      const entry = entries.find((item) => item.id === String(id));
      if (!entry) throw new Error("Такого шрифта в списке нет — откройте список заново.");
      const info = await Promise.resolve(statFile(entry.file)).catch(() => null);
      if (!info || (typeof info.isFile === "function" && !info.isFile())) throw new Error("Файл этого шрифта не найден.");
      if (info.size > MAX_FONT_BYTES) throw new Error("Файл шрифта слишком большой.");
      const data = await readFile(entry.file);
      return { name: entry.name, extension: pathLib.extname(entry.file).toLowerCase(), data: new Uint8Array(data) };
    },
    /** Сбросить кэш списка (после установки шрифта человеком). */
    forget() {
      cache = null;
    },
  };
}

/** Мосты окна: список и чтение (`IPC.SYSTEM_FONTS_LIST`, `IPC.SYSTEM_FONT_READ`). */
export function registerSystemFontsIpc({ IPC, handleIpc, trusted, fonts = createSystemFonts() }) {
  handleIpc(IPC.SYSTEM_FONTS_LIST, (event) => trusted(event, () => fonts.list()));
  handleIpc(IPC.SYSTEM_FONT_READ, (event, id) => trusted(event, () => fonts.read(id)));
  return fonts;
}
