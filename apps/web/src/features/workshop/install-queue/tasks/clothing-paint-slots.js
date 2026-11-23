
import { tr } from "../../../../locales/ui.js";
/*
 * Поставленные покраски одежды по категориям (ТЗ 04.10.2026, задача 7):
 * готовая вещь видна в «Библиотеке» и в «Моих вещах» своей категории.
 *
 * Отдельный модуль без зависимостей: полка библиотеки стоит в стартовом
 * куске окна, а модуль установки покраски тянет за собой мост к Desktop и
 * очередь. Здесь — только чтение той же записи `localStorage`.
 */

export const CLOTHING_SKIN_INSTALLS_KEY = "astral.clothing-studio.install.v1";

/* Тату сервера живёт в той же памяти: «Снять» и «Мои работы» — общие. */
export const CLOTHING_MOD_ID =
  /^local-(?:clothing-(?:skin|replace)|server-tattoo|tattoo-paint)-/;

/*
 * Категория — из снимка проекта в записи (`installedState.slot`), запасом —
 * из ключа вещи («masks-12», «tattoos:server:…»).
 */
function installedPaints(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = JSON.parse(storage?.getItem(CLOTHING_SKIN_INSTALLS_KEY) || "null");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([, record]) => CLOTHING_MOD_ID.test(record?.modId || ""))
    .map(([key, record]) => {
      let slot = "";
      try {
        slot = String(JSON.parse(record.installedState || "null")?.slot || "");
      } catch {
        slot = "";
      }
      return { key, record, slot: slot || key.split(/[-:]/)[0] };
    });
}

/** Покраски этой категории, что стоят в игре: `[{ key, record, slot }]`. */
export const installedClothingPaints = (slotId, storage) =>
  installedPaints(storage).filter((item) => item.slot === slotId);

/** Категории, в которых стоит хоть одна покраска. */
export const installedClothingPaintSlots = (storage) =>
  new Set(installedPaints(storage).map((item) => item.slot));

/*
 * Каждая вещь — отдельной карточкой «Библиотеки» (задача 3 ТЗ 06.10.2026,
 * вечер): покраска вещи — одна карточка (на какие бы вещи сервера она ни
 * легла), работа тату на теле — своя у каждой работы (`works`). Слот
 * карточки — `clothing-item:<вещь>[:<работа>]`: по нему корзина находит,
 * что снимать.
 */
const ITEM_SLOT = "clothing-item:";

/**
 * Пакеты работы: у работы с тела на каждое тату свой (`modIds`), у записи до 01.11.2026 пакет один.
 */
export const workModIds = (work) => (Array.isArray(work?.modIds) && work.modIds.length ? work.modIds : [work?.modId]).filter(Boolean);

/**
 * Та же ли это работа, что `identity` (`{ workId, name }`). У работы, поставленной до 01.11.2026, метки нет: она узнаётся по имени — сохранённая работа и черновик названы как были.
 */
export const sameInstalledWork = (work, identity) =>
  work?.workId ? work.workId === identity?.workId : Boolean(identity?.name) && work?.name === identity.name;

/** Работа без пакетов `removed`: `null`, если не осталось ни одного. */
export function workWithoutMods(work, removed) {
  const left = workModIds(work).filter((modId) => !removed.has(modId));
  if (!left.length) return null;
  if (left.length === workModIds(work).length) return work;
  const packages = (work.packages || []).filter((item) => !removed.has(item.modId));
  return {
    ...work,
    modId: left[0],
    modIds: left,
    ...(work.packages ? { packages, targets: packages.map(({ key, title }) => ({ key, title })) } : {}),
  };
}

const workName = (work) => {
  const targets = Array.isArray(work?.targets) ? work.targets : [];
  const name = String(work?.name || "");
  if (!targets.length) return name;
  const shown = String(targets[0]?.title || targets[0]?.key || "");
  return `${name || tr("Тату")} → ${targets.length > 1 ? `${targets.length} тату` : shown}`;
};

/** Поставленные вещи и работы: `[{ id, key, slot, name, modIds, installedAt }]`. */
export function installedClothingItems(storage = globalThis.localStorage) {
  const out = [];
  for (const { key, record, slot } of installedPaints(storage)) {
    if (Array.isArray(record.works) && record.works.length) {
      for (const work of record.works)
        if (CLOTHING_MOD_ID.test(work?.modId || ""))
          out.push({
            id: `${ITEM_SLOT}${key}:${work.modId}`,
            key,
            slot,
            name: workName(work),
            modIds: workModIds(work),
            installedAt: String(work.installedAt || ""),
          });
      continue;
    }
    const modIds = (record.modIds?.length ? record.modIds : [record.modId]).filter((modId) =>
      CLOTHING_MOD_ID.test(modId || ""),
    );
    out.push({
      id: `${ITEM_SLOT}${key}`,
      key,
      slot,
      name: slot === "tattoos" ? workName(record) : String(record.name || ""),
      modIds,
      installedAt: String(record.installedAt || ""),
      /* Что красили, на что легло и кадр покраски: библиотека рисует по ним пару «вещь → заменёнка» (`paintPairOf`). */
      source: record.source || null,
      targets: Array.isArray(record.targets) ? record.targets : [],
      cover: typeof record.cover === "string" ? record.cover : "",
    });
  }
  return out;
}

/** Установки покраски одежды для полки и корзины библиотеки. */
export const clothingPaintUnits = (storage = globalThis.localStorage) =>
  installedClothingItems(storage).flatMap((item) =>
    item.modIds.map((modId) => ({
      kind: "mod",
      key: `mod:${modId}`,
      modId,
      name: item.name,
      slots: [item.id],
      installedAt: item.installedAt,
      origin: { type: "clothing-paint", key: item.key },
    })),
  );

/**
 * После снятия из библиотеки: снятые пакеты уходят из записей покраски,
 * запись без пакетов — целиком. Возвращает, менялось ли что-то.
 */
export function forgetClothingPaintMods(storage = globalThis.localStorage, removed = new Set()) {
  if (!storage || !removed?.size) return false;
  let raw;
  try {
    raw = JSON.parse(storage.getItem(CLOTHING_SKIN_INSTALLS_KEY) || "null");
  } catch {
    return false;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  let changed = false;
  for (const [key, record] of Object.entries(raw)) {
    if (!record || typeof record !== "object") continue;
    if (Array.isArray(record.works) && record.works.length) {
      const works = record.works.map((work) => workWithoutMods(work, removed)).filter(Boolean);
      if (works.length === record.works.length && works.every((work, at) => work === record.works[at])) continue;
      changed = true;
      if (!works.length) delete raw[key];
      else {
        const last = works.at(-1);
        raw[key] = { ...record, ...last, works, modIds: works.flatMap(workModIds) };
      }
      continue;
    }
    const modIds = (record.modIds?.length ? record.modIds : [record.modId]).filter(Boolean);
    const left = modIds.filter((modId) => !removed.has(modId));
    if (left.length === modIds.length) continue;
    changed = true;
    if (!left.length) delete raw[key];
    else raw[key] = { ...record, modId: left[0], modIds: left };
  }
  if (!changed) return false;
  try {
    storage.setItem(CLOTHING_SKIN_INSTALLS_KEY, JSON.stringify(raw));
  } catch {
    return false;
  }
  return true;
}
