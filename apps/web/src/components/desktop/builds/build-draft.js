import { collectInstalledLibraryWorks } from "../../../features/builds/build-works.js";
import { decodePortableBuild, encodePortableBuild } from "../../../features/builds/portable-code.js";
import { buildWorksEnabled } from "../../../features/builds/works-switch.js";
import { readWorkshopProjects } from "../workshop/workshop-project.js";
import { engineIdsOf } from "./build-lists.js";

// Сборка черновика, разбор кода и уведомления страницы сборок: всё без состояния.

// Проекты студии словарём «id проекта -> проект»: по нему сосед сопоставляет их работам.
function projectsById() {
  const projects = {};
  for (const project of readWorkshopProjects() || []) {
    if (project) projects[project.id] = project;
  }
  return projects;
}

// Имя черновика: введённое без краёв, иначе название по умолчанию.
function draftName(name, defaultName) {
  return name.trim() || defaultName;
}

// Выбранные в окне создания моды в порядке списка.
function tickedIds(picks) {
  return picks.ids.filter(function isTicked(id) {
    return picks.enabledIds.has(id);
  });
}

// Черновик новой сборки из того, что стоит в игре; порядок ключей виден снаружи.
export async function composeDraft(input) {
  const { name, defaultName, picks, installed, modsById, workItems } = input;
  const worksOn = buildWorksEnabled();
  const projects = projectsById();
  const request = { workItems, projects };
  const works = await collectInstalledLibraryWorks(request);
  const draft = {
    id: `profile-${Date.now()}`,
    name: draftName(name, defaultName),
    modIds: tickedIds(picks),
    ...(worksOn ? { engineIds: engineIdsOf(installed, modsById) } : null),
    ...(works.length ? { works } : null),
    updatedAt: new Date().toISOString(),
  };
  return { ...draft, code: encodePortableBuild(draft) };
}

// Итог сохранения: если работы не удалось запомнить, к нему добавляется пояснение.
export function savedNotice(copy, worksCopy, stored) {
  if (stored) return copy.saved;
  return `${copy.saved} · ${worksCopy.notStored}`;
}

// Что сказать про работы из кода: добавлено, пропущено, не удалось.
function reportNotes(worksCopy, report) {
  const notes = [];
  if (report.added.length) notes.push(worksCopy.importedWorks(report.added));
  if (report.skipped.length) notes.push(worksCopy.skippedWorks(report.skipped));
  if (report.failed.length) notes.push(worksCopy.failedWorks(report.failed));
  return notes;
}

// Уведомление об импорте: части через « · », пустые не берём.
export function importNotice({ copy, worksCopy, report, dropped, stored }) {
  const parts = [copy.codeRead];
  if (report) parts.push(...reportNotes(worksCopy, report));
  if (dropped > 0) parts.push(worksCopy.droppedWorks(dropped));
  if (!stored) parts.push(worksCopy.notStored);
  return parts.filter(Boolean).join(" · ");
}

// Сборка из кода: к разобранному добавляются выбранные моды; не разобрался — null.
export function readPortable(fullCode, codePicks) {
  const decoded = decodePortableBuild(fullCode);
  if (!decoded) return null;
  return { ...decoded, modIds: codePicks.pickedIds };
}
