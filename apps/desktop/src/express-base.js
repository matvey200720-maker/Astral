/*
 * Основа своего dlc файлами — для экспресс-установки (16.11.2026, работа «Astral быстрее»).
 *
 * Свой пакет дополнения собирается как «основа + слои работ» (`express-packs.js`). Слои — файлы хранилища. Основа же
 * (`content.xml`, `setup2.xml`, метка в каждом потоковом архиве, пустые типы) лежит внутри своего архива, а команде
 * `build-rpf-dlc` нужны пути к файлам на диске. Здесь основа раскладывается файлами двумя командами движка:
 *   - `index-archive` — список записей архива со вложенными (`{ path, size, sha256 }`);
 *   - `extract-archive-entries` — сами записи файлами (ресурс выходит файлом RSC7 с заголовком: слова читаются из него).
 *
 * Основа мала (килобайты, десятки записей) и меняется только с версией приложения, поэтому раскладка лежит рядом с
 * архивом-основой, в папке с его отпечатком в имени, и берётся готовой, пока все файлы на месте и нужной длины. Пропала
 * (уборка кэша) — раскладывается заново.
 *
 * Архив-основа только читается. Видимых человеку строк нет.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describeFile } from "@modovik/install-engine/express-dlc.js";
import { runEngineCommand } from "./engine-run.js";

export const BASE_LAYOUT_FORMAT = 1;
/** Столько записей движок берёт одной командой (`native-engine.js`: больше 5000 — отказ). */
export const EXTRACT_BATCH = 2000;

const SHA256 = /^[a-f0-9]{64}$/i;

/** Папка раскладки основы: рядом с архивом, по его отпечатку. */
export function baseLayoutFolder(baseArchive, baseSha256) {
  if (!SHA256.test(String(baseSha256 || ""))) throw new Error("Раскладка основы: нужен отпечаток архива-основы.");
  return path.join(path.dirname(String(baseArchive)), `${path.basename(String(baseArchive))}.files-${String(baseSha256).slice(0, 16).toLowerCase()}`);
}

const keysArguments = (keysDirectory) => (keysDirectory ? ["--keys", keysDirectory] : []);

/* Готовая раскладка: список записей и все файлы на месте, длина каждого — как записано. Иначе `null`. */
async function readyLayout(folder, baseSha256) {
  try {
    const listed = JSON.parse(await fs.readFile(path.join(folder, "layout.json"), "utf8"));
    if (listed?.format !== BASE_LAYOUT_FORMAT || listed.baseSha256 !== String(baseSha256).toLowerCase() || !Array.isArray(listed.entries)) return null;
    const rows = [];
    for (const { file, ...row } of listed.entries) {
      const source = path.join(folder, "files", String(file));
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size !== row.size) return null;
      rows.push({ ...row, source });
    }
    return rows;
  } catch {
    return null;
  }
}

/**
 * Записи основы файлами: `[{ path, kind, size, source, words?, sha256 }]` — то, что ждёт `expressPackOf` в `baseEntries`.
 *
 * `baseArchive` — архив-основа (копия хоста в кэше движка), `baseSha256` — его отпечаток из состояния. `executable` —
 * `astral-engine`, `keysDirectory` — ключи чтения архивов. `run` — запуск команды движка (для проверок).
 */
export async function layOutExpressBase({ baseArchive, baseSha256, executable, keysDirectory = null, signal = null, run = runEngineCommand } = {}) {
  if (!baseArchive || !path.isAbsolute(String(baseArchive))) throw new Error("Раскладка основы: путь архива-основы должен быть абсолютным.");
  if (!executable) throw new Error("Раскладка основы: движок не найден.");
  const folder = baseLayoutFolder(baseArchive, baseSha256);
  const ready = await readyLayout(folder, baseSha256);
  if (ready) return ready;

  /* Раскладка собирается в своей папке и встаёт на место переименованием: недописанную за готовую не принять. */
  const stage = `${folder}.${process.pid}.${Date.now().toString(36)}.stage`;
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(path.join(stage, "files"), { recursive: true });
  try {
    const indexFile = path.join(stage, "index.json");
    await run(executable, ["index-archive", "--input", String(baseArchive), "--output", indexFile, ...keysArguments(keysDirectory)], { signal });
    const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
    if (index.truncated || (Array.isArray(index.unreadable) ? index.unreadable.length : index.unreadable))
      throw new Error("Раскладка основы: движок прочитал архив-основу не целиком.");
    const paths = (index.entries || []).map((entry) => String(entry.path));
    if (!paths.length) throw new Error("Раскладка основы: в архиве-основе нет записей.");

    const extracted = new Map();
    for (let from = 0; from < paths.length; from += EXTRACT_BATCH) {
      const batch = paths.slice(from, from + EXTRACT_BATCH);
      /* Каждая пачка — в свою папку: движок кладёт запись под именем из её пути, и две пачки не должны встретиться. */
      const outputDirectory = path.join(stage, "files", String(from / EXTRACT_BATCH));
      await fs.mkdir(outputDirectory, { recursive: true });
      const result = await run(
        executable,
        ["extract-archive-entries", "--input", String(baseArchive), "--output-dir", outputDirectory, ...batch.flatMap((entry) => ["--entry", entry]), ...keysArguments(keysDirectory)],
        { signal },
      );
      if ((result?.missing || []).length) throw new Error(`Раскладка основы: движок не нашёл записи: ${result.missing.slice(0, 3).join(", ")}.`);
      for (const item of result?.files || []) {
        const key = String(item.entry).toLowerCase();
        if (extracted.has(key)) throw new Error(`Раскладка основы: запись ${item.entry} пришла дважды.`);
        extracted.set(key, path.join(String(from / EXTRACT_BATCH), String(item.file)));
      }
    }

    const seenFiles = new Set();
    const entries = [];
    for (const entry of paths) {
      const file = extracted.get(entry.toLowerCase());
      if (!file) throw new Error(`Раскладка основы: запись ${entry} не извлечена.`);
      if (seenFiles.has(file.toLowerCase())) throw new Error(`Раскладка основы: две записи легли в один файл (${file}).`);
      seenFiles.add(file.toLowerCase());
      const full = path.join(stage, "files", file);
      /* Отпечаток файла-источника: движок сверяет его по ходу записи (основа мала — читаем целиком). */
      const sha256 = createHash("sha256")
        .update(await fs.readFile(full))
        .digest("hex");
      const { source: _source, ...row } = await describeFile(full, entry, { sha256 });
      entries.push({ ...row, file });
    }
    await fs.rm(indexFile, { force: true });
    await fs.writeFile(path.join(stage, "layout.json"), JSON.stringify({ format: BASE_LAYOUT_FORMAT, baseSha256: String(baseSha256).toLowerCase(), entries }));
    await fs.rm(folder, { recursive: true, force: true });
    await fs.rename(stage, folder);
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const rows = await readyLayout(folder, baseSha256);
  if (!rows) throw new Error("Раскладка основы: готовая раскладка не читается.");
  return rows;
}
