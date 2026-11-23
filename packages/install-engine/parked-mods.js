/*
 * Моды, снятые проверкой файлов игры (задача 2 ТЗ 10.10.2026).
 *
 * Steam, Epic и Rockstar Games Launcher при проверке целостности кладут в
 * игру штатные архивы; обновление игры и лаунчеры проектов (своя копия
 * update.rpf) — тоже. Модов Astral в игре после этого нет. Раньше движок об
 * этом не знал: библиотека показывала «установлено», а первая же установка
 * любого мода молча возвращала в игру все прежние — человек не понимал, что
 * произошло, и не мог решить сам.
 *
 * Теперь перебазирование, увидев, что Astral из архива ушёл
 * (`astralLeftUpdate`, `restoredToStock`), не кладёт прежние слои обратно, а
 * переносит моды этих архивов в «снятые проверкой файлов» (`target.parked`):
 * запись установки, все слои мода по записям архивов, регистрации его пакетов
 * DLC. Мод не числится установленным — окно покажет его неустановленным и
 * предложит «Установить снова», — но ничего не потеряно: файлы слоёв остаются
 * в хранилище (их держит уборка, `cache-housekeeping.js`), и «Установить
 * снова» (`restoreParkedMods`) кладёт те же слои поверх нового архива игры
 * одной транзакцией.
 */

import { WAITING_FOR_VERSION } from "./stock-guard.js";

const UPDATE_ARCHIVE = "update/update.rpf";
/*
 * Прямые DLC Astral — по пути хоста (`direct-dlcs.js` держит тот же список,
 * но его модули сами импортируют перебазирование: кольцо). Записи состояния
 * своих хостов есть только у оружия и одежды.
 */
const DLC_HOST = /^update\/x64\/dlcpacks\/(astral_[a-z0-9_]+)\/dlc\.rpf$/i;
const DLC_STATE = Object.freeze({ astral_weapons: "fastWeaponDlc", astral_clothing: "clothingDlc" });
const dlcOf = (archive) => {
  const name = DLC_HOST.exec(String(archive || ""))?.[1]?.toLowerCase();
  return name ? { name, target: archive, state: DLC_STATE[name] || null } : null;
};
const dlcsOf = (target) => Object.keys(target.archives || {}).map(dlcOf).filter(Boolean);
/* Сколько модов помнит «снятые» — с запасом на любую сборку. */
const MAX_PARKED = 512;

const lower = (value) => String(value || "").toLowerCase();

/* Слои мода по записям архивов и ресурсам — что снимается и что вернётся. */
function layersOf(target, modId) {
  const entries = [];
  for (const [archive, record] of Object.entries(target.archives || {}))
    for (const [entry, state] of Object.entries(record?.entries || {})) {
      const own = (state?.layers || []).filter((layer) => layer?.modId === modId);
      if (own.length) entries.push({ archive, entry, layers: own });
    }
  const resources = [];
  for (const [relativePath, resource] of Object.entries(target.resources || {})) {
    const own = (resource?.layers || []).filter((layer) => layer?.modId === modId);
    if (own.length) resources.push({ relativePath, layers: own });
  }
  return { entries, resources };
}

/**
 * Моды, у которых есть слой в одном из архивов `archives` (пути как в
 * состоянии), а если среди них update.rpf — ещё и моды прямых DLC Astral: их
 * регистрация живёт в dlclist.xml update.rpf и ушла вместе с ним.
 */
export function modsInArchives(target, archives) {
  const wanted = new Set([...archives].map(lower));
  if (wanted.has(UPDATE_ARCHIVE)) for (const dlc of dlcsOf(target)) wanted.add(lower(dlc.target));
  const mods = new Set();
  for (const [archive, record] of Object.entries(target.archives || {})) {
    if (!wanted.has(lower(archive))) continue;
    for (const state of Object.values(record?.entries || {}))
      for (const layer of state?.layers || [])
        if (layer?.modId && !String(layer.modId).startsWith("@")) mods.add(layer.modId);
  }
  for (const item of target.installed || [])
    if ((item?.archiveEntries || []).some((entry) => wanted.has(lower(entry?.target)))) mods.add(item.modId);
  return mods;
}

/**
 * Переносит моды `modIds` в «снятые проверкой файлов». Состояние цели
 * меняется на месте; возвращает id перенесённых.
 */
export function parkMods(target, { modIds, reason = "restored", archives = [], waiting = {} }) {
  const ids = [...new Set([...modIds].filter(Boolean))];
  if (!ids.length) return [];
  const parked = Array.isArray(target.parked) ? target.parked : [];
  const at = new Date().toISOString();
  const moved = [];
  for (const modId of ids) {
    const record = (target.installed || []).find((item) => item?.modId === modId) || null;
    const { entries, resources } = layersOf(target, modId);
    if (!record && !entries.length && !resources.length) continue;
    const dlcs = {};
    for (const item of entries) {
      const dlc = dlcOf(item.archive);
      if (dlc && target.directDlcRegistrations?.[dlc.name]) dlcs[dlc.name] = target.directDlcRegistrations[dlc.name];
    }
    parked.push({ modId, record, entries, resources, dlcs, parkedAt: at, reason, archives: [...archives], ...(waiting[modId]?.length ? { waiting: waiting[modId] } : {}) });
    moved.push(modId);
  }
  const gone = new Set(moved);
  for (const record of Object.values(target.archives || {}))
    for (const state of Object.values(record?.entries || {}))
      if (Array.isArray(state?.layers)) state.layers = state.layers.filter((layer) => !gone.has(layer?.modId));
  for (const resource of Object.values(target.resources || {}))
    if (Array.isArray(resource?.layers)) resource.layers = resource.layers.filter((layer) => !gone.has(layer?.modId));
  target.installed = (target.installed || []).filter((item) => !gone.has(item?.modId));
  /* Пакет DLC без единого слоя — выключен: в dlclist.xml его уже нет. */
  for (const dlc of dlcsOf(target)) {
    const layered = Object.values(target.archives?.[dlc.target]?.entries || {}).some((state) => (state?.layers || []).length);
    if (layered || !target.directDlcRegistrations?.[dlc.name]) continue;
    delete target.directDlcRegistrations[dlc.name];
    if (dlc.state && target[dlc.state]) target[dlc.state].preparedOnly = true;
  }
  /* Тот же мод, снятый второй раз, — одна запись: последняя. */
  const seen = new Set();
  target.parked = parked
    .reverse()
    .filter((item) => (seen.has(item.modId) ? false : seen.add(item.modId)))
    .reverse()
    .slice(-MAX_PARKED);
  return moved;
}

/**
 * Возвращает снятые моды (`modIds`, по умолчанию — все) в установленные.
 * Их слои ложатся под слои того, что поставлено после проверки файлов: оно
 * новее. Возвращает id вернувшихся и архивы, которые надо собрать заново.
 */
export function unparkMods(target, { modIds = null } = {}) {
  /* Мод, поставленный заново после проверки файлов, — уже не «снятый». */
  const now = new Set((target.installed || []).map((item) => item?.modId));
  const parked = (Array.isArray(target.parked) ? target.parked : []).filter((item) => !now.has(item.modId));
  target.parked = parked;
  const wanted = modIds ? new Set(modIds) : null;
  /* Мод, которому после обновления игры нужна новая версия (`stock-guard.js`), старыми слоями не возвращается — даже по прямой просьбе: его файл ляжет поверх нового штатного. */
  const restoring = parked.filter((item) => item.reason !== WAITING_FOR_VERSION && (!wanted || wanted.has(item.modId)));
  if (!restoring.length) return { restored: [], archives: new Set(), dlcs: [] };
  const archives = new Set();
  const dlcs = new Set();
  target.archives ||= {};
  target.resources ||= {};
  target.installed ||= [];
  target.directDlcRegistrations ||= {};
  const installed = new Set(target.installed.map((item) => item?.modId));
  /* Снизу вверх: снятые раньше легли раньше. */
  for (const item of [...restoring].reverse()) {
    for (const { archive, entry, layers } of item.entries || []) {
      const record = (target.archives[archive] ||= { entries: {} });
      record.entries ||= {};
      const state = (record.entries[entry] ||= { layers: [] });
      state.layers = [...layers, ...(state.layers || []).filter((layer) => layer?.modId !== item.modId)];
      delete record.lastBuilt;
      archives.add(archive);
    }
    for (const { relativePath, layers } of item.resources || []) {
      const resource = target.resources[relativePath];
      if (!resource) continue;
      resource.layers = [...layers, ...(resource.layers || []).filter((layer) => layer?.modId !== item.modId)];
      archives.add(relativePath);
    }
    for (const [name, registration] of Object.entries(item.dlcs || {})) {
      if (!target.directDlcRegistrations[name]) target.directDlcRegistrations[name] = registration;
      dlcs.add(name);
    }
    if (item.record && !installed.has(item.modId)) {
      target.installed.unshift(item.record);
      installed.add(item.modId);
    }
  }
  for (const name of dlcs) {
    const state = DLC_STATE[name];
    if (state && target[state]) target[state].preparedOnly = false;
  }
  const back = new Set(restoring.map((item) => item.modId));
  target.parked = parked.filter((item) => !back.has(item.modId));
  return { restored: [...back], archives, dlcs: [...dlcs] };
}

/*
 * Работа мастерской поставлена заново, новой версией (у работ свои id:
 * `local-legacy-vegetation-<отпечаток>`): её прежняя версия среди «снятых»
 * уже не нужна — «Установить снова» положила бы её под новую.
 */
const workFamily = (modId) => {
  const id = String(modId || "");
  return id.startsWith("local-") ? id.replace(/-[0-9a-f]{8,}$/i, "") : "";
};

export function forgetSupersededParked(target, { modId, slots = [] }) {
  if (!Array.isArray(target?.parked) || !target.parked.length) return false;
  const family = workFamily(modId);
  const wanted = new Set(slots || []);
  const before = target.parked.length;
  target.parked = target.parked.filter((item) => {
    if (item.modId === modId) return false;
    if (!family || workFamily(item.modId) !== family) return true;
    const own = item.record?.slots || [];
    return own.length && wanted.size ? !own.some((slot) => wanted.has(slot)) : false;
  });
  return target.parked.length !== before;
}

/** Снятый мод уходит совсем («Удалить» в библиотеке). */
export function forgetParked(target, modId) {
  const before = (target?.parked || []).length;
  if (!before) return false;
  target.parked = target.parked.filter((item) => item?.modId !== modId);
  return target.parked.length !== before;
}

/** Снятые моды для окна: без слоёв и описей. */
export function parkedSummary(target) {
  const now = new Set((target?.installed || []).map((item) => item?.modId));
  return (Array.isArray(target?.parked) ? target.parked : []).filter((item) => !now.has(item.modId)).map((item) => ({
    modId: item.modId,
    parkedAt: item.parkedAt,
    reason: item.reason,
    ...(item.waiting?.length ? { waiting: item.waiting.map((row) => row.entry) } : {}),
    /* Релиз каталога, которому отказали «в каталоге пока прежняя версия» (`stock-guard.js`). */
    ...(item.refusedRelease ? { refusedRelease: item.refusedRelease } : {}),
    ...(item.record?.version ? { version: item.record.version } : {}),
    ...(Array.isArray(item.record?.slots) ? { slots: item.record.slots } : {}),
    ...(item.record?.origin ? { origin: item.record.origin } : {}),
  }));
}

/** Файлы слоёв снятых модов — их держит уборка кэша. */
export function parkedCachePaths(target) {
  const paths = [];
  for (const item of Array.isArray(target?.parked) ? target.parked : []) {
    for (const { layers } of item.entries || []) for (const layer of layers || []) if (layer?.cachePath) paths.push(layer.cachePath);
    for (const { layers } of item.resources || []) for (const layer of layers || []) if (layer?.cachePath) paths.push(layer.cachePath);
  }
  return paths;
}
