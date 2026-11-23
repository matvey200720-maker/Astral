/*
 * Как подсветка выглядит в кадре — одна модель на плитки, обложку и 3D.
 *
 * В игре оболочка — полупрозрачная модель поверх укрытия с шейдером
 * `emissive`: её цвет — цвет текстуры, освещённый миром, плюс собственное
 * свечение (`emissiveMultiplier`), а поверх укрытия она ложится по альфе
 * текстуры. Кадр повторяет это в линейном свете:
 *
 *   укрытие  = материал × свет
 *   оболочка = цвет × (0,45 × свет + 0,55 × свечение)
 *   пиксель  = тон(экспозиция × смесь(укрытие, оболочка, альфа))
 *
 * Свет — солнце по Ламберту и окружение; экспозиция — привыкание глаза, как
 * у игры: ночью ярче. Поэтому та же оболочка днём — краска на стене, а ночью
 * светится. Тон — кривая ACES, как у кадров мастерской с HDR.
 *
 * Это модель, а не рендер GTA V: числа подобраны так, чтобы днём оболочка
 * ×1 читалась своим цветом, а ночью светилась. Подпись кадра так и говорит.
 */

import {
  normalizeWallbangProject,
  wallbangAlpha,
  wallbangEmissive,
  wallbangHexRgb,
  findWallbangObject,
} from "@modovik/climb-contract/wallbang";

export const WALLBANG_SCENES = Object.freeze([
  Object.freeze({ id: "day", label: "День" }),
  Object.freeze({ id: "dusk", label: "Сумерки" }),
  Object.freeze({ id: "night", label: "Ночь" }),
]);

/*
 * Свет времени суток. `sky` и `ground` — цвета кадра (sRGB), `sun` и
 * `ambient` — сила солнца и окружения, `exposure` — привыкание глаза.
 */
export const SCENE_LIGHT = Object.freeze({
  day: Object.freeze({
    sun: 1,
    ambient: 0.38,
    exposure: 1.05,
    sky: Object.freeze(["#86aee0", "#dbe5ef"]),
    ground: "#77736c",
  }),
  dusk: Object.freeze({
    sun: 0.34,
    ambient: 0.17,
    exposure: 1.9,
    sky: Object.freeze(["#27305c", "#d88f63"]),
    ground: "#56504b",
  }),
  night: Object.freeze({
    sun: 0.035,
    ambient: 0.05,
    exposure: 3.4,
    sky: Object.freeze(["#05070f", "#161d33"]),
    ground: "#3a3a3e",
  }),
});

/* Солнце сверху-слева-спереди (Z вверх, как у моделей игры). */
const SUN = [-0.46, -0.38, 0.8];
const SUN_LENGTH = Math.hypot(...SUN);
export const SUN_DIRECTION = Object.freeze(
  SUN.map((value) => value / SUN_LENGTH),
);

export const OVERLAY_LIT = 0.45;
export const OVERLAY_EMISSION = 0.55;

export const sceneOf = (id) => SCENE_LIGHT[id] || SCENE_LIGHT.day;

/* sRGB ↔ линейный свет. */
export const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = (value) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

/* Кривая ACES (Narkowicz), как у тонмаппинга three.js. */
export function aces(value) {
  const x = Math.max(0, value);
  return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

export const hexLinear = (hex) =>
  wallbangHexRgb(hex).map((value) => srgbToLinear(value / 255));

/**
 * Облик укрытия для кадра: цвет оболочки в линейном свете, альфа 0…1,
 * свечение, цвет самого укрытия. Скрытое — без оболочки.
 */
export function frameLook(input, id) {
  const project = normalizeWallbangProject(input);
  const item = project.objects[id];
  const object = findWallbangObject(id);
  const own = item?.own;
  const colour = own ? item.colour : project.look.colour;
  const opacity = own ? item.opacity : project.look.opacity;
  const visible = item?.visible !== false;
  return {
    visible,
    colour,
    overlay: hexLinear(colour),
    alpha: visible ? wallbangAlpha(opacity) / 255 : 0,
    emission: wallbangEmissive(project.look.glow),
    material: hexLinear(object?.material || "#8a8a8a"),
  };
}

/**
 * Цвет пикселя (sRGB 0…255) по освещённости грани `lambert` (0…1).
 * `out` — массив на три числа, чтобы плитки не плодили объектов.
 */
export function shadePixel(look, scene, lambert, out = [0, 0, 0]) {
  const light = sceneOf(scene);
  const lit = light.ambient + light.sun * lambert;
  const glow = OVERLAY_EMISSION * look.emission;
  for (let channel = 0; channel < 3; channel += 1) {
    const base = look.material[channel] * lit;
    const overlay = look.overlay[channel] * (OVERLAY_LIT * lit + glow);
    const mixed = base + (overlay - base) * look.alpha;
    out[channel] = Math.round(linearToSrgb(aces(mixed * light.exposure)) * 255);
  }
  return out;
}

/* Тот же расчёт на видеокарте — для 3D-кадра (`wallbang-scene.js`). */
export const LOOK_GLSL = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uSun;
  uniform float uAmbient;
  uniform float uExposure;
  vec3 wallbangAces(vec3 x) {
    x = max(x, vec3(0.0));
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 wallbangSrgb(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, step(value, vec3(0.0031308)));
  }
  vec3 wallbangShade(vec3 material, vec3 overlay, float alpha, float emission, float lambert) {
    float lit = uAmbient + uSun * lambert;
    vec3 base = material * lit;
    vec3 shell = overlay * (${OVERLAY_LIT.toFixed(2)} * lit + ${OVERLAY_EMISSION.toFixed(2)} * emission);
    return wallbangSrgb(wallbangAces(mix(base, shell, alpha) * uExposure));
  }
`;
