/*
 * «До» рядом с живым архивом: точка отката без копии в своей папке (14.11.2026, «одна запись вместо двух»).
 *
 * Установка из операций (`install.before: "aside"`, `packages/install-engine/ops-build.js`) не копирует прежний
 * архив в папку точки. Если кэш на другом диске, чем игра, прежний `update.rpf` остаётся вторым именем рядом с
 * живым файлом — `<архив>.astral-before-<id точки>` (имя даёт `engineBeforeBesidePath`, то же, что у движка:
 * `points::aside_path`). Файла `<точка>/update/update.rpf` у такой точки нет, и всё, что искало копию только в
 * папке точки (перемотка, учёт места, «забыть точку»), считало бы точку без копии.
 *
 * Здесь — общие правила для всех таких мест. Имя выводится из папки игры, пути архива и id точки, а не берётся
 * из описи: как у откатов движка, поле с путём в `restore.json` не читается. Удаляется только обычный файл с
 * именем ровно этой точки: повреждённая опись не должна увести уборку на чужие файлы игры.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { engineBeforeBesidePath, sweepOrphanBeforeBeside } from "@modovik/install-engine/engine-swap.js";
import { invalidateOperation } from "@modovik/install-engine/operation-scope.js";

const POINT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MANIFEST = "restore.json";
const UNSAFE_PART = /[:*?"<>|]/;
/* Незаконченные операции над точками: пока они лежат, чьи точки живы, неизвестно (`restore-points-move.js`). */
const PENDING_JOURNALS = ["library-removal-journal.json", "squash-journal.json"];

const yes = () => true;
const no = () => false;

function archiveParts(relativePath) {
  const parts = String(relativePath ?? "").replaceAll("\\", "/").split("/");
  const sound = parts.every((part) => part && part !== "." && part !== ".." && !UNSAFE_PART.test(part));
  return sound ? parts : null;
}

/** Где лежало бы «до» архива этой точки; пусто, если папка игры, путь архива или имя точки не подходят. */
export function besideBeforeOf(gameRoot, relativePath, pointId) {
  const root = String(gameRoot || "");
  const parts = archiveParts(relativePath);
  if (!root || !path.isAbsolute(root) || !parts || !POINT_ID.test(String(pointId || ""))) return "";
  return engineBeforeBesidePath(path.join(path.resolve(root), ...parts), pointId);
}

const isRegularFile = (file) => fs.lstat(file).then((facts) => facts.isFile(), no);

/** Путь «до» рядом, если такой обычный файл есть; иначе пусто. */
export async function findBesideBefore(gameRoot, relativePath, pointId) {
  const file = besideBeforeOf(gameRoot, relativePath, pointId);
  return file && (await isRegularFile(file)) ? file : "";
}

/** Все «до» рядом, что лежат у точки по её описи (архив за архивом, без повторов). Нет описи — пусто. */
export async function besideCopiesOfPoint(directory) {
  const pointId = path.basename(String(directory || ""));
  if (!POINT_ID.test(pointId)) return [];
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(String(directory), MANIFEST), "utf8"));
  } catch {
    return [];
  }
  const found = [];
  const seen = new Set();
  for (const archive of Array.isArray(manifest?.archives) ? manifest.archives : []) {
    const file = besideBeforeOf(manifest?.gameRoot, archive?.relativePath, pointId);
    if (!file || seen.has(file.toLowerCase())) continue;
    seen.add(file.toLowerCase());
    if (await isRegularFile(file)) found.push(file);
  }
  return found;
}

/** Все «до» рядом всех точек из папки точек: `[{ pointId, file }]`. Для учёта места. */
export async function listBesideCopies(pointsRoot) {
  const found = [];
  const entries = await fs.readdir(String(pointsRoot || ""), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !POINT_ID.test(entry.name)) continue;
    for (const file of await besideCopiesOfPoint(path.join(String(pointsRoot), entry.name))) found.push({ pointId: entry.name, file });
  }
  return found;
}

/** Убирает «до» рядом, если имя ровно `<архив>.astral-before-<точка>` и это обычный файл. Возвращает, убран ли файл. */
export async function removeBesideBefore(file, pointId) {
  const text = String(file || "");
  const id = String(pointId || "");
  if (!POINT_ID.test(id) || !path.isAbsolute(text) || !text.endsWith(`.astral-before-${id}`)) return false;
  if (!(await isRegularFile(text))) return false;
  const removed = await fs.rm(text, { force: true, maxRetries: 12, retryDelay: 250 }).then(yes, no);
  /* Копии точки больше нет — память операций о стопке точек (`operation-scope.js`) устарела. */
  invalidateOperation();
  return removed;
}

/** Убирает перечисленные «до» рядом; один сбой не мешает остальным. Возвращает убранные пути. */
export async function removeBesideCopies(files, pointId) {
  const removed = [];
  for (const file of files || []) if (await removeBesideBefore(file, pointId)) removed.push(file);
  return removed;
}

const sameFolder = (left, right) => path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();

async function holdsPoints(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !POINT_ID.test(entry.name)) continue;
    if (await fs.stat(path.join(root, entry.name, MANIFEST)).then((facts) => facts.isFile(), no)) return true;
  }
  return false;
}

/*
 * Можно ли сейчас судить, чья точка жива. Уборка брошенных «до» считает брошенным всё, чьей точки нет в
 * `pointsRoot`: если эта папка недоступна (диск кэша не подключён), а точки лежат в другом месте, под нож пошли
 * бы живые «до» — единственные копии прежнего архива. Поэтому уборка идёт, только когда папка точек на месте,
 * нет незаконченного удаления из библиотеки и в прежней папке точек (`defaultRoot`) не осталось точек, что ещё
 * не переехали вслед за кэшем.
 */
export async function besideSweepIsSafe(pointsRoot, { defaultRoot = "" } = {}) {
  const root = String(pointsRoot || "");
  if (!root || !path.isAbsolute(root)) return false;
  if (!(await fs.stat(root).then((facts) => facts.isDirectory(), no))) return false;
  for (const journal of PENDING_JOURNALS) {
    if (await fs.access(path.join(path.dirname(root), journal)).then(yes, no)) return false;
  }
  if (defaultRoot && path.isAbsolute(String(defaultRoot)) && !sameFolder(defaultRoot, root) && (await holdsPoints(String(defaultRoot)))) return false;
  return true;
}

/** Уборка при запуске: брошенные «до» рядом с живым архивом. Ничего не бросает; возвращает полные пути убранных. */
export async function sweepBesideCopies(livePath, pointsRoot, { defaultRoot = "", log = () => {} } = {}) {
  try {
    if (!(await besideSweepIsSafe(pointsRoot, { defaultRoot }))) return [];
    const names = await sweepOrphanBeforeBeside(livePath, pointsRoot);
    return names.map((name) => path.join(path.dirname(livePath), name));
  } catch (error) {
    log(`«До» рядом с ${livePath} не убрано: ${error?.message || error}`);
    return [];
  }
}
