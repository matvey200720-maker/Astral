// Отделение залазов от места: карта размещения, ставящая метки контейнера, уходит с ними в свою находку.

import { CLIMB_SLOT_IDS } from "@modovik/climb-contract";
import { recategorizeFinding } from "./classify.js";
import { placeTarget } from "./containers.js";

const CLIMBS = "climbs";
const MIN_MARKERS = 4;
const MARKER_EXT = ".ydr";
const MAP_EXT = ".ymap";
const ARCHETYPE_EXT = ".ytyp";
const MARKER_FILES = new Set(CLIMB_SLOT_IDS.map((id) => id + MARKER_EXT));

export function joaat(text) {
  let hash = 0;
  // Обход по символам: от символа вне основной плоскости берётся только первая единица UTF-16.
  for (const symbol of String(text).toLowerCase()) {
    hash = (hash + symbol.charCodeAt(0)) | 0;
    hash = (hash + (hash << 10)) | 0;
    hash ^= hash >>> 6;
  }
  hash = (hash + (hash << 3)) | 0;
  hash ^= hash >>> 11;
  hash = (hash + (hash << 15)) | 0;
  return hash >>> 0;
}

function fileNameOf(entry) {
  return String(entry.path ?? "").split("/").pop().toLowerCase();
}

function hasExtension(entry, extension) {
  return String(entry.path ?? "").toLowerCase().endsWith(extension);
}

function stem(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? fileName : fileName.slice(0, dot);
}

// Отказ чтения или разбора выключает только эту карту.
async function placedHashes(entry, readBytes, inspectMap) {
  try {
    return await inspectMap(await readBytes(entry.path));
  } catch {
    return [];
  }
}

async function selectClimbMaps(entries, markerHashes, { readBytes, inspectMap }) {
  const found = [];
  for (const entry of entries) {
    if (hasExtension(entry, MAP_EXT)) {
      const hashes = await placedHashes(entry, readBytes, inspectMap);
      // Не массив падает здесь, вне защищённой части: отказ всего вызова.
      if (hashes.some((hash) => markerHashes.has(hash >>> 0))) found.push(entry);
    }
  }
  return found;
}

function climbsId(id) {
  return `${String(id).replace(/::[^:]+$/, "")}::${CLIMBS}`;
}

function buildClimbsFinding(finding, entries, mapEntries) {
  const mapNames = mapEntries.map(fileNameOf).join(", ");
  const label = finding.container?.label;
  const recategorized = recategorizeFinding(
    { ...finding, entries },
    CLIMBS,
    `метки залазов, которые ставит ${mapNames}`,
    { targetLookup: placeTarget },
  );
  return {
    ...recategorized,
    id: climbsId(finding.id),
    title: label ? `Залазы · ${label}` : "Залазы",
  };
}

export async function splitClimbsOut(finding, { readBytes, inspectMap }) {
  if (!inspectMap || finding.category === CLIMBS || finding.origin !== "container") {
    return [finding];
  }

  const entries = [...(finding.entries ?? [])];
  const markers = entries.filter((entry) => MARKER_FILES.has(fileNameOf(entry)));
  if (markers.length < MIN_MARKERS) return [finding];

  const markerHashes = new Set(
    markers.map((entry) => joaat(fileNameOf(entry).slice(0, -MARKER_EXT.length))),
  );
  const climbMaps = await selectClimbMaps(entries, markerHashes, { readBytes, inspectMap });
  if (climbMaps.length === 0) return [finding];

  const mapStems = new Set(climbMaps.map((entry) => stem(fileNameOf(entry))));
  const archetypes = entries.filter(
    (entry) => hasExtension(entry, ARCHETYPE_EXT) && mapStems.has(stem(fileNameOf(entry))),
  );

  const taken = new Set([...markers, ...climbMaps, ...archetypes]);
  const rest = entries.filter((entry) => !taken.has(entry));
  const climbs = buildClimbsFinding(finding, [...markers, ...climbMaps, ...archetypes], climbMaps);
  return rest.length ? [{ ...finding, entries: rest }, climbs] : [climbs];
}
