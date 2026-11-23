/*
 * Расчёты позы для окна «Анимации» (ТЗ 29.10.2026-d) — без three.js и без видеокарты, чтобы их можно было проверить.
 *
 * Дорожка клипа приходит из главного процесса в осях RAGE (Z вверх): повороты костей по кадрам, по четыре числа на кость, и мувер
 * (поворот и сдвиг корня клипа). Скелет персонажа в GLB — в осях glTF (Y вверх): (x, y, z) RAGE → (x, z, −y). У поворота так
 * же переставляется векторная часть, а число `w` остаётся.
 */

/** Номер кости в скелете и её тег из имени узла GLB (`bone_<номер>_<тег>`, `animation-rig.js`). */
export function boneName(name) {
  const match = /^bone_(\d+)_(-?\d+)$/.exec(String(name || ""));
  return match ? { index: Number(match[1]), tag: Number(match[2]) } : null;
}

/** Два соседних кадра дорожки и доля между ними для момента `seconds`: клип идёт по кругу. */
export function frameAt(track, seconds) {
  const frames = Math.max(1, track.frames | 0);
  const position = (((seconds * track.fps) % frames) + frames) % frames;
  const first = Math.floor(position);
  return { first, second: (first + 1) % frames, alpha: position - first };
}

/** Те же два кадра, что у `frameAt`, и два соседних с ними: кубической кривой нужны четыре. Клип идёт по кругу. */
export function frameAround(track, seconds) {
  const frames = Math.max(1, track.frames | 0);
  const at = frameAt(track, seconds);
  return {
    ...at,
    before: (at.first + frames - 1) % frames,
    after: (at.second + 1) % frames,
  };
}

/* Шов круга: сколько секунд перед концом клипа плавно идёт к первому кадру и с какого скачка стык считается рваным. */
export const SEAM_SECONDS = 0.35;
const SEAM_ANGLE = (6 * Math.PI) / 180;
const SEAM_RATIO = 2;

const angleOf = (rotations, from, to) => {
  const dot = Math.abs(
    rotations[from] * rotations[to] +
      rotations[from + 1] * rotations[to + 1] +
      rotations[from + 2] * rotations[to + 2] +
      rotations[from + 3] * rotations[to + 3],
  );
  return 2 * Math.acos(Math.min(1, dot));
};

const seams = new WeakMap();

/**
 * Рвётся ли у клипа стык круга: последний кадр дальше от первого, чем обычный шаг клипа. Танец, снятый по кругу, сходится сам; жест или поза, у которых конец не равен началу, на стыке прыгали бы
 * за один кадр. Меряется один раз на дорожку: у самой дальней кости стык больше двух её шагов у конца клипа и больше шести градусов.
 */
export function seamTorn(track) {
  if (!track?.rotations) return false;
  if (seams.has(track)) return seams.get(track);
  const frames = track.frames | 0;
  const count = track.tags?.length || 0;
  let torn = false;
  if (frames >= 4 && count) {
    const last = (frames - 1) * count * 4;
    const before = (frames - 2) * count * 4;
    for (let slot = 0; slot < count && !torn; slot += 1) {
      const jump = angleOf(track.rotations, last + slot * 4, slot * 4);
      const step = angleOf(track.rotations, before + slot * 4, last + slot * 4);
      torn = jump > SEAM_RATIO * step + SEAM_ANGLE;
    }
  }
  seams.set(track, torn);
  return torn;
}

/**
 * Доля перехода к первому кадру в момент `seconds`: 0 почти весь круг, а в последние `SEAM_SECONDS` растёт плавно до 1 — на стыке поза уже первого кадра, и рывка при возврате в начало нет.
 * У клипа со сходящимся стыком всегда 0, поэтому обычные танцы идут как сняты.
 */
export function seamBlend(track, seconds) {
  if (!seamTorn(track)) return 0;
  const length = track.frames / (track.fps || 30);
  const span = Math.min(SEAM_SECONDS, length * 0.4);
  const toEnd = length - (((seconds % length) + length) % length || 0);
  if (toEnd >= span) return 0;
  const linear = 1 - toEnd / span;
  return linear * linear * (3 - 2 * linear);
}

/**
 * Поворот между кадрами `b` и `c` на доле `alpha` по кривой Катмулла — Рома через соседей `a` и `d` (все — `[x, y, z, w]`).
 * Дорожка снята тридцать раз в секунду, и по дуге между двумя кадрами (`slerpInto`) скорость поворота рвётся на каждом кадре
 * дорожки — на глаз это ступеньки в плавном движении. Здесь скорость у кадра одна для обоих отрезков рядом, и рука идёт
 * плавно. Знаки соседей приводятся к полусфере `b`: `q` и `−q` — один поворот, а кривая по ним — нет.
 */
export function cubicInto(out, a, b, c, d, alpha) {
  const toward = (q, to) =>
    q[0] * to[0] + q[1] * to[1] + q[2] * to[2] + q[3] * to[3] < 0 ? -1 : 1;
  const sc = toward(c, b);
  const sa = toward(a, b);
  const sd = toward(d, c) * sc;
  const t2 = alpha * alpha;
  const t3 = t2 * alpha;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + alpha;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  for (let axis = 0; axis < 4; axis += 1) {
    const start = b[axis];
    const end = sc * c[axis];
    const tangentStart = 0.5 * (end - sa * a[axis]);
    const tangentEnd = 0.5 * (sd * d[axis] - start);
    out[axis] = h00 * start + h10 * tangentStart + h01 * end + h11 * tangentEnd;
  }
  const length = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
  out[3] /= length;
  return out;
}

/** Поворот RAGE `array[at..at+3]` → `out` `[x, y, z, w]` в осях сцены. */
export function sceneQuaternion(out, array, at) {
  out[0] = array[at];
  out[1] = array[at + 2];
  out[2] = -array[at + 1];
  out[3] = array[at + 3];
  return out;
}

/** Кватернионы `a` и `b` на доле `alpha` — короткой дугой, нормализованно. */
export function slerpInto(out, a, b, alpha) {
  let [bx, by, bz, bw] = b;
  let cosine = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosine < 0) {
    cosine = -cosine;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scaleA = 1 - alpha;
  let scaleB = alpha;
  if (cosine < 0.9995) {
    const angle = Math.acos(Math.min(1, cosine));
    const sine = Math.sin(angle);
    scaleA = Math.sin((1 - alpha) * angle) / sine;
    scaleB = Math.sin(alpha * angle) / sine;
  }
  out[0] = a[0] * scaleA + bx * scaleB;
  out[1] = a[1] * scaleA + by * scaleB;
  out[2] = a[2] * scaleA + bz * scaleB;
  out[3] = a[3] * scaleA + bw * scaleB;
  const length = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
  out[3] /= length;
  return out;
}

/**
 * Поворот мувера без поворота вокруг вертикали: куда смотрит персонаж, решает окно (три четверти к зрителю), а лежит он или
 * стоит на корточках — решает клип. `q` — `[x, y, z, w]` в осях сцены; вертикаль сцены — Y.
 */
export function moverRest(out, q) {
  const length = Math.hypot(q[1], q[3]);
  if (length < 1e-6) {
    out[0] = q[0];
    out[1] = q[1];
    out[2] = q[2];
    out[3] = q[3];
    return out;
  }
  /* q = twist · rest, twist = (0, y, 0, w)/длина ⇒ rest = twist⁻¹ · q. */
  const ty = -q[1] / length;
  const tw = q[3] / length;
  out[0] = tw * q[0] + ty * q[2];
  out[1] = tw * q[1] + ty * q[3];
  out[2] = tw * q[2] - ty * q[0];
  out[3] = tw * q[3] - ty * q[1];
  return out;
}

/*
 * Наклон тела от мувера. У эмоций и танцев мувер несёт не «лёг» и не «присел», а раскачку корпуса: до 17–36° вперёд и вбок посреди прыжка (замер по 40 клипам игры, 1.11.2026:
 * медиана 8°, у 17 из 40 дольше 10°). Если ставить её на всё тело, фигура завалена вперёд, а ноги висят над полом — именно такой «наклон» владелец и называл. Корпус и так
 * наклоняют кости позвоночника; мувер нужен там, где тело действительно ложится или стоит на четвереньках (йога, лёжа, кувырок): наклон до `UPRIGHT_UNTIL` не ставится вовсе,
 * между ним и `TILTED_FROM` вступает плавно, выше — целиком.
 */
export const UPRIGHT_UNTIL = (40 * Math.PI) / 180;
export const TILTED_FROM = (75 * Math.PI) / 180;

/** Поворот тела по мувера `q` (`[x, y, z, w]`, оси сцены): без курса, без раскачки корпуса, с настоящим «лёжа». `out` — `[x, y, z, w]`. */
export function moverPosture(out, q) {
  moverRest(out, q);
  /* Кратчайшая дуга: w ≥ 0. */
  const sign = out[3] < 0 ? -1 : 1;
  const angle = 2 * Math.acos(Math.min(1, sign * out[3]));
  if (angle <= UPRIGHT_UNTIL) {
    out[0] = out[1] = out[2] = 0;
    out[3] = 1;
    return out;
  }
  if (angle >= TILTED_FROM) return out;
  const share = (angle - UPRIGHT_UNTIL) / (TILTED_FROM - UPRIGHT_UNTIL);
  const eased = share * share * (3 - 2 * share);
  /* Тот же наклон на долю `eased`: ось та же, угол — `angle × eased`. */
  const half = (angle * eased) / 2;
  const axis = Math.hypot(out[0], out[1], out[2]) || 1;
  const scale = Math.sin(half) / axis;
  out[0] *= sign * scale;
  out[1] *= sign * scale;
  out[2] *= sign * scale;
  out[3] = Math.cos(half);
  return out;
}

/** Рамка точек `[x, y, z, …]`: центр и размеры. Пустой набор — рамка единичного человека. */
export function boundsOf(points) {
  if (!points.length) return { center: [0, 0.9, 0], size: [0.8, 1.8, 0.8] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < points.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], points[at + axis]);
      max[axis] = Math.max(max[axis], points[at + axis]);
    }
  return {
    center: min.map((value, axis) => (value + max[axis]) / 2),
    size: max.map((value, axis) => value - min[axis]),
  };
}

/** Расстояние камеры, при котором рамка `size` целиком в кадре: вертикальный угол `fov` в градусах, `aspect` — ширина к высоте. */
export function fitDistance(size, aspect, fov = 28, margin = 0.3) {
  const half = Math.tan((fov * Math.PI) / 360);
  const height = Math.max(size[1], 1.0) + margin;
  const width = Math.max(size[0], size[2], 0.6) + margin;
  return (
    Math.max(height / (2 * half), width / (2 * half * Math.max(0.2, aspect))) +
    Math.max(size[2], 0.4) / 2
  );
}

/** Шаг сглаживания камеры: доля пути к цели за `dt` секунд (не зависит от частоты кадров). */
export const approach = (dt, speed = 5) =>
  1 - Math.exp(-Math.max(0, dt) * speed);

/*
 * Корневое движение клипа (дорожки 5 и 6, 14.11.2026): куда сам идёт и как поворачивается тело. Раньше просмотр играл на месте, сдвиг и курс выбрасывались.
 *
 * Дорожка `travel` — по семь чисел на кадр: поворот (`x, y, z, w`) и сдвиг (`x, y, z`) корня, оси RAGE (Z вверх). Сцена — Y вверх: (x, y, z) → (x, z, −y). Сдвиг и курс
 * считаются от кадра 0 в осях самого персонажа в начале клипа, поэтому клип начинается лицом к зрителю, а не туда, куда смотрел корень в мире игры. Высоту тела даёт корневая кость
 * (`moverPosture`), здесь только по земле и вокруг вертикали.
 *
 * Фигура должна остаться в кадре: сдвиг мягко сжимается, `дальность × tanh(путь / дальность)` — короткие пути идут как в файле, длинные (ходьба, бег на десятки метров)
 * упираются в `TRAVEL_REACH`. Конец круга плавно возвращается к началу тем же швом, что и повороты костей (`seam`).
 */
export const TRAVEL_REACH = 1.4;

const TWO_PI = Math.PI * 2;
const wrapAngle = (angle) => angle - TWO_PI * Math.round(angle / TWO_PI);

/** Курс (поворот вокруг вертикали сцены) из поворота RAGE `array[at..at+3]`. */
export function travelYaw(array, at) {
  /* В осях сцены: (x, z, −y, w); вертикаль — Y. Вращение вокруг неё — `2·atan2(qy, qw)`; остальной наклон тела даёт `moverPosture`. */
  return 2 * Math.atan2(array[at + 2], array[at + 3]);
}

/** Сжатие пути до `TRAVEL_REACH`: ноль остаётся нулём, малое — почти как есть, большое — упирается в дальность. */
export function reachOf(distance) {
  return TRAVEL_REACH * Math.tanh(distance / TRAVEL_REACH);
}

const rawTravel = (travel, frame, out) => {
  const at = frame * 7;
  out.x = travel[at + 4];
  out.z = -travel[at + 5];
  out.yaw = travelYaw(travel, at);
  return out;
};

/**
 * Сдвиг и курс тела в момент между кадрами `first` и `second` дорожки (доля `alpha`), с возвратом к началу клипа на доле шва `seam`. Результат в `out` — `{ x, z, yaw }`: сцена, метры и
 * радианы относительно кадра 0, сдвиг сжат до `TRAVEL_REACH`. Клип без корневого движения (нулевая дорожка) — нули.
 */
export function travelAt(
  out,
  travel,
  first,
  second,
  alpha,
  seam = 0,
  scratch = [{}, {}, {}],
) {
  const [origin, a, b] = scratch;
  rawTravel(travel, 0, origin);
  rawTravel(travel, first, a);
  let x = a.x;
  let z = a.z;
  let yaw = a.yaw;
  if (alpha > 0) {
    rawTravel(travel, second, b);
    x += (b.x - a.x) * alpha;
    z += (b.z - a.z) * alpha;
    yaw += wrapAngle(b.yaw - a.yaw) * alpha;
  }
  const keep = 1 - seam;
  /* К концу круга поза возвращается к началу: сдвиг и курс стремятся к кадру 0. */
  x = origin.x + (x - origin.x) * keep;
  z = origin.z + (z - origin.z) * keep;
  yaw = origin.yaw + wrapAngle(yaw - origin.yaw) * keep;
  const dx = x - origin.x;
  const dz = z - origin.z;
  const cos = Math.cos(origin.yaw);
  const sin = Math.sin(origin.yaw);
  /* Сдвиг в осях тела в начале клипа. */
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const distance = Math.hypot(localX, localZ);
  const scale = distance > 1e-6 ? reachOf(distance) / distance : 0;
  out.x = localX * scale;
  out.z = localZ * scale;
  out.yaw = wrapAngle(yaw - origin.yaw);
  return out;
}

/** Рамка пути по всем кадрам дорожки (сцена, метры): `{ minX, maxX, minZ, maxZ }`; клип без корневого движения — нулевая рамка. */
export function travelExtent(track) {
  const extent = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const travel = track?.travel;
  if (!travel) return extent;
  const out = {};
  const scratch = [{}, {}, {}];
  for (let frame = 0; frame < track.frames; frame += 1) {
    travelAt(out, travel, frame, frame, 0, 0, scratch);
    extent.minX = Math.min(extent.minX, out.x);
    extent.maxX = Math.max(extent.maxX, out.x);
    extent.minZ = Math.min(extent.minZ, out.z);
    extent.maxZ = Math.max(extent.maxZ, out.z);
  }
  return extent;
}
