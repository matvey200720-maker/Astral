import { AsyncLocalStorage } from "node:async_hooks";

/*
 * Память одной операции — чтобы чтение стопки точек отката не повторялось, пока она идёт.
 *
 * Один «Список установленного», «План снятия» или перебазирование основы спрашивали стопку точек (`readRestorePoints`,
 * `engineHistory`) пять и больше раз подряд, и каждый раз — заново: папка точек, `restore.json` каждой, `access` её копии
 * архива и `manifest.json` патча. Замер на стенде установки (24.10.2026): 124 разбора стопки и около 10 800 обращений к диску
 * на один сценарий из шести вещей и трёх раундов снятия; на слабом диске это секунды ожидания у человека.
 *
 * Правило узкое, чтобы не отдать устаревшее:
 *   — память есть только внутри `inOperation(...)`; вне операции каждое чтение идёт на диск, как раньше;
 *   — любая запись в хранилище точек зовёт `invalidateOperation()`: всё, что операции успели запомнить, устарело, и следующее
 *     чтение идёт на диск снова (счётчик общий на процесс, поэтому запись в одной операции сбрасывает память всех идущих);
 *   — вложенная операция — часть внешней, у неё общая память;
 *   — каждый получает свою копию ответа: вызывающий вправе менять то, что получил.
 * Что не отслеживается: записи другим процессом (нативный хост) и руками. Операции с памятью — чтения (список, план, перебазирование),
 * внутри которых хост не зовётся, а перед следующей операцией память пуста.
 */

const scopes = new AsyncLocalStorage();
let generation = 0;

/** Выполнить `task` как одну операцию: повторные одинаковые чтения внутри берутся из памяти. */
export function inOperation(task) {
  return scopes.getStore() ? task() : scopes.run({ memo: new Map() }, task);
}

/** В хранилище точек записали (или это могло случиться): память операций устарела. */
export function invalidateOperation() {
  generation += 1;
}

/** Обернуть запись в хранилище: когда она закончилась (удачно или нет), память операций устарела. */
export function writesStore(write) {
  return async function writing(...args) {
    try {
      return await write.apply(this, args);
    } finally {
      invalidateOperation();
    }
  };
}

const copy = (value) => {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
};

/**
 * `read()` под ключом `key`: вне операции — просто `read()`; внутри — один раз на ключ, пока в хранилище ничего не записано.
 * Одновременные чтения одного ключа делят один разбор. Отказ чтения в память не попадает.
 */
export function operationMemo(key, read) {
  const scope = scopes.getStore();
  if (!scope) return read();
  const hit = scope.memo.get(key);
  if (hit && hit.generation === generation) return hit.value.then(copy);
  const entry = { generation, value: Promise.resolve().then(read) };
  scope.memo.set(key, entry);
  entry.value.catch(() => {
    if (scope.memo.get(key) === entry) scope.memo.delete(key);
  });
  return entry.value.then(copy);
}
