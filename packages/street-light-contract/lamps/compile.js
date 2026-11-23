/*
 * Работа фонарей → правки файлов игры.
 *
 * Чистые функции: вход — работа и то, что установщик прочитал из игры
 * игрока (свет моделей, строки таблиц), выход — точные правки. Ни одна
 * функция не пишет файлов и не зовёт помощника: так каждое число проверяется
 * тестом, а окно показывает то, что уедет в игру, тем же кодом.
 *
 * ЧТО ПРАВИТСЯ
 *
 *  • Свет моделей фонарей (`LightAttributes` в .yft/.ydr): цвет, сила,
 *    радиус, показатель затухания, ореол (corona), объём луча и флаг
 *    DRAW_VOLUME. Помощник меняет в ресурсе ровно эти байты
 *    (`lamp-studio-patch`); стекло лампы — встроенная текстура её
 *    светящегося шейдера — перекрашивается в цвет света теми же правилами
 *    «на месте», иначе зелёный фонарь светил бы из оранжевого стекла (так и
 *    было — снято в игре 28.09.2026).
 *  • Огни вдали (`lodlights_*.ymap` + `distlodlights_*.ymap`): игра рисует
 *    фонари за сотню метров не моделями, а точками LOD-света с ТЕМ ЖЕ цветом.
 *    Без них фонарь менял бы цвет на подъезде. Уличные огни помечены в файле
 *    самой игрой (бит 24 флагов времени и состояния; в парном файле их
 *    ровно `numStreetLights` — сверено на живом lodlights_medium013: 577 и
 *    577).
 *  • Дорожные огни (`visualsettings.dat`, `distantlights.streetlight.*`):
 *    цепочки фонарей вдоль трасс, видные через полкарты.
 *  • Частицы — клон правила ядра + строка entityfx.dat + расширение у
 *    архетипов ламп (см. `particles.js`).
 *
 * Как числа лампы выглядят в игре — `light-model.js` (замеры на живой игре);
 * здесь от них зависят поправка силы, направление «мягкости» и луч.
 */

import { hexToRgb, LIGHT_RAINBOW, lampSignature, rainbowPalette } from "./palette.js";
import { lampParticlesActive, normalizeLampProject } from "./project.js";
import { CROSSING_LOD_SIGNATURES, lampGroupOf } from "./families.js";
import { bridgeColour } from "./bridges.js";
import { BRIDGE_LOD_POINTS } from "./bridge-lod-points.js";
import { LAMP_LIGHT_MODEL, lampCompensation } from "./light-model.js";
import {
  BUTTERFLY_DONOR,
  BUTTERFLY_SHEET,
  BUTTERFLY_VARIANTS,
  CUSTOM_TEMPLATE,
  CUSTOM_TEXTURE,
  DONOR_PLAYBACK,
  LAMP_FX_PREFIX,
  LAMP_FX_RULE,
  LAMP_FX_TAG,
  PARTICLE_LOOK_SHEETS,
  customMotion,
  effectiveMotion,
  particleMotion,
  particleTemplate,
} from "./particles.js";

/*
 * Флаги LightAttributes, которые трогает редактор. Биты сверены по файлам
 * игры: у ламп с собственным цветом внешнего объёма стоит 0x80000, у двух
 * рисующих объём ламп ванили — 0x1000; лампы «только ореол» (второй
 * светильник prop_streetlight_02, огни промзон) несут 0x8000.
 */
export const LIGHT_FLAGS = Object.freeze({
  DRAW_VOLUME: 0x1000,
  CORONA_ONLY: 0x8000,
  USE_VOLUME_OUTER_COLOUR: 0x80000,
});

/* Сила LOD-огня в байте I пары distlodlights — сила лампы × 5.3125 с
   отбрасыванием дробной части: 32 → 170, 16 → 85, 8 → 42, 4 → 21 (живые
   значения того же файла). */
export const LOD_INTENSITY_SCALE = 5.3125;

/*
 * Показатель типичного уличного фонаря — по нему считается поправка силы
 * огней вдали: правило для них одно на все пары, а у штатных уличных ламп
 * показатель 96–128.
 */
export const LOD_REFERENCE_EXPONENT = 96;

const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/*
 * ЛУЧ
 *
 * Объём игры светит как VI·I² (замер: VI ×4 = I ×2 до пикселя) внутри шара
 * радиуса R·VS. «Плотность» задаёт VI для опорной силы 32 (штатный уличный
 * фонарь), и сила объёма пересчитывается под силу лампы после правки:
 * поэтому луч одинаково виден у сильного и у слабого фонаря и становится
 * ярче вместе с «Яркостью» — линейно, а не в квадрате. «Ширина» — размер
 * шара: 100 % — половина радиуса лампы, у уличного фонаря это конус до
 * земли; при размере 1 (прежнее значение) шар накрывал человека у фонаря, и
 * воздух вокруг становился сплошной дымкой — снято в игре.
 */
export const BEAM_REFERENCE_INTENSITY = 32;
export const BEAM_MAX_VOLUME_INTENSITY = 100;

/** Плотность луча 5…100 % → VI для опорной силы. Кривая выпуклая: 55 % ≈ 0,12. */
export function beamIntensity(density) {
  return round(0.3 * Math.pow(clamp(density, 0, 100) / 100, 1.5), 4);
}

/** Ширина 40…200 % → размер шара объёма в радиусах лампы. */
export function beamSize(width) {
  return round((0.5 * clamp(width, 10, 400)) / 100, 3);
}

/*
 * Мягкость края. В игре показатель затухания — сила спада (`light-model.js`):
 * маленький даёт ровное пятно с резким краем у радиуса, большой — яркий
 * центр и плавный спад. Поэтому «мягче» УМНОЖАЕТ показатель, «жёстче» —
 * делит. Прежде было наоборот, и «мягкость 140 %» в игре делала край жёстче.
 */
export function softenedExponent(exponent, softness) {
  const base = Number(exponent) > 0 ? Number(exponent) : 8;
  return round(clamp(base * (clamp(softness, 10, 1000) / 100), 1, LAMP_LIGHT_MODEL.maxExponent), 3);
}

const rgbFloat = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return [round(r / 255, 4), round(g / 255, 4), round(b / 255, 4)];
};

/**
 * Цвет лампы по работе: `#RRGGBB` или `null` («как в игре»). У радуги цвет
 * даёт подпись лампы в палитре работы.
 */
export function lampColourFor(light, project, palette = null) {
  const colour = project.light.colour;
  if (!colour) return null;
  if (colour !== LIGHT_RAINBOW) return colour;
  return palette?.get(lampSignature(light)) || null;
}

/*
 * «Убрать свет совсем» (ТЗ 17.10.2026, вечер): лампа не светит — сила, ореол и
 * луч нулевые. Цвет, дальность и край не трогаем: светить нечему. Правка по
 * одной лампе, как и остальные: у ламп, где всё уже нулевое, её нет.
 */
function compileLampOff(light) {
  const flags = Number(light.flags) >>> 0;
  const mutation = {};
  if (Number(light.intensity) !== 0) mutation.intensity = 0;
  if (Number((light.corona || {}).intensity) !== 0) mutation.coronaIntensity = 0;
  const volume = Number((light.volume || {}).intensity);
  if (flags & LIGHT_FLAGS.DRAW_VOLUME || volume > 0) mutation.volumeIntensity = 0;
  return Object.keys(mutation).length ? mutation : null;
}

/** Стекло погашенной лампы — чёрное: плафон не светится ночью. */
export const LAMP_OFF_GLASS = "#000000";

/**
 * Правка одной лампы по работе или `null`, если менять нечего. `light` —
 * лампа из описи помощника (`lamp-studio-inspect`), `palette` — радуга работы
 * (`rainbowPalette` всех ламп, которые правятся).
 */
export function compileLampLight(light, input, { palette = null } = {}) {
  const project = normalizeLampProject(input);
  if (project.light.off) return compileLampOff(light);
  const { intensity, range, softness } = project.light;
  const flags = Number(light.flags) >>> 0;
  const coronaOnly = (flags & LIGHT_FLAGS.CORONA_ONLY) !== 0;
  const mutation = {};

  const colour = lampColourFor(light, project, palette);
  if (colour) {
    const rgb = hexToRgb(colour);
    const current = light.color || {};
    if (current.r !== rgb.r || current.g !== rgb.g || current.b !== rgb.b) mutation.color = rgb;
    if (flags & LIGHT_FLAGS.USE_VOLUME_OUTER_COLOUR) mutation.volumeOuterColor = rgb;
  }

  /* Радиус и показатель — у светящих ламп; сила подгоняется так, чтобы под
     лампой свет остался тем, что задала «Яркость». */
  const before = { falloff: Number(light.falloff), falloffExponent: Number(light.falloffExponent) };
  const after = { ...before };
  if (!coronaOnly) {
    if (range !== 100) after.falloff = round(clamp(before.falloff * (range / 100), 0.1, 250));
    if (softness !== 100) after.falloffExponent = softenedExponent(before.falloffExponent, softness);
    if (after.falloff !== before.falloff) mutation.falloff = after.falloff;
    if (after.falloffExponent !== before.falloffExponent) mutation.falloffExponent = after.falloffExponent;
  }
  const compensation = coronaOnly ? 1 : lampCompensation(before, after);
  const scale = (intensity / 100) * compensation;
  const newIntensity = round(clamp(Number(light.intensity) * scale, 0, 1000));
  if (Math.abs(scale - 1) > 1e-6 && newIntensity !== Number(light.intensity)) mutation.intensity = newIntensity;

  const corona = light.corona || {};
  if (!project.glare.on) {
    /* Блик выключен — ореола нет ни у одной лампы, и у «только ореол» тоже:
       в игре он проступает у дальних фонарей звездой, и ровно это человек
       просил убрать. Стекло лампы светится и без него. */
    if (Number(corona.intensity) !== 0) mutation.coronaIntensity = 0;
  } else {
    if (project.glare.strength !== 100)
      mutation.coronaIntensity = round(clamp(Number(corona.intensity) * (project.glare.strength / 100), 0, 100));
    if (project.glare.size !== 100)
      mutation.coronaSize = round(clamp(Number(corona.size) * (project.glare.size / 100), 0, 100));
  }

  /* Луч рисуют только светящие лампы: у ламп «только ореол» объёма нет —
     им нечего освещать. Выключенный луч не трогает лампу вовсе: у двух
     штатных ламп с объёмом он остаётся, как их задумала Rockstar. */
  if (project.beam.on && !coronaOnly) {
    if (!(flags & LIGHT_FLAGS.DRAW_VOLUME)) mutation.flagsSet = LIGHT_FLAGS.DRAW_VOLUME;
    const lampIntensity = Math.max(newIntensity, 0.01);
    mutation.volumeIntensity = round(
      clamp(
        beamIntensity(project.beam.density) * (intensity / 100) * (BEAM_REFERENCE_INTENSITY / lampIntensity) ** 2,
        0,
        BEAM_MAX_VOLUME_INTENSITY,
      ),
    );
    mutation.volumeSizeScale = beamSize(project.beam.width);
  }

  return Object.keys(mutation).length ? mutation : null;
}

/*
 * Самый частый фонарь улиц Лос-Сантоса: его вид получает первый цвет
 * радуги, и им же красятся цепочки огней вдоль трасс (visualsettings) —
 * иначе трасса светила бы цветом редкой модели с восемью лампами.
 */
export const RAINBOW_LEAD_MODEL = "prop_streetlight_01";

/** Радуга работы по лампам моделей из описи или `null`, если цвет не радуга. */
export function lampRainbow(models, input) {
  const project = normalizeLampProject(input);
  if (project.light.colour !== LIGHT_RAINBOW) return null;
  const lights = [];
  let lead = null;
  for (const model of models || []) {
    if (!lampGroupOf(model.model)) continue;
    for (const light of model.lights || []) {
      lights.push(light);
      if (!lead && model.model === RAINBOW_LEAD_MODEL && !((Number(light.flags) >>> 0) & LIGHT_FLAGS.CORONA_ONLY))
        lead = lampSignature(light);
    }
  }
  return rainbowPalette(lights, lead);
}

/*
 * Стекло модели — в цвет её света: у радуги — в цвет первой светящей лампы
 * модели. «Как в игре» стекло не трогает.
 */
function glassColour(model, project, palette) {
  /* Погашенный свет: стекло чёрное — кроме мачт светофоров, чьё стекло и
     сигналы не трогаем (красный остаётся красным). */
  if (project.light.off) return /^prop_traffic_/.test(model.model) || !(model.lights || []).length ? null : LAMP_OFF_GLASS;
  if (!project.light.colour) return null;
  const lights = (model.lights || []).filter((light) => !((Number(light.flags) >>> 0) & LIGHT_FLAGS.CORONA_ONLY));
  const first = lights[0] || (model.lights || [])[0];
  return first ? lampColourFor(first, project, palette) : null;
}

/**
 * Правки моделей: `models` — опись помощника `[{ model, entry, lights }]`.
 * Модели без правок в ответ не попадают — установщик не переписывает то,
 * что осталось как было. `glass` — цвет стекла модели (`#RRGGBB`) или
 * `null`.
 */
export function compileLampModels(models, input) {
  const project = normalizeLampProject(input);
  const palette = lampRainbow(models, project);
  const result = [];
  for (const model of models || []) {
    const group = lampGroupOf(model.model);
    if (!group) continue;
    const mutations = [];
    for (const light of model.lights || []) {
      const mutation = compileLampLight(light, project, { palette });
      if (mutation) mutations.push({ list: light.list, index: light.index, ...mutation });
    }
    const glass = glassColour(model, project, palette);
    if (mutations.length || glass)
      result.push({ model: model.model, entry: model.entry, group, mutations, glass });
  }
  return result;
}

/*
 * Поправка силы огней вдали под дальность и мягкость — та же, что у ламп
 * моделей, для типичного уличного показателя.
 */
function lodCompensation(project) {
  const before = { falloff: 1, falloffExponent: LOD_REFERENCE_EXPONENT };
  const after = {
    falloff: project.light.range / 100,
    falloffExponent: clamp(LOD_REFERENCE_EXPONENT * (project.light.softness / 100), 1, 128),
  };
  return lampCompensation(before, after);
}

/** Первый цвет радуги работы — цвет самого частого фонаря улиц. */
export function lampRainbowLead(models, input) {
  const palette = lampRainbow(models, input);
  return palette?.size ? palette.values().next().value : null;
}

/* Огонь вдали лампы под мостом совпадает с её мировой точкой до сантиметров;
   0,6 м — запас на округление точек в контракте. */
export const BRIDGE_LOD_RADIUS = 0.6;

/**
 * Правило огней вдали. `null` — огни вдали не трогаются. `models` — опись
 * ламп (нужна радуге: огонь вдали узнаёт свой вид по радиусу и показателю,
 * `palette` — `[{ falloff, exponent, color }]`).
 *
 * `signatures` — подписи ламп светофоров: их огни вдали правятся, как
 * уличные, хотя бита улицы у них нет. `extra` — огни вдали ламп под мостами
 * и в тоннелях по месту (`BRIDGE_LOD_POINTS`), у них меняется только цвет.
 */
export function compileLodRule(input, models = null) {
  const project = normalizeLampProject(input);
  /* Свет убран совсем: огни вдали гаснут у всех уличных ламп и у ламп на
     мачтах светофоров. Лампы под мостами — отдельный инструмент, их не трогаем. */
  if (project.light.off)
    return { streetOnly: true, intensityScale: 0, coronaScale: 0, signatures: CROSSING_LOD_SIGNATURES.map((item) => ({ ...item })) };
  const rule = {};
  if (project.light.colour === LIGHT_RAINBOW) {
    const palette = lampRainbow(models, project);
    if (palette?.size) {
      rule.palette = [...palette.entries()].map(([signature, colour]) => {
        const [falloff, exponent] = signature.split("|").map(Number);
        return { falloff, exponent, color: hexToRgb(colour) };
      });
      rule.color = rule.palette[0].color;
    }
  } else if (project.light.colour) rule.color = hexToRgb(project.light.colour);
  const scale = (project.light.intensity / 100) * lodCompensation(project);
  if (Math.abs(scale - 1) > 1e-6) rule.intensityScale = round(scale);
  if (project.light.range !== 100) rule.falloffScale = round(project.light.range / 100);
  if (project.light.softness !== 100) rule.exponentScale = round(project.light.softness / 100);
  if (!project.glare.on) rule.coronaScale = 0;
  else if (project.glare.strength !== 100) rule.coronaScale = round(project.glare.strength / 100);
  if (Object.keys(rule).length) rule.signatures = CROSSING_LOD_SIGNATURES.map((item) => ({ ...item }));
  const bridge = bridgeColour(project, { lead: lampRainbowLead(models, project) });
  if (bridge) rule.extra = { color: hexToRgb(bridge), points: [...BRIDGE_LOD_POINTS], radius: BRIDGE_LOD_RADIUS };
  return Object.keys(rule).length ? { streetOnly: true, ...rule } : null;
}

/** Цвет огня вдали по правилу: у радуги — ближайшая подпись палитры. */
export function lodColourFor(light, rule) {
  if (rule.palette?.length) {
    let best = rule.palette[0];
    let bestScore = Infinity;
    for (const entry of rule.palette) {
      const score =
        Math.abs(Math.log(Math.max(Number(light.falloff), 0.01) / Math.max(entry.falloff, 0.01))) +
        Math.abs(Math.log(Math.max(Number(light.falloffExponent), 0.01) / Math.max(entry.exponent, 0.01)));
      if (score < bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best.color;
  }
  return rule.color || null;
}

/** Правка одного LOD-огня по правилу — та же арифметика, что у помощника. */
export function applyLodRule(light, rule) {
  const next = { ...light };
  const colour = lodColourFor(light, rule);
  if (colour) next.color = { ...colour };
  if (rule.intensityScale !== undefined)
    next.intensity = Math.min(255, Math.floor(Number(light.intensity) * rule.intensityScale));
  if (rule.falloffScale !== undefined)
    next.falloff = round(clamp(Number(light.falloff) * rule.falloffScale, 0.1, 250));
  if (rule.exponentScale !== undefined)
    next.falloffExponent = round(clamp(Number(light.falloffExponent) * rule.exponentScale, 1, 128), 3);
  if (rule.coronaScale !== undefined)
    next.coronaIntensity = Math.min(255, Math.round(Number(light.coronaIntensity) * rule.coronaScale));
  return next;
}

/*
 * Дорожные огни в visualsettings.dat. Цвет — доли канала, как у самой игры
 * (1.0 / 0.47 / 0.03 — тот же натрий 255,120,8). Сила — множитель штатной.
 * У радуги цепочки вдоль трасс — цвета самого частого вида фонарей.
 */
export const DISTANT_STREET_KEYS = Object.freeze({
  red: "distantlights.streetlight.color.red",
  green: "distantlights.streetlight.color.green",
  blue: "distantlights.streetlight.color.blue",
  intensity: "distantlights.streetlight.HDRIntensity",
});

export function compileDistantLights(input, baseIntensity, models = null) {
  const project = normalizeLampProject(input);
  const values = {};
  /* Свет убран совсем: цепочки огней вдоль трасс гаснут, цвет им незачем. */
  if (project.light.off) {
    if (Number.isFinite(Number(baseIntensity))) values[DISTANT_STREET_KEYS.intensity] = 0;
    return values;
  }
  let colour = project.light.colour;
  if (colour === LIGHT_RAINBOW) colour = lampRainbow(models, project)?.values().next().value || null;
  if (colour) {
    const [r, g, b] = rgbFloat(colour);
    values[DISTANT_STREET_KEYS.red] = r;
    values[DISTANT_STREET_KEYS.green] = g;
    values[DISTANT_STREET_KEYS.blue] = b;
  }
  const base = Number(baseIntensity);
  const scale = (project.light.intensity / 100) * lodCompensation(project);
  if (Math.abs(scale - 1) > 1e-6 && Number.isFinite(base))
    values[DISTANT_STREET_KEYS.intensity] = round(base * scale, 3);
  return values;
}

/* ---------- частицы ---------- */

/*
 * Где и сколько рождается у лампы (`spawn` и `domain` шаблона): доноры
 * Rockstar заданы для куста, камеры или погоды — у снега игры густоту даёт
 * код погоды, у пыли в свете область в 28 см, у бабочек сфера в четверть
 * метра. Густота работы умножает и рождения, и предел живых частиц.
 */
const SPAWN_RATE = "ptxEmitterRule:m_spawnRateOverTimeKFP";

function placementKeyframes(template, density, glow = 1) {
  const rows = [];
  if (template.emissive != null) {
    const value = round(template.emissive * glow, 3);
    rows.push({ scope: "particle", prop: "ptxu_Colour:m_emissiveIntensityKFP", values: [[0, value, value, 0, 0]] });
  }
  if (template.sizeScalar) {
    const size = template.sizeScalar;
    rows.push({ scope: "emitter", prop: "ptxEmitterRule:m_sizeScalarKFP", values: [[0, size, size, size, 100]] });
  }
  if (template.spawn) {
    const [low, high, alive] = template.spawn;
    rows.push({
      scope: "emitter",
      prop: SPAWN_RATE,
      values: [
        [
          0,
          round(low * density, 3),
          round(high * density, 3),
          alive ? clamp(Math.round(alive * density), 1, 64) : 0,
          0,
        ],
      ],
    });
  }
  if (template.domain) {
    const [x, y, z] = template.domain.size;
    rows.push({ scope: "emitter", prop: "ptxCreationDomain:m_sizeOuterKFP", values: [[0, x, y, z, 0]] });
    if (template.domain.lift)
      rows.push({
        scope: "emitter",
        prop: "ptxCreationDomain:m_positionKFP",
        values: [[0, 0, 0, template.domain.lift, 0]],
      });
  }
  return rows;
}

/* Своё у шаблонов сверх места: мерцание светлячков, размер пылинок, ход снега. */
const TEMPLATE_KEYFRAMES = Object.freeze({
  /*
   * Погодный снег игры летит бураном: ускорение вниз 5–6 м/с² при затухании
   * 0,5–1,3 и шум скорости до 5 м/с — хлопья проносятся мимо лампы за
   * полсекунды, а предел живых забит теми, что давно ушли под землю. У фонаря
   * снег падает около метра в секунду и покачивается: за жизнь донора
   * (8–10 с) хлопья как раз долетают до земли с высоты уличной лампы.
   */
  snow: () => [
    { scope: "particle", prop: "ptxu_Acceleration:m_xyzMinKFP", values: [[0, 0, 0, -1.2, 0]] },
    { scope: "particle", prop: "ptxu_Acceleration:m_xyzMaxKFP", values: [[0, 0, 0, -1, 0]] },
    { scope: "particle", prop: "ptxu_Noise:m_velNoiseMinKFP", values: [[0, 0.5, 0.5, 0.4, 0]] },
    { scope: "particle", prop: "ptxu_Noise:m_velNoiseMaxKFP", values: [[0, 1, 1, 0.6, 0]] },
  ],
  fireflies: (rgb, alpha, glow = 1) => [
    { scope: "emitter", prop: "ptxEmitterRule:m_particleLifeKFP", values: [[0, 4, 7, 0.01, 0.01]] },
    { scope: "emitter", prop: "ptxEmitterRule:m_sizeScalarKFP", values: [[0, 100, 100, 100, 100]] },
    { scope: "particle", prop: "ptxu_Size:m_whdMinKFP", values: [[0, 0.05, 0.05, 0, 0]] },
    { scope: "particle", prop: "ptxu_Size:m_whdMaxKFP", values: [[0, 0.1, 0.1, 0, 0]] },
    { scope: "particle", prop: "ptxu_Colour:m_rgbaMinKFP", values: blink(rgb, alpha, 0) },
    { scope: "particle", prop: "ptxu_Colour:m_rgbaMaxKFP", values: blink(rgb, alpha, 0.12) },
    {
      scope: "particle",
      prop: "ptxu_Colour:m_emissiveIntensityKFP",
      values: [[0, round(3 * glow, 3), round(4.5 * glow, 3), 0, 0]],
    },
  ],
});

/*
 * Шаблоны, чьи кадры не зависят от донора: светлячок задаёт размер кадра в
 * метрах и мерцание цветом — на любом движении он тот же. Снег правит ход
 * своего донора (ускорение и шум бурана) — его числа живут только с ним.
 */
const PORTABLE_KEYFRAMES = new Set(["fireflies"]);

/*
 * Скорость: темп эмиттера донора × доля. У доноров без своего темпа
 * свойство пустое — это единица; заполняется одним кадром.
 */
const PLAYBACK = "ptxEmitterRule:m_playbackRateScalarKFP";

function speedKeyframes(donor, speed) {
  if (speed === 100) return [];
  const base = DONOR_PLAYBACK[donor] ?? 1;
  const value = round(base * (speed / 100), 4);
  const rest = DONOR_PLAYBACK[donor] != null ? 0.01 : value;
  return [{ scope: "emitter", prop: PLAYBACK, values: [[0, value, rest, rest, rest]] }];
}

/*
 * Слои вида на чужом движении: у каждого слоя — донор движения и лист вида
 * под именем Astral вместо листа донора. Бабочки несут по строке крыльев на
 * слой (пёстрый рой — три), остальные — один лист вида. Кадры: листы-взмахи
 * листаются там, где донор листает (`animates`), разные частицы на
 * листающем доноре держат один кадр — иначе лепесток менял бы форму на лету.
 */
function movedLayers(template, motion, custom) {
  const look = template.look;
  const frames = (animated) =>
    !animated && motion.animates
      ? { frameMin: look.frames[0], frameMax: look.frames[0], lastFrame: look.frames[0] }
      : { frameMin: look.frames[0], frameMax: look.frames[1], lastFrame: look.frames[1] };
  if (look.wings)
    return look.wings.map((variantId) => {
      const own = custom ? "neutral" : variantId;
      return {
        donor: motion.donor,
        variant: own,
        sheet: null,
        swap: { texture: BUTTERFLY_VARIANTS[own].texture, donorTexture: motion.texture, ...frames(look.animate) },
      };
    });
  const sheet = PARTICLE_LOOK_SHEETS[look.sheet];
  return [
    {
      donor: motion.donor,
      variant: null,
      sheet,
      swap: { texture: sheet.texture, donorTexture: motion.texture, ...frames(look.animate) },
    },
  ];
}

/* Мерцание светлячка: кадры цвета за жизнь частицы — вспыхнул, притух,
   вспыхнул снова. `phase` сдвигает вторую дорожку, чтобы рой не мигал
   хором: игра выбирает каждой частице долю между нижними и верхними кадрами. */
function blink([r, g, b], alpha, phase) {
  const a = (value) => round(clamp(value * alpha, 0, 1), 3);
  const t = (value) => round(clamp(value + phase, 0.01, 0.99), 3);
  return [
    [0, r, g, b, 0],
    [t(0.12), r, g, b, a(1)],
    [t(0.3), r, g, b, a(0.2)],
    [t(0.48), r, g, b, a(1)],
    [t(0.66), r, g, b, a(0.15)],
    [t(0.82), r, g, b, a(0.9)],
    [1, r, g, b, 0],
  ].filter((row, index, rows) => index === 0 || row[0] > rows[index - 1][0]);
}

/**
 * Частицы работы для установщика или `null`. Возвращает:
 *  • `clone` — заказ клона (одно правило, слои) в той форме, которую
 *    принимают и помощник (`ypt-texture-patch`), и сборка клона окна
 *    (`buildEffectClone` из `@modovik/ptfx-runtime`): кадр показывает тот
 *    же клон, что уедет в игру;
 *  • `textures` — листы, которые установщик соберёт сам: перекрашенные
 *    бабочки (из листа ядра игрока, `recolour.js`) и своя картинка человека
 *    (`custom: true`, по отпечатку `asset`);
 *  • `clipSheets` — строки их сеток для ptxclipregions.dat;
 *  • `entityFx` — строка таблицы;
 *  • `extension` — что дописать архетипам ламп.
 */
export function compileLampParticles(input) {
  const project = normalizeLampProject(input);
  if (!lampParticlesActive(project)) return null;
  const settings = project.particles;
  const template = particleTemplate(settings.template);
  const groups = project.light.groups.filter((id) => id === "street" || id === "wall");
  if (!groups.length) return null;

  const own = template.id === CUSTOM_TEMPLATE;
  const motionId = effectiveMotion(template, settings.motion);
  /* Родное движение — прежний клон байт в байт; чужое — донор движения. */
  const moved = !own && motionId !== template.motion && Boolean(template.look);
  const motion = own ? customMotion(motionId) : moved ? particleMotion(motionId) : null;
  const custom = template.colourable && settings.colour ? settings.colour : null;
  /* У своей картинки место и размер — от выбранного движения, свечение — от
     шаблона: фотографию ночью должно быть видно. У вида на чужом движении
     место — от движения, а размер пересчитан так, чтобы частица осталась
     своего размера на чужом доноре (у светлячка размер в его же кадрах). */
  const placement = own
    ? { ...template, spawn: motion.spawn, domain: motion.domain, sizeScalar: motion.sizeScalar }
    : moved
      ? {
          ...template,
          spawn: motion.spawn,
          domain: motion.domain,
          sizeScalar: template.look.apparent ? round((template.look.apparent / motion.size) * 100, 1) : undefined,
        }
      : template;
  const sourceLayers = own
    ? [{ donor: motion.donor, variant: null }]
    : moved
      ? movedLayers(template, motion, custom)
      : template.layers;
  const alpha = settings.opacity / 100;
  const textures = new Map();
  const grids = new Map();
  const layers = sourceLayers.map((layer) => {
    const tune = {};
    /* Свой цвет бабочек — нейтральный лист плюс цвет кадров, у любого
       шаблона бабочек; без своего цвета — лист варианта (голубые, алые) или
       родной лист монархов. */
    const butterfly = !own && !moved && layer.donor === BUTTERFLY_DONOR;
    const variantId = moved ? layer.variant : custom && butterfly ? "neutral" : layer.variant;
    const variant = variantId ? BUTTERFLY_VARIANTS[variantId] : null;
    if (variant) {
      textures.set(variant.texture, { texture: variant.texture, variant: variantId, sheet: BUTTERFLY_SHEET });
      grids.set(variant.texture, { columns: BUTTERFLY_SHEET.columns, rows: 1 });
    }
    if (layer.sheet) {
      const { texture, source, sourceRows, row, columns, rows } = layer.sheet;
      textures.set(texture, {
        texture,
        copy: { source, ...(Number.isInteger(row) ? { rows: sourceRows, row } : {}) },
      });
      grids.set(texture, { columns, rows });
    }
    if (own) {
      textures.set(CUSTOM_TEXTURE, { texture: CUSTOM_TEXTURE, custom: true, asset: settings.custom.asset });
      grids.set(CUSTOM_TEXTURE, { columns: 1, rows: 1 });
    }
    /* Цвет кадров: свой — всегда; у шаблонов «своего цвета» (светлячки,
       искры, листья) — их цвет, у остальных — родной цвет донора. Своя
       картинка без цвета — белые кадры: картинка летит своими цветами, а не
       цветом пыли или лепестков донора. Вид на чужом движении — тоже белые
       кадры (или цвет вида у лепестков и огоньков): кадры донора движения
       красили бы его своим цветом — бабочки на доноре лепестков стали бы
       розовыми. */
    const lookPaint =
      template.tint === "template" || template.look?.paint === "template" ? template.colour : "#FFFFFF";
    const paint = own
      ? custom || "#FFFFFF"
      : moved
        ? custom || lookPaint
        : custom || (template.tint === "template" ? template.colour : null);
    const density = clamp((template.density || 1) * (settings.density / 100), 0.1, 8);
    const ownKeyframes = !moved || PORTABLE_KEYFRAMES.has(template.id) ? TEMPLATE_KEYFRAMES[template.id] : null;
    const keyframes = [
      ...placementKeyframes(placement, density, settings.glow / 100),
      ...(ownKeyframes?.(paint ? rgbFloat(paint) : [1, 1, 1], alpha, settings.glow / 100) || []),
      ...speedKeyframes(layer.donor, settings.speed),
    ];
    if (template.id !== "fireflies") {
      /* У светлячка цвет и прозрачность уже в кадрах мерцания. */
      if (paint && (moved || !variant || variant.neutral)) tune.colour = rgbFloat(paint);
      else if (variant?.hue != null && !custom) {
        /* Перекрашенные крылья (морфо, алые) без своего цвета — белые
           кадры: тёплый оттенок донора (0,97; 0,80; 0,53), возведённый
           шейдером в квадрат, делал синих морфо бирюзовыми и в кадре, и в
           игре (задача 5 ТЗ 05.10.2026). */
        tune.colour = [1, 1, 1];
      }
      if (alpha < 1) tune.alphaScale = round(alpha, 3);
    }
    if (keyframes.length) tune.keyframes = keyframes;
    /* Шаблон без своего числа рождений — густота множителем донора. */
    if (!placement.spawn) tune.spawnScale = round(density, 3);
    if (settings.size !== 100)
      tune.scales = [{ prop: "ptxEmitterRule:m_sizeScalarKFP", factor: round(settings.size / 100, 3) }];
    /* Лампа на высоте семи–десяти метров: рой должен быть виден дальше
       тридцати пяти метров, заданных донору для куста у земли. */
    tune.cullDist = 70;
    tune.cullFade = 55;
    const entry = { donorEffect: layer.donor, tune };
    if (moved) entry.textures = [layer.swap];
    else if (variant) {
      entry.textures = [
        {
          texture: variant.texture,
          donorTexture: BUTTERFLY_SHEET.source,
          frameMin: 0,
          frameMax: BUTTERFLY_SHEET.columns - 1,
          lastFrame: BUTTERFLY_SHEET.columns - 1,
        },
      ];
    }
    if (own) entry.textures = [{ texture: CUSTOM_TEXTURE, donorTexture: motion.texture, frameMin: 0, frameMax: 0, lastFrame: 0 }];
    return entry;
  });

  return {
    template: template.id,
    motion: motionId,
    clone: { effect: LAMP_FX_RULE, layers },
    cloneReset: [LAMP_FX_PREFIX],
    textures: [...textures.values()],
    clipSheets: [...grids.entries()].map(([texture, grid]) => ({ texture, ...grid })),
    entityFx: entityFxRow(settings.night),
    extension: {
      fxName: LAMP_FX_TAG,
      groups,
      probability: settings.share,
    },
  };
}

/* ---------- entityfx.dat ---------- */

/*
 * Строка таблицы окружающих эффектов. Колонки — те же, что у штатных строк
 * (заголовок файла): TAG, словарь, правило, IGNORE ROT, ALWAYS, пороги
 * солнца/дождя/ветра, температура, часы, эволюции, вероятность ночью,
 * триггер. «Ночью» — как у штатных мотыльков `AMB_MOTHS_NIGHTTIME`: с 19 до
 * 6; «всегда» — как у бабочек мода: ALWAYS = 1 без порогов.
 */
export function entityFxRow(night = true) {
  const time = night ? ["19", "06"] : ["0", "0"];
  const always = night ? "0" : "1";
  return [
    LAMP_FX_TAG,
    "core",
    LAMP_FX_RULE,
    "0",
    always,
    "-1.0",
    "-1.0",
    "-1.0",
    "-100",
    "100",
    ...time,
    "0",
    "0",
    "10.0",
    "0.0",
    "0.0",
    "1.0",
    "0",
    "0.0",
    "0.0",
  ].join("\t");
}

const AMBIENT_START = "ENTITYFX_AMBIENT_PTFX_START";
const AMBIENT_END = "ENTITYFX_AMBIENT_PTFX_END";

/**
 * Ставит или снимает строку Astral в таблице игрока. Меняется только она:
 * остальные строки, комментарии, табуляция и переводы строк остаются байт
 * в байт. `row === null` — снять. Возвращает `{ text, changed }`.
 */
export function patchEntityFx(text, row) {
  const source = String(text ?? "");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === AMBIENT_START);
  const end = lines.findIndex((line, index) => index > start && line.trim() === AMBIENT_END);
  if (start < 0 || end < 0) throw new Error("В entityfx.dat нет раздела окружающих эффектов.");
  const ours = (line) => line.trimStart().startsWith(`${LAMP_FX_TAG}\t`) || line.trim() === LAMP_FX_TAG;
  const kept = lines.filter((line, index) => !(index > start && index < end && ours(line)));
  if (row !== null) {
    const closing = kept.findIndex((line, index) => index > start && line.trim() === AMBIENT_END);
    /* Перед закрывающей строкой раздела обычно стоит пустая строка с
       табуляцией — своя строка встаёт над ней, как последняя штатная. */
    let insert = closing;
    while (insert - 1 > start && !kept[insert - 1].trim()) insert -= 1;
    kept.splice(insert, 0, row);
  }
  const next = kept.join(eol);
  return { text: next, changed: next !== source };
}

/* ---------- расширения архетипов ---------- */

/**
 * Что дописать в описания пропов: у каждой модели выбранных групп — по
 * частице на лампу (не больше двух — у двухрожкового фонаря две головы).
 *
 * Точка — сама лампа, а не основание столба. У фонаря-фрагмента лампа стоит
 * в пространстве кости плафона (`bone` — её тег, позиция — от кости), и
 * расширение цепляется к той же кости: так Rockstar вешает на головы
 * фонарей искры и осколки стекла (тег 29567 у двадцати расширений ванили).
 * Сбитый машиной фонарь уносит рой с собой, а не оставляет его в воздухе.
 *
 * Имя тега в описании — строчными, как у штатных (`amb_moths_nighttime`):
 * таблица entityfx.dat пишет его прописными, игра сравнивает без регистра.
 */
export function compileLampExtensions(models, particles) {
  if (!particles) return [];
  const groups = new Set(particles.extension.groups);
  const result = [];
  for (const model of models || []) {
    const group = lampGroupOf(model.model);
    if (!group || !groups.has(group)) continue;
    const heads = (model.lights || [])
      .filter((light) => !((Number(light.flags) >>> 0) & LIGHT_FLAGS.CORONA_ONLY))
      .filter((light) => light.position)
      .map((light) => ({ ...light.position, bone: Number(light.bone) || 0 }));
    const unique = [];
    for (const point of heads) {
      const same = unique.some(
        (other) =>
          other.bone === point.bone &&
          Math.hypot(other.x - point.x, other.y - point.y, other.z - point.z) < 0.75,
      );
      if (same) continue;
      unique.push(point);
      if (unique.length === 2) break;
    }
    if (!unique.length) continue;
    result.push({
      archetype: model.model,
      points: unique.map((point) => ({
        x: round(point.x, 3),
        y: round(point.y, 3),
        z: round(point.z, 3),
        bone: point.bone,
      })),
      fxName: particles.extension.fxName.toLowerCase(),
      probability: particles.extension.probability,
    });
  }
  return result;
}
