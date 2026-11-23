import { findObject, patchObject } from "../world-map-editing.js";

/*
 * Цвет всего выделенного разом (задача 36 ТЗ 19.10.2026: «у каждого значка свой цвет — и всех разом»).
 *
 * Выбранные объекты — значки, подписи, зоны, мазки, надписи — получают один цвет: значок — свой (у подписи без
 * значка красится и сам текст), зона — границу и заливку (если у заливки был свой цвет, он идёт с границей), мазок и
 * надпись — свой. Картинки цвета не имеют — их пропускают. Цвет каждого объекта по отдельности — на его панели.
 */
export function recolourObjects(config, targets, colour) {
  let next = config;
  for (const target of targets || []) {
    const object = findObject(next, target);
    if (!object) continue;
    if (target.kind === "zone")
      next = patchObject(next, target, { color: colour, ...(object.fillColor ? { fillColor: colour } : null) });
    else if (target.kind === "marker")
      next = patchObject(next, target, { color: colour, ...(object.dot ? null : { labelColor: colour }) });
    else if (target.kind === "stroke") next = patchObject(next, target, { color: colour });
    else if (target.kind === "emblem" && object.kind === "text") next = patchObject(next, target, { color: colour });
  }
  return next;
}

/** Сколько из выделенного красится (картинки не в счёт) — чтобы не показывать кнопку цвета, когда красить нечего. */
export const recolourable = (config, targets) =>
  (targets || []).filter((target) => {
    const object = findObject(config, target);
    return object && (target.kind !== "emblem" || object.kind === "text");
  }).length;
