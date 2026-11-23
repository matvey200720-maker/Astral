/*
 * Объёмная картинка на экране зала Majestic (rp-route, 20.11.2026, сборка arena10).
 *
 * Правило общее для любого проекта (слова владельца: «главное, чтобы в мастерской люди могли ставить как хотят, свои модельки»):
 * «Своя картинка → объём», поставленная на экран, монитор или табло (`@modovik/climb-contract/recolor/arena-screens`), НЕ заменяет
 * экран. Серверная модель экрана остаётся, а плита встаёт отдельной дописанной сущностью того же зала на месте, которое задал
 * человек. Раньше (arena3/5/6/7) сущность экрана перенаправлялась на копию-плиту: стена-экран №200033 исчезала («дырка»), а плита
 * стояла посреди зала.
 *
 * Только чистая геометрия: ни файлов, ни игры. Оси — как в типах помещения: сущность стоит в точке `position`, её сетка лежит в
 * осях модели; у дописанной сущности поворота нет, поэтому сетку поворачиваем в оси помещения здесь.
 *
 * Знак поворота. В файле типов кватернион сущности хранится обращённым (как в картах): у экрана №200033 записано (0, 0, −0,71, 0,71),
 * а на деле он повёрнут на +90° (стена длиной 14,33 м лежит по оси зала y −7,14…7,19, центр у 0,03 — зал симметричен;
 * сцена мастерской даёт тот же поворот 140,17° = 50,17° помещения + 90°; смещение владельца 7,5 м «вглубь» ставит плиту в середину зала).
 */
import { placeModelQuaternionTurn } from "@modovik/climb-contract/recolor/place-models";
import { ARENA_SCREEN_PLATE_GAP } from "@modovik/climb-contract/recolor/arena-screens";

/* Умолчание одной строкой: `false` — выключено (включается `ASTRAL_ARENA_SCREEN_PLATES=1`), `true` — включено (выключить `=0`).
   Включают, когда владелец подтвердил заходом, что экран на месте, а плита стоит где надо (arena10, 21.11.2026). */
export const ARENA_SCREEN_PLATES_DEFAULT = false;
export const screenPlatesEnabledFrom = (
  value,
  fallback = ARENA_SCREEN_PLATES_DEFAULT,
) => (value === "1" ? true : value === "0" ? false : fallback);
export const arenaScreenPlatesEnabled = () =>
  screenPlatesEnabledFrom(process.env.ASTRAL_ARENA_SCREEN_PLATES);

const TOLERANCE = 0.05;
const sum = (a, b) => a.map((value, axis) => value + b[axis]);
const minus = (a, b) => a.map((value, axis) => value - b[axis]);
const round4 = (value) => Math.round(value * 1e4) / 1e4 + 0;

/** Действующий поворот сущности по записанному в файле типов: записанный кватернион обращён. */
export const effectiveEntityRotation = (stored) => [
  -stored[0],
  -stored[1],
  -stored[2],
  stored[3],
];

/** Точка из осей модели сущности (`position`, записанный `rotation`) в оси помещения. */
export function entityToInterior({ position, rotation }, point) {
  return sum(
    position,
    placeModelQuaternionTurn(effectiveEntityRotation(rotation), point),
  );
}

export function boxCorners({ min, max }) {
  const out = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/** Все точки внутри ОДНОЙ комнаты помещения (рамки комнат в осях помещения, `interiorRoomBoxes`). */
export const insideRoom = (box, points) =>
  Boolean(box) &&
  points.every((point) =>
    point.every(
      (value, axis) =>
        value >= box.min[axis] - TOLERANCE &&
        value <= box.max[axis] + TOLERANCE,
    ),
  );
export const insideRooms = (rooms, points) =>
  (rooms || []).some((box) => insideRoom(box, points));

/* Комната, ближайшая к точке (как в хосте: рамка с наименьшим зазором, при равенстве — с меньшим номером). */
export function nearestRoom(rooms, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const box of rooms || []) {
    const gap = point.map((value, axis) =>
      Math.max(box.min[axis] - value, 0, value - box.max[axis]),
    );
    const distance = Math.hypot(...gap);
    if (distance < bestDistance) {
      best = box;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Куда встанет плита «картинка → объём» на экране.
 *
 * `fitted` — плита, вписанная в рамку экрана (`fitReplacementMesh`, оси модели; смещение человека — в ней же), `frame` — рамка
 * модели экрана в осях модели, `entity` — `{ position, rotation }` сущности экрана в типах помещения, `rooms` — рамки комнат помещения
 * (`[{ min, max }]`, оси помещения), `hasOffset` — задал ли человек смещение.
 *
 * Правило (записано здесь и покрыто тестом `arena-screens.test.js`):
 *   1. Смещение человека уважается, если плита целиком внутри одной комнаты помещения: человек сам решил, где она стоит.
 *   2. Иначе (смещения нет или плита вышла бы за помещение) — перед экраном: вдоль самой тонкой оси рамки, в сторону середины
 *      комнаты, так что между лицом экрана и спиной плиты остаётся `ARENA_SCREEN_PLATE_GAP` (0,5 м).
 *   3. Если и так плита вне комнат — `null`: плиту не ставим, сборка сообщает «не поставлено».
 * Ответ: `{ mesh, source, centre }` — сетка уже в осях помещения относительно точки сущности, `source` — `offset` или `front`.
 */
export function layScreenPlate({ fitted, frame, entity, rooms, hasOffset }) {
  const place = (shift) => {
    const count = fitted.positions.length / 3;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const turn = effectiveEntityRotation(entity.rotation);
    for (let index = 0; index < count; index += 1) {
      const p = placeModelQuaternionTurn(turn, [
        fitted.positions[index * 3] + shift[0],
        fitted.positions[index * 3 + 1] + shift[1],
        fitted.positions[index * 3 + 2] + shift[2],
      ]);
      const n = placeModelQuaternionTurn(turn, [
        fitted.normals[index * 3],
        fitted.normals[index * 3 + 1],
        fitted.normals[index * 3 + 2],
      ]);
      for (let axis = 0; axis < 3; axis += 1) {
        positions[index * 3 + axis] = p[axis];
        normals[index * 3 + axis] = n[axis];
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
    return {
      positions,
      normals,
      uvs: fitted.uvs,
      indices: fitted.indices,
      bounds: { min, max },
    };
  };
  const inside = (mesh) =>
    insideRooms(
      rooms,
      boxCorners(mesh.bounds).map((point) => sum(entity.position, point)),
    );
  const centreOf = ({ min, max }) =>
    min.map((value, axis) => (value + max[axis]) / 2);

  if (hasOffset) {
    const mesh = place([0, 0, 0]);
    if (inside(mesh))
      return {
        mesh,
        source: "offset",
        centre: sum(entity.position, centreOf(mesh.bounds)),
      };
  }

  /* Перед экраном: вернуть плиту в середину рамки (если было смещение) и сдвинуть вдоль тонкой оси. */
  const frameExtent = minus(frame.max, frame.min);
  const thin = frameExtent.indexOf(Math.min(...frameExtent));
  const frameCentre = centreOf(frame);
  const plateCentre = centreOf(fitted.bounds);
  const plateThickness = fitted.bounds.max[thin] - fitted.bounds.min[thin];
  const axis = [0, 0, 0];
  axis[thin] = 1;
  const direction = placeModelQuaternionTurn(
    effectiveEntityRotation(entity.rotation),
    axis,
  );
  const screenCentre = entityToInterior(entity, frameCentre);
  const room = nearestRoom(rooms, screenCentre);
  if (!room) return null;
  const toHall = minus(centreOf(room), screenCentre);
  const sign =
    direction.reduce((total, value, at) => total + value * toHall[at], 0) >= 0
      ? 1
      : -1;
  const distance =
    (frameExtent[thin] + plateThickness) / 2 + ARENA_SCREEN_PLATE_GAP;
  const shift = minus(frameCentre, plateCentre);
  shift[thin] += sign * distance;
  const mesh = place(shift);
  if (!inside(mesh)) return null;
  return {
    mesh,
    source: "front",
    centre: sum(entity.position, centreOf(mesh.bounds)),
  };
}

/* Округление габаритов для отчёта. */
export const roundedBox = ({ min, max }) => ({
  min: min.map(round4),
  max: max.map(round4),
});
