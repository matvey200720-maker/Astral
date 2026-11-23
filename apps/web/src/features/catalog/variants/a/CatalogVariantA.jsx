import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretLeft, CaretRight, Clock, Fire } from "../../../../components/ui/icons.jsx";
import Button from "../../../../components/ui/Button.jsx";
import VirtualGrid from "../../../../components/ui/VirtualGrid.jsx";
import CatalogNavigator from "../../../../components/desktop/catalog/CatalogNavigator.jsx";
import ModName from "../../../../components/desktop/catalog/ModName.jsx";
import { coverFor } from "../../../../utils/catalogMedia.js";
import { tr } from "../../../../locales/ui.js";
import VariantEmpty from "../VariantEmpty.jsx";
import VariantHeading from "../VariantHeading.jsx";
import VariantTools from "../VariantTools.jsx";
import { bannerFit, bannerMod, RAIL_SIZE, showcaseOf } from "./showcase.js";
import "./catalog-variant-a.css";

/*
 * Вид А вкладки «Каталог» — витрина (ТЗ 29.10.2026-б). Колонка навигации слева — та же; справа вместо одной сетки:
 *
 *   ┌ баннер раздела: кадр самого нового мода, название, сколько найдено, «Открыть …» ┐
 *   [♡] [проект] [Новые ▾]
 *   Новое          ◀ ▶     ← полки идут вбок; карточки те же, что в сетке (только постеры, роликов нет)
 *   Популярное     ◀ ▶     ← только при настоящих цифрах: в облачном каталоге загрузок нет, и полки без них не будет
 *   Мини-карта  10  Все →  ← по полке на подраздел (во «Всех» — на раздел)
 *
 * Поиск, избранное и выбранная полка — обычная сетка под сжатой шапкой: витрине там нечего показывать, человек уже выбрал. Обложка баннера —
 * настоящий кадр мода из каталога; нет кадра — баннер без картинки, ничего не рисуется.
 */

function Rail({ icon: Icon, title, count = null, onAll = null, allLabel = "", children }) {
  const track = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const node = track.current;
    if (!node) return;
    const start = node.scrollLeft <= 2;
    const end = node.scrollLeft + node.clientWidth >= node.scrollWidth - 2;
    setEdges((now) => (now.start === start && now.end === end ? now : { start, end }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const node = track.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [measure, children]);
  const step = (direction) => {
    const node = track.current;
    node?.scrollBy({ left: direction * node.clientWidth * 0.86, behavior: "smooth" });
  };
  const scrollable = !(edges.start && edges.end);
  return (
    <section className="cv-a-rail" data-scroll={edges.start ? undefined : "start"} data-more={edges.end ? undefined : "end"}>
      <header className="cv-a-rail-head">
        <h2 className="cv-a-rail-title">
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{title}</span>
          {count === null ? null : <small>{count}</small>}
        </h2>
        <div className="cv-a-rail-tools">
          {onAll ? (
            <Button variant="ghost" size="sm" className="cv-a-rail-all" onClick={onAll}>
              {allLabel}
            </Button>
          ) : null}
          {scrollable ? (
            <>
              <Button variant="secondary" size="sm" icon={<CaretLeft />} ariaLabel={tr("Листать влево")} disabled={edges.start} onClick={() => step(-1)} />
              <Button variant="secondary" size="sm" icon={<CaretRight />} ariaLabel={tr("Листать вправо")} disabled={edges.end} onClick={() => step(1)} />
            </>
          ) : null}
        </div>
      </header>
      <div className="cv-a-rail-track" ref={track} onScroll={measure}>
        {children}
      </div>
    </section>
  );
}

function Banner({ model, featured }) {
  const { category, shelf, activeCategoryLabel, selectCard } = model;
  const art = featured ? coverFor(featured) : "";
  const kicker = shelf ? activeCategoryLabel : category === "all" ? tr("Витрина") : tr("Раздел");
  return (
    <header className={`cv-a-banner${art ? "" : " is-bare"}`} data-banner={art ? "art" : "bare"}>
      {art ? <img className={`cv-a-banner-art${bannerFit(featured) === "contain" ? " is-render" : ""}`} src={art} alt="" draggable="false" /> : null}
      <div className="cv-a-banner-copy">
        <p className="cv-a-kicker">{kicker}</p>
        <VariantHeading model={model} />
        {art ? (
          <Button variant="primary" size="sm" className="cv-a-banner-open" onClick={() => selectCard(featured)}>
            <span>
              {tr("Открыть")} <ModName name={featured.name} />
            </span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export default function CatalogVariantA({ model }) {
  const { words, category, shelf, shelves, search, favoritesOnly, visibleMods, reduxCards, gridItems, gridFeedItems, renderCard } = model;
  const focused = Boolean(search.trim()) || favoritesOnly;
  const shelved = !focused && !shelf && !reduxCards;
  const showcase = useMemo(() => (shelved ? showcaseOf({ mods: visibleMods, category, shelves }) : null), [category, shelved, shelves, visibleMods]);
  const featured = useMemo(() => (focused ? null : bannerMod(visibleMods)), [focused, visibleMods]);
  const groupLabel = (group) => (group.redux ? group.label : words.label(group.label));
  const open = (group) => (group.kind === "section" ? model.chooseCategory(group.id) : model.chooseShelf(group.id));
  const rail = (mods) => mods.slice(0, RAIL_SIZE).map(renderCard);

  let body;
  if (!gridItems.length) body = <VariantEmpty model={model} />;
  else if (showcase)
    body = (
      <div className="cv-a-shelves">
        <Rail icon={Clock} title={tr("Новое")}>
          {rail(showcase.fresh)}
        </Rail>
        {showcase.popular.length ? (
          <Rail icon={Fire} title={tr("Популярное")}>
            {rail(showcase.popular)}
          </Rail>
        ) : null}
        {showcase.groups.map((group) => (
          <Rail
            key={`${group.kind}:${group.id}`}
            title={groupLabel(group)}
            count={group.mods.length.toLocaleString(words.locale)}
            allLabel={tr("Смотреть все")}
            onAll={() => open(group)}
          >
            {rail(group.mods)}
          </Rail>
        ))}
      </div>
    );
  else
    body = (
      <VirtualGrid
        className="public-catalog-grid"
        key={`${category}:${shelf?.id || ""}:${model.refine}:${favoritesOnly}`}
        onGeometry={model.setFeedGeometry}
        items={gridFeedItems}
        renderItem={renderCard}
      />
    );

  return (
    <div ref={model.pageRef} className="desktop-page public-catalog-page is-navigator cv-a" data-catalog-variant="a">
      <CatalogNavigator {...model.navigatorProps} search={model.searchField} />
      <section className="catalog-main cv-a-main" data-catalog-output>
        {focused ? (
          /* Поиск и избранное: обычная шапка без картинки, орудия — в её строке. */
          <header className="cv-a-compact">
            <VariantHeading model={model} />
            <VariantTools model={model} className="cv-a-tools" />
          </header>
        ) : (
          <>
            <Banner model={model} featured={featured} />
            <VariantTools model={model} className="cv-a-tools" />
          </>
        )}
        <section className="public-catalog-results cv-a-results">{body}</section>
      </section>
    </div>
  );
}
