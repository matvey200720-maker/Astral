import { useEffect, useRef, useState } from "react";
import { Play } from "../../../ui/icons.jsx";
import { renderFillStyle, useFrameCrop } from "../../../ui/frame-crop.js";
import { PhotoSkeleton } from "../../../ui/Skeleton.jsx";
import { tr } from "../../../../locales/ui.js";

/*
 * Кадр сцены — во весь блок: картинка заполняет плитку, рамки и поля вокруг нет. Плитка тянется на ту высоту, что
 * осталась сцене от ленты и правой панели (ТЗ 24.10.2026, п. 10), поэтому её пропорции — не 16 : 9 и не пропорции самого
 * рисунка, а те, что получились у рамки: их меряет ResizeObserver, и рамка рисунка (мини-карта, коллаж стволов,
 * прозрачный ствол) доводится до них, чтобы «cover» ничего от рисунка не отрезал. Подпись происхождения — строкой под
 * кадром.
 */
export default function FrameTile({ item, index, view, onOpen }) {
  const [ratio, setRatio] = useState(0);
  const tileRef = useRef(null);
  /* Подпись разбора, которую знает словарь, — словами языка окна; свободная подпись модератора
     («mirz, расцветка B») — данные, как есть. Видимой подписи под кадром нет (владелец, 25.10.2026): она лежит подсказкой. */
  const raw = view.captionOf(item);
  const caption = raw ? tr(raw) : "";
  const video = item.type === "video";
  /* Рисунок на своём поле (мини-карта, коллаж стволов) — без поля: плитка
     показывает только рисунок (`frame-crop.js`). */
  const crop = useFrameCrop(video ? "" : item.src);
  /* Пропорции плитки — по её же рамке: меняются с окном и с высотой правой панели. */
  useEffect(() => {
    const node = tileRef.current;
    if (!node) return undefined;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width && height) setRatio(Math.round((width / height) * 100) / 100);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);
  const tileRatio = ratio || 16 / 9;
  /* Ствол на прозрачном — целиком по центру на матовом поле плитки. */
  const transparent = Boolean(crop?.transparent);
  /* Рендер на своём поле — рисунок во весь кадр с полем не больше 6 %, без
     обрезки; недостающее — цветом края картинки: шва и острова нет
     (`renderFillStyle`). Кадр без рамки рисунка — как есть. */
  const fill =
    (crop?.field || crop?.transparent) && crop.inset && tileRatio
      ? renderFillStyle(crop, tileRatio)
      : null;
  const fillKey = fill ? JSON.stringify(fill) : "";
  useEffect(() => {
    const node = tileRef.current?.querySelector("img");
    if (!node) return;
    const props = {
      "object-fit": fill?.objectFit,
      "object-position": fill?.objectPosition,
      "object-view-box": fill?.objectViewBox,
      "background-color": fill?.backgroundColor,
      "background-image": fill?.backgroundImage,
      "background-position": fill?.backgroundPosition,
      "background-size": fill?.backgroundSize,
      "background-repeat": fill?.backgroundRepeat,
      "box-sizing": fill?.boxSizing,
      padding: fill?.padding,
    };
    for (const [name, value] of Object.entries(props))
      if (value) node.style.setProperty(name, value);
      else node.style.removeProperty(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- по ключу стиля
  }, [fillKey]);
  return (
    <figure className="mod-card-frame">
      <button
        type="button"
        className={`mod-card-tile${video ? " is-video" : ""}${transparent ? " is-transparent" : ""}`}
        ref={tileRef}
        title={caption || undefined}
        aria-label={
          video
            ? view.cardCopy.watchVideo
            : `${view.cardCopy.openFrame} ${index + 1}`
        }
        onClick={onOpen}
      >
        {/* Серое место до кадра (скелет, `docs/3D.md`, правило 22): плита стоит перед `<img data-photo>`. */}
        {!video && <PhotoSkeleton />}
        {view.renderMedia(item, "mod-card-tile-media")}
        {video && (
          <>
            <span className="mod-card-tile-badge" aria-hidden="true">
              <Play weight="fill" />
            </span>
            <span className="mod-card-tile-label" aria-hidden="true">
              {item.title || view.cardCopy.watchVideo}
            </span>
          </>
        )}
      </button>
    </figure>
  );
}
