// Остальные ветки на компьютере: обновление закрытых, «Установить рядом», занятость для окон.
import { createInstallStateFile } from '../channels/install-state.js';
import { branchRoot, isBranch } from '../channels/branches.js';
import { overallProgress } from './progress.js';
import { updatePaths } from './paths.js';
import { createUpdateClient } from './client.js';
import { SIDE_DIRECTORY } from './staging.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const messageOf = (error) => error?.message ?? String(error);
const exitCodeOf = (code) => code ?? -1;

const TRANSFER_KEYS = [
  'stage', 'doneBytes', 'totalBytes', 'bytesPerSec', 'etaSec', 'attempt', 'retry', 'stalledMs', 'resumedFrom', 'verifyPercent',
];

export const downloadPercent = (state) => overallProgress(state)?.percent ?? null;

export function busyOf(state, kind = 'update') {
  const phase = state.phase;
  if (phase === 'applying') return { kind, phase };
  if (phase === 'error') return { kind, phase, error: state.error?.code || 'SERVER' };
  if (phase !== 'downloading') return null;

  const progress = overallProgress(state);
  if (progress === null) return { kind, phase, percent: null };
  const transfer = Object.fromEntries(TRANSFER_KEYS.map((key) => [key, progress[key]]));
  transfer.version = state.candidate.version ?? null;
  return { kind, phase, percent: progress.percent, transfer };
}

// Отказ на шаге установки «рядом»: код причины и подробности для журнала и файла состояния.
class InstallFailure extends Error {
  constructor(code, detail) {
    super(detail);
    Object.assign(this, { code, detail });
  }
}

const asFailure = (error) => (error instanceof InstallFailure ? error : new InstallFailure('INTERNAL', messageOf(error)));
const fromClientError = (error) => new InstallFailure(error.code, error.message);

// Установка ветки «рядом»: проверка, загрузка, передача хелперу.
class SideInstall {
  #owner;
  #channel;
  #file;
  #exitJob = null;

  constructor(owner, channel, file) {
    this.#owner = owner;
    this.#channel = channel;
    this.#file = file;
  }

  async run() {
    this.#owner.hub.setBusy(this.#channel, { kind: 'install', phase: 'checking' });
    this.#note('download', 0);
    const staged = await this.#obtain();
    return this.#handOff(staged);
  }

  #note(phase, percent, extra = {}) {
    this.#file?.working({ phase, percent, overall: percent, ...extra, force: true });
  }

  #onState(state) {
    if (state.phase !== 'downloading') return;
    const busy = busyOf(state, 'install');
    this.#owner.hub.setBusy(this.#channel, busy);
    const { transfer } = busy;
    if (!this.#file || !transfer) return;
    const verifying = transfer.stage === 'verify';
    this.#file.working({
      phase: verifying ? 'verify' : 'download',
      percent: verifying ? transfer.verifyPercent : busy.percent,
      overall: busy.percent,
      version: transfer.version,
    });
  }

  #client() {
    const owner = this.#owner;
    const channel = this.#channel;
    const root = branchRoot(owner.localAppData, channel);
    return owner.makeClient(owner.clientDeps({
      paths: { ...updatePaths(root), updateDir: join(owner.ownPaths.updateDir, SIDE_DIRECTORY) },
      channel,
      mode: 'side',
      tag: `${channel} рядом`,
      settings: { get: () => ({ autoDownload: true }), set() {} },
      emit: (state) => this.#onState(state),
    }));
  }

  // Проверка и загрузка файлов ветки; возвращает готовое скачанное.
  async #obtain() {
    const client = this.#client();
    let state = await client.check();
    if (state.phase === 'error') throw fromClientError(state.error);
    if (!['available', 'ready'].includes(state.phase)) throw new InstallFailure('NO_RELEASE', 'у ветки нет релиза');
    if (state.phase === 'available') {
      state = await client.download();
      if (state.phase === 'error') throw fromClientError(state.error);
    }
    const staged = await client.staged();
    if (staged === null) throw new InstallFailure('NO_RELEASE', 'скачанное не найдено');
    return staged;
  }

  async #handOff(staged) {
    const { hub, ownPaths } = this.#owner;
    hub.setBusy(this.#channel, { kind: 'install', phase: 'handing-off', percent: 100 });
    this.#note('verify', 0, { version: staged.version });
    // Всё, что мы записали в файл состояния, должно лечь раньше, чем хелпер допишет итог.
    await this.#file?.settled();
    const args = ['--install-channel', this.#channel, '--staging', staged.directory];
    return this.#file ? this.#awaitQuiet(ownPaths, args, staged) : this.#launchWindowed(ownPaths, args);
  }

  async #awaitQuiet(ownPaths, args, staged) {
    const owner = this.#owner;
    const code = await owner.runHelper(ownPaths.helper, [...args, '--quiet'], { cwd: ownPaths.root }).then(
      (outcome) => outcome.code,
      (error) => {
        throw new InstallFailure('HELPER_UNAVAILABLE', messageOf(error));
      },
    );
    await this.#file.settleFromExit(code, { version: staged.version });
    await this.#file.settled();
    owner.finished(this.#channel, code);
    return code === 0 ? { started: true } : { started: false, reason: `helper-${code}` };
  }

  async #launchWindowed(ownPaths, args) {
    const owner = this.#owner;
    const channel = this.#channel;
    const options = { cwd: ownPaths.root, detached: true, stdio: 'ignore', windowsHide: false };
    try {
      const child = owner.spawnProcess(ownPaths.helper, args, options);
      const exited = new Promise((resolve) => {
        child.once('exit', (code) => resolve(exitCodeOf(code)));
      });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('spawn', resolve);
        child.once('exit', resolve);
      });
      child.unref?.();
      // Итог хелпера разбирается позже: когда «handing-off» уже опубликовано и {started: true} возвращён.
      this.#exitJob = () => exited.then((code) => owner.finished(channel, code));
    } catch (error) {
      throw new InstallFailure('HELPER_UNAVAILABLE', messageOf(error));
    }
    return { started: true };
  }

  releaseExit() {
    const job = this.#exitJob;
    this.#exitJob = null;
    job?.();
  }
}

// Закрытые ветки и установка «рядом» от лица одного обновителя.
class BranchUpdater {
  #deps;
  #clients = new Map();
  #sweeping = false;
  #installing = null;

  constructor(deps) {
    this.#deps = {
      localAppData: process.env.LOCALAPPDATA,
      spawnProcess: spawn,
      makeClient: createUpdateClient,
      now: () => new Date(),
      ...Object.fromEntries(Object.entries(deps).filter(([, value]) => value !== undefined)),
    };
    this.runHelper = this.runHelper.bind(this);
    this.clientDeps = this.clientDeps.bind(this);
    this.finished = this.finished.bind(this);
  }

  get hub() {
    return this.#deps.channels.hub;
  }

  get ownPaths() {
    return this.#deps.ownPaths;
  }

  get localAppData() {
    return this.#deps.localAppData;
  }

  get spawnProcess() {
    return this.#deps.spawnProcess;
  }

  get makeClient() {
    return this.#deps.makeClient;
  }

  get installing() {
    return this.#installing;
  }

  // Запуск хелпера без окна с ожиданием выхода.
  async runHelper(command, args, { cwd }) {
    const child = this.#deps.spawnProcess(command, args, { cwd, stdio: 'ignore', windowsHide: true });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve({ code: exitCodeOf(code) }));
    });
  }

  // Общие параметры клиента ветки; порядок ключей виден тем, кто подменяет makeClient.
  clientDeps({ paths, channel, mode, tag, settings, emit }) {
    const { getRuntime, getKeyring, appVersion, log } = this.#deps;
    const runtime = getRuntime();
    return {
      guard: runtime.guard,
      keyring: getKeyring(),
      paths,
      createPakDecryptor: runtime.createPakDecryptor,
      appVersion,
      settings,
      emit,
      log: (line) => log('info', `[${tag}] ${line}`),
      channel,
      mode,
      onChannels: (list) => this.hub.setKnown(list),
      onChannelDenied: (denied) => this.hub.setDenied(denied),
    };
  }

  #closedClient(install) {
    const key = `${install.channel}|${install.root}`;
    if (!this.#clients.has(key)) {
      const branch = install.channel;
      const base = this.clientDeps({
        paths: updatePaths(install.root),
        channel: branch,
        mode: 'closed',
        tag: branch,
        settings: this.#deps.settings,
        emit: (state) => this.hub.setBusy(branch, busyOf(state)),
      });
      this.#clients.set(key, this.makeClient({ ...base, runHelper: this.runHelper }));
    }
    return this.#clients.get(key);
  }

  async sweep() {
    const { channels, ownChannel, log } = this.#deps;
    if (this.#sweeping || !this.#deps.getRuntime()) return;
    this.#sweeping = true;
    try {
      const closed = (await channels.discover()).filter((item) => !ownChannel || item.channel !== ownChannel);
      for (const install of closed) {
        const failure = await Promise.resolve()
          .then(() => this.#closedClient(install).runClosedCycle())
          .then(() => null, (error) => ({ error }));
        if (failure !== null) {
          log('warn', `ветка ${install.channel}: обновление не вышло: ${messageOf(failure.error)}`);
          this.hub.setBusy(install.channel, null);
        }
        this.hub.refreshInstalls();
      }
    } finally {
      this.#sweeping = false;
    }
  }

  // Отказы, не требующие знать установленные ветки.
  #plainRefusal(channel) {
    if (!isBranch(channel)) return 'unknown-branch';
    return channel === this.#deps.ownChannel ? 'same-branch' : null;
  }

  // Отказы по установленным веткам и по уже идущей установке.
  #crowdedRefusal(channel, present) {
    if (present.some((item) => item.channel === channel)) return 'already-installed';
    if (this.#installing === null) return null;
    return this.#installing === channel ? 'already-running' : 'busy';
  }

  // Конец работы хелпера: признак «ставится» снимается, хаб читает установки заново.
  finished(channel, code) {
    this.#installing = null;
    this.hub.refreshInstalls();
    if (code === 0) {
      this.hub.setBusy(channel, null);
      return;
    }
    this.#deps.log('warn', `установка ${channel} рядом: хелпер вернул код ${code}`);
    this.hub.setBusy(channel, { kind: 'install', phase: 'error', error: 'HELPER_FAILED' });
  }

  // Установка считается начатой с самого вызова: отметка ставится до первого ожидания.
  async install(channel, { viaArgument = false } = {}) {
    const early = this.#plainRefusal(channel);
    if (early !== null) return { started: false, reason: early };

    const listing = this.#deps.channels.discover();
    const present = typeof listing?.then === 'function' ? await listing : listing;
    const crowded = this.#crowdedRefusal(channel, present);
    if (crowded !== null) return { started: false, reason: crowded };

    this.#installing = channel;
    try {
      return await this.#proceed(channel, viaArgument);
    } catch (error) {
      this.#installing = null;
      throw error;
    }
  }

  async #proceed(channel, viaArgument) {
    const { userData, now, getRuntime, log } = this.#deps;
    const file = viaArgument ? createInstallStateFile({ userData, channel, now }) : null;
    if (!getRuntime()) {
      if (file) {
        file.failed('AUTH', 'no activation');
        await file.settled();
      }
      this.#installing = null;
      return { started: false, reason: 'no-activation' };
    }

    const side = new SideInstall(this, channel, file);
    return side.run().then((result) => {
      side.releaseExit();
      return result;
    }).catch(async (error) => {
      const failure = asFailure(error);
      log('warn', `установка ${channel} рядом не вышла: ${failure.code} ${failure.detail}`);
      this.hub.setBusy(channel, { kind: 'install', phase: 'error', error: failure.code });
      if (file) {
        file.failed(failure.code, failure.detail);
        await file.settled();
      }
      this.#installing = null;
      return { started: false, reason: failure.code };
    });
  }

  async refresh(ownClient) {
    this.hub.refreshInstalls();
    if (ownClient) await ownClient.check();
  }
}

export function createBranchUpdater(deps) {
  const updater = new BranchUpdater(deps);
  return {
    installBranch: (channel, options) => updater.install(channel, options),
    updateClosedBranches: () => updater.sweep(),
    refresh: (ownClient) => updater.refresh(ownClient),
    isInstalling: () => updater.installing,
  };
}
