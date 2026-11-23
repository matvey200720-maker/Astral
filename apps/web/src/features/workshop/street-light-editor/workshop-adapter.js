import {
  STREET_LIGHT_MODULE_SCHEMA_VERSION,
  applyStreetLightPreset,
  createDefaultStreetLightDesign,
  normalizeStreetLightModule,
  normalizeStreetLightPreset,
} from "@modovik/street-light-contract";

export const STREET_LIGHT_WORKSHOP_MODULE_ID = "street-lights";

function safeIdentity(value, fallback) {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .slice(0, 80);
  return normalized || fallback;
}

export function createDefaultStreetLightModule(projectId = "new") {
  const identity = safeIdentity(projectId, "new");
  return {
    schemaVersion: STREET_LIGHT_MODULE_SCHEMA_VERSION,
    design: createDefaultStreetLightDesign(
      `design:street-lights:${identity}`,
      "Тёплый городской свет",
    ),
    binding: null,
  };
}

export function migrateStreetLightModule(input, projectTarget, projectId) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return createDefaultStreetLightModule(projectId);
  return normalizeStreetLightModule(
    input,
    projectTarget,
    "modules.street-lights",
  );
}

export function createStreetLightPresetPayload(moduleInput, projectTarget) {
  const module = normalizeStreetLightModule(moduleInput, projectTarget);
  return normalizeStreetLightPreset({
    schema: "astral-street-light-preset/v1",
    values: {
      light: module.design.light,
      corona: module.design.corona,
      volumetric: module.design.volumetric,
      decoration: module.design.decoration,
    },
  });
}

export function applyStreetLightPresetPayload(
  moduleInput,
  presetInput,
  projectTarget,
) {
  const module = normalizeStreetLightModule(moduleInput, projectTarget);
  return {
    ...module,
    design: applyStreetLightPreset(module.design, presetInput),
  };
}

export function copyStreetLightModuleAsUnbound(
  moduleInput,
  projectTarget,
  newProjectId,
) {
  const module = normalizeStreetLightModule(moduleInput, projectTarget);
  const identity = safeIdentity(newProjectId, "copy");
  return {
    ...module,
    design: {
      ...module.design,
      designId: `design:street-lights:${identity}`,
      name: `${module.design.name} — копия`,
    },
    binding: null,
  };
}

export function resetStreetLightBindingForTarget(project, nextTarget) {
  if (
    project.target === nextTarget ||
    !project.modules?.[STREET_LIGHT_WORKSHOP_MODULE_ID]
  )
    return { ...project, target: nextTarget };
  return {
    ...project,
    target: nextTarget,
    modules: {
      ...project.modules,
      [STREET_LIGHT_WORKSHOP_MODULE_ID]: {
        ...project.modules[STREET_LIGHT_WORKSHOP_MODULE_ID],
        binding: null,
      },
    },
  };
}
