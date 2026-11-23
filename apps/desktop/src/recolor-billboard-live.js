/*
 * Живые плашки «Билбордов» (задача 6 ТЗ 17.10.2026, вечер): гифка на щите.
 *
 * Лицо щита запечено в модель района, и клип развёртки двигал бы весь район,
 * поэтому живая гифка — своя модель-плашка перед полотном (тот же сборщик,
 * что «Модели» мест и полотна арены: `buildPlaceModels`): лист кадров в рамку
 * щита, клип развёртки `<модель>_uv_0`, архетип с флагом 0x400. Плашка стоит
 * на сантиметр впереди полотна по его точной нормали (`billboardPlate`,
 * `scripts/prepare-billboards.mjs`) и видна так же далеко, как ближняя
 * модель щита; дальше, вдали и на общем листе щит показывает первый кадр на
 * самом листе (`buildBillboardFiles`) — провала между ними нет.
 *
 * Кому быть живым, решает договор (`billboardLiveState`): не больше
 * `GIF_SURFACE_PROFILES.billboards.maxLive` плашек, лист ≤ 1024 px, вес
 * вместе ≤ 40 МБ; остальные щиты — первым кадром на листе.
 */

import { createHash } from "node:crypto";
import {
  billboard,
  billboardDrawingKey,
  billboardGlowMultiplier,
  billboardLiveState,
  billboardLookOf,
  billboardPicture,
  billboardPlate,
  billboardPlateCentre,
  billboardPlateRotation,
  normalizeBillboardsProject,
} from "@modovik/climb-contract/recolor/billboards";
import { GIF_SURFACE_PROFILES, gifSurfaceAtlas } from "@modovik/climb-contract/recolor/gif-surface";
import { PLACE_MODEL_GLOW_MAX } from "@modovik/climb-contract/recolor/place-models";
import { buildPlaceModels } from "./recolor-place-models.js";

/** Набор моделей плашек: `astral_billboardlive_m<N>.ydr` и компания (`placeModelNames`). */
export const BILLBOARD_LIVE_SET = "billboardlive";

/* Рамка плашки в модели — по пропорции щита: длинная сторона столько условных пикселей. */
const FRAME_LONG = 4096;
/* Дальность плашки, если у ближней модели щита её не нашлось. */
const DEFAULT_DISTANCE = 150;

/** Свечение плашки (доля множителя игры, %): у щитов, что светятся, — штатный множитель × свечение облика. */
function plateGlow(board, look) {
  if (!board.glow || look.glow <= 0) return 0;
  const standard = board.glowShaders?.[0]?.multiplier;
  const multiplier = billboardGlowMultiplier(Number.isFinite(standard) && standard > 0 ? standard : 1, look);
  return Math.max(0, Math.min(100, Math.round((multiplier / PLACE_MODEL_GLOW_MAX) * 100)));
}

/**
 * Файлы живых плашек работы: `{ files: [{ name, bytes }], report }`.
 * `images` — свои картинки (`Map` ключ → `{ rgba, width, height }`, лист
 * кадров гифки и рисунки облика), `compile` — нативный хост. Без живых
 * щитов — `{ files: [] }`.
 */
export async function buildBillboardLive(input, { images = new Map(), compile = null, stateDir = "" } = {}) {
  const project = normalizeBillboardsProject(input);
  const state = billboardLiveState(project);
  const report = { live: 0, bytes: 0, skipped: [], boards: [] };
  if (!state.live.length) return { files: [], report };
  if (typeof compile !== "function") throw new Error("Сборщик живых плашек щитов не подключён — обновите Astral.");
  const profile = GIF_SURFACE_PROFILES.billboards;
  const pictures = new Map();
  const origins = new Map();
  const items = [];
  for (const id of state.live) {
    const board = billboard(id);
    const plate = billboardPlate(id);
    const look = billboardLookOf(project, id);
    const sheet = images.get(look.image.asset);
    if (!board || !plate || !sheet) {
      report.skipped.push(id);
      continue;
    }
    const drawingKey = billboardDrawingKey(look.drawing);
    const drawing = drawingKey ? images.get(drawingKey) || null : null;
    const aspect = plate.width / plate.height;
    /* Каждый кадр — по тем же правилам, что неподвижная картинка щита (подгонка, яркость, рисунок поверх). */
    const atlas = gifSurfaceAtlas(sheet, look.image.animation, (frame, width, height) => billboardPicture(look, sheet, width, height, aspect, drawing, frame)?.rgba || null, {
      side: profile.atlasSide,
    });
    const asset = `hangar-emblem:${createHash("sha256").update(Buffer.from(atlas.rgba.buffer, atlas.rgba.byteOffset, atlas.rgba.byteLength)).digest("hex")}`;
    pictures.set(asset, { rgba: atlas.rgba, width: atlas.width, height: atlas.height });
    const long = Math.max(plate.width, plate.height);
    const scene = `b${items.length + 1}`;
    origins.set(scene, billboardPlateCentre(plate));
    items.push({
      id: `m${items.length + 1}`,
      label: board.label,
      asset,
      shape: "plate",
      scene,
      position: [0, 0, 0],
      rotation: billboardPlateRotation(plate),
      size: long,
      width: Math.max(1, Math.round((plate.width / long) * FRAME_LONG)),
      height: Math.max(1, Math.round((plate.height / long) * FRAME_LONG)),
      animation: look.image.animation,
      opacity: 100,
      glow: plateGlow(board, look),
      motion: "none",
      distance: plate.distance > 0 ? plate.distance : DEFAULT_DISTANCE,
    });
    report.boards.push(id);
  }
  if (!items.length) return { files: [], report };
  const built = await buildPlaceModels(BILLBOARD_LIVE_SET, items, {
    pictures,
    origin: (scene) => origins.get(scene) || null,
    sheetSide: profile.atlasSide,
    compile,
    stateDir,
  });
  report.live = built.report.live;
  report.clips = built.report.clips || [];
  report.skipped.push(...built.report.skipped);
  report.bytes = built.files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (report.bytes > profile.maxBytes) throw new Error(`Живые плашки щитов весят ${Math.round(report.bytes / 1048576)} МБ — больше ${Math.round(profile.maxBytes / 1048576)} МБ: оставьте меньше щитов с гифкой.`);
  return { files: built.files, report };
}
