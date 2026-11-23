import { clothingOf } from "./clothing-catalog.js";
import { assortmentInstallTarget, assortmentItem } from "@modovik/clothing/assortment";

export const TARGET_PROJECTS = Object.freeze("gta5rp majestic".split(" "));

const folded = (text) => String(text || "").toLowerCase();
const firstFilled = (...values) => values.find(Boolean) ?? "";

// Подписи цели и откуда брать каждую: первое непустое значение (имя записи важнее имени вещи).
const LABEL_SOURCES = [
  ["name", (record, item) => [record.name, item.name]],
  ["shop", (record) => [record.shop]],
  ["part", (record) => [record.part]],
];

const labelsOf = (record, item) =>
  Object.fromEntries(LABEL_SOURCES.map(([field, sources]) => [field, firstFilled(...sources(record, item))]));

// Записи известных проектов, из которых вышла вещь игры; ключ цели — проект, имя, магазин и вещь.
const candidatesOf = (block) =>
  block.replaces
    .filter(({ server }) => TARGET_PROJECTS.includes(server))
    .map((record) => ({ record, item: assortmentItem({ ...record, component: block.component }, "author") }))
    .filter(({ item }) => item)
    .map(({ record, item }) => ({
      record,
      item,
      key: `${record.server}|${folded(record.name)}|${folded(record.shop)}|${item.key}`,
    }));

// Из повторов с одним ключом остаётся первая запись.
const firstPerKey = (candidates) =>
  candidates.filter(({ key }, at) => candidates.findIndex((other) => other.key === key) === at);

const optionOf = ({ record, item, key }) =>
  Object.freeze({ key, ...labelsOf(record, item), item, target: assortmentInstallTarget(item) });

export const projectTargets = (mod) => {
  const block = clothingOf(mod);
  if (!block?.component) return [];
  const owned = firstPerKey(candidatesOf(block)).map((candidate) => [candidate.record.server, optionOf(candidate)]);
  return TARGET_PROJECTS.map((server) => ({
    server,
    options: owned.filter(([owner]) => owner === server).map(([, option]) => option),
  }))
    .filter(({ options }) => options.length > 0)
    .map((project) => Object.freeze(project));
};

const installOf = (mod, server, { part, target, item }) => ({ server, modId: part || mod.id, target, item });

export function projectInstalls(mod, projects, picks) {
  return [...projects].reduce((installs, { server, options }) => {
    const chosen = options.find(({ key }) => key === picks[server]);
    return chosen ? installs.concat(installOf(mod, server, chosen)) : installs;
  }, []);
}

export function hasProjectFiles(projects) {
  return projects.some(({ options }) => options.some(({ part }) => part));
}
