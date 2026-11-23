/*
 * Свет квартала из таймцикла (задача 4Б ТЗ 18.10.2026): числа для ламп сцены,
 * в которой стоит настоящий кусок карты из игры.
 *
 * Квартал освещают ровно те числа, что и процедурный город в шейдере неба
 * (`sky-renderer.js`, ветка «Кварталы»): солнце `light_dir_col × light_dir_mult`
 * на `SCENE_LIGHT.direct`, естественное окружение — градиент по вертикали
 * нормали (снизу `light_natural_amb_down`, сверху `light_natural_amb_up`) на
 * `SCENE_LIGHT.ambient`, городские фонари — `light_artificial_ext_up`. Шкала
 * одна на кадр: по ней же считается и экспозиция (`autoExposureStops`), поэтому
 * здесь нет ни одной подобранной «на глаз» яркости.
 *
 * Модуль не знает three.js — отдаёт числа и оси, чтобы их проверял тест без
 * WebGL. Оси: таймцикл — Z вверх, сцена three — Y вверх; точка (x, y, z) игры
 * в сцене — (x, z, −y), как у размещения сущностей карты
 * (`placementTransform` в `mega-mall-scene.js`).
 *
 * Ламберт в three поделён на π (`albedo/π · E`), поэтому интенсивность лампы
 * сцены — яркость шейдера неба на π: поверхность с тем же альбедо даёт ту же
 * яркость, что процедурный дом.
 */

import { SCENE_LIGHT } from "@modovik/timecycle";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Точка игры (Z вверх) → сцена three (Y вверх). */
export const toSceneAxes = (vector) => [vector.x, vector.z, -vector.y];

/** Сцена three → игра. */
export const fromSceneAxes = (vector) => ({ x: vector[0], y: -vector[2], z: vector[1] });

const normalize = (vector) => {
  const size = Math.hypot(...vector) || 1;
  return vector.map((value) => value / size);
};

/* Высота света над горизонтом (синус), с которой он светит в полную силу. */
const HORIZON_FADE = 0.04;

/* Солнце ниже этой высоты (≈ 6° под горизонтом) отдаёт направленный свет луне. */
const SUN_HANDOVER = -0.1;

/**
 * Откуда светит направленный свет игры: днём солнце, ночью луна. Переключение —
 * когда солнце ушло под горизонт: к этому часу `light_dir_mult` таймцикла уже
 * почти ноль (закат гаснет), и скачок направления не виден. Смешивать два
 * почти противоположных направления нельзя: середина между ними — вектор
 * нулевой длины, и после нормализации свет разворачивался бы за минуты.
 *
 * @returns {{ toLight: number[], day: boolean }} направление К свету в осях игры
 */
export function directionalLight(state) {
  const sun = state.sunDirection;
  const day = sun.z > SUN_HANDOVER;
  const source = day ? sun : state.moonDirection;
  return { toLight: normalize([source.x, source.y, source.z]), day };
}

/**
 * Свет квартала на час.
 *
 * @param {object} state — `resolveSkyState`
 * @returns {{
 *   sun: { direction: number[], colour: number[], gain: number, radiance: number[], intensity: number[], shadows: boolean },
 *   hemisphere: { sky: number[], ground: number[], intensity: { sky: number[], ground: number[] } },
 *   artificial: number[],
 *   night: number,
 * }} `direction` — К свету в осях сцены; `radiance` — яркость в единицах шейдера неба,
 *   `intensity` — она же на π для ламп three
 */
export function blockLighting(state) {
  const { toLight } = directionalLight(state);
  /* Свет из-под горизонта ничего не освещает: у самого горизонта он плавно гаснет, ниже — ноль. */
  const gain = clamp(toLight[2] / HORIZON_FADE, 0, 1);
  const power = clamp(Number(state.lightDirIntensity) || 0, 0, 80) * SCENE_LIGHT.direct * gain;
  const colour = (state.lightDirColour || [1, 1, 1]).map((value) => Math.max(value, 0));
  const radiance = colour.map((value) => value * power);

  const ambient = (rgb, intensity) =>
    rgb.map((value) => Math.max(value, 0) * Math.max(Number(intensity) || 0, 0) * SCENE_LIGHT.ambient);
  const sky = ambient(state.ambientUpColour, state.ambientUpIntensity);
  const ground = ambient(state.ambientDownColour, state.ambientDownIntensity);
  const artificial = (state.artificialColour || [0, 0, 0]).map(
    (value) => Math.max(value, 0) * Math.max(Number(state.artificialIntensity) || 0, 0),
  );

  /* Ночь как доля — по ней зажигаются окна и фонари, как у шейдера неба. */
  const night = 1 - clamp(state.sunDirection.z * 4, 0, 1);
  const lift = Math.max(toLight[2], 0);
  return {
    sun: {
      direction: toSceneAxes({ x: toLight[0], y: toLight[1], z: toLight[2] }),
      colour,
      gain,
      radiance,
      intensity: radiance.map((value) => value * Math.PI),
      /* Тень — пока свет над горизонтом: ночью и в сумерках лунная тень мелка и мутна, а карта теней дорога. */
      shadows: lift > 0.06,
    },
    hemisphere: {
      sky,
      ground,
      intensity: { sky: sky.map((value) => value * Math.PI), ground: ground.map((value) => value * Math.PI) },
    },
    artificial,
    night,
  };
}

/**
 * Ширина области, на которую падает тень, и высота света над ней — для
 * карты теней: у квартала радиус 140 м, у низкого солнца тень длиннее.
 */
export function shadowReach(radius = 140) {
  return clamp(radius * 1.25, 60, 480);
}
