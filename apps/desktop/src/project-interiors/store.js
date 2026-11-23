/*
 * «Интерьеры проектов» — откуда человек берёт интерьеры: список источников.
 *
 * Источник — папка на машине игрока: выгрузка интерьеров проекта, папка сборки
 * с пакетами (`dlcpacks`) или кэш клиента RAGE:MP. Выбирает его человек
 * диалогом либо берёт найденный Astral кэш GTA 5 РП; окну приходят номера, а не
 * пути: путь окно не называет, и главный процесс не читает того, что человек не
 * выбирал. Список лежит в хранилище Astral (`project-interiors/sources.json`).
 *
 * Кэш клиента Majestic (alt:V) зашифрован — интерьеры сервера из него не
 * прочесть, поэтому для Majestic кэш не ищется: только выбранная папка или
 * сборка игрока.
 *
 * Папок проектов в поставке и в репозитории нет: Astral читает то, что есть у
 * игрока, и ничего не копирует.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { rageRoots, serverFolders } from "../server-clothing.js";

export const PROJECT_IDS = Object.freeze(["majestic", "gta5rp"]);
export const SOURCES_LIMIT = 8;
const STORE_VERSION = 1;

const fileOf = (stateDir) => path.join(stateDir, "project-interiors", "sources.json");
/* Пакеты интерьеров с CDN Astral: `<хранилище>/project-interiors/cdn/<проект>/<пакет>/<версия>/…` (`cdn.js`). */
export const cdnRootOf = (stateDir, project) => path.join(stateDir, "project-interiors", "cdn", project);
const idOf = (project, folder) => createHash("sha1").update(`${project}|${folder.toLowerCase()}`).digest("hex").slice(0, 10);
const inside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Корень файлов интерьера: у интерьера из пакета Astral — папка самого пакета, у остальных — источник. */
export const unitRoot = (unit, source) => unit?.internal?.root || source.path;

/** Источники проектов: `[{ id, project, kind, path, label, added }]`; `kind` — `folder`, `rage-cache` или `astral` (пакеты с CDN). */
export async function readSources(stateDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(fileOf(stateDir), "utf8"));
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.sources)) return [];
    return parsed.sources.filter((item) => PROJECT_IDS.includes(item?.project) && typeof item.path === "string" && typeof item.id === "string");
  } catch {
    return [];
  }
}

async function writeSources(stateDir, sources) {
  const file = fileOf(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${process.pid}.tmp`;
  await fs.writeFile(staged, JSON.stringify({ version: STORE_VERSION, sources }, null, 2));
  await fs.rename(staged, file);
}

/**
 * Папка годится в источники: настоящая папка человека, не корень диска, не
 * сама игра и не хранилище Astral.
 */
export async function checkFolder(folder, { gameRoot = "", stateDir = "" } = {}) {
  const value = String(folder || "");
  if (!path.isAbsolute(value) || value.length > 1024) throw new SourceError("bad-path", "Нужна полная папка на диске.");
  const resolved = path.resolve(value);
  if (path.parse(resolved).root === resolved) throw new SourceError("disk-root", "Выберите папку с интерьерами, а не целый диск.");
  if (gameRoot && (inside(resolved, path.resolve(gameRoot)) || inside(path.resolve(gameRoot), resolved)))
    throw new SourceError("game-folder", "Это папка самой GTA V (или в ней). Выберите папку с интерьерами проекта.");
  if (stateDir && inside(resolved, path.resolve(stateDir))) throw new SourceError("astral-folder", "Это папка самого Astral. Выберите папку с интерьерами проекта.");
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new SourceError("not-found", "Такой папки нет.");
  return resolved;
}

/** Кэши клиентов RAGE:MP на этой машине — предложение для GTA 5 РП (id — по пути, путь окну не нужен). */
export async function discoverCaches({ env = process.env } = {}) {
  const folders = await serverFolders(rageRoots(env)).catch(() => []);
  return folders.map((folder) => ({ id: idOf("gta5rp", folder), project: "gta5rp", kind: "rage-cache", path: folder, label: path.basename(folder) }));
}

/** Добавляет источник проекта; повтор той же папки — тот же источник. */
export async function addSource(stateDir, { project, folder, kind = "folder", gameRoot = "" }) {
  if (!PROJECT_IDS.includes(project)) throw new SourceError("bad-project", "Неизвестный проект.");
  const resolved = await checkFolder(folder, { gameRoot, stateDir });
  const sources = await readSources(stateDir);
  const id = idOf(project, resolved);
  const known = sources.find((item) => item.id === id);
  if (known) return known;
  if (sources.filter((item) => item.project === project && item.kind !== "astral").length >= SOURCES_LIMIT)
    throw new SourceError("too-many", `Источников у проекта уже ${SOURCES_LIMIT} — уберите ненужные.`);
  const added = { id, project, kind: kind === "rage-cache" ? "rage-cache" : "folder", path: resolved, label: path.basename(resolved), added: new Date().toISOString() };
  await writeSources(stateDir, [...sources, added]);
  return added;
}

/**
 * Источник «Астрал» проекта — пакеты, скачанные с CDN: один на проект, папку
 * выбирает не человек, а `cdn.js` (проверка `checkFolder` её бы отвергла: это
 * хранилище Astral). Появляется с первым скачанным пакетом.
 */
export async function ensureAstralSource(stateDir, project) {
  if (!PROJECT_IDS.includes(project)) throw new SourceError("bad-project", "Неизвестный проект.");
  const sources = await readSources(stateDir);
  const known = sources.find((item) => item.project === project && item.kind === "astral");
  if (known) return known;
  const root = cdnRootOf(stateDir, project);
  const added = { id: idOf(project, root), project, kind: "astral", path: root, label: "Astral", added: new Date().toISOString() };
  await writeSources(stateDir, [...sources, added]);
  return added;
}

/** Убирает источник из списка. Саму папку не трогает; источник «Астрал» не убирается (пакеты — через `removeFetched`). */
export async function removeSource(stateDir, id) {
  const sources = await readSources(stateDir);
  if (sources.find((item) => item.id === id)?.kind === "astral") throw new SourceError("astral-source", "Это пакеты, скачанные из каталога Astral: уберите нужные в блоке «Из каталога Astral».");
  const left = sources.filter((item) => item.id !== id);
  if (left.length === sources.length) return false;
  await writeSources(stateDir, left);
  return true;
}
