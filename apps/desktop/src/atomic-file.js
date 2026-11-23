/*
 * Атомарная запись небольшого файла: временный файл и переименование поверх
 * настоящего, чтобы читающий никогда не увидел половину содержимого.
 *
 * На Windows и запись временного файла, и переименование поверх существующего
 * падают на время с EPERM, EBUSY или EACCES, если файл в этот момент кто-то
 * держит: установщик с сайта опрашивает файл состояния, антивирус проверяет
 * свежие файлы, проводник открывает папку. Через несколько десятков
 * миллисекунд файл отпускают. Поэтому запись и переименование повторяются с
 * паузой; любая другая ошибка уходит сразу. Без повторов потерянное
 * переименование оставляло старое содержимое навсегда (бета 22.10.2026: итог
 * установки рядом не доходил до файла состояния, и окно установщика ждало).
 *
 * Два варианта: обычный (`writeFileAtomic`) и синхронный
 * (`writeFileAtomicSync`, для мест вроде `before-quit`, где ждать нельзя:
 * пауза между повторами блокирует поток, поэтому повторов немного). Скачанные
 * большие файлы переименовывает `renameWhenFree`: антивирус проверяет такой
 * файл секундами, и терпения ему нужно больше.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Файл состояния и настроек: небольшой, держат его недолго. */
export const BUSY_RETRIES = 10;
export const BUSY_PAUSE_MS = 40;
/** Скачанный целиком файл на сотни мегабайт: антивирус и индексатор держат его секунды. */
export const FILE_RETRIES = 20;
export const FILE_PAUSE_MS = 150;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/* Блокирующая пауза без нагрузки на процессор; в главном потоке Electron `Atomics.wait` разрешён. */
const pauseSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Повторить `task`, пока файл занят (не больше `retries` раз); иная ошибка и последняя занятость — исключением. */
export async function retryWhileBusy(task, { retries = BUSY_RETRIES, pauseMs = BUSY_PAUSE_MS, sleep = pause } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (!BUSY_CODES.has(error?.code) || attempt >= retries) throw error;
      await sleep(pauseMs);
    }
  }
}

/** То же для синхронного кода: пауза блокирует поток. */
export function retryWhileBusySync(task, { retries = BUSY_RETRIES, pauseMs = BUSY_PAUSE_MS, sleep = pauseSync } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return task();
    } catch (error) {
      if (!BUSY_CODES.has(error?.code) || attempt >= retries) throw error;
      sleep(pauseMs);
    }
  }
}

/**
 * Переименовать скачанный или склеенный файл на место. Только повтор при занятости: что считать
 * неудачей загрузки и когда её повторять, решает сама загрузка.
 */
export function renameWhenFree(from, to, { fsImpl = fs, retries = FILE_RETRIES, pauseMs = FILE_PAUSE_MS, sleep } = {}) {
  return retryWhileBusy(() => fsImpl.rename(from, to), { retries, pauseMs, sleep });
}

/**
 * @param {string} file  куда писать
 * @param {string | Buffer} content
 * @param {{
 *   fsImpl?: object, temporary?: string, makeDirectory?: boolean,
 *   retries?: number, pauseMs?: number, sleep?: (ms: number) => Promise<void>,
 * }} [options]
 *   `temporary` — имя временного файла (по умолчанию рядом с настоящим, с номером процесса);
 *   `makeDirectory: false` — не создавать каталог файла: там, где его исчезновение значит «этого больше нет»
 *   (отменённая загрузка), запись не должна воскрешать каталог
 */
export async function writeFileAtomic(file, content, { fsImpl = fs, temporary = `${file}.${process.pid}.tmp`, makeDirectory = true, ...retry } = {}) {
  if (makeDirectory) await fsImpl.mkdir(path.dirname(file), { recursive: true });
  try {
    await retryWhileBusy(() => fsImpl.writeFile(temporary, content), retry);
    await retryWhileBusy(() => fsImpl.rename(temporary, file), retry);
  } catch (error) {
    /* Не вышло — временный файл не оставляем лежать рядом с настоящим. */
    try {
      await fsImpl.rm?.(temporary, { force: true });
    } catch {
      /* убрать не удалось: главная ошибка важнее */
    }
    throw error;
  }
}

/** Синхронный `writeFileAtomic`; `fsImpl` — как `node:fs` (`mkdirSync`, `writeFileSync`, `renameSync`, `rmSync`). */
export function writeFileAtomicSync(file, content, { fsImpl = fsSync, temporary = `${file}.${process.pid}.tmp`, makeDirectory = true, ...retry } = {}) {
  if (makeDirectory) fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  try {
    retryWhileBusySync(() => fsImpl.writeFileSync(temporary, content), retry);
    retryWhileBusySync(() => fsImpl.renameSync(temporary, file), retry);
  } catch (error) {
    try {
      fsImpl.rmSync?.(temporary, { force: true });
    } catch {
      /* убрать не удалось: главная ошибка важнее */
    }
    throw error;
  }
}
