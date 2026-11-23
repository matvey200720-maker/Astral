/*
 * «Вторая папка игры» для копии из Rockstar Games Launcher (задача 7,
 * 05.10.2026).
 *
 * Лаунчер Rockstar при каждом запуске игры сверяет её файлы и возвращает
 * свой update.rpf — моды, поставленные прямо в игру, пропадают. Вторая папка
 * — та же игра, собранная из жёстких ссылок NTFS на файлы оригинала: данные
 * общие, места почти не нужно. Моды Astral ставит только в неё, лаунчер
 * Rockstar проверяет нетронутый оригинал, а лаунчер сервера (Majestic,
 * «Россия Онлайн», GTA 5 RP) запускает игру из второй папки.
 *
 * Что лежит настоящей копией, а что ссылкой:
 *   — ссылки — большие архивы игры (≥ 64 МиБ): `x64*.rpf`, `common.rpf`,
 *     DLC, звук; их Astral не пишет никогда;
 *   — копии — `update/update.rpf` (его Astral пересобирает) и все мелкие
 *     файлы (exe, dll, asi, ini): правка на месте мелкого файла во второй
 *     папке — загрузчик, настройки — не должна задеть оригинал.
 *   Движок пишет в игру через стейджинг и rename, поэтому и запись в update.rpf
 *   второй папки ссылку не задевает; копией он лежит ради правок на месте
 *   чужими программами (OpenIV).
 *
 * Режим `copy` («Полная копия игры») — все файлы настоящими копиями: для
 * другого диска, где жёсткие ссылки невозможны.
 *
 * Метка `astral-linked-copy.json` в корне второй папки — по ней Astral её
 * узнаёт, сверяет с оригиналом и удаляет: папку без метки он не трогает.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const LINKED_COPY_MARKER = "astral-linked-copy.json";
/* Файлы меньше — настоящими копиями (мелочь: exe, dll, asi, настройки). */
export const LINKED_COPY_SMALL_BYTES = 64 * 1024 * 1024;
/* Что всегда копией: архив, который пересобирает Astral. */
const ALWAYS_COPY = new Set(["update/update.rpf"]);
/* Чего во второй папке не нужно: следы Astral и чужих инструментов в оригинале. */
const SKIP = [/^\.astral-/i, /^\.astral\//i, /^astral-linked-copy\.json$/i, /\.astral-stage-/i, /\.astral-parked/i];
/* Запас места сверх копий. */
const SPARE_BYTES = 1024 * 1024 * 1024;

const relativeOf = (root, file) => path.relative(root, file).split(path.sep).join("/");
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/* Все файлы папки игры: `[{ relative, size, ino, mtimeMs }]`, без следов Astral. */
async function listGameFiles(root) {
  const out = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const relative = relativeOf(root, full);
      if (SKIP.some((rule) => rule.test(relative))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full);
        out.push({ relative, size: stat.size, ino: stat.ino, mtimeMs: Math.round(stat.mtimeMs) });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => (a.relative < b.relative ? -1 : 1));
}

/** Как лежит файл во второй папке: `link` или `copy`. */
export function linkedCopyKind(file, mode = "link", smallBytes = LINKED_COPY_SMALL_BYTES) {
  if (mode === "copy") return "copy";
  return ALWAYS_COPY.has(file.relative.toLowerCase()) || file.size < smallBytes ? "copy" : "link";
}

async function freeBytesAt(folder) {
  try {
    const info = await fs.statfs(folder);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

/* Ближайшая существующая папка на пути (для тома и свободного места). */
async function existingParent(target) {
  let current = path.resolve(target);
  for (;;) {
    const stat = await fs.stat(current).catch(() => null);
    if (stat?.isDirectory()) return { folder: current, stat };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * План второй папки: сколько файлов ссылками и копиями, хватит ли места, на
 * том ли диске. `problems` — коды отказа (`same-folder`, `not-empty`,
 * `other-volume`, `no-space`, `no-game`).
 */
export async function planLinkedCopy({ source, destination, mode = "link", smallBytes = LINKED_COPY_SMALL_BYTES }) {
  const from = path.resolve(String(source || ""));
  const to = path.resolve(String(destination || ""));
  const problems = [];
  const exe = await fs.stat(path.join(from, "GTA5.exe")).catch(() => null);
  if (!exe?.isFile()) problems.push("no-game");
  if (inside(from, to) || inside(to, from)) problems.push("same-folder");
  const existing = await fs.readdir(to).catch(() => null);
  if (existing?.length && !existing.includes(LINKED_COPY_MARKER)) problems.push("not-empty");
  const parent = await existingParent(path.dirname(to));
  const sourceStat = await fs.stat(from).catch(() => null);
  const sameVolume = Boolean(parent && sourceStat && parent.stat.dev === sourceStat.dev);
  if (mode === "link" && !sameVolume) problems.push("other-volume");
  const files = problems.includes("no-game") ? [] : await listGameFiles(from);
  let linkBytes = 0;
  let copyBytes = 0;
  let links = 0;
  for (const file of files) {
    if (linkedCopyKind(file, mode, smallBytes) === "link") {
      linkBytes += file.size;
      links += 1;
    } else copyBytes += file.size;
  }
  const freeBytes = parent ? await freeBytesAt(parent.folder) : null;
  if (freeBytes !== null && freeBytes < copyBytes + SPARE_BYTES) problems.push("no-space");
  return { source: from, destination: to, mode, files: files.length, links, copies: files.length - links, linkBytes, copyBytes, freeBytes, sameVolume, problems };
}

/**
 * Собирает вторую папку: ссылки и копии по `linkedCopyKind`, метка — в
 * самом конце (папка без метки — недособранная, её можно стереть). Отмена
 * (`signal`) и сбой — недособранная папка стирается. `onProgress({ done,
 * total, bytes })`.
 */
export async function createLinkedCopy({ source, destination, mode = "link", smallBytes = LINKED_COPY_SMALL_BYTES, onProgress = null, signal = null, now = () => new Date() }) {
  const plan = await planLinkedCopy({ source, destination, mode, smallBytes });
  if (plan.problems.length) {
    const error = new Error(`Вторую папку собрать нельзя: ${plan.problems.join(", ")}.`);
    error.code = "LINKED_COPY_REFUSED";
    error.problems = plan.problems;
    throw error;
  }
  const files = await listGameFiles(plan.source);
  /* Прежняя вторая папка (с меткой) пересобирается начисто. */
  if (await fs.stat(path.join(plan.destination, LINKED_COPY_MARKER)).catch(() => null)) await removeLinkedCopy(plan.destination);
  await fs.mkdir(plan.destination, { recursive: true });
  let done = 0;
  let bytes = 0;
  try {
    for (const file of files) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Сборка второй папки отменена.");
      const from = path.join(plan.source, ...file.relative.split("/"));
      const to = path.join(plan.destination, ...file.relative.split("/"));
      await fs.mkdir(path.dirname(to), { recursive: true });
      if (linkedCopyKind(file, mode, smallBytes) === "link") await fs.link(from, to);
      else {
        await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
        bytes += file.size;
      }
      done += 1;
      onProgress?.({ done, total: files.length, bytes, totalBytes: plan.copyBytes });
    }
    const marker = {
      format: "astral.linked-copy",
      version: 1,
      source: plan.source,
      mode,
      smallBytes,
      createdAt: now().toISOString(),
      files: files.map((file) => ({ relative: file.relative, size: file.size, ino: file.ino, mtimeMs: file.mtimeMs, kind: linkedCopyKind(file, mode, smallBytes) })),
    };
    await fs.writeFile(path.join(plan.destination, LINKED_COPY_MARKER), JSON.stringify(marker, null, 2));
    return { ...plan, created: true, copiedBytes: bytes };
  } catch (error) {
    await fs.rm(plan.destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Метка второй папки или `null` (не вторая папка Astral). */
export async function readLinkedCopy(destination) {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(path.resolve(destination), LINKED_COPY_MARKER), "utf8"));
    return marker?.format === "astral.linked-copy" ? marker : null;
  } catch {
    return null;
  }
}

/**
 * Сверка второй папки с оригиналом: `changed` — файлы-ссылки, которые
 * оригинал заменил (обновление GTA: новый файл — новая запись, ссылка
 * осталась на старый), `added` / `removed` — новые и пропавшие файлы
 * оригинала, `updateChanged` — у оригинала новый update.rpf (игра обновилась:
 * моды второй папки пересобираются на новую основу).
 */
export async function inspectLinkedCopy(destination) {
  const marker = await readLinkedCopy(destination);
  if (!marker) return null;
  const files = await listGameFiles(marker.source).catch(() => null);
  if (!files) return { marker, sourceMissing: true, changed: [], added: [], removed: [], updateChanged: false };
  const known = new Map(marker.files.map((file) => [file.relative.toLowerCase(), file]));
  const changed = [];
  const added = [];
  let updateChanged = false;
  for (const file of files) {
    const before = known.get(file.relative.toLowerCase());
    known.delete(file.relative.toLowerCase());
    if (!before) {
      added.push(file.relative);
      continue;
    }
    const moved = file.size !== before.size || file.mtimeMs !== before.mtimeMs || (before.kind === "link" && file.ino !== before.ino);
    if (!moved) continue;
    if (ALWAYS_COPY.has(file.relative.toLowerCase())) updateChanged = true;
    else changed.push(file.relative);
  }
  return { marker, sourceMissing: false, changed, added, removed: [...known.values()].map((file) => file.relative), updateChanged };
}

/**
 * Догнать оригинал после обновления GTA: заменённые и новые файлы —
 * заново ссылками или копиями, пропавшие — прочь. Свой update.rpf второй
 * папки (с модами) не трогается: обновлённый оригинал update.rpf
 * возвращается отдельно (`updateChanged`), чтобы Astral пересобрал моды на
 * новую основу. `{ relinked, added, removed }`.
 */
export async function resyncLinkedCopy(destination) {
  const report = await inspectLinkedCopy(destination);
  if (!report || report.sourceMissing) throw new Error("Оригинал второй папки не найден.");
  const { marker } = report;
  const root = path.resolve(destination);
  const files = new Map((await listGameFiles(marker.source)).map((file) => [file.relative.toLowerCase(), file]));
  const place = async (relative) => {
    const file = files.get(relative.toLowerCase());
    const from = path.join(marker.source, ...file.relative.split("/"));
    const to = path.join(root, ...file.relative.split("/"));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rm(to, { force: true });
    if (linkedCopyKind(file, marker.mode, marker.smallBytes) === "link") await fs.link(from, to);
    else await fs.copyFile(from, to);
  };
  for (const relative of [...report.changed, ...report.added]) await place(relative);
  for (const relative of report.removed) {
    if (ALWAYS_COPY.has(relative.toLowerCase())) continue;
    await fs.rm(path.join(root, ...relative.split("/")), { force: true });
  }
  const own = new Map(marker.files.map((file) => [file.relative.toLowerCase(), file]));
  const next = [...files.values()].map((file) => {
    const kept = ALWAYS_COPY.has(file.relative.toLowerCase()) ? own.get(file.relative.toLowerCase()) : null;
    return kept || { relative: file.relative, size: file.size, ino: file.ino, mtimeMs: file.mtimeMs, kind: linkedCopyKind(file, marker.mode, marker.smallBytes) };
  });
  await fs.writeFile(path.join(root, LINKED_COPY_MARKER), JSON.stringify({ ...marker, files: next, syncedAt: new Date().toISOString() }, null, 2));
  return { relinked: report.changed.length, added: report.added.length, removed: report.removed.length, updateChanged: report.updateChanged };
}

/**
 * Удаляет вторую папку. Только папку с меткой Astral и не оригинал: стираются
 * ссылки и копии, данные оригинала остаются (у его файлов просто меньше
 * ссылок). `{ removed: true }`.
 */
export async function removeLinkedCopy(destination) {
  const root = path.resolve(String(destination || ""));
  const marker = await readLinkedCopy(root);
  if (!marker) throw new Error("Это не вторая папка Astral — удалять её Astral не будет.");
  if (inside(root, path.resolve(marker.source)) || inside(path.resolve(marker.source), root)) throw new Error("Вторая папка пересекается с оригиналом игры.");
  await fs.rm(root, { recursive: true, force: true });
  return { removed: true };
}
