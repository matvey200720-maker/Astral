import path from "node:path";
import { mountWebInterface } from "./web-interface.js";

/*
 * Интерфейс окна — из папки или (бета-сборка) из памяти: `web-interface.js`. Токен запуска (`accessToken`), с которым выдаётся интерфейс из памяти,
 * требуется и у `/api/*` (`local-guard.js`): выдача сначала передаёт его охране, потом монтирует интерфейс. Вынесено из `server.js` 24.11.2026 (потолок строк).
 * Монтируется там же, где раньше, — после всех маршрутов `/api`.
 */
export function mountGuardedWebInterface(app, localGuard, { production }) {
  const mountedWebInterface = mountWebInterface(app, {
    webRoot: process.env.MODOVIK_WEB_ROOT
      ? path.resolve(process.env.MODOVIK_WEB_ROOT)
      : null,
    production,
  });
  return (files, options = {}) => {
    localGuard.useShellKey(options?.accessToken);
    return mountedWebInterface(files, options);
  };
}
