// Клиент автообновления бета-лаунчера: проверка, загрузка, подпись, применение.
import { createReadStream } from 'node:fs';
import { mkdir, rm, statfs } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DownloadError, downloadFile, sha256File, sizeOf } from './download.js';
import { PARALLEL_DEFAULTS, downloadParallel, planParts, removeParts } from './download-parallel.js';
import { isNewerThanInstalled, planDownload, readInstalledRelease } from './installed.js';
import { CHANNELS, ManifestError, NOTE_LANGUAGES, isRequiredUpdate, verifyManifest } from './manifest.js';
import {
  addBad,
  atomicWrite,
  bumpAttempts,
  clearAttempts,
  clearBootOk,
  clearFailure,
  forgetRefused,
  isRejected,
  readAttempts,
  readBadList,
  readFailure,
  readPending,
  removeStaging,
  stagingFor,
  writeBootOk,
  writePending,
} from './staging.js';

export const PHASES = Object.freeze([
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready',
  'applying',
  'error',
]);

const UPDATE_PATH = '/api/v1/beta/launcher/update';
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };
const FILE_URL = /^\/api\/v1\/beta\/(?:install|launcher)\/files\/(?:base|pak)\?ticket=[A-Za-z0-9._~%+=-]+$/;
const BASE_FILE = 'base.zip';
const PAK_FILE = 'astral-web.pak';
const HELPER_ARGS_HEAD = '--apply-update';

const MAX_APPLY_ATTEMPTS = 3;
const HELPER_REFUSAL_PAUSE_MS = 10 * 60 * 1000;
const SPAWN_RETRIES = 3;
const SPAWN_PAUSE_MS = 2000;
const BUSY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const AUTH_STATUSES = new Set([401, 403, 404, 410]);

const DEFAULT_TIMING = { heartbeatMs: 1000, stallAfterMs: 5000, progressIntervalMs: 250, stallTimeoutMs: 30000 };

// Коды загрузчика -> коды состояния окна.
const DOWNLOAD_CODES = {
  NO_NETWORK: 'NO_NETWORK',
  SERVER: 'SERVER',
  TICKET: 'SERVER',
  NOT_FOUND: 'SERVER',
  AUTH: 'AUTH',
  SIZE_MISMATCH: 'HASH_MISMATCH',
  ABORTED: 'ABORTED',
  DISK_FULL: 'DISK_FULL',
};

const noop = () => {};
const isObject = (value) => value !== null && typeof value === 'object';
const isText = (value) => typeof value === 'string';
const reasonText = (error) => error?.message ?? String(error);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class UpdateError extends Error {
  constructor(code, message, { retryable = false, details = null } = {}) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function parseChannels(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((entry) => (
      isObject(entry)
      && CHANNELS.includes(entry.channel)
      && isText(entry.version)
      && entry.version.length >= 1
      && entry.version.length <= 64
    ))
    .map(({ channel, version }) => ({ channel, version }));
}

export function pickNotes(notes, language) {
  for (const candidate of [language, 'ru', 'en', ...NOTE_LANGUAGES]) {
    const note = notes?.[candidate];
    if (note) return note;
  }
  return '';
}

export function driveOf(directory) {
  return isText(directory) && /^[A-Za-z]:/.test(directory) ? `${directory[0].toUpperCase()}:` : null;
}

export async function defaultFreeSpace(directory) {
  let current = directory;
  for (;;) {
    const parent = dirname(current);
    try {
      const info = await statfs(current);
      return Number(info.bavail) * Number(info.bsize);
    } catch (error) {
      if (error?.code !== 'ENOENT' || parent === current) throw error;
      current = parent;
    }
  }
}

export async function spawnPatiently(spawn, log, args, { wait = pause } = {}) {
  for (let retry = 0; ; retry += 1) {
    try {
      return await spawn(...args);
    } catch (error) {
      if (!BUSY_CODES.has(error?.code) || retry >= SPAWN_RETRIES) throw error;
      log(`обновление: установщик занят (${error.code}), попытка ${retry + 1} из ${SPAWN_RETRIES}`);
      await wait(SPAWN_PAUSE_MS);
    }
  }
}

function wellFormed(update) {
  return isObject(update)
    && isText(update.version)
    && isText(update.channel)
    && isText(update.manifest)
    && isText(update.manifest_sig)
    && isObject(update.base)
    && isText(update.base.url)
    && isText(update.base.sha256)
    && Number.isSafeInteger(update.base.bytes)
    && isObject(update.pak)
    && isText(update.pak.url)
    && FILE_URL.test(update.base.url)
    && FILE_URL.test(update.pak.url);
}

const protocolError = (message) => new UpdateError('PROTOCOL', message);
const fromManifest = ({ version, build, sequence }) => ({ version, build, sequence });
// Соседу отдаётся установленный релиз; поля манифеста продублированы наверху на случай, если он ждёт сам манифест.
const forComparison = (installed) => (installed ? { ...installed.manifest, ...installed } : null);
const matchesArtifact = (found, expected) => found.sha256 === expected.sha256 && found.size === expected.size;

function describeCandidate(manifest, plan, required) {
  const { base, web } = manifest.artifacts;
  const baseBytes = plan.needBase ? base.size : 0;
  const webBytes = plan.needWeb ? web.size : 0;
  return {
    version: manifest.version,
    build: manifest.build,
    sequence: manifest.sequence,
    channel: manifest.channel,
    publishedAt: manifest.publishedAt,
    notes: manifest.notes,
    cover: manifest.cover ?? null,
    required,
    bytes: baseBytes + webBytes,
    baseBytes,
    webBytes,
    downloadsBase: plan.needBase,
  };
}

function zeroProgress(file) {
  return {
    file,
    stage: 'download',
    received: 0,
    total: null,
    bytesPerSec: 0,
    etaSec: null,
    attempt: 1,
    resumedFrom: 0,
    retry: null,
    stalledMs: 0,
  };
}

// Состояние клиента и все его действия. Снаружи виден только набор методов из createUpdateClient.
class UpdateEngine {
  #guard;
  #keyring;
  #paths;
  #makePakDecryptor;
  #appVersion;
  #settings;
  #emit;
  #log;
  #now;
  #freeSpace;
  #canRestart;
  #spawnHelper;
  #requestQuit;
  #sleep;
  #maxAttempts;
  #parallel;
  #timing;
  #channel;
  #mode;
  #onChannels;
  #onChannelDenied;
  #runHelper;

  #state;
  #offer = null;
  #controller = null;
  #tail = Promise.resolve();
  #beat = { lastData: 0, retryAt: 0 };

  constructor(deps) {
    this.#guard = deps.guard;
    this.#keyring = deps.keyring;
    this.#paths = deps.paths;
    this.#makePakDecryptor = deps.createPakDecryptor;
    this.#appVersion = deps.appVersion ?? '0.0.0';
    this.#settings = deps.settings ?? memorySettings();
    this.#emit = deps.emit ?? noop;
    this.#log = deps.log ?? noop;
    this.#now = deps.now ?? (() => new Date());
    this.#freeSpace = deps.freeSpace ?? defaultFreeSpace;
    this.#canRestart = deps.canRestart ?? (() => true);
    this.#spawnHelper = deps.spawnHelper ?? noop;
    this.#requestQuit = deps.requestQuit ?? noop;
    this.#sleep = deps.sleep ?? pause;
    this.#maxAttempts = deps.maxDownloadAttempts ?? 8;
    this.#parallel = { ...PARALLEL_DEFAULTS, ...deps.parallelDownload };
    this.#timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.#channel = deps.channel ?? null;
    this.#mode = deps.mode ?? 'own';
    this.#onChannels = deps.onChannels ?? noop;
    this.#onChannelDenied = deps.onChannelDenied ?? noop;
    this.#runHelper = deps.runHelper ?? null;

    this.#state = {
      phase: 'idle',
      disabled: false,
      channel: null,
      current: null,
      candidate: null,
      progress: null,
      checkedAt: null,
      error: null,
      lastFailure: null,
      auto: Boolean(this.#settings.get().autoDownload),
    };
  }

  // ---- состояние ----

  getState() {
    return structuredClone(this.#state);
  }

  #patch(changes) {
    Object.assign(this.#state, changes);
    this.#emit(this.getState());
  }

  #patchProgress(changes) {
    this.#patch({ progress: { ...this.#state.progress, ...changes } });
  }

  #fail(error) {
    this.#log(`обновление: ошибка ${error.code}: ${error.message}`);
    this.#patch({
      phase: 'error',
      progress: null,
      error: { code: error.code, retryable: error.retryable, message: error.message, details: error.details },
    });
  }

  // Ожидаемые отказы кладутся в состояние, всё прочее уходит наружу как есть.
  #settle(error) {
    if (!(error instanceof UpdateError)) throw error;
    this.#fail(error);
  }

  // ---- очередь действий ----

  #action(work) {
    const run = this.#tail.then(async () => {
      const controller = new AbortController();
      this.#controller = controller;
      try {
        return await work(controller.signal);
      } finally {
        if (this.#controller === controller) this.#controller = null;
      }
    });
    this.#tail = run.catch(noop);
    return run;
  }

  cancel() {
    this.#controller?.abort();
  }

  // ---- проверка ----

  check() {
    return this.#action(async (signal) => {
      await this.#check({ forget: true, signal });
      return this.getState();
    });
  }

  checkAndMaybeDownload() {
    return this.#action(async (signal) => {
      await this.#check({ forget: false, signal });
      await this.#maybeDownload(signal);
      return this.getState();
    });
  }

  runClosedCycle() {
    return this.#action(async (signal) => {
      await this.#check({ forget: false, signal });
      await this.#maybeDownload(signal);
      if (this.#state.phase === 'ready') await this.#apply();
      return this.getState();
    });
  }

  async #maybeDownload(signal) {
    const { phase, candidate } = this.#state;
    const auto = Boolean(this.#settings.get().autoDownload);
    if (phase === 'available' && (auto || candidate?.required)) await this.#download(signal);
  }

  async #check({ forget, signal }) {
    const active = await this.#guard.active();
    if (!active) {
      this.#patch({ phase: 'idle', disabled: true });
      return;
    }
    this.#patch({ phase: 'checking', disabled: false, error: null });
    try {
      await this.#consult(active, forget, signal);
    } catch (error) {
      this.#settle(error);
    }
  }

  async #consult(active, forget, signal) {
    const installed = await readInstalledRelease({ paths: this.#paths, keyring: this.#keyring, log: this.#log });
    const named = this.#namedVersion(installed, active);
    const channel = this.#channel || installed?.manifest.channel || active.channel || null;
    const current = installed ? fromManifest(installed.manifest) : { version: named, build: null, sequence: null };

    const body = { activation_id: active.activationId };
    if (active.machine) body.machine = active.machine;
    body.current_version = named;
    if (this.#channel) body.channel = this.#channel;

    const update = await this.#askServer(body, signal);
    if (!update) {
      this.#log(`обновление: проверка — новее нет (ветка ${channel ?? '?'}, стоит ${named || '?'})`);
      await this.#upToDate({ channel, current, installed });
      return;
    }

    const manifest = this.#accept(update);
    this.#log(
      `обновление: проверка — сервер предлагает ${manifest.version} (sequence ${manifest.sequence}), стоит ${named || '?'}`,
    );
    if (!isNewerThanInstalled(forComparison(installed), manifest)) {
      this.#log(`обновление: манифест ${manifest.version} (sequence ${manifest.sequence}) не новее установленного, пропускаем`);
      await this.#upToDate({ channel, current, installed });
      return;
    }

    const required = this.#mode !== 'side' && Boolean(named) && isRequiredUpdate(manifest, named);
    if (forget && await forgetRefused(this.#paths, manifest.channel)) {
      this.#log('обновление: прежний отказ хелпера забыт по кнопке');
    }
    const rejected = isRejected(await readBadList(this.#paths), manifest.channel, manifest.sequence, { now: this.#now });
    if (rejected && !required) {
      this.#log(`обновление: ${manifest.version} уже не запускалось у этого человека, не предлагаем`);
      await this.#upToDate({ channel, current, installed });
      return;
    }

    const plan = planDownload(forComparison(installed), manifest);
    const manifestBytes = Buffer.from(update.manifest, 'base64');
    if (plan.metadataOnly) {
      await atomicWrite(this.#paths.manifest, manifestBytes);
      await atomicWrite(this.#paths.signature, `${update.manifest_sig}\n`);
      this.#offer = null;
      this.#patch({
        phase: 'up-to-date',
        channel: manifest.channel,
        current: fromManifest(manifest),
        candidate: null,
        progress: null,
        checkedAt: this.#now().toISOString(),
        error: null,
      });
      return;
    }

    this.#offer = { update, manifest, manifestBytes, plan, required, body };
    // Кандидат запоминается отдельным событием, затем фаза решается по готовому скачанному.
    this.#patch({ channel: manifest.channel, current, candidate: describeCandidate(manifest, plan, required) });
    const staged = await readPending(this.#paths);
    const alreadyReady = staged !== null && staged.channel === manifest.channel && staged.sequence === manifest.sequence;
    this.#patch({
      phase: alreadyReady ? 'ready' : 'available',
      progress: null,
      checkedAt: this.#now().toISOString(),
      error: null,
    });
  }

  #namedVersion(installed, active) {
    if (this.#mode === 'side') return '';
    if (this.#mode === 'closed') return installed?.manifest.version ?? '';
    return installed?.manifest.version ?? (active.version || this.#appVersion);
  }

  async #upToDate({ channel, current, installed }) {
    this.#offer = null;
    this.#patch({
      phase: 'up-to-date',
      channel,
      current,
      candidate: null,
      progress: null,
      checkedAt: this.#now().toISOString(),
      error: null,
    });
    await this.#tidy(installed);
  }

  // Запрос обновления у сервера: вернёт значение поля update.
  async #askServer(body, signal) {
    let response;
    try {
      response = await this.#guard.signedFetch(UPDATE_PATH, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new UpdateError('NO_NETWORK', error?.message || 'нет связи', { retryable: true });
    }
    if (!response.ok) throw await this.#rejection(response);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw protocolError('ответ обновления — не JSON');
    }
    if (!isObject(payload) || !('update' in payload)) throw protocolError('в ответе нет поля update');
    const channels = parseChannels(payload.channels);
    if (channels) this.#onChannels(channels);
    return payload.update;
  }

  async #rejection(response) {
    const { status } = response;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = isText(body?.code) ? body.code : '';

    if (status === 403 && code === 'BETA_CHANNEL_DENIED') {
      const channel = CHANNELS.includes(body.channel) ? body.channel : this.#channel;
      const channels = parseChannels(body.channels);
      this.#onChannelDenied({ channel, channels });
      return new UpdateError('CHANNEL_DENIED', `доступ к ветке снят (${channel ?? '?'})`, { details: { channel, channels } });
    }
    if (AUTH_STATUSES.has(status)) return new UpdateError('AUTH', `доступ отклонён (${code || status})`);
    return new UpdateError('SERVER', `сервер ответил ${status}${code ? ` (${code})` : ''}`, { retryable: true });
  }

  // Форма ответа, подпись и согласие ответа с подписанным манифестом.
  #accept(update) {
    if (!wellFormed(update)) throw protocolError('ответ обновления неполный или с чужим адресом файла');
    let manifest;
    try {
      manifest = verifyManifest({
        bytes: Buffer.from(update.manifest, 'base64'),
        signature: update.manifest_sig,
        keyring: this.#keyring,
      });
    } catch (error) {
      if (error instanceof ManifestError) {
        throw new UpdateError('SIGNATURE_INVALID', `манифест не принят (${error.code}): ${error.message}`);
      }
      throw error;
    }
    const signedBase = manifest.artifacts.base;
    const agrees = update.version === manifest.version
      && update.channel === manifest.channel
      && update.base.sha256 === signedBase.sha256
      && update.base.bytes === signedBase.size
      && (!this.#channel || manifest.channel === this.#channel);
    if (!agrees) throw protocolError('ответ сервера расходится с подписанным манифестом');
    return manifest;
  }

  // Разбор после проверки без предложения (и в startup, markReady).
  async #tidy(known) {
    const installed = known === undefined ? await this.#readInstalled() : known;
    if (!installed) return;
    const own = installed.manifest;
    const ready = await readPending(this.#paths);
    if (ready && ready.channel === own.channel && ready.sequence <= own.sequence) {
      await removeStaging(this.#paths);
    }
    const attempts = await readAttempts(this.#paths);
    if (attempts && attempts.channel === own.channel && attempts.sequence <= own.sequence) {
      await clearAttempts(this.#paths);
    }
  }

  #readInstalled() {
    return readInstalledRelease({ paths: this.#paths, keyring: this.#keyring, log: this.#log });
  }

  // ---- загрузка ----

  download() {
    return this.#action(async (signal) => {
      await this.#download(signal);
      return this.getState();
    });
  }

  async #download(signal) {
    const job = this.#offer;
    if (!job) throw protocolError('нечего скачивать: сначала проверка обновлений');

    this.#beat = { lastData: Date.now(), retryAt: 0 };
    this.#patch({
      phase: 'downloading',
      error: null,
      progress: zeroProgress(job.plan.needBase ? 'base' : 'pak'),
    });
    const stopBeat = this.#startHeartbeat();
    try {
      await this.#transfer(job, signal);
      this.#patch({ phase: 'ready', progress: null });
    } catch (error) {
      await this.#downloadFailed(error, job);
    } finally {
      stopBeat();
    }
  }

  async #transfer(job, signal) {
    const { manifest, plan, update } = job;
    const directory = stagingFor(this.#paths, manifest.channel, manifest.sequence);

    job.need = this.#bytesNeeded(job);
    const free = await this.#freeSpace(this.#paths.root);
    if (free < job.need) {
      throw new UpdateError('DISK_FULL', `нужно ${job.need} байт, свободно ${free}`, {
        details: { need: job.need, available: free, drive: driveOf(this.#paths.root) },
      });
    }

    await mkdir(directory, { recursive: true });
    await removeStaging(this.#paths, { keep: basename(directory) });
    await atomicWrite(join(directory, 'manifest.json'), job.manifestBytes);
    await atomicWrite(join(directory, 'manifest.sig'), `${update.manifest_sig}\n`);

    if (plan.needBase) await this.#fetchBase(job, directory, signal);
    if (plan.needWeb) await this.#fetchPak(job, directory, signal);

    await writePending(directory, {
      channel: manifest.channel,
      version: manifest.version,
      sequence: manifest.sequence,
      hasBase: plan.needBase,
      hasWeb: plan.needWeb,
      required: job.required,
      createdAt: this.#now().toISOString(),
    });
  }

  #bytesNeeded({ update, manifest, plan }) {
    const { base, web } = manifest.artifacts;
    const pakBytes = this.#declaredPakBytes(update) ?? web.size;
    return Math.ceil((plan.needBase ? base.size * 2.5 : 0) + (plan.needWeb ? pakBytes * 2 : 0));
  }

  #declaredPakBytes(update) {
    const { bytes } = update.pak;
    return Number.isInteger(bytes) && bytes > 0 ? bytes : null;
  }

  async #downloadFailed(error, job) {
    let failure;
    if (error instanceof UpdateError) {
      failure = error;
    } else if (error instanceof DownloadError) {
      if (error.code === 'ABORTED') {
        this.#patch({ phase: 'available', progress: null, error: null });
        return;
      }
      failure = await this.#translate(error, job);
    } else {
      throw error;
    }
    this.#fail(failure);
  }

  async #translate(error, job) {
    const code = DOWNLOAD_CODES[error.code] ?? 'SERVER';
    if (code !== 'DISK_FULL') return new UpdateError(code, error.message, { retryable: error.retryable });
    let available = 0;
    try {
      available = await this.#freeSpace(this.#paths.root);
    } catch {
      available = 0;
    }
    return new UpdateError(code, error.message, {
      details: { need: job.need, available, drive: driveOf(this.#paths.root) },
    });
  }

  // Новый билет: тот же запрос обновления, принимается только тот же кандидат.
  async #refreshTickets(job, signal) {
    const update = await this.#askServer(job.body, signal);
    if (!update) throw new UpdateError('SUPERSEDED', 'обновление пропало с сервера');
    const manifest = this.#accept(update);
    if (manifest.sequence !== job.manifest.sequence || manifest.channel !== job.manifest.channel) {
      throw new UpdateError('SUPERSEDED', 'на сервере вышла другая версия, начнём заново');
    }
    job.update = update;
  }

  #fetchFile(job, kind) {
    return (offset, signal) => {
      const init = { method: 'GET', signal };
      if (offset > 0) init.headers = { Range: `bytes=${offset}-` };
      return this.#guard.signedFetch(job.update[kind].url, init);
    };
  }

  #fetchRange(job) {
    return (start, end, signal) => this.#guard.signedFetch(job.update.base.url, {
      method: 'GET',
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });
  }

  #transferOptions(job, file, signal) {
    return {
      refresh: () => this.#refreshTickets(job, signal),
      onProgress: (snapshot) => this.#onTransfer(file, snapshot),
      onRetry: (retry) => this.#onRetry(retry),
      progressIntervalMs: this.#timing.progressIntervalMs,
      stallTimeoutMs: this.#timing.stallTimeoutMs,
      signal,
      maxAttempts: this.#maxAttempts,
      sleep: this.#sleep,
    };
  }

  async #fetchBase(job, directory, signal) {
    const file = join(directory, BASE_FILE);
    const expected = job.manifest.artifacts.base;
    this.#beginFile('base');

    if ((await sizeOf(file)) > 0 && matchesArtifact(await this.#verifyFile('base', file, signal), expected)) return;

    for (let round = 1; round <= 2; round += 1) {
      this.#beginFile('base');
      const found = await this.#pullBase(job, file, signal);
      if (matchesArtifact(found, expected)) return;
      this.#log(`база: хэш не сошёлся (попытка ${round})`);
      await rm(file, { force: true });
    }
    throw new UpdateError('HASH_MISMATCH', 'base.zip не совпал с подписанным манифестом после повторной загрузки');
  }

  // Одна загрузка базы: кусками параллельно, если можно, иначе одним потоком.
  async #pullBase(job, file, signal) {
    const size = job.manifest.artifacts.base.size;
    const parts = planParts(size, this.#parallel);
    if (parts && parts.length >= 2) {
      try {
        await removeParts(file);
        const done = await downloadParallel({
          ...this.#transferOptions(job, 'base', signal),
          fetchRange: this.#fetchRange(job),
          target: file,
          size,
          parts,
          blockBytes: this.#parallel.blockBytes,
        });
        this.#verifyBoard('base', done.received).end(done.received);
        return { sha256: done.sha256, size: done.received };
      } catch (error) {
        if (!(error instanceof DownloadError) || error.code !== 'NO_RANGE') throw error;
        this.#log('база: сервер не отдаёт диапазоны — качаем одним потоком');
        await removeParts(file);
      }
    }
    await downloadFile({
      ...this.#transferOptions(job, 'base', signal),
      fetchPart: this.#fetchFile(job, 'base'),
      target: file,
      size,
      resumable: true,
    });
    return this.#verifyFile('base', file, signal);
  }

  async #fetchPak(job, directory, signal) {
    const file = join(directory, PAK_FILE);
    const expected = job.manifest.artifacts.web;
    for (let round = 1; round <= 2; round += 1) {
      this.#beginFile('pak');
      await downloadFile({
        ...this.#transferOptions(job, 'pak', signal),
        fetchPart: this.#fetchFile(job, 'pak'),
        target: file,
        size: this.#declaredPakBytes(job.update),
        resumable: false,
      });
      const key = await this.#guard.pakKey();
      if (!key) throw new UpdateError('KEY_UNAVAILABLE', 'ключ интерфейса недоступен: нужна проверка на сервере');
      const complaint = await this.#inspectPak(file, key, expected, signal);
      if (complaint === null) return;
      this.#log(`интерфейс: ${complaint} (попытка ${round})`);
      await rm(file, { force: true });
    }
    throw new UpdateError('HASH_MISMATCH', 'astral-web.pak не прошёл проверку после повторной загрузки');
  }

  // Причина отказа или null, если интерфейс прошёл расшифровку и сверку.
  async #inspectPak(file, key, expected, signal) {
    const total = await sizeOf(file);
    const board = this.#verifyBoard('pak', total);
    board.begin();
    const decryptor = this.#makePakDecryptor(key);
    let opened = 0;
    const counter = new Transform({
      transform(chunk, encoding, done) {
        opened += chunk.length;
        done();
      },
    });
    try {
      await pipeline(createReadStream(file), decryptor, counter, { signal });
    } catch (error) {
      if (signal.aborted) throw new DownloadError('ABORTED', 'проверка отменена');
      return `расшифровка не удалась: ${reasonText(error)}`;
    }
    board.end(total);
    const sound = decryptor.sha256 === expected.sha256 && opened === expected.size;
    return sound ? null : 'хэш открытого интерфейса не совпал с манифестом';
  }

  // ---- ход загрузки ----

  #beginFile(file) {
    const p = this.#state.progress;
    const fresh = p && p.file === file && p.stage === 'download' && p.received === 0 && p.total === null && !p.retry;
    if (fresh) return;
    this.#beat.lastData = Date.now();
    this.#patch({ progress: zeroProgress(file) });
  }

  #onTransfer(file, snapshot) {
    this.#beat.lastData = Date.now();
    this.#patch({
      progress: {
        file,
        stage: 'download',
        received: snapshot.received,
        total: snapshot.total,
        bytesPerSec: snapshot.bytesPerSec,
        etaSec: snapshot.etaSec,
        attempt: snapshot.attempt,
        resumedFrom: snapshot.resumedFrom,
        retry: null,
        stalledMs: 0,
      },
    });
  }

  #onRetry({ attempt, maxAttempts, waitMs, code }) {
    this.#beat.retryAt = Date.now() + waitMs;
    this.#patchProgress({
      bytesPerSec: 0,
      etaSec: null,
      retry: { attempt, max: maxAttempts, inMs: waitMs, code },
      stalledMs: 0,
    });
  }

  // Проверка файла: свои снимки, без скорости; первый и последний выдаются всегда.
  #verifyBoard(file, total) {
    const interval = this.#timing.progressIntervalMs;
    let last = 0;
    const send = (received) => {
      const p = this.#state.progress;
      this.#patch({
        progress: {
          file,
          stage: 'verify',
          received,
          total,
          bytesPerSec: 0,
          etaSec: null,
          attempt: p?.attempt ?? 1,
          resumedFrom: p?.resumedFrom ?? 0,
          retry: null,
          stalledMs: 0,
        },
      });
    };
    return {
      begin: () => {
        last = Date.now();
        send(0);
      },
      step: (received) => {
        const at = Date.now();
        if (at - last < interval) return;
        last = at;
        send(received);
      },
      end: send,
    };
  }

  async #verifyFile(file, path, signal) {
    const board = this.#verifyBoard(file, await sizeOf(path));
    board.begin();
    const found = await sha256File(path, { signal, onProgress: board.step });
    board.end(found.size);
    return found;
  }

  // «Сердцебиение»: срок до повтора и молчание соединения.
  #startHeartbeat() {
    const { heartbeatMs, stallAfterMs } = this.#timing;
    const timer = setInterval(() => {
      const p = this.#state.progress;
      if (this.#state.phase !== 'downloading' || !p) return;
      const at = Date.now();
      if (p.retry) {
        const inMs = Math.max(0, this.#beat.retryAt - at);
        if (inMs !== p.retry.inMs) this.#patchProgress({ retry: { ...p.retry, inMs } });
        return;
      }
      const quiet = at - this.#beat.lastData;
      if (p.stage === 'download' && quiet > stallAfterMs) {
        this.#patchProgress({ stalledMs: quiet, bytesPerSec: 0, etaSec: null });
      }
    }, heartbeatMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // ---- применение ----

  apply() {
    return this.#action(() => this.#apply());
  }

  async #apply() {
    const ready = await readPending(this.#paths);
    if (!ready) throw new UpdateError('NOTHING_TO_APPLY', 'нет скачанного и проверенного обновления');
    return this.#mode === 'closed' ? this.#applyClosed(ready) : this.#applyOwn(ready);
  }

  async #applyClosed(ready) {
    if (!this.#runHelper) throw new UpdateError('HELPER_UNAVAILABLE', 'запуск хелпера закрытой ветки не подключён');
    const { root, helper } = this.#paths;
    this.#patch({ phase: 'applying' });
    let outcome;
    try {
      outcome = await this.#runHelper(helper, [HELPER_ARGS_HEAD, '--install-dir', root, '--staging', ready.directory, '--quiet'], { cwd: root });
    } catch (error) {
      this.#patch({ phase: 'ready' });
      throw new UpdateError('HELPER_UNAVAILABLE', `хелпер ветки не запустился: ${reasonText(error)}`, { retryable: true });
    }

    const { code } = outcome;
    if (code === 0) {
      const after = await this.#readInstalled();
      this.#offer = null;
      this.#patch({
        phase: 'up-to-date',
        candidate: null,
        progress: null,
        error: null,
        ...(after ? { current: fromManifest(after.manifest) } : {}),
      });
      return { started: true, version: ready.version, code: 0 };
    }

    this.#log(`обновление закрытой ветки ${ready.channel} ${ready.version}: хелпер вернул код ${code}`);
    await addBad(this.#paths, {
      channel: ready.channel,
      sequence: ready.sequence,
      version: ready.version,
      reason: `helper_exit_${code}`,
      now: this.#now,
    });
    await removeStaging(this.#paths);
    this.#fail(new UpdateError('HELPER_FAILED', `хелпер ветки вернул код ${code}`, { details: { code } }));
    return { started: false, code };
  }

  async #applyOwn(ready) {
    if (!(await this.#canRestart())) {
      this.#log('обновление: сейчас идёт установка или запись в игру, применим позже');
      return { started: false, reason: 'busy' };
    }
    const { root, helper } = this.#paths;
    await clearBootOk(this.#paths);
    await bumpAttempts(this.#paths, { channel: ready.channel, sequence: ready.sequence, now: this.#now });
    this.#patch({ phase: 'applying' });
    const args = [HELPER_ARGS_HEAD, '--pid', String(process.pid), '--install-dir', root, '--staging', ready.directory, '--launch'];
    try {
      await spawnPatiently(this.#spawnHelper, this.#log, [helper, args, { cwd: root }]);
    } catch (error) {
      this.#patch({ phase: 'ready' });
      throw new UpdateError('HELPER_UNAVAILABLE', `хелпер обновления не запустился: ${reasonText(error)}`, { retryable: true });
    }
    this.#requestQuit();
    return { started: true, version: ready.version };
  }

  async applyOnStart() {
    const ready = await readPending(this.#paths);
    if (!ready) return false;
    const installed = await this.#readInstalled();
    const own = installed?.manifest;
    if (own && own.channel === ready.channel && ready.sequence <= own.sequence) {
      await removeStaging(this.#paths);
      return false;
    }

    const attempts = await readAttempts(this.#paths);
    if (attempts && attempts.channel === ready.channel && attempts.sequence === ready.sequence) {
      if (this.#now().getTime() - attempts.at < HELPER_REFUSAL_PAUSE_MS) {
        this.#log(`обновление ${ready.version}: хелпер только что отказал, откладываем до следующего запуска`);
        return false;
      }
      if (attempts.count >= MAX_APPLY_ATTEMPTS) {
        this.#log(`обновление ${ready.version}: хелпер уже ${attempts.count} раза не смог его применить, оставляем прежнюю версию`);
        const at = this.#now().toISOString();
        await addBad(this.#paths, {
          channel: ready.channel,
          sequence: ready.sequence,
          version: ready.version,
          reason: 'apply_refused',
          now: this.#now,
        });
        await clearAttempts(this.#paths);
        await removeStaging(this.#paths);
        this.#patch({ lastFailure: { version: ready.version, restored: own?.version ?? '', reason: 'apply_refused', at } });
        return false;
      }
    }

    const outcome = await this.apply();
    return outcome.started === true;
  }

  // ---- запуск, подтверждение, настройки ----

  async startup() {
    const installed = await this.#readInstalled();
    const failure = await readFailure(this.#paths);
    if (failure) {
      const channel = failure.channel ?? installed?.manifest.channel;
      if (channel) {
        await addBad(this.#paths, {
          channel,
          sequence: failure.sequence,
          version: failure.version,
          reason: failure.reason,
          now: this.#now,
        });
      }
      await clearFailure(this.#paths);
      await clearAttempts(this.#paths);
      await removeStaging(this.#paths);
      this.#patch({
        lastFailure: {
          version: failure.version,
          restored: failure.restored || installed?.manifest.version || '',
          reason: failure.reason,
          at: failure.at,
        },
      });
    }
    await this.#tidy(installed);
    return this.getState();
  }

  async markReady() {
    const installed = await this.#readInstalled();
    if (!installed) return { written: false };
    const { version, sequence } = installed.manifest;
    await writeBootOk(this.#paths, { version, sequence, now: this.#now });
    await this.#tidy(installed);
    return { written: true, version };
  }

  staged() {
    return readPending(this.#paths);
  }

  setAuto(value) {
    const auto = Boolean(value);
    this.#settings.set({ autoDownload: auto });
    this.#patch({ auto });
  }

  dismissFailure() {
    this.#patch({ lastFailure: null });
  }
}

function memorySettings() {
  const stored = { autoDownload: true };
  return {
    get: () => ({ ...stored }),
    set: (patch) => {
      Object.assign(stored, patch);
    },
  };
}

export function createUpdateClient(deps) {
  const engine = new UpdateEngine(deps);
  return {
    getState: () => engine.getState(),
    check: () => engine.check(),
    download: () => engine.download(),
    apply: () => engine.apply(),
    cancel: () => engine.cancel(),
    runClosedCycle: () => engine.runClosedCycle(),
    staged: () => engine.staged(),
    checkAndMaybeDownload: () => engine.checkAndMaybeDownload(),
    setAuto: (value) => engine.setAuto(value),
    dismissFailure: () => engine.dismissFailure(),
    startup: () => engine.startup(),
    markReady: () => engine.markReady(),
    applyOnStart: () => engine.applyOnStart(),
  };
}
