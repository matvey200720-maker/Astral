// Предохранитель от цикла падений Rust-движка: два страйка на паре «команда + отпечаток файлов игры»
// блокируют команду, успех той же пары снимает счёт.
import { appLog } from "./app-log.js";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { releaseVersionFor } from "./updates/display-version.js";

export const ENGINE_CRASHED_CODE = "ENGINE_CRASHED";
export const ENGINE_CRASH_STRIKES = 2;

const STRIKES_FILE = "engine-crash-strikes.json";
const LOG_ERROR_LIMIT = 300;
const REFUSAL_TEXT =
  "Это действие дважды обрывало движок Astral на файлах вашей игры, поэтому сейчас Astral его не выполняет. " +
  "Обычно так бывает с редуксом, который меняет эти файлы. " +
  "Astral попробует снова, когда файлы игры изменятся или Astral обновится.";

export function engineCrashedMessage() {
  return REFUSAL_TEXT;
}

export function engineCrashedError(command) {
  return Object.assign(new Error(engineCrashedMessage()), { code: ENGINE_CRASHED_CODE, command });
}

const isRecord = (value) => typeof value === "object" && value !== null;

export function isEngineCrash(error) {
  if (!isRecord(error)) return false;
  return error.engineCrash === true || (error.code === "ENGINE_STOPPED" && error.reason === "exit");
}

// «размер:время правки» либо «-», если файла нет или он не читается.
function fileMark(target) {
  try {
    const stats = statSync(target);
    return [stats.size, Math.round(stats.mtimeMs)].join(":");
  } catch {
    return "-";
  }
}

// Первое непустое строковое поле из списка (остальные не читаются).
function firstText(record, fields) {
  for (const field of fields) {
    const value = record[field];
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text;
  }
  return "";
}

// Откуда берётся отпечаток: поля входа по приоритету и файл, у которого снимается «размер:время».
const STAMP_SOURCES = [
  { fields: ["gameRoot"], markedFile: (root) => join(root, "update", "update.rpf") },
  { fields: ["archive", "archivePath"], markedFile: (archive) => archive },
];

export function engineFilesStamp(input) {
  const record = isRecord(input) ? input : {};
  for (const { fields, markedFile } of STAMP_SOURCES) {
    const given = firstText(record, fields);
    if (!given) continue;
    const absolute = resolve(given);
    return `${absolute.toLowerCase()}|${fileMark(markedFile(absolute))}`;
  }
  return "";
}

const strikeKey = (command, stamp) => `${command}\n${stamp}`;

function describeStrike(command, count, error) {
  const head = `Движок упал посреди «${command}» (${count} из ${ENGINE_CRASH_STRIKES} на этих файлах игры)`;
  const lockNote =
    count >= ENGINE_CRASH_STRIKES
      ? ": дальше эта команда не запускается, пока файлы игры или Astral не сменятся"
      : "";
  const reason = String(error?.message || "").slice(0, LOG_ERROR_LIMIT);
  return `${head}${lockNote}. ${reason}`;
}

const isUsableLedger = (candidate, wanted) =>
  isRecord(candidate) && candidate.version === wanted && isRecord(candidate.strikes);

// Журнал счёта: память на текущую версию + файл в папке данных. Имена `dir`, `version` и `pid` нужны
// как есть: по ним читаются тексты платформенных ошибок.
function openStrikeBook(dir, version, pid) {
  let memory = null;

  function loadFor(wanted) {
    let stored;
    try {
      stored = JSON.parse(readFileSync(join(dir(), STRIKES_FILE), "utf8"));
    } catch {
      stored = null;
    }
    return isUsableLedger(stored, wanted) ? stored : { version: wanted, strikes: {} };
  }

  // Память заполняется заново только при смене версии.
  function current() {
    const wanted = String(version?.() || "");
    if (memory === null || memory.version !== wanted) memory = loadFor(wanted);
    return memory;
  }

  // Каждое обращение к папке данных при записи вычисляется на месте; сбой записи глотается.
  function persist() {
    try {
      mkdirSync(dir(), { recursive: true });
      const staging = `${join(dir(), STRIKES_FILE)}.${pid}.stage`;
      writeFileSync(staging, JSON.stringify(memory));
      renameSync(staging, join(dir(), STRIKES_FILE));
    } catch {
      // счёт остаётся только в памяти этого запуска
    }
  }

  return {
    tally(command, stamp) {
      return current().strikes[strikeKey(command, stamp)] || 0;
    },
    record(command, stamp) {
      const { strikes } = current();
      const key = strikeKey(command, stamp);
      const count = (strikes[key] || 0) + 1;
      strikes[key] = count;
      persist();
      return count;
    },
    forgive(command, stamp) {
      const { strikes } = current();
      const key = strikeKey(command, stamp);
      if (!strikes[key]) return;
      delete strikes[key];
      persist();
    },
  };
}

export function createEngineCrashGuard({ dir, version, pid = process.pid, log = () => {} } = {}) {
  const book = openStrikeBook(dir, version, pid);

  function blocked(command, stamp) {
    if (!stamp) return false;
    return book.tally(command, stamp) >= ENGINE_CRASH_STRIKES;
  }

  function struck(command, stamp, error) {
    if (!stamp) return 0;
    const count = book.record(command, stamp);
    log({ level: "warn", source: "engine-guard", message: describeStrike(command, count, error) });
    return count;
  }

  function cleared(command, stamp) {
    if (!stamp) return;
    book.forgive(command, stamp);
  }

  return { blocked, struck, cleared };
}

export function createDesktopEngineCrashGuard(app) {
  function dataFolder() {
    return app.getPath("userData");
  }

  function installedRelease() {
    return releaseVersionFor(app.getPath("exe"), app.getVersion());
  }

  function journal(entry) {
    return appLog.record(entry);
  }

  return createEngineCrashGuard({ dir: dataFolder, version: installedRelease, log: journal });
}
