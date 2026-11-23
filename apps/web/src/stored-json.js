/*
 * Разбор больших записей хранилища окна без повторов (31.10.2026, настоящее окно владельца, beta.83).
 *
 * Запись неба и проекты мастерской весят 1,1–1,3 МБ, а библиотека читает их на каждую плитку: разбор заново и сборка мусора после
 * него занимали больше времени, чем сама страница. Пока строка та же, ответ тот же. Ответ общий: править его нельзя. Кто правит
 * запись и пишет её обратно, разбирает свою копию обычным `JSON.parse`.
 */

const LARGE = 16 * 1024;
const answers = new WeakMap();
const nameCache = { text: null, name: "" };

export function readStoredJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    if (raw.length < LARGE) return JSON.parse(raw);
    let known = answers.get(storage);
    if (!known) {
      known = new Map();
      answers.set(storage, known);
    }
    const entry = known.get(key);
    if (entry && entry.raw === raw) return entry.value;
    const value = JSON.parse(raw);
    known.set(key, { raw, value });
    return value;
  } catch {
    return null;
  }
}

/** Имя из снимка работы: `{ name }` снимка неба — внутри мегабайта; строка та же — не разбираем. */
export function storedStateName(text) {
  if (text === nameCache.text) return nameCache.name;
  let name = "";
  try {
    const state = JSON.parse(text || "null");
    name = typeof state?.name === "string" ? state.name : "";
  } catch {
    name = "";
  }
  nameCache.text = text;
  nameCache.name = name;
  return name;
}
