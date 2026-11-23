/*
 * Где в зале арены стоит звезда — цель кадра обложки (26.10.2026, «арены один в один»).
 *
 * Владелец: кадр арены — «со стороны трибун, так, чтобы обязательно была видна звезда/модель автора в центре зала». Звезда автора — своя
 * сущность в его `v_int_62.ytyp` (у Blink x Skye анимированный `hatemod` на (−14,7,0,6), у Sakura — дерево `arena_tree` на (−16,6,0)),
 * штатная — `v_62_fos_props01` у входа. Расстановка зала (`arena-hall-model.js`) уже знает все сущности; здесь выбирается та, что
 * заменила звезду.
 *
 * Выбор (по порядку):
 *   • у Majestic — `slot`: статуя штатной витрины (`mj_ma_int3_rm4_racer` в стеклянном цилиндре `mj_ma_int3_rm4_glass_vitrine`), которую мод заменил своей
 *     моделью под тем же именем (12.11.2026, ALLIANCE V3: статуя на постаменте в стеклянном цилиндре — центр ролика автора). Цель — настоящее место модели
 *     по границам её сетки, а не по сущности;
 *   • мод заменил штатную звезду (`v_62_fos_props01`) своей моделью под тем же именем — цель: место штатной статуи (28.10.2026: у Tiffany звездой
 *     выбирался стул `v_ilev_chair02_ped`, у Barbie — телевизор, а кукла в коробке и помада — в «реквизите зала», что заменил автор);
 *   • своя модель автора (имени нет среди штатных файлов арены, деталь от мода) в пределах `REACH` м от места звезды мода — ближайшая;
 *   • штатная звезда, если мод её не спрятал пустой моделью и карта её ставит;
 *   • звезды нет — место звезды мода (середина зала): кадр всё равно смотрит туда, там и стояла статуя.
 *
 * Место своей модели — по её границам (`piece.bounds`, `arena-bounds.js`), когда они известны: у запечённых моделей автора сущность стоит в (0; 0; 0), и по её
 * позиции звездой выбиралась первая же модель, а камера смотрела в пустой воздух над входом (ALLIANCE V3: статуи стоят в 31 м от этой точки).
 */

import { arenaServerInventory } from "@modovik/climb-contract/recolor/arenas";
import { ARENA_STOCK_NAMES } from "@modovik/rpf-inspector/arena-stock-names";

import { boundsCentre, boundsSize, placedBounds } from "./arena-bounds.js";

const STAR_MODEL = "v_62_fos_props01";
/* Свои модели автора дальше этого от места звезды мода (по горизонтали, м) звездой не считаются: кресла, вывески, оболочка. */
const REACH = 14;

const stemOf = (name) =>
  String(name || "")
    .toLowerCase()
    .split("/")
    .pop()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/\+(hi|hidr|hifr)$/, "");
const STOCK_STEMS = new Set([...ARENA_STOCK_NAMES].map(stemOf));

/**
 * @param {{ pieces?: object[], placements?: object[] }} manifest расстановка зала (`pieces[].stem/overlay`, `placements[].piece/position`)
 * @param {{ hidden?: string[], place?: number[], stock?: Set<string>, stockModel?: string|null, reach?: number, slot?: string|null }} [options] `hidden` — пустые модели мода
 *   (`arena-blank.js`), `place` — место звезды мода; `stock` — штатные имена сервера (не звезда автора), `stockModel` — штатная звезда (у Majestic её нет),
 *   `reach` — как далеко от `place` ищется своя модель автора, `slot` — штатная модель, чья замена автором и есть звезда (Majestic: статуя витрины);
 *   деталь с `sameAsStock` (файл мода байт в байт как у сервера) слот не заменяет
 * @returns {{ at: number[], from: "mod"|"stock"|"none", model: string, piece?: number, size?: number, bounds?: { min: number[], max: number[] } }} `piece` — номер детали
 *   в расстановке (по нему меряется модель), `bounds` и `size` — границы и наибольший размер модели в зале, когда они известны
 */
export function arenaStarTarget(
  manifest,
  {
    hidden = [],
    place = arenaServerInventory("gta5rp")?.star?.local || [-16.283, 5.295, -0.394],
    stock = STOCK_STEMS,
    stockModel = STAR_MODEL,
    reach: radius = REACH,
    slot = null,
  } = {},
) {
  const pieces = manifest?.pieces || [];
  const placements = manifest?.placements || [];
  const gone = new Set(hidden.map(stemOf));
  /* Деталь в зале: границы после размещения (если известны границы модели) — иначе только сущность. */
  const boxOf = (entity) => placedBounds(pieces[entity.piece]?.bounds, entity);
  const centreOf = (entity) => {
    const box = boxOf(entity);
    return box ? boundsCentre(box) : [entity.position.x, entity.position.y, entity.position.z];
  };
  const measured = (entity) => {
    const box = boxOf(entity);
    return box ? { size: Math.round(boundsSize(box) * 100) / 100, bounds: box } : {};
  };
  const at = centreOf;
  const turned = (entity) => (entity.rotation ? { rotation: [entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w] } : {});
  const reach = (entity) => {
    const [x, y] = centreOf(entity);
    return Math.hypot(x - place[0], y - place[1]);
  };
  /* Штатная витрина Majestic: автор заменил статую своей — это и есть звезда, где бы в зале она ни стояла. */
  const slotted = slot ? placements.find((entity) => pieces[entity.piece]?.stem === slot) : null;
  const slotPiece = slotted ? pieces[slotted.piece] : null;
  if (slotPiece?.overlay && !slotPiece.stub && !slotPiece.sameAsStock && !gone.has(slot))
    return { at: centreOf(slotted), from: "mod", model: slot, piece: slotted.piece, slot: true, ...turned(slotted), ...measured(slotted) };
  /* Мод заменил штатную звезду (`v_62_fos_props01`, у Tiffany и Barbie — своя модель под тем же именем): это и есть звезда автора. Модель у штатной —
     «реквизит зала» шириной в сорок метров, звезда в нём стоит на месте штатной статуи (`place`), поэтому целью кадра служит оно, а не центр модели. */
  const kept = stockModel ? placements.find((entity) => pieces[entity.piece]?.stem === stockModel) : null;
  if (kept && pieces[kept.piece]?.overlay && !pieces[kept.piece]?.stub && !gone.has(stockModel))
    return { at: [...place], from: "mod", model: stockModel, piece: kept.piece, replaced: true };
  let best = null;
  for (const entity of placements) {
    const piece = pieces[entity.piece];
    if (!piece?.overlay || piece.stub || stock.has(piece.stem) || gone.has(piece.stem)) continue;
    const distance = reach(entity);
    if (distance <= radius && (!best || distance < best.distance)) best = { distance, entity, model: piece.stem };
  }
  if (best) return { at: at(best.entity), from: "mod", model: best.model, piece: best.entity.piece, ...turned(best.entity), ...measured(best.entity) };
  if (kept && !pieces[kept.piece]?.stub && !gone.has(stockModel)) return { at: at(kept), from: "stock", model: stockModel, piece: kept.piece, ...turned(kept) };
  return { at: [...place], from: "none", model: "" };
}

/**
 * Наибольший размер модели (м) по её GLB — по границам вершин; `null`, если не прочиталось. Звезда автора бывает разной: у штатной 5 м,
 * у Blink x Skye `hatemod` — табличка 0,7 м, и кадр с одного расстояния для обеих не годится (`arena-star-frames.js`).
 */
export function glbSize(glb) {
  try {
    const bytes = Buffer.from(glb);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    let size = 0;
    for (const mesh of json.meshes || [])
      for (const primitive of mesh.primitives || []) {
        const { min, max } = json.accessors?.[primitive.attributes?.POSITION] || {};
        if (min && max) size = Math.max(size, ...max.map((value, axis) => value - min[axis]));
      }
    return size > 0 ? Math.round(size * 100) / 100 : null;
  } catch {
    return null;
  }
}
