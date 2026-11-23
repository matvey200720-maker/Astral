/*
 * Кэш сырых блоков листов на диске читателя (этап 2 «3D на Rust», шаг A1): чистый модуль, ему дают папку, ключ (строку) и байты.
 *
 * Файл кэша — контейнер ASB1 с одной записью, тот же формат, что в ответе читателя (`workshop-sheet-blocks.js`: `packSheets([entry])`
 * и обратно `unpackSheet`); при сборке ответа запись переносится в общий контейнер с флагом «из кэша». Файлы лежат в своей
 * подпапке `bcn1/` рядом с `.webp`, чтобы не мешаться с ними. Имя — первые 32 знака sha256 от ключа и `.asb`; ключ собирает вызывающий
 * (источник, имя листа, размер, отпечаток архива, версия правил хвоста и список форматов `accept`: разные наборы форматов — разные листы).
 *
 * Потолок по сумме размеров (по умолчанию 512 МБ). При старте — один асинхронный обход папки (размер и время изменения); после записи сверх
 * потолка самые давно использованные файлы удаляются до 90 % потолка. Попадание освежает время использования: в памяти сразу, на диске —
 * `utimes` не чаще раза за сеанс на файл и без ожидания. Запись атомарна (временный файл и переименование). Любая ошибка диска (нет места,
 * файл занят, папку не создать) — не исключение наружу: чтение даёт `null`, запись — `false`, лист отдаётся без кэша.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { unpackSheet } from "./workshop-sheet-blocks.js";

export const SHEET_CACHE_FOLDER = "bcn1";
export const SHEET_CACHE_LIMIT_BYTES = 512 * 1024 * 1024;
const KEEP_FRACTION = 0.9;
const SCAN_BATCH = 64;
/* Временный файл старше этого срока — остаток оборванной записи, при старте он удаляется. */
const STALE_TEMP_MS = 10 * 60 * 1000;
const EXTENSION = ".asb";

/** Имя файла кэша по ключу: первые 32 знака sha256 и `.asb`. */
export function sheetCacheFileName(key) {
  return `${createHash("sha256").update(String(key)).digest("hex").slice(0, 32)}${EXTENSION}`;
}

/**
 * @param {{ root: string, limitBytes?: number, now?: () => number }} options
 *   `root` — папка кэша листов (файлы лягут в `<root>/bcn1/`); `now` — часы (для тестов).
 */
export function createSheetCache({ root, limitBytes = SHEET_CACHE_LIMIT_BYTES, now = Date.now } = {}) {
  const dir = path.join(String(root || ""), SHEET_CACHE_FOLDER);
  const limit = Math.max(0, Number(limitBytes) || 0);
  /** имя файла → { size, used } */
  const index = new Map();
  const touched = new Set();
  const inflight = new Map();
  const background = new Set();
  const stats = { hits: 0, misses: 0, corrupt: 0, writes: 0, evicted: 0, errors: 0 };
  let total = 0;
  let usable = false;
  let evicting = Promise.resolve();
  let sequence = 0;

  const track = (promise) => {
    const tracked = promise.catch(() => {}).finally(() => background.delete(tracked));
    background.add(tracked);
    return tracked;
  };

  /** Один обход папки: размеры и времена, остатки временных файлов. */
  const scan = async () => {
    try {
      await fs.mkdir(dir, { recursive: true });
      usable = true;
      const names = await fs.readdir(dir);
      for (let from = 0; from < names.length; from += SCAN_BATCH) {
        await Promise.all(
          names.slice(from, from + SCAN_BATCH).map(async (name) => {
            const file = path.join(dir, name);
            try {
              const stat = await fs.stat(file);
              if (!stat.isFile()) return;
              if (name.endsWith(EXTENSION)) {
                index.set(name, { size: stat.size, used: stat.mtimeMs });
                total += stat.size;
              } else if (name.endsWith(".tmp") && now() - stat.mtimeMs > STALE_TEMP_MS) {
                await fs.unlink(file);
              }
            } catch {
              /* исчез между обходом и stat — не наш файл */
            }
          }),
        );
      }
    } catch {
      stats.errors += 1;
    }
  };

  const evict = (keep) => {
    evicting = evicting.then(async () => {
      try {
        if (total <= limit) return;
        const target = limit * KEEP_FRACTION;
        const order = [...index].filter(([name]) => name !== keep).sort((a, b) => a[1].used - b[1].used || (a[0] < b[0] ? -1 : 1));
        for (const [name, meta] of order) {
          if (total <= target) break;
          index.delete(name);
          touched.delete(name);
          total -= meta.size;
          stats.evicted += 1;
          await fs.unlink(path.join(dir, name)).catch(() => {});
        }
      } catch {
        stats.errors += 1;
      }
    });
    return track(evicting);
  };

  const forget = async (name, file) => {
    const known = index.get(name);
    if (known) {
      index.delete(name);
      total -= known.size;
    }
    touched.delete(name);
    if (file) await fs.unlink(file).catch(() => {});
  };

  const ready = scan().then(() => (total > limit ? evict(null) : undefined));

  /** Прочитать и проверить файл ключа: `{ bytes, entry }` или `null` (нет файла, файл битый и удалён, диск не читается). Попадание освежает файл. */
  async function load(key) {
    await ready;
    if (!usable) return null;
    const name = sheetCacheFileName(key);
    const file = path.join(dir, name);
    let bytes;
    try {
      bytes = await fs.readFile(file);
    } catch (error) {
      if (error?.code === "ENOENT") await forget(name, null);
      else stats.errors += 1;
      stats.misses += 1;
      return null;
    }
    const entry = unpackSheet(bytes);
    if (!entry) {
      stats.corrupt += 1;
      stats.misses += 1;
      await forget(name, file);
      return null;
    }
    const known = index.get(name);
    total += bytes.length - (known ? known.size : 0);
    index.set(name, { size: bytes.length, used: now() });
    if (!touched.has(name)) {
      touched.add(name);
      const stamp = new Date(now());
      track(fs.utimes(file, stamp, stamp));
    }
    stats.hits += 1;
    return { bytes, entry };
  }

  return {
    dir,

    /** Запись из кэша в виде, который принимает `packSheets` (с `fromCache: true`), или `null`: нет файла, файл битый (он удаляется), диск не читается. */
    async get(key) {
      return (await load(key))?.entry ?? null;
    },

    /** Байты файла кэша (проверенные, без разбора и перепаковки) или `null`: готовый контейнер для ответа читателя. Буфер — свежий, им можно распоряжаться (передать потоку). */
    async getFile(key) {
      return (await load(key))?.bytes ?? null;
    },

    /**
     * Известен ли файл ключа оглавлению (обход папки при старте, записи и попадания этого сеанса, подсказки `note`) — без чтения диска. Файл, который положил другой писатель
     * (движок) мимо оглавления, неизвестен, пока ему не подскажут или не обойдут папку заново: для него `false` — это «не знаю», а не «нет файла».
     */
    async has(key) {
      await ready;
      return usable && index.has(sheetCacheFileName(key));
    },

    /**
     * Подсказка: другой писатель (движок) положил файл ключа длиной `size` — запись в оглавление без чтения диска. Файла может ещё не быть (движок пишет следом за ответом):
     * первое чтение с ENOENT уберёт запись само. `true` — оглавление знает ключ.
     */
    async note(key, size) {
      await ready;
      if (!usable || !(size > 0)) return false;
      const name = sheetCacheFileName(key);
      if (index.has(name)) return true;
      total += size;
      index.set(name, { size, used: now() });
      if (total > limit) evict(name);
      return true;
    },

    /** Положить файл (контейнер ASB1 с одной записью) под ключ. `true` — лежит на диске; `false` — не записан (кэш недоступен, ошибка диска, файл больше потолка). Одновременные записи одного ключа сливаются в одну. */
    put(key, bytes) {
      const name = sheetCacheFileName(key);
      if (inflight.has(name)) return inflight.get(name);
      const job = (async () => {
        await ready;
        if (!usable || !(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > limit) return false;
        const file = path.join(dir, name);
        const temporary = path.join(dir, `${name}.${process.pid}.${(sequence += 1)}.tmp`);
        try {
          await fs.writeFile(temporary, bytes);
          await fs.rename(temporary, file);
        } catch {
          stats.errors += 1;
          await fs.unlink(temporary).catch(() => {});
          return index.has(name);
        }
        const known = index.get(name);
        total += bytes.length - (known ? known.size : 0);
        index.set(name, { size: bytes.length, used: now() });
        touched.add(name);
        stats.writes += 1;
        if (total > limit) evict(name);
        return true;
      })();
      inflight.set(name, job);
      const clear = () => inflight.delete(name);
      job.then(clear, clear);
      return job;
    },

    /** Дождаться начатого обхода, вытеснения и обновления времён (для тестов и выхода). */
    async idle() {
      await ready;
      await Promise.all([...inflight.values()]);
      while (background.size > 0) await Promise.all([...background]);
      await evicting.catch(() => {});
    },

    stats() {
      return { files: index.size, bytes: total, limitBytes: limit, usable, ...stats };
    },
  };
}
