import { useRef, useState } from "react";
import {
  CaretLeft,
  CaretRight,
  ImageSquare,
  Play,
  YoutubeLogo,
} from "../../../../ui/icons.jsx";
import { PhotoSkeleton, skeletonDelay } from "../../../../ui/Skeleton.jsx";
import { tr } from "../../../../../locales/ui.js";
import { coverThumbUrl } from "../../../../../utils/cover-thumb.js";
import { youtubePosterUrl } from "../../../../../features/catalog/youtube-video.js";
import {
  nativeThumbTier,
  useStageThumbWidth,
} from "../../../../../utils/stage-photo.js";

/*
 * Галерея страницы мода (21.11.2026, макет «карточки»): большой кадр и виден край следующего. Кадры стоят в один ряд по 76 % ширины, ряд сдвигается плавно (длительность и кривая —
 * токены), у первого и последнего кадра край следующего или прежнего остаётся виден. У мода с одним кадром кадр занимает всю ширину — пустого края нет. Тонкие стрелки, счётчик
 * «2 / 5», клавиши ←/→ на самой галерее; при «Движение: выкл» и `prefers-reduced-motion` ряд переезжает мгновенно.
 *
 * Кадр — кнопка: нажатие на выбранный кадр открывает предпросмотр (`onOpen`), нажатие на соседний — сдвигает к нему. Ролик, YouTube и сутки таймцикла в самой галерее не играют:
 * в рамке стоит кадр-постер со значком ▶ и подписью, играют они в предпросмотре. Запись — `{ key, item, name, model }` сцены страницы мода.
 *
 * Постер YouTube — картинка ролика с сервера YouTube (`youtubePosterUrl`: окно пускает её по `img-src`, больше туда не ходит ничего); нет «максимальной» — берётся средняя, нет и её — значок.
 * Стрелки — тонкие «‹ ›» без кругов (владелец, 22.11.2026).
 */

const SHARE = 76;
const GAP_PX = 12;

// Картинка кадра: постер ролика, фото, обложка шапки у суток; у YouTube постера нет — стоит значок.
const posterOf = (item, cover) => {
  if (item.type === "youtube") return "";
  if (item.type === "sky") return cover;
  if (item.type === "clip") return item.poster || cover;
  if (item.type === "video") return item.poster || item.thumbnail || cover;
  return item.src;
};

// Сдвиг ряда: у первого кадра ноль, у последнего — его правый край у края галереи, между ними — по кадру. Один сдвиг на весь ряд (`.xw-strip`), проценты — от ширины самого ряда (= ширины
// галереи), поэтому кадр — 76 % и шаг — «76 % + зазор» без замеров. Раньше сдвиг и анимацию имел каждый кадр отдельно (14 переходов сразу): под нагрузкой они отставали друг от друга, кадр
// «не вставал на место», а щелчок по виду «текущему» попадал в соседний (жалоба владельца 22.11.2026: пустота рядом с шестым кадром, предпросмотр не открывается, листание рывками).
export const shiftOf = (at, count) => {
  if (count < 2 || at === 0) return "0px";
  const step = `(${SHARE}% + ${GAP_PX}px)`;
  if (at === count - 1)
    return `calc(${-(count - 1)} * ${step} + ${100 - SHARE}%)`;
  return `calc(${-at} * ${step})`;
};

function Slide({
  entry,
  index,
  at,
  view,
  badge,
  cover,
  width,
  onPick,
  frameRef,
}) {
  const { item } = entry;
  const tube = item.type === "youtube";
  const [tubeSize, setTubeSize] = useState("maxresdefault");
  const tubeSrc = tube && tubeSize ? youtubePosterUrl(item.id, tubeSize) : "";
  const src = tube ? tubeSrc : posterOf(item, cover);
  const sized = tube
    ? tubeSrc
    : src && width !== null
      ? coverThumbUrl(src, Math.min(width, nativeThumbTier(item.width)))
      : "";
  // У ролика без «максимальной» картинки YouTube отдаёт серую заглушку 120 × 90: берём среднюю, потом значок.
  const nextTube = () =>
    setTubeSize((size) => (size === "maxresdefault" ? "hqdefault" : ""));
  const label = badge?.label || view.captionOf?.(item) || "";
  const near = Math.abs(index - at) <= 1;
  return (
    <button
      ref={frameRef}
      type="button"
      className={`xw-slide${index === at ? " is-current" : ""}${badge?.play ? " is-video" : ""}`}
      aria-label={
        badge?.play
          ? badge.label || view.cardCopy.watchVideo
          : entry.name ||
            (badge?.live
              ? tr("Открыть живой предпросмотр")
              : `${tr("Кадр")} ${index + 1}`)
      }
      aria-current={index === at ? "true" : undefined}
      title={entry.name || view.captionOf?.(item) || undefined}
      onClick={() => onPick(index)}
      data-audit-ignore="box-overflow"
    >
      {src ? (
        <>
          {/* Серое место, пока кадр едет: плиты идут волной слева направо (скелет, `docs/3D.md`, правило 22). */}
          <PhotoSkeleton delay={skeletonDelay(index)} />
          {sized && (
            <img
              className="xw-slide-image"
              src={sized}
              alt={index === at ? view.mod.name : ""}
              data-photo=""
              draggable="false"
              loading={near ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={index === at ? "high" : "low"}
              onLoad={
                tube
                  ? (event) => {
                      if (event.currentTarget.naturalWidth <= 120) nextTube();
                    }
                  : undefined
              }
              onError={() => (tube ? nextTube() : view.dropMedia?.(item.src))}
            />
          )}
        </>
      ) : (
        <span className="xw-slide-empty" aria-hidden="true">
          {item.type === "youtube" ? (
            <YoutubeLogo weight="fill" />
          ) : (
            <ImageSquare />
          )}
        </span>
      )}
      {badge?.play && (
        <span className="xw-slide-play" aria-hidden="true">
          <Play weight="fill" />
        </span>
      )}
      {label && badge && (
        <span className="xw-slide-chip" data-audit-ignore="caps">
          {label}
        </span>
      )}
      {entry.part && entry.name && !entry.bare && (
        <span className="xw-slide-name">{entry.name}</span>
      )}
    </button>
  );
}

export default function CardGallery({
  view,
  items,
  active,
  onActive,
  onOpen,
  badgeOf,
  cover = "",
}) {
  const count = items.length;
  const at = Math.min(Math.max(active, 0), Math.max(count - 1, 0));
  const first = useRef(null);
  const width = useStageThumbWidth(first, count > 0);
  if (count === 0) return null;

  const step = (shift) => onActive((at + shift + count) % count);
  const onKeyDown = (event) => {
    if (count < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))
      return;
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };
  const pick = (index) => (index === at ? onOpen(index) : onActive(index));

  return (
    <div
      className={`xw-gallery${count === 1 ? " is-single" : ""}`}
      role="group"
      aria-roledescription="carousel"
      aria-label={view.cardCopy.frames}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Ряд режет лишнее сам (`overflow: hidden`), а сдвиг стоит на каждом кадре: кадры не «вылезают» за ячейку, как их видит сверка экрана. */}
      <div className="xw-track">
        <div
          className="xw-strip"
          style={{ "--xw-shift": shiftOf(at, count) }}
          data-audit-ignore="box-overflow"
        >
          {items.map((entry, index) => (
            <Slide
              key={entry.key}
              entry={entry}
              index={index}
              at={at}
              view={view}
              badge={badgeOf(entry)}
              cover={cover}
              width={width}
              onPick={pick}
              frameRef={index === 0 ? first : undefined}
            />
          ))}
        </div>
      </div>
      {count > 1 && (
        <>
          <button
            type="button"
            className="xw-arrow is-left"
            aria-label={view.copy.previous}
            onClick={() => step(-1)}
          >
            <CaretLeft weight="light" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="xw-arrow is-right"
            aria-label={view.copy.next}
            onClick={() => step(1)}
          >
            <CaretRight weight="light" aria-hidden="true" />
          </button>
          <span
            className="xw-counter"
            aria-live="polite"
          >{`${at + 1} / ${count}`}</span>
        </>
      )}
    </div>
  );
}
