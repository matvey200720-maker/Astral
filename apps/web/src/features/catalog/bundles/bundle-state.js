import { variantOf } from "@modovik/publishing";
import { isCatalogBundle, variantSiblings } from "../../../catalog-utils.js";
import { isCatalogWork } from "../../workshop/works/catalog-work.js";
import { chosenMapWork } from "./map-works.js";

// Индекс каталога: первый мод с id, моды групп версий в порядке каталога, id частей-работ.
class CatalogIndex {
  constructor(mods) {
    this.firstById = new Map();
    this.groups = new Map();
    this.workIds = new Set();
    mods.forEach((mod) => this.take(mod));
  }

  take(mod) {
    if (!this.firstById.has(mod.id)) this.firstById.set(mod.id, mod);
    const group = variantOf(mod)?.group;
    if (group && this.groups.has(group)) this.groups.get(group).push(mod);
    else if (group) this.groups.set(group, [mod]);
    if (isCatalogWork(mod)) this.workIds.add(mod.id);
  }

  // Версии части в порядке выбора: сама часть и моды её группы.
  versionsOf(part) {
    return variantSiblings(part, this.groups.get(variantOf(part)?.group));
  }
}

// Индекс привязан к самому массиву каталога: правка массива на месте счёту не видна.
const indexes = new WeakMap();

function catalogIndexOf(mods) {
  if (!indexes.has(mods)) indexes.set(mods, new CatalogIndex(mods));
  return indexes.get(mods);
}

// Состояние по доле стоящих: ноль — ничего, все — всё, иначе часть.
function stateOf(count, total) {
  if (!count) return "none";
  return count === total ? "full" : "partial";
}

const lonely = (part) => ({ mod: part, siblings: [part], group: "" });

// Версия части: выбранная, иначе первая стоящая, иначе она сама.
function choosePart(part, siblings, installed, choices) {
  const group = variantOf(part)?.group || "";
  const picks = [
    () => siblings.find((version) => version.id === choices[group]),
    () => siblings.find((version) => installed.includes(version.id)),
  ];
  let mod = part;
  for (const pick of picks) {
    const hit = pick();
    if (hit) {
      mod = hit;
      break;
    }
  }
  return { mod, siblings, group };
}

export function bundleVariantOf(part, { mods = [], installed = [], choices = {} } = {}) {
  const siblings = variantSiblings(part, mods);
  return siblings.length > 1 ? choosePart(part, siblings, installed, choices) : lonely(part);
}

const emptyReport = () => ({ parts: [], works: [], catalogWorks: [], missingIds: [] });

// Раскладка состава сборки по четырём спискам.
function sortOut(bundle, mods, choice) {
  const report = emptyReport();
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const place = (id) => {
    const mod = byId.get(id);
    if (!mod) return ["missingIds", id];
    if (isCatalogWork(mod)) return ["catalogWorks", mod];
    const own = chosenMapWork(id, choice.mapWorks, choice.choices);
    return own ? ["works", own] : ["parts", bundleVariantOf(mod, { ...choice, mods }).mod];
  };
  (bundle.includedModIds || []).forEach((id) => {
    const [bucket, value] = place(id);
    report[bucket].push(value);
  });
  return report;
}

export function bundleParts(bundle, mods = [], choice = {}) {
  return isCatalogBundle(bundle) ? sortOut(bundle, mods, choice) : emptyReport();
}

// Состав сборки без частей-работ (если каталог задан) и индекс каталога.
function compositionOf(bundle, mods) {
  const listed = isCatalogBundle(bundle) ? bundle.includedModIds || [] : [];
  if (!mods) return { index: null, ids: listed };
  const index = catalogIndexOf(mods);
  return { index, ids: listed.filter((id) => !index.workIds.has(id)) };
}

export function bundleProgress(bundle, installed = [], mods = null, satisfied = []) {
  const standing = new Set(installed);
  const { index, ids } = compositionOf(bundle, mods);

  // Что стоит вместо части: она сама, иначе первая стоящая версия из каталога.
  const standingFor = (id) => {
    if (standing.has(id)) return { id };
    const part = index?.firstById.get(id);
    if (!part) return null;
    return index.versionsOf(part).find((version) => standing.has(version.id)) ?? null;
  };
  const verdictOf = (id) => {
    const found = standingFor(id);
    if (found) return ["stands", found.id];
    return satisfied.includes(id) ? ["replaced"] : ["pending", id];
  };

  const verdicts = ids.map(verdictOf);
  const idsOf = (kind) => verdicts.filter(([tag]) => tag === kind).map(([, id]) => id);
  const installedIds = idsOf("stands");
  const installedCount = installedIds.length + idsOf("replaced").length;
  return { total: ids.length, installedCount, installedIds, pendingIds: idsOf("pending"), state: stateOf(installedCount, ids.length) };
}

export function installedBundles(mods = [], installed = []) {
  const found = [];
  mods.forEach((mod) => {
    if (!isCatalogBundle(mod)) return;
    const progress = bundleProgress(mod, installed, mods);
    if (progress.installedCount > 0) found.push({ bundle: mod, progress });
  });
  return found;
}

export function bundleOriginsOf(records = [], targetId = "") {
  const pairs = records.flatMap((record) => {
    if (targetId && record.targetId !== targetId) return [];
    const bundleId = record?.origin?.bundleId;
    return bundleId ? [[record.modId, bundleId]] : [];
  });
  // fromEntries делает ключ собственным свойством, в том числе __proto__.
  return Object.fromEntries(pairs);
}

export function bundleMembers(bundleId, bundleOf = {}) {
  const members = [];
  Object.keys(bundleOf).forEach((modId) => {
    if (bundleOf[modId] === bundleId) members.push(modId);
  });
  return members;
}

export function dropBundleRest(queue = [], failed) {
  if (!failed?.bundleId) return queue;
  const sameBundle = (row) => row.bundleId === failed.bundleId;
  const isFailedRow = (row) => row.queueId === failed.queueId;
  return queue.filter((row) => !sameBundle(row) || isFailedRow(row) || row.started || row.failed);
}

export function bundleRemoval(bundle, { installed = [], members = [], mods = null } = {}) {
  const { installedIds } = bundleProgress(bundle, installed, mods);
  const ids = [];
  installedIds.forEach((id) => members.includes(id) && ids.push(id));
  return { ids };
}
