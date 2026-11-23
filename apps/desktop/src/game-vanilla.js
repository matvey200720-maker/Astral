/*
 * Штатные записи update.rpf — чем сборка человека отличается от игры
 * (задача 1 ТЗ 07.10.2026).
 *
 * Движок спрашивает «оставить своё или заменить», когда кладёт запись
 * целиком поверх правки чужого мода (`@modovik/install-engine`,
 * `foreign-entries.js`). Чужая ли запись — решает опись штатных записей
 * версии игры (`resources/game-vanilla/*.json.gz`, `npm run
 * game:vanilla-index`): путь → 16 знаков хеша содержимого тем же правилом,
 * что у разбора редуксов (`entryContentHash`: у ресурса — заголовок и
 * распакованное тело, пересжатый OpenIV файл правкой не считается).
 *
 * Подходит ли опись игре человека, видно по самой основе: выборка записей,
 * которых пакет не касается, должна совпасть хотя бы на 75 %. Другая версия
 * игры (Rockstar выпустила обновление, опись старая) не совпадёт — и
 * вопросов не будет: лучше промолчать, чем назвать чужим весь архив.
 * Ответ помнится на отпечаток основы, решения о записях — тоже.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { entryContentHash } from "@modovik/rpf-inspector/baseline";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const UPDATE_TARGET = "update/update.rpf";
const RSC7 = 0x37435352;
export const VANILLA_MATCH_SHARE = 0.75;
export const VANILLA_SAMPLE = 24;

const lower = (value) => String(value || "").toLowerCase();

function indexDirectories() {
  return [
    process.env.ASTRAL_GAME_VANILLA,
    process.resourcesPath && path.join(process.resourcesPath, "game-vanilla"),
    path.resolve(moduleDirectory, "../../../resources/game-vanilla"),
  ].filter(Boolean);
}

/** Опись из файла или `null`, если файл — не опись Astral. */
export async function readVanillaIndex(file) {
  try {
    const raw = await fs.readFile(file);
    const text = (raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw).toString("utf8");
    const parsed = JSON.parse(text);
    if (parsed?.schema !== 1 || !parsed.entries || typeof parsed.entries !== "object") return null;
    return {
      file,
      archive: lower(parsed.archive || UPDATE_TARGET),
      edition: String(parsed.edition || "Legacy"),
      version: String(parsed.version || ""),
      entries: parsed.entries,
    };
  } catch {
    return null;
  }
}

async function loadIndexes(directories) {
  const found = [];
  for (const directory of directories) {
    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names.filter((item) => /\.json(\.gz)?$/i.test(item)).sort().reverse()) {
      const index = await readVanillaIndex(path.join(directory, name));
      if (index && !found.some((item) => item.version === index.version && item.edition === index.edition))
        found.push(index);
    }
    if (found.length) break;
  }
  return found;
}

let indexesPromise = null;

/** Все описи поставки (кэш на запуск); `directories` — для тестов. */
export function readVanillaIndexes({ directories = null } = {}) {
  if (directories) return loadIndexes(directories);
  indexesPromise ||= loadIndexes(indexDirectories());
  return indexesPromise;
}

/** 16 знаков хеша содержимого записи, вынутой помощником. */
export async function entryHash16(file) {
  const bytes = await fs.readFile(file);
  const resource = bytes.length >= 16 && bytes.readUInt32LE(0) === RSC7;
  return entryContentHash(bytes, { resource }).slice(0, 16);
}

/* Записи для выборки: равномерно по описи, мимо тех, о которых спрашивают. */
function sampleEntries(index, exclude, size) {
  const skip = new Set(exclude.map(lower));
  const keys = Object.keys(index.entries).filter((key) => !skip.has(key) && !key.endsWith(".rpf"));
  if (keys.length <= size) return keys;
  const step = keys.length / size;
  return Array.from({ length: size }, (_, position) => keys[Math.floor(position * step + step / 2)]);
}

/**
 * Проверка чужих правок для движка: `tools` — чтение записей помощником RPF
 * (`entryProbe`, `entryReader` из `direct-base-tools.js`).
 */
export function createForeignDetector({
  entryProbe,
  entryReader,
  readIndexes = () => readVanillaIndexes(),
  sampleSize = VANILLA_SAMPLE,
  matchShare = VANILLA_MATCH_SHARE,
} = {}) {
  /* Какая опись подошла основе: отпечаток основы → опись или `null`. */
  const fitted = new Map();
  /* Ответы о записях: `отпечаток|запись` → вердикт. */
  const verdicts = new Map();

  return async function detectForeignEntries({
    archivePath,
    archiveTarget,
    baseSha256 = null,
    entries = [],
    gameRoot,
    edition,
    stateDir,
    signal,
  }) {
    const out = new Map();
    if (lower(archiveTarget) !== UPDATE_TARGET || !entries.length) return out;
    const indexes = (await readIndexes()).filter(
      (index) => index.archive === UPDATE_TARGET && (!edition || index.edition === edition),
    );
    if (!indexes.length) {
      for (const entry of entries) out.set(entry, "unknown");
      return out;
    }
    const baseKey = baseSha256 || `${lower(archivePath)}`;
    const work = path.join(stateDir || os.tmpdir(), "foreign-check", randomUUID());
    const request = { archivePath, archiveTarget: UPDATE_TARGET, gameRoot, edition, signal };
    const read = async (list) => {
      if (!list.length) return { present: new Set(), hashes: new Map() };
      const present = new Set(
        [...(await entryProbe({ ...request, entries: list }))].map((entry) => lower(entry)),
      );
      const wanted = list.filter((entry) => present.has(lower(entry)));
      const extracted = wanted.length
        ? await entryReader({ ...request, entries: wanted, outputDirectory: path.join(work, randomUUID()) })
        : [];
      const hashes = new Map();
      for (const item of extracted || []) hashes.set(lower(item.entry), await entryHash16(item.file));
      return { present, hashes };
    };
    try {
      let index = fitted.get(baseKey);
      if (index === undefined) {
        index = null;
        for (const candidate of indexes) {
          const sample = sampleEntries(candidate, entries, sampleSize);
          if (!sample.length) continue;
          const { hashes } = await read(sample);
          const matched = sample.filter((entry) => hashes.get(entry) === candidate.entries[entry]).length;
          if (matched / sample.length >= matchShare) {
            index = candidate;
            break;
          }
        }
        fitted.set(baseKey, index);
      }
      if (!index) {
        for (const entry of entries) out.set(entry, "unknown");
        return out;
      }
      const unknown = entries.filter((entry) => !verdicts.has(`${baseKey}|${lower(entry)}`));
      if (unknown.length) {
        const { present, hashes } = await read(unknown);
        for (const entry of unknown) {
          const key = lower(entry);
          const verdict = !present.has(key)
            ? "absent"
            : key.endsWith(".rpf")
              ? /* Вложенный архив целиком опись не описывает. */ "unknown"
            : !index.entries[key]
              ? /* В штатной игре такой записи нет — её добавил мод. */ "foreign"
              : hashes.get(key) === index.entries[key]
                ? "vanilla"
                : "foreign";
          verdicts.set(`${baseKey}|${key}`, verdict);
        }
      }
      for (const entry of entries) out.set(entry, verdicts.get(`${baseKey}|${lower(entry)}`) || "unknown");
      return out;
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  };
}
