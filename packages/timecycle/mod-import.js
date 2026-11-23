// Перенос неба редукса в проект редактора неба: параметры из w_*.xml, выключатели
// погоды из weather.xml, виды облаков из clouds.xml и cloudkeyframes.xml.
// Чего проект выразить не может, называется кодами в lost.
import { parseKeyframeXml } from "./keyframe-xml.js";
import { parseWeatherTypes } from "./weather-xml.js";
import {
  CLOUD_HAT_TYPES,
  VANILLA_CLEAR_CLOUD_BITS,
  VANILLA_CLOUD_HAT_ORDER,
  VANILLA_CLOUD_SETTINGS,
  cloudHatLook,
  parseCloudHats,
  parseCloudKeyframes,
} from "./cloud-hats.js";
import { createProject, setParameter } from "./project.js";
import { SAMPLE_COUNT, TIMECYCLE_REGIONS, weatherFromFileName } from "./samples.js";

const ORDINARY_WEATHERS = new Set(["EXTRASUNNY", "CLEAR", "CLOUDS", "SMOG", "FOGGY", "OVERCAST", "RAIN", "THUNDER", "CLEARING"]);

// Выключатели осадков: погоды файла и поле, которое у каждой из них должно быть 0.
const PRECIPITATION_SWITCHES = [
  { key: "rain", weathers: new Set(["RAIN", "CLEARING", "THUNDER"]), field: "Rain" },
  { key: "snow", weathers: new Set(["SNOW", "SNOWLIGHT", "XMAS"]), field: "Snow" },
  { key: "blizzard", weathers: new Set(["BLIZZARD"]), field: "Snow" },
];

const CALM_WIND_MAX = 0.3;
const SHARED_CLOUDS_AFTER = 4;
const LAST_MASK_BIT = 30;
const CLEAR_SETTINGS = "LIGHTclouds";
const REGION_IDS = new Set(TIMECYCLE_REGIONS.map((region) => region.id));

function newProject(name, fallback) {
  const project = createProject(name || fallback);
  // Блики остаются игровыми — вид нейтрален.
  project.look.weather.flares = true;
  return project;
}

// Имя файла кончается нужным (без учёта регистра), а перед ним — начало или косая черта.
function endsWithFileName(name, wanted) {
  const start = name.length - wanted.length;
  if (start < 0 || name.slice(start).toLowerCase() !== wanted) return false;
  const before = name[start - 1];
  return start === 0 || before === "/" || before === "\\";
}

// Поиск методом массива: не массив (строка, число, объект) — TypeError, как у старого кода.
function firstFile(files, wanted) {
  return files.find((file) => file?.name != null && endsWithFileName(String(file.name), wanted)) ?? null;
}

// ——— Небо из w_*.xml ———

// Сколько параметров файла записано правками; null — файл не разобран.
function transferKeyframes(project, weatherId, text) {
  let document;
  try {
    document = parseKeyframeXml(text, { lenient: true });
  } catch {
    return null;
  }
  let written = 0;
  for (const region of document.regions) {
    const regionId = String(region.name).toUpperCase();
    if (!REGION_IDS.has(regionId)) continue;
    for (const parameter of region.order) {
      const values = region.values[parameter];
      if (!Array.isArray(values) || values.length !== SAMPLE_COUNT) continue;
      setParameter(project, { weather: weatherId, region: regionId, parameter, values });
      written += 1;
    }
  }
  return written;
}

export function importSkyFromMod(files = [], { name } = {}) {
  const project = newProject(name, "Небо");
  const weathers = [];
  const skipped = [];
  for (const file of files) {
    const weather = weatherFromFileName(file?.name);
    // Перенесённая погода больше не смотрится; неудачная — смотрится снова.
    if (!weather || weathers.includes(weather.id)) continue;
    const written = transferKeyframes(project, weather.id, file.text);
    (written ? weathers : skipped).push(weather.id);
  }
  return weathers.length ? { project, weathers, skipped } : null;
}

// ——— Погода из weather.xml ———

const weatherIdOf = (type) => String(type.name).toUpperCase();

function fogIsOff(ordinary) {
  return ordinary.every((type) => Number(type.values.Fog ?? 0) === 0);
}

function thunderIsOff(ordinary) {
  return !ordinary.some((type) => type.values.Lightning === true);
}

function precipitationIsOff(types, { weathers, field }) {
  const related = types.filter((type) => weathers.has(weatherIdOf(type)));
  return related.length > 0 && related.every((type) => type.values[field] != null && Number(type.values[field]) === 0);
}

function windIsCalm(ordinary) {
  const winds = ordinary.map((type) => type.values.WindMax).filter(Number.isFinite);
  return winds.length > 0 && Math.max(...winds) <= CALM_WIND_MAX;
}

function cloudSettingNames(ordinary) {
  const names = new Set();
  for (const type of ordinary) {
    const setting = type.texts.CloudSettingsName;
    if (setting) names.add(setting);
  }
  return [...names];
}

export function importWeatherFromMod(files = [], { name } = {}) {
  const file = firstFile(files, "weather.xml");
  if (!file) return null;
  let types;
  try {
    types = parseWeatherTypes(file.text);
  } catch {
    return null;
  }
  const ordinary = types.filter((type) => ORDINARY_WEATHERS.has(weatherIdOf(type)));
  if (!ordinary.length) return null;

  const changed = { fog: fogIsOff(ordinary), thunder: thunderIsOff(ordinary) };
  for (const rule of PRECIPITATION_SWITCHES) changed[rule.key] = precipitationIsOff(types, rule);
  if (!Object.values(changed).some(Boolean)) return null;

  const project = newProject(name, "Погода");
  for (const [key, off] of Object.entries(changed)) if (off) project.look.weather[key] = false;

  const settings = cloudSettingNames(ordinary);
  const lost = [];
  if (windIsCalm(ordinary)) lost.push("wind");
  if (changed.rain || changed.snow || changed.blizzard) lost.push("precipitation");
  if (ordinary.length > SHARED_CLOUDS_AFTER && settings.length === 1) lost.push("clouds");
  return { project, changed, lost, clouds: settings.length === 1 ? settings[0] : "" };
}

// ——— Облака из clouds.xml и cloudkeyframes.xml ———

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Вид шапки ищется по её именам frags без учёта регистра.
function typeOfHat(hatName) {
  return CLOUD_HAT_TYPES.find((type) => type.frags.some((frag) => sameName(frag, hatName)))?.id ?? null;
}

// Виды шапок, разрешённых маской (биты 0…30), и сколько среди них своих.
function readMask(hats, mask) {
  const types = [];
  let own = 0;
  const last = Math.min(LAST_MASK_BIT, hats.length - 1);
  for (let bit = 0; bit <= last; bit += 1) {
    if (((mask >>> bit) & 1) === 0) continue;
    const { look } = hats[bit];
    if (look === null) {
      own += 1;
      continue;
    }
    const type = typeOfHat(look);
    if (type && !types.includes(type)) types.push(type);
  }
  return { types, own };
}

const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

export function importCloudsFromMod(files = [], { name } = {}) {
  const hatsText = firstFile(files, "clouds.xml")?.text;
  const framesText = firstFile(files, "cloudkeyframes.xml")?.text;
  if (!hatsText && !framesText) return null;

  let hats;
  let frames = null;
  try {
    hats = hatsText
      ? parseCloudHats(hatsText).hats.map((hat) => ({ name: hat.name, look: cloudHatLook(hat) }))
      : VANILLA_CLOUD_HAT_ORDER.map((hatName) => ({ name: hatName, look: hatName }));
    if (framesText) frames = parseCloudKeyframes(framesText).settings;
  } catch {
    return null;
  }

  const clear = frames?.get(CLEAR_SETTINGS);
  const mask = clear ? clear.bits >>> 0 : VANILLA_CLEAR_CLOUD_BITS;
  const { types, own } = readMask(hats, mask);
  const vanilla = readMask(VANILLA_CLOUD_HAT_ORDER.map((hatName) => ({ name: hatName, look: hatName })), VANILLA_CLEAR_CLOUD_BITS).types;
  if (sameSet(types, vanilla)) return null;
  // Одни свои шапки в ясной погоде: «без облаков» исказило бы небо автора.
  if (types.length === 0 && own > 0) return null;

  const vanillaSettings = new Set(VANILLA_CLOUD_SETTINGS);
  const settings = frames ? [...frames.keys()].filter((setting) => !vanillaSettings.has(setting)) : [];
  const lost = [];
  if (hatsText && hats.some((hat) => hat.look === null || !sameName(hat.look, hat.name))) lost.push("weathers");
  if (hats.some((hat) => hat.look === null)) lost.push("own");
  if (settings.length) lost.push("settings");
  if (framesText) lost.push("light");

  const project = newProject(name, "Облака");
  project.look.clouds = { types: [...types], template: null };
  return { project, types, lost, settings };
}
