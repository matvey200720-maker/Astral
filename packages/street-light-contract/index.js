export const STREET_LIGHT_DESIGN_SCHEMA = "astral-street-light-design/v1";
export const STREET_LIGHT_BINDING_SCHEMA = "astral-street-light-binding/v1";
export const STREET_LIGHT_PRESET_SCHEMA = "astral-street-light-preset/v1";
export const STREET_LIGHT_MODULE_SCHEMA_VERSION = 1;
export const STREET_LIGHT_COMPILER_VERSION = "street-light-resolver-v1";
export const STREET_LIGHT_COLOR_PROFILE = "srgb-cct-v1";

export * from "./canonical.js";
export * from "./registry.js";

export const STREET_LIGHT_PROJECT_TARGETS = Object.freeze([
  "gta5-legacy-story",
  "gta5-enhanced-story",
  "fivem",
]);

const STATIC_BINDING_TARGETS = new Set([
  "gta5-legacy-story",
  "gta5-enhanced-story",
]);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const RGB_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DESIGN_KEYS = [
  "schema",
  "designId",
  "name",
  "light",
  "corona",
  "volumetric",
  "decoration",
];
const VALUE_KEYS = ["light", "corona", "volumetric", "decoration"];

const fail = (path, message) => {
  throw new Error(`${path}: ${message}`);
};

function plainObject(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(path, "ожидался plain object.");
  }
  return value;
}

function exactKeys(value, allowed, path) {
  plainObject(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(path, `ожидались только поля: ${allowed.join(", ")}.`);
  }
  return value;
}

function finiteNumber(value, path, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    fail(path, `ожидалось конечное число от ${minimum} до ${maximum}.`);
  return Object.is(value, -0) ? 0 : value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") fail(path, "ожидалось boolean-значение.");
  return value;
}

function id(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    fail(path, "ожидался безопасный идентификатор без путей и пробелов.");
  return value;
}

function name(value, path) {
  if (typeof value !== "string") fail(path, "ожидалась строка.");
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 80)
    fail(path, "длина должна быть от 1 до 80 символов.");
  return normalized;
}

function enumValue(value, allowed, path) {
  if (!allowed.includes(value))
    fail(path, `ожидалось одно из значений: ${allowed.join(", ")}.`);
  return value;
}

function rgb(value, path) {
  if (typeof value !== "string" || !RGB_PATTERN.test(value))
    fail(path, "ожидался цвет #RRGGBB.");
  return value.toUpperCase();
}

function normalizeColor(value, path) {
  plainObject(value, path);
  if (value.mode === "rgb") {
    exactKeys(value, ["mode", "rgb"], path);
    return { mode: "rgb", rgb: rgb(value.rgb, `${path}.rgb`) };
  }
  if (value.mode === "temperature") {
    exactKeys(value, ["mode", "kelvin"], path);
    return {
      mode: "temperature",
      kelvin: finiteNumber(value.kelvin, `${path}.kelvin`, 1_000, 20_000),
    };
  }
  fail(`${path}.mode`, "ожидался rgb или temperature.");
}

function normalizeValues(input, path) {
  exactKeys(input, VALUE_KEYS, path);
  exactKeys(
    input.light,
    [
      "color",
      "intensityMultiplier",
      "rangeMultiplier",
      "falloffExponentMultiplier",
      "lightFadeDistanceMultiplier",
    ],
    `${path}.light`,
  );
  exactKeys(
    input.corona,
    ["enabled", "intensityMultiplier", "sizeMultiplier", "zBiasOffset"],
    `${path}.corona`,
  );
  exactKeys(
    input.volumetric,
    [
      "enabled",
      "intensityMultiplier",
      "sizeScaleMultiplier",
      "outerIntensityMultiplier",
      "outerExponentMultiplier",
      "fadeDistanceMultiplier",
    ],
    `${path}.volumetric`,
  );
  exactKeys(
    input.decoration,
    [
      "presetId",
      "scaleMultiplier",
      "probabilityMultiplier",
      "colorMode",
      "color",
    ],
    `${path}.decoration`,
  );
  return {
    light: {
      color: normalizeColor(input.light.color, `${path}.light.color`),
      intensityMultiplier: finiteNumber(
        input.light.intensityMultiplier,
        `${path}.light.intensityMultiplier`,
        0,
        16,
      ),
      rangeMultiplier: finiteNumber(
        input.light.rangeMultiplier,
        `${path}.light.rangeMultiplier`,
        0.05,
        8,
      ),
      falloffExponentMultiplier: finiteNumber(
        input.light.falloffExponentMultiplier,
        `${path}.light.falloffExponentMultiplier`,
        0.05,
        8,
      ),
      lightFadeDistanceMultiplier: finiteNumber(
        input.light.lightFadeDistanceMultiplier,
        `${path}.light.lightFadeDistanceMultiplier`,
        0,
        8,
      ),
    },
    corona: {
      enabled: boolean(input.corona.enabled, `${path}.corona.enabled`),
      intensityMultiplier: finiteNumber(
        input.corona.intensityMultiplier,
        `${path}.corona.intensityMultiplier`,
        0,
        16,
      ),
      sizeMultiplier: finiteNumber(
        input.corona.sizeMultiplier,
        `${path}.corona.sizeMultiplier`,
        0,
        8,
      ),
      zBiasOffset: finiteNumber(
        input.corona.zBiasOffset,
        `${path}.corona.zBiasOffset`,
        -16,
        16,
      ),
    },
    volumetric: {
      enabled: boolean(input.volumetric.enabled, `${path}.volumetric.enabled`),
      intensityMultiplier: finiteNumber(
        input.volumetric.intensityMultiplier,
        `${path}.volumetric.intensityMultiplier`,
        0,
        16,
      ),
      sizeScaleMultiplier: finiteNumber(
        input.volumetric.sizeScaleMultiplier,
        `${path}.volumetric.sizeScaleMultiplier`,
        0,
        8,
      ),
      outerIntensityMultiplier: finiteNumber(
        input.volumetric.outerIntensityMultiplier,
        `${path}.volumetric.outerIntensityMultiplier`,
        0,
        16,
      ),
      outerExponentMultiplier: finiteNumber(
        input.volumetric.outerExponentMultiplier,
        `${path}.volumetric.outerExponentMultiplier`,
        0.05,
        8,
      ),
      fadeDistanceMultiplier: finiteNumber(
        input.volumetric.fadeDistanceMultiplier,
        `${path}.volumetric.fadeDistanceMultiplier`,
        0,
        8,
      ),
    },
    decoration: {
      presetId: id(input.decoration.presetId, `${path}.decoration.presetId`),
      scaleMultiplier: finiteNumber(
        input.decoration.scaleMultiplier,
        `${path}.decoration.scaleMultiplier`,
        0.1,
        8,
      ),
      probabilityMultiplier: finiteNumber(
        input.decoration.probabilityMultiplier,
        `${path}.decoration.probabilityMultiplier`,
        0,
        8,
      ),
      colorMode: enumValue(
        input.decoration.colorMode,
        ["inherit", "custom"],
        `${path}.decoration.colorMode`,
      ),
      color: rgb(input.decoration.color, `${path}.decoration.color`),
    },
  };
}

export function normalizeStreetLightDesign(input, path = "design") {
  exactKeys(input, DESIGN_KEYS, path);
  if (input.schema !== STREET_LIGHT_DESIGN_SCHEMA)
    fail(`${path}.schema`, "неподдерживаемая schema дизайна.");
  return {
    schema: STREET_LIGHT_DESIGN_SCHEMA,
    designId: id(input.designId, `${path}.designId`),
    name: name(input.name, `${path}.name`),
    ...normalizeValues(
      {
        light: input.light,
        corona: input.corona,
        volumetric: input.volumetric,
        decoration: input.decoration,
      },
      path,
    ),
  };
}

export function normalizeStreetLightBinding(
  input,
  { designId, projectTarget } = {},
  path = "binding",
) {
  exactKeys(
    input,
    ["schema", "bindingId", "designId", "profileId", "familyIds"],
    path,
  );
  if (input.schema !== STREET_LIGHT_BINDING_SCHEMA)
    fail(`${path}.schema`, "неподдерживаемая schema binding.");
  if (!STATIC_BINDING_TARGETS.has(projectTarget))
    fail(
      path,
      "static binding разрешён только для Legacy/Enhanced Story target.",
    );
  if (
    !Array.isArray(input.familyIds) ||
    input.familyIds.length < 1 ||
    input.familyIds.length > 128
  )
    fail(`${path}.familyIds`, "нужно выбрать от 1 до 128 семейств.");
  const familyIds = [
    ...new Set(
      input.familyIds.map((value, index) =>
        id(value, `${path}.familyIds[${index}]`),
      ),
    ),
  ].sort();
  if (familyIds.length !== input.familyIds.length)
    fail(`${path}.familyIds`, "дубликаты семейств запрещены.");
  const normalized = {
    schema: STREET_LIGHT_BINDING_SCHEMA,
    bindingId: id(input.bindingId, `${path}.bindingId`),
    designId: id(input.designId, `${path}.designId`),
    profileId: id(input.profileId, `${path}.profileId`),
    familyIds,
  };
  if (designId && normalized.designId !== designId)
    fail(`${path}.designId`, "binding ссылается на другой design.");
  return normalized;
}

export function normalizeStreetLightPreset(input, path = "preset") {
  exactKeys(input, ["schema", "values"], path);
  if (input.schema !== STREET_LIGHT_PRESET_SCHEMA)
    fail(`${path}.schema`, "неподдерживаемая schema preset.");
  return {
    schema: STREET_LIGHT_PRESET_SCHEMA,
    values: normalizeValues(input.values, `${path}.values`),
  };
}

export function applyStreetLightPreset(designInput, presetInput) {
  const design = normalizeStreetLightDesign(designInput);
  const preset = normalizeStreetLightPreset(presetInput);
  return normalizeStreetLightDesign({
    ...design,
    ...preset.values,
    designId: design.designId,
    name: design.name,
  });
}

export function createDefaultStreetLightDesign(
  designId,
  designName = "Новый стиль фонарей",
) {
  return normalizeStreetLightDesign({
    schema: STREET_LIGHT_DESIGN_SCHEMA,
    designId,
    name: designName,
    light: {
      color: { mode: "temperature", kelvin: 3_200 },
      intensityMultiplier: 1,
      rangeMultiplier: 1,
      falloffExponentMultiplier: 1,
      lightFadeDistanceMultiplier: 1,
    },
    corona: {
      enabled: true,
      intensityMultiplier: 1,
      sizeMultiplier: 1,
      zBiasOffset: 0,
    },
    volumetric: {
      enabled: true,
      intensityMultiplier: 1,
      sizeScaleMultiplier: 1,
      outerIntensityMultiplier: 1,
      outerExponentMultiplier: 1,
      fadeDistanceMultiplier: 1,
    },
    decoration: {
      presetId: "none",
      scaleMultiplier: 1,
      probabilityMultiplier: 1,
      colorMode: "inherit",
      color: "#FFFFFF",
    },
  });
}

function channel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// Versioned CCT approximation. Kelvin remains authoritative; this function is
// the single conversion used by preview and compiler in schema V1.
export function kelvinToStreetLightRgb(kelvin) {
  const temperature = finiteNumber(kelvin, "kelvin", 1_000, 20_000) / 100;
  const red =
    temperature <= 66
      ? 255
      : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green =
    temperature <= 66
      ? 99.4708025861 * Math.log(temperature) - 161.1195681661
      : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue =
    temperature >= 66
      ? 255
      : temperature <= 19
        ? 0
        : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  return { r: channel(red), g: channel(green), b: channel(blue) };
}

export function resolveStreetLightRgb(colorInput) {
  const color = normalizeColor(colorInput, "color");
  if (color.mode === "temperature") return kelvinToStreetLightRgb(color.kelvin);
  return {
    r: Number.parseInt(color.rgb.slice(1, 3), 16),
    g: Number.parseInt(color.rgb.slice(3, 5), 16),
    b: Number.parseInt(color.rgb.slice(5, 7), 16),
  };
}

export function resolveBaselineMultiplier({
  baseline,
  multiplier,
  minimum,
  maximum,
  integer = false,
  path,
}) {
  finiteNumber(baseline, `${path}.baseline`, -1_000_000, 1_000_000);
  finiteNumber(multiplier, `${path}.multiplier`, 0, 64);
  finiteNumber(minimum, `${path}.minimum`, -1_000_000, 1_000_000);
  finiteNumber(maximum, `${path}.maximum`, -1_000_000, 1_000_000);
  if (minimum > maximum) fail(path, "minimum больше maximum.");
  const requested = baseline * multiplier;
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

export function normalizeStreetLightModule(
  input,
  projectTarget,
  path = "streetLights",
) {
  exactKeys(input, ["schemaVersion", "design", "binding"], path);
  if (input.schemaVersion !== STREET_LIGHT_MODULE_SCHEMA_VERSION)
    fail(`${path}.schemaVersion`, "неподдерживаемая module schema.");
  enumValue(projectTarget, STREET_LIGHT_PROJECT_TARGETS, "project.target");
  const design = normalizeStreetLightDesign(input.design, `${path}.design`);
  return {
    schemaVersion: STREET_LIGHT_MODULE_SCHEMA_VERSION,
    design,
    binding:
      input.binding === null
        ? null
        : normalizeStreetLightBinding(
            input.binding,
            { designId: design.designId, projectTarget },
            `${path}.binding`,
          ),
  };
}
