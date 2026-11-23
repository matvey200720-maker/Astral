/*
 * Живые плашки «Остановок» (задача 6 ТЗ 17.10.2026, вечер): гифка на постере.
 *
 * Шейдер постера остановки (`emissive_speclum`) не несёт параметров
 * развёртки `globalAnimUV0/1`, и клип развёртки на штатную модель ничего не
 * двинул бы, поэтому гифку играет плашка: сетка постера (две стороны, на
 * сантиметр впереди каждой — `busStopPlateMesh`) с листом кадров и клипом
 * `<модель>_uv_0` — своя модель на каждый вид остановки и её сущность на
 * каждой остановке вида. Сущность берёт положение и поворот остановки как
 * записаны в карте (игра обращает поворот сама), модель плашки — в осях
 * модели остановки, так плашка ложится ровно на постер. На самом листе
 * постера (вблизи и в высокой чёткости) лежит первый кадр
 * (`finish-bake.js`), штатные модели, словари и типы игры не трогаются.
 *
 * Лист кадров — подогнан под лист постера (`stretch`, подкраска отделки),
 * не больше `GIF_SURFACE_PROFILES.busstops.atlasSide`; непрозрачность
 * остановки — непрозрачность плашки.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resample } from "@modovik/dds";
import {
  busStopLiveState,
  busStopLookOf,
  busStopPlate,
  busStopPlateMesh,
  findBusStopType,
  normalizeBusStopsProject,
} from "@modovik/climb-contract/recolor/busstops";
import { normalizeFinishImage, tintImagePixels } from "@modovik/climb-contract/recolor/finish";
import { GIF_SURFACE_PROFILES, gifSurfaceAtlas, gifSurfaceFrame } from "@modovik/climb-contract/recolor/gif-surface";
import { normalizePlaceModel } from "@modovik/climb-contract/recolor/place-models";
import { compilePlaceModel, placeModelNames } from "./recolor-place-models.js";

/** Набор моделей плашек: `astral_busstoplive_m<N>.ydr` и компания (`placeModelNames`). */
export const BUSSTOP_LIVE_SET = "busstoplive";

/*
 * Ось модели нативного хоста: он сдвигает вершины на неё (кость барабана,
 * `StarModelCommands.cs`) — сетку шлём со сдвигом назад, и в файле игры вершины
 * плашки там же, где вершины постера. Хост отвечает тем же `pivot` — сверка.
 */
const HOST_PIVOT = Object.freeze([0.0006432533, -0.31497478, 0]);
/* Свечение постера: штатный множитель — 1 (доля от 8, %). */
const POSTER_GLOW = 13;
/* Любая картинка — один лист; ключ в хранилище окна установщику не нужен, лишь формат. */
const sheetKey = (rgba) => `hangar-emblem:${createHash("sha256").update(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)).digest("hex")}`;

/** Кадр листа кадров `frame` в `width × height` (растянут на весь постер) и подкрашен отделкой. */
function posterFrame(sheet, image, frame, width, height) {
  const piece = gifSurfaceFrame(sheet, image.animation, frame);
  const rgba = new Uint8ClampedArray(resample(new Uint8ClampedArray(piece.rgba), piece.width, piece.height, width, height));
  return tintImagePixels(rgba, image);
}

/**
 * Файлы живых плашек работы: `{ files: [{ name, bytes }], report }`.
 * `images` — свои картинки (`Map` ключ → `{ rgba, width, height }`, лист
 * кадров гифки), `compile` — нативный хост. Без живых видов — `{ files: [] }`.
 */
export async function buildBusStopLive(input, { images = new Map(), compile = null, stateDir = "" } = {}) {
  const project = normalizeBusStopsProject(input);
  const state = busStopLiveState(project);
  const report = { live: 0, stops: 0, bytes: 0, types: [], skipped: [], clips: [] };
  if (!state.live.length) return { files: [], report };
  if (typeof compile !== "function") throw new Error("Сборщик живых плашек остановок не подключён — обновите Astral.");
  const profile = GIF_SURFACE_PROFILES.busstops;
  const names = placeModelNames(BUSSTOP_LIVE_SET);
  const staging = path.join(stateDir || ".", "recolor", BUSSTOP_LIVE_SET, randomUUID());
  await fs.mkdir(staging, { recursive: true });
  const files = [];
  const archetypes = [];
  const entities = [];
  try {
    for (const typeId of state.live) {
      const plate = busStopPlate(typeId);
      const image = normalizeFinishImage(busStopLookOf(project, typeId).parts.poster.image);
      const sheet = image.asset ? images.get(image.asset) : null;
      if (!sheet) {
        report.skipped.push(typeId);
        continue;
      }
      const opacity = busStopLookOf(project, typeId).opacity;
      /* Каждый кадр — на весь постер, как неподвижная картинка на его листе. */
      const atlas = gifSurfaceAtlas(sheet, image.animation, (frame, width, height) => posterFrame(sheet, image, frame, width, height), { side: profile.atlasSide });
      const unit = busStopPlateMesh(typeId, image.animation);
      const mesh = {
        positions: unit.positions.map((value, at) => value - HOST_PIVOT[at % 3]),
        normals: unit.normals,
        uvs: unit.uvs,
        indices: unit.indices,
      };
      const name = names.model(report.types.length);
      const item = normalizePlaceModel({
        asset: sheetKey(atlas.rgba),
        shape: "plate",
        width: atlas.width,
        height: atlas.height,
        animation: image.animation,
        opacity,
        glow: POSTER_GLOW,
        motion: "none",
        distance: plate.lod || 140,
      });
      const built = await compilePlaceModel(item, {
        name,
        clipDictionary: names.clips(report.types.length),
        picture: { rgba: atlas.rgba, width: atlas.width, height: atlas.height },
        mesh,
        sheetSide: profile.atlasSide,
        compile,
        workDir: path.join(staging, name),
      });
      /* Хост отвечает осью модели: другая ось — плашка уехала бы от постера. */
      if (HOST_PIVOT.some((value, axis) => Math.abs(value - (built.pivot[axis] || 0)) > 1e-5)) throw new Error("Нативный хост поменял ось модели плашки — обновите Astral.");
      files.push(...built.files.map(({ name: file, bytes }) => ({ name: file, bytes })));
      archetypes.push(built.archetype);
      for (const stop of plate.stops) entities.push({ archetype: name, position: stop.slice(0, 3), rotation: stop.slice(3, 7), lodDist: built.archetype.lodDist, flags: 32 });
      report.live += 1;
      report.stops += plate.stops.length;
      report.types.push({ type: typeId, model: name, label: findBusStopType(typeId)?.label || typeId, stops: plate.stops.length, sheet: [atlas.width, atlas.height] });
      if (built.uvClip) report.clips.push({ model: name, clip: built.uvClip, frames: built.host?.uvFrames ?? 0 });
    }
    if (!entities.length) return { files, report };
    const request = path.join(staging, "place.json");
    await fs.writeFile(request, JSON.stringify({ format: "astral.compile-placements", version: 1, types: names.types, map: names.map, manifest: true, archetypes, entities }));
    const out = path.join(staging, "place");
    await compile("compile-placements", { input: request, output: out });
    for (const file of [`${names.types}.ytyp`, `${names.map}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(out, file)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка плашек остановок не дала ${file}.`);
      files.push({ name: file, bytes });
    }
    report.bytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
    if (report.bytes > profile.maxBytes) throw new Error(`Живые плашки остановок весят ${Math.round(report.bytes / 1048576)} МБ — больше ${Math.round(profile.maxBytes / 1048576)} МБ.`);
    return { files, report };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

