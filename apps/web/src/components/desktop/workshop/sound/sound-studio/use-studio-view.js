import { useReducer, useState, useMemo, useEffect } from "react";
import { loadSoundProject, storeSoundProject } from "../sound-model.js";
import { useSkyHistory } from "../../useSkyHistory.js";
import { ADVANCED_STORE_KEY, SAVE_DELAY_MS } from "./studio-model.js";

// Отложенная запись: последнее значение уходит в хранилище через паузу или сразу по flush.
class DraftWriter {
  constructor(pause, sink) {
    this.pause = pause;
    this.sink = sink;
    this.pending = null;
    this.waiting = false;
    this.timer = 0;
    this.start = undefined;
  }

  // Первое значение — исходное, его не пишем; дальше каждое новое откладывается.
  follow(value) {
    if (this.start === undefined) this.start = value;
    if (value !== this.start) this.note(value);
  }

  note(value) {
    this.pending = value;
    this.waiting = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.pause);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.waiting) return;
    this.waiting = false;
    this.sink(this.pending);
  }

  // Подписка на закрытие окна; возвращает отписку, которая дописывает несохранённое.
  attach(win) {
    const leaving = () => this.flush();
    win.addEventListener("pagehide", leaving);
    return () => {
      win.removeEventListener("pagehide", leaving);
      this.flush();
    };
  }
}

// Хранилище может быть закрыто: тогда выбор живёт до закрытия студии.
const guarded = (action, fallback) => {
  try {
    return action();
  } catch {
    return fallback;
  }
};

const advancedFromStore = () =>
  guarded(() => localStorage.getItem(ADVANCED_STORE_KEY) === "1", false);

export const rememberAdvancedChoice = (on) =>
  guarded(() => localStorage[on ? "setItem" : "removeItem"](ADVANCED_STORE_KEY, "1"), null);

// Вид меняют значением или функцией от прежнего вида.
const nextView = (was, change) => (change instanceof Function ? change(was) : change);

// Вид (раздел, банк, станция, отпечатки) + история правок + запись проекта в хранилище.
export function useStudioView() {
  const [view, setView] = useReducer(nextView, undefined, loadSoundProject);
  const history = useSkyHistory(() => ({ assignments: view.assignments, events: view.events }));
  const [advanced, setAdvanced] = useState(advancedFromStore);
  const writer = useMemo(() => new DraftWriter(SAVE_DELAY_MS, storeSoundProject), []);

  const { assignments, events } = history.state;
  const project = useMemo(
    () => Object.assign({}, view, { assignments, events }),
    [view, assignments, events],
  );

  useEffect(() => writer.follow(project), [project, writer]);
  useEffect(() => writer.attach(window), [writer]);

  return { view, setView, history, advanced, setAdvanced, project };
}
