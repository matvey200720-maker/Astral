/*
 * «Интерьеры» снаружи в файлах (второй заход задачи 3 ТЗ 10.10.2026):
 * заправки и фасады магазинов.
 *
 * Основа — штатные файлы игры игрока (опись `inventory/shops-outside-files.js`):
 *
 *   • место (станция или магазин) — свои модели квартала, что стоят только
 *     здесь. Лист части (стены, навес, площадка, вывески) правится там, где
 *     лежит: зашитый в свою модель — на месте в модели и её `+hidr`; в
 *     словаре, который берут только свои модели места, — на месте в словаре
 *     и его `+hi`; лист общего словаря квартала (или его родителя по gtxd) —
 *     перекрашенной копией, зашитой в каждую свою модель, что его берёт
 *     (`shop-embed-textures` нативного хоста): игра ищет лист модели сперва в
 *     ней самой, и соседние дома квартала остаются как были;
 *   • колонки — один облик на все станции: листы корпуса и табло на месте в
 *     штатных фрагментах (`prop_gas_pump_*.yft`) и их `+hifr` — других вещей у
 *     этих моделей нет;
 *   • свои колонки у станции — копия архетипа колонки под своим именем
 *     (`astral_shops_<станция>_<колонка>`, постоянные типы набора
 *     `astral_shops_local.ytyp`) со своей моделью — штатный фрагмент с листами
 *     облика этой станции; сущности колонок станции в картах района (все
 *     копии карты в пакетах Rockstar) смотрят на копию. Вблизи у копии —
 *     зашитые листы (словарь `+hifr` игра цепляет только к штатной модели);
 *   • эмблемы и надписи на фасадах — общей системой мест: своя плашка на
 *     каждую (`compile-emblem-plates`), свои типы, карта и манифест в
 *     контейнере слоя update.rpf.
 *
 * Дальние модели квартала (LOD) едут как в игре: издалека место — штатное.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import { BUILDING_TINT_LIFT } from "@modovik/climb-contract/recolor/buildings";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import OUTSIDE_FILES from "@modovik/climb-contract/recolor/inventory/shops-outside-files";
import { SHOPS_LOCAL_TYPES, stationPumpCloneName } from "@modovik/climb-contract/recolor/shops-local";
import {
  SHOPS_PLATE,
  SHOP_PUMPS,
  changedOutsidePlaces,
  outsideEmblemPlates,
  outsideLookOf,
  ownPumpStations,
  pumpLookOf,
  pumpsChanged,
  shopsPlateFiles,
} from "@modovik/climb-contract/recolor/shops-outside";
import { joaatName, patchMapEntityArchetypes } from "./place-isolation.js";
import { buildAssetPlates } from "./recolor-emblem.js";
import { bakeFile, resourceRefs, sheetPixels } from "./recolor-sheets.js";

/* Подъём тёмного у тона — как у зданий (и у кадра: `surfaceLook`), чёрные швы листа не остаются чёрными. */
const TINT_LIFT = BUILDING_TINT_LIFT;
/* Форматы листа, которые копия пишет как у игры; прочие — DXT5. */
const DDS_FORMATS = new Set(["DXT1", "DXT3", "DXT5", "A8R8G8B8"]);

const placeFiles = new Map(OUTSIDE_FILES.places.map((place) => [place.id, place]));
const pumpFiles = new Map(OUTSIDE_FILES.pumps.map((pump) => [pump.id, pump]));
const leaf = (address) => String(address).split("/").pop().toLowerCase();

/** Правка листа по облику поверхности или `null` — лист как в игре. */
export function shopSurfaceOp(surface) {
  if (!surface || surface.mode === "standard") return null;
  if (surface.mode === "colour") {
    const look = normalizeColourEffect(surface.look);
    return look.mode === "solid" ? { tint: look.colour, lift: TINT_LIFT } : { strip: look, lift: TINT_LIFT };
  }
  if (surface.mode === "flat") return { flat: hexBytes(normalizeColourEffect(surface.look).colour) };
  return { finish: surface };
}

/* Правка листа колонки по облику: часть листа — по описи колонки. */
function pumpOps(pump, look) {
  const parts = new Map(pump.sheets.map((sheet) => [sheet.name, sheet.part]));
  return (name) => {
    const part = parts.get(name);
    return part ? shopSurfaceOp(look.parts[part]) : null;
  };
}

/**
 * Что правит место: `{ inPlace, embeds }` — файлы с листами на месте
 * (`file → { at, ops }`) и свои модели места с копиями общих листов
 * (`номер модели → [{ sheet, op }]`).
 */
export function outsidePlacePlan(placeId, look) {
  const spec = placeFiles.get(placeId);
  const inPlace = new Map();
  const embeds = new Map();
  if (!spec) return { spec: null, inPlace, embeds };
  const add = (file, at, name, op) => {
    const entry = inPlace.get(file) || { at, ops: new Map() };
    entry.ops.set(name, op);
    inPlace.set(file, entry);
  };
  for (const sheet of spec.sheets) {
    const op = shopSurfaceOp(look.parts[sheet.part]);
    if (!op) continue;
    if (sheet.embed) {
      for (const model of sheet.embed) embeds.set(model, [...(embeds.get(model) || []), { sheet, op }]);
      continue;
    }
    add(sheet.file, sheet.at, sheet.name, op);
    if (sheet.hd) add(sheet.hd.file, sheet.hd.at, sheet.name, op);
  }
  return { spec, inPlace, embeds };
}

/*
 * Копии общих листов — в модель места: каждый лист читается из своего
 * словаря игры, перекрашивается тем же расчётом, что и на месте, и едет в
 * нативный хост DDS той же раскладки (формат, мипы); имя и флаги листа хост
 * берёт у штатного.
 */
async function embedSheets({ model, base, jobs, game, compile, stateDir, context }) {
  if (typeof compile !== "function") throw new Error("Сборщик листов места не подключён — обновите Astral.");
  const staging = path.join(stateDir, "recolor", "shops", "embed", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const sources = new Map();
    const textures = [];
    for (const [index, { sheet, op }] of jobs.entries()) {
      let source = sources.get(sheet.file);
      if (!source) {
        const bytes = await game.read(sheet.at).catch(() => null);
        if (!bytes) continue;
        const file = path.join(staging, `s${sources.size}.ytd`);
        await fs.writeFile(file, bytes, { flag: "wx" });
        const { refs } = resourceRefs(new Uint8Array(bytes), sheet.file);
        source = { file, refs: new Map(refs.map((ref) => [ref.name.toLowerCase(), ref])) };
        sources.set(sheet.file, source);
      }
      const ref = source.refs.get(sheet.name);
      if (!ref?.complete) continue;
      const rgba = sheetPixels(ref, op, context);
      if (!rgba) continue;
      const format = DDS_FORMATS.has(ref.format) ? ref.format : "DXT5";
      const dds = encodeDds({ width: ref.width, height: ref.height, format, mipLevels: fullMipLevels(ref.width, ref.height), rgba });
      const target = path.join(staging, `t${index}.dds`);
      await fs.writeFile(target, dds, { flag: "wx" });
      textures.push({ name: sheet.name, dds: target, source: source.file });
    }
    if (!textures.length) return { bytes: base, embedded: 0 };
    const extension = path.extname(model.file);
    const input = path.join(staging, `in${extension}`);
    const output = path.join(staging, `out${extension}`);
    const request = path.join(staging, "request.json");
    await fs.writeFile(input, base, { flag: "wx" });
    await fs.writeFile(request, JSON.stringify({ format: "astral.shop-embed-textures", version: 1, target: input, textures }));
    await compile("shop-embed-textures", { input: request, output });
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes?.length) throw new Error(`Сборка листов места ${model.file} не дала файла.`);
    return { bytes, embedded: textures.length };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/* Копия колонки станции: штатный фрагмент с листами облика станции (зашитые листы — у самой модели). */
async function stationPumpModel(pump, look, game, context) {
  const spec = pumpFiles.get(pump.id);
  const base = spec ? await game.read(spec.at).catch(() => null) : null;
  if (!base) return null;
  const baked = await bakeFile(base, spec.file, pumpOps(pump, look), context);
  return baked.bytes;
}

/**
 * Файлы «снаружи» под облик: `{ files, patches, report }`. `outside` —
 * часть работы (`normalizeShopsOutside`), `game` — читатель игры игрока,
 * `sourceOf` — источник отделки (узор, картинка, градиент), `compile` —
 * нативный хост, `emblems` — картинки эмблем (`Map` ключ → `{ rgba, width, height }`).
 */
export async function buildShopOutsideFiles(outside, { game, compile = null, stateDir = os.tmpdir(), sourceOf = null, emblems = new Map(), clones: interiorClones = [] } = {}) {
  const files = [];
  const patches = [];
  const report = { places: [], pumps: false, stations: [], sheets: 0, embedded: 0, clones: 0, maps: 0, mismatched: 0, missing: [] };
  const context = { images: {}, sources: sourceOf };
  const taken = new Set();
  const push = (name, bytes, patch) => {
    const key = name.toLowerCase();
    if (taken.has(key)) throw new Error(`Файл ${name} правят два места снаружи — обновите опись Astral.`);
    taken.add(key);
    files.push({ name, bytes });
    patches.push({ file: name, ...patch });
  };

  /* 1. Места: листы своих моделей по частям. */
  for (const placeId of changedOutsidePlaces(outside)) {
    const { spec, inPlace, embeds } = outsidePlacePlan(placeId, outsideLookOf(outside, placeId));
    if (!spec) continue;
    const built = new Map();
    for (const [file, entry] of inPlace) {
      const base = await game.read(entry.at).catch(() => null);
      if (!base) {
        report.missing.push(file);
        continue;
      }
      const baked = await bakeFile(base, file, (name) => entry.ops.get(name) || null, context);
      if (!baked.textures.length) continue;
      built.set(file, baked.bytes);
      report.sheets += baked.textures.length;
    }
    for (const [modelIndex, jobs] of embeds) {
      const model = spec.models[modelIndex];
      if (!model) continue;
      const base = built.get(model.file) || (await game.read(model.at).catch(() => null));
      if (!base) {
        report.missing.push(model.file);
        continue;
      }
      const embedded = await embedSheets({ model, base, jobs, game, compile, stateDir, context: { ...context } });
      if (!embedded.embedded) continue;
      built.set(model.file, embedded.bytes);
      report.embedded += embedded.embedded;
    }
    for (const [file, bytes] of built) push(file, bytes, { place: placeId });
    if (built.size) report.places.push(placeId);
  }

  /* 2. Колонки — общий облик: штатные фрагменты и их `+hifr` на месте. */
  if (pumpsChanged(outside)) {
    for (const pump of SHOP_PUMPS) {
      const spec = pumpFiles.get(pump.id);
      if (!spec) continue;
      const opOf = pumpOps(pump, outside.pumps.all);
      for (const target of [{ file: spec.file, at: spec.at }, ...(spec.hd ? [spec.hd] : [])]) {
        const base = await game.read(target.at).catch(() => null);
        if (!base) {
          report.missing.push(target.file);
          continue;
        }
        const baked = await bakeFile(base, target.file, opOf, context);
        if (!baked.textures.length) continue;
        push(target.file, baked.bytes, { pump: pump.id });
        report.sheets += baked.textures.length;
      }
    }
    report.pumps = true;
  }

  /* 3. Свои колонки станции — копии архетипов со своими моделями, карты района — на копии. */
  const stations = ownPumpStations(outside);
  /* Свои копии вещей помещений (задача 5 ТЗ 11.10.2026) — в тех же постоянных типах набора. */
  const clones = [...interiorClones];
  const mapEdits = new Map();
  if (stations.length || clones.length) {
    if (typeof compile !== "function") throw new Error("Сборщик своих копий вещей не подключён — обновите Astral.");
    for (const stationId of stations) {
      const station = placeFiles.get(stationId);
      const look = pumpLookOf(outside, stationId);
      for (const model of new Set((station?.pumps || []).map((item) => item.model))) {
        const pump = SHOP_PUMPS.find((item) => item.model === model);
        const spec = pump && pumpFiles.get(pump.id);
        if (!spec?.ytyp) continue;
        const bytes = await stationPumpModel(pump, look, game, context);
        if (!bytes) {
          report.missing.push(spec.file);
          continue;
        }
        const name = stationPumpCloneName(stationId, pump.id);
        push(`${name}${path.extname(spec.file)}`, bytes, { station: stationId, pump: pump.id });
        clones.push({ source: spec.ytyp, archetypeHash: joaatName(model), name, assetName: name });
        for (const entity of station.pumps.filter((item) => item.model === model))
          for (const ref of entity.refs) {
            const changes = mapEdits.get(ref.map) || new Map();
            changes.set(ref.index, { from: joaatName(model), to: joaatName(name), position: entity.position });
            mapEdits.set(ref.map, changes);
          }
      }
      report.stations.push(stationId);
    }
    if (clones.length) {
      push(`${SHOPS_LOCAL_TYPES}.ytyp`, await compileLocalTypes(clones, { game, compile, stateDir }), { local: clones.length });
      report.clones = clones.length;
      for (const [address, changes] of mapEdits) {
        const bytes = await game.read(address).catch(() => null);
        if (!bytes) {
          report.missing.push(leaf(address));
          continue;
        }
        const patched = patchMapEntityArchetypes(new Uint8Array(bytes), changes);
        report.mismatched += patched.mismatched;
        if (!patched.bytes) continue;
        push(leaf(address), patched.bytes, { map: true, retargeted: patched.patched });
        report.maps += 1;
      }
    }
  }
  /* 4. Эмблемы и надписи на фасадах — плашками. */
  const plates = outsideEmblemPlates(outside);
  if (plates.length) {
    /* Дальних копий у плашек мест снаружи нет (дальние модели квартала — как в игре): карты `_lod` и моделей `_far` хост не пишет. */
    const files = (count) => shopsPlateFiles(count).filter((name) => !name.endsWith("_lod.ymap") && !name.endsWith("_far.ydr"));
    const built = await buildAssetPlates({ plates, images: emblems, compile, stateDir, set: "shops", names: { types: SHOPS_PLATE.types, map: SHOPS_PLATE.map }, files });
    for (const file of built) push(file.name, file.bytes, { plate: true });
    report.plates = plates.length;
  }
  return { files, patches, report };
}

/* Постоянные типы копий набора — нативным хостом из типов игры (`compile-place-types`). */
async function compileLocalTypes(clones, { game, compile, stateDir }) {
  const staging = path.join(stateDir, "recolor", "shops", "local-types", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const sources = [];
    const ids = new Map();
    for (const address of new Set(clones.map((clone) => clone.source))) {
      const bytes = await game.read(address).catch(() => null);
      if (!bytes) throw new Error(`Типы игры ${leaf(address)} не прочитались — свои колонки станции не собрать.`);
      const id = `s${ids.size + 1}`;
      const file = path.join(staging, `${id}.ytyp`);
      await fs.writeFile(file, bytes, { flag: "wx" });
      ids.set(address, id);
      sources.push({ id, file });
    }
    const request = path.join(staging, "request.json");
    const output = path.join(staging, `${SHOPS_LOCAL_TYPES}.ytyp`);
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.compile-place-types",
        version: 1,
        typesName: SHOPS_LOCAL_TYPES,
        sources,
        clones: clones.map(({ source, ...clone }) => ({ source: ids.get(source), ...clone })),
      }),
    );
    await compile("compile-place-types", { input: request, output });
    return await fs.readFile(output);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
