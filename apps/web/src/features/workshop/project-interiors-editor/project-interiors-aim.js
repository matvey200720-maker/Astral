/*
 * Щелчок по кадру «Интерьеров проектов» (18.10.2026, Session 2, задача 2):
 * поверхность под курсором — та, что красит «Цвет и блеск».
 *
 * Поверхность листа кадру говорит запись материала сцены (`info.surface`: стены,
 * пол, потолок, мебель и вещи): её проставляет главный процесс только листам
 * самого интерьера, что красит установщик (`project-interiors/scene.js`).
 * Штатные вещи игры, зеркала, тени-наклейки и свечение поверхности не имеют —
 * по ним щелчок ничего не выбирает и ничего не подсвечивает.
 *
 * Чистые функции, без React и three: ими пользуются и щелчок, и подсветка.
 */

import { PROJECT_SURFACES } from "@modovik/climb-contract/recolor/project-interiors";

const SURFACE_IDS = new Set(PROJECT_SURFACES.map((surface) => surface.id));

/** Поверхность под попаданием кадра (`'walls'`, `'floor'`…) или `null` — править нечего. */
export function interiorAimSurface(hit) {
  const surface = hit?.info?.surface;
  return typeof surface === "string" && SURFACE_IDS.has(surface) ? surface : null;
}

/**
 * Что подсветить для поверхности: все листы с ней — правка ложится на каждый.
 * `null` — поверхность не названа.
 */
export function interiorSurfaceSpec(surface) {
  if (!surface || !SURFACE_IDS.has(surface)) return null;
  return { where: (info) => info?.surface === surface };
}
