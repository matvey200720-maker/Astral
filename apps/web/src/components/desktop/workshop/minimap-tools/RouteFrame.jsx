import { minimapGpsLine } from "@modovik/minimap-contract/gps-marker";
import { GPS_STAGE_HEIGHT, GPS_STAGE_WIDTH } from "../../../../features/workshop/gps-editor/gps-scene.js";
import {
  STAGED_LAKE,
  STAGED_NO_ENTRY,
  STAGED_PARKS,
  STAGED_SEA,
  stagedRoads,
} from "../../../../features/workshop/gps-editor/gps-staged.js";

/*
 * Картинка маршрута: подложка, два пути и значки (`route-model.js`). Один и тот же рисунок стоит и большим кадром
 * инструмента «Маршрут», и маленькой карточкой выбора «Как в игре» / «Улучшенный» (`thumb`).
 *
 * Линия, метка и её значок — из работы: цвет, толщина, узор и прозрачность те же, что уйдут в игру. У карточки в
 * том же кадре та же линия, только меньше, — поэтому человек видит, как его линия ляжет на оба варианта.
 */

/* Значок метки в кадре при «×1» — как штатные 16 точек на экране 1080p против куска карты в тысячу точек шириной. */
const ICON_SIZE = 46;
/* Линия маршрута при «×1» — в той же мере, что значок. */
const LINE_WIDTH = 10;

/** Толщины и цвета дорог схемы; тёмная тема одна. */
const ROAD = Object.freeze({
  local: { stroke: "#2b333e", width: 3 },
  avenue: { stroke: "#3a4350", width: 6 },
  highway: { stroke: "#566070", width: 12 },
});

/* Подложка схемы: суша, море, озеро, парки и улицы. Без игры это весь «кадр». */
function StagedBackdrop() {
  return (
    <g className="gps-staged" aria-hidden="true">
      <rect width={GPS_STAGE_WIDTH} height={GPS_STAGE_HEIGHT} fill="#131921" />
      <path d={STAGED_SEA} fill="#0c2233" />
      <ellipse cx={STAGED_LAKE.cx} cy={STAGED_LAKE.cy} rx={STAGED_LAKE.rx} ry={STAGED_LAKE.ry} fill="#0c2233" />
      {STAGED_PARKS.map((park) => (
        <rect key={`${park.x}:${park.y}`} x={park.x} y={park.y} width={park.w} height={park.h} rx="8" fill="#15251d" />
      ))}
      {stagedRoads().map((road, index) => (
        <path
          key={index}
          d={road.d}
          fill="none"
          stroke={ROAD[road.tone].stroke}
          strokeWidth={ROAD[road.tone].width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

/* «Въезд запрещён»: улица, которую штатный GPS обходит и которую улучшенный маршрут не боится. */
function NoEntry() {
  return (
    <g className="gps-staged-no-entry" aria-hidden="true">
      <circle cx={STAGED_NO_ENTRY.x} cy={STAGED_NO_ENTRY.y} r="15" fill="#e8202a" stroke="#0b1018" strokeWidth="3" />
      <rect x={STAGED_NO_ENTRY.x - 9} y={STAGED_NO_ENTRY.y - 3} width="18" height="6" rx="1.5" fill="#ffffff" />
    </g>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<import("./route-model.js").routeModel>} props.model
 * @param {"stock"|"direct"} props.variant какой путь — основной
 * @param {object} props.gps `config.gps`
 * @param {string} props.icon значок метки картинкой (`useMarkerIcon`)
 * @param {boolean} [props.thumb] карточка выбора: без ролей и классов, по которым кадр ищут
 * @param {string} [props.label] имя кадра для читалки экрана (у карточки не нужно)
 */
export default function RouteFrame({ model, variant, gps, icon, thumb = false, label = "" }) {
  const line = minimapGpsLine(gps);
  const lineWidth = LINE_WIDTH * line.width;
  const dashes = line.pattern ? line.pattern.map((value) => value * lineWidth).join(" ") : undefined;
  const iconSize = ICON_SIZE * gps.marker.size;
  const { start, end } = model;
  const main = variant === "direct" ? model.direct : model.stock;
  /* У улучшенного штатный путь остаётся белым пунктиром: видно, чем он короче. */
  const comparison = variant === "direct" ? model.stock : null;

  return (
    <div className={thumb ? "gps-thumb" : "gps-map"} data-gps-destination={model.destination?.id} data-gps-source={model.source}>
      {model.field && <img className="gps-field" src={model.field.url} alt="" draggable={false} style={model.frame} />}
      <svg
        className="gps-overlay"
        viewBox={`0 0 ${GPS_STAGE_WIDTH} ${GPS_STAGE_HEIGHT}`}
        preserveAspectRatio="none"
        role={thumb ? undefined : "img"}
        aria-label={thumb ? undefined : label}
        aria-hidden={thumb || undefined}
        data-gps-accuracy={variant}
      >
        {!model.field && <StagedBackdrop />}
        {!model.field && <NoEntry />}
        {comparison && (
          <polyline
            className={thumb ? "gps-route-stock-thumb" : "gps-route-stock"}
            points={comparison}
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.6"
            strokeWidth="4"
            strokeDasharray="10 8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <polyline
          className={thumb ? "gps-route-thumb" : "gps-route-marker"}
          points={main}
          fill="none"
          stroke={line.colour || gps.marker.color}
          strokeOpacity={line.opacity}
          strokeWidth={lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashes}
          data-line-style={line.style}
        />
        <g className={thumb ? undefined : "mmc-gps-marker"} opacity={gps.marker.opacity} data-size={gps.marker.size}>
          {icon ? (
            <image href={icon} x={end.x - iconSize / 2} y={end.y - iconSize / 2} width={iconSize} height={iconSize} />
          ) : (
            <circle cx={end.x} cy={end.y} r={iconSize / 3} fill={gps.marker.color} stroke="#000000" strokeWidth="3" />
          )}
        </g>
        <path
          d={`M ${start.x} ${start.y - 16} L ${start.x + 11} ${start.y + 12} L ${start.x} ${start.y + 6} L ${start.x - 11} ${start.y + 12} Z`}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
