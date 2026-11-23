/*
 * Небесное тело вместо луны (21.11.2026).
 *
 * Луна в GTA V — прозрачный квадрат с картинкой `moon-new` из `skydome.ytd` (в Legacy 128×128, RGBA): игра ставит его в
 * сторону луны, размер — `sky_moon_disc_size`, яркость — `sky_moon_iten`. Картинка может быть любой. Этот модуль рисует её:
 * шар с освещением от солнца и фазой, мягким краем, свечением атмосферы и (у Сатурна и Урана) кольцами с тенью шара на них и
 * тенью колец на шаре. Модуль чистый — без DOM и без файлов: тот же код рисует кадр в окне и картинку для установки в игру.
 *
 * Поверхность считается процедурно прямо в точке шара (шум в трёх измерениях), поэтому швов развёртки нет и размер листа
 * не ограничивает детали; настоящие карты (NASA и подобные) подставляются через `maps` — равнопромежуточная развёртка.
 *
 * Квадрат: x и y от −1 до 1, y вверх. Радиус шара — доля половины квадрата (`bodyRadius`); у кольцевых тел шар мельче, чтобы кольцо
 * (до 2,27 радиуса) умещалось. Свет: `phase` — освещённая доля диска (0 — новолуние, 0,5 — половина, 1 — полнолуние),
 * `lightAngle` — откуда светит солнце в плоскости картинки (0° — справа, против часовой стрелки).
 */

/** Тела, которые умеет рисовать генератор. */
export const BODY_KINDS = Object.freeze([
  Object.freeze({ id: "moon", ru: "Луна", ring: null }),
  Object.freeze({ id: "mercury", ru: "Меркурий", ring: null }),
  Object.freeze({ id: "venus", ru: "Венера", ring: null }),
  Object.freeze({ id: "earth", ru: "Земля", ring: null }),
  Object.freeze({ id: "mars", ru: "Марс", ring: null }),
  Object.freeze({ id: "jupiter", ru: "Юпитер", ring: null }),
  Object.freeze({ id: "saturn", ru: "Сатурн", ring: "saturn" }),
  Object.freeze({ id: "uranus", ru: "Уран", ring: "uranus" }),
  Object.freeze({ id: "neptune", ru: "Нептун", ring: null }),
]);

export const BODY_IDS = Object.freeze(BODY_KINDS.map((item) => item.id));

export const BODY_LIMITS = Object.freeze({
  size: Object.freeze({ min: 0.3, max: 1.2 }),
  phase: Object.freeze({ min: 0, max: 1 }),
  lightAngle: Object.freeze({ min: -180, max: 180 }),
  axisRoll: Object.freeze({ min: -90, max: 90 }),
  viewTilt: Object.freeze({ min: -60, max: 60 }),
  atmosphere: Object.freeze({ min: 0, max: 1.5 }),
});

/* Свечение атмосферы по телам: цвет в sRGB и сила по умолчанию. */
const ATMOSPHERE = Object.freeze({
  moon: { colour: [0.8, 0.8, 0.82], power: 0 },
  mercury: { colour: [0.8, 0.78, 0.74], power: 0 },
  venus: { colour: [1, 0.9, 0.62], power: 0.7 },
  earth: { colour: [0.38, 0.6, 1], power: 0.9 },
  mars: { colour: [0.95, 0.65, 0.5], power: 0.35 },
  jupiter: { colour: [0.95, 0.85, 0.7], power: 0.3 },
  saturn: { colour: [0.97, 0.88, 0.65], power: 0.3 },
  uranus: { colour: [0.6, 0.92, 0.96], power: 0.55 },
  neptune: { colour: [0.4, 0.55, 1], power: 0.6 },
});

/* Умолчания по телам: наклон оси, как его видно с Земли, и кольца. */
const DEFAULTS = Object.freeze({
  moon: { axisRoll: 0, viewTilt: 0, phase: 1 },
  mercury: { axisRoll: 0, viewTilt: 0, phase: 1 },
  venus: { axisRoll: 0, viewTilt: 0, phase: 0.85 },
  earth: { axisRoll: 12, viewTilt: 18, phase: 1 },
  mars: { axisRoll: 20, viewTilt: 14, phase: 0.95 },
  jupiter: { axisRoll: 0, viewTilt: 3, phase: 1 },
  saturn: { axisRoll: -12, viewTilt: 24, phase: 1 },
  uranus: { axisRoll: 62, viewTilt: 30, phase: 1 },
  neptune: { axisRoll: 28, viewTilt: 10, phase: 1 },
});

const clamp = (value, { min, max }, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : fallback;
};

/** Тело в границах: неизвестное — `null` (тела нет, луна остаётся игры). */
export function normalizeBody(raw) {
  const kind = BODY_IDS.includes(raw?.kind) ? raw.kind : null;
  if (!kind) return null;
  const base = DEFAULTS[kind];
  return {
    kind,
    size: clamp(raw.size, BODY_LIMITS.size, 1),
    phase: clamp(raw.phase, BODY_LIMITS.phase, base.phase),
    lightAngle: clamp(raw.lightAngle, BODY_LIMITS.lightAngle, 35),
    axisRoll: clamp(raw.axisRoll, BODY_LIMITS.axisRoll, base.axisRoll),
    viewTilt: clamp(raw.viewTilt, BODY_LIMITS.viewTilt, base.viewTilt),
    atmosphere: clamp(raw.atmosphere, BODY_LIMITS.atmosphere, 1),
    rotation: clamp(raw.rotation, { min: -180, max: 180 }, 0),
  };
}

/* --- Шум (три измерения, без швов) --- */

const hash3 = (x, y, z, seed) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function valueNoise(x, y, z, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const at = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), fx), mix(at(0, 1, 0), at(1, 1, 0), fx), fy),
    mix(mix(at(0, 0, 1), at(1, 0, 1), fx), mix(at(0, 1, 1), at(1, 1, 1), fx), fy),
    fz,
  );
}

/* Каждая октава повёрнута: иначе узор шума вытягивается вдоль осей решётки и читается клеткой. */
function fbm(x, y, z, octaves, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let px = x;
  let py = y;
  let pz = z;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise(px * frequency, py * frequency, pz * frequency, seed + octave * 17);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
    const nx = px * 0.8 - pz * 0.6;
    const nz = px * 0.6 + pz * 0.8;
    const ny = py * 0.936 + nz * 0.352;
    pz = -py * 0.352 + nz * 0.936;
    px = nx;
    py = ny;
  }
  return sum / total;
}

/* Кратеры: ближайшая точка решётки Вороного, чаша темнее, вал светлее. Множитель яркости ~0,7…1,25. */
function craters(x, y, z, scale, seed) {
  const gx = x * scale;
  const gy = y * scale;
  const gz = z * scale;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  const cz = Math.floor(gz);
  let shade = 1;
  for (let dx = -1; dx <= 1; dx += 1)
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dz = -1; dz <= 1; dz += 1) {
        const ix = cx + dx;
        const iy = cy + dy;
        const iz = cz + dz;
        if (hash3(ix, iy, iz, seed + 5) > 0.55) continue;
        const px = ix + 0.2 + 0.6 * hash3(ix, iy, iz, seed + 1);
        const py = iy + 0.2 + 0.6 * hash3(ix, iy, iz, seed + 2);
        const pz = iz + 0.2 + 0.6 * hash3(ix, iy, iz, seed + 3);
        const radius = 0.18 + 0.28 * hash3(ix, iy, iz, seed + 4);
        const distance = Math.hypot(gx - px, gy - py, gz - pz) / radius;
        if (distance < 0.8) shade *= 0.82 + 0.1 * smoothstep(0.1, 0.8, distance);
        else if (distance < 1.15) shade *= 1 + 0.3 * (1 - Math.abs(distance - 0.98) / 0.17) * 0.8;
      }
  return shade;
}

const saturate = (value) => Math.min(Math.max(value, 0), 1);
const smoothstep = (low, high, value) => smooth(saturate((value - low) / (high - low)));
const lerpRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* Цвет по полосам широты: `stops` — [[положение 0…1, rgb]…]. */
function bandColour(stops, t) {
  const clamped = saturate(t);
  for (let index = 1; index < stops.length; index += 1) {
    if (clamped <= stops[index][0]) {
      const [t0, c0] = stops[index - 1];
      const [t1, c1] = stops[index];
      return lerpRgb(c0, c1, (clamped - t0) / Math.max(t1 - t0, 1e-6));
    }
  }
  return stops[stops.length - 1][1];
}

/* --- Поверхности по телам: точка на единичной сфере `(x, y, z)`, `y` — к северному полюсу --- */

function surfaceAlbedo(kind, x, y, z, rotation) {
  const lat = Math.asin(Math.min(Math.max(y, -1), 1));
  const lon = Math.atan2(x, z) + rotation;
  const px = Math.sin(lon) * Math.cos(lat);
  const pz = Math.cos(lon) * Math.cos(lat);
  switch (kind) {
    case "moon": {
      /* Без карты — тёмные «моря» крупными пятнами на светлой кратерной суше; настоящая карта (NASA LRO) приходит через `maps.moon`. */
      const sea = smoothstep(0.52, 0.66, fbm(px * 1.5 + 9, y * 1.5, pz * 1.5, 4, 41));
      const base = mix(0.62, 0.3, sea * 0.85) * (0.92 + 0.16 * fbm(px * 9, y * 9, pz * 9, 4, 43));
      const shade = base * craters(px, y, pz, 6, 5) * craters(px, y, pz, 15, 17);
      return [shade * 1.02, shade * 1.0, shade * 0.96];
    }
    case "mercury": {
      const base = 0.46 + 0.14 * fbm(px * 3, y * 3, pz * 3, 5, 3);
      const shade =
        base * craters(px, y, pz, 5, 7) * craters(px, y, pz, 13, 19) * (0.94 + 0.12 * fbm(px * 30, y * 30, pz * 30, 3, 5));
      return [shade * 1.03, shade * 0.97, shade * 0.9];
    }
    case "venus": {
      const warp = fbm(px * 2.2, y * 2.2 + 3, pz * 2.2, 4, 11);
      const swirl = fbm(px * 2.6 + warp * 2.4, y * 6 + warp * 3, pz * 2.6 + warp * 2.4, 4, 23);
      return lerpRgb([0.88, 0.74, 0.46], [0.99, 0.93, 0.72], smoothstep(0.25, 0.8, swirl));
    }
    case "earth": {
      const land = fbm(px * 1.7 + 4, y * 1.7, pz * 1.7, 6, 31);
      const coast = smoothstep(0.5, 0.54, land);
      const depth = smoothstep(0.2, 0.5, land);
      const ocean = lerpRgb([0.02, 0.09, 0.3], [0.08, 0.3, 0.58], depth);
      const dry = smoothstep(0.35, 0.75, fbm(px * 3 + 9, y * 3, pz * 3, 4, 37) + Math.abs(y) * -0.5 + 0.35);
      const ground = lerpRgb([0.16, 0.36, 0.13], [0.55, 0.45, 0.28], dry);
      let rgb = lerpRgb(ocean, ground, coast);
      const ice = smoothstep(0.84, 0.92, Math.abs(y) + 0.05 * valueNoise(px * 9, y * 9, pz * 9, 2));
      rgb = lerpRgb(rgb, [0.93, 0.95, 0.98], ice);
      const cloud = smoothstep(0.52, 0.72, fbm(px * 2.4 + 20, y * 3.6, pz * 2.4, 6, 47));
      return lerpRgb(rgb, [0.97, 0.98, 1], cloud * 0.85);
    }
    case "mars": {
      const tone = fbm(px * 2.2, y * 2.2, pz * 2.2, 5, 53);
      let rgb = lerpRgb([0.62, 0.3, 0.16], [0.84, 0.56, 0.33], tone);
      const maria = smoothstep(0.48, 0.62, fbm(px * 1.4 + 7, y * 1.4, pz * 1.4, 5, 59));
      rgb = lerpRgb(rgb, [0.32, 0.2, 0.15], maria * 0.7);
      const detail = 0.92 + 0.16 * fbm(px * 12, y * 12, pz * 12, 3, 61);
      rgb = rgb.map((value) => value * detail);
      const cap = smoothstep(0.86, 0.93, Math.abs(y) + 0.04 * valueNoise(px * 8, y * 8, pz * 8, 4));
      return lerpRgb(rgb, [0.94, 0.94, 0.95], cap);
    }
    case "jupiter": {
      const warp = fbm(px * 3, y * 8, pz * 3, 5, 67);
      const stripe = 0.5 + 0.5 * Math.sin(lat * 15 + warp * 3.2 + 0.4 * Math.sin(lat * 38));
      const turbulence = fbm(px * 10 + warp * 2, y * 24, pz * 10, 4, 71);
      let rgb = bandColour(
        [
          [0, [0.55, 0.36, 0.26]],
          [0.3, [0.8, 0.62, 0.44]],
          [0.55, [0.93, 0.88, 0.76]],
          [0.8, [0.7, 0.46, 0.32]],
          [1, [0.88, 0.8, 0.66]],
        ],
        stripe * 0.82 + turbulence * 0.26,
      );
      /* Большое красное пятно: эллипс южнее экватора. */
      const dl = Math.atan2(Math.sin(lon - 0.6), Math.cos(lon - 0.6));
      const spot = 1 - smoothstep(0.55, 1.05, Math.hypot(dl / 0.26, (lat + 0.38) / 0.13));
      rgb = lerpRgb(rgb, [0.75, 0.32, 0.2], spot * 0.85);
      return rgb;
    }
    case "saturn": {
      const warp = fbm(px * 2.4, y * 6, pz * 2.4, 4, 79);
      const stripe = 0.5 + 0.5 * Math.sin(lat * 11 + warp * 2.2);
      const rgb = bandColour(
        [
          [0, [0.72, 0.6, 0.42]],
          [0.5, [0.88, 0.78, 0.58]],
          [1, [0.95, 0.88, 0.7]],
        ],
        stripe * 0.75 + 0.25 * fbm(px * 6, y * 14, pz * 6, 3, 83),
      );
      return rgb;
    }
    case "uranus": {
      const stripe = 0.5 + 0.5 * Math.sin(lat * 7 + 1.2 * fbm(px * 2, y * 3, pz * 2, 3, 89));
      return lerpRgb([0.48, 0.8, 0.86], [0.66, 0.9, 0.93], stripe * 0.7 + 0.2 * Math.max(y, 0));
    }
    case "neptune": {
      const warp = fbm(px * 2.4, y * 5, pz * 2.4, 4, 97);
      const stripe = 0.5 + 0.5 * Math.sin(lat * 9 + warp * 2.6);
      let rgb = lerpRgb([0.1, 0.2, 0.62], [0.28, 0.45, 0.9], stripe);
      const spot = 1 - smoothstep(0.4, 0.8, Math.hypot(Math.atan2(Math.sin(lon - 2), Math.cos(lon - 2)) / 0.3, (lat + 0.3) / 0.16));
      rgb = lerpRgb(rgb, [0.05, 0.1, 0.38], spot * 0.7);
      const cloud = smoothstep(0.62, 0.8, fbm(px * 2.2, y * 18, pz * 2.2, 4, 101));
      return lerpRgb(rgb, [0.8, 0.88, 1], cloud * 0.4);
    }
    default:
      return [0.5, 0.5, 0.5];
  }
}

/* --- Кольца: профиль по расстоянию от центра в радиусах шара → [прозрачность, rgb] --- */

const RINGS = Object.freeze({
  saturn: { inner: 1.24, outer: 2.27 },
  uranus: { inner: 1.55, outer: 2.05 },
});

function ringSample(ring, rho) {
  if (ring === "saturn") {
    if (rho < 1.24 || rho > 2.27) return null;
    const grain = 0.88 + 0.24 * valueNoise(rho * 60, 3.3, 7.1, 13);
    let alpha;
    let rgb;
    if (rho < 1.53) {
      alpha = 0.16 * smoothstep(1.24, 1.32, rho);
      rgb = [0.42, 0.36, 0.3];
    } else if (rho < 1.95) {
      alpha = 0.92 * smoothstep(1.53, 1.6, rho) * (1 - 0.35 * smoothstep(1.85, 1.95, rho));
      rgb = lerpRgb([0.78, 0.66, 0.5], [0.9, 0.8, 0.64], smoothstep(1.55, 1.95, rho));
    } else if (rho < 2.03) {
      alpha = 0.06;
      rgb = [0.5, 0.45, 0.38];
    } else {
      alpha = (0.62 - 0.4 * smoothstep(2.2, 2.27, rho)) * (rho > 2.205 && rho < 2.225 ? 0.15 : 1);
      rgb = [0.72, 0.64, 0.52];
    }
    return { alpha: Math.min(alpha * grain, 1), rgb: rgb.map((value) => Math.min(value * grain, 1)) };
  }
  if (ring === "uranus") {
    if (rho < 1.55 || rho > 2.05) return null;
    const lines = Math.max(smoothstep(0.03, 0, Math.abs(rho - 1.78)), smoothstep(0.03, 0, Math.abs(rho - 1.95)) * 0.8);
    return lines > 0 ? { alpha: 0.5 * lines, rgb: [0.7, 0.76, 0.8] } : null;
  }
  return null;
}

/* sRGB ↔ линейный свет упрощённо: освещение считается в линейном. */
const toLinear = (value) => value ** 2.2;
const toSrgb = (value) => saturate(value) ** (1 / 2.2);

/** Радиус шара в долях половины квадрата: у кольцевых тел мельче, чтобы кольцо умещалось. */
export function bodyRadius(kind, size = 1) {
  const item = BODY_KINDS.find((entry) => entry.id === kind);
  const outer = item?.ring ? RINGS[item.ring].outer : 1.18;
  /* Что обязано уместиться в квадрат: кольцо или ореол атмосферы (`bodyReach`). Иначе при размере больше единицы край листа режет их ровной линией,
     а у квадрата луны не должно быть видимого края (пустая рамка листа — проверка `sky-battle-clean.test.js`). Размер 1 не меняется. */
  return Math.min((0.92 / outer) * size, 0.95 / bodyReach(kind));
}

/** Во сколько радиусов шара уходит нарисованное: кольцо Сатурна — 2,27, ореол атмосферы — 1,12, у голого шара (Луна, Меркурий) — 1. */
export function bodyReach(kind) {
  const item = BODY_KINDS.find((entry) => entry.id === kind);
  return item?.ring ? RINGS[item.ring].outer : (ATMOSPHERE[kind]?.power ?? 0) > 0 ? 1.12 : 1;
}

/*
 * Лист луны в игре — 128×128 (`moon-new`), и на крупных размерах он мылит: пиксель листа растягивается на несколько пикселей экрана. Предел размера луны
 * считается так, чтобы лист на экране 1920×1080 при обычном угле обзора (50° по вертикали) был увеличен не больше чем в 1,3 раза. Пока в движке нет команды
 * листа больше 128 (`ytd-texture-replace` написана, не собрана), выше предела размер не пускаем ни в окне, ни в файле.
 *
 * Число `MOON_QUAD_PER_DISC_SIZE` — угол стороны квадрата луны на единицу `sky_moon_disc_size` (рад). Снято по кадрам стенда пачки-1 (02:00 и 04:00, одна
 * «полка» размера ×2, `sky_moon_disc_size` 6): диск луны 0,093…0,097 рад на кадрах с углом 70° и 35° (подгонка круга по кромке), диск занимает 0,78 стороны
 * листа, значит квадрат ≈ 0,1224 рад, то есть 0,0204 на единицу. Когда придут кадры «луны-2» (размеры известны точно), число пересчитать (`moonSheetZoom`).
 */
export const MOON_SHEET_SIDE = 128;
export const MOON_QUAD_PER_DISC_SIZE = 0.0204;
/** Во сколько раз можно растянуть лист на экране, чтобы он ещё не мылил. */
export const MOON_SHEET_MAX_ZOOM = 1.3;
/** Угол обзора игры по умолчанию (по вертикали, градусы) и высота экрана, для которых считается предел. */
export const MOON_SHEET_REFERENCE_VIEW = Object.freeze({ fov: 50, screenHeight: 1080 });

/**
 * Во сколько раз лист луны растянут на экране: сторона квадрата в пикселях экрана на сторону листа.
 * `discSize` — значение `sky_moon_disc_size` (штатно 3; размер луны в окне — множитель к нему).
 */
export function moonSheetZoom(discSize, { fov = MOON_SHEET_REFERENCE_VIEW.fov, screenHeight = MOON_SHEET_REFERENCE_VIEW.screenHeight, sheet = MOON_SHEET_SIDE } = {}) {
  const pixelsPerRadian = screenHeight / 2 / Math.tan((fov * Math.PI) / 360);
  return (Math.max(Number(discSize) || 0, 0) * MOON_QUAD_PER_DISC_SIZE * pixelsPerRadian) / sheet;
}

/** Штатный `sky_moon_disc_size` (3): предел «размера луны» в окне — множитель к нему, при котором лист ещё не мылит (шаг 0,05 ползунка). */
export const MOON_DISC_SIZE_STOCK = 3;
export const MOON_SIZE_LIMIT = Math.floor((MOON_SHEET_MAX_ZOOM / moonSheetZoom(MOON_DISC_SIZE_STOCK)) * 20) / 20;
/** Тот же предел в самом `sky_moon_disc_size` (для типов погоды, где штатный размер не 3: выше него наше увеличение не поднимает). */
export const MOON_DISC_SIZE_LIMIT = Math.round(MOON_SIZE_LIMIT * MOON_DISC_SIZE_STOCK * 100) / 100;

const SAMPLES = 3;

/** Сторона картинки в пикселях: не меньше 8 и не больше 1024. */
export const bodySide = (size) => Math.max(8, Math.min(1024, Math.round(Number(size) || 128)));

/**
 * Рисует тело: `{ width, height, rgba }` (прямая прозрачность, 8 бит). `size` — сторона квадрата в пикселях (степень двойки
 * для игры: 128). `maps` — необязательные карты поверхности `{ [тело]: { width, height, rgba } }` (равнопромежуточные).
 */
export function renderBody(rawBody, { size = 128, maps = null } = {}) {
  const body = normalizeBody(rawBody);
  const side = bodySide(size);
  const rgba = new Uint8ClampedArray(side * side * 4);
  if (!body) return { width: side, height: side, rgba };

  const item = BODY_KINDS.find((entry) => entry.id === body.kind);
  const radius = bodyRadius(body.kind, body.size);
  const ring = item.ring ? RINGS[item.ring] : null;
  const atmosphere = ATMOSPHERE[body.kind];
  const map = maps?.[body.kind] || null;

  /* Вид → предмет: Mz(крен)·Mx(наклон к зрителю). Ось тела в виде — `pole`; нормаль плоскости колец — она же. */
  const roll = (body.axisRoll * Math.PI) / 180;
  const tilt = (body.viewTilt * Math.PI) / 180;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const toView = (x, y, z) => {
    const y1 = y * ct - z * st;
    const z1 = y * st + z * ct;
    return [x * cr - y1 * sr, x * sr + y1 * cr, z1];
  };
  const toObject = (x, y, z) => {
    const x1 = x * cr + y * sr;
    const y1 = -x * sr + y * cr;
    return [x1, y1 * ct + z * st, -y1 * st + z * ct];
  };
  const pole = toView(0, 1, 0);

  /* Свет в виде: фаза — угол солнце–тело–зритель. */
  const theta = (1 - body.phase) * Math.PI;
  const angle = (body.lightAngle * Math.PI) / 180;
  const light = [Math.sin(theta) * Math.cos(angle), Math.sin(theta) * Math.sin(angle), Math.cos(theta)];
  const rotation = (body.rotation * Math.PI) / 180;
  const glowPower = atmosphere.power * body.atmosphere;
  const ringTiltOk = Math.abs(pole[2]) > 0.02;

  const albedo = (nx, ny, nz) => {
    const [ox, oy, oz] = toObject(nx, ny, nz);
    if (map) return sampleMap(map, ox, oy, oz, rotation);
    return surfaceAlbedo(body.kind, ox, oy, oz, rotation);
  };

  /* Освещённость точки шара без колец: мягкий терминатор, затемнение к краю, пепельный свет. */
  const shade = (nx, ny, nz) => {
    const diffuse = nx * light[0] + ny * light[1] + nz * light[2];
    const lit = smoothstep(-0.06, 0.32, diffuse);
    const limb = 1 - 0.38 * (1 - nz) ** 1.4;
    return (0.012 + lit * limb) * (0.82 + 0.18 * Math.min(Math.max(diffuse, 0), 1));
  };

  /* Тень колец на шаре: луч от точки к солнцу пересекает плоскость колец. */
  const ringShadowOnBody = (qx, qy, qz) => {
    if (!ring || !ringTiltOk) return 1;
    const denominator = pole[0] * light[0] + pole[1] * light[1] + pole[2] * light[2];
    if (Math.abs(denominator) < 1e-4) return 1;
    const t = -(pole[0] * qx + pole[1] * qy + pole[2] * qz) / denominator;
    if (t <= 0) return 1;
    const rho = Math.hypot(qx + t * light[0], qy + t * light[1], qz + t * light[2]) / radius;
    const sample = ringSample(item.ring, rho);
    return sample ? 1 - 0.9 * sample.alpha : 1;
  };

  const inv = 1 / SAMPLES;
  for (let py = 0; py < side; py += 1) {
    for (let px = 0; px < side; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) * inv) / side) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) * inv) / side) * 2;
          const d = Math.hypot(x, y);
          const u = x / radius;
          const v = y / radius;
          const onBody = d <= radius;
          let bodyZ = -Infinity;
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;

          if (onBody) {
            const nx = u;
            const ny = v;
            const nz = Math.sqrt(Math.max(1 - nx * nx - ny * ny, 0));
            bodyZ = nz * radius;
            const colour = albedo(nx, ny, nz);
            const lit = shade(nx, ny, nz);
            const light_ = lit * ringShadowOnBody(nx * radius, ny * radius, bodyZ);
            /* Неосвещённая часть диска полупрозрачна: небо просвечивает сквозь тёмную сторону, и серп не висит чёрным кругом на светлом небе. */
            a = mix(0.32, 1, smoothstep(0.02, 0.2, lit));
            r = toLinear(colour[0]) * light_ * a;
            g = toLinear(colour[1]) * light_ * a;
            b = toLinear(colour[2]) * light_ * a;
            if (glowPower > 0) {
              /* Свечение у лимба — на освещённой стороне. */
              const rim = (1 - nz) ** 3 * glowPower * saturate(smoothstep(-0.1, 0.5, nx * light[0] + ny * light[1] + nz * light[2]));
              r += toLinear(atmosphere.colour[0]) * rim * 0.9;
              g += toLinear(atmosphere.colour[1]) * rim * 0.9;
              b += toLinear(atmosphere.colour[2]) * rim * 0.9;
            }
          } else if (glowPower > 0 && d < radius * 1.12) {
            /* Ореол снаружи диска: на освещённой стороне, быстро гаснет. */
            const outside = (d - radius) / (radius * 0.045);
            const towards = (x / d) * light[0] + (y / d) * light[1] + 0.35 * light[2];
            const strength = glowPower * Math.exp(-outside * outside) * smoothstep(-0.2, 0.55, towards);
            if (strength > 0.003) {
              /* r, g, b — с прозрачностью (premultiplied): так кольца и ореол складываются одной формулой «поверх». */
              a = Math.min(strength * 0.8, 0.85);
              r = toLinear(atmosphere.colour[0]) * 0.9 * a;
              g = toLinear(atmosphere.colour[1]) * 0.9 * a;
              b = toLinear(atmosphere.colour[2]) * 0.9 * a;
            }
          }

          /* Кольца: пересечение луча зрения с плоскостью колец; впереди шара или позади него. */
          if (ring && ringTiltOk) {
            const rz = -(pole[0] * x + pole[1] * y) / pole[2];
            const rho = Math.hypot(x, y, rz) / radius;
            const sample = ringSample(item.ring, rho);
            if (sample && (rz > bodyZ || !onBody)) {
              const facing = Math.sign(pole[2]);
              const lit = pole[0] * light[0] + pole[1] * light[1] + pole[2] * light[2];
              const face = Math.sign(lit) === facing ? 1 : 0.35;
              /* Тень шара на кольцах. */
              const alongSun = x * light[0] + y * light[1] + rz * light[2];
              const away = Math.hypot(x - alongSun * light[0], y - alongSun * light[1], rz - alongSun * light[2]);
              const shadowed = alongSun < 0 && away < radius ? 0.12 : 1;
              const ringLight = (0.06 + 0.94 * Math.abs(lit)) * face * shadowed * (0.6 + 0.4 * Math.max(light[2], 0.2));
              const rr = toLinear(sample.rgb[0]) * ringLight;
              const rg = toLinear(sample.rgb[1]) * ringLight;
              const rb = toLinear(sample.rgb[2]) * ringLight;
              const over = sample.alpha;
              r = rr * over + r * (1 - over);
              g = rg * over + g * (1 - over);
              b = rb * over + b * (1 - over);
              a = over + Math.min(a, 1) * (1 - over);
            }
          }
          accR += r;
          accG += g;
          accB += b;
          accA += Math.min(a, 1);
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = Math.min(accA / total, 1);
      const offset = (py * side + px) * 4;
      if (alpha > 0.002) {
        /* Среднее по выборкам: цвет с прозрачностью делится на сумму прозрачностей. */
        rgba[offset] = toSrgb(accR / accA) * 255;
        rgba[offset + 1] = toSrgb(accG / accA) * 255;
        rgba[offset + 2] = toSrgb(accB / accA) * 255;
        rgba[offset + 3] = alpha * 255;
      }
    }
  }
  return { width: side, height: side, rgba };
}

/** Цвет карты в точке шара (равнопромежуточная развёртка, билинейно): `[r, g, b]` в 0…1. */
function sampleMap(map, x, y, z, rotation) {
  const lat = Math.asin(Math.min(Math.max(y, -1), 1));
  const lon = Math.atan2(x, z) + rotation;
  const u = ((lon / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
  const v = 0.5 - lat / Math.PI;
  const fx = u * map.width - 0.5;
  const fy = Math.min(Math.max(v * map.height - 0.5, 0), map.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (ix, iy, channel) => map.rgba[(Math.min(Math.max(iy, 0), map.height - 1) * map.width + (((ix % map.width) + map.width) % map.width)) * 4 + channel] / 255;
  return [0, 1, 2].map((channel) =>
    mix(mix(at(x0, y0, channel), at(x0 + 1, y0, channel), tx), mix(at(x0, y0 + 1, channel), at(x0 + 1, y0 + 1, channel), tx), ty),
  );
}
