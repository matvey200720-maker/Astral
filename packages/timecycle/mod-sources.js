/*
 * Небо, которое уже стоит у игрока (ТЗ 17.10.2026, вечер, задача 3).
 *
 * У игрока на машине бывает чужой графический пакет — NaturalVision Evolved,
 * coreFx, QuantV, сборка сервера: его таймцикл лежит в `update.rpf`, в слое
 * OpenIV (`mods/update/update.rpf`) или в дополнении (`dlcpacks/<имя>/dlc.rpf`).
 * Эти пакеты в поставку Astral не входят и не копируются: приложение читает
 * файлы с диска игрока, как разбор редукса, и показывает их шаблоном
 * мастерской — человек берёт небо, а Astral не хранит ни одного чужого числа.
 *
 * Здесь — только чистая часть: какие записи архива считаются файлами неба,
 * как узнать пакет по меткам в его файлах и как собрать из файлов один проект
 * редактора (`importSkyBundleFromMod`). Чтение архивов — в приложении
 * (`apps/desktop/src/sky-sources.js`).
 *
 * КАК УЗНАЮТСЯ ПАКЕТЫ
 *
 * Метки берутся только из текста, который автор положил сам: первые строки
 * `visualsettings.dat` (у ребят там `# ИМЯ [ссылка]`), комментарии в начале
 * `w_*.xml`, имя папки дополнения и имя в `setup2.xml` / `content.xml`. Своего
 * списка «настоящих» файлов NVE или coreFx у проекта нет, поэтому пакет без
 * метки не придумывается: он называется по месту — «Небо вашей игры».
 */

import {
  importCloudsFromMod,
  importSkyFromMod,
  importWeatherFromMod,
} from "./mod-import.js";
import { createProject } from "./project.js";
import { ETERNAL_WEATHER_IDS } from "./look.js";
import { parseWeatherCycles } from "./weather-xml.js";

/** Записи архива, из которых складывается небо пакета. */
export const SKY_SOURCE_ENTRY = Object.freeze({
  timecycle: /(?:^|\/)common\/data\/timecycle\/(w_[a-z0-9_]+\.xml)$/i,
  weather: /(?:^|\/)common\/data\/levels\/gta5\/weather\.xml$/i,
  clouds: /(?:^|\/)common\/data\/clouds\.xml$/i,
  cloudKeyframes: /(?:^|\/)common\/data\/cloudkeyframes\.xml$/i,
  visualSettings: /(?:^|\/)common\/data\/visualsettings\.dat$/i,
});

/**
 * Что за запись: `{ kind, name }` — `name` у файлов неба то, под чем его
 * знает мод-импорт (`w_clear.xml`, `weather.xml`…); `null` — не наша.
 */
export function skyEntryKind(path) {
  const entry = String(path || "").replace(/\\/g, "/");
  const timecycle = SKY_SOURCE_ENTRY.timecycle.exec(entry);
  if (timecycle) return { kind: "timecycle", name: timecycle[1].toLowerCase() };
  if (SKY_SOURCE_ENTRY.weather.test(entry)) return { kind: "weather", name: "weather.xml" };
  if (SKY_SOURCE_ENTRY.clouds.test(entry)) return { kind: "clouds", name: "clouds.xml" };
  if (SKY_SOURCE_ENTRY.cloudKeyframes.test(entry))
    return { kind: "cloudKeyframes", name: "cloudkeyframes.xml" };
  if (SKY_SOURCE_ENTRY.visualSettings.test(entry))
    return { kind: "visualSettings", name: "visualsettings.dat" };
  return null;
}

/* Известные графические пакеты по меткам в их файлах. */
const KNOWN_PACKS = Object.freeze([
  { id: "nve", label: "NaturalVision Evolved", pattern: /natural\s*[-_ ]?vision|(?<![A-Za-z])N\.?V\.?E(?![A-Za-z])/i },
  { id: "corefx", label: "coreFx", pattern: /core\s*[-_ ]?fx/i },
  { id: "quantv", label: "QuantV", pattern: /quant\s*[-_ ]?v(?![A-Za-z])/i },
  { id: "visualv", label: "VisualV", pattern: /visual\s*[-_ ]?v(?![A-Za-z])/i },
]);

/**
 * Узнаёт пакет по меткам: `texts` — куски текста из его файлов (начало
 * `visualsettings.dat`, комментарии `w_*.xml`), `names` — имена (папка
 * дополнения, имя в `setup2.xml`). Возвращает `{ id, label }` или `null`.
 */
export function recognizeSkyPack({ texts = [], names = [] } = {}) {
  const haystack = [...texts, ...names].map((item) => String(item ?? "")).join("\n");
  const found = KNOWN_PACKS.find((pack) => pack.pattern.test(haystack));
  return found ? { id: found.id, label: found.label } : null;
}

/* Заголовок самого файла Rockstar — не метка автора. */
const VANILLA_HEADER = /^(?:visual configuration table|platform tunnings:?|myvalue\.(?:x64|xb1|ps4)\b.*)$/i;

/**
 * Метка автора из начала `visualsettings.dat`: первая строка-комментарий
 * `# ИМЯ [ссылка]` без ссылок и скобок. Файл Rockstar начинается со своего
 * заголовка («Visual Configuration Table») и своих пояснений («PC vs consoles
 * setup»): они меткой не считаются. Если автор оставил заголовок и дописал
 * метку ниже, то метка — только та строка, где есть ссылка (`[…]` или
 * `http`): так подписываются пакеты, а пояснения Rockstar ссылок не несут.
 * Нет метки — `null`.
 */
export function skyPackAuthor(visualSettingsText) {
  let afterHeader = false;
  for (const raw of String(visualSettingsText || "").split(/\r?\n/).slice(0, 24)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("#")) return null;
    const comment = line.replace(/^#+/, "").trim();
    if (VANILLA_HEADER.test(comment)) {
      afterHeader = true;
      continue;
    }
    if (afterHeader && !/\[[^\]]*\]|https?:\/\//i.test(comment)) continue;
    const name = comment
      .replace(/\[[^\]]*\]/g, "")
      .replace(/https?:\/\/\S+/gi, "")
      .trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }
  return null;
}

/** Комментарии `<!-- … -->` из начала XML-файла — метки автора. */
export function xmlHeadComments(xml, limit = 2000) {
  const head = String(xml || "").slice(0, limit);
  return [...head.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => match[1].trim()).filter(Boolean);
}

/**
 * Небо пакета одним проектом редактора: погода по файлам `w_*.xml` точно,
 * выключатели тумана, грозы и осадков по `weather.xml`, облака ясной погоды
 * по `clouds.xml` и `cloudkeyframes.xml`. Каждая часть берётся, если есть и
 * разобралась; вид остаётся нейтральным, блики как в игре — всё, что человек
 * подвинет дальше, ляжет поверх неба пакета.
 *
 * `files` — `[{ name, text }]`, имя — как в игре. Возвращает `{ project,
 * weathers, skipped, parts, lost }` или `null`, если ни одна часть не
 * разобралась. `lost` — чего проект неба не держит (`weather`, `clouds`).
 */
export function importSkyBundleFromMod(files = [], { name = "" } = {}) {
  const sky = importSkyFromMod(
    files.filter((file) => /^w_/i.test(String(file?.name || "").split(/[\\/]/).pop())),
    { name },
  );
  const weather = importWeatherFromMod(files, { name });
  const clouds = importCloudsFromMod(files, { name });
  if (!sky && !weather && !clouds) return null;
  const project = sky?.project || createProject(name || "Небо");
  project.look.weather.flares = true;
  if (weather) {
    const { flares: _flares, ...toggles } = weather.project.look.weather;
    project.look.weather = { ...project.look.weather, ...toggles };
  }
  if (clouds) project.look.clouds = clouds.project.look.clouds;
  /* Расписание пакета из одной погоды (так замораживают погоду серверные
     сборки) — это и есть «вечная погода» редактора. */
  const weatherText = files.find((file) => /(^|[\\/])weather\.xml$/i.test(String(file?.name || "")))?.text;
  if (weatherText) {
    const names = parseWeatherCycles(weatherText).map((item) => item.name);
    if (names.length > 1 && names.every((item) => item === names[0]) && ETERNAL_WEATHER_IDS.includes(names[0]))
      project.look.weather.eternal = names[0];
  }
  return {
    project,
    weathers: sky?.weathers || [],
    skipped: sky?.skipped || [],
    parts: { sky: Boolean(sky), weather: Boolean(weather), clouds: Boolean(clouds) },
    lost: { weather: weather?.lost || [], clouds: clouds?.lost || [] },
  };
}
