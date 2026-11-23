import {
  createWorldMapConfig,
  mapStyleActive,
  normalizeWorldMap as normalizeProject,
  styleLook,
  withLabelLook,
} from "./world.js";
import { WORLD_MAP_TEMPLATE_MAP as VIEW_TEMPLATES } from "./templates.js";
import * as packs from "../map-templates.js";
import * as catalog from "../catalog.js";

export const STARTER_MAP_TEMPLATE = "akio-atlas-vector";

const { MAP_TEMPLATE_MAP: PACKS } = packs;
const { DEFAULT_MARKERS, SERVER_PRESET_MAP, ZONE_TEMPLATE_MAP } = catalog;

// Слияние раздела с патчем: без объекта-патча остаётся сам раздел.
export const mergeSection = (current, patch) => {
  if (typeof patch !== "object" || patch === null) return current;
  return { ...current, ...patch };
};

// Раздел с патчем как новый объект; перечисленные поля всегда остаются от текущего.
const mergeKeeping = (current, patch, kept) => {
  const joined = mergeSection(current, patch);
  const merged = joined === current ? { ...current } : joined;
  for (let at = 0; at < kept.length; at++) merged[kept[at]] = current[kept[at]];
  return merged;
};

// Общий вход применений: запись каталога по id и нормализованный текущий проект.
// У шаблонов вида и готовых карт сначала ищется запись, у наборов зон и профилей — сначала нормализуется проект.
const prepared = (config, table, id, searchFirst) => {
  if (searchFirst) {
    const entry = table[id];
    return { entry, current: normalizeProject(config) };
  }
  const current = normalizeProject(config);
  return { entry: table[id], current };
};

// Проект с переопределёнными разделами и новой нормализацией: ключи остаются на своих местах.
const rebuilt = (current, overrides) => normalizeProject({ ...current, ...overrides });

// Какие поля раздела после слияния с патчем берутся из текущего проекта (шаг рецепта → раздел → поля).
const KEPT_FIELDS = {
  view: { zones: ["items"], markers: ["categories", "items"] },
  server: { zones: ["items"], markers: ["categories"] },
};

const MERGED_KEYS = ["zones", "markers"];

const mergedSections = (recipe, current, patch) => {
  const merged = {};
  for (let at = 0; at < MERGED_KEYS.length; at++) {
    const key = MERGED_KEYS[at];
    merged[key] = mergeKeeping(current[key], patch[key], KEPT_FIELDS[recipe][key]);
  }
  return merged;
};

const isCircle = (marker) => Boolean(marker.circle);

// Зона набора: группа — id набора, включена, если заготовка не выключена, подпись всегда.
const zoneEntry = (zone, group) => {
  const entry = { ...zone };
  entry.group = group;
  entry.enabled = zone.enabled !== false;
  entry.label = true;
  return entry;
};

// Точка профиля: группа — id профиля, включена, с точкой; подпись — если заготовка её не отключает.
const presetEntry = (marker, group) => {
  const entry = { ...marker };
  entry.group = group;
  entry.enabled = true;
  entry.label = marker.label !== false;
  entry.dot = true;
  entry.circle = isCircle(marker);
  return entry;
};
// Море карты паузы идёт за шаблоном вида.
export const templatePauseMap = (current, patch) => {
  const own = patch.pauseMap;
  if (own) return mergeSection(current, own);
  const base = patch.base || {};
  if (base.recolor) {
    return typeof base.sea === "string" ? { ...current, sea: "color", seaColor: base.sea } : current;
  }
  return base.recolor === false ? { ...current, sea: "game" } : current;
};

// Шаблон вида: три прохода нормализатора (вход, проект с палитрой, подстройка подписей).
export const applyWorldMapTemplate = (config, templateId, options = {}) => {
  const { entry: template, current } = prepared(config, VIEW_TEMPLATES, templateId, true);
  if (!template) return current;
  const patch = template.patch || {};
  const toGame = options.game && current.base.source !== "game";
  const underlay = toGame ? { ...current.base, source: "game", templateId: "" } : current.base;
  const next = rebuilt(current, {
    template: template.id,
    pauseMap: templatePauseMap(current.pauseMap, patch),
    base: mergeSection(underlay, patch.base),
    ...mergedSections("view", current, patch),
  });
  return normalizeProject(withLabelLook(next, styleLook(next.base)));
};

// Основа с подложкой готовой карты: источник, id карты и пустые правки палитры.
const swappedBase = (base, pack) => ({ ...base, source: "template", templateId: pack.id, paletteMap: {} });

// Что сбрасывает готовая карта без шаблона вида: перекраску, тон и текстуру (скрытые слои — отдельно).
const RESET_FIELDS = ["recolor", "brightness", "contrast", "saturation", "tintOpacity", "textureId"];
const RESET_VALUES = [false, 100, 100, 100, 0, "none"];

const resetBase = (swapped, grid) => {
  const base = { ...swapped };
  for (let at = 0; at < RESET_FIELDS.length; at++) base[RESET_FIELDS[at]] = RESET_VALUES[at];
  base.hidden = [];
  // сетка своя у карты с сеткой; у карты без неё гаснет только прозрачность
  if (!grid) {
    base.gridOpacity = 0;
    return base;
  }
  base.gridOpacity = grid.opacity;
  base.gridStep = grid.step;
  base.gridLabels = grid.labels;
  base.gridColor = grid.color;
  return base;
};

// Подписи, подстроенные под вид: берутся только точки и зоны.
const labelled = (current, look) => {
  const adjusted = withLabelLook(current, look);
  return { markers: adjusted.markers, zones: adjusted.zones };
};

// Готовая карта из пака: два прохода.
export const applyMapTemplate = (config, templateId) => {
  const { entry: pack, current } = prepared(config, PACKS, templateId, true);
  if (!pack) return current;
  const grid = pack.grid || null;
  const swapped = swappedBase(current.base, pack);
  if (mapStyleActive(current)) return rebuilt(current, { base: swapped, ...labelled(current, styleLook(swapped)) });
  return rebuilt(current, {
    base: resetBase(swapped, grid),
    pauseMap: { ...current.pauseMap, sea: "game" },
    ...labelled(current, pack.look),
  });
};

// Набор зон: зоны человека заменяются целиком.
export const applyZoneTemplate = (config, templateId) => {
  const { entry: set, current } = prepared(config, ZONE_TEMPLATE_MAP, templateId, false);
  if (!set) return current;
  const zones = { ...current.zones, template: set.id };
  zones.items = set.zones.map((zone) => zoneEntry(zone, set.id));
  return rebuilt(current, { zones });
};

// Профиль сервера: набор зон профиля плюс его точки и оформление.
export const applyServerPreset = (config, presetId) => {
  const { entry: preset, current } = prepared(config, SERVER_PRESET_MAP, presetId, false);
  if (!preset) return { ...current, server: "custom" };
  const zoned = applyZoneTemplate(current, preset.zoneTemplate);
  const merged = mergedSections("server", zoned, preset.patch || {});
  merged.markers.items = preset.markers.map((marker) => presetEntry(marker, preset.id));
  return rebuilt(zoned, { server: preset.id, ...merged });
};

// Заводской набор обозначений: свежие записи с включёнными подписью и точкой.
export const defaultMarkerItems = () =>
  DEFAULT_MARKERS.map((marker) => {
    const circle = isCircle(marker);
    return { ...marker, enabled: true, label: true, dot: true, circle };
  });

export const createDefaultWorldMap = () => normalizeProject(applyWorldMapTemplate(createWorldMapConfig(), "original"));

export const createStarterWorldMap = () => applyMapTemplate(createDefaultWorldMap(), STARTER_MAP_TEMPLATE);
