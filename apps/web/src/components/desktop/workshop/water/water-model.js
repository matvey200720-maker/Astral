
import { tr } from "../../../../locales/ui.js";
/*
 * Вода: что человек правит и в каких величинах.
 *
 * Слот каталога `water` до сих пор был мёртвой плиткой — кнопка
 * «Кастомизировать» проваливалась сквозь весь реестр редакторов и отвечала
 * красным тостом. Здесь описано то, что в воде GTA V правят на самом деле, и
 * описано величинами игры, а не процентами «от чего-то»:
 *
 *   • `surface.amplitude`   → WaterWaveQuad.Amplitude       (water.xml)
 *   • `surface.direction`   → WaterWaveQuad.XDirection/YDirection
 *   • `surface.dampening`   → WaterCalmingQuad.fDampening
 *   • `surface.level`       → WaterQuad.z
 *   • `optics.reflection`   → water_reflection              (таймцикл)
 *   • `optics.specular`     → water_specular_intensity
 *   • `optics.foam`         → water_foam_intensity_mult
 *   • `optics.drying`       → water_drying_speed_mult
 *
 * Всё остальное — цвет мелководья, цвет глубины, прозрачность, уклон дна —
 * ЖИВЁТ ТОЛЬКО В ПРЕДПРОСМОТРЕ, и это сказано в редакторе вслух. Цвет каждого
 * водоёма игра держит в `waterheight.dat` (бинарный WMAP: 13 рек, 15 озёр, 314
 * бассейнов и 342 персональных цвета), парсера которого в вебе нет, а доставка
 * воды в игру помечена в `packages/mod-targets` как заблокированная. Ползунок,
 * который нельзя ни применить, ни увидеть в игре, — это вторая история
 * `waterTint`, и повторять её здесь незачем.
 *
 * Модель держится отдельно от сцены и от разметки по той же причине, что у
 * дорог и арены: сцена её только читает, а проверяется она целиком и без окна.
 */

export const WATER_SLOT_ID = "water";
export const WATER_PROJECT_FORMAT = "astral-water";
export const WATER_PROJECT_VERSION = 1;

/*
 * Потолок амплитуды волны.
 *
 * В ванильном `water.xml` у океанских WaveQuad стоит 0.1, и это спокойная зыбь.
 * Восьмая десятая — уже шторм, за которым волна начинает опрокидываться сама на
 * себя: гребень Гершнера при такой крутизне даёт петлю, и поверхность рвётся.
 * Потолок стоит здесь, а не в ползунке, чтобы чужой файл с амплитудой в
 * двадцать метров открывался штормом, а не разорванной сеткой.
 */
export const AMPLITUDE_MAX = 0.8;

/*
 * Сколько волн Гершнера складывается в поверхность.
 *
 * Меньше четырёх — видно решётку: сумма читается как одна синусоида с рябью.
 * Больше шести — каждая следующая уже короче шага сетки у горизонта и работает
 * не на форму, а на муар. Пять — там, где эти два края расходятся.
 */
export const WAVE_TRAINS = 5;

/**
 * Уровень воды в мире сцены.
 *
 * Это `WaterQuad.z` — в ванильном океане ноль. Ползунок ходит вокруг нуля
 * метрами, потому что мод «поднять воду» правит именно это поле, и правит его
 * метрами.
 */
export const WATER_RANGES = Object.freeze({
  amplitude: { min: 0, max: AMPLITUDE_MAX, step: 0.01 },
  direction: { min: 0, max: 359, step: 1 },
  dampening: { min: 0, max: 1, step: 0.01 },
  level: { min: -4, max: 4, step: 0.1 },
  clarity: { min: 0, max: 100, step: 1 },
  slope: { min: 2, max: 22, step: 0.5 },
  foamWidth: { min: 0, max: 100, step: 1 },
  specular: { min: 0, max: 200, step: 1 },
  foam: { min: 0, max: 200, step: 1 },
  drying: { min: 0, max: 300, step: 1 },
  timeOfDay: { min: 0, max: 24, step: 0.1 },
});

/**
 * Ракурсы.
 *
 * Вода читается на скользящем угле, где френель максимален, — то есть с уровня
 * глаз, а не с вертолёта. Обзор сверху оставлен третьим и не первым намеренно:
 * с него видно полосу бирюзы у берега и больше ничего из того, ради чего эту
 * работу делают.
 */
export const WATER_EYES = Object.freeze([
  Object.freeze({
    value: "shore",
    label: "С берега",
    hint: "Кромка прибоя вблизи, залив до горизонта",
  }),
  Object.freeze({
    value: "boat",
    label: "С лодки",
    hint: "Над самой водой: гребни, дорожка солнца, отражённые горы",
  }),
  Object.freeze({
    value: "high",
    label: "Сверху",
    hint: "Видно, как бирюза отмели уходит в глубокую синь",
  }),
]);

/**
 * Часы, ради которых редактор показывает сутки.
 *
 * Вода меняется не «днём и ночью», а на скользящем солнце: в полдень она отдаёт
 * цветом толщи, на закате — почти целиком отражением. Ночь тоже нужна: по ней
 * видно, не светится ли пена сама по себе.
 */
export const TIME_MARKS = Object.freeze([
  Object.freeze({ id: "dawn", label: "Рассвет", hour: 6.3 }),
  Object.freeze({ id: "day", label: "День", hour: 12.5 }),
  Object.freeze({ id: "dusk", label: "Закат", hour: 19.3 }),
  Object.freeze({ id: "night", label: "Ночь", hour: 23.5 }),
]);

/**
 * Пресеты — это не «краски», а наборы полей квадов.
 *
 * Каждый пресет раскладывается в конкретные значения `Amplitude`,
 * `fDampening` и `z`, то есть в правку конкретных квадов `water.xml`. Бассейн
 * отличается от океана не цветом, а тем, что у него амплитуда ноль, гашение
 * полное, а дно в двух метрах.
 */
export const WATER_PRESETS = Object.freeze([
  Object.freeze({
    id: "calm",
    label: "Штиль",
    hint: "Зеркало: волны нет, отражение берега целое",
    surface: { amplitude: 0, direction: 250, dampening: 0.35, level: 0 },
    body: { shallow: "#3fd0c6", deep: "#06263f", clarity: 74, foamWidth: 24 },
    shore: { slope: 7 },
  }),
  Object.freeze({
    id: "bay",
    label: "Залив",
    hint: "Ванильная зыбь океана: Amplitude 0.10",
    surface: { amplitude: 0.1, direction: 250, dampening: 0.05, level: 0 },
    body: { shallow: "#37c9c2", deep: "#062a45", clarity: 66, foamWidth: 34 },
    shore: { slope: 7 },
  }),
  Object.freeze({
    id: "swell",
    label: "Зыбь",
    hint: "Длинная волна с открытого моря, гребни ещё не рвутся",
    surface: { amplitude: 0.3, direction: 232, dampening: 0.02, level: 0 },
    body: { shallow: "#2fb9bd", deep: "#052437", clarity: 58, foamWidth: 46 },
    shore: { slope: 9 },
  }),
  Object.freeze({
    id: "storm",
    label: "Шторм",
    hint: "Гребни опрокидываются, дорожка солнца рвётся, пены много",
    surface: { amplitude: 0.62, direction: 214, dampening: 0, level: 0.4 },
    body: { shallow: "#2a9aa6", deep: "#04202f", clarity: 40, foamWidth: 62 },
    shore: { slope: 12 },
  }),
  Object.freeze({
    id: "pool",
    label: "Бассейн",
    hint: "Гашение полное, дно близко: чистая бирюза и каустики",
    surface: { amplitude: 0, direction: 250, dampening: 1, level: 0 },
    body: { shallow: "#5fe0d4", deep: "#0b6f83", clarity: 96, foamWidth: 8 },
    shore: { slope: 20 },
  }),
]);

const DEFAULT_PRESET = "bay";

const preset = (id) =>
  WATER_PRESETS.find((entry) => entry.id === id) || WATER_PRESETS[1];

export const presetById = preset;

const DEFAULTS = Object.freeze({
  name: "Вода",
  presetId: DEFAULT_PRESET,
  surface: Object.freeze({ ...preset(DEFAULT_PRESET).surface }),
  body: Object.freeze({ ...preset(DEFAULT_PRESET).body }),
  shore: Object.freeze({ ...preset(DEFAULT_PRESET).shore }),
  /*
   * Оптика — единственный раздел, который в самом деле уезжает в таймцикл.
   * Сто процентов здесь означают «как в игре»: множители таймцикла — это
   * единицы, а не проценты, и ползунок на сотне не правит ничего.
   */
  optics: Object.freeze({
    reflection: true,
    specular: 100,
    foam: 100,
    drying: 100,
  }),
  view: Object.freeze({ eye: "shore", timeOfDay: 17.4 }),
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function clampTo(range, value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const stepped =
    Math.round(clamp(numeric, range.min, range.max) / range.step) * range.step;
  /* Хвост двоичной дроби виден в подписи ползунка: 0.30000000000000004 вместо
     0.3 читается как поломка, хотя это ровно то же число. */
  return Number(stepped.toFixed(4));
}

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value, fallback) =>
  HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback;

const oneOf = (values, value, fallback) =>
  values.includes(value) ? value : fallback;

/** Проект целиком, приведённый к пределам. Чужой файл проходит здесь же. */
export function createWaterProject(source = {}) {
  const base = source && typeof source === "object" ? source : {};
  const surface = base.surface || {};
  const body = base.body || {};
  const shore = base.shore || {};
  const optics = base.optics || {};
  const view = base.view || {};
  return {
    name: String(base.name ?? DEFAULTS.name).slice(0, 80) || DEFAULTS.name,
    presetId: oneOf(
      WATER_PRESETS.map((entry) => entry.id),
      base.presetId,
      DEFAULTS.presetId,
    ),
    surface: {
      amplitude: clampTo(
        WATER_RANGES.amplitude,
        surface.amplitude,
        DEFAULTS.surface.amplitude,
      ),
      direction: clampTo(
        WATER_RANGES.direction,
        surface.direction,
        DEFAULTS.surface.direction,
      ),
      dampening: clampTo(
        WATER_RANGES.dampening,
        surface.dampening,
        DEFAULTS.surface.dampening,
      ),
      level: clampTo(WATER_RANGES.level, surface.level, DEFAULTS.surface.level),
    },
    body: {
      shallow: colour(body.shallow, DEFAULTS.body.shallow),
      deep: colour(body.deep, DEFAULTS.body.deep),
      clarity: clampTo(
        WATER_RANGES.clarity,
        body.clarity,
        DEFAULTS.body.clarity,
      ),
      foamWidth: clampTo(
        WATER_RANGES.foamWidth,
        body.foamWidth,
        DEFAULTS.body.foamWidth,
      ),
    },
    shore: {
      slope: clampTo(WATER_RANGES.slope, shore.slope, DEFAULTS.shore.slope),
    },
    optics: {
      reflection: optics.reflection !== false,
      specular: clampTo(
        WATER_RANGES.specular,
        optics.specular,
        DEFAULTS.optics.specular,
      ),
      foam: clampTo(WATER_RANGES.foam, optics.foam, DEFAULTS.optics.foam),
      drying: clampTo(
        WATER_RANGES.drying,
        optics.drying,
        DEFAULTS.optics.drying,
      ),
    },
    view: {
      eye: oneOf(
        WATER_EYES.map((entry) => entry.value),
        view.eye,
        DEFAULTS.view.eye,
      ),
      timeOfDay: clampTo(
        WATER_RANGES.timeOfDay,
        view.timeOfDay,
        DEFAULTS.view.timeOfDay,
      ),
    },
  };
}

export const defaultWaterProject = () => createWaterProject();

/** Проект, собранный по пресету: пресет правит поверхность, толщу и берег. */
export function projectFromPreset(current, presetId) {
  const chosen = preset(presetId);
  return createWaterProject({
    ...current,
    presetId: chosen.id,
    surface: { ...chosen.surface },
    body: { ...chosen.body },
    shore: { ...chosen.shore },
  });
}

/* ---------- производные величины ---------- */

/**
 * Сила ветра — один орган на всё.
 *
 * Это не отдельное поле проекта, а прочтение амплитуды: ветер в воде ничем
 * другим и не выражается. От него зависят сразу четыре вещи — крутизна волны,
 * шероховатость блика, плотность пены на гребнях и скорость бега волн, — и
 * держать под них четыре ползунка значило бы позволить человеку собрать
 * невозможную воду: зеркальную гладь с рваной дорожкой солнца.
 */
export const windScale = (project) =>
  clamp((project?.surface?.amplitude || 0) / AMPLITUDE_MAX, 0, 1);

/**
 * Направление волны в полях игры.
 *
 * `XDirection`/`YDirection` в `water.xml` — нормализованный вектор в плоскости
 * карты (у GTA V ось Y смотрит на север). Ноль градусов — волна идёт на север,
 * дальше по часовой стрелке, как на компасе.
 */
export function waveDirection(project) {
  const radians = ((project?.surface?.direction || 0) * Math.PI) / 180;
  return {
    x: Number(Math.sin(radians).toFixed(4)),
    y: Number(Math.cos(radians).toFixed(4)),
  };
}

const COMPASS = [
  "север",
  "северо-восток",
  "восток",
  "юго-восток",
  "юг",
  "юго-запад",
  "запад",
  "северо-запад",
];

/** Румб словами: человек проверяет не число, а куда легла волна. */
export const waveCompass = (degrees) =>
  tr(COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]);

/**
 * Квады, которые правит проект.
 *
 * Ровно поля `WaterWaveQuad`, `WaterCalmingQuad` и `WaterQuad` из `water.xml`
 * (см. `native/CodeWalker.Core/World/Water.cs`). Границы квадов здесь не
 * трогаются: мод «волны выше» правит амплитуду существующих квадов, а не
 * перекраивает карту воды.
 */
export function waterQuads(project) {
  const value = createWaterProject(project);
  const direction = waveDirection(value);
  return {
    wave: {
      Amplitude: value.surface.amplitude,
      XDirection: direction.x,
      YDirection: direction.y,
    },
    calming: { fDampening: value.surface.dampening },
    water: { z: value.surface.level },
  };
}

/**
 * Поля модификатора таймцикла — только настоящие имена.
 *
 * Проверено по `packages/timecycle/parameter-names.js`: каждое имя ниже есть в
 * ванильном наборе из 423 параметров. Выдуманных `water_ocean_*` и
 * `water_shallow_*` здесь нет и быть не может — игра такие поля молча
 * игнорирует, и мод получается пустышкой.
 */
export function waterTimecycleFields(project) {
  const value = createWaterProject(project);
  return [
    ["water_reflection", value.optics.reflection ? 1 : 0],
    ["water_specular_intensity", value.optics.specular / 100],
    ["water_foam_intensity_mult", value.optics.foam / 100],
    ["water_drying_speed_mult", value.optics.drying / 100],
  ];
}

/* ---------- сборка файлов ---------- */

const xmlNumber = (value) => Number(value).toFixed(6);

/**
 * Кусок `water.xml` с правленными квадами.
 *
 * Именно кусок, а не файл целиком: настоящий `water.xml` — это тысячи квадов
 * всей карты, и подменять его выдуманным значило бы стереть воду в остальном
 * мире. Человек вставляет отсюда поля в свои квады.
 */
export function buildWaterXml(project) {
  const quads = waterQuads(project);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!--",
    tr("  Astral: правка квадов воды. Вставьте поля в свои квады water.xml"),
    tr("  (common.rpf/data/levels/gta5/water.xml). Границы квадов не трогаются."),
    "-->",
    "<WaterData>",
    "  <WaterQuads>",
    "    <Item>",
    `      <z value="${xmlNumber(quads.water.z)}" />`,
    "    </Item>",
    "  </WaterQuads>",
    "  <CalmingQuads>",
    "    <Item>",
    `      <fDampening value="${xmlNumber(quads.calming.fDampening)}" />`,
    "    </Item>",
    "  </CalmingQuads>",
    "  <WaveQuads>",
    "    <Item>",
    `      <Amplitude value="${xmlNumber(quads.wave.Amplitude)}" />`,
    `      <XDirection value="${xmlNumber(quads.wave.XDirection)}" />`,
    `      <YDirection value="${xmlNumber(quads.wave.YDirection)}" />`,
    "    </Item>",
    "  </WaveQuads>",
    "</WaterData>",
    "",
  ].join("\n");
}

/** Модификатор таймцикла с водными параметрами — тоже для ручной установки. */
export function buildWaterTimecycleXml(project, name = "astral_water") {
  const fields = waterTimecycleFields(project);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<timecycle_modifier_data version="1.000000">',
    `  <modifier name="${name}" numMods="${fields.length}" userFlags="0">`,
    ...fields.map(
      ([field, value]) => `    <${field}>${xmlNumber(value)}</${field}>`,
    ),
    "  </modifier>",
    "</timecycle_modifier_data>",
    "",
  ].join("\n");
}

/* ---------- описание и счёт правок ---------- */

/** Сколько полей уехало от штатных. По нему включается кнопка «Сохранить». */
export function waterProjectStats(project) {
  const value = createWaterProject(project);
  const base = defaultWaterProject();
  let changes = 0;
  for (const section of ["surface", "body", "shore", "optics"]) {
    for (const key of Object.keys(base[section])) {
      if (value[section][key] !== base[section][key]) changes += 1;
    }
  }
  return {
    changes,
    /* Сколько полей проекта в самом деле уезжает в файлы игры: три квада плюс
       четыре параметра таймцикла. Остальное живёт только в окне. */
    gameFields: waterTimecycleFields(value).length + 4,
    windPercent: Math.round(windScale(value) * 100),
  };
}

export const waterProjectIsDefault = (project) =>
  waterProjectStats(project).changes === 0;

/** Одна строка под заголовком редактора. */
export function describeWaterProject(project) {
  const value = createWaterProject(project);
  const wind = Math.round(windScale(value) * 100);
  const level = value.surface.level;
  return [
    tr(preset(value.presetId).label.toLowerCase()),
    value.surface.amplitude > 0
      ? tr("волна {amp} на {dir}")
          .replace("{amp}", value.surface.amplitude.toFixed(2))
          .replace("{dir}", waveCompass(value.surface.direction))
      : tr("штиль"),
    /* Уровень называется только сдвинутый: буй тянут глядя на залив, а не на
       ползунок, и строка — единственное место, где виден точный метраж. Ноль
       здесь был бы шумом на каждом штатном проекте. */
    ...(level !== 0
      ? [
          tr("уровень {level} м").replace(
            "{level}",
            `${level > 0 ? "+" : ""}${level.toFixed(1)}`,
          ),
        ]
      : []),
    tr("ветер {wind}%").replace("{wind}", wind),
    value.surface.dampening > 0
      ? tr("гашение {value}").replace(
          "{value}",
          value.surface.dampening.toFixed(2),
        )
      : tr("без гашения"),
  ].join(" · ");
}

export function serializeWaterProject(project) {
  return JSON.stringify(
    {
      format: WATER_PROJECT_FORMAT,
      version: WATER_PROJECT_VERSION,
      ...createWaterProject(project),
    },
    null,
    2,
  );
}

/**
 * Разбор своего файла.
 *
 * Чужой формат отбивается по метке, а не по тому, что внутри не нашлось полей:
 * иначе проект дорог открылся бы штатным заливом и выглядел бы как потеря
 * работы, а не как отказ.
 */
export function parseWaterProject(raw) {
  let value = null;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(tr("Файл не читается как проект воды"));
  }
  if (!value || value.format !== WATER_PROJECT_FORMAT) {
    throw new Error(tr("Это не проект воды Astral"));
  }
  return createWaterProject(value);
}
