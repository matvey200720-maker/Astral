// Погода обложки таймцикла части: чистая функция без WebGL и игры — её читают и кадр квартала (`sky-quarter-cover.js`), и петля с кадрами шейдера (`shooter-service.js`).
import { PREVIEW_WEATHER } from "@modovik/timecycle";

/*
 * Погоды, на которых обложка может сниматься, по приоритету. Только ясные: облака кадра квартала всегда ясного набора (`previewClouds` зовётся без плана),
 * и цвет неба FOGGY, OVERCAST, RAIN или THUNDER лёг бы под тучи другой погоды.
 */
export const COVER_WEATHERS = Object.freeze(["CLEAR", "EXTRASUNNY", "CLOUDS", "SMOG"]);

/**
 * Погода обложки — из ясных, что тронул автор, по приоритету `COVER_WEATHERS` (а не по порядку файлов части): обложка снималась только в EXTRASUNNY, а автор
 * правил w_clear или w_smog, и она получала штатное небо игры. Из ясных автор ничего не тронул или проекта нет — ясный день игрока, как раньше.
 */
export function coverWeather(project) {
  const touched = Object.keys(project?.weathers || {});
  return COVER_WEATHERS.find((name) => touched.includes(name)) || PREVIEW_WEATHER;
}
