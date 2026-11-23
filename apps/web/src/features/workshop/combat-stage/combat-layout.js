/*
 * Раскладка 3D-кадра боя для предпросмотров эффектов (задача 4А, 18.10.2026):
 * стрелок, жертва, линия выстрела и готовые ракурсы камеры.
 *
 * Чистые функции без three.js — раскладка проверяется тестами. Мир — как у
 * всей сцены частиц: метры, ось Z вверх. Жертва стоит в начале координат
 * ногами на земле (z = 0) лицом к стрелку, то есть к −Y; стрелок — на
 * расстоянии `separation` позади, его дуло лежит на линии выстрела x = 0, и
 * пуля летит вдоль +Y к выбранной зоне.
 *
 * Тела приходят из игры в осях glTF (Y вверх) и в позе привязки к тазу:
 * начало координат тела — таз, ноги ниже на `footLift` метров. Поэтому
 * положение тела в мире — это положение таза: `footLift` над землёй.
 */

/* Расстояние от стрелка до жертвы, м: «вблизи» — бой на пяти-шести метрах,
   «вдали» — за верхней границей LOD штатной крови (40 м). */
export const SEPARATION = Object.freeze({ near: 3.2, far: 45 });

/* Высота кадра, который ракурс отдаёт цели, м: объектив подбирается так, чтобы
   жертва занимала кадр одинаково и вблизи, и вдали — меняется лишь расстояние
   до эффекта, а с ним и его LOD, как в игре. */
export const FRAMING = Object.freeze({ shooter: 4.2, side: 3.1, victim: 4.2 });

/* Камера «из-за плеча», как камера прицеливания в GTA: позади головы, правее и чуть выше — плечо и ствол остаются в нижнем левом углу, а цель — в середине кадра. */
export const SHOULDER = Object.freeze({ behind: 2.1, aside: 0.62, above: 0.5 });

/* Дальше этого расстояния «Сбоку» не пытается уложить в кадр обоих. */
const SIDE_BOTH_WITHIN = 15;
/* Запас кадра «Сбоку» по ширине сверх расстояния между фигурами — на спину стрелка, плечи, руки и ствол, м. */
const SIDE_MARGIN = 2.4;
/* Стрелок вытянут назад от дула (корпус и приклад), жертва — на линии: середина кадра сдвинута к стрелку, м. */
const SIDE_SHIFT = 0.15;

/* От сустава головы до макушки, м. */
const HEAD_HEIGHT = 0.22;

const TAU = Math.PI * 2;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const size = length(a);
  return size > 1e-9 ? scale(a, 1 / size) : [0, 0, 0];
}
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Поворот вокруг Z на `angle` радиан (против часовой, если смотреть сверху). */
export function rotateZ(point, angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2]];
}

/** Точка в осях glTF (x, y вверх, z к зрителю) → оси сцены (Z вверх). */
export const gltfToScene = (point) => [point[0], -point[2], point[1]];

/** Направление взгляда в осях сцены: yaw 0 — вдоль +Y, положительный — к +X. */
export function lookAngles(from, to) {
  const delta = sub(to, from);
  const flat = Math.hypot(delta[0], delta[1]);
  return { yaw: Math.atan2(delta[0], delta[1]), pitch: Math.atan2(delta[2], flat) };
}

/** Угол, на который надо повернуть вектор в плоскости XY, чтобы он лёг на другой. */
export function turnBetween(from, to) {
  let angle = Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0]);
  while (angle > Math.PI) angle -= TAU;
  while (angle < -Math.PI) angle += TAU;
  return angle;
}

/** Вертикальный угол объектива (градусы), чтобы на расстоянии `distance` в кадр легли `metres`. */
export function framingFov(metres, distance) {
  return (2 * Math.atan(metres / 2 / Math.max(distance, 0.05)) * 180) / Math.PI;
}

/** Точка тела (в осях сцены, начало — таз) в мире: поворот вокруг Z и перенос. */
export const bodyToWorld = (local, placement) => add(rotateZ(local, placement.yaw), placement.position);

/**
 * Куда целится пуля в каждой зоне. Суставы приходят из кэша тела
 * (`joints`, оси glTF). Сдвиги — от сустава к центру части тела: сустав головы
 * лежит у основания черепа, сустав груди — на позвоночнике, а не посреди
 * грудной клетки.
 */
export const ZONE_TARGETS = Object.freeze({
  head: Object.freeze({ joint: "head", offset: [0, 0.1, 0] }),
  body: Object.freeze({ joint: "spine3", offset: [0, 0.02, 0] }),
});

/** Центр зоны в осях сцены, начало — таз; `null`, если сустава нет. */
export function zoneCentre(zoneId, joints) {
  const target = ZONE_TARGETS[zoneId] || ZONE_TARGETS.body;
  const joint = joints?.[target.joint];
  if (!Array.isArray(joint) || joint.length !== 3) return null;
  return gltfToScene([joint[0] + target.offset[0], joint[1] + target.offset[1], joint[2] + target.offset[2]]);
}

/*
 * Запасные точки, когда тела из игры нет (песочница без игры): рост 1,8 м,
 * таз на 0,95 м от земли. Нужны лишь затем, чтобы раскладка и подписи не
 * рассыпались — картинки без тела сцена не рисует.
 */
export const FALLBACK_BODY = Object.freeze({
  footLift: 0.95,
  joints: Object.freeze({ head: [0, 0.64, 0], spine3: [0, 0.28, 0], pelvis: [0, 0, 0] }),
});

/**
 * Раскладка кадра.
 *
 * @param {object} input
 * @param {number} input.separation — расстояние стрелок → жертва, м
 * @param {object} input.victim — `{ footLift, joints }` тела жертвы
 * @param {object} input.shooter — `{ footLift, muzzle, forward }`: дуло и ось ствола в осях сцены, начало — таз
 * @param {string} [input.zone] — зона выстрела: `head` или `body`
 */
export function layoutFor({ separation, victim, shooter, zone = "body" }) {
  const victimBody = victim || FALLBACK_BODY;
  /* Пед из игры стоит лицом к −Y без поворота: к стрелку (он на −Y) — как есть. */
  const victimPlacement = { position: [0, 0, victimBody.footLift], yaw: 0 };
  const centreLocal = zoneCentre(zone, victimBody.joints) || zoneCentre("body", FALLBACK_BODY.joints);
  const target = bodyToWorld(centreLocal, victimPlacement);

  /* Стрелок: ствол смотрит вдоль +Y, дуло — на линии выстрела x = 0. */
  const forwardFlat = [shooter.forward[0], shooter.forward[1], 0];
  const yaw = turnBetween(forwardFlat, [0, 1, 0]);
  const muzzleLocal = rotateZ(shooter.muzzle, yaw);
  const shooterPlacement = {
    position: [-muzzleLocal[0], -separation - muzzleLocal[1], shooter.footLift],
    yaw,
  };
  const muzzle = bodyToWorld(shooter.muzzle, shooterPlacement);
  const direction = normalize(sub(target, muzzle));
  /* Макушка — выше сустава головы на высоту черепа; центр тела — полроста: на
     него смотрят кадры, чтобы фигура помещалась целиком при любой зоне. */
  const headJoint = victimBody.joints?.head;
  const top = victimBody.footLift + (Array.isArray(headJoint) ? headJoint[1] : FALLBACK_BODY.joints.head[1]) + HEAD_HEIGHT;
  return {
    separation,
    victim: victimPlacement,
    shooter: shooterPlacement,
    muzzle,
    target,
    direction,
    zone,
    victimCentre: [0, 0, top / 2],
    /* Глаза и голова: от них считаются ракурсы. */
    victimHead: bodyToWorld(zoneCentre("head", victimBody.joints) || centreLocal, victimPlacement),
    shooterHead: bodyToWorld(shooter.head || [0, 0, FALLBACK_BODY.joints.head[1]], shooterPlacement),
  };
}

/** Зоны, что считаются у жертвы, — для проверки и подписей. */
export const ZONE_IDS = Object.freeze(Object.keys(ZONE_TARGETS));

/**
 * Ракурсы камеры: `{ id, eye, target, yaw, pitch, fov }`.
 *
 *   shooter — «Стреляешь ты»: из-за правого плеча стрелка, как камера
 *             прицеливания в GTA — плечо и ствол внизу слева, цель в середине;
 *   side    — «Сбоку»: стрелок и жертва целиком в профиль, линия выстрела
 *             видна поперёк кадра;
 *   victim  — «Стреляют в тебя»: из-за плеча жертвы на стрелка, пули летят в
 *             объектив.
 *
 * Объектив подбирается по расстоянию до цели (`framingFov`): вдали кадр тот
 * же, но эффект — на сорока метрах от камеры, и игра ведёт себя с ним
 * соответственно (LOD).
 */
export function viewsFor(layout, { aspect = 1.6 } = {}) {
  const { muzzle, separation, victimHead, shooterHead, victimCentre } = layout;
  /* Смещения камеры — по горизонтали пули: наклон от головы к груди кадр не качает. */
  const direction = normalize([layout.direction[0], layout.direction[1], 0]);
  const up = [0, 0, 1];
  const right = normalize(cross(direction, up));
  const make = (id, eye, look, metres) => {
    const angles = lookAngles(eye, look);
    return {
      id,
      eye,
      target: look,
      yaw: angles.yaw,
      pitch: angles.pitch,
      fov: framingFov(metres, length(sub(look, eye))),
    };
  };

  const shooterEye = add(add(sub(shooterHead, scale(direction, SHOULDER.behind)), scale(right, SHOULDER.aside)), [0, 0, SHOULDER.above]);
  const shooterView = make("shooter", shooterEye, victimCentre, FRAMING.shooter);

  /* Вблизи в профиль лежат оба — целиком, по центру, по ширине кадра; вдали
     стрелок за кадром, и кадр — жертва, а до неё те же сорок метров. */
  const both = separation <= SIDE_BOTH_WITHIN;
  const middle = add(victimCentre, scale(direction, -(separation * 0.5 + SIDE_SHIFT)));
  const lateral = Math.max(6.5, separation * 0.9);
  const sideEye = add(add(middle, scale(right, lateral)), [0, 0, 0.1]);
  const sideMetres = both ? Math.max(FRAMING.side, (separation + SIDE_MARGIN) / aspect) : FRAMING.side;
  const sideView = make("side", sideEye, both ? middle : victimCentre, sideMetres);

  /* Жертва смотрит на стрелка: «позади неё» — по направлению пули, а её правое плечо — слева от нашего «вправо». */
  const victimEye = add(add(add(victimHead, scale(direction, SHOULDER.behind)), scale(right, -SHOULDER.aside)), [0, 0, SHOULDER.above]);
  const victimView = make("victim", victimEye, add(muzzle, [0, 0, -0.12]), FRAMING.victim);
  return [shooterView, sideView, victimView];
}

export const VIEW_IDS = Object.freeze(["shooter", "side", "victim"]);

/* Ракурсы «от третьего лица» и «от первого» (следы урона и килл-эффект). */
export const PERSON_VIEW_IDS = Object.freeze(["third", "first"]);

/**
 * Ракурсы персонажа, за которого играет человек: за плечом — как камера
 * третьего лица в GTA — и из глаз. Камера смотрит туда же, куда персонаж (или
 * на точку прицела `aim`, если она есть): враги — в кадре там, где они стоят, а
 * персонаж — слева внизу, не заслоняя того, во что целится.
 *
 * @param {object} person
 * @param {number[]} person.head — голова персонажа в мире
 * @param {number[]} person.forward — куда он смотрит (горизонталь берётся сама)
 * @param {number[]} [person.aim] — точка прицела: камера за плечом смотрит на неё, а не вдоль курса
 */
export function thirdPersonViews({ head, forward, aim = null }) {
  const heading = normalize([forward[0], forward[1], 0]);
  const right = normalize(cross(heading, [0, 0, 1]));
  const make = (id, eye, look, fov) => {
    const angles = lookAngles(eye, look);
    return { id, eye, target: look, yaw: angles.yaw, pitch: angles.pitch, fov };
  };
  /* Позади и правее, чуть выше головы: персонаж занимает слева две трети кадра по высоте. */
  const behind = add(add(sub(head, scale(heading, 2.9)), scale(right, 0.85)), [0, 0, 0.5]);
  const inside = add(add(head, scale(heading, 0.14)), [0, 0, 0.04]);
  /* Горизонт — в середине кадра: смотрит вдоль курса чуть ниже линии глаз. */
  const along = (eye) => add(eye, add(scale(heading, 20), [0, 0, -0.6]));
  return [make("third", behind, aim || along(behind), 50), make("first", inside, along(inside), 66)];
}

/**
 * Куда на экране ложится след урона от выстрела: угол в том смысле, в каком его
 * рисует `screen-hits-painter.js` — 0 вправо, дальше по часовой стрелке (вниз
 * на экране — π/2, вверх — −π/2).
 *
 * @param {number[]} from — откуда стреляют
 * @param {number[]} to — где стоит игрок
 * @param {number[]} heading — куда смотрит камера игры
 */
export function hitAngle(from, to, heading) {
  const forward = normalize([heading[0], heading[1], 0]);
  const right = normalize(cross(forward, [0, 0, 1]));
  const offset = sub(from, to);
  /* `0 − …`, а не минус: у стрелка точно сбоку ноль со знаком давал бы −π вместо π. */
  return Math.atan2(0 - dot(offset, forward), dot(offset, right));
}

/** Обратное `hitAngle`: где стоять стрелку на расстоянии `radius`, чтобы след лёг под углом `angle`. */
export function bearingPosition(angle, radius, centre, heading) {
  const forward = normalize([heading[0], heading[1], 0]);
  const right = normalize(cross(forward, [0, 0, 1]));
  const offset = add(scale(right, Math.cos(angle) * radius), scale(forward, -Math.sin(angle) * radius));
  return [centre[0] + offset[0], centre[1] + offset[1], centre[2]];
}

/** Ракурс по имени; незнакомое имя — «Стреляешь ты». */
export function viewById(layout, id) {
  const views = viewsFor(layout);
  return views.find((view) => view.id === id) || views[0];
}
