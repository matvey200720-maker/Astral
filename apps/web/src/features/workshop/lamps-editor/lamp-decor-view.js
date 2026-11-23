/*
 * Столб кадра: краска, блеск, прозрачность и украшение — по тем же числам и
 * той же сетке, что уедут в игру.
 *
 * Сетку украшения строит контракт (`decorMeshes`) вокруг нарисованного
 * столба кадра — у него пропорции `prop_streetlight_01`, — поэтому спираль,
 * гирлянда и завитки в кадре те же, что встанут в модель. Цвет частей —
 * клетки того же листа (`decorCellColour`), свечение огоньков — множитель
 * `emissive`, пересчитанный в свет сцены по стеклу лампы: у стекла фонаря
 * множитель 16, и в кадре оно светит цветом лампы × 2,2.
 *
 * Краска столба — средний цвет листа корпуса после краски (`poleMeanColour`):
 * в кадре столб гладкий, рисунка листа на нём нет — он нарисован Astral.
 */

import { decorCellColour, decorEmissive, decorMeshes } from "@modovik/street-light-contract/lamps";

/* Свет сцены на единицу множителя `emissive`: стекло лампы — 16 → 2,2. */
export const DECOR_GLOW_UNIT = 2.2 / 16;
/* Серый корпус фонаря игры (средняя яркость листа, sRGB) — опора краски. */
export const VANILLA_POLE_GREY = 0.42;

export const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const hexLinear = (hex) =>
  [1, 3, 5].map((offset) => srgbToLinear(Number.parseInt(String(hex).slice(offset, offset + 2), 16) / 255));

/** Столб нарисованного фонаря как столб модели (`poleProfile`). */
export function previewPoleProfile(geometry) {
  const pole = geometry.pole;
  const top = geometry.arm.from[2] - 0.1;
  return {
    axis: [pole.x, pole.y],
    bottom: pole.baseHeight,
    top,
    radius: pole.radius,
    base: pole.base,
    ground: 0,
    height: top,
    profile: [
      [pole.baseHeight, pole.radius],
      [top, pole.radius],
    ],
  };
}

/*
 * Краска столба в свете сцены: множитель к серому металлу кадра. Без краски
 * — единица (столб игры).
 */
export function polePaintFactor(paint) {
  if (!paint) return [1, 1, 1];
  const grey = srgbToLinear(VANILLA_POLE_GREY);
  return paint.map((channel) => srgbToLinear(channel) / grey);
}

const cache = new Map();

/**
 * Украшение кадра: `{ parts: [{ positions, normals, indices, colours,
 * emissive }] }` (оси сцены = оси модели, Z вверх) или `null`. Цвета —
 * линейные, `emissive` — свет огонька в единицах сцены (0 у «тела»).
 */
export function decorPreview(decor, geometry) {
  if (!decor) return null;
  return decorPreviewFor(decor, previewPoleProfile(geometry), "drawn");
}

/**
 * Украшение по профилю столба (`poleProfile` контракта): у нарисованного столба кадра профиль свой
 * (`previewPoleProfile`), у настоящего столба на дороге — снятый с его модели (`lamp-live-pole.js`).
 * `owner` — чей профиль: входит в ключ кэша.
 */
export function decorPreviewFor(decor, profile, owner, lod = "high") {
  if (!decor || !profile) return null;
  const key = `${owner}|${lod}|${JSON.stringify(decor)}|${profile.height}|${profile.radius}|${profile.bottom}|${profile.top}`;
  if (cache.has(key)) return cache.get(key);
  const meshes = decorMeshes({ ...decor, on: true }, profile, lod);
  const glow = decorEmissive(decor.glow) * DECOR_GLOW_UNIT;
  const parts = [];
  for (const role of ["body", "glow"]) {
    const mesh = meshes[role];
    if (!mesh) continue;
    const count = mesh.vertices;
    const colours = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const [r, g, b] = hexLinear(decorCellColour(decor, mesh.cells[index]));
      colours[index * 3] = r;
      colours[index * 3 + 1] = g;
      colours[index * 3 + 2] = b;
    }
    parts.push({
      role,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      colours,
      emissive: role === "glow" ? glow : 0,
    });
  }
  const preview = parts.length ? { key, parts } : null;
  if (cache.size > 24) cache.clear();
  cache.set(key, preview);
  return preview;
}
