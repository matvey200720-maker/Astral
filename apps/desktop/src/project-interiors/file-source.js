/*
 * «Интерьеры проектов» — откуда читаются файлы: папка игрока или набор
 * архивов RAGE:MP.
 *
 * Источник — список файлов с путями «через косую вперёд» и чтение по пути.
 * Файл на диске и запись архива RPF7 для остального кода одинаковы: у записи
 * внутри архива путь начинается с пути самого архива
 * (`dlcpacks/x/dlc.rpf/levels/gta5/interiors/y.rpf/y.ytyp`), вложенные архивы
 * раскрывает читатель RPF7. Так одна выгрузка («Interiors Majestic» лежит
 * россыпью файлов), пакет `dlc.rpf` сборки и кэш RAGE:MP (имена — хеши,
 * архив узнаётся по четырём байтам) читаются одним сканером.
 *
 * Только чтение: ничего не копируется и не меняется. Файлы проектов в
 * поставку Astral и в репозиторий не попадают.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { RPF7_MAGIC } from "@modovik/rpf7";
import { openRpfFile } from "@modovik/rpf7/node";

/* Что сканеру нужно: типы, карты, манифесты, модели, словари, коллизии, анимации. */
export const SOURCE_FILE = /\.(ytyp|ymap|ymf|ydr|ydd|yft|ytd|ybn|ycd)$/i;
export const MAX_SOURCE_FILES = 400_000;
export const MAX_SOURCE_ARCHIVES = 2_000;
/* Файл без расширения в кэше RAGE:MP — архив, если начинается как RPF7; меньше этого архивом быть не может. */
const MIN_ARCHIVE_BYTES = 1024;

const forward = (value) => String(value).replaceAll("\\", "/");

/**
 * Источник из памяти — для тестов: `files = { "путь/файл.ytyp": Uint8Array }`;
 * `archives` — пути, под которыми файлы «лежат в архиве» (в раскрытой выгрузке
 * папки `*.rpf` — обычные папки, и отличить их по имени нельзя).
 */
export function memorySource(label, files, { archives = [] } = {}) {
  const list = Object.entries(files).map(([name, bytes]) => ({
    path: forward(name),
    size: bytes?.length ?? 0,
    ...(archives.some((prefix) => forward(name).startsWith(`${forward(prefix)}/`)) ? { archive: true } : {}),
  }));
  return {
    label,
    files: list,
    stamp: createHash("sha1").update(JSON.stringify(list)).digest("hex").slice(0, 16),
    unreadable: [],
    read: async (name) => files[name] ?? files[forward(name)] ?? null,
    close: async () => {},
  };
}

async function isArchive(file, size) {
  if (size < MIN_ARCHIVE_BYTES) return false;
  const handle = await fs.open(file, "r").catch(() => null);
  if (!handle) return false;
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return bytesRead === 4 && head.readUInt32LE(0) === RPF7_MAGIC;
  } finally {
    await handle.close();
  }
}

/*
 * Обход папки без раскрытия архивов: файлы, что нужны сканеру, найденные
 * архивы и отпечаток (набор файлов, размеры, время правки). Ссылки на папки не
 * раскрываются — обход не зацикливается.
 */
async function walkFolder(root, archives) {
  const base = path.resolve(root);
  /* Пропавшая папка — отказ, а не пустой источник: каталог называет её пропавшей. */
  if (!(await fs.stat(base)).isDirectory()) throw new Error("Это не папка.");
  const files = [];
  const found = [];
  const hash = createHash("sha1");
  let total = 0;
  let newest = 0;
  const queue = [""];
  while (queue.length) {
    const relative = queue.pop();
    const items = await fs.readdir(path.join(base, relative), { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        queue.push(name);
        continue;
      }
      if (!item.isFile()) continue;
      const absolute = path.join(base, relative, item.name);
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat) continue;
      const extension = path.extname(item.name).toLowerCase();
      if (SOURCE_FILE.test(item.name)) {
        if (files.length >= MAX_SOURCE_FILES) continue;
        files.push({ path: name, size: stat.size, absolute });
      } else if (extension === ".rpf" || (archives === "magic" && !extension && (await isArchive(absolute, stat.size)))) {
        found.push({ name, absolute });
      } else continue;
      total += stat.size;
      newest = Math.max(newest, Math.round(stat.mtimeMs));
      hash.update(`${name}:${stat.size}:${Math.round(stat.mtimeMs)}\n`);
    }
  }
  const stamp = createHash("sha1").update(hash.digest("hex")).update(`${total}:${newest}:${files.length}:${found.length}`).digest("hex").slice(0, 16);
  return { base, files, found, stamp };
}

/**
 * Чтение файла источника по пути каталога без обхода всей папки: путь делится
 * на настоящий файл (или архив) на диске и остаток внутри архива. Архивы
 * открываются по требованию и держатся, пока читатель не закрыт — кадру
 * интерьера нужны десяток файлов, а не весь источник.
 */
export function lazyFolderReader(root, { keys = null } = {}) {
  const base = path.resolve(root);
  const archives = new Map();
  const open = (file) => {
    if (!archives.has(file)) archives.set(file, openRpfFile(file, { keys }));
    return archives.get(file);
  };
  return {
    async read(name) {
      const parts = forward(name).split("/");
      let prefix = "";
      for (let at = 0; at < parts.length; at += 1) {
        prefix = prefix ? `${prefix}/${parts[at]}` : parts[at];
        const absolute = path.join(base, ...prefix.split("/"));
        const stat = await fs.stat(absolute).catch(() => null);
        if (!stat) return null;
        if (!stat.isFile()) continue;
        if (at === parts.length - 1) return new Uint8Array(await fs.readFile(absolute));
        const archive = await open(absolute).catch(() => null);
        return archive ? archive.read(parts.slice(at + 1).join("/")).catch(() => null) : null;
      }
      return null;
    },
    async close() {
      for (const pending of archives.values()) (await pending.catch(() => null))?.close?.();
      archives.clear();
    },
  };
}

/** Отпечаток папки без чтения архивов: не менялась — каталог из кэша. */
export async function folderStamp(root, { archives = "extension" } = {}) {
  return (await walkFolder(root, archives)).stamp;
}

/**
 * Папка игрока. `archives`: `"extension"` — архивы по расширению `.rpf`
 * (сборка в `dlcpacks`), `"magic"` — ещё и файлы без расширения, что
 * начинаются как RPF7 (кэш RAGE:MP: имена — хеши).
 */
export async function folderSource(root, { keys = null, archives = "extension", label = "" } = {}) {
  const { base, files: loose, found, stamp } = await walkFolder(root, archives);
  const files = loose.map(({ path: name, size }) => ({ path: name, size }));
  const reads = new Map(loose.map(({ path: name, absolute }) => [name, { absolute }]));
  const unreadable = [];
  const opened = [];
  for (const { name, absolute } of found.slice(0, MAX_SOURCE_ARCHIVES)) {
    try {
      const archive = await openRpfFile(absolute, { keys });
      opened.push(archive);
      for (const entry of archive.entries) {
        if (entry.kind === "directory" || !SOURCE_FILE.test(entry.path) || files.length >= MAX_SOURCE_FILES) continue;
        const inside = `${name}/${forward(entry.path)}`;
        files.push({ path: inside, size: Math.max(entry.size || 0, entry.storedSize || 0), archive: true });
        reads.set(inside, { archive, entry: entry.path });
      }
    } catch (error) {
      unreadable.push({ path: name, code: String(error?.code || "RPF_UNREADABLE") });
    }
  }
  return {
    label: label || path.basename(base),
    files,
    stamp,
    unreadable,
    read: async (name) => {
      const where = reads.get(name);
      if (!where) return null;
      if (where.archive) return where.archive.read(where.entry);
      return new Uint8Array(await fs.readFile(where.absolute));
    },
    close: async () => {
      for (const archive of opened) await archive.close?.().catch(() => {});
      opened.length = 0;
    },
  };
}
