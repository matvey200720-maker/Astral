// Служба автообновления бета-лаунчера: связывает клиент, расписание, выход и каналы окна.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { markElevatedReady, startElevated } from '../elevation.js';
import { createBranchUpdater } from './branches-updater.js';
import { createUpdateClient } from './client.js';
import { readInstalledRelease } from './installed.js';
import { createStableWatch, leftoverPlaces as stableLeftovers } from './stable.js';
import { loadKeyring } from './manifest.js';
import { stopLeftoverProcesses } from './leftover-processes.js';
import { installRootFor, updatePaths } from './paths.js';
import { refreshSetupHelper } from './setup-refresh.js';
import { RELEASE_KEYS } from './release-keys.js';
import { createScheduler } from './scheduler.js';
import { createSettingsStore } from './settings.js';

const HELPER_LOG_BYTES = 40960;
const ELEVATION_CODES = new Set(['EACCES', 'UNKNOWN']);
const LOG_SOURCE = { id: 'beta-setup', label: 'Журнал установщика Astral Beta' };

const noop = () => {};
const messageOf = (error) => error?.message ?? String(error);

// Последние байты файла как текст UTF-8.
async function readTail(file, bytes) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const wanted = Math.min(size, bytes);
    if (wanted <= 0) return '';
    const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(wanted), position: size - wanted, length: wanted });
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close().catch(noop);
  }
}

// Хвост последнего журнала установщика (setup-*.log) в папке %LOCALAPPDATA%\AstralBetaSetup\logs.
export async function readLatestHelperLog({ env = process.env, bytes = HELPER_LOG_BYTES } = {}) {
  if (!env.LOCALAPPDATA) return '';
  const folder = join(env.LOCALAPPDATA, 'AstralBetaSetup', 'logs');
  const names = await fsp.readdir(folder).catch(() => []);
  const latest = names.filter((name) => name.startsWith('setup-') && name.endsWith('.log')).sort().pop();
  if (latest === undefined) return '';
  return readTail(join(folder, latest), bytes).catch(() => '');
}

// Состояние «службы нет»: всё пусто, кроме настройки.
const silentState = (auto) => ({
  phase: 'idle',
  disabled: true,
  ...Object.fromEntries(['channel', 'current', 'candidate', 'progress', 'checkedAt', 'error', 'lastFailure'].map((key) => [key, null])),
  auto,
});

// Клиент без защиты для запуска без окна: проверок и загрузки в нём не бывает.
const QUIET_GUARD = {
  active: () => null,
  signedFetch: () => Promise.reject(new Error('проверка при запуске не нужна')),
  pakKey: () => null,
};
const QUIET_DECRYPTOR = () => {
  throw new Error('проверка pak при запуске не нужна');
};

// Значения по умолчанию; явное undefined считается «не задано».
const DEFAULT_OPTIONS = {
  loadPakFormat: () => null,
  executablePath: process.execPath,
  spawnProcess: spawn,
  spawnElevated: startElevated,
  exitTimeoutMs: 10_000,
  stopLeftovers: stopLeftoverProcesses,
  beforeLeave: noop,
  activationPollMs: 5000,
  setupRefreshDelayMs: 60_000,
  channels: null,
  keyring: null,
};

export function createUpdateService(options) {
  const { app, getGuard, canRestart, broadcast, log, registerLogSource } = options;
  const cfg = {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
  };
  const { channels, spawnProcess, spawnElevated, stopLeftovers, beforeLeave } = cfg;

  const paths = updatePaths(installRootFor(cfg.executablePath));
  const info = (message) => log('info', message);

  const lazy = { settings: null, keyring: null };
  let client = null;
  let updater = null;
  let knownGuard = null;
  let pakDecryptor = null;
  let started = false;
  let exiting = false;

  const getSettings = () => {
    lazy.settings ??= createSettingsStore(app.getPath('userData'), { log: (message) => log('warn', message) });
    return lazy.settings;
  };
  const getKeyring = () => {
    lazy.keyring ??= cfg.keyring || loadKeyring({ keys: RELEASE_KEYS });
    return lazy.keyring;
  };
  const isBetaInstall = () => existsSync(paths.helper) && Boolean(app.isPackaged);

  // ---- запуск хелпера и выход ----

  async function spawnDetached(command, args, cwd) {
    const child = spawnProcess(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    child.unref();
  }

  // Установщик просит права администратора, а у лаунчера их нет: тот же запуск через повышение.
  async function launchHelper(command, args, { cwd }) {
    const refusal = await spawnDetached(command, args, cwd).then(() => null, (error) => ({ error }));
    if (refusal === null) return;
    if (!ELEVATION_CODES.has(refusal.error?.code)) throw refusal.error;
    const answer = await spawnElevated({ exe: command, args, cwd });
    if (answer?.outcome !== 'started') throw refusal.error;
  }

  async function leaveNow() {
    const asked = beforeLeave();
    await Promise.resolve(asked).catch((error) => {
      log('warn', `обновление: перед выходом не вышло попросить закрыться фоновых помощников: ${messageOf(error)}`);
    });
    const removed = await Promise.resolve()
      .then(() => stopLeftovers({ appDir: paths.appDir }))
      .catch(() => []);
    if (removed?.length) {
      const names = removed.map(({ name, pid, stopped }) => `${name} ${pid}${stopped ? '' : ' (отказ)'}`);
      info(`обновление: перед выходом сняты процессы из папки приложения: ${names.join(', ')}`);
    }
    app.exit(0);
  }

  function requestQuit() {
    const timers = { fallback: null };
    const go = () => {
      clearTimeout(timers.fallback);
      if (exiting) return undefined;
      exiting = true;
      return leaveNow();
    };
    const onWillQuit = (event) => {
      event.preventDefault();
      go();
    };
    app.once('will-quit', onWillQuit);
    app.quit();
    timers.fallback = setTimeout(go, cfg.exitTimeoutMs);
    timers.fallback.unref?.();
  }

  // ---- применение при запуске ----

  async function watchStable() {
    const { version } = JSON.parse(await fsp.readFile(paths.manifest, 'utf8'));
    if (!version) return false;
    const watch = createStableWatch({
      paths,
      version,
      spawnHelper: launchHelper,
      requestQuit,
      onQuit: (handler) => app.once('before-quit', handler),
      log: info,
    });
    return (await watch.start()).action === 'rollback';
  }

  function applyDownloaded() {
    return createUpdateClient({
      guard: QUIET_GUARD,
      keyring: getKeyring(),
      paths,
      createPakDecryptor: QUIET_DECRYPTOR,
      log: info,
      canRestart: () => true,
      spawnHelper: launchHelper,
      requestQuit,
    }).applyOnStart();
  }

  // Обработчик отказа: строка в журнал с уровнем error и запасное значение.
  const reportAs = (prefix, fallback) => (error) => {
    log('error', `${prefix}: ${messageOf(error)}`);
    return fallback;
  };

  async function applyOnStart() {
    if (!isBetaInstall()) return false;
    if (await watchStable().catch(reportAs('сигнал stable', false))) return true;
    return Promise.resolve().then(applyDownloaded).catch(reportAs('применение обновления при запуске не удалось', false));
  }

  // ---- защита и клиент ----

  // Фабрика расшифровщика интерфейса: свой у защиты, иначе из запасного источника.
  async function pakFormatOf(guard) {
    const owner = typeof guard.createPakDecryptor === 'function' ? guard : await cfg.loadPakFormat();
    return typeof owner?.createPakDecryptor === 'function' ? (key) => owner.createPakDecryptor(key) : null;
  }

  function scheduleChecks() {
    const checkEverything = () => client.checkAndMaybeDownload()
      .then(() => (channels === null ? undefined : getUpdater().updateClosedBranches()));
    const scheduler = createScheduler({ run: checkEverything });
    scheduler.start();
    app.on('browser-window-focus', () => scheduler.notifyFocus());
  }

  async function launchClient(guard) {
    const decryptor = await pakFormatOf(guard);
    if (decryptor === null) {
      log('warn', 'автообновление выключено: нет формата интерфейса (@modovik/beta-pak)');
      return;
    }
    pakDecryptor = decryptor;
    const clientDeps = {
      guard,
      keyring: getKeyring(),
      paths,
      createPakDecryptor: decryptor,
      appVersion: app.getVersion(),
      settings: getSettings(),
      emit: broadcast,
      log: info,
      canRestart,
      spawnHelper: launchHelper,
      requestQuit,
    };
    const hubHooks = channels && {
      channel: channels.ownChannel,
      onChannels: (list) => channels.hub.setKnown(list),
      onChannelDenied: (denied) => channels.hub.setDenied(denied),
    };
    client = createUpdateClient(Object.assign(clientDeps, hubHooks));
    registerLogSource?.({ ...LOG_SOURCE, read: () => readLatestHelperLog() });
    await client.startup();
    scheduleChecks();
    broadcast(client.getState());
  }

  // Пока активации нет, защиту спрашивают снова; таймер процесс не держит.
  function waitForActivation(guard) {
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      const active = await Promise.resolve().then(() => guard.active()).catch(() => null);
      if (active) {
        clearInterval(poll);
        await launchClient(guard).catch(reportAs('автообновление не запустилось', undefined));
      }
      inFlight = false;
    };
    const poll = setInterval(tick, cfg.activationPollMs);
    poll.unref?.();
  }

  function armSetupRefresh() {
    const refreshLater = () => refreshSetupHelper({ paths, log: info })
      .catch((error) => log('warn', `установщик не обновлён: ${messageOf(error)}`));
    setTimeout(refreshLater, cfg.setupRefreshDelayMs).unref?.();
  }

  async function bootService() {
    const guard = await getGuard();
    if (typeof guard?.active !== 'function') {
      info('автообновление выключено: защита беты недоступна');
      return;
    }
    knownGuard = guard;
    if (await guard.active()) {
      await launchClient(guard);
      return;
    }
    info('автообновление выключено: бета-активации нет — ждём проверку при запуске');
    waitForActivation(guard);
  }

  async function start() {
    if (started || !isBetaInstall()) return;
    started = true;
    armSetupRefresh();
    await bootService().catch(reportAs('автообновление не запустилось', undefined));
  }

  const getState = () => (client ? client.getState() : silentState(getSettings().get().autoDownload));

  // ---- установленное и остатки ----

  async function installedInfo() {
    if (!isBetaInstall()) return null;
    const release = await readInstalledRelease({ paths, keyring: getKeyring(), log: info });
    if (!release) return null;
    const { version, build, sequence, channel, publishedAt, notes, cover = null } = release.manifest;
    return { version, build, sequence, channel, publishedAt, notes, cover };
  }

  async function leftoverPlaces() {
    if (!isBetaInstall()) return null;
    const text = await fsp.readFile(paths.manifest, 'utf8').catch(() => null);
    if (text === null) return null;
    const { version, sequence } = JSON.parse(text);
    if (!version) return null;
    return stableLeftovers({ paths, version, sequence, uptimeMs: process.uptime() * 1000 });
  }

  // ---- ветки ----

  const getRuntime = () => (knownGuard && pakDecryptor ? { guard: knownGuard, createPakDecryptor: pakDecryptor } : null);

  function getUpdater() {
    const environment = {
      userData: app.getPath('userData'),
      appVersion: app.getVersion(),
      localAppData: channels.localAppData,
    };
    updater ??= createBranchUpdater({
      channels,
      ownChannel: channels.ownChannel,
      ownPaths: paths,
      getRuntime,
      getKeyring,
      settings: getSettings(),
      log,
      spawnProcess,
      ...environment,
    });
    return updater;
  }

  // Дожидается защиты; если формат интерфейса ещё не взят и активация есть, берёт его.
  async function awaitRuntime() {
    if (pakDecryptor) return;
    const guard = await new Promise((resolve) => resolve(getGuard())).catch(() => null);
    if (!guard || pakDecryptor) return;
    const active = await new Promise((resolve) => resolve(guard.active?.())).catch(() => null);
    if (!active) return;
    knownGuard = guard;
    pakDecryptor = await pakFormatOf(guard);
  }

  async function installBranch(branch, viaArgument) {
    if (!isBetaInstall() || channels === null) return { started: false, reason: 'unavailable' };
    await awaitRuntime();
    const target = getUpdater();
    return viaArgument ? target.installBranch(branch, { viaArgument: true }) : target.installBranch(branch);
  }

  const branchActions = {
    install: (branch) => installBranch(branch, false),
    installFromArgument: (branch) => installBranch(branch, true),
    async refresh() {
      await awaitRuntime();
      if (isBetaInstall()) await getUpdater().refresh(client ?? undefined);
    },
  };
  channels?.setActions(branchActions);

  const installChannelFromCli = (channel) => branchActions.installFromArgument(channel).then(
    (result) => (result.started ? 0 : 1),
    (error) => {
      log('error', `установка ${channel} по аргументу не удалась: ${messageOf(error)}`);
      return 1;
    },
  );

  // ---- каналы окна ----

  async function setAuto(value) {
    const auto = Boolean(value);
    if (client) client.setAuto(auto);
    else getSettings().set({ autoDownload: auto });
    await getSettings().flush?.();
    return getState();
  }

  // Каждая запись: [ключ в карте каналов, имя канала, задача].
  const windowRoutes = [
    ['UPDATES_STATE', 'astral:updates-state', () => getState()],
    ['UPDATES_CHECK', 'astral:updates-check', () => (client ? client.check() : getState())],
    ['UPDATES_DOWNLOAD', 'astral:updates-download', () => (client ? client.download() : getState())],
    ['UPDATES_APPLY', 'astral:updates-apply', () => (client ? client.apply() : { started: false, reason: 'disabled' })],
    ['UPDATES_CANCEL', 'astral:updates-cancel', () => {
      client?.cancel();
      return getState();
    }],
    ['UPDATES_SET_AUTO', 'astral:updates-set-auto', (value) => setAuto(value)],
    ['UPDATES_READY', 'astral:updates-ready', () => {
      markElevatedReady({ argv: process.argv });
      return client ? client.markReady() : { written: false };
    }],
    ['UPDATES_DISMISS_FAILURE', 'astral:updates-dismiss-failure', () => {
      client?.dismissFailure();
      return getState();
    }],
    ['UPDATES_INSTALLED', 'astral:updates-installed', () => installedInfo()],
  ];

  function registerIpc({ IPC, handleIpc, trusted }) {
    windowRoutes.forEach(([key, fallback, task]) => {
      handleIpc(IPC?.[key] ?? fallback, (event, ...args) => trusted(event, () => task(...args)));
    });
  }

  return {
    applyOnStart,
    start,
    registerIpc,
    getState,
    isBetaInstall,
    installedInfo,
    installChannelFromCli,
    leftoverPlaces,
  };
}
