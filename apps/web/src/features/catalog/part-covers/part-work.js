const NAMES_SHOWN = 3;
const KILL_TOLERANCE = 0.0001;
const SKY_SCALE = 10000;

const WEATHER_FILE = /^w_.+\.xml$/;
const MODS_FILE = /^timecycle_mods_\d+\.xml$/;
const MODIFIER_TAG = /<modifier\s+name=/gi;

const FORMS = {
  weatherFile: ["файл погоды", "файла погоды", "файлов погоды"],
  skyParam: ["параметр неба", "параметра неба", "параметров неба"],
  modifier: ["модификатор таймцикла", "модификатора таймцикла", "модификаторов таймцикла"],
  killField: ["поле вспышки", "поля вспышки", "полей вспышки"],
};

// Слово после числа: 1 / 2–4 / остальное, кроме 11–14.
function plural(count, [one, few, many]) {
  const tail = count % 100;
  const last = count % 10;
  if (last === 1 && tail !== 11) return one;
  if (last >= 2 && last <= 4 && (tail < 12 || tail > 14)) return few;
  return many;
}

const first = (names) => names.slice(0, NAMES_SHOWN).join(", ");
const firstWithEllipsis = (names) => first(names) + (names.length > NAMES_SHOWN ? "…" : "");

const TEXT = {
  outsideSky: (count, names) =>
    `${count} ${plural(count, FORMS.weatherFile)} вне видов неба (${first(names)})`,
  skyParams: (count) => `${count} ${plural(count, FORMS.skyParam)} не повторяются кодом`,
  modifiers: (count) => `${count} ${plural(count, FORMS.modifier)} (timecycle_mods)`,
  killFields: (names) =>
    `${names.length} ${plural(names.length, FORMS.killField)} кодом не повторяются: ${firstWithEllipsis(names)}`,
  frontend: "остальной frontend.xml автора — кнопки меню и прочий интерфейс",
  maskBlur: "маска или размытие мини-карты у автора стоят иначе, чем ставит редактор",
  bigMap: "большая карта у автора стоит иначе, чем ставит редактор",
  stripes: "точные места и размеры полос — по ближайшей раскладке редактора",
  hitFrame: "своя картинка рамки урона в код работы не входит",
  sunParticles: "солнце и частицы по погодам (weather.xml) — в небе только выключатели погод",
};

// Потери облаков и погоды по кодам разбора; неизвестный код отбрасывается.
const CLOUD_LOSS = {
  settings: (clouds) => `свои наборы облаков (${firstWithEllipsis(clouds.settings ?? [])})`,
  weathers: () => "облака в непогоду: у мода свои шапки, небо выбирает облака только ясной погоды",
  own: () => "шапки облаков со своими моделями — у редактора таких видов нет",
  light: () => "свет и цвет облаков по часам (cloudkeyframes.xml)",
};
const WEATHER_LOSS = {
  wind: () => "ветер погод (WindMin, WindMax) и снос капель ветром — в небе их нет",
  precipitation: () =>
    "у автора дождливые и снежные погоды остаются собой, только без осадков; в небе выключенная погода — ясный день",
  clouds: (weather) =>
    `один набор облаков ${weather.clouds ?? ""} на все погоды — небо выбирает облака только ясной погоды`,
};

function lossesByCode(table, codes, source) {
  return codes
    .filter((code) => Object.hasOwn(table, code))
    .map((code) => table[code](source));
}

const answer = (kind, code, lossless, lost) => ({ work: { kind, code }, lossless, lost });

// Последний сегмент пути строчными: по нему сверяются шаблоны имён.
const fileKey = (file) => String(file?.name ?? "").split(/[\\/]/).pop().toLowerCase();
const fileText = (file) =>
  typeof file.bytes === "string" ? file.bytes : new TextDecoder().decode(file.bytes);

// Состояние шаблона из прочитанного кода: строка JSON разбирается, иное берётся как есть.
function templateState(read) {
  const state = read.templates?.[0]?.state;
  return typeof state === "string" ? JSON.parse(state) : (state ?? {});
}

const round4 = (value) => Math.round(value * SKY_SCALE) / SKY_SCALE;

function sameRounded(got, expected) {
  return (
    Array.isArray(got) &&
    got.length === expected.length &&
    expected.every((value, index) => got[index] === round4(value))
  );
}

function readParameterOrNull(timecycle, project, query) {
  try {
    return timecycle.readParameter(project, query);
  } catch {
    return null;
  }
}

function parseWeatherDocument(timecycle, text) {
  try {
    return timecycle.parseKeyframeXml(text, { lenient: true });
  } catch {
    return null;
  }
}

function countMismatches(timecycle, project, weather, document) {
  let bad = 0;
  for (const region of document.regions) {
    const regionName = String(region.name ?? "").toUpperCase();
    for (const parameter of region.order) {
      const got = readParameterOrNull(timecycle, project, {
        weather: weather.id,
        region: regionName,
        parameter,
      });
      if (!sameRounded(got, region.values[parameter])) bad += 1;
    }
  }
  return bad;
}

async function skyFromFiles({ work, files, name, transfer }) {
  const { code } = await transfer.skyCode(work.project, { name });
  const timecycle = await import("@modovik/timecycle");
  const project = timecycle.parseProject(
    JSON.stringify(templateState(await transfer.readWorkCode(code))),
  );

  const outside = [];
  let mismatched = 0;
  let modifiers = 0;
  for (const file of files) {
    const key = fileKey(file);
    if (WEATHER_FILE.test(key)) {
      const weather = timecycle.weatherFromFileName(file.name);
      const document = weather && parseWeatherDocument(timecycle, fileText(file));
      if (!document) {
        outside.push(key);
        continue;
      }
      mismatched += countMismatches(timecycle, project, weather, document);
    } else if (MODS_FILE.test(key)) {
      modifiers += (fileText(file).match(MODIFIER_TAG) ?? []).length;
    }
  }

  const lost = [];
  if (outside.length) lost.push(TEXT.outsideSky(outside.length, outside));
  if (mismatched) lost.push(TEXT.skyParams(mismatched));
  if (modifiers) lost.push(TEXT.modifiers(modifiers));
  return answer("sky", code, lost.length === 0, lost);
}

function differs(have, field, a, b) {
  const got = have.get(field);
  return !got || Math.abs(got[0] - a) > KILL_TOLERANCE || Math.abs(got[1] - b) > KILL_TOLERANCE;
}

async function killFromFiles({ work, files, name, transfer }) {
  const made = await transfer.killCode(work.project, { name });
  const lost = made.lost ? [made.lost] : [];

  const kill = await import("@modovik/kill-effects");
  const project = kill.createKillEffectProject(templateState(await transfer.readWorkCode(made.code)));
  const have = new Map(kill.resolveKillEffectFields(project).map(([field, a, b]) => [field, [a, b]]));

  const modifierFiles = [];
  for (const file of files) {
    const key = fileKey(file);
    if (MODS_FILE.test(key)) modifierFiles.push({ name: key, text: fileText(file) });
  }
  const winner = kill.winningKillModifier(modifierFiles);
  if (winner) {
    const missing = winner.filter(([field, a, b]) => differs(have, field, a, b)).map(([field]) => field);
    if (missing.length) lost.push(TEXT.killFields(missing));
  }
  return answer("kill", made.code, lost.length === 0, lost);
}

async function cloudsWork({ work, name, transfer }) {
  const { code } = await transfer.skyCode(work.project, { name });
  const clouds = work.clouds === undefined ? {} : work.clouds;
  return answer("sky", code, false, lossesByCode(CLOUD_LOSS, clouds.lost ?? [], clouds));
}

async function weatherWork({ work, name, transfer }) {
  const { code } = await transfer.skyCode(work.project, { name });
  const weather = work.weather === undefined ? {} : work.weather;
  const lost = lossesByCode(WEATHER_LOSS, weather.lost ?? [], weather);
  lost.push(TEXT.sunParticles);
  return answer("sky", code, false, lost);
}

async function minimapWork({ work, name, transfer }) {
  const made = await transfer.studioCode({ ...work.project, name }, "minimap");
  const lost = [];
  if (work.position) {
    lost.push(TEXT.frontend);
    if (work.position.differs.includes("minimap")) lost.push(TEXT.maskBlur);
    if (work.position.differs.includes("bigmap")) lost.push(TEXT.bigMap);
  } else {
    lost.push(...(work.lost ?? []), TEXT.stripes);
  }
  if (made.lost) lost.push(made.lost);
  return answer("minimap", made.code, false, lost);
}

async function impactWork({ work, name, transfer }) {
  const made = await transfer.effectsPartCode(work.project, "impact", { name });
  return answer("impact", made.code, work.exact === true, work.lost ?? []);
}

async function reticleWork({ work, name, transfer }) {
  const made = await transfer.studioCode({ ...work.project, name }, "reticle");
  return answer("reticle", made.code, false, work.lost ?? []);
}

async function waterWork({ work, name, transfer }) {
  const made = await transfer.recolorCode("water", work.project, { name });
  return answer("water", made.code, false, work.lost ?? []);
}

const hitFrameWork = async () => ({ work: null, lossless: false, lost: [TEXT.hitFrame] });

// Порядок важен: берётся первая подходящая ветка.
const BRANCHES = [
  { when: (work, kind) => work.kind === "sky" && kind === "timecycle", run: skyFromFiles },
  { when: (work) => work.kind === "kill", run: killFromFiles },
  { when: (work, kind) => work.kind === "sky" && kind === "clouds", run: cloudsWork },
  { when: (work, kind) => work.kind === "sky" && kind === "weather", run: weatherWork },
  { when: (work) => work.kind === "minimap", run: minimapWork },
  { when: (work) => work.kind === "impact", run: impactWork },
  { when: (work) => work.kind === "reticle", run: reticleWork },
  { when: (work) => work.kind === "recolor" && work.recolorKind === "water", run: waterWork },
  { when: (work) => work.kind === "screen-hits", run: hitFrameWork },
];

export async function partWork(kind, files, imported, { name = "" } = {}) {
  const work = imported?.work;
  if (!work) return null;
  try {
    const transfer = await import("../../workshop/works/work-transfer.js");
    const branch = BRANCHES.find((item) => item.when(work, kind));
    return branch ? await branch.run({ files, work, name, transfer }) : null;
  } catch {
    return null;
  }
}
