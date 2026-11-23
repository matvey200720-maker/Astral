/*
 * «Щёлкнул по детали — правишь её» в кадре «Будок» (задача 11 ТЗ 18.10.2026).
 * Попадание кадра (`orbit-stage.js`) несёт запись материала сцены:
 * `info.type` — будка (`hut1`, `hut2`), `info.group` — часть (`body`,
 * `canopy`, `frame`, `roof`, `signs`, `notices`, `glass`, `floor`; `fixed` —
 * то, что правке не поддаётся: замок, постеры на стенах, лампа, стойка).
 *
 * Чистые данные, без React и three: их берут кадр (что подсвечивать при
 * наведении), студия (что открыть) и тест.
 */

import { BOOTH_PART_IDS, findBoothType } from "@modovik/climb-contract/recolor/busstop-booths";

/* Части будки правятся одним инструментом — «Цвет и текстура»: у каждой в нём свой раздел. */
export const BOOTH_PART_TOOL = "paint";

/**
 * Что открыть по щелчку: `{ tool, target, part }` — инструмент, вкладка
 * будки и часть (её раздел в колонке правок), либо `null` — править нечего.
 */
export function boothAimTarget(hit) {
  const info = hit?.info;
  if (!info) return null;
  const type = findBoothType(info.type);
  if (!type || !BOOTH_PART_IDS.includes(info.group) || !type.parts.includes(info.group)) return null;
  return { tool: BOOTH_PART_TOOL, target: type.id, part: info.group };
}

/**
 * Что подсветить: часть `part` у будки `target`; у вкладки «Обе» — эта часть
 * у обеих будок сразу, как и правка на ней.
 */
export function boothPartSpec(target, part) {
  return { where: (info) => info.group === part && (target === "all" || info.type === target) };
}
