/*
 * Канал разметки выделения (ТЗ владельца 26.10.2026, раздел D): окно присылает запись сцены `{ url, bytes, sha256, version }`, главный процесс
 * отдаёт тело `.selmap` — из кэша на диске или с CDN (`selection-markup/load.js`). Путь выбирает главный процесс, окно путей не называет.
 */

import path from "node:path";
import { loadSelectionMarkup } from "./selection-markup/load.js";

export function registerSelectionMarkupIpc({ IPC, handleIpc, trusted, safeInput, installOptions, catalogPackages = null }) {
  handleIpc(IPC.WORKSHOP_SELECTION_MARKUP, (event, input) =>
    trusted(event, async () => {
      const trust = catalogPackages ? catalogPackages() : { allowedHosts: [], allowInsecureLocalhost: false };
      const { stateDir } = await installOptions();
      const { body, source, sha256 } = await loadSelectionMarkup(safeInput(input), {
        cacheDir: path.join(stateDir, "selection-markup"),
        allowedHosts: trust.allowedHosts,
        allowInsecureLocalhost: trust.allowInsecureLocalhost,
      });
      return { body, source, sha256 };
    }),
  );
}
