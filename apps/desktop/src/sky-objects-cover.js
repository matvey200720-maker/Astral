/*
 * Обложка маппинга «объекты в небе» (северное сияние, редукс Barbie · Mapping (auroraa), 14.11.2026).
 *
 * Лента сияния — плоские полотна на высоте 1400 м над океаном: на студийном фоне, сбоку и крупно, они читались тёмно-синими плоскостями, и владелец не понимал, что это (правило: объекты
 * снимаются как в игре). Здесь кадр другой — «с земли»: камера смотрит вверх-вдаль на объекты на их настоящих местах и в настоящем масштабе, фон — ночное небо, материал как в игре
 * (прозрачность из листа), свечение дорисовывает окно (`shooter-service.js`, рамка `sky`).
 *
 * Как печь узнаёт «объект в небе» (`skyObjectsOf`): карты части ставят модели части, и
 *   • все размещения лежат высоко над миром — не ниже `SKY_MIN_Z` м над нулём;
 *   • коллизий в части нет (`.ybn`) — по этим объектам не ходят и не ездят;
 *   • хотя бы у одной поставленной модели есть прозрачный или светящийся материал (прозрачность листа, аддитивный шейдер).
 * Любое условие не сошлось — маршрут не нужен, часть снимается как раньше.
 */

import * as placement from "@modovik/climb-contract/recolor/placement";
import * as mapEntities from "./map-entities-append.js";
import { joaatName } from "./place-isolation.js";
import { isDrawn } from "./mod-model-scene.js";
import { firstDrawable } from "./mod-place-scene.js";

/** Ниже этой высоты (м над нулём) размещение — обычная постройка, а не объект в небе. */
export const SKY_MIN_Z = 400;
/** Названия шейдеров со своим свечением (имя шейдера у светящегося и аддитивного материала). */
const GLOWING_SHADER = /emissive|glow|additive|neon|aurora/i;
/** Взгляды кадров: первый — обложка, остальные — галерея. Ленты тянутся с юга на север (~2600 м при ~600 м шириной), поэтому камера — сбоку (`yaw` около ±π/2, не с торца), `pitch` ниже нуля: камера на земле смотрит вверх. */
export const SKY_VIEWS = Object.freeze([
  { yaw: 1.3, pitch: -0.1, zoom: 1 },
  { yaw: -1.25, pitch: -0.08, zoom: 1 },
  { yaw: 0.95, pitch: -0.14, zoom: 0.9 },
]);

const stemOf = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");

/** Размещения моделей части со всех её карт: `[{ model, file, position, rotation, scaleXY, scaleZ }]`; карта, что не читается, ничего не ставит. */
export function skyPlacements(maps, models) {
  const byHash = new Map(
    models.map((file) => [joaatName(stemOf(file.name)), file]),
  );
  const placed = [];
  for (const map of maps) {
    try {
      for (const entity of mapEntities.readMapEntityPlaces(map.bytes)) {
        const file = byHash.get(entity.archetype >>> 0);
        if (!file) continue;
        placed.push({
          model: stemOf(file.name),
          file,
          position: entity.position,
          rotation: entity.rotation,
          scaleXY: entity.scale?.[0] || 1,
          scaleZ: entity.scale?.[1] || 1,
        });
      }
    } catch {
      /* карта не читается — её модели не считаются поставленными */
    }
  }
  return placed;
}

const lowestZ = (placements) =>
  Math.min(...placements.map((place) => place.position[2]));

/** Правило: есть размещения, все высоко, коллизий нет. Чистая — для теста. */
export function isHighPlacement(placements, hasCollision) {
  if (hasCollision || !placements.length) return false;
  const low = lowestZ(placements);
  return Number.isFinite(low) && low >= SKY_MIN_Z;
}

/** Материал сетки прозрачный (лист с альфой) или светится своим шейдером. Чистая — для теста. */
export function isGlowingMaterial(material) {
  if (!material) return false;
  const alpha = String(material.alphaMode || "opaque");
  return (
    alpha !== "opaque" || GLOWING_SHADER.test(String(material.shader || ""))
  );
}

async function hasGlowingModel(placements) {
  const seen = new Set();
  for (const place of placements) {
    if (seen.has(place.model)) continue;
    seen.add(place.model);
    const drawable = firstDrawable(place.file.bytes);
    if (
      drawable?.meshes?.some(
        (mesh) => isDrawn(mesh) && isGlowingMaterial(mesh.material),
      )
    )
      return true;
  }
  return false;
}

/** Середина размещений по осям мира: сцена строится вокруг неё (числа мира в тысячи метров не годятся для кадра). */
export function skyCentre(placements) {
  const sum = placements.reduce(
    (total, place) => total.map((value, axis) => value + place.position[axis]),
    [0, 0, 0],
  );
  return sum.map((value) => value / placements.length);
}

/**
 * Объект в небе или `null`: `{ plan, views }` — план для `modelsScene` (каждое размещение — своя вещь на своём месте и в своём масштабе) и взгляды кадров.
 * @param {{ maps: { name: string, bytes: Uint8Array }[], models: { name: string, bytes: Uint8Array }[], collision: boolean }} part — карты части (`.ymap`), её модели (`.ydr`) и признак: коллизии (`.ybn`) в части есть
 */
export async function skyObjectsOf({ maps, models, collision }) {
  const placements = skyPlacements(maps, models);
  if (!isHighPlacement(placements, collision)) return null;
  if (!(await hasGlowingModel(placements))) return null;
  const centre = skyCentre(placements);
  const items = placements.map((place) => {
    const shifted = place.position.map((value, axis) => value - centre[axis]);
    return {
      name: place.file.name,
      at: [0, 0, 0],
      ground: 0,
      alpha: "additive",
      move: placement.placementTransform({ ...place, position: shifted }),
      turn: placement.placementRotation(place),
    };
  });
  return {
    plan: { items },
    views: SKY_VIEWS,
    count: placements.length,
    centre,
  };
}
