/*
 * Журнал режима Rockstar (05.11.2026): что агент и окно делали с файлами игры,
 * когда и почему. Пишут оба процесса в один файл, читает окно.
 *
 * Строка — одна запись JSON: `{ at, src, scope, code, data?, detail? }`.
 * `code` — короткое имя события (`armed`, `returned`, `repair-detected`…), по
 * нему окно подбирает фразу на языке человека; `data` — числа и имена для этой
 * фразы (архив, миллисекунды, pid); `detail` — сырой технический текст
 * (сообщение ОС, исключение) — он показывается как есть. Так журнал читается
 * на всех пяти языках, а в файле остаётся то, что нужно разбирать поддержке.
 *
 * Файл растёт до `maxBytes`, потом уходит в `.prev` (прежний `.prev`
 * теряется). Дописывание — одной короткой записью (`appendFile`), поэтому
 * строки двух процессов не рвутся; сбой записи журнал глотает: он не должен
 * ронять подмену.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const MODE_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const MODE_HOME_ENV = "ASTRAL_ROCKSTAR_MODE_HOME";

/** Папка служебных файлов режима вне игры: журнал, сердцебиение агента, настройки агента. */
export function modeHome(env = process.env, { platform = process.platform, home = () => process.env.USERPROFILE || process.env.HOME || "." } = {}) {
  if (env[MODE_HOME_ENV]) return path.resolve(env[MODE_HOME_ENV]);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home(), "AppData", "Local"), "Astral", "rockstar-mode");
  return path.join(home(), ".astral", "rockstar-mode");
}

export const modeLogFile = (env = process.env) => path.join(modeHome(env), "rockstar-mode.log");

/**
 * @param {{ file: string, src?: string, maxBytes?: number, now?: () => Date }} options
 *   `src` — кто пишет: `agent` (фоновый агент) или `window` (окно Astral).
 */
export function createModeLog({ file, src = "window", maxBytes = MODE_LOG_MAX_BYTES, now = () => new Date() } = {}) {
  async function rotate() {
    try {
      const stat = await fs.stat(file);
      if (stat.size <= maxBytes) return;
      await fs.rm(`${file}.prev`, { force: true });
      await fs.rename(file, `${file}.prev`);
    } catch {
      /* нет файла или его держит другой процесс — следующая запись попробует снова */
    }
  }

  /** Записать событие. Не бросает. */
  async function write(scope, code, data = null, detail = "") {
    const record = { at: now().toISOString(), src, scope, code };
    if (data && Object.keys(data).length) record.data = data;
    if (detail) record.detail = String(detail).slice(0, 2000);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await rotate();
      await fs.appendFile(file, `${JSON.stringify(record)}\n`);
    } catch {
      /* журнал не должен ронять режим */
    }
    return record;
  }

  return { file, src, write, tail: (options) => readModeLogTail(file, options) };
}

const parseLine = (line) => {
  try {
    const record = JSON.parse(line);
    return record && typeof record === "object" && record.code ? record : null;
  } catch {
    return null;
  }
};

/**
 * Последние записи журнала, старые — первыми. Читает хвост файла (по
 * умолчанию 128 КБ) и, если его мало, хвост `.prev`. Битые строки — мимо.
 */
export async function readModeLogTail(file, { bytes = 128 * 1024, limit = 400 } = {}) {
  const tailOf = async (target, budget) => {
    let handle;
    try {
      handle = await fs.open(target, "r");
      const { size } = await handle.stat();
      const length = Math.min(size, budget);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/);
      /* Первая строка среза могла начаться посреди записи. */
      if (size > length) lines.shift();
      return lines.map(parseLine).filter(Boolean);
    } catch {
      return [];
    } finally {
      await handle?.close().catch(() => {});
    }
  };
  let records = await tailOf(file, bytes);
  if (records.length < limit) records = [...(await tailOf(`${file}.prev`, bytes)), ...records];
  return records.slice(-limit);
}
