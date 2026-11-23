import { buildContents, catalogIdsOf } from "../../../features/library/my-mods.js";
import { mergeWorkCards } from "../../../features/library/work-cards.js";

// Чистые помощники страницы сборок: списки, словари и выборки без состояния.

// Библиотека модов: каталог, поверх него полная библиотека; порядок по первому появлению.
export function mergeLibrary(catalogMods, libraryMods) {
  const byId = new Map();
  const put = (mod) => {
    if (mod) byId.set(mod.id, mod);
  };
  for (const mod of catalogMods) put(mod);
  for (const mod of libraryMods) put(mod);
  return Array.from(byId.values());
}

// Отмеченными при открытии становятся моды сборки, которые можно поставить.
export function unblockedSet(ids, blockOf) {
  const free = (ids || []).filter(function canInstall(id) {
    return !blockOf(id);
  });
  return new Set(free);
}

// Обновления списка сборок: в конец или в начало без прежней записи с тем же id.
export function appendEntry(entry) {
  return function appended(prev) {
    return [...prev, entry];
  };
}

export function putFirst(entry) {
  return function placed(prev) {
    const rest = prev.filter((item) => item.id !== entry.id);
    return [entry, ...rest];
  };
}

export function without(list, id) {
  return list.filter(function other(item) {
    return item.id !== id;
  });
}

export function findById(list, id) {
  return list.find(function matches(item) {
    return item.id === id;
  });
}

export function indexById(mods) {
  const pairs = mods.map(function pairOf(mod) {
    return [mod.id, mod];
  });
  return new Map(pairs);
}

export function toSet(ids) {
  return new Set(ids);
}

// Установки мастерской среди стоящего: всё, что не относится к модам каталога.
export function engineIdsOf(installed, modsById) {
  const ids = catalogIdsOf(installed, modsById);
  const known = toSet(ids);
  return installed.filter((id) => known.has(id) === false);
}

// Моды сборки, которые остаются при установке: отмечены и не заменены работами.
export function installableIds(build, enabledIds, replaced) {
  return (build.modIds || []).filter(function keeps(id) {
    return enabledIds.has(id) && !replaced.has(id);
  });
}

// Та же запись с заменёнными работами.
export function withWorks(entry, works) {
  return { ...entry, works };
}

// Сколько модов открытой сборки отмечено; без открытой сборки — ноль.
export function countEnabled(view, enabledIds) {
  if (!view) return 0;
  const marked = view.mods.filter(function isMarked(mod) {
    return enabledIds.has(mod.id);
  });
  return marked.length;
}

// Моды, карточки работ и установки сборки для показа (общее для плитки и окна).
export function contentsOf(build, { entriesOf, modsById, installOrder, workItems }) {
  const ids = catalogIdsOf(build.modIds, modsById);
  const mods = entriesOf(ids);
  const given = build.works || [];
  const works = mergeWorkCards(given, { order: installOrder });
  const contents = buildContents(build, { mods, workItems, modsById });
  return { mods, works, items: contents.engineWorks };
}
