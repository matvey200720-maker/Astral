/*
 * Щелчок по детали завода (18.10.2026, Session 2, задача 2): что правится под
 * курсором и что подсвечивать. Без React и three — тесты идут на чистых данных.
 *
 * Запись материала сцены (`hit.info`) знает группу завода — корпуса, земля,
 * контейнеры, реквизит — и имя листа; группа и есть инструмент («Корпуса»,
 * «Земля», «Контейнеры», «Реквизит»). У корпусов ещё часть: стены, крыши,
 * бетон, металл, конвейеры, детали — её выбирает поле «Часть корпуса» в
 * колонке, и щелчок ставит его на часть нажатой детали.
 */

import { FACTORY_GROUPS, factoryLayerOf, factoryPartOf } from "@modovik/climb-contract/recolor/factory";

const GROUPS = new Set(FACTORY_GROUPS.map((group) => group.id));

/*
 * Часть корпуса у листа — так, как её видит облик в кадре. Грязь (`overlay`)
 * идёт за стенами, вывески и граффити — за деталями (`factoryLayerLook`); у
 * остальных листов — часть по смыслу листа.
 */
export function factoryAimPart(info) {
  const layer = factoryLayerOf(info?.texture);
  if (layer === "overlay") return "walls";
  if (layer) return "details";
  return factoryPartOf(info?.texture);
}

/**
 * Что открыть по щелчку: `{ tool, part?, focus? }` или `null` — править нечего
 * (мимо модели завода, рельеф и лист без группы). `focus: "graffiti"` — щёлкнули
 * по граффити: колонка подводит к их переключателю.
 */
export function factoryAimTarget(hit) {
  const info = hit?.info;
  if (!info || !GROUPS.has(info.group)) return null;
  if (info.group !== "buildings") return { tool: info.group };
  const part = factoryAimPart(info);
  return { tool: "buildings", part, ...(factoryLayerOf(info.texture) === "graffiti" ? { focus: "graffiti" } : { focus: "part" }) };
}

/**
 * Описание подсветки для общего кадра: у корпусов — выбранная часть, у остальных
 * групп — вся группа. Инструмент без деталей в кадре (эмблемы, модели, шаблоны) —
 * `null`: подсвечивать нечего.
 */
export function factoryAimSpec(tool, part = "") {
  if (tool === "buildings") return { where: (info) => info?.group === "buildings" && (!part || factoryAimPart(info) === part) };
  if (GROUPS.has(tool)) return { where: (info) => info?.group === tool };
  return null;
}
