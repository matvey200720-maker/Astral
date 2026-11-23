/*
 * Слой HUD поверх кадра игры.
 *
 * Рисуется SVG в координатах выбранного экрана: viewBox — это и есть
 * разрешение, под которое настраивают, поэтому «восемь пикселей полосы на
 * 1080p» здесь ровно восемь единиц, а не «восемь чего-то от ширины окна».
 * Общее окно вписывает слой в кадр без искажения и отдаёт один масштаб на обе
 * оси — на этом держится вся точность, и своей вёрстки слою не нужно.
 *
 * ПОЧЕМУ ЭТО НЕ ХОЛСТ
 *
 * Холст пришлось бы перерисовывать по кадрам и мерить руками — а мерить
 * родителя изнутри его же ребёнка мы уже пробовали: наблюдатель размера
 * раздувал собственного родителя до пятнадцати тысяч пикселей. Здесь нет ни
 * наблюдателя, ни кадрового цикла, ни текстур: React перерисовывает слой
 * ровно тогда, когда меняется проект или показ, а между правками не
 * происходит ничего. Ни одного `requestAnimationFrame` в этом файле нет и
 * быть не должно — это стережёт тест.
 */

import { memo, useId, useRef, useState } from "react";
import { HUD_WANTED_GAP, HUD_WANTED_STARS } from "./hud-model.js";
import { hudDragOffsets, hudDragScale } from "./hud-layout.js";
import { tr, useTr } from "../../../../locales/ui.js";

/** Разряды денег через тонкий пробел — не через локаль: она в тестах чужая. */
const money = (value) =>
  `$${String(Math.max(0, Math.round(Number(value) || 0))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  )}`;

/** Пятиконечная звезда в квадрате `size`. */
function starPoints(x, y, size) {
  const radius = size / 2;
  const centreX = x + radius;
  const centreY = y + radius;
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const length = index % 2 === 0 ? radius : radius * 0.44;
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    points.push(
      `${(centreX + Math.cos(angle) * length).toFixed(2)},${(
        centreY +
        Math.sin(angle) * length
      ).toFixed(2)}`,
    );
  }
  return points.join(" ");
}

function Minimap({ rect, widget, field }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `hud-map-${raw}`;
  const radius = Math.min(rect.width, rect.height) * 0.06;
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={radius}
          />
        </clipPath>
      </defs>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={radius}
        fill="#0b1016"
      />
      {field ? (
        <image
          href={field}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clip})`}
        />
      ) : null}
      {/* Метка игрока: она же показывает, что карта смотрит по движению. */}
      <polygon
        points={`${rect.x + rect.width / 2},${rect.y + rect.height * 0.42} ${
          rect.x + rect.width / 2 - rect.height * 0.07
        },${rect.y + rect.height * 0.58} ${rect.x + rect.width / 2 + rect.height * 0.07},${
          rect.y + rect.height * 0.58
        }`}
        fill="#ffffff"
        opacity="0.92"
      />
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={radius}
        fill="none"
        stroke={widget.color}
        strokeWidth={Math.max(1, rect.height * 0.012)}
      />
    </>
  );
}

/** Полоса: тёмная дорожка и заливка по текущему значению. */
function Bar({ rect, widget, value }) {
  const filled = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
  return (
    <>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#000000"
        opacity="0.45"
      />
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width * filled}
        height={rect.height}
        fill={widget.color}
      />
    </>
  );
}

function Wanted({ rect, widget, level }) {
  const step =
    rect.width / (HUD_WANTED_STARS + (HUD_WANTED_STARS - 1) * HUD_WANTED_GAP);
  const lit = Math.max(0, Math.min(HUD_WANTED_STARS, Math.round(level)));
  return Array.from({ length: HUD_WANTED_STARS }, (_, index) => (
    <polygon
      key={index}
      points={starPoints(
        rect.x + index * step * (1 + HUD_WANTED_GAP),
        rect.y,
        rect.height,
      )}
      fill={index < lit ? widget.color : "#000000"}
      opacity={index < lit ? 1 : 0.38}
      stroke={index < lit ? "none" : widget.color}
      strokeWidth={index < lit ? 0 : Math.max(1, rect.height * 0.05)}
      strokeOpacity="0.45"
    />
  ));
}

/* Текст прижимается к тому же краю, к которому прижат сам элемент: счёт в
   правом углу растёт влево, а не наползает на край экрана. */
const textAnchor = (anchor) =>
  anchor.endsWith("right")
    ? "end"
    : anchor.endsWith("left")
      ? "start"
      : "middle";
const textX = (rect) =>
  rect.anchor.endsWith("right")
    ? rect.x + rect.width
    : rect.anchor.endsWith("left")
      ? rect.x
      : rect.x + rect.width / 2;

function Money({ rect, widget, amount }) {
  return (
    <text
      x={textX(rect)}
      y={rect.y + rect.height * 0.86}
      textAnchor={textAnchor(rect.anchor)}
      fill={widget.color}
      style={{
        fontFamily: "var(--astral-font)",
        fontSize: `${rect.height}px`,
        fontWeight: 700,
        letterSpacing: `${rect.height * 0.01}px`,
      }}
    >
      {money(amount)}
    </text>
  );
}

/** Подсказка оружия: плашка, силуэт ствола и патроны. */
function Weapon({ rect, widget, ammo }) {
  const pad = rect.height * 0.18;
  const iconWidth = rect.height * 0.9;
  const iconX = rect.x + pad;
  const iconY = rect.y + rect.height * 0.3;
  return (
    <>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={rect.height * 0.16}
        fill={widget.color}
      />
      <path
        d={`M ${iconX} ${iconY}
            h ${iconWidth * 0.78}
            v ${rect.height * 0.16}
            h ${-iconWidth * 0.2}
            l ${-iconWidth * 0.14} ${rect.height * 0.26}
            h ${-iconWidth * 0.22}
            l ${iconWidth * 0.1} ${-rect.height * 0.26}
            h ${-iconWidth * 0.32}
            z`}
        fill="#ffffff"
        opacity="0.9"
      />
      <text
        x={rect.x + rect.width - pad}
        y={rect.y + rect.height * 0.68}
        textAnchor="end"
        fill="#ffffff"
        style={{
          fontFamily: "var(--astral-font)",
          fontSize: `${rect.height * 0.44}px`,
          fontWeight: 600,
        }}
      >
        {`${ammo?.[0] ?? 0} / ${ammo?.[1] ?? 0}`}
      </text>
    </>
  );
}

const PARTS = {
  minimap: (props) => <Minimap {...props} />,
  health: ({ rect, widget, demo }) => (
    <Bar rect={rect} widget={widget} value={demo.health} />
  ),
  armor: ({ rect, widget, demo }) => (
    <Bar rect={rect} widget={widget} value={demo.armor} />
  ),
  wanted: ({ rect, widget, demo }) => (
    <Wanted rect={rect} widget={widget} level={demo.wanted} />
  ),
  money: ({ rect, widget, demo }) => (
    <Money rect={rect} widget={widget} amount={demo.money} />
  ),
  weapon: ({ rect, widget, demo }) => (
    <Weapon rect={rect} widget={widget} ammo={demo.ammo} />
  ),
};

/**
 * @param {object} props
 * @param {{width:number,height:number}} props.design Разрешение, под которое
 *   настраивают: оно же система координат слоя.
 * @param {object} props.project Проект целиком.
 * @param {object} props.rects Прямоугольники из `hudWidgetRects`.
 * @param {object} props.safe Безопасная зона — в её высоте живут отступы.
 * @param {object} props.demo Что показать в элементах: здоровье, розыск, счёт.
 * @param {string} props.selected Выделенный элемент.
 * @param {Function} props.onSelect Выбор элемента прямо на кадре.
 * @param {Function} props.onMove Протяжка элемента: `(id, {offsetX, offsetY})`.
 *   Без него слой остаётся кликабельным просмотром — как в галерее.
 * @param {string} props.field Подложка мини-карты, если она доехала.
 */
function HudLayer({
  design,
  project,
  rects,
  safe = null,
  demo,
  selected = "",
  onSelect = null,
  onMove = null,
  field = "",
}) {
  useTr();
  const svgRef = useRef(null);
  /*
   * Жест живёт в ссылке, а не в состоянии: каждое движение и так
   * перерисовывает слой через проект, и второй setState на то же движение
   * удваивал бы работу. Состоянием остаётся только «тянем ли» — от него
   * зависит курсор, то есть картинка.
   */
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const beginDrag = (event, id) => {
    onSelect?.(id);
    /* Не-левая кнопка протяжку не начинает. Указатель без номера кнопки —
       синтетика тестовой среды — считается левой, а не чужой. */
    if (!onMove || !safe || (event.button ?? 0) !== 0) return;
    const bounds = svgRef.current?.getBoundingClientRect?.();
    const scale = hudDragScale(bounds, design);
    /* Нулевая ширина — свёрнутое окно или jsdom: жеста нет, выбор остался. */
    if (!scale) return;
    const widget = project.widgets[id];
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      scale,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: widget.offsetX,
      offsetY: widget.offsetY,
    };
    setDragging(true);
    try {
      svgRef.current.setPointerCapture(event.pointerId);
    } catch {
      /* указатель уже отпущен — протяжку доведут события на самом слое */
    }
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    onMove(
      drag.id,
      hudDragOffsets(
        drag,
        {
          x: (event.clientX - drag.startX) * drag.scale,
          y: (event.clientY - drag.startY) * drag.scale,
        },
        safe.height,
      ),
    );
  };

  const endDrag = (event) => {
    if (!dragRef.current) return;
    try {
      svgRef.current?.releasePointerCapture?.(event.pointerId);
    } catch {
      /* захват уже снят браузером */
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${design.width} ${design.height}`}
      role="img"
      aria-label={tr("Предпросмотр HUD поверх кадра игры")}
      className={`hud-layer${dragging ? " is-dragging" : ""}`}
      onPointerMove={onMove ? moveDrag : undefined}
      onPointerUp={onMove ? endDrag : undefined}
      onPointerCancel={onMove ? endDrag : undefined}
    >
      {Object.entries(PARTS).map(([id, render]) => {
        const widget = project.widgets[id];
        if (!widget.visible) return null;
        const rect = rects[id];
        return (
          <g
            key={id}
            data-hud-widget={id}
            opacity={widget.opacity / 100}
            /* Нажатие и выбирает, и начинает протяжку: отдельный клик «сначала
               выбери, потом тяни» заставлял бы делать каждый перенос дважды.
               Щелчок при этом остаётся выбором сам по себе — указателя может
               не быть вовсе (клавиатурный клик, старый тест-двигатель). */
            onPointerDown={
              onSelect || onMove ? (event) => beginDrag(event, id) : undefined
            }
            onClick={onSelect ? () => onSelect(id) : undefined}
            style={
              onMove
                ? { cursor: dragging ? "grabbing" : "grab" }
                : onSelect
                  ? { cursor: "pointer" }
                  : undefined
            }
          >
            {render({ rect, widget, demo, field })}
            {/* Прозрачная накладка ловит нажатие целиком: попасть по звезде
                или по восьмипиксельной полосе иначе почти невозможно. */}
            {onSelect || onMove ? (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="transparent"
              />
            ) : null}
          </g>
        );
      })}

      {/* Выделение стоит поверх всего и не масштабируется вместе со слоем:
          на 4K рамка в два пикселя иначе превратилась бы в волосок. */}
      {selected && rects[selected] ? (
        <rect
          className="hud-layer-selection"
          x={rects[selected].x}
          y={rects[selected].y}
          width={rects[selected].width}
          height={rects[selected].height}
          fill="none"
          stroke="var(--astral-accent)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
    </svg>
  );
}

/*
 * Слой перерисовывается по изменению, а не постоянно.
 *
 * Родитель держит и историю правок, и подложку карты, и выбор кадра — и
 * перерисовывается от каждого из них. Слою из этого важны четыре вещи, и
 * `memo` отсекает остальное: движение мыши по инспектору не должно стоить
 * пересборки шести групп SVG.
 */
export default memo(HudLayer);
