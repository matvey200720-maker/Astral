/*
 * Выбор щелчком в «Интерьерах» (18.10.2026, Session 2, задача 2): что правится
 * под курсором в кадре помещения и в кадре места снаружи. Без React и three —
 * чистые функции над записями сцены, их же зовут `aimTarget`, `onAim` и
 * подсветка выбранного.
 *
 * Изнутри цель — поверхность «Цвета и блеска»: стена, пол, потолок или вещь
 * (прилавок, полки, мебель, техника). Вещь узнаётся по сущности её части
 * сцены, оболочка — по `surface` в записи материала. Снаружи цель — часть
 * места (`part`: стены, навес, площадка, вывески) или часть колонки АЗС
 * (`pump` и `pumpPart`).
 */

import { shopInterior, shopSurfacesOf } from "@modovik/climb-contract/recolor/shops";
import { OUTSIDE_PART_IDS, PUMP_PART_IDS } from "@modovik/climb-contract/recolor/shops-outside";
import { itemSurfaceOf } from "./shops-text.js";

/* Запись материала и часть сцены под попаданием: щелчок отдаёт и номера, и готовую запись. */
function recordsOf(asset, hit) {
  const info = Number.isInteger(hit?.material) ? asset?.materials?.[hit.material] || hit.info || null : hit?.info || null;
  const part = Number.isInteger(hit?.part) ? asset?.parts?.[hit.part] || null : null;
  return { info, part };
}

/**
 * Поверхность помещения у сетки: вещь — по сущности части (её поверхность,
 * если у помещения она правится), оболочка — по записи материала. `null` —
 * править нечего (грязь, стёкла, неправимая вещь).
 */
export function shopMeshSurface(interiorId, part, info) {
  const interior = shopInterior(interiorId);
  if (!interior) return null;
  if (part && interior.items.some((item) => item.index === part.entity)) return itemSurfaceOf(interiorId, part.entity);
  const surface = info?.surface;
  return surface && shopSurfacesOf(interiorId).some((entry) => entry.id === surface) ? surface : null;
}

/** Что правится под попаданием изнутри: `{ surface }` или `null`. */
export function shopAimTarget(interiorId, asset, hit) {
  if (!hit) return null;
  const { info, part } = recordsOf(asset, hit);
  const surface = shopMeshSurface(interiorId, part, info);
  return surface ? { surface } : null;
}

/**
 * Подсветка поверхности помещения: все сетки, что в кадре красятся её
 * настройками (оболочка с таким `surface` и части-вещи этой поверхности).
 */
export function shopSurfaceSpec(interiorId, asset, surface) {
  if (!surface) return null;
  return {
    where: (info, mesh) => shopMeshSurface(interiorId, asset?.parts?.[mesh?.userData?.part], info) === surface,
  };
}

/**
 * Что правится под попаданием снаружи: `{ tool: "pumps", part }` у колонки
 * заправки (только у заправок), `{ tool: "parts", part }` у части места.
 */
export function outsideAimTarget(kind, asset, hit) {
  if (!hit) return null;
  const { info } = recordsOf(asset, hit);
  if (!info) return null;
  if (info.pump) return kind === "gas" ? { tool: "pumps", part: PUMP_PART_IDS.includes(info.pumpPart) ? info.pumpPart : null } : null;
  return OUTSIDE_PART_IDS.includes(info.part) ? { tool: "parts", part: info.part } : null;
}

/**
 * Подсветка части места или колонки: сетки с тем же `part` (колонки — с тем
 * же `pump` и `pumpPart`; у колонки без части — все её листы).
 */
export function outsidePartSpec(target) {
  if (!target?.tool) return null;
  if (target.tool === "pumps") return { where: (info) => Boolean(info?.pump) && (!target.part || info.pumpPart === target.part) };
  if (!target.part) return null;
  return { where: (info) => Boolean(info) && !info.pump && info.part === target.part };
}
