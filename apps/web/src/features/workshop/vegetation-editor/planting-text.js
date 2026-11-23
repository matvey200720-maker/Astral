/*
 * Засаженность в словах и числах (ТЗ 11.10.2026): сколько встанет деревьев
 * вдоль дорог, на разделительных полосах, клумб и рощ при выбранной ступени
 * — по плану посадки (`VEGETATION_PLANTING`, счёт по районам и ступеням) и
 * описи мира (деревья Rockstar для рощ).
 */

import {
  VEGETATION_PLANTING,
  VEGETATION_WORLD,
  densityForestsIn,
} from "@modovik/climb-contract/recolor/vegetation";
import { trFill } from "../../../locales/tr-fill.js";

const ROAD_ROLES = Object.freeze(["row", "minor", "back"]);

/* Места роли в районе до ступени `value` (десятки процентов). */
function upTo(area, role, value) {
  const buckets = VEGETATION_PLANTING.counts?.[area]?.[role] || [];
  let sum = 0;
  for (
    let index = 0;
    index < Math.min(buckets.length, Math.round(value / 10));
    index += 1
  )
    sum += buckets[index];
  return sum;
}

/**
 * Сколько встанет при засаженности `density`: `{ roads, medians, shrubs,
 * beds, forests }` — деревьев рядов, деревьев и кустов полос, клумб и
 * деревьев рощ (≈, рощи — по числу деревьев Rockstar в картах районов).
 */
export function plantingCounts(density) {
  const out = { roads: 0, medians: 0, shrubs: 0, beds: 0, forests: 0 };
  if (!density?.value) return out;
  for (const area of density.areas || []) {
    if (density.roads !== false)
      for (const role of ROAD_ROLES)
        out.roads += upTo(area, role, density.value);
    if (density.medians !== false) {
      out.medians += upTo(area, "median", density.value);
      out.shrubs +=
        upTo(area, "shrub", density.value) + upTo(area, "edge", density.value);
      out.beds += upTo(area, "bed", density.value);
    }
    if (densityForestsIn(density, area))
      out.forests +=
        ((VEGETATION_WORLD.areas?.[area]?.trees || 0) * density.value) / 100;
  }
  out.forests = Math.round(out.forests);
  return out;
}

export const thousands = (value) =>
  Math.round(Number(value) || 0).toLocaleString("ru-RU");

/** Засаженность одной фразой — под кадром и в «что уедет в игру». */
export function plantingText(density) {
  const counts = plantingCounts(density);
  const parts = [];
  if (counts.roads)
    parts.push(trFill("≈ {0} деревьев рядами вдоль дорог", thousands(counts.roads)));
  if (counts.medians || counts.shrubs)
    parts.push(
      trFill("≈ {0} деревьев и кустов на разделительных полосах", thousands(counts.medians + counts.shrubs)),
    );
  if (counts.beds) parts.push(trFill("{0} клумб вдоль бордюров", thousands(counts.beds)));
  if (counts.forests)
    parts.push(
      trFill("ещё ≈ {0} деревьев рощами рядом с деревьями Rockstar", thousands(counts.forests)),
    );
  return parts.join(", ");
}
