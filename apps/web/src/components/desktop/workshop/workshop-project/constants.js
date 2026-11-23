/*
 * Опорные значения проекта мастерской: версии схем, ключи хранилища и список
 * платформ. Лежат отдельным файлом потому, что их читают почти все остальные
 * части набора — от миграции до пресетов, — и любая другая прописка неизбежно
 * тянула бы за собой лишние зависимости.
 */

export const WORKSHOP_SCHEMA_VERSION = 11;
export const WORKSHOP_PRESET_SCHEMA_VERSION = 2;
export const WORKSHOP_PRESET_FORMAT = "astralpreset";
export const WORKSHOP_STORAGE_KEY = "astral-workshop-projects-v1";
export const WORKSHOP_DRAFT_KEY = "astral-workshop-recovery-v1";
/* Черновики по проектам: `{ [id]: { at, base, project } }` (05.10). */
export const WORKSHOP_DRAFTS_KEY = "astral-workshop-drafts-v1";

export const WORKSHOP_TARGETS = [
  {
    id: "gta5-legacy-story",
    label: "Majestic / GTA5RP",
    detail: "GTA V Legacy · update.rpf",
  },
  {
    id: "gta5-enhanced-story",
    label: "GTA V Enhanced",
    detail: "Сюжетный режим · ограниченная совместимость",
  },
  { id: "fivem", label: "FiveM", detail: "Собственный ресурс" },
];

/* Списки совместимости модулей. Наружу из набора не выходят: за пределами
   определений модулей ими никто не пользуется. */
export const allTargets = WORKSHOP_TARGETS.map((target) => target.id);
export const storyTargets = allTargets.filter((target) => target !== "fivem");
