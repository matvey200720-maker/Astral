// Арифметика кадра: где стоит окно относительно карты игры.
// Кадр приходит от сцены: { x, y, width, height, pixels: { width } } в единицах сцены.
import { mapToWorld, atlasSize } from "@modovik/vector-map";

// Из единиц сцены в мир: доля по каждой оси, затем карта атласа
const worldOf = (size, atlas) => (sceneX, sceneY) =>
  mapToWorld({ u: sceneX / size.width, v: sceneY / size.height }, atlas);

const sceneKnown = (size) => !!size?.width && !!size?.height;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Середина кадра в мировых координатах или null, если кадра нет
export function frameCentre(frame, size, atlas) {
  if (!frame || !sceneKnown(size)) return null;
  const { x, y, width, height } = frame;
  return worldOf(size, atlas)(x + width / 2, y + height / 2);
}

// Границы кадра в мировых единицах (по двум углам) или null, если считать нечего
export function frameBounds(frame, size, atlas) {
  if (!frame?.width || !sceneKnown(size)) return null;
  const toWorld = worldOf(size, atlas);
  const corners = [toWorld(frame.x, frame.y), toWorld(frame.x + frame.width, frame.y + frame.height)];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Шаг сдвига стрелками в единицах мира: по пикселю кадра, а без кадра 10
export function nudgeStep(frame, size, atlas, fast) {
  const pixels = frame?.pixels?.width;
  let step = 10;
  if (frame && size?.width && pixels) {
    const sceneUnitsPerPixel = frame.width / pixels;
    const worldPerSceneUnit = atlasSize(atlas).width / size.width;
    step = sceneUnitsPerPixel * worldPerSceneUnit;
  }
  return fast ? step * 10 : step;
}

// Куда и какой ширины класть картинку: по кадру, а без него — в середину атласа
export function pictureSpot(frame, size, atlas) {
  const centre = frameCentre(frame, size, atlas);
  if (centre === null) return { centre: mapToWorld({ u: 0.5, v: 0.5 }, atlas), width: 2200 };
  const shareOfScene = frame.width / size.width;
  const visible = shareOfScene * atlasSize(atlas).width;
  return { centre, width: Math.round(clamp(visible * 0.4, 400, 6000)) };
}

// Куда сдвигает стрелка: множители по осям (ось y мира смотрит вверх)
const ARROWS = new Map([
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, 1]],
  ["ArrowDown", [0, -1]],
]);

export function arrowDelta(key, step) {
  const aim = ARROWS.get(key);
  return aim ? { x: aim[0] && aim[0] * step, y: aim[1] && aim[1] * step } : null;
}

// Зум сцены — восьмушки; масштаб подписей окна — шаги 1/32 степени двойки
export const snap = (value, steps) => Math.round(value * steps) / steps;

export const quantizeZoom = (zoom) => snap(zoom, 8);
export const quantizeScale = (pixels) => 2 ** snap(Math.log2(pixels), 32);
