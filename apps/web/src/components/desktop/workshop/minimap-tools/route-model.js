import { useMemo } from "react";
import { fieldAligned, fieldFrame } from "../blips/blips-scene.js";
import { markerIconCanvas } from "../../../../features/workshop/gps-editor/gps-icons.js";
import { GPS_START, gpsPolyline, gpsStagePoint, gpsView } from "../../../../features/workshop/gps-editor/gps-scene.js";
import { STAGED_END, STAGED_ROUTES, STAGED_START, stagedPolyline } from "../../../../features/workshop/gps-editor/gps-staged.js";

/*
 * Картинка маршрута для инструмента «Маршрут» мини-карты (ТЗ 22.10.2026): два готовых варианта — «Как в игре» и
 * «Улучшенный», — а не карта, по которой надо переставлять метку.
 *
 * Откуда картинка:
 *  • `game` — игра под рукой: настоящие плитки карты и пути по узлам дорог игрока (`useMinimapGps`). Читаются
 *    только когда инструмент взят; пока дороги не прочитаны, на экране схема;
 *  • `staged` — игры нет, дорог нет или карта не та: тёмная схема Astral с двумя нарисованными путями
 *    (`gps-staged.js`). Подпись кадра прямо называет её схемой, а не кадром из игры.
 *
 * Модель одна и для большого кадра, и для маленьких карточек выбора: оба рисуют то же самое в кадре 1000 × 625.
 */

/**
 * Что нарисовать: подложка (плитки игры или схема), оба пути строкой `points` и значки в единицах кадра. Место
 * назначения одно — Форт-Занкудо: там улучшенный путь короче всего (7,10 → 6,01 км, снято в игре 10.10.2026).
 */
export function routeModel(scene) {
  const { field, routes, destination, graphState } = scene;
  const stock = routes?.stock;
  const direct = routes?.direct;
  if (fieldAligned(field) && stock?.points?.length > 1 && direct?.points?.length > 1) {
    const world = (list) => list.map(([x, y]) => ({ x, y }));
    /* Кадр охватывает оба пути, а не выбранный: картинки вариантов должны смотреть на один и тот же кусок карты. */
    const view = gpsView([GPS_START, destination, ...world(stock.points), ...world(direct.points)]);
    return {
      source: "game",
      state: "ready",
      field,
      frame: fieldFrame(view),
      stock: gpsPolyline(stock.points, view),
      direct: gpsPolyline(direct.points, view),
      start: gpsStagePoint(GPS_START, view),
      end: gpsStagePoint(destination, view),
      distances: { stock: stock.distance, direct: direct.distance },
      destination,
    };
  }
  const known = destination?.game;
  return {
    source: "staged",
    state: graphState === "loading" ? "loading" : "missing",
    field: null,
    frame: null,
    stock: stagedPolyline(STAGED_ROUTES.stock),
    direct: stagedPolyline(STAGED_ROUTES.direct),
    start: STAGED_START,
    end: STAGED_END,
    /* Длины, снятые в игре 10.10.2026, — они же на подписи схемы. */
    distances: known ? { stock: known.stock * 1000, direct: known.direct * 1000 } : null,
    destination,
  };
}

/** Модель, пока не менялись плитки, дороги и точка назначения. */
export function useRouteModel(scene) {
  const { field, routes, destination, graphState } = scene;
  return useMemo(
    () => routeModel({ field, routes, destination, graphState }),
    [field, routes, destination, graphState],
  );
}

/** Значок метки картинкой для кадра: цвет и картинка из работы, как их нарисует игра. */
export function useMarkerIcon(gps, scene) {
  const { stockImage, picture } = scene;
  return useMemo(() => {
    const canvas = markerIconCanvas({ icon: gps.marker.icon, color: gps.marker.color, stockImage, picture, size: 64 });
    try {
      return canvas ? canvas.toDataURL("image/png") : "";
    } catch {
      return "";
    }
  }, [gps.marker.icon, gps.marker.color, stockImage, picture]);
}
