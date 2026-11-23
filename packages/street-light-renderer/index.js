import {
  normalizeStreetLightDesign,
  resolveBaselineMultiplier,
  resolveStreetLightRgb,
} from "@modovik/street-light-contract";

export const STREET_LIGHT_MAPPING_PROFILE = "legacy-lod-light-v1";
export const STREET_LIGHT_PREVIEW_MODEL_SCHEMA =
  "astral-street-light-preview-model/v1";

const finite = (value, path) => {
  if (!Number.isFinite(value))
    throw new Error(`${path}: expected finite number.`);
  return Object.is(value, -0) ? 0 : value;
};

function baselineFor(baselineByTarget, targetId, kind) {
  const value = baselineByTarget?.[targetId];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`baselineByTarget.${targetId}: missing ${kind} baseline.`);
  return value;
}

function targetBound(target, field, fallback) {
  const bounds = target.safeEnvelope?.[field];
  if (!bounds) return fallback;
  return { minimum: bounds.min, maximum: bounds.max };
}

function multiply({
  target,
  baseline,
  multiplier,
  field,
  path,
  fallback,
  integer = false,
}) {
  const { minimum, maximum } = targetBound(target, field, fallback);
  return resolveBaselineMultiplier({
    baseline: finite(baseline, `${path}.baseline`),
    multiplier,
    minimum,
    maximum,
    integer,
    path,
  });
}

function offset({
  target,
  baseline,
  offset: amount,
  field,
  path,
  fallback,
  integer = false,
}) {
  const { minimum, maximum } = targetBound(target, field, fallback);
  const requested =
    finite(baseline, `${path}.baseline`) + finite(amount, `${path}.offset`);
  const bounded = Math.max(minimum, Math.min(maximum, requested));
  const effective = integer ? Math.round(bounded) : bounded;
  return {
    requested,
    effective,
    clamp:
      requested === bounded
        ? null
        : {
            path,
            requested,
            effective,
            reasonCode: "STREET_LIGHT_TARGET_ENVELOPE_CLAMP",
          },
  };
}

function own(target, field) {
  return target.ownedFields.includes(field);
}

function unsupported(path, reasonCode) {
  return { path, reasonCode };
}

function resolveHdTarget(design, family, target, baseline, rgb) {
  const clamps = [];
  const unsupportedFields = [];
  const values = {};
  const capture = (field, result) => {
    values[field] = result.effective;
    if (result.clamp) clamps.push(result.clamp);
  };
  if (own(target, "color")) values.color = rgb;
  else
    unsupportedFields.push(
      unsupported("light.color", "STREET_LIGHT_TARGET_FIELD_NOT_OWNED"),
    );

  if (own(target, "intensity"))
    capture(
      "intensity",
      multiply({
        target,
        baseline: baseline.intensity,
        multiplier: design.light.intensityMultiplier,
        field: "intensity",
        path: `${target.targetId}.intensity`,
        fallback: { minimum: 0, maximum: 256 },
      }),
    );
  if (own(target, "falloff"))
    capture(
      "falloff",
      multiply({
        target,
        baseline: baseline.falloff,
        multiplier: design.light.rangeMultiplier,
        field: "falloff",
        path: `${target.targetId}.falloff`,
        fallback: { minimum: 0.01, maximum: 10_000 },
      }),
    );
  if (own(target, "falloffExponent"))
    capture(
      "falloffExponent",
      multiply({
        target,
        baseline: baseline.falloffExponent,
        multiplier: design.light.falloffExponentMultiplier,
        field: "falloffExponent",
        path: `${target.targetId}.falloffExponent`,
        fallback: { minimum: 0.01, maximum: 1_000 },
      }),
    );
  if (own(target, "lightFadeDistance"))
    capture(
      "lightFadeDistance",
      multiply({
        target,
        baseline: baseline.lightFadeDistance,
        multiplier: design.light.lightFadeDistanceMultiplier,
        field: "lightFadeDistance",
        path: `${target.targetId}.lightFadeDistance`,
        fallback: { minimum: 0, maximum: 255 },
        integer: true,
      }),
    );

  if (!family.capabilities.supportsCorona) {
    unsupportedFields.push(
      unsupported("corona", "STREET_LIGHT_FAMILY_CORONA_UNSUPPORTED"),
    );
  } else {
    if (own(target, "coronaIntensity")) {
      const multiplier = design.corona.enabled
        ? design.corona.intensityMultiplier
        : 0;
      capture(
        "coronaIntensity",
        multiply({
          target,
          baseline: baseline.coronaIntensity,
          multiplier,
          field: "coronaIntensity",
          path: `${target.targetId}.coronaIntensity`,
          fallback: { minimum: 0, maximum: 256 },
        }),
      );
    }
    if (own(target, "coronaSize")) {
      const multiplier = design.corona.enabled
        ? design.corona.sizeMultiplier
        : 0;
      capture(
        "coronaSize",
        multiply({
          target,
          baseline: baseline.coronaSize,
          multiplier,
          field: "coronaSize",
          path: `${target.targetId}.coronaSize`,
          fallback: { minimum: 0, maximum: 256 },
        }),
      );
    }
    if (own(target, "coronaZBias"))
      capture(
        "coronaZBias",
        offset({
          target,
          baseline: baseline.coronaZBias,
          offset: design.corona.zBiasOffset,
          field: "coronaZBias",
          path: `${target.targetId}.coronaZBias`,
          fallback: { minimum: -32, maximum: 32 },
        }),
      );
  }

  const volumeFields = [
    ["volumeIntensity", "intensityMultiplier", 0, 256],
    ["volumeSizeScale", "sizeScaleMultiplier", 0, 64],
    ["volumeOuterIntensity", "outerIntensityMultiplier", 0, 256],
    ["volumeOuterExponent", "outerExponentMultiplier", 0.01, 256],
    ["volumetricFadeDistance", "fadeDistanceMultiplier", 0, 255, true],
  ];
  if (!family.capabilities.supportsVolumetric) {
    unsupportedFields.push(
      unsupported("volumetric", "STREET_LIGHT_FAMILY_VOLUMETRIC_UNSUPPORTED"),
    );
  } else {
    for (const [
      field,
      designField,
      minimum,
      maximum,
      integer,
    ] of volumeFields) {
      if (!own(target, field)) continue;
      const multiplier = design.volumetric.enabled
        ? design.volumetric[designField]
        : 0;
      capture(
        field,
        multiply({
          target,
          baseline: baseline[field],
          multiplier,
          field,
          path: `${target.targetId}.${field}`,
          fallback: { minimum, maximum },
          integer: Boolean(integer),
        }),
      );
    }
    if (own(target, "volumeIntensity") || own(target, "volumeOuterIntensity"))
      values.volumeOuterColor = rgb;
  }
  return {
    targetId: target.targetId,
    targetKind: target.kind,
    expectedFingerprint: target.structuralFingerprint,
    values,
    clamps,
    unsupported: unsupportedFields,
  };
}

function requireMappingParameter(parameters, key, path) {
  return finite(parameters[key], `${path}.mappingParameters.${key}`);
}

function resolveLodLink(link, hdById, lodTargetById) {
  if (link.mappingProfileId !== STREET_LIGHT_MAPPING_PROFILE)
    throw new Error(
      `${link.linkId}: unsupported mappingProfileId ${link.mappingProfileId}.`,
    );
  const source = hdById.get(link.hdTargetIds[0]);
  if (!source) throw new Error(`${link.linkId}: missing resolved HD source.`);
  const parameters = link.mappingParameters;
  const intensityScale = requireMappingParameter(
    parameters,
    "intensityScale",
    link.linkId,
  );
  const coronaScale = requireMappingParameter(
    parameters,
    "coronaScale",
    link.linkId,
  );
  const results = [];
  for (const targetId of link.lodTargetIds) {
    const target = lodTargetById.get(targetId);
    if (!target)
      throw new Error(`${link.linkId}: missing LOD target ${targetId}.`);
    const values = {};
    if (link.fields.includes("color") && target.ownedFields.includes("rgb"))
      values.color = source.values.color;
    if (
      link.fields.includes("intensity") &&
      target.ownedFields.includes("intensity")
    )
      values.intensity = Math.max(
        0,
        Math.min(255, Math.round(source.values.intensity * intensityScale)),
      );
    if (link.fields.includes("range") && target.ownedFields.includes("falloff"))
      values.falloff = source.values.falloff;
    if (
      link.fields.includes("falloffExponent") &&
      target.ownedFields.includes("falloffExponent")
    )
      values.falloffExponent = source.values.falloffExponent;
    if (
      link.fields.includes("coronaIntensity") &&
      target.ownedFields.includes("coronaIntensity") &&
      source.values.coronaIntensity !== undefined
    )
      values.coronaIntensity = Math.max(
        0,
        Math.min(255, Math.round(source.values.coronaIntensity * coronaScale)),
      );
    results.push({
      targetId,
      targetKind: "ymap-lod-light",
      expectedFingerprint: target.structuralFingerprint,
      sourceHdTargetId: source.targetId,
      values,
      clamps: [],
      unsupported: [],
    });
  }
  return results;
}

export function resolveStreetLightFamily({
  design: designInput,
  family,
  baselineByTarget,
}) {
  const design = normalizeStreetLightDesign(designInput);
  if (
    !family ||
    typeof family !== "object" ||
    !Array.isArray(family.hdTargets) ||
    !Array.isArray(family.lodTargets)
  )
    throw new Error("family: invalid coverage family.");
  const rgb = resolveStreetLightRgb(design.light.color);
  const hdResults = family.hdTargets
    .map((target) =>
      resolveHdTarget(
        design,
        family,
        target,
        baselineFor(baselineByTarget, target.targetId, "HD"),
        rgb,
      ),
    )
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
  const hdById = new Map(hdResults.map((target) => [target.targetId, target]));
  const lodTargetById = new Map(
    family.lodTargets.map((target) => [target.targetId, target]),
  );
  const lodById = new Map();
  for (const link of family.links) {
    for (const result of resolveLodLink(link, hdById, lodTargetById)) {
      const previous = lodById.get(result.targetId);
      if (
        previous &&
        JSON.stringify(previous.values) !== JSON.stringify(result.values)
      )
        throw new Error(`${result.targetId}: conflicting HD-to-LOD links.`);
      lodById.set(result.targetId, result);
    }
  }
  for (const target of family.lodTargets)
    if (!lodById.has(target.targetId))
      throw new Error(`${target.targetId}: unlinked LOD target.`);
  const lodResults = [...lodById.values()].sort((a, b) =>
    a.targetId.localeCompare(b.targetId),
  );
  const clamps = [...hdResults, ...lodResults].flatMap(
    (target) => target.clamps,
  );
  const unsupported = [...hdResults, ...lodResults].flatMap(
    (target) => target.unsupported,
  );
  return {
    familyId: family.familyId,
    designId: design.designId,
    colorProfile: "srgb-cct-v1",
    mappingProfileId: STREET_LIGHT_MAPPING_PROFILE,
    values: {
      color: rgb,
      coronaEnabled:
        design.corona.enabled && family.capabilities.supportsCorona,
      volumetricEnabled:
        design.volumetric.enabled && family.capabilities.supportsVolumetric,
      decorationPresetId: family.capabilities.supportsDecorations
        ? design.decoration.presetId
        : "none",
    },
    hdTargets: hdResults,
    lodTargets: lodResults,
    clamps,
    unsupported,
  };
}

export function createStreetLightPreviewModel(resolvedFamily) {
  const hd = resolvedFamily.hdTargets[0];
  if (!hd)
    throw new Error("resolvedFamily.hdTargets: expected at least one target.");
  return {
    schema: STREET_LIGHT_PREVIEW_MODEL_SCHEMA,
    familyId: resolvedFamily.familyId,
    color: resolvedFamily.values.color,
    intensity: hd.values.intensity ?? 0,
    range: hd.values.falloff ?? 0,
    falloffExponent: hd.values.falloffExponent ?? 1,
    corona: {
      enabled: resolvedFamily.values.coronaEnabled,
      intensity: hd.values.coronaIntensity ?? 0,
      size: hd.values.coronaSize ?? 0,
      zBias: hd.values.coronaZBias ?? 0,
    },
    volumetric: {
      enabled: resolvedFamily.values.volumetricEnabled,
      intensity: hd.values.volumeIntensity ?? 0,
      sizeScale: hd.values.volumeSizeScale ?? 0,
      outerIntensity: hd.values.volumeOuterIntensity ?? 0,
      outerExponent: hd.values.volumeOuterExponent ?? 1,
    },
    decorationPresetId: resolvedFamily.values.decorationPresetId,
  };
}
