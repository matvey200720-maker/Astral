/*
 * Переходник между контрактом залазов и проектом мастерской.
 *
 * Контракт (`@modovik/climb-contract`) не знает ни про проекты, ни про
 * хранилище файлов: он описывает облик меток. Здесь — ровно то, чего ему
 * знать не положено: под каким ключом модуль лежит в проекте, как назвать
 * макет по идентификатору проекта и что делать с копией.
 *
 * Тот же слой у уличных фонарей (`street-light-editor/workshop-adapter.js`) —
 * и по той же причине.
 */

import {
  CLIMB_MODULE_SCHEMA_VERSION,
  applyClimbPreset,
  climbSlotsWithImages,
  createClimbPreset,
  createDefaultClimbDesign,
  normalizeClimbModule,
  stripClimbImages,
} from "@modovik/climb-contract";

export const CLIMB_WORKSHOP_MODULE_ID = "climbs";

function safeIdentity(value, fallback) {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .slice(0, 80);
  return normalized || fallback;
}

export function createDefaultClimbModule(projectId = "new") {
  return {
    schemaVersion: CLIMB_MODULE_SCHEMA_VERSION,
    design: createDefaultClimbDesign(
      `design:climbs:${safeIdentity(projectId, "new")}`,
      "Мои залазы",
    ),
  };
}

/**
 * Модуль из старого проекта.
 *
 * Сломанный или пустой модуль — не повод отказать в открытии редактора:
 * контракт вернёт заготовку. Макет первой версии (одна стрелка и два цвета)
 * контракт переводит сам — цвета переезжают, значки остаются модовыми.
 */
export function migrateClimbModule(input, projectId) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return createDefaultClimbModule(projectId);
  return normalizeClimbModule(input, `modules.${CLIMB_WORKSHOP_MODULE_ID}`);
}

export function createClimbPresetPayload(moduleInput) {
  return createClimbPreset(normalizeClimbModule(moduleInput).design);
}

export function applyClimbPresetPayload(moduleInput, presetInput) {
  const module = normalizeClimbModule(moduleInput);
  return { ...module, design: applyClimbPreset(module.design, presetInput) };
}

/** Есть ли у набора свои картинки — их не перенести ни кодом, ни копией. */
export const climbModuleHasPictures = (moduleInput) =>
  climbSlotsWithImages(normalizeClimbModule(moduleInput).design).length > 0;

/**
 * Копия макета для нового проекта.
 *
 * Свои картинки остаются привязанными к файлам исходного проекта, а файлы
 * при импорте переносятся под новыми идентификаторами. Поэтому копия
 * возвращает такие метки к значкам мода: знакомый значок лучше ссылки в
 * никуда и пустой плашки в игре.
 */
export function copyClimbModuleForProject(moduleInput, newProjectId) {
  const module = normalizeClimbModule(moduleInput);
  const design = stripClimbImages(module.design);
  return {
    ...module,
    design: {
      ...design,
      designId: `design:climbs:${safeIdentity(newProjectId, "copy")}`,
      name: `${module.design.name} — копия`,
    },
  };
}
