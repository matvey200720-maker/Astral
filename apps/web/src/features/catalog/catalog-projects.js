import { useSyncExternalStore as useExternalStore } from "react";
import { projectOfCard } from "@modovik/clothing/card-project";
import { clothingOf as clothingCard } from "../clothing/clothing-catalog.js";
import { advantageRisk as givesEdge } from "./recommend.js";

const EVERY_PROJECT = "all";

export { EVERY_PROJECT as ALL_PROJECTS };

const STORAGE_KEY = "astral.project.v1";

// id, подпись, знак, вписывание знака, фирменный цвет.
const PROJECT_ROWS = [
  ["majestic", "Majestic", "/brands/majestic.png", "cover", "#e0015b"],
  ["gta5rp", "GTA 5 RP", "/brands/gta5rp.png", "contain", "#ff9e00"],
  ["russia", "Россия Онлайн", "/brands/russia-online.svg", "contain", "#c83d3d"],
];

export const PROJECTS = Object.freeze(
  PROJECT_ROWS.map(([id, label, logo, fit, accent]) => Object.freeze({ id, label, logo, fit, accent })),
);

const PROJECT_IDS = PROJECTS.map((project) => project.id);

// Написания в данных (строчные, пробелы внутри — дефис), сгруппированные по проекту. RMRP намеренно нет.
const SPELLING_GROUPS = {
  majestic: ["majestic", "majesticrp", "majestic-rp"],
  gta5rp: ["gta5rp", "gta5-rp", "gta-5-rp"],
  russia: ["russia", "russia-online", "russiaonline", "rusonline"],
};

const SPELLINGS = new Map(
  Object.entries(SPELLING_GROUPS).flatMap(([id, names]) => names.map((name) => [name, id])),
);

// Слова в подписи совместимости: перед словом начало строки или не-буква, после — что угодно.
const LABEL_PATTERNS = {
  majestic: /(?<!\p{L})(?:majestic|маджестик|мажестик)/iu,
  gta5rp: /(?<!\p{L})(?:gta\s?5\s?rp|гта\s?5\s?рп)/iu,
  russia: /(?<!\p{L})(?:россия|russia)\s+(?:онлайн|online)/iu,
};

const LIST_FIELDS = ["projects", "platforms", "servers"];
const RISKY_PROJECT = "gta5rp";

/* Сборка редукса (ведущая карточка пака) от выбора проекта не зависит от своих частей: в каждом редуксе есть «Трейсеры», а у многих и «Прострелы», и за них сборка не теряет GTA 5 RP
   (слово владельца 14.11.2026: редукс виден целиком, со всеми частями). Решает подпись серверов самой сборки; отдельные части вне редукса правило «преимущество» сохраняют. */
const isReduxPack = (mod) => mod.reduxLead === true || mod.catalogSlot === "redux-pack";

function spelled(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.split(/\s+/).join("-");
}

// Узнанные проекты из списка названий, в порядке списка, без повторов.
function recognize(names) {
  const known = names.map((name) => SPELLINGS.get(spelled(name))).filter(Boolean);
  return new Set(known);
}

// Источники по убыванию силы; каждый отдаёт множество или null, если сказать нечего.
const SOURCES = [
  function byClothing(mod) {
    const servers = (clothingCard(mod)?.replaces ?? []).map((swap) => swap.server).filter(Boolean);
    return servers.length ? recognize(servers) : null;
  },
  function byLists(mod) {
    for (const field of LIST_FIELDS) {
      const list = mod[field];
      const found = Array.isArray(list) && list.length > 0 ? recognize(list) : null;
      if (found && found.size > 0) return found;
    }
    return null;
  },
  function byLabel(mod) {
    const label = mod.platformLabel ? String(mod.platformLabel) : "";
    if (!label) return null;
    const hits = Object.entries(LABEL_PATTERNS).filter(([, pattern]) => pattern.test(label));
    return hits.length > 0 ? new Set(hits.map(([id]) => id)) : null;
  },
];

// Кеш по объекту мода — только для вызовов без карты каталога.
const projectsOfMod = new WeakMap();

function projectsFor(mod, byId) {
  let picked = null;
  for (const source of SOURCES) {
    picked = source(mod);
    if (picked) break;
  }
  const set = picked ?? new Set(PROJECT_IDS);
  if (givesEdge(mod, isReduxPack(mod) ? null : byId)) set.delete(RISKY_PROJECT);
  return set;
}

export function modProjects(mod, byId = null) {
  if (mod === null || typeof mod !== "object") return new Set();
  if (byId) return projectsFor(mod, byId);
  if (!projectsOfMod.has(mod)) projectsOfMod.set(mod, projectsFor(mod, byId));
  return projectsOfMod.get(mod);
}

export function modFitsProject(mod, project, byId = null) {
  const open = !project || project === EVERY_PROJECT;
  return open || modProjects(mod, byId).has(project);
}

/* «Подходит проекту» (`modFitsProject`, `modProjects`) и «из паков проекта» — разные вопросы. Вещь из паков GTA 5 RP ставится заменёнкой и на Majestic: она подходит обоим проектам, и «Работает на» на её странице
   называет оба (владелец, главный сценарий). А в выдаче «Одежды» при выбранном проекте глобуса (16.11.2026, слово владельца: «при Majestic стоят вещи из паков GTA 5 RP») карточка из паков проекта (`projectOfCard`:
   слаг карточки и блок `dlc`, `packages/clothing/card-project.js`) стоит только при своём проекте. Работы авторов (не паки) — по прежнему правилу «подходит». Id проекта глобуса и id проекта пака не совпадают
   (`majestic` и `majesticrp`); у Nova RP в глобусе пункта нет — её вещи видны только на «Все проекты». Функцию зовут только места, что строят выдачу и счётчики «Одежды»; страница вещи, «Работает на», установка и мастерская
   читают `modProjects` и от неё не зависят. `fits` — уже посчитанное множество `modProjects(mod)`, если оно есть у вызывающего. */
const PACK_PROJECT = Object.freeze({ gta5rp: "gta5rp", majesticrp: "majestic" });

export function listedForProject(mod, project, fits = null) {
  if (!project || project === EVERY_PROJECT) return true;
  const pack = projectOfCard(mod);
  if (pack) return PACK_PROJECT[pack] === project;
  return (fits ?? modProjects(mod)).has(project);
}

const projectField = (id, field) => PROJECTS.find((project) => project.id === id)?.[field] ?? "";

export const projectLabel = (id) => projectField(id, "label");

export const projectLogo = (id) => projectField(id, "logo");

// Выбор проекта: память модуля (undefined — ещё не читали), подписчики хука.
let chosen;
const listeners = new Set();

function readStored() {
  let stored = null;
  try {
    stored = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    // хранилища нет или чтение отказало: считаем, что записи нет
  }
  return PROJECT_IDS.includes(stored) ? stored : EVERY_PROJECT;
}

function writeStored(project) {
  try {
    if (project === EVERY_PROJECT) globalThis.localStorage.removeItem(STORAGE_KEY);
    else globalThis.localStorage.setItem(STORAGE_KEY, project);
  } catch {
    // хранилища нет или оно отказало: выбор живёт в памяти до закрытия окна
  }
}

export function getProject() {
  if (chosen === undefined) chosen = readStored();
  return chosen;
}

export function setProject(next) {
  chosen = PROJECT_IDS.includes(next) ? next : EVERY_PROJECT;
  writeStored(chosen);
  [...listeners].forEach((notify) => notify());
}

export function resetProjectForTests() {
  chosen = undefined;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProject() {
  return [useExternalStore(subscribe, getProject, () => EVERY_PROJECT), setProject];
}
