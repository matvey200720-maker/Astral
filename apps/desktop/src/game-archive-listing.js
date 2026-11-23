/*
 * Оглавления архивов игры из движка (`rpf-listing`) под видом читателя `openRpfFile` (14.11.2026, работа «Astral быстрее»).
 *
 * Перепись карты (`texture-census.js`) и поиск имён сетевой карты (`game-map-names.js`) открывают каждый архив игры: 117 архивов, 360 тысяч
 * записей, 6 с на одни оглавления читателем JS — и так дважды за сборку дорог (замер тестового ПК: перепись 10 с, имена карты 7,5 с).
 * Движок открывает их разом в несколько потоков; оба разбора берут читателя параметром `open`, и сюда он приходит готовый: список записей
 * тот же и в том же порядке (`scripts/probe-archive-listing.mjs` сверяет с читателем JS), мелкие файлы (`setup2.xml`, `content.xml`,
 * `dlclist.xml`) едут в ответе, а отпечатки словарей и моделей `update.rpf` — готовыми. Любое другое чтение и любой архив, которого в ответе
 * нет, идут прежним читателем — он поднимается по первому требованию.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openRpfFile } from "@modovik/rpf7/node";
import { engineScratchDirectory, runEngineCommand } from "./engine-run.js";

const REQUEST_FORMAT = "astral.rpf-listing";
/* Мелкие файлы, что разборы читают у каждого пакета: едут в ответе байтами. */
const INLINE_FILES = ["setup2.xml", "content.xml", "dlclist.xml"];
/* Записи `update.rpf`, чьи отпечатки нужны переписи (словари и модели). */
const HASH_EXTENSIONS = ["ytd", "ydr", "ydd", "yft"];
const KINDS = ["directory", "binary", "resource"];

/** Оглавления из движка выключает `ASTRAL_ENGINE_LISTING=0`: архивы игры читает прежний читатель (для сравнения «до» и на случай отказа). */
export const archiveListingEnabled = () => process.env.ASTRAL_ENGINE_LISTING !== "0";

const keyOf = (file) => path.resolve(String(file)).split(path.sep).join("/").toLowerCase();
const exists = (file) => fs.stat(file).then((stat) => stat.isFile(), () => false);

/** Архивы игры, что открывают перепись карты и поиск имён карты: `update.rpf`, базовые `x64?.rpf`, пакеты дополнений. */
export async function gameArchiveFiles(gameRoot) {
  const root = path.resolve(gameRoot);
  const files = [];
  const update = path.join(root, "update", "update.rpf");
  if (await exists(update)) files.push(update);
  for (const name of (await fs.readdir(root).catch(() => [])).filter((item) => /^x64[a-z]\.rpf$/i.test(item)).sort()) files.push(path.join(root, name));
  for (const base of [path.join(root, "update", "x64", "dlcpacks"), path.join(root, "x64", "dlcpacks")])
    for (const folder of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!folder.isDirectory()) continue;
      for (const name of ["dlc.rpf", "dlc1.rpf", "dlc2.rpf"]) {
        const file = path.join(base, folder.name, name);
        if (await exists(file)) files.push(file);
      }
    }
  return { files, update };
}

/* Архив из ответа движка с повадками читателя: `entries`, `read`, `close`. Чтение, которого в ответе нет, поднимает прежнего читателя. */
function listedArchive(file, listing, options) {
  const entries = listing.entries.map(([entryPath, kind, storedSize]) => ({
    path: entryPath,
    name: entryPath.slice(entryPath.lastIndexOf("/") + 1),
    kind: KINDS[kind],
    ...(kind === 0 ? {} : { storedSize }),
  }));
  const inline = new Map(Object.entries(listing.inline || {}).map(([entryPath, text]) => [entryPath.toLowerCase(), text]));
  let real = null;
  return {
    entries,
    async read(entryPath) {
      const key = String(entryPath || "").replaceAll("\\", "/").toLowerCase().replace(/^\/+/, "");
      const text = inline.get(key);
      if (text !== undefined) return Buffer.from(text, "base64");
      real ||= openRpfFile(file, options);
      return (await real).read(entryPath);
    },
    async close() {
      const opened = real;
      real = null;
      await (await opened?.catch(() => null))?.close?.();
    },
  };
}

/**
 * Оглавления архивов игры одним запуском движка: `{ open, updateHashes, archives, ms }`. `open(file, options)` — замена `openRpfFile` для
 * переписи и поиска имён карты; `updateHashes` — отпечатки словарей и моделей `update.rpf` (путь записи → 32 знака SHA-256), как их считает
 * перепись. Архив, которого в ответе нет или который движок не открыл, читает прежний читатель.
 */
export async function listGameArchives({ executable, gameRoot, keysDirectory = "", threads = 6, onSpawn = null, signal = null, scratchRoot = "" }) {
  const started = Date.now();
  const { files, update } = await gameArchiveFiles(gameRoot);
  const scratch = await engineScratchDirectory("astral-rpf-listing-", scratchRoot);
  try {
    const requestFile = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: REQUEST_FORMAT,
        version: 1,
        gameRoot,
        threads: Math.max(1, Math.floor(threads) || 1),
        inline: INLINE_FILES,
        hashExtensions: HASH_EXTENSIONS,
        archives: files.map((file) => ({ label: keyOf(file), file, hash: file === update })),
      }),
    );
    const result = await runEngineCommand(executable, ["rpf-listing", "--request", requestFile, ...(keysDirectory ? ["--keys", keysDirectory] : [])], { onSpawn, signal });
    const listed = new Map((result.archives || []).filter((item) => item?.ok === true && Array.isArray(item.entries)).map((item) => [item.label, item]));
    const updateListing = listed.get(keyOf(update));
    return {
      open: async (file, options) => {
        const listing = listed.get(keyOf(file));
        return listing ? listedArchive(file, listing, options) : openRpfFile(file, options);
      },
      updateHashes: updateListing ? new Map(Object.entries(updateListing.hashes || {})) : null,
      archives: listed.size,
      ms: Date.now() - started,
    };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
