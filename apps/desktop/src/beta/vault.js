import path from "node:path";
import fs from "node:fs/promises";

const OPEN_FLAG = "w";
const FILE_MODE = 0o600;

// Выполняет действие и не считает отказом любой его сбой, синхронный или асинхронный.
async function tolerate(action) {
  try {
    await action();
  } catch {
    // сбой не мешает
  }
}

// Шифрует значение для записи; недоступность хранилища важнее ошибки значения.
function seal(safeStorage, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable.");
  const text = JSON.stringify(value);
  return safeStorage.encryptString(text);
}

// Проверки прочитанного по порядку: первая, что вернёт вердикт, решает, остальные не вызываются.
function checkContent(safeStorage, trial) {
  return trial.bytes?.length ? undefined : { status: "corrupt" };
}

function checkAvailable(safeStorage) {
  return safeStorage.isEncryptionAvailable() ? undefined : { status: "unavailable" };
}

function decipher(safeStorage, trial) {
  try {
    trial.text = safeStorage.decryptString(trial.bytes);
  } catch (error) {
    return { status: "undecryptable", error };
  }
  return undefined;
}

function parseJson(safeStorage, trial) {
  try {
    return { status: "found", value: JSON.parse(trial.text) };
  } catch {
    return { status: "corrupt" };
  }
}

const VERDICT_CHAIN = [checkContent, checkAvailable, decipher, parseJson];

function classify(safeStorage, bytes) {
  const trial = { bytes };
  let verdict;
  for (const check of VERDICT_CHAIN) {
    verdict = check(safeStorage, trial);
    if (verdict) break;
  }
  return verdict;
}

// Байты файла либо вердикт о том, почему их нет: файла нет или он не читается.
async function fetchBytes(fsImpl, file) {
  try {
    return { bytes: await fsImpl.readFile(file) };
  } catch (error) {
    const missing = error?.code === "ENOENT";
    return { verdict: missing ? { status: "none" } : { status: "unreadable", error } };
  }
}

// Данные во временный файл и sync. Сбой sync терпим, сбой записи — нет.
async function fillTemp(handle, sealed) {
  await handle.writeFile(sealed);
  await tolerate(() => handle.sync());
}

// Временный файл: открыть, наполнить, закрыть в любом случае, переименовать.
async function installViaTemp(fsImpl, temp, file, sealed) {
  const handle = await fsImpl.open(temp, OPEN_FLAG, FILE_MODE);
  await fillTemp(handle, sealed).finally(() => handle.close());
  await fsImpl.rename(temp, file);
}

const ignore = () => undefined;

// Убирает временный файл; отказ уборки молчит, прежняя ошибка остаётся главной.
function discard(fsImpl, temp) {
  const removal = { force: true };
  return fsImpl.rm(temp, removal).catch(ignore);
}

export function createVault(options) {
  const { file, safeStorage } = options;
  const fsImpl = options.fsImpl === undefined ? fs : options.fsImpl;

  return {
    async read() {
      const fetched = await fetchBytes(fsImpl, file);
      return fetched.verdict ?? classify(safeStorage, fetched.bytes);
    },
    async write(value) {
      const sealed = seal(safeStorage, value);
      await fsImpl.mkdir(path.dirname(file), { recursive: true });
      const temp = [file, process.pid, "tmp"].join(".");
      await installViaTemp(fsImpl, temp, file, sealed).catch(async (error) => {
        await discard(fsImpl, temp);
        throw error;
      });
    },
    async remove() {
      const removal = { force: true };
      await tolerate(() => fsImpl.rm(file, removal));
    },
    file,
  };
}
