/*
 * «Щёлкнул по детали — правишь её» в кадре «Банкоматов» (ТЗ 18.10.2026,
 * Session 2, задача 2). Попадание кадра (`orbit-stage.js`) несёт запись
 * материала сцены: `info.type` — модель банкомата, `info.group` — часть
 * (`body`, `frame`, `metal`, `panel`, `keyboard`, `screen`, `sign`, `strip`,
 * `lamp`, `glass`; `fixed` — то, что правке не поддаётся, `wall` —
 * постановочная стена за настенными).
 *
 * Чистые данные, без React и three: их берут кадр (что подсвечивать при
 * наведении), студия (что открыть) и тест.
 */

import { ATM_PART_IDS, findAtmType } from "@modovik/climb-contract/recolor/atms";

/*
 * Инструмент, которым правится часть. Те же две группы, что в колонке правок
 * (`AtmsInspector`): корпус, рамка, металл, панель, клавиатура и стекло —
 * «Корпус и панель»; экран, вывеска, полоса логотипов и лампа — «Экран и вывеска».
 */
export const ATM_PART_TOOLS = Object.freeze({
  body: "paint",
  frame: "paint",
  metal: "paint",
  panel: "paint",
  keyboard: "paint",
  glass: "paint",
  screen: "screen",
  sign: "screen",
  strip: "screen",
  lamp: "screen",
});

/**
 * Что открыть по щелчку: `{ tool, target, part }` — инструмент, вкладка
 * модели и часть (её раздел в колонке правок), либо `null` — править нечего
 * (рельеф «как в игре», стена за банкоматом).
 */
export function atmAimTarget(hit) {
  const info = hit?.info;
  if (!info) return null;
  const tool = ATM_PART_TOOLS[info.group];
  const type = findAtmType(info.type);
  /* Часть правится, только если она есть у этой модели: у тумбы нет рамки и панели. */
  if (!tool || !ATM_PART_IDS.includes(info.group) || !type?.parts.includes(info.group)) return null;
  return { tool, target: type.id, part: info.group };
}

/**
 * Что подсветить: часть `part` у модели `target`; у вкладки «Все» — эта часть
 * у всех моделей сразу, как и правка на ней.
 */
export function atmPartSpec(target, part) {
  return { where: (info) => info.group === part && (target === "all" || info.type === target) };
}
