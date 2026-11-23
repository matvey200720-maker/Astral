/*
 * Уменьшенные превью облачных картинок (30.10.2026, «чтобы быстро грузились фотки»).
 *
 * Обложка в облаке — оригинал 1200 × 800 (медиана 263 КБ, до 1,7 МБ), а карточка каталога показывает её шириной до ~330 px. Окно просит `?w=<ширина>` из короткого ряда
 * ширин, и этот модуль отдаёт уменьшенный webp, который лежит на диске рядом с оригиналом (`<хэш>.w<ширина>.webp`): ключ — хэш картинки и ширина, а не адрес страницы.
 * Уменьшает sharp (libvips) в своих потоках, не в главном потоке JS; одновременно идут не больше четырёх, а работа, которую уже никто не ждёт (окно закрыло запрос,
 * карточка уехала за край), в очереди отбрасывается. Нет sharp или картинка не годится (анимация, уже уже нужной ширины, порча) — отдаётся оригинал.
 *
 * Превью — производные файлы, их можно пересоздать из оригинала, поэтому место под них ограничено (31.10.2026): не больше `THUMB_CACHE_MAX_BYTES`, лишнее — самые давние по
 * использованию. Время использования — `mtime`: файл, отданный из кэша и старше `TOUCH_AFTER_MS`, обновляется (на NTFS `atime` не ведётся). Чистит `createThumbCacheKeeper`:
 * при старте API через полминуты и ещё раз, когда за сеанс накопилось много нового; по одной папке за раз с паузой между ними, чтобы не мешать окну. Оригиналы
 * (`<хэш>`, `<хэш>.type`) не трогаются.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

/** Допустимые ширины превью: просить можно только их (иначе кэш рос бы от любого `?w=`). */
/* 1280 и 1600 — кадр открытой карточки (18.11.2026): рамка 750–1100 css px на экранах 100–150 %. Тот же ряд, что в окне (`utils/cover-thumb.js`), сверяется тестом `cloud-media-thumb`. */
export const THUMB_WIDTHS = Object.freeze([360, 540, 720, 960, 1280, 1600]);
export const THUMB_TYPE = "image/webp";
const THUMB_SOURCES = new Set(["image/jpeg", "image/png", "image/webp"]);
const THUMB_QUALITY = 80;

/** Сколько места занимают превью в кэше облачных картинок. */
export const THUMB_CACHE_MAX_BYTES = 300 * 1024 * 1024;
/* Чистка опускает кэш не до потолка, а ниже: иначе каждый старт срезал бы по паре файлов. */
const THUMB_CACHE_TARGET = 0.9;
const TOUCH_AFTER_MS = 6 * 60 * 60 * 1000;
const STALE_TEMPORARY_MS = 24 * 60 * 60 * 1000;
const THUMB_NAME = /\.w\d+\.webp$/;

/** Ширина из запроса или 0, если такой нет в ряду. */
export function thumbWidthOf(value) {
  const width = Number(value);
  return THUMB_WIDTHS.includes(width) ? width : 0;
}

export const thumbFileOf = (file, width) => `${file}.w${width}.webp`;

async function loadSharp() {
  const module = await import("sharp");
  return module.default || module;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Чистка превью: считает файлы `*.w<ширина>.webp` в кэше `root` (две вложенности: `<первые два знака хэша>/<файл>`) и, если их больше `maxBytes`, удаляет самые давние
 * по `mtime`, пока не останется `THUMB_CACHE_TARGET` потолка. Давно брошенные `*.tmp` (прерванная запись) уходят всегда. По одной папке за раз с паузой `pauseMs`; файл,
 * который успели обновить или открыли (Windows не даёт удалить), остаётся. Возвращает `{ files, bytes, removed, freed }`.
 */
export async function pruneThumbs(root, { maxBytes = THUMB_CACHE_MAX_BYTES, pauseMs = 2, now = Date.now(), pause = sleep } = {}) {
  const kept = [];
  let bytes = 0;
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return { files: 0, bytes: 0, removed: 0, freed: 0 };
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    let names;
    try {
      names = await readdir(path.join(root, dir.name));
    } catch {
      continue;
    }
    for (const name of names) {
      const thumb = THUMB_NAME.test(name);
      const temporary = name.endsWith(".tmp");
      if (!thumb && !temporary) continue;
      const file = path.join(root, dir.name, name);
      try {
        const info = await stat(file);
        if (!info.isFile()) continue;
        if (temporary) {
          if (now - info.mtimeMs > STALE_TEMPORARY_MS) await rm(file, { force: true });
          continue;
        }
        kept.push({ file, size: info.size, mtimeMs: info.mtimeMs });
        bytes += info.size;
      } catch {}
    }
    await pause(pauseMs);
  }
  const files = kept.length;
  if (bytes <= maxBytes) return { files, bytes, removed: 0, freed: 0 };
  const goal = maxBytes * THUMB_CACHE_TARGET;
  kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let removed = 0;
  let freed = 0;
  for (const entry of kept) {
    if (bytes - freed <= goal) break;
    try {
      /* Обновлён после подсчёта — им пользуются, оставляем. */
      if ((await stat(entry.file)).mtimeMs !== entry.mtimeMs) continue;
      await rm(entry.file);
      freed += entry.size;
      removed += 1;
    } catch {}
    if (removed && removed % 50 === 0) await pause(pauseMs);
  }
  return { files, bytes, removed, freed };
}

/**
 * Сторож кэша превью: `start()` ставит чистку через `delayMs` после старта API (не мешает запуску), `made(bytes)` — вызывается на каждое новое превью, и когда за сеанс
 * накопилось `regrowBytes`, чистка запускается ещё раз (через `rerunMs`). Таймеры не держат процесс. Сбой чистки молчит: кэш и без неё работает.
 */
export function createThumbCacheKeeper(
  root,
  { maxBytes = THUMB_CACHE_MAX_BYTES, delayMs = 30_000, rerunMs = 5_000, regrowBytes = 64 * 1024 * 1024, prune = pruneThumbs } = {},
) {
  let timer = null;
  let running = null;
  let grown = 0;
  const arm = (delay) => {
    if (timer || running) return;
    timer = setTimeout(() => {
      timer = null;
      grown = 0;
      running = prune(root, { maxBytes })
        .catch(() => {})
        .finally(() => {
          running = null;
        });
    }, delay);
    timer.unref?.();
  };
  return {
    start: () => arm(delayMs),
    made(bytes) {
      grown += bytes;
      if (grown >= regrowBytes) arm(rerunMs);
    },
    /** Дождаться идущей чистки (тесты). */
    idle: async () => {
      while (timer || running) await (running || sleep(5));
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
  };
}

/* Файл использовали — освежаем `mtime`, чтобы чистка считала его недавним; не на каждый запрос, а когда прошло `TOUCH_AFTER_MS`. */
function touch(file, info) {
  if (Date.now() - info.mtimeMs <= TOUCH_AFTER_MS) return;
  const stamp = new Date();
  utimes(file, stamp, stamp).catch(() => {});
}

/**
 * Фабрика превью: `thumbnail(file, type, width, signal)` → `{file, type}` или `null` (отдать оригинал).
 * `load` — как получить sharp (в тестах подменяется), `limit` — сколько уменьшений идёт одновременно, `onMade(байты)` — вызывается на каждое новое превью.
 */
export function createThumbnailer({ load = loadSharp, limit = 4, onMade = null } = {}) {
  const jobs = new Map();
  const queue = [];
  /* Картинки, из которых превью не вышло или не нужно: повторно не пробуем до перезапуска. */
  const declined = new Set();
  let running = 0;
  let sharpPromise = null;

  const pump = () => {
    while (running < limit && queue.length) {
      const job = queue.shift();
      if (job.waiters === 0) {
        jobs.delete(job.key);
        job.resolve(null);
        continue;
      }
      running += 1;
      job.run().then(job.resolve, () => job.resolve(null)).finally(() => {
        running -= 1;
        jobs.delete(job.key);
        pump();
      });
    }
  };

  const ready = () => (sharpPromise ||= load().catch(() => null));

  async function make(file, width) {
    const sharp = await ready();
    if (!sharp) return null;
    const out = thumbFileOf(file, width);
    /* Байты, а не путь: libvips держит открытый файл по пути, и на Windows его потом нельзя ни стереть, ни заменить. */
    const bytes = await readFile(file);
    const info = await sharp(bytes, { failOn: "none" }).metadata();
    if (!info.width || (info.pages || 1) > 1 || info.width <= width) return null;
    /* В буфер, а не `toFile`: libvips открывает путь сам и спотыкается о 260 знаков Windows (хэш и uuid уже дают ~110), а Node записывает длинные пути. */
    const data = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: true, kernel: "lanczos3" })
      .webp({ quality: THUMB_QUALITY, effort: 3 })
      .toBuffer();
    const temporary = `${out}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, out);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    onMade?.(data.length);
    return out;
  }

  async function thumbnail(file, type, width, signal) {
    if (!width || !THUMB_SOURCES.has(type) || signal?.aborted) return null;
    const out = thumbFileOf(file, width);
    try {
      const info = await stat(out);
      if (info.isFile()) {
        touch(out, info);
        return { file: out, type: THUMB_TYPE };
      }
    } catch {}
    if (signal?.aborted) return null;
    const key = out;
    if (declined.has(key)) return null;
    let job = jobs.get(key);
    if (!job) {
      job = { key, waiters: 0 };
      job.promise = new Promise((resolve) => {
        job.resolve = resolve;
      });
      job.run = async () => {
        try {
          const made = await make(file, width);
          if (!made) declined.add(key);
          return made ? { file: made, type: THUMB_TYPE } : null;
        } catch (error) {
          /* Сбой превью не ломает картинку (отдаётся оригинал), но и молчать о нём нельзя: первый — в журнал. */
          if (!declined.size) console.warn("[media-thumb] превью не вышло:", error?.message || error);
          declined.add(key);
          return null;
        }
      };
      jobs.set(key, job);
      queue.push(job);
    }
    job.waiters += 1;
    const leave = () => {
      job.waiters -= 1;
    };
    signal?.addEventListener("abort", leave, { once: true });
    pump();
    const result = await job.promise;
    signal?.removeEventListener("abort", leave);
    return signal?.aborted ? null : result;
  }

  /* Загрузка sharp (~80 мс) идёт, пока оригинал ещё качается с CDN, а не после него: у первого экрана холодного кэша это время не тратится вхолостую. */
  thumbnail.prepare = ready;
  return thumbnail;
}
