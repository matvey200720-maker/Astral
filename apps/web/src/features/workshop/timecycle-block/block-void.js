/*
 * Объём кадра с куском карты: что в нём видно и докуда летит камера (задача 40 ТЗ 19.10.2026).
 *
 * Кадры «Фонарей» и «Таймцикла» стоят на куске настоящей карты из игры, а за его краем — земля и
 * небо, нарисованные шейдером неба: человек вылетал за улицу и видел плоскую бежевую пустыню.
 * Объём — прямоугольник на земле, повёрнутый вдоль улицы (рыскание оси — от севера, как у камеры),
 * с полом и потолком; его числа — метры от якоря секции в осях игры (X — восток, Y — север, Z — вверх).
 *
 *   `visible` — что показывает кадр: всё, что за боками и под полом, — чёрная пустота (стены
 *   чёрные до потолка, выше — небо), а у самого бока здания и земля гаснут к чёрному на `fade` метров,
 *   чтобы срез дома не лез в глаза. Рисует это шейдер сведения (`block-shaders.js`, `uVoid*`).
 *   `flight` — докуда летит камера: меньший прямоугольник, пол и потолок. Камера в него упирается
 *   (`flightCollide` для `collide` общей камеры), а не пролетает дальше.
 *
 * Объём — прямоугольник (`shape: "box"`) или круг (`shape: "disc"`, радиус `half[0]`: круг настоящего мира вокруг места, 11.11.2026), а то, что за его краем, — чёрная пустота
 * (`look: "black"`) или бездна (`look: "abyss"`): дымка у горизонта, что темнеет вниз, и небо над ним — не чёрный купол.
 *
 * Здесь — только числа и их перевод; рисует и двигает кадр `block-scene.js`.
 */

/* Вдоль оси (u) и поперёк неё вправо (v): рыскание `yaw` — от севера к востоку, как у камеры кадра. */
const axisOf = (yaw) => ({ sin: Math.sin(yaw), cos: Math.cos(yaw) });

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/**
 * Прямоугольник на земле: `centre` — [x, y], `yaw` — рыскание оси, `half` — [вдоль, поперёк], м; `floor` и
 * `top` — пол и потолок (Z, м), `fade` — на какой глубине у края всё гаснет к чёрному.
 */
export function makeVolume({ centre = [0, 0], yaw = 0, half = [10, 10], floor = -Infinity, top = Infinity, fade = 0, shape = "box", look = "black" } = {}) {
  return Object.freeze({
    shape: shape === "disc" ? "disc" : "box",
    look: look === "abyss" ? "abyss" : "black",
    centre: Object.freeze([finite(centre[0], 0), finite(centre[1], 0)]),
    yaw: finite(yaw, 0),
    half: Object.freeze([Math.max(0.1, finite(half[0], 10)), Math.max(0.1, finite(half[1], 10))]),
    floor: finite(floor, -Infinity),
    top: finite(top, Infinity),
    fade: Math.max(0, finite(fade, 0)),
  });
}

/** Точка (x, y) игры в осях объёма: [вдоль оси, вправо от неё], м от центра. */
export function toLocal(volume, x, y) {
  const { sin, cos } = axisOf(volume.yaw);
  const dx = x - volume.centre[0];
  const dy = y - volume.centre[1];
  return [dx * sin + dy * cos, dx * cos - dy * sin];
}

/** Из осей объёма — обратно в игру. */
export function fromLocal(volume, u, v) {
  const { sin, cos } = axisOf(volume.yaw);
  return [volume.centre[0] + u * sin + v * cos, volume.centre[1] + u * cos - v * sin];
}

/** Метры до ближайшего бока изнутри: отрицательно за краем (у круга — до его края). */
export function depthInside(volume, x, y) {
  const [u, v] = toLocal(volume, x, y);
  if (volume.shape === "disc") return volume.half[0] - Math.hypot(u, v);
  return Math.min(volume.half[0] - Math.abs(u), volume.half[1] - Math.abs(v));
}

/** Точка (x, y), прижатая внутрь прямоугольника на `inset` метров от краёв. */
export function clampInto(volume, x, y, inset = 0) {
  const [u, v] = toLocal(volume, x, y);
  if (volume.shape === "disc") {
    const reach = Math.max(0, volume.half[0] - inset);
    const length = Math.hypot(u, v);
    return length <= reach ? [x, y] : fromLocal(volume, (u / length) * reach, (v / length) * reach);
  }
  const hu = Math.max(0, volume.half[0] - inset);
  const hv = Math.max(0, volume.half[1] - inset);
  const cu = Math.min(hu, Math.max(-hu, u));
  const cv = Math.min(hv, Math.max(-hv, v));
  return cu === u && cv === v ? [x, y] : fromLocal(volume, cu, cv);
}

/**
 * Числа для шейдера сведения: `uVoidCentre`, `uVoidAxis` (sin и cos рыскания), `uVoidHalf`, `uVoidZ` (пол и
 * потолок; бесконечности — большие числа), `uVoidFade`, `uVoidDisc` (круг вместо прямоугольника) и `uVoidAbyss` (бездна вместо чёрной пустоты).
 */
export function voidUniforms(volume) {
  const { sin, cos } = axisOf(volume.yaw);
  const big = 1.0e6;
  return {
    centre: [volume.centre[0], volume.centre[1]],
    axis: [sin, cos],
    half: [volume.half[0], volume.half[1]],
    z: [Number.isFinite(volume.floor) ? volume.floor : -big, Number.isFinite(volume.top) ? volume.top : big],
    fade: volume.fade,
    disc: volume.shape === "disc" ? 1 : 0,
    abyss: volume.look === "abyss" ? 1 : 0,
  };
}

/**
 * Полёт: `collide(from, to)` для общей камеры (`stage-camera.js`, оси сцены, Y вверх: сцена (x, y, z) —
 * игра (x, −z, y)). Камера не выходит за `flight` по сторонам и не поднимается выше его потолка; нижний
 * предел — земля под камерой — держит `block-ground.js`. `inner` — функция, что считает своё первой
 * (земля): её ответ потом прижимается к объёму.
 */
export function flightCollide(flight, inner = null, inset = 0.5) {
  if (!flight) return inner;
  return (from, to) => {
    const moved = inner ? inner(from, to) : to;
    const [x, y] = clampInto(flight, moved.x, -moved.z, inset);
    const z = Math.min(moved.y, flight.top);
    if (x === moved.x && -y === moved.z && z === moved.y) return moved;
    const out = moved.clone();
    out.x = x;
    out.z = -y;
    out.y = z;
    return out;
  };
}
