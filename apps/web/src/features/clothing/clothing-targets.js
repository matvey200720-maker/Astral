import {
  assortmentForCached,
  memoByIdentity,
  memoBySubjectKey,
  mergeAssortmentCached,
} from "./assortment-cache.js";
import { ALL, clothingMods, clothingOf } from "./clothing-catalog.js";
import { assortmentItem, catalogAssortment, customAssortmentItem } from "@modovik/clothing/assortment";

// ------------------------------------------------------------ «Заменяет» → вещи

// Записи «Заменяет», из которых вышла вещь игры (источник author); прочие выпадают молча.
const itemsOfRecords = (records, component) =>
  records.flatMap((record) => {
    const item = assortmentItem({ ...record, component }, "author");
    return item ? [item] : [];
  });

// Вещь без сервера годится любому; при `server === null` остаются только такие.
const narrowToServer = (items, server) =>
  server === ALL ? items : items.filter((item) => !item.server || item.server === server);

function targetsOfRecords(replaces, component, server = ALL) {
  return component ? narrowToServer(itemsOfRecords(replaces || [], component), server) : [];
}

export const replacesTargets = memoBySubjectKey(targetsOfRecords);

export const authorTargets = (mod, server = ALL) => {
  const { replaces, component } = clothingOf(mod) ?? {};
  return component ? replacesTargets(replaces, component, server) : [];
};

// ------------------------------------------------------------ каталог и сервер

function catalogOf(mods) {
  return catalogAssortment(Array.from(clothingMods(mods), clothingOf));
}

export const catalogTargets = memoByIdentity(catalogOf);

// Сервер `all` и «не задан» спрашивают только вещи без сервера.
const serverAsked = (server) => (server === ALL ? null : (server ?? null));

const poolOf = (mods, author, extra) => mergeAssortmentCached(catalogTargets(mods), author, ...extra);

export function serverTargets({ mods, wear, server, author = [], extra = [] }) {
  if (!wear) return [];
  const { gender, component } = wear;
  return assortmentForCached(poolOf(mods, author, extra), { server: serverAsked(server), gender, component });
}

// ------------------------------------------------------------ что ставится и своя вещь

export function wearOf(mod) {
  const { gender, component, prop } = clothingOf(mod) ?? {};
  return component ? { gender, component, prop } : null;
}

export function customTarget(wear, fields, server = null) {
  if (!wear) return null;
  return customAssortmentItem(Object.assign({}, wear, fields, { server }));
}
