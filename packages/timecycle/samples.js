// Опорные кадры суток, регионы и погоды таймцикла GTA V (Legacy), смешивание
// параметра по часу и направления солнца и луны для предпросмотра.

// Кадр: номер в массиве значений, час, сколько часов кадр держится, подпись.
export const TIMECYCLE_SAMPLES = Object.freeze([
  { index: 0, hour: 0, duration: 4, label: "00:00" },
  { index: 1, hour: 5, duration: 0, label: "05:00" },
  { index: 2, hour: 6, duration: 0, label: "06:00" },
  { index: 3, hour: 7, duration: 0, label: "07:00" },
  { index: 4, hour: 10, duration: 0, label: "10:00" },
  { index: 5, hour: 12, duration: 0, label: "12:00" },
  { index: 6, hour: 16, duration: 0, label: "16:00" },
  { index: 7, hour: 17, duration: 0, label: "17:00" },
  { index: 8, hour: 18, duration: 0, label: "18:00" },
  { index: 9, hour: 19, duration: 0, label: "19:00" },
  { index: 10, hour: 20, duration: 0, label: "20:00" },
  { index: 11, hour: 21, duration: 0, label: "21:00" },
  { index: 12, hour: 22, duration: 0, label: "22:00" },
]);

export const SAMPLE_COUNT = 13;

// Значения игры из time.xml; модуль использует только два наклона.
export const CELESTIAL_ORBIT = Object.freeze({
  sunRoll: 122,
  sunYaw: 0,
  moonRoll: -122,
  moonWobbleFrequency: 2,
  moonWobbleAmplitude: 0.2,
  moonWobbleOffset: 0.375,
});

export const TIMECYCLE_REGIONS = Object.freeze([
  {
    id: "GLOBAL",
    label: { ru: "Весь остров", en: "Whole island" },
    hint: { ru: "Пустыня, горы, побережье и трассы", en: "Desert, hills, coast and highways" },
  },
  {
    id: "URBAN",
    label: { ru: "Город", en: "City" },
    hint: { ru: "Лос-Сантос внутри городской зоны", en: "Los Santos inside the urban zone" },
  },
]);

// id, файл, ru, en — от ясной к тяжёлой.
const WEATHER_ROWS = [
  ["EXTRASUNNY", "w_extrasunny.xml", "Ясно и жарко", "Extra sunny"],
  ["CLEAR", "w_clear.xml", "Ясно", "Clear"],
  ["CLOUDS", "w_clouds.xml", "Облачно", "Clouds"],
  ["SMOG", "w_smog.xml", "Смог", "Smog"],
  ["FOGGY", "w_foggy.xml", "Туман", "Foggy"],
  ["OVERCAST", "w_overcast.xml", "Пасмурно", "Overcast"],
  ["RAIN", "w_rain.xml", "Дождь", "Rain"],
  ["THUNDER", "w_thunder.xml", "Гроза", "Thunder"],
  ["CLEARING", "w_clearing.xml", "Проясняется", "Clearing"],
  ["NEUTRAL", "w_neutral.xml", "Нейтральная", "Neutral"],
  ["SNOW", "w_snow.xml", "Снег", "Snow"],
  ["BLIZZARD", "w_blizzard.xml", "Метель", "Blizzard"],
  ["SNOWLIGHT", "w_snowlight.xml", "Лёгкий снег", "Light snow"],
  ["XMAS", "w_xmas.xml", "Рождество", "Christmas"],
  ["HALLOWEEN", "w_halloween.xml", "Хеллоуин", "Halloween"],
];

export const WEATHER_TYPES = Object.freeze(
  WEATHER_ROWS.map(([id, file, ru, en]) => Object.freeze({ id, file, label: Object.freeze({ ru, en }) })),
);

export const TIMECYCLE_ARCHIVE_DIRECTORY = "update:/common/data/timecycle";

const weatherById = new Map(WEATHER_TYPES.map((weather) => [weather.id, weather]));
const weatherByFile = new Map(WEATHER_TYPES.map((weather) => [weather.file, weather]));

const textOf = (value) => (value ? String(value) : "");

export function findWeather(id) {
  return weatherById.get(textOf(id).toUpperCase()) ?? null;
}

export function weatherFromFileName(value) {
  const unified = textOf(value).replace(/\\/g, "/");
  const fileName = unified.slice(unified.lastIndexOf("/") + 1).trim().toLowerCase();
  return weatherByFile.get(fileName) ?? null;
}

export function weatherArchivePath(weatherId) {
  const weather = findWeather(weatherId);
  if (!weather) throw new Error(`Неизвестный тип погоды: ${weatherId}`);
  return `${TIMECYCLE_ARCHIVE_DIRECTORY}/${weather.file}`;
}

// ——— Смешивание по часу ———

const HOURS_PER_DAY = 24;

// Час суток в [0, 24); NaN и бесконечность — NaN.
function wrapHour(hour) {
  const remainder = Number(hour) % HOURS_PER_DAY;
  return (remainder + HOURS_PER_DAY) % HOURS_PER_DAY;
}

// Окно смешивания каждого кадра: где кадр перестаёт держаться, сколько часов
// длится переход и к какому кадру. За последним кадром — первый, в 24:00.
const BLEND_WINDOWS = TIMECYCLE_SAMPLES.map((frame, index, frames) => {
  const next = frames[index + 1];
  const nextHour = next ? next.hour : HOURS_PER_DAY;
  return { index, nextIndex: next ? index + 1 : 0, from: frame.hour + frame.duration, span: nextHour - frame.hour - frame.duration };
});

// Окно последнего кадра, чей час не позже h. NaN ни с чем не сравнивается:
// findLastIndex даёт -1, и берётся окно последнего кадра.
function windowAt(h) {
  const found = TIMECYCLE_SAMPLES.findLastIndex((frame) => frame.hour <= h);
  return BLEND_WINDOWS.at(found);
}

export function resolveSampleBlend(hour) {
  const h = wrapHour(hour);
  const { index, nextIndex, from, span } = windowAt(h);
  const blend = span > 0 ? Math.min(1, Math.max(0, (h - from) / span)) : 0;
  return { hour: h, index, nextIndex, blend };
}

export function sampleAtHour(values, hour) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const { index, nextIndex, blend } = resolveSampleBlend(hour);
  const lastSlot = values.length - 1;
  // Короткий массив повторяет последнее значение; не число — 0.
  const [from, to] = [index, nextIndex].map((slot) => {
    const number = Number(values[Math.min(slot, lastSlot)]);
    return Number.isNaN(number) ? 0 : number;
  });
  return from * (1 - blend) + to * blend;
}

// ——— Солнце и луна: точка орбиты, повёрнутая матрицей вокруг оси X ———

const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Разреженная матрица поворота вокруг X: у каждой строки — только ненулевые
// коэффициенты [столбец, множитель]. Нули не складываются, поэтому знак нуля
// и каждый бит результата — как у прямых формул поворота.
function rotationX(angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[[0, 1]], [[1, cos], [2, -sin]], [[1, sin], [2, cos]]];
}

function transform(matrix, vector) {
  return matrix.map((row) => row.map(([column, factor]) => vector[column] * factor).reduce((sum, term) => sum + term));
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  const divisor = length > 0 ? length : Number.EPSILON;
  const [x, y, z] = vector.map((component) => component / divisor);
  return { x, y, z };
}

export function celestialDirections(hour, orbit = CELESTIAL_ORBIT) {
  const h = wrapHour(hour);
  const sunTilt = rotationX(toRadians(Number(orbit.sunRoll)));
  const moonTilt = rotationX(-toRadians(Number(orbit.moonRoll)));

  const dayAngle = Math.PI * (0.5 + (h - 6) / 14);
  const nightAngle = Math.PI * (h > 12 ? (h - 7) / 9 : (h + 17) / 9);
  const sunOnOrbit = [Math.sin(dayAngle), -Math.cos(dayAngle), 0];
  const moonOnOrbit = [-Math.sin(nightAngle), 0, -Math.cos(nightAngle)];

  return {
    sun: normalized(transform(sunTilt, sunOnOrbit)),
    moon: normalized(transform(moonTilt, moonOnOrbit)),
    usesMoon: h < 5 || h > 21,
  };
}
