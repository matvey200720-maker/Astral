// apps/desktop/src/engine-file-check.js
// Проверка при запуске: лежит ли в поставке `astral-engine.exe` (22.11.2026). Без него 30 из 85 команд мастерской и установки не
// имеют запасного пути, и первый же отказ у человека выглядит как «ничего не работает». Чаще всего файл убирает антивирусная
// программа (неподписанный exe). Проверка только читает: нет файла — одна запись в журнал, чтобы по тикету причина была видна сразу.

import path from "node:path";
import { RUST_ENGINE_NAME, resolveRustExecutable, rustEngineEnabled } from "./native-engine-rust.js";

export function checkEngineFile({
  packaged,
  resourcesPath,
  projectRoot,
  log = () => {},
  resolve = resolveRustExecutable,
  enabled = rustEngineEnabled,
} = {}) {
  /* Дерево разработчика собирает движок отдельно, а выключенный движок не нужен: проверять нечего. */
  if (!packaged || !enabled()) return { checked: false, present: null };
  const found = resolve({ packaged, resourcesPath, projectRoot });
  if (found) return { checked: true, present: true, file: found };
  try {
    log({
      level: "error",
      source: "engine",
      message: `Движок ${RUST_ENGINE_NAME} не найден в поставке: функции мастерской и установки, которым он нужен, откажут. Чаще всего файл убирает антивирусная программа`,
      detail: `искали: ${path.join(String(resourcesPath || ""), "native", RUST_ENGINE_NAME)}`,
    });
  } catch {
    // журнал не должен мешать запуску
  }
  return { checked: true, present: false };
}
