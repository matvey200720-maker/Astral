/*
 * Ракурсы «Баннеров на зданиях» (задача 7 ТЗ 18.10.2026): готовые виды на
 * здание и на каждое полотно. Чистая арифметика, без React и three: кадр
 * берёт из неё рамку (`ModelStage frame`), тест проверяет дальность и угол.
 *
 * Камера орбиты общая на мастерскую (`stage-camera.js`): глаз стоит на
 * расстоянии `радиус / sin(угол/2) × 0,92 × zoom` от точки, радиус — полурасстояние
 * по диагонали рамки сцены. Поэтому, чтобы встать на нужное число метров, берут
 * `zoom` из метров (`zoomForDistance`).
 */

import { bannerPlace, bannerSite } from "@modovik/climb-contract/recolor/banner-sites";
import { focusFrame } from "../model-stage/focus-frame.js";

/* Угол объектива орбиты — тот же, что у `orbit-stage.js`. */
export const BANNER_FOV = 34;
const HALF = (BANNER_FOV * Math.PI) / 360;
const ORBIT_FACTOR = 0.92 / Math.sin(HALF);
/* Пределы колеса: вплотную к полотну и со стороны на весь кусок города. Дальше 1,6 радиуса сцены кусок — точка в чёрной пустоте, и край виден целиком (31.10.2026). */
export const BANNER_ZOOM_RANGE = Object.freeze([0.02, 1.6]);

/**
 * Подъём тёмного листа: металл и бетон с почти чёрным цветом (Mile High: плиты `#110f0f`) в игре
 * светятся отражением неба, а в кадре без отражений выходят чёрными дырами. Возвращает множитель
 * цвета листа (1 — не трогать): средний цвет подтягивается до тёмно-серого, но не более чем втрое.
 */
export function darkLift(colour, { floor = 0.1, aim = 0.2, limit = 3 } = {}) {
  const hex = String(colour || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return 1;
  const luma = (parseInt(hex.slice(0, 2), 16) * 0.3 + parseInt(hex.slice(2, 4), 16) * 0.59 + parseInt(hex.slice(4, 6), 16) * 0.11) / 255;
  return luma >= floor ? 1 : Math.min(limit, aim / Math.max(luma, 0.01));
}

/** Готовые ракурсы на место: порядок кнопок. */
export const SITE_ANGLES = Object.freeze(["all", "street", "top"]);

const clampZoom = (zoom) => Math.min(BANNER_ZOOM_RANGE[1], Math.max(BANNER_ZOOM_RANGE[0], zoom));

/** Радиус орбиты кадра для рамки сцены — как его считает кадр (`orbit-stage.js`, `setFrame`). */
export function frameRadius(bounds) {
  const extent = [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]);
  return Math.max(1.2, Math.hypot(...extent) / 2);
}

/** Куда смотрит камера, если встать перед стеной с нормалью `normal` (горизонтальной): та же формула, что у «Мегамолла». */
export const yawOf = (normal) => Math.atan2(normal[0], -normal[1]);

/** `zoom` камеры, при котором глаз стоит в `distance` метрах от точки орбиты. */
export const zoomForDistance = (distance, radius) => clampZoom(distance / (radius * ORBIT_FACTOR));

/** Глаз в метрах от точки орбиты при `zoom` (обратное к `zoomForDistance`). */
export const distanceForZoom = (zoom, radius) => zoom * radius * ORBIT_FACTOR;

/**
 * Метров до полотна, чтобы оно уместилось в кадре с полями: по высоте — угол
 * объектива, по ширине — тот же угол, умноженный на пропорцию кадра.
 */
export function fitDistance([width, height], { aspect = 1.5, margin = 1.2 } = {}) {
  const byHeight = (height * margin) / (2 * Math.tan(HALF));
  const byWidth = (width * margin) / (2 * Math.tan(HALF) * aspect);
  return Math.max(6, byHeight, byWidth);
}

/**
 * Взгляд на полотно — общий фокус кадра (`model-stage/focus-frame.js`, владелец 01.11.2026: «камера сразу на элемент, метра четыре»):
 * точка орбиты — его середина, глаз прямо перед ним по нормали; небольшое полотно — в четырёх метрах, огромное — целиком в кадре.
 * `{ centre, view, focus }`: кадр по `focus` ещё проверит, не закрыто ли полотно, и подойдёт ближе или выше.
 */
export function bannerShot(boardId, bounds) {
  const place = bannerPlace(boardId);
  if (!place) return null;
  return focusFrame({ point: place.point, normal: place.normal, size: place.size }, bounds, { fov: BANNER_FOV });
}

/**
 * Середина и охват места: `{ centre, extent, lead }` (метры; `lead` — главное полотно). Если опись знает здание
 * (`site.focus`: сфера моделей полотен), берётся оно — «Здание целиком» показывает дом, а не одни полотна;
 * иначе — середина и охват самих полотен.
 */
export function siteCluster(siteId) {
  const site = bannerSite(siteId);
  const places = (site?.boards || []).map((id) => ({ id, ...bannerPlace(id) })).filter((place) => place.point);
  if (!places.length) return null;
  const centre = [0, 1, 2].map((axis) => places.reduce((sum, place) => sum + place.point[axis], 0) / places.length);
  const extent = Math.max(...places.map((place) => Math.hypot(place.point[0] - centre[0], place.point[1] - centre[1], place.point[2] - centre[2]) + Math.max(...place.size) / 2));
  const focus = site.focus;
  if (focus?.p?.every(Number.isFinite) && Number.isFinite(focus.radius)) return { centre: focus.p, extent: Math.max(extent, focus.radius), lead: places[0] };
  return { centre, extent, lead: places[0] };
}

/* Глаз «С улицы» — на стольких метрах над землёй (м). */
export const STREET_EYE = 2.5;

/**
 * Наклон камеры «С улицы»: глаз стоит на `STREET_EYE` м над землёй у здания (`site.ground` — высота улицы в осях сцены, из описи места), а не на
 * прежних −0,12 рад от середины здания: у сцены с настоящей землёй такой глаз уходил под плиту и снизу было видно чёрную пустоту (31.10.2026).
 * Глаз выше середины здания не бывает — смотрим вверх (не круче −0,6 рад).
 */
export function streetPitch(ground, centreZ, distance) {
  if (!Number.isFinite(ground) || !Number.isFinite(centreZ) || !(distance > 0)) return -0.12;
  const rise = Math.max(-1, Math.min(1, (ground + STREET_EYE - centreZ) / distance));
  return Math.min(-0.02, Math.max(-0.6, Math.asin(rise)));
}

/**
 * Готовый ракурс на место: `all` — здание целиком, чуть сверху и сбоку;
 * `street` — снизу, как с тротуара (глаз над землёй, полотна вверх над головой); `top` — сверху
 * на всё здание. Точка орбиты — середина полотен места.
 */
export function siteShot(siteId, angle, bounds) {
  const cluster = siteCluster(siteId);
  if (!cluster) return null;
  const radius = frameRadius(bounds);
  const reach = Math.min(160, Math.max(34, cluster.extent));
  const distance = (reach * 1.15) / Math.tan(HALF);
  const yaw = yawOf(cluster.lead.normal);
  const streetDistance = distance * 0.8;
  const shot = {
    all: { yaw: yaw + 0.5, pitch: 0.28, zoom: zoomForDistance(distance, radius) },
    street: { yaw: yaw - 0.34, pitch: streetPitch(bannerSite(siteId)?.ground, cluster.centre[2], streetDistance), zoom: zoomForDistance(streetDistance, radius) },
    top: { yaw: yaw + 0.2, pitch: 1.08, zoom: zoomForDistance(distance * 1.05, radius) },
  }[angle];
  if (!shot) return null;
  return { centre: cluster.centre, view: shot };
}
