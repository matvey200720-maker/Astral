/*
 * Камера к тату (05.11.2026, владелец: «человек выбрал или нанёс тату — камера сама плавно переезжает к этой части тела и встаёт с той стороны, где тату: перед, спина, левый или правый бок»).
 *
 * Прежний `focusPart` прыгал: камера вставала сразу, целилась в коробку всей зоны (у руки — вся рука, тату на плече терялось) и сторону брала из слова «сзади» в названии тату. Здесь расчёт без three.js:
 *  - место тату — центр вершин зоны, лежащих у его рамки во второй развёртке (`nearbyCentre`): зона у тела — своя сетка, у каждой вершины есть место в зоне `(u, v)`; точка и нормаль у рамки говорят, где тату и куда оно смотрит;
 *  - сторона — по нормали у рамки (`sideDirection`): спереди, сзади, слева, справа; для всей зоны без места (блэкворк) — по слову и по зоне, как раньше;
 *  - расстояние — по размеру рамки в зоне (`viewRadius`): маленькое тату — ближе, вся часть — как раньше;
 *  - перелёт — не прыжок, а плавный путь за `FLIGHT_SECONDS` (`flightAt`).
 */

/** Сколько секунд камера летит к части тела. */
export const FLIGHT_SECONDS = 0.7;

/** Плавность в начале и в конце: 0 → 0, 1 → 1, на середине — быстрее всего. */
export const easeInOut = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/* U зоны замкнута (часть тела обходит круг): расстояние по кругу, от 0 до 0,5. */
const wrapDistance = (a, b) => Math.abs(((((a - b) % 1) + 1.5) % 1) - 0.5);

/**
 * Центр и нормаль вершин зоны у места `at = { u, v }`: `samples` — `[{ u, v, position: [x, y, z], normal: [x, y, z] }]` (мировые). Берутся вершины не дальше `radius` от места по зоне, радиус растёт вдвое,
 * пока не найдётся хоть одна. `null` — вершин нет вовсе. Ответ — `{ centre, normal, count, radius }`, нормаль единичная (или нулевая, если вершины смотрят в разные стороны).
 */
export function nearbyCentre(samples, at, radius = 0.06) {
  if (!samples?.length || !at) return null;
  for (let reach = Math.max(0.01, radius); reach <= 0.6; reach *= 2) {
    let count = 0;
    const centre = [0, 0, 0];
    const normal = [0, 0, 0];
    for (const sample of samples) {
      if (wrapDistance(sample.u, at.u) > reach || Math.abs(sample.v - at.v) > reach) continue;
      count += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        centre[axis] += sample.position[axis];
        normal[axis] += sample.normal?.[axis] || 0;
      }
    }
    if (!count) continue;
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    return { centre: centre.map((value) => value / count), normal: length > 1e-6 ? normal.map((value) => value / length) : [0, 0, 0], count, radius: reach };
  }
  return null;
}

/**
 * Откуда смотреть камере: единичное направление от цели к камере. `normal` — нормаль поверхности у тату (мировая, `[x, y, z]`); без неё (вся зона) — по слову `side`:
 * `front`, `back`, `left`, `right` (левое и правое — у персонажа: он стоит лицом к +Z, его левая сторона — +X), `outside` — рука и нога снаружи тела (`outsideSign` — сторона по оси X).
 * Камера чуть выше цели (подъём 0,12) — тату на груди и руке читается не снизу.
 */
export function sideDirection({ side = "front", normal = null, outsideSign = 1 } = {}) {
  let x;
  let z;
  const flat = normal ? Math.hypot(normal[0], normal[2]) : 0;
  if (flat > 0.35) {
    /* Нормаль у тату лежит ближе к горизонтали: камера встаёт по ней, а не по слову. */
    x = normal[0] / flat;
    z = normal[2] / flat;
  } else if (side === "back") {
    [x, z] = [0, -1];
  } else if (side === "left") {
    [x, z] = [1, 0.25];
  } else if (side === "right") {
    [x, z] = [-1, 0.25];
  } else if (side === "outside") {
    [x, z] = [Math.sign(outsideSign) || 1, 0.55];
  } else {
    [x, z] = [0, 1];
  }
  const length = Math.hypot(x, 0.12, z);
  return [x / length, 0.12 / length, z / length];
}

/**
 * Радиус кадра вокруг цели: `zoneSize` — наибольший размер зоны (метры), `fraction` — размер рамки тату в долях зоны (0…1; нет — вся зона). Маленькое тату — ближе, но не теснее половины зоны.
 */
export function viewRadius(zoneSize, fraction = 1) {
  const share = Number.isFinite(fraction) ? Math.max(0.5, Math.min(1, fraction * 1.4)) : 1;
  return Math.max(0.05, zoneSize * 0.75 * share);
}

/** Точка пути перелёта: от `from` к `to` (числа) в момент `elapsed` из `seconds`. */
export function flightAt(from, to, elapsed, seconds = FLIGHT_SECONDS) {
  const k = easeInOut(seconds > 0 ? elapsed / seconds : 1);
  return from.map((value, index) => value + (to[index] - value) * k);
}

/** Камера как «цель, расстояние, азимут от +Z, подъём» (радианы): так её удобно вести по дуге, а не по прямой — по прямой с лица на спину камера прошла бы сквозь персонажа. */
export function cameraState(target, position) {
  const offset = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const distance = Math.hypot(offset[0], offset[1], offset[2]) || 1;
  return { target: [...target], distance, azimuth: Math.atan2(offset[0], offset[2]), elevation: Math.asin(Math.max(-1, Math.min(1, offset[1] / distance))) };
}

/** Положение камеры по её состоянию: `{ target, position }`. */
export function cameraPose({ target, distance, azimuth, elevation }) {
  const flat = Math.cos(elevation) * distance;
  return { target: [...target], position: [target[0] + flat * Math.sin(azimuth), target[1] + Math.sin(elevation) * distance, target[2] + flat * Math.cos(azimuth)] };
}

/**
 * Камера на пути от состояния `from` к `to` в момент `elapsed`: цель и расстояние плывут по прямой, азимут — короткой дугой (не дольше полуоборота, на спину — через бок), подъём — по прямой.
 */
export function cameraAt(from, to, elapsed, seconds = FLIGHT_SECONDS) {
  const k = easeInOut(seconds > 0 ? elapsed / seconds : 1);
  const turn = ((((to.azimuth - from.azimuth) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return cameraPose({
    target: from.target.map((value, index) => value + (to.target[index] - value) * k),
    distance: from.distance + (to.distance - from.distance) * k,
    azimuth: from.azimuth + turn * k,
    elevation: from.elevation + (to.elevation - from.elevation) * k,
  });
}
