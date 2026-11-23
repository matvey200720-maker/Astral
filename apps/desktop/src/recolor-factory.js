/*
 * Завод в файлах: облик корпусов, земли, контейнеров и реквизита, эмблема
 * своей плашкой и дальняя прорисовка.
 *
 * У мода все листы — плашки 4×4 одного серого: в них ложится только ровный
 * цвет (свой цвет, радуга, разноцветные контейнеры — `factoryFilePatches`).
 * Узору, картинке и градиенту нужно разрешение, поэтому лист с отделкой
 * едет штатным файлом игры игрока (адреса — `FACTORY_VANILLA` описи), а в
 * его листы цвета пишется отделка на месте (`finish-bake.js`): нормали,
 * блики и детализация штатные. Палитры тинта таких групп — белые: цвет несёт
 * лист. Файл, где все листы «Стандарт», в пакет не едет вовсе, и игра берёт
 * свои файлы.
 *
 * Корпус — одной семьёй файлов (исправление 03.10.2026, «здание не
 * красится»). Почему здание оставалось серым при покрашенных контейнерах и
 * земле:
 *   1. Поверх стен лежит модель-наложение `cs4_13_build_03_g`: грязь и
 *      потёки (`im_wall_overlay03` — ~1450 м² стен при прозрачности вершин
 *      ~70 %), вывески, граффити. У мода это непрозрачные серые плашки 4×4,
 *      у игры — серая грязь. Установщик красил их цветом «деталей» или
 *      оставлял штатными — и серая корка закрывала покрашенные стены.
 *      Теперь грязь идёт за стенами и у покрашенного корпуса прозрачна
 *      (`factoryLayerLook`), вывески и граффити — штатные.
 *   2. Файлы корпуса решались поодиночке: модель могла ехать штатной, а её
 *      словарь высокой чёткости (`+hidr`) — листом мода 4×4. Вблизи (до
 *      ~50 м, где игра подменяет листы на `+hidr`) облик менялся. Теперь
 *      покрашенный корпус — целиком штатные файлы (модели, `+hidr`,
 *      словари `cs4_13_build3` и `cs4_13_rails`): ровный цвет заливкой с
 *      альфой листа, отделка — отделкой; нормали и блики — штатные, а не
 *      серые 4×4 мода.
 *   3. Каркас и фермы, которых нет в моде (`cs4_13_build_01_b` со своими
 *      листами), оставались ржавыми. Окружение места (опись `footprint`)
 *      едет вместе с корпусом.
 *
 * Дальняя прорисовка — общая система LOD мастерской (`recolor-lod.js`):
 * цепочки LOD → SLOD1 → SLOD2 → SLOD3 корпусов, земли, контейнеров и
 * реквизита из `resources/recolor-lod/factory.json`. Облик тексель за
 * текселем — ближайшей поверхности HD-моделей места; свой лист стен дальних
 * моделей (его делит с заводом мини-молл) — копией словаря.
 *
 * Эмблема — плашка с картинкой (`compile-emblem-plates` нативного хоста):
 * своя модель, свой архетип, своя карта и манифест в контейнере набора.
 *
 * Листы, которые правка не понимает (сжатие BC7 и прочее), остаются
 * штатными — сборка говорит, сколько таких.
 */

import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import {
  FACTORY_FINISH_MODES,
  FACTORY_INVENTORY,
  FACTORY_LABEL_COLOURS,
  FACTORY_LOD_GRAFFITI,
  FACTORY_OVERLAY_DECALS,
  FACTORY_PLATE,
  factoryPlateFiles,
  FACTORY_TEXTURES,
  FACTORY_VANILLA,
  factoryAreaFile,
  factoryBuildingsPainted,
  factoryContainerColour,
  factoryEmblemPlates,
  factoryFileGroup,
  factoryFilePatches,
  factoryGroupSettings,
  FACTORY_RUST_SHADE,
  factoryLayerLook,
  factoryLayerOf,
  factoryOverlayDecalHidden,
  factoryRustySheet,
  factoryTerrainModel,
  factoryTextureLook,
  factoryTextureSettings,
  hexBytes,
  normalizeFactoryProject,
} from "@modovik/climb-contract/recolor";
import { bakeSheetFinish, finishSource } from "./finish-bake.js";
import { buildAssetPlates } from "./recolor-emblem.js";
import { hideGrimeDecals } from "./recolor-grime.js";
import { buildLodFiles, createLookField, nearPlateTriangles } from "./recolor-lod.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";
import { inflateResource } from "@modovik/native-rs";

const inflateRaw = inflateResource;

/* Роль листа без описи мода: палитра, нормаль, блик — по имени, как у подготовки. */
function roleByName(name) {
  const text = String(name).toLowerCase();
  if (/_pal$/.test(text)) return "palette";
  if (/(_n|_nm|_nrm|_ndo|_normal)$/.test(text)) return "normal";
  if (/(_s|_sm|_spec|_spc)$/.test(text)) return "specular";
  if (/^nxg_.*_h$/.test(text)) return "height";
  if (/^env_/.test(text)) return "detail";
  return "diffuse";
}

function describe(file, name) {
  const lower = name.toLowerCase();
  return (
    FACTORY_TEXTURES.find((item) => item.file === file && item.name === lower) ||
    FACTORY_TEXTURES.find((item) => item.name === lower) || { name: lower, role: roleByName(lower) }
  );
}

function resourceRefs(bytes, fileName) {
  const resource = openResourceWith(bytes, inflateRaw);
  if (fileName.endsWith(".ytd")) return readTextureDictionary(resource);
  const seen = new Set();
  const kind = fileName.toLowerCase().split(".").pop();
  return readDrawable(resource, { inflateRaw, kind })
    .drawables.flatMap((drawable) => drawable.embeddedTextures || [])
    .filter((ref) => (seen.has(ref.dataAt) ? false : seen.add(ref.dataAt)));
}

const solid = (width, height, [r, g, b], alpha) => {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < out.length; at += 4) {
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    out[at + 3] = alpha;
  }
  return out;
};

/**
 * Штатный файл с обликом по листам: `lookOf(info, ref)` → `null` (лист как
 * в игре), `{ finish, source }` (отделка), `{ flat: [r, g, b], alpha? }`
 * (ровная заливка; без `alpha` — с альфой листа: перила и сетки остаются
 * сквозными), `{ transparent: true }` (лист не виден), `{ labels }`
 * (наклейки контейнеров) или `{ white: true }` (палитра).
 * `{ bytes, textures, skipped }`.
 */
export function bakeVanillaFile(bytes, fileName, lookOf) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const replacements = {};
  let skipped = 0;
  for (const ref of resourceRefs(raw, fileName)) {
    if (!ref.complete) continue;
    const info = describe(fileName, ref.name);
    const look = lookOf(info, ref);
    if (!look) continue;
    let rgba = null;
    try {
      if (look.white) rgba = solid(ref.width, ref.height, [255, 255, 255], 255);
      else if (look.transparent) rgba = solid(ref.width, ref.height, [0, 0, 0], 0);
      else if (look.flat && look.alpha != null) rgba = solid(ref.width, ref.height, look.flat, look.alpha);
      else if (look.flat) {
        const level = decodeTextureRef(ref, { level: 0 });
        rgba = new Uint8ClampedArray(level.rgba);
        for (let at = 0; at < rgba.length; at += 4) {
          rgba[at] = look.flat[0];
          rgba[at + 1] = look.flat[1];
          rgba[at + 2] = look.flat[2];
        }
      } else if (look.labels) {
        if (look.labels === "hidden") rgba = solid(ref.width, ref.height, [0, 0, 0], 0);
        else {
          const level = decodeTextureRef(ref, { level: 0 });
          rgba = new Uint8ClampedArray(level.rgba);
          const colour = hexBytes(FACTORY_LABEL_COLOURS[look.labels]);
          for (let at = 0; at < rgba.length; at += 4) rgba.set(colour, at);
        }
      } else if (look.finish) {
        const level = decodeTextureRef(ref, { level: 0 });
        rgba = bakeSheetFinish(level.rgba, level.width, level.height, look.finish, look.source, {
          shade: factoryRustySheet(ref.name) ? FACTORY_RUST_SHADE : 1,
        });
      }
      if (!rgba) continue;
      replacements[ref.name] = texturePayload(
        { name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes },
        rgba,
      );
    } catch {
      /* Формат, которого правка не пишет (BC7…), — лист остаётся штатным. */
      skipped += 1;
    }
  }
  if (!Object.keys(replacements).length) return { bytes: Buffer.from(raw), textures: [], skipped };
  const patched = patchResourceTextures(raw, fileName, replacements);
  return { bytes: Buffer.from(patched.bytes), textures: patched.patched, skipped };
}

/**
 * Штатный файл с отделкой одной группы: листы цвета — отделка, палитры —
 * белые, наклейки контейнеров — по их настройке. `{ bytes, textures, skipped }`.
 */
export function finishVanillaFile(bytes, fileName, settings, source, { labels = "hidden" } = {}) {
  return bakeVanillaFile(bytes, fileName, (info) => {
    if (info.role === "palette") return { white: true };
    if (info.role === "diffuse" && info.decal && info.group === "containers") return { labels };
    if (info.role === "diffuse" && !info.decal) return { finish: settings, source };
    return null;
  });
}

const VANILLA = new Set(["standard", ...FACTORY_FINISH_MODES]);

/*
 * Корпуса: чей облик у каждого листа цвета файла. Файл без листов цвета
 * (только нормали и блики) идёт за корпусом целиком: штатный, если хоть
 * одной части нужен штатный лист.
 */
function buildingSettings(project, fileName) {
  const colours = FACTORY_TEXTURES.filter((item) => item.file === fileName && item.role === "diffuse" && !item.decal);
  const list = colours.length
    ? colours.map((item) => factoryTextureSettings(project, "buildings", item.name))
    : [project.buildings, ...Object.values(project.parts).filter((part) => part.mode !== "buildings")];
  return {
    skip: list.every((settings) => settings.mode === "standard"),
    vanilla: list.some((settings) => VANILLA.has(settings.mode)),
  };
}

/**
 * Облик листа корпуса в штатном файле: часть корпуса по имени листа, слои
 * поверх стен — по своим правилам (`factoryLayerLook`), палитры — белые.
 * `sourceOf(settings)` — источник отделки.
 */
export function factoryBuildingLook(project, info, ref, sourceOf) {
  if (info.role === "palette") return { white: true };
  if (info.role !== "diffuse") return null;
  const name = ref.name.toLowerCase();
  const layer = factoryLayerLook(project, { name, group: "buildings" });
  if (layer === "standard") return null;
  if (layer === "hidden") return { transparent: true };
  if (layer === "mod") return { flat: hexBytes(info.mod || "#7b797b"), alpha: 255 };
  if (info.decal) return null;
  const settings = factoryTextureSettings(project, "buildings", name);
  if (settings.mode === "standard") return null;
  if (FACTORY_FINISH_MODES.includes(settings.mode)) return { finish: settings, source: sourceOf(settings) };
  const texture = FACTORY_TEXTURES.find((item) => item.name === name && item.group === "buildings") || {
    name,
    group: "buildings",
    role: "diffuse",
    alpha: 255,
    mod: "#7b797b",
  };
  const look = factoryTextureLook(project, texture);
  return { flat: hexBytes(look?.colour || texture.mod || "#7b797b") };
}

/* Файлы корпуса с листами граффити: при убранных граффити едут всегда. */
const GRAFFITI_FILES = new Set(FACTORY_TEXTURES.filter((item) => item.role === "diffuse" && factoryLayerOf(item.name) === "graffiti").map((item) => item.file));
const graffitiFile = (project, fileName) => project.graffiti === "hidden" && GRAFFITI_FILES.has(fileName);

/* Корпус целиком «Стандарт GTA» — штатные файлы игры, пакету нечего везти. */
function buildingsAllStandard(project) {
  return project.buildings.mode === "standard" && Object.values(project.parts).every((part) => ["buildings", "standard"].includes(part.mode));
}

/**
 * Файлы завода под работу. `resources` — файлы мода по имени; `game` —
 * чтение штатных файлов игры (`read(адрес)`), нужно «Стандарту», отделке,
 * покрашенному корпусу и дальней прорисовке; `images` — свои картинки
 * отделки; `lod` — опись дальней прорисовки (`resources/recolor-lod`).
 * `{ files, patches, skipped, lodReport }`.
 */
export async function buildFactoryFiles(input, resources, { game = null, images = new Map(), lod = null } = {}) {
  const project = normalizeFactoryProject(input);
  const flat = new Map(factoryFilePatches(project).map((patch) => [patch.file, patch]));
  const files = [];
  const patches = [];
  const sources = new Map();
  const sourceOf = (settings) => {
    const key = JSON.stringify([settings.mode, settings.pattern, settings.gradient, settings.image]);
    if (!sources.has(key)) sources.set(key, finishSource(settings, images));
    return sources.get(key);
  };
  const readVanilla = async (name, location = FACTORY_VANILLA[name]) => {
    if (!game || !location) throw new Error(`Для отделки нужен штатный файл ${name} из вашей GTA V — подключите игру.`);
    const vanilla = await game.read(location);
    if (!vanilla) throw new Error(`В вашей GTA V нет штатного файла ${name} — проверьте целостность игры.`);
    return vanilla;
  };
  /* Покрашенный корпус — целиком штатной семьёй файлов (см. шапку). */
  const vanillaFamily = Boolean(game) && factoryBuildingsPainted(project) && !buildingsAllStandard(project);
  const buildingLook = (info, ref) => factoryBuildingLook(project, info, ref, sourceOf);
  let skipped = 0;
  for (const { name } of FACTORY_INVENTORY.files) {
    /* Словарь дальних моделей района (кусты, деревья, камни) — не завод. */
    if (factoryAreaFile(name)) continue;
    const group = factoryFileGroup(name);
    if (group === "buildings") {
      const decision = buildingSettings(project, name);
      /* Убранные граффити едут и у «Стандарта»: файлу с ними — штатный с прозрачными листами. */
      if (decision.skip && !graffitiFile(project, name)) continue;
      if (vanillaFamily || decision.vanilla) {
        const done = bakeVanillaFile(await readVanilla(name), name, buildingLook);
        skipped += done.skipped;
        files.push({ name, bytes: done.bytes });
        patches.push({ file: name, textures: done.textures, vanilla: true });
        continue;
      }
    } else {
      const settings = group ? factoryGroupSettings(project, group) : null;
      if (settings?.mode === "standard") continue;
      if (settings && FACTORY_FINISH_MODES.includes(settings.mode)) {
        const done = finishVanillaFile(await readVanilla(name), name, settings, sourceOf(settings), { labels: project.containers.labels });
        skipped += done.skipped;
        files.push({ name, bytes: done.bytes });
        patches.push({ file: name, textures: done.textures, vanilla: true });
        continue;
      }
    }
    const source = resources.get(name);
    if (!source) throw new Error(`В наборе нет файла ${name}.`);
    const patch = flat.get(name);
    if (!patch) {
      files.push({ name, bytes: source });
      continue;
    }
    const { bytes } = patchResourceTextures(source, name, patch.textures);
    files.push({ name, bytes: Buffer.from(bytes) });
    patches.push(patch);
  }

  /* Окружение со своими листами (каркас, фермы) — вместе с корпусом. */
  if (vanillaFamily) {
    const shipped = new Set(files.map((file) => file.name));
    for (const item of FACTORY_INVENTORY.factory.footprint || []) {
      /* Рельеф вокруг (подсыпка, колея) — не завод: как в игре. */
      if (factoryTerrainModel(item.model)) continue;
      for (const location of [item.at, item.hidr].filter(Boolean)) {
        const name = location.split("/").pop().toLowerCase();
        if (shipped.has(name)) continue;
        const bytes = await game.read(location).catch(() => null);
        if (!bytes) continue;
        let done;
        try {
          done = bakeVanillaFile(new Uint8Array(bytes), name, buildingLook);
        } catch {
          continue;
        }
        if (!done.textures.length) continue;
        shipped.add(name);
        skipped += done.skipped;
        files.push({ name, bytes: done.bytes });
        patches.push({ file: name, textures: done.textures, vanilla: true, footprint: true });
      }
    }
  }

  /* Ржавые пояса силосов у покрашенного металла — прочь из модели-наложения
     (`FACTORY_OVERLAY_DECALS`): лист у них общий с трубами, и узор ложился
     поясами своей развёртки поверх бункеров. Треугольники сводятся в точку
     (`hideGrimeDecals`), лист труб остаётся общим. */
  for (const decal of FACTORY_OVERLAY_DECALS) {
    if (!factoryOverlayDecalHidden(project, decal.texture)) continue;
    const already = files.find((file) => file.name === decal.file);
    const base = already ? already.bytes : game && FACTORY_VANILLA[decal.file] ? await game.read(FACTORY_VANILLA[decal.file]).catch(() => null) : resources.get(decal.file);
    if (!base) continue;
    const cleaned = hideGrimeDecals(base, [decal.texture]);
    if (!cleaned.bytes) continue;
    if (already) already.bytes = cleaned.bytes;
    else files.push({ name: decal.file, bytes: cleaned.bytes });
    patches.push({ file: decal.file, overlays: [decal.texture], removed: cleaned.removed });
  }

  /* Дальний завод — общая система LOD. */
  let lodReport = null;
  if (game && lod) {
    const built = await buildFactoryLod(project, { game, resources, lod, images, sourceOf });
    lodReport = built.report;
    const shipped = new Set(files.map((file) => file.name));
    for (const file of built.files) {
      if (shipped.has(file.name)) continue;
      files.push(file);
      patches.push({ file: file.name, lod: true });
    }
  }
  return { files, patches, skipped, lodReport };
}

/* Средний цвет источника отделки — облик дальнего листа. */
function sourceColour(source) {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = source.rgba.length / 4;
  for (let at = 0; at < source.rgba.length; at += 4) {
    r += source.rgba[at];
    g += source.rgba[at + 1];
    b += source.rgba[at + 2];
  }
  return `#${[r, g, b].map((value) => Math.round(value / count).toString(16).padStart(2, "0")).join("")}`;
}

/*
 * Операция дальнего листа по листу HD: свой цвет и радуга — тон их цвета,
 * отделка — тон её среднего цвета (с сотни метров узор не различить), «как
 * в моде» — серый, «Стандарт» — не трогать. Контейнеры — цвет своей модели.
 */
function lodOpOf(project, group, textureName, model, sourceOf) {
  const name = String(textureName || "").toLowerCase();
  const own = project[group];
  if (!own) return null;
  if (group === "containers") {
    if (own.mode === "standard") return null;
    if (own.mode === "mod") return { kind: "grey" };
    if (FACTORY_FINISH_MODES.includes(own.mode)) return { kind: "tint", colour: sourceColour(sourceOf(own)) };
    return { kind: "tint", colour: factoryContainerColour(project, model) };
  }
  const settings = factoryTextureSettings(project, group, name);
  if (!settings || settings.mode === "standard") return null;
  if (settings.mode === "mod") return { kind: "grey" };
  if (FACTORY_FINISH_MODES.includes(settings.mode)) return { kind: "tint", colour: sourceColour(sourceOf(settings)) };
  const texture = FACTORY_TEXTURES.find((item) => item.name === name && item.group === group) || {
    name,
    group,
    role: "diffuse",
    alpha: 255,
    mod: "#7b797b",
  };
  const look = factoryTextureLook(project, texture);
  return look ? { kind: "tint", colour: look.colour } : { kind: "grey" };
}

/**
 * Дальний завод: поле облика — HD-модели места (корпуса, земля, контейнеры
 * и реквизит мода на своих местах, окружение — штатные модели из игры),
 * операции — по листам HD. `{ files, report }`.
 */
export async function buildFactoryLod(input, { game, resources, lod, images = new Map(), sourceOf = null }) {
  const project = normalizeFactoryProject(input);
  const finishOf =
    sourceOf ||
    ((settings) => finishSource(settings, images));
  const field = createLookField();
  const ops = [];
  const opIds = new Map();
  const opId = (op) => {
    if (!op) return -1;
    const key = JSON.stringify(op);
    if (!opIds.has(key)) {
      opIds.set(key, ops.length);
      ops.push(op);
    }
    return opIds.get(key);
  };
  /* Граффити убраны: стены «как в игре» тоже идут в поле — их дальний лист
     не красится (облик `null`), но место граффити на нём стирается. */
  const graffiti = project.graffiti === "hidden";
  let keep = -1;
  const keepId = () => {
    if (keep < 0) {
      keep = ops.length;
      ops.push(null);
    }
    return keep;
  };
  const lookOf = (group, model) => (mesh) => {
    const texture = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    if (!texture || mesh.material?.alphaMode === "blend" || /decal/.test(String(mesh.material?.shader || ""))) return null;
    const id = opId(lodOpOf(project, group, texture, model, finishOf));
    return id < 0 && graffiti && group === "buildings" ? keepId() : id;
  };
  const drawables = new Map();
  const drawableFrom = (name, bytes) => {
    if (!drawables.has(name)) {
      try {
        const kind = name.toLowerCase().split(".").pop();
        drawables.set(name, readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind }).drawables[0] || null);
      } catch {
        drawables.set(name, null);
      }
    }
    return drawables.get(name);
  };
  for (const placement of FACTORY_INVENTORY.factory.placements) {
    const name = [`${placement.model}.ydr`, `${placement.model}.yft`].find((file) => resources.has(file));
    if (!name) continue;
    const drawable = drawableFrom(name, resources.get(name));
    if (drawable) field.addDrawable(drawable, placement, lookOf(factoryFileGroup(name) || "props", placement.model));
  }
  for (const item of FACTORY_INVENTORY.factory.footprint || []) {
    /* Рельеф вокруг — не облик завода: вдали его листы не берут цвет корпуса. */
    if (!item.at || factoryTerrainModel(item.model)) continue;
    const bytes = await game.read(item.at).catch(() => null);
    const drawable = bytes ? drawableFrom(item.at, bytes) : null;
    if (drawable) field.addDrawable(drawable, item.placement, lookOf("buildings", item.model));
  }
  /* Граффити вдали — запечены в лист окон дальнего завода: чистится копия
     словаря места, которую видят одни модели завода. */
  const sheetEdits = graffiti ? [{ sheet: FACTORY_LOD_GRAFFITI.sheet, edit: (rgba, width, height) => cleanGraffitiBand(rgba, width, height, FACTORY_LOD_GRAFFITI) }] : [];
  /* Дальняя подсыпка (`cs4_13_land_01_ov1_lod`) — рельеф, как и вблизи: из
     цепочки места она уходит, иначе её листы брали облик земли двора рядом. */
  const chain = { ...lod, levels: lod.levels.filter((level) => !(level.children?.length && level.children.every(factoryTerrainModel))) };
  return buildLodFiles({ lod: chain, game, field, ops, reach: FACTORY_LOD_REACH, sheetEdits });
}

/*
 * Граффити на дальнем листе (`FACTORY_LOD_GRAFFITI`): полоса листа — ряды
 * гофрированных панелей с тегами. Чистый лист панели взять неоткуда, поэтому
 * фон собирается из самой полосы: тексель — медиана своего столбца (и двух
 * соседних) в окне по высоте ряда панели, без ярких и насыщенных текселей
 * (краска тегов, белые буквы). Гофр панели вертикальный, и медиана столбца
 * держит его полосы и ржавые потёки, а теги в ней тонут. Тексель, что от фона
 * отличается заметно (цветом или насыщенностью), и его соседи берут фон;
 * остальные остаются листом игры. Места `keep` (вывеска «LOADING», окна) не
 * трогаются и в фон не идут. Правит `rgba` на месте; ответ — число текселей.
 */
const GRAFFITI_DIFFERENCE = 45;
const GRAFFITI_SATURATION = 0.22;
const GRAFFITI_PAINT = 0.45;
const GRAFFITI_BRIGHT = 200;
const saturationOf = (r, g, b) => {
  const high = Math.max(r, g, b);
  return high ? (high - Math.min(r, g, b)) / high : 0;
};
export function cleanGraffitiBand(rgba, width, height, { rows, keep = [], window: span = 28 / 512 }) {
  const y0 = Math.max(0, Math.round(rows[0] * height));
  const y1 = Math.min(height, Math.round(rows[1] * height));
  const boxes = keep.map(([u0, v0, u1, v1]) => [Math.round(u0 * width), Math.round(v0 * height), Math.round(u1 * width), Math.round(v1 * height)]);
  const kept = (x, y) => boxes.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d);
  const tall = Math.max(4, Math.round(span * height));
  const median = (list) => {
    list.sort((a, b) => a - b);
    return list.length ? list[list.length >> 1] : 0;
  };
  const background = new Float32Array(width * height * 3);
  const red = [];
  const green = [];
  const blue = [];
  for (let x = 0; x < width; x += 1)
    for (let y = y0; y < y1; y += 1) {
      const from = Math.max(y0, Math.min(y - (tall >> 1), y1 - tall));
      const to = Math.min(y1, from + tall);
      red.length = green.length = blue.length = 0;
      for (let row = from; row < to; row += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const column = Math.min(width - 1, Math.max(0, x + dx));
          if (kept(column, row)) continue;
          const at = (row * width + column) * 4;
          if (saturationOf(rgba[at], rgba[at + 1], rgba[at + 2]) > GRAFFITI_PAINT || Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) > GRAFFITI_BRIGHT) continue;
          red.push(rgba[at]);
          green.push(rgba[at + 1]);
          blue.push(rgba[at + 2]);
        }
      if (!red.length) continue;
      const index = (y * width + x) * 3;
      background[index] = median(red);
      background[index + 1] = median(green);
      background[index + 2] = median(blue);
    }
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (kept(x, y)) continue;
      const at = (y * width + x) * 4;
      const index = (y * width + x) * 3;
      const far = Math.hypot(rgba[at] - background[index], rgba[at + 1] - background[index + 1], rgba[at + 2] - background[index + 2]) > GRAFFITI_DIFFERENCE;
      const painted = saturationOf(rgba[at], rgba[at + 1], rgba[at + 2]) - saturationOf(background[index], background[index + 1], background[index + 2]) > GRAFFITI_SATURATION;
      if (far || painted) mask[y * width + x] = 1;
    }
  let changed = 0;
  for (let y = y0; y < y1; y += 1)
    for (let x = 0; x < width; x += 1) {
      if (kept(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const row = y + dy;
          const column = x + dx;
          if (row >= y0 && row < y1 && column >= 0 && column < width && mask[row * width + column]) {
            near = true;
            break;
          }
        }
      if (!near) continue;
      const at = (y * width + x) * 4;
      const index = (y * width + x) * 3;
      rgba[at] = background[index];
      rgba[at + 1] = background[index + 1];
      rgba[at + 2] = background[index + 2];
      changed += 1;
    }
  return changed;
}

/*
 * Порог «своей» поверхности у LOD завода (задача 5 ТЗ 06.10.2026, вечер).
 * Бункеры, силосы и конвейеры вдали — простые цилиндры и коробки, их
 * поверхность отходит от HD на метры: при общих 3,5 м бетон силосов
 * (`im_concrete17_lod`, лист повтором) оказывался на 66 % «мимо места», и
 * дальний завод в 350 м стоял штатным бежевым. При 8 м своё — 64 % площади
 * этого листа: силосы вдали в облике работы, а площадки вокруг (на них
 * у HD нет облика) по-прежнему как в игре.
 */
const FACTORY_LOD_REACH = Object.freeze({ 1: Object.freeze({ xy: 8, z: 8 }) });


/**
 * Плашки эмблем завода — общей сборкой плашек мест (`recolor-emblem.js`).
 * `images` — картинки по `asset` (`Map`); `resources` — файлы мода (модели
 * корпусов: плашка выносится перед их деталями, задача 11 ТЗ 10.10.2026).
 * `[{ name, bytes }]` или `[]` без эмблем.
 */
export async function buildFactoryEmblems(input, images, { compile, stateDir, lod = null, game = null, resources = null }) {
  const plates = factoryEmblemPlates(input);
  /* Модели мода — из файлов набора, окружение (каркас, фермы) — из игры. */
  const placements = [
    ...FACTORY_INVENTORY.factory.placements.map((placement) => ({ ...placement, file: [`${placement.model}.ydr`, `${placement.model}.yft`].find((name) => resources?.has(name)) })),
    ...(FACTORY_INVENTORY.factory.footprint || []).filter((item) => item.at).map((item) => ({ ...item.placement, at: item.at, model: item.model })),
  ];
  const read = async (placement) => (placement.file ? resources.get(placement.file) : placement.at && game ? game.read(placement.at).catch(() => null) : null);
  const near = plates.length ? await nearPlateTriangles(plates, placements.map((placement) => ({ ...placement, at: placement.at || placement.file })), read) : null;
  return buildAssetPlates({
    far: { lod, game },
    near,
    plates,
    images,
    compile,
    stateDir,
    set: "factory",
    names: { types: FACTORY_PLATE.types, map: FACTORY_PLATE.map },
    files: factoryPlateFiles,
  });
}
