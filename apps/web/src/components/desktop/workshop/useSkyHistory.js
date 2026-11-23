import { useMemo, useState } from "react";

// Вся история — один список значений и курсор на настоящем: «прошлое» слева, «будущее» справа.
// Прошлое хранит не больше 60 шагов, поэтому в списке не больше 61 значения.
const KEEP = 61;
const origin = (value, moves = 0) => ({ list: [value], at: 0, moves });
const present = (h) => h.list[h.at];

const overwrite = (h, value) => ({ ...h, list: h.list.with(h.at, value) });
const append = (h, value) => {
  const list = [...h.list.slice(0, h.at + 1), value].slice(-KEEP);
  return { ...h, list, at: list.length - 1 };
};
const shift = (dir) => (h) => {
  const at = h.at + dir;
  return at < 0 || at >= h.list.length ? h : { ...h, at, moves: h.moves + 1 };
};
// Новое значение — готовое или функция от настоящего; то же значение (===) историю не меняет.
const rewrite = (next, place) => (h) => {
  const value = typeof next === "function" ? next(present(h)) : next;
  return value === present(h) ? h : place(h, value);
};

// Склейка и сброс живут в замыкании: действия создаются один раз и не меняют ссылок.
function createActions(setHistory) {
  let tag = null;
  let stamp = 0;
  const forget = () => {
    tag = null;
    stamp = 0;
  };
  return {
    commit(next, label = null) {
      // Решение о склейке — до обновления состояния: StrictMode зовёт обновление дважды.
      const now = Date.now();
      const glued = label !== null && label === tag && now - stamp < 450;
      tag = label;
      stamp = now;
      setHistory(rewrite(next, glued ? overwrite : append));
    },
    undo() {
      forget();
      setHistory(shift(-1));
    },
    redo() {
      forget();
      setHistory(shift(1));
    },
    amend: (next) => setHistory(rewrite(next, overwrite)),
    reset(value) {
      forget();
      setHistory((h) => origin(value, h.moves));
    },
  };
}

export function useSkyHistory(initial) {
  const [h, setHistory] = useState(() => origin(typeof initial === "function" ? initial() : initial));
  const [actions] = useState(() => createActions(setHistory));
  return useMemo(
    () => ({ state: present(h), ...actions, canUndo: h.at > 0, canRedo: h.at < h.list.length - 1, moves: h.moves }),
    [h, actions],
  );
}
