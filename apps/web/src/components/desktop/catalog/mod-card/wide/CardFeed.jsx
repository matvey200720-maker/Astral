import { Fragment, useMemo } from "react";
import ScrollRail from "../../../../ui/ScrollRail.jsx";
import Showcase from "../../../../../features/showcase/Showcase.jsx";
import { tr } from "../../../../../locales/ui.js";
import { catalogLabel } from "../../../../../features/catalog/catalog-words.js";
import { cardProjectsOf } from "../../../../../features/catalog/card-projects.js";
import { coverFor, hasOwnCover } from "../../../../../utils/catalogMedia.js";
import { pageThumbUrl } from "../../../../../utils/cover-thumb.js";
import ModName from "../../ModName.jsx";
import { dataLangOf } from "../../data-lang.js";
import { reduxOfPart } from "../ModReduxPlate.jsx";

/*
 * Разделитель и лента «Подборка модов» под названием (21.11.2026). Разделитель — сплошная линия посередине, по краям и у надписи она затухает острыми хвостами и надписи не касается.
 * Лента листается вбок: карточка — обложка 16 : 9, название и строка «вид · сервер»; нажатие открывает страницу мода. Состав ленты: паки, в которые входит мод (у части редукса —
 * сам редукс, он стоит первым; прежняя плашка «Часть редукса» ушла в ленту), стволы пака, затем похожие моды каталога. Прежние полки «Входит в…», «Похожие» и сетка ушли, место рекламной полосы (`Showcase`) осталось.
 */

const LIMIT = 14;
export const FEED_ART_PX = 236;

// Раздел мода словами языка: словарь витрины, а если он слова не знает — общий перевод.
const kindWord = (mod, language) => {
  const source = mod.catalogSubcategory || mod.categoryLabel || "";
  const word = catalogLabel(source, language);
  return word === source ? tr(source) : word;
};

/** Состав ленты: без повторов и без самого мода, не больше `LIMIT`. */
export function feedOf(view) {
  const { rails, mod, contents } = view;
  const own = new Set([mod.id]);
  return [
    reduxOfPart(view),
    ...(view.reduxes ?? []),
    ...(rails.parents ?? []),
    ...(contents?.length > 0 ? [] : (rails.members ?? [])),
    ...(rails.related ?? []),
  ]
    .filter((entry) => entry && !own.has(entry.id) && own.add(entry.id))
    .slice(0, LIMIT);
}

export function FeedDivider({ label }) {
  return (
    <div className="xw-divider">
      <i className="xw-divider-line is-left" aria-hidden="true" />
      <h2 data-audit-ignore="caps">{label}</h2>
      <i className="xw-divider-line is-right" aria-hidden="true" />
    </div>
  );
}

function FeedCard({ mod, view, onSelect }) {
  const cover = hasOwnCover(mod) ? coverFor(mod) : "";
  const projects = cardProjectsOf(mod)
    .map((project) => project.label)
    .join(" · ");
  const sub = [kindWord(mod, view.language), projects]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="xw-feed-card"
      onClick={onSelect ? () => onSelect(mod) : undefined}
      disabled={!onSelect}
    >
      <span className="xw-feed-art" aria-hidden="true">
        {cover && (
          <img
            src={pageThumbUrl(cover, FEED_ART_PX)}
            alt=""
            loading="lazy"
            decoding="async"
            data-photo=""
            draggable="false"
          />
        )}
      </span>
      <b lang={dataLangOf(mod.name)}>
        <ModName name={mod.name} />
      </b>
      {sub && <small>{sub}</small>}
    </button>
  );
}

export default function CardFeed({ view }) {
  const mods = useMemo(() => feedOf(view), [view]);
  const choose = view.rails.onSelect;
  const label = tr("Подборка модов");
  const stage = {
    place: "mod",
    screen: "mod-detail",
    mod: view.mod,
    language: view.language,
    className: "mod-detail-showcase",
  };
  return (
    <Fragment>
      {mods.length > 0 && (
        <section className="xw-feed" aria-label={label}>
          <FeedDivider label={label} />
          <ScrollRail
            trackClassName="xw-feed-track"
            label={label}
            previousLabel={view.copy.previousShelf}
            nextLabel={view.copy.nextShelf}
          >
            {mods.map((mod) => (
              <FeedCard key={mod.id} mod={mod} view={view} onSelect={choose} />
            ))}
          </ScrollRail>
        </section>
      )}
      <Showcase {...stage} />
    </Fragment>
  );
}
