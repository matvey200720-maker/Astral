/*
 * Поток-работник профиля установок для окна (`install-profile-reader.js`).
 *
 * Файл состояния движка — десятки мегабайт JSON. Его разбор в главном
 * процессе останавливал окно: не отвечали кнопки, перетаскивание, отрисовка,
 * а Windows записывала «electron.exe перестал взаимодействовать» и закрывала
 * окно (`AppHangB1`, 04–06.10.2026). Здесь файл читается и разбирается в своём
 * потоке, а наружу уходят только записи установок без описей — килобайты.
 */

import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { windowProfileFromState } from "./install-profile-shape.js";

async function read(file) {
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    parsed = null;
  }
  return windowProfileFromState(parsed);
}

parentPort.postMessage(await read(workerData.file));
