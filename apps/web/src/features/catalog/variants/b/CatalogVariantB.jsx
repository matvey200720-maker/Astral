import { useCallback, useMemo, useState } from "react";
import { GridFour, ListBullets } from "../../../../components/ui/icons.jsx";
import Button from "../../../../components/ui/Button.jsx";
import VirtualGrid from "../../../../components/ui/VirtualGrid.jsx";
import CatalogNavigator from "../../../../components/desktop/catalog/CatalogNavigator.jsx";
import { animateInstallToDownloads } from "../../../../components/desktop/catalog/install-flight.js";
import { catalogDownloadCount } from "../../../../catalog-utils.js";
import { useRememberedState } from "../../../../section-memory.js";
import { coverFor, hasOwnCover } from "../../../../utils/catalogMedia.js";
import { tr } from "../../../../locales/ui.js";
import { catalogLabelKey } from "../../useCatalogResults.js";
import VariantEmpty from "../VariantEmpty.jsx";
import VariantHeading from "../VariantHeading.jsx";
import VariantTools from "../VariantTools.jsx";
import CatalogRow from "./CatalogRow.jsx";
import { canQuickInstall } from "./quick-install.js";
import "./catalog-variant-b.css";

/*
 * Вид Б вкладки «Каталог» — плотный список и таблица (ТЗ 29.10.2026-б). Колонка навигации слева — та же; справа:
 *
 *   Каталог                                   [поиск] [список|сетка] [♡] [проект] [Новые ▾]
 *   [Все 61] [Редуксы 10] [Ганпаки 2] …       ← подразделы чипами (во «Всех» — разделы), под ними подписи полки
 *   кадр  Название      Автор   Проекты  Размер  Загрузки  ♡  [Установить]
 *
 * Строка — один мод; «Установить» в ней ставит мод, у которого на странице нет ничего, кроме кнопки (`quick-install.js`), остальным открывает страницу.
 * «Сетка» — те же карточки, что в прежнем виде, под теми же чипами. Колонка «Загрузки» есть, только когда у модов в списке есть настоящие цифры
 * (в облачном каталоге v2 их нет). Кадры — настоящие обложки; роликов нет, как и в сетке (docs/3D.md, п. 31).
 */

const CHIPS_SHOWN = 14;

function chipsOf(model) {
  const { words, category, shelf, shelves, refine, navigatorProps, sectionCounts, shelfCounts, labelCounts } = model;
  const pick = (id) => model.chooseCategory(id);
  if (category === "all")
    return {
      top: navigatorProps.sections.map((section) => ({
        key: section.id,
        label: words.label(section.label),
        count: section.count,
        selected: section.id === "all",
        onSelect: () => pick(section.id),
      })),
      labels: [],
    };
  const total = sectionCounts.get(category) ?? 0;
  const top = [
    { key: "·all", label: tr("Все"), count: total, selected: !shelf, onSelect: () => pick(category) },
    ...shelves.map((item) => ({
      key: item.id,
      label: item.redux ? item.label : words.label(item.label),
      count: shelfCounts.get(item.id) ?? 0,
      selected: shelf?.id === item.id,
      onSelect: () => model.chooseShelf(item.id),
    })),
  ];
  const labels =
    shelf && shelf.labels.length > 1
      ? [
          { key: "·all", label: tr("Все"), count: shelfCounts.get(shelf.id) ?? 0, selected: !refine, onSelect: () => model.chooseShelf(shelf.id) },
          ...shelf.labels.map((label) => ({
            key: label,
            label: words.label(label),
            count: labelCounts.get(catalogLabelKey(category, shelf.id, label)) ?? 0,
            selected: refine === label,
            onSelect: () => model.chooseLabelIn(category, shelf.id, label),
          })),
        ]
      : [];
  return { top, labels };
}

function ChipRow({ chips, label, locale }) {
  const [more, setMore] = useState(false);
  if (!chips.length) return null;
  /* Чипов больше четырнадцати — пустые уходят за «Ещё» (в «Для редуксов» их три десятка с нулём); выбранный и первый стоят на виду всегда. */
  const lively = chips.filter((chip, index) => index === 0 || chip.count || chip.selected);
  /* Выбирать не из чего (поиск ничего не нашёл — у всех подразделов ноль): одинокое «Все 0» над пустым состоянием лишнее. */
  if (lively.length < 2 && chips.length > 1) return null;
  const foldable = chips.length > CHIPS_SHOWN + 1 && lively.length < chips.length;
  const shown = foldable && !more ? lively : chips;
  return (
    <div className="cv-b-chips" role="group" aria-label={label}>
      {shown.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className={`cv-b-chip${chip.selected ? " is-selected" : ""}${chip.count ? "" : " is-empty"}`}
          aria-pressed={chip.selected}
          onClick={chip.onSelect}
        >
          <span>{chip.label}</span>
          <small>{Number(chip.count || 0).toLocaleString(locale)}</small>
        </button>
      ))}
      {foldable ? (
        <button type="button" className="cv-b-chip is-more" aria-expanded={more} onClick={() => setMore((value) => !value)}>
          {more ? tr("Свернуть") : `${tr("Ещё")} ${chips.length - shown.length}`}
        </button>
      ) : null}
    </div>
  );
}

export default function CatalogVariantB({ model }) {
  const { words, mods, favoriteIds, installedIds, onInstall, gridItems, gridFeedItems, renderCard, search, favoritesOnly } = model;
  const [view, setView] = useRememberedState("catalog:variant-b-view", "list");
  const [busyId, setBusyId] = useState("");
  const chips = useMemo(() => chipsOf(model), [model]);
  const hasDownloads = useMemo(() => gridItems.some((item) => !item.reduxCard && catalogDownloadCount(item) > 0), [gridItems]);

  const open = useCallback(
    (item) => {
      if (!item.reduxCard) return model.selectCard(item);
      return item.lead ? model.selectCard(item.lead) : model.chooseShelfIn("redux", item.group.id);
    },
    [model],
  );
  /* Та же установка, что на странице мода: полёт обложки к «Загрузкам», затем общая установка оболочки (`onInstall`). */
  const install = useCallback(
    (mod, source) => {
      if (!onInstall) return;
      setBusyId(mod.id);
      void animateInstallToDownloads({ source, cover: hasOwnCover(mod) ? coverFor(mod) : "", label: mod.name })
        .then(() => onInstall(mod))
        .catch(() => {})
        .finally(() => setBusyId(""));
    },
    [onInstall],
  );
  const renderRow = (item) => (
    <CatalogRow
      key={item.id}
      item={item}
      mods={mods}
      words={words}
      liked={favoriteIds.has(item.id)}
      installed={installedIds.has(item.id)}
      quick={Boolean(onInstall) && !item.reduxCard && canQuickInstall(item, mods)}
      busy={busyId === item.id}
      onOpen={open}
      onFavorite={model.toggleFavorite}
      onInstall={install}
    />
  );

  const switcher = (
    <div className="cv-b-view" role="group" aria-label={tr("Вид каталога")}>
      <Button variant="secondary" size="sm" icon={<ListBullets />} active={view === "list"} aria-pressed={view === "list"} ariaLabel={tr("Список")} title={tr("Список")} onClick={() => setView("list")} />
      <Button variant="secondary" size="sm" icon={<GridFour />} active={view === "grid"} aria-pressed={view === "grid"} ariaLabel={tr("Сетка")} title={tr("Сетка")} onClick={() => setView("grid")} />
    </div>
  );

  let body;
  if (!gridItems.length) body = <VariantEmpty model={model} />;
  else if (view === "grid")
    body = (
      <VirtualGrid
        className="public-catalog-grid"
        key={`grid:${model.category}:${model.shelf?.id || ""}:${model.refine}:${favoritesOnly}`}
        onGeometry={model.setFeedGeometry}
        items={gridFeedItems}
        renderItem={renderCard}
      />
    );
  else
    body = (
      <div className={`cv-b-table${hasDownloads ? " has-downloads" : ""}`}>
        <div className="cv-b-cols" aria-hidden="true">
          <span className="cv-b-col-thumb" />
          <span>{tr("Название")}</span>
          <span className="cv-b-col-author">{tr("Автор")}</span>
          <span className="cv-b-col-projects">{tr("Совместимость")}</span>
          <span className="cv-b-col-size">{tr("Размер")}</span>
          {hasDownloads ? <span className="cv-b-col-downloads">{tr("Загрузки")}</span> : null}
          <span className="cv-b-col-actions" />
        </div>
        <VirtualGrid
          className="cv-b-list"
          key={`list:${model.category}:${model.shelf?.id || ""}:${model.refine}:${favoritesOnly}:${search.trim()}`}
          onGeometry={model.setFeedGeometry}
          items={gridItems}
          renderItem={renderRow}
        />
      </div>
    );

  return (
    <div ref={model.pageRef} className="desktop-page public-catalog-page is-navigator cv-b" data-catalog-variant="b">
      <CatalogNavigator {...model.navigatorProps} search={null} />
      <section className="catalog-main cv-b-main" data-catalog-output>
        <header className="cv-b-top">
          <VariantHeading model={model} />
          <div className="cv-b-bar">
            {model.searchField}
            <VariantTools model={model} own className="cv-b-tools">
              {switcher}
            </VariantTools>
          </div>
        </header>
        <nav className="cv-b-tabs" aria-label={tr("Подразделы")}>
          <ChipRow chips={chips.top} label={tr("Подразделы")} locale={words.locale} />
          <ChipRow chips={chips.labels} label={tr("Подразделы")} locale={words.locale} />
        </nav>
        <section className="public-catalog-results cv-b-results">{body}</section>
      </section>
    </div>
  );
}
