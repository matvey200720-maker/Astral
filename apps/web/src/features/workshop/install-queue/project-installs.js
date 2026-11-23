/*
 * Куда попадает запись об установке, когда редактора уже нет на экране.
 *
 * Раньше её принимал сам редактор: окно установки звало `onInstallationChange`,
 * редактор дописывал запись в свой проект и сохранял его. Это работало ровно
 * потому, что окно держало человека на месте все сорок пять секунд. Теперь
 * установка идёт в очереди, а человек в это время правит дальше, уходит в
 * каталог или закрывает редактор совсем — и принимать запись некому.
 *
 * Поэтому запись кладётся прямо в хранилище работ, а открытый редактор о ней
 * узнаёт подпиской и подхватывает её в свою копию проекта. Одна дорога, а не
 * две: писать и из очереди, и из редактора значило бы однажды записать
 * проект поверх самого себя — с установкой, но без правки, или наоборот.
 */

import {
  readWorkshopProjects,
  writeWorkshopProjects,
} from "../../../components/desktop/workshop/workshop-project.js";

/* Сколько установок помнит проект. Столько же, сколько помнил всегда: это
   история «что стояло», а не журнал на все времена. */
const MAX_INSTALLATIONS = 10;

const listeners = new Set();

/**
 * Слить записи установки в список проекта.
 *
 * Записи приходят и пачкой: новая версия работы вместе с прежними, которые
 * она заменила. `replacesInstallIds` — прежние имена записи, если библиотеке
 * пришлось поставить новую версию заново под новым именем точки.
 */
export function mergeInstallations(current, update) {
  const records = (Array.isArray(update) ? update : [update]).filter(Boolean);
  if (!records.length) return null;
  const replaced = new Set(
    records.flatMap((item) => [
      item.installId,
      ...(item.replacesInstallIds || []),
    ]),
  );
  return [
    ...(current || []).filter((item) => !replaced.has(item.installId)),
    ...records.map(({ replacesInstallIds: _replaces, ...item }) => item),
  ].slice(-MAX_INSTALLATIONS);
}

/**
 * Записать установку в работу по её id.
 *
 * Проект перечитывается из хранилища, а не берётся из замыкания: за время
 * установки человек мог сохранить правку, и затирать её записью о том, что
 * работа встала в игру, нельзя.
 */
export function recordProjectInstallation(projectId, update) {
  const records = (Array.isArray(update) ? update : [update]).filter(Boolean);
  if (!projectId || !records.length) return null;
  const projects = readWorkshopProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;
  const installations = mergeInstallations(project.installations, records);
  const saved = {
    ...project,
    installations,
    updatedAt: new Date().toISOString(),
  };
  writeWorkshopProjects([
    saved,
    ...projects.filter((item) => item.id !== projectId),
  ]);
  for (const listener of listeners) listener({ projectId, records });
  return saved;
}

/** Открытый редактор слушает, чтобы показать установку в своей копии. */
export function subscribeProjectInstalls(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
