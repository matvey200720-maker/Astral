/*
 * Геометрия кадра «Метки и GPS»: откуда и куда ведут маршруты и какой кусок
 * карты их показывает.
 *
 * Точки — мировые координаты игры; старт и шесть мест — те же, на которых
 * маршруты сняты в игре 10.10.2026 (`tools/ingame-qa/runs/tz1010/gps-session.mjs`):
 * у мест подписаны спутниковые расстояния радара игры с узлами «как в игре»
 * и «напрямую». Кусок карты считается общей проекцией атласа
 * (`radarView` / `projectPoint` из `blips-scene.js`): у карты одно мнение о том,
 * где у неё север.
 */

import { DEFAULT_ATLAS, mapToWorld } from "@modovik/vector-map";
import { projectPoint, radarView } from "../../../components/desktop/workshop/blips/blips-scene.js";
import { tr } from "../../../locales/ui.js";

/* Игрок — у площади Легион, как в прогоне в игре. */
export const GPS_START = Object.freeze({ x: 195, y: -933, label: "Площадь Легион" });
/* Куда ведёт маршрут сервера в кадре: мэрия Рокфорд-Хиллз — частая точка RP. */
export const GPS_SERVER_POINT = Object.freeze({ x: -545, y: -204, label: "Мэрия" });

export const GPS_DESTINATIONS = Object.freeze([
  Object.freeze({ id: "vespucci", label: "Пляж Веспуччи", x: -1200, y: -1500, game: { stock: 1.82, direct: 1.8 } }),
  Object.freeze({ id: "airport", label: "Аэропорт", x: -1037, y: -2737, game: { stock: 2.41, direct: 2.39 } }),
  Object.freeze({ id: "zancudo", label: "Форт-Занкудо", x: -2100, y: 3000, game: { stock: 7.1, direct: 6.01 } }),
  Object.freeze({ id: "mirror", label: "Миррор-парк", x: 1100, y: -500, game: { stock: 1.52, direct: 1.51 } }),
  Object.freeze({ id: "pier", label: "Пирс Дель-Перро", x: -1600, y: -1050, game: { stock: 2.18, direct: 2.19 } }),
  Object.freeze({ id: "paleto", label: "Палето-Бэй", x: -150, y: 6300, game: { stock: 10.53, direct: 9.48 } }),
]);
export const GPS_DEFAULT_DESTINATION = "zancudo";

/* Кадр шире, чем выше, — как окно редактора. */
export const GPS_STAGE_ASPECT = 16 / 10;
export const GPS_STAGE_WIDTH = 1000;
export const GPS_STAGE_HEIGHT = GPS_STAGE_WIDTH / GPS_STAGE_ASPECT;

export function gpsDestination(id, custom = null) {
  if (id === "custom" && custom && Number.isFinite(custom.x) && Number.isFinite(custom.y))
    return Object.freeze({ id: "custom", label: tr("Своя точка"), x: custom.x, y: custom.y, game: null });
  return GPS_DESTINATIONS.find((item) => item.id === id) || GPS_DESTINATIONS.find((item) => item.id === GPS_DEFAULT_DESTINATION);
}

/**
 * Кусок карты, в который помещаются все точки с полем по краям. Метров
 * поперёк — не меньше 1200: ближе узлы дорог уже не читаются линией.
 */
export function gpsView(points, aspect = GPS_STAGE_ASPECT, atlas = DEFAULT_ATLAS) {
  const xs = points.map((point) => point.x).filter(Number.isFinite);
  const ys = points.map((point) => point.y).filter(Number.isFinite);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const metres = Math.max(1200, (maxX - minX) * 1.2, (maxY - minY) * 1.2 * aspect);
  return radarView({ centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, metres, aspect, atlas });
}

/** Мировая точка → точка кадра (0…GPS_STAGE_WIDTH × 0…GPS_STAGE_HEIGHT). */
export function gpsStagePoint(point, view) {
  const projected = projectPoint(point, view);
  return { x: projected.x * GPS_STAGE_WIDTH, y: projected.y * GPS_STAGE_HEIGHT };
}

/** Линия маршрута для SVG `points`: `[[x, y], …]` мира → «x,y x,y …» кадра. */
export function gpsPolyline(points, view) {
  return (points || [])
    .map(([x, y]) => {
      const at = gpsStagePoint({ x, y }, view);
      return `${at.x.toFixed(1)},${at.y.toFixed(1)}`;
    })
    .join(" ");
}

/** Щелчок по кадру (доли 0…1) → мировая точка. */
export function gpsPick({ x, y }, view) {
  return mapToWorld({ u: view.u + x * view.du, v: view.v + y * view.dv }, view.atlas || DEFAULT_ATLAS);
}

/** Километры для подписи: «7,1 км». */
export function gpsKilometres(metres) {
  if (!Number.isFinite(metres)) return "—";
  return `${String(Math.round(metres / 10) / 100).replace(".", ",")} км`;
}
