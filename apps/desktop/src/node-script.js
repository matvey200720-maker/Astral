/*
 * Запуск node-скрипта репозитория из приложения.
 *
 * Рендер превью живёт скриптами (`render-glb-preview.js`, `render-sky-preview.js`):
 * так их можно гонять и из консоли, и из тестов, и из окна публикации. Но
 * внутри Electron `process.execPath` — это сам Electron, а не node, и обычный
 * `node script.js` там нечем выполнить. `ELECTRON_RUN_AS_NODE` заставляет тот
 * же исполняемый файл вести себя как node — без второго рантайма на машине.
 *
 * Переменная не должна протекать дальше: скрипт превью сам поднимает
 * скрытое окно Electron, и унаследованный `ELECTRON_RUN_AS_NODE` превратил бы
 * его в ещё один node без окна. Скрипты снимают её у своих потомков.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function runNodeScript(
  script,
  args = [],
  { cwd, timeout = 10 * 60 * 1000, env = {} } = {},
) {
  const underElectron = Boolean(process.versions?.electron);
  return execFileAsync(process.execPath, [script, ...args], {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      ...(underElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      ...env,
    },
  });
}
