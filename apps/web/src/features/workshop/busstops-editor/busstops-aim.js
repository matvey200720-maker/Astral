/*
 * «Щёлкнул по детали — правишь её» в кадре «Остановок» (ТЗ 18.10.2026,
 * Session 2, задача 2). Попадание кадра (`orbit-stage.js`) несёт запись
 * материала сцены: `info.type` — вид остановки, `info.group` — часть
 * (`frame`, `poster`, `glass`, `light`).
 *
 * Чистые данные, без React и three: их берут кадр (что подсвечивать при
 * наведении), студия (что открыть) и тест.
 */

import { BUSSTOP_PART_IDS, findBusStopType } from "@modovik/climb-contract/recolor/busstops";

/* Части остановки правятся одним инструментом — «Цвет и текстура»: у каждой в нём свой раздел. */
export const BUSSTOP_PART_TOOL = "paint";

/**
 * Что открыть по щелчку: `{ tool, target, part }` — инструмент, вкладка вида
 * и часть (её раздел в колонке правок), либо `null` — править нечего.
 */
export function busStopAimTarget(hit) {
  const info = hit?.info;
  if (!info) return null;
  const type = findBusStopType(info.type);
  /* Часть правится, только если она есть у этого вида: светильник — у навеса с подсветкой, у знака — один каркас. */
  if (!type || !BUSSTOP_PART_IDS.includes(info.group) || !type.parts.includes(info.group)) return null;
  return { tool: BUSSTOP_PART_TOOL, target: type.id, part: info.group };
}

/**
 * Что подсветить: часть `part` у вида `target`; у вкладки «Все» — эта часть
 * у всех видов сразу, как и правка на ней.
 */
export function busStopPartSpec(target, part) {
  return { where: (info) => info.group === part && (target === "all" || info.type === target) };
}
