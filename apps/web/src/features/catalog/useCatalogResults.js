/*
 * Что каталог показывает: раздел, полка, уточнение, проект, фильтры раздела,
 * избранное, поиск и порядок.
 *
 * Выборка на тысячи модов (выгрузка Discord) считается один раз на
 * изменение условий, а не на каждую перерисовку: наведение, сердечко и
 * анимации перерисовывают страницу, и каждый раз заново фильтровать и
 * сортировать три тысячи карточек — это сотни миллисекунд. Текст поиска,
 * проекты и размер мода собираются один раз на массив каталога, а новая буква
 * запроса считается кусками вне рендера (`runResults`), пока на экране прежняя
 * выдача: поле ввода отвечает сразу.
 *
 * Поиск (ТЗ 05.10, задача 14) — по названию и тегам. Теги — то, чем мод
 * помечен: свои теги публикации, раздел и подраздел, автор, у одежды —
 * категория, пол, что вещь заменяет и её наборы, у ствола — его модель.
 * Описание в поиск не входит: длинный текст находил всё подряд. Каждое слово
 * запроса должно найтись — «dragon rifle» находит «DRAGON Carbine Rifle».
 * Нашлась сборка — её части в выдачу не идут, а совпадения в названии стоят
 * выше совпадений в тегах (11.10, `search-bundles.js`).
 *
 * Поиск по смыслу (16.10, `search-concepts.js`): у мода в тексте — метки
 * цвета расцветок, вида вещи и стволов, и «розовая майка», «калаш», «AK-47»
 * находят вещь и звук, хотя таких букв в моде нет. Звуки стволов из пака в
 * сетке не стоят (`sound-packs.js`): их место — список на странице пака, а
 * пак находится и по своему звуку — какому, говорит `soundHits`.
 */
import { startTransition, useEffect, useMemo, useReducer, useRef } from "react";
import { catalogLikeCount, modSizeBytes } from "../../catalog-utils.js";
import { currentUiLanguage, tr } from "../../locales/ui.js";
import { projectOfCard } from "@modovik/clothing/card-project";
import {
  ALL_SECTION_PART_KINDS,
  ALL_SECTION_SCOPE,
  catalogKinds,
  catalogSectionOfMod,
  isGunpackMod,
  publicCatalogCategories,
  REDUX_ADDONS_SECTION,
} from "../../components/desktop/catalog/catalogSections.js";
import {
  CATEGORIES as CLOTHING_CATEGORIES,
  GENDER_LABELS,
  clothingOf,
} from "../clothing/clothing-catalog.js";
import { withoutAttachmentCards } from "./attachment-cards.js";
import { ALL_PROJECTS, listedForProject, modProjects } from "./catalog-projects.js";
import { modOnShelf, shelfCountsOf, shelvesFor } from "./catalog-shelves.js";
import { mixByKind } from "./feed-mix.js";
import { newestFirst } from "./post-order.js";
import { OTHER_EDITOR } from "./redux-editors.js";
import { advantageRisk } from "./recommend.js";
import { itemColours } from "./clothing-looks.js";
import { modsWithParts, partsFoldedBy, rankByName } from "./search-bundles.js";
import {
  conceptTokens,
  modWeapons,
  textMatchesQuery,
  weaponById,
} from "./search-concepts.js";
import { foldSearchText, swapKeyboardLayout } from "./search-text.js";
import { isSoundMod, soundHitIds, soundPacksOf } from "./sound-packs.js";
import { mappingSetsOf } from "./mapping-sets.js";
import { isReduxBase } from "./bundles/component-groups.js";

/* «Новые» — по дате исходного поста, как в Discord (Т-71, `post-order.js`):
   дата каждого мода разбирается один раз, а не на каждую пару. Во «Всех» без
   поиска виды чередуются (29.10, `feed-mix.js`): внутри вида порядок тот же. */
function sortBy(sortMode, mods, mix = false) {
  if (sortMode === "downloads")
    return mods.sort(
      (left, right) =>
        Number(right.downloads || 0) - Number(left.downloads || 0),
    );
  if (sortMode === "popular")
    return mods.sort(
      (left, right) =>
        catalogLikeCount(right) - catalogLikeCount(left) ||
        Number(right.downloads || 0) - Number(left.downloads || 0),
    );
  return mix ? mixByKind(newestFirst(mods)) : newestFirst(mods);
}

const sectionLabel = new Map(
  catalogKinds.map((item) => [item.id, item.label]),
);

/* Разделы колонки (без «Всех»): что вообще стоит в каталоге. Сборки — нет,
   у них своя страница «Сборки». */
const COLUMN_SECTIONS = new Set(
  publicCatalogCategories.map((item) => item.id).filter((id) => id !== "all"),
);
const ALL_SCOPE = new Set(ALL_SECTION_SCOPE);

/*
 * «Все» (вечер 15.10): без поиска — только главное: редуксы по карточке на
 * редукс (её пак), ганпаки целиком и одежда. Стволы из ганпаков, части
 * редуксов, звуки и «Для редуксов» — в своих разделах. С поиском — весь
 * каталог колонки. Исключение (29.10): части редуксов из «Интерфейса» и
 * «Эффектов» — прицел, мини-карта, таймцикл, килл-эффект — каждая своей
 * карточкой (`ALL_SECTION_PART_KINDS`): они ставятся и по одной.
 */
export function inAllSection(mod, searching = false) {
  const section = catalogSectionOfMod(mod);
  /* Ганпаки и с поиском — только паки (владелец 05.11.2026): ствол находит свой пак (`gunHit`), отдельной карточкой — лишь на полке семейства. */
  if (searching) return COLUMN_SECTIONS.has(section) && (section !== "skins" || isGunpackMod(mod));
  if (
    section === REDUX_ADDONS_SECTION &&
    ALL_SECTION_PART_KINDS.includes(mod.catalogCategory)
  )
    /* «Прочее» (кнопки меню, HUD, патчи) — безымянные части без своего редактора: во «Все» не идут. */
    return mod.catalogEditor !== OTHER_EDITOR;
  if (!ALL_SCOPE.has(section)) return false;
  if (section === "redux") return Boolean(mod.reduxLead);
  if (section === "skins") return isGunpackMod(mod);
  return true;
}

/*
 * Ключ подписи подраздела для счёта. В «Для редуксов» подписи разных видов
 * живут рядом, поэтому ключ — `редактор/подпись` (у полок-редакторов подписей
 * нет, но ключ не должен сливать чужие).
 */
export function catalogLabelKey(section, shelfId, label) {
  return section === REDUX_ADDONS_SECTION ? `${shelfId}/${label}` : label;
}
const labelKeyOf = (mod) =>
  catalogLabelKey(
    catalogSectionOfMod(mod),
    mod.catalogEditor,
    mod.catalogSubcategory,
  );

/** Теги мода: чем он помечен в данных, кроме названия. */
export function modTags(mod) {
  const block = clothingOf(mod);
  const clothingCategory = block
    ? CLOTHING_CATEGORIES.find((item) => item.id === block.category)?.label
    : null;
  return [
    ...(Array.isArray(mod?.tags) ? mod.tags : []),
    sectionLabel.get(mod?.catalogCategory),
    mod?.catalogSubcategory,
    mod?.categoryLabel,
    mod?.author,
    clothingCategory,
    block?.gender ? GENDER_LABELS[block.gender] : null,
    ...(block?.replaces || []).flatMap((item) => [item.name, item.shop]),
    ...(block?.sets || []).map((set) => set.label),
    mod?.domain?.weapon?.model,
  ].filter((value) => typeof value === "string" && value.trim());
}

function reduxParts(mods) {
  const parts = new globalThis.Map();
  for (const mod of mods) {
    /* «Основа редукса» поиск редукса не ведёт: слово «основа» или «маппинг» (её полка) привело бы к каждому редуксу, у которого она есть. */
    if (!mod.reduxGroup || mod.reduxLead || isReduxBase(mod)) continue;
    if (!parts.has(mod.reduxGroup)) parts.set(mod.reduxGroup, []);
    parts.get(mod.reduxGroup).push(mod);
  }
  return parts;
}

/*
 * Текст поиска мода: название, теги, имена стволов (по-русски, по-английски и
 * на языке окна — «Sturmgewehr» на немецком) и метки смысла
 * (`search-concepts.js`).
 */
export function modSearchText(mod, language = "ru") {
  const weapons = modWeapons(mod)
    .map(weaponById)
    .filter(Boolean)
    .flatMap((weapon) => [
      weapon.name,
      weapon.catalog,
      language !== "ru" && weapon.name ? tr(weapon.name) : "",
    ]);
  const tokens = conceptTokens(mod, {
    colours: clothingOf(mod) ? itemColours(mod) : [],
    garment: clothingOf(mod)?.category || "",
    sound: isSoundMod(mod),
  });
  return `${foldSearchText(
    [mod.name, ...modTags(mod), ...weapons].filter(Boolean).join(" "),
  )} ${tokens.join(" ")}`.trim();
}

/* Всё, что считается один раз на массив каталога (Т-99): страница каталога
   монтируется при каждом входе, а массив тот же (`catalog-page-mods.js`).
   Текст поиска — ещё и на язык окна: имена стволов в нём переведены. */
const prepared = new WeakMap();

/* Значение по id мода, посчитанное при первом обращении (20.10.2026): текст
   поиска, свёрнутое название и проекты нужны только с запросом или выбранным
   проектом, а первый вход в каталог на 5 000 модов считал их для всех сразу —
   ~140 мс главного потока при процессоре ×4 до первой карточки. */
function lazyById(byId, compute) {
  const values = new globalThis.Map();
  return {
    get(id) {
      if (!values.has(id)) {
        const mod = byId.get(id);
        values.set(id, mod ? compute(mod) : undefined);
      }
      return values.get(id);
    },
  };
}

/* Текст поиска досчитывается в простое кусками, пока человек смотрит
   каталог: первая буква запроса не ждёт все 5 000 модов разом. */
function warmInIdle(ids, values) {
  const idle =
    globalThis.requestIdleCallback ||
    ((step) => setTimeout(() => step({ timeRemaining: () => 8 }), 50));
  const cancel = globalThis.cancelIdleCallback || clearTimeout;
  let index = 0;
  let handle = 0;
  const step = (deadline) => {
    while (index < ids.length && deadline.timeRemaining() > 2)
      values.get(ids[index++]);
    if (index < ids.length) handle = idle(step);
  };
  handle = idle(step);
  return () => cancel(handle);
}
const NO_MEMBERS = Object.freeze([]);
function gunpackMembers(mods, byId) {
  const members = new globalThis.Map();
  for (const pack of mods) {
    /* `isGunpackMod` паком считает любой мод с составом — сборку редукса тоже; у неё свои правила (`partsFoldedBy`). */
    if (!pack?.includedModIds?.length || catalogSectionOfMod(pack) !== "skins" || !isGunpackMod(pack)) continue;
    const guns = pack.includedModIds
      .map((id) => byId.get(id))
      .filter((part) => part && part !== pack);
    if (guns.length) members.set(pack.id, guns);
  }
  return members;
}

function prepare(mods, language) {
  if (!prepared.has(mods)) prepared.set(mods, new globalThis.Map());
  const byLanguage = prepared.get(mods);
  let value = byLanguage.get(language);
  if (!value) {
    const byId = new globalThis.Map(mods.map((mod) => [mod.id, mod]));
    value = {
      text: lazyById(byId, (mod) => modSearchText(mod, language)),
      names: lazyById(byId, (mod) => foldSearchText(mod.name)),
      groups: modsWithParts(mods),
      /* Части редукса по группе: пак в «Редуксах» находится и по ним. */
      parts: reduxParts(mods),
      projects: lazyById(byId, (mod) => modProjects(mod, byId)),
      sizes: new globalThis.Map(),
      risky: new globalThis.Map(),
      /* Паки звуков: звук ствола в сетке не стоит, пак находится по нему. */
      sounds: soundPacksOf(mods),
      /* Маппинг кусками: в сетке — ведущий набора, набор находится по
         любому своему куску (`mapping-sets.js`). */
      mapping: mappingSetsOf(mods),
      /* Стволы ганпака по паку: в разделе и во «Всех» пак находится по любому своему стволу. */
      gunMembers: gunpackMembers(mods, byId),
      byId,
    };
    byLanguage.set(language, value);
  }
  return value;
}

const sizeOf = (data, mods, mod) => {
  if (!data.sizes.has(mod.id)) data.sizes.set(mod.id, modSizeBytes(mod, mods));
  return data.sizes.get(mod.id);
};
const riskyOf = (data, mod) => {
  if (!data.risky.has(mod.id))
    data.risky.set(mod.id, advantageRisk(mod, data.byId));
  return data.risky.get(mod.id);
};

/*
 * Каталог без карточек обвесов — один раз на массив каталога (30.10.2026, вкладки). `withoutAttachmentCards` каждый раз отдаёт НОВЫЙ массив, а `prepared` выше держится
 * на identity массива: страница, монтируясь при каждом входе, считала всё заново — группы частей, паки звуков, куски маппинга, словарь по id и ленивые тексты поиска.
 */
const listedByCatalog = new WeakMap();
function listedMods(catalogMods) {
  if (!catalogMods || typeof catalogMods !== "object")
    return withoutAttachmentCards(catalogMods);
  let list = listedByCatalog.get(catalogMods);
  if (!list) {
    list = withoutAttachmentCards(catalogMods);
    listedByCatalog.set(catalogMods, list);
  }
  return list;
}

/** Прогрев в простое (`warm.js`): кэши по ответу каталога, что первый вход считал бы сам. Возвращает моды витрины без карточек обвесов. */
export function warmCatalogResults(catalogMods) {
  const mods = listedMods(catalogMods);
  prepare(mods, currentUiLanguage());
  return mods;
}

/*
 * Выдача каталога по условиям — на все входы в раздел (30.10.2026, «листал и переключался между вкладками — не 30 кадров, а 144»). Страница монтируется при каждом входе,
 * а `useMemo` живёт ровно до размонтирования: тёплый вход пересчитывал фильтры, полки, счета и сортировку трёх тысяч модов (94–144 мс одним куском при ×4, React такой
 * кусок не режет). Теперь результат лежит по данным каталога (`prepared`, они же — язык окна) и ключу условий; новый каталог — новые данные и пустой кэш.
 * Условия — только значения и идентификаторы: ключ тот же, пока человек не сменил раздел, полку, поиск, порядок, избранное или фильтры.
 */
const RESULT_CACHE_LIMIT = 8;
const resultsByData = new WeakMap();
const pendingResults = new WeakMap();
/** Сколько выдач посчитано хуком сразу (`computed`) и сколько догрето в простое (`warmed`): тест прогрева видит, попал ли вход в кэш. */
export const resultsStats = { computed: 0, warmed: 0 };
const finished = (data, key) => resultsByData.get(data)?.has(key) === true;

function store(data, key, value) {
  let byKey = resultsByData.get(data);
  if (!byKey) resultsByData.set(data, (byKey = new globalThis.Map()));
  byKey.set(key, value);
  if (byKey.size > RESULT_CACHE_LIMIT) byKey.delete(byKey.keys().next().value);
  return value;
}

/** Выдача по ключу: готовая — из кэша; греющаяся в простое — достраивается тут же (работа не пропадает); иначе считается целиком. `make` — генератор выдачи. */
function remembered(data, key, make) {
  if (finished(data, key)) return resultsByData.get(data).get(key);
  const pending = pendingResults.get(data);
  let generator = pending?.get(key);
  if (!generator) {
    resultsStats.computed += 1;
    generator = make();
  }
  pending?.delete(key);
  let step;
  do step = generator.next();
  while (!step.done);
  return store(data, key, step.value);
}

/**
 * Прогрев выдачи в простое (31.10.2026, холодный первый вход в каталог): те же фазы, что считает хук, по куску за вызов простоя, не дольше `budgetMs` подряд. Страница,
 * что откроется посреди прогрева, достроит выдачу сама (`remembered` берёт тот же генератор). Возвращает отмену.
 */
export function warmResults(input, whenIdle, budgetMs = 8) {
  const { data } = input;
  const key = resultsKey(input);
  if (finished(data, key)) return () => {};
  let pending = pendingResults.get(data);
  if (!pending) pendingResults.set(data, (pending = new globalThis.Map()));
  if (pending.has(key)) return () => {};
  const generator = resultsSteps(input);
  pending.set(key, generator);
  let cancel = () => {};
  let stopped = false;
  const slice = () => {
    if (stopped || finished(data, key) || pending.get(key) !== generator) return;
    const until = performance.now() + budgetMs;
    let step;
    do step = generator.next();
    while (!step.done && performance.now() < until);
    if (step.done) {
      pending.delete(key);
      store(data, key, step.value);
      resultsStats.warmed += 1;
      return;
    }
    cancel = whenIdle(slice);
  };
  cancel = whenIdle(slice);
  return () => {
    stopped = true;
    cancel();
    if (pending.get(key) === generator) pending.delete(key);
  };
}

/*
 * Выдача на новую букву запроса (31.10.2026, «лаги при вводе в поиск»): пока человек печатает, расчёт идёт не в рендере, а кусками по `SLICE_MS` из очереди задач —
 * между кусками браузер успевает отдать ввод и кадр. Новая буква бросает недосчитанное (`cancel` из эффекта хука), а с готовой выдачей хук перерисовывает страницу сам.
 * В рендере считается только то, что без прежней выдачи показать нечем: первое открытие, смена раздела, порядка, проекта, избранного, фильтров (там нужен точный ответ сразу).
 * Тесты считают выдачу в рендере, как раньше: `globalThis.__ASTRAL_RESULTS_SYNC__ = true` (`test/setup.js`).
 */
const SLICE_MS = 6;
const asyncResults = () => globalThis.__ASTRAL_RESULTS_SYNC__ !== true;
/* Ввод ждёт в очереди — кусок кончается, не дожидаясь срока (Chromium; где метода нет, решает срок). */
const inputPending = () => globalThis.navigator?.scheduling?.isInputPending?.() === true;
let taskChannel = null;
const taskQueue = [];
/** Следующая задача браузера без паузы таймера (`setTimeout` после пятой вложенной ждёт 4 мс): куски идут друг за другом, ввод и кадр — между ними. В окне — `MessageChannel`, в Node (тесты) — `setImmediate`. */
function nextTask(run) {
  if (typeof globalThis.setImmediate === "function") {
    globalThis.setImmediate(run);
    return;
  }
  if (typeof MessageChannel === "undefined") {
    globalThis.setTimeout(run, 0);
    return;
  }
  if (!taskChannel) {
    taskChannel = new MessageChannel();
    taskChannel.port1.onmessage = () => taskQueue.shift()?.();
  }
  taskQueue.push(run);
  taskChannel.port2.postMessage(0);
}

/** Считает выдачу по ключу кусками; `whenDone` — когда она в кэше. Греющийся в простое генератор берёт на себя (прогрев после этого ничего не пишет). Возвращает отмену. */
function runResults(input, key, whenDone) {
  const { data } = input;
  const pending = pendingResults.get(data);
  let generator = pending?.get(key);
  if (generator) pending.delete(key);
  else {
    resultsStats.computed += 1;
    generator = resultsSteps(input);
  }
  let stopped = false;
  const slice = () => {
    if (stopped) return;
    const until = performance.now() + SLICE_MS;
    let step;
    do step = generator.next();
    while (!step.done && performance.now() < until && !inputPending());
    if (step.done) {
      store(data, key, step.value);
      whenDone();
      return;
    }
    nextTask(slice);
  };
  nextTask(slice);
  return () => {
    stopped = true;
  };
}

const NO_SECTIONS = Object.freeze([]);
const NO_IDS = new Set();

const sameMods = (before, after) => before.length === after.length && before.every((mod, index) => mod === after[index]);

/* Каждое слово запроса — в тексте мода буквами или меткой смысла. */
const matchesWords = (text, query) => !query || textMatchesQuery(text, query);
const NO_HITS = new globalThis.Map();

/* Запрос, который ничего не нашёл, перекладывается на другую раскладку
   («[eLb» → «худи», `search-text.js`) — и экран говорит, по чему нашлось. */
function* findWithLayout(matching, query) {
  const found = yield* matching(query);
  if (found.length || !query) return { found, swapped: null };
  const swapped = swapKeyboardLayout(query);
  const retry = swapped ? yield* matching(swapped) : [];
  return retry.length ? { found: retry, swapped } : { found, swapped: null };
}

/** Сколько модов проходит между остановками генератора: кусок ~1–2 мс при ×4, а не весь проход по трём тысячам за раз. */
const SLICE_ITEMS = 256;

/** `list.filter(keep)` с остановкой каждые `SLICE_ITEMS` элементов: асинхронный расчёт (`runResults`) укладывается в кусок и уступает вводу между ними. */
function* filterSliced(list, keep) {
  const out = [];
  for (let start = 0; start < list.length; start += SLICE_ITEMS) {
    const end = Math.min(list.length, start + SLICE_ITEMS);
    for (let index = start; index < end; index += 1) if (keep(list[index])) out.push(list[index]);
    yield;
  }
  return out;
}

/**
 * `visibleMods` — карточки по порядку; `layoutQuery` — запрос в другой
 * раскладке, если нашлось только по нему; `elsewhere` — сколько модов по
 * тому же запросу лежит вне выбранного раздела, полки или избранного, когда
 * внутри не нашлось ничего; `shelfCounts` — сколько модов на каждой полке
 * раздела при остальных условиях (проект, фильтры, поиск), `refineCounts` —
 * то же по уточняющим подписям выбранной полки, `labelCounts` — по подписям
 * всего раздела (ключ — `catalogLabelKey`), `sectionCounts` — по разделам
 * (у «Редуксов» — число редуксов, у `all` — что стоит во «Всех») при
 * сервере и поиске, `favoriteCount` — сколько избранных при них же,
 * `branchCounts` — полки и подписи раскрытых в колонке разделов, кроме
 * выбранного (`openSections`), при сервере и поиске: `{ shelves, labels }`.
 *
 * `shelf` — полка (`catalog-shelves.js`), `refine` — подпись подраздела
 * внутри неё, `subcategory` — подпись подраздела без полки (переход по
 * ссылке), `project` — проект приложения, `filters` — фильтры раздела:
 * `maxBytes` (не больше), `safe` (без преимущества в перестрелке), `gender`
 * (вещи одежды для мужского или женского персонажа), `projectPack` (вещи одежды из паков проекта, `packages/clothing/card-project.js`).
 */
/*
 * Выдача каталога — генератор: тело считается кусками, между фазами стоит `yield` (31.10.2026, холодный первый вход в каталог: первый расчёт по трём тысячам модов
 * — ~80 мс при ×4 одной задачей в кадре входа). Хук гонит его до конца сразу, а прогрев (`warmResults`) — по куску за простой, и вход в каталог берёт готовое.
 * Фазы: выборка, счёт полок, разделов и веток, порядок «Новые», чередование видов, ранжирование по имени; самый тяжёлый кусок — порядок «Новые».
 */
function* resultsSteps({
  data,
  mods,
  category,
  subcategory,
  shelf,
  shelves,
  refine,
  group,
  project,
  maxBytes,
  safe,
  gender,
  projectPack,
  favoritesOnly,
  favoriteIds,
  filterQuery,
  sortMode,
  openSections,
  shelvesOf,
}) {
  const fitsProject = (mod) => listedForProject(mod, project, data.projects.get(mod.id));
  /* Без запроса текст поиска не нужен — и не считается (`lazyById`). Слова запроса против текста мода сверяются один раз на мод за расчёт: выдача, счёт полок, разделов
     и веток спрашивают один и тот же ответ по трём тысячам модов по четыре-пять раз (набор в поиске, 31.10.2026: `textMatchesQuery` — половина расчёта). */
  const textHits = new globalThis.Map();
  const textHit = (mod, query) => {
    if (!query) return true;
    let byId = textHits.get(query);
    if (!byId) textHits.set(query, (byId = new globalThis.Map()));
    let hit = byId.get(mod.id);
    if (hit === undefined) byId.set(mod.id, (hit = matchesWords(data.text.get(mod.id), query)));
    return hit;
  };
  /* Части сборки, которую нашёл тот же запрос, — в её карточке: и в
     выдаче, и в счёте полок и разделов. */
  const folded = new globalThis.Map();
  const foldedBy = (query) => {
    if (!query) return NO_IDS;
    if (!folded.has(query))
      folded.set(
        query,
        partsFoldedBy(
          data.groups,
          (group) => fitsProject(group) && textHit(group, query),
        ),
      );
    return folded.get(query);
  };
  const matches = (mod, query) =>
    textHit(mod, query) && !foldedBy(query).has(mod.id);
  /* Части редукса стоят в «Для редуксов» (вечер 15.10), а в «Редуксах» —
     карточка его пака. Поиск там оставляет и редуксы, у которых нашлась
     часть: «трейсеры» — редуксы с трейсерами. */
  const reduxHit = (mod, query) =>
    Boolean(query && mod.reduxLead) &&
    (data.parts.get(mod.reduxGroup) || []).some((part) => textHit(part, query));
  /* Пак звуков находится и по звуку своего ствола: «калаш» — паки, где
     есть звук штурмовой винтовки. Сами звуки стволов пака в сетке не
     стоят и не считаются. Так же — куски маппинга: за набор стоит его
     ведущий кусок. */
  const soundMember = (mod) =>
    data.sounds.packOf.has(mod.id) ||
    (data.mapping.leaderOf.has(mod.id) &&
      data.mapping.leaderOf.get(mod.id) !== mod.id);
  const soundHit = (mod, query) => {
    if (!query) return false;
    const sounds = data.sounds.members.get(mod.id);
    if (sounds?.some((member) => textHit(member, query))) return true;
    return Boolean(data.mapping.members.get(mod.id)?.some((member) => textHit(member, query)));
  };
  /* Пак ганпака находится по своим стволам: «калаш» — паки, где он есть; и по слову, которое есть только у стволов (имя папки источника у паков без автора). */
  const gunHit = (mod, query) =>
    Boolean(query) &&
    (data.gunMembers.get(mod.id) || NO_MEMBERS).some((gun) => textHit(gun, query));
  const matchesHere = (mod, query) =>
    !soundMember(mod) &&
    (matches(mod, query) ||
      soundHit(mod, query) ||
      gunHit(mod, query) ||
      (category === "redux" && reduxHit(mod, query)));
  /* Пол — у вещи одежды; у комплекта и у вещи на оба пола его нет, они
     видны при любом. */
  const fitsGender = (mod) =>
    !gender || !clothingOf(mod)?.gender || clothingOf(mod).gender === gender;
  /* Проект, из паков которого вещь (14.11.2026, «Проект» в «Одежде»): признак — слаг карточки (`packages/clothing/card-project.js`); работы авторов не из паков проектов видны только при «Все». С выбором
     «на каком сервере я играю» (`fitsProject`) не связан. */
  const fitsPack = (mod) => !projectPack || projectOfCard(mod) === projectPack;
  const fitsBase = (mod) => (!maxBytes || sizeOf(data, mods, mod) <= maxBytes) && (!safe || !riskyOf(data, mod));
  const fitsFilters = (mod) => fitsBase(mod) && fitsGender(mod) && fitsPack(mod);
  const searching = Boolean(filterQuery);
  const inSection = (mod) =>
    category === "all"
      ? inAllSection(mod, searching)
      : catalogSectionOfMod(mod) === category;
  const inGroup = (mod) => !group || group.some((item) => modOnShelf(mod, item));
  const inShelf = (mod) =>
    modOnShelf(mod, shelf) &&
    inGroup(mod) &&
    (!refine || mod.catalogSubcategory === refine) &&
    (!subcategory || mod.catalogSubcategory === subcategory);
  /* Ганпаки (ТЗ 24.10.2026, п. 15): раздел без полки — только сами паки; отдельные стволы и обвесы — на своих
     полках. С поиском тоже (владелец 05.11.2026: «по гану отдельно не будет, по ганам — внутрь заходить»):
     ствол, найденный запросом, приводит свой пак (`gunHit`). */
  const packsOnly = category === "skins" && !shelf && !refine && !subcategory;
  const inRoot = (mod) => !packsOnly || isGunpackMod(mod);
  /* `ignore` — какой из фильтров одежды снять при подсчёте «что срезало»: "gender", "pack" или оба сразу ("both"). */
  const inScope = (mod, ignore = "") =>
    inSection(mod) &&
    inRoot(mod) &&
    inShelf(mod) &&
    fitsProject(mod) &&
    fitsBase(mod) &&
    (ignore === "gender" || ignore === "both" || fitsGender(mod)) &&
    (ignore === "pack" || ignore === "both" || fitsPack(mod)) &&
    (!favoritesOnly || favoriteIds.has(mod.id));
  const { found, swapped } = yield* findWithLayout(
    (query) => filterSliced(mods, (mod) => inScope(mod) && matchesHere(mod, query)),
    filterQuery,
  );
  yield;
  /* Что срезало (ревью 14.11.2026, п. 8; фильтр «Проект»): выдача пуста, а без одного из фильтров одежды вещи есть. Тогда пустое состояние говорит про настоящую причину — пол или проект, — а не про сервер или полку.
     Считается только на пустую выдачу. */
  const cutBy = function* (ignore, active) {
    if (!active || found.length) return 0;
    return (yield* filterSliced(mods, (mod) => inScope(mod, ignore) && matchesHere(mod, swapped || filterQuery))).length;
  };
  const genderCut = yield* cutBy("gender", gender);
  const packCut = yield* cutBy("pack", projectPack);
  /* Ни один фильтр по отдельности не виноват, а оба вместе срезали всё (женское + Nova RP + обувь). */
  const comboCut = genderCut || packCut || !(gender && projectPack) ? 0 : yield* cutBy("both", true);
  const scoped =
    category !== "all" ||
    Boolean(shelf || group || refine || subcategory) ||
    favoritesOnly ||
    Boolean(maxBytes || safe || gender || projectPack);
  const elsewhere =
    !found.length && filterQuery && scoped
      ? (
          yield* findWithLayout(
            (query) =>
              filterSliced(
                mods,
                (mod) =>
                  fitsProject(mod) &&
                  inAllSection(mod, true) &&
                  !soundMember(mod) &&
                  (matches(mod, query) || soundHit(mod, query) || gunHit(mod, query)),
              ),
            filterQuery,
          )
        ).found.length
      : 0;
  yield;
  /* Счёт полок — при тех же проекте, фильтрах, избранном и поиске, но без
     самой полки: карточка полки говорит, сколько там будет. */
  const query = swapped || filterQuery;
  const pool = yield* filterSliced(
    mods,
    (mod) =>
      inSection(mod) &&
      fitsProject(mod) &&
      fitsFilters(mod) &&
      (!favoritesOnly || favoriteIds.has(mod.id)) &&
      matchesHere(mod, query),
  );
  yield;
  const poolCounts = shelfCountsOf(pool, shelves.filter((item) => !item.section));
  const shelfCounts = new globalThis.Map();
  for (const item of shelves)
    shelfCounts.set(
      item.id,
      item.section
        ? (
            yield* filterSliced(
              mods,
              (mod) =>
                catalogSectionOfMod(mod) === item.section &&
                fitsProject(mod) &&
                fitsFilters(mod) &&
                (!favoritesOnly || favoriteIds.has(mod.id)) &&
                !soundMember(mod) &&
                (matches(mod, query) || soundHit(mod, query)),
            )
          ).length
        : poolCounts.get(item.id),
    );
  yield;
  /* Сколько модов у каждой подписи подраздела — по всему разделу, при тех
     же проекте, фильтрах и поиске, но без выбранной полки и уточнения:
     список подписей («Модель ▾») показывает числа и вне выбранной полки. */
  const labelCounts = new globalThis.Map();
  for (const mod of pool)
    if (mod.catalogSubcategory) {
      const key = labelKeyOf(mod);
      labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
    }
  const refineCounts = new globalThis.Map();
  if (shelf)
    for (const label of shelf.labels) {
      const key = catalogLabelKey(category, shelf.id, label);
      if (labelCounts.has(key)) refineCounts.set(label, labelCounts.get(key));
    }
  yield;
  /* Счёт разделов и избранного для колонки навигации — при сервере и
     поиске, но без фильтров раздела: размер, пол и «без преимущества»
     у каждого раздела свои, и чужой фильтр соседний раздел не сужает. */
  /* У «Редуксов» число — редуксов, а не их частей: в разделе по карточке
     на редукс. */
  const sectionCounts = new globalThis.Map();
  const reduxGroups = new Set();
  let everything = 0;
  let favoriteCount = 0;
  for (let at = 0; at < mods.length; at += 1) {
    if (at && at % SLICE_ITEMS === 0) yield;
    const mod = mods[at];
    if (!fitsProject(mod) || soundMember(mod)) continue;
    const section = catalogSectionOfMod(mod);
    const hit = matches(mod, query) || soundHit(mod, query) || gunHit(mod, query);
    if (
      section === "redux" &&
      mod.reduxGroup &&
      (hit || reduxHit(mod, query))
    )
      reduxGroups.add(mod.reduxGroup);
    if (!hit) continue;
    if (inAllSection(mod, searching)) everything += 1;
    /* Число у «Ганпаков» — паки, как и сетка раздела (и с поиском); стволы считают их полки. */
    if (section === "skins" && !isGunpackMod(mod)) {
      if (favoriteIds.has(mod.id)) favoriteCount += 1;
      continue;
    }
    if (section && section !== "redux")
      sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    if (favoriteIds.has(mod.id)) favoriteCount += 1;
  }
  sectionCounts.set("redux", reduxGroups.size);
  sectionCounts.set("all", everything);
  yield;
  /* Раскрытые в колонке разделы, кроме выбранного, — при сервере и поиске,
     как и число у самого раздела: фильтр выбранного раздела соседний не
     сужает. */
  const branchCounts = new globalThis.Map();
  for (const section of openSections) {
    if (section === category || section === "all") continue;
    const own = yield* filterSliced(
      mods,
      (mod) =>
        catalogSectionOfMod(mod) === section &&
        fitsProject(mod) &&
        !soundMember(mod) &&
        (matches(mod, query) || soundHit(mod, query)),
    );
    const ownLabels = new globalThis.Map();
    for (const mod of own)
      if (mod.catalogSubcategory) {
        const key = labelKeyOf(mod);
        ownLabels.set(key, (ownLabels.get(key) || 0) + 1);
      }
    branchCounts.set(section, {
      shelves: new globalThis.Map(
        (() => {
          const items = shelvesOf(section);
          const counts = shelfCountsOf(own, items);
          return items.map((item) => [item.id, counts.get(item.id)]);
        })(),
      ),
      labels: ownLabels,
    });
  }
  yield;
  /* Какие звуки пака нашёл запрос — их карточка пака называет, а
     страница пака подсвечивает. */
  const textOf = (mod) => data.text.get(mod.id) || "";
  const soundHits = query ? new globalThis.Map() : NO_HITS;
  if (query)
    for (const mod of found) {
      const members = data.sounds.members.get(mod.id);
      if (!members) continue;
      const ids = soundHitIds(members, query, textOf);
      if (ids.length) soundHits.set(mod.id, ids);
    }
  yield;
  /* Порядок «Новые» и чередование видов — двумя кусками: каждый — отдельная остановка (`warmResults` греет выдачу в простое по куску за раз). */
  let ordered;
  if (sortMode === "downloads" || sortMode === "popular") ordered = sortBy(sortMode, found);
  else {
    const newest = newestFirst(found);
    yield;
    ordered = category === "all" && !searching ? mixByKind(newest) : newest;
  }
  yield;
  return {
    visibleMods: rankByName(ordered, query, (mod) => data.names.get(mod.id)),
    query,
    textOf,
    soundHits,
    layoutQuery: swapped,
    elsewhere,
    genderCut,
    packCut,
    comboCut,
    shelfCounts,
    refineCounts,
    labelCounts,
    sectionCounts,
    branchCounts,
    favoriteCount,
    sectionTotal: pool.length,
  };
}

/** Вход выдачи из того, что знает страница, и ответ каталога: те же умолчания, что у хука, — по ним и ключ. Прогрев строит вход тем же путём, что хук. */
export function resultsInput({ mods: catalogMods, language = currentUiLanguage(), search, filters = null, subcategory = "", shelf = null, shelves = [], refine = "", group = null, project = ALL_PROJECTS, openSections = NO_SECTIONS, shelvesOf = shelvesFor, category, favoritesOnly, favoriteIds, sortMode, filterQuery }) {
  const mods = listedMods(catalogMods);
  return {
    data: prepare(mods, language),
    mods,
    category,
    subcategory,
    shelf,
    shelves,
    refine,
    group,
    project,
    maxBytes: filters?.maxBytes || 0,
    safe: Boolean(filters?.safe),
    gender: filters?.gender || "",
    projectPack: filters?.projectPack || "",
    favoritesOnly,
    favoriteIds,
    filterQuery: filterQuery ?? foldSearchText(search),
    sortMode,
    openSections,
    shelvesOf,
  };
}

/** Ключ выдачи: условия — только значения и идентификаторы. */
export function resultsKey({ category, subcategory, shelf, shelves, refine, group, project, maxBytes, safe, gender, projectPack, favoritesOnly, favoriteIds, filterQuery, sortMode, openSections, shelvesOf }) {
  return JSON.stringify([
    category,
    subcategory,
    shelf?.id ?? null,
    shelves.map((item) => item.id),
    refine,
    group ? group.map((item) => item.id) : null,
    project,
    maxBytes,
    safe,
    gender,
    projectPack,
    Boolean(favoritesOnly),
    /* Избранное входит в выдачу всегда: число «♡» считается и без фильтра. */
    [...favoriteIds].sort(),
    filterQuery,
    sortMode,
    openSections.map((section) => [section, shelvesOf(section).map((item) => item.id)]),
  ]);
}

export function useCatalogResults({
  mods: catalogMods,
  category,
  subcategory = "",
  shelf = null,
  shelves = [],
  refine = "",
  /* Группа редакторов «Для редуксов» целиком — её полки (`catalog-shelves.js`): мод лежит на любой из них. */
  group = null,
  project = ALL_PROJECTS,
  filters = null,
  favoritesOnly,
  favoriteIds,
  search,
  sortMode,
  openSections = NO_SECTIONS,
  /* Полки раздела: у «Редуксов» они из ответа каталога (`reduxShelves`). */
  shelvesOf = shelvesFor,
}) {
  const language = currentUiLanguage();
  /* Карточки обвесов ганпаков в каталоге не показываются (ТЗ 24.10.2026, п. 4): их обвесы подтягиваются
     в студию ствола, когда человек скачал ганпак. В данных окна они остаются — студии они нужны. */
  const mods = listedMods(catalogMods);
  const data = useMemo(() => prepare(mods, language), [mods, language]);
  useEffect(
    () => warmInIdle(mods.map((mod) => mod.id), data.text),
    [mods, data],
  );
  /* Запрос идёт в расчёт сразу, без отложенного значения: рендер на новую букву дёшев (прежняя выдача на экране), а считается она кусками (`runResults`). */
  const filterQuery = foldSearchText(search);
  const maxBytes = filters?.maxBytes || 0;
  const safe = Boolean(filters?.safe);
  const gender = filters?.gender || "";
  const projectPack = filters?.projectPack || "";
  const input = useMemo(
    () => ({
      data,
      mods,
      category,
      subcategory,
      shelf,
      shelves,
      refine,
      group,
      project,
      maxBytes,
      safe,
      gender,
      projectPack,
      favoritesOnly,
      favoriteIds,
      filterQuery,
      sortMode,
      openSections,
      shelvesOf,
    }),
    [category,
      data,
      favoriteIds,
      favoritesOnly,
      filterQuery,
      gender,
      group,
      maxBytes,
      mods,
      openSections,
      project,
      projectPack,
      refine,
      safe,
      shelf,
      shelves,
      shelvesOf,
      sortMode,
      subcategory,
    ],
  );
  /* Ключ — строка: перерисовка страницы с теми же условиями, но новыми массивами (`shelves`, `favoriteIds`) расчёт не сбрасывает. */
  const key = useMemo(() => resultsKey(input), [input]);
  /* Показанная выдача: пока считается новая на ту же страницу (меняется только запрос), на экране прежняя — поле ввода не ждёт результатов. Запоминается в эффекте, когда
     рендер дошёл до экрана: отложенный рендер, который оборвала следующая буква, свою выдачу следующему рендеру не отдаёт (иначе буква смонтировала бы сетку за него). */
  const shown = useRef(null);
  const [done, wake] = useReducer((count) => count + 1, 0);
  const view = useMemo(() => {
    const held = shown.current;
    if (held?.data === data && held.key === key) return held;
    const rest = resultsKey({ ...input, filterQuery: "" });
    const sameConditions = held?.data === data && held.rest === rest;
    if (sameConditions && !finished(data, key) && asyncResults()) return held;
    let fresh = remembered(data, key, () => resultsSteps(input));
    /* Запрос сменился, а карточки те же (последние буквы слова) — прежний массив: сетка не пересобирается ради выдачи, которая от неё не отличается. */
    if (sameConditions && sameMods(held.value.visibleMods, fresh.visibleMods)) fresh = { ...fresh, visibleMods: held.value.visibleMods };
    return { data, rest, key, value: fresh, done };
  }, [input, key, data, done]);
  useEffect(() => {
    shown.current = view;
  }, [view]);
  /* Выдача, которой нет в кэше, достаётся из очереди задач; сменился ключ (новая буква) — недосчитанная бросается. */
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (finished(data, key)) return undefined;
    return runResults(latest.current, key, () => startTransition(wake));
  }, [key, data]);
  return view.value;
}
