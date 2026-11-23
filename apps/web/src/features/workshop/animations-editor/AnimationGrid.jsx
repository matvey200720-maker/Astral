import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import VirtualGrid from "../../../components/ui/VirtualGrid.jsx";
import { PersonSimpleWalk } from "../../../components/ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { isOwn, isProject, kindLabel } from "./animation-library.js";

/*
 * Сетка анимаций (ТЗ 29.10.2026-d): плитка — поза ключевого кадра клипа на персонаже игры и подпись на самой карточке: вид («Эмоция», «Танец»…) и имя. В документе только
 * видимые ряды (`VirtualGrid`); снимок позы плитка просит у полки при появлении и отменяет, если ушла за край раньше, чем
 * очередь дошла до неё. Рисуется снимок один раз на запись (`createPoseShelf`) — плитка только копирует его в свой холст.
 */

const noop = () => () => {};
const zero = () => 0;

const PoseCard = memo(function PoseCard({
  entry,
  shelf,
  selected,
  marked,
  locked,
  onPick,
  onWarm,
}) {
  useTr();
  const canvasRef = useRef(null);
  const version = useSyncExternalStore(
    shelf?.subscribe || noop,
    shelf?.version || zero,
  );
  useEffect(() => {
    if (!shelf) return undefined;
    shelf.want(entry);
    return () => shelf.cancel(entry);
  }, [shelf, entry]);
  const picture = shelf?.get(entry.id);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;
    /* Снимок ложится один к одному: холст плитки того же размера в пикселях, а на экран его сжимает браузер (в `animations.css` — на всю плитку). */
    if (
      picture &&
      (canvas.width !== picture.width || canvas.height !== picture.height)
    ) {
      canvas.width = picture.width;
      canvas.height = picture.height;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (picture) context.drawImage(picture, 0, 0);
  }, [picture, version]);
  const kind = kindLabel(entry);
  return (
    <button
      type="button"
      className="animation-card"
      data-entry={entry.id}
      data-selected={selected ? "" : undefined}
      data-marked={marked ? "" : undefined}
      aria-pressed={selected}
      disabled={locked}
      title={`${kind} · ${entry.name}`}
      onClick={() => onPick(entry)}
      onPointerEnter={onWarm ? () => onWarm(entry) : undefined}
      onPointerLeave={onWarm ? () => onWarm(null) : undefined}
      onFocus={onWarm ? () => onWarm(entry) : undefined}
    >
      <span
        className="animation-card-pose"
        data-state={
          picture ? "ready" : picture === false ? "failed" : "loading"
        }
      >
        <canvas ref={canvasRef} width={140} height={175} aria-hidden="true" />
        {!picture && <PersonSimpleWalk aria-hidden="true" />}
      </span>
      <span className="animation-card-caption">
        <small className="animation-card-kind">
          {kind}
          {isOwn(entry) ? ` · ${tr("свой файл")}` : ""}
          {isProject(entry) ? ` · ${entry.pack}` : ""}
        </small>
        <b className="animation-card-name">{entry.name}</b>
      </span>
    </button>
  );
});

export default function AnimationGrid({
  entries,
  shelf,
  selectedId,
  markedIds,
  lockedId,
  onPick,
  onWarm,
}) {
  return (
    <VirtualGrid
      className="animation-grid"
      items={entries}
      assembly={false}
      tabIndex={-1}
      renderItem={(entry) => (
        <PoseCard
          key={entry.id}
          entry={entry}
          shelf={shelf}
          selected={entry.id === selectedId}
          marked={markedIds?.has(entry.id)}
          locked={entry.id === lockedId}
          onPick={onPick}
          onWarm={onWarm}
        />
      )}
    />
  );
}
