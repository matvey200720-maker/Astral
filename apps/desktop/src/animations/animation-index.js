/*
 * Список анимаций мастерской (ТЗ 29.10.2026-d): словари `.ycd` из архивов игры игрока и из его собственных файлов.
 *
 * Только чтение. Игру перечисляет `list-archive-entries` (основной `x64c.rpf`, `update.rpf` и дополнения `dlcpacks`), нужные
 * словари вынимает пачкой `extract-archive-entries`, имена клипов отдаёт `sample-anim-pose` без клипа. Всё это Rust-движок;
 * первое построение — десятки секунд на тысячи словарей, поэтому готовый список лежит в данных приложения под отпечатком игры
 * и построения версии. Свои файлы (`own-sources.js`) читаются так же, но их словари разбираются заново при смене файла.
 *
 * Тело читателя (`animation-reads.js`) выполняется в потоке чтения игры, не в главном процессе Electron.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite } from "../clothing-models.js";
import { animationId, classifyGameDictionary, hiddenClip, humanizeAnimation, skippedClip } from "./animation-catalog.js";

/* Версия правил: другая — список строится заново. */
export const ANIMATION_INDEX_BUILD = "a6";

const ARCHIVE_BATCH = 400;
export const CLIP_WORKERS = 8;
const LIST_LIMIT = 200_000;

const unwrap = (answer) => answer?.result ?? answer ?? {};

export const gameHash = (gameRoot) =>
  createHash("sha256").update(path.resolve(gameRoot).toLowerCase()).digest("hex").slice(0, 16);

/** Папка кэша анимаций игры. */
export const animationsFolder = (stateDir, gameRoot) => path.join(stateDir, "animations", gameRoot ? gameHash(gameRoot) : "own");

/* Порядок разделов в выдаче: эмоции — первыми, толпа танцев — не впереди всего. */
export const sectionRank = (section) => {
  const at = ["emotes", "gestures", "dances", "scenarios", "rest", "poses"].indexOf(section);
  return at < 0 ? 99 : at;
};

/* Пул: не больше `limit` дел сразу, порядок результатов — как у входа. */
export async function pool(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next;
      next += 1;
      out[at] = await task(items[at], at);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Архивы игры, где живут клипы: основной, обновление и каждое дополнение, у которого есть `dlc.rpf`. */
export async function gameAnimationArchives(gameRoot) {
  const archives = [{ archive: "x64c.rpf", pack: "base" }];
  const root = path.join(gameRoot, "update", "x64", "dlcpacks");
  const packs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const pack of packs.filter((item) => item.isDirectory()).map((item) => item.name).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))) {
    const relative = `update/x64/dlcpacks/${pack}/dlc.rpf`;
    if (await fs.stat(path.join(gameRoot, relative)).then((stat) => stat.isFile(), () => false)) archives.push({ archive: relative, pack });
  }
  /* Заплатка `update.rpf` — последней: игра берёт словарь дополнения из `dlc_patch/<пак>/…`, а не из самого пака, и список обязан называть тот файл,
     что играет, — от него строится замена (`animation-install.js`). */
  archives.push({ archive: "update/update.rpf", pack: "update" });
  return archives;
}

/**
 * Словари игры, что годятся в выдачу: `{ dictionary, section, pack, archive, entry }`. Один словарь в нескольких архивах —
 * берётся последний (дополнение перекрывает основной архив, как в игре).
 */
export async function listGameDictionaries({ gameRoot }, context, tools) {
  const found = new Map();
  for (const { archive, pack } of await gameAnimationArchives(gameRoot)) {
    const answer = unwrap(
      await tools.list({ gameRoot, archive, filter: ".ycd", maxEntries: LIST_LIMIT }, context).catch(() => null),
    );
    for (const item of answer.entries || []) {
      const entry = String(item.path || "");
      if (!/\.ycd$/i.test(entry)) continue;
      const dictionary = path.posix.basename(entry).replace(/\.ycd$/i, "").toLowerCase();
      const section = classifyGameDictionary(dictionary);
      if (section) found.set(dictionary, { dictionary, section, pack, archive, entry, size: Number(item.size) || 0 });
    }
  }
  return [...found.values()];
}

/** Вынуть словари пачками: `Map(entry → файл)`. */
async function extractDictionaries(items, { gameRoot, keys, work }, context, tools) {
  const files = new Map();
  const byArchive = new Map();
  for (const item of items) {
    if (!byArchive.has(item.archive)) byArchive.set(item.archive, []);
    byArchive.get(item.archive).push(item);
  }
  let index = 0;
  for (const [archive, list] of byArchive) {
    for (let at = 0; at < list.length; at += ARCHIVE_BATCH) {
      const batch = list.slice(at, at + ARCHIVE_BATCH);
      const outputDirectory = path.join(work, String(index));
      index += 1;
      await fs.mkdir(outputDirectory, { recursive: true });
      const answer = unwrap(
        await tools.native(
          "extract-archive-entries",
          { input: path.join(gameRoot, archive), outputDirectory, entries: batch.map((item) => item.entry), gameRoot, keys },
          context,
        ),
      );
      for (const file of answer.files || []) files.set(`${archive}|${file.entry}`, path.join(outputDirectory, file.file));
    }
  }
  return files;
}

/** Имена клипов словаря из файла `.ycd`. */
export async function clipNames(file, context, tools) {
  const answer = unwrap(await tools.native("sample-anim-pose", { input: file }, context).catch(() => null));
  return Array.isArray(answer.clips) ? answer.clips : [];
}

/** Построенный список: `{ build, gameRoot, entries: [{ id, source, dictionary, clip, name, section, pack, archive, entry }] }`. */
export async function buildGameIndex({ gameRoot, stateDir, keys }, context, tools) {
  const progress = (done, total, phase) => context?.onProgress?.({ phase: "animations-index", step: phase, done, total });
  progress(0, 1, "list");
  const dictionaries = await listGameDictionaries({ gameRoot }, context, tools);
  const work = path.join(stateDir, "animations", "work", randomUUID());
  try {
    await fs.mkdir(work, { recursive: true });
    progress(0, dictionaries.length, "extract");
    const files = await extractDictionaries(dictionaries, { gameRoot, keys, work }, context, tools);
    let done = 0;
    const entries = [];
    await pool(dictionaries, CLIP_WORKERS, async (item) => {
      const file = files.get(`${item.archive}|${item.entry}`);
      const clips = file ? await clipNames(file, context, tools) : [];
      for (const clip of clips) {
        if (hiddenClip(clip) || skippedClip(clip)) continue;
        entries.push({
          id: animationId("game", item.dictionary, clip),
          source: "game",
          dictionary: item.dictionary,
          clip,
          name: humanizeAnimation(item.dictionary, clip),
          section: item.section,
          pack: item.pack,
          archive: item.archive,
          entry: item.entry,
        });
      }
      done += 1;
      if (done % 50 === 0) progress(done, dictionaries.length, "clips");
    });
    entries.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
    progress(dictionaries.length, dictionaries.length, "done");
    return { build: ANIMATION_INDEX_BUILD, gameRoot, entries };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Отпечаток состояния игры для кэша списка (18.11.2026): размер и время записи `update.rpf` и состав `dlcpacks` (имена папок). Обновление игры и новое дополнение
 * меняют отпечаток — список строится заново без «перечитать». Дёшево: один `stat` и один `readdir`, архивы не открываются (`io` — для проверки счёта вызовов).
 */
export async function gameStamp(gameRoot, io = { stat: fs.stat, readdir: fs.readdir }) {
  const root = path.resolve(String(gameRoot));
  const update = await io.stat(path.join(root, "update", "update.rpf")).catch(() => null);
  const packs = await io.readdir(path.join(root, "update", "x64", "dlcpacks"), { withFileTypes: true }).catch(() => []);
  const names = packs
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const parts = [update ? `${update.size}:${Math.round(update.mtimeMs)}` : "none", ...names];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

/** Файл кэша списка игры: версия правил и отпечаток состояния игры в имени. */
export async function gameIndexFile(stateDir, gameRoot, io) {
  return path.join(animationsFolder(stateDir, gameRoot), `index.${ANIMATION_INDEX_BUILD}.${await gameStamp(gameRoot, io)}.json`);
}

/** Файлы списка прежних версий и прежних состояний игры: остаётся один, свежий (папку состояния мусором не растим). */
async function tidyOldIndexes(file) {
  const folder = path.dirname(file);
  for (const name of await fs.readdir(folder).catch(() => []))
    if (/^index\.[a-z0-9]+(?:\.[0-9a-f]{12})?\.json$/.test(name) && path.join(folder, name) !== file) await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
}

/**
 * Список игры из кэша или построенный и записанный. `keys` — каталог ключей или функция, что его отдаёт: ключи нужны только сборке, и поставка ключей
 * зовётся, когда кэш не подошёл (18.11.2026).
 */
export async function readGameIndex({ gameRoot, stateDir, keys, refresh = false }, context, tools) {
  const file = await gameIndexFile(stateDir, gameRoot);
  if (!refresh) {
    const cached = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => null);
    /* Готовый список проходит те же правила скрытия клипов: новое правило (камера парных жестов, 02.11.2026) не перестраивает список на тысячи словарей. */
    if (cached?.build === ANIMATION_INDEX_BUILD && Array.isArray(cached.entries))
      return { ...cached, entries: cached.entries.filter((entry) => !hiddenClip(entry?.clip)) };
  }
  const built = await buildGameIndex({ gameRoot, stateDir, keys: typeof keys === "function" ? await keys() : keys }, context, tools);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, Buffer.from(JSON.stringify(built)));
  await tidyOldIndexes(file);
  return built;
}
