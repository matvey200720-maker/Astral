import { coverThumbUrl } from "../../../../../utils/cover-thumb.js";
import {
  nativeThumbTier,
  stageThumbWidth,
} from "../../../../../utils/stage-photo.js";
import { isTimecycleMod } from "../../../../../utils/catalogMedia.js";
import { motionEnabled } from "../../../../../motion-preference.js";
import ClipStage from "../ClipStage.jsx";
import SkyCyclePlayer from "../SkyCyclePlayer.jsx";
import YoutubeStage from "../YoutubeStage.jsx";
import { PreviewFrame } from "./CardOverlay.jsx";
import WideDay from "./WideDay.jsx";

/*
 * Предпросмотры страницы-галереи, у которых нет своего окна в приложении (21.11.2026): ролик, YouTube, сутки листом и просто картинка. Остальные виды — готовые окна:
 * 3D-ствол и одежда на персонаже (`ModelWindow`), миникарта, таймцикл и прицел живьём (`PreviewWindow`, `ModPreviewWindow`). Всё идёт в одной карточке по центру с крестиком в правом
 * углу (`PreviewFrame`); внутри не листается.
 */

// Кадр-картинка крупно: ярус из ряда не выше родного и не шире окна — не оригиналом, пока оригинал не нужен.
const IMAGE_BOX_PX = 1120;
const imageWidth = (item) =>
  Math.min(
    stageThumbWidth(
      Math.min(
        typeof window === "undefined" ? IMAGE_BOX_PX : window.innerWidth - 80,
        IMAGE_BOX_PX,
      ),
    ),
    nativeThumbTier(item.width),
  );

/** Одна картинка крупно. */
export function ImagePreview({ view, entry, onClose }) {
  const { item } = entry;
  const src = coverThumbUrl(item.src, imageWidth(item));
  return (
    <PreviewFrame label={view.mod.name} onClose={onClose}>
      <figure
        className="xw-preview-figure"
        title={view.captionOf?.(item) || undefined}
      >
        <img
          className="xw-preview-image"
          src={src}
          alt={view.mod.name}
          data-photo=""
          draggable="false"
          onError={() => view.dropMedia?.(item.src)}
        />
      </figure>
    </PreviewFrame>
  );
}

// Тело плеера по виду кадра.
function PlayerBody({ view, entry, page }) {
  const { item } = entry;
  if (item.type === "clip")
    return (
      <>
        <ClipStage key={item.id} clip={item} />
        {page.motionOnly && isTimecycleMod(view.mod) && (
          <WideDay
            startHour={view.mod.domain?.timecycle?.cycle?.startHour ?? 12}
          />
        )}
      </>
    );
  if (item.type === "youtube")
    return <YoutubeStage key={item.id} id={item.id} />;
  if (item.type === "sky")
    return <SkyCyclePlayer key={item.src} cycle={item.cycle} autoPlay />;
  return (
    <figure className="xw-video" title={view.captionOf?.(item) || undefined}>
      {/* Нажали на кадр — ролик играет; петля (мини-карта с полосами) при «Движение: выкл» стоит стоп-кадром до ▶, как прежде (ТЗ 10.11.2026). */}
      {view.renderMedia(item, "xw-video-media", {
        playing: !item.loop || motionEnabled(),
        stage: true,
      })}
    </figure>
  );
}

/** Ролик, YouTube, сутки таймцикла: играют в предпросмотре, в галерее стоит кадр-постер. */
export function PlayerPreview({ view, entry, page, onClose }) {
  return (
    <PreviewFrame label={view.mod.name} onClose={onClose} className="is-player">
      <div className="xw-player">
        <PlayerBody view={view} entry={entry} page={page} />
      </div>
    </PreviewFrame>
  );
}
