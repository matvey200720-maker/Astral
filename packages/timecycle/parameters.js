// Реестр параметров таймцикла для редактора неба: разделы, подписи, границы и шаг ползунков.
// Модель строится по тому, что лежит в области документа, а не по зашитому списку.

// ---- таблицы данных: строки «ячейка | ячейка» и списки слов через пробел ----

const rows = (text) => text.trim().split("\n").map((line) => line.split(" | "));
const words = (text) => text.trim().split(/\s+/);

// Таблица «ключ → слова» в пары [слово, ключ] в порядке записи.
const invert = (table) =>
  Object.entries(table).flatMap(([key, text]) => words(text).map((word) => [word, key]));

// id | подпись ru | подпись en | подсказка ru (английской подсказки нет ни у одного раздела)
const GROUP_TABLE = `
sky | Небо | Sky | Купол, горизонт и переходы цвета
sun | Солнце | Sun | Диск, рассеивание и тёплый свет
moon | Луна и звёзды | Moon and stars | Ночное небо
clouds | Облака | Clouds | Слои, плотность и тени облаков
fog | Туман и дымка | Fog and haze | Даль, горизонт и марево
light | Свет и тени | Light and shadow | Солнечный и ambient-свет
postfx | Постобработка | Post-processing | Экспозиция, цвет, линза
water | Вода и отражения | Water and reflections | Отражения и блики
scene | Сцена | Scene | Дальность, погода и прочая механика
`;

const FEATURED_TABLE = {
  sky: `
    sky_zenith_col sky_zenith_transition_col sky_azimuth_east_col sky_azimuth_west_col
    sky_azimuth_transition_col sky_hdr sky_azimuth_transition_position
    sky_zenith_transition_position
  `,
  sun: `
    sky_sun_col sky_sun_disc_col sky_sun_disc_size sky_sun_hdr sky_sun_scatter_inten
    sky_sun_influence_radius sky_sun_miephase sky_sun_miescatter
  `,
  moon: `
    sky_moon_col sky_moon_disc_size sky_stars_iten sky_moon_scatter_inten
    sky_moon_influence_radius
  `,
  clouds: `
    sky_cloud_base_col sky_cloud_mid_col sky_cloud_shadow_col sky_cloud_density_mult
    sky_cloud_overall_strength sky_cloud_hdr sky_small_cloud_col
  `,
  fog: `
    fog_col fog_haze_col fog_density fog_start fog_falloff fog_hdr fog_haze_density
    fog_horizon_tint_scale
  `,
  light: `
    light_dir_col light_directional_amb_col light_natural_amb_up_col light_natural_amb_down_col
    light_artificial_ext_up_col ssao_inten
  `,
  postfx: `
    postfx_exposure postfx_intensity_bloom postfx_desaturation postfx_correct_col
    postfx_shift_col postfx_vignetting_col light_ray_col
  `,
  water: `
    water_reflection water_specular_intensity water_foam_intensity_mult
  `,
  scene: `
    far_clip temperature wind_speed_mult
  `,
};

// раздел → точные имена; раздел → префиксы (порядок записей — порядок проверки)
const EXACT_TABLE = {
  sky: `
    sky_hdr
  `,
  scene: `
    temperature
  `,
};
const PREFIX_TABLE = {
  moon: `
    sky_moon_ moon_direction_ sky_stars_
  `,
  sun: `
    sky_sun_ sun_direction_
  `,
  clouds: `
    sky_cloud_ sky_small_cloud_ cloud_shadow_
  `,
  sky: `
    sky_
  `,
  fog: `
    fog_ fogray_ fogvolume_ hh_
  `,
  postfx: `
    postfx_ light_ray_ lens_ chrom_ blur_ bokeh_ dof_ environmental_blur_ nv_ screen_blur_
    Lensflare_
  `,
  light: `
    light_ ped_light_ ssao_ dir_shadow_ sprite_ natural_ambient_ artificial_int_ambient_
    shadow_distance_
  `,
  water: `
    water_ mirror_ reflection_
  `,
};

// имя элемента | подпись ru | подпись en
const LABEL_TABLE = `
sky_zenith_col | Зенит | Zenith
sky_zenith_transition_col | Переход зенита | Zenith transition
sky_zenith_transition_position | Высота перехода зенита | Zenith transition position
sky_zenith_blend_start | Начало смешивания зенита | Zenith blend start
sky_zenith_transition_east_blend | Переход зенита, восток | Zenith transition east
sky_zenith_transition_west_blend | Переход зенита, запад | Zenith transition west
sky_azimuth_east_col | Горизонт, восток | Horizon east
sky_azimuth_west_col | Горизонт, запад | Horizon west
sky_azimuth_transition_col | Горизонт, переход | Horizon transition
sky_azimuth_transition_position | Высота перехода горизонта | Horizon transition position
sky_hdr | Яркость неба (HDR) | Sky HDR
sky_plane | Плоскость неба | Sky plane
sky_sun_col | Свет солнца в небе | Sun sky colour
sky_sun_disc_col | Диск солнца | Sun disc
sky_sun_disc_size | Размер солнца | Sun disc size
sky_sun_hdr | Яркость солнца (HDR) | Sun HDR
sky_sun_miephase | Ми-фаза | Mie phase
sky_sun_miescatter | Ми-рассеивание | Mie scatter
sky_sun_mie_intensity_mult | Сила рассеивания | Mie intensity
sky_sun_influence_radius | Радиус свечения солнца | Sun influence radius
sky_sun_scatter_inten | Сила ореола солнца | Sun scatter intensity
sky_moon_col | Луна | Moon
sky_moon_disc_size | Размер луны | Moon size
sky_moon_influence_radius | Радиус свечения луны | Moon influence radius
sky_moon_scatter_inten | Сила ореола луны | Moon scatter intensity
sky_stars_iten | Яркость звёзд | Stars intensity
sky_cloud_base_col | Облака, основание | Clouds base
sky_cloud_mid_col | Облака, середина | Clouds mid
sky_cloud_shadow_col | Облака, тень | Clouds shadow
sky_cloud_density_mult | Плотность облаков | Cloud density
sky_cloud_density_bias | Смещение плотности | Cloud density bias
sky_cloud_overall_strength | Сила облаков | Cloud strength
sky_cloud_fadeout | Растворение облаков | Cloud fadeout
sky_cloud_hdr | Яркость облаков (HDR) | Cloud HDR
sky_small_cloud_col | Мелкие облака | Small clouds
fog_col | Туман | Fog
fog_near_col | Ближний туман | Near fog
fog_east_col | Туман, восток | East fog
fog_moon_col | Туман под луной | Moon fog
fog_haze_col | Дымка | Haze
fog_density | Плотность тумана | Fog density
fog_start | Начало тумана | Fog start
fog_falloff | Спад тумана | Fog falloff
fog_hdr | Яркость тумана (HDR) | Fog HDR
fog_haze_density | Плотность дымки | Haze density
fog_haze_start | Начало дымки | Haze start
fog_haze_hdr | Яркость дымки (HDR) | Haze HDR
fog_horizon_tint_scale | Подкраска горизонта | Horizon tint
light_dir_col | Солнечный свет | Directional light
light_directional_amb_col | Ambient от солнца | Directional ambient
light_natural_amb_up_col | Ambient сверху | Ambient up
light_natural_amb_down_col | Ambient снизу | Ambient down
light_artificial_ext_up_col | Городской свет сверху | Exterior artificial up
light_artificial_ext_down_col | Городской свет снизу | Exterior artificial down
light_artificial_int_up_col | Свет в помещениях сверху | Interior artificial up
light_artificial_int_down_col | Свет в помещениях снизу | Interior artificial down
ped_light_col | Свет на персонажах | Ped light
light_ray_col | Лучи света | Light rays
light_ray_dist | Длина лучей | Ray distance
ssao_inten | Сила затенения (SSAO) | SSAO intensity
postfx_exposure | Экспозиция | Exposure
postfx_exposure_min | Экспозиция, минимум | Exposure min
postfx_exposure_max | Экспозиция, максимум | Exposure max
postfx_intensity_bloom | Сила блума | Bloom intensity
postfx_bright_pass_thresh | Порог блума | Bloom threshold
postfx_desaturation | Обесцвечивание | Desaturation
postfx_noise | Зерно | Grain
postfx_correct_col | Коррекция цвета | Colour correction
postfx_shift_col | Сдвиг цвета | Colour shift
postfx_vignetting_col | Виньетка | Vignette
postfx_vignetting_radius | Радиус виньетки | Vignette radius
postfx_grad_top_col | Градиент сверху | Gradient top
postfx_grad_middle_col | Градиент по центру | Gradient middle
postfx_grad_bottom_col | Градиент снизу | Gradient bottom
far_clip | Дальность прорисовки | Far clip
temperature | Температура воздуха | Temperature
wind_speed_mult | Сила ветра | Wind speed
water_reflection | Отражения в воде | Water reflection
water_specular_intensity | Блики на воде | Water specular
sun_direction | Направление солнца | Sun direction
moon_direction | Направление луны | Moon direction
`;

// слово строчными | замена при языке ru
const WORD_TABLE = `
col | цвет
inten | яркость
iten | яркость
hdr | HDR
ssao | SSAO
lod | LOD
dof | DOF
nv | ночное зрение
hh | марево
amb | ambient
mult | множитель
fx | эффекты
`;

// концы имён спутника | подпись ru | подпись en
const COMPANION_TABLE = `
_inten _iten _intensity | Интенсивность | Intensity
_mult | Множитель | Multiplier
_strength | Сила | Strength
_a | Прозрачность | Alpha
`;

// границы «min max» → имена, у которых они заданы явно
const RANGE_TABLE = {
  "0 40": `
    sky_hdr
  `,
  "0 255": `
    sky_sun_hdr
  `,
  "0 12": `
    sky_sun_disc_size sky_moon_disc_size sky_sun_miescatter
  `,
  "0 8": `
    sky_moon_iten sky_sun_scatter_inten sky_cloud_density_mult postfx_intensity_bloom
  `,
  "0 4": `
    sky_stars_iten sky_sun_miephase sky_cloud_overall_strength
  `,
  "0 256": `
    sky_sun_influence_radius sky_moon_influence_radius
  `,
  "0 80": `
    light_dir_mult
  `,
  "-4 4": `
    postfx_exposure
  `,
  "0 1": `
    postfx_desaturation fog_alpha
  `,
  "0 60": `
    fog_density
  `,
  "0 2000": `
    fog_start
  `,
  "0 20000": `
    far_clip
  `,
  "-40 60": `
    temperature
  `,
};

const SWITCH_NAMES = `
  no_weather_fx no_gpu_fx no_rain enable_occlusion enable_shadow_occlusion render_exterior
  water_reflection water_foglight water_interior water_fogstreaming dof_enable_hq
  dof_hq_smallblur dof_hq_shallowdof light_direction_override_overrides_sun
  light_amb_volumes_in_diffuse water_reflection_lod_range_enabled
  water_reflection_height_override
`;

const pair = (ru, en) => Object.freeze({ ru, en });

export const PARAMETER_GROUPS = Object.freeze(
  rows(GROUP_TABLE).map(([id, ru, en, hint]) =>
    Object.freeze({ id, label: pair(ru, en), hint: pair(hint, "") }),
  ),
);

export const FEATURED_CONTROLS = Object.freeze(
  Object.fromEntries(Object.entries(FEATURED_TABLE).map(([group, text]) => [group, words(text)])),
);

const EXACT_GROUPS = new Map(invert(EXACT_TABLE));
const PREFIX_GROUPS = invert(PREFIX_TABLE);
const LABELS = new Map(rows(LABEL_TABLE).map(([name, ru, en]) => [name, { ru, en }]));
const WORDS = new Map(rows(WORD_TABLE));
const FIXED_BOUNDS = new Map(
  invert(RANGE_TABLE).map(([name, range]) => [name, range.split(" ").map(Number)]),
);
const SWITCHES = new Set(words(SWITCH_NAMES));

const COMPANIONS = rows(COMPANION_TABLE).map(([suffixes, ru, en]) => ({
  suffixes: words(suffixes),
  texts: { ru, en },
}));
const COMPANION_SUFFIXES = COMPANIONS.flatMap(({ suffixes }) => suffixes).filter((s) => s !== "_a");

// ---- разделы и подписи ----

export function groupForParameter(name) {
  return (
    EXACT_GROUPS.get(name) ?? PREFIX_GROUPS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "scene"
  );
}

const isUpper = (code) => code >= 65 && code <= 90;
const isLowerOrDigit = (code) => (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

// Части имени по «_»; внутри части между «строчная или цифра» и заглавной ASCII ставится пробел.
function splitName(text) {
  const parts = [];
  let current = "";
  let before = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === "_") {
      if (current) parts.push(current);
      current = "";
    } else {
      current += isUpper(code) && isLowerOrDigit(before) ? ` ${char}` : char;
    }
    before = code;
  }
  return current ? [...parts, current] : parts;
}

const upperFirst = (word) => word.slice(0, 1).toUpperCase() + word.slice(1);

const translatePart = (part, index) =>
  WORDS.get(part.toLowerCase()) ?? (index === 0 ? upperFirst(part) : part);

export function readableName(name, language = "ru") {
  const parts = splitName(String(name));
  return (language === "ru" ? parts.map(translatePart) : parts).join(" ");
}

function labelOf(key, language) {
  const entry = LABELS.get(key);
  return entry ? entry[language === "ru" ? "ru" : "en"] : readableName(key, language);
}

// Язык ищется как свойство обычного объекта {ru, en}: чужой язык даёт русский текст.
function companionText(name, language) {
  const { texts } = COMPANIONS.find(({ suffixes }) => suffixes.some((s) => name.endsWith(s)));
  return texts[language] ?? texts.ru;
}

// ---- границы и шаг ----

const roundToHundredths = (value) => Math.round(value / 0.01) * 0.01;

// Границы по самим данным: запас — три четверти размаха (или модуля, или единицы).
function boundsFromSamples(samples) {
  const finite = [...samples].filter(Number.isFinite);
  if (finite.length === 0) return { min: 0, max: 1 };
  const [low, high] = finite.reduce(
    ([lo, hi], value) => [Math.min(lo, value), Math.max(hi, value)],
    [Infinity, -Infinity],
  );
  const padding = 0.75 * Math.max(high - low, Math.abs(high), 1);
  return {
    min: low < 0 ? roundToHundredths(low - padding) : 0,
    max: roundToHundredths(Math.max(high + padding, 1)),
  };
}

// Явные границы и переключатели данные не читают.
function boundsFor(name, samples) {
  const fixed = FIXED_BOUNDS.get(name) ?? (SWITCHES.has(name) ? [0, 1] : null);
  if (fixed === null) return boundsFromSamples(samples);
  const [min, max] = fixed;
  return { min, max };
}

// Ширина не больше предела — шаг из той же строки; шире всех пределов — единица.
const STEP_LIMITS = [
  [2, 0.001],
  [20, 0.01],
  [200, 0.1],
];

function stepFor({ min, max }) {
  const width = Math.abs(max - min);
  return STEP_LIMITS.find(([limit]) => width <= limit)?.[1] ?? 1;
}

// ---- модель элементов ----

const nameSet = (base, letters) =>
  Object.fromEntries([...letters].map((letter) => [letter, `${base}_${letter}`]));

// Связки из трёх имён, которые собираются в один элемент: хвост, два соседних, сборщик.
const BUNDLES = [
  ["_r", ["_g", "_b"], (session, base) => session.colour(base)],
  ["_x", ["_y", "_z"], (session, base) => session.vector(base)],
];

class ControlSession {
  constructor(values, language) {
    this.values = values;
    this.language = language;
    this.spent = new Set();
  }

  owns(key) {
    return Object.hasOwn(this.values, key);
  }

  claim(keys) {
    keys.forEach((key) => this.spent.add(key));
    return keys;
  }

  heading(base) {
    return { group: groupForParameter(base), label: labelOf(base, this.language) };
  }

  // Первый свободный собственный параметр из кандидатов; нашёлся — расходуется.
  claimCompanion(base) {
    const stems = base.endsWith("_col") ? [base, base.slice(0, -4)] : [base];
    const candidates = [
      `${base}_a`,
      ...COMPANION_SUFFIXES.flatMap((suffix) => stems.map((stem) => stem + suffix)),
    ];
    const found = candidates.find((key) => this.owns(key) && !this.spent.has(key));
    if (found === undefined) return null;
    this.spent.add(found);
    return found;
  }

  colour(base) {
    const channels = nameSet(base, "rgb");
    const parameters = this.claim(Object.values(channels));
    const companion = this.claimCompanion(base);
    const linked = companion !== null;
    return {
      kind: "color",
      id: base,
      parameters: linked ? [...parameters, companion] : parameters,
      channels,
      companion,
      companionLabel: linked ? companionText(companion, this.language) : null,
      companionRange: linked ? boundsFor(companion, this.values[companion]) : null,
      ...this.heading(base),
    };
  }

  vector(base) {
    const axes = nameSet(base, "xyz");
    return {
      kind: "vector",
      id: base,
      parameters: this.claim(Object.values(axes)),
      axes,
      ...this.heading(base),
    };
  }

  single(name) {
    this.spent.add(name);
    const range = boundsFor(name, this.values[name]);
    return {
      kind: SWITCHES.has(name) ? "toggle" : "scalar",
      id: name,
      parameters: [name],
      ...this.heading(name),
      range,
      step: stepFor(range),
    };
  }

  take(name) {
    const base = name.slice(0, -2);
    const bundle = BUNDLES.find(
      ([tail, rest]) => name.endsWith(tail) && rest.every((s) => this.owns(base + s)),
    );
    return bundle ? bundle[2](this, base) : this.single(name);
  }
}

export function buildControlModel(region, language = "ru") {
  const source = region ?? {};
  const values = source.values || {};
  const order = source.order || Object.keys(values);
  const session = new ControlSession(values, language);

  const controls = [...order].flatMap((name) => (session.spent.has(name) ? [] : [session.take(name)]));

  const byParameter = new Map();
  for (const control of controls) {
    for (const key of control.parameters) byParameter.set(key, control);
  }

  const groups = PARAMETER_GROUPS.map(({ id, label, hint }) => ({
    id,
    label,
    hint,
    controls: controls.filter((control) => control.group === id),
  })).filter((group) => group.controls.length > 0);

  return { controls, byParameter, groups };
}
