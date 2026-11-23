/*
 * Живой кадр «Под мостом» на видеокарте — сцена `lamp-bridge-view.js` теми
 * же формулами: настил, балки, опоры, разметка, ряды трубок и пятна их света.
 *
 * Как у кадра фонаря (`lamp-scene-shader.js`), два прохода: сцена — в HDR-цель
 * рисовальщика частиц с глубиной, поверх неё — ореолы трубок сложением. Числа
 * модели света приходят униформами, в тексте шейдера их нет. Камера
 * рисовальщика смотрит вдоль +Y; взгляд на трубки поднимает сам шейдер
 * (`uPitch`), как `bridgeCamera` эталона.
 */

import { LAMP_LIGHT_MODEL } from "@modovik/street-light-contract/lamps";
import { BRIDGE_SCENE, TUBE_GLOW } from "./lamp-bridge-view.js";
import { CALIBRATION_LUMINANCE, LAMP_NIGHT } from "./lamp-view.js";

const ROWS = BRIDGE_SCENE.rows.length;
const GIRDERS = BRIDGE_SCENE.girders.length;
const DASHED = BRIDGE_SCENE.lanes.dashed.length;

const BRIDGE_SHADER_BODY = /* glsl */ `
precision highp float;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uNear;
uniform float uFar;
uniform vec4 uModel;          // C, степень конуса, K·Yбетона, cos(внешний угол + поправка)
uniform vec3 uColour;         // цвет трубок, линейно / яркость калибровки
uniform vec3 uSpot;           // сила, радиус, показатель пятна
uniform vec3 uBounce;         // средний свет дороги
uniform vec2 uSpill;          // доля·сила, радиус света светильника на бетоне
uniform vec4 uDeck;           // высота, y0, y1, полуширина
uniform vec2 uGirder;         // глубина, ширина балки
uniform float uGirders[${GIRDERS}];
uniform float uRows[${ROWS}];
uniform vec4 uTube;           // высота, радиус, длина, шаг
uniform vec2 uTubeSpan;       // y0, y1
uniform vec4 uPillars;        // x, шаг, радиус, y0
uniform float uPillarsEnd;
uniform vec4 uLanes;          // осевая, ширина линии, штрих, период
uniform vec2 uLaneEdges;
uniform float uLaneDashed[${DASHED}];
uniform float uPitch;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uConcrete;
uniform float uAsphalt;
uniform float uGlow;
uniform float uCalibration;
in vec2 vUv;
out vec4 outColour;

const vec3 MARK_WHITE = vec3(2.6);
const vec3 MARK_YELLOW = vec3(2.4, 1.95, 0.8);

float attenuation(float d, float radius, float exponent) {
  if (radius <= 0.0) return 0.0;
  float x = d / radius;
  if (x >= 1.0) return 0.0;
  return (1.0 - x * x) / (uModel.x + max(exponent, 0.0) * x * x);
}

float spotCone(float cosTheta) {
  float t = clamp((cosTheta - uModel.w) / (1.0 - uModel.w), 0.0, 1.0);
  return pow(t, uModel.y);
}

float nearestTubeY(float y) {
  float index = floor((y - uTubeSpan.x) / uTube.w + 0.5);
  return clamp(uTubeSpan.x + index * uTube.w, uTubeSpan.x, uTubeSpan.y);
}

vec3 tubesOnSurface(vec3 point, vec3 normal) {
  vec3 light = vec3(0.0);
  float centre = nearestTubeY(point.y);
  for (int r = 0; r < ${ROWS}; r++) {
    for (int k = -2; k <= 2; k++) {
      float y = centre + float(k) * uTube.w;
      if (y < uTubeSpan.x - 1e-4 || y > uTubeSpan.y + 1e-4) continue;
      vec3 v = vec3(uRows[r], y, uTube.x) - point;
      float d = length(v);
      if (d < 1e-3) continue;
      vec3 l = v / d;
      float facing = dot(l, normal);
      if (facing <= 0.0) continue;
      float cone = spotCone(l.z);
      if (cone <= 0.0) continue;
      light += uColour * (uModel.z * uSpot.x * attenuation(d, uSpot.y, uSpot.z) * cone * facing);
    }
  }
  return light;
}

vec3 fixtureSpill(vec3 point) {
  float along = max(0.0, abs(point.y - nearestTubeY(point.y)) - uTube.z * 0.5);
  float sum = 0.0;
  for (int r = 0; r < ${ROWS}; r++) {
    float dx = point.x - uRows[r];
    float dz = point.z - uTube.x;
    sum += 1.0 / (1.0 + (dx * dx + along * along + dz * dz) / (uSpill.y * uSpill.y));
  }
  return uColour * (uSpill.x * sum);
}

float asphaltGrain(vec2 p) {
  float n = sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453;
  float m = sin(p.x * 3.1 + p.y * 5.7) * 0.5 + 0.5;
  return 0.86 + 0.14 * fract(n) + 0.08 * (m - 0.5);
}

vec3 laneMark(vec2 p) {
  float lineHalf = uLanes.y * 0.5;
  if (abs(p.x - uLaneEdges.x) <= lineHalf || abs(p.x - uLaneEdges.y) <= lineHalf) return MARK_WHITE;
  if (abs(abs(p.x) - uLanes.x) <= lineHalf) return MARK_YELLOW;
  float phase = mod(p.y, uLanes.w);
  if (phase < uLanes.z)
    for (int i = 0; i < ${DASHED}; i++) if (abs(p.x - uLaneDashed[i]) <= lineHalf) return MARK_WHITE;
  return vec3(1.0);
}

vec3 roadAlbedo(vec3 point, float distance) {
  float fade = exp(-distance / 18.0);
  float grain = 0.93 + (asphaltGrain(point.xy) - 0.93) * fade;
  vec3 mark = laneMark(point.xy);
  return grain * uAsphalt * (vec3(1.0) + (mark - vec3(1.0)) * exp(-distance / 70.0));
}

float hitPlaneZ(vec3 origin, vec3 dir, float z) {
  if (abs(dir.z) < 1e-6) return 1e9;
  float t = (z - origin.z) / dir.z;
  return t > 0.0 ? t : 1e9;
}

float hitVerticalCylinder(vec3 origin, vec3 dir, vec2 axis, float radius, float z0, float z1) {
  vec2 o = origin.xy - axis;
  float a = dot(dir.xy, dir.xy);
  if (a < 1e-9) return 1e9;
  float b = dot(o, dir.xy);
  float c = dot(o, o) - radius * radius;
  float disc = b * b - a * c;
  if (disc < 0.0) return 1e9;
  float t = (-b - sqrt(disc)) / a;
  if (t <= 0.0) return 1e9;
  float z = origin.z + dir.z * t;
  return (z >= z0 && z <= z1) ? t : 1e9;
}

/* Стекло трубок и их ореол: ближайший подход луча к оси каждого ряда. */
vec3 tubeGlass(vec3 origin, vec3 dir, float tMax, float haloShare) {
  vec3 glow = vec3(0.0);
  for (int r = 0; r < ${ROWS}; r++) {
    vec2 d = vec2(dir.x, dir.z);
    vec2 o = vec2(origin.x - uRows[r], origin.z - uTube.x);
    float a = dot(d, d);
    if (a < 1e-9) continue;
    float s = -dot(o, d) / a;
    if (s <= 0.0 || s >= tMax) continue;
    float miss = length(o + d * s);
    float y = origin.y + dir.y * s;
    if (y < uTubeSpan.x - uTube.z * 0.5 || y > uTubeSpan.y + uTube.z * 0.5) continue;
    float along = abs(y - nearestTubeY(y));
    if (along > uTube.z * 0.5) continue;
    float core = exp(-pow(miss / (uTube.y * (1.0 + s * 0.012)), 2.0));
    float halo = exp(-pow(miss / (0.4 + s * 0.01), 2.0)) * 0.08;
    glow += uColour * uCalibration * uGlow * (core * (1.0 - haloShare) + halo * haloShare);
  }
  return glow;
}

vec3 pitched(vec3 v) {
  float c = cos(uPitch);
  float s = sin(uPitch);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = pitched(normalize((uCameraWorld * vec4(normalize(view.xyz / view.w), 0.0)).xyz));
  vec3 origin = uCameraWorld[3].xyz;

  float t = hitPlaneZ(origin, dir, 0.0);
  int surface = t < 1e8 ? 1 : 0;      // 0 небо, 1 асфальт, 2 настил, 3 опора
  vec3 normal = vec3(0.0, 0.0, 1.0);

  float tDeck = hitPlaneZ(origin, dir, uDeck.x);
  if (tDeck < t) {
    vec3 p = origin + dir * tDeck;
    if (p.y >= uDeck.y && p.y <= uDeck.z && abs(p.x) <= uDeck.w) { t = tDeck; surface = 2; normal = vec3(0.0, 0.0, -1.0); }
  }
  float tBeam = hitPlaneZ(origin, dir, uDeck.x - uGirder.x);
  if (tBeam < t) {
    vec3 p = origin + dir * tBeam;
    bool onBeam = false;
    for (int g = 0; g < ${GIRDERS}; g++) if (abs(p.x - uGirders[g]) <= uGirder.y * 0.5) onBeam = true;
    if (onBeam && p.y >= uDeck.y && p.y <= uDeck.z) { t = tBeam; surface = 2; normal = vec3(0.0, 0.0, -1.0); }
  }
  for (int side = 0; side < 2; side++) {
    float x = side == 0 ? -uPillars.x : uPillars.x;
    for (int k = 0; k < 16; k++) {
      float y = uPillars.w + float(k) * uPillars.y;
      if (y > uPillarsEnd) break;
      float tPillar = hitVerticalCylinder(origin, dir, vec2(x, y), uPillars.z, 0.0, uDeck.x);
      if (tPillar < t) {
        t = tPillar; surface = 3;
        vec3 p = origin + dir * t;
        normal = normalize(vec3(p.x - x, p.y - y, 0.0));
      }
    }
  }

#ifdef OVERLAY
  outColour = vec4(max(tubeGlass(origin, dir, t, 1.0), vec3(0.0)), 1.0);
#else
  vec3 colour;
  float depth = 1.0;
  if (surface == 0) {
    float up = clamp(dir.z, 0.0, 1.0);
    colour = mix(uSkyHorizon, uSkyZenith, min(1.0, up / 0.45));
  } else {
    vec3 point = origin + dir * t;
    if (surface == 1) {
      colour = roadAlbedo(point, t) * (uConcrete * 0.35 + tubesOnSurface(point, normal));
    } else if (surface == 3) {
      colour = 0.8 * (uConcrete * 0.4 + tubesOnSurface(point, normal));
    } else {
      float across = point.x / uDeck.w;
      float profile = 1.0 - 0.5 * across * across;
      colour = 0.6 * (uConcrete * 0.25 + 0.09 * uBounce * profile + fixtureSpill(point));
    }
    vec3 forward = pitched(normalize((uCameraWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz));
    float z = max(dot(point - origin, forward), uNear);
    float ndcDepth = (uFar + uNear) / (uFar - uNear) - (2.0 * uFar * uNear) / ((uFar - uNear) * z);
    depth = clamp(ndcDepth * 0.5 + 0.5, 0.0, 1.0);
  }
  colour += tubeGlass(origin, dir, t, 0.0);
  gl_FragDepth = depth;
  outColour = vec4(max(colour, vec3(0.0)), 1.0);
#endif
}
`;

export const BRIDGE_SCENE_FRAGMENT = `#define SCENE\n${BRIDGE_SHADER_BODY}`;
export const BRIDGE_OVERLAY_FRAGMENT = `#define OVERLAY\n${BRIDGE_SHADER_BODY}`;

const cosOuter = (degrees) =>
  Math.cos(Math.min(((degrees + LAMP_LIGHT_MODEL.coneMargin) * Math.PI) / 180, Math.PI / 2));

/** Униформы по сцене (`bridgeScene`). */
export function bridgeSceneUniforms(scene) {
  const { deck, girders, girderDepth, girderWidth, rows, tube, pillars, lanes } = BRIDGE_SCENE;
  return {
    uModel: [
      LAMP_LIGHT_MODEL.quadratic,
      LAMP_LIGHT_MODEL.conePower,
      LAMP_LIGHT_MODEL.groundScale * LAMP_NIGHT.concreteLuminance,
      cosOuter(BRIDGE_SCENE.spotCone),
    ],
    uColour: [...scene.colour],
    uSpot: [scene.intensity, scene.falloff, BRIDGE_SCENE.spotExponent],
    uBounce: [...scene.bounce],
    uSpill: [BRIDGE_SCENE.spill * scene.intensity, BRIDGE_SCENE.spillReach],
    uDeck: [deck.z, deck.y0, deck.y1, deck.halfWidth],
    uGirder: [girderDepth, girderWidth],
    uGirders: Float32Array.from(girders),
    uRows: Float32Array.from(rows),
    uTube: [tube.z, tube.radius, tube.length, tube.pitch],
    uTubeSpan: [tube.y0, tube.y1],
    uPillars: [pillars.x[1], pillars.pitch, pillars.radius, pillars.y0],
    uPillarsEnd: pillars.y1,
    uLanes: [lanes.centre, lanes.width, lanes.dash, lanes.period],
    uLaneEdges: [...lanes.edges],
    uLaneDashed: Float32Array.from(lanes.dashed),
    uPitch: (BRIDGE_SCENE.pitch * Math.PI) / 180,
    uSkyZenith: [...LAMP_NIGHT.skyZenith],
    uSkyHorizon: [...LAMP_NIGHT.skyHorizon],
    uConcrete: [...LAMP_NIGHT.concrete],
    uAsphalt: LAMP_NIGHT.asphalt,
    uGlow: TUBE_GLOW,
    uCalibration: CALIBRATION_LUMINANCE,
  };
}
