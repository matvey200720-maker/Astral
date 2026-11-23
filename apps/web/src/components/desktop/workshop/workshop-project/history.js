/*
 * История правок проекта: отмена, повтор и восстановление снимка. Снимки —
 * полные копии проекта, поэтому глубина ограничена пятьюдесятью шагами.
 */
import { clone, projectId } from "./internals.js";

export function createHistoryState(project) {
  return { past: [], present: project, future: [], entries: [] };
}

/*
 * Снимок — ссылка на проект, без копии: правки собирают новый проект из прежних разделов (`{...config, ...patch}`), а
 * прежний не меняют. Полная копия (и сравнение по JSON) на каждом шаге ползунка стоили ~260 мс профиля вида игры
 * после шаблонов: копия всего проекта, а не только того раздела, который тянут.
 */
export function commitHistory(
  state,
  nextProject,
  description,
  moduleId = "project",
  property = "",
) {
  if (state.present === nextProject) return state;
  const previousEntry = state.entries.at(-1);
  const mergesContinuousChange =
    property &&
    previousEntry?.moduleId === moduleId &&
    previousEntry?.property === property &&
    Date.now() - new Date(previousEntry.time).getTime() < 500;
  if (mergesContinuousChange) {
    return {
      ...state,
      present: nextProject,
      future: [],
      entries: [
        ...state.entries.slice(0, -1),
        {
          ...previousEntry,
          description,
          time: new Date().toISOString(),
          snapshot: nextProject,
        },
      ],
    };
  }
  return {
    past: [...state.past.slice(-49), state.present],
    present: nextProject,
    future: [],
    entries: [
      ...state.entries.slice(-49),
      {
        id: projectId(),
        description,
        moduleId,
        property,
        time: new Date().toISOString(),
        snapshot: nextProject,
      },
    ],
  };
}

export function undoHistory(state) {
  if (!state.past.length) return state;
  return {
    ...state,
    past: state.past.slice(0, -1),
    present: state.past.at(-1),
    future: [state.present, ...state.future],
  };
}

export function redoHistory(state) {
  if (!state.future.length) return state;
  return {
    ...state,
    past: [...state.past, state.present],
    present: state.future[0],
    future: state.future.slice(1),
  };
}

export function restoreHistoryEntry(state, entryId, description) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry?.snapshot) return state;
  return commitHistory(
    state,
    { ...clone(entry.snapshot), updatedAt: new Date().toISOString() },
    description || `Восстановлено состояние «${entry.description}»`,
    entry.moduleId,
  );
}

export function workshopHistoryReducer(state, action) {
  if (action.type === "commit")
    return commitHistory(
      state,
      action.project,
      action.description,
      action.moduleId,
      action.property,
    );
  if (action.type === "undo") return undoHistory(state);
  if (action.type === "redo") return redoHistory(state);
  if (action.type === "restore-entry")
    return restoreHistoryEntry(state, action.entryId, action.description);
  if (action.type === "replace") return createHistoryState(action.project);
  /*
   * Работа встала в игру — это не правка проекта.
   *
   * `replace` заводит историю заново: он для «открыли другой снимок». Пока
   * установка шла окном поверх приложения, разницы не было — человек всё
   * равно ничего не правил. Теперь установка идёт в очереди, человек правит
   * дальше, и стирать ему отмену на сорок пятой секунде нельзя. Меняется
   * только список установок в текущем снимке.
   */
  if (action.type === "installations")
    return {
      ...state,
      present: { ...state.present, installations: action.installations },
    };
  return state;
}
