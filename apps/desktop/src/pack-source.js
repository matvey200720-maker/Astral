/*
 * Источник готового набора: папка или архив.
 *
 * Моды скачивают архивом. `.zip` — обычно, `.oiv` — пакет установщика OpenIV,
 * который внутри тот же zip. Требовать «сначала распакуйте» значит оставить
 * человеку ровно тот шаг, ради снятия которого приложение и написано: он уже
 * скачал файл, он уже знает, что в нём звук, и распаковка ему ничего не даёт.
 *
 * Поэтому источником может быть и папка, и архив. Папка отдаётся как есть;
 * архив распаковывается в кэш под отпечатком своего содержимого — тот же
 * файл второй раз не распаковывается, а разные наборы не смешиваются. Дальше
 * оба пути одинаковы: сборщику приходит папка, и он не знает, откуда она.
 *
 * Распаковка чужого архива — операция, в которой ошибаются: путь вида
 * `../../Windows/System32` внутри zip и есть классический zip slip. Здесь
 * каждая запись проверяется до записи на диск: только относительные пути,
 * никаких `..`, никаких абсолютных и буквенных дисков, никаких ссылок, и
 * жёсткие пределы на число файлов и на распакованный размер.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import unzipper from "unzipper";

/** Расширения, которые распаковываются. `.oiv` внутри — тот же zip. */
export const PACK_ARCHIVE_EXTENSIONS = Object.freeze([".zip", ".oiv"]);

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
/* Сколько распакованных наборов держать в кэше: набор весит десятки
   мегабайт, и бесконечный кэш незаметно съел бы диск. */
const KEEP_EXTRACTED = 8;

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Безопасное имя записи архива.
 *
 * Возвращает относительный путь или `null`, если запись трогать нельзя.
 * Молчаливый пропуск здесь правильнее отказа: в архивах модов регулярно
 * попадаются служебные записи вроде `__MACOSX/`, и падать из-за них значит
 * не поставить нормальный набор.
 */
export function safeArchiveEntry(name) {
  const raw = String(name || "").replace(/\\/g, "/");
  if (!raw || raw.endsWith("/")) return null;
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  /* Служебное дерево macOS и мусор Windows в наборах не нужны никому. */
  if (parts[0] === "__MACOSX" || parts.at(-1) === "desktop.ini") return null;
  if (parts.some((part) => part.length > 200)) return null;
  return parts.join("/");
}

const sha256File = async (file) => {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
};

/** Старые распакованные наборы удаляются, чтобы кэш не рос без конца. */
async function pruneExtracted(root, keep = KEEP_EXTRACTED) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat) directories.push({ full, at: stat.mtimeMs });
  }
  directories.sort((left, right) => right.at - left.at);
  for (const stale of directories.slice(keep))
    await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

async function extractArchive(archivePath, stateDir) {
  const stat = await fs.stat(archivePath);
  if (stat.size > MAX_ARCHIVE_BYTES)
    throw refusal("PACK_ARCHIVE_TOO_BIG", "Архив больше допустимого размера.");
  const digest = await sha256File(archivePath);
  const root = path.join(stateDir, "pack-sources", digest.slice(0, 16));
  const marker = path.join(root, ".astral-unpacked");
  /* Тот же архив второй раз не распаковывается: метка ставится последней,
     поэтому оборванная распаковка не сойдёт за готовую. */
  if (await fs.readFile(marker, "utf8").catch(() => null))
    return { root, extracted: true, cached: true, digest };

  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  const staging = `${root}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(staging, { recursive: true });
  try {
    const archive = await unzipper.Open.file(archivePath);
    const files = archive.files.filter((entry) => entry.type === "File");
    if (files.length > MAX_ENTRIES)
      throw refusal("PACK_ARCHIVE_TOO_MANY", "В архиве слишком много файлов.");
    let unpacked = 0;
    let written = 0;
    for (const entry of files) {
      const relative = safeArchiveEntry(entry.path);
      if (!relative) continue;
      unpacked += Number(entry.uncompressedSize) || 0;
      if (unpacked > MAX_UNPACKED_BYTES)
        throw refusal(
          "PACK_ARCHIVE_TOO_BIG",
          "Распакованный архив больше допустимого размера.",
        );
      const target = path.join(staging, ...relative.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await entry.buffer(), { flag: "wx" });
      written += 1;
    }
    if (!written)
      throw refusal("PACK_ARCHIVE_EMPTY", "В архиве нет ни одного файла.");
    await fs.writeFile(path.join(staging, ".astral-unpacked"), `${digest}\n`);
    await fs.mkdir(path.dirname(root), { recursive: true });
    await fs.rename(staging, root);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    if (error?.code?.startsWith?.("PACK_")) throw error;
    throw refusal(
      "PACK_ARCHIVE_BROKEN",
      `Архив не читается как zip: ${error?.message || error}`,
    );
  }
  await pruneExtracted(path.dirname(root));
  return { root, extracted: true, cached: false, digest };
}

/**
 * Папка с набором по тому, что показал человек.
 *
 * Папка — сама собой; архив — распакованный в кэш. Возвращается всегда
 * папка, поэтому сборщику всё равно, откуда пришёл набор.
 */
export async function resolvePackSource(
  sourcePath,
  { stateDir, unpack = extractArchive } = {},
) {
  const raw = String(sourcePath || "");
  if (!raw || !path.isAbsolute(raw))
    throw refusal("PACK_SOURCE_MISSING", "Нужен абсолютный путь к набору.");
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch {
    throw refusal("PACK_SOURCE_MISSING", "Файл или папка не найдены.");
  }
  if (stat.isSymbolicLink())
    throw refusal(
      "PACK_SOURCE_MISSING",
      "Ссылки как источник набора не принимаются.",
    );
  if (stat.isDirectory())
    return { root: resolved, extracted: false, cached: false, digest: null };
  const extension = path.extname(resolved).toLowerCase();
  if (!PACK_ARCHIVE_EXTENSIONS.includes(extension))
    throw refusal(
      "PACK_SOURCE_UNSUPPORTED",
      "Покажите папку с набором или архив .zip либо .oiv.",
    );
  if (!stateDir)
    throw refusal(
      "PACK_SOURCE_UNSUPPORTED",
      "Распаковка архива требует каталога состояния.",
    );
  return unpack(resolved, stateDir);
}
