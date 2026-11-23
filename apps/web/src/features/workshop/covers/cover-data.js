/*
 * Откуда обложка берёт работу человека.
 *
 * Проекты студии лежат в хранилище окна одним списком; обложке нужен один —
 * по id, без миграций и проверок: это картинка на плитке, и непонятный проект
 * для неё просто «работы нет», то есть стандартная обложка.
 */

import { parseProject } from "@modovik/ptfx-studio";

const PROJECTS_KEY = "astral-workshop-projects-v1";

/**
 * Проект студии для обложки. Сохранённый читается по id; шаблон по коду,
 * которого в хранилище ещё нет, приходит снимком строкой (`state`) — окно
 * «Добавить шаблон» показывает работу до того, как её добавят.
 */
export function readStudioProject(projectId, state = null) {
  const snapshot = parseCoverState(state);
  if (snapshot?.modules) return snapshot;
  if (!projectId) return null;
  try {
    const projects = JSON.parse(
      globalThis.localStorage?.getItem(PROJECTS_KEY) || "[]",
    );
    return Array.isArray(projects)
      ? projects.find((project) => project?.id === projectId) || null
      : null;
  } catch {
    return null;
  }
}

/** Настройки модуля студии из проекта или `null`. */
export function readStudioModule(projectId, moduleId, state = null) {
  const config = readStudioProject(projectId, state)?.modules?.[moduleId];
  return config && typeof config === "object" ? config : null;
}

/** Снимок правки отдельного редактора: строка JSON → объект или `null`. */
export function parseCoverState(state) {
  if (typeof state !== "string" || !state) return null;
  try {
    const parsed = JSON.parse(state);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Снимок набора эффектов — разобранным проектом.
 *
 * Снимок мог сохранить прежняя мастерская (шесть зон попаданий, четыре
 * семейства окружения): разбор проекта переводит его в нынешний вид, и обложка
 * рисует то же, что откроет редактор. Нечитаемый снимок — «работы нет».
 */
export function parseEffectsState(state) {
  const raw = parseCoverState(state);
  if (!raw) return null;
  try {
    return parseProject(raw);
  } catch {
    return null;
  }
}
