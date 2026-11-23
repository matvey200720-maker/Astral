/*
 * Штатные вещи ангара ограблений — то, что игра ставит картами сетевого района, а не моделями ангара (Хелпер 19, 28.10.2026,
 * владелец: «у него включены модели — контейнеры, подъёмник, вагончик, баллоны — а ты их отключил»).
 *
 * В ангаре, кроме пяти моделей корпуса и нутра (`HANGAR_INVENTORY.hangar.placements`), стоят вещи карт `hei_ap1_01_a_strm_5/17`
 * (mpheist): ножничный подъёмник (`prop_hydro_platform_01`), вагончики (`prop_portacabin01`), газовый баллон, ёмкости, бочки,
 * ящики, прицепы, настенные лампы. Автор редукса их не трогает — они из игры игрока и стоят в кадре ролика. Опись, где что стоит,
 * уже есть у изоляции места (`resources/recolor-local/hangar.json`, `clones`: имя вещи, файл модели, карта и номер сущности);
 * не хватает только поворота и масштаба — их читаем из самой карты по номеру.
 */

import { joaatName } from "./place-isolation.js";

/* Запас вокруг коробки нутра (м): вещь у самой стены — всё равно внутри. */
const MARGIN = 1;

const inside = (position, centre, box) =>
  position.every((value, axis) => value - centre[axis] >= box.min[axis] - MARGIN && value - centre[axis] <= box.max[axis] + MARGIN);

/**
 * Вещи ангара для сцены кадра: `[{ model, at, position, rotation, scaleXY, scaleZ, prop: true }]`.
 *
 * @param {object} options
 * @param {{ clones: object[] }} options.plan  опись изоляции места «ангар» (`readPlaceIsolation("hangar")`)
 * @param {number[]} options.centre            центр сцены ангара
 * @param {{ min: number[], max: number[] }} options.box  коробка нутра относительно центра
 * @param {(at: string) => Promise<Uint8Array | null>} options.read  байты файла игры по адресу
 * @param {(bytes: Uint8Array) => { entities: object[] }} options.readMap  сущности карты (`readMapData`)
 * @param {((txd: string) => string | null) | null} [options.sheetAt]  адрес словаря текстур вещи по имени (`openGameNames().sheetAt`):
 *   лист, не вшитый в модель, лежит в нём; у вещей, чью модель правит пакет DLC, словарь остался в базовом архиве
 * @param {RegExp} [options.maps]  какие карты берём: сетевые `hei_` (в сюжете ангар не грузится)
 */
export async function hangarStockProps({ plan, centre, box, read, readMap, sheetAt = null, maps = /(^|\/)hei_[^/]*\.ymap$/i }) {
  const wanted = new Map();
  for (const clone of plan?.clones || []) {
    for (const entity of clone.entities || []) {
      if (!maps.test(String(entity.map)) || !inside(entity.position, centre, box)) continue;
      if (!wanted.has(entity.map)) wanted.set(entity.map, []);
      wanted.get(entity.map).push({ clone, entity });
    }
  }
  const out = [];
  for (const [map, items] of wanted) {
    const bytes = await read(map).catch(() => null);
    if (!bytes) continue;
    let entities;
    try {
      entities = readMap(bytes).entities;
    } catch {
      continue;
    }
    for (const { clone, entity } of items) {
      const found = entities[entity.index];
      /* Номер из описи — та же вещь: хеш имени совпал. Иначе карту переставили, и вещь пропускаем. */
      const hash = (clone.archetype ?? joaatName(clone.archetypeName)) >>> 0;
      if (!found || found.archetype >>> 0 !== hash) continue;
      out.push({
        model: clone.archetypeName,
        at: clone.modelAt,
        position: found.position,
        rotation: found.rotation,
        scaleXY: found.scaleXY,
        scaleZ: found.scaleZ,
        tint: found.tintValue,
        ...(sheetAt && clone.txd ? { sheet: sheetAt(clone.txd) || undefined } : {}),
        prop: true,
      });
    }
  }
  return out;
}
