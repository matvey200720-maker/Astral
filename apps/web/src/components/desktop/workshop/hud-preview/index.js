/*
 * Точка входа общего двумерного окна предпросмотра.
 *
 * Редакторам нужен один компонент. Всё остальное здесь — для тех, кто считает
 * геометрию сам: холст обязан знать, где под слоем оказался кадр, а редактор с
 * якорями — где в кадре угол безопасной зоны.
 */

export { default as HudPreviewWindow } from "./HudPreviewWindow.jsx";
export { default } from "./HudPreviewWindow.jsx";
export {
  HUD_ANCHORS,
  HUD_ANCHOR_MARGIN,
  HUD_DEFAULT_DESIGN,
  HUD_SAFE_INSET,
  HUD_SCREENS,
  hudAnchor,
  hudAnchorRect,
  hudCoverRect,
  hudLayerRect,
  hudSafeRect,
  hudSize,
  loadHudScene,
  normalizeHudSource,
  normalizeHudSources,
  validHudScene,
} from "./hud-frame.js";
export {
  HUD_MATTE_SCENE,
  HUD_RANGE_FRAME,
  HUD_SCENES,
  HUD_STREET_SCENE,
} from "./hud-scenes.js";
export {
  MINIMAP_FIELD_FALLBACK,
  MINIMAP_FIELD_TILE,
  MINIMAP_FIELD_TILE_GAME,
  MINIMAP_RADAR_FIELD,
  loadMinimapField,
} from "./hud-map-field.js";
