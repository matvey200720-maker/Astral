/*
 * Поток-работник журнала падений: читает файл состояния движка (десятки мегабайт JSON) и отдаёт только индекс
 * установленных модов с совпадениями по именам файлов (`suspects.js`). Главный процесс файл не разбирает.
 */
import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { indexInstalled } from "./suspects.js";

async function read({ file, wanted }) {
  try {
    return indexInstalled(JSON.parse(await fs.readFile(file, "utf8")), wanted);
  } catch {
    return { mods: [], total: 0, unreadable: true };
  }
}

parentPort.postMessage(await read(workerData));
