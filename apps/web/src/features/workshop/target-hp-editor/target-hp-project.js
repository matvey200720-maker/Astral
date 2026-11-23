/*
 * Работа «Полоски HP» в хранилище окна (задача 2 ТЗ 11.10.2026).
 *
 * Своя правка редактора лежит в `astral.target-hp.project.v1`, как у
 * остальных отдельных редакторов. Утром того же дня полоска была
 * инструментом прицела и лежала в модуле обычного прицела проекта студии
 * (`modules.crosshair.targetHealth`). Своей правки ещё нет, а в проекте
 * прицела полоска включена — работа начинается с неё, с выбором человека
 * (последний правленный проект). Проект прицела не трогается: прежние
 * работы открываются как были.
 */

import {
  createTargetHpProject,
  normalizeTargetHpProject,
  parseTargetHpProject,
  serializeTargetHpProject,
  targetHealthFromReticleModule,
} from "@modovik/reticle-contract";

export const TARGET_HP_STORAGE_KEY = "astral.target-hp.project.v1";
const WORKSHOP_PROJECTS_KEY = "astral-workshop-projects-v1";

/** Полоска из проектов студии, где она была инструментом прицела, или `null`. */
export function targetHpFromReticleProjects(storage = globalThis.localStorage) {
  let projects = [];
  try {
    projects = JSON.parse(storage?.getItem(WORKSHOP_PROJECTS_KEY) || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(projects)) return null;
  const found = projects
    .map((project) => ({
      config: targetHealthFromReticleModule(project?.modules?.crosshair),
      time: Date.parse(project?.updatedAt || "") || 0,
    }))
    .filter((item) => item.config)
    .sort((a, b) => b.time - a.time)[0];
  return found ? normalizeTargetHpProject(found.config) : null;
}

/** Правка редактора: своя — или полоска прежнего прицела — или как в игре. */
export function restoreTargetHpProject(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(TARGET_HP_STORAGE_KEY);
    if (stored) return parseTargetHpProject(stored);
  } catch {
    /* хранилище закрыто — работа с начала */
  }
  return targetHpFromReticleProjects(storage) || createTargetHpProject();
}

export function saveTargetHpProject(project, storage = globalThis.localStorage) {
  try {
    storage?.setItem(TARGET_HP_STORAGE_KEY, serializeTargetHpProject(project));
    return true;
  } catch {
    return false;
  }
}
