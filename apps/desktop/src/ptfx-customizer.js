/*
 * Эффекты попадания и трассеры: чтение базы и сборка патча.
 *
 * Окно присылает только настройки. Здесь они встречаются с настоящими файлами
 * конкретной установки GTA V:
 *
 *   common/data/effects/bloodfx.dat            — какая запись за что отвечает;
 *   common/data/effects/ptxclipregions.dat     — сетка кадров каждой текстуры;
 *   x64/patch/data/effects/ptfx*.rpf/core.ypt  — правила эффектов и текстуры;
 *   common/data/ai/weapons.meta                — какое оружие какой след тянет.
 *
 * Ни один из них не приносится «готовым» из каталога. Каждый читается из
 * архива игрока, правится точечно и кладётся обратно. Поэтому чужой
 * графический мод, стоящий поверх, не затирается целиком, а установка
 * переживает обновление игры: база всегда новая, слои те же.
 *
 * Нативный движок и поставщик ArchiveFix приходят параметрами: в бою это те
 * же функции, а в тестах — единственный способ проверить сборку патча, не
 * открывая настоящий update.rpf и не требуя Windows с установленной игрой.
 */

import fs from "node:fs/promises";
import {
  describeYptFacts,
  explainForeignArchive,
  explainUnreadableYpt,
} from "./foreign-archive.js";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyBloodRouting,
  healOrphanedBloodRules,
  irregularRecords,
  parseBloodFx,
  revertBloodRouting,
  serializeBloodFx,
} from "@modovik/bloodfx";
import sharp from "sharp";
import {
  decodeBlocks,
  levelBytes,
  resample,
  writeDdsHeader,
} from "@modovik/dds";
import { encodeDdsPooled } from "./dds-pool.js";
import {
  CUSTOM_TEXTURE_LAYOUT,
  ENVIRONMENT_FAMILIES,
  IMPACT_ZONE_IDS,
  applyFamilyTint,
  effectTextures,
  environmentPreviewBatches,
  pickEnvironmentEffect,
  findImpactDonorFile,
  impactCatalogueRules,
  impactPictureSvg,
  impactZoneChanged,
  layerNeedsUpload,
  layerPictureKey,
  parseProject,
  ruleTextures,
} from "@modovik/ptfx-studio";
import {
  compileProject,
  projectDonorFiles,
} from "@modovik/ptfx-studio/compile.js";
import { readYptTextures } from "@modovik/ypt";
import { readSceneLight } from "./ptfx-scene-light.js";
import {
  CORE_ARCHIVES,
  coreEntry,
  coreReadEntry,
  coreWriteEntries,
  dataReadEntry,
  donorReadEntry,
  isUnreadableEntry,
  locateEffectEntries,
  missingEntry,
  readGameEntry,
} from "./ptfx-entry-locator.js";
import {
  ASTRAL_PTFX_CORE_VERSION,
  ASTRAL_TRACER_SLOTS,
  isAstralMuzzle,
  isAstralSmoke,
  muzzleRuleFor,
  smokeRuleFor,
} from "@modovik/tracer-contract";
import { DEFAULT_SMOKE_DONOR } from "@modovik/ptfx-studio/muzzle.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { callNativeEngine } from "./native-engine.js";
import { appLog } from "./app-log.js";
import {
  MAX_CLIP_REGIONS_BYTES,
  PTX_CLIP_REGIONS_ENTRY,
  parseClipRegions,
  readClipGrids,
  upsertClipRegions,
} from "./ptfx-clip-regions.js";
import {
  IMPACT_CLONE_PREFIX,
  cloneDonorMessage,
  describeCoreSlots,
  missingCloneDonors,
  planCoreSlots,
  requiredCoreSlots,
  slotSheets,
} from "./ptfx-core-slots.js";
import { openOriginals } from "./ptfx-originals.js";
import { inspectProfile } from "@modovik/install-engine";
import {
  assertRpfHelperFeatures,
  digestYptRules,
  exportYptRules,
  extractRpfEntries,
  inspectYpt,
  patchWeaponTracerFiles,
  patchYptTextures,
  searchRpfArchive,
} from "./rpf-composer.js";
import {
  boundedTracerJournal,
  flashDonors,
  planTracerWeaponFiles,
  readTracerBindings,
  smokeDonors,
  weaponFileChanges,
} from "./tracer-weapons.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const defaultTools = () => ({
  native: callNativeEngine,
  archiveSupport: provisionArchiveSupport,
  inspect: inspectYpt,
  patchTextures: patchYptTextures,
  /* Файлы оружия: где лежат (поиск по update.rpf), пакетное извлечение из
     update.rpf и пакетов дополнений, правка пачкой — всё помощником RPF,
     одним запуском на шаг. Параметрами — чтобы тест не носил архивы игры. */
  searchArchive: searchRpfArchive,
  extractMany: extractRpfEntries,
  patchWeaponFiles: patchWeaponTracerFiles,
  /* Что умеет помощник RPF сверх режимов: слои клонов, дальность. Приходит
     параметром, чтобы тест не искал на диске настоящий helper. */
  assertFeatures: assertRpfHelperFeatures,
  /* Пиксели штатных текстур ядра — для превью окружения и для его патча.
     Приходит параметром: тесту незачем носить настоящий core.ypt. */
  coreTextures: readYptTextures,
  /* Выписка правил эффектов из ядра игрока — по ней сцена окна проигрывает
     попадание числами самих правил. Тоже параметром, по той же причине. */
  digest: digestYptRules,
  /* Те же правила целиком — для движка частиц окна: эволюции, домены,
     поведения, переменные шейдера. Параметром — тест подставляет свою. */
  exportRules: exportYptRules,
  /* Где в update.rpf игрока на самом деле лежат файлы эффектов
     (`ptfx-entry-locator.js`). `null` — описи нет, читаем штатные пути. */
  locate: locateEffectEntries,
});

/* Лист для сцены попаданий — игровой размер: у `ptfx_blood_spray` это 512
   (по 73 точки на кадр), и ужатый до 384 лист превращал брызги в мыло рядом с
   настоящим телом (задача 4А ТЗ 18.10.2026). Не больше 1024 по стороне и не
   меньше 128 на кадр: 2048² дымов и пыли сцене не нужны, а база с сорока
   листами обязана оставаться по плечу — её читают при каждом открытии
   редактора. Меняется размер — меняется и хеш исходников, а с ним и кэш базы. */
const IMPACT_SHEET_EDGE = 1024;
const IMPACT_FRAME_EDGE = 128;
/* Листы объёмного превью окружения крупнее: пламя встаёт на весь кадр, и
   кадр флипбука в 72 точки был бы мылом (задача 7 ТЗ 05.10.2026). */
const ENVIRONMENT_SHEET_EDGE = 1024;
const ENVIRONMENT_FRAME_EDGE = 160;

/* Превью кадра окружения в окне — не больше 192 пикселей по стороне: человеку
   нужно увидеть характер дыма, а не все 2048×2048, и листов в ответе сорок. */
const PREVIEW_EDGE = 192;
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

/**
 * Картинка зоны для вида «Картинка» → RGBA текстуры клона.
 *
 * Картинка человека приходит из окна строкой base64: мост между процессами
 * передаёт JSON, и гонять двоичное через него незачем. Готовый значок из набора
 * не приходит вовсе — он собирается здесь из тех же контуров, по которым его
 * рисует окно (`impactPictureSvg`). Картинка приводится ровно к размеру
 * текстуры: больше не нужно, меньше — видно ступеньки. `key` — отпечаток
 * пикселей: голова и тело с одной и той же картинкой делят один клон и одну
 * текстуру.
 */
async function preparePicture(bytes) {
  if (!bytes?.length) return null;
  if (bytes.length > MAX_PICTURE_BYTES)
    throw new RangeError("Картинка эффекта превышает 4 МБ.");
  const framed = sharp(bytes, { failOn: "error" })
    .rotate()
    .resize(CUSTOM_TEXTURE_LAYOUT.width, CUSTOM_TEXTURE_LAYOUT.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .ensureAlpha();
  const { data, info } = await framed
    .clone()
    .raw()
    .toBuffer({ resolveWithObject: true });
  /* Тот же кадр ещё и картинкой: лист брызг собирается из SVG, а картинка
     человека ложится в него ссылкой — внешних файлов в SVG быть не может. */
  const png = await framed.clone().png().toBuffer();
  return {
    width: info.width,
    height: info.height,
    rgba: data,
    key: sha256(data).slice(0, 16),
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  };
}

/**
 * Картинки слоёв, которым они нужны: ключ — `зона:слой`.
 *
 * Картинку человека присылает окно строкой base64. Ключи прежних установок
 * («head», «body» — одна картинка на зону) и самый старый `impactImage`
 * (одна на всё) принимаются тоже: сохранённая работа обязана ставиться и
 * теперь, а слой у неё был один.
 */
async function zonePictures(input, project) {
  const pictures = {};
  const images =
    input.impactImages && typeof input.impactImages === "object"
      ? input.impactImages
      : {};
  if (!project.impact.enabled) return pictures;
  for (const zone of IMPACT_ZONE_IDS) {
    const settings = project.impact.zones[zone];
    if (!impactZoneChanged(settings)) continue;
    for (const [index, layer] of settings.layers.entries()) {
      if (!layerNeedsUpload(layer)) continue;
      const key = layerPictureKey(zone, index);
      const encoded =
        images[key] || (index === 0 ? images[zone] || input.impactImage : null);
      const bytes = Buffer.from(
        typeof encoded === "string" ? encoded : "",
        "base64",
      );
      const picture = await preparePicture(bytes);
      if (picture) pictures[key] = picture;
    }
  }
  return pictures;
}

/**
 * Значок из набора → картинка слоя.
 *
 * Готовые значки окно не присылает вовсе: они собираются здесь из тех же
 * контуров, по которым их рисует окно (`impactPictureSvg`). Своя картинка
 * человека приходит байтами и через это не проходит.
 */
async function glyphPictures(project, pictures) {
  if (!project.impact.enabled) return pictures;
  for (const zone of IMPACT_ZONE_IDS) {
    const settings = project.impact.zones[zone];
    if (!impactZoneChanged(settings)) continue;
    for (const [index, layer] of settings.layers.entries()) {
      if (layer.kind !== "custom" || layer.picture === "upload") continue;
      const key = layerPictureKey(zone, index);
      if (pictures[key]) continue;
      const picture = await preparePicture(
        Buffer.from(
          impactPictureSvg(layer.picture, CUSTOM_TEXTURE_LAYOUT.width),
        ),
      );
      if (picture) pictures[key] = picture;
    }
  }
  return pictures;
}

/**
 * Лист брызг из SVG → DDS точной раскладки.
 *
 * Лист рисует та же функция, что показывает его в окне (`bloodSheetSvg`), —
 * значит в игре окажется ровно то, что человек видел. Растрирует sharp: у
 * главного процесса он есть, и своего растеризатора SVG заводить незачем.
 */
async function renderSheetTexture(sheet) {
  const { data, info } = await sharp(Buffer.from(sheet.svg), {
    density: 96,
  })
    .resize(sheet.layout.width, sheet.layout.height, {
      fit: "fill",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encodeDdsPooled({
    width: info.width,
    height: info.height,
    format: sheet.layout.format,
    mipLevels: safeMipLevels(info.width, info.height, sheet.layout.mipLevels),
    rgba: new Uint8ClampedArray(data),
  });
}

/*
 * Нейтральная копия штатного листа: та же форма в оттенках серого.
 *
 * Лист кровяной пыли несёт красный прямо в пикселях, и синяя кровь на нём
 * выходила бы чёрной: цвет правила на текстуру умножается. Яркость копии —
 * старший канал оригинала, поэтому штатный красный на ней выглядит как в игре.
 */
function neutralCopy(rgba) {
  const copy = new Uint8ClampedArray(rgba);
  for (let index = 0; index < copy.length; index += 4) {
    const value = Math.max(copy[index], copy[index + 1], copy[index + 2]);
    copy[index] = copy[index + 1] = copy[index + 2] = value;
  }
  return copy;
}

/*
 * Число mip новой текстуры: последний уровень — не меньше блока 4×4.
 * Помощник читает ядро CodeWalker'ом, а тот считает размер уровня делением
 * предыдущего на четыре: у уровня меньше блока выходит меньше настоящего, и
 * ядро перечитывается короче записанного (см. ASTRAL_TRACER_TEXTURE_LAYOUT).
 */
function safeMipLevels(width, height, wanted) {
  const whole = Math.floor(Math.log2(Math.min(width, height))) - 1;
  return Math.max(1, Math.min(Number(wanted) || 1, whole));
}

/* Байты текстуры в DDS идут сразу за заголовком — те же, что лягут в ядро. */
const DDS_PAYLOAD_OFFSET = 128;

/** Уровень 0 текстуры ядра в RGBA. */
function decodeCoreTexture(texture) {
  if (!texture?.decodable || !texture.payload) {
    throw new Error(
      `Текстура ${texture?.name || "?"} в формате ${texture?.format || "неизвестно"} — Astral её не перекрашивает.`,
    );
  }
  const level = levelBytes(texture.format, texture.width, texture.height);
  return decodeBlocks(
    texture.format,
    texture.payload.subarray(0, level),
    texture.width,
    texture.height,
  );
}

/**
 * Кадр листа для превью: один кадр анимации, а не весь лист.
 *
 * Лист огня — это сорок девять кадров 7×7: ужатый до превью целиком, он
 * превращается в рябь из точек. Человеку нужен сам язык пламени, поэтому из
 * листа вырезается один кадр по сетке из ptxclipregions.dat игрока.
 *
 * Кадр выбирается по содержимому, а не по номеру. Прежде брался кадр на 40 %
 * анимации — и это давало чёрный квадрат вместо превью: у `ptfx_fire_tail`
 * (4 кадра) хвост разгорается к концу, и кадр № 1 в нём пустой. Пустой кадр
 * — законная часть анимации, но показывать его вместо эффекта нельзя: человек
 * видит чёрный квадрат и решает, что семейство сломано.
 *
 * «Содержимое» — сумма яркости, взвешенная непрозрачностью: у листов без
 * альфы (DXT1) пустое место — это чёрный пиксель, у листов с альфой — нулевая
 * прозрачность. Одна мерка ловит оба случая.
 */
function frameEnergy(rgba, textureWidth, left, top, width, height) {
  let sum = 0;
  /* Шаг по четыре пикселя: мерка сравнительная, и полный обход листа 512×512
     ради неё — это четверть миллиона итераций на каждый лист впустую. */
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const offset = ((top + y) * textureWidth + (left + x)) * 4;
      const luminance =
        (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3;
      sum += (luminance * rgba[offset + 3]) / 255;
    }
  }
  return sum;
}

function previewFrame(rgba, texture, grid) {
  const columns = Math.max(1, grid?.columns || 1);
  const rows = Math.max(1, grid?.rows || 1);
  if (columns * rows === 1)
    return { rgba, width: texture.width, height: texture.height };
  const width = Math.floor(texture.width / columns);
  const height = Math.floor(texture.height / rows);
  let index = 0;
  let best = -1;
  for (let candidate = 0; candidate < columns * rows; candidate += 1) {
    const energy = frameEnergy(
      rgba,
      texture.width,
      (candidate % columns) * width,
      Math.floor(candidate / columns) * height,
      width,
      height,
    );
    if (energy > best) {
      best = energy;
      index = candidate;
    }
  }
  const left = (index % columns) * width;
  const top = Math.floor(index / columns) * height;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * texture.width + left) * 4;
    frame.set(rgba.subarray(from, from + width * 4), y * width * 4);
  }
  return { rgba: frame, width, height, frameIndex: index };
}

/*
 * Декодирование листов идёт в главном процессе, и лист 1024² — это десятки
 * миллисекунд подряд. Между листами главный поток отпускается: окно в это
 * время ждёт ответов на свои запросы (проверка установки, очередь, звук), и
 * сорок листов одним куском были бы для него секундой тишины.
 */
const breathe = () => new Promise((resolve) => setImmediate(resolve));

/** Текстуры словаря по имени в нижнем регистре. */
const texturesByName = (textures) =>
  new Map(textures.map((texture) => [texture.name.toLowerCase(), texture]));

/**
 * Листы каждого семейства окружения — прямо из ядра игрока, по кадру на лист.
 *
 * Без них окно показывало бы нарисованный «примерно дым», а человек правил бы
 * оттенок настоящего. Кадр сжимается до превью здесь, в главном процессе: канал
 * IPC не для мегабайтных листов. PNG превью едет байтами (`png` — Buffer, окно
 * получает Uint8Array), а не строкой `data:image/png;base64,…`: base64 раздувал
 * ответ на треть, и строку надо было ещё кодировать здесь и разбирать там. Базой служат ШТАТНЫЕ байты листа: если в игре
 * уже лежит наша правка, берётся отложенный оригинал — окно красит то же, что
 * перекрасит установка.
 */
async function environmentSprites(byName, { grids, originals }) {
  const sprites = {};
  for (const family of ENVIRONMENT_FAMILIES) {
    const sheets = [];
    for (const name of family.textures) {
      const texture = byName.get(name.toLowerCase());
      if (!texture?.decodable || !texture.payload) continue;
      await breathe();
      const base = await originals.baseFor(texture);
      const grid = grids.get(name.toLowerCase()) || { columns: 1, rows: 1 };
      const frame = previewFrame(
        decodeCoreTexture({ ...texture, payload: base.payload }),
        texture,
        grid,
      );
      const scale = Math.min(
        1,
        PREVIEW_EDGE / Math.max(frame.width, frame.height),
      );
      const width = Math.max(1, Math.round(frame.width * scale));
      const height = Math.max(1, Math.round(frame.height * scale));
      const small = resample(
        frame.rgba,
        frame.width,
        frame.height,
        width,
        height,
      );
      const png = await sharp(
        Buffer.from(small.buffer, small.byteOffset, small.byteLength),
        { raw: { width, height, channels: 4 } },
      )
        .png()
        .toBuffer();
      sheets.push({
        texture: texture.name,
        width: texture.width,
        height: texture.height,
        format: texture.format,
        grid: { columns: grid.columns, rows: grid.rows },
        /* Какой кадр флипбука показан: он выбран по содержимому, и человеку
           полезно знать, что это не «первый», а самый видный. */
        frame: frame.frameIndex ?? 0,
        /* В игре сейчас лежит правка Astral, а превью показывает оригинал. */
        tinted: base.ours,
        preview: {
          width,
          height,
          png,
        },
      });
    }
    if (!sheets.length) continue;
    const lead =
      sheets.find(
        (sheet) => sheet.texture.toLowerCase() === family.preview.toLowerCase(),
      ) || sheets[0];
    sprites[family.id] = { ...lead, sheets };
  }
  return sprites;
}

/**
 * База сцены попаданий: выписки правил-доноров и их листы — из игры игрока.
 *
 * Сцена окна проигрывает попадание по числам самих правил (сколько частиц,
 * как летят, какого цвета в каждый миг) и рисует их теми же листами, что
 * рисует игра. Правила выписывает помощник (`ypt-rule-digest`) из ядра и из
 * чужих словарей каталога (клоунские эффекты живут в `scr_rcbarry2.ypt`);
 * листы декодируются здесь, в главном процессе, и ужимаются до превью.
 *
 * Словарь, которого в игре нет (редукс вырезал), помечается недоступным —
 * окно гасит его эффекты, а установка отказала бы словами. Лист, который не
 * разобрать, просто пропускается: сцена нарисует частицу схемой.
 */
/**
 * Чужие словари доноров каталога — из архива игрока, до разбора: чтения
 * архива идут по одному (хост держит его без совместного доступа), а разбор
 * уже извлечённых файлов — рядом друг с другом. Словаря нет — `null`: окно
 * погасит его эффекты, установка откажет словами.
 *
 * Словарь берётся там, где он есть (`donorReadEntry`): у 71 установки беты
 * его нет в `ptfx_hi.rpf` (архив переложен сборкой), а в `ptfx_lo.rpf` или
 * чужом архиве он бывает на месте. Нет нигде — хост не спрашивается: его
 * отказ ушёл бы в «авто-ошибки», хотя словарь не обязателен.
 */
async function extractDonorFiles(
  { native, gameRoot, keys, directory, where },
  context,
) {
  const files = new Map();
  for (const fileId of impactCatalogueRules().keys()) {
    if (!fileId) continue;
    const found = donorReadEntry(where, findImpactDonorFile(fileId));
    const output = path.join(directory, `${fileId}.ypt`);
    if (!found) {
      files.set(fileId, null);
      continue;
    }
    try {
      await extract(
        { native, gameRoot, entry: found.entry, output, keys },
        context,
      );
      files.set(fileId, output);
    } catch {
      files.set(fileId, null);
    }
  }
  return files;
}

/*
 * Выгрузка правил не вышла — кадр остаётся на листе, но причина идёт в журнал:
 * молчаливое `null` прятало поломку (20.10.2026: у человека не было ни сцены
 * огня, ни попаданий, а в журнале было пусто).
 */
function exportFailed(label, error) {
  appLog.record({
    level: "warn",
    source: "ptfx",
    message: `${label}: выгрузка правил эффектов не удалась — кадр остаётся на листе.`,
    detail: String(error?.message || error),
  });
  return null;
}

async function impactBase(
  { gameRoot, coreFile, core, donors },
  { coreTextures, digest, exportRules = null },
  { grids, originals },
) {
  const rules = {};
  const donorFiles = {};
  const wanted = new Map();
  /* Полная выгрузка правил по словарям: `core` и чужие (`scr_rcbarry2`).
     Её читает движок частиц окна; без помощника с этим режимом сцена
     остаётся на выписке. */
  const model = {};
  /*
   * Выписка и выгрузка всех словарей — разом: это отдельные запуски
   * помощника по секунде каждый, и друг от друга они не зависят. Выгрузка
   * разбирает готовый файл без ключей и идёт рядом с общей очередью
   * помощника (`rpf-composer.js`), выписка — в очереди.
   */
  const dictionaries = await Promise.all(
    [...impactCatalogueRules()].map(async ([fileId, names]) => {
      const file = fileId ? donors.get(fileId) : coreFile;
      if (!file) return { fileId, names, missing: true };
      const [answer, exported, textures] = await Promise.all([
        digest({ input: file, rules: names, gameRoot }),
        exportRules
          ? Promise.resolve()
              .then(() => exportRules({ input: file, rules: names, gameRoot }))
              .catch((error) => exportFailed("Сцена попаданий", error))
          : null,
        fileId
          ? fs
              .readFile(file)
              .then((bytes) => texturesByName(coreTextures(bytes)))
          : core,
      ]);
      return { fileId, names, answer, exported, textures };
    }),
  );
  for (const {
    fileId,
    names,
    missing,
    answer,
    exported,
    textures,
  } of dictionaries) {
    if (missing) {
      donorFiles[fileId] = { available: false, effectRules: [] };
      continue;
    }
    /* Старый помощник без режима выгрузки: сцена обойдётся выпиской. */
    if (exported?.export) model[fileId || "core"] = exported.export;
    const present = [];
    for (const name of names) {
      const rule = answer?.rules?.[name];
      if (!rule) continue;
      rules[name] = { ...rule, file: fileId };
      present.push(name);
    }
    if (fileId) donorFiles[fileId] = { available: true, effectRules: present };
    const exportedTextures = model[fileId || "core"]?.textures || [];
    for (const texture of [
      ...present.flatMap((name) => ruleTextures(name, rules)),
      ...exportedTextures,
    ]) {
      const key = String(texture).toLowerCase();
      if (!key || wanted.has(key)) continue;
      const found = textures.get(key) || core.get(key);
      if (found) wanted.set(key, found);
    }
  }
  const sheets = {};
  for (const [key, texture] of wanted) {
    const tiny = Math.max(texture.width, texture.height) <= 8;
    if (!texture.decodable || !texture.payload || tiny) continue;
    const grid = grids.get(key) || { columns: 1, rows: 1 };
    await breathe();
    /* Штатные байты: в игре может лежать наша же перекраска окружения. */
    const base = await originals.baseFor(texture);
    const rgba = decodeCoreTexture({ ...texture, payload: base.payload });
    const edge = Math.min(
      IMPACT_SHEET_EDGE,
      Math.max(128, IMPACT_FRAME_EDGE * Math.max(grid.columns, grid.rows)),
    );
    const scale = Math.min(1, edge / Math.max(texture.width, texture.height));
    const width = Math.max(1, Math.round(texture.width * scale));
    const height = Math.max(1, Math.round(texture.height * scale));
    const small =
      scale === 1
        ? rgba
        : resample(rgba, texture.width, texture.height, width, height);
    const png = await sharp(
      Buffer.from(small.buffer, small.byteOffset, small.byteLength),
      { raw: { width, height, channels: 4 } },
    )
      .png()
      .toBuffer();
    sheets[texture.name] = {
      width,
      height,
      columns: grid.columns,
      rows: grid.rows,
      png,
    };
  }
  return { rules, sheets, donorFiles, model };
}

/*
 * Объёмное превью окружения (задача 7 ТЗ 05.10.2026): сами эффекты игры,
 * что рисуют листы семейств, — выгрузкой правил из ядра игрока, — и их
 * ШТАТНЫЕ листы (окно красит их тем же `applyFamilyTint`, что установка).
 * По возможности: без помощника с выгрузкой окно остаётся на листе.
 * `{ exports, picks: { семейство: эффект }, sheets }`.
 */
async function environmentSceneBase(
  { gameRoot, coreFile, core },
  { exportRules = null },
  { grids, originals },
) {
  if (!exportRules) return null;
  const exports = [];
  for (const names of environmentPreviewBatches()) {
    const answer = await Promise.resolve()
      .then(() => exportRules({ input: coreFile, rules: names, gameRoot }))
      .catch((error) => exportFailed("Огонь и взрывы", error));
    if (answer?.export) exports.push(answer.export);
  }
  if (!exports.length) return null;
  const picks = {};
  for (const family of ENVIRONMENT_FAMILIES) {
    const name = pickEnvironmentEffect(exports, family.id);
    if (name) picks[family.id] = name;
  }
  const wanted = new Set();
  for (const name of new Set(Object.values(picks)))
    for (const texture of effectTextures(exports, name)) wanted.add(texture);
  const sheets = {};
  for (const key of wanted) {
    const texture = core.get(key);
    if (!texture?.decodable || !texture.payload) continue;
    if (Math.max(texture.width, texture.height) <= 8) continue;
    const grid = grids.get(key) || { columns: 1, rows: 1 };
    await breathe();
    const base = await originals.baseFor(texture);
    const rgba = decodeCoreTexture({ ...texture, payload: base.payload });
    const edge = Math.min(
      ENVIRONMENT_SHEET_EDGE,
      Math.max(256, ENVIRONMENT_FRAME_EDGE * Math.max(grid.columns, grid.rows)),
    );
    const scale = Math.min(1, edge / Math.max(texture.width, texture.height));
    const width = Math.max(1, Math.round(texture.width * scale));
    const height = Math.max(1, Math.round(texture.height * scale));
    const small = scale === 1 ? rgba : resample(rgba, texture.width, texture.height, width, height);
    const png = await sharp(
      Buffer.from(small.buffer, small.byteOffset, small.byteLength),
      { raw: { width, height, channels: 4 } },
    )
      .png()
      .toBuffer();
    sheets[texture.name] = {
      width,
      height,
      columns: grid.columns,
      rows: grid.rows,
      /* Формат решает, чем у листа гаснет плотность (`applyFamilyTint`). */
      format: texture.format,
      png,
    };
  }
  return { exports, picks, sheets };
}

/*
 * Объёмный кадр трассеров (задача 4А ТЗ 18.10.2026): сами правила игры —
 * след пули (`bullet_tracer`), вспышки стволов и пыль в бетонной стене — и их
 * листы в игровом размере. След в окне играется так, как его соберёт
 * установка: размер, цвет и скрытие вблизи камеры — теми же числами, что уходят
 * помощнику (`packages/ptfx-studio/tracer-slot.js`).
 * `{ exports, rules, sheets }`; `null` — старый помощник без выгрузки правил.
 */
const TRACER_SCENE_RULES = Object.freeze([
  "bullet_tracer",
  "bullet_tracer_mg",
  "muz_assault_rifle",
  "muz_assault_rifle_fp",
  "muz_pistol",
  "muz_pistol_fp",
  "muz_smg",
  "muz_smg_fp",
  "muz_shotgun",
  "bul_concrete",
]);
const TRACER_SHEET_EDGE = 1024;
const TRACER_FRAME_EDGE = 128;

/*
 * Тир студии звука (владелец 18.10.2026: «выстрелы… эффекты брать из GTA»):
 * вспышки стволов, дым из ствола (`muz_smoking_barrel`, общий донор
 * `<MuzzleSmokeFx>`) и гильзы (`eject_*` — у правила гильзы своя модель
 * частицы из ядра). Те же выгрузка и листы, что у кадра трассеров.
 */
const RANGE_SCENE_RULES = Object.freeze([
  "muz_assault_rifle",
  "muz_pistol",
  "muz_smg",
  "muz_shotgun",
  "muz_minigun",
  "muz_smoking_barrel",
  "eject_auto",
  "eject_pistol",
  "eject_shotgun",
  "eject_sniper",
  "eject_sniper_heavy",
  "eject_minigun",
]);

const tracerSceneBase = (source, tools, extra) => rulesSceneBase(TRACER_SCENE_RULES, source, tools, extra);
const rangeSceneBase = (source, tools, extra) => rulesSceneBase(RANGE_SCENE_RULES, source, tools, extra);

async function rulesSceneBase(rules, { gameRoot, coreFile, core }, { exportRules = null }, { grids, originals }) {
  if (!exportRules) return null;
  const answer = await Promise.resolve()
    .then(() => exportRules({ input: coreFile, rules: [...rules], gameRoot }))
    .catch((error) => exportFailed("Трассеры и тир", error));
  const exported = answer?.export;
  if (!exported) return null;
  const present = Object.keys(exported.effects || {});
  const wanted = new Set();
  for (const name of present) for (const texture of effectTextures([exported], name)) wanted.add(texture);
  /* Листы моделей частиц (гильзы тира): без них рисовальщик пропускает деталь. */
  for (const mesh of Object.values(exported.meshes || {}))
    for (const part of mesh?.parts || []) if (part?.texture) wanted.add(String(part.texture).toLowerCase());
  const sheets = {};
  for (const key of wanted) {
    const texture = core.get(key);
    if (!texture?.decodable || !texture.payload) continue;
    if (Math.max(texture.width, texture.height) <= 8) continue;
    const grid = grids.get(key) || { columns: 1, rows: 1 };
    await breathe();
    const base = await originals.baseFor(texture);
    const rgba = decodeCoreTexture({ ...texture, payload: base.payload });
    const edge = Math.min(TRACER_SHEET_EDGE, Math.max(128, TRACER_FRAME_EDGE * Math.max(grid.columns, grid.rows)));
    const scale = Math.min(1, edge / Math.max(texture.width, texture.height));
    const width = Math.max(1, Math.round(texture.width * scale));
    const height = Math.max(1, Math.round(texture.height * scale));
    const small = scale === 1 ? rgba : resample(rgba, texture.width, texture.height, width, height);
    const png = await sharp(Buffer.from(small.buffer, small.byteOffset, small.byteLength), {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    sheets[texture.name] = {
      width,
      height,
      columns: grid.columns,
      rows: grid.rows,
      png,
    };
  }
  return { exports: [exported], rules: present, sheets };
}

/*
 * Листы Astral, которые рисуются кадрами: нейтральная копия кровяной пыли
 * (7×7), нарисованные листы брызг (4×4) и переехавшие из чужого словаря.
 * Картинки в один кадр (`astral_impact_pic_*`) строки не требуют — без неё
 * игра и так рисует их целиком.
 */
const FRAMED_IMPACT_SHEET = /^astral_impact_(blood_spray|sheet_.+|tex_.+)$/i;

/** Имена кадровых листов ядра, которых нет в таблице; нет таблицы — пусто. */
export function missingClipRows(textures, grids) {
  if (!grids?.size) return [];
  return [...(textures || [])]
    .filter(
      (name) =>
        FRAMED_IMPACT_SHEET.test(String(name)) &&
        !grids.has(String(name).toLowerCase()),
    )
    .sort();
}

/**
 * Сетки кадров листов из ptxclipregions.dat; без таблицы — все листы 1×1. `writable` — таблица такая, что строгая запись её примет: счётчики заголовка сходятся, строки целы. На чужой таблице с неверным
 * счётчиком (и на повреждённой) «Применить» откажет, поэтому баннер «потерялась таблица кадров» на ней молчит (`clipProblems`): причину назовёт сам отказ. Так же молчит читатель на Rust: его разбор строгий.
 */
async function clipGrids({ native, gameRoot, keys, directory, where }, context) {
  const grids = new Map();
  let writable = false;
  try {
    const found = await dataReadEntry(where, PTX_CLIP_REGIONS_ENTRY);
    if (!found) return { grids, writable };
    const table = await extract(
      {
        native,
        gameRoot,
        entry: found.entry,
        output: path.join(directory, "ptxclipregions.dat"),
        keys,
      },
      context,
    );
    const stat = await fs.lstat(table);
    if (!stat.isFile() || stat.size > MAX_CLIP_REGIONS_BYTES) return { grids, writable };
    const text = await fs.readFile(table, "latin1");
    /* Только сетки: таблица редукса бывает с неверным заголовком, игра её принимает, а строгий разбор оставлял лист целым кадром (`ptfx-clip-regions.js: readClipGrids`). */
    for (const [name, grid] of readClipGrids(text)) grids.set(name, grid);
    try {
      parseClipRegions(text);
      writable = true;
    } catch {
      /* Строгая запись такую таблицу не примет: окно читает её, но чинить не обещает. */
    }
  } catch {
    /* Превью обойдётся целым листом: таблица нужна установке, не окну. */
  }
  return { grids, writable };
}

const BLOODFX_ENTRY = "update:/common/data/effects/bloodfx.dat";
/* Все файлы оружия update.rpf — базовый и лежащие в dlc_patch. */
const WEAPON_METAS_QUERY = "common/data/ai/";
/* Клонов эффектов за одну установку у помощника RPF (`YptEffectClones`). */
const EFFECT_CLONE_LIMIT = 16;
/* Три варианта ядра (`CORE_ARCHIVES`, `coreEntry`) и где они лежат у игрока —
   `ptfx-entry-locator.js`: все три обязаны совпадать, игра выбирает их по
   качеству частиц. */

const MAX_PROJECT_BYTES = 256 * 1024;
const MAX_BLOODFX_BYTES = 4 * 1024 * 1024;
/*
 * Принесённая окном база ограничена жёстче прочитанной из архива: канал IPC
 * пропускает мегабайт на весь запрос, и четырёхмегабайтный файл всё равно был
 * бы отвергнут границей процесса — лучше сказать об этом здесь и понятно.
 */
const MAX_SUPPLIED_BLOODFX_BYTES = 768 * 1024;
const MAX_BLOOD_JOURNAL_BYTES = 256 * 1024;

/*
 * Журнал прежней правки bloodfx.dat — то, что вернула прошлая установка и
 * запомнило окно. Он вспомогательный: битый или слишком большой журнал не
 * повод отказать в установке, осиротевшие записи всё равно вылечит
 * `healOrphanedBloodRules`.
 */
function boundedJournal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, "utf8") > MAX_BLOOD_JOURNAL_BYTES)
      return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function boundedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Проект эффектов обязателен.");
  }
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROJECT_BYTES) {
    throw new RangeError("Проект эффектов превышает 256 КБ.");
  }
  return parseProject(JSON.parse(serialized));
}

function requireGameRoot(input) {
  const selected = String(input?.gameRoot || "").trim();
  if (!selected || !path.isAbsolute(selected)) {
    throw new Error("Выберите папку GTA V Legacy.");
  }
  return path.resolve(selected);
}

/* Папка состояния приложения: в ней живут и патчи, и хранилище оригиналов —
   рядом, а не одно в другом: патчи приходят и уходят, оригиналы остаются. */
const stateRoot = (stateDir) => path.resolve(stateDir || os.tmpdir());
const workRoot = (stateDir) => path.join(stateRoot(stateDir), "ptfx-patches");

/*
 * Хранилище оригиналов этой игры. Под покраской листа может лежать картинка карточки каталога («наш Core»): стоит
 * ли карточка, хранилищу говорит движок — что в этой игре установлено (только чтение, общий разбор состояния).
 */
async function openGameOriginals(stateDir, gameRoot) {
  let installed = null;
  try {
    const state = await inspectProfile({ stateDir: stateRoot(stateDir) });
    const root = path.resolve(String(gameRoot)).toLowerCase();
    installed = new Set();
    for (const target of Object.values(state?.targets || {}))
      if (target?.gameRoot && path.resolve(target.gameRoot).toLowerCase() === root)
        for (const item of target.installed || []) if (item?.modId) installed.add(item.modId);
  } catch {
    installed = null;
  }
  return openOriginals(stateRoot(stateDir), gameRoot, { installed });
}

/*
 * Ключи архива для нативного чтения.
 *
 * Окно их не знает и не должно; в Steam-сборке нативный хост сам их не
 * находит и отвечает «could not discover the RPF keys» — так база для следа
 * и попаданий молча не читалась, а студия открывалась на эталоне. Ключи
 * лежат в проверенном наборе ArchiveFix, тем же путём, что у мини-карты и
 * арены. Без набора чтение идёт без ключей — и падает своей же честной
 * ошибкой, а не выдуманной.
 */
async function resolveKeys(input, archiveSupport, stateDir) {
  if (input?.keys) return input.keys;
  try {
    const support = await archiveSupport?.({ stateDir });
    return support?.directory || undefined;
  } catch {
    return undefined;
  }
}

/** Достаёт запись архива во временный файл. */
async function extract(
  { native, gameRoot, entry, output, keys, readEntry = readGameEntry },
  context,
) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    await native("read-archive-file", { gameRoot, entry, output, keys }, context);
  } catch (error) {
    /* Хост старше приложения не расшифровывает запись архива с оглавлением
       OPEN (update.rpf после OpenIV): её читает rpf7, те же байты. */
    if (isUnreadableEntry(error)) {
      const read = await readEntry({ gameRoot, keys, entry, output }).then(
        () => true,
        () => false,
      );
      if (read) return output;
    }
    /* Штатной записи нет — архив перестроила чужая сборка (`foreign-archive.js`). */
    throw explainForeignArchive(error);
  }
  return output;
}

/*
 * Опись update.rpf игрока (`ptfx-entry-locator.js`): где лежат ядро, словари
 * и файлы данных. Не прочиталась — `null`, и чтения идут штатными путями.
 * Чтение не со штатного места пишется в журнал: по тикету видно, откуда
 * взята база.
 */
async function locateEntries(locate, { gameRoot, keys }) {
  return Promise.resolve()
    .then(() => locate?.({ gameRoot, keys }) ?? null)
    .catch(() => null);
}

function logRelocated(what, found) {
  if (!found || found.how === "standard") return;
  appLog.record({
    level: "warn",
    source: "ptfx",
    message:
      `${what}: штатной записи нет, читаем ${found.entry}` +
      (found.how === "relocated"
        ? found.mounted
          ? " (архив подключён в content.xml update.rpf — его и читает игра)."
          : " (архив игра не подключает — только для редактора)."
        : found.how === "common"
          ? " (из common.rpf — правка ляжет в update.rpf новой записью)."
          : " (тот же файл другого качества частиц)."),
  });
}

/**
 * База для мастерской: текст `bloodfx.dat` и опись правил ядра.
 *
 * Опись нужна, чтобы сказать правду до установки. Слоты Astral, которых в
 * ядре нет, установка построит из штатных доноров самого ядра; если донор
 * вырезан редуксом или слот собран наполовину, `core.slots` говорит об этом
 * здесь — узнать лучше в редакторе, чем после сорока секунд установки.
 */
export async function readPtfxBase(input, context, stateDir, tools = {}) {
  const { native, inspect, archiveSupport, locate } = {
    ...defaultTools(),
    ...tools,
  };
  const gameRoot = requireGameRoot(input);
  const keys = await resolveKeys(input, archiveSupport, stateDir);
  const directory = path.join(workRoot(stateDir), `read-${randomUUID()}`);
  /* Где что лежит у игрока — до чтений: опись закрывает архив раньше, чем
     к нему придёт хост. */
  const where = await locateEntries(locate, { gameRoot, keys });
  try {
    const bloodAt = await dataReadEntry(where, BLOODFX_ENTRY);
    if (!bloodAt) throw missingEntry(BLOODFX_ENTRY);
    logRelocated("bloodfx.dat", bloodAt);
    const bloodFile = await extract(
      {
        native,
        gameRoot,
        entry: bloodAt.entry,
        output: path.join(directory, "bloodfx.dat"),
        keys,
      },
      context,
    );
    const stat = await fs.lstat(bloodFile);
    if (!stat.isFile() || stat.size > MAX_BLOODFX_BYTES) {
      throw new Error("bloodfx.dat в архиве повреждён.");
    }
    const bloodfx = await fs.readFile(bloodFile, "utf8");
    // Разбираем здесь, а не в окне: битый файл обязан упасть на границе
    // процесса, а не превратиться в пустой редактор.
    const document = parseBloodFx(bloodfx);
    logIrregularBloodRecords(document);

    /* Ядро — штатное, иначе то, что читает игра (`coreReadEntry`). */
    const coreAt = coreReadEntry(where);
    if (!coreAt) throw missingEntry(coreEntry(CORE_ARCHIVES[0]));
    logRelocated("Ядро эффектов", coreAt);
    const coreFile = await extract(
      {
        native,
        gameRoot,
        entry: coreAt.entry,
        output: path.join(directory, "core.ypt"),
        keys,
      },
      context,
    );
    /*
     * Всё остальное из архива — сразу, до разбора: чтения архива идут по
     * одному (хост держит его без совместного доступа), а разбор извлечённых
     * файлов дальше идёт одновременно — опись ядра, выписки и выгрузки
     * помощником, декодирование листов здесь. Друг за другом это было семь
     * с половиной секунд на каждый вход в редактор.
     */
    const { grids, writable: clipWritable } = await clipGrids(
      { native, gameRoot, keys, directory, where },
      context,
    );
    const donors = await extractDonorFiles(
      { native, gameRoot, keys, directory, where },
      context,
    );
    /* Свет сцены из игры: без него окно возьмёт эталонный день. */
    let light = null;
    let lightError = null;
    try {
      light = await readSceneLight(
        { native, gameRoot, keys, directory },
        context,
      );
    } catch (error) {
      lightError = String(error?.message || error);
    }
    const originals = await openGameOriginals(stateDir, gameRoot);
    const allTools = { ...defaultTools(), ...tools };
    /* Опись ядра — первой: она дольше всех, и помощник для неё свой. Отказ
       ловится сразу, а бросается ниже: пока идёт декодирование листов,
       отказ без обработчика главный процесс счёл бы необработанным. */
    const inspecting = Promise.resolve()
      .then(() => inspect({ input: coreFile, gameRoot }))
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    /* Спрайты окружения и база сцены попаданий — по возможности: их
       отсутствие не отменяет базу для следа и попаданий, окно честно
       покажет нарисованный образец. Текстуры ядра разбираются один раз на
       оба. */
    const failure = (error) => String(error?.message || error);
    /* Ядро, которое разжимается больше заявленного (бета 15.10.2026, редукс),
       — тем же отказом, что у помощника: «архив переделан», с фактами о
       файле в журнале, а не голым текстом распаковщика. */
    const core = await fs
      .readFile(coreFile)
      .then((bytes) => texturesByName(allTools.coreTextures(bytes)))
      .catch(async (error) => {
        const explained = await explainUnreadableYpt(error, coreFile);
        if (explained !== error)
          appLog.record({
            level: "warn",
            source: "ptfx",
            message: explained.message,
            detail: `${describeYptFacts(explained.facts)}\n${failure(error)}`.trim(),
          });
        throw explained;
      });
    const impacting = impactBase(
      { gameRoot, coreFile, core, donors },
      allTools,
      { grids, originals },
    ).then(
      (value) => ({ value }),
      (error) => ({ error: failure(error) }),
    );
    const environmentResult = await environmentSprites(core, {
      grids,
      originals,
    }).then(
      (value) => ({ value }),
      (error) => ({ error: failure(error) }),
    );
    const sceneResult = await environmentSceneBase(
      { gameRoot, coreFile, core },
      allTools,
      { grids, originals },
    ).then(
      (value) => ({ value }),
      (error) => ({ error: failure(error) }),
    );
    const tracerResult = await tracerSceneBase(
      { gameRoot, coreFile, core },
      allTools,
      { grids, originals },
    ).then(
      (value) => ({ value }),
      (error) => ({ error: failure(error) }),
    );
    const rangeResult = await rangeSceneBase(
      { gameRoot, coreFile, core },
      allTools,
      { grids, originals },
    ).then(
      (value) => ({ value }),
      (error) => ({ error: failure(error) }),
    );
    const [inspected, impactResult] = await Promise.all([
      inspecting,
      impacting,
    ]);
    if (inspected.error) throw inspected.error;
    const inspection = inspected.value;
    const textures = new Set(
      (inspection.resource?.textures || []).map((item) => item.name),
    );
    const rules = new Set(inspection.resource?.effectRules || []);
    const slots = describeCoreSlots(inspection);
    const environment = environmentResult.value ?? null;
    const environmentError = environmentResult.error ?? null;
    const impact = impactResult.value ?? null;
    const impactError = impactResult.error ?? null;
    return {
      bloodfx,
      version: document.version,
      entries: {
        entry: document.records.entry.order.length,
        exit: document.records.exit.order.length,
      },
      core: {
        version: ASTRAL_PTFX_CORE_VERSION,
        textures: [...textures].sort(),
        /*
         * Правила, на которые мастерская может рассчитывать при установке:
         * лежащие в ядре и слоты Astral, которые установка построит из
         * штатных доноров. Что из них уже есть, а что будет построено, —
         * в `slots`; окно по этому списку решает, можно ли применять.
         */
        effectRules: [...new Set([...rules, ...slots.available])].sort(),
        slots,
        /*
         * Клоны Astral в ядре, эволюции которых расходятся с данными Rockstar:
         * так до 24.09.2026 собирались составные эффекты попадания, и игра на
         * них падала при попадании. Окно просит пересобрать набор. Старый
         * помощник этого поля не знает — тогда список пуст.
         */
        cloneProblems: Array.isArray(inspection.resource?.cloneProblems)
          ? inspection.resource.cloneProblems
          : [],
      },
      /*
       * Листы кадров Astral, которым в ptxclipregions.dat не хватает строки:
       * игра рисует такой лист целиком одной картинкой, и кровь летит
       * «плоской PNG-шкой». Строку теряла замена прежней версии набора
       * (19.10.2026); окно просит нажать «Применить». Отдельный раздел, не
       * часть `core`: ядро читает и движок на Rust, сверка идёт по разделам.
       */
      clipProblems: clipWritable ? missingClipRows(textures, grids) : [],
      environment,
      environmentError,
      /* Эффекты игры для объёмного превью окружения (задача 7). */
      environmentScene: sceneResult.value ?? null,
      environmentSceneError: sceneResult.error ?? null,
      /* Следы, вспышки стволов и пыль в стене для объёмного кадра трассеров (задача 4А). */
      tracerScene: tracerResult.value ?? null,
      tracerSceneError: tracerResult.error ?? null,
      /* Вспышки, дым из ствола и гильзы для тира студии звука. */
      rangeScene: rangeResult.value ?? null,
      rangeSceneError: rangeResult.error ?? null,
      /* Выписки правил-доноров, их листы и доступность чужих словарей. */
      impact,
      impactError,
      /* Таймцикл ясного дня и visualsettings.dat — свет окна эффектов. */
      light,
      lightError,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * Помощник, собранный до построения слотов, заказ слота молча не видит и
 * падает на «текстуры не существует» — или отвечает без отчёта о слотах.
 * Человеку нужно не это, а что сделать.
 */
const outdatedHelperMessage = (archive) =>
  `Помощник RPF не построил слоты Astral в ${archive}: он собран без этой возможности. ` +
  "Обновите Astral или пересоберите помощник (npm run rpf:build) и повторите.";

/*
 * Файлы игры с модами обязаны читаться и собираться: то, что Astral оставил
 * в них как есть, называется в журнале («Логи» в настройках), чтобы по тикету
 * было видно, почему эффект в этой записи или правиле не поменялся.
 */
function logIrregularBloodRecords(document) {
  const irregular = irregularRecords(document);
  if (!irregular.length) return;
  appLog.record({
    level: "warn",
    source: "ptfx",
    message:
      `bloodfx.dat: ${irregular.length} записей не того вида (мод или другая версия игры) — ` +
      "Astral их не правит, в файле они остаются как есть.",
    detail: irregular
      .slice(0, 16)
      .map((item) => `${item.name}/${item.id}: ${item.problem}`)
      .join("\n"),
  });
}

function logForeignNameHashes(archive, report) {
  const remarks = report?.nameHashRemarks;
  if (!remarks?.count) return;
  appLog.record({
    level: "warn",
    source: "ptfx",
    message:
      `Ядро эффектов ${archive}: ${remarks.count} записей словаря с нестандартным хешем имени ` +
      "(ядро собрано модом) — перенесены как есть.",
    detail: (remarks.entries || [])
      .slice(0, 16)
      .map((item) => `${item.dictionary} ${item.name}: ${item.hash} (${item.form})`)
      .join("\n"),
  });
}

/*
 * Ссылки штатных эффектов исходного ядра за его словарь (ядро из редукса —
 * тестер беты 19.10.2026, ent_brk_wood_planks): помощник их не трогает и
 * установку из-за них не останавливает, а журнал называет — по нему видно,
 * какой файл игрока такой и почему эффект работает как есть.
 */
function logGraphRemarks(archive, report) {
  const remarks = report?.graphRemarks;
  if (!remarks?.count) return;
  appLog.record({
    level: "warn",
    source: "ptfx",
    message:
      `Ядро эффектов ${archive}: у ${remarks.count} эффектов ссылка на правило уходит за словарь ядра ` +
      "(ядро собрано редуксом) — оставлены как есть, установка идёт.",
    detail: (remarks.entries || []).slice(0, 32).join("\n"),
  });
}

/** Ошибка помощника на одном из трёх ядер — с именем ядра и по-русски. */
function coreArchiveError(archive, reservations, error) {
  const message = String(error?.message || error);
  if (
    reservations.some((item) =>
      message.includes(`does not exist: ${item.texture}`),
    )
  ) {
    return new Error(outdatedHelperMessage(archive), { cause: error });
  }
  /* Донора сверяли по первому ядру; в hi или lo редукс мог вырезать иное. */
  const donor = /YPT donor effect rule does not exist: (\S+)/.exec(message);
  if (donor) {
    return new Error(`${archive}: ${cloneDonorMessage([donor[1]])}`, {
      cause: error,
    });
  }
  return new Error(`Ядро эффектов ${archive} не собрано: ${message}`, {
    cause: error,
  });
}

/** Помощник обязан подтвердить каждый заказанный слот, а не промолчать. */
function confirmedReservations(archive, reservations, report) {
  if (!reservations.length) return null;
  const reserved = report?.slotReservations?.reserved;
  const confirmed =
    Array.isArray(reserved) &&
    reserved.length === reservations.length &&
    reservations.every((item) =>
      reserved.some(
        (slot) =>
          slot?.effect === item.effect && slot?.texture === item.texture,
      ),
    );
  if (!confirmed) throw new Error(outdatedHelperMessage(archive));
  return report.slotReservations.verification || null;
}

/**
 * Помощник обязан подтвердить каждый заказанный клон, а не промолчать.
 *
 * У составного клона сверяются все доноры: helper, собравший из трёх слоёв
 * один, отчитается одним донором — и молчаливо потерянные слои надо поймать
 * здесь, а не увидеть в игре.
 */
function confirmedClones(archive, clones, report) {
  if (!clones.length) return null;
  const cloned = report?.effectClones?.cloned;
  const donorsOf = (clone) =>
    Array.isArray(clone?.donors) && clone.donors.length
      ? clone.donors
      : [clone?.donorEffect].filter(Boolean);
  const confirmed =
    Array.isArray(cloned) &&
    cloned.length === clones.length &&
    clones.every((item) => {
      const wanted = item.layers.map((layer) => layer.donorEffect);
      const built = cloned.find((clone) => clone?.effect === item.effect);
      const donors = donorsOf(built);
      return (
        built &&
        donors.length === wanted.length &&
        wanted.every((donor, index) => donors[index] === donor)
      );
    });
  if (!confirmed) {
    throw new Error(
      `Помощник RPF не собрал эффекты попадания в ${archive}: он собран без этой возможности. ` +
        "Обновите Astral или пересоберите помощник (npm run rpf:build) и повторите.",
    );
  }
  return cloned.map((clone) => ({
    rule: clone.effect,
    donor: clone.donorEffect,
    donors: donorsOf(clone),
    emitters: clone.emitters,
    layers: clone.layers ?? 1,
    /* Текстуры чужого словаря, переехавшие в ядро под своими именами. */
    imported: (Array.isArray(clone.importedTextures)
      ? clone.importedTextures
      : []
    )
      .filter((item) => item?.texture && item?.source)
      .map((item) => ({ texture: item.texture, source: item.source })),
  }));
}

/*
 * Таблица кадров листов ptxclipregions.dat.
 *
 * Читается до сборки ядер: если таблицы нет или она битая, отказ приходит
 * через секунду, а не после трёх тринадцатимегабайтных ядер. Правится же
 * после: какие текстуры чужого словаря переехали в ядро, знает только
 * помощник, а строки им нужны те же, что у исходных листов.
 */
async function readClipTable(
  { native, gameRoot, keys, staging, found },
  context,
) {
  let table;
  try {
    if (!found) throw missingEntry(PTX_CLIP_REGIONS_ENTRY);
    table = await extract(
      {
        native,
        gameRoot,
        entry: found.entry,
        output: path.join(staging, "ptxclipregions.dat"),
        keys,
      },
      context,
    );
  } catch (error) {
    throw new Error(
      "В update.rpf не читается common/data/effects/ptxclipregions.dat — без неё " +
        "игра не разложит лист эффекта на кадры. Проверьте целостность файлов " +
        "игры в Steam и повторите.",
      { cause: error },
    );
  }
  const stat = await fs.lstat(table);
  if (!stat.isFile() || stat.size > MAX_CLIP_REGIONS_BYTES) {
    throw new Error("ptxclipregions.dat в архиве игры повреждён.");
  }
  return fs.readFile(table, "latin1");
}

/*
 * Чужие словари доноров: достаются из игры игрока и проверяются до сборки
 * ядер. Словаря нет (редукс вырезал `ptfx_hi.rpf` или сам файл) — отказ
 * словами: какого файла нет и какой эффект без него не собрать.
 */
/*
 * Файлы оружия игры: где лежат, что в них сейчас и что в них записать.
 *
 * Сначала один поиск по update.rpf — какие файлы оружия там есть (базовый
 * weapons.meta и файлы пакетов, которые Rockstar уже положила в dlc_patch).
 * Их — одним пакетным извлечением. Файлов, которых в dlc_patch нет, —
 * из самих пакетов дополнений, тоже пачкой на пакет: установка положит их в
 * dlc_patch новыми. Пятьдесят файлов «всего оружия» так читаются за пару
 * секунд, а не за полсотни запусков.
 *
 * Возвращает по файлу: план, путь к прочитанному, добавляется ли он заново и
 * что в него записать (`weaponFileChanges`).
 */
async function readWeaponFiles(
  { plans, previous, gameRoot, staging },
  { searchArchive, extractMany },
) {
  const updateArchive = path.join(gameRoot, "update", "update.rpf");
  const request = { gameRoot, edition: "Legacy" };
  const listing = await searchArchive({
    ...request,
    archivePath: updateArchive,
    query: WEAPON_METAS_QUERY,
    maxMatches: 4000,
    /* Файлы оружия лежат папками, не во вложенных архивах. */
    maxNestedDepth: 0,
  });
  const present = new Map(
    (listing?.matches || []).map((match) => [
      String(match.entry).toLowerCase(),
      String(match.entry),
    ]),
  );
  const fromUpdate = [];
  const fromPacks = new Map();
  for (const plan of plans) {
    const inner = plan.target.replace(/^update:\//, "");
    const found = present.get(inner.toLowerCase());
    if (found) {
      fromUpdate.push({ plan, entry: found });
      continue;
    }
    if (plan.source.kind !== "dlc") {
      /* Базового weapons.meta в update.rpf нет — игра не та или сломана;
         лечить нечего, пока трассеров нет, а с ними — не к чему привязать. */
      if (!planChanges(plan)) continue;
      throw new Error(
        `В update.rpf нет ${inner}: без него трассер к оружию не привязать. Проверьте целостность файлов GTA V в Steam или Rockstar Launcher.`,
      );
    }
    /* Возвращать штатное файлу, которого в dlc_patch нет, незачем: игра и
       так читает его из пакета, где правки Astral не было. */
    if (!planChanges(plan)) continue;
    const list = fromPacks.get(plan.source.archive) || [];
    list.push({ plan, entry: plan.source.packEntry });
    fromPacks.set(plan.source.archive, list);
  }

  const read = [];
  const directory = path.join(staging, "weapons");
  if (fromUpdate.length) {
    const output = path.join(directory, "update");
    await extractMany({
      ...request,
      archivePath: updateArchive,
      entries: fromUpdate.map((item) => item.entry),
      outputDirectory: output,
    });
    for (const item of fromUpdate)
      read.push({
        plan: item.plan,
        input: path.join(output, ...item.entry.split("/")),
        imported: false,
      });
  }
  let pack = 0;
  for (const [archive, items] of fromPacks) {
    pack += 1;
    const output = path.join(directory, `pack-${pack}`);
    try {
      await extractMany({
        ...request,
        archivePath: path.join(gameRoot, ...archive.split("/")),
        entries: items.map((item) => item.entry),
        outputDirectory: output,
      });
    } catch (error) {
      const weapons = [
        ...new Set(
          items.flatMap((item) => [
            ...item.plan.bindings.map((binding) => binding.weapon),
            ...item.plan.flashes,
            ...item.plan.smokes,
            ...item.plan.looks,
          ]),
        ),
      ];
      throw new Error(
        `В вашей игре не читается описание оружия ${weapons.join(", ")} (${archive}): ${String(error?.message || error)}. Проверьте целостность файлов GTA V в Steam или Rockstar Launcher.`,
      );
    }
    for (const item of items)
      read.push({
        plan: item.plan,
        input: path.join(output, ...item.entry.split("/")),
        imported: true,
      });
  }

  /* Порядок плана: имена payload и порядок записей в манифесте от него. */
  const order = new Map(plans.map((plan, index) => [plan.target, index]));
  read.sort(
    (left, right) => order.get(left.plan.target) - order.get(right.plan.target),
  );
  for (const item of read) {
    item.current = readTracerBindings(await fs.readFile(item.input, "utf8"));
    /* Доноры вспышек и дыма — до правки: по ним называются клоны. */
    item.donors = flashDonors({
      file: item.plan,
      current: item.current,
      previous,
    });
    item.smokeDonors = smokeDonors({
      file: item.plan,
      current: item.current,
      previous,
    });
  }
  return read;
}

/* Есть ли файлу оружия что ставить (а не только что вернуть). */
const planChanges = (plan) =>
  plan.bindings.length > 0 ||
  plan.flashes.length > 0 ||
  plan.smokes.length > 0 ||
  plan.looks.length > 0;

/**
 * Что записать в каждый прочитанный файл оружия (`weaponFileChanges`):
 * `flashRules` — ствол → клон его вспышки. Ствола нет в файле — отказ до
 * записи в игру.
 */
function settleWeaponFiles(
  read,
  previous,
  flashRules,
  smokeRules = new Map(),
  lookSpecs = new Map(),
  coreRules = null,
) {
  for (const item of read) {
    item.change = weaponFileChanges({
      file: item.plan,
      current: item.current,
      previous,
      flashRules,
      smokeRules,
      lookSpecs,
      coreRules,
    });
    if (item.change.missing.length)
      throw new Error(
        `В файле ${item.plan.target.replace(/^update:\//, "")} нет ${item.change.missing.join(", ")} — трассер или вспышку к этому стволу не привязать. Скорее всего файл заменён модом оружия.`,
      );
  }
  return read;
}

async function donorFilePaths(
  { native, gameRoot, keys, staging, inspect, files, where },
  context,
) {
  const paths = new Map();
  for (const file of files) {
    const output = path.join(staging, `${file.id}.ypt`);
    try {
      /* Словарь — там, где он есть (`donorReadEntry`); нет нигде — тот же
         отказ, но без запуска хоста. */
      const found = donorReadEntry(where, file);
      if (!found) throw missingEntry(`update:/${file.entry}`);
      logRelocated(file.entry, found);
      await extract(
        { native, gameRoot, entry: found.entry, output, keys },
        context,
      );
    } catch (error) {
      throw new Error(
        `В update.rpf вашей игры не читается ${file.entry} (${file.label}) — ` +
          `без него не собрать эффект из правил ${file.effects.join(", ")}. ` +
          "Скорее всего файл вырезан редуксом: верните штатный update.rpf или выберите другой эффект.",
        { cause: error },
      );
    }
    const inspection = await inspect({ input: output, gameRoot });
    const missing = missingCloneDonors(inspection, file.effects);
    if (missing.length)
      throw new Error(
        `В словаре ${file.label} вашей игры нет правила ${missing.join(", ")} — ` +
          "из него Astral собирает выбранный эффект. Выберите другой эффект или верните штатный update.rpf.",
      );
    paths.set(file.id, output);
  }
  return paths;
}

async function materialize(input, context, stateDir, tools) {
  const {
    native,
    inspect,
    patchTextures,
    searchArchive,
    extractMany,
    patchWeaponFiles,
    coreTextures,
    archiveSupport,
    assertFeatures,
    locate,
  } = {
    ...defaultTools(),
    ...tools,
  };
  const gameRoot = requireGameRoot(input);
  const keys = await resolveKeys(input, archiveSupport, stateDir);
  const project = boundedProject(input.project);
  const directory = path.join(workRoot(stateDir), randomUUID());
  const payload = path.join(directory, "payload");
  const staging = path.join(directory, "base");
  await fs.mkdir(payload, { recursive: true });
  await fs.mkdir(staging, { recursive: true });
  /* Где у игрока лежат ядро, словари и файлы данных (`ptfx-entry-locator.js`). */
  const where = await locateEntries(locate, { gameRoot, keys });

  /*
   * База `bloodfx.dat`. Окно могло открыть чужой мод — тогда правки ложатся
   * поверх него. Текст берётся как есть и не пересобирается из разобранного
   * документа: разбор знает не про всякую конструкцию. Нет его в update.rpf —
   * база из common.rpf (её и читает игра), правка ляжет новой записью.
   */
  const suppliedBlood =
    typeof input.baseBloodfx === "string" ? input.baseBloodfx : "";
  if (Buffer.byteLength(suppliedBlood, "utf8") > MAX_SUPPLIED_BLOODFX_BYTES) {
    throw new RangeError("Принесённый bloodfx.dat превышает 768 КБ.");
  }
  const bloodAt = await dataReadEntry(where, BLOODFX_ENTRY);
  if (!bloodAt) throw missingEntry(BLOODFX_ENTRY);
  const bloodText =
    suppliedBlood ||
    (await fs.readFile(
      await extract(
        {
          native,
          gameRoot,
          entry: bloodAt.entry,
          output: path.join(staging, "bloodfx.dat"),
          keys,
        },
        context,
      ),
      "utf8",
    ));
  const bloodDocument = parseBloodFx(bloodText);
  logIrregularBloodRecords(bloodDocument);
  /*
   * База читается из игры, где прежняя версия этой работы уже стоит. Сначала
   * она снимается: по журналу прошлой установки, а чего журнал не знает
   * (его не вела первая версия мастерской) — лечением осиротевших записей.
   * Иначе зона, которую человек выключил, так и жила бы прошлым эффектом, а
   * после пересборки семейства клонов — вовсе без эффекта.
   */
  const revertedFields = revertBloodRouting(
    bloodDocument,
    boundedJournal(input.previousBlood),
  );
  const healedRecords = healOrphanedBloodRules(
    bloodDocument,
    IMPACT_CLONE_PREFIX,
  );
  /*
   * Ядро и чужие словари доноров — до сборки проекта: чужой словарь, которого
   * в игре нет, — отказ словами, а не после сорока секунд сборки ядер. Ядро —
   * штатное, иначе то, что читает игра (`coreReadEntry`).
   */
  const coreAt = coreReadEntry(where);
  if (!coreAt) throw missingEntry(coreEntry(CORE_ARCHIVES[0]));
  logRelocated("bloodfx.dat", bloodAt);
  logRelocated("Ядро эффектов", coreAt);
  const coreBase = await extract(
    {
      native,
      gameRoot,
      entry: coreAt.entry,
      output: path.join(staging, "core.ypt"),
      keys,
    },
    context,
  );
  const donorFiles = await donorFilePaths(
    {
      native,
      gameRoot,
      keys,
      staging,
      inspect,
      files: projectDonorFiles(project),
      where,
    },
    context,
  );
  let available = null;
  const coreTextureMap = async () => {
    available ||= new Map(
      coreTextures(await fs.readFile(coreBase)).map((texture) => [
        texture.name.toLowerCase(),
        texture,
      ]),
    );
    return available;
  };
  const pictures = await glyphPictures(
    project,
    await zonePictures(input, project),
  );
  const compiled = compileProject({ project, bloodDocument, pictures });

  /*
   * Слоты Astral: те, что уже в ядре, берутся как есть; недостающие помощник
   * построит из штатных доноров того же ядра. Отказ — только если слот не
   * построить, и тогда до записи в игру, с объяснением.
   */
  const slots = requiredCoreSlots(compiled);
  const inspection = await inspect({ input: coreBase, gameRoot });
  const slotPlan = planCoreSlots(inspection, slots);

  /*
   * Файлы оружия: привязки этой установки и стволы прошлой, которым надо
   * вернуть штатное (журнал `previousTracers`). Читаются и считаются до
   * сборки ядер: ствола может не оказаться (файл заменён модом оружия), и
   * узнать об этом надо до сорока секунд работы, а не после.
   *
   * Без привязок и журнала файлы читаются, только если в ядре есть слоты
   * следа: значит, трассеры сюда уже ставили, и ствол мог остаться со слотом
   * от версии, которая журнала не вела. Ядро без слотов таких стволов не
   * знает — и читать оружие ради огня незачем.
   */
  const previousTracers = boundedTracerJournal(input.previousTracers);
  const muzzles = compiled.muzzles || [];
  const smokes = compiled.smokes || [];
  const muzzleLooks = compiled.muzzleLooks || [];
  /* «Без вспышки и дыма» (задача 6 ТЗ 17.10.2026): та же вспышка и тот же
     дым файла оружия, только пустые — клонов нет, журнал тот же. */
  const quiet = new Set(compiled.quiet || []);
  const weaponPlans = planTracerWeaponFiles({
    bindings: compiled.weaponBindings,
    flashes: [...muzzles.map((item) => item.weapon), ...quiet],
    smokes: [...smokes.map((item) => item.weapon), ...quiet],
    looks: muzzleLooks.map((item) => item.weapon),
    previous: previousTracers,
  });
  const tracerSlotsInCore = (inspection.resource?.effectRules || []).some(
    (name) => /^astral_tracer_\d{3}$/i.test(String(name || "")),
  );
  /* Клоны вспышек и дыма в ядре — значит, стволы могли остаться с ними. */
  const muzzlesInCore = (inspection.resource?.effectRules || []).some(
    (name) => isAstralMuzzle(name) || isAstralSmoke(name),
  );
  const weaponRead =
    tracerSlotsInCore ||
    muzzlesInCore ||
    weaponPlans.some(
      (plan) =>
        plan.bindings.length ||
        plan.restores.length ||
        plan.flashes.length ||
        plan.flashRestores.length ||
        plan.smokes.length ||
        plan.smokeRestores.length ||
        plan.looks.length ||
        plan.lookRestores.length,
    )
      ? await readWeaponFiles(
          {
            plans: weaponPlans,
            previous: previousTracers,
            gameRoot,
            staging,
          },
          { searchArchive, extractMany },
        )
      : [];
  /*
   * Вспышки выстрела: донор — штатный `<FlashFx>` ствола (запись журнала,
   * нынешнее значение или донор из имени нашего клона), клон — копия его
   * целиком с цветом, числом и скоростью частиц. Ствол без вспышки не
   * получает ничего — об этом в замечаниях.
   */
  const muzzleByWeapon = new Map(muzzles.map((item) => [item.weapon, item]));
  const muzzleClones = [];
  const muzzleWarnings = [];
  const flashRules = new Map();
  for (const item of weaponRead)
    for (const [weapon, donor] of item.donors) {
      /* Без вспышки: пустой `<FlashFx>`, донор — в журнал как исходная. */
      if (quiet.has(weapon)) {
        flashRules.set(weapon, "");
        continue;
      }
      if (!donor) {
        muzzleWarnings.push({
          kind: "muzzle",
          message: `У ${weapon} в игре нет своей вспышки у дула — копировать нечего, вспышка не ставится.`,
        });
        continue;
      }
      /* Форма — копия другой вспышки ядра; в имени — штатная ствола, к
         которой вернёт снятие. */
      const muzzle = muzzleByWeapon.get(weapon);
      const effect = muzzleRuleFor(weapon, donor, muzzle.shape || "");
      muzzleClones.push({
        effect,
        layers: [
          { donorEffect: muzzle.shapeRule || donor, tune: muzzle.tune },
        ],
      });
      flashRules.set(weapon, effect);
    }
  /*
   * Дым из ствола: донор — штатный `<MuzzleSmokeFx>` ствола; у ствола без
   * своего дыма копия снимается с общего `muz_smoking_barrel`, а журнал
   * помнит, что дыма не было. Поля дыма у ствола нет вовсе — сказать.
   */
  const smokeByWeapon = new Map(smokes.map((item) => [item.weapon, item]));
  const smokeRules = new Map();
  for (const item of weaponRead)
    for (const [weapon, { original, present }] of item.smokeDonors) {
      /* Без дыма: пустой `<MuzzleSmokeFx>`; поля нет — выключать нечего. */
      if (quiet.has(weapon)) {
        if (present) smokeRules.set(weapon, "");
        continue;
      }
      if (!present) {
        muzzleWarnings.push({
          kind: "muzzle",
          message: `У ${weapon} в файле оружия нет поля дыма из ствола — дым не ставится.`,
        });
        continue;
      }
      const donor = original || DEFAULT_SMOKE_DONOR;
      const effect = smokeRuleFor(weapon, donor);
      muzzleClones.push({
        effect,
        layers: [{ donorEffect: donor, tune: smokeByWeapon.get(weapon).tune }],
      });
      smokeRules.set(weapon, effect);
    }
  /* Гильзы от первого лица — пара «_fp» выбранного правила, если она есть
     в ядре игрока (`eject_shotgun_fp`), иначе то же правило. */
  const coreRules = new Set(
    (inspection.resource?.effectRules || []).map((name) =>
      String(name || "").toLowerCase(),
    ),
  );
  const lookSpecs = new Map(
    muzzleLooks.map((item) => [
      item.weapon,
      item.look.shell === null || item.look.shell === undefined
        ? item.look
        : {
            ...item.look,
            shellFP: !item.look.shell
              ? ""
              : coreRules.has(`${item.look.shell}_fp`)
                ? `${item.look.shell}_fp`
                : item.look.shell,
          },
    ]),
  );
  const weaponWork = settleWeaponFiles(
    weaponRead,
    previousTracers,
    flashRules,
    smokeRules,
    lookSpecs,
    coreRules,
  );
  /* Поля вида, которых у ствола в файле нет: размер, свет или гильзы этого
     ствола не меняются — сказать, а не молчать. */
  for (const item of weaponWork)
    for (const { weapon, field } of item.change.lookMissing || [])
      muzzleWarnings.push({
        kind: "muzzle",
        message: `У ${weapon} в файле оружия нет поля ${field} — эта часть выстрела не меняется.`,
      });
  /*
   * Какие клоны вспышек снять перед сборкой: те, на которые смотрели
   * прочитанные стволы (их файл сейчас переводится на новый клон или на
   * штатную), и те, что строятся заново. Клоны, о которых эта установка
   * не знает, не трогаются: на них может смотреть непрочитанный файл.
   */
  const muzzleReset = [
    ...new Set([
      ...muzzleClones.map((item) => item.effect),
      ...weaponWork.flatMap((item) =>
        [...item.current.values()]
          .flatMap((binding) => [binding.flashFx, binding.smokeFx])
          .filter((rule) => isAstralMuzzle(rule) || isAstralSmoke(rule))
          .map((rule) => rule.toLowerCase()),
      ),
    ]),
  ].sort();
  const weaponPatches = weaponWork.filter((item) => item.change.patch.length);
  const clearsTracer = weaponPatches.some((item) =>
    item.change.patch.some((binding) => binding.tracerFx === ""),
  );
  /* Вспышка и «след не трогать» — новое у помощника: прежний молча не
     тронул бы `<FlashFx>`, а привязку без следа прочёл бы как «без следа». */
  const touchesFlash = weaponPatches.some((item) =>
    item.change.patch.some(
      (binding) => binding.flashFx != null || binding.tracerFx == null,
    ),
  );
  /*
   * Слои и дальность помощник RPF умеет не всякий: он обновляется порознь с
   * приложением. Спросить надо здесь, до сорока секунд сборки трёх ядер, —
   * иначе составной клон молча собрался бы одним слоем.
   */
  /* Свет, размер, дым и гильзы — поле `look` привязки: прежний помощник
     такого поля не знает. */
  const touchesLook = weaponPatches.some((item) =>
    item.change.patch.some((binding) => binding.look),
  );
  await assertFeatures([
    ...compiled.helperFeatures,
    ...(weaponPatches.length ? ["weapons-meta-tracer-batch"] : []),
    ...(clearsTracer ? ["weapons-meta-tracer-clear"] : []),
    ...(touchesFlash ? ["weapons-meta-flash"] : []),
    ...(touchesLook ? ["weapons-meta-muzzle-look"] : []),
  ]);
  /*
   * Клоны эффектов попадания строятся из штатных правил ядра игрока: нет
   * донора — нет эффекта, и сказать это надо до сборки трёх ядер.
   */
  const missingDonors = missingCloneDonors(inspection, [
    ...new Set([
      ...compiled.requiredDonors,
      ...muzzleClones.map((item) => item.layers[0].donorEffect),
    ]),
  ]);
  if (missingDonors.length) throw new Error(cloneDonorMessage(missingDonors));
  /* Гильзы — правило выброса из того же ядра: нет его — ствол остался бы
     без гильз молча. */
  const missingShells = missingCloneDonors(inspection, [
    ...new Set(muzzleLooks.map((item) => item.look.shell).filter(Boolean)),
  ]);
  if (missingShells.length)
    throw new Error(
      `В ядре эффектов вашей игры нет гильз ${missingShells.join(", ")} — выберите другие гильзы или верните штатный update.rpf.`,
    );
  /*
   * Семейство клонов пересобирается целиком. Если в ядре лежат прежние клоны
   * (или слоты попаданий первой версии мастерской), ядро правится, даже когда
   * новому проекту эффекты попадания не нужны: иначе они остались бы в игре.
   */
  const staleFamily = [
    ...(inspection.resource?.effectRules || []),
    ...(inspection.resource?.textures || []).map((item) => item?.name),
  ].some((name) =>
    String(name || "")
      .toLowerCase()
      .startsWith(IMPACT_CLONE_PREFIX),
  );
  const warnings = [...compiled.warnings, ...muzzleWarnings];

  const textureFiles = [];
  /* Плитки семейства, которых в ядре игрока не оказалось: уходят в отчёт. */
  let skippedEnvironment = [];
  for (const texture of compiled.textures) {
    const { dds } = texture;
    const file = path.join(staging, `${texture.texture}.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    textureFiles.push({
      texture: texture.texture,
      source: file,
      sha256: sha256(dds),
    });
  }
  /* Листы брызг рисует приложение: SVG растрируется и кодируется здесь — в
     окне того же листа не нужно, а sharp есть только тут. */
  for (const sheet of compiled.sheetTextures) {
    const dds = await renderSheetTexture(sheet);
    const file = path.join(staging, `${sheet.texture}.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    textureFiles.push({
      texture: sheet.texture,
      source: file,
      sha256: sha256(dds),
    });
  }

  /*
   * Текстуры-копии: собираются из ядра самого игрока, а не приносятся —
   * нейтральный лист кровяной пыли повторяет кадры его же листа, каким бы тот
   * ни был (штатный или из редукса). Лист, который не разобрать или который
   * редукс заменил пустышкой, не копируется: клон крови остаётся на листе
   * игрока, и об этом сказано в замечаниях.
   */
  const skippedCopies = new Set();
  for (const copy of compiled.coreCopies) {
    const texture = (await coreTextureMap()).get(copy.source.toLowerCase());
    const tiny = texture && Math.max(texture.width, texture.height) <= 8;
    if (!texture?.decodable || !texture.payload || tiny) {
      skippedCopies.add(copy.texture);
      warnings.push({
        kind: "blood-sheet",
        message: tiny
          ? `Лист кровяной пыли ${copy.source} в вашем ядре заменён пустышкой (так делают FPS-редуксы): брызги будут без пыли.`
          : `Лист кровяной пыли ${copy.source} в вашем ядре не разбирается: пыль останется красноватой, остальные брызги примут выбранный цвет.`,
      });
      continue;
    }
    const dds = await encodeDdsPooled({
      width: texture.width,
      height: texture.height,
      format: texture.format,
      mipLevels: safeMipLevels(texture.width, texture.height, texture.levels),
      rgba: neutralCopy(decodeCoreTexture(texture)),
    });
    const file = path.join(staging, `${copy.texture}.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    textureFiles.push({
      texture: copy.texture,
      source: file,
      sha256: sha256(dds),
    });
  }
  /*
   * Рецепты клонов — без служебных полей плана и без несостоявшихся копий.
   * Слой, у которого не собралась копия штатного листа, остаётся на листе
   * игрока: подмены у него просто нет, а сам слой играет.
   */
  const impactClones = compiled.clones.map(({ effect, layers, lod }) => ({
    effect,
    layers: layers.map(
      ({ donorEffect, donorFile, keepParticles, textures, tune }) => ({
        donorEffect,
        /* Донор из чужого словаря — путём к файлу, который достали выше. */
        ...(donorFile ? { donorFile: donorFiles.get(donorFile) } : {}),
        keepParticles,
        textures: (textures || []).filter(
          (item) => !skippedCopies.has(item.texture),
        ),
        tune,
      }),
    ),
    ...(lod ? { lod } : {}),
  }));
  /* Клоны вспышек — тем же проходом; предел помощника общий. */
  const effectClones = [...impactClones, ...muzzleClones];
  if (effectClones.length > EFFECT_CLONE_LIMIT)
    throw new Error(
      `Своих эффектов попадания и вспышек вместе больше ${EFFECT_CLONE_LIMIT}: столько помощник за одну установку не соберёт. Уберите часть вспышек.`,
    );

  const clipSheets = [
    ...slotSheets(slots),
    ...compiled.sheets.filter((sheet) => !skippedCopies.has(sheet.texture)),
  ];
  /* Строки прежних клонов снимаются вместе с самими клонами. */
  const clipReset =
    impactClones.length || staleFamily ? [IMPACT_CLONE_PREFIX] : [];
  /* Таблица — из update.rpf, иначе из common.rpf (правка — новой записью). */
  const clipAt =
    clipSheets.length || clipReset.length
      ? await dataReadEntry(where, PTX_CLIP_REGIONS_ENTRY)
      : null;
  const clipTable =
    clipSheets.length || clipReset.length
      ? await readClipTable(
          { native, gameRoot, keys, staging, found: clipAt },
          context,
        )
      : null;

  /*
   * Окружение: штатные листы ядра игрока перекрашиваются той же функцией,
   * что рисовала превью в окне, и кодируются в тот же формат с тем же
   * числом mip — патч текстуры сверяет раскладку побайтно и иное отвергнет.
   */
  const originals = await openGameOriginals(stateDir, gameRoot);
  /* Листы, которые Astral красил раньше, а этот проект не трогает: если в игре
     до сих пор лежит наша правка, в ядро возвращается штатный лист. */
  const restoredEnvironment = [];
  const wantedSheets = new Set(
    compiled.environment.map((item) => item.texture.toLowerCase()),
  );
  for (const name of originals.known()) {
    if (wantedSheets.has(name)) continue;
    const texture = (await coreTextureMap()).get(name);
    const base = texture ? await originals.baseFor(texture) : null;
    originals.release(name);
    if (!base?.ours) continue;
    const dds = Buffer.concat([
      writeDdsHeader({
        width: texture.width,
        height: texture.height,
        mipLevels: texture.levels,
        format: texture.format,
      }),
      base.payload,
    ]);
    const file = path.join(staging, `${texture.name}.original.dds`);
    await fs.writeFile(file, dds, { flag: "wx" });
    textureFiles.push({
      texture: texture.name,
      source: file,
      sha256: sha256(dds),
    });
    restoredEnvironment.push(texture.name);
  }

  if (compiled.environment.length) {
    const coreSheets = await coreTextureMap();
    /*
     * Чужое ядро может не нести всех плиток семейства: редуксы вырезают
     * из `core.ypt` то, чем не пользуются. Отказывать из-за одной пропавшей
     * плитки значило бы не дать перекрасить огонь вовсе, поэтому пропавшая
     * пропускается, а семейство без единой плитки — это уже отказ: красить
     * нечего, и молчать об этом нельзя.
     */
    const missing = [];
    const painted = new Set();
    for (const item of compiled.environment) {
      const texture = coreSheets.get(item.texture.toLowerCase());
      if (!texture) {
        missing.push(item.texture);
        continue;
      }
      painted.add(item.family);
      /* Красится штатный лист, а не то, что лежит в игре после прошлой
         установки: иначе оттенок копился бы от раза к разу. */
      const base = await originals.baseFor(texture);
      const tinted = applyFamilyTint(
        decodeCoreTexture({ ...texture, payload: base.payload }),
        item.settings,
        {
          format: texture.format,
        },
      );
      const dds = await encodeDdsPooled({
        width: texture.width,
        height: texture.height,
        format: texture.format,
        mipLevels: texture.levels,
        rgba: tinted,
      });
      originals.stage(texture, base.payload, dds.subarray(DDS_PAYLOAD_OFFSET), item.settings);
      const file = path.join(staging, `${item.texture}.dds`);
      await fs.writeFile(file, dds, { flag: "wx" });
      textureFiles.push({
        texture: item.texture,
        source: file,
        sha256: sha256(dds),
      });
    }
    const empty = [
      ...new Set(compiled.environment.map((item) => item.family)),
    ].filter((family) => !painted.has(family));
    if (empty.length)
      throw new Error(
        `В ядре игрока нет ни одной текстуры: ${empty.join(", ")}.`,
      );
    skippedEnvironment = missing;
  }

  const files = [];
  /*
   * Ядро правится по одному разу на каждый вариант архива, а не копируется
   * из первого: normal, hi и lo — разные файлы, и подмена одного другим тихо
   * меняет качество эффектов. Слоты и клоны строятся в каждом варианте
   * отдельно из его же доноров, тем же проходом, что текстуры и размер следа.
   * Проект, которому в ядре делать нечего (одни зоны «без эффекта» на чистом
   * ядре), ядро не трогает вовсе.
   *
   * Куда писать — `coreWriteEntries`: штатное место варианта, а если ядро
   * сборка вынесла в свой архив, подключённый в content.xml, — туда, откуда
   * его читает игра (одна копия на несколько вариантов — один раз). Места,
   * которое читает игра, нет — отказ словами до сборки.
   */
  const touchesCore =
    textureFiles.length > 0 ||
    effectClones.length > 0 ||
    compiled.tracerRules.length > 0 ||
    slotPlan.reservations.length > 0 ||
    muzzleReset.length > 0 ||
    staleFamily;
  let importedTextures = null;
  for (const target of touchesCore ? coreWriteEntries(where) : []) {
    const { archive } = target;
    /* В отчётах — где лежит ядро: вариант или чужой архив. */
    const label =
      target.how === "relocated"
        ? target.entry.replace(/^update:\//, "")
        : archive;
    const base =
      target.entry === coreAt.entry
        ? coreBase
        : await extract(
            {
              native,
              gameRoot,
              entry: target.entry,
              output: path.join(staging, `${archive}.ypt`),
              keys,
            },
            context,
          );
    const file = `core-${archive.replace(/\./g, "-")}.ypt`;
    let report;
    try {
      report = await patchTextures({
        input: base,
        output: path.join(payload, file),
        gameRoot,
        patches: textureFiles,
        /* Толщина и длина следа — в правиле слота, тем же патчем. */
        rules: compiled.tracerRules,
        ...(slotPlan.reservations.length
          ? { slotReservations: slotPlan.reservations }
          : {}),
        effectClones,
        effectCloneReset: [IMPACT_CLONE_PREFIX, ...muzzleReset],
      });
    } catch (error) {
      throw coreArchiveError(label, slotPlan.reservations, error);
    }
    logForeignNameHashes(label, report);
    logGraphRemarks(label, report);
    const verification = confirmedReservations(
      label,
      slotPlan.reservations,
      report,
    );
    const cloned = confirmedClones(label, effectClones, report);
    /* Текстуры чужого словаря обязаны переехать одинаково во все три ядра:
       строка кадров в таблице одна на имя. */
    const importedHere = new Map(
      (cloned || [])
        .flatMap((clone) => clone.imported)
        .map((item) => [item.texture.toLowerCase(), item]),
    );
    if (importedTextures === null) importedTextures = importedHere;
    else if (
      importedHere.size !== importedTextures.size ||
      [...importedHere.keys()].some((key) => !importedTextures.has(key))
    )
      throw new Error(
        `Ядро ${label} перенесло из чужого словаря не те текстуры, что ${CORE_ARCHIVES[0]}: варианты ядра расходятся.`,
      );
    files.push({
      file,
      target: target.entry,
      role: "core",
      ...(verification ? { slots: verification } : {}),
      ...(cloned ? { clones: cloned } : {}),
    });
  }

  /* Таблица кадров: свои листы, слоты и строки переехавших текстур — те же,
     что у их исходных листов. */
  const clipRegions =
    clipTable === null
      ? null
      : upsertClipRegions(
          clipTable,
          [
            ...clipSheets,
            ...[...(importedTextures || new Map()).values()].map((item) => ({
              texture: item.texture,
              copyFrom: item.source,
            })),
          ],
          { reset: clipReset },
        );

  /*
   * Патч обязан нести таблицу целиком, даже когда в игре строки наших листов
   * уже стоят (их положила прежняя версия этой же работы): «Применить» второй
   * раз видит `changed: false` и без этого оставил бы таблицу вне патча. Но
   * прежнюю версию замена снимает перемоткой архива и возвращает новую её
   * же патчем — а в нём таблицы нет, и лист кровяной пыли (7×7 кадров) без
   * строки рисуется в игре целиком одной картинкой (19.10.2026).
   */
  const carriesSheets =
    clipSheets.length > 0 || (importedTextures && importedTextures.size > 0);
  if (clipRegions && (clipRegions.changed || carriesSheets)) {
    await fs.writeFile(
      path.join(payload, "ptxclipregions.dat"),
      clipRegions.text,
      {
        encoding: "latin1",
        flag: "wx",
      },
    );
    files.push({
      file: "ptxclipregions.dat",
      target: PTX_CLIP_REGIONS_ENTRY,
      /* База из common.rpf: в update.rpf таблицы нет — добавляется. */
      ...(clipAt?.how === "common" ? { action: "Import" } : {}),
      role: "clip-regions",
      added: clipRegions.added.length,
      replaced: clipRegions.replaced.length,
    });
  }

  /*
   * bloodfx.dat уходит в игру, если итог отличается от того, что в ней лежит:
   * это и новая правка, и снятая прежняя (человек выключил попадания, оставив
   * след пули, — кровь обязана вернуться штатной). Работа с кровью уходит
   * файлом и тогда, когда в игре он уже такой: патч должен нести его сам, а
   * не рассчитывать на прежнюю версию — её замена снимает перемоткой архива
   * и ставит новую одним её патчем (см. таблицу кадров выше).
   */
  const bloodReport = compiled.blood
    ? applyBloodRouting(bloodDocument, compiled.blood)
    : null;
  const bloodResult = serializeBloodFx(bloodDocument);
  if (bloodResult !== bloodText || compiled.blood) {
    await fs.writeFile(path.join(payload, "bloodfx.dat"), bloodResult, {
      encoding: "utf8",
      flag: "wx",
    });
    files.push({
      file: "bloodfx.dat",
      target: BLOODFX_ENTRY,
      /* База из common.rpf: в update.rpf файла нет — добавляется туда, где
         игра ищет его первым. Замена отсутствующей записи молча ничего не
         сделала бы (`RpfInjectEngine.ApplyLeafInPlace`). */
      ...(bloodAt.how === "common" ? { action: "Import" } : {}),
      role: "blood",
      routes: bloodReport?.routes.length || 0,
      effects: bloodReport?.effects.length || 0,
      reverted: revertedFields,
      healed: healedRecords.length,
    });
  }
  /*
   * Оружие: по файлу на источник — `weapons.meta` у базовых стволов и файлы
   * пакетов через `update.rpf/dlc_patch/<пакет>/…` у стволов дополнений
   * (`tracer-weapons.js`). В каждом файле — привязки этой установки, возврат
   * стволов, выпавших из набора (по журналу), и лечение стволов, которые
   * прежняя версия связала со слотом без журнала. Журнал этой установки —
   * что было у привязанных стволов до Astral — уходит в запись установки.
   */
  const tracerJournal = weaponWork
    .filter((item) => item.change.journal.length)
    .map((item) => ({
      target: item.plan.target,
      weapons: item.change.journal,
    }));
  const restoredWeapons = weaponPatches.flatMap((item) => item.change.restored);
  if (weaponPatches.length) {
    await patchWeaponFiles({
      gameRoot,
      files: weaponPatches.map((item) => ({
        input: item.input,
        output: path.join(payload, item.plan.file),
        bindings: item.change.patch,
      })),
    });
    for (const item of weaponPatches)
      files.push({
        file: item.plan.file,
        target: item.plan.target,
        role: "weapons",
        /* Файла в update.rpf не было — он добавляется, а не заменяется. */
        action: item.imported ? "Import" : "Replace",
        weapons: item.plan.bindings.length,
        flashes: item.plan.flashes.length,
        restored: item.change.restored.length,
      });
  }

  if (!files.length) {
    throw new Error(
      "В игре уже стоит ровно этот набор эффектов — менять нечего.",
    );
  }

  const actions = [];
  for (const file of files) {
    const bytes = await fs.readFile(path.join(payload, file.file));
    file.size = bytes.length;
    file.sha256 = sha256(bytes);
    actions.push({
      Type: file.action || "Replace",
      TargetPath: file.target,
      SourcePath: `payload/${file.file}`,
      Size: file.size,
      Sha256: file.sha256,
      IsWholeReplaceNestedRpf: false,
    });
  }
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(
      {
        ReduxName: `Astral effects — ${project.name}`,
        ParsedAt: new Date().toISOString(),
        TotalPatchSize: files.reduce((total, file) => total + file.size, 0),
        Actions: actions,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  await fs.rm(staging, { recursive: true, force: true }).catch(() => {});

  const generated = {
    patch: directory,
    gameRoot,
    files,
    warnings,
    assignments: compiled.assignments,
    /*
     * Журнал правки bloodfx.dat: что и поверх чего записано. Окно хранит его
     * в записи установки и приносит следующей установке (`previousBlood`) —
     * по нему прежняя правка снимается перед новой.
     */
    bloodJournal: bloodReport
      ? { routes: bloodReport.routes, effects: bloodReport.effects }
      : null,
    /*
     * Журнал оружия: что было у привязанных стволов до Astral. Окно хранит
     * его в записи установки и приносит следующей (`previousTracers`): по
     * нему выпавшие из набора стволы получают свой след обратно.
     */
    tracerJournal: tracerJournal.length ? { files: tracerJournal } : null,
    /* Трассеры набора: какой слот, каким цветом и на каких стволах. */
    tracers: compiled.assignments.tracers.map((item) => ({
      profile: item.profile,
      rule: item.rule,
      weapons: item.weapons,
    })),
    /* Стволы, которым установка вернула их штатный след. */
    restoredWeapons,
    /* Вспышки выстрела: ствол, клон и штатная вспышка, с которой он снят;
       и стволы, которым вернулась их штатная вспышка. */
    muzzles: [...flashRules]
      .filter(([, rule]) => rule)
      .map(([weapon, rule]) => ({
        weapon,
        rule,
        donor: muzzleClones.find((item) => item.effect === rule)?.layers[0]
          .donorEffect,
      })),
    /* Стволы без вспышки и дыма: пустые поля в их файлах оружия. */
    quiet: [...flashRules].filter(([, rule]) => !rule).map(([weapon]) => weapon),
    restoredFlashes: weaponPatches.flatMap((item) => item.change.flashRestored),
    /* Дым из ствола: ствол, клон и донор; и стволы, которым вернулся их дым. */
    smokes: [...smokeRules]
      .filter(([, rule]) => rule)
      .map(([weapon, rule]) => ({
        weapon,
        rule,
        donor: muzzleClones.find((item) => item.effect === rule)?.layers[0]
          .donorEffect,
      })),
    restoredSmokes: weaponPatches.flatMap(
      (item) => item.change.smokeRestored || [],
    ),
    /* Вид выстрела в файлах оружия: ствол и поля, что ушли помощнику. */
    muzzleLooks: weaponPatches.flatMap((item) =>
      item.change.patch
        .filter((binding) => binding.look)
        .map((binding) => ({
          weapon: binding.weapon,
          fields: Object.keys(binding.look),
        })),
    ),
    restoredLooks: weaponPatches.flatMap(
      (item) => item.change.lookRestored || [],
    ),
    /* Клоны правил эффектов попадания: что из чего собрано, с какой стороны
       и какие текстуры чужого словаря переехали в ядро. */
    impactClones: compiled.clones.map(
      ({ effect, zone, placement, layers, lod }) => ({
        rule: effect,
        zone,
        placement,
        donor: layers[0]?.donorEffect ?? null,
        donors: layers.map((layer) => layer.donorEffect),
        donorFiles: [
          ...new Set(layers.map((layer) => layer.donorFile).filter(Boolean)),
        ],
        layers: layers.length,
        ...(lod ? { lod } : {}),
      }),
    ),
    importedTextures: [...(importedTextures || new Map()).values()],
    environment: compiled.environment
      .filter(({ texture }) => !skippedEnvironment.includes(texture))
      .map(({ family, texture }) => ({ family, texture })),
    /* Плитки, которых в ядре игрока не нашлось: их не покрасили, и план
       обязан это назвать, а не сделать вид, что перекрасил всё. */
    environmentMissing: skippedEnvironment,
    /* Листы выключенных семейств, возвращённые штатными. */
    environmentRestored: restoredEnvironment,
    tracerSlots: ASTRAL_TRACER_SLOTS.length,
    /* Какие слоты уже лежали в ядре, а какие установка строит из доноров. */
    coreSlots: {
      present: slotPlan.present.map((slot) => slot.rule),
      derived: slotPlan.reservations.map((item) => ({
        rule: item.effect,
        texture: item.texture,
        donor: item.donorEffect,
      })),
    },
    clipRegions: clipRegions
      ? {
          changed: clipRegions.changed,
          added: clipRegions.added,
          replaced: clipRegions.replaced,
          removed: clipRegions.removed,
        }
      : null,
    coreVersion: compiled.coreVersion,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
  /* Хранилище оригиналов меняется только после удавшейся установки: план и
     проверка патча его не трогают. */
  return { generated, commitOriginals: () => originals.commit() };
}

export async function planPtfxCustomization(
  input,
  context,
  stateDir,
  tools = {},
) {
  const { native } = { ...defaultTools(), ...tools };
  const { generated } = await materialize(input, context, stateDir, tools);
  const validation = await native(
    "validate-rpf-patch",
    { patch: generated.patch },
    context,
  );
  return {
    ...generated,
    validation,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
    archive: "update/update.rpf",
  };
}

export async function applyPtfxCustomization(
  input,
  context,
  stateDir,
  { assertRuntimeSafety, ...tools } = {},
) {
  const { native, archiveSupport } = { ...defaultTools(), ...tools };
  const { generated, commitOriginals } = await materialize(
    input,
    context,
    stateDir,
    tools,
  );
  await assertRuntimeSafety?.(generated.gameRoot);
  const support = await archiveSupport({ stateDir });
  const installed = await native(
    "install-rpf-patch",
    {
      patch: generated.patch,
      gameRoot: generated.gameRoot,
      archiveFix: path.join(support.directory, "ArchiveFix.exe"),
      keys: support.directory,
    },
    context,
  );
  /* Игра уже переписана: память об оригиналах — забота о следующей установке,
     и её сбой не должен превращать удавшуюся установку в ошибку. */
  await commitOriginals().catch(() => {});
  return {
    ...installed,
    ...generated,
    platform: "Majestic / GTA5RP",
    edition: "Legacy",
  };
}
