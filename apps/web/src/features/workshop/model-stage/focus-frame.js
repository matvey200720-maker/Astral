/*
 * Камера к тому, что правится, — одна на все кадры мастерской (слово владельца 01.11.2026: «камера спавнится где-то высоко над кварталом,
 * а должна сразу идти на тот элемент, который редактируешь, в расстоянии четырёх метров грубо говоря, выбранный элемент посередине экрана —
 * абсолютно во всех вкладках»).
 *
 * Рамка кадра (`setFrame` у `orbit-stage.js`) несёт `focus` — что держать в середине:
 *   `{ point, normal?, size?, yaw?, pitch?, distance? }`
 * `point` — точка на вещи (метры сцены); `normal` — лицо полотна, стены, экрана (глаз встаёт перед ним, по нормали); без нормали —
 * вещь целиком в три четверти; `size` — `[ширина, высота]` полотна или `[x, y, z]` вещи (или одно число — размах); `yaw`/`pitch` —
 * свой угол редактора; `distance` — свои метры (иначе — по размеру, `focusDistance`).
 *
 * Здесь — чистая арифметика без three и React: где встать (`focusPose`), сколько метров (`focusDistance`), как метры лягут в
 * приближение орбиты (`orbitUnit`). Кадр проверяет линию взгляда лучом (`blocked`) и, если вещь закрыта, подходит ближе или
 * поднимается выше; рамка, которую редактор считает сам (`focusFrame`), — та же поза без луча, на случай кадра без сцены.
 */

/* Угол объектива орбиты (как `orbit-stage.js`, `FOV`) и обычная пропорция кадра редактора. */
export const FOCUS_FOV = 34;
export const FOCUS_ASPECT = 1.6;
/* «Четыре метра грубо говоря»: так стоит камера у вещи обычного размера. */
export const FOCUS_NEAR = 4;
/* Ближе не подходим и к самой мелкой вещи: она не упирается в объектив. */
export const FOCUS_CLOSEST = 1.2;
/* Поле вокруг вещи, когда она целиком в кадре: 25 % сверх размера. */
const FOCUS_MARGIN = 1.25;
/* Доля высоты кадра, которую занимает вещь у обычного подхода. */
const FOCUS_FILL = 0.45;
/* Сколько метров держит глаз от того, что заслоняет вещь. */
export const FOCUS_GAP = 0.35;
/* Угол «три четверти» у вещи без лица и лёгкий взгляд сверху на полотно. */
export const FOCUS_THREE_QUARTER = Object.freeze({ yaw: -0.62, pitch: 0.36 });
const FRONT_PITCH = 0.08;
/* Подъём взгляда, если спереди вещь закрыта: шаги по 0,3 рад, не круче 1,25. */
const LIFTS = Object.freeze([0, 0.3, 0.6, 0.9]);
const MAX_PITCH = 1.25;
/* Ближе на столько от нужного подойти можно: вещь всё ещё почти целиком в кадре. */
const CLOSER_SHARE = 0.6;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Ширина и высота того, что держим в кадре, по `size` фокуса: полотно — как есть, вещь — по размаху. */
export function focusDims(size) {
  if (finite(size)) return [Math.max(0, size), Math.max(0, size)];
  if (!Array.isArray(size) || !size.length) return [1, 1];
  const parts = size.map((value) => (finite(value) ? Math.abs(value) : 0));
  if (parts.length === 2) return parts;
  /* Вещь: в кадре видна её ширина по земле и высота. */
  return [Math.hypot(parts[0] || 0, parts[1] || 0), parts[2] || 0];
}

/** Метров до вещи, чтобы она целиком легла в кадр с полями: по высоте — угол объектива, по ширине — он же на пропорцию. */
export function wholeDistance([width, height], { fov = FOCUS_FOV, aspect = FOCUS_ASPECT, margin = FOCUS_MARGIN } = {}) {
  const tan = Math.tan((fov * Math.PI) / 360);
  return Math.max((height * margin) / (2 * tan), (width * margin) / (2 * tan * Math.max(0.2, aspect)));
}

/**
 * Сколько метров до вещи: около четырёх у вещи обычного размера; огромное полотно — целиком в кадре (дальше); мелкая вещь — ближе,
 * но не вплотную (`FOCUS_CLOSEST`).
 */
export function focusDistance(size, options = {}) {
  const { fov = FOCUS_FOV, near = FOCUS_NEAR, closest = FOCUS_CLOSEST } = options;
  const dims = focusDims(size);
  const tan = Math.tan((fov * Math.PI) / 360);
  const extent = Math.max(dims[0], dims[1]);
  const comfortable = Math.min(near, Math.max(closest, extent / (2 * tan * FOCUS_FILL)));
  return Math.max(wholeDistance(dims, options), comfortable, closest);
}

/** Сторона взгляда: перед лицом полотна (по нормали, чуть сверху), сверху на пол и снизу на потолок, у вещи — три четверти. */
export function focusAngles({ normal = null, yaw = null, pitch = null } = {}) {
  let angles = { ...FOCUS_THREE_QUARTER };
  if (Array.isArray(normal) && normal.length >= 2 && normal.every(finite)) {
    const [nx, ny, nz = 0] = normal;
    const flat = Math.hypot(nx, ny);
    const length = Math.hypot(flat, nz) || 1;
    /* Лицо почти горизонтальное (пол, крыша, потолок): глядим сверху или снизу, сторона — та, что у кадра по умолчанию. */
    if (flat / length < 0.3) angles = { yaw: FOCUS_THREE_QUARTER.yaw, pitch: nz > 0 ? 1.1 : -0.15 };
    else angles = { yaw: Math.atan2(nx, -ny), pitch: clamp(Math.asin(clamp(nz / length, -1, 1)) + FRONT_PITCH, -0.15, MAX_PITCH) };
  }
  return { yaw: finite(yaw) ? yaw : angles.yaw, pitch: finite(pitch) ? pitch : angles.pitch };
}

/** Куда от вещи стоит глаз при `yaw`/`pitch` орбиты (оси «Z вверх», как у `stage-camera.js`). */
export function eyeDirection(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
}

const along = (from, direction, by) => from.map((value, axis) => value + direction[axis] * by);

/**
 * Точки на вещи, по которым проверяется линия взгляда: середина и четыре точки к краям (по ширине и высоте того, что в кадре). Одной
 * середины мало: у полотна над соседней крышей середина видна, а низ закрывает парапет, на котором стоит камера (вход в «Банк Pacific
 * Standard», 01.11.2026).
 */
export function sightSamples(focus, yaw, dims) {
  const [width, height] = dims;
  const normal = Array.isArray(focus?.normal) && focus.normal.length >= 2 ? focus.normal : null;
  const flat = normal ? Math.hypot(normal[0], normal[1]) : 0;
  /* Вправо по кадру: вдоль полотна (поперёк нормали), у вещи — поперёк взгляда. */
  const right = flat > 1e-6 ? [-normal[1] / flat, normal[0] / flat, 0] : [Math.cos(yaw), Math.sin(yaw), 0];
  const side = (width / 2) * 0.8;
  const rise = (height / 2) * 0.8;
  return [[0, 0, 0], right.map((value) => value * side), right.map((value) => -value * side), [0, 0, rise], [0, 0, -rise]];
}

/*
 * Сколько метров можно стоять по линии `direction`, чтобы все точки вещи были видны: заслон перед точкой — глаз встаёт перед ним с
 * зазором и проверяет снова (за ближним заслоном мог стоять второй). `clear` — видно ли всё с найденного места.
 */
function clearReach(centre, direction, distance, samples, blocked, gap) {
  let reach = distance;
  for (let pass = 0; pass < 4; pass += 1) {
    const eye = along(centre, direction, reach);
    let next = reach;
    for (const offset of samples) {
      const point = along(centre, offset, 1);
      const hit = blocked(eye, point);
      if (!finite(hit)) continue;
      const span = Math.hypot(...point.map((value, axis) => value - eye[axis]));
      /* `hit` — сколько от точки до заслона: глаз уходит вперёд за него. */
      next = Math.min(next, reach - (span - hit) - gap);
    }
    if (next >= reach) return { distance: reach, clear: true };
    reach = next;
    if (reach < FOCUS_CLOSEST) break;
  }
  return { distance: reach, clear: false };
}

/**
 * Где встать камере у вещи: `{ centre, yaw, pitch, distance }`. `blocked(eye, point)` — если линию от глаза до точки вещи что-то
 * закрывает, сколько метров от точки до заслона (`null` — видно). Линия проверяется до середины и краёв вещи (`sightSamples`).
 * Закрыто — сперва ближе по той же линии (пока вещь почти целиком в кадре), потом выше (`LIFTS`), а если закрыто отовсюду — самый
 * чистый подход, но не вплотную. `null` — фокуса нет.
 */
export function focusPose(focus, { fov = FOCUS_FOV, aspect = FOCUS_ASPECT, blocked = null, gap = FOCUS_GAP } = {}) {
  const point = focus?.point;
  if (!Array.isArray(point) || point.length < 3 || !point.slice(0, 3).every(finite)) return null;
  const centre = point.slice(0, 3);
  const distance = finite(focus.distance) && focus.distance > 0 ? focus.distance : focusDistance(focus.size, { fov, aspect });
  const base = focusAngles(focus);
  if (typeof blocked !== "function") return { centre, ...base, distance };
  const samples = sightSamples(focus, base.yaw, focusDims(focus.size));
  const enough = Math.max(FOCUS_CLOSEST, distance * CLOSER_SHARE);
  let best = null;
  for (const lift of LIFTS) {
    const pitch = lift ? clamp(base.pitch + lift, -0.15, MAX_PITCH) : base.pitch;
    if (lift && pitch <= base.pitch + 1e-6) break;
    const reach = clearReach(centre, eyeDirection(base.yaw, pitch), distance, samples, blocked, gap);
    const pose = { centre, yaw: base.yaw, pitch, distance: reach.distance };
    if (reach.clear && reach.distance >= enough) return pose;
    if (!best || (reach.clear && !best.clear) || (reach.clear === best.clear && reach.distance > best.pose.distance)) best = { pose, clear: reach.clear };
    if (pitch >= MAX_PITCH) break;
  }
  if (best?.clear && best.pose.distance >= FOCUS_CLOSEST) return best.pose;
  /* Чистого места нет ни с одной высоты — обычный подход: вплотную к заслону было бы хуже. */
  return { centre, ...base, distance };
}

/** Сколько у точки вещи не считается заслоном: у полотна — его волны и рельеф (ткань в игре выгнута на полметра), у вещи — она сама. */
export function sightSkip(focus) {
  const dims = focusDims(focus?.size);
  const extent = Math.max(dims[0], dims[1]);
  return Array.isArray(focus?.normal) ? 0.3 + extent * 0.04 : extent / 2 + 0.1;
}

/** Метров на единицу приближения орбиты (`stage-camera.js`, `orbitDistance` без посадки): радиус рамки по синусу половины угла. */
export function orbitUnit(radius, { fov = FOCUS_FOV, aspect = FOCUS_ASPECT } = {}) {
  return (Math.max(1, radius) / Math.sin((fov * Math.PI) / 360)) * (0.92 / Math.min(1, aspect || 1));
}

/** Радиус орбиты рамки — полудиагональ коробки, как его считает кадр (`orbit-stage.js`, `setFrame`). */
export function boundsRadius(bounds) {
  if (!bounds?.min || !bounds?.max) return 1.2;
  return Math.max(1.2, Math.hypot(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis])) / 2);
}

/**
 * Рамка кадра с фокусом: `{ centre, view, focus }` — середина и вид орбиты для рамки `bounds` (без луча: кадр уточнит сам) и сам фокус.
 * Редактор кладёт это в свою рамку (`{ bounds, ground, …, ...focusFrame(focus, bounds) }`). `null` — фокуса нет.
 */
export function focusFrame(focus, bounds, options = {}) {
  const pose = focusPose(focus, options);
  if (!pose) return null;
  const zoom = pose.distance / orbitUnit(boundsRadius(bounds), options);
  return { centre: pose.centre, view: { yaw: pose.yaw, pitch: pose.pitch, zoom }, focus };
}

/** Пределы колеса, в которых точно есть приближение фокуса: можно чуть ближе и дальше, до всей сцены. */
export function focusZoomRange(range, zoom) {
  const [low, high] = Array.isArray(range) && range.length === 2 ? range : [0.25, 2.8];
  return [Math.min(low, zoom * 0.35), Math.max(high, zoom * 1.05)];
}
