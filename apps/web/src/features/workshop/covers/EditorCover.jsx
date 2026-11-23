import React, { useMemo } from "react";
import { PhotoSkeleton, Skeleton, skeletonDelay } from "../../../components/ui/Skeleton.jsx";
import { currentUiLanguage } from "../../../locales/ui.js";
import { coverComponent } from "./cover-loaders.js";
import { editorCoverKind } from "./editor-covers.js";
import { stockCover } from "./stock-covers.js";

/*
 * Обложка плитки редактора.
 *
 * Плитка редактора — готовая картинка, снятая с настоящего предпросмотра в полной загрузке
 * (`stock-covers.js`, `scripts/stock-covers-live/`): она стоит сразу, ничего не рисуется и не снимается живьём, и
 * правки человека её не меняют (владелец, 25.10.2026: «чтобы у человека плитка не менялась, а работа ставилась в
 * библиотеку»). Печи обложек (`cover-oven.jsx`) и прогрева после запуска здесь больше нет.
 *
 * Работа человека (`projectId`, `state`) на плитке не показывается. Её обложка — снимок кадра самого редактора
 * при «Сохранить» (`works/work-covers.js`), а этот компонент нужен ей только как запасной вид, пока снимка нет:
 *   • лёгкая обложка-холст без 3D (`LIVE_KINDS`: карта, трассер, метки, шрифты…) рисуется сразу, одним холстом —
 *     вся работа человека на ней видна без печи и без IndexedDB;
 *   • у остальных — та же штатная картинка вида.
 */

/* Рисователь, упавший на чужом снимке правки, не должен уносить с собой полку: плитка остаётся тёмной плашкой. */
class CoverBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function LiveCover({ kind, projectId, state, delay }) {
  const Cover = coverComponent(kind);
  if (!Cover) return null;
  return (
    <CoverBoundary key={`${projectId}:${state ? state.length : 0}`}>
      <React.Suspense fallback={<Skeleton fill delay={delay} />}>
        <Cover projectId={projectId} state={state} kind={kind} />
      </React.Suspense>
    </CoverBoundary>
  );
}

/* Лёгкие обложки без 3D — один холст или немного разметки (SVG мини-карты, прицела, полоски HP, значок звука):
   работа человека на них рисуется сразу, живьём, — это не сцена. */
export const LIVE_KINDS = new Set([
  "minimap",
  "reticle",
  "target-hp",
  "sound",
  "world-map",
  "tracer",
  "kill-effect",
  "screen-hits",
  "group-markers",
  "fonts",
  "flags",
]);

export default function EditorCover({ slotId, projectId = "", state = null }) {
  const kind = editorCoverKind(slotId);
  const work = Boolean(projectId) || Boolean(state);
  const stock = kind ? stockCover(kind, currentUiLanguage()) : null;
  const live = work && LIVE_KINDS.has(kind);
  const wave = useMemo(
    () => skeletonDelay(Array.from(slotId || kind || "").reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    [slotId, kind],
  );
  if (!kind || !coverComponent(kind)) return null;
  const shown = live ? null : stock;
  return (
    <span className="workshop-cover" data-cover={kind} aria-hidden="true">
      {/* Плита под картинкой держит экран, пока та не доехала (`screen-ready.js`). */}
      {shown && <PhotoSkeleton delay={wave} />}
      {shown ? (
        <img
          className="workshop-cover-image workshop-cover-stock"
          data-photo=""
          src={shown.url}
          alt=""
          draggable="false"
          decoding="async"
        />
      ) : live ? (
        <LiveCover kind={kind} projectId={projectId} state={state} delay={wave} />
      ) : null}
    </span>
  );
}
