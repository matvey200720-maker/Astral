/*
 * Вода кадра редактора «Вода» (задача 20 ТЗ 18.10.2026): числа для сведения кадра
 * (`timecycle-block/block-shaders.js`, блок «Вода») из работы человека.
 *
 * Море рисуется так же, как у игры (`PS_FogComposite`): гладь — плоскость на
 * уровне моря, глубина сцены говорит, сколько метров воды между ней и дном, и
 * дно гаснет в цвет толщи. Те же числа, что уедут в игру:
 *
 *   цвет толщи — плитки тумана воды (`waterScreenColour`: отмель → глубь, в
 *                точке карты, где стоит кадр); экран берёт цвет тумана квадратом —
 *                линейный свет — и солнце с небом таймцикла его освещают;
 *   прозрачность — на скольких метрах воды остаётся 10 % света (`waterVisibility`):
 *                T = exp(−κ·d), κ = ln 10 / видимость;
 *   под водой — подводные модификаторы (`underPreview`): цвет тумана и света, на
 *                сколько видно у берега, виньетка.
 *
 * Модуль без WebGL и без окна: числа в долях яркости кадра, их проверяет тест.
 */

import { waterVisibility } from "@modovik/climb-contract/recolor/water";
import { blockLighting } from "../timecycle-block/block-light.js";
import { underPreview, waterScreenColour } from "./water-text.js";

/* Точка карты, где стоит кадр: море у Венис-Бич (центр секции `venice-sea`). */
export const SEA_SITE = Object.freeze({ x: -1700, y: -1110 });

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
/* Над водой днём кадр темнее на столько ступеней экспозиции: белый песок и пена на полуденном солнце не пересвечиваются до белого. */
export const EXPOSURE_ABOVE = -1;
/* Экранный цвет 0…255 → линейный свет: игра берёт цвет тумана квадратом. */
const linear = (rgb) => rgb.map((value) => (clamp(value, 0, 255) / 255) ** 2);
const times = (rgb, light) => rgb.map((value, index) => value * light[index]);

/*
 * Поглощение по каналам: канал, у которого цвет воды сильнее, глохнет медленнее.
 * 0,35…1,5 вокруг единицы — вода цветная, но не чёрная.
 */
export function absorbFor(rgb) {
  const top = Math.max(...rgb, 1e-6);
  return rgb.map((value) => clamp(1.5 - 1.15 * (value / top), 0.35, 1.5));
}

/**
 * Свет, что падает на воду: `body` — солнце на высоту над горизонтом плюс небо (им
 * освещена толща), `sky` — одно небо (его отражает гладь: солнечный диск в кадре
 * не рисуется, а с ним отражение стало бы белым пятном). Выше единицы — это
 * яркость кадра, а не доля: тем же числом освещена и суша.
 */
export function waterLight(state) {
  const light = blockLighting(state);
  const lift = clamp(light.sun.direction[1], 0.12, 1);
  return {
    body: light.sun.radiance.map((value, index) => value * lift + light.hemisphere.sky[index]),
    sky: light.hemisphere.sky,
  };
}

/**
 * Числа воды на кадр.
 *
 * @param {object} input
 * @param {object} input.project — работа воды (`normalizeWaterProject`)
 * @param {object} input.looks — `compileWaterLooks(работа)`: море и озёра с реками
 * @param {object} input.state — небо на час (`resolveSkyState`)
 * @param {{ x: number, y: number }} [input.site] — где на карте стоит кадр (эффект «по карте» берёт цвет отсюда)
 */
export function waterFrameSpec({ project, looks, state, site = SEA_SITE }) {
  const { body: light, sky: skyLight } = waterLight(state);
  const sea = looks.sea;
  const at = (s) => times(linear(waterScreenColour(sea, s, site.x, site.y)), light);
  const shore = at(1);
  const mid = at(0.5);
  const deep = at(0);

  /* Солнце (ночью — луна): откуда светит, в осях игры, и чем; блик на ряби — только пока оно над горизонтом. */
  const lighting = blockLighting(state);
  const sunDirection = [lighting.sun.direction[0], -lighting.sun.direction[2], lighting.sun.direction[1]];

  /* Под водой: цвет тумана на яркость (вдвое тусклее — свет теряется в толще), свет — мягким оттенком. */
  const under = underPreview(project);
  const fogDisplay = under.fog.map((value) => clamp(value * 2.4, 0, 1));
  const fog = times(fogDisplay.map((value) => value * value), light).map((value) => value * 0.5);
  const lightTop = Math.max(...under.light, 1e-6);
  const tint = under.light.map((value) => 0.55 + 0.45 * (value / lightTop));

  return {
    /* Гладь — плоскость y = 0: сцена секции стоит на уровне моря. */
    level: 0,
    shore,
    mid,
    deep,
    kappa: Math.LN10 / Math.max(0.2, waterVisibility(sea.transparency)),
    absorb: absorbFor(mid),
    sky: skyLight.map((value) => value * 1.6),
    fog,
    tint,
    absorbUnder: absorbFor(fogDisplay),
    underKappa: Math.LN10 / Math.max(0.5, under.metres),
    vignette: clamp(under.vignette * 0.55, 0, 0.7),
    sun: sunDirection,
    sunColour: lighting.sun.radiance,
    /* Экспозиция кадра у воды, ступени: над водой днём — ниже (песок на солнце не белеет), к ночи — как есть (темнее некуда); под водой — как есть. */
    exposureAbove: EXPOSURE_ABOVE * (1 - lighting.night),
    exposureUnder: 0,
  };
}

/**
 * Числа воды без пропусков: каждое число конечное, каждый массив — из конечных чисел. Одно `NaN` в сведении кадра
 * закрашивает весь кадр (кислотный зелёно-жёлтый кадр при смене шаблона, П6.5), поэтому такое сведение кадру не уходит.
 */
export function finiteWaterSpec(spec) {
  if (!spec || typeof spec !== "object") return false;
  return Object.values(spec).every((value) => (Array.isArray(value) ? value.every(Number.isFinite) : Number.isFinite(value)));
}

/** Сведение на доле `k` пути от `from` к `to` (0…1): числа и массивы чисел; формы у сведений одинаковые. */
export function mixWaterSpec(from, to, k) {
  const out = {};
  for (const [name, target] of Object.entries(to)) {
    const start = from?.[name];
    if (Array.isArray(target)) out[name] = target.map((value, index) => (Array.isArray(start) && Number.isFinite(start[index]) ? start[index] + (value - start[index]) * k : value));
    else out[name] = Number.isFinite(start) ? start + (target - start) * k : target;
  }
  return out;
}
