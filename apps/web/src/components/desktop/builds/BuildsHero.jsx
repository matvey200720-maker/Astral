import { Copy } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import { pendingWithoutPhoto } from "../../../features/builds/cover-tiles.js";
import { describeBuild } from "./BuildCard.jsx";
import BuildCoverCollage, { buildCoverCells } from "./BuildCoverCollage.jsx";
import { gluedTitle } from "../../../features/builds/title-glue.js";
import "./builds-poster.css";

/*
 * «Афиша» сборок (дизайн 15.11.2026, макет r3/builds/builds-B-list): над сеткой — сборка, что сейчас стоит в игре, крупно: первая плитка её обложки
 * идёт кадром на весь герой (без швов мозаики), остальные — маленькими квадратами справа внизу; состав и два действия — слева. Под героем — карточки
 * сборок и плитка «Создать сборку» первой в сетке.
 * Данные те же, что у карточки (`cardPropsOf`): что стоит, определяет `buildIsInstalled`, состав и размер — `describeBuild`.
 */
/* Квадрат справа внизу — 96 px в макете; превью берётся с запасом на плотный экран. */
const THUMB_SIZE = 192;

export default function BuildsHero({ card, onOpen, onCopy, copy }) {
  const { profile, mods, items = [], workCards = null } = card;
  const works = workCards ?? profile.works ?? [];
  const tiles = { mods, works, items, pending: pendingWithoutPhoto(mods) };
  /* Кадром — первая плитка, у которой есть что показать (заготовка без картинки её не занимает); остальные с картинкой — квадратами. */
  const layout = (leadAt) =>
    buildCoverCells(tiles, {
      sizeOf: (index) =>
        index === leadAt ? (viewport) => viewport : THUMB_SIZE,
    }).cells;
  let cells = layout(0);
  const leadAt = cells.findIndex((cell) => cell.body);
  if (leadAt > 0) cells = layout(leadAt);
  const lead = cells[leadAt] ?? null;
  const thumbs = cells.filter((cell) => cell !== lead && cell.body);
  return (
    <section className="builds-hero" aria-label={profile.name}>
      <div className="builds-hero-cover" aria-hidden="true">
        {lead ? (
          lead.body
        ) : (
          <BuildCoverCollage mods={mods} works={works} items={items} />
        )}
      </div>
      <div className="builds-hero-shade" aria-hidden="true" />
      {thumbs.length > 0 && (
        <div className="builds-hero-thumbs" aria-hidden="true">
          {thumbs.map((cell) => (
            <div
              key={cell.key}
              className="builds-hero-thumb"
              data-kind={cell.kind}
            >
              {cell.body}
            </div>
          ))}
        </div>
      )}
      <span className="builds-hero-live">
        <i aria-hidden="true" />
        {copy.liveNow}
      </span>
      <div className="builds-hero-copy">
        <span className="builds-hero-chip">
          {describeBuild(card, works.length + items.length)}
        </span>
        <h2>{gluedTitle(profile.name)}</h2>
        <div className="builds-hero-actions">
          <Button variant="primary" onClick={() => onOpen(profile)}>
            {copy.openBuild}
          </Button>
          <Button
            variant="secondary"
            icon={<Copy />}
            onClick={() => onCopy(profile)}
          >
            {copy.copyCode}
          </Button>
        </div>
      </div>
    </section>
  );
}
