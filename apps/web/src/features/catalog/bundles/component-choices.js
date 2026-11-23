import { useSyncExternalStore } from "react";
import { variantOf } from "@modovik/publishing";
import { REDUX_BASE_SLOT, groupKeyOf, isReduxBase, workSlotsOf } from "./component-groups.js";

/*
 * Выбор компонентов сборки (ТЗ владельца 10.11.2026): каждую часть редукса можно отключить, заменить такой же из другой сборки или своей
 * работой из мастерской. Выбор хранится на карточку, а не на запись: у сборки с версиями («GTA 5 RP», «Majestic») он общий для всех версий,
 * и компонент узнаётся по слоту (`catalogSlot`: мини-карта, таймцикл, арена…), а не по id записи. Поэтому, переключив версию, человек
 * не теряет выбор по тем компонентам, что есть в обеих версиях; выбор по тому, чего в версии нет, просто ничего не значит.
 *
 * Таблица «карточка → { off, swap, work }»:
 *  • `off`  — слот → true: компонент не входит в сборку;
 *  • `swap` — слот → id другой сборки: её пакеты с этим слотом ставятся вместо родных (все, не один);
 *  • `work` — слот → ключ своей работы мастерской, что встаёт на место компонента.
 * `swap` и `work` не живут вместе: новый выбор снимает прежний. Хранится в localStorage окна (переживает перезапуск); не записалось — живёт
 * в памяти. Битая запись и чужие ключи читаются как «выбора нет».
 */

const STORAGE_KEY = "astral.bundle.components.v1";

const frozen = (value) => Object.freeze(value);
const NOTHING = frozen({ off: frozen({}), swap: frozen({}), work: frozen({}) });

let table = null;
const listeners = new Set();

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Ключ карточки: общая группа версий либо сама сборка. */
export const componentGroupOf = (bundle) => variantOf(bundle)?.group || bundle?.id || "";

// Одна запись таблицы приводится к трём чистым картам; чужое и пустое отбрасывается.
function cleanEntry(entry) {
  if (!isPlain(entry)) return NOTHING;
  const pick = (name, accepts) => {
    const source = isPlain(entry[name]) ? entry[name] : {};
    const result = {};
    for (const key of Object.keys(source)) if (accepts(source[key])) result[key] = source[key];
    return frozen(result);
  };
  return frozen({
    off: pick("off", (value) => value === true),
    swap: pick("swap", (value) => typeof value === "string" && value !== ""),
    work: pick("work", (value) => typeof value === "string" && value !== ""),
  });
}

function loadTable() {
  if (table) return table;
  let parsed = null;
  try {
    parsed = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  } catch {
    parsed = null;
  }
  table = {};
  if (isPlain(parsed)) for (const group of Object.keys(parsed)) table[group] = cleanEntry(parsed[group]);
  return table;
}

function saveTable() {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // не записалось — живёт в памяти до перезапуска
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Выбор карточки; пока человек ничего не трогал — один и тот же замороженный «ничего». */
export function bundleComponents(group) {
  if (!group) return NOTHING;
  const current = loadTable();
  return own(current, group) ? current[group] : NOTHING;
}

// Новая запись карточки собирается из прежней правкой одной карты; пустая запись из таблицы уходит.
function change(group, mutate) {
  if (!group) return;
  const current = bundleComponents(group);
  const next = { off: { ...current.off }, swap: { ...current.swap }, work: { ...current.work } };
  mutate(next);
  const entry = cleanEntry(next);
  const empty = !Object.keys(entry.off).length && !Object.keys(entry.swap).length && !Object.keys(entry.work).length;
  const copy = { ...loadTable() };
  if (empty) delete copy[group];
  else copy[group] = entry;
  table = copy;
  saveTable();
  for (const listener of [...listeners]) listener();
}

/** Не входит в сборку / снова входит. */
export function setComponentOff(group, key, off) {
  if (!key) return;
  change(group, (next) => {
    if (off) next.off[key] = true;
    else delete next.off[key];
  });
}

/** Пакеты слота из другой сборки (её id) вместо родных; пустой id возвращает родные. Своя работа этого слота снимается. */
export function setComponentSwap(group, key, sourceId) {
  if (!key) return;
  change(group, (next) => {
    delete next.work[key];
    if (sourceId) next.swap[key] = String(sourceId);
    else delete next.swap[key];
  });
}

/** Своя работа вместо родной; пустой ключ возвращает родную. Замена из другой сборки по этому слоту снимается. */
export function setComponentWork(group, key, workKey) {
  if (!key) return;
  change(group, (next) => {
    delete next.swap[key];
    if (workKey) next.work[key] = String(workKey);
    else delete next.work[key];
  });
}

/** Подписка окна на выбор карточки. */
export function useBundleComponents(group) {
  return useSyncExternalStore(
    subscribe,
    () => bundleComponents(group),
    () => NOTHING,
  );
}

/*
 * Вещь (одежда, ствол ганпака) слотом не склеивается: слот у неё — вид вещи («футболки», «пистолет»), а не место в сборке, и каждая вещь — свой компонент.
 * Условия те же, что у карточки (`isClothingCard`, `isGunpackCard`): часть редукса или звук оружия вещью не считается.
 */
function isItemPart(part) {
  if (part?.catalogCategory === "clothing" || part?.catalogSection === "clothing" || part?.domain?.clothing) return true;
  if (!part || part.catalogCategory === "sounds" || part.domain?.sound) return false;
  if (part.catalogSection === "redux" || part.catalogSlot === "redux-pack") return false;
  return Boolean(part.catalogSection === "gunpacks" || part.category === "gunpacks" || part.catalogCategory === "skins" || part.domain?.weapon);
}

// Слоты, объявленные подписанным манифестом пакета (`manifest.slots`): тот же список, по которому движок решает конфликты (`utils/catalogConflicts.js`).
const declaredSlots = (part) => (Array.isArray(part?.manifest?.slots) ? [...new Set(part.manifest.slots.filter((slot) => typeof slot === "string" && slot))] : []);

/** Объявил ли пакет свои слоты (`manifest.slots`): запись с объявленным слотом — пакет разбора редукса, а не старая запись каталога. */
export const hasDeclaredSlots = (part) => declaredSlots(part).length > 0;

/**
 * Слот части. Источник истины — подписанный манифест пакета, `manifest.slots`: один слот — он и есть слот компонента (`interior-7`, `timecycle`, `optimization-world`),
 * несколько — общий архив зон, слотом служит первый из них, остальные он тоже занимает (`slotsOf`). Слот полки каталога (`catalogSlot`) общий на все интерьеры и всю
 * оптимизацию и компонент определять не может: он — запасной, только для старых записей без `manifest.slots`. Слоты склеенной группы («Эффекты»: четыре слота пакетов автора)
 * дают ключ группы (`component-groups.js`). У вещи и у части без слота — пусто. Прежняя оптимизация живёт одним слотом `optimization` на все свои виды (следы, погода,
 * облака…), и делит их `kind`: каждый вид — свой компонент.
 *
 * Манифест записи каталога приходит не всегда: у облачной витрины (`packageStatus: "preview"`, id — uuid каталога, без релиза) его нет в списке, он доезжает по гранту при
 * установке (`DesktopShell.install`, `prepareBuildInstallPlan`). До этого окно работает по запасному `catalogSlot`.
 */
export function componentSlotOf(part) {
  if (!part || isItemPart(part)) return "";
  /* «Основа редукса» — свой компонент `redux-base`, а не «Маппинг»: полка её карточки — маппинг (нарочно), слот установки — нет. */
  if (isReduxBase(part)) return REDUX_BASE_SLOT;
  const declared = declaredSlots(part);
  /* Запасной слот полки тоже идёт через группу: пакеты «Эффектов» без манифеста склеиваются в одну строку, как и с манифестом. */
  const slot = declared.length ? groupKeyOf(declared[0]) : groupKeyOf(part.catalogSlot || (part.category === "timecycle" ? "timecycle" : ""));
  const kind = part.domain?.optimization?.kind;
  return slot === "optimization" && typeof kind === "string" && kind ? `optimization:${kind}` : slot;
}

/**
 * Пакеты компонента, которые заменяет своя работа мастерской: у склеенной группы — только часть («Эффекты»: пакет попаданий `blood-routing`, остальные три остаются),
 * у остальных компонентов — все. Нет пакета, что работа заменяет, — заменять нечего, работа встаёт рядом.
 */
export function workReplacedParts(key, parts = []) {
  const slots = workSlotsOf(key);
  return slots ? parts.filter((part) => declaredSlots(part).some((slot) => slots.includes(slot))) : parts;
}

/** Все слоты, что занимает часть: слот компонента и, у общего архива зон, ещё два слота зон (`manifest.slots`). Слоты склеенной группы — одним ключом группы. */
export function slotsOf(part) {
  if (isReduxBase(part)) return [REDUX_BASE_SLOT];
  const declared = declaredSlots(part);
  if (declared.length > 1) return [...new Set(declared.map(groupKeyOf))];
  const own = componentSlotOf(part);
  return own ? [own] : [];
}

/**
 * Компоненты сборки по её частям, в порядке состава: **компонент — это слот**, а не часть (решение ведущей 10.11.2026). Все пакеты сборки с одним слотом —
 * один компонент (таймцикл = пакет маршрутов + пакет облаков, оптимизация = несколько архивов, арена = зал, экстерьер и LOD): одна строка, одна галочка,
 * «Заменить» и «Вернуть родную» действуют на все пакеты слота. Часть без слота — свой компонент (`part:<id>`). Интерьеры — слоты `interior-<N>`, каждый свой.
 * @returns {{ key: string, parts: object[] }[]}
 */
export function componentsOf(parts = []) {
  const found = new Map();
  for (const part of parts) {
    if (!part?.id) continue;
    const key = componentSlotOf(part) || `part:${part.id}`;
    if (!found.has(key)) found.set(key, { key, parts: [] });
    found.get(key).parts.push(part);
  }
  return [...found.values()];
}

/**
 * Части в порядке сборки (`includedModIds`): так их и ставят. Порядок задаёт сборка, а не имя и не слот — ядро и частицы автора раньше крови и трассеров (кровь ссылается
 * на правила из ядра, и движок иначе отвечает отказом; ТЗ ведущей 10.11.2026, п. 3). Части, которых в сборке нет, остаются в конце в прежнем порядке; без сборки — как пришли.
 * Не теряет и не повторяет: сортировка устойчивая.
 */
export function inBuildOrder(parts = [], bundle = null) {
  const order = new Map((bundle?.includedModIds || []).map((id, index) => [id, index]));
  if (!order.size) return [...parts];
  const known = [];
  const strangers = [];
  parts.forEach((part, position) => (order.has(part?.id) ? known : strangers).push([part, position]));
  known.sort((left, right) => order.get(left[0].id) - order.get(right[0].id) || left[1] - right[1]);
  return [...known, ...strangers].map(([part]) => part);
}

/** Ключи компонентов по частям: карта «id части → ключ слота». */
export function componentKeysOf(parts = []) {
  const keys = new Map();
  for (const component of componentsOf(parts)) for (const part of component.parts) keys.set(part.id, component.key);
  return keys;
}

/** Только для тестов: забыть таблицу и стереть хранилище. */
export function resetBundleComponents() {
  table = null;
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // нечего стирать
  }
}

export { NOTHING as NO_COMPONENT_CHOICE };
