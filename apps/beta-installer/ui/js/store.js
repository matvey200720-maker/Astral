// Одно место для состояния окна установщика. Пишут контроллер и события моста,
// рисует view.js. Оповещаем синхронно сразу после правки: склейка правок в одну
// отрисовку — дело view.js (микрозадача), скрытая панель кадров не отдаёт.
// Методы без `this`: контроллер берёт их деструктуризацией.

const derive = (patch, base) => (typeof patch === "function" ? patch(base) : { ...base, ...patch });

export function createStore(initial) {
  const cell = { state: initial };
  const watchers = new Set();

  // Состояние читаем на каждом вызове: при вложенном set подписчики, до которых
  // внешний проход ещё не дошёл, получают самое свежее, а прежнее — своё.
  const announce = (before) => {
    watchers.forEach((watcher) => watcher(cell.state, before));
  };

  const set = (patch) => {
    const before = cell.state;
    const after = derive(patch, before);
    if (after !== before) {
      cell.state = after;
      announce(before);
    }
    return cell.state;
  };

  const subscribe = (watcher) => {
    watchers.add(watcher);
    return () => watchers.delete(watcher);
  };

  return { get: () => cell.state, set, subscribe };
}
