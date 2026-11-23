// Свежий установщик из релиза заменяет копию AstralBetaSetup.exe в корне установки.
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { renameWhenFree } from '../atomic-file.js';
import { compareVersions, isValidVersion } from './semver.js';

export const SETUP_RECORD = 'setup.json';

const SETUP_EXE = 'AstralBetaSetup.exe';
const HEX_64 = /^[\da-f]{64}$/;

const noop = () => {};
const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Хэш файла; null - файла нет. Прочие ошибки чтения идут наружу.
const hashOrNull = (file) => fsp.readFile(file).then(sha256Of, (failure) => {
  if (failure?.code === 'ENOENT') return null;
  throw failure;
});

// Содержимое JSON-файла или null, если файла нет либо он не разбирается.
async function parseOrNull(file) {
  const text = await fsp.readFile(file, 'utf8').catch(() => null);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const wellDescribed = (info) => typeof info?.sha256 === 'string' && HEX_64.test(info.sha256) && isValidVersion(String(info.version));

export async function bundledSetup(appDir) {
  const folder = join(appDir, 'resources', 'setup');
  const info = await parseOrNull(join(folder, SETUP_RECORD));
  if (!wellDescribed(info)) return null;
  const exe = join(folder, SETUP_EXE);
  const { version, sha256 } = info;
  return (await hashOrNull(exe)) === sha256 ? { exe, version, sha256 } : null;
}

// Решение о корне установки: оставить, признать актуальным или заменить.
function verdictFor({ installedHash, record, bundled }) {
  if (installedHash === bundled.sha256) return 'current';
  const knownFile = installedHash !== null && record?.sha256 === installedHash;
  if (!knownFile) return 'replace';
  const recorded = String(record.version);
  return isValidVersion(recorded) && compareVersions(recorded, bundled.version) !== -1 ? 'newer-installed' : 'replace';
}

async function writeRecord(paths, bundled) {
  await fsp.mkdir(paths.updateDir, { recursive: true });
  const line = JSON.stringify({ version: bundled.version, sha256: bundled.sha256 });
  await fsp.writeFile(join(paths.updateDir, SETUP_RECORD), `${line}\n`);
}

// Копия из релиза кладётся рядом; пока хэш не сошёлся, на место её не ставим.
async function putFreshCopy(bundled, fresh) {
  await fsp.copyFile(bundled.exe, fresh);
  if ((await hashOrNull(fresh)) === bundled.sha256) return;
  await fsp.rm(fresh, { force: true });
  throw new Error('копия нового установщика не сошлась по sha256');
}

async function swapInstaller({ helper, hadInstaller }) {
  const fresh = `${helper}.new`;
  const leftover = `${helper}.old`;
  if (hadInstaller) await renameWhenFree(helper, leftover);
  await renameWhenFree(fresh, helper).catch(async (failure) => {
    if (hadInstaller) await fsp.rename(leftover, helper).catch(noop);
    await fsp.rm(fresh, { force: true }).catch(noop);
    throw failure;
  });
}

function previousNote(record) {
  const was = record?.version;
  return was === undefined || was === null || String(was) === '' ? '' : ` (был ${was})`;
}

export async function refreshSetupHelper({ paths, log = noop }) {
  const { helper } = paths;
  await fsp.rm(`${helper}.old`, { force: true }).catch(noop);

  const bundled = await bundledSetup(paths.appDir);
  if (bundled === null) return { result: 'no-bundled' };

  const installedHash = await hashOrNull(helper);
  const record = await parseOrNull(join(paths.updateDir, SETUP_RECORD));

  const handlers = {
    async current() {
      if (record?.sha256 !== bundled.sha256) await writeRecord(paths, bundled);
      return { result: 'current', version: bundled.version };
    },
    async 'newer-installed'() {
      return { result: 'newer-installed', version: record.version };
    },
    async replace() {
      await putFreshCopy(bundled, `${helper}.new`);
      await swapInstaller({ helper, hadInstaller: installedHash !== null });
      await writeRecord(paths, bundled);
      await fsp.rm(`${helper}.old`, { force: true }).catch(noop);
      log(`установщик обновлён до ${bundled.version}${previousNote(record)}`);
      return { result: 'replaced', version: bundled.version };
    },
  };
  return handlers[verdictFor({ installedHash, record, bundled })]();
}
