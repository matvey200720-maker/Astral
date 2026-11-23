/*
 * SHA-256 больших архивов игры по их записи на диске (задача 8, 05.10.2026).
 *
 * Одна установка через движок считала SHA-256 двухгигабайтного update.rpf
 * несколько раз: живой архив — перед сборкой (не правил ли его кто-то
 * снаружи), собранный — после сборки, и снова — следующая операция, хотя
 * архив с тех пор никто не трогал. Каждое такое чтение — секунды.
 *
 * Здесь отпечаток запоминается вместе с записью файла: размер, время правки
 * с точностью до наносекунд и номер записи на томе. Пока все три те же,
 * файл тот же: правка на месте меняет время, подмена переименованием — номер.
 *
 * Память — на жизнь процесса, а для больших файлов — и между запусками
 * (задача 6 ТЗ 10.10.2026): каждый запуск Astral первым делом читал
 * двухгигабайтный update.rpf целиком ради уборки кэша и значков библиотеки —
 * у владельца это полминуты диска под 99 %. Хранилище отпечатков включает
 * главный процесс (`openFingerprintStore`); на диск идут только файлы от
 * PERSIST_MIN_BYTES, и запись там строже: ещё время смены записи (ctime) и
 * том. Тесты и сборщики без хранилища живут, как прежде, — только памятью.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./manifest.js";

/*
 * Отпечаток файла — SHA-256 (64 цифры) или, у архива, который дописывал движок, отпечаток цепочки `a1:` + 64 цифры
 * (`append-item.js`, 19.11.2026): SHA-256 всего дозаписанного файла не считается, чтобы не читать два гигабайта после каждой
 * записи в мегабайты. Для вызывающих это непрозрачная строка: ею сверяют «тот же файл», равенством.
 */
const FINGERPRINT = /^(?:a1:)?[a-f0-9]{64}$/;

const known = new Map();
const inflight = new Map();
const keyOf = (file) => path.resolve(String(file)).toLowerCase();

const PERSIST_MIN_BYTES = 64 * 1024 * 1024;
const PERSIST_LIMIT = 256;
const SAVE_DELAY_MS = 1500;

let store = null;

async function stampOf(file) {
  const stat = await fs.stat(file, { bigint: true });
  return {
    stamp: `${stat.size}:${stat.mtimeNs}:${stat.ino}`,
    durable: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
    size: stat.size,
  };
}

/**
 * Хранилище отпечатков между запусками: `file` — JSON в памяти движка.
 * Повторный вызов с тем же файлом ничего не делает; другой файл (перенос
 * кэша) — новое хранилище. `minBytes` — с какого размера файл помнится
 * между запусками (тестам — меньше).
 */
export function openFingerprintStore(file, { minBytes = PERSIST_MIN_BYTES } = {}) {
  const target = path.resolve(String(file || ""));
  if (!file) {
    store = null;
    return;
  }
  if (store?.file === target) return;
  const next = { file: target, minBytes: BigInt(minBytes), entries: new Map(), timer: null, saving: Promise.resolve() };
  next.loaded = fs
    .readFile(target, "utf8")
    .then((text) => {
      const data = JSON.parse(text);
      for (const item of Array.isArray(data?.entries) ? data.entries : [])
        if (item?.key && item?.durable && FINGERPRINT.test(String(item.sha256 || "")))
          next.entries.set(item.key, { durable: item.durable, sha256: item.sha256 });
    })
    .catch(() => {});
  store = next;
}

function scheduleSave(target, delay = SAVE_DELAY_MS) {
  clearTimeout(target.timer);
  target.timer = setTimeout(() => {
    target.timer = null;
    target.saving = target.saving.then(async () => {
      const entries = [...target.entries].slice(-PERSIST_LIMIT).map(([key, value]) => ({ key, ...value }));
      const stage = `${target.file}.${randomUUID()}.stage`;
      try {
        await fs.mkdir(path.dirname(target.file), { recursive: true });
        await fs.writeFile(stage, JSON.stringify({ schema: 1, entries }));
        await fs.rename(stage, target.file);
      } catch {
        await fs.rm(stage, { force: true }).catch(() => {});
      }
    });
  }, delay);
  target.timer.unref?.();
}

async function persisted(key, stamp) {
  if (!store || stamp.size < store.minBytes) return "";
  await store.loaded;
  const item = store.entries.get(key);
  return item?.durable === stamp.durable ? item.sha256 : "";
}

function persist(key, stamp, sha256) {
  if (!store || stamp.size < store.minBytes) return;
  const target = store;
  target.entries.delete(key);
  target.entries.set(key, { durable: stamp.durable, sha256 });
  while (target.entries.size > PERSIST_LIMIT) target.entries.delete(target.entries.keys().next().value);
  scheduleSave(target);
}

/** SHA-256 файла: из памяти, если запись та же, иначе честным чтением. */
export async function fingerprintSha256(file, { hash = sha256File } = {}) {
  const key = keyOf(file);
  const before = await stampOf(file);
  const cached = known.get(key);
  if (cached?.stamp === before.stamp) return cached.sha256;
  const stored = await persisted(key, before);
  if (stored) {
    known.set(key, { stamp: before.stamp, sha256: stored });
    return stored;
  }
  /*
   * Два первых вопроса об одном и том же файле — одно чтение (задача 6 ТЗ
   * 10.10.2026): уборка кэша и значки библиотеки при запуске спрашивали
   * update.rpf одновременно и читали его дважды.
   */
  const flight = `${key}|${before.durable}`;
  const shared = hash === sha256File;
  if (shared && inflight.has(flight)) return inflight.get(flight);
  const reading = (async () => {
    const sha256 = await hash(file);
    /* Файл сменился, пока читался, — отпечаток не запоминается. */
    const after = await stampOf(file).catch(() => null);
    if (after?.durable === before.durable) {
      known.set(key, { stamp: before.stamp, sha256 });
      persist(key, before, sha256);
    }
    return sha256;
  })();
  if (shared) {
    inflight.set(flight, reading);
    reading.finally(() => inflight.delete(flight)).catch(() => {});
  }
  return reading;
}

/**
 * Запомнить SHA-256 файла, который только что записан и проверен (подмена
 * архива транзакцией сверяет байты по дороге): следующее чтение не нужно.
 */
export async function rememberSha256(file, sha256) {
  if (!FINGERPRINT.test(String(sha256 || ""))) return;
  const stamp = await stampOf(file).catch(() => null);
  if (!stamp) return;
  const key = keyOf(file);
  known.set(key, { stamp: stamp.stamp, sha256 });
  persist(key, stamp, sha256);
}

/** SHA-256, который вернул помощник сборки RPF (`compose-rpf` считает его по записанным байтам), или "" — тогда считать самим. */
export function composedSha256(composed) {
  const sha256 = String(composed?.sha256 || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(sha256) ? sha256 : "";
}

/** Дождаться записи хранилища на диск (для тестов и выхода). */
export async function flushFingerprintStore() {
  const target = store;
  if (!target) return;
  if (target.timer) {
    clearTimeout(target.timer);
    target.timer = null;
    scheduleSave(target, 0);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  await target.saving;
}

/** Забыть отпечаток (для тестов и после записи без сверки). */
export function forgetSha256(file = null) {
  if (file) {
    known.delete(keyOf(file));
    store?.entries.delete(keyOf(file));
  } else {
    known.clear();
    store?.entries.clear();
  }
}
