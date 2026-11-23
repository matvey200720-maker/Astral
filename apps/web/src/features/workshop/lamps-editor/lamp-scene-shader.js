/*
 * Живой кадр фонаря на видеокарте — сцена `lamp-view.js` теми же формулами.
 *
 * Шейдер рисует в HDR-цель рисовальщика частиц (`setSceneShader` в
 * `ptfx-renderer.js`) линейный свет сцены до экспозиции и глубину: рой у
 * лампы ложится поверх той же камерой, столб и плафон его заслоняют, а
 * экспозиция и плёночная кривая — общие для сцены и частиц, как в игре.
 *
 * Два прохода, как у игры. Сцена (земля, столб, стекло) — до частиц. Объём
 * луча и ореолы — ПОСЛЕ них, сложением: в игре светящийся воздух ложится
 * поверх роя, и тёмные ночные бабочки в плотном луче тонут в нём (снято
 * 28.09.2026: без объёма рой ночью виден, с объёмом 0,6 × 1 — нет). Без
 * этого порядка кадр обещал бы бабочек, которых в игре не видно.
 *
 * Числа модели света (C, степень конуса, K, kv) приходят униформами из
 * `light-model.js` — в тексте шейдера их нет, и разъехаться с процессорной
 * сценой они не могут. Формулы повторяют `traceLampRay` построчно; если
 * меняется одна — меняется и другая (тест `lamp-view.test.js` сверяет
 * названия шагов). Светофор перекрёстка — пересечения `lamp-traffic-view.js`
 * (`hitTraffic`) с его же числами в униформах.
 */

import {
  CALIBRATION_LUMINANCE,
  DISTANT_LAMPS,
  LAMP_GEOMETRY,
  LAMP_NIGHT,
} from "./lamp-view.js";
import { LAMP_LIGHT_MODEL } from "@modovik/street-light-contract/lamps";
import { TRAFFIC_GEOMETRY, TRAFFIC_HOUSING, trafficLensGlow } from "./lamp-traffic-view.js";

export const MAX_DISTANT = 8;

const LAMP_SHADER_BODY = /* glsl */ `
precision highp float;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uNear;
uniform float uFar;
uniform vec4 uModel;          // C, степень конуса, K·Yбетона, kv
uniform vec3 uLightPos;
uniform vec3 uLightAxis;
uniform vec3 uLightColour;    // линейный цвет / яркость калибровки
uniform vec4 uLight;          // сила, радиус, показатель, cos(внешний угол + поправка)
uniform vec2 uVolume;         // VI, радиус шара объёма (0 — луча нет)
uniform vec3 uGlass;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uHills;
uniform vec3 uConcrete;
uniform vec3 uSurface;        // асфальт, металл, запас
uniform vec4 uPole;           // x, y, радиус, высота
uniform vec2 uPoleBase;       // радиус, высота основания
uniform vec4 uArmFrom;        // xyz, радиус
uniform vec3 uArmTo;
uniform vec3 uHeadCentre;
uniform vec3 uHeadRadii;
uniform int uDistantCount;
uniform vec3 uDistantPos[${MAX_DISTANT}];
uniform vec3 uDistantColour[${MAX_DISTANT}];
uniform vec4 uCorona;         // вкл, сила, размер, начало видимости
uniform float uCoronaEnd;
uniform float uCalibration;
uniform vec3 uPolePaint;      // краска корпуса — множитель к серому металлу
uniform vec2 uPoleLook;       // сила блика (0,12·блеск²), непрозрачность
uniform vec4 uTrafficMast;    // светофор: x, y, радиус, высота мачты (0 — его нет)
uniform vec2 uTrafficBase;    // радиус, высота фланца
uniform vec4 uTrafficArmFrom; // консоль: xyz, радиус
uniform vec3 uTrafficArmTo;
uniform vec3 uTrafficHeads[3];  // центры коробов сигналов
uniform vec3 uTrafficHeadSize;  // полуразмеры короба
uniform vec3 uTrafficLens;    // радиус и шаг линз, доля серого у короба
uniform vec3 uTrafficGlow[3]; // свечение линз сверху вниз
uniform vec3 uTrafficPaint;   // краска мачты — вид «Светофоры»
uniform vec2 uTrafficLook;    // сила блика, непрозрачность мачты
in vec2 vUv;
out vec4 outColour;

float attenuation(float d, float radius, float exponent) {
  if (radius <= 0.0) return 0.0;
  float x = d / radius;
  if (x >= 1.0) return 0.0;
  return (1.0 - x * x) / (uModel.x + max(exponent, 0.0) * x * x);
}

float cone(float cosTheta) {
  float t = clamp((cosTheta - uLight.w) / (1.0 - uLight.w), 0.0, 1.0);
  return pow(t, uModel.y);
}

/* lampOnSurface: свет лампы на поверхности в линейных единицах сцены. */
vec3 lampOnSurface(vec3 position, vec3 colour, bool spot, vec3 point, vec3 normal) {
  vec3 v = position - point;
  float d = length(v);
  if (d <= 1e-3) return vec3(0.0);
  vec3 l = v / d;
  float facing = dot(normal, l);
  if (facing <= 0.0) return vec3(0.0);
  float c = spot ? cone(-dot(l, uLightAxis)) : 1.0;
  if (c <= 0.0) return vec3(0.0);
  return colour * (uModel.z * uLight.x * attenuation(d, uLight.y, uLight.z) * c * facing);
}

/* volumeAlong: объём луча вдоль луча зрения. */
float volumeAlong(vec3 origin, vec3 dir, float tMax) {
  float reach = uVolume.y;
  if (reach <= 0.0 || uVolume.x <= 0.0) return 0.0;
  vec3 o = origin - uLightPos;
  float b = dot(o, dir);
  float c = dot(o, o) - reach * reach;
  float disc = b * b - c;
  if (disc <= 0.0) return 0.0;
  float root = sqrt(disc);
  float t0 = max(0.0, -b - root);
  float t1 = min(tMax, -b + root);
  if (t1 <= t0) return 0.0;
  const int STEPS = 40;
  float dt = (t1 - t0) / float(STEPS);
  float sum = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 v = o + dir * t;
    float d = length(v);
    if (d < 1e-3) continue;
    float k = cone(dot(v, uLightAxis) / d);
    if (k <= 0.0) continue;
    sum += k * attenuation(d, reach, uLight.z) * dt;
  }
  return uModel.w * uVolume.x * uLight.x * uLight.x * sum / reach;
}

float hitCylinder(vec3 origin, vec3 dir, vec2 axis, float radius, float z0, float z1) {
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

float hitCapsule(vec3 origin, vec3 dir, vec3 a, vec3 b, float radius) {
  vec3 ba = b - a;
  vec3 oa = origin - a;
  float baba = dot(ba, ba);
  float bard = dot(ba, dir);
  float baoa = dot(ba, oa);
  float rdoa = dot(dir, oa);
  float oaoa = dot(oa, oa);
  float qa = baba - bard * bard;
  float qb = baba * rdoa - baoa * bard;
  float qc = baba * oaoa - baoa * baoa - radius * radius * baba;
  float h = qb * qb - qa * qc;
  if (h >= 0.0 && qa > 1e-9) {
    float t = (-qb - sqrt(h)) / qa;
    float y = baoa + t * bard;
    if (t > 0.0 && y > 0.0 && y < baba) return t;
  }
  return 1e9;
}

float hitEllipsoid(vec3 origin, vec3 dir, vec3 centre, vec3 radii, out vec3 normal) {
  vec3 o = (origin - centre) / radii;
  vec3 d = dir / radii;
  float a = dot(d, d);
  float b = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0) return 1e9;
  float t = (-b - sqrt(disc)) / a;
  if (t <= 0.0) return 1e9;
  normal = normalize((o + d * t) / radii);
  return t;
}

float horizonHeight(vec3 dir) {
  float azimuth = atan(dir.x, dir.y);
  return 0.018 + 0.012 * sin(azimuth * 3.1 + 0.4) + 0.008 * sin(azimuth * 7.3 + 1.7);
}

float asphaltGrain(vec2 p) {
  float n = sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453;
  float m = sin(p.x * 3.1 + p.y * 5.7) * 0.5 + 0.5;
  return 0.86 + 0.14 * fract(n) + 0.08 * (m - 0.5);
}

float stars(vec3 dir) {
  if (dir.z < 0.05) return 0.0;
  vec2 cell = floor(vec2(atan(dir.x, dir.y) * 260.0, dir.z * 260.0));
  float n = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  return n > 0.992 ? (n - 0.992) * 18.0 * smoothstep(0.05, 0.3, dir.z) : 0.0;
}

vec3 coronaGlow(vec3 origin, vec3 dir) {
  if (uCorona.x < 0.5 || uCorona.y <= 0.0) return vec3(0.0);
  vec3 out3 = vec3(0.0);
  for (int i = 0; i < ${MAX_DISTANT}; i++) {
    if (i >= uDistantCount) break;
    vec3 v = uDistantPos[i] - origin;
    float d = length(v);
    float visibility = clamp((d - uCorona.w) / (uCoronaEnd - uCorona.w), 0.0, 1.0);
    if (visibility <= 0.0) continue;
    float angle = acos(clamp(dot(v / d, dir), -1.0, 1.0));
    float width = 0.0045 * (1.0 + 0.35 * log2(1.0 + uCorona.z));
    out3 += uDistantColour[i] * exp(-pow(angle / width, 2.0)) * visibility * uCorona.y * 0.9;
  }
  return out3;
}

/* poleSpecular: блик стекла лампы на корпусе и слабое небо (корпус — столба
   или мачты светофора: своя краска, своя сила блика). */
vec3 poleSpecular(vec3 point, vec3 normal, vec3 dir, vec3 paint, float strength) {
  if (strength <= 0.0) return vec3(0.0);
  vec3 reflected = reflect(dir, normal);
  vec3 toHead = uHeadCentre - point;
  float distance = max(length(toHead), 1e-3);
  float alignment = max(dot(reflected, toHead / distance), 0.0);
  float lobe = pow(alignment, 48.0) * (8.0 / (1.0 + distance * 0.15));
  float peak = max(max(paint.x, paint.y), max(paint.z, 1e-6));
  vec3 tint = 0.45 + 0.55 * min(paint / peak, vec3(1.0));
  float sky = max(reflected.z, 0.0) * 0.004;
  return strength * tint * (uGlass * lobe + sky);
}

float safeDir(float value) {
  return abs(value) < 1e-8 ? 1e-8 : value;
}

/* hitBox: короб по осям — центр и полуразмеры. */
float hitBox(vec3 origin, vec3 dir, vec3 centre, vec3 halfSize, out vec3 normal) {
  float tNear = -1e9;
  float tFar = 1e9;
  int axis = 0;
  for (int i = 0; i < 3; i++) {
    float invDir = 1.0 / safeDir(dir[i]);
    float a = (centre[i] - halfSize[i] - origin[i]) * invDir;
    float b = (centre[i] + halfSize[i] - origin[i]) * invDir;
    float low = min(a, b);
    if (low > tNear) { tNear = low; axis = i; }
    tFar = min(tFar, max(a, b));
  }
  normal = vec3(0.0);
  if (tNear > tFar || tNear <= 0.0) return 1e9;
  float facing = dir[axis] > 0.0 ? -1.0 : 1.0;
  if (axis == 0) normal.x = facing;
  else if (axis == 1) normal.y = facing;
  else normal.z = facing;
  return tNear;
}

/* hitTraffic: ближайшая часть светофора ближе t — 0 нет, 1 мачта и консоль,
   2 короб, 3 линза (lens — её номер сверху вниз). */
int hitTraffic(vec3 origin, vec3 dir, inout float t, out vec3 normal, out int lens) {
  int part = 0;
  lens = -1;
  normal = vec3(0.0, 0.0, 1.0);
  if (uTrafficMast.w <= 0.0) return 0;
  float tMast = hitCylinder(origin, dir, uTrafficMast.xy, uTrafficMast.z, 0.0, uTrafficMast.w);
  if (tMast < t) {
    t = tMast; part = 1;
    vec3 p = origin + dir * t;
    normal = normalize(vec3(p.xy - uTrafficMast.xy, 0.0));
  }
  float tBase = hitCylinder(origin, dir, uTrafficMast.xy, uTrafficBase.x, 0.0, uTrafficBase.y);
  if (tBase < t) {
    t = tBase; part = 1;
    vec3 p = origin + dir * t;
    normal = normalize(vec3(p.xy - uTrafficMast.xy, 0.0));
  }
  float tArm = hitCapsule(origin, dir, uTrafficArmFrom.xyz, uTrafficArmTo, uTrafficArmFrom.w);
  if (tArm < t) { t = tArm; part = 1; normal = vec3(0.0, -0.6, 0.8); }
  for (int i = 0; i < 3; i++) {
    vec3 boxNormal;
    float tBox = hitBox(origin, dir, uTrafficHeads[i], uTrafficHeadSize, boxNormal);
    if (tBox >= t) continue;
    t = tBox; normal = boxNormal; part = 2; lens = -1;
    if (boxNormal.y < -0.5) {
      vec3 p = origin + dir * t - uTrafficHeads[i];
      for (int k = 0; k < 3; k++) {
        float dz = p.z - uTrafficLens.y * (1.0 - float(k));
        if (p.x * p.x + dz * dz < uTrafficLens.x * uTrafficLens.x) lens = k;
      }
      if (lens >= 0) part = 3;
    }
  }
  return part;
}

vec3 shadeSky(vec3 dir) {
  float up = clamp(dir.z, 0.0, 1.0);
  if (dir.z < horizonHeight(dir)) return uHills;
  return mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.45, up)) + vec3(stars(dir)) * 0.004;
}

vec3 shadeGround(vec3 point, vec3 dir) {
  float grain = asphaltGrain(point.xy) * uSurface.x;
  float viewLight = 0.25 + 0.75 * smoothstep(0.05, 0.45, -dir.z);
  vec3 lamp = lampOnSurface(uLightPos, uLightColour, true, point, vec3(0.0, 0.0, 1.0));
  vec3 lod = vec3(0.0);
  for (int i = 0; i < ${MAX_DISTANT}; i++) {
    if (i >= uDistantCount) break;
    lod += lampOnSurface(uDistantPos[i], uDistantColour[i], false, point, vec3(0.0, 0.0, 1.0));
  }
  return grain * (uConcrete * viewLight + lamp + lod);
}

vec3 distantGlass(vec3 origin, vec3 dir) {
  vec3 out3 = vec3(0.0);
  for (int i = 0; i < ${MAX_DISTANT}; i++) {
    if (i >= uDistantCount) break;
    vec3 v = uDistantPos[i] - origin;
    float d = length(v);
    float angle = acos(clamp(dot(v / d, dir), -1.0, 1.0));
    float width = 0.22 / d;
    out3 += uDistantColour[i] * uCalibration * exp(-pow(angle / width, 2.0)) * 1.2;
  }
  return out3;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize((uCameraWorld * vec4(normalize(view.xyz / view.w), 0.0)).xyz);
  vec3 origin = uCameraWorld[3].xyz;

  float t = dir.z < -1e-6 ? -origin.z / dir.z : 1e9;
  if (t <= 0.0) t = 1e9;
  // 0 небо, 1 земля, 2 металл, 3 стекло; светофор: 4 мачта, 5 короб, 6 линза
  int surface = t < 1e8 ? 1 : 0;
  vec3 normal = vec3(0.0, 0.0, 1.0);

  float tPole = hitCylinder(origin, dir, uPole.xy, uPole.z, 0.0, uPole.w);
  if (tPole < t) {
    t = tPole; surface = 2;
    vec3 p = origin + dir * t;
    normal = normalize(vec3(p.xy - uPole.xy, 0.0));
  }
  float tBase = hitCylinder(origin, dir, uPole.xy, uPoleBase.x, 0.0, uPoleBase.y);
  if (tBase < t) {
    t = tBase; surface = 2;
    vec3 p = origin + dir * t;
    normal = normalize(vec3(p.xy - uPole.xy, 0.0));
  }
  float tArm = hitCapsule(origin, dir, uArmFrom.xyz, uArmTo, uArmFrom.w);
  if (tArm < t) { t = tArm; surface = 2; normal = normalize(vec3(0.0, -1.0, 0.3)); }
  vec3 headNormal;
  float tHead = hitEllipsoid(origin, dir, uHeadCentre, uHeadRadii, headNormal);
  if (tHead < t) {
    t = tHead; normal = headNormal;
    vec3 p = origin + dir * t;
    surface = (normal.z < -0.55 && abs(p.x - uHeadCentre.x) < 0.34) ? 3 : 2;
  }
  vec3 trafficNormal;
  int lens;
  float tTraffic = t;
  int trafficPart = hitTraffic(origin, dir, tTraffic, trafficNormal, lens);
  if (trafficPart > 0) { t = tTraffic; normal = trafficNormal; surface = 3 + trafficPart; }

#ifdef OVERLAY
  /* Второй проход: объём до ближайшей поверхности и ореолы. */
  vec3 glow = uLightColour * volumeAlong(origin, dir, t) + coronaGlow(origin, dir);
  outColour = vec4(max(glow, vec3(0.0)), 1.0);
#else
  vec3 colour;
  float depth = 1.0;
  if (surface == 0) {
    colour = shadeSky(dir);
  } else {
    vec3 point = origin + dir * t;
    if (surface == 3) {
      colour = uGlass;
    } else if (surface == 6) {
      /* Сигнал светофора светит сам и не перекрашивается. */
      colour = uTrafficGlow[lens];
    } else if (surface == 5) {
      /* Короб сигналов — тёмный металл игры, без краски. */
      vec3 lamp = lampOnSurface(uLightPos, uLightColour, true, point, normal);
      colour = uSurface.y * uTrafficLens.z * (uConcrete * 0.35 + lamp);
    } else if (surface == 2 || surface == 4) {
      /* Корпус фонаря или мачта светофора — у каждого краска своего вида. */
      vec3 paint = surface == 4 ? uTrafficPaint : uPolePaint;
      vec2 look = surface == 4 ? uTrafficLook : uPoleLook;
      vec3 lamp = lampOnSurface(uLightPos, uLightColour, true, point, normal);
      colour = uSurface.y * paint * (uConcrete * 0.35 + lamp) + poleSpecular(point, normal, dir, paint, look.x);
      /* Прозрачный корпус: за ним — земля или небо. */
      if (look.y < 1.0) {
        float tGround = dir.z < -1e-6 ? -origin.z / dir.z : 1e9;
        vec3 behind = tGround > 0.0 && tGround < 1e8 ? shadeGround(origin + dir * tGround, dir) : shadeSky(dir);
        colour = mix(behind, colour, look.y);
        if (look.y < 0.5) {
          if (tGround > 0.0 && tGround < 1e8) point = origin + dir * tGround;
          else surface = 0;
        }
      }
    } else {
      colour = shadeGround(point, dir);
    }
    if (surface != 0) {
      vec3 forward = normalize((uCameraWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
      float z = max(dot(point - origin, forward), uNear);
      float ndcDepth = (uFar + uNear) / (uFar - uNear) - (2.0 * uFar * uNear) / ((uFar - uNear) * z);
      depth = clamp(ndcDepth * 0.5 + 0.5, 0.0, 1.0);
    }
  }
  colour += distantGlass(origin, dir);
  gl_FragDepth = depth;
  outColour = vec4(max(colour, vec3(0.0)), 1.0);
#endif
}
`;

/* Сцена — до частиц; объём и ореолы — после них, сложением. */
export const LAMP_SCENE_FRAGMENT = `#define SCENE\n${LAMP_SHADER_BODY}`;
export const LAMP_OVERLAY_FRAGMENT = `#define OVERLAY\n${LAMP_SHADER_BODY}`;

/* Тот же внешний угол, что у `lampCone` модели. */
const cosOuter = (degrees) =>
  Math.cos(Math.min(((Math.min(89, Number(degrees) || 89) + LAMP_LIGHT_MODEL.coneMargin) * Math.PI) / 180, Math.PI / 2));

/** Униформы шейдера по сцене (`lampScene`): имя → значение. */
export function lampSceneUniforms(scene) {
  const g = LAMP_GEOMETRY;
  const tg = TRAFFIC_GEOMETRY;
  const distant = scene.distant.slice(0, MAX_DISTANT);
  const pad = (list) => [...list, ...Array.from({ length: MAX_DISTANT - list.length }, () => [0, 0, 0])];
  return {
    uModel: [
      LAMP_LIGHT_MODEL.quadratic,
      LAMP_LIGHT_MODEL.conePower,
      LAMP_LIGHT_MODEL.groundScale * LAMP_NIGHT.concreteLuminance,
      LAMP_LIGHT_MODEL.volumeScale,
    ],
    uLightPos: [...scene.light.position],
    uLightAxis: [...scene.light.axis],
    uLightColour: [...scene.light.colour],
    uLight: [scene.light.intensity, scene.light.falloff, scene.light.falloffExponent, cosOuter(scene.light.coneOuterAngle)],
    uVolume: scene.light.volume ? [scene.light.volume.intensity, scene.light.volume.reach] : [0, 0],
    uGlass: [...scene.glass],
    uSkyZenith: [...LAMP_NIGHT.skyZenith],
    uSkyHorizon: [...LAMP_NIGHT.skyHorizon],
    uHills: [...LAMP_NIGHT.hills],
    uConcrete: [...LAMP_NIGHT.concrete],
    uSurface: [LAMP_NIGHT.asphalt, LAMP_NIGHT.metal, 0],
    uPole: [g.pole.x, g.pole.y, g.pole.radius, g.pole.height],
    uPoleBase: [g.pole.base, g.pole.baseHeight],
    uArmFrom: [...g.arm.from, g.arm.radius],
    uArmTo: [...g.arm.to],
    uHeadCentre: [...g.head.centre],
    uHeadRadii: [...g.head.radii],
    uDistantCount: distant.length,
    uDistantPos: pad(distant.map((item) => item.position)),
    uDistantColour: pad(distant.map((item) => item.colour)),
    uCorona: [
      scene.corona?.on ? 1 : 0,
      scene.corona?.intensity || 0,
      scene.corona?.size || 0,
      LAMP_LIGHT_MODEL.coronaFadeStart,
    ],
    uCoronaEnd: LAMP_LIGHT_MODEL.coronaFadeEnd,
    uCalibration: CALIBRATION_LUMINANCE,
    uPolePaint: [...(scene.pole?.paint || [1, 1, 1])],
    uPoleLook: [0.12 * (scene.pole?.metal ?? 1) ** 2, scene.pole?.opacity ?? 1],
    /* Светофор (`lamp-traffic-view.js`): нет его в сцене — мачта нулевой высоты. */
    uTrafficMast: [tg.mast.x, tg.mast.y, tg.mast.radius, scene.traffic ? tg.mast.height : 0],
    uTrafficBase: [tg.mast.base, tg.mast.baseHeight],
    uTrafficArmFrom: [...tg.arm.from, tg.arm.radius],
    uTrafficArmTo: [...tg.arm.to],
    uTrafficHeads: tg.heads.map((centre) => [...centre]),
    uTrafficHeadSize: [...tg.head],
    uTrafficLens: [tg.lens.radius, tg.lens.step, TRAFFIC_HOUSING],
    uTrafficGlow: trafficLensGlow(),
    uTrafficPaint: [...(scene.traffic?.paint || [1, 1, 1])],
    uTrafficLook: [0.12 * (scene.traffic?.metal ?? 1) ** 2, scene.traffic?.opacity ?? 1],
  };
}

export { DISTANT_LAMPS };
