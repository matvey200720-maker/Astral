/*
 * Кадр животного: куда ставить камеру, чтобы зверь стоял в середине и был «в меру» — не мелким и не во весь кадр (замечание
 * владельца 06.11.2026). Считается только по телу: метка, свечение и всё, что над животным, камеру не двигают — иначе метка на
 * длинной палочке отодвигала камеру, а олень съёживался до точки внизу кадра.
 *
 * Камера смотрит по умолчанию (`VIEW_YAW`, `VIEW_PITCH`). Точки тела проецируются на кадр, расстояние берётся по самой тесной
 * стороне: самая дальняя от центра точка занимает `BODY_FILL` половины кадра, а середина силуэта ставится в середину кадра
 * (перспектива делает ближний конец тела крупнее дальнего, и середина габарита уходит от середины силуэта). Поэтому кабан,
 * дельфин (длинный и низкий) и кит (огромный) занимают в кадре одну и ту же долю, а не «как получится» по диагонали шара, как было.
 *
 * Точки — настоящие вершины сеток тела (`points`: плоский массив x, y, z в осях сцены) или, когда сеток ещё нет, восемь углов
 * габаритной коробки (`min`, `max`). Коробка щедрее силуэта (углы пусты), поэтому по ней животное выходило мельче и выше центра.
 * Чистая арифметика без three.js — проверяется тестом без видеокарты.
 */

export const VIEW_FOV = 30;
export const VIEW_YAW = -0.7;
export const VIEW_PITCH = 0.18;
/* Какую долю половины кадра по тесной стороне занимает самая дальняя точка тела: зверь заметный, но с воздухом вокруг. */
export const BODY_FILL = 0.66;

/** Точки тела: `{ points }` — плоский массив координат, иначе углы коробки `{ min, max }`. */
function* cloud(shape) {
  if (shape.points && shape.points.length >= 3) {
    const points = shape.points;
    for (let index = 0; index + 2 < points.length; index += 3) yield [points[index], points[index + 1], points[index + 2]];
    return;
  }
  for (const x of [shape.min[0], shape.max[0]])
    for (const y of [shape.min[1], shape.max[1]]) for (const z of [shape.min[2], shape.max[2]]) yield [x, y, z];
}

/* Середина габарита всех точек — отсюда начинается поиск центра кадра и вокруг него крутится камера. */
function extent(shape) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const point of cloud(shape))
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  return { low, high };
}

/**
 * Камера для тела: `target` — центр кадра, `distance` — расстояние от камеры до него. `shape` — `{ min, max }` или `{ points }`
 * в осях glTF (Y вверх); `aspect` — ширина кадра к высоте.
 */
export function fitBodyView(shape, { aspect = 1.6, yaw = VIEW_YAW, pitch = VIEW_PITCH, fov = VIEW_FOV, fill = BODY_FILL } = {}) {
  const { low, high } = extent(shape);
  const target = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  const basis = viewBasis(yaw, pitch);
  const distanceFor = () => {
    let distance = 0.3;
    for (const point of cloud(shape)) {
      const { x, y, depth } = toView(minus(point, target), basis);
      /* |x| / (distance + depth) ≤ tanH·fill — глубина точки прибавляется к расстоянию до центра. */
      distance = Math.max(distance, Math.abs(x) / (tanH * fill) - depth, Math.abs(y) / (tanV * fill) - depth);
    }
    return distance;
  };
  let distance = distanceFor();
  /* Середина силуэта сдвигается в середину кадра вдоль осей кадра, расстояние пересчитывается: четыре шага — с запасом. */
  for (let step = 0; step < 4; step += 1) {
    const spread = bodySpread(shape, { target, distance }, { aspect, yaw, pitch, fov });
    for (let axis = 0; axis < 3; axis += 1)
      target[axis] += spread.centreX * tanH * distance * basis.right[axis] + spread.centreY * tanV * distance * basis.up[axis];
    distance = distanceFor();
  }
  return { target, distance };
}

/**
 * Какую долю половины кадра по горизонтали и по вертикали занимает тело при этой камере и где лежит его середина:
 * `{ x, y, centreX, centreY }` (доли от половины кадра; середина — среднее крайних точек). Нужна тесту и разбору кадра.
 */
export function bodySpread(shape, view, { aspect = 1.6, yaw = VIEW_YAW, pitch = VIEW_PITCH, fov = VIEW_FOV } = {}) {
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  const basis = viewBasis(yaw, pitch);
  const lows = [Infinity, Infinity];
  const highs = [-Infinity, -Infinity];
  for (const point of cloud(shape)) {
    const { x, y, depth } = toView(minus(point, view.target), basis);
    const screenX = x / ((view.distance + depth) * tanH);
    const screenY = y / ((view.distance + depth) * tanV);
    lows[0] = Math.min(lows[0], screenX);
    highs[0] = Math.max(highs[0], screenX);
    lows[1] = Math.min(lows[1], screenY);
    highs[1] = Math.max(highs[1], screenY);
  }
  return {
    x: Math.max(Math.abs(lows[0]), Math.abs(highs[0])),
    y: Math.max(Math.abs(lows[1]), Math.abs(highs[1])),
    centreX: (lows[0] + highs[0]) / 2,
    centreY: (lows[1] + highs[1]) / 2,
  };
}

/* Оси камеры, смотрящей на центр с орбитой (yaw, pitch): вперёд, вправо, вверх — в осях сцены. */
function viewBasis(yaw, pitch) {
  const forward = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const toView = (relative, basis) => ({ x: dot(relative, basis.right), y: dot(relative, basis.up), depth: dot(relative, basis.forward) });
