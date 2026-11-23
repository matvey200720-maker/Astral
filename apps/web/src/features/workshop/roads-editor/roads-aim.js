/*
 * «Щёлкнул по детали — правишь её» в кадре «Дорог» (ТЗ 18.10.2026, Session 2,
 * задача 2). Участок в кадре — постановочный: у каждой краски свой материал,
 * `info.group` называет его (`ROAD_STAGE_SHEETS` в `roads-sheets.js`):
 *   asphalt, dirt, kerb, sidewalk — покрытия;
 *   markings — лист разметки (жёлтые и белые линии вместе),
 *   crossing, stops, coloured, parking — переход, стоп-линия со стрелками,
 *   цветная краска и парковка: по группе разметки на каждый;
 *   grid — сетка пола, править нечего.
 *
 * Чистые данные, без React и three (лист кадра и его пиксели сюда не нужны):
 * их берут кадр (что подсвечивать при наведении), студия (что открыть) и тест.
 */

import { ROAD_MARKING_GROUPS } from "@modovik/climb-contract/recolor/roads";

/* Покрытия → инструмент: бордюр красится вместе с тротуаром («Тротуары»), как и в колонке правок. */
const SURFACE_TOOLS = Object.freeze({
  asphalt: "asphalt",
  dirt: "dirt",
  kerb: "sidewalk",
  sidewalk: "sidewalk",
  /* Лист разметки несёт и жёлтые, и белые линии: какую из двух задели, по материалу не сказать — открывается «Разметка» целиком. */
  markings: "markings",
});
/* Материалы кадра, что называются группой разметки договора: у них свой раздел в «Разметке». */
const MARKING_GROUPS = new Set(ROAD_MARKING_GROUPS.map((group) => group.id));

/**
 * Что открыть по щелчку: `{ tool, group, section }` — инструмент, материал
 * кадра под курсором и раздел колонки правок (`data-roads-section`; пусто —
 * открыть инструмент без раздела), либо `null` — править нечего (сетка пола).
 */
export function roadAimTarget(hit) {
  const group = hit?.info?.group;
  if (typeof group !== "string") return null;
  if (MARKING_GROUPS.has(group)) return { tool: "markings", group, section: `markings-${group}` };
  const tool = SURFACE_TOOLS[group];
  if (!tool) return null;
  return { tool, group, section: tool === "markings" ? "" : `${tool}-surface` };
}

/**
 * Что подсветить: покрытия инструмента целиком (у «Тротуаров» — тротуар и
 * бордюр) или один материал разметки — тот, по которому щёлкнули.
 */
export function roadSurfaceSpec({ tool, group }) {
  if (tool === "markings") return { where: (info) => info.group === group };
  return { where: (info) => SURFACE_TOOLS[info.group] === tool };
}
