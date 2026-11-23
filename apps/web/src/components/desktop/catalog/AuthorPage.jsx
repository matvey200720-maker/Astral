import { createElement, useCallback, useMemo, useRef, useState } from "react";
import "./mod-card/mod-card.css";
import { dataLangOf } from "./data-lang.js";
import { catalogSectionOfMod, publicCatalogCategories } from "./catalogSections.js";
import { AuthorAvatar, avatarOf } from "./ModAuthor.jsx";
import ReduxGroupCard from "./ReduxGroupCard.jsx";
import CatalogModCard from "./CatalogModCard.jsx";
import DetailTopbar from "../../ui/DetailTopbar.jsx";
import useHolds from "../../ui/useHolds.js";
import { CaretRight } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { readCatalogFavoriteIds, writeCatalogFavoriteIds } from "../../../catalog-utils.js";
import { catalogWordsFor } from "../../../features/catalog/catalog-words.js";
import { authorCatalog, isDefaultAuthor } from "../../../features/catalog/catalog-authors.js";
import { catalogPageMods, catalogReduxGroups } from "../../../features/catalog/catalog-page-mods.js";
import { newestFirst } from "../../../features/catalog/post-order.js";
import { reduxOfParts } from "../../../features/catalog/search-bundles.js";
import { reduxGroupComponentCount } from "../../../features/catalog/bundles/component-count.js";

// Картинка автора: знак Astral без разбора модов, иначе первая найденная у модов страницы.
const pictureFor = (name, mods) => {
  const own = avatarOf(null, name);
  if (own) return own;
  for (const one of mods) {
    const found = avatarOf(one, name);
    if (found) return found;
  }
  return "";
};

// Разделы по порядку колонки каталога, затем «Другое»; пустые не рисуются.
const sectionsOf = (mods, words) => {
  const slots = publicCatalogCategories.filter(({ id }) => id !== "all").map(({ id, label }) => ({ id, label, mods: [] }));
  const spare = { id: "other", label: null, mods: [] };
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  mods.forEach((one) => (byId.get(catalogSectionOfMod(one)) ?? spare).mods.push(one));
  return [...slots, spare]
    .filter((slot) => slot.mods.length)
    .map(({ id, label, mods: inside }) => ({
      id,
      mods: inside,
      title: label === null ? tr("Другое") : words.label(label),
      count: id === "redux" ? words.reduxes(inside.length) : words.modifications(inside.length),
    }));
};

// Витрина страницы и всё, что из неё считается: моды автора, группы редуксов, части по группам.
function useShowcase(authorName, allMods, catalogMods) {
  const pageMods = useMemo(() => catalogPageMods(allMods, catalogMods), [allMods, catalogMods]);
  const authorMods = useMemo(() => newestFirst(authorCatalog(authorName, pageMods)), [authorName, pageMods]);
  const groups = useMemo(() => catalogReduxGroups(pageMods), [pageMods]);
  const parents = useMemo(() => reduxOfParts(pageMods), [pageMods]);
  /* Компонентов у редукса — по его сборке версии по умолчанию (владелец 13.11.2026); нет сборки — части, что на полках. */
  const componentCounts = useMemo(() => {
    const onShelves = pageMods.reduce((counts, { reduxGroup, reduxLead }) => {
      return reduxGroup && !reduxLead ? counts.set(reduxGroup, (counts.get(reduxGroup) || 0) + 1) : counts;
    }, new Map());
    return new Map(groups.map((group) => [group.id, reduxGroupComponentCount(group, allMods) || onShelves.get(group.id) || 0]));
  }, [pageMods, groups, allMods]);
  return { pageMods, authorMods, groups, parents, componentCounts };
}

// Избранное читается один раз при открытии, дальше живёт в состоянии страницы.
function useSavedMods() {
  const [liked, setLiked] = useState(readCatalogFavoriteIds);
  const toggle = useCallback((id) => {
    setLiked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      try {
        writeCatalogFavoriteIds(next);
      } catch {
        // хранилище недоступно: страница живёт с обновлённым состоянием
      }
      return next;
    });
  }, []);
  return [liked, toggle];
}

// Открытие мода наверх: всегда одним аргументом, без обработчика — молча.
function useOpeners(onSelect, groups, pageMods) {
  const openMod = useCallback(
    (picked) => {
      if (onSelect) onSelect(picked);
    },
    [onSelect],
  );
  const openGroup = useCallback(
    (groupId) => {
      const leadId = groups.find(({ id }) => id === groupId)?.leadId;
      const lead = pageMods.find(({ id }) => id === leadId);
      if (lead) openMod(lead);
    },
    [groups, pageMods, openMod],
  );
  return { openMod, openGroup };
}

const Breadcrumb = () =>
  createElement("div", { className: "redux-product-breadcrumb ui-detail-topbar-end" }, createElement("span", null, tr("Каталог")), <CaretRight />, createElement("span", null, tr("Автор")));

const AuthorHead = ({ name, mods, words }) => {
  const brand = isDefaultAuthor(name);
  const redux = mods.filter(({ reduxLead }) => reduxLead).length;
  const total = [words.modifications(mods.length), redux > 0 && words.reduxes(redux)].filter(Boolean).join(" · ");
  const intro = [
    createElement("small", { key: "who" }, brand ? tr("Сообщество Astral") : tr("Автор")),
    createElement("h1", { key: "name", "data-audit-ignore": "caps", lang: dataLangOf(name) }, name),
    createElement("p", { key: "total" }, mods.length ? total : tr("Модов автора в каталоге пока нет")),
  ];
  if (brand) intro.push(createElement("p", { key: "note", className: "author-page-note" }, tr("Моды без указанного автора — из сообщества Astral Mods в Discord.")));
  return createElement("header", { className: "author-page-head" }, <AuthorAvatar name={name} avatar={pictureFor(name, mods)} size="xl" />, createElement("div", { className: "author-page-intro" }, intro));
};

const Shelf = ({ title, count, id, children }) =>
  createElement(
    "section",
    { className: "mod-card-section author-page-section", "aria-labelledby": `author-section-${id}` },
    createElement("header", null, createElement("h2", { id: `author-section-${id}` }, title), createElement("small", null, count)),
    createElement("div", { className: "author-page-grid" }, children),
  );

export default function AuthorPage({ mod, allMods = [], catalogMods = [], language = "ru", onBack, backName = "", onSelect }) {
  useTr();
  const rootRef = useRef(null);
  const showcase = useShowcase(mod.name, allMods, catalogMods);
  const words = useMemo(() => catalogWordsFor(language), [language]);
  const [liked, onFavorite] = useSavedMods();
  const { openMod, openGroup } = useOpeners(onSelect, showcase.groups, showcase.pageMods);
  useHolds(rootRef, "catalog-product-page", [".desktop-content"]);

  const cardOf = (one) => {
    const group = one.reduxLead && showcase.groups.find(({ id }) => id === one.reduxGroup);
    if (group) {
      return <ReduxGroupCard key={one.id} group={group} lead={one} components={showcase.componentCounts.get(group.id) || 0} words={words} onOpen={openGroup} />;
    }
    const shared = { mods: showcase.pageMods, redux: showcase.parents.get(one.id) || null, liked: liked.has(one.id) };
    return <CatalogModCard key={one.id} mod={one} {...shared} language={language} words={words} onFavorite={onFavorite} onSelect={openMod} />;
  };
  const shelves = sectionsOf(showcase.authorMods, words).map((section) => (
    <Shelf key={section.id} id={section.id} title={section.title} count={section.count}>
      {section.mods.map(cardOf)}
    </Shelf>
  ));

  return createElement(
    "div",
    { ref: rootRef, className: "desktop-page catalog-product-page mod-card author-page" },
    <DetailTopbar className="mod-card-topbar" backLabel={backName || tr("Каталог")} onBack={onBack} trail={<Breadcrumb />} />,
    <AuthorHead name={mod.name} mods={showcase.authorMods} words={words} />,
    shelves,
  );
}
