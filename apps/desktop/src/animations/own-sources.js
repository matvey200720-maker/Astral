/*
 * Свои файлы анимаций (ТЗ 29.10.2026-d): человек указывает папку с `.ycd`, один словарь или архив `dlc.rpf` со своими
 * анимациями — клипы встают в сетку рядом с анимациями игры, раздел «Свои файлы».
 *
 * Файлы человека читаются только на месте и в копию кэша (`animations/own/<id>`); оригинал не меняется и не пересобирается.
 * Архив RPF7 открывает наш JS-разбор (`@modovik/rpf7`): открытые архивы — без ключей, зашифрованный без ключа не открывается
 * — он называется в ответе как не открывшийся, и его никто не взламывает. В репозиторий и в поставку эти файлы не едут.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { atomicWrite } from "../clothing-models.js";
import {
  animationId,
  classifyOwnClip,
  hiddenClip,
  humanizeAnimation,
} from "./animation-catalog.js";
import {
  CLIP_WORKERS,
  clipNames,
  pool,
  sectionRank,
} from "./animation-index.js";
import { clipKinds } from "./clip-kind.js";

const FILE_LIMIT = 6000;
const SOURCES_FILE = "own-sources.json";

const unwrap = (answer) => answer?.result ?? answer ?? {};
export const ownSourceId = (source) =>
  createHash("sha1")
    .update(path.resolve(source).toLowerCase())
    .digest("hex")
    .slice(0, 10);

const sourcesFile = (stateDir) =>
  path.join(stateDir, "animations", SOURCES_FILE);

/** Сохранённые источники: `[{ id, kind, path, label }]`. */
export async function readOwnSources(stateDir) {
  const list = await fs
    .readFile(sourcesFile(stateDir), "utf8")
    .then(JSON.parse)
    .catch(() => []);
  return Array.isArray(list)
    ? list.filter((item) => item?.id && item?.path)
    : [];
}

async function kindOf(source) {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) return null;
  if (stat.isDirectory()) return "folder";
  if (/\.ycd$/i.test(source)) return "ycd";
  if (/\.rpf$/i.test(source)) return "rpf";
  return null;
}

/** Запомнить источник. Ответ — `{ source }` или `{ reason }`: этот файл анимацией не будет. */
export async function addOwnSource(stateDir, input) {
  const source = path.resolve(String(input || ""));
  const kind = await kindOf(source);
  if (!kind)
    return { reason: "Нужна папка с .ycd, словарь .ycd или архив .rpf." };
  const list = await readOwnSources(stateDir);
  const id = ownSourceId(source);
  const record = { id, kind, path: source, label: path.basename(source) };
  const next = [...list.filter((item) => item.id !== id), record];
  await fs.mkdir(path.dirname(sourcesFile(stateDir)), { recursive: true });
  await atomicWrite(sourcesFile(stateDir), Buffer.from(JSON.stringify(next)));
  return { source: record };
}

/** Забыть источник и его копию; файлы человека остаются как были. */
export async function removeOwnSource(stateDir, id) {
  const list = await readOwnSources(stateDir);
  await atomicWrite(
    sourcesFile(stateDir),
    Buffer.from(JSON.stringify(list.filter((item) => item.id !== id))),
  );
  await fs
    .rm(
      path.join(
        stateDir,
        "animations",
        "own",
        String(id).replace(/[^a-z0-9]/gi, ""),
      ),
      { recursive: true, force: true },
    )
    .catch(() => {});
  return { removed: true };
}

async function walk(directory, out = [], depth = 0) {
  if (out.length >= FILE_LIMIT || depth > 8) return out;
  for (const item of await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => [])) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) await walk(full, out, depth + 1);
    else if (/\.ycd$/i.test(item.name)) out.push(full);
    if (out.length >= FILE_LIMIT) break;
  }
  return out;
}

/** Словари источника как файлы на диске: папка и файл — на месте, архив — копиями в кэше. */
async function dictionaryFiles(source, stateDir, keysDirectory) {
  if (source.kind === "ycd") return { files: [source.path], skipped: 0 };
  if (source.kind === "folder")
    return { files: await walk(source.path), skipped: 0 };
  const cache = path.join(stateDir, "animations", "own", source.id);
  const stat = await fs.stat(source.path).catch(() => null);
  if (!stat) return { files: [], skipped: 0, reason: "Файл не найден." };
  const marker = path.join(cache, "source.json");
  const mark = JSON.stringify({
    size: stat.size,
    mtime: Math.floor(stat.mtimeMs),
  });
  if ((await fs.readFile(marker, "utf8").catch(() => "")) === mark)
    return { files: await walk(cache), skipped: 0 };
  await fs.rm(cache, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(cache, { recursive: true });
  let archive;
  try {
    /* Каталог ключей — строкой или функцией (`listAnimations`): поставка ключей нужна, только когда архив правда открывается, а не на каждый вызов списка. */
    const keysAt = typeof keysDirectory === "function" ? await keysDirectory() : keysDirectory;
    archive = await openRpfFile(source.path, {
      keys: keysAt
        ? await keysFromDirectory(keysAt).catch(() => null)
        : null,
    });
  } catch (error) {
    return {
      files: [],
      skipped: 0,
      reason: /ключ|key|encrypt|AES|NG/i.test(String(error?.message))
        ? "Архив зашифрован — без ключа он не открывается."
        : String(error?.message || error),
    };
  }
  const files = [];
  let skipped = 0;
  try {
    for (const entry of archive.entries) {
      if (entry.directory || !/\.ycd$/i.test(entry.path)) continue;
      try {
        const bytes = await archive.read(entry.path);
        const target = path.join(
          cache,
          `${files.length}_${path.posix.basename(entry.path)}`,
        );
        await fs.writeFile(target, bytes);
        files.push(target);
      } catch {
        skipped += 1;
      }
      if (files.length >= FILE_LIMIT) break;
    }
  } finally {
    await archive.close?.();
  }
  await fs.writeFile(marker, mark);
  return { files, skipped };
}

/** Клипы своих источников: `{ entries, problems }`, записи той же формы, что у игры (`source: "own:<id>"`). */
export async function readOwnIndex(
  { stateDir, keysDirectory = "", extra = [] },
  context,
  tools,
) {
  const stored = await readOwnSources(stateDir);
  const sources = [...stored];
  for (const path_ of extra) {
    const kind = await kindOf(path_);
    if (kind && !sources.some((item) => item.path === path.resolve(path_)))
      sources.push({
        id: ownSourceId(path_),
        kind,
        path: path.resolve(path_),
        label: path.basename(path_),
      });
  }
  const entries = [];
  const problems = [];
  for (const source of sources) {
    const { files, skipped, reason } = await dictionaryFiles(
      source,
      stateDir,
      keysDirectory,
    );
    if (reason) problems.push({ id: source.id, label: source.label, reason });
    if (skipped)
      problems.push({
        id: source.id,
        label: source.label,
        reason: "Часть словарей не прочиталась.",
      });
    await pool(files, CLIP_WORKERS, async (file) => {
      const dictionary = path
        .basename(file)
        .replace(/\.ycd$/i, "")
        .replace(/^\d+_/, "")
        .toLowerCase();
      /* Человек или нет (предмет, камера): по костям клипа; не разобралось — как человек, список остаётся прежним. */
      const kinds = await fs.readFile(file).then(
        (bytes) => clipKinds(bytes),
        () => new Map(),
      );
      for (const clip of await clipNames(file, context, tools)) {
        if (hiddenClip(clip)) continue;
        const human = kinds.get(String(clip).toLowerCase())?.human !== false;
        entries.push({
          id: animationId(`own-${source.id}`, dictionary, clip),
          source: `own:${source.id}`,
          dictionary,
          clip,
          name: humanizeAnimation("", clip) || clip,
          /* Раздел — по смыслу клипа, как у анимаций игры; «Свои файлы» в сетке — отбор по источнику. */
          section: human ? classifyOwnClip(clip) : "other",
          ...(human ? {} : { human: false }),
          pack: source.label,
          file,
        });
      }
    });
  }
  entries.sort(
    (a, b) =>
      sectionRank(a.section) - sectionRank(b.section) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
  return {
    entries,
    problems,
    sources: sources.map(({ id, kind, path: at, label }) => ({
      id,
      kind,
      path: at,
      label,
    })),
  };
}

export { unwrap as unwrapAnswer };
