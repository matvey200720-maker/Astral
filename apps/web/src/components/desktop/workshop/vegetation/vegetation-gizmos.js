/*
 * Ручки растительности: геометрия жестов без единого пикселя.
 *
 * Всё, что делает мышь на поляне — куда ложится стрела ветра, во что
 * превращается её протяжка, как ход бусины по земле становится дальностью, а
 * вертикальный ход руки — сантиметрами травы, — выражено здесь чистыми
 * функциями. Причина та же, что у воды: попадание, границы и порядок
 * округления — места, где ошибка не видна глазом на одном кадре, а тесты не
 * умеют возить мышь по WebGL.
 *
 * Соглашение осей — сцены превью: X вправо, Z на камеру, север — это -Z.
 * Румб ветра в модели задан «ОТКУДА дует», а стрела обязана лежать «куда
 * бежит волна травы» — тем же вектором, каким шейдер гонит фронт волны.
 * Поэтому направление стрелы берётся из `windVector`, и никакого второго
 * разворота на сто восемьдесят здесь нет: два разворота в двух местах — это
 * стрела, однажды показывающая против собственного жеста.
 */

import { VEGETATION_RANGES, windVector } from "./vegetation-model.js";

/*
 * Якорь стрелы — чуть впереди и левее стартового взгляда: прямо по центру
 * стоит поляна, ради которой окно открыли, а стрела над самой камерой была бы
 * видна только рёбрами.
 */
export const WIND_ANCHOR = Object.freeze({ x: -2.6, z: 1.8 });

/*
 * Длина стрелы — это сила ветра. Минимум не ноль: у штиля стрела остаётся в
 * руке, иначе неподвижное поле нельзя было бы разогнать обратно тем же жестом.
 */
export const WIND_MIN_LENGTH = 1.6;
export const WIND_MAX_LENGTH = 5.2;

/*
 * Куда на кольце дальности посажена бусина: единичный вектор ровно напротив
 * стартовой камеры (yaw 2.1 в `mount` сцены). Камера стоит ВНУТРИ кольца, и
 * ближняя его сторона — за спиной; бусина напротив открывается в кадре первой.
 * Азимут закреплён: данные у кольца — только радиус, и бусина ходит по своему
 * лучу, как каретка по рельсе, а не бегает за указателем по кругу.
 */
export const RING_HANDLE = Object.freeze({
  x: -Math.sin(2.1),
  z: -Math.cos(2.1),
});

/* Столбик-мерка высоты — на поляне рядом со стрелой, где трава ещё густая:
   мерить высоту по прореженному краю значило бы мерить то, чего не видно. */
export const HEIGHT_POST = Object.freeze({ x: 1.3, z: 3.4 });

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const step = (range, value) =>
  Number(
    (
      Math.round(clamp(value, range.min, range.max) / range.step) * range.step
    ).toFixed(4),
  );

/** Куда смотрит и какой длины стоит стрела при данном проекте. */
export function windArrowState(project) {
  const wind = project?.wind || {};
  const degrees = Number(wind.direction) || 0;
  const [x, z] = windVector(degrees);
  const share = clamp((Number(wind.strength) || 0) / 100, 0, 1);
  const length = WIND_MIN_LENGTH + share * (WIND_MAX_LENGTH - WIND_MIN_LENGTH);
  return {
    /* Поворот вокруг Y, кладущий геометрию, собранную вдоль +Z, на вектор
       ветра: (sin θ, cos θ) = (-sin d, cos d) ⇒ θ = -d. */
    radians: (-degrees * Math.PI) / 180,
    length,
    direction: { x, z },
    tip: {
      x: WIND_ANCHOR.x + x * length,
      z: WIND_ANCHOR.z + z * length,
    },
  };
}

/**
 * Протяжка наконечника → правка ветра.
 *
 * Угол от якоря — румб, расстояние — сила. Оба приводятся к шагу своих
 * ползунков: гизмо и ползунок обязаны писать в проект одинаковые числа, иначе
 * после жеста ползунок показывает «32.00000001» и выглядит сломанным.
 */
export function windArrowPatch(point) {
  const dx = (point?.x ?? WIND_ANCHOR.x) - WIND_ANCHOR.x;
  const dz = (point?.z ?? WIND_ANCHOR.z) - WIND_ANCHOR.z;
  const distance = Math.hypot(dx, dz);
  const patch = {};
  /* У самого якоря угла нет: направление при нулевой длине — шум жеста. */
  if (distance > 0.4) {
    /* Вектор жеста — «куда бежит волна», а румб хранится «откуда дует»:
       разворот здесь зеркален `windVector`, и обратимость этой пары держит
       тест. Округление к шагу — С ПЕРЕНОСОМ через север: 358° — это румб 0,
       а не зажатые в потолок 355. */
    const degrees = (Math.atan2(-dx, dz) * 180) / Math.PI;
    const turn = ((degrees % 360) + 360) % 360;
    const rose = VEGETATION_RANGES.windDirection;
    patch.direction = (Math.round(turn / rose.step) * rose.step) % 360;
  }
  const share = clamp(
    (distance - WIND_MIN_LENGTH) / (WIND_MAX_LENGTH - WIND_MIN_LENGTH),
    0,
    1,
  );
  patch.strength = step(VEGETATION_RANGES.windStrength, share * 100);
  return patch;
}

/** Где стоит бусина дальности при данном проекте. */
export function ringHandleState(project) {
  const distance = clamp(
    Number(project?.grass?.distance) || VEGETATION_RANGES.distance.min,
    VEGETATION_RANGES.distance.min,
    VEGETATION_RANGES.distance.max,
  );
  return {
    distance,
    x: RING_HANDLE.x * distance,
    z: RING_HANDLE.z * distance,
  };
}

/**
 * Ход бусины по земле → дальность травы.
 *
 * Считается расстояние от центра поля, а не проекция на луч бусины: жест
 * «оттащить кольцо туда» обязан давать кольцо ровно там, где отпустили руку,
 * с какой бы стороны его ни тянули.
 */
export function ringDragDistance(point) {
  return step(
    VEGETATION_RANGES.distance,
    Math.hypot(point?.x ?? 0, point?.z ?? 0),
  );
}

/**
 * Вертикальный ход руки в метрах → высота травы в сантиметрах, зажатая в
 * пределы ползунка. Метры в сантиметры — здесь, а не в сцене: сцена возит
 * точки по плоскости, а в каких единицах проект — знает модель и этот файл.
 */
export function postDragHeight(startHeight, deltaY) {
  return step(
    VEGETATION_RANGES.height,
    (Number(startHeight) || 0) + (Number(deltaY) || 0) * 100,
  );
}

/**
 * Масштаб ручки по расстоянию до камеры: на отходе камеры ручка не должна
 * таять в точку, на подлёте — заслонять поляну. Ход камеры здесь 2.5–34 метра
 * от центра, а бусина уезжает за девяносто — потолок выше водного.
 */
export const gizmoScale = (distance) => clamp(distance / 12, 0.75, 6);
