// Единая таблица страницы «Настройки графики» (GTA V): ключи settings.xml, которые правит человек,
// допустимые значения, готовые шаблоны, справка и небольшие чистые функции поверх таблиц.
// Файлов не читает и не пишет; побочных действий при импорте нет.

export const GRAPHICS_SCHEMA = 1;

// ---------------------------------------------------------------- группы и масштаб кадра

export const GRAPHICS_GROUPS = Object.freeze(
  [
    ["quality", "Качество", "Quality"],
    ["shadows", "Тени", "Shadows"],
    ["aa", "Сглаживание", "Anti-aliasing"],
    ["world", "Мир и дальность", "World and distance"],
    ["effects", "Кадр и эффекты", "Frame and effects"],
  ].map(([id, ru, en]) => Object.freeze({ id, label: [ru, en] })),
);

// В файле лежит не доля, а номер строки меню игры; порядок записей — порядок строк меню.
export const SAMPLING_STEPS = Object.freeze(
  [
    [1, 1 / 2],
    [2, 2 / 3],
    [3, 3 / 4],
    [4, 5 / 6],
    [0, 1],
    [5, 5 / 4],
    [6, 3 / 2],
    [7, 7 / 4],
    [8, 2],
    [9, 5 / 2],
  ].map(([value, scale]) => Object.freeze({ value, scale })),
);

const SCALE_BY_STEP = new Map(SAMPLING_STEPS.map((step) => [step.value, step.scale]));
const STEPS_NOT_ABOVE_FULL = SAMPLING_STEPS.filter((step) => step.scale <= 1);

// ---------------------------------------------------------------- параметры

const LABEL = {
  off: ["Выкл.", "Off"],
  normal: ["Нормально", "Normal"],
  high: ["Высоко", "High"],
  veryHigh: ["Очень высоко", "Very high"],
  ultra: ["Ультра", "Ultra"],
  below: ["Ниже мин.", "Below min"],
  multiplier: (n) => [`×${n}`, `×${n}`],
};

const option = (value, [ru, en]) => Object.freeze({ value, label: [ru, en] });
const optionList = (...entries) => Object.freeze(entries.map(([value, label]) => option(value, label)));

const scaleParam = (key, group, label, min, max) =>
  Object.freeze({ key, group, kind: "scale", label, hint: null, min, max });
const levelParam = (key, group, label, options, hint = null) =>
  Object.freeze({ key, group, kind: "level", label, hint, options });
const toggleParam = (key, group, label, hint = null) =>
  Object.freeze({ key, group, kind: "toggle", label, hint });
const shareParam = (key, group, label, min, max, accepts) =>
  Object.freeze({ key, group, kind: "share", label, hint: null, min, max, accepts: Object.freeze(accepts) });

const normalToVeryHigh = () =>
  optionList([0, LABEL.normal], [1, LABEL.high], [2, LABEL.veryHigh]);
const normalToUltra = () =>
  optionList([0, LABEL.normal], [1, LABEL.high], [2, LABEL.veryHigh], [3, LABEL.ultra]);
const belowToVeryHigh = () =>
  optionList([-1, LABEL.below], [0, LABEL.normal], [1, LABEL.high], [2, LABEL.veryHigh]);
const offToVeryHigh = () =>
  optionList([0, LABEL.off], [1, LABEL.normal], [2, LABEL.high], [3, LABEL.veryHigh]);
const multisampling = () =>
  optionList([0, LABEL.off], [2, LABEL.multiplier(2)], [4, LABEL.multiplier(4)], [8, LABEL.multiplier(8)]);

export const GRAPHICS_PARAMETERS = Object.freeze([
  scaleParam("SamplingMode", "quality", ["Масштаб кадра", "Frame scaling"], 0.5, 1),
  levelParam("TextureQuality", "quality", ["Текстуры", "Textures"], normalToVeryHigh()),
  levelParam("ShaderQuality", "quality", ["Шейдеры", "Shaders"], normalToVeryHigh()),
  levelParam("ReflectionQuality", "quality", ["Отражения", "Reflections"], normalToUltra()),
  levelParam("WaterQuality", "quality", ["Вода", "Water"], belowToVeryHigh()),
  levelParam("ParticleQuality", "quality", ["Частицы", "Particles"], belowToVeryHigh()),
  levelParam("GrassQuality", "quality", ["Трава", "Grass"], normalToUltra()),
  levelParam("PostFX", "quality", ["Постобработка", "Post FX"], normalToUltra()),
  levelParam(
    "SSAO",
    "quality",
    ["Затенение (SSAO)", "Ambient occlusion"],
    optionList([0, LABEL.off], [1, LABEL.normal], [2, LABEL.high]),
  ),
  levelParam("Tessellation", "quality", ["Тесселяция", "Tessellation"], offToVeryHigh()),
  levelParam(
    "AnisotropicFiltering",
    "quality",
    ["Анизотропная фильтрация", "Anisotropic filtering"],
    optionList(
      [0, LABEL.off],
      [2, LABEL.multiplier(2)],
      [4, LABEL.multiplier(4)],
      [8, LABEL.multiplier(8)],
      [16, LABEL.multiplier(16)],
    ),
  ),
  levelParam("ShadowQuality", "shadows", ["Качество теней", "Shadow quality"], offToVeryHigh()),
  levelParam(
    "Shadow_SoftShadows",
    "shadows",
    ["Мягкость теней", "Soft shadows"],
    optionList(
      [0, ["Резкие", "Sharp"]],
      [1, ["Мягкие", "Soft"]],
      [2, ["Мягче", "Softer"]],
      [3, ["Самые мягкие", "Softest"]],
      [4, ["AMD CHS", "AMD CHS"]],
      [5, ["Nvidia PCSS", "Nvidia PCSS"]],
    ),
    ["AMD CHS — только AMD, Nvidia PCSS — только Nvidia", "AMD CHS — AMD only, Nvidia PCSS — Nvidia only"],
  ),
  toggleParam("UltraShadows_Enabled", "shadows", ["Тени высокой чёткости", "High resolution shadows"]),
  toggleParam("Shadow_LongShadows", "shadows", ["Длинные тени", "Long shadows"]),
  toggleParam("Shadow_ParticleShadows", "shadows", ["Тени от частиц", "Particle shadows"]),
  shareParam("Shadow_Distance", "shadows", ["Дальность теней", "Shadow distance"], 0, 1, [0, 1]),
  levelParam("MSAA", "aa", ["MSAA", "MSAA"], multisampling()),
  levelParam("ReflectionMSAA", "aa", ["MSAA отражений", "Reflection MSAA"], multisampling()),
  toggleParam("FXAA_Enabled", "aa", ["FXAA", "FXAA"]),
  toggleParam("TXAA_Enabled", "aa", ["TXAA", "TXAA"], ["Только NVIDIA и вместе с MSAA", "NVIDIA only, with MSAA"]),
  shareParam("LodScale", "world", ["Дальность прорисовки", "Distance scaling"], 0, 1, [0, 1]),
  shareParam("MaxLodScale", "world", ["Увеличенная дальность", "Extended distance scaling"], 0, 1, [0, 1]),
  shareParam("PedLodBias", "world", ["Детализация людей вдали", "Distant ped detail"], -0.5, 1, [-1, 1]),
  shareParam("VehicleLodBias", "world", ["Детализация машин вдали", "Distant vehicle detail"], -0.5, 1, [-1, 1]),
  shareParam("CityDensity", "world", ["Плотность машин и людей", "Traffic and ped density"], -0.5, 1, [-1, 1]),
  shareParam("PedVarietyMultiplier", "world", ["Разнообразие людей", "Ped variety"], 0, 1, [-100, 1]),
  shareParam("VehicleVarietyMultiplier", "world", ["Разнообразие машин", "Vehicle variety"], 0, 1, [-100, 1]),
  toggleParam("HdStreamingInFlight", "world", [
    "Детальная подгрузка в полёте",
    "High detail streaming while flying",
  ]),
  shareParam("MotionBlurStrength", "effects", ["Размытие в движении", "Motion blur"], 0, 1, [0, 1]),
  toggleParam("DoF", "effects", ["Глубина резкости", "Depth of field"]),
  toggleParam("Lighting_FogVolumes", "effects", ["Объёмный туман", "Fog volumes"]),
  toggleParam("Reflection_MipBlur", "effects", ["Размытие отражений", "Reflection blur"]),
  levelParam(
    "VSync",
    "effects",
    ["Вертикальная синхронизация", "VSync"],
    optionList([0, LABEL.off], [1, ["Вкл.", "On"]], [2, ["Половина", "Half"]]),
  ),
]);

const PARAMETER_BY_KEY = new Map(GRAPHICS_PARAMETERS.map((param) => [param.key, param]));
const LEVEL_VALUES = new Map(
  GRAPHICS_PARAMETERS.filter((param) => param.kind === "level").map((param) => [
    param.key,
    new Set(param.options.map((item) => item.value)),
  ]),
);

// ---------------------------------------------------------------- справка

// [ключ, что, выигрыш в кадрах, значения ниже меню игры или null, пометка или null]
const DETAIL_ROWS = [
  [
    "SamplingMode",
    ["Игра рисует меньше точек и растягивает кадр до экрана", "The game renders fewer pixels and upscales the frame"],
    ["50 % — до +60–100 % (мыльно), 75 % — до +40 %", "50 % — up to +60–100 % (blurry), 75 % — up to +40 %"],
    [1, 2, 3, 4],
    null,
  ],
  [
    "TextureQuality",
    ["Чёткость текстур; ест видеопамять", "Texture sharpness; uses video memory"],
    ["почти 0, пока хватает видеопамяти; иначе убирает рывки", "≈0 while VRAM lasts; otherwise removes stutter"],
    null,
    [
      "Ниже «Нормально» — «Ухудшение текстур» в Мастерской → Оптимизация",
      "Below Normal — “Texture downgrade” in Workshop → Optimization",
    ],
  ],
  [
    "ShaderQuality",
    ["Сложность освещения материалов", "Material lighting complexity"],
    ["до +10 %", "up to +10 %"],
    null,
    null,
  ],
  [
    "ReflectionQuality",
    ["Отражения в машинах, окнах и воде", "Reflections on cars, windows and water"],
    ["до +5–10 %", "up to +5–10 %"],
    null,
    null,
  ],
  [
    "WaterQuality",
    ["Волны и отражения воды", "Waves and water reflections"],
    ["до +5 %; «Ниже мин.» — ещё +2–3 %", "up to +5 %; “Below min” — another +2–3 %"],
    [-1],
    null,
  ],
  [
    "ParticleQuality",
    ["Дым, искры, взрывы", "Smoke, sparks, explosions"],
    ["до +5 % в перестрелках; «Ниже мин.» — ещё +2–3 %", "up to +5 % in gunfights; “Below min” — another +2–3 %"],
    [-1],
    null,
  ],
  [
    "GrassQuality",
    ["Густота и тени травы", "Grass density and shadows"],
    ["за городом до +20–30 %", "up to +20–30 % outside the city"],
    null,
    null,
  ],
  [
    "PostFX",
    ["Свечение, блики, размытие кадра", "Bloom, flares, frame blur"],
    ["до +10 %", "up to +10 %"],
    null,
    null,
  ],
  [
    "SSAO",
    ["Мягкие тени в углах и под предметами", "Soft shadows in corners and under objects"],
    ["до +5–10 %", "up to +5–10 %"],
    null,
    null,
  ],
  [
    "Tessellation",
    ["Объём деревьев и камней вблизи", "Depth of trees and rocks up close"],
    ["до +3–5 %", "up to +3–5 %"],
    null,
    null,
  ],
  [
    "AnisotropicFiltering",
    ["Чёткость дороги под углом", "Road sharpness at an angle"],
    ["до +1–2 %", "up to +1–2 %"],
    null,
    null,
  ],
  [
    "ShadowQuality",
    ["Тени от солнца и фонарей", "Sun and lamp shadows"],
    ["до +10 %; «Выкл.» — ещё +10–15 %", "up to +10 %; “Off” — another +10–15 %"],
    [0],
    null,
  ],
  [
    "Shadow_SoftShadows",
    ["Размытие края тени", "Shadow edge softness"],
    ["до +5 %", "up to +5 %"],
    null,
    null,
  ],
  [
    "UltraShadows_Enabled",
    ["Тени в высоком разрешении", "High-resolution shadow maps"],
    ["до +5–10 %", "up to +5–10 %"],
    null,
    null,
  ],
  [
    "Shadow_LongShadows",
    ["Длинные тени на закате", "Long shadows at sunset"],
    ["до +2 %", "up to +2 %"],
    null,
    null,
  ],
  [
    "Shadow_ParticleShadows",
    ["Тени от дыма и огня", "Shadows from smoke and fire"],
    ["до +2 %", "up to +2 %"],
    null,
    null,
  ],
  [
    "Shadow_Distance",
    ["Как далеко видны тени; 0 — только рядом", "How far shadows reach; 0 — only nearby"],
    ["до +5 %", "up to +5 %"],
    null,
    null,
  ],
  [
    "MSAA",
    ["Сглаживание краёв", "Edge anti-aliasing"],
    ["×4 съедает до 30–40 %", "×4 costs up to 30–40 %"],
    null,
    null,
  ],
  [
    "ReflectionMSAA",
    ["Сглаживание в отражениях", "Anti-aliasing in reflections"],
    ["до +3–5 %", "up to +3–5 %"],
    null,
    null,
  ],
  ["FXAA_Enabled", ["Дешёвое сглаживание", "Cheap anti-aliasing"], ["≈1 %", "≈1 %"], null, null],
  [
    "TXAA_Enabled",
    ["Сглаживание NVIDIA поверх MSAA", "NVIDIA anti-aliasing on top of MSAA"],
    ["до +5 %", "up to +5 %"],
    null,
    null,
  ],
  [
    "LodScale",
    ["Сколько подробностей видно вдали", "Detail at distance"],
    ["до +10–15 %", "up to +10–15 %"],
    null,
    null,
  ],
  [
    "MaxLodScale",
    ["Ещё дальше «Дальности прорисовки»; грузит процессор", "Beyond draw distance; CPU heavy"],
    ["до +10–20 %", "up to +10–20 %"],
    null,
    null,
  ],
  [
    "PedLodBias",
    ["Когда люди вдали упрощаются; ниже нуля — раньше", "When distant peds simplify; below zero — sooner"],
    ["до +2–3 %", "up to +2–3 %"],
    null,
    null,
  ],
  [
    "VehicleLodBias",
    ["Когда машины вдали упрощаются; ниже нуля — раньше", "When distant vehicles simplify; below zero — sooner"],
    ["до +2–3 %", "up to +2–3 %"],
    null,
    null,
  ],
  [
    "CityDensity",
    [
      "Сколько машин и прохожих на улицах; ниже нуля — меньше минимума игры",
      "How many cars and peds; below zero — under the game's minimum",
    ],
    ["в одиночной игре до +5–10 % (процессор)", "single player up to +5–10 % (CPU)"],
    null,
    [
      "На Majestic, GTA 5 RP и «Россия Онлайн» машин и людей задаёт сервер — даёт мало",
      "On Majestic, GTA 5 RP and Russia Online the server sets traffic — little effect",
    ],
  ],
  [
    "PedVarietyMultiplier",
    ["Сколько разных моделей людей держит память", "How many ped models stay in memory"],
    ["меньше памяти, +1–3 %", "less memory, +1–3 %"],
    null,
    null,
  ],
  [
    "VehicleVarietyMultiplier",
    ["Сколько разных моделей машин держит память", "How many vehicle models stay in memory"],
    ["меньше памяти, +1–3 %", "less memory, +1–3 %"],
    null,
    null,
  ],
  [
    "HdStreamingInFlight",
    ["Подробная подгрузка мира в полёте", "Detailed streaming while flying"],
    ["меньше рывков в полёте", "less stutter in flight"],
    null,
    null,
  ],
  [
    "MotionBlurStrength",
    ["Размытие при быстром движении", "Blur while moving fast"],
    ["≈1 %", "≈1 %"],
    null,
    null,
  ],
  [
    "DoF",
    ["Размытие фона в катсценах и прицеле", "Background blur in cutscenes and aiming"],
    ["до +3–5 %", "up to +3–5 %"],
    null,
    null,
  ],
  [
    "Lighting_FogVolumes",
    ["Лучи света в тумане", "Light shafts in fog"],
    ["ночью до +3–5 %", "at night up to +3–5 %"],
    null,
    null,
  ],
  ["Reflection_MipBlur", ["Размытие отражений", "Reflection blur"], ["≈1 %", "≈1 %"], null, null],
  [
    "VSync",
    [
      "Ждать экран: без разрывов кадра, но с задержкой",
      "Wait for the display: no tearing but more input lag",
    ],
    ["«Выкл.» — без потолка кадров", "“Off” — no frame cap"],
    null,
    null,
  ],
];

// Справка — обычный объект с прототипом (поиск по нему не защищён от имён вроде «constructor»).
export const GRAPHICS_DETAILS = Object.freeze(
  Object.fromEntries(
    DETAIL_ROWS.map(([key, what, fps, below, note]) => [key, Object.freeze({ what, fps, below, note })]),
  ),
);

// ---------------------------------------------------------------- особые ключи и список всех ключей

// Приходят только вместе с шаблонами: запись повторов, звук, трассировка лучей.
export const GRAPHICS_EXTRA_KEYS = Object.freeze(
  Object.fromEntries(
    [
      ["MSAAFragments", 0, 8],
      ["MSAAQuality", 0, 8],
      ["Shader_SSA"],
      ["numBytesPerReplayBlock", 1000000, 100000000],
      ["numReplayBlocks", 1, 100],
      ["maxSizeOfStreamingReplay", 128, 8192],
      ["maxFileStoreSize", 1024, 1000000],
      ["Audio3d"],
      ["Raytracing_Enabled"],
      ["RTShadows_Enabled"],
      ["RTAmbientOcclusion_Enabled"],
      ["RTReflection_Enabled"],
      ["RTIndirectDiffuse_Enabled"],
    ].map(([key, min, max]) => [
      key,
      Object.freeze(min === undefined ? { kind: "toggle" } : { kind: "number", min, max }),
    ]),
  ),
);

const EXTRA_BY_KEY = new Map(Object.entries(GRAPHICS_EXTRA_KEYS));

export const GRAPHICS_KEYS = Object.freeze([
  ...GRAPHICS_PARAMETERS.map((param) => param.key),
  ...EXTRA_BY_KEY.keys(),
]);

// ---------------------------------------------------------------- шаблоны

const PARAM_ORDER = GRAPHICS_PARAMETERS.map((param) => param.key);
const RAY_TRACING_KEYS = [
  "Raytracing_Enabled",
  "RTShadows_Enabled",
  "RTAmbientOcclusion_Enabled",
  "RTReflection_Enabled",
  "RTIndirectDiffuse_Enabled",
];
// Порядок записей с настоящих машин: у слабых шаблонов он свой, и он виден в контракте с сервером.
const FIELD_ORDER = [
  "Tessellation",
  "LodScale",
  "PedLodBias",
  "VehicleLodBias",
  "ShadowQuality",
  "ReflectionQuality",
  "ReflectionMSAA",
  "SSAO",
  "AnisotropicFiltering",
  "MSAA",
  "MSAAFragments",
  "MSAAQuality",
  "SamplingMode",
  "TextureQuality",
  "ParticleQuality",
  "WaterQuality",
  "GrassQuality",
  "ShaderQuality",
  "Shadow_SoftShadows",
  "UltraShadows_Enabled",
  "Shadow_ParticleShadows",
  "Shadow_Distance",
  "Shadow_LongShadows",
  "Reflection_MipBlur",
  "FXAA_Enabled",
  "TXAA_Enabled",
  "Lighting_FogVolumes",
  "Shader_SSA",
  "CityDensity",
  "PedVarietyMultiplier",
  "VehicleVarietyMultiplier",
  "PostFX",
  "DoF",
  "HdStreamingInFlight",
  "MaxLodScale",
  "MotionBlurStrength",
  "numBytesPerReplayBlock",
  "numReplayBlocks",
  "maxSizeOfStreamingReplay",
  "maxFileStoreSize",
  "Audio3d",
  "VSync",
];
const ENHANCED_ORDER = [...RAY_TRACING_KEYS, ...PARAM_ORDER];
const ENHANCED_EXTRA = ["MSAAFragments", "MSAAQuality", "Shader_SSA"];
const REPLAY_KEYS = ["numBytesPerReplayBlock", "numReplayBlocks", "maxSizeOfStreamingReplay", "maxFileStoreSize"];

const valuesOf = (keys, list) => {
  const values = {};
  keys.forEach((key, index) => {
    values[key] = list[index];
  });
  return Object.freeze(values);
};

const makeTemplate = (id, label, graphics, group, author, tier, keys, list) =>
  Object.freeze({ id, label, graphics, group, author, tier, values: valuesOf(keys, list) });

const noRayTracing = [false, false, false, false, false];

export const GRAPHICS_TEMPLATES = Object.freeze([
  makeTemplate(
    "astral-ultra",
    ["Топовые ПК", "High-end PCs"],
    ["Максимальные", "Maximum"],
    "astral",
    "Astral",
    "ultra",
    PARAM_ORDER,
    [0, 2, 2, 3, 2, 2, 3, 3, 2, 3, 16, 2, 3, true, true, true, 1, 2, 2, false, false, 1, 0.5, 0.2, 0, 1, 1, 1, true, 0, true, true, true, 1],
  ),
  makeTemplate(
    "astral-high",
    ["Мощные ПК", "Powerful PCs"],
    ["Высокие", "High"],
    "astral",
    "Astral",
    "high",
    PARAM_ORDER,
    [0, 2, 2, 2, 2, 2, 1, 2, 2, 2, 16, 1, 2, false, false, true, 1, 0, 0, true, false, 0.8, 0, 0.2, 0, 0.8, 0.8, 0.8, false, 0, true, true, true, 0],
  ),
  makeTemplate(
    "astral-medium",
    ["Средние ПК", "Mid-range PCs"],
    ["Сбалансированные", "Balanced"],
    "astral",
    "Astral",
    "medium",
    PARAM_ORDER,
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 8, 1, 1, false, false, false, 1, 0, 0, true, false, 0.5, 0, 0.1, 0, 0.6, 0.6, 0.6, false, 0, false, true, true, 0],
  ),
  makeTemplate(
    "vram-3600",
    ["Слабые ПК", "Low-end PCs"],
    ["Низкие", "Low"],
    "astral",
    "Astral",
    "low",
    FIELD_ORDER,
    [0, 0, 0, -0.5, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, -1, -1, 0, 0, 0, false, false, 0, false, false, true, false, false, false, -0.5, -20, -20, 0, false, false, 0, 0, 9000000, 30, 1024, 65536, false, 0],
  ),
  makeTemplate(
    "vram-27000",
    ["Ультраслабые ПК", "Entry-level PCs"],
    ["Минимальные", "Minimum"],
    "astral",
    "Astral",
    "ultra-low",
    FIELD_ORDER,
    [0, 0, 0.1, 0.1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, false, false, 1, false, false, false, false, false, false, 0, -50, -50, 0, false, false, 0, 0, 9000000, 30, 1024, 65536, false, 0],
  ),
  makeTemplate(
    "game-minimum",
    ["Минимум игры", "Game minimum"],
    ["Нижняя строка меню игры", "Lowest in-game menu values"],
    "astral",
    "Astral",
    "game-minimum",
    ENHANCED_ORDER,
    [...noRayTracing, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, false, false, false, 0, 0, 0, true, false, 0, 0, 0, 0, 0, 0, 0, false, 0, false, false, false, 0],
  ),
  makeTemplate(
    "below-minimum",
    ["Ниже минимума", "Below minimum"],
    ["Тени выкл., ниже меню игры", "Shadows off, below the game menu"],
    "astral",
    "Astral",
    "below-minimum",
    [...ENHANCED_ORDER, ...ENHANCED_EXTRA],
    [...noRayTracing, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, false, false, false, 0, 0, 0, true, false, 0, 0, 0, -0.5, -0.5, -20, -20, false, 0, false, false, false, 0, 0, 0, false],
  ),
  makeTemplate(
    "potato",
    ["Картошка", "Potato"],
    ["Всё в минус, кадр 50 %", "Everything down, 50 % frame"],
    "astral",
    "Astral",
    "potato",
    [...ENHANCED_ORDER, ...ENHANCED_EXTRA, ...REPLAY_KEYS],
    [...noRayTracing, 1, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, false, false, false, 0, 0, 0, false, false, 0, 0, -0.5, -0.5, -0.5, -50, -50, false, 0, false, false, false, 0, 0, 0, false, 9000000, 30, 1024, 65536],
  ),
  makeTemplate(
    "yukiko-vex",
    ["Средние ПК", "Mid-range PCs"],
    ["Низкие настройки", "Low settings"],
    "community",
    "Yukiko Vex",
    "medium",
    FIELD_ORDER,
    [0, 0, 0, -0.5, 1, 0, 0, 2, 16, 0, 0, 0, 0, 0, -1, -1, 0, 0, 0, false, false, 1, false, false, true, false, false, false, -0.5, -20, -20, 0, false, false, 0, 0, 9880000, 30, 2048, 95536, false, 0],
  ),
]);

const TEMPLATE_BY_ID = new Map(GRAPHICS_TEMPLATES.map((template) => [template.id, template]));

// ---------------------------------------------------------------- функции

export function samplingScale(value) {
  return SCALE_BY_STEP.get(Number(value)) ?? 1;
}

export function samplingModeFor(share) {
  let best = STEPS_NOT_ABOVE_FULL[0];
  let bestDistance = Infinity;
  for (const step of STEPS_NOT_ABOVE_FULL) {
    // Вычитание, а не Number(): символ и BigInt должны бросать TypeError именно здесь.
    const distance = Math.abs(step.scale - share);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best.value;
}

export function graphicsParameter(key) {
  return PARAMETER_BY_KEY.get(key) ?? null;
}

export function graphicsDetail(key) {
  return GRAPHICS_DETAILS[key] || null;
}

export function graphicsTemplate(id) {
  return TEMPLATE_BY_ID.get(id) ?? null;
}

export function graphicsBelowMinimum(key, value) {
  const below = graphicsDetail(key)?.below;
  if (Array.isArray(below) && below.includes(value)) return true;
  return graphicsParameter(key)?.kind === "share" && typeof value === "number" && value < 0;
}

const isFiniteWithin = (value, low, high) =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

const CHECK_BY_KIND = {
  toggle: (param, value) => typeof value === "boolean",
  scale: (param, value) => typeof value === "number" && SCALE_BY_STEP.has(value),
  level: (param, value) => LEVEL_VALUES.get(param.key).has(value),
  share: (param, value) => isFiniteWithin(value, param.accepts[0], param.accepts[1]),
  number: (param, value) => isFiniteWithin(value, param.min, param.max),
};

export function graphicsValueAllowed(key, value) {
  const param = PARAMETER_BY_KEY.get(key) ?? EXTRA_BY_KEY.get(key);
  return param ? CHECK_BY_KIND[param.kind](param, value) : false;
}

const ROUND_FACTOR = 1e6;

export function normalizeGraphicsValues(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Настройки графики: нужен набор значений.");
  }
  const result = {};
  let count = 0;
  for (const key of Object.keys(input)) {
    const original = input[key];
    const isShare = PARAMETER_BY_KEY.get(key)?.kind === "share";
    const value =
      isShare && typeof original === "number" ? Math.round(original * ROUND_FACTOR) / ROUND_FACTOR : original;
    if (!graphicsValueAllowed(key, value)) {
      throw new Error(`Настройки графики: недопустимое значение ${key}=${JSON.stringify(original) ?? "undefined"}.`);
    }
    result[key] = value;
    count += 1;
  }
  if (count === 0) throw new Error("Настройки графики: набор пуст.");
  return result;
}

export function graphicsValuesFrom(settings = {}) {
  const result = {};
  for (const key of GRAPHICS_KEYS) {
    if (key in settings) result[key] = settings[key];
  }
  return result;
}

// ---------------------------------------------------------------- оценка видеопамяти

const SCREEN_FLOOR = { width: 800, height: 600 };
const SCREEN_FALLBACK = { width: 1920, height: 1080 };
const REFERENCE_AREA = 1920 * 1080;

// Веса по ступеням качества; ступеней всегда четыре, хотя в меню у части параметров их три.
const STEP_WEIGHTS = [
  ["TextureQuality", [420, 900, 1500, 2200]],
  ["ShaderQuality", [120, 240, 420, 650]],
  ["ShadowQuality", [80, 220, 440, 720]],
  ["ReflectionQuality", [70, 180, 360, 620]],
  ["GrassQuality", [40, 130, 260, 430]],
  ["WaterQuality", [50, 120, 240, 380]],
  ["ParticleQuality", [40, 110, 220, 350]],
  ["PostFX", [60, 160, 320, 520]],
  ["SSAO", [0, 90, 190, 300]],
  ["ReflectionMSAA", [0, 120, 260, 420]],
];

const finiteOr = (raw, fallback) => {
  const number = Number(raw);
  return Number.isFinite(number) ? number : fallback;
};

const multisamplingCost = (samples) => {
  if (samples >= 8) return 1800;
  if (samples >= 4) return 1050;
  if (samples >= 2) return 520;
  return 0;
};

// Условные МБ: сравнивает наборы между собой, а не показывает счётчик видеокарты.
export function estimateGraphicsVram(values = {}) {
  const width = Math.max(SCREEN_FLOOR.width, finiteOr(values.ScreenWidth, SCREEN_FALLBACK.width));
  const height = Math.max(SCREEN_FLOOR.height, finiteOr(values.ScreenHeight, SCREEN_FALLBACK.height));
  const frameScale = samplingScale(finiteOr(values.SamplingMode, 0)) ** 2;

  let total = (width * height / REFERENCE_AREA) * 420 * frameScale;
  if (frameScale > 1) total += (frameScale - 1) * 600;
  total += multisamplingCost(Math.max(0, finiteOr(values.MSAA, 0)));
  for (const [key, weights] of STEP_WEIGHTS) {
    const step = Math.round(Math.min(weights.length - 1, Math.max(0, finiteOr(values[key], 0))));
    total += weights[step];
  }
  return Math.round(total);
}
