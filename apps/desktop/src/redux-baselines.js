/*
 * Память чистых баз.
 *
 * Разбор сравнивает чужой архив с чистым, и чистый надо откуда-то взять.
 * Для `update.rpf` он есть всегда — резервная копия подготовки Astral. А для
 * `dlc.rpf` патчдея, куда авторы кладут ганпаки, ничего готового нет: базу
 * раньше приходилось указывать рукой на каждый разбор.
 *
 * Здесь приложение запоминает. Один раз найденная база — из установки игры,
 * из резервной копии или указанная человеком — остаётся в памяти под ключом
 * архива (`update`, `dlc:patchday18ng`), и следующий такой же архив
 * сравнивается сразу. Хранится не сам архив, а его отпечаток: разбору
 * нужны только хеши записей, а полгигабайта патчдея копировать незачем.
 * Путь к архиву запоминается рядом — пока файл на месте и не менялся, из него
 * можно доставать записи для уточнений по содержимому.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const libraryRoot = (stateDir) =>
  path.join(stateDir, "redux-inspector", "library");

const catalogFile = (stateDir) =>
  path.join(libraryRoot(stateDir), "library.json");

const safeKey = (key) =>
  String(key)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .slice(0, 80);

const indexFileFor = (stateDir, key) =>
  path.join(libraryRoot(stateDir), `${safeKey(key)}.json`);

async function readCatalog(stateDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(catalogFile(stateDir), "utf8"));
    if (parsed?.baselines && typeof parsed.baselines === "object")
      return { schema: 1, baselines: { ...parsed.baselines } };
  } catch {
    /* Памяти ещё нет или она нечитаема — начинаем с пустой. */
  }
  return { schema: 1, baselines: {} };
}

async function writeCatalog(stateDir, catalog) {
  const file = catalogFile(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

const stampOf = (file) =>
  fs.stat(file).then(
    (info) =>
      info.isFile()
        ? { size: info.size, mtimeMs: Math.round(info.mtimeMs) }
        : null,
    () => null,
  );

/**
 * Запоминает базу: копирует отпечаток в память и записывает, откуда он.
 *
 * `source` — откуда взялась база: `game` (чистая копия из установки),
 * `astral-backup` (резервная копия подготовки), `manual` (указал человек).
 * Повторное запоминание под тем же ключом заменяет старую запись: если
 * человек указал базу рукой, значит, прежняя его не устроила.
 */
export async function rememberBaseline(
  stateDir,
  {
    key,
    kind,
    name,
    label,
    indexFile,
    archivePath = null,
    source,
    entryCount = null,
    archiveBytes = null,
    archiveSha256 = null,
  },
) {
  if (!key) throw new Error("У архива нет имени пака — базу не запомнить.");
  const target = indexFileFor(stateDir, key);
  await fs.mkdir(libraryRoot(stateDir), { recursive: true });
  if (path.resolve(indexFile) !== path.resolve(target))
    await fs.copyFile(indexFile, target);

  const record = {
    key,
    kind,
    name,
    label,
    source,
    archivePath: archivePath ? path.resolve(archivePath) : null,
    archiveStamp: archivePath ? await stampOf(archivePath) : null,
    entryCount,
    archiveBytes,
    archiveSha256,
    indexFile: target,
    rememberedAt: new Date().toISOString(),
  };
  const catalog = await readCatalog(stateDir);
  catalog.baselines[key] = record;
  await writeCatalog(stateDir, catalog);
  return record;
}

/**
 * База из памяти по ключу архива или `null`.
 *
 * `archivePath` в ответе есть только если запомненный архив всё ещё на
 * месте и не менялся: отпечаток пригоден всегда, а вот доставать записи из
 * подменённого файла нельзя — это была бы уже другая база.
 */
export async function recallBaseline(stateDir, key) {
  if (!key) return null;
  const catalog = await readCatalog(stateDir);
  const record = catalog.baselines[key];
  if (!record?.indexFile) return null;
  const ready = await fs.stat(record.indexFile).then(
    (info) => info.isFile() && info.size > 0,
    () => false,
  );
  if (!ready) return null;

  let archivePath = null;
  if (record.archivePath && record.archiveStamp) {
    const stamp = await stampOf(record.archivePath);
    if (
      stamp &&
      stamp.size === record.archiveStamp.size &&
      stamp.mtimeMs === record.archiveStamp.mtimeMs
    )
      archivePath = record.archivePath;
  }
  return { ...record, archivePath, archiveAvailable: Boolean(archivePath) };
}

/** Всё, что приложение помнит, — для окна. Свежие сверху. */
export async function listBaselines(stateDir) {
  const catalog = await readCatalog(stateDir);
  return Object.values(catalog.baselines)
    .map((record) => ({
      key: record.key,
      kind: record.kind,
      name: record.name,
      label: record.label,
      source: record.source,
      archivePath: record.archivePath,
      entryCount: record.entryCount,
      archiveBytes: record.archiveBytes,
      rememberedAt: record.rememberedAt,
    }))
    .sort((left, right) =>
      String(right.rememberedAt).localeCompare(String(left.rememberedAt)),
    );
}

/** Забыть базу: и запись, и отпечаток. Следующий разбор найдёт её заново. */
export async function forgetBaseline(stateDir, key) {
  const catalog = await readCatalog(stateDir);
  const record = catalog.baselines[key];
  if (!record) return { forgotten: false };
  delete catalog.baselines[key];
  await writeCatalog(stateDir, catalog);
  if (record.indexFile)
    await fs.rm(record.indexFile, { force: true }).catch(() => {});
  return { forgotten: true, key };
}
