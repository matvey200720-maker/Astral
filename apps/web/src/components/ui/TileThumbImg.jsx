import { useTileThumb } from "../../utils/tile-thumb.js";

/*
 * Картинка плитки с превью по её раскладке (`utils/tile-thumb.js`): облачная картинка идёт уменьшенной копией нужной ширины, а не оригиналом. Остальные свойства — как у `<img>`.
 * `tile` — функция «ширина окна → ширина плитки в css px» или готовая ширина.
 */
export default function TileThumbImg({ src, tile, alt = "", ...rest }) {
  const shown = useTileThumb(src, tile);
  return <img src={shown} alt={alt} {...rest} />;
}
