import path from "node:path";
import fs from "node:fs/promises";

export const WRITE_RETRY_MS = Object.freeze([60, 150, 400, 1000]);
export const CREDENTIAL_FILE = "cloud-credentials.bin";

const DESCRIBE_LIMIT = 240;

const NOTE = Object.freeze(Object.fromEntries([
  ["emptyFile", "файл учётки пустой (запись оборвалась)"],
  ["noKeystore", "хранилище ключей системы недоступно (safeStorage)"],
  ["broken", "Сохранённый вход в Astral повреждён — войдите снова."],
  ["unreadable", "Вход в Astral сейчас не читается с диска — Astral повторит сам."],
  ["writeDetail", "Окно работает с учёткой из памяти, запись повторится при следующем обращении. "
    + "Если закрыть Astral до этого, понадобится новый вход."],
]));

const noop = () => {};

const orDefault = (value, fallback) => (value === undefined ? fallback : value);

// Пауза по умолчанию: глобальный setTimeout читается в момент вызова.
function pause(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

export function vaultFailure(kind, message, cause) {
  const failure = new Error(message, cause ? { cause } : undefined);
  failure.kind = kind;
  return failure;
}

export function describeError(error) {
  const prefix = error?.code ? `${error.code}: ` : "";
  const text = String(error?.message || error || "");
  const words = (prefix + text).split(/\s+/).filter(Boolean);
  return words.join(" ").slice(0, DESCRIBE_LIMIT);
}

// ---- внутренние операции над состоянием хранилища (session) ----

function emit(session, entry) {
  const { log } = session;
  log(entry);
}

function noteErased(session, level, why) {
  emit(session, { level, message: `сессия: учётка стёрта — ${why}` });
}

function enqueue(session, task) {
  const outcome = session.tail.then(task, task);
  session.tail = outcome.then(noop, noop);
  return outcome;
}

function unseal(safeStorage, encrypted) {
  try {
    return { state: JSON.parse(safeStorage.decryptString(encrypted)) };
  } catch (error) {
    return { error };
  }
}

// Вердикт по содержимому файла; inspect зовётся вне защиты.
function judge(session, encrypted) {
  const { safeStorage, inspect } = session;
  const refuse = (status, reason) => ({ status, reason });
  if (!encrypted?.length) {
    return refuse("broken", NOTE.emptyFile);
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return refuse("unreadable", NOTE.noKeystore);
  }
  const opened = unseal(safeStorage, encrypted);
  if ("error" in opened) {
    return refuse("broken", `расшифровка не удалась: ${describeError(opened.error)}`);
  }
  const problem = inspect(opened.state);
  if (problem) {
    return refuse("broken", problem);
  }
  return { status: "found", state: opened.state };
}

async function readDisk(session) {
  const { file, fsImpl } = session;
  let encrypted;
  try {
    encrypted = await fsImpl.readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "none" };
    }
    return { status: "unreadable", reason: describeError(error) };
  }
  return judge(session, encrypted);
}

// Уборка обрывков рядом с основным файлом; любая ошибка прекращает её молча.
async function sweep(session) {
  const { file, fsImpl } = session;
  try {
    const folder = path.dirname(file);
    const stem = path.basename(file) + ".";
    const isLeftover = (name) => name.startsWith(stem) && name.endsWith(".tmp");
    const names = await fsImpl.readdir(folder);
    for (const name of names) {
      if (isLeftover(name)) {
        const target = path.join(folder, name);
        await fsImpl.rm(target, { force: true });
      }
    }
  } catch {
    // остаток не трогаем
  }
}

async function eraseFile(session) {
  const { file, fsImpl } = session;
  const removal = { force: true, maxRetries: 4, retryDelay: 50 };
  try {
    await fsImpl.rm(file, removal);
  } catch (error) {
    emit(session, { level: "warn", message: `сессия: файл учётки не удалился — ${describeError(error)}` });
  }
  await sweep(session);
}

function seal(safeStorage, value) {
  const available = safeStorage.isEncryptionAvailable();
  if (!available) {
    throw new Error("Secure credential storage is unavailable.");
  }
  const text = JSON.stringify(value);
  return safeStorage.encryptString(text);
}

// Одна попытка записи: временный файл, затем переименование.
async function writeOnce(session, value) {
  const { file, fsImpl, safeStorage } = session;
  const sealed = seal(safeStorage, value);
  const folder = path.dirname(file);
  await fsImpl.mkdir(folder, { recursive: true });
  const temp = [file, process.pid, "tmp"].join(".");
  try {
    const handle = await fsImpl.open(temp, "w", 0o600);
    try {
      await handle.writeFile(sealed);
      try {
        await handle.sync();
      } catch {
        // fsync не обязателен
      }
    } finally {
      await handle.close();
    }
    await fsImpl.rename(temp, file);
  } catch (error) {
    await fsImpl.rm(temp, { force: true }).catch(noop);
    throw error;
  }
}

// Длина списка пауз читается перед каждой попыткой.
async function persist(session, value) {
  const { retryDelays, wait } = session;
  let lastError = null;
  let attempt = 0;
  while (attempt <= retryDelays.length) {
    try {
      await writeOnce(session, value);
      return;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retryDelays.length) {
      await wait(retryDelays[attempt]);
    }
    attempt += 1;
  }
  throw lastError;
}

export function createCredentialVault(config) {
  const { file, safeStorage, inspect } = config;
  const session = {
    file,
    safeStorage,
    inspect,
    log: orDefault(config.log, noop),
    fsImpl: orDefault(config.fsImpl, fs),
    retryDelays: orDefault(config.retryDelays, WRITE_RETRY_MS),
    wait: orDefault(config.wait, pause),
    memory: null,
    loaded: false,
    deferred: false,
    tail: Promise.resolve(),
  };

  async function forgetNow(reason, flags = {}) {
    const { onlyIfAccess = "" } = flags;
    const held = session.memory;
    if (onlyIfAccess && held && held.access_token !== onlyIfAccess) {
      return false;
    }
    Object.assign(session, { memory: null, loaded: true, deferred: false });
    await eraseFile(session);
    noteErased(session, "info", reason);
    return true;
  }

  function forget(reason, options) {
    return enqueue(session, () => forgetNow(reason, options));
  }

  function snapshot() {
    return session.memory;
  }

  function diagnose() {
    return enqueue(session, () => readDisk(session));
  }

  async function peek() {
    if (session.loaded) {
      return session.memory;
    }
    const disk = await readDisk(session);
    return disk.status === "found" ? disk.state : null;
  }

  async function load() {
    if (!session.loaded) {
      const disk = await readDisk(session);
      switch (disk.status) {
        case "unreadable":
          throw vaultFailure("unreadable", NOTE.unreadable, new Error(disk.reason));
        case "broken":
          await eraseFile(session);
          Object.assign(session, { memory: null, loaded: true });
          noteErased(session, "warn", disk.reason);
          throw vaultFailure("broken", NOTE.broken);
        default:
          Object.assign(session, { memory: disk.status === "found" ? disk.state : null, loaded: true });
          await sweep(session);
      }
    }
    if (session.deferred && session.memory) {
      try {
        await writeOnce(session, session.memory);
        session.deferred = false;
        emit(session, { level: "info", message: "сессия: отложенная запись учётки дошла до диска" });
      } catch {
        // запись догонится при следующем обращении
      }
    }
    return session.memory;
  }

  function exclusive(task) {
    return enqueue(session, task);
  }

  async function store(value) {
    await persist(session, value);
    Object.assign(session, { memory: value, loaded: true, deferred: false });
  }

  async function rotate(value) {
    Object.assign(session, { memory: value, loaded: true });
    try {
      await persist(session, value);
      session.deferred = false;
    } catch (error) {
      session.deferred = true;
      emit(session, {
        level: "error",
        message: `сессия: обновлённая учётка не записалась — ${describeError(error)}`,
        detail: NOTE.writeDetail,
      });
    }
  }

  async function update(change) {
    const latest = await load();
    if (!latest) {
      return null;
    }
    const next = change(latest);
    await rotate(next);
    return next;
  }

  function expireAccess(accessToken) {
    return enqueue(session, async () => {
      const latest = await load();
      if (latest && latest.access_token === accessToken) {
        session.memory = { ...latest, accessExpiresAt: 0 };
      }
    });
  }

  return { exclusive, load, store, rotate, update, expireAccess, forget, forgetNow, snapshot, peek, diagnose };
}
