/*
 * Небо для кадра: вид, положенный на ясный день игрока.
 *
 * Кадр показывает ясный день — ту погоду, которой становится всё, что
 * человек выключил, и на которую вид ложится целиком (`PREVIEW_WEATHER`).
 * Считается тем же кодом, что соберёт файлы для игры (`applyLookToRegion`):
 * кадр и установка не могут разойтись, потому что это одна функция.
 *
 * Прежние точечные правки старых работ ложатся первыми — как и при сборке.
 */

import {
  CLEAR_CLOUD_SETTING,
  PREVIEW_WEATHER,
  applyLookToRegion,
  applyProject,
  cloudHatShading,
  cloudTemplateFrag,
  daySwatches,
  findCloudHatType,
  findCloudTemplate,
  findRegion,
  groundCloudLayers,
  likeliestCloudHat,
  lookClearCloudKeys,
  lookCloudKeys,
  lookCloudLighting,
  lookCloudTemplateSlot,
  parseCloudHats,
  parseCloudKeyframes,
  parseWeatherTypes,
  resolveSkyState,
  sampleCloudSettings,
} from "@modovik/timecycle";

export const PREVIEW_REGION = "GLOBAL";

/*
 * Погода кадра — по умолчанию ясный день. Остальные типы приходят из выбора
 * погоды (`sky-weather.js`): свой файл таймцикла и режим, в котором на него
 * ложится вид (`resolveWeatherPlan`), — так же, как это сделает установка.
 */

/** Основа кадра: файл погоды с прежними правками старой работы. */
export function previewDocument(baseDocument, project, weather = PREVIEW_WEATHER) {
  if (!project?.weathers?.[weather]) return baseDocument;
  return applyProject(baseDocument, project, weather).document;
}

/**
 * Правки вида в той форме, которую читает `resolveSkyState`: разреженный
 * проект ровно на одну погоду и один регион.
 */
export function previewProject(document, look, weather = PREVIEW_WEATHER, mode = "look") {
  const region = findRegion(document, PREVIEW_REGION) || document.regions[0];
  /* «Весь кадр серым» из «ЧБ-мира» — настройка игры, а не вида неба: кадр редактора её не показывает
     (владелец, 19.10.2026: «ЧБ-мир не должен отображаться на предпросмотрах нигде»). */
  const shown = look?.weather?.grayFrame ? { ...look, weather: { ...look.weather, grayFrame: false } } : look;
  const edits = region ? applyLookToRegion(region.values, shown, mode) : {};
  return {
    schemaVersion: 2,
    name: "preview",
    weathers: { [weather]: { [region?.name || PREVIEW_REGION]: edits } },
  };
}

/** Небо часа. */
export const previewState = (document, project, hour, weather = PREVIEW_WEATHER) =>
  resolveSkyState({
    document,
    project,
    weather,
    region: PREVIEW_REGION,
    hour,
  });

/** Цвета ленты суток — тринадцать опорных кадров с одной экспозицией. */
export const previewBand = (document, project, weather = PREVIEW_WEATHER) =>
  daySwatches({
    document,
    project,
    weather,
    region: PREVIEW_REGION,
  }).colours;

/*
 * Облака игрока для кадра: clouds.xml, cloudkeyframes.xml и наборы облаков
 * типов погоды из weather.xml (ясного дня — `clearSetting`, остальных —
 * `settings`). Разбираются один раз на базу; без базы или при битом файле —
 * `null`, и кадр остаётся с облаками купола.
 */
export function parseCloudBases(bases) {
  try {
    if (!bases?.clouds?.xml || !bases?.cloudKeyframes?.xml) return null;
    const hats = parseCloudHats(bases.clouds.xml);
    const keyframes = parseCloudKeyframes(bases.cloudKeyframes.xml);
    const weather = bases.weather?.xml ? parseWeatherTypes(bases.weather.xml) : [];
    const clear = weather.find((type) => type.name === PREVIEW_WEATHER);
    const settings = Object.fromEntries(
      weather
        .filter((type) => type.texts?.CloudSettingsName)
        .map((type) => [type.name.toUpperCase(), type.texts.CloudSettingsName]),
    );
    return {
      hats,
      keyframes,
      clearSetting: clear?.texts?.CloudSettingsName || CLEAR_CLOUD_SETTING,
      settings,
    };
  } catch {
    return null;
  }
}

/**
 * Встанет ли готовое небо облаков у этого игрока: есть место (шапка-слот,
 * которую не держит ни один набор) и хоть один слой шаблона в его clouds.xml.
 * Без этого установка оставит облака как в игре — и кадр тоже.
 */
export function cloudTemplateAvailable(parsed, rawTemplate) {
  /* Номер готового шаблона или сам шаблон (свой из проекта). */
  const template = typeof rawTemplate === "string" ? findCloudTemplate(rawTemplate) : rawTemplate;
  return Boolean(
    parsed &&
      template &&
      lookCloudTemplateSlot(parsed.hats, parsed.keyframes) &&
      cloudTemplateFrag(parsed.hats, template),
  );
}

/**
 * Облачная шапка кадра и её свет в этот час.
 *
 * «Как в игре» — шапка, которую набор ясного дня показывает чаще всех; свои
 * облака — та, что человек выбрал последней (`focus`), иначе первая из
 * выбранных; готовое небо — шапка шаблона, собранная так же, как её
 * запишет установка (`cloudTemplateFrag`). «Без облаков» — ничего. Свет —
 * ключи набора после вида (`lookCloudKeys`): те же, что уедут в
 * cloudkeyframes.xml.
 *
 * `plan` — погода кадра (`previewWeatherPlan`). Свои облака и вид ложатся
 * только на ясные погоды (`lookWeatherXmlPlan`), остальные носят облака игры:
 * дождь — тучи дождя, снег — снежные, и кадр показывает их же.
 */
export function previewClouds(parsed, look, focus, hour, plan = null) {
  if (!parsed) return null;
  if (plan && plan.mode === "style") return gameClouds(parsed, plan.base, hour);
  const clearName = plan && plan.base !== PREVIEW_WEATHER
    ? parsed.settings?.[plan.base] || parsed.clearSetting
    : parsed.clearSetting;
  /* Номер — готовый шаблон или свой из проекта: кадр рисует тот же объект, что запишет установка. */
  const template = look?.clouds?.template
    ? findCloudTemplate(look.clouds.template, look.clouds.own)
    : null;
  if (template && cloudTemplateAvailable(parsed, template)) {
    const frag = cloudTemplateFrag(parsed.hats, template);
    const keys = lookClearCloudKeys(look, parsed.keyframes);
    return {
      frag,
      shading: cloudHatShading(sampleCloudSettings({ keys }, hour)),
      layerFiles: groundCloudLayers(frag).map((layer) => layer.file),
    };
  }
  /* Шаблону у игрока нет места — в игре облака останутся его, и в кадре. */
  const shown = template ? { ...look, clouds: { types: null, template: null, own: look.clouds.own } } : look;
  const types = shown?.clouds?.types ?? null;
  if (Array.isArray(types) && !types.length) return null;
  let frag = null;
  let keys = null;
  if (types === null) {
    const setting = parsed.keyframes.settings.get(clearName);
    if (!setting) return null;
    frag = likeliestCloudHat(setting, parsed.hats);
    keys = { ...setting.keys, ...lookCloudKeys(setting, shown) };
  } else {
    /* Свет своих облаков — тот, что уедет в ясный набор: родной набор самого
       тяжёлого из выбранных видов (`lookClearCloudKeys`). */
    const lighting = lookCloudLighting(shown, parsed.keyframes);
    if (!lighting) return null;
    const id = types.includes(focus) ? focus : types[0];
    const name = findCloudHatType(id)?.frag.toLowerCase();
    frag =
      parsed.hats.hats.find((item) => item.name.toLowerCase() === name) || null;
    keys = { ...lighting.keys, ...lookClearCloudKeys(shown, parsed.keyframes) };
  }
  if (!frag) return null;
  return {
    frag,
    shading: cloudHatShading(sampleCloudSettings({ keys }, hour)),
    layerFiles: groundCloudLayers(frag).map((layer) => layer.file),
  };
}

/** Облака типа погоды как в игре: его набор из weather.xml, без правок вида. */
function gameClouds(parsed, weather, hour) {
  const name = parsed.settings?.[weather];
  const setting = name ? parsed.keyframes.settings.get(name) : null;
  const frag = setting ? likeliestCloudHat(setting, parsed.hats) : null;
  if (!frag) return null;
  return {
    frag,
    shading: cloudHatShading(sampleCloudSettings({ keys: setting.keys }, hour)),
    layerFiles: groundCloudLayers(frag).map((layer) => layer.file),
  };
}
