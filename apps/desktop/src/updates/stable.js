// Отметка «версия стабильна»: надзор за первым временем работы новой версии, откат после вылетов, остатки прежней.
import { writeFileAtomicSync } from '../atomic-file.js';
import { join } from 'node:path';
import fsp from 'node:fs/promises';

export const STABLE_AFTER_MS = 45000;
export const STRIKES_TO_ROLL_BACK = 2;

const BRANCH_NAMES = ['alpha', 'beta', 'release'];
const APP_OLD_REMOVAL = { recursive: true, force: true, maxRetries: 3, retryDelay: 500 };
const FORCE = { force: true };

const noop = () => {};
const reasonText = (error) => error?.message ?? String(error);

export function stablePaths(paths) {
  const betaOld = ['astral-web.pak.old', 'manifest.json.old', 'manifest.sig.old'];
  return {
    pending: join(paths.updateDir, 'pending-stable.json'),
    run: join(paths.updateDir, 'stable-run.json'),
    appOld: join(paths.root, 'app.old'),
    betaOld: betaOld.map((name) => join(paths.betaDir, name)),
  };
}

// Номер из имени каталога «ветка-число» или null, если имя другое.
function stagingNumber(name) {
  const [branch, digits, ...extra] = name.split('-');
  const wellFormed = BRANCH_NAMES.includes(branch) && extra.length === 0 && /^\d+$/.test(digits ?? '');
  return wellFormed ? Number(digits) : null;
}

// Записи надзора и остатки прежней версии в одной установке.
class StableFolder {
  #paths;
  #where;

  constructor(paths) {
    this.#paths = paths;
    this.#where = stablePaths(paths);
  }

  get where() {
    return this.#where;
  }

  // JSON-файл или null (нет файла, не читается, не JSON).
  static async load(file) {
    const text = await fsp.readFile(file, 'utf8').catch(() => null);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  static namesVersion(pending) {
    return Boolean(pending?.version);
  }

  // Запись на диск, отказ которой не должен ничему мешать.
  stamp(record) {
    const file = this.#where.run;
    try {
      writeFileAtomicSync(file, `${JSON.stringify(record)}\n`, { makeDirectory: false, temporary: `${file}.tmp` });
    } catch {
      // антивирус или права: надзор от этого не страдает
    }
  }

  dropRecords() {
    return Promise.all([this.#where.pending, this.#where.run].map((file) => fsp.rm(file, FORCE)));
  }

  async dropLeftovers() {
    await fsp.rm(this.#where.appOld, APP_OLD_REMOVAL);
    for (const file of this.#where.betaOld) {
      await fsp.rm(file, FORCE);
    }
  }

  async decideOnStart(version, now) {
    const pending = await StableFolder.load(this.#where.pending);
    if (!StableFolder.namesVersion(pending)) return { action: 'none' };
    if (pending.version !== version) {
      await this.dropRecords();
      return { action: 'none' };
    }
    const run = await StableFolder.load(this.#where.run);
    const carried = run?.version === version ? (Number(run.strikes) || 0) + (run.running ? 1 : 0) : 0;
    if (carried >= STRIKES_TO_ROLL_BACK) return { action: 'rollback', strikes: carried, pending };
    this.stamp({ version, strikes: carried, running: true, at: now().toISOString() });
    return { action: 'watch', strikes: carried, pending };
  }

  async commit() {
    // Записи снимаем первыми: неудача со стиранием не должна дать ложный страйк.
    await this.dropRecords();
    await this.dropLeftovers();
  }

  async cleanup() {
    const waiting = StableFolder.namesVersion(await StableFolder.load(this.#where.pending));
    if (!waiting) await this.dropLeftovers();
    return !waiting;
  }

  async removableAppOld({ version, uptimeMs, stableAfterMs }) {
    const present = await fsp.access(this.#where.appOld).then(() => true, () => false);
    if (!present) return null;
    const pending = await StableFolder.load(this.#where.pending);
    if (!StableFolder.namesVersion(pending)) return this.#where.appOld;
    const bootOk = await StableFolder.load(this.#paths.bootOk);
    const settled = pending.version === version && bootOk?.version === version && uptimeMs >= stableAfterMs;
    return settled ? this.#where.appOld : null;
  }

  async staleFolders(sequence) {
    if (!Number.isInteger(sequence)) return [];
    const listing = await fsp.readdir(this.#paths.updateDir, { withFileTypes: true }).catch(() => []);
    return listing
      .filter((item) => item.isDirectory() && (stagingNumber(item.name) ?? Infinity) <= sequence)
      .map((item) => join(this.#paths.updateDir, item.name));
  }
}

export const checkStableOnStart = ({ paths, version, now = () => new Date() }) => new StableFolder(paths).decideOnStart(version, now);

export function markCleanExit({ paths, version }) {
  new StableFolder(paths).stamp({ version, strikes: 0, running: false, at: new Date().toISOString() });
}

export const commitStable = ({ paths }) => new StableFolder(paths).commit();
export const cleanupLeftovers = ({ paths }) => new StableFolder(paths).cleanup();

export async function leftoverPlaces({ paths, version, sequence = null, uptimeMs = 0, stableAfterMs = STABLE_AFTER_MS }) {
  const folder = new StableFolder(paths);
  const [appOld, stale] = await Promise.all([
    folder.removableAppOld({ version, uptimeMs, stableAfterMs }),
    folder.staleFolders(sequence),
  ]);
  return { appOld, stale };
}

// Надзор за запуском: что делать по решению проверки при старте.
class Overseer {
  #cfg;

  constructor(settings) {
    const given = Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
    this.#cfg = { onQuit: noop, log: noop, stableAfterMs: STABLE_AFTER_MS, pid: process.pid, ...given };
  }

  #later(job) {
    const handle = setTimeout(job, this.#cfg.stableAfterMs);
    handle.unref?.();
    return handle;
  }

  async start() {
    const { paths, version } = this.#cfg;
    const verdict = await checkStableOnStart({ paths, version });
    switch (verdict.action) {
      case 'rollback':
        return this.#rollBack(verdict);
      case 'watch':
        return this.#watch(verdict);
      default:
        this.#later(() => cleanupLeftovers({ paths }).catch(noop));
        return verdict;
    }
  }

  async #rollBack(verdict) {
    const { paths, version, spawnHelper, requestQuit, log, pid } = this.#cfg;
    log(`версия ${version} упала ${verdict.strikes} раза до «стабильна» — возвращаем ${verdict.pending.from || 'прежнюю'}`);
    const args = ['--rollback-old', '--pid', String(pid), '--install-dir', paths.root, '--launch'];
    const launch = await new Promise((resolve) => {
      resolve(spawnHelper(paths.helper, args, { cwd: paths.root }));
    }).then(() => ({ failed: false }), (error) => ({ failed: true, error }));
    if (launch.failed) {
      log(`откат не запустился: ${reasonText(launch.error)}`);
      return { action: 'none' };
    }
    requestQuit();
    return verdict;
  }

  #watch(verdict) {
    const { paths, version, onQuit, log } = this.#cfg;
    let settled = false;
    const timer = this.#later(async () => {
      settled = true;
      await commitStable({ paths }).then(
        () => log(`обновление ${version} стабильно: прежняя версия убрана`),
        (error) => log(`прежнюю версию убрать не вышло: ${reasonText(error)}`),
      );
    });
    onQuit(() => {
      if (settled) return;
      clearTimeout(timer);
      markCleanExit({ paths, version });
    });
    return verdict;
  }
}

export function createStableWatch(settings) {
  const overseer = new Overseer(settings);
  return { start: () => overseer.start() };
}
