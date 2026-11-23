/*
 * Подстройка под диск (01.11.2026, владелец: «у людей, у которых диск слабый, он не должен долбиться в сотку»).
 *
 * Потолок 250 МБ/с подобран на NVMe; жёсткому диску и QLC с кончившимся кэшем это потолок выше их скорости. Здесь процесс
 * меряет собственные операции и держит нагрузку примерно на половине того, что диск сейчас может:
 *
 *   — большие записи идут сквозь кэш системы (`disk-care.js`), поэтому время записи — честная мера диска, а не памяти;
 *   — большие чтения: то, что отдал кэш системы, видно по скорости и в счёт не идёт;
 *   — сброс на диск (`datasync`) короткой пробой: задержка сброса отличает жёсткий диск от любого SSD надёжнее, чем скорость;
 *   — медиана последних операций, а не лучшая: QLC пишет гигабайт в секунду, пока жив кэш ячеек, и 80 МБ/с после него.
 *
 * Сон потолка в замер не входит, поэтому подстройка не душит сама себя: потолок уже стоит, а диск освободился — следующие
 * операции покажут это, и потолок поднимется. Выше прежнего умолчания потолок не поднимается: на NVMe всё идёт как раньше.
 * «Быстрая установка», включённая человеком, главнее подстройки: тормоз снят целиком (`storage-manager.js`, `fastInstall`).
 *
 * Числа живут на диск (том) и переживают запуск: первая установка после запуска не начинает с незнания.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MEGABYTE = 1024 * 1024;
/* Прежнее умолчание: на быстром диске подстройка ничего не меняет. */
export const AUTO_WRITE_CEILING_MBPS = 250;
const MIN_WRITE_LIMIT_MBPS = 8;
const MIN_READ_LIMIT_MBPS = 16;
/* Операции меньше этого (`datasync` отдельно) скорость диска не показывают: один доступ к файловой системе решает всё. */
const MIN_SAMPLE_BYTES = MEGABYTE;
/* Быстрее этого читает только кэш системы: в счёт диска не идёт. */
const CACHED_READ_MBPS = 4000;
const WINDOW = 48;
const MIN_SAMPLES = 8;
const PROBE_BLOCK_BYTES = 2 * MEGABYTE;
const PROBE_BLOCKS = 8;
const PROBE_FLUSHES = 6;
export const PROBE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 2000;
const FIELD = Object.freeze({ write: "writeMBps", read: "readMBps" });

const profiles = new Map();
const listeners = new Set();
/* Поток копии (`copy-worker.js`) своих чисел не держит: отправляет замеры главному потоку. */
let sampleSink = null;
export const setDiskSampleSink = (sink) => {
  sampleSink = sink;
};
let store = null;
let saveTimer = null;
let saving = Promise.resolve();

export const volumeOf = (place) => path.parse(path.resolve(String(place))).root.toUpperCase();

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

function profileOf(volume) {
  let profile = profiles.get(volume);
  if (!profile) {
    profile = { writeMBps: 0, readMBps: 0, flushMs: 0, probedAt: 0, samples: { write: [], read: [] } };
    profiles.set(volume, profile);
  }
  return profile;
}

function changed() {
  scheduleSave();
  for (const listener of listeners) listener();
}

/*
 * Куда ещё пишет Astral, кроме кэша: папки игры (их знает движок, а не «Хранилище»). Новая папка — повод посмотреть на её диск.
 */
const places = new Set();
export function noteDiskPlaces(list) {
  let fresh = false;
  for (const place of list || []) {
    if (!place || places.has(place)) continue;
    places.add(place);
    fresh = true;
  }
  if (fresh) for (const listener of listeners) listener({ places: true });
}
export const knownDiskPlaces = () => [...places];

/** Подписка на смену чисел. Ответ — отписка. */
export function onDiskProfileChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function saveNow() {
  const file = store;
  if (!file) return;
  saving = saving.then(async () => {
    const disks = Object.fromEntries([...profiles].map(([volume, { writeMBps, readMBps, flushMs, probedAt }]) => [volume, { writeMBps, readMBps, flushMs, probedAt }]));
    const stage = `${file}.${randomUUID()}.stage`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(stage, JSON.stringify({ schema: 1, disks }));
      await fs.rename(stage, file);
    } catch {
      await fs.rm(stage, { force: true }).catch(() => {});
    }
  });
}

function scheduleSave() {
  if (!store || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

/** Где помнить числа между запусками (рядом с настройками «Хранилища»). */
export async function openDiskProfiles(file) {
  store = path.resolve(String(file));
  try {
    const data = JSON.parse(await fs.readFile(store, "utf8"));
    for (const [volume, item] of Object.entries(data?.disks || {})) {
      const profile = profileOf(volume);
      for (const key of ["writeMBps", "readMBps", "flushMs", "probedAt"]) if (Number.isFinite(item?.[key])) profile[key] = item[key];
    }
  } catch {
    /* Файла нет или он битый: числа появятся с первых операций. */
  }
}

/** Дождаться записи чисел на диск: тестам и выходу. */
export async function flushDiskProfiles() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }
  await saving;
}

/** Забыть всё: тестам. */
export function forgetDiskProfiles() {
  profiles.clear();
  places.clear();
  store = null;
  clearTimeout(saveTimer);
  saveTimer = null;
}

/** Поставить числа напрямую: стендам и тестам. */
export function setDiskProfile(place, numbers) {
  Object.assign(profileOf(volumeOf(place)), numbers);
  changed();
}

export const diskProfile = (place) => {
  const profile = profiles.get(volumeOf(place));
  return profile ? { writeMBps: profile.writeMBps, readMBps: profile.readMBps, flushMs: profile.flushMs, probedAt: profile.probedAt } : null;
};

/**
 * Одна большая операция процесса: `kind` — `write` или `read`, `place` — путь файла.
 * Сон потолка и очередь в `ms` не входят (`disk-care.js`): это время самого диска.
 */
export function noteDiskOp(kind, bytes, ms, place) {
  if (sampleSink) {
    sampleSink(kind, bytes, ms, place);
    return;
  }
  if (!place || !(bytes >= MIN_SAMPLE_BYTES) || !(ms > 0) || !FIELD[kind]) return;
  const rate = bytes / MEGABYTE / (ms / 1000);
  if (kind === "read" && rate >= CACHED_READ_MBPS) return;
  const profile = profileOf(volumeOf(place));
  const ring = profile.samples[kind];
  ring.push(rate);
  if (ring.length > WINDOW) ring.shift();
  if (ring.length < MIN_SAMPLES) return;
  const next = median(ring);
  const before = profile[FIELD[kind]];
  profile[FIELD[kind]] = next;
  /* Каждая операция не повод пересчитывать потолки: шум в пятую часть ничего не меняет. */
  if (!before || Math.abs(next - before) / before >= 0.2) changed();
}

/**
 * Что это за диск: `slow` — жёсткий диск или равный ему, `medium` — SATA SSD, QLC, занятый диск, `fast` — NVMe,
 * `unknown` — ещё не мерили.
 */
export function diskKind(place) {
  const profile = profiles.get(volumeOf(place));
  if (!profile?.writeMBps && !profile?.flushMs) return "unknown";
  if ((profile.writeMBps && profile.writeMBps < 80) || profile.flushMs >= 15) return "slow";
  if ((profile.writeMBps && profile.writeMBps < 400) || profile.flushMs >= 8) return "medium";
  return "fast";
}

const uniqueVolumes = (places) => [...new Set(places.filter(Boolean).map(volumeOf))];

/** Потолок записи по самому медленному из дисков, куда пишем: половина его скорости, не выше прежнего умолчания. */
export function autoWriteLimitMbps(places, { ceiling = AUTO_WRITE_CEILING_MBPS } = {}) {
  let limit = ceiling;
  for (const volume of uniqueVolumes(places)) {
    const write = profiles.get(volume)?.writeMBps;
    if (write > 0) limit = Math.min(limit, Math.max(MIN_WRITE_LIMIT_MBPS, Math.floor(write / 2)));
  }
  return limit;
}

/**
 * Потолок чтения движка: медленному диску — половина скорости его чтения, быстрому — `ceiling` (`0` — без потолка,
 * как было до 18.11.2026; обычный режим установки называет свой, `storage-manager.js`).
 */
export function autoReadLimitMbps(places, { ceiling = 0 } = {}) {
  let limit = ceiling > 0 ? ceiling : 0;
  for (const volume of uniqueVolumes(places)) {
    const profile = profiles.get(volume);
    if (!profile) continue;
    const slow = (profile.writeMBps && profile.writeMBps < 80) || profile.flushMs >= 15;
    const medium = (profile.writeMBps && profile.writeMBps < 400) || profile.flushMs >= 8;
    if (!slow && !medium) continue;
    /* Читать не мерили: жёсткий диск читает примерно как пишет. SATA SSD и QLC читают намного быстрее записи, им потолок по записи только мешал бы. */
    const read = profile.readMBps || (slow ? profile.writeMBps : 0);
    if (!read || read >= 1000) continue;
    const mine = Math.max(MIN_READ_LIMIT_MBPS, Math.floor(read / 2));
    limit = limit ? Math.min(limit, mine) : mine;
  }
  return limit;
}

/* Сколько мелких файлов в полёте. На жёстком диске 64 разом — это сплошные перемещения головок и очередь на весь компьютер. */
const SMALL_FILE_LIMIT = Object.freeze({ fast: 64, medium: 16, slow: 3, unknown: 16 });
export const smallFileLimit = (place, { fast = SMALL_FILE_LIMIT.fast } = {}) => {
  const kind = diskKind(place);
  return kind === "fast" ? fast : Math.min(fast, SMALL_FILE_LIMIT[kind]);
};

/**
 * Короткая проба диска: 16 МБ сквозь кэш и шесть сбросов, файл сразу удаляется. Чтение пробой не мерить: только что
 * записанное лежит в кэше системы, поэтому чтение считается по настоящим большим чтениям (`noteDiskOp`).
 */
export async function probeDisk(directory, { now = Date.now(), writeFlags = "wx", beforeOp = null } = {}) {
  const file = path.join(directory, `.astral-disk-probe-${randomUUID()}`);
  const block = Buffer.alloc(PROBE_BLOCK_BYTES, 0x5a);
  const rates = [];
  const flushes = [];
  let handle = null;
  try {
    handle = await fs.open(file, writeFlags);
    for (let index = 0; index < PROBE_BLOCKS; index += 1) {
      const started = performance.now();
      await beforeOp?.(block.length);
      await handle.write(block, 0, block.length, null);
      /* Мельче десятой миллисекунды таймер не верит. */
      rates.push(block.length / MEGABYTE / (Math.max(0.1, performance.now() - started) / 1000));
    }
    const tiny = Buffer.alloc(4096, 0xa5);
    for (let index = 0; index < PROBE_FLUSHES; index += 1) {
      const started = performance.now();
      await beforeOp?.(tiny.length);
      await handle.write(tiny, 0, tiny.length, index * tiny.length);
      await handle.datasync();
      flushes.push(performance.now() - started);
    }
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(file, { force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  }
  const profile = profileOf(volumeOf(directory));
  profile.writeMBps = median(rates);
  profile.flushMs = median(flushes);
  profile.probedAt = now;
  profile.samples.write = [];
  changed();
  return { writeMBps: profile.writeMBps, flushMs: profile.flushMs };
}

/** Проба нужна: диск ещё не мерили или мерили давно. */
export function probeIsDue(place, { now = Date.now(), maxAgeMs = PROBE_MAX_AGE_MS } = {}) {
  const profile = profiles.get(volumeOf(place));
  return !profile?.probedAt || now - profile.probedAt >= maxAgeMs;
}
