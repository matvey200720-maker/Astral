/*
 * Облачные шапки GTA V: какие облака бывают и когда.
 *
 * Большие облака на небе игры — не шум в шейдере купола (тот рисует только
 * лёгкую высокую пелену, `sky_cloud_*` в таймцикле), а «шапки»: модели
 * `cloudhat_*` в `x64b.rpf/levels/gta5/cloudhats/v_clouds.rpf` с текстурами
 * плотности и нормалей. Какие шапки бывают, описывают два файла:
 *
 *   common/data/clouds.xml          — сами шапки: имя, слои-модели, масштаб,
 *                                     скорость анимации (порядок в файле —
 *                                     номер бита в наборах ниже);
 *   common/data/cloudkeyframes.xml  — наборы по погоде (`LIGHTclouds`,
 *                                     `HEAVYclouds` …): какие шапки разрешены
 *                                     (`mBits`), с каким весом
 *                                     (`mProbability`) и как их освещать в
 *                                     каждый час — четырнадцать ключей суток.
 *
 * Тип погоды выбирает набор полем `CloudSettingsName` в `weather.xml`. Когда
 * погода сменяется, игра берёт одну из разрешённых шапок по весу и
 * держит её, пока погода не сменится снова.
 *
 * Выбор «какие облака» в редакторе — это `mBits` набора ясной погоды. Сами
 * модели и текстуры не трогаются: они остаются из игры человека.
 */

import { SaxesParser } from "saxes";

import { xmlForParsing } from "./xml-declaration.js";

const MAX_CLOUD_XML_BYTES = 4 * 1024 * 1024;

/*
 * Шапки в порядке ванильного `clouds.xml`. Порядок — это номера битов, но
 * верить ему вслепую нельзя: чужой мод облаков может переставить или
 * добавить шапки. Поэтому номер берётся из файла игрока по имени
 * (`cloudHatBits`), а этот список — запасной, на случай, когда файла нет.
 */
export const VANILLA_CLOUD_HAT_ORDER = Object.freeze([
  "Cloudy 01",
  "RAIN",
  "horizonband1",
  "horizonband2",
  "Puffs",
  "Wispy",
  "Horizon",
  "Stormy 01",
  "Clear 01",
  "Snowy 01",
  "Contrails",
  "altostratus",
  "Nimbus",
  "Cirrus",
  "cirrocumulus",
  "stratoscumulus",
  "horizonband3",
  "Stripey",
  "horsey",
  "shower",
]);

/*
 * Модели слоёв каждой шапки ванильного `clouds.xml` (update.rpf). По ним
 * узнаётся, какие облака на самом деле стоят под именем шапки у чужого
 * мода: моды облаков чаще меняют не имена и биты, а слои — у COMPETITIVE
 * V2 REDUX все двадцать шапок носят слои «Cloudy 01» (`cloudHatLook`).
 */
const ALTITUDE_MED = ["cloudhat_altitude_med_a", "cloudhat_altitude_med_b", "cloudhat_altitude_med_c"];
const ALTITUDE_HEAVY = ["cloudhat_altitude_heavy_a", "cloudhat_altitude_heavy_b", "cloudhat_altitude_heavy_c"];
const ALTITUDE_LIGHT = ["cloudhat_altitude_light_a", "cloudhat_altitude_light_b"];
const ALTITUDE_VLIGHT = ["cloudhat_altitude_Vlight_a", "cloudhat_altitude_Vlight_b"];
export const VANILLA_CLOUD_HAT_LAYERS = Object.freeze({
  "Cloudy 01": ["horizonring", "cloudhat_cloudy_base", "cloudhat_cloudy_a", "cloudhat_cloudy_b", "cloudhat_cloudy_c", "cloudhat_cloudy_d", "cloudhat_cloudy_e", "cloudhat_cloudy_f", ...ALTITUDE_MED],
  RAIN: ["cloudhat_RAIN_a", "cloudhat_RAIN_b", ...ALTITUDE_HEAVY],
  horizonband1: ["horizonring", "cloudhat_clear01_a", ...ALTITUDE_MED],
  horizonband2: ["horizonring", "cloudhat_cloudy_a", ...ALTITUDE_MED],
  Puffs: ["horizonring", "cloudhat_PUFF_a", "cloudhat_PUFF_b", "cloudhat_PUFF_c", ...ALTITUDE_VLIGHT],
  Wispy: ["horizonring", "cloudhat_WISPY_a", "cloudhat_WISPY_b", ...ALTITUDE_VLIGHT],
  Horizon: ["horizonring", "cloudhat_HORIZON_a", "cloudhat_HORIZON_b", "cloudhat_HORIZON_c", ...ALTITUDE_LIGHT],
  "Stormy 01": ["cloudhat_stormy01_a", "cloudhat_stormy01_b", "cloudhat_stormy01_c", "cloudhat_stormy01_d", "cloudhat_stormy01_e", "cloudhat_stormy01_f", ...ALTITUDE_HEAVY],
  "Clear 01": ["horizonring", "cloudhat_clear01_a", "cloudhat_clear01_b", "cloudhat_clear01_c", ...ALTITUDE_LIGHT],
  "Snowy 01": ["cloudhat_snowy01"],
  Contrails: ["horizonring", "cloudhat_contrails_a", "cloudhat_contrails_b", "cloudhat_contrails_c", "cloudhat_contrails_d", ...ALTITUDE_VLIGHT],
  altostratus: ["horizonring", "cloudhat_altostatus_a", "cloudhat_altostatus_b", ...ALTITUDE_MED],
  Nimbus: ["horizonring", "cloudhat_nimbus_a", "cloudhat_nimbus_b", "cloudhat_nimbus_c", ...ALTITUDE_LIGHT],
  Cirrus: ["horizonring", "cloudhat_cirrus", ...ALTITUDE_VLIGHT],
  cirrocumulus: ["horizonring", "cloudhat_cirrocumulus_a", "cloudhat_cirrocumulus_b", ...ALTITUDE_LIGHT],
  stratoscumulus: ["horizonring", "cloudhat_stratocumulus", ...ALTITUDE_MED],
  horizonband3: ["horizonring", "cloudhat_PUFF_a", ...ALTITUDE_VLIGHT],
  Stripey: ["cloudhat_stripey_a", "cloudhat_stripey_b", ...ALTITUDE_HEAVY],
  horsey: ["horizonring", ...ALTITUDE_VLIGHT],
  shower: ["horizonring", "cloudhat_shower_a", "cloudhat_shower_b", "cloudhat_shower_c", ...ALTITUDE_MED],
});

/* Набор ясного дня ванили (`LIGHTclouds` в update.rpf): какие шапки он
   разрешает, — когда мод своего cloudkeyframes.xml не принёс. */
export const VANILLA_CLEAR_CLOUD_BITS = 0b1111010001111100;

/* Наборы ванильного cloudkeyframes.xml. Свои наборы мода носят только его
   же weather.xml. */
export const VANILLA_CLOUD_SETTINGS = Object.freeze([
  "LIGHTclouds",
  "MEDIUMclouds",
  "HEAVYclouds",
  "STORMclouds",
  "SNOWclouds",
  "POSTRAINclouds",
  "HALLOWEENclouds",
  "default",
]);

const layerKey = (files) =>
  [...new Set(files.map((file) => String(file).toLowerCase()))].sort().join("|");
const VANILLA_LOOKS = new Map(
  Object.entries(VANILLA_CLOUD_HAT_LAYERS).map(([name, files]) => [layerKey(files), name]),
);

/**
 * Какая ванильная шапка на самом деле стоит в шапке чужого `clouds.xml`:
 * имя той, чьи слои совпали до файла, или `null` — слои свои.
 */
export function cloudHatLook(hat) {
  return VANILLA_LOOKS.get(layerKey((hat?.layers || []).map((layer) => layer.file))) || null;
}

/*
 * Что из этого можно выбрать и как оно называется по-человечески.
 *
 * Названия — по тому, как облака выглядят, а не по метеорологии: «барашки»
 * узнают все, «перисто-кучевые» — единицы. В выборе — все шапки ванили,
 * кроме двух: `horsey` (облака видны только с самолёта) и `horizonband3`
 * (его не держит ни один набор игры — на его месте живут готовые облака,
 * `cloud-templates.js`). Полосы у горизонта собраны в одну
 * плитку — по одной они почти неотличимы.
 *
 * `lighting` — набор cloudkeyframes.xml, чьим светом шапку освещает ваниль.
 * Свет у набора один на все его шапки, и тяжёлые облака под светом ясного
 * дня (`LIGHTclouds`: рассеянный свет в полдень — полсотни) выходят сплошной
 * белой засветкой вместо серой пелены и тёмной грозы. Какой набор родной —
 * видно по битам ванили: гроза живёт только в `STORMclouds`, тучи и
 * пасмурное — в `HEAVYclouds`, пухлые и кучевые — в `MEDIUMclouds`.
 */
export const CLOUD_HAT_TYPES = Object.freeze([
  hat("fair", "Clear 01", "Кучевые", "Fair weather", "Отдельные белые облака", "MEDIUMclouds"),
  hat("puffs", "Puffs", "Россыпь", "Puffs", "Много мелких облаков", "LIGHTclouds"),
  hat("cumulus", "Cloudy 01", "Пухлые", "Cumulus", "Крупные облака по всему небу", "MEDIUMclouds"),
  hat("towers", "Nimbus", "Башни", "Towers", "Высокие облака над горизонтом", "LIGHTclouds"),
  hat("cirrus", "Cirrus", "Перистые", "Cirrus", "Тонкие высокие штрихи", "LIGHTclouds"),
  hat("mackerel", "cirrocumulus", "Барашки", "Mackerel", "Мелкая рябь высоко в небе", "LIGHTclouds"),
  hat("wisps", "Wispy", "Пряди", "Wisps", "Лёгкие прозрачные пряди", "LIGHTclouds"),
  hat("contrails", "Contrails", "Следы самолётов", "Contrails", "Белые полосы через небо", "LIGHTclouds"),
  hat("stratus", "stratoscumulus", "Слой", "Cloud layer", "Облачный слой с просветами", "LIGHTclouds"),
  /*
   * Четыре вида, которых в выборе прежде не было (просьба владельца
   * 26.09.2026 «добавь ещё облачков»). Свет — по родному набору ванили:
   * полосы у горизонта живут в LIGHTclouds, пелена — в HEAVYclouds, полосы
   * через небо — в MEDIUMclouds и HEAVYclouds (берётся лёгкий), снежная
   * шапка — только в наборе `default` снегопада, свет у неё тяжёлый.
   * «У горизонта» — три шапки сразу: по одной они почти неотличимы.
   */
  hat("horizon", "horizonband1", "У горизонта", "Horizon bands", "Гряды облаков над горизонтом", "LIGHTclouds", ["horizonband2", "Horizon"]),
  hat("stripes", "Stripey", "Полосы", "Stripes", "Длинные полосы через всё небо", "MEDIUMclouds"),
  hat("veil", "altostratus", "Пелена", "Veil", "Высокая сплошная пелена", "HEAVYclouds"),
  hat("showers", "shower", "Тучи", "Showers", "Рваные тяжёлые облака", "HEAVYclouds"),
  /* Шапка снегопада — кольцо у самого горизонта (модель ±0.73 по высоте
     вокруг глаза): над головой она неба не закрывает, и подсказка говорит
     это прямо — иначе щелчок по плитке выглядел как «облака не включились». */
  hat("snowy", "Snowy 01", "Снежные", "Snow clouds", "Серая гряда низко у горизонта", "HEAVYclouds"),
  hat("storm", "Stormy 01", "Грозовые", "Storm", "Тёмные грозовые тучи", "STORMclouds"),
  hat("overcast", "RAIN", "Пасмурно", "Overcast", "Затянутое серое небо", "HEAVYclouds"),
]);

function hat(id, frag, ru, en, hintRu, lighting, extraFrags = []) {
  return Object.freeze({
    id,
    frag,
    /* Все шапки вида — главная первой: она на плитке и в кадре. */
    frags: Object.freeze([frag, ...extraFrags]),
    label: Object.freeze({ ru, en }),
    hint: Object.freeze({ ru: hintRu, en: "" }),
    lighting,
  });
}

/* Наборы света от лёгкого к тяжёлому. */
export const CLOUD_LIGHTING_ORDER = Object.freeze([
  "LIGHTclouds",
  "MEDIUMclouds",
  "HEAVYclouds",
  "STORMclouds",
]);

const HAT_BY_ID = new Map(CLOUD_HAT_TYPES.map((item) => [item.id, item]));
export const findCloudHatType = (id) => HAT_BY_ID.get(String(id)) || null;

/**
 * Чьим светом освещать выбранные облака: родной набор самого тяжёлого из
 * них. Смесь «кучевые и гроза» получает грозовой свет — светлые облака под
 * ним темнеют, а гроза не становится белой.
 */
export function cloudLightingFor(types) {
  let heaviest = 0;
  for (const id of types || []) {
    const rank = CLOUD_LIGHTING_ORDER.indexOf(findCloudHatType(id)?.lighting);
    if (rank > heaviest) heaviest = rank;
  }
  return CLOUD_LIGHTING_ORDER[heaviest];
}

function assertWellFormed(xml, label) {
  const parser = new SaxesParser();
  let failure = null;
  parser.on("error", (error) => {
    failure ||= error;
  });
  parser.on("doctype", () => {
    failure ||= new Error(`DTD в ${label} не допускается.`);
  });
  parser.write(xmlForParsing(xml)).close();
  if (failure) throw new Error(`${label} повреждён: ${failure.message || failure}`);
}

const readVector = (block, tag) => {
  const match = block.match(
    new RegExp(`<${tag}\\s+x="([^"]*)"\\s+y="([^"]*)"\\s+z="([^"]*)"`),
  );
  return match
    ? { x: Number(match[1]) || 0, y: Number(match[2]) || 0, z: Number(match[3]) || 0 }
    : { x: 0, y: 0, z: 0 };
};

const readNumber = (block, tag, fallback = 0) => {
  const match = block.match(new RegExp(`<${tag}\\s+value="([^"]*)"`));
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
};

const readBool = (block, tag) => {
  const match = block.match(new RegExp(`<${tag}\\s+value="([^"]*)"`));
  return match ? match[1].trim() === "true" : false;
};

const readText = (block, tag) => {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1].trim() : "";
};

/** Верхние элементы `Item` внутри блока — без вложенных. */
function topItems(block) {
  const items = [];
  const regex = /<\/?Item>/g;
  let depth = 0;
  let start = -1;
  for (;;) {
    const match = regex.exec(block);
    if (!match) break;
    if (match[0] === "<Item>") {
      if (depth === 0) start = match.index + match[0].length;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        items.push(block.slice(start, match.index));
        start = -1;
      }
    }
  }
  return items;
}

/**
 * Разбор `clouds.xml`: шапки по порядку, у каждой — слои-модели.
 * Номер шапки в списке и есть номер её бита в `cloudkeyframes.xml`.
 */
export function parseCloudHats(xml) {
  const text = String(xml ?? "");
  if (!text.trim()) throw new Error("clouds.xml пуст.");
  if (text.length > MAX_CLOUD_XML_BYTES)
    throw new Error("clouds.xml превышает безопасный размер.");
  assertWellFormed(text, "clouds.xml");
  const frags = text.match(/<mCloudHatFrags>([\s\S]*?)<\/mCloudHatFrags>/);
  if (!frags) throw new Error("В clouds.xml нет списка шапок.");
  const hats = topItems(frags[1]).map((block, index) => {
    const layersBlock = block.match(/<mLayers>([\s\S]*?)<\/mLayers>/)?.[1] || "";
    const layers = topItems(layersBlock).map((layer) => ({
      file: readText(layer, "mFilename"),
      costFactor: readNumber(layer, "mCostFactor"),
      rotationScale: readNumber(layer, "mRotationScale"),
      camPositionScalerAdjust: readNumber(layer, "mCamPositionScalerAdjust", 1),
      transitionIn: readNumber(layer, "mTransitionInTimePercent"),
      transitionOut: readNumber(layer, "mTransitionOutTimePercent"),
      transitionInDelay: readNumber(layer, "mTransitionInDelayPercent"),
      transitionOutDelay: readNumber(layer, "mTransitionOutDelayPercent"),
      heightTrigger: readNumber(layer, "mHeightTigger"),
      heightFadeRange: readNumber(layer, "mHeightFadeRange"),
    }));
    const velocities = (block.match(/<mUVVelocity[^>]*>([\s\S]*?)<\/mUVVelocity>/)?.[1] || "")
      .trim()
      .split(/\n/)
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
    const animModes = (block.match(/<mAnimMode[^>]*>([\s\S]*?)<\/mAnimMode>/)?.[1] || "")
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter(Number.isFinite);
    const showLayer = [...(block.match(/<mShowLayer>([\s\S]*?)<\/mShowLayer>/)?.[1] || "")
      .matchAll(/value="([^"]*)"/g)].map((match) => match[1] === "true");
    return {
      index,
      name: readText(block, "mName"),
      position: readVector(block, "mPosition"),
      rotation: readVector(block, "mRotation"),
      scale: readVector(block, "mScale"),
      layers,
      transitionAlphaRange: readNumber(block, "mTransitionAlphaRange"),
      transitionMidPoint: readNumber(block, "mTransitionMidPoint"),
      enabled: readBool(block, "mEnabled"),
      angularVelocity: readVector(block, "mAngularVelocity"),
      animBlendWeights: readVector(block, "mAnimBlendWeights"),
      uvVelocity: velocities,
      animMode: animModes,
      showLayer,
      enableAnimations: readBool(block, "mEnableAnimations"),
    };
  });
  if (!hats.length) throw new Error("В clouds.xml нет ни одной шапки.");
  return {
    hats,
    transitionSeconds: readNumber(text, "mDesiredTransitionTimeSec", 30),
    camPositionScaler: readVector(text, "mCamPositionScaler"),
    altitudeScrollScaler: readNumber(text, "mAltitudeScrollScaler"),
  };
}

/**
 * Номер бита шапки по её имени — из файла игрока, а без него — из ванили.
 * Имена в файле пишутся как попало (`Cirrus`, `cirrocumulus`), сравнение
 * без регистра.
 */
export function cloudHatBits(cloudHats = null) {
  const order = cloudHats?.hats?.length
    ? cloudHats.hats.map((item) => item.name)
    : VANILLA_CLOUD_HAT_ORDER;
  return new Map(order.map((name, index) => [String(name).toLowerCase(), index]));
}

/** Разрешённые наборы типов → маска битов для `mBits`. */
export function cloudTypesMask(types, cloudHats = null) {
  const bits = cloudHatBits(cloudHats);
  let mask = 0;
  for (const id of types || []) {
    const type = findCloudHatType(id);
    for (const frag of type?.frags || []) {
      const bit = bits.get(frag.toLowerCase());
      if (bit !== undefined && bit < 31) mask |= 1 << bit;
    }
  }
  return mask >>> 0;
}

/** Какие типы разрешены маской — обратно. */
export function cloudTypesOfMask(mask, cloudHats = null) {
  const bits = cloudHatBits(cloudHats);
  return CLOUD_HAT_TYPES.filter((type) => {
    const bit = bits.get(type.frag.toLowerCase());
    return bit !== undefined && (mask >>> bit) & 1;
  }).map((type) => type.id);
}

/*
 * cloudkeyframes.xml
 *
 * Ключи суток: 0, 4, 5, 6, 7, 10, 12, 16, 17, 18, 19, 20, 21, 22 и 24 — это
 * «0» ещё раз, чтобы ночь замыкалась в кольцо. На один ключ больше, чем у
 * таймцикла (четыре часа утра), поэтому срезы вида ложатся на них по часу, а
 * не по номеру.
 */
export const CLOUD_KEY_SECTIONS = Object.freeze([
  "CloudColor",
  "CloudLightColor",
  "CloudAmbientColor",
  "CloudSkyColor",
  "CloudBounceColor",
  "CloudEastColor",
  "CloudWestColor",
  "CloudScaleFillColors",
  "CloudDensityShift_Scale_ScatteringConst_Scale",
  "CloudPiercingLightPower_Strength_NormalStrength_Thickness",
  "CloudScaleDiffuseFillAmbient_WrapAmount",
]);

function settingsBlocks(text) {
  const map = text.match(/<SettingsMap>([\s\S]*?)<\/SettingsMap>/);
  if (!map) throw new Error("В cloudkeyframes.xml нет наборов облаков.");
  const offset = map.index + map[0].indexOf(map[1]);
  const blocks = [];
  const regex = /<\/?Item>/g;
  let depth = 0;
  let start = -1;
  for (;;) {
    const match = regex.exec(map[1]);
    if (!match) break;
    if (match[0] === "<Item>") {
      if (depth === 0) start = match.index + match[0].length;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push({ start: offset + start, end: offset + match.index });
        start = -1;
      }
    }
  }
  return blocks;
}

function parseKeyData(block) {
  const keys = {};
  for (const section of CLOUD_KEY_SECTIONS) {
    const match = block.match(
      new RegExp(
        `<${section}>\\s*<keyData>[\\s\\S]*?<keyEntryData[^>]*>([\\s\\S]*?)</keyEntryData>`,
      ),
    );
    if (!match) continue;
    keys[section] = match[1]
      .trim()
      .split(/\n/)
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((row) => row.length >= 5 && row.every(Number.isFinite))
      .map((row) => row.slice(0, 5));
  }
  return keys;
}

/** Разбор `cloudkeyframes.xml`: наборы по именам. */
export function parseCloudKeyframes(xml) {
  const text = String(xml ?? "");
  if (!text.trim()) throw new Error("cloudkeyframes.xml пуст.");
  if (text.length > MAX_CLOUD_XML_BYTES)
    throw new Error("cloudkeyframes.xml превышает безопасный размер.");
  assertWellFormed(text, "cloudkeyframes.xml");
  const times = (text.match(/<KeyframeTimes[^>]*>([\s\S]*?)<\/KeyframeTimes>/)?.[1] || "")
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);
  const settings = new Map();
  for (const { start, end } of settingsBlocks(text)) {
    const block = text.slice(start, end);
    const name = readText(block, "Name");
    if (!name) continue;
    const probability = (block.match(/<mProbability[^>]*>([\s\S]*?)<\/mProbability>/)?.[1] || "")
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter(Number.isFinite);
    const bitsMatch = block.match(/<mBits[^>]*bits="(\d+)"[^>]*>([\s\S]*?)<\/mBits>/);
    settings.set(name, {
      name,
      probability,
      bitCount: bitsMatch ? Number(bitsMatch[1]) : probability.length,
      bits: bitsMatch ? Number.parseInt(bitsMatch[2].trim(), 16) >>> 0 : 0,
      keys: parseKeyData(block),
    });
  }
  if (!settings.size)
    throw new Error("В cloudkeyframes.xml нет ни одного набора облаков.");
  return { times, settings };
}

/**
 * Значение раздела набора в час суток — смешиванием соседних ключей, как в
 * игре. Ключ 24 замыкает сутки; если его в файле нет, кольцо замыкается
 * первым ключом.
 */
export function sampleCloudKeys(rows, hour) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const h = ((Number(hour) % 24) + 24) % 24;
  const sorted = [...rows].sort((a, b) => a[0] - b[0]);
  const ring = sorted.at(-1)[0] >= 24 ? sorted : [...sorted, [sorted[0][0] + 24, ...sorted[0].slice(1)]];
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [t0, ...a] = ring[index];
    const [t1, ...b] = ring[index + 1];
    if (h >= t0 && h <= t1) {
      const blend = t1 > t0 ? (h - t0) / (t1 - t0) : 0;
      return a.map((value, channel) => value + (b[channel] - value) * blend);
    }
  }
  return ring[0].slice(1);
}

/** Весь набор в час суток: раздел → четыре числа. */
export function sampleCloudSettings(setting, hour) {
  if (!setting) return null;
  return Object.fromEntries(
    Object.entries(setting.keys || {}).map(([section, rows]) => [
      section,
      sampleCloudKeys(rows, hour),
    ]),
  );
}

const formatKeyNumber = (value) => {
  const numeric = Number(value);
  return (Number.isFinite(numeric) ? numeric : 0).toFixed(6);
};

/**
 * Правит наборы облаков и возвращает новый текст.
 *
 * `plan` — карта «имя набора → правка»:
 *   { bits: 0x2000, probability: [...] } — какие шапки разрешены и с каким
 *                                          весом;
 *   { keys: { CloudColor: [[t, r, g, b, a], …] } } — ключи суток раздела.
 *
 * Правка точечная, как и у `weather.xml`: остальной файл не пересобирается.
 * Ключи пишутся в той же вёрстке, что у Rockstar, — шесть знаков через
 * табуляцию, — и их число в `numKeyEntries` следует за ними.
 */
export function patchCloudKeyframes(xml, plan = {}) {
  let text = String(xml ?? "");
  const skipped = [];
  const applied = [];
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [name, edit] of Object.entries(plan || {})) {
    const block = settingsBlocks(text).find(
      ({ start, end }) => readText(text.slice(start, end), "Name") === name,
    );
    if (!block) {
      skipped.push(name);
      continue;
    }
    let body = text.slice(block.start, block.end);
    if (edit.probability) {
      body = body.replace(
        /(<mProbability[^>]*>)([\s\S]*?)(<\/mProbability>)/,
        (whole, open, inner, close) => {
          const indent = inner.match(/\n([ \t]*)\S/)?.[1] ?? "            ";
          const tail = inner.match(/\n([ \t]*)$/)?.[1] ?? "";
          const values = edit.probability.map((value) =>
            Math.max(0, Math.round(Number(value) || 0)),
          );
          return `${open}${eol}${values.map((value) => `${indent}${value} `).join(eol)}${eol}${tail}${close}`;
        },
      );
    }
    if (edit.bits !== undefined) {
      const mask = Number(edit.bits) >>> 0;
      body = body.replace(
        /(<mBits[^>]*>)([\s\S]*?)(<\/mBits>)/,
        (whole, open, inner, close) =>
          `${open}${inner.replace(/0x[0-9a-fA-F]+/, `0x${mask.toString(16).toUpperCase().padStart(8, "0")}`)}${close}`,
      );
    }
    for (const [section, rows] of Object.entries(edit.keys || {})) {
      if (!CLOUD_KEY_SECTIONS.includes(section))
        throw new Error(`Раздел облаков «${section}» правкой не предусмотрен.`);
      const pattern = new RegExp(
        `(<${section}>\\s*<keyData>\\s*<numKeyEntries value=")(\\d+)("[^>]*>\\s*<keyEntryData[^>]*>)([\\s\\S]*?)(</keyEntryData>)`,
      );
      if (!pattern.test(body)) {
        skipped.push(`${name}/${section}`);
        continue;
      }
      body = body.replace(pattern, (whole, head, count, middle, inner, close) => {
        const indent = inner.match(/\n([ \t]*)\S/)?.[1] ?? "              ";
        const tail = inner.match(/\n([ \t]*)$/)?.[1] ?? "";
        const lines = rows.map(
          (row) => `${indent}${row.map(formatKeyNumber).join("\t")}\t`,
        );
        return `${head}${rows.length}${middle}${eol}${lines.join(eol)}${eol}${tail}${close}`;
      });
    }
    text = text.slice(0, block.start) + body + text.slice(block.end);
    applied.push(name);
  }
  assertWellFormed(text, "cloudkeyframes.xml");
  return { xml: text, applied, skipped };
}
