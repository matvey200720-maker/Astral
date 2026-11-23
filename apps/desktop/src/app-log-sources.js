import fs from "node:fs";
import * as nativeEngine from "./native-engine.js";
import * as appLog from "./app-log.js";

import path from "node:path";
import { newestMajesticClientLog, newestRageMpLog } from "./game-crash/client-logs.js";
import { scrubGameText } from "./game-crash/scrub.js";

/*
 * Правила для Windows (ТЗ 11.11.2026, «Журнал падений игры»): хвосты журналов клиентов уходят в выгрузку для тикета —
 * чтобы поддержка видела, что писал клиент перед падением. Только чтение, предел байт — общий (`sourceBytes`), текст
 * проходит общую вычистку журнала и ещё `scrubGameText` (куки, ключи, адреса). Отчёт о самих падениях — отдельный
 * источник `game-crashes` (`game-crash/index.js`), в событиях журнала они стоят записями `kind: "game-crash"`.
 */
const underAppData = (env, ...parts) => (env.APPDATA ? path.join(env.APPDATA, ...parts) : "");
const underLocal = (env, ...parts) => (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, ...parts) : "");

export const WINDOWS_LOCATORS = Object.freeze([
  { id: "majestic-client", label: "Журнал клиента Majestic (последний запуск игры)", scrub: true, locate: ({ env }) => newestMajesticClientLog({ env }) },
  { id: "majestic-launcher", label: "Журнал лаунчера Majestic", scrub: true, locate: ({ env }) => underAppData(env, "majestic-launcher", "logs", "main.log") },
  { id: "ragemp-client", label: "Журнал RAGE MP (GTA 5 RP)", scrub: true, locate: ({ env }) => newestRageMpLog({ env }) },
  { id: "rockstar-launcher", label: "Rockstar Games Launcher (stub.log)", scrub: true, locate: ({ env }) => underLocal(env, "Rockstar Games", "Launcher", "stub.log") },
]);

// Последний кусок файла: сколько байт взять и с какой позиции.
function tailWindow(limit, size) {
  const count = Math.min(limit, size);
  return { count, from: size - count };
}

// Последние байты файла: размер, выделение буфера под них, чтение с нужной позиции. Буфер не обрезается по bytesRead.
async function pullTail(handle, limit) {
  const { size } = await handle.stat();
  const { count, from } = tailWindow(limit, size);
  const target = Buffer.alloc(count);
  const request = [target, 0, count, from];
  await handle.read(...request);
  return target.toString("utf8");
}

const ignoreFailure = () => {};

// Читает хвост и закрывает дескриптор при любом исходе.
async function pullAndClose(handle, limit) {
  try {
    return await pullTail(handle, limit);
  } finally {
    await handle?.close().catch(ignoreFailure);
  }
}

// Открывает файл и читает хвост; отказ на любом шаге возвращается как значение.
async function readOpened(fsImpl, file, limit) {
  try {
    const handle = await fsImpl.open(file, "r");
    return { text: await pullAndClose(handle, limit) };
  } catch (failure) {
    return { failure };
  }
}

export async function readTail(file, options = {}) {
  const limit = options.bytes === undefined ? appLog.APP_LOG_LIMITS.sourceBytes : options.bytes;
  const fsImpl = options.fsImpl === undefined ? fs.promises : options.fsImpl;
  const outcome = await readOpened(fsImpl, file, limit);
  if (!("failure" in outcome)) return outcome.text;
  if (outcome.failure?.code === "ENOENT") return "";
  throw outcome.failure;
}

// async нужен, чтобы сбой locate стал отказом; сам locate вызывается синхронно.
async function readLocated(locator, env, fsImpl) {
  return Promise.resolve(locator.locate({ env }))
    .then((file) => (file ? readTail(file, { fsImpl }) : ""))
    .then((text) => (locator.scrub ? scrubGameText(text, { limit: appLog.APP_LOG_LIMITS.sourceBytes * 2 }) : text));
}

function sourceFor(locator, env, fsImpl) {
  const read = () => readLocated(locator, env, fsImpl);
  const { id, label } = locator;
  return { id, label, read };
}

export function sourcesFromLocators(locators, options = {}) {
  const env = options.env === undefined ? process.env : options.env;
  const fsImpl = options.fsImpl === undefined ? fs.promises : options.fsImpl;
  return locators.map((locator) => sourceFor(locator, env, fsImpl));
}

const hostRule = () => ({
  id: "native-host",
  label: "Журнал нативного хоста (установка)",
  locate() {
    return nativeEngine.hostLogPath();
  },
});

export function defaultLogSources(options = {}) {
  const rules = [hostRule()];
  if (process.platform === "win32") rules.push(...WINDOWS_LOCATORS);
  return sourcesFromLocators(rules, options);
}
