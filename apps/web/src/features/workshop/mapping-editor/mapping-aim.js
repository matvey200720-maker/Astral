/*
 * Щелчок по месту маппинга (18.10.2026, Session 2, задача 2): что правится под
 * курсором и что подсвечивать. Без React и three — тесты идут на чистых данных.
 *
 * В кадре одно место со своим соседством. Запись материала сцены (`info.group`)
 * называет, чьё оно: id места (ферма, база байкеров, самолёт, парковка, хлам
 * вокруг), `stock` — штатная модель места из игры игрока, `keep` — лист игры,
 * который маппинг не красит. Место красит «Цвет» — туда и ведёт щелчок; хлам
 * вокруг (`props`) у ферм и баз — своё место списка, и щелчок по нему берёт его.
 */

import { findMappingLocation } from "@modovik/climb-contract/recolor/mapping";
import { isRingMaterial } from "../model-stage/ring-fade.js";

/**
 * Чьё место у записи материала: id места или `null` (лист игры, постороннее).
 * `current` — место в кадре: штатные модели (`stock`) — его; у парковки штатное
 * лишь соседство, красятся только стены (`group: "carpark"`).
 */
export function mappingAimLocation(info, current) {
  if (!info) return null;
  if (info.group === "stock") return current && !findMappingLocation(current)?.stockEdit ? current : null;
  return findMappingLocation(info.group)?.id || null;
}

/** Что открыть по щелчку: `{ tool: "look", location }` («Облик» — цвет этого места) или `null` — править нечего. */
export function mappingAimTarget(hit, current) {
  const location = mappingAimLocation(hit?.info, current);
  return location ? { tool: "look", location } : null;
}

/**
 * Описание подсветки места `location` в сцене кадра `asset`. Если всё, что в
 * кадре, и есть это место, подсвечивать нечего (штрихи легли бы на всё и
 * закрыли цвет, который человек как раз подбирает) — `{ none: true }`: править
 * есть что, а выделять нечем.
 */
export function mappingAimSpec(asset, location, current) {
  const matches = (info) => mappingAimLocation(info, current) === location;
  /* Круг мира вокруг места (`surround`) — фон: «в кадре только это место» верно и с ним. */
  const partial = asset?.meshes?.some((mesh) => {
    const info = asset.materials?.[mesh.material];
    return !matches(info) && !isRingMaterial(info);
  });
  return partial ? { where: matches } : { none: true };
}
