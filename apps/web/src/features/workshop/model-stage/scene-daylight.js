/*
 * Свет без оттенка (13.11.2026, ALLIANCE V3): свет кадра зала арены тёплый — он подобран по кадрам игры у залов GTA 5 RP, — а у Majestic автор берёт чёрные и серые
 * материалы и нейтральный таймцикл, и тёплый свет красил их коричневым. Сцена с отметкой `neutralLight` (зал Majestic, `arena-hall-scene.js`) светится белым и серым:
 * цвета источников заменяются, силы и экспозиция остаются.
 */
export const NEUTRAL_DAYLIGHT = Object.freeze({ sunColour: "#ffffff", fillColour: "#ffffff", skyColour: "#ffffff", groundColour: "#555555" });

/** Свет кадра для сцены `asset`: у сцены с `neutralLight` — без оттенка, у остальных тот же объект. */
export function daylightFor(asset, daylight) {
  return asset?.neutralLight === true && daylight ? { ...daylight, ...NEUTRAL_DAYLIGHT } : daylight;
}
