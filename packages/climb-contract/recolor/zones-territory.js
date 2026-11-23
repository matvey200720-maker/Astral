/*
 * «Зоны» — кусок местности из игры вокруг зоны (задача 23, вариант «а», ТЗ 19.10.2026).
 *
 * Лента зоны мода на чёрном не говорит, что она обводит. У двенадцати мест — девяти кругов по зелёным и
 * запретным зонам и углу у бизвара, ВЗХ и порта — есть сцена местности: земля, дороги и здания из файлов игры
 * игрока и ленты самих зон круга (`inventory/zones-territory.js`, `scripts/prepare-zones-territory.mjs`). Места
 * выбраны по числу упоминаний в Majestic (`scripts/lib/zones-territory-places.mjs`): остальным зонам кадр
 * показывает зону на чёрном, как раньше, и говорит об этом в подписи.
 *
 * Начало сцены — середина круга места; ленты зон лежат в ней со сдвигом `зона.position − начало`
 * (`zoneTerritory(id).shift`). Чистые данные, без React и three: их берёт кадр редактора и тест.
 */

import ZONES_TERRITORY_INVENTORY from "./inventory/zones-territory.js";
import { ZONES } from "./zones.js";

export { ZONES_TERRITORY_INVENTORY };

export const ZONES_TERRITORY = Object.freeze(ZONES_TERRITORY_INVENTORY.places.map((place) => Object.freeze(place)));

const placeById = new Map(ZONES_TERRITORY.map((place) => [place.id, place]));
const zoneById = new Map(ZONES.map((zone) => [zone.id, zone]));

/** Место по id: `{ id, kind: "area" | "outline", centre, reach, zones, mentions, vertices, ground, scene }` или `null`. */
export const zonesTerritoryPlace = (placeId) => placeById.get(placeId) || null;

/**
 * Местность зоны: `{ place, shift: [x, y, z] }` — место и сдвиг сетки зоны в сцене места (точка зоны минус начало
 * сцены) — или `null`, если у зоны местности нет.
 */
export function zoneTerritory(zoneId) {
  const place = placeById.get(ZONES_TERRITORY_INVENTORY.zoneToPlace[zoneId]);
  const zone = zoneById.get(zoneId);
  if (!place || !zone) return null;
  return { place, shift: zone.position.map((value, axis) => Number((value - place.scene.origin[axis]).toFixed(3))) };
}
