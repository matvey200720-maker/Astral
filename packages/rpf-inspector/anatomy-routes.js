/*
 * Маршрутные компоненты редукса → заявки (пакет Р3б, проект `REDUX-SYSTEM-1011.md`, §4.4 и §6.2; Хелпер 28, 10.11.2026).
 *
 * Архивные компоненты (арена, ангар, залазы…) собирает `anatomy-drafts.js`: архив автора целиком, слоем Astral. Здесь — компоненты, чьи
 * файлы игра читает по штатным путям: мини-карта, прицел, большая карта, положение мини-карты, цвета интерфейса, вода, таймцикл (с облаками
 * отдельным слотом `clouds`), переключатели оптимизации и быстрый вход. Они ставятся записями `update.rpf` (`rpf-entry`): запись автора ложится на
 * штатный путь игры, остальное в штатном архиве остаётся как есть. Слой мира и записи `update.rpf` подпись в одном пакете не разрешает,
 * поэтому облака — свой компонент со своим слотом (`clouds`; а если у редукса оба вида облаков — `clouds` и `clouds-layer`).
 *
 * Чистый модуль, как `anatomy-drafts.js`: байтов не читает. Единственная внедряемая зависимость — `modifiersOf(путь файла) → имена
 * модификаторов`: слой таймцикла ставится по именам, а имена лежат внутри файла.
 *
 * Не здесь: эффекты (`core.ypt`, `bloodfx.dat`, привязки трассеров — Р3в), звуки автора (`.awc`), ганпаки и одежда.
 */

import { createHash } from "node:crypto";
import { getLegacyModTarget } from "@modovik/mod-targets";
import { exactRouteIndex } from "./rules.js";
import { postKey } from "./post-key.js";
import { ARCHIVE_CAPABILITIES, ID_LIMIT, LAYER_STRATEGY, NO_MEDIA, UPDATE_RPF, idPrefixOf, layerContainer, partLabel, payloadName, placementOf, plural } from "./anatomy-drafts.js";

const ENTRY_CAPABILITIES = Object.freeze(["direct-update-entries-v1", "rpf-container-entry-v1"]);
const TIMECYCLE_MERGE = "timecycle-modifier-v1";
const MODIFIER_FILE = /(^|\/)timecycle_mods_\d+\.xml$/i;
const GRASS_DICTIONARY = /(^|\/)plantsmgr\d*\.ytd$/;
const CLOUDHATS = /(^|\/)cloudhats\/[^/]+\.rpf$/i;
const VECTOR_MAP = "x64/levels/gta5/minimap.rpf";
const DEFAULT_ACTION = "upsert";
const PRIORITY = 100;
const KILL_PRIORITY = 200;
const NAMES_LIMIT = 128;
const FILE_PARTS = 99;

/** Слоты анатомии, которые собирает этот модуль. Остальные — `deferred`. */
export const ROUTE_SLOTS = Object.freeze(["minimap", "crosshair", "large-map", "minimap-position", "hudcolor", "water", "timecycle", "optimization-toggles"]);

/* Слот установки и вид полки каталога по слоту анатомии. У прицела слот установки старый — `reticle` (его же держат мастерская и прежние
   пакеты каталога, `mod-targets`), слот полки — `crosshair`; окно сводит компонент по слоту установки. */
const KIND_OF_SLOT = Object.freeze({
  minimap: { kind: "minimap", slots: ["minimap"] },
  crosshair: { kind: "reticle", slots: ["reticle"] },
  "large-map": { kind: "large-map", slots: ["large-map"] },
  "minimap-position": { kind: "minimap-position", slots: ["minimap-position"] },
  hudcolor: { kind: "hudcolor", slots: ["hudcolor"] },
  water: { kind: "water", slots: ["water"] },
  timecycle: { kind: "timecycle", slots: ["timecycle"] },
});

/* Полка цветов интерфейса: своей в таблице места нет — раздел «Интерфейс», подраздел «HUD» (список подразделов окна, `catalogSections.js`). */
const HUDCOLOR_SHELF = Object.freeze({ category: "graphics", categoryLabel: "Цвета интерфейса", section: "redux", slot: "hudcolor", catalogCategory: "interface", catalogSubcategory: "HUD" });

const TOGGLE_LABELS = Object.freeze({
  "no-dirt": "Без грязи",
  "no-rain": "Без дождя",
  "no-wheel-smoke": "Без дыма колёс",
  "no-clouds": "Без облаков",
  "no-grass": "Без травы",
  "no-explosion-shake": "Без тряски от взрывов",
  "no-particles": "Без частиц",
  "no-drug-effects": "Без эффектов веществ",
});

/* Модификаторы килл-эффекта — те, что знает прежний разбор и мастерская (`mod-targets: kill-effects`). Они едут своим пакетом, из таймцикла исключены. */
let killCache = null;
export function killEffectNames() {
  if (killCache) return killCache;
  const names = new Set();
  for (const target of getLegacyModTarget("kill-effects")?.targets ?? []) for (const name of target.merge?.includeNames ?? []) names.add(String(name).toLowerCase());
  killCache = names;
  return killCache;
}

/* Файлы, которые автор подключает строкой `content.xml` или кладёт под своим именем: у игрока они встают на штатный путь (§4.5). */
const FILE_ROUTES = Object.freeze({ "hudcolor.dat": "common/data/ui/hudcolor.dat" });

let routeCache = null;
function routes() {
  if (routeCache) return routeCache;
  const byEntry = new Map();
  const byBase = new Map();
  for (const [entry, claims] of exactRouteIndex()) {
    const info = { entry, ids: [...new Set(claims.map((item) => item.id))], action: claims[0]?.action || "replace", option: claims.find((item) => item.option)?.option ?? null };
    byEntry.set(entry, info);
    const base = entry.split("/").pop();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(info);
  }
  routeCache = { byEntry, byBase };
  return routeCache;
}

const lower = (value) => String(value ?? "").split("\\").join("/").toLowerCase();
const lastOf = (path) => lower(path).split("/").pop();

/**
 * Куда файл ложится у игрока: штатный путь записи и действие.
 *
 * `null` — для файла нет штатного маршрута (игра не прочитает его из чужого контейнера); такой файл в заявку не идёт, а называется в отчёте.
 */
export function installOf(unit, file) {
  const { byEntry, byBase } = routes();
  const known = (entry) => byEntry.get(lower(entry));
  const make = (entry, info) => ({ entry, action: info?.action || DEFAULT_ACTION, option: info?.option ?? null, ids: info?.ids ?? [] });
  if (file.install) return make(file.install, known(file.install));
  if (unit.type === "file") {
    const entry = FILE_ROUTES[lastOf(file.path)];
    return entry ? make(entry, known(entry)) : null;
  }
  if (unit.type === "route" && !unit.path) return make(file.path, known(file.path));
  /* Файл-маршрут внутри архива автора: по имени — единственный штатный путь с таким именем. */
  const same = byBase.get(lastOf(file.inner)) ?? [];
  return same.length === 1 ? make(same[0].entry, same[0]) : null;
}

const filesWord = (n) => `${n} ${plural(n, "файл", "файла", "файлов")}`;

function describePackage(component, label, files, extra) {
  const from = label ? ` редукса ${label}` : "";
  return `${extra || component.label}${from}: ${filesWord(files)} автора по штатным путям игры.`;
}

function shelfOf(kind) {
  if (kind === "hudcolor") return { ...HUDCOLOR_SHELF };
  const placement = placementOf(kind);
  const card = { ...placement, catalogSubcategory: placement.subcategory ?? "" };
  delete card.subcategory;
  if (!card.catalogSubcategory) delete card.catalogSubcategory;
  return card;
}

const unique = (list) => [...new Set(list)];

/**
 * Заявки маршрутных компонентов разбора.
 *
 * @param {object} anatomy результат `analyzeAnatomy`
 * @param {{ label?: string, author?: string, archive?: string, postUrl?: string, sourceOf?: (path: string) => string, containerSourceOf?: (path: string) => string, modifiersOf?: (path: string) => Promise<string[]|null>|string[]|null }} [context]
 * @returns {Promise<{ drafts: object[], problems: object[], deferred: { slot: string, kind: string, why: string }[], claimed: Set<string> }>}
 *   `claimed` — пути записей `update.rpf` (строчными), которые взял этот разбор.
 */
export async function routeComponentDrafts(anatomy, context = {}) {
  const { label = "", author = "", archive = "", postUrl = "", sourceOf = (path) => path, modifiersOf = null, inBase = null } = context;
  const containerSourceOf = context.containerSourceOf ?? sourceOf;
  const unitsById = new Map(anatomy.units.map((unit) => [unit.id, unit]));
  const drafts = [];
  const problems = [];
  const deferred = [];
  const claimed = new Set();
  const tail = postKey(postUrl);

  for (const component of anatomy.components) {
    const members = component.units.map((id) => unitsById.get(id));
    if (!ROUTE_SLOTS.includes(component.slot)) {
      if (!members.every((unit) => unit.type === "container")) deferred.push({ slot: component.slot, kind: component.kind, why: "эффекты и звуки — Р3в" });
      continue;
    }
    /* Файлы маршрутного компонента заняты разбором анатомии: прежний разбор по разнице их заявками больше не делает (в заявку они либо легли, либо названы в `omitted`). */
    for (const unit of members) {
      if (unit.type === "container") claimed.add(lower(unit.path));
      for (const file of unit.files) claimed.add(lower(file.path));
    }
    const packages = await packagesOf(component, members, { problems, modifiersOf });
    for (const pack of packages) {
      const made = buildDraft({ anatomy, component, members, pack, label, author, archive, tail, sourceOf, containerSourceOf, problems, inBase });
      if (made) drafts.push(made);
    }
  }
  return { drafts, problems, deferred, claimed };
}

/* ---------------------------------------------------------------- состав пакетов компонента */

/** Одна запись пакета: файл автора → штатная запись игры. */
const entryOf = (unit, file, install, extra = {}) => ({ unit, file, entry: install.entry, action: install.action, ...extra });

/**
 * Действие записи в заявке (замечание ведущей по `verify-install` hallowen, 10.11.2026: «RPF preflight failed: common/data/playerswitch.meta»).
 *
 * Таблица целей (`mod-targets`) ставит `replace` на все свои пути, но 62 из 113 таких путей в чистом `update.rpf` нет (они живут в `common.rpf`
 * и в `x64a.rpf`, игра читает перекрытие из `update.rpf`): `replace` по записи, которой нет, движок отвергает до установки. Поэтому `replace` остаётся
 * только у слоя слияния (модификаторы таймцикла, меты оружия), у которого есть файл, куда сливать, и который есть в базе; всё остальное — `upsert`
 * (заменить, если запись есть; положить, если нет — у игрока другой версии записи может не быть). `inBase(путь строчными)` — есть ли путь в
 * чистой базе; без базы (`null`) слой слияния остаётся как в таблице.
 */
export function entryAction(item, inBase = null) {
  const action = item.action || DEFAULT_ACTION;
  if (action !== "replace") return action;
  if (!item.merge) return DEFAULT_ACTION;
  return !inBase || inBase(lower(item.entry)) ? "replace" : DEFAULT_ACTION;
}

/**
 * Слой таймцикла по именам модификаторов; килл-эффект выделяется своим слоем.
 *
 * Возвращает `{ items, kill }`: записи пакета таймцикла и записи пакета килл-эффекта. Модификатор лежит ровно в одном пакете: пакет
 * килл-эффекта берёт свои имена (`includeNames`), таймцикл — остальные (`includeNames`, пока их не больше 128) или все, кроме килл-эффекта
 * (`excludeNames` = имена килл-эффекта, когда остальных больше предела списка).
 */
async function mergeFor(items, { problems, modifiersOf }) {
  const out = [];
  const kill = [];
  const killNames = killEffectNames();
  for (const item of items) {
    if (!(MODIFIER_FILE.test(item.entry) && item.action === "replace")) {
      out.push(item);
      continue;
    }
    let names = null;
    try {
      names = modifiersOf ? await modifiersOf(item.file.path) : null;
    } catch {
      names = null;
    }
    /* Файл автора с изъяном разметки, который читатель починил (лишний закрывающий тег): имена и исправленный текст; в пакет идёт исправленный текст. */
    let mark = {};
    if (names && !Array.isArray(names) && typeof names === "object") {
      if (typeof names.text === "string" && names.text) {
        mark = { repaired: { text: names.text, removed: names.removed ?? 1 } };
        problems.push({ code: "timecycle-repaired", message: `${item.file.path}: в файле автора лишний закрывающий тег (${mark.repaired.removed}) — строгий разбор падал, имена модификаторов не читались. В пакете текст без лишнего тега: модификаторы и значения те же.`, severity: "info" });
      }
      names = names.names;
    }
    if (!Array.isArray(names) || names.length === 0) {
      problems.push({ code: "timecycle-layer", message: `${item.file.path}: имена модификаторов таймцикла не прочитаны — файл идёт заменой целиком, а не слоем: игрок потеряет модификаторы других модов.`, severity: "warn" });
      out.push(item);
      continue;
    }
    const sorted = unique(names.map((name) => String(name).toLowerCase())).sort();
    const own = sorted.filter((name) => killNames.has(name));
    const rest = sorted.filter((name) => !killNames.has(name));
    if (own.length > 0) {
      kill.push({ ...item, ...mark, merge: { strategy: TIMECYCLE_MERGE, priority: KILL_PRIORITY, includeNames: own } });
      /* Остальных до предела списка — перечисляем (`includeNames`); больше — таймцикл берёт все модификаторы файла, кроме килл-эффекта (`excludeNames`, движок
         10.11.2026): имена килл-эффекта в обоих пакетах разные, модификатор лежит ровно в одном. Оба списка вместе движок отказывает. */
      if (rest.length > 0) out.push({ ...item, ...mark, merge: { strategy: TIMECYCLE_MERGE, priority: PRIORITY, ...(rest.length <= NAMES_LIMIT ? { includeNames: rest } : { excludeNames: own }) } });
      continue;
    }
    const merge = { strategy: TIMECYCLE_MERGE, priority: PRIORITY };
    if (sorted.length <= NAMES_LIMIT) merge.includeNames = sorted;
    out.push({ ...item, ...mark, merge });
  }
  return { items: out, kill };
}

/** Файлы единиц компонента → записи; файлы без штатного маршрута — в `omitted`. */
function routedEntries(members, problems, { onlyKinds = null } = {}) {
  const items = [];
  const omitted = [];
  const seen = new Map();
  for (const unit of members) {
    if (unit.type === "container") continue;
    for (const file of unit.files) {
      const install = installOf(unit, file);
      if (!install) {
        omitted.push({ path: file.path, sha256: file.sha256, size: file.size, why: "нет штатного пути установки: игра не прочитает его из чужого контейнера" });
        continue;
      }
      if (onlyKinds && !onlyKinds(install, file)) continue;
      const key = lower(install.entry);
      const prior = seen.get(key);
      if (prior) {
        /* Одноимённые файлы разных мест автора решает порядок включения (§4.3): поздний перекрывает ранний. Равный или пустой порядок решить нечем — остаётся
           первый, а замечание блокирующее: человек выбирает. */
        const later = Number.isInteger(unit.order) && Number.isInteger(prior.unit.order) && unit.order !== prior.unit.order && unit.order > prior.unit.order;
        const ordered = Number.isInteger(unit.order) && Number.isInteger(prior.unit.order) && unit.order !== prior.unit.order;
        if (later) {
          omitted.push({ path: prior.file.path, sha256: prior.file.sha256, size: prior.file.size, why: `перекрыт позже подключённым файлом ${file.path} (место ${unit.order} против ${prior.unit.order}) на том же штатном пути ${install.entry}` });
          items[prior.at] = entryOf(unit, file, install);
          seen.set(key, { file, unit, at: prior.at });
          problems.push({ code: "duplicate-entry", message: `${prior.file.path} и ${file.path} ложатся на ${install.entry}: взят поздний по порядку автора (${file.path}).`, severity: "info" });
        } else if (ordered) {
          omitted.push({ path: file.path, sha256: file.sha256, size: file.size, why: `перекрыт позже подключённым файлом ${prior.file.path} на том же штатном пути ${install.entry}` });
          problems.push({ code: "duplicate-entry", message: `${file.path} и ${prior.file.path} ложатся на ${install.entry}: взят поздний по порядку автора (${prior.file.path}).`, severity: "info" });
        } else {
          omitted.push({ path: file.path, sha256: file.sha256, size: file.size, why: `тот же штатный путь ${install.entry} уже занят файлом ${prior.file.path}, порядок автора не решает (место ${unit.order ?? "нет"} и ${prior.unit.order ?? "нет"})` });
          problems.push({ code: "duplicate-entry", message: `${file.path} и ${prior.file.path} ложатся на ${install.entry}, порядок автора не решает (место ${unit.order ?? "нет"} и ${prior.unit.order ?? "нет"}) — взят первый, нужен выбор человека.`, severity: "block" });
        }
        continue;
      }
      seen.set(key, { file, unit, at: items.length });
      items.push(entryOf(unit, file, install));
    }
  }
  return { items, omitted };
}

const containerItem = (unit, entry, action = "import") => ({ unit, file: null, container: true, entry, action });

async function packagesOf(component, members, env) {
  const { slot } = component;
  const containers = members.filter((unit) => unit.type === "container");

  if (slot === "optimization-toggles") {
    const { items, omitted } = routedEntries(members, env.problems);
    const groups = new Map();
    const leftover = [...omitted];
    for (const item of items) {
      const claim = routes().byEntry.get(lower(item.entry));
      /* Словари травы `plantsmgr*.ytd` идут с переключателем «без травы» (его запись в таблице маршрутов — только модель): путь — их собственный. */
      const toggle = claim?.ids.includes("optimization") ? claim.option : GRASS_DICTIONARY.test(lower(item.entry)) ? "no-grass" : null;
      const key = toggle ? `optimization-${toggle}` : claim?.ids.includes("fast-entry") ? "fast-entry" : null;
      if (!key) {
        leftover.push({ path: item.file.path, sha256: item.file.sha256, size: item.file.size, why: `${item.entry} не принадлежит ни одному переключателю оптимизации` });
        continue;
      }
      if (!groups.has(key)) groups.set(key, { key, toggle, items: [] });
      groups.get(key).items.push(item);
    }
    const packs = [...groups.values()].map((group, at) => ({
      key: group.key,
      slots: [group.key],
      kind: group.toggle ? "optimization" : "fast-entry",
      title: group.toggle ? TOGGLE_LABELS[group.toggle] || group.toggle : "Быстрый вход",
      items: group.items,
      omitted: at === 0 ? leftover : [],
    }));
    if (packs.length === 0 && leftover.length) env.problems.push({ code: "toggles-omitted", message: `${component.label}: ни один файл не лёг в переключатель (${leftover.length}).`, severity: "warn" });
    return packs;
  }

  const base = KIND_OF_SLOT[slot];
  const { items, omitted } = routedEntries(members, env.problems);

  if (slot === "large-map") {
    /* Векторная карта — один файл-архив на штатном пути `minimap.rpf`; плитки, `mapzoomdata.meta`, `hud.gfx` и `minimap_main_map.gfx` — записи.
       Второй архив автора с тем же именем (СЖАТЫЙ, 14.11.2026: `x64/patch/data/cdimages/minimap.rpf` — три `.gfx` патча `scaleform_minimap.rpf`) на штатный путь
       векторной карты не ложится (плиток `.ydd` в нём нет) — заявка получала два `import` на один путь и бандл не собирался («Повторяющийся целевой путь»). Такой архив раскладывается по файлам:
       каждый — на штатный путь по имени (`installOf`), без штатного пути — в `omitted`. */
    const tiles = (unit) => unit.files.some((file) => /\.ydd$/.test(lower(file.inner)));
    const vector = containers.some(tiles) ? containers.filter(tiles) : containers;
    const others = containers.filter((unit) => !vector.includes(unit)).map((unit) => ({ ...unit, type: "archive-files" }));
    const routed = others.length ? routedEntries([...members.filter((unit) => unit.type !== "container"), ...others], env.problems) : { items, omitted };
    const all = [...routed.items, ...vector.map((unit) => containerItem(unit, VECTOR_MAP))];
    return [{ key: slot, ...base, title: null, items: all, omitted: routed.omitted }];
  }

  if (slot === "timecycle") {
    const cloudsWhole = containers.filter((unit) => CLOUDHATS.test(lower(unit.path)));
    const cloudsLayer = containers.filter((unit) => !CLOUDHATS.test(lower(unit.path)));
    const merged = await mergeFor(items, env);
    const packs = [{ key: slot, ...base, title: null, items: merged.items, omitted }];
    /* Килл-эффект — своим компонентом (вид и слот прежние): его редактор мастерской вытесняет именно его. */
    if (merged.kill.length) packs.push({ key: "kill-effects", kind: "kill-effects", slots: ["kill-effects"], title: "Килл-эффект", anatomy: { slot: "kill-effects", kind: "kill-effects", label: "Килл-эффект" }, items: merged.kill, omitted: [] });
    /* Облака — свой компонент и свой слот (решение ведущей 10.11.2026): один слот — один пакет, а слой мира и записи `update.rpf` подпись в одном пакете не
       разрешает. Архив из `cloudhats/` — запись целым файлом (`clouds`); архив, подключённый автором, — слой Astral `import` (`clouds`, а при обоих видах сразу
       — `clouds-layer`). Полка — таймцикла. */
    const cloud = (key, extra) => ({ key, kind: "timecycle", slots: [key], title: "Облака", anatomy: { slot: key, kind: "clouds", label: "Облака" }, omitted: [], ...extra });
    if (cloudsWhole.length) packs.push(cloud("clouds", { items: cloudsWhole.map((unit) => containerItem(unit, unit.path)) }));
    if (cloudsLayer.length) packs.push(cloud(cloudsWhole.length ? "clouds-layer" : "clouds", { items: [], layer: cloudsLayer }));
    return packs.filter((pack) => pack.items.length || pack.layer?.length);
  }

  return [{ key: slot, ...base, title: null, items, omitted }];
}

/* ---------------------------------------------------------------- заявка пакета */

function buildDraft({ anatomy, component, members, pack, label, author, archive, tail, sourceOf, containerSourceOf, problems, inBase = null }) {
  const specFiles = [];
  const mapping = [];
  /* Откуда запись у автора (`covers[].author`/`inventory` описи части): путь файла в архиве автора и его отпечаток из описи (содержимое, не сырые байты). */
  const sources = {};
  const draftProblems = [];
  const containers = [];
  const kindLabel = pack.title || component.label;

  if (pack.layer) {
    /* Облака, подключённые строкой content.xml (`artis_clouds.rpf`): слой Astral в порядке автора, как архивные компоненты. */
    pack.layer.forEach((unit, at) => {
      if (unit.order === null || unit.order === undefined || unit.order > 99) {
        draftProblems.push({ code: "unit-order", message: `${unit.path}: у архива нет места в порядке включения автора.`, severity: "block" });
        return;
      }
      const container = layerContainer(unit.order, at + 1);
      containers.push({ unit, container });
      for (const file of unit.files) {
        const inner = lower(file.inner);
        const index = specFiles.length;
        const source = payloadName(inner.split("/").pop(), index);
        /* Слой Astral — отдельный пакет: весь манифест из `import` внутри `x64/astral` (`manifest-authority: directSets.astral`), способность `astral-content-rpf-v1`. */
        specFiles.push({ source, target: UPDATE_RPF, entry: `${container}/${inner}`, merge: { ...LAYER_STRATEGY }, action: "import" });
        mapping.push({ path: source, source: sourceOf(file.path), sha256: file.sha256, size: file.size });
        sources[`${container}/${inner}`] = { author: file.path, inventory: file.sha256 };
      }
    });
  }

  pack.items.forEach((item) => {
    const index = specFiles.length;
    if (item.container) {
      const source = payloadName(lastOf(item.unit.path), index);
      specFiles.push({ source, target: UPDATE_RPF, entry: item.entry, action: item.action });
      sources[item.entry] = { author: item.unit.path };
      mapping.push({ path: source, source: containerSourceOf(item.unit.path), contains: item.unit.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })) });
      return;
    }
    const source = payloadName(lastOf(item.file.path), index);
    specFiles.push({ source, target: UPDATE_RPF, entry: item.entry, action: entryAction(item, inBase), ...(item.merge ? { merge: item.merge } : {}) });
    /* Исправленный текст (лишний тег) — не байты автора: путь у автора назван, равенства отпечатку описи нет. */
    sources[item.entry] = item.repaired ? { author: item.file.path } : { author: item.file.path, inventory: item.file.sha256 };
    if (item.repaired) {
      /* Исправленный текст файла автора — байтами заявки; откуда он, названо в `from`. */
      const bytes = new TextEncoder().encode(item.repaired.text);
      mapping.push({ path: source, source: bytes, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, from: sourceOf(item.file.path) });
      return;
    }
    mapping.push({ path: source, source: sourceOf(item.file.path), sha256: item.file.sha256, size: item.file.size });
  });

  if (specFiles.length === 0) return null;
  if (specFiles.length > FILE_PARTS * 50) draftProblems.push({ code: "files-limit", message: `${component.label}: слишком много файлов (${specFiles.length}).`, severity: "block" });
  if (draftProblems.some((item) => item.severity === "block")) {
    problems.push(...draftProblems);
    return null;
  }
  for (const item of pack.omitted) {
    draftProblems.push({ code: "file-omitted", message: `${item.path}: ${item.why}.`, severity: "warn" });
  }

  const layerOnly = Boolean(pack.layer?.length) && pack.items.length === 0;
  const capabilities = layerOnly ? [...ARCHIVE_CAPABILITIES] : [...ENTRY_CAPABILITIES];
  if (specFiles.some((file) => file.merge?.strategy === TIMECYCLE_MERGE)) capabilities.push("timecycle-modifier-merge-v1");

  const slugPart = pack.key.replace(/[^a-z0-9-]/g, "-");
  const id = [[idPrefixOf(label), slugPart].join("-"), tail].filter(Boolean).join("-").slice(0, ID_LIMIT);
  const placement = shelfOf(pack.kind);
  /* Имя — «<редукс> · <что это>» у каждой заявки, как у архивных компонентов (`archiveComponentDrafts`). */
  const name = label ? `${label} · ${partLabel(kindLabel)}` : partLabel(kindLabel);
  const card = {
    name,
    description: describePackage(component, label, specFiles.length, pack.anatomy ? pack.anatomy.label : pack.title ? `${component.label} · ${pack.title}` : null),
    author: String(author || "").trim(),
    ...placement,
  };

  const layerMembers = pack.layer ?? [];
  const unitIds = unique([...pack.items.map((item) => item.unit.id), ...layerMembers.map((unit) => unit.id)]);
  const domain = {
    anatomy: {
      schema: 1,
      redux: label,
      slot: pack.anatomy?.slot ?? component.slot,
      slots: [...pack.slots],
      kind: pack.anatomy?.kind ?? component.kind,
      label: pack.anatomy?.label ?? component.label,
      ...(pack.anatomy ? { derivedFrom: component.slot } : {}),
      order: component.order,
      build: anatomy.build.key,
      stock: "diff",
      package: pack.key,
      units: unitIds.map((unitId) => {
        const unit = members.find((item) => item.id === unitId);
        const layer = containers.find((item) => item.unit.id === unitId);
        return { id: unit.id, path: unit.path, order: unit.order, part: layer ? containers.indexOf(layer) + 1 : null, container: layer?.container ?? null, files: unit.files.length, kindBy: unit.kindBy, kindNote: unit.kindNote };
      }),
      omitted: pack.omitted,
      sources,
    },
  };
  if (layerMembers.length) domain.anatomy.stock = "container";

  return {
    id,
    archive,
    kind: pack.kind,
    delivery: "package",
    spec: {
      id,
      version: "1.0.0",
      adapter: "rpf-entry",
      editions: ["Legacy"],
      requiresLoader: false,
      scope: "game-root",
      ...(layerMembers.length ? { gameplayChanges: true } : {}),
      ...(author ? { author } : {}),
      capabilities: unique(capabilities),
      slots: [...pack.slots],
      files: specFiles,
    },
    files: mapping,
    card,
    domain,
    problems: [...draftProblems, { code: "needs-media", message: NO_MEDIA, severity: "warn" }],
  };
}
