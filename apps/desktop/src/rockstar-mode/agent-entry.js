/*
 * Вход фонового агента режима Rockstar из `main.js` (05.11.2026): сборка
 * путей и запуск `runRockstarAgent`. Отдельный файл, чтобы `main.js` не рос:
 * в нём на агента — одна строка. Управление отсюда не возвращается: процесс
 * живёт, пока работает канал управления и дозор (`agent.js`).
 */

import { resolveNativeExecutable } from "../native-engine.js";
import { runRockstarAgent } from "./agent.js";

export async function runAgentProcess({ app, projectRoot }) {
  await runRockstarAgent({
    app,
    version: app.getVersion(),
    nativeExecutable: () => {
      try {
        return resolveNativeExecutable({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, projectRoot });
      } catch {
        return null;
      }
    },
  });
  await new Promise(() => {});
}
