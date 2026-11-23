import { markerItems } from "./markers.js";
import { zoneItems } from "./zones.js";
import { createProjector } from "./geometry.js";
import { normalizeAtlas } from "../projection.js";

// Состояния атласа привязаны к объекту, который их принёс, и живут не дольше него.
export const atlasMemo = new WeakMap();

const stateFor = (input, atlas = normalizeAtlas(input)) => ({ atlas, projector: createProjector(atlas) });

export const atlasState = (input) => {
  if (typeof input !== "object" || input === null) return stateFor(input);
  if (!atlasMemo.has(input)) atlasMemo.set(input, stateFor(input));
  return atlasMemo.get(input);
};

export const CACHE_ENTRIES = 4;

const topCopy = (items) => ({ ...items });

// Сохранённый ключ короче или длиннее нового — сверяются места сохранённого.
const sameAt = (inputs) => (value, place) => inputs[place] === value;

// Записи лежат от давней (в начале) к свежей (в конце); ищем с конца.
class RecentRows {
  constructor(limit) {
    this.limit = limit;
    this.rows = [];
  }

  locate(inputs) {
    for (let at = this.rows.length; at-- > 0; ) {
      const entry = this.rows[at];
      if (entry.inputs.every(sameAt(inputs))) return at;
    }
    return -1;
  }

  fetch(inputs, compute) {
    const at = this.locate(inputs);
    const entry = at < 0 ? this.add({ inputs, items: compute() }) : this.promote(at);
    return topCopy(entry.items);
  }

  add(entry) {
    this.rows.push(entry);
    if (this.rows.length > this.limit) this.rows.shift();
    return entry;
  }

  promote(at) {
    return this.add(this.rows.splice(at, 1)[0]);
  }
}

export const entriesCache = (limit = CACHE_ENTRIES) => {
  const recent = new RecentRows(limit);
  return (inputs, compute) => recent.fetch(inputs, compute);
};

// Рецепт ключа: [номер аргумента] или [номер аргумента, имя поля, которое берётся у него].
const ZONE_KEY = [[0, "zones"], [0, "markers"], [1], [2], [3], [4]];
const MARKER_KEY = [[0, "markers"], [1], [2], [3], [4], [5], [6]];

const keyFrom = (recipe, args) =>
  recipe.map(([slot, field]) => (field === undefined ? args[slot] : args[slot][field]));

const memo = (cache, recipe, producer) => (args) =>
  cache(keyFrom(recipe, args), () => producer(...args));

export const zoneCache = entriesCache();
export const markerCache = entriesCache();

const rememberZones = memo(zoneCache, ZONE_KEY, zoneItems);
const rememberMarkers = memo(markerCache, MARKER_KEY, markerItems);

// (config, projector, shrink, tones, textAdvance)
export const zoneItemsCached = (...args) => rememberZones(args);

// (config, projector, shrink, assets, zoom, tones, windowScale)
export const markerItemsCached = (...args) => rememberMarkers(args);
