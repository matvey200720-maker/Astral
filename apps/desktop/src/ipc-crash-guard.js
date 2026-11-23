import fs from "node:fs";
import path from "node:path";
import * as logging from "./app-log.js";
import * as versions from "./updates/display-version.js";

export const IPC_CRASHED_CODE = "IPC_CRASHED";
export const CRASH_STRIKES_LIMIT = 2;

const STRIKES_FILE = "ipc-crash-strikes.json";
const MARKS_DIR = "ipc-inflight";
const FINGERPRINT_TTL_MS = 3000;
const OVER_LIMIT_TAIL = ": дальше этот запрос не выполняется, пока файлы игры или Astral не сменятся";

const isRecord = (value) => typeof value === "object" && Boolean(value);
const noop = () => {};

// Сбой диска здесь не повод ронять запрос: возвращаем запасное значение.
function attempt(job, fallback) {
  let outcome = fallback;
  try {
    outcome = job();
  } catch {
    outcome = fallback;
  }
  return outcome;
}

export function ipcCrashedMessage() {
  return [
    "Это действие дважды обрывало Astral на файлах вашей игры, поэтому сейчас Astral его не выполняет.",
    "Обычно так бывает с редуксом, который меняет эти файлы.",
    "Astral попробует снова, когда файлы игры изменятся или Astral обновится.",
  ].join(" ");
}

function crashRefusal() {
  const refusal = new Error(ipcCrashedMessage());
  refusal.code = IPC_CRASHED_CODE;
  return refusal;
}

function deathNotice(channel, count) {
  const tail = count >= CRASH_STRIKES_LIMIT ? OVER_LIMIT_TAIL : "";
  return `Прошлый запуск умер посреди «${channel}» (${count} из ${CRASH_STRIKES_LIMIT} на этих файлах игры)${tail}.`;
}

// Охраняется запрос, у которого первый аргумент — объект с непустой строкой gameRoot.
function rootOf(input) {
  if (!isRecord(input)) return null;
  const { gameRoot } = input;
  if (typeof gameRoot !== "string") return null;
  const trimmed = gameRoot.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

// Счёт страйков: ключ «канал\nотпечаток» -> число смертей на этих файлах игры.
function restoreLedger(saved, release) {
  const intact = isRecord(saved) && isRecord(saved.strikes) && saved.version === release;
  return intact ? saved : { version: release, strikes: {} };
}

const strikesOf = (ledger, key) => ledger.strikes[key];

function addStrike(ledger, key) {
  const total = (ledger.strikes[key] || 0) + 1;
  ledger.strikes[key] = total;
  return ledger.strikes[key];
}

// Значения с временем жизни: свежее значение берётся из памяти, иначе строится заново.
function stampMemory() {
  const entries = new Map();
  return (key, now, make) => {
    const remembered = entries.get(key);
    const alive = remembered !== undefined && now - remembered.at < FINGERPRINT_TTL_MS;
    if (alive) return remembered.value;
    const value = make();
    entries.set(key, { at: now, value });
    return value;
  };
}

function archiveTail(root) {
  return attempt(() => {
    const info = fs.statSync(path.join(root, "update", "update.rpf"));
    return `${info.size}:${Math.round(info.mtimeMs)}`;
  }, "-");
}

const fingerprintOf = (recall, root) => recall(root, Date.now(), () => `${root.toLowerCase()}|${archiveTail(root)}`);

// Всё общение с диском: файл счёта и метки запросов в папке данных.
const stateFileOf = (site) => path.join(site.dir(), STRIKES_FILE);
const marksDirOf = (site) => path.join(site.dir(), MARKS_DIR);
const prefixOf = (site) => `${site.pid}-`;

const readLedger = (site) => attempt(() => JSON.parse(fs.readFileSync(stateFileOf(site), "utf8")), null);

function writeLedger(site, ledger) {
  attempt(() => {
    fs.mkdirSync(site.dir(), { recursive: true });
    const stage = `${stateFileOf(site)}.${site.pid}.stage`;
    fs.writeFileSync(stage, JSON.stringify(ledger));
    fs.renameSync(stage, stateFileOf(site));
  });
}

// Метки чужих запусков забираются (и удаляются); пара «канал + отпечаток» считается одной смертью.
function takeForeignMarks(site) {
  const names = attempt(() => fs.readdirSync(marksDirOf(site)), []);
  const foreign = names.filter((entry) => !entry.startsWith(prefixOf(site)));
  return foreign.reduce((fallen, name) => {
    const file = path.join(marksDirOf(site), name);
    const mark = attempt(() => JSON.parse(fs.readFileSync(file, "utf8")), null);
    if (mark?.channel && mark?.stamp) fallen.set(`${mark.channel}\n${mark.stamp}`, mark.channel);
    attempt(() => fs.rmSync(file, { force: true }));
    return fallen;
  }, new Map());
}

function prepareMarksFolder(site, folder) {
  if (site.folderReady) return;
  fs.mkdirSync(folder, { recursive: true });
  site.folderReady = true;
}

// Возвращает функцию, снимающую метку; если метку записать не вышло — пустую.
function putMark(site, channel, stamp) {
  const folder = marksDirOf(site);
  site.serial += 1;
  const written = attempt(() => {
    prepareMarksFolder(site, folder);
    const file = path.join(folder, `${prefixOf(site)}${site.serial}.json`);
    fs.writeFileSync(file, JSON.stringify({ channel, stamp, at: Date.now() }));
    return file;
  }, null);
  if (written === null) {
    site.folderReady = false;
    return noop;
  }
  return () => attempt(() => fs.rmSync(written, { force: true }));
}

function dropOwnMarks(site) {
  attempt(() => {
    const folder = marksDirOf(site);
    const own = fs.readdirSync(folder).filter((name) => name.startsWith(prefixOf(site)));
    for (const name of own) fs.rmSync(path.join(folder, name), { force: true });
  });
}

// Загрузка счёта в два приёма: сначала книга (её сразу запоминает охранник), потом разбор меток и запись.
function openLedger(site, version) {
  const release = String(version?.() || "");
  const saved = readLedger(site);
  return { release, saved, ledger: restoreLedger(saved, release) };
}

function settleLedger(site, boot, log) {
  const { release, saved, ledger } = boot;
  const fallen = takeForeignMarks(site);
  for (const [key, channel] of fallen) {
    const count = addStrike(ledger, key);
    log({ level: "warn", source: "ipc-guard", message: deathNotice(channel, count) });
  }
  if (fallen.size > 0 || saved?.version !== release) writeLedger(site, ledger);
}

export function createIpcCrashGuard(options = {}) {
  const { dir, version } = options;
  const log = options.log === undefined ? () => {} : options.log;
  const pid = options.pid === undefined ? process.pid : options.pid;
  const site = { dir, pid, folderReady: false, serial: 0 };
  const recall = stampMemory();
  let ledger = null;

  async function guardedCall(channel, handler, event, args) {
    const root = rootOf(args[0]);
    if (root === null) return handler(event, ...args);
    if (ledger === null) {
      const boot = openLedger(site, version);
      ledger = boot.ledger;
      settleLedger(site, boot, log);
    }
    const stamp = fingerprintOf(recall, root);
    if (strikesOf(ledger, `${channel}\n${stamp}`) >= CRASH_STRIKES_LIMIT) throw crashRefusal();
    const lift = putMark(site, channel, stamp);
    try {
      return await handler(event, ...args);
    } finally {
      lift();
    }
  }

  return {
    wrap: (channel, handler) => async (event, ...args) => guardedCall(channel, handler, event, args),
    stop: () => {
      dropOwnMarks(site);
    },
  };
}

export const createDesktopIpcCrashGuard = (app) => {
  const dir = () => app.getPath("userData");
  const version = () => versions.releaseVersionFor(app.getPath("exe"), app.getVersion());
  const log = (entry) => logging.appLog.record(entry);
  return createIpcCrashGuard({ dir, version, log });
};
