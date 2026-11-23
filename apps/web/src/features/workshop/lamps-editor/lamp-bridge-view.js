/*
 * Кадр «Под мостом»: низ эстакады шоссе ночью и ряды длинных ламп-трубок
 * над головой.
 *
 * Так выглядят эстакады в центре Лос-Сантоса (`dt1_rd1_fwy03_*`,
 * `fwy_01_split_19_lights`): вдоль дороги под настилом тянутся ряды
 * люминесцентных трубок, и они же — пятна света на асфальте. Числа света —
 * из моделей самой игры (`BRIDGE_LIGHT` контракта): пятно вниз с силой 5 и
 * радиусом 14,8 у каждой трубки, свечение трубки — её цвет. Спад пятна —
 * модель света фонарей, снятая с живой GTA V (`light-model.js`).
 *
 * Сцена нарисована Astral: текстур и моделей Rockstar в поставке нет. Здесь
 * — эталон на процессоре (экспозиция, плитка вида); живой кадр рисует шейдер
 * `lamp-bridge-shader.js` теми же формулами.
 *
 * Мир — как у кадра фонаря: метры, ось Z вверх, камера смотрит вдоль +Y и
 * чуть вверх — на трубки над головой.
 */

import { BRIDGE_GAME_COLOUR, BRIDGE_LIGHT, LAMP_LIGHT_MODEL, hexToRgb } from "@modovik/street-light-contract/lamps";
import {
  CALIBRATION_LUMINANCE,
  LAMP_EXPOSURE,
  LAMP_NIGHT,
  asphaltGrain,
  cameraRay,
  lampCamera,
  tonemapLamp,
} from "./lamp-view.js";

/* Геометрия: настил, балки, ряды трубок, опоры, разметка. */
export const BRIDGE_SCENE = Object.freeze({
  deck: Object.freeze({ z: 7.2, y0: -60, y1: 170, halfWidth: 19 }),
  girders: Object.freeze([-17, -11.4, -5.6, 0, 5.6, 11.4, 17]),
  girderDepth: 0.75,
  girderWidth: 0.6,
  rows: Object.freeze([-8.5, -2.8, 2.8, 8.5]),
  tube: Object.freeze({ z: 6.2, radius: 0.06, length: 4.8, pitch: 10, y0: -40, y1: 160 }),
  pillars: Object.freeze({ x: Object.freeze([-16.5, 16.5]), pitch: 24, y0: -12, y1: 156, radius: 1.05 }),
  lanes: Object.freeze({
    dashed: Object.freeze([-7.2, -3.6, 3.6, 7.2]),
    edges: Object.freeze([-10.8, 10.8]),
    centre: 0.2,
    width: 0.15,
    dash: 3,
    period: 9,
  }),
  /* Пятно трубки: конус вниз, как у ламп эстакады. */
  spotCone: 58,
  spotExponent: 8,
  /* Свет светильника на бетоне вокруг него: доля силы и радиус пятна. */
  spill: 0.08,
  spillReach: 1.4,
  /* Камера поднята на трубки над головой. */
  pitch: 12,
});

/* Сколько светит сама трубка (яркость стекла в линейных единицах сцены). */
export const TUBE_GLOW = 1.3;

/* Разметка светлее асфальта: белая и жёлтая осевая. */
const MARK_WHITE = Object.freeze([2.6, 2.6, 2.6]);
const MARK_YELLOW = Object.freeze([2.4, 1.95, 0.8]);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Цвет трубок: работы или игры, линейно, в единицах калибровки. */
export function bridgeLightColour(hex) {
  const { r, g, b } = hexToRgb(hex || BRIDGE_GAME_COLOUR);
  return [r, g, b].map((value) => value / 255 / CALIBRATION_LUMINANCE);
}

const cosOuter = (degrees) =>
  Math.cos(Math.min(((degrees + LAMP_LIGHT_MODEL.coneMargin) * Math.PI) / 180, Math.PI / 2));

function attenuation(d, radius, exponent) {
  if (radius <= 0) return 0;
  const x = d / radius;
  if (x >= 1) return 0;
  return (1 - x * x) / (LAMP_LIGHT_MODEL.quadratic + Math.max(exponent, 0) * x * x);
}

function spotCone(cosTheta) {
  const outer = cosOuter(BRIDGE_SCENE.spotCone);
  const t = clamp((cosTheta - outer) / (1 - outer), 0, 1);
  return t ** LAMP_LIGHT_MODEL.conePower;
}

/* Центр трубки ряда, ближайшей к y. */
function nearestTubeY(y) {
  const { pitch, y0, y1 } = BRIDGE_SCENE.tube;
  const index = Math.round((y - y0) / pitch);
  return clamp(y0 + index * pitch, y0, y1);
}

/* Свет трубок на поверхности: пятна ближайших трубок каждого ряда. */
export function tubesOnSurface(scene, point, normal) {
  const out = [0, 0, 0];
  const { tube, rows } = BRIDGE_SCENE;
  const k = LAMP_LIGHT_MODEL.groundScale * LAMP_NIGHT.concreteLuminance * scene.intensity;
  const centre = nearestTubeY(point[1]);
  for (const x of rows)
    for (let step = -2; step <= 2; step += 1) {
      const y = centre + step * tube.pitch;
      if (y < tube.y0 - 1e-6 || y > tube.y1 + 1e-6) continue;
      const v = [x - point[0], y - point[1], tube.z - point[2]];
      const d = Math.hypot(...v);
      if (d < 1e-3) continue;
      const l = v.map((value) => value / d);
      const facing = l[0] * normal[0] + l[1] * normal[1] + l[2] * normal[2];
      if (facing <= 0) continue;
      const cone = spotCone(l[2]);
      if (cone <= 0) continue;
      const e = k * attenuation(d, scene.falloff, BRIDGE_SCENE.spotExponent) * cone * facing;
      for (let index = 0; index < 3; index += 1) out[index] += scene.colour[index] * e;
    }
  return out;
}

/*
 * Отражённый от асфальта свет под настилом — средний свет дороги (одно число
 * на сцену, чтобы низ настила не повторял пятна дороги кругами).
 */
function roadAverage(scene) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let x = -12; x <= 12; x += 1.5)
    for (let y = 0; y < BRIDGE_SCENE.tube.pitch; y += 1.25) {
      const light = tubesOnSurface(scene, [x, y, 0], [0, 0, 1]);
      for (let index = 0; index < 3; index += 1) sum[index] += light[index];
      count += 1;
    }
  return sum.map((value) => value / count);
}

/** Сцена кадра по цвету трубок (`look.bridge.hex`). */
export function bridgeScene(look) {
  const scene = {
    colour: bridgeLightColour(look?.bridge?.hex),
    intensity: BRIDGE_LIGHT.spot.intensity,
    falloff: BRIDGE_LIGHT.spot.falloff,
  };
  scene.bounce = roadAverage(scene);
  return scene;
}

/* Свет светильников на бетоне рядом с ними (низ настила и балок). */
function fixtureSpill(scene, point) {
  const { rows, tube, spill, spillReach } = BRIDGE_SCENE;
  const along = Math.max(0, Math.abs(point[1] - nearestTubeY(point[1])) - tube.length / 2);
  let sum = 0;
  for (const x of rows) {
    const d2 = (point[0] - x) ** 2 + along ** 2 + (point[2] - tube.z) ** 2;
    sum += 1 / (1 + d2 / (spillReach * spillReach));
  }
  return scene.colour.map((value) => value * spill * scene.intensity * sum);
}

/* Разметка под точкой дороги: множитель альбедо или null. */
function laneMark(x, y) {
  const { lanes } = BRIDGE_SCENE;
  const half = lanes.width / 2;
  if (lanes.edges.some((edge) => Math.abs(x - edge) <= half)) return MARK_WHITE;
  if (Math.abs(Math.abs(x) - lanes.centre) <= half) return MARK_YELLOW;
  const phase = ((y % lanes.period) + lanes.period) % lanes.period;
  if (phase < lanes.dash && lanes.dashed.some((line) => Math.abs(x - line) <= half)) return MARK_WHITE;
  return null;
}

/* Альбедо дороги: зерно асфальта (вдали — среднее, без ряби) и разметка. */
function roadAlbedo(point, distance) {
  const fade = Math.exp(-distance / 18);
  const grain = 0.93 + (asphaltGrain(point[0], point[1]) - 0.93) * fade;
  const mark = laneMark(point[0], point[1]);
  const markFade = Math.exp(-distance / 70);
  return [0, 1, 2].map((index) => grain * LAMP_NIGHT.asphalt * (mark ? 1 + (mark[index] - 1) * markFade : 1));
}

/* ---------- пересечения ---------- */

function hitPlaneZ(origin, dir, z) {
  if (Math.abs(dir[2]) < 1e-6) return Infinity;
  const t = (z - origin[2]) / dir[2];
  return t > 0 ? t : Infinity;
}

function hitVerticalCylinder(origin, dir, x, y, radius, z0, z1) {
  const ox = origin[0] - x;
  const oy = origin[1] - y;
  const a = dir[0] * dir[0] + dir[1] * dir[1];
  if (a < 1e-9) return Infinity;
  const b = ox * dir[0] + oy * dir[1];
  const c = ox * ox + oy * oy - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t <= 0) return Infinity;
  const z = origin[2] + dir[2] * t;
  return z >= z0 && z <= z1 ? t : Infinity;
}

/**
 * Линейный свет сцены вдоль луча — без экспозиции:
 * `{ colour: [r, g, b], distance }`.
 */
export function traceBridgeRay(scene, origin, dir) {
  const { deck, girders, girderDepth, girderWidth, pillars } = BRIDGE_SCENE;
  let t = hitPlaneZ(origin, dir, 0);
  let surface = Number.isFinite(t) ? "ground" : "sky";
  let normal = [0, 0, 1];

  /* Низ настила: плоскость на высоте настила в пределах эстакады. */
  const tDeck = hitPlaneZ(origin, dir, deck.z);
  if (tDeck < t) {
    const p = origin.map((value, index) => value + dir[index] * tDeck);
    if (p[1] >= deck.y0 && p[1] <= deck.y1 && Math.abs(p[0]) <= deck.halfWidth) {
      t = tDeck;
      surface = "deck";
      normal = [0, 0, -1];
    }
  }
  /* Балки: низ каждой — полоса ниже настила. */
  const tBeam = hitPlaneZ(origin, dir, deck.z - girderDepth);
  if (tBeam < t) {
    const p = origin.map((value, index) => value + dir[index] * tBeam);
    if (p[1] >= deck.y0 && p[1] <= deck.y1 && girders.some((x) => Math.abs(p[0] - x) <= girderWidth / 2)) {
      t = tBeam;
      surface = "deck";
      normal = [0, 0, -1];
    }
  }
  /* Опоры. */
  for (const x of pillars.x)
    for (let y = pillars.y0; y <= pillars.y1; y += pillars.pitch) {
      const tPillar = hitVerticalCylinder(origin, dir, x, y, pillars.radius, 0, deck.z);
      if (tPillar < t) {
        t = tPillar;
        surface = "pillar";
        const p = origin.map((value, index) => value + dir[index] * t);
        const length = Math.hypot(p[0] - x, p[1] - y) || 1;
        normal = [(p[0] - x) / length, (p[1] - y) / length, 0];
      }
    }

  if (surface === "sky") {
    const up = clamp(dir[2], 0, 1);
    const mix = up <= 0 ? 0 : Math.min(1, up / 0.45);
    return {
      colour: LAMP_NIGHT.skyHorizon.map((value, index) => value + (LAMP_NIGHT.skyZenith[index] - value) * mix),
      distance: Infinity,
    };
  }
  const point = origin.map((value, index) => value + dir[index] * t);
  let colour;
  if (surface === "ground") {
    const light = tubesOnSurface(scene, point, normal);
    const albedo = roadAlbedo(point, t);
    colour = LAMP_NIGHT.concrete.map((value, index) => albedo[index] * (value * 0.35 + light[index]));
  } else if (surface === "pillar") {
    const light = tubesOnSurface(scene, point, normal);
    colour = LAMP_NIGHT.concrete.map((value, index) => 0.8 * (value * 0.4 + light[index]));
  } else {
    /* Низ настила: отражённый дорогой свет (ярче над серединой) и свет
       светильников вокруг них. */
    const profile = 1 - 0.5 * (point[0] / deck.halfWidth) ** 2;
    const spill = fixtureSpill(scene, point);
    colour = LAMP_NIGHT.concrete.map(
      (value, index) => 0.6 * (value * 0.25 + 0.09 * scene.bounce[index] * profile + spill[index]),
    );
  }
  /* Трубки сами: светящееся стекло поверх ближайшей поверхности. */
  const glass = tubeGlass(scene, origin, dir, t);
  for (let index = 0; index < 3; index += 1) colour[index] += glass[index];
  return { colour, distance: t };
}

/*
 * Стекло трубок: для каждого ряда — ближайшая точка луча к оси ряда; если
 * она в трубке (а не в промежутке) и ближе поверхности — светит цветом.
 */
export function tubeGlass(scene, origin, dir, tMax = Infinity) {
  const out = [0, 0, 0];
  const { rows, tube } = BRIDGE_SCENE;
  for (const x of rows) {
    /* Ось ряда: x = const, z = tube.z, вдоль y. Ближайший подход луча к ней. */
    const dxz = [dir[0], dir[2]];
    const oxz = [origin[0] - x, origin[2] - tube.z];
    const a = dxz[0] * dxz[0] + dxz[1] * dxz[1];
    if (a < 1e-9) continue;
    const s = -(oxz[0] * dxz[0] + oxz[1] * dxz[1]) / a;
    if (s <= 0 || s >= tMax) continue;
    const miss = Math.hypot(oxz[0] + dxz[0] * s, oxz[1] + dxz[1] * s);
    const y = origin[1] + dir[1] * s;
    if (y < tube.y0 - tube.length / 2 || y > tube.y1 + tube.length / 2) continue;
    const along = Math.abs(y - nearestTubeY(y));
    if (along > tube.length / 2) continue;
    const core = Math.exp(-((miss / (tube.radius * (1 + s * 0.012))) ** 2));
    const halo = Math.exp(-((miss / (0.4 + s * 0.01)) ** 2)) * 0.08;
    const strength = TUBE_GLOW * (core + halo);
    for (let index = 0; index < 3; index += 1) out[index] += scene.colour[index] * CALIBRATION_LUMINANCE * strength;
  }
  return out;
}

/** Камера вида «Под мостом»: глаза на 1,7 м, взгляд поднят на трубки. */
export function bridgeCamera(width, height) {
  const camera = lampCamera("bridge", width, height);
  const pitch = (BRIDGE_SCENE.pitch * Math.PI) / 180;
  return {
    ...camera,
    forward: [0, Math.cos(pitch), Math.sin(pitch)],
    up: [0, -Math.sin(pitch), Math.cos(pitch)],
  };
}

/** Экспозиция глаза по средней яркости кадра — той же кривой, что у фонаря. */
export function bridgeExposure(scene, camera, columns = 40, rows = 24) {
  let sum = 0;
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const dir = cameraRay(camera, (column + 0.5) / columns, (row + 0.5) / rows);
      sum += luminance(traceBridgeRay(scene, camera.position, dir).colour);
    }
  const L = Math.max(sum / (columns * rows), 1e-6);
  const { scale, power, offset, min, max } = LAMP_EXPOSURE;
  return clamp(scale * L ** power + offset, min, max);
}

/**
 * Кадр «Под мостом» на процессоре — для плитки вида и сверки шейдера: RGBA
 * `width × height` и экспозиция.
 */
export function renderBridgeImage(scene, width, height) {
  const camera = bridgeCamera(width, height);
  const ev = bridgeExposure(scene, camera);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const dir = cameraRay(camera, (x + 0.5) / width, (y + 0.5) / height);
      const display = tonemapLamp(traceBridgeRay(scene, camera.position, dir).colour, ev);
      const at = (y * width + x) * 4;
      pixels[at] = display[0] * 255;
      pixels[at + 1] = display[1] * 255;
      pixels[at + 2] = display[2] * 255;
      pixels[at + 3] = 255;
    }
  return { pixels, ev };
}
