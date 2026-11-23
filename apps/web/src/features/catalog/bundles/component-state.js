import { isCatalogBundle } from "../../../catalog-utils.js";
import { bundleParts, bundleProgress } from "./bundle-state.js";
import { componentKeysOf, componentsOf, slotsOf, workReplacedParts } from "./component-choices.js";
import { MERGED_GROUPS, REDUX_BASE_SLOT } from "./component-groups.js";

/*
 * Состав сборки с учётом выбора человека по компонентам (ТЗ владельца 10.11.2026): отключено, заменено пакетами другой сборки, заменено своей
 * работой мастерской. Компонент — слот: все пакеты сборки с одним слотом ведут себя вместе (`componentsOf`).
 *
 * Модуль ленивый и в стартовый кусок не входит (потолок `main-*.js`): раскладку и счёт сборки он берёт у `bundle-state.js`, подменяя только состав — id,
 * которые сборка «включает». Прежние `bundleParts` и `bundleProgress` остаются как были, с ними не расходится ни одна цифра, пока человек ничего не выбрал.
 */

/** Метка «вместо этих пакетов стоит своя работа»: в счёт сборки идёт одной единицей, «стоит», когда стоит сама работа. */
export const WORK_PREFIX = "component-work:";

const NO_CHOICE = Object.freeze({ off: {}, swap: {}, work: {} });

const hasChoice = (components) => Boolean(components) && ["off", "swap", "work"].some((name) => Object.keys(components[name] || {}).length > 0);

/**
 * Пакеты слота у другой сборки: все, что занимают этот слот (в том числе общим архивом нескольких слотов). `own` — слоты самого компонента: общий архив зон
 * (`zones` на три слота) заменяется пакетами любого из них.
 * Источник — не сборка, а отдельная вещь каталога (выбор в каталоге, `component-pick.js`): она сама и есть пакет слота, если слот у неё тот же. Склеенную группу («Эффекты»)
 * вещь не заменяет — только сборка целиком. «Основу редукса» (`redux-base`) не заменяет никто: её файлы лежат только в своём редуксе и «один в один» с ним, чужую основу подставить нельзя.
 */
export function sourceParts(source, key, byId, own = []) {
  if (key === REDUX_BASE_SLOT || own.includes(REDUX_BASE_SLOT)) return [];
  const wanted = new Set([key, ...own].filter(Boolean));
  if (!isCatalogBundle(source)) return source?.id && !Object.hasOwn(MERGED_GROUPS, key) && slotsOf(source).some((slot) => wanted.has(slot)) ? [source] : [];
  return (source.includedModIds || [])
    .map((id) => byId.get(id))
    .filter((part) => part && slotsOf(part).some((slot) => wanted.has(slot)));
}

/**
 * Что сборка включает после выбора человека.
 * @returns {{ ids: string[], skipped: string[], works: object[] }} `ids` — состав (id частей и метки работ), `skipped` — отключённые пакеты,
 * `works` — свои работы на месте компонентов: сама работа плюс `slot` и `slots` (слоты компонентов, куда она встала) и `partIds` (родные пакеты этих слотов, `partId` — первый).
 */
export function resolveComponents(bundle, mods = [], components = NO_CHOICE, ownWorks = []) {
  const listed = bundle?.includedModIds || [];
  if (!hasChoice(components)) return { ids: listed, skipped: [], works: [] };
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const members = listed.map((id) => byId.get(id)).filter(Boolean);
  const skipped = [];
  const works = [];
  /* Решение по компоненту, а ставятся части в порядке сборки: части одного компонента остаются на своих местах (`includedModIds`), замена и метка работы встают там, где
     компонент впервые встретился. Раньше состав склеивался по компонентам, и части «Эффектов» уезжали друг к другу мимо чужих компонентов между ними. */
  const decisions = new Map();
  for (const { key, parts } of componentsOf(members)) {
    const own = parts.map((part) => part.id);
    if (components.off?.[key]) {
      skipped.push(...own);
      decisions.set(key, { kind: "off" });
      continue;
    }
    const work = components.work?.[key] ? ownWorks.find((item) => item.key === components.work[key]) : null;
    if (work) {
      /* Одна работа «Запретных зон» стоит на все три слота зон: в очередь мастерской она уходит один раз, а родные пакеты всех её слотов — вместе. Работа вместо «Эффектов»
         заменяет только пакет попаданий, остальные пакеты группы остаются в составе. */
      const replaced = workReplacedParts(key, parts).map((part) => part.id);
      const placed = works.find((item) => item.key === work.key);
      if (placed) {
        placed.slots.push(key);
        placed.partIds.push(...replaced);
      } else {
        works.push({ ...work, slot: key, slots: [key], partId: replaced[0] ?? own[0], partIds: [...replaced] });
      }
      decisions.set(key, { kind: "work", marker: `${WORK_PREFIX}${key}`, replaced: new Set(replaced) });
      continue;
    }
    const source = components.swap?.[key] && components.swap[key] !== bundle.id ? byId.get(components.swap[key]) : null;
    const replacement = source ? sourceParts(source, key, byId, parts.flatMap(slotsOf)) : [];
    decisions.set(key, replacement.length ? { kind: "swap", ids: replacement.map((part) => part.id) } : { kind: "own" });
  }
  const keys = componentKeysOf(members);
  const opened = new Set();
  const ids = [];
  for (const part of members) {
    const key = keys.get(part.id);
    const decision = decisions.get(key) || { kind: "own" };
    if (decision.kind === "off") continue;
    if (decision.kind === "swap") {
      if (!opened.has(key)) ids.push(...decision.ids);
      opened.add(key);
      continue;
    }
    if (decision.kind === "work") {
      if (!opened.has(key)) ids.push(decision.marker);
      opened.add(key);
      if (!decision.replaced.has(part.id)) ids.push(part.id);
      continue;
    }
    ids.push(part.id);
  }
  const missing = listed.filter((id) => !byId.has(id));
  return { ids: [...new Set([...ids, ...missing])], skipped, works };
}

/** `bundleParts` с выбором человека: то же, что отдаёт он, и ещё `skipped` (отключённые пакеты) и `componentWorks` (свои работы на месте компонентов). */
export function bundlePartsOf(bundle, mods = [], choice = {}) {
  const { ids, skipped, works } = resolveComponents(bundle, mods, choice.components, choice.ownWorks || []);
  const real = ids.filter((id) => !id.startsWith(WORK_PREFIX));
  return { ...bundleParts({ ...bundle, includedModIds: real }, mods, choice), skipped, componentWorks: works };
}

/** `bundleProgress` с выбором человека: отключённое не считается, замена стоит на месте родной, работа «стоит», когда стоит сама. */
export function bundleProgressOf(bundle, installed = [], mods = null, satisfied = [], components = null, ownWorks = []) {
  const { ids, works } = resolveComponents(bundle, mods || [], components || NO_CHOICE, ownWorks);
  const worksStand = works.filter((work) => work.installed).flatMap((work) => work.slots.map((slot) => `${WORK_PREFIX}${slot}`));
  const progress = bundleProgress({ ...bundle, includedModIds: ids }, installed, mods, [...satisfied, ...worksStand]);
  return { ...progress, componentWorks: works };
}
