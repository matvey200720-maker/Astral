/*
 * Щелчок по кадру зон каптов (18.10.2026, Session 2, задача 2): какую зону
 * назвала шайба под курсором и какой инструмент открыть.
 *
 * Шайбу рисует объект кадра, сетки сцены описи спрятаны: под ней нечего
 * выбирать, кроме неё самой. Поэтому корень объекта называется правимой вещью
 * (`userData.pick`, см. `captZonePick`), а кадр отдаёт эти данные редактору в
 * `hit.pick`. «Все зоны» — обзор четырнадцати шайб: щелчок выбирает зону, и
 * кадр подлетает к ней, как при выборе над кадром.
 *
 * Чистые функции, без React и three: ими пользуются и кадр, и редактор.
 */

import { findCaptZone } from "@modovik/climb-contract/recolor/capt-zones";

export const CAPT_ZONE_PICK = "capt-zone";

/** Что объект шайбы называет своим: `{ kind, id }` — в `object.userData.pick`. */
export const captZonePick = (zone) => ({ kind: CAPT_ZONE_PICK, id: zone.id });

/** Зона под попаданием кадра: `{ zone: id }` или `null` — это не шайба. */
export function captZoneAimTarget(hit) {
  const pick = hit?.pick;
  if (pick?.kind !== CAPT_ZONE_PICK) return null;
  const zone = findCaptZone(pick.id);
  return zone ? { zone: zone.id } : null;
}

/**
 * Описание для кадра (`aimTarget`): править есть что, а подсвечивать сетки
 * нечем — шайба нарисована объектом, и рамка у неё своя. `null` — править нечего.
 */
export const captZoneAimSpec = (hit) => (captZoneAimTarget(hit) ? { none: true } : null);

/**
 * Инструмент, что откроет щелчок: «Вид» (в нём прозрачность зоны — у зоны
 * она своя) остаётся «Видом», остальные уступают «Цвету» (18.10.2026:
 * прозрачность, свечение, стенка и дальность — одна вкладка).
 */
export const captZoneAimTool = (tool) => (tool === "look" || tool === "opacity" ? "look" : "colour");
