/*
 * «Интерьеры проектов» (ТЗ 17.10.2026, вечер, задача 10) — каталог проекта:
 * сканирование источников игрока и его кэш.
 *
 * Каталог проекта (Majestic или GTA 5 РП) — интерьеры всех его источников,
 * слитые по номеру интерьера. Разбор сотен файлов типов и карт стоит
 * секунды, а набор файлов у человека меняется редко, поэтому готовый каталог
 * лежит в кэше Astral под отпечатком источников и игры: тот же набор файлов и
 * та же игра — каталог из кэша, без чтения архивов.
 *
 * Кэш — на единицу работы (26.10.2026, ТЗ п. C): папка или кэш игрока — одна
 * единица, каждый пак с CDN Astral — своя. Пак, которого не касались, не
 * сканируется заново, когда рядом скачали или убрали другой (раньше любое
 * изменение набора перечитывало все двенадцать паков Majestic подряд). Редактор,
 * которому нужны паки одной записи реестра («Казино» — два пака из двенадцати),
 * просит только их (`slugs`): чужие паки не читаются вовсе, а в сводный список
 * для установки (`findUnit`) попадают, если их кэш уже был собран.
 *
 * Окну уходит краткая запись об интерьере (`publicUnit`): имя, раздел,
 * полнота, что мешает установке. Списки файлов и пути остаются в главном
 * процессе — они нужны установке.
 *
 * Читается в потоке (`project-interiors-ipc.js`, `createGameReader`): обход
 * папок и разбор типов и карт не держат главный процесс, а ход (`onProgress`)
 * уходит окну.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { archiveKeysDirectory, provisionArchiveSupport } from "../loader-provisioner.js";
import { listFetched } from "./cdn.js";
import { folderSource, folderStamp } from "./file-source.js";
import { openGameNames } from "./game-names.js";
import { SCAN_VERSION, publicUnit, scanSource } from "./scan.js";
import { PROJECT_IDS, readSources } from "./store.js";

const cacheFile = (stateDir, project) => path.join(stateDir, "project-interiors", `catalog-${project}.json`);
const partFile = (stateDir, project, id) => path.join(stateDir, "project-interiors", `catalog-${project}-${createHash("sha1").update(id).digest("hex").slice(0, 16)}.json`);
const namesFile = (stateDir) => path.join(stateDir, "project-interiors", "game-names.json");
const archivesOf = (source) => (source.kind === "rage-cache" ? "magic" : "extension");
const sha1 = (value, length = 24) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, length);

/* Сборки, что идут прямо сейчас: два запроса одного проекта — одна сборка. */
const building = new Map();

async function gameOf(input, stateDir, tools) {
  const gameRoot = String(input?.gameRoot || "").trim();
  if (!gameRoot || !path.isAbsolute(gameRoot)) return { game: null, keys: null, gameRoot: "" };
  const exists = await fs.stat(path.join(gameRoot, "update", "update.rpf")).catch(() => null);
  const keysDirectory = await archiveKeysDirectory({ keys: input?.keys, stateDir, provision: tools.archiveSupport });
  const keys = keysDirectory ? await keysFromDirectory(keysDirectory).catch(() => null) : null;
  if (!exists) return { game: null, keys, gameRoot: "" };
  const game = await (tools.openGameNames || openGameNames)(gameRoot, { keys, cacheFile: namesFile(stateDir) }).catch(() => null);
  return { game, keys, gameRoot };
}

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8").catch(() => "null"));

/** Единица в кэше: ключ сошёлся — её интерьеры и строка отчёта готовы. */
async function readPart(file, key) {
  const stored = await readJson(file);
  return stored?.version === SCAN_VERSION && stored.key === key && Array.isArray(stored.units) ? stored : null;
}

async function writePart(file, key, units, row) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ version: SCAN_VERSION, key, units, row })).catch(() => {});
}

/**
 * Каталог проекта: `{ project, units, sources, game, cached }`. `input` —
 * `{ project, gameRoot?, keys?, force?, slugs? }`; `slugs` — только эти паки
 * Astral (папки и кэши игрока читаются как всегда). `tools.onProgress({ stage:
 * "scan", done, total, label })` — после каждой единицы, что пришлось читать.
 */
export async function readCatalog(input, stateDir, tools = {}) {
  const t = { archiveSupport: provisionArchiveSupport, scan: scanSource, ...tools };
  const project = String(input?.project || "");
  if (!PROJECT_IDS.includes(project)) throw new Error("Неизвестный проект.");
  const sources = (await readSources(stateDir)).filter((item) => item.project === project);
  if (!sources.length) return { project, units: [], sources: [], game: Boolean(input?.gameRoot), cached: false };
  const slugs = Array.isArray(input?.slugs) ? new Set(input.slugs.map(String)) : null;

  const { game, keys, gameRoot } = await gameOf(input, stateDir, t);
  /* Пакеты с CDN Astral читаются по одному (каждый сам по себе, как папка игрока); отпечаток — их список. */
  const fetched = new Map();
  for (const source of sources.filter((item) => item.kind === "astral")) fetched.set(source.id, await listFetched(stateDir, project));
  const stamps = [];
  for (const source of sources)
    stamps.push(
      source.kind === "astral"
        ? createHash("sha1").update(JSON.stringify(fetched.get(source.id).map((pack) => [pack.slug, pack.version, pack.bytes, pack.files]))).digest("hex").slice(0, 16)
        : await folderStamp(source.path, { archives: archivesOf(source) }).catch(() => "missing"),
    );
  const gameKey = [game ? "game" : "-", gameRoot.toLowerCase()];
  const key = sha1([SCAN_VERSION, project, sources.map((item) => item.id), stamps, ...gameKey]);

  const file = cacheFile(stateDir, project);
  /* Полный каталог без фильтра и без «Пересканировать»: прежний общий кэш. */
  if (!input?.force && !slugs) {
    const cached = await readJson(file);
    if (cached?.key === key) return { ...answer(project, cached.units, cached.sources, Boolean(game)), cached: true };
  }
  const runKey = slugs ? `${file}|${[...slugs].sort().join(",")}` : file;
  const running = building.get(runKey);
  if (running) return running;

  /* Единицы работы по порядку источников: ключ кэша, чем читать, нужна ли окну. */
  const parts = [];
  sources.forEach((source, index) => {
    if (stamps[index] === "missing") {
      parts.push({ source, missing: true });
      return;
    }
    if (source.kind === "astral") {
      for (const pack of fetched.get(source.id)) {
        const partKey = sha1([SCAN_VERSION, project, "pack", pack.slug, pack.version, pack.bytes, pack.files, ...gameKey]);
        parts.push({ source, pack, key: partKey, file: partFile(stateDir, project, `pack|${pack.slug}`), wanted: !slugs || slugs.has(pack.slug) });
      }
      return;
    }
    const partKey = sha1([SCAN_VERSION, project, "source", source.id, stamps[index], ...gameKey]);
    parts.push({ source, key: partKey, file: partFile(stateDir, project, `source|${source.id}`), wanted: true });
  });

  const scanPart = async (part) => {
    const { source, pack } = part;
    const label = pack ? pack.slug : source.label;
    const opened = await folderSource(pack ? pack.dir : source.path, { keys, archives: pack ? "extension" : archivesOf(source), label });
    try {
      const scanned = await t.scan(opened, { game, installFiles: true });
      const units = [];
      for (const unit of scanned.units) {
        if (pack) {
          /* Имя и место интерьера — из подписанного манифеста пака: имена папок в пакете не человеческие. */
          const named = pack.interiors[unit.id];
          if (named?.label) unit.label = named.label;
          if (named?.place) unit.category = named.place;
          Object.assign(unit.internal, { sourceId: source.id, root: pack.dir, pack: pack.slug });
        } else unit.internal.sourceId = source.id;
        units.push(unit);
      }
      return {
        units,
        row: { files: scanned.stats.files, problems: scanned.problems.length + opened.unreadable.length, unreadableArchives: opened.unreadable.length, count: scanned.units.length },
      };
    } finally {
      await opened.close();
    }
  };

  const job = (async () => {
    /* Сколько единиц придётся читать, известно до чтения: окно держит по ним ход. */
    const results = new Map();
    for (const part of parts) if (!part.missing) results.set(part, input?.force && part.wanted ? null : await readPart(part.file, part.key));
    const toRead = parts.filter((part) => !part.missing && part.wanted && !results.get(part));
    let done = 0;
    t.onProgress?.({ stage: "scan", done, total: toRead.length, label: "" });
    for (const part of toRead) {
      const scanned = await scanPart(part);
      await writePart(part.file, part.key, scanned.units, scanned.row);
      results.set(part, { units: scanned.units, row: scanned.row });
      done += 1;
      t.onProgress?.({ stage: "scan", done, total: toRead.length, label: part.pack?.slug || part.source.label });
    }

    const units = new Map();
    const index = new Map();
    const report = [];
    const rows = new Map();
    for (const part of parts) {
      const { source, pack } = part;
      if (part.missing) {
        report.push({ id: source.id, label: source.label, kind: source.kind, units: 0, files: 0, problems: 0, missing: true });
        continue;
      }
      const stored = results.get(part) || (part.wanted ? null : await readPart(part.file, part.key));
      if (!stored) continue;
      /* Сводный список для установки: интерьеры всех паков, у которых кэш сошёлся. */
      for (const unit of stored.units) if (!index.has(unit.id)) index.set(unit.id, unit);
      if (!part.wanted) continue;
      for (const unit of stored.units) if (!units.has(unit.id)) units.set(unit.id, unit);
      if (pack) {
        const row = rows.get(source.id) || { id: source.id, label: source.label, kind: source.kind, units: 0, files: 0, problems: 0, unreadableArchives: 0, packs: 0 };
        row.units += stored.row.count;
        row.files += stored.row.files;
        row.problems += stored.row.problems;
        row.unreadableArchives += stored.row.unreadableArchives;
        row.packs += 1;
        if (!rows.has(source.id)) {
          rows.set(source.id, row);
          report.push(row);
        }
      } else report.push({ id: source.id, label: source.label, kind: source.kind, units: stored.row.count, files: stored.row.files, problems: stored.row.problems, unreadableArchives: stored.row.unreadableArchives });
    }
    const list = [...units.values()];
    await fs.mkdir(path.dirname(file), { recursive: true });
    /* Сводный кэш: у полного чтения — его ключ (быстрый путь), у частичного — без ключа, но с интерьерами всех готовых паков. */
    await fs.writeFile(file, JSON.stringify({ version: SCAN_VERSION, key: slugs ? null : key, units: slugs ? [...index.values()] : list, sources: report })).catch(() => {});
    return { ...answer(project, list, report, Boolean(game)), cached: toRead.length === 0 };
  })();
  building.set(runKey, job);
  try {
    return await job;
  } finally {
    building.delete(runKey);
  }
}

const answer = (project, units, sources, game) => ({ project, units: units.map(publicUnit), sources, game });

/** Интерьер проекта со списками файлов — для установки и сцены (в окно не уходит). */
export async function findUnit(project, id, stateDir) {
  const cached = await readJson(cacheFile(stateDir, project));
  return cached?.version === SCAN_VERSION ? cached.units?.find((unit) => unit.id === id) || null : null;
}
