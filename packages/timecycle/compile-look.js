/*
 * Сборка вида острова в файлы игры.
 *
 * Вход — проект неба (вид плюс прежние точечные правки) и чистая база игрока:
 * все файлы погоды, weather.xml, cloudkeyframes.xml, clouds.xml и наборы
 * бликов объектива (`lens-flare.js`). Выход — готовые файлы для
 * `install-rpf-patch` и отчёт о том, что в них изменилось.
 *
 * Файлов погоды семнадцать, и не все лежат в `update.rpf`: снег, метель и
 * лёгкий снег игра до сих пор читает из базового `common.rpf`. Копия в
 * `update.rpf` перекрывает базовую, поэтому такой файл не заменяется, а
 * добавляется (`Import`) — иначе правка снежной погоды тихо терялась бы, как
 * у прежнего редактора, который искал её только в `update.rpf`.
 */

import { createHash } from "node:crypto";
import {
  cloneKeyframeDocument,
  findRegion,
  parseKeyframeXml,
  patchKeyframeXml,
} from "./keyframe-xml.js";
import { applyProject } from "./project.js";
import { findWeather } from "./samples.js";
import { LOOK_WEATHERS, lookWeatherEdits } from "./look-apply.js";
import { lookCloudKeyframesPlan, lookWeatherXmlPlan } from "./look-plan.js";
import { normalizeLook } from "./look.js";
import { parseWeatherTypes, patchWeatherCycles, patchWeatherTypes } from "./weather-xml.js";
import {
  parseCloudHats,
  parseCloudKeyframes,
  patchCloudKeyframes,
} from "./cloud-hats.js";
import { cloudTemplateReport, findCloudTemplate, writeCloudTemplate } from "./cloud-templates.js";
import { CLOUD_SIZE_AVAILABLE, cloudSizeIsNeutral, patchCloudHatSize } from "./cloud-size.js";
import { CLEAR_CLOUD_SETTING } from "./look-plan.js";
import { LENS_FLARE_FILES, quietLensFlareXml } from "./lens-flare.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Заметка отчёта: наборов облаков игрока не прочесть — облака не правятся. */
export const CLOUD_KEYFRAMES_UNREADABLE =
  "cloudkeyframes.xml: облака игрока не читаются — оставлены как в игре";

/** Куда что ложится в архиве. */
export const SKY_ARCHIVE_PATHS = Object.freeze({
  timecycle: (file) => `update:/common/data/timecycle/${file}`,
  weather: "update:/common/data/levels/gta5/weather.xml",
  cloudKeyframes: "update:/common/data/cloudkeyframes.xml",
  clouds: "update:/common/data/clouds.xml",
  lensFlare: (file) => `update:/common/data/${file}`,
});

/** Откуда эти файлы читать: копия в `update.rpf`, иначе базовая. */
export const SKY_BASE_SOURCES = Object.freeze({
  timecycle: (file) => [
    `update:/common/data/timecycle/${file}`,
    `common:/data/timecycle/${file}`,
  ],
  weather: [
    "update:/common/data/levels/gta5/weather.xml",
    "common:/data/levels/gta5/weather.xml",
  ],
  cloudKeyframes: [
    "update:/common/data/cloudkeyframes.xml",
    "common:/data/cloudkeyframes.xml",
  ],
  clouds: ["update:/common/data/clouds.xml", "common:/data/clouds.xml"],
  lensFlare: (file) => [`update:/common/data/${file}`, `common:/data/${file}`],
});

function fileOut({ kind, id, file, target, inUpdate, text, details }) {
  const bytes = Buffer.from(text, "utf8");
  return {
    kind,
    id,
    file,
    target,
    action: inUpdate === false ? "Import" : "Replace",
    xml: text,
    size: bytes.length,
    sha256: sha256(bytes),
    ...details,
  };
}

/**
 * Собирает всё, что вид меняет в игре.
 *
 * `bases.timecycles` — `{ [тип]: { xml, inUpdate } }`; `bases.weather`,
 * `bases.cloudKeyframes` — `{ xml, inUpdate }`; `bases.clouds` — `{ xml,
 * inUpdate }` (номера шапок и место готового неба облаков);
 * `bases.lensFlares` — `{ [файл]: { xml, inUpdate } }` (`LENS_FLARE_FILES`).
 * Любого из них может не быть: у старых сборок нет хеллоуинских типов, у
 * Enhanced — половины всего. Чего нет, то не собирается и попадает в
 * `missing`.
 */
export function compileSkyLook({ project, bases }) {
  const look = normalizeLook(project?.look);
  const files = [];
  const missing = [];
  const skipped = [];

  /* Прежние точечные правки — сперва: вид ложится поверх них так же, как
     поверх файла игрока. */
  const documents = {};
  const legacyApplied = {};
  for (const item of LOOK_WEATHERS) {
    const base = bases?.timecycles?.[item.id];
    if (!base?.xml) {
      missing.push(item.file);
      continue;
    }
    let document = parseKeyframeXml(base.xml);
    legacyApplied[item.id] = 0;
    if (findWeather(item.id) && project?.weathers?.[item.id]) {
      const result = applyProject(document, project, item.id);
      document = result.document;
      legacyApplied[item.id] = result.applied;
      skipped.push(...result.skipped.map((name) => `${item.file}: ${name}`));
    }
    documents[item.id] = document;
  }

  let parameters = 0;
  for (const item of LOOK_WEATHERS) {
    const document = documents[item.id];
    if (!document) continue;
    const result = lookWeatherEdits({ weather: item.id, bases: documents, look });
    if (!result?.complete) {
      skipped.push(`${item.file}: нет основы ${result?.plan?.base || ""}`.trim());
      continue;
    }
    const output = cloneKeyframeDocument(document);
    let changed = 0;
    for (const [regionName, values] of Object.entries(result.regions)) {
      const region = findRegion(output, regionName);
      if (!region) {
        skipped.push(`${item.file}: регион ${regionName}`);
        continue;
      }
      for (const [name, curve] of Object.entries(values)) {
        const current = region.values[name];
        if (!Array.isArray(current)) continue;
        region.values[name] =
          current.length === curve.length
            ? curve.map(Number)
            : current.map((value, index) =>
                index < curve.length ? Number(curve[index]) : value,
              );
        changed += 1;
      }
    }
    if (!changed && !legacyApplied[item.id]) continue;
    parameters += changed + legacyApplied[item.id];
    files.push(
      fileOut({
        kind: "timecycle",
        id: item.id,
        file: item.file,
        target: SKY_ARCHIVE_PATHS.timecycle(item.file),
        inUpdate: bases.timecycles[item.id].inUpdate,
        /* Точечно по тексту игрока: CRLF, отступы и неизвестные редактору
           параметры остаются как были, а собранное сверяется с задуманным
           (`patchKeyframeXml`). */
        text: patchKeyframeXml(bases.timecycles[item.id].xml, output),
        details: {
          weather: item.id,
          mode: result.plan.mode,
          from: result.plan.base,
          applied: changed + legacyApplied[item.id],
        },
      }),
    );
  }

  /*
   * Облака. Файлы облаков разбираются один раз: номера шапок нужны и
   * готовому небу, и выбору видов. Нечитаемый clouds.xml — не повод отказать
   * в установке: номера шапок тогда берутся из ванильного порядка, а готовое
   * небо не собирается.
   */
  /* Нечитаемый cloudkeyframes.xml — тоже не отказ. Корень без «<» — приём
     «Нет облаков» оптимизаций (так и у редукса Korolevskiy): игра файл не
     читает, шапок в небе нет; у Nick V4 наборов нет вовсе. Облака остаются
     как в игре, погода и таймцикл ставятся (тестер на Enhanced, 03.11.2026). */
  let cloudKeyframes = null;
  if (bases?.cloudKeyframes?.xml) {
    try {
      cloudKeyframes = parseCloudKeyframes(bases.cloudKeyframes.xml);
    } catch {
      skipped.push(CLOUD_KEYFRAMES_UNREADABLE);
    }
  }
  let cloudHats = null;
  try {
    cloudHats = bases?.clouds?.xml ? parseCloudHats(bases.clouds.xml) : null;
  } catch {
    cloudHats = null;
  }
  /*
   * Готовое небо облаков: шапка шаблона встаёт в clouds.xml игрока на место
   * шапки-слота (`writeCloudTemplate`), ясный набор разрешает только её.
   * Не собралось (нет файлов, место занято модом, слоёв шаблона у игрока
   * нет) — облака остаются как в игре, и причина уходит в `skipped`: бит
   * слота без записанной шапки показал бы чужие облака.
   */
  let cloudLook = look;
  if (look.clouds.template) {
    const asInGame = { ...look, clouds: { types: null, template: null } };
    if (!bases?.clouds?.xml || !cloudKeyframes || !cloudHats) {
      skipped.push("clouds.xml: готовые облака не собрать без файлов облаков игры");
      cloudLook = asInGame;
    } else {
      try {
        /* Номер — готовый шаблон или свой из проекта (`look.clouds.own`): пишется тот же объект, что рисует кадр. */
        const template = findCloudTemplate(look.clouds.template, look.clouds.own);
        const written = writeCloudTemplate(bases.clouds.xml, template, {
          cloudKeyframes,
          clearSetting: CLEAR_CLOUD_SETTING,
        });
        /* Слой, которого у игрока нет, в файл не идёт — об этом сказано в отчёте до «Применить». */
        for (const gone of cloudTemplateReport(cloudHats, template).missing)
          skipped.push(`clouds.xml: слоя «${gone.file}» нет в вашей игре — он в облака не вошёл`);
        files.push(
          fileOut({
            kind: "cloudhats",
            id: "clouds",
            file: "clouds.xml",
            target: SKY_ARCHIVE_PATHS.clouds,
            inUpdate: bases.clouds.inUpdate,
            text: written.xml,
            details: {
              template: look.clouds.template,
              slot: written.slot.name,
              layers: written.layers,
            },
          }),
        );
      } catch (error) {
        skipped.push(`clouds.xml: ${error?.message || error}`);
        cloudLook = asInGame;
      }
    }
  }

  /*
   * Большие облака (21.11.2026): размер, высота и скорость шапок. Правятся шапки файла — после готового неба облаков, если оно есть: тогда размер ложится и на шапку шаблона.
   */
  if (CLOUD_SIZE_AVAILABLE && !cloudSizeIsNeutral(look.cloudSize)) {
    if (!bases?.clouds?.xml) skipped.push("clouds.xml: размер облаков не собрать без файлов облаков игры");
    else {
      try {
        const at = files.findIndex((file) => file.id === "clouds");
        const sized = patchCloudHatSize(at >= 0 ? files[at].xml : bases.clouds.xml, look.cloudSize);
        const out = fileOut({
          kind: "cloudhats",
          id: "clouds",
          file: "clouds.xml",
          target: SKY_ARCHIVE_PATHS.clouds,
          inUpdate: bases.clouds.inUpdate,
          text: sized.xml,
          details: { ...(at >= 0 ? { template: files[at].template, slot: files[at].slot, layers: files[at].layers } : {}), cloudSize: look.cloudSize, hats: sized.hats },
        });
        if (at >= 0) files[at] = out;
        else files.push(out);
      } catch (error) {
        skipped.push(`clouds.xml: ${error?.message || error}`);
      }
    }
  }

  let types = [];
  if (bases?.weather?.xml) {
    types = parseWeatherTypes(bases.weather.xml);
    const plan = lookWeatherXmlPlan(cloudLook, types);
    let weatherXml = bases.weather.xml;
    let applied = [];
    if (Object.keys(plan).length) {
      const patched = patchWeatherTypes(weatherXml, plan);
      skipped.push(...patched.skipped.map((name) => `weather.xml: ${name}`));
      weatherXml = patched.xml;
      applied = patched.applied;
    }
    /* Вечная погода: расписание из одного типа, число пунктов прежнее. Типа
       нет в файле игрока (у старых сборок нет хеллоуинских) или расписания
       нет вовсе — расписание остаётся как есть, причина уходит в отчёт. */
    let cycles = null;
    if (look.weather.eternal) {
      try {
        const result = patchWeatherCycles(weatherXml, look.weather.eternal);
        if (!result.count) skipped.push("weather.xml: в файле нет расписания погоды");
        else if (result.changed) {
          weatherXml = result.xml;
          cycles = { type: look.weather.eternal, count: result.count, changed: result.changed };
        }
      } catch (error) {
        skipped.push(`weather.xml: ${error?.message || error}`);
      }
    }
    if (weatherXml !== bases.weather.xml) {
      files.push(
        fileOut({
          kind: "weather",
          id: "weather",
          file: "weather.xml",
          target: SKY_ARCHIVE_PATHS.weather,
          inUpdate: bases.weather.inUpdate,
          text: weatherXml,
          details: { types: applied, ...(cycles ? { cycles } : {}) },
        }),
      );
    }
  } else missing.push("weather.xml");

  if (cloudKeyframes) {
    const plan = lookCloudKeyframesPlan(cloudLook, cloudKeyframes, types, cloudHats);
    if (Object.keys(plan).length) {
      const patched = patchCloudKeyframes(bases.cloudKeyframes.xml, plan);
      skipped.push(
        ...patched.skipped.map((name) => `cloudkeyframes.xml: ${name}`),
      );
      files.push(
        fileOut({
          kind: "clouds",
          id: "cloudkeyframes",
          file: "cloudkeyframes.xml",
          target: SKY_ARCHIVE_PATHS.cloudKeyframes,
          inUpdate: bases.cloudKeyframes.inUpdate,
          text: patched.xml,
          details: { settings: patched.applied },
        }),
      );
    }
  } else if (!bases?.cloudKeyframes?.xml) missing.push("cloudkeyframes.xml");

  /* Блики объектива: наборы героев гаснут, пока вид их не разрешил.
     Разрешённые не пишутся вовсе — установка сама вернёт наборы игрока
     (`restoreFiles` в приложении), как возвращает незатронутую погоду. */
  if (!look.weather.flares) {
    for (const file of LENS_FLARE_FILES) {
      const base = bases?.lensFlares?.[file];
      if (!base?.xml) {
        missing.push(file);
        continue;
      }
      const quiet = quietLensFlareXml(base.xml);
      if (!quiet.elements) {
        skipped.push(`${file}: нет элементов бликов`);
        continue;
      }
      /* Набор уже без бликов (такой поставил чужой мод) — писать нечего. */
      if (!quiet.changed) continue;
      files.push(
        fileOut({
          kind: "lensflare",
          id: file,
          file,
          target: SKY_ARCHIVE_PATHS.lensFlare(file),
          inUpdate: base.inUpdate,
          text: quiet.xml,
          details: { elements: quiet.elements, silenced: quiet.changed },
        }),
      );
    }
  }

  return {
    files,
    missing,
    skipped,
    applied: parameters,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}

/**
 * Вид проекта с отдельными видами для отдельных типов погоды (21.11.2026, наборы для стенда): основной вид собирается как обычно, а файл погоды из `variants`
 * (`{ ТИП: вид }`) берётся из сборки ЭТОГО вида — в одном `update.rpf` у разных погод разное небо, атмосфера или свет, и стенд за один заход шлёт
 * `weather ТИП` по очереди. Для людей это не нужно: у них один вид на все погоды. Тип, которого нет среди собранных файлов вида, пропускается.
 * Возвращает то же, что `compileSkyLook`, и `variants` — какие типы заменены.
 */
export function compileSkyLookVariants({ project, variants = {}, bases }) {
  const compiled = compileSkyLook({ project, bases });
  const files = [...compiled.files];
  const replaced = [];
  for (const [weather, variantLook] of Object.entries(variants || {})) {
    const variant = compileSkyLook({ project: { ...project, look: variantLook }, bases });
    const own = variant.files.find((file) => file.kind === "timecycle" && file.weather === weather);
    if (!own) continue;
    const at = files.findIndex((file) => file.kind === "timecycle" && file.weather === weather);
    if (at >= 0) files[at] = own;
    else files.push(own);
    replaced.push(weather);
  }
  return { ...compiled, files, totalBytes: files.reduce((total, file) => total + file.size, 0), variants: replaced };
}

/**
 * Манифест патча: те же поля, что у прицела и мини-карты. Файлы, которых в
 * `update.rpf` не было, добавляются (`Import`), остальные заменяются.
 */
export function skyPatchManifest({ name, files }) {
  return {
    ReduxName: name || "Astral sky",
    ParsedAt: new Date().toISOString(),
    TotalPatchSize: files.reduce((total, file) => total + file.size, 0),
    Actions: files.map((file) => ({
      Type: file.action,
      TargetPath: file.target,
      SourcePath: `payload/${file.file}`,
      Size: file.size,
      Sha256: file.sha256,
      IsWholeReplaceNestedRpf: false,
    })),
  };
}
