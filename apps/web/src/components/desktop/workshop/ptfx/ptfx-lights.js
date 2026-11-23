/*
 * Местные огни частиц — `extralightmult` шейдеров игры.
 *
 * Освещённая частица в игре берёт не только солнце и окружение таймцикла, но
 * и огни рядом с собой: мотыльки у фонаря светятся его светом, а не лунным.
 * Сцена попаданий огней не задаёт (фигура стоит под солнцем), и у неё свет
 * прежний; кадр фонарей задаёт сами фонари — до четырёх ближайших.
 *
 * Спад — квадрат доли до края радиуса, как у точечных огней LightAttributes
 * с показателем 2; лицом к огню — с «обёрткой»: крыло и лепесток тонкие и
 * светятся с изнанки.
 *
 * Фонарь кадра фонарей задаёт огню спад самой игры (`model`): (1 − x²) /
 * (C + n·x²), как у пятна на земле (`light-model.js`, снято с GTA V). С
 * прежним квадратом лепестки в метре от лампы светились вдвое тусклее, чем
 * в игре, где лампа высвечивает их почти добела.
 */

import * as THREE from "three";

export const LOCAL_LIGHTS = 4;

export const LOCAL_LIGHT_GLSL = /* glsl */ `
uniform int uLocalCount;
uniform vec4 uLocalPositions[${LOCAL_LIGHTS}];
uniform vec4 uLocalColours[${LOCAL_LIGHTS}];
uniform vec4 uLocalParams[${LOCAL_LIGHTS}];

vec3 localLight(vec3 point, vec3 normal, float wrap) {
  vec3 total = vec3(0.0);
  for (int i = 0; i < ${LOCAL_LIGHTS}; i += 1) {
    if (i >= uLocalCount) break;
    vec3 toLight = uLocalPositions[i].xyz - point;
    float distance = length(toLight);
    float x = distance / max(uLocalPositions[i].w, 0.001);
    float fall = clamp(1.0 - x, 0.0, 1.0);
    /* x: 1 — спад игры (1 − x²)/(C + n·x²), y — n, z — C; 2 — спад огня three, как у ламп квартала из игры:
       окно по радиусу (1 − x⁴)² и 1/d^n, где n — y. */
    float attenuation;
    if (uLocalParams[i].x > 1.5) {
      float window = clamp(1.0 - x * x * x * x, 0.0, 1.0);
      attenuation = window * window / max(pow(distance, uLocalParams[i].y), 0.01);
    } else if (uLocalParams[i].x > 0.5) {
      attenuation = x < 1.0 ? (1.0 - x * x) / (uLocalParams[i].z + uLocalParams[i].y * x * x) : 0.0;
    } else {
      attenuation = fall * fall;
    }
    float facing = clamp((dot(normal, toLight / max(distance, 0.0001)) + wrap) / (1.0 + wrap), 0.0, 1.0);
    total += uLocalColours[i].rgb * attenuation * facing;
  }
  return total;
}
`;

/** Общие значения огней для всех материалов рисовальщика. */
export function createLocalLights() {
  return {
    uLocalCount: { value: 0 },
    uLocalPositions: { value: Array.from({ length: LOCAL_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uLocalColours: { value: Array.from({ length: LOCAL_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLocalParams: { value: Array.from({ length: LOCAL_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
}

/** Те же значения — в униформы материала. */
export function localLightUniforms(shared) {
  return {
    uLocalCount: shared.uLocalCount,
    uLocalPositions: shared.uLocalPositions,
    uLocalColours: shared.uLocalColours,
    uLocalParams: shared.uLocalParams,
  };
}

/**
 * Огни сцены: `[{ position: [x, y, z], range, colour: [r, g, b], model?, decay? }]`
 * (метры мира, цвет с силой; `model: { exponent, quadratic }` — спад лампы
 * игры; `decay` — показатель спада огня three, `range` тогда — его радиус:
 * так светят лампы квартала из игры, `lamp-swarm.js`). Лишние сверх четырёх
 * отбрасываются.
 */
export function writeLocalLights(shared, lights = []) {
  const list = (Array.isArray(lights) ? lights : []).slice(0, LOCAL_LIGHTS);
  shared.uLocalCount.value = list.length;
  list.forEach((light, index) => {
    const [x, y, z] = light.position;
    shared.uLocalPositions.value[index].set(x, y, z, Math.max(0.001, Number(light.range) || 1));
    const [r, g, b] = light.colour;
    shared.uLocalColours.value[index].set(r, g, b, 0);
    const model = light.model;
    if (Number.isFinite(light.decay)) shared.uLocalParams.value[index].set(2, light.decay, 1, 0);
    else shared.uLocalParams.value[index].set(model ? 1 : 0, Number(model?.exponent) || 0, Number(model?.quadratic) || 1, 0);
  });
}
