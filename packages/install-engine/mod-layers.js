// Слои модов в состоянии цели: снятие со всех записей архивов и полная вычистка
// заменяемых модов. Состояние правится на месте.

const not = (predicate) => (item) => !predicate(item);
const ownedBy = (modId) => (layer) => layer.modId === modId;
const hasLayerOf = (layers, modId) => layers.some(ownedBy(modId));
const withoutLayersOf = (layers, modId) => layers.filter(not(ownedBy(modId)));

// Архивы из описи установки, без повторов, в порядке первого появления.
function declaredArchives(installed) {
  const entries = installed?.archiveEntries ?? [];
  return new Set(entries.map((entry) => entry.target));
}

// Слои мода снимаются со всех записей архива, а не только с названных в описи.
function stripArchive(target, name, modId) {
  for (const entry of Object.values(target.archives?.[name]?.entries ?? {})) {
    const layers = entry.layers;
    if (layers != null && hasLayerOf(layers, modId)) entry.layers = withoutLayersOf(layers, modId);
  }
}

// Работа мастерской лежала поверх слоя этого мода (`workOver` основы): слой снят, и запись о нём
// не должна пережить повторную установку мода с теми же байтами — новый слой снова последний.
function forgetWorkOver(target, modId) {
  for (const resource of Object.values(target.resources ?? {})) {
    const over = resource?.compositionBase?.workOver;
    if (!over) continue;
    for (const [entry, layer] of Object.entries(over)) if (layer?.modId === modId) delete over[entry];
    if (!Object.keys(over).length) delete resource.compositionBase.workOver;
  }
}

export function removeModLayers(target, installed, modId = installed?.modId) {
  const archives = declaredArchives(installed);
  for (const name of archives) stripArchive(target, name, modId);
  forgetWorkOver(target, modId);
  return archives;
}

function ownResource(resources, path) {
  return Object.hasOwn(resources, path) ? resources[path] : undefined;
}

// Снимает слои вытесняемой записи и по одному отдаёт затронутые пути:
// сначала ресурсы, потом все архивы описи.
function* evictedPaths(target, record) {
  for (const path of record.resources ?? []) {
    const resource = ownResource(target.resources, path);
    if (!resource) continue;
    resource.layers = withoutLayersOf(resource.layers ?? [], record.modId);
    yield path;
  }
  yield* removeModLayers(target, record);
}

function dropRegistrations(registrations, supersededIds) {
  let dropped = false;
  for (const [name, registration] of Object.entries(registrations ?? {})) {
    if (!supersededIds.has(registration.modId)) continue;
    delete registrations[name];
    dropped = true;
  }
  return dropped;
}

export function supersedeInstalled(target, supersededIds, affectedPaths) {
  // Один проход: вытесняемые записи чистятся сразу, остающиеся попадают в новую опись.
  const staying = [];
  for (const record of target.installed ?? []) {
    if (supersededIds.has(record.modId)) {
      for (const path of evictedPaths(target, record)) affectedPaths.add(path);
    } else {
      staying.push(record);
    }
  }
  target.installed = staying;

  return dropRegistrations(target.dlcRegistrations, supersededIds);
}

/* Пересчёт слоя слотов звука после снятия и установки слоёв банков (`audio-slot-layer.js`). */
export { settleAudioSlotLayer } from "./audio-slot-layer.js";
