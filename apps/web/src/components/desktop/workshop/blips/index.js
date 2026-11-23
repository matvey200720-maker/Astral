/*
 * Точка входа редактора значков и маршрута.
 *
 * Наружу нужен один компонент: реестр редакторов открывает его и больше про
 * значки ничего не знает. Модель и сцена экспортируются рядом — ими живут
 * тесты и они же понадобятся тому, кто однажды понесёт эти настройки в игру.
 */

export { default as BlipsStudio } from "./BlipsStudio.jsx";
export { default } from "./BlipsStudio.jsx";
export {
  BLIPS_RANGES,
  BLIP_EDGE_MODES,
  BLIP_GLYPHS,
  BLIP_KINDS,
  BLIP_SHAPES,
  blipKind,
  hexLuminance,
  relativeLuminance,
  createBlipsProject,
  defaultBlipsProject,
  describeBlipsProject,
  blipsProjectIsDefault,
  blipsProjectStats,
  parseBlipsProject,
  readableInk,
  serializeBlipsProject,
} from "./blips-model.js";
export {
  BLIP_SCENES,
  RADAR_ASPECT,
  RADAR_COVER,
  RADAR_ZOOMS,
  SCENE_BLIPS,
  SCENE_CENTRE,
  SCENE_ROUTE,
  atlasPoint,
  blipScene,
  fieldAligned,
  fieldBox,
  fieldFrame,
  northMark,
  placeBlip,
  placeScene,
  projectPoint,
  radarPlacement,
  radarTurn,
  radarView,
  routeArrowSize,
  routeArrows,
  routePath,
} from "./blips-scene.js";
export {
  BLIP_GLYPH_ART,
  BLIP_SHAPE_ART,
  blipGlyphArt,
  blipShapeArt,
  glyphMargin,
  outlineBand,
  personFigure,
} from "./blips-art.js";
export { default as BlipArt } from "./BlipArt.jsx";
export {
  blipContrast,
  contrastRatio,
  contrastVerdict,
  outlineShare,
  probeLuminance,
  sampleMapField,
} from "./blips-contrast.js";
