import { factoryProjectIsMod, parseFactoryProject } from "@modovik/climb-contract/recolor/factory";

const MARK_KEY = "astral.factory.start.v2";
export const FACTORY_STORAGE_KEY = "astral.factory.project.v1";

// Хранилище окна; если его нет или доступ запрещён, хранилища нет.
const pageStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

// Перенос однократный: отметка ставится при первом же вызове, даже если
// черновика нет. Истина, только если отметки не было и теперь она есть.
function claimMark(storage) {
  const seen = Boolean(storage.getItem(MARK_KEY));
  if (!seen) storage.setItem(MARK_KEY, "1");
  return !seen;
}

// Серый безымянный проект «как в моде» — след старого начала, а не выбор человека.
const isOldStartTrace = (project) => factoryProjectIsMod(project) && !project.name;

function dropOldStartTrace(storage) {
  const raw = storage.getItem(FACTORY_STORAGE_KEY);
  const trace = Boolean(raw) && isOldStartTrace(parseFactoryProject(raw));
  if (trace) storage.removeItem(FACTORY_STORAGE_KEY);
  return trace;
}

// Хранилище без методов (null, 0, объект) даёт TypeError, а он здесь тоже «нет»
export function carryFactoryDraft(storage = pageStorage()) {
  try {
    return claimMark(storage) && dropOldStartTrace(storage);
  } catch {
    return false;
  }
}
