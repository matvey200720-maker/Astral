// Общая шина спячки окна. Владельцы ресурсов записываются в реестр под своим именем с набором
// { sleep, wake, busy }; спячка обходит реестр, ничего не зная о каждом владельце.
// Реестр один на процесс: модуль существует в единственном экземпляре, а экспорты — тонкие привязки к нему.

// Выполняет действие и сообщает, обошлось ли без исключения (обещание ожидается).
async function completes(action) {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

// Вызывает действие, поглощая любое исключение.
function shielded(action) {
  try {
    action();
  } catch {
    // сбой одного слушателя не мешает остальным
  }
}

// Строка-причина занятости владельца либо null; сбой опроса означает «не занят».
function busyReason(hook) {
  try {
    const reason = hook.busy?.();
    return reason ? String(reason) : null;
  } catch {
    return null;
  }
}

class HibernationRegistry {
  #owners = new Map();
  #listeners = new Set();
  #asleep = false;

  get asleep() {
    return this.#asleep;
  }

  // Повторное имя заменяет владельца на прежнем месте. Отписка снимает запись, только пока
  // под именем лежит тот самый набор, что был передан.
  enlist(name, hook) {
    const key = String(name);
    this.#owners.set(key, hook || {});
    return () => {
      if (this.#owners.get(key) === hook) this.#owners.delete(key);
    };
  }

  // Array.from тянет итератор по шагу, поэтому владельцы, заведённые во время опроса, тоже попадают в него.
  busyOwners() {
    const polled = Array.from(this.#owners, ([name, hook]) => ({ name, reason: busyReason(hook) }));
    return polled.filter(({ reason }) => reason !== null);
  }

  // Строго по очереди: каждый владелец дожидается завершения предыдущего. Нет метода — пропуск,
  // метод не функция или сбой — имя владельца попадает в ответ.
  async sweep(method) {
    const failed = [];
    for (const [name, hook] of this.#owners) {
      if (!(await completes(() => hook[method]?.()))) failed.push(name);
    }
    return failed;
  }

  // Признак меняется синхронно, до вызова первого владельца.
  async fallAsleep() {
    this.#asleep = true;
    return this.sweep("sleep");
  }

  async wakeUp() {
    this.#asleep = false;
    return this.sweep("wake");
  }

  listen(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Set.forEach обходит набор вживую: подписанные по ходу рассылки вызываются в ней же, снятые — нет.
  announce(source) {
    this.#listeners.forEach((listener) => shielded(() => listener(source)));
  }

  reset() {
    this.#owners.clear();
    this.#listeners.clear();
    this.#asleep = false;
  }
}

const registry = new HibernationRegistry();

export const onHibernate = (name, hook) => registry.enlist(name, hook);
export const hibernating = () => registry.asleep;
export const hibernationBusy = () => registry.busyOwners();
export const runSleepHooks = () => registry.fallAsleep();
export const runWakeHooks = () => registry.wakeUp();
export const noteGameRunning = (source = "") => registry.announce(source);
export const onGameRunning = (listener) => registry.listen(listener);
export const resetHibernationHooks = () => registry.reset();
