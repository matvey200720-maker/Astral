import fsp from "node:fs/promises";
import { join } from "node:path";

export const ENGINE_ASSETS_CAP_BYTES = 1024 ** 3;
export const ENGINE_ASSETS_RECENT_MS = 10 * 60 * 1000;

const FINGERPRINT_LENGTH = 64;

const isHexDigit = (ch) => (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f");
// Имя файла — отпечаток содержимого: ровно 64 знака из 0-9 и a-f.
const isFingerprint = (name) => name.length === FINGERPRINT_LENGTH && [...name].every(isHexDigit);

const reasonOf = (error) => String((error && error.message) || error);

function missingIsEmpty(error) {
  if (error && error.code === "ENOENT") return [];
  throw error;
}

const namesIn = (directory) => fsp.readdir(directory).catch(missingIsEmpty);

// Любая ошибка внутри превращается в «пропустить».
async function quietly(task) {
  try {
    return await task();
  } catch {
    return null;
  }
}

const lastTouched = ({ atimeMs, mtimeMs }) => Math.max(atimeMs, mtimeMs);
const recordOf = (name, file, info) => ({ name, file, bytes: info.size, usedAt: lastTouched(info) });

const describeFile = (directory, name) =>
  quietly(async () => {
    const file = join(directory, name);
    const info = await fsp.stat(file);
    return info.isFile() ? recordOf(name, file, info) : null;
  });

export async function listEngineAssets(directory) {
  const names = await namesIn(directory);
  const described = await Promise.all(names.filter(isFingerprint).map((name) => describeFile(directory, name)));
  return described.filter(Boolean);
}

const addBytes = (sum, entry) => sum + entry.bytes;
const byNameAsc = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
// Самые давние первыми; при равной давности (или без времени) — по имени.
const oldestFirst = (a, b) => a.usedAt - b.usedAt || byNameAsc(a, b);

export function planEngineAssetsTrim(
  entries,
  { cap = ENGINE_ASSETS_CAP_BYTES, now = Date.now(), recentMs = ENGINE_ASSETS_RECENT_MS } = {},
) {
  const total = entries.reduce(addBytes, 0);
  const stopsAt = (left, entry) => left <= cap || now - entry.usedAt < recentMs;
  // Как только условие остановки сработало, дальше не берём никого: список упорядочен по давности.
  const verdict = [...entries].sort(oldestFirst).reduce(
    (acc, entry) => {
      if (acc.stopped || stopsAt(acc.left, entry)) {
        acc.stopped = true;
        return acc;
      }
      acc.remove.push(entry);
      acc.left -= entry.bytes;
      return acc;
    },
    { left: total, remove: [], stopped: false },
  );
  return { total, remove: verdict.remove, keptBytes: verdict.left };
}

// Состояние одного прохода уборки; отчёт собирается из его полей.
class TrimRun {
  constructor(total) {
    this.removed = [];
    this.failed = [];
    this.bytes = 0;
    this.skipped = null;
    this.total = total;
    this.keptBytes = total;
  }

  // Возвращает false, когда проход надо закончить (занято).
  async step(entry, { isBusy, remove }) {
    if (isBusy()) {
      this.skipped = "busy";
      return false;
    }
    try {
      await remove(entry.file);
    } catch (error) {
      this.failed.push({ path: entry.file, message: reasonOf(error) });
      return true;
    }
    this.removed.push({ path: entry.file, bytes: entry.bytes });
    this.bytes += entry.bytes;
    this.keptBytes -= entry.bytes;
    return true;
  }

  report() {
    const { removed, failed, bytes, skipped, total, keptBytes } = this;
    return { removed, failed, bytes, skipped, total, keptBytes };
  }
}

export async function trimEngineAssets(
  directory,
  { cap, now = Date.now(), recentMs, isBusy = () => false, remove = (file) => fsp.rm(file, { force: true }) } = {},
) {
  const plan = planEngineAssetsTrim(await listEngineAssets(directory), { cap, now, recentMs });
  const run = new TrimRun(plan.total);
  await plan.remove.reduce(
    (chain, entry) => chain.then((go) => go && run.step(entry, { isBusy, remove })),
    Promise.resolve(true),
  );
  return run.report();
}
