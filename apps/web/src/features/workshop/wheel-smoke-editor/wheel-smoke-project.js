/*
 * Работа «Дыма из-под колёс» в хранилище окна: своя правка редактора лежит
 * в `astral.wheel-smoke.project.v1`, как у остальных отдельных редакторов.
 * Нет правки или хранилище закрыто — дым как в игре.
 */

import {
  createWheelSmokeProject,
  parseWheelSmokeProject,
  serializeWheelSmokeProject,
} from "@modovik/ptfx-studio/wheel-smoke.js";

export const WHEEL_SMOKE_STORAGE_KEY = "astral.wheel-smoke.project.v1";

export function restoreWheelSmokeProject(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(WHEEL_SMOKE_STORAGE_KEY);
    if (stored) return parseWheelSmokeProject(stored);
  } catch {
    /* хранилище закрыто — работа с начала */
  }
  return createWheelSmokeProject();
}

export function saveWheelSmokeProject(project, storage = globalThis.localStorage) {
  try {
    storage?.setItem(WHEEL_SMOKE_STORAGE_KEY, serializeWheelSmokeProject(project));
    return true;
  } catch {
    return false;
  }
}
