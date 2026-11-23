// Название сборки лаунчера, которое окно запомнило в прошлый раз.
// Хранится только в localStorage и читается заново при каждом вызове.

/** Читает имя сборки; нет хранилища, чтение бросило или записи нет — пустая строка. */
export function currentBuild() {
  return guarded((box) => box.getItem(STORAGE_KEY), "") || "";
}

/** Называет сборку. Пустое имя ничего не меняет, то же имя не перезаписывается. */
export function noteBuild(id) {
  const name = id ? String(id) : "";
  if (name === "" || name === currentBuild()) return;
  guarded((box) => box.setItem(STORAGE_KEY, name));
}

// Любой отказ хранилища (его нет, бросает обращение, чтение или запись) не выходит наружу.
function guarded(action, fallback) {
  try {
    return action(globalThis.localStorage);
  } catch {
    return fallback;
  }
}

const STORAGE_KEY = "astral.downloads.build.v1";
