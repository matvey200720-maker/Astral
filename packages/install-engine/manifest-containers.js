/*
 * Свои контейнеры для работ с `_manifest.ymf` (задача 3 ТЗ 10.10.2026).
 *
 * `_manifest.ymf` в контейнере один: в нём записано, какие карты (ymap)
 * какие типы (ytyp) тянут. Залазы, арена из папки мода и готовый набор
 * интерьеров жили в общем `astral_maps.rpf`, у каждого — свой манифест, а
 * слои одной записи складываются стопкой: в игре оставался манифест того,
 * кто поставлен последним. Арена после залазов выглядела установленной, а
 * её плашек в игре не было (уступленный манифест, 05.10.2026), — моды
 * ломали друг друга молча.
 *
 * Теперь у каждой такой работы свой контейнер, как у прострелов и радуги, —
 * со своим манифестом. Поставленные раньше переезжают при первой же
 * пересборке update.rpf (`relocateSharedManifests`): те же файлы слоёв, новые
 * записи, а реестр content.xml регистрирует новый контейнер сам.
 *
 * Моды каталога с манифестом (16.10.2026) — тоже: маппинг редукса приходит
 * кусками (Optimization, Gz, Zapretka — свои установщики автора), и у
 * каждого свой `_manifest.ymf`. Разбор кладёт их в общий контейнер, движок
 * при разборе пакета (`withOwnMapsContainer`) переносит в
 * `x64/astral/astral_m_<хэш id>.rpf` — куски встают рядом, а не сменяют
 * друг друга. Поставленные раньше остаются, где стоят, и снимаются по своей
 * описи, как раньше.
 */

import { createHash } from "node:crypto";

export const SHARED_MAPS_CONTAINER = "x64/astral/astral_maps.rpf";
export const CLIMBS_CONTAINER = "x64/astral/astral_climbs.rpf";
export const ARENA_CONTAINER = "x64/astral/astral_arena.rpf";
export const INTERIOR_SET_CONTAINER = "x64/astral/astral_interiors.rpf";

const UPDATE_ARCHIVE = "update/update.rpf";
const OWN = Object.freeze([
  { pattern: /^local-legacy-climbs-/, container: CLIMBS_CONTAINER },
  { pattern: /^local-legacy-arena-/, container: ARENA_CONTAINER },
  { pattern: /^local-legacy-interior-set-/, container: INTERIOR_SET_CONTAINER },
]);

/** Свой контейнер работы или `null` (каталог, одиночный интерьер). */
export function ownManifestContainer(modId) {
  const id = String(modId || "");
  return OWN.find((item) => item.pattern.test(id))?.container || null;
}

const sharedPrefix = `${SHARED_MAPS_CONTAINER}/`;
const relocated = (entry, container) => `${container}/${entry.slice(sharedPrefix.length)}`;

function moveEntries(list, modId, container) {
  let moved = false;
  for (const item of list || []) {
    if (String(item?.target || item?.archive || "").toLowerCase() !== UPDATE_ARCHIVE) continue;
    if (!String(item.entry || "").toLowerCase().startsWith(sharedPrefix)) continue;
    item.entry = relocated(item.entry, container);
    moved = true;
  }
  return moved;
}

/**
 * Переселить слои работ с манифестом из общего контейнера в свои. Состояние
 * меняется на месте; возвращает id переселённых работ (пусто — нечего).
 */
export function relocateSharedManifests(target) {
  const entries = target?.archives?.[UPDATE_ARCHIVE]?.entries;
  if (!entries) return [];
  const moved = new Set();
  for (const [entry, record] of Object.entries(entries)) {
    if (!entry.toLowerCase().startsWith(sharedPrefix)) continue;
    const layers = record?.layers || [];
    const staying = [];
    for (const layer of layers) {
      const container = ownManifestContainer(layer?.modId);
      if (!container) {
        staying.push(layer);
        continue;
      }
      const next = relocated(entry, container);
      const destination = (entries[next] ||= { layers: [] });
      destination.layers = [...(destination.layers || []).filter((item) => item?.modId !== layer.modId), layer];
      moved.add(layer.modId);
    }
    if (staying.length === layers.length) continue;
    if (staying.length) record.layers = staying;
    else delete entries[entry];
  }
  if (!moved.size) return [];
  for (const item of target.installed || [])
    if (moved.has(item?.modId)) moveEntries(item.archiveEntries, item.modId, ownManifestContainer(item.modId));
  /* Снятые проверкой файлов вернутся уже на свои места. */
  for (const item of Array.isArray(target.parked) ? target.parked : []) {
    const container = ownManifestContainer(item?.modId);
    if (!container) continue;
    moveEntries(item.entries, item.modId, container);
    moveEntries(item.record?.archiveEntries, item.modId, container);
  }
  delete target.archives[UPDATE_ARCHIVE].lastBuilt;
  return [...moved];
}

/**
 * В общем контейнере стоит работа, которой положен свой: подготовка
 * пересобирает update.rpf сразу, а не ждёт следующей установки, — иначе
 * арена под залазами так и оставалась бы невидимой до неё.
 */
export function sharedManifestsToRelocate(target) {
  const entries = target?.archives?.[UPDATE_ARCHIVE]?.entries || {};
  return Object.entries(entries).some(
    ([entry, record]) =>
      entry.toLowerCase().startsWith(sharedPrefix) &&
      (record?.layers || []).some((layer) => ownManifestContainer(layer?.modId)),
  );
}

const MAPS_MANIFEST = `${sharedPrefix}_manifest.ymf`;
const UPDATE_TARGETS = new Set([UPDATE_ARCHIVE, `mods/${UPDATE_ARCHIVE}`]);
const inUpdate = (file) => UPDATE_TARGETS.has(String(file?.target || "").toLowerCase());

/** 12 знаков sha256 id мода: различитель имён его контейнеров. */
const modHash = (modId) => createHash("sha256").update(String(modId || "")).digest("hex").slice(0, 12);

/** Свой контейнер мода каталога с манифестом: `x64/astral/astral_m_<12 знаков sha256 id>.rpf`. */
export function catalogMapsContainer(modId) {
  return `x64/astral/astral_m_${modHash(modId)}.rpf`;
}

/* Контейнеры автора арены: манифест называет их по порядку (`astral_m_part_<k>.rpf`, `spec.js: partContainer`). */
const PART_CONTAINER = /^x64\/astral\/astral_m_part_([1-9])\.rpf\//i;

/** Свой контейнер k-й части мода каталога: `x64/astral/astral_m_<12 знаков sha256 id>_<k>.rpf`. Номер — в имени всегда: по имени контейнеры ложатся в content.xml. */
export function catalogPartContainer(modId, part) {
  return catalogMapsContainer(modId).replace(/\.rpf$/, `_${part}.rpf`);
}

/*
 * Контейнеры компонентов редукса: манифест называет их по порядку автора (`astral_r<NNN>_part_<kk>.rpf`,
 * `rpf-inspector/anatomy-drafts.js: layerContainer`). `NNN` — три цифры, место единицы в порядке включения автора
 * (его `content.xml`, поздний перекрывает ранний); `kk` — две цифры, номер архива внутри компонента.
 */
const ORDERED_CONTAINER = /^x64\/astral\/astral_r(\d{3})_part_(\d{2})\.rpf\//i;

/**
 * Свой контейнер компонента редукса: `x64/astral/astral_r<NNN>_<12 знаков sha256 id>_<kk>.rpf`.
 * Реестр `content.xml` пишет контейнеры по имени, три цифры `NNN` стоят первыми — строки встают в порядке автора;
 * у разных модов имена разные (хэш id), одноимённые файлы разных компонентов не склеиваются.
 */
export function catalogOrderedContainer(modId, order, part) {
  return `x64/astral/astral_r${order}_${modHash(modId)}_${part}.rpf`;
}

/* Итоговая форма имени (после переписи): хэш в ней стоит на месте различителя мода. */
const FINAL_ORDERED_CONTAINER = /^x64\/astral\/astral_r\d{3}_([0-9a-f]{12})_\d{2}\.rpf\//i;

/**
 * Запись, которая уже называет итоговый контейнер компонента, но с хэшем не своего id: так мод писал бы в контейнер
 * другого мода (его слой снялся бы вместе с чужим). Манифест такой записи не принимает; своя итоговая форма
 * (пересбор уже переписанного пакета) и авторская (`astral_r<NNN>_part_<kk>.rpf`) проходят.
 */
export function foreignOrderedContainer(modId, entry) {
  const match = FINAL_ORDERED_CONTAINER.exec(String(entry || ""));
  return Boolean(match) && match[1].toLowerCase() !== modHash(modId);
}

/**
 * Разобранный пакет (`validateManifest`) с записями общего контейнера в
 * своём — только у мода каталога, который кладёт туда `_manifest.ymf`.
 * Работы мастерской (`local-*`) и всё остальное — как есть.
 *
 * Мод с контейнерами автора (арена: `astral_m_part_<k>.rpf`) получает каждому свой —
 * `astral_m_<хэш id>_<k>.rpf`: у разных модов имена разные, у одного мода — по порядку автора.
 * Компонент редукса (`astral_r<NNN>_part_<kk>.rpf`) — `astral_r<NNN>_<хэш id>_<kk>.rpf` (`catalogOrderedContainer`).
 */
export function withOwnMapsContainer(parsed) {
  const id = String(parsed?.id || "");
  const files = parsed?.files || [];
  const foreign = files.find((file) => inUpdate(file) && foreignOrderedContainer(id, file.entry));
  if (foreign) throw new Error(`Запись ${foreign.entry} называет контейнер другого мода.`);
  if (!id || id.startsWith("local-") || id.startsWith("@")) return parsed;
  /* Компонент редукса с порядком автора: каждому контейнеру свой, в общий `astral_maps.rpf` не идёт никогда — ни с
     `_manifest.ymf`, ни без него (остатки общего контейнера в таком пакете уходят в `astral_m_<хэш id>.rpf`). */
  if (files.some((file) => inUpdate(file) && ORDERED_CONTAINER.test(String(file.entry || "")))) {
    return {
      ...parsed,
      files: files.map((file) => {
        if (!inUpdate(file)) return file;
        const entry = String(file.entry || "");
        const ordered = ORDERED_CONTAINER.exec(entry.toLowerCase());
        if (ordered) return { ...file, entry: `${catalogOrderedContainer(id, ordered[1], ordered[2])}/${entry.slice(ordered[0].length)}` };
        return entry.toLowerCase().startsWith(sharedPrefix) ? { ...file, entry: relocated(entry.toLowerCase(), catalogMapsContainer(id)) } : file;
      }),
    };
  }
  if (files.some((file) => inUpdate(file) && PART_CONTAINER.test(String(file.entry || "")))) {
    return {
      ...parsed,
      files: files.map((file) => {
        const part = inUpdate(file) && PART_CONTAINER.exec(String(file.entry || "").toLowerCase());
        return part
          ? { ...file, entry: `${catalogPartContainer(id, part[1])}/${String(file.entry).slice(part[0].length)}` }
          : file;
      }),
    };
  }
  if (!files.some((file) => inUpdate(file) && String(file.entry || "").toLowerCase() === MAPS_MANIFEST)) return parsed;
  const container = catalogMapsContainer(id);
  return {
    ...parsed,
    files: files.map((file) =>
      inUpdate(file) && String(file.entry || "").toLowerCase().startsWith(sharedPrefix)
        ? { ...file, entry: relocated(String(file.entry).toLowerCase(), container) }
        : file,
    ),
  };
}
