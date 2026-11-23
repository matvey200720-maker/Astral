// Арифметика кадра: холст с запасом, трансформ живого кадра, охват → кадр, путь перелёта.
import { reachOf, fitHeight, frameAspect, frameSize, clampView } from "../world-map-frame.js";
import { ZOOM_LIMITS, CANVAS_MARGIN, MAX_STRETCH, MIN_SPAN, NOTICEABLE_SHARE } from "./numbers.js";

// ——— зум и холст ———
export function clampZoom(zoom) {
  const { min, max } = ZOOM_LIMITS;
  return Math.min(max, Math.max(min, zoom));
}

// Место холста в пикселях окна: 150 % окна, сдвинутые на четверть назад
export function canvasBoxOf(viewport) {
  const [wide, tall] = [viewport?.width, viewport?.height];
  if (!(wide > 0 && tall > 0)) return undefined;
  return { left: -wide * 0.25, top: -tall * 0.25, width: wide * 1.5, height: tall * 1.5 };
}

// Кадр, расширенный на запас с каждой стороны
export function canvasFrameOf(frame) {
  const margin = CANVAS_MARGIN;
  const grown = (size) => size * (1 + 2 * margin);
  return {
    x: frame.x - frame.width * margin,
    y: frame.y - frame.height * margin,
    width: grown(frame.width),
    height: grown(frame.height),
  };
}

export const viewBoxOf = ({ x, y, width, height }) => [x, y, width, height].join(" ");

// Любая сторона кадра вышла за нарисованный холст
export function escapesCanvas(frame, canvas) {
  const sides = [
    [frame.x, canvas.x],
    [frame.y, canvas.y],
  ];
  const far = [
    [frame.x + frame.width, canvas.x + canvas.width],
    [frame.y + frame.height, canvas.y + canvas.height],
  ];
  return sides.some(([inner, outer]) => inner < outer) || far.some(([inner, outer]) => inner > outer);
}

// Холст растянут слишком сильно в любую сторону
export const stretchedBeyond = (ratio) => ratio > MAX_STRETCH || ratio < 1 / MAX_STRETCH;

// CSS-трансформ нарисованного холста `drawn`, чтобы он выглядел как `target`
export function canvasTransform(drawn, target, pixelWidth) {
  const perUnit = pixelWidth / target.width;
  const [dx, dy] = [(drawn.x - target.x) * perUnit, (drawn.y - target.y) * perUnit];
  return `translate(${dx}px, ${dy}px) scale(${drawn.width / target.width})`;
}

export const nearlySameView = (a, b) =>
  a.zoom === b.zoom && [a.x - b.x, a.y - b.y].every((gap) => Math.abs(gap) < 1e-6);

// Карту можно тянуть, если кадр уже охвата хотя бы на полпиксела сцены
export function isPannable(scene, frame) {
  const reach = reachOf(scene);
  const room = [reach.width - frame.width, reach.height - frame.height];
  return room.some((left) => left >= 0.5);
}

// Экранных точек на единицу сцены (0, пока окно не измерено)
export function dotsPerUnit(win, zoom, scene) {
  if (!(win.height > 0)) return 0;
  return (win.height * zoom) / fitHeight(scene, win);
}

export const centerOfFrame = ({ x, y, width, height }) => [x + width / 2, y + height / 2, width];

// ——— охват объекта ———

// Левый верхний и правый нижний углы охвата (мир) в сцене
const cornersOf = (bounds, projector) => ({
  near: projector.point({ x: bounds.minX, y: bounds.maxY }),
  far: projector.point({ x: bounds.maxX, y: bounds.minY }),
});

// Кадр, который охватывает `bounds` с полем `margin`
export function viewAroundBounds(bounds, margin, { projector, scene, win }) {
  const { near, far } = cornersOf(bounds, projector);
  const side = (gap) => Math.max(MIN_SPAN, Math.abs(gap)) * margin;
  const [wide, tall] = [side(far.x - near.x), side(far.y - near.y)];
  const aspect = frameAspect(scene, win);
  const zoom = clampZoom(fitHeight(scene, win) / Math.max(tall, wide / aspect));
  const size = frameSize(zoom, scene, win);
  const centre = { x: (near.x + far.x) / 2, y: (near.y + far.y) / 2 };
  const corner = { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
  return clampView({ ...corner, zoom }, scene, win);
}

// Объект уже на виду: хоть один угол в кадре и сам он заметен (не меньше четверти кадра)
export function boundsInSight(bounds, frame, projector) {
  const { near, far } = cornersOf(bounds, projector);
  const inside = ({ x, y }) =>
    x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
  const corners = [near, { x: far.x, y: near.y }, { x: near.x, y: far.y }, far];
  const share = NOTICEABLE_SHARE;
  const big = Math.abs(far.x - near.x) >= frame.width * share ||
    Math.abs(far.y - near.y) >= frame.height * share;
  return corners.some(inside) && big;
}

// Кадр на пути перелёта: `point` = [центр x, центр y, ширина]
export function viewAtPathPoint([midX, midY, span], scene, win) {
  // высота кадра - ширина пути на форму окна; зум - от неё (так числа пути не теряют знаков)
  const zoom = clampZoom(fitHeight(scene, win) / (span / frameAspect(scene, win)));
  const size = frameSize(zoom, scene, win);
  return { x: midX - size.width / 2, y: midY - size.height / 2, zoom };
}
