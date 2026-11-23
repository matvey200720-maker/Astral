/*
 * Что показывает кадр фонаря — по работе и по лампам игрока.
 *
 * Кадр не считает свет заново: он берёт те же правки, что уедут в игру
 * (`compileLampLight` контракта), и применяет их к лампе уличного фонаря
 * игрока — `prop_streetlight_01`, самого частого на улицах Лос-Сантоса. Не
 * прочитали игру — его же числа из описи Legacy. Сила, радиус, показатель,
 * объём и ореол после правки — ровно те, что запишет помощник, а как они
 * выглядят, решает модель света, снятая с игры (`lamp-view.js`).
 */

import {
  LIGHT_FLAGS,
  LIGHT_RAINBOW,
  POLE_STOCK,
  RAINBOW_COLOURS,
  bridgeColour,
  compileLampLight,
  effectiveMotion,
  hexToRgb,
  lampParticlesActive,
  lampRainbow,
  normalizeLampProject,
  particleTemplate,
  poleColourFor,
  poleMeanColour,
} from "@modovik/street-light-contract/lamps";

/* Лампа prop_streetlight_01 из описи Legacy — когда игра не прочитана. */
export const REFERENCE_LAMP = Object.freeze({
  model: "prop_streetlight_01",
  list: "fragment",
  index: 0,
  type: "spot",
  flags: 0x580,
  bone: 29567,
  color: Object.freeze({ r: 255, g: 104, b: 0 }),
  intensity: 32,
  falloff: 18,
  falloffExponent: 96,
  coneOuterAngle: 70,
  corona: Object.freeze({ intensity: 0.1, size: 3 }),
  volume: Object.freeze({ intensity: 1, sizeScale: 1 }),
});

/*
 * Стекло штатного фонаря — натриевое пятно его текстуры (снято с модели:
 * оранжево-жёлтое, светится шейдером с множителем 16). Сила — в линейных
 * единицах сцены: ночью глаз открыт, и стекло горит почти белым с цветной
 * каймой свечения, как в игре.
 */
const VANILLA_GLASS = Object.freeze([1, 0.55, 0.08]);
const GLASS_STRENGTH = 2.2;

const rgbOf = (color) => [
  (Number(color?.r) || 0) / 255,
  (Number(color?.g) || 0) / 255,
  (Number(color?.b) || 0) / 255,
];

/** Лампа уличного фонаря игрока (`models` из базы) или из описи Legacy. */
export function previewLamp(models = null) {
  const model = (models || []).find((item) => item?.model === REFERENCE_LAMP.model);
  const light = (model?.lights || []).find(
    (item) => !((Number(item.flags) >>> 0) & LIGHT_FLAGS.CORONA_ONLY) && Number(item.intensity) > 0,
  );
  return light ? { ...REFERENCE_LAMP, ...light, coneOuterAngle: light.coneOuterAngle || 70 } : REFERENCE_LAMP;
}

/*
 * Радуга кадра: цвет главного фонаря — по подписи его лампы, дальние огни —
 * остальные цвета спектра, чтобы было видно, что у каждого вида свой.
 */
function rainbowColours(models, project, lamp) {
  const palette = lampRainbow(models?.length ? models : [{ model: REFERENCE_LAMP.model, lights: [lamp] }], project);
  const own = palette?.get(`${Math.round(lamp.falloff * 10) / 10}|${Math.round(lamp.falloffExponent * 10) / 10}`);
  const rest = RAINBOW_COLOURS.filter((colour) => colour !== own);
  return { own: own || RAINBOW_COLOURS[0], rest, palette };
}

/**
 * Вид кадра: главная лампа (цвет, сила, радиус, показатель, конус, луч,
 * стекло), ореол, цвета дальних огней, частицы для плиток.
 */
export function lampLook(input, models = null) {
  const project = normalizeLampProject(input);
  const base = previewLamp(models);
  const rainbow = project.light.colour === LIGHT_RAINBOW ? rainbowColours(models, project, base) : null;
  const palette = rainbow?.palette || null;
  const mutation = compileLampLight(base, project, { palette }) || {};
  const colourBytes = mutation.color || base.color;
  const colour = rgbOf(colourBytes);
  /* «Убрать свет совсем»: лампа не светит, ореола и луча нет, стекло тёмное,
     дальние огни — чёрные (то же, что уедет в игру). */
  const off = project.light.off;
  const glassColour = off ? [0, 0, 0] : project.light.colour ? colour : [...VANILLA_GLASS];
  const flags = Number(base.flags) >>> 0;
  const beamOn = !off && (project.beam.on || Boolean(flags & LIGHT_FLAGS.DRAW_VOLUME));
  const lamp = {
    colour,
    intensity: mutation.intensity ?? Number(base.intensity),
    falloff: mutation.falloff ?? Number(base.falloff),
    falloffExponent: mutation.falloffExponent ?? Number(base.falloffExponent),
    coneOuterAngle: Number(base.coneOuterAngle) || 70,
    beam: beamOn
      ? {
          intensity: mutation.volumeIntensity ?? Number(base.volume?.intensity ?? 1),
          size: mutation.volumeSizeScale ?? Number(base.volume?.sizeScale ?? 1),
        }
      : null,
    glass: glassColour.map((value) => value * GLASS_STRENGTH),
  };
  const corona = {
    on: project.glare.on && !off,
    intensity: project.glare.on && !off ? mutation.coronaIntensity ?? Number(base.corona?.intensity ?? 0.1) : 0,
    size: mutation.coronaSize ?? Number(base.corona?.size ?? 3),
  };
  /* Радуга в кадре: дальний ряд той же улицы — тот же вид фонаря и тот же
     цвет, ряд через дорогу — другие виды, другие цвета спектра. */
  const distantColours = off
    ? [[0, 0, 0]]
    : rainbow
      ? [colour, colour, colour, colour, ...rainbow.rest.slice(0, 3).map((hex) => rgbOf(hexToRgb(hex)))]
      : [colour];
  const template = particleTemplate(project.particles.template);
  const particles = lampParticlesActive(project)
    ? {
        template: template.id,
        /* Как летят — выбранное движение (кружат, падают, парят), а не
           родное шаблона: плитка и обложка показывают то, что уедет в игру. */
        kind: effectiveMotion(template, project.particles.motion),
        colour: rgbOf(hexToRgb((template.colourable && project.particles.colour) || template.colour || "#FFFFFF")),
        size: project.particles.size / 100,
        opacity: project.particles.opacity / 100,
        density: project.particles.density / 100,
      }
    : null;
  /* Лампы под мостами и в тоннелях — цвет фонарей (у радуги — цвет главного
     фонаря), свой цвет или цвет игры (`null`). */
  const bridge = { on: project.bridge.on, hex: bridgeColour(project, { lead: rainbow?.own || null }) };
  return {
    lamp,
    corona,
    distantColours,
    particles,
    bridge,
    pole: poleLook(project),
    traffic: bodyLook(project, PREVIEW_TRAFFIC_KIND),
  };
}

/*
 * Столб кадра — `prop_streetlight_01`, вид «Городские»: краска (средний цвет
 * листа после той же краски, что уедет в игру, `poleMeanColour`), блеск,
 * непрозрачность и украшение (`null` — без него). Светофор кадра — вид
 * «Светофоры»: своя краска, тот же блеск и прозрачность, украшений нет
 * (их нет у светофоров и в игре — `poleJobFor`).
 */
export const PREVIEW_POLE_KIND = "city";
export const PREVIEW_TRAFFIC_KIND = "traffic";

/* Корпус вида: «как в игре» у вида — без краски, блеска и прозрачности,
   как и в игре (`poleJobFor` такому виду ничего не заказывает). */
function bodyLook(project, kind) {
  const pole = project.pole;
  const stock = pole.kinds?.[kind] === POLE_STOCK;
  const hex = poleColourFor(pole, kind);
  return {
    hex,
    paint: hex ? poleMeanColour(hex, pole.shade) : null,
    metal: stock ? 1 : pole.metal / 100,
    opacity: stock ? 1 : pole.opacity / 100,
  };
}

function poleLook(project) {
  const pole = project.pole;
  return {
    ...bodyLook(project, PREVIEW_POLE_KIND),
    decor: pole.decor.on && pole.kinds?.[PREVIEW_POLE_KIND] !== POLE_STOCK ? { ...pole.decor } : null,
  };
}

/** Короткий отпечаток вида — ключ перерисовки и плиток. */
export function lookKey(look) {
  return JSON.stringify(look, (key, value) =>
    typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
  );
}
