/*
 * Кадр «Меток и GPS»: кусок карты из вашей игры, маршрут к метке и маршрут
 * сервера — теми цветами и тем путём, что уйдут в игру.
 *
 * Подложка — плитки большой карты из установки (`loadMinimapField`), линии —
 * узлы дорог вашей игры (`readGpsGraph` → `findGpsRoute`), значок — клетка
 * листа значков игры, покрашенная цветом метки, как красит её игра. Чего
 * под рукой нет (браузер, песочница), то кадр рисует сам и говорит об этом в
 * подписи. Щелчок по карте ставит метку в своё место.
 */

import { useMemo } from "react";
import Select from "../../../components/ui/Select.jsx";
import { StageBar } from "../../../components/ui/StageOverlay.jsx";
import { fieldAligned, fieldFrame } from "../../../components/desktop/workshop/blips/blips-scene.js";
import { markerIconCanvas } from "./gps-icons.js";
import {
  GPS_DESTINATIONS,
  GPS_SERVER_POINT,
  GPS_STAGE_HEIGHT,
  GPS_STAGE_WIDTH,
  GPS_START,
  gpsPick,
  gpsPolyline,
  gpsStagePoint,
  gpsView,
} from "./gps-scene.js";
import { tr, useTr } from "../../../locales/ui.js";

const DESTINATION_OPTIONS = Object.freeze([
  ...GPS_DESTINATIONS.map((item) => [item.id, item.label]),
  ["custom", "Своя точка — щелчок по карте"],
]);

const straight = (from, to) => [
  [from.x, from.y],
  [to.x, to.y],
];

export default function GpsStage({
  project,
  field = null,
  routes = null,
  destination,
  destinationId,
  onDestination,
  onPick,
  serverColour,
  stockImage = null,
  picture = null,
}) {
  useTr();
  const aligned = fieldAligned(field);
  const markerRoute = routes ? (project.route.accuracy === "direct" ? routes.direct : routes.stock) : null;
  const markerPoints = markerRoute?.points || straight(GPS_START, destination);
  const serverPoints = routes?.server?.points || straight(GPS_START, GPS_SERVER_POINT);
  const comparison = routes && project.route.accuracy === "direct" ? routes.stock?.points || null : null;

  const view = useMemo(() => {
    const points = [GPS_START, destination, GPS_SERVER_POINT, ...[...markerPoints, ...serverPoints].map(([x, y]) => ({ x, y }))];
    return gpsView(points);
  }, [destination, markerPoints, serverPoints]);

  const icon = useMemo(() => {
    const canvas = markerIconCanvas({ icon: project.marker.icon, color: project.marker.color, stockImage, picture, size: 64 });
    try {
      return canvas ? canvas.toDataURL("image/png") : "";
    } catch {
      return "";
    }
  }, [project.marker.icon, project.marker.color, stockImage, picture]);

  const start = gpsStagePoint(GPS_START, view);
  const end = gpsStagePoint(destination, view);
  const server = gpsStagePoint(GPS_SERVER_POINT, view);
  const iconSize = 46;

  return (
    <div className="fx-stage recolor-stage gps-stage is-studio">
      <div className={`model-stage-frame gps-frame${aligned ? "" : " is-drawn"}`}>
        <div
          className="gps-map"
          data-gps-destination={destination.id}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            onPick?.(gpsPick({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, view));
          }}
        >
        {aligned && <img className="gps-field" src={field.url} alt="" draggable={false} style={fieldFrame(view)} />}
        <svg
          className="gps-overlay"
          viewBox={`0 0 ${GPS_STAGE_WIDTH} ${GPS_STAGE_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Карта: маршрут к метке «${destination.label}» и маршрут сервера к «${GPS_SERVER_POINT.label}»`}
          data-gps-accuracy={project.route.accuracy}
        >
          {comparison && (
            <polyline className="gps-route-stock" points={gpsPolyline(comparison, view)} fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" strokeLinejoin="round" />
          )}
          <polyline points={gpsPolyline(markerPoints, view)} fill="none" stroke="#000000" strokeOpacity="0.45" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
          <polyline
            className="gps-route-marker"
            points={gpsPolyline(markerPoints, view)}
            fill="none"
            stroke={project.marker.color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={markerRoute ? undefined : "16 10"}
          />
          {/* Маршрут сервера — поверх и тоньше: где он идёт той же улицей,
              видны обе линии. */}
          <polyline points={gpsPolyline(serverPoints, view)} fill="none" stroke="#000000" strokeOpacity="0.5" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <polyline
            className="gps-route-server"
            points={gpsPolyline(serverPoints, view)}
            fill="none"
            stroke={serverColour}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={routes?.server ? undefined : "12 9"}
          />
          <circle cx={server.x} cy={server.y} r="13" fill={serverColour} stroke="#000000" strokeWidth="3" />
          {icon ? (
            <image href={icon} x={end.x - iconSize / 2} y={end.y - iconSize / 2} width={iconSize} height={iconSize} />
          ) : (
            <circle cx={end.x} cy={end.y} r="16" fill={project.marker.color} stroke="#000000" strokeWidth="3" />
          )}
          <path d={`M ${start.x} ${start.y - 16} L ${start.x + 11} ${start.y + 12} L ${start.x} ${start.y + 6} L ${start.x - 11} ${start.y + 12} Z`} fill="#ffffff" stroke="#000000" strokeWidth="3" strokeLinejoin="round" />
        </svg>
        </div>
      </div>
      <StageBar>
        <Select label={tr("Метка")} ariaLabel={tr("Куда стоит метка")} value={destinationId} options={DESTINATION_OPTIONS} onChange={onDestination} />
      </StageBar>
    </div>
  );
}
