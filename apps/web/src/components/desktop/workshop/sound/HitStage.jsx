import { memo, useEffect, useId, useRef, useState } from "react";
import { hudLayerRect } from "../hud-preview/hud-frame.js";
import {
  CHARACTER_IMAGE,
  FIGURE_HEADROOM,
  FIGURE_STAGE,
  FIGURE_STAGE_BOX,
  FIGURE_VIEW,
  ZONE_ANCHORS,
  zoneShapeElements,
} from "../impact-figure.js";
import { STAGE_IDLE, startStageLoop } from "../stage-loop.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Кадр звуков попадания: человек-мишень, по которому показывают пальцем.
 *
 * Та же фигура и те же зоны, что у эффектов попадания (`impact-figure.js`):
 * щёлкнул по голове — правишь голову и сразу слышишь её звук, по телу —
 * тело. Каждый звук сопровождает выстрел: пуля прилетает слева, и в миг,
 * когда звучит звук, у раны вспыхивает отметка попадания — как её рисуют
 * шутеры. Моменты приходят от проигрывателя (`feed` — лента попаданий на
 * часах страницы, пополняется, пока идёт серия), поэтому вспышка и звук
 * совпадают до кадра. Органы поверх кадра (`StageBar`) и подпись студия
 * кладёт детьми.
 *
 * Фигура — рендер Astral, а не кадр из игры; подпись кадра (подпись кадра,
 * её ставит студия) говорит это прямо (CLAUDE.md).
 */

const PARTS = Object.freeze([
  Object.freeze({ id: "head", label: "Голова" }),
  Object.freeze({ id: "body", label: "Тело" }),
]);

/* Пуля летит к ране десятую долю секунды — до звука, а не вместе с ним. */
const FLIGHT_MS = 120;
/* Отметка попадания держится меньше полсекунды: это знак, а не декорация. */
const MARK_MS = 460;

/* Где фигура в коробке: кадр с воздухом над головой вписан по центру. */
function figureRect(box) {
  const frame = hudLayerRect(box, FIGURE_STAGE);
  return {
    x: frame.x,
    y: frame.y + FIGURE_HEADROOM * frame.scale,
    width: FIGURE_VIEW.width * frame.scale,
    height: FIGURE_VIEW.height * frame.scale,
  };
}

/*
 * Цвета отметки — слой игры, а не палитра лаунчера: голова красная, как
 * «хедшот» в шутерах, тело белое. На чёрной подложке сцены они читаются в
 * любой теме приложения.
 */
const MARK_COLOURS = Object.freeze({ head: "255, 77, 77", body: "255, 255, 255" });

function drawBullet(context, point, unit, progress) {
  const fromX = point.x - unit * 2.4;
  const fromY = point.y - unit * 0.55;
  const head = Math.min(1, progress);
  const tail = Math.max(0, head - 0.45);
  const hx = fromX + (point.x - fromX) * head;
  const hy = fromY + (point.y - fromY) * head;
  const tx = fromX + (point.x - fromX) * tail;
  const ty = fromY + (point.y - fromY) * tail;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  const gradient = context.createLinearGradient(tx, ty, hx, hy);
  gradient.addColorStop(0, "rgba(255, 214, 150, 0)");
  gradient.addColorStop(1, "rgba(255, 240, 210, 0.9)");
  context.strokeStyle = gradient;
  context.lineWidth = Math.max(1.5, unit * 0.02);
  context.beginPath();
  context.moveTo(tx, ty);
  context.lineTo(hx, hy);
  context.stroke();
  context.restore();
}

/* Отметка попадания: четыре штриха крестом с просветом в середине. */
function drawMark(context, point, unit, part, progress) {
  const fade = 1 - progress;
  const pop = 1 + 0.35 * Math.exp(-progress * 9);
  const gap = unit * 0.07 * pop;
  const length = unit * 0.11 * pop;
  context.save();
  context.lineCap = "round";
  context.lineWidth = Math.max(2, unit * 0.028);
  context.strokeStyle = `rgba(${MARK_COLOURS[part]}, ${0.95 * fade})`;
  context.shadowColor = "rgba(0, 0, 0, 0.6)";
  context.shadowBlur = unit * 0.03;
  context.beginPath();
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const nx = dx / Math.SQRT2;
    const ny = dy / Math.SQRT2;
    context.moveTo(point.x + nx * gap, point.y + ny * gap);
    context.lineTo(point.x + nx * (gap + length), point.y + ny * (gap + length));
  }
  context.stroke();
  /* У головы — расходящееся кольцо: хедшот отличим от попадания в тело и
     без звука. */
  if (part === "head") {
    context.lineWidth = Math.max(1.5, unit * 0.014);
    context.strokeStyle = `rgba(${MARK_COLOURS.head}, ${0.7 * fade})`;
    context.beginPath();
    context.arc(point.x, point.y, unit * (0.12 + progress * 0.28), 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function HitStage({
  parts,
  selected,
  onSelect,
  onPlay,
  feed,
  children = null,
}) {
  useTr();
  const layersRef = useRef(null);
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  const eventsRef = useRef([]);
  const [hovered, setHovered] = useState(null);
  const maskId = `snd-hit-figure-${useId().replace(/:/g, "")}`;

  /* Цикл кадров: рисует, пока летит пуля или горит отметка, и спит до
     следующего выстрела серии. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const layers = layersRef.current;
    if (!canvas || !layers) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const box = { width: 0, height: 0, ratio: 1 };
    const measure = () => {
      const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      box.width = layers.clientWidth;
      box.height = layers.clientHeight;
      box.ratio = ratio;
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
    };
    measure();
    const loop = startStageLoop({
      element: canvas,
      maxFps: 60,
      frame: (now) => {
        context.setTransform(box.ratio, 0, 0, box.ratio, 0, 0);
        context.clearRect(0, 0, box.width, box.height);
        const figure = figureRect(box);
        const unit = figure.height * 0.18;
        let next = STAGE_IDLE;
        const alive = [];
        for (const event of eventsRef.current) {
          const [ax, ay] = ZONE_ANCHORS[event.part] || ZONE_ANCHORS.body;
          const point = {
            x: figure.x + ax * figure.width,
            y: figure.y + ay * figure.height,
          };
          const since = now - event.at;
          if (since >= MARK_MS) continue;
          alive.push(event);
          if (since < -FLIGHT_MS) {
            next = Math.min(next, -FLIGHT_MS - since);
            continue;
          }
          next = 0;
          if (since < 0) drawBullet(context, point, unit, 1 + since / FLIGHT_MS);
          else drawMark(context, point, unit, event.part, since / MARK_MS);
        }
        eventsRef.current = alive;
        return next;
      },
    });
    loopRef.current = loop;
    const observer = new ResizeObserver(() => {
      measure();
      loop.invalidate();
    });
    observer.observe(layers);
    return () => {
      observer.disconnect();
      loop.stop();
      loopRef.current = null;
    };
  }, []);

  /* Попадания — лентой: серия пополняет расписание кадра, остановка снимает
     то, что ещё не долетело. */
  useEffect(() => {
    if (!feed) return undefined;
    return feed.subscribe((message) => {
      if (message.type === "clear") {
        const now = performance.now();
        eventsRef.current = eventsRef.current.filter(
          (event) => event.at <= now,
        );
      } else if (message.type === "hits" && message.events?.length) {
        eventsRef.current = [
          ...eventsRef.current,
          ...message.events.map((event) => ({ ...event })),
        ];
      }
      loopRef.current?.invalidate();
    });
  }, [feed]);

  const activate = (part) => {
    onSelect?.(part);
    onPlay?.(part);
  };

  return (
    <div className="fx-body snd-hit-stage">
      <div className="fx-body-layers" ref={layersRef}>
        <svg
          className="fx-body-photo"
          viewBox={FIGURE_STAGE_BOX}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* Подсветка ложится по самому человеку, а не по фигуре зоны:
                маска — альфа рендера. */}
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={FIGURE_VIEW.width}
              height={FIGURE_VIEW.height}
              style={{ maskType: "alpha" }}
            >
              <image
                href={CHARACTER_IMAGE}
                x="0"
                y="0"
                width={FIGURE_VIEW.width}
                height={FIGURE_VIEW.height}
              />
            </mask>
          </defs>
          <image
            href={CHARACTER_IMAGE}
            x="0"
            y="0"
            width={FIGURE_VIEW.width}
            height={FIGURE_VIEW.height}
          />
          <g mask={`url(#${maskId})`}>
            {PARTS.map((part) => {
              const state =
                selected === part.id
                  ? "is-selected"
                  : hovered === part.id
                    ? "is-hovered"
                    : "";
              return (
                <g
                  key={part.id}
                  className={`snd-hit-tint ${state}${parts?.[part.id]?.enabled ? " is-on" : ""}`}
                >
                  {zoneShapeElements(part.id)}
                </g>
              );
            })}
          </g>
        </svg>
        <canvas
          ref={canvasRef}
          className="fx-body-canvas"
          role="presentation"
        />
        <svg
          className="fx-body-figure"
          viewBox={FIGURE_STAGE_BOX}
          role="group"
          aria-label={tr("Куда попадание")}
        >
          {PARTS.map((part) => (
            <g
              key={part.id}
              className="fx-body-zone"
              role="button"
              tabIndex={0}
              aria-pressed={selected === part.id}
              aria-label={tr("{part}: выбрать и прослушать").replace("{part}", tr(part.label))}
              onClick={() => activate(part.id)}
              onMouseEnter={() => setHovered(part.id)}
              onMouseLeave={() =>
                setHovered((current) => (current === part.id ? null : current))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate(part.id);
                }
              }}
            >
              {zoneShapeElements(part.id)}
            </g>
          ))}
        </svg>
      </div>
      {children}
    </div>
  );
}

export default memo(HitStage);
