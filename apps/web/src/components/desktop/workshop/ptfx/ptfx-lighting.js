/*
 * Свет сцены частиц — таймцикл и visualsettings.dat игры, в тех же
 * единицах, что у шейдеров GTA V.
 *
 * `ptfx_sprite` освещает частицу константами `lighting_globals`: солнце
 * (направление по часу и `light_dir_col × light_dir_mult`), естественное
 * окружение как градиент по вертикали нормали (снизу `light_natural_amb_down`,
 * сверху `light_natural_amb_up`) и направленное окружение
 * (`light_directional_amb_*`). Числа приходят из игры игрока (`light` базы
 * эффектов: таймцикл ясной погоды и ключи visualsettings.dat); чего там нет —
 * берётся из эталонного таймцикла Astral и штатных значений visualsettings.
 *
 * Экспозиция — автомат игры (`PS_CalculateExposure` в postfx.fxc):
 * EV = scale · L^power + offset + postfx_exposure, в пределах
 * [postfx_exposure_min, postfx_exposure_max], множитель 2^EV. L — средняя
 * яркость кадра; кадра игры у окна нет, поэтому L считается для «серого
 * мира» под этим же светом: альбедо 0.2, половина — земля, половина — стены,
 * треть поверхностей в тени. Плёночная кривая — набор «ярко» или «темно» из
 * visualsettings.dat (или его замена таймциклом), смешанный по EV, как в игре.
 */

import {
  celestialDirections,
  referenceKeyframeDocument,
  sampleAtHour,
} from "@modovik/timecycle";

/* Штатные значения visualsettings.dat GTA V Legacy (update.rpf). */
export const VISUAL_DEFAULTS = Object.freeze({
  "Tonemapping.bright.filmic.A": 0.22,
  "Tonemapping.bright.filmic.B": 0.3,
  "Tonemapping.bright.filmic.C": 0.1,
  "Tonemapping.bright.filmic.D": 0.2,
  "Tonemapping.bright.filmic.E": 0.01,
  "Tonemapping.bright.filmic.F": 0.3,
  "Tonemapping.bright.filmic.W": 4,
  "Tonemapping.bright.filmic.exposure": -0.5,
  "Tonemapping.dark.filmic.A": 0.22,
  "Tonemapping.dark.filmic.B": 0.3,
  "Tonemapping.dark.filmic.C": 0.1,
  "Tonemapping.dark.filmic.D": 0.2,
  "Tonemapping.dark.filmic.E": 0,
  "Tonemapping.dark.filmic.F": 0.3,
  "Tonemapping.dark.filmic.W": 4,
  "Tonemapping.dark.filmic.exposure": 3,
  "Exposure.curve.scale": -106.2,
  "Exposure.curve.power": 0.007,
  "Exposure.curve.offset": 104.7,
  "bloom.threshold.min": 0.4,
  "bloom.threshold.power": 1,
  "bloom.blurblendmult.large": 0.5,
  "bloom.blurblendmult.med": 2,
  "bloom.blurblendmult.small": 1,
  "particles.shadowintensity": 0.5,
});

/* «Серый мир» для автомата экспозиции. */
const GREY_WORLD = Object.freeze({ albedo: 0.2, shadowed: 1 / 3 });

/* Гамма сведения: в Composite это `pow(x, Gamma)`, Gamma = 1/2.2 по умолчанию. */
const DISPLAY_GAMMA = 2.2;

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function referenceValues(weather) {
  try {
    const document = referenceKeyframeDocument(weather);
    return document.regions[0]?.values || {};
  } catch {
    return referenceKeyframeDocument("EXTRASUNNY").regions[0]?.values || {};
  }
}

/** Средняя яркость «серого мира» под солнцем и небом — вход автомата. */
export function greyWorldLuminance({ sun, sunHeight, up, down }) {
  const lit = 1 - GREY_WORLD.shadowed;
  const height = clamp(sunHeight, 0, 1);
  const ground = sun * height * lit + up;
  const walls = (sun * Math.sqrt(1 - height * height) * lit) / Math.PI + (up + down) / 2;
  return GREY_WORLD.albedo * (ground + walls) * 0.5;
}

/** Автомат экспозиции игры: EV по средней яркости кадра. */
export function autoExposure(sceneLuminance, { scale, power, offset, bias = 0, min = -3.5, max = 5 }) {
  const ev = scale * Math.max(sceneLuminance, 1e-6) ** power + offset + bias;
  return clamp(ev, min, max);
}

/**
 * Свет, экспозиция и кривая для рисовальщика частиц.
 *
 * `light` — `{ weather, values, visual }` из базы эффектов (таймцикл и
 * visualsettings.dat игрока), может отсутствовать; `hour` — час суток.
 */
export function sceneLighting({ light = null, hour = 13 } = {}) {
  const weather = light?.weather || "EXTRASUNNY";
  const reference = referenceValues(weather);
  const game = light?.values || {};
  const visual = { ...VISUAL_DEFAULTS, ...(light?.visual || {}) };
  const read = (name, fallback = 0) => {
    const row = Array.isArray(game[name]) ? game[name] : reference[name];
    return Array.isArray(row) && row.length ? sampleAtHour(row, hour) : fallback;
  };
  const rgb = (name) => [read(`${name}_r`, 1), read(`${name}_g`, 1), read(`${name}_b`, 1)];
  const scaled = (colour, intensity) => colour.map((value) => value * intensity);

  const { sun: toSun } = celestialDirections(hour);
  const sunColour = scaled(rgb("light_dir_col"), read("light_dir_mult", 1));
  const natural = read("natural_ambient_multiplier", 1) || 1;
  const down = scaled(
    rgb("light_natural_amb_down_col"),
    read("light_natural_amb_down_intensity", 1) * natural,
  );
  const up = scaled(
    rgb("light_natural_amb_up_col"),
    read("light_natural_amb_up_intensity", 1) *
      (read("light_natural_amb_up_intensity_mult", 1) || 1) *
      natural,
  );
  const directional = scaled(
    rgb("light_directional_amb_col"),
    read("light_directional_amb_intensity", 1) *
      (read("light_directional_amb_intensity_mult", 1) || 1),
  );

  const sceneLuminance = greyWorldLuminance({
    sun: toSun.z > 0 ? luminance(sunColour) : 0,
    sunHeight: toSun.z,
    up: luminance(up),
    down: luminance(down),
  });
  const ev = autoExposure(sceneLuminance, {
    scale: visual["Exposure.curve.scale"],
    power: visual["Exposure.curve.power"],
    offset: visual["Exposure.curve.offset"],
    bias: read("postfx_exposure", 0),
    min: read("postfx_exposure_min", -3.5),
    max: read("postfx_exposure_max", 5),
  });

  /* Кривая: «ярко» при низкой EV, «темно» при высокой, между — смесь. */
  const curveSet = (kind) => {
    const override =
      kind === "bright"
        ? read("postfx_tonemap_filmic_override_bright", 0) > 0
        : read("postfx_tonemap_filmic_override_dark", 0) > 0;
    const suffix = kind === "bright" ? "_bright" : "";
    const pick = (letter) =>
      override
        ? read(`postfx_tonemap_filmic_${letter}${suffix}`, 0)
        : visual[`Tonemapping.${kind}.filmic.${letter.toUpperCase()}`];
    return {
      a: pick("a"),
      b: pick("b"),
      c: pick("c"),
      d: pick("d"),
      e: pick("e"),
      f: pick("f"),
      w: pick("w"),
      exposure: override
        ? read(`postfx_tonemap_filmic_exposure${suffix || "_dark"}`, 0)
        : visual[`Tonemapping.${kind}.filmic.exposure`],
    };
  };
  const bright = curveSet("bright");
  const dark = curveSet("dark");
  const span = dark.exposure - bright.exposure;
  const mix = span > 0 ? clamp((ev - bright.exposure) / span, 0, 1) : 0;
  const filmic = {};
  for (const letter of ["a", "b", "c", "d", "e", "f", "w"])
    filmic[letter] = bright[letter] + (dark[letter] - bright[letter]) * mix;

  return {
    sun: { direction: [-toSun.x, -toSun.y, -toSun.z], colour: sunColour },
    ambient: {
      /* Градиент: (N.z + 1) · 0.5 — от «снизу» к «сверху». */
      gradient: [up[0] - down[0], up[1] - down[1], up[2] - down[2], 1],
      base: [down[0], down[1], down[2], 0.5],
      directional,
      directionalAxis: [toSun.x, toSun.y, toSun.z],
    },
    post: {
      ev,
      exposure: 2 ** ev,
      sceneLuminance,
      filmic,
      gamma: DISPLAY_GAMMA,
      /* Порог яркой точки — «Порог блума» таймцикла, как у кадра неба (`timecycle-block`): прежние 0,4 из
         visualsettings заливали светом всю светлую ткань под солнцем. Нет в таймцикле — штатный. */
      bloomThreshold: read("postfx_bright_pass_thresh", visual["bloom.threshold.min"]),
      bloomKnee: visual["bloom.threshold.power"] || 1,
      bloomIntensity: read("postfx_intensity_bloom", 0.2),
      bloomBlend: [
        visual["bloom.blurblendmult.small"],
        visual["bloom.blurblendmult.med"],
        visual["bloom.blurblendmult.large"],
      ],
    },
    particleShadow: visual["particles.shadowintensity"],
    /* Множитель свечения частиц таймцикла (particle_emissive_intensity_mult). */
    particleEmissive: read("particle_emissive_intensity_mult", 1),
  };
}
