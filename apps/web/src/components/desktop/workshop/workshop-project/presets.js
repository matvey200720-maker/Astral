/*
 * Пресеты поверх проекта: проверить, собрать из проекта, применить к проекту,
 * записать в файл и прочитать обратно. Разбор самого формата живёт в
 * `preset-schema.js` — здесь только то, чему нужен готовый проект.
 */
import {
  applyStreetLightPresetPayload,
  createDefaultStreetLightModule,
  createStreetLightPresetPayload,
} from "../../../../features/workshop/street-light-editor/workshop-adapter.js";
import { WORKSHOP_PRESET_FORMAT } from "./constants.js";
import { WORKSHOP_MODULE_MAP } from "./catalog.js";
import { migrateWorkshopPreset } from "./preset-schema.js";
import { createWorkshopProject, validateWorkshopProject } from "./project.js";
import { clone, projectId } from "./internals.js";
import { tr } from "../../../../locales/ui.js";

export function validateWorkshopPreset(value) {
  try {
    const preset = migrateWorkshopPreset(value);
    const enabledModules = Object.keys(preset.modules);
    const project = createWorkshopProject({
      target: "gta5-legacy-story",
      enabledModules,
    });
    project.modules = Object.fromEntries(
      Object.entries(preset.modules).map(([id, config]) => [
        id,
        id === "street-lights"
          ? applyStreetLightPresetPayload(
              project.modules[id],
              config,
              project.target,
            )
          : clone(config),
      ]),
    );
    const result = validateWorkshopProject(project);
    return { ...result, preset };
  } catch (error) {
    return {
      valid: false,
      errors: [error.message || tr("Повреждённый файл пресета")],
      preset: null,
    };
  }
}

export function createWorkshopPreset(project, input = {}) {
  const moduleIds =
    input.scope === "project"
      ? project.enabledModules.filter(
          (id) => !project.disabledModules.includes(id),
        )
      : [input.moduleId || project.moduleOrder[0]].filter((id) =>
          project.enabledModules.includes(id),
        );
  if (!moduleIds.length)
    throw new Error(tr("Не выбран модуль для сохранения пресета"));
  return migrateWorkshopPreset({
    name: input.name,
    tags: input.tags,
    favorite: input.favorite,
    modules: Object.fromEntries(
      moduleIds.map((id) => [
        id,
        id === "street-lights"
          ? createStreetLightPresetPayload(project.modules[id], project.target)
          : clone(project.modules[id]),
      ]),
    ),
    palette: input.scope === "project" ? clone(project.palette) : {},
  });
}

export function applyWorkshopPreset(project, value, input = {}) {
  const validation = validateWorkshopPreset(value);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const preset = validation.preset;
  const requestedIds =
    input.scope === "project"
      ? Object.keys(preset.modules)
      : [input.moduleId].filter(Boolean);
  const moduleIds = requestedIds.filter(
    (id) =>
      preset.modules[id] &&
      WORKSHOP_MODULE_MAP[id]?.compatibility.includes(project.target),
  );
  if (!moduleIds.length)
    throw new Error(
      tr("Пресет не содержит настроек для выбранной платформы или модуля"),
    );
  const enabledModules = [...project.enabledModules];
  const moduleOrder = [...project.moduleOrder];
  const modules = { ...project.modules };
  for (const id of moduleIds) {
    if (!enabledModules.includes(id)) enabledModules.push(id);
    if (!moduleOrder.includes(id)) moduleOrder.push(id);
    modules[id] =
      id === "street-lights"
        ? applyStreetLightPresetPayload(
            project.modules[id] || createDefaultStreetLightModule(project.id),
            preset.modules[id],
            project.target,
          )
        : clone(preset.modules[id]);
  }
  const next = {
    ...project,
    enabledModules,
    moduleOrder,
    disabledModules: project.disabledModules.filter(
      (id) => !moduleIds.includes(id),
    ),
    modules,
    palette:
      input.scope === "project"
        ? { ...project.palette, ...preset.palette }
        : project.palette,
  };
  const projectValidation = validateWorkshopProject(next);
  if (!projectValidation.valid)
    throw new Error(projectValidation.errors.join("\n"));
  return next;
}

export function serializeWorkshopPreset(value) {
  const validation = validateWorkshopPreset(value);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return JSON.stringify(
    {
      format: WORKSHOP_PRESET_FORMAT,
      version: 2,
      preset: validation.preset,
    },
    null,
    2,
  );
}

export function parseWorkshopPreset(raw) {
  if (String(raw || "").length > 2 * 1024 * 1024)
    throw new Error(tr("Файл пресета превышает безопасный размер 2 МБ"));
  let envelope;
  try {
    envelope = JSON.parse(String(raw));
  } catch {
    throw new Error(tr("Файл пресета содержит некорректный JSON"));
  }
  if (
    envelope?.format !== WORKSHOP_PRESET_FORMAT ||
    ![1, 2].includes(envelope?.version)
  )
    throw new Error(tr("Неизвестный формат файла пресета"));
  const validation = validateWorkshopPreset(envelope.preset);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return {
    ...validation.preset,
    id: projectId(),
    favorite: false,
    updatedAt: new Date().toISOString(),
  };
}
