import { choice, color } from "./values.js";
import { normalizeRadarTilt } from "./radar-tilt.js";
import {
  DEFAULT_EXPORT,
  DEFAULT_PAUSE_MAP,
  DEFAULT_RADAR,
  EXPORT_GENERATION,
  MAP_DETAIL_LEVELS,
  PAUSE_MAP_OVERLAY_MODES,
  RADAR_MODES,
} from "./defaults.js";

const DETAIL_CHOICES = MAP_DETAIL_LEVELS.map((level) => level.value);
const RESOLUTION_CHOICES = [2048, 4096, 8192];
const FORMAT_CHOICES = ["bc1", "bc3"];
const SEA_CHOICES = ["game", "color"];
const BLUR_CHOICES = ["game", "off"];
const NO_FIELDS = Object.freeze({});

const asSource = (value) => (value && typeof value === "object" ? value : NO_FIELDS);

// Приведение прочитанных значений карты паузы: слово из списка либо цвет моря
const pauseWord = (list, fallback) => (raw) => choice(raw, list, fallback);
const pauseOverlays = pauseWord(PAUSE_MAP_OVERLAY_MODES, DEFAULT_PAUSE_MAP.overlays);
const pauseSea = pauseWord(SEA_CHOICES, DEFAULT_PAUSE_MAP.sea);
const pauseSeaColor = (raw) => color(raw, DEFAULT_PAUSE_MAP.seaColor);
const pauseBlur = pauseWord(BLUR_CHOICES, DEFAULT_PAUSE_MAP.blur);

export const normalizeExport = (value) => {
  const source = asSource(value);
  const picked = choice(Number(source.detail), DETAIL_CHOICES, DEFAULT_EXPORT.detail);
  const resolution = choice(Number(source.resolution), RESOLUTION_CHOICES, DEFAULT_EXPORT.resolution);
  const format = choice(source.format, FORMAT_CHOICES, DEFAULT_EXPORT.format);
  // Чёткость прежнего поколения заменяется заводской один раз: выбор держится только при поколении ровно 4
  const detail = source.generation === EXPORT_GENERATION ? picked : DEFAULT_EXPORT.detail;
  return { resolution, format, detail, generation: EXPORT_GENERATION };
};

export const normalizePauseMap = (value) => {
  const source = asSource(value);
  const overlays = pauseOverlays(source.overlays);
  const sea = pauseSea(source.sea);
  const seaColor = pauseSeaColor(source.seaColor);
  const blur = pauseBlur(source.blur);
  return { overlays, sea, seaColor, blur };
};

export const normalizeRadar = (value) => ({
  ...DEFAULT_RADAR,
  mode: choice(asSource(value).mode, RADAR_MODES, DEFAULT_RADAR.mode),
  tilt: normalizeRadarTilt(asSource(value).tilt),
});
