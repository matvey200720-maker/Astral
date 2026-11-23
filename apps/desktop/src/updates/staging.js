// Папка update\ установки: скачанное обновление и служебные файлы рядом с ним.
import { writeFileAtomic } from '../atomic-file.js';
import { stagingDirectory } from './paths.js';
import { isValidVersion } from './semver.js';
import { CHANNELS } from './manifest.js';
import { join } from 'node:path';
import fsp from 'node:fs/promises';

export const PENDING_FILE = 'pending.json';
export const SIDE_DIRECTORY = 'side';
export const APPLY_REFUSED_RETRY_MS = 21_600_000;

const REFUSED = 'apply_refused';
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isChannel = (v) => CHANNELS.includes(v);
const isVersion = (v) => typeof v === 'string' && isValidVersion(v);
const stringOr = (v) => (typeof v === 'string' ? v : '');
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const oneLine = (value) => `${JSON.stringify(value)}\n`;

// Описание полей pending.json: имя поля -> проверка значения.
const PENDING_RULES = new Map([
  ['schema', (v) => v === 1],
  ['channel', isChannel],
  ['version', isVersion],
  ['sequence', (v) => Number.isSafeInteger(v) && v >= 1],
  ['hasBase', (v) => typeof v === 'boolean'],
  ['hasWeb', (v) => typeof v === 'boolean'],
  ['required', (v) => typeof v === 'boolean'],
  ['createdAt', (v) => typeof v === 'string'],
]);

export function validPending(value) {
  if (!isObject(value)) return false;
  for (const [field, accepts] of PENDING_RULES) {
    if (!accepts(value[field])) return false;
  }
  return true;
}

// Свежесть отказа хелпера относительно часов.
const refusalIsFresh = (stamp, clock) => {
  const moment = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
  return moment === moment && clock - moment < APPLY_REFUSED_RETRY_MS;
};

// Запись через временный файл рядом; папку файла не создаём - исчезнувший каталог загрузки значит «отменено».
const writeAtomically = (file, data) => writeFileAtomic(file, data, {
  makeDirectory: false,
  temporary: [file, process.pid, Date.now(), 'tmp'].join('.'),
});

// Работа с одной папкой update: все чтения и записи служебных файлов.
class UpdateFolder {
  #paths;

  constructor(paths) {
    this.#paths = paths;
  }

  async #json(file) {
    let raw;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (failure) {
      if (ABSENT.has(failure?.code)) return undefined;
      throw failure;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async #folders() {
    const listing = await fsp.readdir(this.#paths.updateDir, { withFileTypes: true }).catch((failure) => {
      if (failure?.code === 'ENOENT') return [];
      throw failure;
    });
    return listing.filter((item) => item.isDirectory()).map((item) => item.name).sort();
  }

  #prepare() {
    return fsp.mkdir(this.#paths.updateDir, { recursive: true });
  }

  async #inspect(name) {
    const directory = join(this.#paths.updateDir, name);
    const pending = await this.#json(join(directory, PENDING_FILE));
    if (!validPending(pending) || name !== `${pending.channel}-${pending.sequence}`) return null;
    const promised = ['manifest.json', 'manifest.sig'];
    if (pending.hasBase) promised.push('base.zip');
    if (pending.hasWeb) promised.push('astral-web.pak');
    for (const file of promised) {
      const present = await fsp.access(join(directory, file)).then(() => true, () => false);
      if (!present) return null;
    }
    return { ...pending, directory };
  }

  async newestReady() {
    let best = null;
    for (const name of await this.#folders()) {
      const candidate = await this.#inspect(name);
      if (candidate && (best === null || candidate.sequence > best.sequence)) best = candidate;
    }
    return best;
  }

  async clearDownloads(keep) {
    const doomed = (await this.#folders()).filter((name) => ![SIDE_DIRECTORY, keep].includes(name));
    await Promise.all(doomed.map((name) => fsp.rm(join(this.#paths.updateDir, name), { force: true, recursive: true })));
  }

  async badEntries() {
    const document = await this.#json(this.#paths.bad);
    const entries = isObject(document) ? document.entries : null;
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => isObject(entry) && isChannel(entry.channel) && Number.isInteger(entry.sequence));
  }

  async dropRefusals(channel) {
    const before = await this.badEntries();
    const after = before.filter((entry) => !(entry.channel === channel && entry.reason === REFUSED));
    if (after.length === before.length) return false;
    await writeAtomically(this.#paths.bad, pretty({ entries: after }));
    return true;
  }

  async appendBad({ channel, sequence, version, reason, now = () => new Date() }) {
    const entries = await this.badEntries();
    if (!rejects(entries, channel, sequence, () => new Date())) {
      entries.push({ channel, sequence, version, reason, at: now().toISOString() });
    }
    await this.#prepare();
    await writeAtomically(this.#paths.bad, pretty({ entries: entries.slice(-50) }));
  }

  async attempts() {
    const data = await this.#json(this.#paths.attempts);
    if (!isObject(data)) return null;
    const { channel, sequence, count } = data;
    if (!isChannel(channel) || !Number.isInteger(sequence) || !Number.isInteger(count)) return null;
    const moment = typeof data.at === 'string' ? Date.parse(data.at) : 0;
    return { channel, sequence, count, at: moment || 0 };
  }

  async countAttempt({ channel, sequence, now = () => new Date() }) {
    const known = await this.attempts();
    const continues = known !== null && known.channel === channel && known.sequence === sequence;
    const count = continues ? known.count + 1 : 1;
    await this.#prepare();
    await writeAtomically(this.#paths.attempts, oneLine({ channel, sequence, count, at: now().toISOString() }));
    return count;
  }

  async failure() {
    const data = await this.#json(this.#paths.failed);
    if (!isObject(data) || !isVersion(data.version) || !Number.isInteger(data.sequence)) return null;
    const channel = isChannel(data.channel) ? data.channel : null;
    const [reason, restored, at] = [data.reason, data.restored, data.at].map(stringOr);
    return { version: data.version, sequence: data.sequence, channel, reason, restored, at };
  }

  async markBoot({ version, sequence, now = () => new Date() }) {
    await this.#prepare();
    await writeAtomically(this.#paths.bootOk, oneLine({ version, sequence, at: now().toISOString() }));
  }

  erase(key) {
    return fsp.rm(this.#paths[key], { force: true });
  }

}

// Закрывает ли список версию: любая причина, кроме отказа хелпера, - навсегда, отказ - на 6 часов.
function rejects(list, channel, sequence, now) {
  const clock = now().getTime();
  return list.some((entry) => {
    if (entry.channel !== channel || entry.sequence !== sequence) return false;
    return entry.reason === REFUSED ? refusalIsFresh(entry.at, clock) : true;
  });
}

export const isRejected = (list, channel, sequence, { now = () => new Date() } = {}) => rejects(list, channel, sequence, now);

export const atomicWrite = writeAtomically;

export async function writePending(directory, pending) {
  const document = { schema: 1, ...pending };
  if (!validPending(document)) throw new Error('pending.json: неверные поля');
  await atomicWrite(join(directory, PENDING_FILE), pretty(document));
}

export const readPending = (paths) => new UpdateFolder(paths).newestReady();
export const removeStaging = (paths, { keep = null } = {}) => new UpdateFolder(paths).clearDownloads(keep);
export const stagingFor = (paths, channel, sequence) => stagingDirectory(paths, channel, sequence);
export const readBadList = (paths) => new UpdateFolder(paths).badEntries();
export const forgetRefused = (paths, channel) => new UpdateFolder(paths).dropRefusals(channel);
export const addBad = (paths, record) => new UpdateFolder(paths).appendBad(record);
export const readAttempts = (paths) => new UpdateFolder(paths).attempts();
export const bumpAttempts = (paths, record) => new UpdateFolder(paths).countAttempt(record);
export const clearAttempts = (paths) => new UpdateFolder(paths).erase('attempts');
export const readFailure = (paths) => new UpdateFolder(paths).failure();
export const clearFailure = (paths) => new UpdateFolder(paths).erase('failed');
export const writeBootOk = (paths, record) => new UpdateFolder(paths).markBoot(record);
export const clearBootOk = (paths) => new UpdateFolder(paths).erase('bootOk');
