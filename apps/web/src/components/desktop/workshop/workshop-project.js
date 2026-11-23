/*
 * Проект мастерской. Файл был одним куском на четыре тысячи строк, где рядом
 * лежали определения шестнадцати модулей, миграция схемы, пресеты, хранилище и
 * история правок; теперь всё это разложено по `workshop-project/`, а здесь
 * остался только список того, чем набор пользуются снаружи.
 *
 * Состав набора:
 *   constants.js       — версии схем, ключи хранилища, платформы
 *   internals.js       — copy и генератор идентификаторов
 *   timecycle.js       — ключевые кадры суток и выборка между ними
 *   effect-defaults.js — профили оружия, материалы попаданий, погода
 *   modules/           — определения шестнадцати модулей по категориям
 *   catalog.js         — витрина мастерской и таблица конфликтов
 *   templates.js       — заготовки нового проекта
 *   project.js         — создание, миграция и проверка проекта
 *   preset-schema.js   — разбор формата пресета
 *   presets.js         — пресеты поверх готового проекта
 *   storage.js         — localStorage и черновик восстановления
 *   analysis.js        — оценки: частота, производительность, конфликты
 *   history.js         — отмена, повтор, восстановление снимка
 */

export {
  WORKSHOP_SCHEMA_VERSION,
  WORKSHOP_PRESET_SCHEMA_VERSION,
  WORKSHOP_PRESET_FORMAT,
  WORKSHOP_STORAGE_KEY,
  WORKSHOP_DRAFT_KEY,
  WORKSHOP_DRAFTS_KEY,
  WORKSHOP_TARGETS,
} from "./workshop-project/constants.js";

export { projectId } from "./workshop-project/internals.js";

export {
  TIMECYCLE_VALUE_FIELDS,
  DEFAULT_TIMECYCLE_KEYFRAMES,
  normalizeTimecycleKeyframes,
  sampleTimecycleAt,
  upsertTimecycleKeyframe,
  copyTimecycleHour,
  removeTimecycleKeyframe,
} from "./workshop-project/timecycle.js";

export {
  WEAPON_EFFECT_PROFILE_KEYS,
  IMPACT_MATERIAL_KEYS,
  WEATHER_PROFILE_KEYS,
  WEATHER_PROFILE_VALUE_KEYS,
  DEFAULT_IMPACT_MATERIALS,
  DEFAULT_WEATHER_PROFILES,
  normalizeWeaponEffectProfiles,
  normalizeImpactMaterials,
  normalizeWeatherProfiles,
} from "./workshop-project/effect-defaults.js";

export {
  WORKSHOP_MODULES,
  WORKSHOP_RELEASED_MODULE_IDS,
  WORKSHOP_RETICLE_MODULE_IDS,
  WORKSHOP_MODULE_MAP,
  WORKSHOP_CONFLICT_DEFINITIONS,
  WORKSHOP_CATEGORIES,
} from "./workshop-project/catalog.js";

export {
  createWorkshopProject,
  migrateWorkshopProject,
  validateWorkshopProject,
} from "./workshop-project/project.js";

export { migrateWorkshopPreset } from "./workshop-project/preset-schema.js";

export {
  validateWorkshopPreset,
  createWorkshopPreset,
  applyWorkshopPreset,
  serializeWorkshopPreset,
  parseWorkshopPreset,
} from "./workshop-project/presets.js";

export {
  readWorkshopProjects,
  readWorkshopProjectRecords,
  writeWorkshopProjects,
  upsertWorkshopProject,
  saveRecoveryDraft,
  readRecoveryDraft,
  readProjectDraft,
  readProjectDraftOrigin,
  clearProjectDraft,
  draftBase,
} from "./workshop-project/storage.js";

export {
  moduleUsageScore,
  performanceEstimate,
  detectWorkshopConflicts,
  unresolvedWorkshopConflicts,
  resolveWorkshopConflict,
} from "./workshop-project/analysis.js";

export {
  createHistoryState,
  commitHistory,
  undoHistory,
  redoHistory,
  restoreHistoryEntry,
  workshopHistoryReducer,
} from "./workshop-project/history.js";
