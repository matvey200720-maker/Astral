export { WORLD_MAP_SCHEMA_VERSION, WORLD_MAP_LIMITS, BLEND_MODES, mapObjectId } from "./model/values.js";

export {
  DEFAULT_BASE,
  BASE_LAYERS,
  BASE_RENDER_MODES,
  baseRendersVector,
  LABEL_FONTS,
  LABEL_WEIGHTS,
  EMBLEM_FONTS,
  GROUP_OUTLINE_MAX,
  ZONE_FILL_MODES,
  ZONE_STROKE_ALIGNS,
  DEFAULT_ZONES,
  DEFAULT_MARKER_SECTION,
  DEFAULT_BRUSH,
  STROKE_LINES,
  STROKE_ARROWS,
  STROKE_KINDS,
  DEFAULT_PAINT,
  DEFAULT_EMBLEMS,
  EXPORT_GENERATION,
  DEFAULT_EXPORT,
  MAP_DETAIL_LEVELS,
  MAP_TILE_SIDE_LIMIT,
  PAUSE_MAP_GAME_SEA,
  PAUSE_MAP_OVERLAY_MODES,
  DEFAULT_PAUSE_MAP,
  RADAR_MODES,
  DEFAULT_RADAR,
  DEFAULT_RADAR_TILT,
  VOLUME_HEIGHT_RANGE,
  RADAR_BIGMAP_STOCK_FIELDS,
  RADAR_CAR_COPY,
  RADAR_TILT_FIELDS,
  RADAR_TILT_STRENGTH,
  RADAR_TINT_RANGE,
  RADAR_TEXT_SCALE_RANGE,
  DEFAULT_MARKER_OUTLINE,
  DEFAULT_MARKER_GLOW,
  OWN_GLYPH_LIMITS,
} from "./model/defaults.js";

export {
  WORLD_MAP_TEMPLATES,
  WORLD_MAP_VIEWS,
  WORLD_MAP_TEMPLATE_GROUPS,
  WORLD_MAP_TEMPLATE_MAP,
} from "./model/templates.js";

export {
  worldMapDiffersFromGame,
  radarPlan,
  pauseMapPlan,
  pauseTileSea,
  pauseMapInstallPlan,
} from "./model/plans.js";

export { normalizeWorldMap, mapStyleActive, createWorldMapConfig } from "./model/world.js";

export { normalizeRadarTilt, radarCarFields } from "./model/radar-tilt.js";

export {
  applyWorldMapTemplate,
  applyMapTemplate,
  applyZoneTemplate,
  applyServerPreset,
  defaultMarkerItems,
  STARTER_MAP_TEMPLATE,
  createStarterWorldMap,
  createDefaultWorldMap,
} from "./model/apply.js";
