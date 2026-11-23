/*
 * Вид → правки weather.xml и cloudkeyframes.xml.
 *
 * Таймцикл отвечает за свет и цвет; всё остальное, что человек выключает и
 * выбирает, живёт в двух других файлах игры:
 *
 *  • weather.xml — есть ли у погоды дождь с лужами, снег, туман, молния и
 *    какой набор облачных шапок она берёт;
 *  • cloudkeyframes.xml — какие шапки в наборе разрешены и как они освещены
 *    в каждый час.
 *
 * Модуль не знает про архивы и работает и в окне (предпросмотр должен
 * показывать те же облака, что уедут в игру), и в главном процессе.
 */

import {
  CLEAR_SOURCE,
  LOOK_WEATHERS,
  recolour,
  resolveWeatherPlan,
} from "./look-apply.js";
import { cycleHours, hexToLinear, normalizeLook, skyPartColours } from "./look.js";
import { TIMECYCLE_SAMPLES } from "./samples.js";
import { cloudLightingFor, cloudTypesMask, sampleCloudKeys } from "./cloud-hats.js";
import {
  cloudTemplateSlot,
  findCloudTemplate,
  styleCloudKeys,
} from "./cloud-templates.js";

/** Набор облаков ясного дня: его разрешённые шапки и правит выбор облаков. */
export const CLEAR_CLOUD_SETTING = "LIGHTclouds";

/* Облака ясного дня свои — выбранные виды или готовое небо, — а не игры. */
const ownClouds = (look) => look.clouds.types !== null || look.clouds.template !== null;
const templateOf = (look) => findCloudTemplate(look.clouds.template, look.clouds.own);

/*
 * «Без облаков».
 *
 * Пустая маска — не выход: разрешённых шапок ноль, и что игра сделает с
 * выбором «одна из нуля», проверить негде, а падение игры — слишком дорогая
 * цена за проверку. Поэтому остаётся одна шапка, у которой облаков нет вовсе
 * (`horsey` — только высотные слои, видные с самолёта), а её плотность
 * сдвигается за край, где шейдер не рисует ничего.
 */
export const EMPTY_SKY_HAT = "horsey";
const INVISIBLE_DENSITY_SHIFT = 2;

const RAIN_DROPS = new Set(["RAINSTORM_DROP", "THUNDER_DROP"]);

/**
 * Правки weather.xml для вида.
 *
 * `types` — разобранные типы погоды игрока (`parseWeatherTypes`): нужны,
 * чтобы не просить правку того, чего в файле нет, и чтобы узнать, какие
 * частицы у праздничных типов — дождевые или снежные.
 */
export function lookWeatherXmlPlan(rawLook, types = []) {
  const look = normalizeLook(rawLook);
  const toggles = look.weather;
  const present = new Map(types.map((item) => [item.name, item]));
  const plan = {};
  const edit = (name) => (plan[name] ||= {});

  /* Хамелеон: каждый тип — копия одного (`resolveWeatherPlan`), а правки поверх
     копии считаются по ИСТОЧНИКУ: у копии в файле уже его осадки, молния и
     туман, а прежние числа самого типа ушли вместе с телом. */
  const chameleon = toggles.chameleon === true && Boolean(toggles.eternal);
  const chameleonSource = chameleon
    ? present.get(resolveWeatherPlan(toggles.eternal, { ...toggles, chameleon: false })?.base)
    : null;

  for (const item of LOOK_WEATHERS) {
    if (!present.has(item.id)) continue;
    const resolved = resolveWeatherPlan(item.id, toggles);
    if (resolved.base !== item.id) edit(item.id).cloneFrom = resolved.base;
  }

  /* Дождь у праздничных и служебных типов: они остаются собой, но без капель
     и мокрого асфальта. Частицы снимаются только дождевые: у снежного
     хеллоуина там хлопья, и их судьбу решает выключатель снега. */
  const eventFixups = (type) => {
    const values = {};
    const texts = {};
    if (!toggles.rain && Number(type.values.Rain) > 0) {
      values.Rain = 0;
      if (RAIN_DROPS.has(type.texts.DropSettingName)) {
        texts.DropSettingName = "-";
        texts.MistSettingName = "-";
        texts.GroundSettingName = "-";
      }
    }
    if (!toggles.snow && Number(type.values.Snow) > 0) {
      values.Snow = 0;
      values.SnowMist = 0;
      if (!RAIN_DROPS.has(type.texts.DropSettingName)) {
        texts.DropSettingName = "-";
        texts.GroundSettingName = "-";
      }
    }
    return { values, texts };
  };
  const sourceIsEvent =
    chameleonSource &&
    LOOK_WEATHERS.find((entry) => entry.id === chameleonSource.name)?.family === "event";
  for (const type of present.values()) {
    const item = LOOK_WEATHERS.find((entry) => entry.id === type.name);
    /* Хамелеон: праздничные типы больше не «собой» — у всех типов семнадцати
       тело источника, и снимать с них надо то, что снимается с источника. */
    const follows = chameleon && item && chameleonSource;
    if (follows ? !sourceIsEvent : item?.family !== "event") continue;
    const { values, texts } = eventFixups(follows ? chameleonSource : type);
    if (Object.keys(values).length) edit(type.name).values = values;
    if (Object.keys(texts).length) edit(type.name).texts = texts;
  }

  /* Молния и туман выключаются во всех типах, а не только в «своих»: гром в
     хеллоуин — тоже гром, а туман снегопада — тоже туман. */
  for (const type of present.values()) {
    const item = LOOK_WEATHERS.find((entry) => entry.id === type.name);
    const read = chameleon && item && chameleonSource ? chameleonSource : type;
    if (!toggles.thunder && read.values.Lightning === true)
      (edit(type.name).values ||= {}).Lightning = false;
    if (!toggles.fog && Number(read.values.Fog) > 0)
      (edit(type.name).values ||= {}).Fog = 0;
  }

  /* Выбранные облака получают все погоды, на которые ложится вид: ясные и
     выключенные (эти — уже копией ясного дня). У хамелеона копии все: имя
     набора пишется каждому типу сразу, не полагаясь на порядок правок. */
  if (ownClouds(look)) {
    for (const item of LOOK_WEATHERS) {
      if (!present.has(item.id)) continue;
      const resolved = resolveWeatherPlan(item.id, toggles);
      if (resolved.mode !== "look" || (resolved.base !== item.id && !chameleon)) continue;
      if (present.get(item.id).texts.CloudSettingsName !== CLEAR_CLOUD_SETTING || resolved.base !== item.id)
        (edit(item.id).texts ||= {}).CloudSettingsName = CLEAR_CLOUD_SETTING;
    }
  }

  for (const [name, value] of Object.entries(plan))
    if (!value.cloneFrom && !value.values && !value.texts) delete plan[name];
  return plan;
}

/** Какие наборы облаков носят погоды, на которые ложится вид. */
export function lookCloudSettings(rawLook, types = []) {
  const look = normalizeLook(rawLook);
  const names = new Set();
  for (const type of types) {
    const resolved = resolveWeatherPlan(type.name, look.weather);
    if (!resolved || resolved.mode !== "look") continue;
    if (ownClouds(look)) {
      names.add(CLEAR_CLOUD_SETTING);
      continue;
    }
    const source =
      resolved.base === type.name
        ? type
        : types.find((item) => item.name === resolved.base);
    const setting = source?.texts?.CloudSettingsName;
    if (setting) names.add(setting);
  }
  if (!names.size) names.add(CLEAR_CLOUD_SETTING);
  return [...names];
}

/*
 * Срез вида для ключа облаков.
 *
 * Ключей у облаков четырнадцать: к часам таймцикла добавлены четыре утра и
 * «24» — та же полночь, замыкающая кольцо. Четыре утра берут срез пяти утра:
 * это та же предрассветная ночь, и отдельной настройки у неё нет.
 */
function slotForKeyHour(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  const exact = TIMECYCLE_SAMPLES.find((sample) => sample.hour === normalized);
  if (exact) return exact.index;
  if (normalized === 4) return 1;
  let best = 0;
  let distance = Infinity;
  for (const sample of TIMECYCLE_SAMPLES) {
    const gap = Math.abs(sample.hour - normalized);
    if (gap < distance) {
      best = sample.index;
      distance = gap;
    }
  }
  return best;
}

const colourOf = (row) => row.slice(1, 4);

function recolourRow(row, target, strength) {
  if (!target) return row;
  const next = recolour(colourOf(row), target, strength).map((value) =>
    Math.min(Math.max(value, 0), 4),
  );
  return [row[0], ...next, row[4]];
}

/*
 * Сколько облаков. Шейдер шапок гасит облако, когда плотность текстуры не
 * дотягивает до сдвига (`gDensityShiftScale.x`): сдвиг выше — облака тоньше
 * и реже, ниже — гуще. Та же шкала, что у облаков купола: единица — как в
 * игре, ноль — нет вовсе, два — вдвое гуще.
 */
function shiftForAmount(shift, amount) {
  if (amount === null || amount === undefined) return shift;
  const a = Math.min(Math.max(Number(amount), 0), 2);
  if (a === 0) return INVISIBLE_DENSITY_SHIFT;
  if (a < 1) return shift + (1 - a) * 0.6;
  return Math.max(shift - (a - 1) * 0.35, -0.6);
}

/*
 * Из какого часа облака берут свет в этот ключ.
 *
 * Вечный день и вечная ночь ставят в каждый час таймцикла числа полудня или
 * полуночи (`applyCycle` в `look-apply.js`), а «этот час как другой» — числа
 * другого среза (`from`). Облака — часть того же неба: без перестановки их
 * ключей вечная ночь в полдень несла бы полуденный свет облаков над чёрным
 * небом — белую засветку, в которой видны края моделей шапок (жалоба
 * владельца 12.10.2026: «острые углы»). Небо в вечных сутках берётся из часа
 * неба (`cycleHours(...).sky`), и облака — оттуда же.
 */
function cloudSourceHour(look, hour) {
  const from = cycleHours(look.cycle);
  if (from) return from.sky;
  const slot = look.slots[slotForKeyHour(hour)];
  if (slot?.from !== null && slot?.from !== undefined)
    return TIMECYCLE_SAMPLES[slot.from]?.hour ?? hour;
  return hour;
}

/** Ключи раздела после перестановки часов: значения — из часа-источника. */
function remapCloudRows(rows, look) {
  return rows.map((row) => {
    const own = ((Number(row[0]) % 24) + 24) % 24;
    const source = cloudSourceHour(look, own);
    if (source === own) return row;
    const sampled = sampleCloudKeys(rows, source);
    return sampled ? [row[0], ...sampled] : row;
  });
}

/**
 * Ключи одного набора облаков под вид: цвет облаков, отсвет неба, цвет
 * солнца на облаках и их густота — по срезам суток.
 */
export function lookCloudKeys(setting, rawLook) {
  const look = normalizeLook(rawLook);
  const empty = Array.isArray(look.clouds.types) && !look.clouds.types.length;
  const keys = {};
  const original = setting?.keys || {};
  /* Сначала — чей час: вечные сутки и «этот час как другой», потом правки
     среза, как и у таймцикла (`applyLookToRegion`). */
  const sections = Object.fromEntries(
    Object.entries(original).map(([section, rows]) => [
      section,
      Array.isArray(rows) && rows.length ? remapCloudRows(rows, look) : rows,
    ]),
  );
  const changed = (section, next) => {
    const rows = original[section];
    return next.some((row, index) => row.some((value, channel) => value !== rows[index][channel]));
  };
  for (const [section, rows] of Object.entries(sections))
    if (Array.isArray(rows) && rows.length && changed(section, rows)) keys[section] = rows;
  const perRow = (section, change) => {
    const rows = sections[section];
    if (!rows?.length) return;
    const next = rows.map((row) => change(row, look.slots[slotForKeyHour(row[0])]));
    if (changed(section, next)) keys[section] = next;
  };

  perRow("CloudColor", (row, slot) =>
    recolourRow(row, hexToLinear(slot.clouds.colour), 0.9),
  );
  perRow("CloudSkyColor", (row, slot) =>
    recolourRow(row, slot.sky ? hexToLinear(slot.sky.zenith) : null, 0.7),
  );
  perRow("CloudAmbientColor", (row, slot) =>
    recolourRow(row, slot.sky ? hexToLinear(slot.sky.zenith) : null, 0.4),
  );
  /* Облако освещено той стороной горизонта, к которой повёрнуто: у
     радужного неба восток и запад разные, и облака берут каждый свой. */
  for (const [section, part] of [
    ["CloudEastColor", "east"],
    ["CloudWestColor", "west"],
  ])
    perRow(section, (row, slot) =>
      recolourRow(
        row,
        slot.sky ? hexToLinear(skyPartColours(slot.sky)[part]) : null,
        0.7,
      ),
    );
  perRow("CloudLightColor", (row, slot) =>
    recolourRow(row, hexToLinear(slot.sun.colour), 0.8),
  );
  perRow("CloudDensityShift_Scale_ScatteringConst_Scale", (row, slot) => [
    row[0],
    empty ? INVISIBLE_DENSITY_SHIFT : shiftForAmount(row[1], slot.clouds.amount),
    row[2],
    row[3],
    row[4],
  ]);
  return keys;
}

/**
 * Набор, чьим светом освещены облака ясного дня под этим видом.
 *
 * «Как в игре» — сам ясный набор. Свои облака — родной набор самого тяжёлого
 * из выбранных (`cloudLightingFor`), готовое небо — набор шаблона; если
 * такого набора у игрока нет — ясный.
 */
export function lookCloudLighting(rawLook, cloudKeyframes) {
  const look = normalizeLook(rawLook);
  const clear = cloudKeyframes?.settings?.get(CLEAR_CLOUD_SETTING) || null;
  const template = templateOf(look);
  if (template) return cloudKeyframes?.settings?.get(template.lighting) || clear;
  if (!look.clouds.types?.length) return clear;
  return cloudKeyframes.settings.get(cloudLightingFor(look.clouds.types)) || clear;
}

/**
 * Ключи ясного набора под вид. Если свет берётся у другого набора, он
 * переезжает в ясный целиком — все разделы, — а правки вида ложатся сверху.
 * Ясный набор носят только ясные погоды (EXTRASUNNY и CLEAR), поэтому дождь
 * и гроза своего света не теряют.
 *
 * У готового неба свет переезжает всегда целиком и со стилем шаблона
 * (`styleCloudKeys`): прямой свет, заливка и окружение в его долях, — а
 * цвет облаков и их густота из вида ложатся уже поверх стиля.
 */
export function lookClearCloudKeys(rawLook, cloudKeyframes) {
  const look = normalizeLook(rawLook);
  const clear = cloudKeyframes?.settings?.get(CLEAR_CLOUD_SETTING) || null;
  const lighting = lookCloudLighting(look, cloudKeyframes);
  if (!lighting) return {};
  const template = templateOf(look);
  if (template) {
    const styled = styleCloudKeys(lighting.keys, template.style);
    return { ...styled, ...lookCloudKeys({ keys: styled }, look) };
  }
  if (lighting === clear) return lookCloudKeys(clear, look);
  return { ...lighting.keys, ...lookCloudKeys(lighting, look) };
}

/**
 * Место готового неба у этого игрока (`cloudTemplateSlot`): шапка-слот, если
 * её не держит ни один набор. Без разобранного clouds.xml места нет — шаблон
 * без файла шапок не собрать.
 */
export const lookCloudTemplateSlot = (cloudHats, cloudKeyframes) =>
  cloudHats ? cloudTemplateSlot(cloudHats, cloudKeyframes, CLEAR_CLOUD_SETTING) : null;

/**
 * Правки cloudkeyframes.xml для вида: разрешённые шапки ясного набора и
 * ключи всех наборов, которые носят «ваши» погоды.
 *
 * `cloudHats` — разобранный `clouds.xml` игрока: из него берутся номера
 * битов. Без него — ванильный порядок.
 */
export function lookCloudKeyframesPlan(rawLook, cloudKeyframes, types = [], cloudHats = null) {
  const look = normalizeLook(rawLook);
  const plan = {};
  if (!cloudKeyframes?.settings) return plan;
  /* Готовое небо: ясный набор разрешает одну шапку — слот, куда шаблон
     записан в clouds.xml (`writeCloudTemplate`). Места нет — ясный набор не
     трогается: без записанной шапки бит слота показал бы чужие облака. */
  if (templateOf(look)) {
    const clear = cloudKeyframes.settings.get(CLEAR_CLOUD_SETTING);
    const slot = lookCloudTemplateSlot(cloudHats, cloudKeyframes);
    if (clear && slot && slot.index < clear.probability.length) {
      const keys = lookClearCloudKeys(look, cloudKeyframes);
      plan[CLEAR_CLOUD_SETTING] = {
        bits: (1 << slot.index) >>> 0,
        probability: clear.probability.map((value, bit) =>
          bit === slot.index ? 5 : value,
        ),
        ...(Object.keys(keys).length ? { keys } : {}),
      };
    }
  } else if (look.clouds.types !== null) {
    const clear = cloudKeyframes.settings.get(CLEAR_CLOUD_SETTING);
    if (clear) {
      const chosen = look.clouds.types.length
        ? look.clouds.types
        : [];
      const mask = chosen.length
        ? cloudTypesMask(chosen, cloudHats)
        : emptyMask(cloudHats);
      /* Веса у выбранных — поровну: выбор «перистые и барашки» значит «то
         одно, то другое», а не «почти всегда первое». */
      const probability = clear.probability.map((value, bit) =>
        (mask >>> bit) & 1 ? 5 : value,
      );
      const keys = lookClearCloudKeys(look, cloudKeyframes);
      plan[CLEAR_CLOUD_SETTING] = {
        bits: mask,
        probability,
        ...(Object.keys(keys).length ? { keys } : {}),
      };
    }
  }
  for (const name of lookCloudSettings(look, types)) {
    /* Ясный набор под своими облаками уже собран выше вместе со светом. */
    if (ownClouds(look) && name === CLEAR_CLOUD_SETTING) continue;
    const setting = cloudKeyframes.settings.get(name);
    if (!setting) continue;
    const keys = lookCloudKeys(setting, look);
    if (Object.keys(keys).length) plan[name] = { ...(plan[name] || {}), keys };
  }
  return plan;
}

function emptyMask(cloudHats) {
  const order = cloudHats?.hats?.map((item) => item.name.toLowerCase()) || [];
  const index = order.indexOf(EMPTY_SKY_HAT);
  return ((1 << (index >= 0 ? index : 18)) >>> 0);
}

/** Какая погода служит ясным днём предпросмотра. */
export const PREVIEW_WEATHER = CLEAR_SOURCE;
