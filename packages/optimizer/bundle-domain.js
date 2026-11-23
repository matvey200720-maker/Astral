// Блок domain.optimization карточки каталога: проверка при публикации и
// безопасное чтение списка слоёв для окна.
import { OPTIMIZATION_LAYER_IDS, OPTIMIZATION_LAYER_TITLES } from "./layer-ids.js";
import { TEXTURE_LEVEL_LAYERS } from "./texture-levels.js";

export const OPTIMIZATION_PART_KINDS = Object.freeze([
  "decals",
  "screen",
  "explosions",
  "weather",
  "clouds",
  "grass",
]);

const MAX_FACTS = 8;
const MAX_FACT_LENGTH = 200;
const NOT_A_BLOCK = "Оптимизация сборки: нужен блок { layers }.";

// Допустимы слои каталога без ступеней «Ухудшения текстур»; порядок — порядок каталога.
const texturePack = new Set(TEXTURE_LEVEL_LAYERS);
const BUNDLE_LAYERS = OPTIMIZATION_LAYER_IDS.filter((id) => !texturePack.has(id));
const BUNDLE_LAYER_SET = new Set(BUNDLE_LAYERS);

const layerTitle = (id) => OPTIMIZATION_LAYER_TITLES[id]?.ru || id;

function readLayerNames(block) {
  const raw = block.layers;
  if (!Array.isArray(raw)) return [];
  return [...new Set(Array.from(raw, (item) => String(item)))];
}

function readFacts(block) {
  const raw = block.facts;
  if (!Array.isArray(raw)) return [];
  return Array.from(raw, (item) => (item == null ? "" : String(item).trim().slice(0, MAX_FACT_LENGTH)))
    .filter((fact) => fact !== "")
    .slice(0, MAX_FACTS);
}

export function normalizeOptimizationDomain(block) {
  if (block == null) return null;
  if (typeof block !== "object" || Array.isArray(block)) throw new Error(NOT_A_BLOCK);

  const names = readLayerNames(block);
  const unknown = names.filter((name) => !BUNDLE_LAYER_SET.has(name));
  if (unknown.length > 0) {
    throw new Error(`Оптимизация сборки: у Astral нет слоёв ${unknown.join(", ")}.`);
  }
  const facts = readFacts(block);
  if (names.length === 0 && facts.length === 0) return null;

  const chosen = new Set(names);
  const layers = BUNDLE_LAYERS.filter((id) => chosen.has(id));
  const result = { layers, titles: layers.map(layerTitle) };
  if (facts.length > 0) result.facts = facts;
  if (OPTIMIZATION_PART_KINDS.includes(block.kind)) result.kind = block.kind;
  return result;
}

export function bundleOptimizationLayers(mod) {
  try {
    const normalized = normalizeOptimizationDomain(mod?.domain?.optimization);
    return normalized ? normalized.layers : [];
  } catch {
    return [];
  }
}
