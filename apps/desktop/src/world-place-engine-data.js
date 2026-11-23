/*
 * Данные, которые оболочка движка места мира (`world-place-engine.js`) отдаёт ему в запросе: таблица мира (имена файлов типов, карты, родство словарей — как их читает
 * `worldReader`) и зоны обводов (`ZONES`). Отдельным модулем, чтобы главный процесс держал их в памяти только когда путь движка включён и зовётся (`import()` по первому запросу).
 */
import { ZONES } from "@modovik/climb-contract/recolor/zones";
import { WORLD_MAPS, WORLD_TXD_PARENTS, WORLD_TYPES } from "./world-place-table.js";

const numbers = (list) => Array.from(list, Number);

/** Зона обвода в виде, который читает движок. Поля — те, что берёт `outlineMeshes` и сборка материала зоны. */
export function outlineZoneOf(zone) {
  return {
    id: zone.id,
    part: zone.part,
    line: zone.line,
    colour: zone.modColour,
    alpha: zone.modAlpha,
    position: numbers(zone.position),
    targets: zone.targets.map((target) => ({ file: target.file, origin: numbers(target.origin), texture: String(target.texture) })),
  };
}

/** Линии части обвода (`bizvar`, `vzhzone`, `porta`) — те же зоны и в том же порядке, что берёт `outlineMeshes`. */
export const outlineZonesFor = (outline) => ZONES.filter((zone) => zone.part === outline && zone.line).map(outlineZoneOf);

/** Все линии всех обводов — образец для проверок движка (`fixtures/world-place/zones.json`). */
export const allOutlineZones = () => ZONES.filter((zone) => zone.line).map(outlineZoneOf);

/** Текст таблицы мира для движка: `{ typeNames, maps, parents }`. */
export const worldTableText = () => JSON.stringify({ typeNames: WORLD_TYPES.split("|"), maps: WORLD_MAPS, parents: WORLD_TXD_PARENTS });
