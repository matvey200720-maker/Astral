/*
 * Лампы настоящих столбов квартала из игры (задача 19 ТЗ 18.10.2026, поздний
 * вечер): кадры «Дорога», «Перекрёсток» и «Под мостом» ставят свет работы на
 * столбы и мачты светофоров самого квартала Davis — те, что стоят в секции
 * карты (`pieceMatrices` переходника квартала).
 *
 * Откуда лампа. Запись `LightAttributes` модели (положение и направление — в
 * кости `Bulb_Glass`, остальное — сила, радиус, показатель спада, конус, цвет)
 * приходит из описи ламп игрока (`readLampStudio`); кость в самой модели —
 * из скелетов (`STREET_BONES`, `scripts/prepare-lamp-heads.mjs`). Правка —
 * та же функция, что уедет в игру (`compileLampLight`): цвет, яркость,
 * дальность, мягкость края, «убрать свет совсем».
 *
 * Как светит. Прожектор three на каждую из ближайших ламп (`STREET_SLOTS`
 * штук, число постоянно: оно входит в шейдер каждого материала квартала),
 * силой, радиусом и спадом по тем же формулам, что у ламп Мега Молла
 * (`mega-mall-scene.js`): сила × 90 кд, радиус × 3, спад — показатель ÷ 64.
 * Ночь — доля из света таймцикла (`blockLighting`): лампы зажигаются на
 * закате и гаснут к утру, как в игре. Это упрощённый свет three, а не
 * калиброванное пятно и объём кадра «Фонарь» (`lamp-view.js`): точное пятно
 * на земле, луч и ореол — там; подпись кадра об этом говорит.
 *
 * Мост. Кадр «Под мостом» (мост шоссе над руслом реки в Сан-Педро) ставит свет
 * на лампы самого моста: они лежат в модели моста (`bridgeHeads`), и работа
 * правит их цвет (`bridgeStyle`, режимы «как фонари / свой цвет / как в игре»
 * — `bridgeColour` контракта), а силу, радиус и конус оставляет игре.
 *
 * Модуль без WebGL и без окна: числа и оси, их проверяет тест.
 */

import * as THREE from "three";
import {
  LAMP_LIGHT_MODEL,
  LIGHT_FLAGS,
  STREET_BONES,
  bridgeColour,
  compileLampLight,
  hexToRgb,
  lampGroupOf,
  lampRainbow,
  lampAttenuation,
  lampRainbowLead,
  normalizeLampProject,
} from "@modovik/street-light-contract/lamps";

/** Сколько ламп горит в кадре одновременно: ближайшие к глазу. */
export const STREET_SLOTS = 8;
/* Сила прожектора на единицу силы лампы игры, кд, и дальность на единицу радиуса — как у ламп Мега Молла. */
const CANDELA = 8;
const REACH = 3;
const MIN_REACH = 12;
/* Дальше этого лампа в кадре не нужна: прожектор слабеет до нуля раньше. */
const MAX_DISTANCE = 140;
const DEFAULT_CONE = 60;
const PENUMBRA = 0.45;

/*
 * Лампы эстакады светят по модели игры (`light-model.js` контракта): пятно
 * E = K · I · (1 − x²) / (C + n · x²), x = d / R, — а не по «мягкой» кривой
 * уличных столбов. Прожектор three гасит свет как d^−decay в окне до радиуса
 * (`distance`); модель игры к такому закону подгоняется (`gameFalloff`) с
 * среднеквадратичной ошибкой около 4 % на 0,3–0,97 радиуса (у краёв до 10 %), и за радиусом лампы света нет — как в
 * игре. Раньше трубка (радиус 14,8, показатель 8) светила по `decay = 0,5` на
 * 44 м, и восемь ближних ламп заливали весь настил белым.
 *
 * Пятно в игре меряется в долях ночного фона земли (K = 21,6 на единицу
 * силы). Фон кадра — освещённость сцены `BACKGROUND` (по лампе мачты Davis: её
 * 256 кд даёт на земле под ней то же, что даёт модель игры). Свет лампы от неба не
 * зависит, а общий свет — зависит: под настилом эстакады небо закрыто, и его в
 * кадре `UNDER_DECK_AMBIENT` от открытого (ставит кадр). Поэтому под трубками —
 * пятна с игровым спадом, а между ними — темнее, асфальт не белеет.
 */
export const UNDER_DECK_AMBIENT = 0.25;
const BACKGROUND = 0.5;
/* Радиус окна three — чуть за радиусом игры: на самом радиусе игра ещё светит. */
const FALLOFF_EDGE = 1.05;

const fits = new Map();

/**
 * Подгонка закона игры под прожектор three: `{ decay, distance, gain }`. `gain` —
 * сила прожектора на единицу силы лампы в долях фона (с учётом `R^decay`).
 * Показатель влияет на закон: n = 1 — почти ровный свет (decay 0,7), n ≥ 64 —
 * обратный квадрат; для трубок (n = 8) decay около 1,6.
 */
export function gameFalloff(falloff, exponent) {
  const radius = Math.max(Number(falloff) || 0, 0.1);
  const n = Math.max(Number(exponent) || 0, 1);
  const key = `${radius}|${n}`;
  const known = fits.get(key);
  if (known) return known;
  const decay = Math.max(0.7, 2 - Math.min(1.3, 2.8 / n));
  let sum = 0;
  let count = 0;
  for (let x = 0.3; x <= 0.97; x += 0.02) {
    const game = lampAttenuation(x * radius, radius, n);
    const edge = x / FALLOFF_EDGE;
    const fitted = (1 - edge ** 4) ** 2 / x ** decay;
    sum += Math.log(fitted / game);
    count += 1;
  }
  const value = Object.freeze({ decay, distance: radius * FALLOFF_EDGE, gain: Math.exp(-sum / count) * radius ** decay });
  fits.set(key, value);
  return value;
}

/* Кость лампы: у уличных столбов и мачт светофоров — стекло лампы (`Bulb_Glass`). */
export const LAMP_BONE = 29567;

const srgbToLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

/**
 * Лампы моделей группы «Улицы» из описи игрока: `[{ model, light, local: {
 * position, direction } }]` — точка и направление в осях модели игры (Z вверх).
 * Лампа «только ореол» и лампа без кости в скелете модели не берутся.
 */
export function streetLights(models) {
  const out = [];
  for (const item of models || []) {
    const model = String(item?.model || "");
    if (lampGroupOf(model) !== "street") continue;
    const bones = STREET_BONES[model];
    if (!bones) continue;
    for (const light of item.lights || []) {
      if ((Number(light.flags) >>> 0) & LIGHT_FLAGS.CORONA_ONLY) continue;
      if (!(Number(light.intensity) > 0)) continue;
      const bone = bones.find((entry) => entry[0] === (Number(light.bone) || LAMP_BONE));
      if (!bone) continue;
      const at = light.position || { x: 0, y: 0, z: 0 };
      const to = light.direction || { x: 0, y: 0, z: -1 };
      out.push({
        model,
        light,
        local: {
          position: [bone[1] + (Number(at.x) || 0), bone[2] + (Number(at.y) || 0), bone[3] + (Number(at.z) || 0)],
          direction: [Number(to.x) || 0, Number(to.y) || 0, Number(to.z) || 0],
        },
      });
    }
  }
  return out;
}

/*
 * Модель игры (X, Y, Z вверх) → модель сцены (X, Z, −Y): так модели квартала
 * лежат в бандлах GLB, и так `placementTransform` ставит их в сцену.
 */
const toScene = ([x, y, z]) => new THREE.Vector3(x, z, -y);

/**
 * Лампы на местах: `lights` — `streetLights`, `matricesOf(model)` — матрицы
 * экземпляров детали квартала (`pieceMatrices`). Ответ — `[{ model, light,
 * position: Vector3, direction: Vector3 }]` в осях сцены.
 */
export function lampHeads(lights, matricesOf) {
  const heads = [];
  const cache = new Map();
  for (const entry of lights) {
    if (!cache.has(entry.model)) cache.set(entry.model, matricesOf(entry.model) || []);
    for (const matrix of cache.get(entry.model)) {
      const position = toScene(entry.local.position).applyMatrix4(matrix);
      const direction = toScene(entry.local.direction).transformDirection(matrix);
      heads.push({ model: entry.model, light: entry.light, position, direction });
    }
  }
  return heads;
}

/**
 * Числа лампы по работе: цвет, сила, радиус, показатель, конус — то, что
 * получит лампа в игре (`compileLampLight`). «Убрать свет совсем» — сила 0.
 */
export function lampValues(light, project, palette = null) {
  const mutation = compileLampLight(light, project, { palette }) || {};
  const colour = mutation.color || light.color || { r: 255, g: 255, b: 255 };
  return {
    colour: [(Number(colour.r) || 0) / 255, (Number(colour.g) || 0) / 255, (Number(colour.b) || 0) / 255],
    intensity: Math.max(0, Number(mutation.intensity ?? light.intensity) || 0),
    falloff: Math.max(0, Number(mutation.falloff ?? light.falloff) || 0),
    exponent: Math.max(0, Number(mutation.falloffExponent ?? light.falloffExponent) || 0),
    cone: Number(light.coneOuterAngle) || 0,
  };
}

/** Работа → функция «лампа игры → её числа» (радуга работы считается по лампам игрока один раз). */
export function lampStyle(models, projectInput) {
  const project = normalizeLampProject(projectInput);
  const palette = lampRainbow(models, project);
  const cache = new Map();
  return (light) => {
    if (!cache.has(light)) cache.set(light, lampValues(light, project, palette));
    return cache.get(light);
  };
}

/**
 * Лампы моста на местах: `pieces` — `[{ light, matrices }]` (`scene.pieceLights`):
 * запись лампы из данных игры в осях детали и матрицы её экземпляров в осях
 * сцены. Берутся прожекторы — свет, что падает на опоры, настил и русло;
 * капсулы — свечение самой трубки, их пятна на земле нет.
 */
export function bridgeHeads(pieces) {
  const heads = [];
  for (const { light, matrices } of pieces || []) {
    if (String(light?.type || "").toLowerCase() !== "spot") continue;
    if (!(Number(light.intensity) > 0)) continue;
    for (const matrix of matrices || []) {
      const position = new THREE.Vector3(...(light.position || [0, 0, 0])).applyMatrix4(matrix);
      const direction = new THREE.Vector3(...(light.direction || [0, -1, 0])).transformDirection(matrix);
      heads.push({ model: "bridge", kind: "bridge", light, position, direction });
    }
  }
  return heads;
}

/**
 * Числа лампы моста по работе: цвет — `bridgeColour` («как фонари», «свой»;
 * «как в игре» оставляет цвет записи), сила, радиус, показатель и конус — из
 * записи игры. Сигнальный огонёк не перекрашивается (`isIndicatorLight`
 * контракта в игре ведёт себя так же; здесь берутся только прожекторы).
 */
export function bridgeStyle(models, projectInput) {
  const project = normalizeLampProject(projectInput);
  const hex = bridgeColour(project, { lead: lampRainbowLead(models, project) });
  const own = hex ? hexToRgb(hex) : null;
  return (light) => {
    const game = light.color || [255, 255, 255];
    const colour = own ? [own.r / 255, own.g / 255, own.b / 255] : [(Number(game[0]) || 0) / 255, (Number(game[1]) || 0) / 255, (Number(game[2]) || 0) / 255];
    return {
      colour,
      intensity: Math.max(0, Number(light.intensity) || 0),
      falloff: Math.max(0, Number(light.falloff) || 0),
      exponent: Math.max(0, Number(light.falloffExponent) || 0),
      cone: Number(light.coneOuterAngle) || 0,
    };
  };
}

/**
 * Цвет полосы трубок эстакады по работе: единичный цвет `[r, g, b]` (sRGB 0–1, максимум 1) — тот
 * самый `unit`, по которому установщик красит лист полосы (`tintGlass`, `lamp-bridges.js`), — или
 * `null` — «как в игре», штатный лист. Цвет — тот же `bridgeColour`, что у ламп эстакады и у установщика.
 */
export function bridgeStripTint(models, projectInput) {
  const project = normalizeLampProject(projectInput);
  const hex = bridgeColour(project, { lead: lampRainbowLead(models, project) });
  if (!hex) return null;
  const { r, g, b } = hexToRgb(hex);
  const target = [r, g, b].map((channel) => channel / 255);
  const peak = Math.max(...target, 1e-6);
  return target.map((channel) => channel / peak);
}

/**
 * Свет лампы кадра в формате `view.setLamps`: `head` — лампа на месте (`lampHeads`, `bridgeHeads`), `values` —
 * её числа по работе (`style`), `night` — доля ночи. Ту же лампу берёт рой частиц у столба
 * (`lamp-swarm.js`): частицы светятся тем же светом, что земля под лампой.
 */
export function lampLight(head, values, night) {
  const cone = values.cone > 1 && values.cone < 90 ? values.cone : DEFAULT_CONE;
  const target = head.position.clone().addScaledVector(head.direction, Math.max(2, values.falloff)).toArray();
  if (head.kind === "bridge") {
    /* Лампа эстакады: пятно по модели игры, фон — под настилом; конус игры — ступень от оси до внешнего угла (penumbra 1). */
    const fit = gameFalloff(values.falloff, values.exponent);
    return {
      position: head.position.toArray(),
      target,
      colour: values.colour.map(srgbToLinear),
      intensity: LAMP_LIGHT_MODEL.groundScale * BACKGROUND * values.intensity * fit.gain * night,
      distance: fit.distance,
      decay: fit.decay,
      angle: (cone * Math.PI) / 180,
      penumbra: 1,
    };
  }
  return {
    position: head.position.toArray(),
    target,
    colour: values.colour.map(srgbToLinear),
    intensity: values.intensity * CANDELA * night,
    distance: Math.max(MIN_REACH, values.falloff * REACH),
    decay: Math.max(0.5, values.exponent / 64),
    angle: (cone * Math.PI) / 180,
    penumbra: PENUMBRA,
  };
}

/**
 * Прожекторы кадра на глаз `eye` (Vector3) и ночь `night` (0 — день, 1 —
 * ночь): ближайшие `slots` ламп с силой, радиусом и спадом по лампе игры.
 * Формат — `view.setLamps` (`timecycle-block/block-view.js`). `style(light,
 * head)` отдаёт числа лампы; у голов моста `head.kind === "bridge"`.
 */
export function lampSlots({ heads, style, eye, night, slots = STREET_SLOTS, maxDistance = MAX_DISTANCE }) {
  if (!(night > 0.001) || !heads.length) return [];
  const limit = maxDistance * maxDistance;
  const near = [];
  for (const head of heads) {
    const distance = head.position.distanceToSquared(eye);
    if (distance <= limit) near.push({ head, distance });
  }
  near.sort((a, b) => a.distance - b.distance);
  const out = [];
  for (const { head } of near) {
    if (out.length >= slots) break;
    const values = style(head.light, head);
    if (!(values.intensity > 0)) continue;
    out.push(lampLight(head, values, night));
  }
  return out;
}
