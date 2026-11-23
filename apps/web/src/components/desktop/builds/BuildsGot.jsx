import { tr, useTr } from "../../../locales/ui.js";
import { pendingWithoutPhoto } from "../../../features/builds/cover-tiles.js";
import { describeBuild } from "./BuildCard.jsx";
import BuildCoverCollage from "./BuildCoverCollage.jsx";
import "./builds-poster.css";

/*
 * «Пришли по коду» (дизайн 15.11.2026, макет builds-B-list): под сеткой моих сборок — строка из двух сборок, прочитанных из кода друга. Автора у кода нет,
 * поэтому под названием только состав и вес — то, что известно о сборке.
 */
export default function BuildsGot({ cards, onOpen, limit = 2 }) {
  useTr();
  if (cards.length === 0) return null;
  return (
    <section className="builds-got" aria-label={tr("Пришли по коду")}>
      <h2>{tr("Пришли по коду")}</h2>
      <div className="builds-got-row">
        {cards.slice(0, limit).map((card) => {
          const { profile, mods, items = [], workCards = null } = card;
          const works = workCards ?? profile.works ?? [];
          return (
            <button
              key={profile.id}
              type="button"
              className="builds-got-card"
              onClick={() => onOpen(profile)}
            >
              <span className="builds-got-cover" aria-hidden="true">
                <BuildCoverCollage
                  mods={mods.slice(0, 1)}
                  works={works}
                  items={items}
                  pending={pendingWithoutPhoto(mods)}
                />
              </span>
              <span className="builds-got-text">
                <b>{profile.name}</b>
                <span>{describeBuild(card, works.length + items.length)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
