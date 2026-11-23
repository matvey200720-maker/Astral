/*
 * Сведение кадра таймцикла (задача 4Б ТЗ 18.10.2026): экспозиция, плёночная
 * кривая Хейбла с обоими наборами, свечение — числами, как их кладёт игра.
 *
 * Экспозиция — автомат игры (`PS_CalculateExposure` в postfx.fxc):
 * EV = scale · L^power + offset + postfx_exposure, в пределах
 * [postfx_exposure_min, postfx_exposure_max], множитель кадра 2^EV. L — средняя
 * яркость кадра. L берётся из модели кадра игры (`gameFrameLuminance`: половина
 * неба, половина земли, числа таймцикла), которая лежит на двенадцать часов
 * ванильного EXTRASUNNY с ошибкой 0,15–0,25 стопа, умноженной на поправку
 * `eyeLuminance`: во сколько раз квартал изменил среднюю яркость кадра против
 * неба без него. Простое среднее настоящего кадра, взятое вместо модели,
 * завышало яркость в 3–8 раз на рассвете и закате и ставило экспозицию на
 * 0,7–1,4 стопа ниже игры (сверка 18.10.2026), поэтому от настоящего кадра
 * берётся только поправка на содержимое. Проход глаза на видеочипе считает то же.
 *
 * Кривая — Хейбл (Uncharted 2): набор «ярко» при низкой EV, «темно» при высокой,
 * между ними смесь по EV, как в Composite игры. Наборы — из visualsettings.dat
 * (`Tonemapping.bright|dark.filmic.*`) или их замена таймциклом, когда у
 * кадра выставлен `postfx_tonemap_filmic_override_*` (`state.tonemap`).
 *
 * Модуль не знает WebGL: он отдаёт числа проходу сведения, а тест проверяет
 * их без видеокарты.
 */

import { GAME_EXPOSURE_MIN, GAME_EXPOSURE_OFFSET, gameFrameLuminance } from "@modovik/timecycle";
import { VISUAL_DEFAULTS, autoExposure } from "../../../components/desktop/workshop/ptfx/ptfx-lighting.js";

/*
 * Во сколько раз квартал в кадре может поменять среднюю яркость против неба без него:
 * белая стена и чёрная парковка не бросают экспозицию в крайности. Тот же предел — в
 * проходе глаза на видеочипе (`EXPOSURE_PASS`).
 */
export const CONTENT_RANGE = Object.freeze([1 / 8, 8]);

export const FILMIC_LETTERS = Object.freeze(["a", "b", "c", "d", "e", "f", "w"]);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Яркость кадра для глаза игры с кварталом.
 *
 * Простое среднее настоящего кадра на рассвете и закате завышает яркость в 3–8 раз против
 * игры (сверка 18.10.2026 с замком экспозиции по часам), а модель кадра игры
 * (`gameFrameLuminance`: числа таймцикла, ошибка 0,15–0,25 стопа) лежит на ней ровно. Поэтому
 * берётся модель, а от настоящего кадра — только поправка на то, во сколько раз квартал
 * изменил среднюю яркость против неба без него. Без квартала (`frame`/`reference` не заданы)
 * поправка единица, и кадр совпадает с плоским кадром неба. Шейдер повторяет эту формулу.
 *
 * @param {number} model — `gameFrameLuminance(state)`
 * @param {number} [frame] — средняя яркость кадра с кварталом
 * @param {number} [reference] — средняя яркость того же кадра без квартала
 */
export function eyeLuminance(model, frame = null, reference = null) {
  const measured = Number.isFinite(frame) && Number.isFinite(reference) && frame > 0 && reference > 0;
  const ratio = measured ? clamp(frame / reference, CONTENT_RANGE[0], CONTENT_RANGE[1]) : 1;
  return Math.max(model * ratio, 1e-6);
}

/** Одна точка кривой Хейбла — яркость до белой точки, 0…1 (то же, что делает шейдер сведения). */
export function filmicCurve(x, set) {
  const { a, b, c, d, e, f } = set;
  const curve = (value) => (value * (a * value + c * b) + d * e) / (value * (a * value + b) + d * f) - e / f;
  return clamp(curve(Math.max(x, 0)) / curve(set.w), 0, 1);
}

/**
 * Набор кривой: visualsettings игры или замена таймциклом.
 *
 * @param {"bright"|"dark"} kind
 * @param {object} [tone] — `state.tonemap`: `{ bright: { override, exposure, a…w }, dark: {…} }`
 * @param {object} visual — значения visualsettings.dat
 */
export function filmicSet(kind, tone, visual) {
  const own = tone?.[kind];
  const override = Boolean(own?.override);
  const pick = (letter) =>
    override && Number.isFinite(own[letter])
      ? own[letter]
      : visual[`Tonemapping.${kind}.filmic.${letter.toUpperCase()}`];
  const set = Object.fromEntries(FILMIC_LETTERS.map((letter) => [letter, pick(letter)]));
  set.exposure =
    override && Number.isFinite(own.exposure) ? own.exposure : visual[`Tonemapping.${kind}.filmic.exposure`];
  return set;
}

/** Доля набора «темно» при экспозиции `ev`: 0 — целиком «ярко», 1 — целиком «темно». */
export function darkShare(ev, bright, dark) {
  const span = dark.exposure - bright.exposure;
  return span > 0 ? clamp((ev - bright.exposure) / span, 0, 1) : 0;
}

/**
 * Числа глаза игры для прохода экспозиции на видеочипе: те же, что берёт `framePost`.
 * Шейдер повторяет `autoExposure` и `darkShare` по этим значениям, поэтому
 * тест сверяет `framePost` с ними, а не с копией формулы.
 */
export function eyeParameters({ state, visual = {} }) {
  const values = { ...VISUAL_DEFAULTS, ...visual };
  const bright = filmicSet("bright", state?.tonemap, values);
  const dark = filmicSet("dark", state?.tonemap, values);
  return {
    curve: [
      values["Exposure.curve.scale"],
      values["Exposure.curve.power"],
      values["Exposure.curve.offset"],
      Number(state?.exposure) || 0,
    ],
    limit: [
      Number.isFinite(Number(state?.exposureMin)) ? Number(state.exposureMin) : GAME_EXPOSURE_MIN,
      Number.isFinite(Number(state?.exposureMax)) ? Number(state.exposureMax) : 5,
    ],
    sets: [bright.exposure, dark.exposure],
    bright,
    dark,
    values,
  };
}

/** Набор кривой как две четвёрки для шейдера: (a, b, c, d) и (e, f, w, 0). */
export function filmicVectors(set) {
  return [
    [set.a, set.b, set.c, set.d],
    [set.e, set.f, set.w, 0],
  ];
}

/**
 * Сведение кадра.
 *
 * @param {object} input
 * @param {object} input.state — `resolveSkyState`
 * @param {object} [input.visual] — visualsettings.dat игрока поверх штатных
 * @param {number} [input.frameLuminance] — средняя яркость настоящего кадра до экспозиции; без неё — модель
 * @returns {{
 *   ev: number, stops: number, exposure: number, share: number,
 *   filmic: object, saturation: number,
 *   bloom: { threshold: number, knee: number, intensity: number, blend: number[] },
 *   source: "frame"|"model", luminance: number,
 * }}
 */
export function framePost({ state, visual = {}, frameLuminance = null }) {
  const { curve, limit, bright, dark, values } = eyeParameters({ state, visual });
  const measured = Number.isFinite(frameLuminance) && frameLuminance > 0;
  const luminance = measured ? frameLuminance : gameFrameLuminance(state);
  const ev = autoExposure(luminance, {
    scale: curve[0],
    power: curve[1],
    offset: curve[2],
    bias: curve[3],
    min: limit[0],
    max: limit[1],
  });
  const share = darkShare(ev, bright, dark);
  const filmic = {};
  for (const letter of FILMIC_LETTERS) filmic[letter] = bright[letter] + (dark[letter] - bright[letter]) * share;
  /* Поправка кадра игры (0,25 стопа) подобрана к модели кадра; у измеренной яркости её нет. */
  const stops = ev + (measured ? 0 : GAME_EXPOSURE_OFFSET);
  return {
    ev,
    stops,
    exposure: 2 ** stops,
    share,
    filmic,
    bright,
    dark,
    saturation: Number.isFinite(Number(state?.saturation)) ? Number(state.saturation) : 1,
    bloom: {
      /* Порог — «Порог блума» таймцикла: правка в редакторе должна менять кадр; без него — visualsettings. */
      threshold: Number.isFinite(Number(state?.bloomThreshold)) ? Number(state.bloomThreshold) : values["bloom.threshold.min"],
      knee: values["bloom.threshold.power"] || 1,
      intensity: Number.isFinite(Number(state?.bloomIntensity)) ? Number(state.bloomIntensity) : 0.2,
      blend: [
        values["bloom.blurblendmult.small"],
        values["bloom.blurblendmult.med"],
        values["bloom.blurblendmult.large"],
      ],
    },
    source: measured ? "frame" : "model",
    luminance,
  };
}

/** Яркость пикселя после сведения (0…1) — по ней проверяют кадр на засвет и провал. */
export function displayLevel(radiance, post) {
  const value = Math.max(radiance, 0) * post.exposure;
  return filmicCurve(value, post.filmic) ** (1 / 2.2);
}
