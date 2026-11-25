import { reduxOfParts } from "../../../features/catalog/search-bundles.js";
import { reduxGroupComponentCount } from "../../../features/catalog/bundles/component-count.js";
import ModName from "./ModName.jsx";
import {
  catalogLabelKey,
  useCatalogResults,
} from "../../../features/catalog/useCatalogResults.js";
import EmptyState from "../../ui/EmptyState.jsx";
import {
  catalogPageMods,
  catalogReduxGroups,
} from "../../../features/catalog/catalog-page-mods.js";
import ReduxGroupCard from "./ReduxGroupCard.jsx";
import PencilCreateTile from "./PencilCreateTile.jsx";
import {
  SquaresFour,
  CloudArrowDown,
  CaretDown,
  ArrowsDownUp,
} from "../../ui/icons.jsx";
import {
  rememberedValue,
  useRememberedScroll,
  useRememberedState,
} from "../../../section-memory.js";
import Showcase from "../../../features/showcase/Showcase.jsx";
import CatalogScrollThumb from "../../../features/catalog/scroll-thumb/CatalogScrollThumb.jsx";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
} from "react";
import { useComponentPick } from "../../../features/catalog/bundles/component-pick.js";
import {
  hasStandardEditor,
  openStandardEditor,
} from "../../../features/catalog/mod-editor.js";
import FavoriteHeart from "../../ui/FavoriteHeart.jsx";
import { dataLangOf } from "./data-lang.js";
import { catalogWordsFor } from "../../../features/catalog/catalog-words.js";
import Button from "../../ui/Button.jsx";
import CatalogMenu from "../../../features/catalog/menu/CatalogMenu.jsx";
import {
  MENU_PLACES,
  OTHER_PAGE_READY,
  leafOfPlace,
  menuGroupOf,
  menuLabel,
} from "../../../features/catalog/menu/catalog-menu.js";
import { tr } from "../../../locales/ui.js";
import {
  labelThumb,
  reduxShelves,
  shelfCountsOf,
  shelfOfLabel,
  shelvesFor,
} from "../../../features/catalog/catalog-shelves.js";
import { clothingLooks } from "../../../features/catalog/clothing-looks.js";
import {
  GENDER_FILTERED,
  genderFilterOf,
  genderGroupOf,
} from "../../../features/catalog/clothing-gender-filter.js";
import {
  packFilterOf,
  packGroupOf,
  packsPresent,
} from "../../../features/catalog/clothing-pack-filter.js";
import { cardProject } from "@modovik/clothing/card-project";
import useHolds from "../../ui/useHolds.js";
import ProjectFilter from "../../../features/catalog/ProjectFilter.jsx";
import {
  ALL_PROJECTS,
  getProject,
  listedForProject,
  projectLabel,
  useProject,
} from "../../../features/catalog/catalog-projects.js";
import VirtualGrid from "../../ui/VirtualGrid.jsx";
import {
  catalogSectionOfMod,
  publicCatalogCategories,
  REDUX_ADDON_KINDS,
  REDUX_ADDONS_SECTION,
} from "./catalogSections.js";
import CatalogSearchField from "./CatalogSearchField.jsx";
import { rememberPackFocus } from "../../../features/catalog/pack-focus.js";
import MenuButton from "../../ui/MenuButton.jsx";
import {
  CatalogVariant,
  catalogVariantOf,
} from "../../../features/catalog/variants/index.js";
import { routeListLabel, workshopRoutesFor } from "./catalogWorkshopRoutes.js";
import AccountAvatar from "../../ui/AccountAvatar.jsx";
import {
  readCatalogFavoriteIds,
  writeCatalogFavoriteIds,
} from "../../../catalog-utils.js";
import {
  useGameEditions,
  workshopEditionNotice,
} from "../../../features/workshop/edition-support.js";
import { labelIcon } from "../../../features/catalog/catalog-row-icons.js";
import CatalogModCard, { warmCatalogCardArt } from "./CatalogModCard.jsx";
import {
  EDITOR_GROUPS,
  editorGroupOf,
  reduxEditorOf,
} from "../../../features/catalog/redux-editors.js";
import { feedEvery, withFeedSlots } from "../../../features/showcase/policy.js";
import { publicCatalogPreviewMods } from "./preview-mods.js";

export { publicCatalogPreviewMods };

/* Режим выбора («Взять из другого редукса», `component-pick.js`): полоса сверху едет по нужде, пока запрос выбора есть. */
const ComponentPickBar = lazy(() => import("./ComponentPickBar.jsx"));

/* Каталог «2.0»: экран «Выборочные» и страница «Прочее» едут отдельными кусками и только тем, кто в них зашёл. */
const SelectiveCatalog = lazy(
  () => import("../../../features/catalog/selective/SelectiveCatalog.jsx"),
);
const OtherPage = lazy(
  () => import("../../../features/catalog/other/OtherPage.jsx"),
);

/* ───────────── таблицы ───────────── */

const MEGABYTE = 1024 * 1024;
export const SIZE_LIMITS = Object.freeze({
  500: 500 * MEGABYTE,
  2000: 2000 * MEGABYTE,
});

const FOR_REDUX = "for-redux";
const SORT_KEYS = ["new", "popular", "downloads"];
const SIZE_STEPS = ["", "500", "2000"];
const SIZE_FILTERED = ["redux", FOR_REDUX];
const MENU_FIELDS = ["sort", "size", "gender", "pack"];
const HOLD_HOSTS = [".desktop-content"];
const FALLBACKS = {
  catalogPending: false,
  catalogLoading: false,
  onRetryCatalog: null,
  onNavigate: null,
  language: "ru",
  initialFilter: null,
  onInstall: null,
  onRemove: null,
};

// Постоянные списки разделов: один раз при загрузке модуля.
const idsWhere = (test) =>
  publicCatalogCategories.filter(test).map((entry) => entry.id);
const COLUMN_IDS = idsWhere(() => true);
const HIDDEN_BRANCHES = idsWhere((entry) => entry.hideSubcategories);
const BRANCH_SECTIONS = idsWhere(
  (entry) =>
    !["all", "redux"].includes(entry.id) &&
    !entry.hideSubcategories &&
    shelvesFor(entry.id).length > 0,
);

/* ───────────── чистые помощники ───────────── */

/* Места меню без своего раздела в выдаче: «Выборочные» и «Прочее» (если включено) считаются по ганпакам и сами рисуют экран. */
const PLACES = MENU_PLACES.filter((id) => id !== "other" || OTHER_PAGE_READY);
const PLACE_LABELS = { selective: "Выборочные", other: "Прочее" };
const resultsCategoryOf = (category) =>
  MENU_PLACES.includes(category) ? "skins" : category;

/* «Все» из меню убрано (каталог 2.0): входом служат «Ганпаки». Поиск, как и раньше, ищет в выбранном разделе, а «Искать во всём каталоге»
   ставит раздел «all» — он живёт, пока в поле есть текст (`keepAll`), очистили поле — каталог вернулся в «Ганпаки». Видам QA (a, b, c) «Все» нужны и без поиска. */
const columnId = (value, keepAll = false) => {
  if (value === "all") return keepAll ? "all" : "skins";
  return COLUMN_IDS.includes(value) || PLACES.includes(value) ? value : "skins";
};
const only = (key) => (current) => (current.includes(key) ? [] : [key]);
const countBy = (keys) =>
  keys.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
const sizeLimitFor = (filtered, size) =>
  filtered ? SIZE_LIMITS[size] || 0 : 0;
const projectName = (words, project) =>
  project === "russia" ? words.russiaOnline : projectLabel(project);

export const sectionFilterKinds = (section) => ({
  size: SIZE_FILTERED.indexOf(section) >= 0,
  /* «Персонаж» (Мужское / Женское / Все) у одежды: возвращён 14.11.2026, `clothing-gender-filter.js`. */
  gender: section === GENDER_FILTERED,
  /* «Проект» (GTA 5 RP / Nova RP / Majestic) у одежды: `clothing-pack-filter.js`; с выбором «на каком сервере я играю» не связан. */
  pack: section === GENDER_FILTERED,
});

const sameGeometry = (a, b) =>
  a === b ||
  (a && b
    ? ["columns", "step", "viewport"].every((name) => a[name] === b[name])
    : false);

function withFallbacks(props) {
  const settled = { ...props };
  for (const name of Object.keys(FALLBACKS)) {
    if (props[name] === undefined) settled[name] = FALLBACKS[name];
  }
  return settled;
}

// Полки раздела: у «Редуксов» их строит каталог, у скрытых разделов нет совсем.
function shelvesForSection(id, reduxList) {
  if (HIDDEN_BRANCHES.includes(id)) return [];
  return id === "redux" ? reduxList : shelvesFor(id);
}

// Выбранная полка; группа редакторов нужна, только пока полка не выбрана.
function pickSelection(category, shelfId, groupId, shelves) {
  const shelf = shelves.find((item) => item.id === shelfId);
  if (shelf || category !== FOR_REDUX)
    return { shelf: shelf || null, group: null, members: null };
  const menuGroup = menuGroupOf(groupId);
  if (menuGroup) {
    const members = shelves.filter((item) =>
      menuGroup.editors.includes(item.editor || item.id),
    );
    return { shelf: null, group: { ...menuGroup, menu: true }, members };
  }
  const group = EDITOR_GROUPS.find((item) => item.id === groupId) || null;
  const members =
    group &&
    shelves.filter(
      (item) => editorGroupOf(item.editor || item.id) === group.id,
    );
  return { shelf: null, group, members };
}

const isAddon = (category) =>
  category === REDUX_ADDONS_SECTION || REDUX_ADDON_KINDS.includes(category);

function addonPlace(label) {
  const editor = label
    ? reduxEditorOf({ subcategory: label, categoryLabel: label })
    : "";
  const shelf = shelvesFor(FOR_REDUX).find(
    (item) => item.core && item.id === editor,
  );
  return { category: FOR_REDUX, shelf: shelf || null, refine: "" };
}

/* Полка редактора по его id: так «Взять из другого редукса» открывает каталог на нужной полке (`component-places.js`). */
function editorPlace(editor) {
  const shelf = shelvesFor(FOR_REDUX).find(
    (item) => item.core && item.id === editor,
  );
  return { category: FOR_REDUX, shelf: shelf || null, refine: "" };
}

export function catalogPlaceOf(category, subcategory = "", editor = "") {
  if (isAddon(category))
    return editor ? editorPlace(editor) : addonPlace(subcategory);
  const section = columnId(category, true);
  const shelf = HIDDEN_BRANCHES.includes(section)
    ? null
    : shelfOfLabel(section, subcategory);
  const refine = shelf && shelf.labels?.length > 1 ? subcategory : "";
  return { category: section, shelf, refine };
}

export function catalogWarmView(mods) {
  const memory = (name, fallback) =>
    rememberedValue("catalog:" + name, fallback);
  let reduxList = null;
  const shelvesOf = (id) => {
    if (id === "redux") reduxList ||= reduxShelves(catalogReduxGroups(mods));
    return shelvesForSection(id, reduxList);
  };
  const searching = Boolean(String(memory("search", "")).trim());
  const category = resultsCategoryOf(
    columnId(memory("category", "skins"), searching),
  );
  const shelves = shelvesOf(category);
  const picked = pickSelection(
    category,
    memory("shelf", ""),
    memory("group", ""),
    shelves,
  );
  const maxBytes = sizeLimitFor(
    sectionFilterKinds(category).size,
    memory("size", ""),
  );
  return {
    category,
    shelf: picked.shelf,
    shelves,
    refine: memory("refine", ""),
    group: picked.members,
    project: getProject(),
    filters: {
      maxBytes,
      gender: genderFilterOf(category, memory("gender", "")),
      projectPack: packFilterOf(
        category,
        memory("pack", ""),
        category === "clothing" ? packsPresent(mods, getProject()) : [],
      ),
    },
    favoritesOnly: memory("favoritesOnly", false),
    favoriteIds: readCatalogFavoriteIds(),
    search: memory("search", ""),
    sortMode: memory("sort", "new"),
    openSections: BRANCH_SECTIONS,
    shelvesOf,
  };
}

function indexShowcase(showcase, allMods = showcase) {
  const groups = catalogReduxGroups(showcase);
  const parts = showcase.filter((mod) => mod.reduxGroup && !mod.reduxLead);
  const countOfParts = countBy(parts.map((mod) => mod.reduxGroup));
  const counted = new Map();
  return {
    /* Компонентов у редукса: сборка версии по умолчанию, группа «Эффекты» — один компонент, «Основа редукса» не считается; нет сборки — части, что на полках. */
    componentsOf: (group) => {
      if (!counted.has(group.id))
        counted.set(
          group.id,
          reduxGroupComponentCount(group, allMods) ||
            countOfParts.get(group.id) ||
            0,
        );
      return counted.get(group.id);
    },
    groupById: new Map(groups.map((group) => [group.id, group])),
    reduxShelvesList: reduxShelves(groups),
    reduxOf: reduxOfParts(showcase),
    byId: new Map(showcase.map((mod) => [mod.id, mod])),
    perSection: countBy(
      showcase.map((mod) => catalogSectionOfMod(mod)).filter(Boolean),
    ),
    perGroup: countOfParts,
  };
}

// По одной карточке на редукс, в порядке первого появления в выдаче.
function cardsOfReduxes(visible, index) {
  const groups = visible
    .map((mod) => index.groupById.get(mod.reduxGroup))
    .filter(Boolean);
  return [...new Set(groups)].map((group) => ({
    id: "redux:" + group.id,
    reduxCard: true,
    group,
    lead: index.byId.get(group.leadId) || null,
    components: index.componentsOf(group),
  }));
}

// Выбран редукс: ведущие моды вперёд, порядок внутри сохраняется.
const leadsFirst = (mods) =>
  [...mods].sort(
    (a, b) => Number(Boolean(b.reduxLead)) - Number(Boolean(a.reduxLead)),
  );

const uniqueBySlot = (routes) =>
  routes.filter(
    (route, at) =>
      routes.findIndex((other) => other.slot === route.slot) === at,
  );

function routesOfPlace({ category, shelf, refine, group, language }) {
  if (group) {
    const lists = group.editors.map((editor) =>
      workshopRoutesFor(FOR_REDUX, editor, language),
    );
    return uniqueBySlot(lists.flat());
  }
  const single = shelf?.labels?.length === 1 ? shelf.labels[0] : "";
  const key =
    category === FOR_REDUX ? (shelf ? shelf.id : "") : refine || single;
  return workshopRoutesFor(category, key, language);
}

const sizeGroupOf = (words, size) => ({
  heading: words.sizeLabel,
  field: "size",
  value: size,
  items: SIZE_STEPS.map((step) => [step, words.sizes[step || "any"]]),
});

function menuOptionsOf(words, sortMode, filterGroups) {
  const sorts = SORT_KEYS.map((key) => ({
    value: "sort:" + key,
    label: words.sorts[key],
    selected: sortMode === key,
  }));
  return filterGroups.reduce(
    (options, group) =>
      options.concat(
        { separator: true },
        { heading: group.heading },
        group.items.map(([key, label]) => ({
          value: `${group.field}:${key}`,
          label,
          selected: key === group.value,
        })),
      ),
    sorts,
  );
}

function countStatus(c) {
  const { words } = c;
  const counted = c.reduxCards
    ? words.reduxes(c.reduxCards.length)
    : words.modifications(c.visibleCount);
  const note = c.favoritesOnly ? " " + words.inFavorites : "";
  const tail =
    c.project === ALL_PROJECTS ? "" : " · " + projectName(words, c.project);
  return {
    text: counted + note + tail,
    tone: "",
    lead: c.reduxGroup?.author || "",
  };
}

const STATUS_RULES = [
  [
    (c) => c.loading && c.showcaseSize > 0,
    (c) => ({
      text: c.words.loadingNote(c.words.publications(c.showcaseSize)),
      tone: "pending",
    }),
  ],
  [
    (c) => Boolean(c.layoutQuery),
    (c) => ({
      text: c.words.layoutNote(c.search.trim(), c.layoutQuery),
      tone: "note",
    }),
  ],
  [() => true, countStatus],
];
const statusOf = (c) => STATUS_RULES.find(([when]) => when(c))[1](c);

function titleOf(c) {
  if (c.category === "all") return c.words.catalogTitle;
  if (c.menuTitle) return c.menuTitle;
  if (c.shelf) return c.placeName(c.refine || c.shelf.label);
  return c.activeGroup
    ? c.activeGroup.menu
      ? tr(c.activeGroup.label)
      : c.words.label(c.activeGroup.label)
    : c.sectionName;
}

/* «Женских вещей этого вида пока нет» — готовые фразы по полу, а не склейка слов: род и падеж у каждого языка свои. Без выбранной полки — «Женских вещей пока нет». */
/* «Вещей Nova RP с такими условиями пока нет»: имя проекта — имя собственное, вставка в готовую фразу. */
const packEmptyTitle = (id) =>
  tr("Вещей {project} с такими условиями пока нет").replace(
    "{project}",
    cardProject(id)?.name || "",
  );

const genderEmptyTitle = (gender, placed) =>
  gender === "female"
    ? placed
      ? tr("Женских вещей этого вида пока нет")
      : tr("Женских вещей пока нет")
    : placed
      ? tr("Мужских вещей этого вида пока нет")
      : tr("Мужских вещей пока нет");

// Пустое состояние: описание «заголовок + абзац + действие (+ плитки)».
const offer = (label, onClick) => ({ label, onClick });
const plain = (title, note, action) => ({
  title,
  note,
  action,
  routes: undefined,
});

const EMPTY_RULES = [
  [
    (c) => c.noMods && c.pending,
    (c) => ({
      pending: true,
      ...plain(
        c.words.pendingTitle,
        c.words.pendingNote,
        c.onRetry ? offer(c.words.retry, c.onRetry) : null,
      ),
    }),
  ],
  [
    (c) => c.loading,
    (c) => ({
      pending: true,
      ...plain(c.words.loadingTitle, c.words.loadingText, undefined),
    }),
  ],
  [
    (c) => c.query && c.elsewhere > 0,
    (c) => {
      const { words } = c;
      const area = c.favoritesOnly
        ? words.inFavorites
        : c.placed
          ? words.inSubcategory(c.placeName)
          : words.inSection(c.sectionName);
      return plain(
        words.nothingIn(area),
        words.elsewhere(c.query, words.modifications(c.elsewhere)),
        offer(words.searchEverywhere, c.act.everywhere),
      );
    },
  ],
  [
    (c) => c.query,
    (c) =>
      plain(
        c.words.nothingFound,
        c.words.noMatches(c.query),
        offer(c.words.resetSearch, c.act.resetSearch),
      ),
  ],
  [
    (c) => c.favoritesOnly,
    (c) =>
      plain(
        c.words.favoritesEmpty,
        c.words.favoritesEmptyNote,
        offer(c.words.showAllMods, c.act.dropFavorites),
      ),
  ],
  [
    /* Вещи есть, только если снять и пол, и проект (ни один по отдельности не виноват: женское + Nova RP в виде, где нет ни женских вещей, ни вещей Nova; ревью №10): слова про оба фильтра и «Сбросить фильтры» —
       сброс одного проекта ничего бы не показал. */
    (c) =>
      Boolean(c.packFilter) &&
      Boolean(c.genderFilter) &&
      !c.packCut &&
      !c.genderCut &&
      c.comboCut > 0,
    (c) =>
      plain(
        packEmptyTitle(c.packFilter),
        tr(
          "Сбросьте пол и проект, чтобы увидеть вещи всех проектов и авторов.",
        ),
        offer(tr("Сбросить фильтры"), c.act.resetPackAndGender),
      ),
  ],
  [
    /* Проект срезал всё сам (без него вещи есть): «Вещей Nova RP с такими условиями пока нет» и сброс этого фильтра. Если без проекта вещей нет и так (сервер, полка), эти слова не нужны. */
    (c) => Boolean(c.packFilter) && c.packCut > 0,
    (c) =>
      plain(
        packEmptyTitle(c.packFilter),
        tr("Сбросьте проект, чтобы увидеть вещи всех проектов и авторов."),
        offer(tr("Показать все проекты"), c.act.showAllPacks),
      ),
  ],
  [
    /* Фильтр «Персонаж» отрезал всё: в тех же условиях без него вещи есть (`genderCut`, ревью п. 8) — говорим словами, чьих вещей нет, и даём «Все». Если пусто и без него (проект, сервер, полка), — обычные слова ниже. */
    (c) => Boolean(c.genderFilter) && c.genderCut > 0,
    (c) =>
      plain(
        c.genderEmptyTitle(c.genderFilter, c.placed),
        tr("Для этого персонажа здесь пока ничего не выложили."),
        offer(tr("Показать вещи для обоих"), c.act.showBothGenders),
      ),
  ],
  [
    (c) => c.routes.length > 0 && (c.placed || !c.sectionHasMods),
    (c) => ({
      title: c.placed
        ? c.words.subcategoryNoPublications(c.placeName)
        : c.words.sectionNoPublications(c.sectionName),
      note: c.words.workshopNote(routeListLabel(c.routes, c.words.and)),
      routes: c.routes,
      action: c.placed
        ? offer(c.words.showWholeSection, c.act.wholeSection)
        : offer(c.words.seeAllSections, c.act.allSections),
    }),
  ],
  [
    (c) => c.noMods,
    (c) =>
      plain(
        c.words.catalogEmpty,
        c.words.catalogEmptyNote,
        c.onNavigate ? offer(c.words.openWorkshop, c.act.workshop) : null,
      ),
  ],
  [
    (c) => !c.isAll && !c.sectionHasMods,
    (c) =>
      plain(
        c.words.sectionNoMods(c.sectionName),
        c.words.sectionNoModsNote,
        offer(c.words.seeAllSections, c.act.allSections),
      ),
  ],
  [
    (c) => c.placed,
    (c) =>
      plain(
        c.words.subcategoryNoMods(c.placeName),
        c.words.subcategoryNoModsNote(c.sectionName),
        offer(c.words.showWholeSection, c.act.wholeSection),
      ),
  ],
  [
    () => true,
    (c) =>
      plain(
        c.words.fallbackTitle,
        c.words.fallbackNote,
        offer(c.words.seeAllSections, c.act.allSections),
      ),
  ],
];
const emptyOf = (c) => EMPTY_RULES.find(([when]) => when(c))[1](c);

/* ───────────── изменения выбора: «заплатки» для памяти ───────────── */

const patchOfCategory = (id) => ({
  category: id,
  shelf: "",
  group: "",
  refine: "",
  sections: id === "all" ? [] : [id],
});

function patchOfShelf(section, id, category, shelvesOf) {
  const found = shelvesOf(section).find((item) => item.id === id);
  if (found && found.section) return patchOfCategory(found.section);
  const moved = section === category ? null : patchOfCategory(section);
  const opened = id ? { open: [`${section}/${id}`] } : null;
  return { ...moved, shelf: id, group: "", refine: "", ...opened };
}

function patchOfPlace(place) {
  const shelfId = place.shelf ? place.shelf.id : "";
  return {
    ...patchOfCategory(place.category),
    shelf: shelfId,
    refine: place.refine,
    ...(shelfId ? { open: [`${place.category}/${shelfId}`] } : null),
  };
}

/* ───────────── собственные хуки ───────────── */

const useField = (key, initial) => useRememberedState(key, initial);

// Одиннадцать запоминаемых полей. Порядок вызовов виден в памяти разделов.
function useSelection() {
  const slots = {
    /* Вход — «Ганпаки»; песочница QA-видов (a, b, c) по-прежнему открывает всё сразу: их вёрстка считает «Все». */
    category: useField(
      "catalog:category",
      catalogVariantOf() ? "all" : "skins",
    ),
    shelf: useField("catalog:shelf", ""),
    group: useField("catalog:group", ""),
    sections: useField("catalog:open-sections", []),
    open: useField("catalog:open", []),
    refine: useField("catalog:refine", ""),
    search: useField("catalog:search", ""),
    sort: useField("catalog:sort", "new"),
    size: useField("catalog:size", ""),
    /* Фильтр «Персонаж» у одежды: "male" / "female", пусто — «Все»; с мастерской не связан. */
    gender: useField("catalog:gender", ""),
    /* «Проект» у одежды: id проекта, пусто — «Все»; с мастерской и выбором сервера не связан. */
    pack: useField("catalog:pack", ""),
    favoritesOnly: useField("catalog:favoritesOnly", false),
    menuOpen: useField("catalog-menu:open", true),
  };
  const now = {};
  const set = {};
  for (const [name, [value, setter]] of Object.entries(slots)) {
    now[name] = value;
    set[name] = setter;
  }
  const latest = useRef(set);
  latest.current = set;
  const write = useCallback((patch) => {
    for (const name of Object.keys(patch)) latest.current[name](patch[name]);
  }, []);
  return { now, set, write };
}

function usePlace(category, shelfId, groupId, index) {
  const shelvesOf = useCallback(
    (id) => shelvesForSection(id, index.reduxShelvesList),
    [index],
  );
  const shelves = useMemo(() => shelvesOf(category), [shelvesOf, category]);
  const picked = useMemo(
    () => pickSelection(category, shelfId, groupId, shelves),
    [category, shelfId, groupId, shelves],
  );
  const redux = picked.shelf && picked.shelf.redux ? picked.shelf.group : null;
  return { ...picked, shelvesOf, shelves, reduxGroup: redux };
}

function useColumnActions(write, area) {
  const { category, shelfId, shelvesOf } = area;
  const chooseCategory = useCallback(
    (id) => write(patchOfCategory(id)),
    [write],
  );
  const chooseShelfIn = useCallback(
    (section, id) => write(patchOfShelf(section, id, category, shelvesOf)),
    [write, category, shelvesOf],
  );
  const chooseShelf = useCallback(
    (id) => chooseShelfIn(category, id),
    [chooseShelfIn, category],
  );
  const chooseLabelIn = useCallback(
    (section, shelf, label) => {
      const reshelve = section !== category || shelfId !== shelf;
      const moved = reshelve
        ? patchOfShelf(section, shelf, category, shelvesOf)
        : null;
      write({ ...moved, refine: label });
    },
    [write, category, shelfId, shelvesOf],
  );
  const chooseGroup = useCallback(
    (section, id) => write({ ...patchOfCategory(section), group: id }),
    [write],
  );
  const toggleSection = useCallback(
    (id) => write({ sections: only(id) }),
    [write],
  );
  const toggleShelf = useCallback(
    (section, id) => write({ open: only(`${section}/${id}`) }),
    [write],
  );
  return {
    chooseCategory,
    chooseShelfIn,
    chooseShelf,
    chooseLabelIn,
    chooseGroup,
    toggleSection,
    toggleShelf,
  };
}

// Ссылка в каталог реагирует на смену значений, а не самого объекта.
function useIncomingLink(initialFilter, apply) {
  const present = typeof initialFilter === "object" && initialFilter !== null;
  const link = present ? initialFilter : {};
  const [category, subcategory, search, editor] = [
    link.category,
    link.subcategory,
    link.search,
    link.editor,
  ];
  useEffect(() => {
    if (present) apply({ category, subcategory, search, editor });
  }, [present, category, subcategory, search, editor, apply]);
}

function useFavoriteSet() {
  const [ids, setIds] = useState(readCatalogFavoriteIds);
  const toggle = useCallback((id) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      writeCatalogFavoriteIds(next);
      return next;
    });
  }, []);
  return [ids, toggle];
}

// Метка «a»/«b» переключается при каждой смене «есть поиск / нет поиска».
// Первая отрисовка ничего не считает.
function useSearchRunMark(searching) {
  const trail = useRef(null);
  if (trail.current === null) trail.current = [searching, 0];
  else if (trail.current[0] !== searching)
    trail.current = [searching, trail.current[1] + 1];
  const swaps = trail.current[1];
  return swaps ? (swaps % 2 ? "a" : "b") : undefined;
}

function useGridContent(results, area, index) {
  const visible = results.visibleMods;
  const [geometry, setGeometry] = useState(null);
  const reportGeometry = useCallback(
    (next) => setGeometry((prev) => (sameGeometry(prev, next) ? prev : next)),
    [],
  );
  const reduxCards = useMemo(
    () =>
      area.category === "redux" && !area.shelf
        ? cardsOfReduxes(visible, index)
        : null,
    [area.category, area.shelf, visible, index],
  );
  const gridMods = useMemo(
    () => (area.reduxGroup ? leadsFirst(visible) : visible),
    [area.reduxGroup, visible],
  );
  const looks = useMemo(
    () => clothingLooks(gridMods, results.query),
    [gridMods, results.query],
  );
  const gridItems = reduxCards ?? gridMods;
  const asIs =
    Boolean(results.query) || area.favoritesOnly || Boolean(reduxCards);
  const feedItems = useMemo(
    () =>
      asIs
        ? gridItems
        : withFeedSlots(gridItems, { every: feedEvery(geometry || {}) }),
    [asIs, gridItems, geometry],
  );
  return { reduxCards, looks, gridItems, feedItems, reportGeometry };
}

// Одна открывающая функция на карточку редукса: карточки под memo не перерисовываются.
function useReduxOpener(selectCard, chooseShelfIn) {
  return useMemo(() => {
    const cache = new WeakMap();
    return (item) => {
      if (!cache.has(item)) {
        cache.set(item, (id) =>
          item.lead ? selectCard(item.lead) : chooseShelfIn("redux", id),
        );
      }
      return cache.get(item);
    };
  }, [selectCard, chooseShelfIn]);
}

/* ───────────── части разметки ───────────── */

function Heading({ title, reduxGroup }) {
  if (!reduxGroup)
    return createElement("h1", { className: "catalog-title" }, title);
  const account = {
    avatarUrl: reduxGroup.avatar,
    displayName: reduxGroup.monogram,
  };
  return createElement(
    "div",
    { className: "catalog-redux-title", lang: dataLangOf(reduxGroup.monogram) },
    createElement(AccountAvatar, { account, size: "lg" }),
    createElement(
      "h1",
      { className: "catalog-title" },
      createElement(ModName, { name: title }),
    ),
  );
}

function StatusLine({ status }) {
  const { text, tone, lead } = status;
  const className = ["catalog-main-status", tone && `is-${tone}`]
    .filter(Boolean)
    .join(" ");
  const kids = lead
    ? [createElement("span", { lang: dataLangOf(lead) }, lead), " · ", text]
    : [text];
  return createElement("p", { className, role: "status" }, ...kids);
}

function EditionChip({ notice }) {
  if (!notice) return null;
  const { tone, label, detail } = notice;
  const classes = [
    "ui-editor-edition",
    "catalog-edition-chip",
    tone === "warning" && "is-warning",
  ];
  return createElement(
    "span",
    {
      className: classes.filter(Boolean).join(" "),
      title: detail,
      "aria-label": label + ". " + detail,
    },
    label,
  );
}

function RouteTiles({ routes, words, onNavigate }) {
  const tile = ({ slot, cover, title, description }) =>
    createElement(
      "button",
      {
        key: slot,
        type: "button",
        className: "public-catalog-route",
        onClick: () => onNavigate("workshop", { slot }),
      },
      createElement(
        "span",
        { className: "public-catalog-route-media", "aria-hidden": "true" },
        createElement("img", { src: cover, alt: "", loading: "lazy" }),
      ),
      createElement("b", null, title),
      createElement("small", null, description),
      createElement("em", null, words.buildInWorkshop),
    );
  return createElement(
    "div",
    { className: "public-catalog-routes", "aria-label": words.buildInWorkshop },
    ...routes.map(tile),
  );
}

function EmptyView({ desc, words, onNavigate }) {
  const { pending, title, note, action, routes } = desc;
  const button = action
    ? createElement(
        Button,
        {
          variant: "secondary",
          className: "public-catalog-empty-action",
          onClick: action.onClick,
        },
        action.label,
      )
    : null;
  return createElement(
    EmptyState,
    {
      icon: pending ? CloudArrowDown : SquaresFour,
      className: "public-catalog-empty",
      headingLevel: 3,
      "aria-busy": pending ? true : undefined,
      "data-pending": pending ? "true" : undefined,
      title,
      text: note,
      actions: button,
    },
    routes ? createElement(RouteTiles, { routes, words, onNavigate }) : null,
  );
}

function SortMenu(spec) {
  const { words, sortMode, filterGroup, activeFilter } = spec;
  const base = words.sorts[sortMode] || words.sorts.new;
  const menuProps = {
    variant: "secondary",
    size: "sm",
    icon: createElement(ArrowsDownUp),
    trailing: createElement(CaretDown),
    align: "end",
    label: filterGroup && activeFilter ? `${base} · ${activeFilter}` : base,
    ariaLabel: filterGroup ? words.sortFilterLabel : words.sortLabel,
    options: spec.options,
    value: "sort:" + sortMode,
    onSelect: spec.onSelect,
  };
  return <MenuButton className="catalog-sort" {...menuProps} />;
}

function ToolsBar({
  words,
  searchSlot,
  favorites,
  onToggleFavorites,
  sortMenu,
}) {
  const heart = createElement(Button, {
    variant: "secondary",
    size: "sm",
    className: "catalog-favorites-toggle",
    icon: createElement(FavoriteHeart, { on: favorites }),
    active: favorites,
    "aria-pressed": favorites,
    ariaLabel: words.favoritesNav,
    title: words.favoritesNav,
    onClick: onToggleFavorites,
  });
  return createElement(
    "div",
    { className: "catalog-main-tools" },
    searchSlot,
    heart,
    createElement(ProjectFilter, { words }),
    createElement(SortMenu, sortMenu),
  );
}

/* ───────────── страница ───────────── */

export function PublicCatalog(props) {
  const given = withFallbacks(props);
  const { language, onNavigate } = given;
  const pageRef = useRef(null);
  const searchInputRef = useRef(null);
  const onSelectRef = useRef(given.onSelect);
  onSelectRef.current = given.onSelect;
  /* Режим выбора: пока он идёт, щелчок по карточке выбирает её и возвращает на страницу мода, а не открывает страницу карточки. */
  const picking = useComponentPick(given.data.mods, publicCatalogPreviewMods);
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const { now, set, write } = useSelection();
  useRememberedScroll("catalog:scroll");
  useHolds(pageRef, "catalog-wide", HOLD_HOSTS);

  const [project] = useProject();
  const notice = workshopEditionNotice(useGameEditions());
  const words = useMemo(() => catalogWordsFor(language), [language]);
  const showcase = useMemo(
    () => catalogPageMods(given.data.mods, publicCatalogPreviewMods),
    [given.data.mods],
  );
  const index = useMemo(
    () => indexShowcase(showcase, given.data.mods),
    [showcase, given.data.mods],
  );
  /* Сколько модов на каждой полке «Маппинга» и вещей в каждой подкатегории «Одежды» для выбранного сервера: меню прячет пустые виды. Один проход по карточкам на раздел; от пола, проекта-пака и поиска не зависит, чтобы виды не прыгали под рукой; пока каталог не пришёл, счёта нет и меню показывает всё (не мигает). Id редакторов мастерской и видов одежды не пересекаются — одна `Map`. */
  const menuCounts = useMemo(() => {
    if (!showcase.length) return null;
    const fits = (section) =>
      showcase.filter(
        (mod) =>
          catalogSectionOfMod(mod) === section &&
          listedForProject(mod, project),
      );
    return new Map([
      ...shelfCountsOf(
        fits(FOR_REDUX),
        shelvesFor(FOR_REDUX).filter((item) => !item.section),
      ),
      ...shelfCountsOf(fits("clothing"), shelvesFor("clothing")),
    ]);
  }, [showcase, project]);

  // Что выбрано.
  const variant = catalogVariantOf();
  const searching = Boolean(now.search.trim());
  /* `place` — место меню, `category` — раздел выдачи: «Выборочные» и «Прочее» считаются по ганпакам и сами рисуют экран. */
  const place = columnId(now.category, searching || Boolean(variant));
  const category = resultsCategoryOf(place);
  const ownScreen = place !== category;
  const area = usePlace(category, now.shelf, now.group, index);
  const { shelf, group: activeGroup, reduxGroup, shelvesOf } = area;
  const sectionName = ownScreen
    ? tr(PLACE_LABELS[place])
    : words.label(
        publicCatalogCategories.find((entry) => entry.id === category).label,
      );
  const placeName = (text) => (reduxGroup ? text : words.label(text));
  const hasSizeFilter = sectionFilterKinds(category).size;
  const hasGenderFilter = sectionFilterKinds(category).gender;
  const hasPackFilter = sectionFilterKinds(category).pack;
  /* Проекты, чьи карточки есть в каталоге: по ним строятся пункты («Majestic» появится сам). */
  const packPresent = useMemo(
    () => packsPresent(showcase, project),
    [showcase, project],
  );
  const filters = useMemo(
    () => ({
      maxBytes: sizeLimitFor(hasSizeFilter, now.size),
      gender: genderFilterOf(category, now.gender),
      projectPack: packFilterOf(category, now.pack, packPresent),
    }),
    [hasSizeFilter, now.size, category, now.gender, now.pack, packPresent],
  );

  // Выдача и сетка.
  const [favoriteIds, toggleFavorite] = useFavoriteSet();
  const results = useCatalogResults({
    mods: showcase,
    category,
    shelf,
    shelves: area.shelves,
    refine: now.refine,
    group: area.members,
    project,
    filters,
    favoritesOnly: now.favoritesOnly,
    favoriteIds,
    search: now.search,
    sortMode: now.sort,
    openSections: BRANCH_SECTIONS,
    shelvesOf,
  });
  const runMark = useSearchRunMark(Boolean(results.query));
  const grid = useGridContent(
    results,
    { category, shelf, reduxGroup, favoritesOnly: now.favoritesOnly },
    index,
  );

  // Действия.
  const columns = useColumnActions(write, {
    category,
    shelfId: now.shelf,
    shelvesOf,
  });
  const [searchEpoch, setSearchEpoch] = useState(0);
  const { search: writeSearch, favoritesOnly: writeFavoritesOnly } = set;
  const replaceSearch = useCallback(
    (value) => {
      writeSearch(value);
      setSearchEpoch((n) => n + 1);
    },
    [writeSearch],
  );
  const applyLink = useCallback(
    (link) => {
      write({
        ...patchOfPlace(
          catalogPlaceOf(link.category || "all", link.subcategory, link.editor),
        ),
        favoritesOnly: false,
      });
      replaceSearch(link.search || "");
    },
    [write, replaceSearch],
  );
  useIncomingLink(given.initialFilter, applyLink);

  const selectCard = useCallback((mod, soundId = "") => {
    const pick = pickingRef.current;
    if (pick) {
      void pick
        .choose(mod)
        .then((done) => done && onNavigateRef.current?.("detail"));
      return;
    }
    if (soundId) rememberPackFocus(mod.id, { sound: soundId });
    onSelectRef.current?.(mod);
  }, []);
  const cancelPick = useCallback(() => {
    pickingRef.current?.cancel();
    onNavigateRef.current?.("detail");
  }, []);
  const toggleFavoritesOnly = useCallback(
    () => writeFavoritesOnly((on) => !on),
    [writeFavoritesOnly],
  );
  const chooseMenuOption = useCallback(
    (value) => {
      const [field, ...rest] = String(value).split(":");
      if (MENU_FIELDS.includes(field)) write({ [field]: rest.join(":") });
    },
    [write],
  );

  // Карточки.
  const openerFor = useReduxOpener(selectCard, columns.chooseShelfIn);
  const renderCard = useCallback(
    (item) => {
      if (item.pencilCreate) {
        return createElement(PencilCreateTile, {
          key: item.id,
          onCreate: item.onCreate,
        });
      }
      if (item.reduxCard) {
        return createElement(ReduxGroupCard, {
          key: item.id,
          group: item.group,
          lead: item.lead,
          components: item.components,
          words,
          onOpen: openerFor(item),
        });
      }
      if (item.showcaseSlot) {
        return createElement(Showcase, {
          key: item.id,
          place: "feed",
          screen: "catalog",
          slot: "feed-" + item.showcaseSlot,
          language,
          onNavigate,
          className: "public-catalog-showcase",
        });
      }
      return createElement(CatalogModCard, {
        key: item.id,
        tile: true,
        mod: item,
        mods: showcase,
        redux: index.reduxOf.get(item.id) || null,
        liked: favoriteIds.has(item.id),
        language,
        words,
        soundHits: results.soundHits.get(item.id),
        cover: grid.looks.get(item.id) || "",
        picking: picking
          ? picking.verdict(item) === "off"
            ? "off"
            : "on"
          : undefined,
        onFavorite: toggleFavorite,
        onSelect: selectCard,
      });
    },
    [
      words,
      language,
      onNavigate,
      showcase,
      index.reduxOf,
      favoriteIds,
      results.soundHits,
      grid.looks,
      toggleFavorite,
      selectCard,
      openerFor,
      picking,
    ],
  );
  const warmAhead = useCallback(
    (near) =>
      near.forEach((item) =>
        warmCatalogCardArt(item, grid.looks.get(item.id) || ""),
      ),
    [grid.looks],
  );

  // Колонка. Выбранный раздел берёт числа по текущей выдаче, остальные — из заготовленных.
  const branches = useMemo(() => {
    const rowsOf = (id) => {
      const counts =
        id === category
          ? results.shelfCounts
          : results.branchCounts.get(id)?.shelves;
      return shelvesOf(id).map((item) => ({
        ...item,
        count: counts?.get(item.id) ?? 0,
      }));
    };
    return new Map(BRANCH_SECTIONS.map((id) => [id, rowsOf(id)]));
  }, [category, results.shelfCounts, results.branchCounts, shelvesOf]);
  const labelCount = useCallback(
    (sectionId, label, id) => {
      const counts =
        sectionId === category
          ? results.labelCounts
          : results.branchCounts.get(sectionId)?.labels;
      return counts?.get(catalogLabelKey(sectionId, id, label)) || 0;
    },
    [category, results.labelCounts, results.branchCounts],
  );
  const navSections = useMemo(
    () =>
      publicCatalogCategories.map((entry) => {
        const count = results.sectionCounts.get(entry.id) || 0;
        return {
          id: entry.id,
          label: entry.label,
          icon: entry.icon,
          count,
          empty: !count,
          hasShelves: BRANCH_SECTIONS.includes(entry.id),
        };
      }),
    [results.sectionCounts],
  );
  const openSections = useMemo(() => new Set(now.sections), [now.sections]);
  const openShelves = useMemo(() => new Set(now.open), [now.open]);
  const navigatorProps = {
    words,
    open: now.menuOpen,
    onOpenChange: set.menuOpen,
    sections: navSections,
    category,
    branches,
    openSections,
    openShelves,
    shelfId: shelf ? shelf.id : "",
    refine: shelf ? now.refine : "",
    labelCount,
    labelThumb,
    labelIcon,
    onSection: columns.chooseCategory,
    onToggleSection: columns.toggleSection,
    onShelf: columns.chooseShelfIn,
    onToggleShelf: columns.toggleShelf,
    onLabel: columns.chooseLabelIn,
  };

  // Шапка.
  const searchField = createElement(CatalogSearchField, {
    value: now.search,
    epoch: searchEpoch,
    onCommit: set.search,
    inputRef: searchInputRef,
    placeholder: words.searchPlaceholder,
    label: words.searchLabel,
    clearLabel: words.clearSearch,
  });
  /* Заголовок страницы называет пункт меню, по которому человек пришёл: «Миникарта», а не «Мини-карта» полки мастерской. */
  const menuLeaf =
    category === "all" || now.refine
      ? null
      : leafOfPlace({
          category: place,
          shelfId: shelf ? shelf.id : "",
          groupId: activeGroup ? activeGroup.id : "",
        });
  /* «Все» внутри «Одежды» — весь раздел: заголовок «Одежда», а не «Все». */
  const menuTitle =
    menuLeaf && menuLeaf.id !== "clothing-all"
      ? menuLabel(words, menuLeaf.label)
      : "";
  const title = titleOf({
    words,
    category,
    shelf,
    refine: now.refine,
    activeGroup,
    sectionName,
    placeName,
    menuTitle,
  });
  const status = statusOf({
    words,
    loading: given.catalogLoading,
    showcaseSize: showcase.length,
    layoutQuery: results.layoutQuery,
    search: now.search,
    reduxCards: grid.reduxCards,
    visibleCount: results.visibleMods.length,
    favoritesOnly: now.favoritesOnly,
    project,
    reduxGroup,
  });
  /* Группы фильтров раздела в меню порядка: размер у редуксов; у одежды — «Персонаж» и «Проект». */
  const filterGroups = [
    hasSizeFilter ? sizeGroupOf(words, now.size) : null,
    hasGenderFilter ? genderGroupOf(words, now.gender) : null,
    hasPackFilter
      ? packGroupOf(words, tr("Проект"), now.pack, packPresent)
      : null,
  ].filter(Boolean);
  const filterGroup = filterGroups[0] || null;
  /* Включённое названо на кнопке меню; «выключенное» значение (любой размер, «Все») имени не имеет. */
  const activeFilter = filterGroups
    .filter((group) => group.value !== (group.idle ?? ""))
    .map((group) => group.items.find(([key]) => key === group.value)?.[1])
    .filter(Boolean)
    .join(" · ");
  const menuOptions = menuOptionsOf(words, now.sort, filterGroups);

  // Пустое состояние.
  const emptyResult = () => {
    const placed = Boolean(shelf || activeGroup);
    const placeText = menuTitle
      ? menuTitle
      : shelf
        ? placeName(now.refine || shelf.label)
        : activeGroup
          ? activeGroup.menu
            ? tr(activeGroup.label)
            : words.label(activeGroup.label)
          : "";
    const route = {
      category,
      shelf,
      refine: now.refine,
      group: activeGroup,
      language,
    };
    return emptyOf({
      words,
      query: now.search.trim(),
      elsewhere: results.elsewhere,
      genderCut: results.genderCut,
      noMods: showcase.length === 0,
      pending: given.catalogPending,
      loading: given.catalogLoading,
      onRetry: given.onRetryCatalog,
      onNavigate,
      favoritesOnly: now.favoritesOnly,
      placed,
      placeName: placeText,
      sectionName,
      sectionHasMods: Boolean(index.perSection.get(category)),
      isAll: category === "all",
      genderFilter: filters.gender,
      packFilter: filters.projectPack,
      packCut: results.packCut,
      comboCut: results.comboCut,
      genderEmptyTitle,
      routes: onNavigate ? routesOfPlace(route) : [],
      act: {
        showBothGenders: () => set.gender(""),
        showAllPacks: () => set.pack(""),
        resetPackAndGender: () => {
          set.pack("");
          set.gender("");
        },
        everywhere: () => {
          columns.chooseCategory("all");
          set.size("");
          set.favoritesOnly(false);
          searchInputRef.current?.focus();
        },
        resetSearch: () => replaceSearch(""),
        dropFavorites: () => set.favoritesOnly(false),
        wholeSection: () => columns.chooseShelf(""),
        allSections: () => columns.chooseCategory("all"),
        workshop: () => onNavigate("workshop"),
      },
    });
  };

  const gridKey = [
    category,
    now.shelf,
    activeGroup ? activeGroup.id : "",
    now.refine,
    now.favoritesOnly,
  ].join(":");
  /* Режим «через карандаш» (чистовой набор 2, 15.11.2026): первой плиткой «Создать свой в мастерской», дальше только годные карточки; обычный каталог плитки не знает. */
  const pencilItems = useMemo(() => {
    if (!picking) return null;
    const native = given.data.mods.find(
      (mod) => mod.id === picking.request.nativeId,
    );
    const bundle = given.data.mods.find(
      (mod) => mod.id === picking.request.bundleId,
    );
    const create =
      native && onNavigate && hasStandardEditor(native)
        ? [
            {
              id: "__pencil-create",
              pencilCreate: true,
              onCreate: () => {
                void openStandardEditor(native, {
                  navigate: onNavigate,
                  locale: language,
                  returnTo: bundle || native,
                  returnTop: picking.request.top,
                });
              },
            },
          ]
        : [];
    const fits = grid.feedItems.filter(
      (item) =>
        !item.reduxCard &&
        !item.showcaseSlot &&
        picking.verdict(item) !== "off",
    );
    return [...create, ...fits];
  }, [picking, grid.feedItems, given.data.mods, onNavigate, language]);
  const body = (pencilItems ? pencilItems.length : grid.gridItems.length)
    ? createElement(VirtualGrid, {
        className: "public-catalog-grid",
        progressive: true,
        key: gridKey,
        onGeometry: grid.reportGeometry,
        onAhead: warmAhead,
        items: pencilItems || grid.feedItems,
        renderItem: renderCard,
      })
    : createElement(EmptyView, { desc: emptyResult(), words, onNavigate });

  const head = createElement(
    "header",
    { className: "catalog-main-head" },
    createElement(
      "div",
      { className: "catalog-main-heading" },
      createElement(Heading, { title, reduxGroup }),
      createElement(StatusLine, { status }),
      createElement(EditionChip, { notice }),
    ),
    createElement(ToolsBar, {
      words,
      searchSlot: now.menuOpen ? null : searchField,
      favorites: now.favoritesOnly,
      onToggleFavorites: toggleFavoritesOnly,
      sortMenu: {
        words,
        sortMode: now.sort,
        filterGroup,
        activeFilter,
        options: menuOptions,
        onSelect: chooseMenuOption,
      },
    }),
  );
  const pickBar = picking
    ? createElement(
        Suspense,
        { fallback: null },
        createElement(ComponentPickBar, {
          request: picking.request,
          language,
          title,
          onCancel: cancelPick,
        }),
      )
    : null;
  const screen = ownScreen
    ? createElement(
        Suspense,
        { fallback: null },
        place === "selective"
          ? createElement(SelectiveCatalog, {
              mods: showcase,
              words,
              language,
              favoriteIds,
              installedIds: given.installed,
              onFavorite: toggleFavorite,
              onInstall: given.onInstall,
              onRemove: given.onRemove,
              onSelect: selectCard,
              /* Колонки разделов на экране ствола нет (доска Pick-gun): путь «Оружие / …» ведёт в раздел. `goTo` объявлен ниже, зовётся уже по щелчку. */
              onSection: (route) => goTo(route),
              onNavigate,
            })
          : createElement(OtherPage),
      )
    : null;
  const mainColumn = createElement(
    "section",
    { className: "catalog-main", "data-catalog-output": "true" },
    pickBar,
    pickBar ? null : screen || head,
    screen
      ? null
      : createElement(
          "section",
          { className: "public-catalog-results", "data-search-run": runMark },
          body,
        ),
  );
  /* Пункт меню → то же состояние каталога, что давала прежняя колонка; выбор пункта выходит из поиска. */
  const goTo = (route) => {
    if (searching) replaceSearch("");
    if (route.group)
      write({ ...patchOfCategory(route.category), group: route.group });
    else if (route.shelf) columns.chooseShelfIn(route.category, route.shelf);
    else columns.chooseCategory(route.category);
  };
  const view = createElement(
    "div",
    {
      ref: pageRef,
      className: `desktop-page public-catalog-page is-navigator${picking ? " is-pencil" : ""}`,
    },
    /* «Через карандаш»: меню разделов, поиска и сортировки нет — категорию не сменить. */
    picking ? null : (
      <CatalogMenu
        place={{
          category: place,
          shelfId: shelf ? shelf.id : "",
          groupId: activeGroup ? activeGroup.id : "",
        }}
        onRoute={goTo}
        words={words}
        counts={menuCounts}
        search={searchField}
        open={now.menuOpen}
        onOpenChange={set.menuOpen}
      />
    ),
    mainColumn,
  );

  if (!variant)
    return (
      <>
        {view}
        <CatalogScrollThumb />
      </>
    );

  const model = Object.fromEntries([
    ["language", language],
    ["words", words],
    ["project", project],
    ["editionNotice", notice],
    ["pageRef", pageRef],
    ["onNavigate", onNavigate],
    ["onInstall", given.onInstall],
    ["installedIds", new Set(given.installed)],
    ["category", category],
    ["activeCategoryLabel", sectionName],
    ["shelf", shelf],
    ["shelves", area.shelves],
    ["refine", now.refine],
    ["reduxGroup", reduxGroup],
    ["title", title],
    ["status", status],
    ["navigatorProps", navigatorProps],
    ["menuOpen", now.menuOpen],
    ["setMenuOpen", set.menuOpen],
    ["search", now.search],
    ["setSearch", replaceSearch],
    ["searchInputRef", searchInputRef],
    ["searchField", searchField],
    ["favoritesOnly", now.favoritesOnly],
    ["setFavoritesOnly", set.favoritesOnly],
    ["sortMode", now.sort],
    ["setSortMode", set.sort],
    ["sorts", SORT_KEYS],
    ["menuOptions", menuOptions],
    ["chooseMenuOption", chooseMenuOption],
    ["filterGroup", filterGroup],
    ["activeFilter", activeFilter],
    ["size", now.size],
    ["setSize", set.size],
    ["mods", showcase],
    ["visibleMods", results.visibleMods],
    ["gridItems", grid.gridItems],
    ["gridFeedItems", grid.feedItems],
    ["setFeedGeometry", grid.reportGeometry],
    ["renderCard", renderCard],
    ["emptyResult", emptyResult],
    ["catalogLoading", given.catalogLoading],
    ["catalogPending", given.catalogPending],
    ["chooseCategory", columns.chooseCategory],
    ["chooseShelf", columns.chooseShelf],
    ["chooseShelfIn", columns.chooseShelfIn],
    ["chooseLabelIn", columns.chooseLabelIn],
    ["toggleFavorite", toggleFavorite],
    ["favoriteIds", favoriteIds],
    ["selectCard", selectCard],
    ["looks", grid.looks],
    ["reduxOf", index.reduxOf],
    ["soundHits", results.soundHits],
    ["reduxCards", grid.reduxCards],
    ["sectionCounts", results.sectionCounts],
    ["shelfCounts", results.shelfCounts],
    ["labelCounts", results.labelCounts],
    ["categoryCounts", index.perSection],
    ["shelvesOf", shelvesOf],
  ]);
  return (
    <>
      <CatalogVariant variant={variant} fallback={view} model={model} />
      <CatalogScrollThumb />
    </>
  );
}
