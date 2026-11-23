/*
 * «Зоны каптов» — кусок территории из игры под шайбой (задача 16 ТЗ 18.10.2026, поздний вечер).
 *
 * Шайба капта — прозрачный цилиндр над районом (`capt-zones.js`). Чтобы по кадру было видно, как она
 * ляжет на землю при другой высоте, размере и цвете, у каждой зоны есть сцена местности вокруг её
 * точки: земля, дороги и здания из файлов игры игрока (`inventory/capt-territory.js`,
 * `scripts/prepare-capt-territory.mjs`). Начало сцены — точка зоны, шайба стоит в начале координат.
 *
 * Чистые данные, без React и three: их берёт кадр редактора и тест.
 */

import CAPT_TERRITORY_INVENTORY from "./inventory/capt-territory.js";

export { CAPT_TERRITORY_INVENTORY };

export const CAPT_TERRITORY = Object.freeze(CAPT_TERRITORY_INVENTORY.zones.map((zone) => Object.freeze(zone)));

const byId = new Map(CAPT_TERRITORY.map((zone) => [zone.id, zone]));

/** Местность зоны: `{ id, reach, vertices, triangles, scene: { url, bytes, sha256, origin, bounds } }` или `null`. */
export const captTerritory = (zoneId) => byId.get(zoneId) || null;
