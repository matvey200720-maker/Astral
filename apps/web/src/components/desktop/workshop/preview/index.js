/*
 * Точка входа общего окна предпросмотра.
 *
 * Редакторам нужен один компонент; всё остальное здесь — для тех, кто строит
 * сцену: расчёт света по таймциклу пригождается, когда содержимое сцены само
 * зависит от времени суток (фонари на дороге, прожекторы арены), а профили
 * качества — когда редактор решает, сколько геометрии он вообще соберёт.
 */

export { default as PreviewWindow } from "./PreviewWindow.jsx";
export { default } from "./PreviewWindow.jsx";
export { previewLighting, normalizeHour } from "./preview-lighting.js";
export { loadPreviewAssets } from "./preview-assets.js";
export {
  createPreviewStage,
  QUALITY_LEVELS,
  QUALITY_PROFILES,
} from "./preview-stage.js";
