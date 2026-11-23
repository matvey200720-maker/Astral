import BuildWorkCover from "./BuildWorkCover.jsx";
import MyModPicture from "../../../features/library/MyModPicture.jsx";
import TileThumbImg from "../../ui/TileThumbImg.jsx";
import { buildCardTile, collageShare } from "../../../utils/tile-thumb.js";
import { modPhoto } from "../../../features/builds/mod-faces.js";
import { coverTiles } from "../../../features/builds/cover-tiles.js";
import { Stack } from "../../ui/icons.jsx";

const LIMIT = 3;

// Ключ узла, значение data-kind и содержимое плитки; неизвестный вид — заготовка. `sized` — своя ширина плитки (число или функция «окно → css px»), когда плитка стоит не в мозаике карточки.
function describeTile(tile, index, count, sized = null) {
  /* Ширина плитки мозаики в окне: кадр обложки сборки × доля плитки (`collageShare`). */
  const width = sized ?? ((viewport) => buildCardTile(viewport) * collageShare(count, index));
  switch (tile.kind) {
    case "work": {
      const { work } = tile;
      return { key: `work:${work.code}`, kind: "work", body: <BuildWorkCover entry={work} index={index} /> };
    }
    case "item": {
      const { item } = tile;
      return { key: `item:${item.key}`, kind: "work", body: <MyModPicture item={item} index={index} tile={width} /> };
    }
    case "mod": {
      const src = modPhoto(tile.mod);
      return {
        key: `mod:${tile.mod.id}`,
        kind: "mod",
        body: src ? <TileThumbImg alt="" loading="lazy" src={src} tile={width} /> : null,
      };
    }
    default:
      return { key: `pending:${index}`, kind: "pending", body: null };
  }
}

const emptyCover = () => {
  const glyph = <Stack aria-hidden="true" />;
  return (
    <div aria-hidden="true" className="builds-cover is-empty">
      <div className="builds-cover-empty">{glyph}</div>
    </div>
  );
};

/**
 * Плитки обложки без мозаики: `cells` — `{ key, kind, body }` по порядку `coverTiles`, `more` — сколько осталось за ними. `sizeOf(index)` — ширина плитки в css px
 * (число или функция «окно → px»): «Афиша» сборок кладёт первую плитку на весь кадр, остальные — маленькими квадратами, и превью берётся по этим размерам.
 */
export function buildCoverCells(props, { sizeOf = null, limit = LIMIT } = {}) {
  const { works = [], mods = [], pending = 0, items = [] } = props;
  const { tiles, more } = coverTiles(works, mods, limit, pending, items);
  return {
    more,
    cells: tiles.map((tile, index) => describeTile(tile, index, tiles.length, sizeOf ? sizeOf(index) : null)),
  };
}

const BuildCoverCollage = (props) => {
  const { works = [], mods = [] } = props;
  const { pending = 0, items = [] } = props;
  const { tiles, more } = coverTiles(works, mods, LIMIT, pending, items);

  if (!tiles.length) return emptyCover();

  const last = tiles.length - 1;
  const cells = tiles.map((tile, index) => {
    const { key, kind, body } = describeTile(tile, index, tiles.length);
    const badge = more > 0 && index === last ? <b className="builds-cover-more">{`+${more}`}</b> : null;
    const tileClass = kind === "pending" ? "builds-cover-tile is-pending" : "builds-cover-tile";
    return (
      <div key={key} data-kind={kind} className={tileClass}>
        {body}
        {badge}
      </div>
    );
  });

  return (
    <div aria-hidden="true" className={`builds-cover is-mosaic has-${tiles.length}`}>
      {cells}
    </div>
  );
};

export default BuildCoverCollage;
