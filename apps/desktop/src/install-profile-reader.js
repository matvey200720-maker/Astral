/*
 * Профиль установок для окна — без остановки главного процесса
 * (ТЗ 06.10.2026, вечер, задача 1).
 *
 * Окно спрашивает профиль часто: при запуске пачкой из шести–десяти
 * запросов, после каждой установки, при смене игры. Раньше каждый запрос
 * дважды разбирал весь файл состояния движка в главном потоке (сначала —
 * восстановление транзакций, потом — чтение), и пока файл весил 48–214 МБ,
 * каждый разбор шёл секунды. Главный поток не отвечал окну, Windows
 * записывала `AppHangB1` и закрывала Astral — это и был «вылет».
 *
 * Теперь:
 *  • файл разбирается в потоке-работнике (`install-profile-worker.js`),
 *    наружу приходят только записи установок — килобайты;
 *  • готовый профиль помнится по отпечатку файла (время записи и размер):
 *    пока движок ничего не записал, ответ — из памяти, без чтения файла;
 *  • одновременные запросы ждут один и тот же разбор;
 *  • окно больше не запускает восстановление транзакций: его делают
 *    мутации движка (в своей очереди) и запуск приложения.
 *
 * Поток не поднялся (нет `worker_threads`, сборка без файла работника) —
 * разбор идёт в главном процессе тем же кодом: медленнее, но верно.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { trackedWorker } from "./worker-census.js";
import { windowProfileFromState } from "./install-profile-shape.js";

const WORKER_URL = new URL("./install-profile-worker.js", import.meta.url);

/** Разбор файла в потоке-работнике; при отказе потока — здесь же. */
export function readProfileInWorker(file, { workerUrl = WORKER_URL } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const inline = async () => {
      if (settled) return;
      settled = true;
      try {
        resolve(windowProfileFromState(JSON.parse(await fs.readFile(file, "utf8"))));
      } catch {
        resolve(windowProfileFromState(null));
      }
    };
    let worker;
    try {
      worker = trackedWorker("install-profile", workerUrl, { workerData: { file } });
    } catch {
      void inline();
      return;
    }
    worker.once("message", (profile) => {
      if (settled) return;
      settled = true;
      resolve(profile);
      void worker.terminate().catch(() => {});
    });
    worker.once("error", () => void inline());
    worker.once("exit", (code) => {
      if (code !== 0) void inline();
    });
  });
}

/**
 * Читатель с памятью: `read(stateDir)` → профиль окна (без установок
 * настроек игры — их добавляет `consolidatedProfile`).
 */
export function createInstallProfileReader({ parse = readProfileInWorker, stat = fs.stat } = {}) {
  let cached = null;
  let pending = null;
  return async function read(stateDir) {
    const file = path.join(path.resolve(String(stateDir || "")), "install-state.json");
    const info = await stat(file).catch(() => null);
    const key = info ? `${file}|${info.mtimeMs}|${info.size}` : `${file}|missing`;
    if (cached?.key === key) return cached.profile;
    if (pending?.key === key) return pending.promise;
    const promise = (info ? parse(file) : Promise.resolve(windowProfileFromState(null))).then((profile) => {
      cached = { key, profile };
      return profile;
    });
    pending = { key, promise };
    promise.finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    return promise;
  };
}
