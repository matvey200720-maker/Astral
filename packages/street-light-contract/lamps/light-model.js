/*
 * Как GTA V светит фонарём — числа сняты с самой игры.
 *
 * 28.09.2026 стендом `tools/ingame-qa` (README, раздел «Фонари»): штатный
 * `prop_streetlight_01` ночью на пустом аэродроме Сэнди-Шорс, глаз игры
 * закреплён, кадр обращён в линейный свет её же плёночной кривой, числа лампы
 * правятся прямо в памяти игры — сила, радиус, показатель, объём, ореол по
 * одному. Двадцать с лишним кадров сверху и сбоку; модель ниже повторяет их
 * с ошибкой 5–15 % (пятно) и 10–20 % (объём).
 *
 * ПЯТНО НА ЗЕМЛЕ
 *
 *   E = K · I · (1 − x²) · конус · cos(падения) / (C + n · x²),   x = d / R
 *
 * I — сила лампы, R — радиус (`falloff`), n — показатель (`falloffExponent`),
 * d — расстояние от лампы. Показатель у игры — не «жёсткость кромки», как
 * казалось по названию, а сила затухания: n = 1 даёт ровное яркое пятно с
 * резким краем у радиуса, n = 96 (штатный фонарь) — яркий центр и мягкий
 * спад, n = 200 — ещё тусклее и уже. При больших n яркость падает ровно
 * обратно n. Конус — ступень от внешнего угла лампы (плюс два градуса),
 * внутренний угол игра не использует.
 *
 * ЛУЧ (ОБЪЁМ, Lighting_FogVolumes)
 *
 *   L = kv · VI · I² · ∫ конус · (1 − x²)/(C + n·x²) ds / (R·VS),   x = d/(R·VS)
 *
 * VI — `volumeIntensity`, VS — `volumeSizeScale`. Объём — тот же свет в шаре
 * радиуса R·VS: радиус 10 при VS 0,5 и радиус 19,8 при VS 0,25 дают один и
 * тот же кадр до пикселя. Сила входит в квадрате (VI ×4 = I ×2 — кадры
 * совпали), интеграл по лучу зрения нормирован на размер объёма.
 *
 * ОРЕОЛ (`corona`)
 *
 * Вблизи игра ореол лампы не рисует вовсе — ни при какой силе и размере: до
 * ~46 м в кадре только стекло. Он проступает дальше ~50 м и к сотне метров
 * становится звездой. Поэтому «блик» в игре — это ореолы дальних фонарей.
 *
 * ЦВЕТ
 *
 * Байты цвета лампы игра читает линейно (доля канала = байт / 255): пятно
 * зелёной лампы #2EFF8C на бетоне дало 0,22 : 1 : 0,47 при ожидаемых
 * 0,18 : 1 : 0,55 (бетон чуть тёплый).
 */

export const LAMP_LIGHT_MODEL = Object.freeze({
  /* K: пятно в долях ночного фона земли на единицу силы. */
  groundScale: 21.6,
  /* C: постоянная в знаменателе затухания. */
  quadratic: 0.669,
  /* Конус: внешний угол лампы плюс поправка, степень ступени. */
  coneMargin: 2,
  conePower: 0.855,
  /* kv: объём в линейном свете сцены на VI·I² нормированного интеграла. */
  volumeScale: 0.0458,
  /* Показатель, который игра ещё различает (200 темнее 128 — проверено). */
  maxExponent: 256,
  /* Ореол: где проступает и где выходит на полную силу, метры. */
  coronaFadeStart: 45,
  coronaFadeEnd: 110,
});

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Затухание по расстоянию: (1 − x²)/(C + n·x²), 0 за радиусом. */
export function lampAttenuation(distance, falloff, exponent) {
  const radius = Number(falloff);
  if (!(radius > 0)) return 0;
  const x = Number(distance) / radius;
  if (!(x < 1)) return 0;
  const n = Math.max(0, Number(exponent) || 0);
  return (1 - x * x) / (LAMP_LIGHT_MODEL.quadratic + n * x * x);
}

/** Конус прожектора: ступень от внешнего угла (градусы) к оси. */
export function lampCone(cosTheta, coneOuterDegrees) {
  const outer = ((Math.min(89, Number(coneOuterDegrees) || 89) + LAMP_LIGHT_MODEL.coneMargin) * Math.PI) / 180;
  const cosOuter = Math.cos(Math.min(outer, Math.PI / 2));
  return clamp01((cosTheta - cosOuter) / (1 - cosOuter)) ** LAMP_LIGHT_MODEL.conePower;
}

/**
 * Пятно на земле в долях ночного фона: `light` — лампа (`intensity`,
 * `falloff`, `falloffExponent`, `coneOuterAngle`, `spot` — прожектор ли),
 * `distance` — от лампы до точки, `cosTheta` — угол к оси лампы, `cosIncidence`
 * — угол падения на землю.
 */
export function lampGroundRatio(light, { distance, cosTheta, cosIncidence }) {
  const attenuation = lampAttenuation(distance, light.falloff, light.falloffExponent);
  if (!attenuation) return 0;
  const cone = light.spot === false ? 1 : lampCone(cosTheta, light.coneOuterAngle);
  return LAMP_LIGHT_MODEL.groundScale * Number(light.intensity) * attenuation * cone * Math.max(0, cosIncidence);
}

/*
 * Опорная точка лампы: земля под ней, на половине радиуса. Там человек видит
 * «яркость фонаря»; ползунки дальности и мягкости края меняют пятно вокруг,
 * а силу лампы подгоняют так, чтобы здесь она осталась той, что задала
 * «Яркость». Без этой поправки «дальность +30 %» делала фонарь в полтора раза
 * ярче (x ближе к нулю — затухание слабее), а «мягче» — вдвое тусклее.
 */
export const LAMP_REFERENCE_SHARE = 0.5;

/**
 * Во сколько раз поменять силу, чтобы в опорной точке свет остался прежним.
 * Опорная точка — на половине МЕНЬШЕГО из радиусов: у фонаря, сжатого до
 * 40 %, прежняя точка оказалась бы за краем пятна, где сравнивать нечего.
 */
export function lampCompensation(before, after) {
  const reference = LAMP_REFERENCE_SHARE * Math.min(Number(before.falloff), Number(after.falloff));
  const was = lampAttenuation(reference, before.falloff, before.falloffExponent);
  const now = lampAttenuation(reference, after.falloff, after.falloffExponent);
  if (!(was > 0) || !(now > 0)) return 1;
  return was / now;
}

/**
 * Объём луча вдоль луча зрения: `sample(t)` → точка мира, `length` — сколько
 * метров идти, `light` — лампа с `volumeIntensity`, `volumeSizeScale`, её
 * положением `position` и осью `axis`. Возвращает свет объёма в линейных
 * единицах сцены (умножается на цвет лампы).
 */
export function lampVolumeAlongRay(light, origin, direction, length, steps = 24) {
  const reach = Number(light.falloff) * Number(light.volumeSizeScale);
  if (!(reach > 0) || !(light.volumeIntensity > 0)) return 0;
  const [px, py, pz] = light.position;
  /* Отрезок луча внутри шара объёма: вне его вклад ноль. */
  const ox = origin[0] - px;
  const oy = origin[1] - py;
  const oz = origin[2] - pz;
  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox * ox + oy * oy + oz * oz - reach * reach;
  const disc = b * b - c;
  if (disc <= 0) return 0;
  const root = Math.sqrt(disc);
  const t0 = Math.max(0, -b - root);
  const t1 = Math.min(length, -b + root);
  if (t1 <= t0) return 0;
  const dt = (t1 - t0) / steps;
  const axis = light.axis || [0, 0, -1];
  let sum = 0;
  for (let index = 0; index < steps; index += 1) {
    const t = t0 + (index + 0.5) * dt;
    const vx = ox + direction[0] * t;
    const vy = oy + direction[1] * t;
    const vz = oz + direction[2] * t;
    const d = Math.hypot(vx, vy, vz);
    if (d < 1e-3) continue;
    const cone = light.spot === false ? 1 : lampCone((vx * axis[0] + vy * axis[1] + vz * axis[2]) / d, light.coneOuterAngle);
    if (!cone) continue;
    sum += cone * lampAttenuation(d, reach, light.falloffExponent) * dt;
  }
  const intensity = Number(light.intensity);
  return (LAMP_LIGHT_MODEL.volumeScale * light.volumeIntensity * intensity * intensity * sum) / reach;
}

/** Сила ореола дальнего фонаря по расстоянию: 0 вблизи, 1 вдали. */
export function lampCoronaVisibility(distance) {
  const { coronaFadeStart, coronaFadeEnd } = LAMP_LIGHT_MODEL;
  return clamp01((Number(distance) - coronaFadeStart) / (coronaFadeEnd - coronaFadeStart));
}
