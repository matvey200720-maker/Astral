import { clamp } from "./values.js";
import { SERVER_PRESETS } from "../catalog.js";
import { MAP_FONTS, isCustomLabelFont } from "../map-fonts.js";
import { MAP_TEXTURES } from "../textures.js";

const idOf = (entry) => entry.id;
const HEX_DIGITS = "0123456789abcdef";

// Полная заморозка: сам объект и всё, что внутри.
const sealDeep = (node) => {
  if (node !== null && typeof node === "object") Object.values(node).forEach(sealDeep);
  return Object.freeze(node);
};

export const SERVER_PROFILE_IDS = Object.freeze(["custom", ...SERVER_PRESETS.map(idOf)]);

export const RETIRED_TEMPLATES = Object.freeze({ "akio-atlas": "akio-atlas-vector" });

export const DEFAULT_BASE = Object.freeze({
  source: "game",
  imageAssetId: "",
  templateId: "",
  sea: "#000206",
  land: "#14171b",
  terrain: "#191d23",
  sand: "#1d2026",
  water: "#0a1018",
  roads: "#3d444e",
  highways: "#575f6b",
  buildings: "#232830",
  runway: "#2e343d",
  outline: "#2a3038",
  outlineWidth: 1.2,
  roadWidth: 100,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  edgeGlow: 46,
  edgeGlowColor: "#1b2029",
  grain: 0,
  tintColor: "#2f6ea8",
  tintBlend: "color",
  tintOpacity: 0,
  recolor: false,
  roleOverrides: [],
  textureId: "none",
  textureAssetId: "",
  textureBlend: "overlay",
  textureOpacity: 50,
  textureScale: 6,
  textureColor: "#ffffff",
  backdropColor: "#0b0d10",
  gridOpacity: 0,
  gridColor: "#ffffff",
  gridStep: 12,
  gridLabels: true,
  gridLabelColor: "",
  gridLabelSize: 100,
  render: "auto",
  shallow: "",
  highwayCasing: "",
  rail: "",
  paths: "",
  paletteMap: {},
  reliefOn: false,
  bare: true,
  reliefShade: 55,
  reliefLight: 315,
  reliefHeight: 100,
  reliefTint: 0,
  reliefLow: "",
  reliefHigh: "",
  reliefContours: false,
  reliefStep: 50,
  reliefContourColor: "",
  reliefContourOpacity: 40,
  /*
   * «3D-здания» (21.11.2026): в мини-карте кварталы встают настоящей геометрией — стенки стопкой слоёв, крыша светлее, высоты по районам
   * (`block-heights.js`, `radarBuildings`). `volumeHeight` — высота зданий в метрах (24 — районная как есть).
   */
  volumeBuildings: false,
  volumeHeight: 24,
  biomes: 0,
  relief: 0,
  roadCasing: 0,
  waterSmooth: 60,
  shallowReach: 35,
  hidden: ["water"],
});

export const BASE_LAYERS = sealDeep([
  { id: "water", title: "Вода", color: "water" },
  { id: "land", title: "Суша", color: "land" },
  { id: "buildings", title: "Постройки", color: "buildings" },
  { id: "roads", title: "Дороги", color: "roads" },
]);

export const BASE_LAYER_IDS = BASE_LAYERS.map(idOf);

export const BASE_RENDER_MODES = Object.freeze(["auto", "raster", "vector"]);

export const BASE_COLOR_KEYS = Object.freeze([
  "tintColor",
  "textureColor",
  "backdropColor",
  "sea",
  "land",
  "terrain",
  "sand",
  "water",
  "roads",
  "highways",
  "buildings",
  "runway",
  "outline",
  "edgeGlowColor",
  "gridColor",
]);

export const BASE_DECIMALS = Object.freeze({ outlineWidth: [0, 12] });

/** Предел высоты «3D-зданий», метры (ползунок «Высота зданий»). */
export const VOLUME_HEIGHT_RANGE = Object.freeze([8, 80]);

export const BASE_RANGES = Object.freeze({
  gridLabelSize: [50, 200],
  tintOpacity: [0, 100],
  textureOpacity: [0, 100],
  textureScale: [1, 32],
  roadWidth: [20, 320],
  brightness: [40, 180],
  contrast: [40, 200],
  saturation: [0, 200],
  edgeGlow: [0, 100],
  grain: [0, 100],
  gridOpacity: [0, 100],
  gridStep: [4, 24],
  biomes: [0, 100],
  relief: [0, 100],
  reliefShade: [0, 100],
  reliefLight: [0, 359],
  reliefHeight: [30, 400],
  reliefTint: [0, 100],
  reliefStep: [10, 200],
  reliefContourOpacity: [0, 100],
  volumeHeight: [8, 80],
  roadCasing: [0, 100],
  waterSmooth: [0, 100],
  shallowReach: [3, 80],
});

export const BASE_OPTIONAL_COLORS = Object.freeze([
  "gridLabelColor",
  "shallow",
  "rail",
  "highwayCasing",
  "paths",
  "reliefLow",
  "reliefHigh",
  "reliefContourColor",
]);

export const LABEL_FONTS = Object.freeze([
  "astral",
  "stock",
  "condensed",
  "wide",
  "heavy",
  "display",
  ...MAP_FONTS.map(idOf).filter((id) => id !== "jetbrains"),
]);

export const LABEL_WEIGHTS = Object.freeze(["regular", "semibold", "bold", "black"]);

export const EMBLEM_FONTS = Object.freeze([...MAP_FONTS.map(idOf), "custom"]);

export const GROUP_OUTLINE_MAX = 400;

export const ZONE_FILL_MODES = Object.freeze(["flat", "recolor"]);

export const ZONE_STROKE_ALIGNS = Object.freeze(["center", "inside"]);

export const TEXTURE_IDS = MAP_TEXTURES.map(idOf);

export const DEFAULT_ZONES = Object.freeze({
  enabled: true,
  template: "none",
  fillMode: "recolor",
  fillOpacity: 100,
  strokeAlign: "inside",
  strokeWidth: 1.7,
  strokeOpacity: 100,
  glow: 0,
  labels: true,
  labelSize: 13,
  labelColor: "#ffffff",
  labelTint: true,
  labelOutline: 0,
  labelAuto: true,
  font: "astral",
  hiddenGroups: [],
  groupTitles: {},
  lockedGroups: [],
  items: [],
});

export const LEGACY_ZONE_LOOK = Object.freeze({
  fillMode: "flat",
  fillOpacity: 26,
  strokeAlign: "center",
  strokeWidth: 3,
  glow: 34,
});

export const DEFAULT_MARKER_SECTION = Object.freeze({
  enabled: true,
  icons: true,
  iconSize: 15,
  font: "astral",
  labelSize: 16,
  labelColor: "#eef2fb",
  labelOutline: 78,
  labelOutlineColor: "#04060a",
  labelAuto: true,
  labelCase: "upper",
  declutter: true,
  letterSpacing: 6,
  dotSize: 7,
  dotOpacity: 100,
  circleStyle: "dashed",
  circleRadius: 320,
  circleWidth: 2,
  circleOpacity: 62,
  categories: {},
  items: [],
});

export const DEFAULT_MARKER_OUTLINE = Object.freeze({
  enabled: true,
  width: 12,
  effect: { mode: "solid", colour: "#ffffff" },
});

export const DEFAULT_MARKER_GLOW = Object.freeze({
  enabled: true,
  strength: 60,
  effect: { mode: "solid", colour: "#ffd23f" },
});

export const OWN_GLYPH_LIMITS = Object.freeze({ glyphs: 800, layers: 6, pathLength: 24000 });

export const DEFAULT_BRUSH = Object.freeze({
  color: "#ff5d72",
  size: 160,
  opacity: 100,
  softness: 0,
  smoothing: 50,
  blend: "normal",
  target: "map",
  line: "solid",
  arrow: "end",
});

export const STROKE_LINES = Object.freeze(["solid", "dashed", "dotted"]);

export const STROKE_ARROWS = Object.freeze(["none", "end", "both"]);

export const STROKE_KINDS = Object.freeze(["free", "line"]);

export const DEFAULT_PAINT = Object.freeze({
  enabled: true,
  brush: { ...DEFAULT_BRUSH },
  items: [],
});

export const DEFAULT_EMBLEMS = Object.freeze({ items: [] });

export const EXPORT_GENERATION = 4;

export const DEFAULT_EXPORT = Object.freeze({
  resolution: 2048,
  format: "bc3",
  detail: 4,
  generation: EXPORT_GENERATION,
});

export const MAP_DETAIL_LEVELS = sealDeep([
  { value: 4, label: "Чёткая" },
  { value: 6, label: "Очень чёткая" },
]);

export const MAP_TILE_SIDE_LIMIT = 6144;

export const PAUSE_MAP_GAME_SEA = "#384a50";

export const PAUSE_MAP_OVERLAY_MODES = Object.freeze(["auto", "keep", "hide"]);

export const DEFAULT_PAUSE_MAP = Object.freeze({
  overlays: "auto",
  sea: "game",
  seaColor: PAUSE_MAP_GAME_SEA,
  blur: "off",
});

export const RADAR_MODES = Object.freeze(["auto", "game", "map"]);

/*
 * Наклон радара «как в машине» (21.11.2026; стенд: `pkg-crash-map-tilt-a/-b/-c`, `-pack`, правка владельца по кадрам). Эталон вида —
 * штатный радар в машине: плоскость уходит от зрителя к горизонту, сильная перспектива, стрелка игрока ниже центра. Это не один угол,
 * а набор полей режима машины в блоке Camera файла `minimap.ymt`: наклон (`fVehicleTilt`, штатно 60; число — угол от вида сверху, 0 —
 * плоско), смещение центра (`fVehicleOffset` 30 — где стоит стрелка) и приближение (`fVehicleStaticZoom` 96 и три парных). Пешком эти
 * поля переносятся с машины (`radarCarFields`), значения берутся из штатного `minimap.ymt` игры (x64a.rpf), а не из нашего прошлого
 * файла. Сила наклона — доля от машины в процентах: 100 — как в машине, меньше — положе (угол и есть доля от угла машины). Карта паузы
 * не трогается: её поле на стенде ничего не меняет. БОЛЬШОЙ радар остаётся как в игре (слово владельца 22.11.2026: наклон на нём
 * «неправильный»): `fBigmapTilt` и `fBigmapOffset` не получают наших значений, а при записи возвращаются к штатным. Наклоняется и
 * вектор, и картинка под радаром, значки и метка остаются прямо.
 */
export const RADAR_TILT_STRENGTH = Object.freeze([40, 100]);
/** Включается с силой «как в машине». */
export const DEFAULT_RADAR_TILT = Object.freeze({ on: false, strength: 100 });
/** Поля наклона блока Camera, которые получают угол: пешком и машина. Большой радар (`fBigmapTilt`) не наш — штатный. */
export const RADAR_TILT_FIELDS = Object.freeze({
  foot: "fExteriorFootTilt",
  vehicle: "fVehicleTilt",
});
/** Поля большого радара, которые наклон не трогает и при записи возвращает к штатным значениям игры. */
export const RADAR_BIGMAP_STOCK_FIELDS = Object.freeze(["fBigmapTilt", "fBigmapOffset"]);
/** Поле режима машины → поля, на которые оно переносится без изменений (смещение центра и приближение). */
export const RADAR_CAR_COPY = Object.freeze({
  fVehicleOffset: Object.freeze(["fExteriorFootOffset"]),
  fVehicleStaticZoom: Object.freeze(["fExteriorFootZoom"]),
  fVehicleMovingZoom: Object.freeze(["fExteriorFootZoomRunning"]),
  fVehicleStaticWantedZoom: Object.freeze(["fExteriorFootZoomWanted"]),
  fVehicleMovingWantedZoom: Object.freeze(["fExteriorFootZoomWantedRunning"]),
});
export const DEFAULT_RADAR = Object.freeze({
  mode: "auto",
  tilt: DEFAULT_RADAR_TILT,
  layers: true,
  items: true,
  textScale: 100,
  tint: 55,
  opaque: true,
});

export const RADAR_TINT_RANGE = Object.freeze({ min: 10, max: 100, step: 5 });

export const RADAR_TEXT_SCALE_RANGE = Object.freeze({ min: 50, max: 150, step: 5 });

// Значение как строка; ложные значения читаются пустой строкой.
const looseText = (value) => (value ? String(value) : "");

const isHexColor = (str) =>
  str.length === 7 && str[0] === "#" && [...str.slice(1)].every((ch) => HEX_DIGITS.includes(ch));

// Собственные перечислимые пары настоящего объекта; массивы и не-объекты дают пусто.
const plainEntries = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];

const MAX_GROUPS = 64;
const GROUP_KEY_LENGTH = 40;
const GROUP_TITLE_LENGTH = 60;

export const hiddenLayers = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((layer) => BASE_LAYER_IDS.includes(layer)))] : [];

const hidesMoreThanWater = (list) => Array.isArray(list) && list.some((layer) => layer !== "water");

// Правила «условие → вердикт»; первое сработавшее решает, поля читаются по порядку.
const VECTOR_VERDICTS = [
  [(base) => hidesMoreThanWater(base.hidden), true],
  [(base) => base.render === "vector", true],
  [(base) => base.reliefOn, true],
  /* «3D-здания» (21.11): кварталы берутся из геометрии радара — только вектором. */
  [(base) => base.volumeBuildings, true],
  [(base) => base.render === "raster", false],
];

export const baseRendersVector = (base) => {
  if (!base) return false;
  const verdict = VECTOR_VERDICTS.find(([applies]) => applies(base));
  return verdict ? verdict[1] : base.source === "game" && Boolean(base.recolor);
};

export const labelFontOf = (value, fallback = "") =>
  LABEL_FONTS.includes(value) || isCustomLabelFont(value) ? value : fallback;

export const groupList = (value) => {
  if (!Array.isArray(value)) return [];
  const names = new Set();
  for (const item of value) {
    const name = looseText(item).slice(0, GROUP_KEY_LENGTH);
    if (name) names.add(name);
  }
  return [...names].slice(0, MAX_GROUPS);
};

export const hexOrEmpty = (value) => {
  const lowered = looseText(value).toLowerCase();
  return isHexColor(lowered) ? lowered : "";
};

export const titleMap = (value) =>
  Object.fromEntries(
    plainEntries(value)
      .map(([key, title]) => [
        key.slice(0, GROUP_KEY_LENGTH),
        looseText(title).trim().slice(0, GROUP_TITLE_LENGTH),
      ])
      .filter(([key, title]) => key && title)
      .slice(0, MAX_GROUPS),
  );

// Поля вида группы с «чужим» числом: [мин, макс, шаг, делитель итога].
// Итог второго прохода («× 10, round, ÷ 10» и т. п.) побитно равен r / делитель,
// где r — округлённое частное «зажатое / шаг».
const OWN_NUMBERS = {
  lineStep: [0.8, 2.5, 0.01, 100],
  fillOpacity: [0, 100, 1, 1],
  strokeWidth: [0, 16, 0.1, 10],
  glow: [0, 100, 1, 1],
  dotScale: [30, 300, 1, 1],
};

// Как у раздела: поле вида с таким значением ничего не меняет (шаг строк не входит).
const UNTOUCHED_LOOK = {
  font: "",
  scale: 100,
  color: "",
  weight: "",
  outline: null,
  outlineColor: "",
  caps: false,
  spacing: 0,
  fillMode: "",
  fillOpacity: null,
  strokeWidth: null,
  strokeAlign: "",
  glow: null,
  dotScale: 100,
};

const isFiniteNumeric = (value) => Number.isFinite(Number(value));

const ownNumber = (name, value) => {
  if (value == null || value === "" || !isFiniteNumeric(value)) return null;
  const [min, max, step, divisor] = OWN_NUMBERS[name];
  return Math.round(clamp(value, min, max, min) / step) / divisor;
};

const pickFrom = (list, value) => (list.includes(value) ? value : "");

const roundedWithin = (value, min, max, fallback, notNumeric) =>
  isFiniteNumeric(value) ? Math.round(clamp(value, min, max, fallback)) : notNumeric;

const groupLook = (style) => {
  const source = style !== null && typeof style === "object" && !Array.isArray(style) ? style : {};
  const look = {};
  look.font = labelFontOf(source.font, "");
  look.scale = roundedWithin(source.scale, 50, 250, 100, 100);
  look.color = hexOrEmpty(source.color);
  look.weight = pickFrom(LABEL_WEIGHTS, source.weight);
  look.outline =
    source.outline == null || source.outline === ""
      ? null
      : roundedWithin(source.outline, 0, GROUP_OUTLINE_MAX, 0, null);
  look.outlineColor = hexOrEmpty(source.outlineColor);
  look.caps = source.caps === true;
  look.spacing = roundedWithin(source.spacing, -10, 60, 0, 0);
  look.lineStep = ownNumber("lineStep", source.lineStep);
  look.fillMode = pickFrom(ZONE_FILL_MODES, source.fillMode);
  look.fillOpacity = ownNumber("fillOpacity", source.fillOpacity);
  look.strokeWidth = ownNumber("strokeWidth", source.strokeWidth);
  look.strokeAlign = pickFrom(ZONE_STROKE_ALIGNS, source.strokeAlign);
  look.glow = ownNumber("glow", source.glow);
  look.dotScale = ownNumber("dotScale", source.dotScale) ?? 100;
  return look;
};

const changesSomething = (look) =>
  Object.entries(UNTOUCHED_LOOK).some(([name, plain]) => look[name] !== plain);

export const groupStyleMap = (value) =>
  Object.fromEntries(
    plainEntries(value)
      .map(([key, style]) => [key.slice(0, GROUP_KEY_LENGTH), groupLook(style)])
      .filter(([key, look]) => key && changesSomething(look))
      .slice(0, MAX_GROUPS),
  );
