/*
 * Значения по умолчанию для трёх наборов, которые правятся не ползунками, а
 * таблицами: профили эффектов оружия, материалы попаданий и погодные профили.
 * Рядом с каждым набором лежит его нормализатор — он и решает, что из чужого
 * JSON вообще имеет право попасть в проект.
 */

export const WEAPON_EFFECT_PROFILE_KEYS = Object.freeze([
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "machinegun",
  "heavy",
]);
export const IMPACT_MATERIAL_KEYS = Object.freeze([
  "metal",
  "concrete",
  "stone",
  "wood",
  "glass",
  "earth",
  "water",
  "vehicle",
  "character",
]);
export const WEATHER_PROFILE_KEYS = Object.freeze([
  "clear",
  "sunny",
  "cloudy",
  "overcast",
  "fog",
  "rain",
  "storm",
  "smog",
  "snow",
]);

const WEAPON_EFFECT_PROFILE_DEFAULTS = Object.freeze({
  flashScale: 100,
  smokeScale: 100,
  shellScale: 100,
  lightScale: 100,
});
export const IMPACT_MATERIAL_DEFAULTS = Object.freeze({
  particle: "debris",
  color: "#d9c39f",
  particles: 24,
  size: 42,
  speed: 68,
  sparks: 20,
  dust: 44,
  shards: 12,
  decal: "bullet",
  decalSize: 36,
  decalOpacity: 74,
  duration: 24,
  sound: "impact",
  intensity: 100,
});
const WEATHER_PROFILE_DEFAULTS = Object.freeze({
  clouds: 36,
  cloudColor: "#a8b4c6",
  cloudSpeed: 24,
  rain: 0,
  rainDropSize: 100,
  visibility: 92,
  fog: 8,
  thunderVolume: 70,
  lightningFrequency: 0,
  lightningBrightness: 100,
  wetness: 8,
  reflections: 62,
  wind: 22,
  sky: "#6f9bc5",
  transition: 12,
});
export const WEATHER_PROFILE_VALUE_KEYS = Object.freeze(
  Object.keys(WEATHER_PROFILE_DEFAULTS),
);

const impactMaterial = (patch = {}) => ({
  ...IMPACT_MATERIAL_DEFAULTS,
  ...patch,
});
export const DEFAULT_IMPACT_MATERIALS = Object.freeze({
  metal: impactMaterial({
    particle: "sparks",
    color: "#ffd089",
    particles: 34,
    sparks: 92,
    dust: 8,
    shards: 28,
    sound: "metal",
    intensity: 118,
  }),
  concrete: impactMaterial({
    particle: "dust",
    color: "#d5c1a2",
    particles: 42,
    dust: 78,
    shards: 26,
    sound: "concrete",
  }),
  stone: impactMaterial({
    particle: "chips",
    color: "#b9ad9c",
    particles: 36,
    dust: 62,
    shards: 44,
    sound: "stone",
  }),
  wood: impactMaterial({
    particle: "splinters",
    color: "#b9824d",
    particles: 30,
    sparks: 2,
    dust: 34,
    shards: 70,
    sound: "wood",
  }),
  glass: impactMaterial({
    particle: "glass",
    color: "#bfe8f3",
    particles: 58,
    size: 28,
    sparks: 20,
    dust: 4,
    shards: 100,
    decal: "crack",
    sound: "glass",
    intensity: 112,
  }),
  earth: impactMaterial({
    particle: "soil",
    color: "#9a744f",
    particles: 46,
    size: 54,
    dust: 92,
    shards: 8,
    decal: "none",
    sound: "earth",
  }),
  water: impactMaterial({
    particle: "splash",
    color: "#9edbf1",
    particles: 38,
    size: 62,
    speed: 82,
    sparks: 0,
    dust: 0,
    shards: 0,
    decal: "none",
    sound: "water",
  }),
  vehicle: impactMaterial({
    particle: "sparks",
    color: "#ffe0a0",
    particles: 40,
    sparks: 82,
    dust: 14,
    shards: 46,
    sound: "metal",
    intensity: 120,
  }),
  character: impactMaterial({
    particle: "blood",
    color: "#8f1f2a",
    particles: 24,
    size: 34,
    speed: 58,
    sparks: 0,
    dust: 0,
    shards: 0,
    decal: "blood",
    sound: "flesh",
    intensity: 88,
  }),
});

const weatherProfile = (patch = {}) => ({
  ...WEATHER_PROFILE_DEFAULTS,
  ...patch,
});
export const DEFAULT_WEATHER_PROFILES = Object.freeze({
  clear: weatherProfile({
    clouds: 12,
    cloudColor: "#e3edf7",
    cloudSpeed: 16,
    visibility: 100,
    fog: 2,
    wetness: 0,
    reflections: 58,
    wind: 10,
    sky: "#68a9e2",
  }),
  sunny: weatherProfile({
    clouds: 22,
    cloudColor: "#f2ead8",
    cloudSpeed: 18,
    visibility: 98,
    fog: 3,
    wetness: 0,
    reflections: 72,
    wind: 14,
    sky: "#4f9edc",
  }),
  cloudy: weatherProfile({
    clouds: 58,
    cloudColor: "#8997ac",
    cloudSpeed: 24,
    rain: 18,
    visibility: 82,
    fog: 18,
    wetness: 36,
    reflections: 62,
    wind: 28,
    sky: "#566a8e",
  }),
  overcast: weatherProfile({
    clouds: 88,
    cloudColor: "#747d8c",
    cloudSpeed: 34,
    rain: 12,
    visibility: 68,
    fog: 30,
    wetness: 42,
    reflections: 52,
    wind: 42,
    sky: "#505a6b",
  }),
  fog: weatherProfile({
    clouds: 44,
    cloudColor: "#b7b9b8",
    cloudSpeed: 10,
    visibility: 28,
    fog: 82,
    wetness: 18,
    reflections: 38,
    wind: 6,
    sky: "#9aa4a6",
    transition: 18,
  }),
  rain: weatherProfile({
    clouds: 92,
    cloudColor: "#596372",
    cloudSpeed: 54,
    rain: 78,
    rainDropSize: 116,
    visibility: 54,
    fog: 46,
    thunderVolume: 48,
    lightningFrequency: 8,
    wetness: 94,
    reflections: 104,
    wind: 58,
    sky: "#394a61",
  }),
  storm: weatherProfile({
    clouds: 100,
    cloudColor: "#3f4654",
    cloudSpeed: 82,
    rain: 96,
    rainDropSize: 138,
    visibility: 38,
    fog: 58,
    thunderVolume: 112,
    lightningFrequency: 72,
    lightningBrightness: 170,
    wetness: 100,
    reflections: 116,
    wind: 88,
    sky: "#28354c",
    transition: 8,
  }),
  smog: weatherProfile({
    clouds: 64,
    cloudColor: "#aa9878",
    cloudSpeed: 8,
    visibility: 34,
    fog: 74,
    thunderVolume: 0,
    wetness: 4,
    reflections: 34,
    wind: 5,
    sky: "#8f765c",
    transition: 20,
  }),
  snow: weatherProfile({
    clouds: 84,
    cloudColor: "#d8e0e7",
    cloudSpeed: 32,
    rain: 42,
    rainDropSize: 76,
    visibility: 46,
    fog: 64,
    thunderVolume: 12,
    lightningFrequency: 2,
    wetness: 78,
    reflections: 86,
    wind: 46,
    sky: "#a6b5c5",
    transition: 16,
  }),
});

export function normalizeWeaponEffectProfiles(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const profileScale = (candidate, fallback) =>
    Number.isFinite(Number(candidate))
      ? Math.max(0, Math.min(200, Number(candidate)))
      : fallback;
  return Object.fromEntries(
    WEAPON_EFFECT_PROFILE_KEYS.map((key) => [
      key,
      {
        flashScale: Math.max(
          25,
          profileScale(
            source[key]?.flashScale,
            WEAPON_EFFECT_PROFILE_DEFAULTS.flashScale,
          ),
        ),
        smokeScale: profileScale(
          source[key]?.smokeScale,
          WEAPON_EFFECT_PROFILE_DEFAULTS.smokeScale,
        ),
        shellScale: profileScale(
          source[key]?.shellScale,
          WEAPON_EFFECT_PROFILE_DEFAULTS.shellScale,
        ),
        lightScale: profileScale(
          source[key]?.lightScale,
          WEAPON_EFFECT_PROFILE_DEFAULTS.lightScale,
        ),
      },
    ]),
  );
}

export function normalizeImpactMaterials(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    IMPACT_MATERIAL_KEYS.map((key) => [
      key,
      {
        ...DEFAULT_IMPACT_MATERIALS[key],
        ...(source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
          ? source[key]
          : {}),
      },
    ]),
  );
}

export function normalizeWeatherProfiles(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const bounds = {
    clouds: [0, 100],
    cloudSpeed: [0, 100],
    rain: [0, 100],
    rainDropSize: [40, 180],
    visibility: [10, 100],
    fog: [0, 100],
    thunderVolume: [0, 120],
    lightningFrequency: [0, 100],
    lightningBrightness: [0, 200],
    wetness: [0, 100],
    reflections: [0, 120],
    wind: [0, 100],
    transition: [1, 60],
  };
  return Object.fromEntries(
    WEATHER_PROFILE_KEYS.map((key) => {
      const fallback = DEFAULT_WEATHER_PROFILES[key];
      const candidate =
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
          ? source[key]
          : {};
      const normalized = { ...fallback };
      for (const field of WEATHER_PROFILE_VALUE_KEYS) {
        if (field === "cloudColor" || field === "sky")
          normalized[field] = /^#[0-9a-f]{6}$/i.test(
            String(candidate[field] || ""),
          )
            ? String(candidate[field])
            : fallback[field];
        else {
          const [minimum, maximum] = bounds[field];
          const number = Number(candidate[field]);
          normalized[field] = Number.isFinite(number)
            ? Math.max(minimum, Math.min(maximum, number))
            : fallback[field];
        }
      }
      return [key, normalized];
    }),
  );
}
