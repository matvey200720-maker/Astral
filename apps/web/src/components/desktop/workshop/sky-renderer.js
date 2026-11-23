import {
  RAINBOW_EMISSIVE,
  RAINBOW_PLACEMENT,
  SCENE_LIGHT,
  gameExposureStops,
  lightningFlash,
  normalizeRainbow,
  rainbowHours,
  rainbowLightAt,
  rainbowVisibility,
} from "@modovik/timecycle";
import { createCloudHatPass } from "./sky/cloud-hat-pass.js";
import { tr } from "../../../locales/ui.js";

const VERTEX_SHADER = `#version 300 es
void main() {
  // Полноэкранный треугольник без буфера вершин.
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

// Выходы: цвет кадра и данные осадков для следующего прохода.
layout(location = 0) out vec4 fragColour;
layout(location = 1) out vec4 precipOut;

// Кадр: размер, камера, экспозиция, время; направления светил.
uniform vec2 uResolution;
uniform vec2 uCamera;
uniform float uFov;
uniform float uExposure;
uniform float uDirectScale;
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform float uHdrIntensity;

// Цвета купола по высоте и азимуту.
uniform vec4 uZenith;
uniform vec4 uZenithTransition;
uniform vec4 uAzimuthEast;
uniform vec4 uAzimuthWest;
uniform vec4 uAzimuthTransition;
uniform float uAzimuthTransitionPosition;
uniform vec4 uZenithConstants;

// Солнце, луна и звёзды.
uniform vec3 uSunColourHdr;
uniform vec4 uSunConstants;
uniform vec3 uSunDiscColour;
uniform float uSunDiscSize;
uniform vec3 uMoonColour;
uniform float uMoonDiscSize;
uniform float uMoonIntensity;
uniform float uStarsIntensity;
uniform sampler2D uMoonTexture;
uniform float uMoonTextureOn;
uniform sampler2D uStarTexture;
uniform float uStarTextureOn;

// Облака купола и слой шапок.
uniform vec3 uCloudBase;
uniform vec3 uCloudMid;
uniform vec3 uCloudShadow;
uniform vec3 uSmallCloud;
uniform float uCloudDensity;
uniform float uCloudDensityBias;
uniform float uCloudStrength;
uniform float uCloudHdr;
uniform float uCloudFadeout;
uniform float uSmallCloudDensity;
uniform float uCloudBaseStrength;
uniform float uCloudShadowStrength;
uniform float uCloudEdgeStrength;
uniform float uCloudOffset;
uniform float uCloudGenFrequency;
uniform float uCloudGenScale;
uniform float uCloudGenThreshold;
uniform float uCloudGenSoftness;
uniform float uCloudGenDensityOffset;
uniform sampler2D uHatLayer;
uniform float uHatOn;

// Дымка у горизонта.
uniform vec4 uFogColour;
uniform vec3 uFogEast;
uniform vec4 uFogMoon;
uniform float uFogSunPower;
uniform float uFogMoonPower;
uniform float uFogFalloff;
uniform float uFogAlpha;
uniform vec3 uFogHaze;
uniform float uFogDensity;
uniform float uFogHdr;
uniform float uFogHazeHdr;

// Освещение земли и города, насыщенность.
uniform vec3 uGroundColour;
uniform vec3 uAmbientUp;
uniform vec3 uCityLight;
uniform vec3 uLightColour;
uniform float uLightIntensity;
uniform float uSaturation;

// Режимы кадра и положение глаза над городом.
uniform float uShowGround;
uniform float uFocus;
uniform float uHdrOut;
uniform float uShowCity;
uniform float uEyeHeight;
uniform vec2 uEyeXY;

// Погода: осадки, ветер, снег, влага, туман, вспышка.
uniform float uPrecipKind;
uniform float uPrecipAmount;
uniform float uWind;
uniform float uSnowCover;
uniform float uWetness;
uniform float uMist;
uniform float uFlash;

// Радуга: видимость, плоскость дуги, размеры, предел, усиление.
uniform float uRainbow;
uniform vec2 uRainbowAxis;
uniform vec4 uRainbowShape;
uniform float uRainbowLimit;
uniform float uRainbowGain;

// Постоянные сцены: берег, сетка и дальность города, снег, высота низового тумана.
const float PI = 3.14159265359;
const float SHORE_X = -1500.0;
const float CITY_CELL = 130.0;
const float CITY_FAR = 6000.0;
const int CITY_STEPS = 64;
const vec3 SNOW_ALBEDO = vec3(0.78, 0.80, 0.85);
const float MIST_HEIGHT = 50.0;


struct RayReport {
  bool found;
  float dist;
  vec3 face;
  vec2 cellId;
};
const float DISC_UNIT = 0.008;
const vec3 LUNAR_POLE = vec3(0.0, 0.0, 1.0);
const float HORIZON_FOG_K = 0.068;

float jumble(vec3 point);
float valueNoise(vec2 point);
float octaveNoise(vec2 point);
vec3 ambientBlend(vec3 normal);
float directLightMask(vec3 surface, vec3 normal, float range);
vec3 shoulderCurve(vec3 lum);
vec3 displayMap(vec3 colour);
vec4 solarDisc(vec3 dir);
float horizonMix(vec3 dir);
vec3 forwardScatter(vec3 dir, vec3 sky);
vec3 domeColour(vec3 dir);
vec3 horizonTint(vec3 dir);
vec3 bowPalette(float across);
vec3 bowShape(vec3 dir);
vec3 bowGlow(vec3 dir);
vec3 starLayer(vec3 gaze);
float towerHeight(vec2 cell);
float openSkyFraction(vec2 spot);
vec4 lunarDisc(vec3 gaze);
RayReport castCityRay(vec3 origin, vec3 dir, float limit, int stepBudget);
vec4 cloudDeck(vec3 viewDir, vec3 skyColour);
float fallingSheet(vec3 viewDir, float snow);
float groundFog(float pointHeight, float rayLength);
vec3 auxE4ViewRay();
float auxE4FocusSky(float cloudCover, float hatCover, float sunAlpha, float moonAlpha, vec3 dir);
float auxE4FocusGround(float cover);
float auxE4FocusHouse(float cosSun, float shadow, float cover);
vec3 auxE4WaterSurface(vec3 dir, float azimuth, float range, vec3 ambientUp, float foam);
vec3 auxE4LandSurface(vec3 dir, vec2 spot, float range, float foam, vec3 ambientUp, float lightPower, float sunHeight, float night);

/* E1: хеш, шумы, свет, тонмаппинг, диск солнца, дымка, купол, радуга. */

// Единственный источник случайности: точка пространства -> число из [0, 1).
float jumble(vec3 point) {
  vec3 squeezed = fract(point * 0.1031);
  vec3 shifted = vec3(squeezed.y + 33.33, squeezed.z + 33.33, squeezed.x + 33.33);
  float mixer = dot(squeezed, shifted);
  vec3 spread = squeezed + mixer;
  return fract((spread.x + spread.y) * spread.z);
}

// Гладкий шум значений на плоскости.
float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 inner = fract(point);
  vec2 weight = (inner * inner) * (3.0 - (2.0 * inner));
  float lowLeft = jumble(vec3(cell.x, cell.y, 0.0));
  float lowRight = jumble(vec3(cell.x + 1.0, cell.y + 0.0, 0.0));
  float highLeft = jumble(vec3(cell.x + 0.0, cell.y + 1.0, 0.0));
  float highRight = jumble(vec3(cell.x + 1.0, cell.y + 1.0, 0.0));
  float lowRow = mix(lowLeft, lowRight, weight.x);
  float highRow = mix(highLeft, highRight, weight.x);
  return mix(lowRow, highRow, weight.y);
}

// Пять октав: точка растёт в 2.03 раза, вклад убывает вдвое.
float octaveNoise(vec2 point) {
  vec2 pos = point;
  float gain = 0.5;
  float sum = 0.0;
  for (int octave = 0; octave < 5; octave++) {
    sum = sum + (valueNoise(pos) * gain);
    pos = pos * 2.03;
    gain = gain * 0.5;
  }
  return sum;
}

// Свет земли снизу, свет неба сверху; z нормали - вверх.
vec3 ambientBlend(vec3 normal) {
  float skyShare = (normal.z * 0.5) + 0.5;
  return mix(uGroundColour, uAmbientUp, skyShare);
}

// 1.0 - светло, меньше - тень от соседнего квартала.
float directLightMask(vec3 surface, vec3 normal, float range) {
  if (uSunDirection.z <= 0.03) {
    return 1.0;
  }
  float strength = 1.0 - smoothstep(1800.0, 3000.0, range);
  if (strength <= 0.0) {
    return 1.0;
  }
  vec3 rayStart = (surface + (normal * 1.5)) + (uSunDirection * 1.5);
  RayReport blocker = castCityRay(rayStart, uSunDirection, 2600.0, 22);
  if (blocker.found) {
    return 1.0 - strength;
  }
  return 1.0;
}

// Кривая плеча с коэффициентами игры.
vec3 shoulderCurve(vec3 lum) {
  const float shoulderA = 0.22;
  const float shoulderB = 0.3;
  const float shoulderC = 0.1;
  const float shoulderD = 0.2;
  const float shoulderE = 0.01;
  const float shoulderF = 0.3;
  vec3 top = (lum * ((shoulderA * lum) + (shoulderC * shoulderB))) + (shoulderD * shoulderE);
  vec3 bottom = (lum * ((shoulderA * lum) + shoulderB)) + (shoulderD * shoulderF);
  return (top / bottom) - (shoulderE / shoulderF);
}

// Экспозиция, кривая с нормировкой, насыщенность, гамма - именно в таком порядке.
vec3 displayMap(vec3 colour) {
  vec3 exposed = colour * exp2(uExposure);
  float whitePoint = shoulderCurve(vec3(4.0, 4.0, 4.0)).x;
  vec3 curved = clamp(shoulderCurve(max(exposed, vec3(0.0, 0.0, 0.0))) / whitePoint, 0.0, 1.0);
  float grey = dot(curved, vec3(0.2126, 0.7152, 0.0722));
  vec3 saturated = mix(vec3(grey, grey, grey), curved, clamp(uSaturation, 0.0, 2.0));
  return pow(saturated, vec3(1.0 / 2.2, 1.0 / 2.2, 1.0 / 2.2));
}

// Диск солнца: непрозрачный, с мягким краем.
vec4 solarDisc(vec3 dir) {
  float radius = max(uSunDiscSize, 0.0) * DISC_UNIT;
  if (radius <= 0.0) {
    return vec4(0.0, 0.0, 0.0, 0.0);
  }
  float angle = acos(clamp(dot(dir, uSunDirection), -1.0, 1.0));
  float cover = 1.0 - smoothstep(radius * 0.86, radius, angle);
  return vec4(uSunDiscColour.r, uSunDiscColour.g, uSunDiscColour.b, cover);
}

// Доля тумана купола на луче взгляда.
float horizonMix(vec3 dir) {
  float climb = max(dir.z, 0.015);
  float thickness = (HORIZON_FOG_K * clamp(uFogDensity, 0.0, 60.0)) / (max(uFogFalloff, 0.5) * climb);
  return clamp((1.0 - exp(-thickness)) * clamp(uFogAlpha, 0.0, 1.0), 0.0, 1.0);
}

// Свечение Ми вокруг солнца; ту же долю убирает из неба.
vec3 forwardScatter(vec3 dir, vec3 sky) {
  float cosToSun = dot(dir, uSunDirection);
  float phaseBase = ((-uSunConstants.x) * cosToSun) + uSunConstants.y;
  float phasePower = pow(abs(phaseBase), 1.5);
  float phaseTop = (cosToSun * cosToSun) + 1.0;
  float mie = phaseTop / max(phasePower, 1e-5);
  float share = mie * uSunConstants.z;
  float glow = clamp(share, 0.0, 1.0);
  float leftover = clamp(1.0 - share, 0.0, 1.0);
  return (sky * leftover) + ((uSunColourHdr * glow) * uSunConstants.w);
}

// Цвет безоблачного купола; компоненты uZenithConstants берутся по индексам, как у игры.
vec3 domeColour(vec3 dir) {
  float lowEdge = max(uZenithConstants.x, 1e-4);
  float heightDivisor = max(uZenithConstants.w, 1e-4);
  float absUp = abs(dir.z);
  float heightRaw = clamp((absUp - lowEdge) / max(1.0 - lowEdge, 1e-4), 0.0, 1.0);
  float heightMix = clamp(heightRaw / heightDivisor, 0.0, 1.0);
  float bearing = sqrt(max(0.5 - (0.5 * dir.x), 0.0));
  float pivot = clamp(uAzimuthTransitionPosition, 1e-4, 1.0 - 1e-4);
  vec3 bearingColour;
  if (bearing < pivot) {
    bearingColour = mix(uAzimuthEast.rgb, uAzimuthTransition.rgb, bearing / pivot);
  } else {
    bearingColour = mix(uAzimuthTransition.rgb, uAzimuthWest.rgb, (bearing - pivot) / (1.0 - pivot));
  }
  vec3 towardBand = uZenithTransition.rgb - bearingColour;
  float bandShare = (bearing * (uZenithConstants.z - uZenithConstants.y)) + uZenithConstants.y;
  vec3 withBand = bearingColour + (towardBand * bandShare);
  vec3 result = mix(withBand, uZenith.rgb, heightMix);
  if (absUp < lowEdge) {
    result = bearingColour + (((absUp / lowEdge) * towardBand) * bandShare);
  }
  return result * uHdrIntensity;
}

// Цвет тумана вдоль луча: к солнцу, к луне, в остальные стороны.
vec3 horizonTint(vec3 dir) {
  float sunSpot = pow(clamp(dot(dir, uSunDirection), 0.0, 1.0), max(uFogSunPower, 0.01));
  float moonSpot = pow(clamp(dot(dir, uMoonDirection), 0.0, 1.0), max(uFogMoonPower, 0.01)) * clamp(uFogMoon.a, 0.0, 1.0);
  vec3 farTint = mix(uFogEast, uFogMoon.rgb, moonSpot);
  return mix(farTint, uFogColour.rgb, sunSpot) * max(uFogHdr, 0.0);
}

// Цвет полосы радуги поперёк дуги: фиолетовый внутри, красный снаружи.
vec3 bowPalette(float across) {
  float pos = clamp(across, 0.0, 1.0);
  vec3 band = mix(vec3(0.56, 0.32, 1.00), vec3(0.28, 0.46, 1.00), smoothstep(0.0, 0.18, pos));
  band = mix(band, vec3(0.28, 0.92, 0.48), smoothstep(0.18, 0.36, pos));
  band = mix(band, vec3(1.00, 0.95, 0.38), smoothstep(0.36, 0.54, pos));
  band = mix(band, vec3(1.00, 0.62, 0.24), smoothstep(0.54, 0.72, pos));
  band = mix(band, vec3(1.00, 0.28, 0.22), smoothstep(0.72, 0.90, pos));
  return mix(band, vec3(1.0, 1.0, 1.0), 0.05);
}

// Дуга радуги: пересечение взгляда с вертикальной плоскостью, цвет уже на прозрачность дважды.
vec3 bowShape(vec3 dir) {
  vec3 planeAxis = vec3(uRainbowAxis.x, uRainbowAxis.y, 0.0);
  float facing = dot(dir, planeAxis);
  if (facing <= 1e-4) {
    return vec3(0.0, 0.0, 0.0);
  }
  vec3 crossing = dir * (uRainbowShape.x / facing);
  vec3 sideAxis = vec3(uRainbowAxis.y, -uRainbowAxis.x, 0.0);
  vec2 inPlane = vec2(dot(crossing, sideAxis), crossing.z + uRainbowShape.y);
  float bandPos = (length(inPlane) - (uRainbowShape.z - uRainbowShape.w)) / (2.0 * uRainbowShape.w);
  if (bandPos <= 0.0 || bandPos >= 1.0) {
    return vec3(0.0, 0.0, 0.0);
  }
  float arcPos = (atan(inPlane.y, inPlane.x) - uRainbowLimit) / (PI - (2.0 * uRainbowLimit));
  float tips = smoothstep(0.0, 0.12, arcPos) * smoothstep(0.0, 0.12, 1.0 - arcPos);
  float opacity = (smoothstep(0.0, 0.18, bandPos) * smoothstep(0.0, 0.18, 1.0 - bandPos)) * tips;
  return (bowPalette(bandPos) * opacity) * opacity;
}

// Вклад радуги в кадр: форма, видимость, излучение модели.
vec3 bowGlow(vec3 dir) {
  if (dir.z <= 0.0 || uRainbow <= 0.0) {
    return vec3(0.0, 0.0, 0.0);
  }
  return (bowShape(dir) * uRainbow) * uRainbowGain;
}

vec3 starLayer(vec3 gaze) {
  float gain = max(uStarsIntensity, 0.0);
  if (gain <= 0.0) {
    return vec3(0.0, 0.0, 0.0);
  }

  if (uStarTextureOn > 0.5) {
    float projDiv = abs(gaze.z) + 0.4;
    vec2 starUv = (gaze.xy / projDiv) * 1.6;
    vec3 texel = texture(uStarTexture, starUv).rgb;
    return clamp((texel * 2.0) - 0.1, 0.0, 1.0) * gain;
  }

  vec3 cell = floor(gaze * 320.0);
  float rank = jumble(cell);
  if (rank < 0.9965) {
    return vec3(0.0, 0.0, 0.0);
  }

  vec3 cellMid = (cell + 0.5) / 320.0;
  float miss = length(normalize(cellMid) - gaze) * 320.0;
  float spot = exp(-((miss * miss) * 6.0));
  float starPower = (rank - 0.9965) / 0.0035;
  float tintMix = jumble(cell + 7.0);
  vec3 starTint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.92, 0.78), tintMix);
  return (((starTint * spot) * (0.35 + (starPower * 1.4))) * gain) * 0.32;
}

float towerHeight(vec2 cell) {
  vec2 mid = (cell + 0.5) * CITY_CELL;
  float shoreHere = SHORE_X + (sin(mid.y * 0.0016) * 260.0);
  if (mid.x < (shoreHere + 90.0)) {
    return 0.0;
  }

  float plot = jumble(vec3(cell.x, cell.y, 11.0));
  if (plot < 0.3) {
    return 0.0;
  }

  float fromOrigin = length(mid);
  float district = smoothstep(240.0, 1500.0, fromOrigin) * smoothstep(4600.0, 2000.0, fromOrigin);
  float tall = jumble(vec3(cell.x, cell.y, 29.0));
  float base = 14.0 + (plot * 34.0);
  float spire = district * (30.0 + ((tall * tall) * 190.0));
  return base + spire;
}

float openSkyFraction(vec2 spot) {
  vec2 cell = floor(spot / CITY_CELL);
  float hEast = towerHeight(cell + vec2(1.0, 0.0));
  float hWest = towerHeight(cell + vec2(-1.0, 0.0));
  float hNorth = towerHeight(cell + vec2(0.0, 1.0));
  float hSouth = towerHeight(cell + vec2(0.0, -1.0));
  float around = 0.25 * (((hEast + hWest) + hNorth) + hSouth);
  return 1.0 - (0.55 * (around / (around + CITY_CELL)));
}

vec4 lunarDisc(vec3 gaze) {
  float facing = dot(gaze, uMoonDirection);
  if (facing <= 0.0) {
    return vec4(0.0, 0.0, 0.0, 0.0);
  }

  float radius = max(uMoonDiscSize, 0.05) * DISC_UNIT;
  vec3 glow = uMoonColour * uMoonIntensity;

  if (uMoonTextureOn < 0.5) {
    float angle = acos(clamp(facing, -1.0, 1.0));
    float disc = 1.0 - smoothstep(radius * 0.86, radius, angle);
    return vec4(glow.r, glow.g, glow.b, uMoonIntensity * disc);
  }

  vec3 axis = LUNAR_POLE;
  if (abs(dot(LUNAR_POLE, uMoonDirection)) > 0.999) {
    axis = vec3(0.0, 1.0, 0.0);
  }
  vec3 rightward = normalize(cross(axis, uMoonDirection));
  vec3 upward = cross(uMoonDirection, rightward);
  vec3 onPlane = gaze / facing;
  vec2 shift = vec2(dot(onPlane, rightward), dot(onPlane, upward)) / radius;
  if (abs(shift.x) > 1.0 || abs(shift.y) > 1.0) {
    return vec4(0.0, 0.0, 0.0, 0.0);
  }

  vec4 texel = texture(uMoonTexture, (shift * 0.5) + 0.5);
  return vec4(glow * texel.rgb, texel.a * uMoonIntensity);
}

RayReport castCityRay(vec3 origin, vec3 dir, float limit, int stepBudget) {
  RayReport report = RayReport(false, 0.0, vec3(0.0, 0.0, 1.0), vec2(0.0, 0.0));

  vec2 planar = dir.xy;
  vec2 gridStep = vec2(planar.x >= 0.0 ? 1.0 : -1.0, planar.y >= 0.0 ? 1.0 : -1.0);
  vec2 invPlanar = 1.0 / max(abs(planar), vec2(1e-6, 1e-6));
  vec2 deltaT = CITY_CELL * invPlanar;
  vec2 cell = floor(origin.xy / CITY_CELL);
  vec2 within = origin.xy - (cell * CITY_CELL);
  vec2 nextT = mix(within, CITY_CELL - within, step(0.0, planar)) * invPlanar;
  vec3 safeDir = mix(dir, vec3(1e-6, 1e-6, 1e-6), lessThan(abs(dir), vec3(1e-6, 1e-6, 1e-6)));
  vec3 slabInv = 1.0 / safeDir;
  float travelT = 0.0;

  for (int i = 0; i < stepBudget; i++) {
    float height = towerHeight(cell);
    if (height > 0.0) {
      vec2 cellMid = (cell + 0.5) * CITY_CELL;
      float inset = 0.3 + (jumble(vec3(cell.x, cell.y, 47.0)) * 0.12);
      float stretchX = 0.8 + (jumble(vec3(cell.x, cell.y, 53.0)) * 0.4);
      vec2 halfSize = (vec2(CITY_CELL, CITY_CELL) * (0.5 - inset)) * vec2(stretchX, 1.0);
      vec3 lowCorner = (vec3(cellMid - halfSize, 0.0) - origin) * slabInv;
      vec3 highCorner = (vec3(cellMid + halfSize, height) - origin) * slabInv;
      vec3 nearSlab = min(lowCorner, highCorner);
      vec3 farSlab = max(lowCorner, highCorner);
      float tNear = max(max(nearSlab.x, nearSlab.y), nearSlab.z);
      float tFar = min(min(farSlab.x, farSlab.y), farSlab.z);
      if (tFar > max(tNear, 0.0)) {
        report.found = true;
        report.dist = max(tNear, 0.0);
        report.cellId = cell;
        report.face = ((-sign(dir)) * step(nearSlab.yzx, nearSlab.xyz)) * step(nearSlab.zxy, nearSlab.xyz);
        return report;
      }
    }

    if (nextT.x < nextT.y) {
      travelT = nextT.x;
      nextT.x += deltaT.x;
      cell.x += gridStep.x;
    } else {
      travelT = nextT.y;
      nextT.y += deltaT.y;
      cell.y += gridStep.y;
    }

    if (travelT > limit) {
      break;
    }
    if (dir.z > 0.0 && (origin.z + (dir.z * travelT)) > 270.0) {
      break;
    }
  }

  return report;
}

vec4 cloudDeck(vec3 viewDir, vec3 skyColour) {
    if (viewDir.z <= 0.005) {
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    float drift = (uTime * clamp(uCloudOffset, 0.0, 2.0)) * 0.05;
    vec2 plane = viewDir.xy / max(viewDir.z, 0.02);
    float freq = clamp(uCloudGenFrequency, 0.5, 12.0);

    // одна координата шума на все три выборки
    vec2 q = ((plane * freq) * 0.9) + vec2(drift, drift * 0.4);

    float relief = octaveNoise(q);
    float detailScale = clamp(uCloudGenScale, 8.0, 400.0) / 24.0;
    float detail = octaveNoise((q * detailScale) + 11.0);

    float threshold = clamp(uCloudGenThreshold, 0.0, 1.0);
    float softness = max(clamp(uCloudGenSoftness, 0.0, 1.5), 0.02);
    float edgeK = clamp(uCloudEdgeStrength, 0.0, 4.0);
    float shaped = relief + (((detail - 0.5) * edgeK) * 0.25);
    float profile0 = smoothstep(threshold - (softness * 0.5), threshold + (softness * 0.5), shaped);
    float profile = clamp(profile0 + clamp(uCloudGenDensityOffset, -1.0, 1.0), 0.0, 1.0);

    float cover0 = clamp((profile * clamp(uCloudDensity, 0.0, 16.0)) - clamp(uCloudDensityBias, -2.0, 4.0), 0.0, 1.0);
    float cover1 = cover0 * cover0;
    float horizonGate = clamp((viewDir.z * 5.0) - clamp(uCloudFadeout, 0.0, 2.0), 0.0, 1.0);
    float cover = cover1 * horizonGate;
    if (cover <= 0.002) {
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    float body = clamp(profile * clamp(uCloudBaseStrength, 0.0, 2.0), 0.0, 1.0);
    float shade = clamp((detail - 0.45) * 1.6, 0.0, 1.0);
    float shadeK = clamp(uCloudShadowStrength, -1.0, 2.0);
    vec3 shadeAdd = (shade * (uCloudShadow - uCloudBase)) * shadeK;
    vec3 tone0 = uCloudMid + (body * ((uCloudBase - uCloudMid) + shadeAdd));

    float puffs = smoothstep(0.66, 0.82, octaveNoise((q * 2.6) + 31.0)) * clamp(uSmallCloudDensity, 0.0, 4.0);
    vec3 tone = mix(tone0, uSmallCloud, clamp(puffs * 0.35, 0.0, 0.55));

    return vec4(tone * max(uCloudHdr, 0.0), cover);
}

float fallingSheet(vec3 viewDir, float snow) {
    float azimuth = atan(viewDir.y, viewDir.x);
    float elevation = asin(clamp(viewDir.z, -1.0, 1.0));

    float lean = uWind * mix(0.45, 0.9, snow);
    vec2 fallAxis = normalize(vec2(lean, 1.0));
    vec2 crossAxis = vec2(fallAxis.y, -fallAxis.x);
    float fallSpeed = mix(20.0, 1.6, snow) * (0.6 + (0.8 * uWind));

    float total = 0.0;

    for (int layer = 0; layer < 3; layer++) {
        float depth = float(layer);
        float cells = mix(80.0, 70.0, snow) * exp2(depth);
        vec2 grid = (vec2(azimuth, elevation) * 0.15915494) * cells;

        vec2 uv = vec2(
            dot(grid, crossAxis),
            dot(grid, fallAxis) + ((uTime * fallSpeed) / exp2(depth * 0.5))
        );
        uv.x = uv.x + (((snow * uWind) * 0.7) * sin((uTime * 0.6) + (depth * 2.1)));

        vec2 cell = floor(uv);
        float seed = jumble(vec3(cell.x, cell.y, depth + 5.0));

        float fill = mix(0.05, 0.12, snow) + (mix(0.55, 0.8, snow) * uPrecipAmount);
        if (seed > fill) {
            continue;
        }

        vec2 spot = vec2(0.2 + (0.6 * fract(seed * 31.7)), 0.35 + (0.3 * fract(seed * 71.3)));
        vec2 off = fract(uv) - spot;

        float pixelCells = (((2.0 * tan(uFov * 0.5)) / uResolution.y) * cells) * 0.15915494;
        float rainWidth = max(0.04, pixelCells * 1.6);

        float shape;
        if (snow > 0.5) {
            float flakeRadius = max(0.11 + (fract(seed * 17.3) * 0.11), pixelCells * 0.7);
            shape = smoothstep(flakeRadius, 0.0, length(off));
        } else {
            shape = smoothstep(rainWidth, 0.0, abs(off.x)) * (1.0 - smoothstep(0.22, 0.34, abs(off.y)));
        }

        total = total + (shape * (0.55 + (0.45 * fract(seed * 13.1))));
    }

    return clamp(total, 0.0, 1.0);
}

float groundFog(float pointHeight, float rayLength) {
    if (uMist <= 0.0) {
        return 0.0;
    }

    float slab = exp((-max(pointHeight, 0.0)) / MIST_HEIGHT);
    float build = 1.0 - exp(((-rayLength) * 0.0009) * (0.4 + uMist));

    return clamp((slab * build) * (0.35 + (0.65 * uMist)), 0.0, 0.97);
}

/* E4: точка входа и крупные куски кадра (луч, вода, суша, маски подсветки). */

vec3 auxE4ViewRay() {
    vec2 screen = ((gl_FragCoord.xy / uResolution) * 2.0) - 1.0;
    float sx = screen.x * (uResolution.x / uResolution.y);
    float sy = screen.y;
    float scale = tan(uFov * 0.5);
    float yaw = uCamera.x;
    float pitch = uCamera.y;
    vec3 forward = vec3(sin(yaw) * cos(pitch), cos(yaw) * cos(pitch), sin(pitch));
    vec3 right = vec3(cos(yaw), -sin(yaw), 0.0);
    vec3 up = cross(right, forward);
    return normalize((forward + ((right * sx) * scale)) + ((up * sy) * scale));
}

/* Подсветка участка, стадия A: небо, светила, облака. */
float auxE4FocusSky(float cloudCover, float hatCover, float sunAlpha, float moonAlpha, vec3 dir) {
    float value;
    if (uFocus > 0.5 && uFocus < 1.5) {
        value = 1.0 - (max(cloudCover, hatCover) * 0.6);
    } else if (uFocus < 2.5) {
        value = max(sunAlpha, smoothstep(0.93, 0.995, dot(dir, uSunDirection)));
    } else if (uFocus < 3.5) {
        value = max(moonAlpha, smoothstep(0.02, 0.12, dir.z));
    } else if (uFocus < 4.5) {
        value = max(cloudCover, hatCover);
    } else if (uFocus < 5.5) {
        value = 0.0;
    } else if (uFocus < 6.5) {
        value = 1.0 - smoothstep(0.02, 0.2, abs(dir.z));
    } else {
        value = 1.0;
    }
    return value;
}

/* Стадия B: земля, маска заменяется целиком. */
float auxE4FocusGround(float cover) {
    float value;
    if (uFocus > 4.5 && uFocus < 5.5) {
        value = 1.0;
    } else if (uFocus > 5.5 && uFocus < 6.5) {
        value = clamp(cover * 1.6, 0.0, 1.0);
    } else if (uFocus > 6.5) {
        value = 1.0;
    } else {
        value = 0.0;
    }
    return value;
}

/* Стадия C: дом, маска заменяется целиком. */
float auxE4FocusHouse(float cosSun, float shadow, float cover) {
    float value;
    if (uFocus > 1.5 && uFocus < 2.5) {
        value = clamp((cosSun * shadow) * 1.8, 0.0, 1.0) * (1.0 - cover);
    } else if (uFocus > 4.5 && uFocus < 5.5) {
        value = 1.0;
    } else if (uFocus > 5.5 && uFocus < 6.5) {
        value = clamp(cover * 1.6, 0.0, 1.0);
    } else if (uFocus > 6.5) {
        value = 1.0;
    } else {
        value = 0.0;
    }
    return value;
}

/* Вода залива: рябь, отражение неба, блик, мель у кромки. */
vec3 auxE4WaterSurface(vec3 dir, float azimuth, float range, vec3 ambientUp, float foam) {
    float ripple = valueNoise(vec2(range * 0.006, azimuth * 30.0) + (uTime * 0.12)) - 0.5;
    vec3 mirrored = normalize(vec3(dir.x + (ripple * 0.018), dir.y + (ripple * 0.018), (-dir.z) + (abs(ripple) * 0.012)));
    vec3 skyInWater = forwardScatter(mirrored, domeColour(mirrored));
    float fresnel = pow(1.0 - clamp(-dir.z, 0.0, 1.0), 4.0);
    vec3 deepWater = ambientUp * 0.35;
    vec3 water = mix(deepWater, skyInWater, 0.2 + (0.8 * fresnel));
    float glint = pow(clamp(dot(mirrored, uSunDirection), 0.0, 1.0), 180.0);
    vec3 withGlint = water + ((uSunColourHdr * glint) * 0.12);
    return mix(withGlint, (withGlint * 1.3) + (ambientUp * 0.5), foam * 0.8);
}

/* Суша: кварталы и дороги, снег, лужи, свет и тень. Производная клеток остаётся внутри ветки суши. */
vec3 auxE4LandSurface(vec3 dir, vec2 spot, float range, float foam, vec3 ambientUp, float lightPower, float sunHeight, float night) {
    vec2 cells = spot / 130.0;
    vec2 cellStep = fwidth(cells);
    float blur = max(cellStep.x, cellStep.y);
    vec2 edgeDist = 0.5 - abs(fract(cells) - 0.5);
    vec2 streets = 1.0 - smoothstep(0.035 - cellStep, 0.035 + cellStep, edgeDist);
    float road = mix(max(streets.x, streets.y), 0.07, smoothstep(0.15, 0.6, blur));
    float detail = 1.0 - smoothstep(0.2, 0.8, blur);
    float plot = mix(1.0, 0.7 + (jumble(vec3(floor(cells.x), floor(cells.y), 7.0)) * 0.6), detail);
    float grain = mix(1.0, 0.85 + (0.3 * valueNoise(spot * 0.02)), detail);
    vec3 albedoDry = mix(((vec3(0.2, 0.21, 0.18) * plot) * grain), vec3(0.115, 0.115, 0.125), road);
    vec3 albedoSand = mix(albedoDry, vec3(0.36, 0.33, 0.28), foam * 0.75);
    float snowLayer = clamp((uSnowCover * (1.0 - (road * 0.7))) * mix(1.0, 0.75 + (0.5 * valueNoise(spot * 0.012)), detail), 0.0, 1.0);
    vec3 albedoSnow = mix(albedoSand, SNOW_ALBEDO, snowLayer);
    float puddles = smoothstep(0.35, 0.72, valueNoise((spot * 0.01) + 4.0));
    float wet = (uWetness * mix(0.5, 1.0, puddles)) * (1.0 - snowLayer);
    vec3 albedo = albedoSnow * mix(1.0, 0.42, wet);
    vec3 shadowPoint = vec3(spot.x, spot.y, 0.0);
    float shadow;
    float openSky;
    if (uShowCity > 0.5) {
        shadow = directLightMask(shadowPoint, vec3(0.0, 0.0, 1.0), range);
        openSky = openSkyFraction(spot);
    } else {
        shadow = 1.0;
        openSky = 1.0;
    }
    vec3 ambientPart = (albedo * ambientUp) * openSky;
    vec3 sunPart = ambientPart + (((((albedo * uLightColour) * lightPower) * uDirectScale) * sunHeight) * shadow);
    vec3 withLamps = sunPart + (((uCityLight * road) * night) * 0.035);
    vec3 result;
    if (wet > 0.0) {
        vec3 mirror = normalize(vec3(dir.x, dir.y, -dir.z));
        vec3 skyInPuddle = forwardScatter(mirror, domeColour(mirror));
        float puddleFresnel = pow(1.0 - clamp(-dir.z, 0.0, 1.0), 5.0);
        result = mix(withLamps, skyInPuddle, wet * (0.06 + (0.6 * puddleFresnel)));
    } else {
        result = withLamps;
    }
    return result;
}

void main() {
    // 1. луч из пикселя
    vec3 d = auxE4ViewRay();

    // 3. купол, рассеяние у солнца, звёзды
    vec3 domeBase = domeColour(d);
    vec3 skyScattered = forwardScatter(d, domeBase);
    vec3 withStars = skyScattered + starLayer(d);

    // 5. диски: луна, затем солнце поверх неё
    vec4 moon = lunarDisc(d);
    vec3 withMoon = mix(withStars, moon.rgb, clamp(moon.a, 0.0, 1.0));
    vec4 sun = solarDisc(d);
    vec3 withSun = mix(withMoon, sun.rgb, clamp(sun.a, 0.0, 1.0));

    // 4. облака купола и шапки из игры
    vec4 cloud = cloudDeck(d, domeBase);
    vec3 withCloud = mix(withSun, cloud.rgb, cloud.a);
    float hatAlpha = 0.0;
    vec3 withHats = withCloud;
    if (uHatOn > 0.5) {
        vec4 hat = texelFetch(uHatLayer, ivec2(gl_FragCoord.xy), 0);
        withHats = (withCloud * (1.0 - hat.a)) + hat.rgb;
        hatAlpha = hat.a;
    }

    // 10А. первичная маска подсветки
    float focusMask = auxE4FocusSky(cloud.a, hatAlpha, sun.a, moon.a, d);

    // 8. радуга и туман купола, цвет дымки для осадков
    vec3 withBow = withHats + bowGlow(d);
    vec3 domeFogged = mix(withBow, horizonTint(d), horizonMix(d));
    vec3 haze = uFogHaze * max(uFogHazeHdr, 0.0);

    vec3 skyColour = domeFogged;
    float night = 1.0 - clamp(uSunDirection.z * 4.0, 0.0, 1.0);

    // 6. земля и город
    vec3 scene = domeFogged;
    if (uShowGround > 0.5) {
        vec3 groundFogColour = (uFogColour.rgb * max(uFogHdr, 0.0)) * 0.35;
        float sunHeight = clamp(uSunDirection.z, 0.0, 1.0);
        float lightPower = clamp(uLightIntensity, 0.0, 80.0);
        vec3 ambientUp = ambientBlend(vec3(0.0, 0.0, 1.0));
        float azimuth = atan(d.y, d.x);
        vec3 eye = vec3(uEyeXY.x, uEyeXY.y, uEyeHeight);

        if (d.z < 0.0) {
            float slope = max(-d.z, 0.0015);
            float range = uEyeHeight / slope;
            vec2 spot = uEyeXY + (d.xy * range);
            float shoreLine = SHORE_X + (sin(spot.y * 0.0016) * 260.0);
            float foam = smoothstep(70.0, 0.0, abs(spot.x - shoreLine));
            vec3 surface;
            if (spot.x < shoreLine) {
                surface = auxE4WaterSurface(d, azimuth, range, ambientUp, foam);
            } else {
                surface = auxE4LandSurface(d, spot, range, foam, ambientUp, lightPower, sunHeight, night);
            }
            float hazeShare = 1.0 - exp(-((clamp(uFogDensity, 0.0, 60.0) * 0.000045) * range));
            vec3 air = mix(groundFogColour * 0.85, skyColour, smoothstep(0.5, 0.96, hazeShare));
            float groundCover = clamp(hazeShare + ((1.0 - hazeShare) * groundFog(0.0, range)), 0.0, 1.0);
            scene = mix(surface, air, groundCover);
            focusMask = auxE4FocusGround(groundCover);
        }

        // 6.3. город поверх земли и неба
        RayReport hit = RayReport(false, 0.0, vec3(0.0, 0.0, 1.0), vec2(0.0, 0.0));
        if (uShowCity > 0.5) {
            hit = castCityRay(eye, d, CITY_FAR, CITY_STEPS);
        }
        if (hit.found) {
            vec3 wallNormal = hit.face;
            float travel = hit.dist;
            vec2 lot = hit.cellId;
            vec3 point = eye + (d * travel);

            float facade = 0.62 + (jumble(vec3(lot.x, lot.y, 23.0)) * 0.5);
            vec3 wallBase = vec3(0.19, 0.195, 0.205) * facade;
            float upward = clamp(wallNormal.z, 0.0, 1.0);
            vec3 wallSnowy = mix(wallBase, SNOW_ALBEDO, uSnowCover * upward);
            vec3 wallAlbedo = wallSnowy * mix(1.0, 0.72, uWetness * (1.0 - upward));
            float cosSun = max(dot(wallNormal, uSunDirection), 0.0);
            float wallShadow;
            if (cosSun > 0.0) {
                wallShadow = directLightMask(point, wallNormal, travel);
            } else {
                wallShadow = 1.0;
            }
            vec3 wallAmbient = wallAlbedo * ambientBlend(wallNormal);
            vec3 wallLit = wallAmbient + (((((wallAlbedo * uLightColour) * lightPower) * uDirectScale) * cosSun) * wallShadow);

            // окна
            float across;
            if (abs(wallNormal.x) > 0.5) {
                across = point.y;
            } else {
                across = point.x;
            }
            vec2 panes = vec2(across, point.z) / vec2(7.0, 6.0);
            vec2 paneStep = fwidth(panes);
            vec2 paneEdge = 0.5 - abs(fract(panes) - 0.5);
            vec2 opening = smoothstep(0.3 - paneStep, 0.3 + paneStep, paneEdge);
            float burning = step(0.72, jumble(vec3(floor(panes.x), floor(panes.y), lot.x + lot.y)));
            float windowGlow = (((opening.x * opening.y) * burning) * (1.0 - abs(wallNormal.z)));
            vec3 wallWithWindows = wallLit + (((uCityLight * windowGlow) * night) * 0.12);

            // дымка дома
            float hazeShareHouse = 1.0 - exp(-((clamp(uFogDensity, 0.0, 60.0) * 0.000045) * travel));
            vec3 airHouse = mix(groundFogColour * 0.85, skyColour, smoothstep(0.5, 0.96, hazeShareHouse));
            float houseCover = clamp(hazeShareHouse + ((1.0 - hazeShareHouse) * groundFog(point.z, travel)), 0.0, 0.94 + (0.05 * uMist));
            scene = mix(wallWithWindows, airHouse, houseCover);
            focusMask = auxE4FocusHouse(cosSun, wallShadow, houseCover);
        }
    }

    // 9.2. кадр с кварталом из игры: сцена без экспозиции, осадки отдельным вложением
    precipOut = vec4(0.0, 0.0, 0.0, 0.0);
    if (uHdrOut > 0.5) {
        if (uPrecipAmount > 0.0) {
            float snowHdr;
            if (uPrecipKind > 1.5) {
                snowHdr = 1.0;
            } else {
                snowHdr = 0.0;
            }
            precipOut = vec4(fallingSheet(d, snowHdr), snowHdr, 0.0, 1.0);
        }
        fragColour = vec4(scene.r, scene.g, scene.b, 1.0);
        return;
    }

    // 7. осадки поверх сцены
    vec3 withPrecip = scene;
    if (uPrecipAmount > 0.0) {
        float snow;
        if (uPrecipKind > 1.5) {
            snow = 1.0;
        } else {
            snow = 0.0;
        }
        float sheet = fallingSheet(d, snow);
        vec3 lamps = (((uLightColour * uLightIntensity) * uDirectScale) * mix(0.012, 0.03, snow)) + ((uCityLight * night) * mix(0.02, 0.05, snow));
        vec3 streak;
        if (snow > 0.5) {
            streak = max((haze * 1.6) + lamps, scene * 1.45);
        } else {
            streak = ((scene * 0.7) + ((haze * 0.12) * night)) + lamps;
        }
        withPrecip = mix(scene, streak, sheet * 0.85);
    }

    // 9.3. молния
    vec3 flashed = withPrecip * (1.0 + (uFlash * 1.6));
    vec3 lit = flashed + ((vec3(0.55, 0.62, 0.80) * uFlash) * 0.25);

    // 9.4. тонмаппинг, серость вне подсвеченного участка, запись
    vec3 shown = displayMap(lit);
    if (uFocus > 0.5) {
        float grey = dot(shown, vec3(0.2126, 0.7152, 0.0722));
        shown = mix(vec3(grey * 0.32, grey * 0.32, grey * 0.32), shown, clamp(focusMask, 0.0, 1.0));
    }
    fragColour = vec4(shown.r, shown.g, shown.b, 1.0);
}
`;

export const SKY_FOCUS_CODES = Object.freeze(
  Object.fromEntries(["sky", "sun", "night", "clouds", "world", "haze", "picture"].map((name, index) => [name, index + 1])),
);

// Отпечаток исходников шейдера (FNV-1a, 32 бита): по нему рендерер окна находит общую программу неба.
const fingerprint = (text) => {
  const codes = Array.from({ length: text.length }, (_, at) => text.charCodeAt(at));
  const hash = codes.reduce((acc, code) => Math.imul(acc ^ code, 0x01000193), 0x811c9dc5);
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
};

export const SKY_RENDERER_STAMP = fingerprint(`${VERTEX_SHADER}\n${FRAGMENT_SHADER}`);
const SKY_PROGRAM = `sky:${SKY_RENDERER_STAMP}`;

/* ---------- вызовы GL сериями ---------- */

// Серия вызовов [метод, ...аргументы]; строка с «$» в начале — имя константы gl ("$TEXTURE_2D").
const play = (gl, script) => {
  for (const [method, ...args] of script) {
    gl[method](...args.map((arg) => (typeof arg === "string" && arg.startsWith("$") ? gl[arg.slice(1)] : arg)));
  }
};

// Серия вызовов над одним объектом: первым аргументом идёт он сам.
const drive = (gl, handle, calls) => {
  for (const [method, ...rest] of calls) gl[method](handle, ...rest);
};

const refuse = (text) => {
  throw new Error(text);
};

/* ---------- математика: порядок операций над числами важен ---------- */

const xyz = ({ x, y, z }) => [x, y, z];
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const timeOf = (camera) => camera.time ?? 0;
const cross = ([a0, a1, a2], [b0, b1, b2]) => [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0];

function viewBasis(camera, aspect) {
  const [yaw, pitch] = [camera.yaw ?? 0, camera.pitch ?? 0.08];
  const [sy, cy, sp, cp] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch)];
  const forward = [sy * cp, cy * cp, sp];
  const right = [cy, -sy, 0];
  const fov = camera.fov ?? 1.15;
  const scale = Math.tan(fov * 0.5);
  const projection = [scale * aspect, scale].map((divisor) => 1 / divisor);
  return { forward, right, up: cross(right, forward), projection };
}

// Свет для шапок облаков: от луны к солнцу по гладкой ступени вокруг горизонта, затем нормировка.
function cloudLight({ sunDirection: sun, moonDirection: moon }) {
  const lifted = sun.z + 0.3;
  const step = clamp(lifted / 0.15, 0, 1);
  const square = step * step;
  const day = square * (3 - step * 2);
  const [mx, my, mz] = ["x", "y", "z"].map((axis) => moon[axis] + (sun[axis] - moon[axis]) * day);
  const norm = Math.hypot(mx, my, mz);
  const divisor = norm || 1;
  return [mx / divisor, my / divisor, mz / divisor];
}

function rainbowGeometry(place) {
  const { distance, sinkMetres } = place;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const arc = (degrees) => distance * Math.tan(radians(degrees));
  const depth = arc(place.depressionDegrees);
  const radius = arc(place.radiusDegrees - place.depressionDegrees) + depth;
  const halfWidth = arc(place.widthDegrees) / 2;
  const norm = Math.hypot(...place.direction) || 1;
  const axis = [0, 1].map((i) => place.direction[i] / norm);
  const shape = [distance, depth, radius, halfWidth];
  const limit = Math.asin(clamp((depth - sinkMetres) / (radius + halfWidth), -1, 1));
  return { axis, shape, limit };
}

const RAINBOW_GEOMETRY = rainbowGeometry(RAINBOW_PLACEMENT);

const rainbowAt = (settings, hour) => {
  const base = RAINBOW_EMISSIVE * normalizeRainbow(settings).brightness;
  const visibility = rainbowVisibility(rainbowHours(settings), hour);
  const light = rainbowLightAt(settings, settings?.skyStops, hour);
  return { visibility, gain: base * light };
};

function skyFog(state) {
  const gain = Math.max(state.fogHdr, 0);
  const lifted = [state.fogColour.slice(0, 3), state.fogEastColour, state.fogMoonColour.slice(0, 3)].map((colour) =>
    colour.map((v) => v * gain),
  );
  const [sun, east, moon] = lifted;
  const moonWeight = clamp(state.fogMoonColour[3] ?? 1, 0, 1);
  const { fogSunPower: sunPower, fogMoonPower: moonPower } = state;
  const [sunDirection, moonDirection] = [state.sunDirection, state.moonDirection].map(xyz);
  return { sun, east, moon, moonWeight, sunPower, moonPower, sunDirection, moonDirection };
}

/* ---------- план юниформов кадра ---------- */

const PRECIP_KINDS = ["none", "rain", "snow"];

function precipitation(weather) {
  const fall = weather?.precipitation || null;
  const active = fall !== null && fall.kind !== "none";
  return { fall, kind: active ? fall.kind : "none" };
}

function precipAmount({ weather }) {
  const { fall, kind } = precipitation(weather);
  return kind === "none" ? 0 : clamp(fall.amount || 0, 0, 100) / 100;
}

function exposureOf({ camera, state }) {
  const manual = camera.autoExposure === false;
  const stops = manual ? 0 : gameExposureStops(state);
  return stops + (camera.exposureBias ?? 0);
}

const percent = (key) => ({ weather }) => (weather?.[key] || 0) / 100;
const padded = (key) => ({ state }) => [...state.dome[key], 1];
const at = (path) => {
  const keys = path.split(".");
  return (frame) => keys.reduce((node, key) => node[key], frame);
};
const stateFloats = (...keys) => keys.map((key) => [`u${key[0].toUpperCase()}${key.slice(1)}`, "1f", `state.${key}`]);

const tint = (colour, intensity, gain) => {
  const level = Math.max(intensity, 0);
  return colour.map((v) => v * level * gain);
};
const shaded = (base, gain) => ({ state }) => tint(state[`${base}Colour`], state[`${base}Intensity`], gain());

// Радугу считаем один раз за кадр и только если она включена: uRainbow и uRainbowGain берут её отсюда.
function rainbowOf(frame) {
  if (frame.rainbow !== undefined) return frame.rainbow;
  const { weather, state } = frame;
  const setting = weather?.rainbow;
  frame.rainbow = setting ? rainbowAt(setting === true ? null : setting, state.hour) : null;
  return frame.rainbow;
}

// Строка плана: имя юниформа, вид установщика (хвост gl.uniform*), откуда брать значение
// (путь по кадру или функция). Порядок строк = порядок вызовов GL, менять нельзя.
const SKY_UNIFORMS = [
  ["uResolution", "2f", "view"],
  ["uCamera", "2f", ({ camera }) => [camera.yaw ?? 0, camera.pitch ?? 0.08]],
  ["uFov", "1f", ({ camera }) => camera.fov ?? 1.15],
  ["uExposure", "1f", exposureOf],
  ["uDirectScale", "1f", () => SCENE_LIGHT.direct],
  ["uTime", "1f", ({ camera }) => timeOf(camera)],
  ["uShowGround", "1f", ({ camera }) => (camera.showGround === false ? 0 : 1)],
  ["uFocus", "1f", ({ camera }) => SKY_FOCUS_CODES[camera.focus] || 0],
  ["uHdrOut", "1f", ({ camera }) => (camera.hdrOut ? 1 : 0)],
  ["uShowCity", "1f", ({ camera }) => (camera.showCity === false ? 0 : 1)],
  ["uEyeHeight", "1f", ({ camera }) => camera.eyeHeight ?? 190],
  ["uEyeXY", "2f", ({ camera }) => camera.eyeXY ?? [65, 65]],
  ["uPrecipKind", "1f", ({ weather }) => Math.max(PRECIP_KINDS.indexOf(precipitation(weather).kind), 0)],
  ["uPrecipAmount", "1f", precipAmount],
  ["uWind", "1f", percent("wind")],
  ["uSnowCover", "1f", percent("snow")],
  ["uWetness", "1f", percent("wetness")],
  ["uMist", "1f", percent("mist")],
  ["uFlash", "1f", ({ camera, weather }) => lightningFlash(timeOf(camera), weather?.lightning || 0)],
  ["uRainbow", "1f", (frame) => rainbowOf(frame)?.visibility || 0],
  ["uRainbowAxis", "2f", () => RAINBOW_GEOMETRY.axis],
  ["uRainbowShape", "4f", () => RAINBOW_GEOMETRY.shape],
  ["uRainbowLimit", "1f", () => RAINBOW_GEOMETRY.limit],
  ["uRainbowGain", "1f", (frame) => rainbowOf(frame)?.gain || 0],
  ["uSunDirection", "3f", ({ state }) => xyz(state.sunDirection)],
  ["uMoonDirection", "3f", ({ state }) => xyz(state.moonDirection)],
  ...stateFloats("hdrIntensity"),
  ["uZenith", "4f", padded("zenith")],
  ["uZenithTransition", "4f", padded("zenithTransition")],
  ["uAzimuthEast", "4f", padded("east")],
  ["uAzimuthWest", "4f", padded("west")],
  ["uAzimuthTransition", "4f", padded("transition")],
  ...stateFloats("azimuthTransitionPosition"),
  ["uZenithConstants", "4f", "state.dome.zenithConstants"],
  ["uSunColourHdr", "3f", "state.dome.sunColourHdr"],
  ["uSunConstants", "4f", "state.dome.sunConstants"],
  ["uSunDiscColour", "3f", "state.dome.sunDiscColour"],
  ...stateFloats("sunDiscSize"),
  ["uMoonColour", "3f", "state.dome.moonColour"],
  ...stateFloats("moonDiscSize", "moonIntensity"),
  ["uStarsIntensity", "1f", "state.dome.stars"],
  ["uCloudBase", "3f", "state.dome.cloudBase"],
  ["uCloudMid", "3f", "state.dome.cloudMid"],
  ["uCloudShadow", "3f", "state.dome.cloudShadow"],
  ["uSmallCloud", "3f", "state.smallCloudColour"],
  ...stateFloats(
    "cloudDensity",
    "cloudDensityBias",
    "cloudStrength",
    "cloudHdr",
    "cloudFadeout",
    "smallCloudDensity",
    "cloudBaseStrength",
    "cloudShadowStrength",
    "cloudEdgeStrength",
    "cloudOffset",
    "cloudGenFrequency",
    "cloudGenScale",
    "cloudGenThreshold",
    "cloudGenSoftness",
    "cloudGenDensityOffset",
  ),
  ["uFogColour", "4f", "state.fogColour"],
  ["uFogHaze", "3f", "state.fogHazeColour"],
  ["uFogEast", "3f", "state.fogEastColour"],
  ["uFogMoon", "4f", "state.fogMoonColour"],
  ...stateFloats("fogSunPower", "fogMoonPower", "fogFalloff", "fogAlpha", "fogDensity", "fogHdr", "fogHazeHdr"),
  ["uGroundColour", "3f", shaded("ambientDown", () => SCENE_LIGHT.ambient)],
  ["uAmbientUp", "3f", shaded("ambientUp", () => SCENE_LIGHT.ambient)],
  ["uCityLight", "3f", shaded("artificial", () => 1)],
  ["uLightColour", "3f", "state.lightDirColour"],
  ["uLightIntensity", "1f", "state.lightDirIntensity"],
  ["uSaturation", "1f", "state.saturation"],
].map(([name, kind, from]) => [name, kind, typeof from === "string" ? at(from) : from]);

// Вид установщика → какие числа уходят в GL. Только 2f не нормализует значения.
const lanes = (count) => (value) => Array.from({ length: count }, (_, i) => value?.[i] || 0);
const UNIFORM_ARGS = {
  "1f": (value) => [Number(value) || 0],
  "1i": (value) => [value | 0],
  "2f": ([x, y]) => [x, y],
  "3f": lanes(3),
  "4f": lanes(4),
};

// Слот текстуры → сэмплер и флаг «включено»; номер строки = номер текстурного блока.
const SAMPLERS = [
  ["moon", "uMoonTexture", "uMoonTextureOn"],
  ["starfield", "uStarTexture", "uStarTextureOn"],
  ["hats", "uHatLayer", "uHatOn"],
];

// Слот → «повторять ли»: звёздное поле тайлится, луна нет.
const SKY_SLOTS = { moon: false, starfield: true };

// Потолок пикселей: стоимость кадра растёт линейно по пикселям.
const MAX_PIXELS = 1_600_000;

function fitCanvas(width, height, pixelRatio) {
  const area = width * height;
  const base = Math.min(pixelRatio, 2);
  const pixels = area * base * base;
  const ratio = pixels > MAX_PIXELS ? base * Math.sqrt(MAX_PIXELS / pixels) : base;
  return [width, height].map((side) => Math.max(Math.round(side * ratio), 1));
}

/* ---------- сборка программы и текстуры ---------- */

// Статус сборки не спрашиваем: это ждало бы всю сборку (секунду-две) в главном потоке (13.10.2026).
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  drive(gl, shader, [["shaderSource", source], ["compileShader"]]);
  return shader;
}

function startProgram(gl) {
  const program = gl.createProgram();
  const stages = [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
  ];
  const shaders = stages.map(([type, source]) => compile(gl, type, source));
  drive(gl, program, [["attachShader", shaders[0]], ["attachShader", shaders[1]], ["linkProgram"]]);
  return { program, shaders };
}

function linkFailure(gl, { program, shaders }) {
  const broken = [];
  for (const shader of shaders) {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) broken.push(shader);
  }
  const logs = broken.map((shader) => gl.getShaderInfoLog(shader));
  logs.push(gl.getProgramInfoLog(program));
  const text = logs.filter(Boolean).join(" | ");
  const message = tr("Видеокарта не собрала шейдер неба — обновите драйвер видеокарты.");
  return new Error(message, { cause: new Error(text || "program link") });
}

function checkProgram(gl, built) {
  if (!gl.getProgramParameter(built.program, gl.LINK_STATUS)) throw linkFailure(gl, built);
  built.shaders.forEach((shader) => gl.deleteShader(shader));
  return built.program;
}

function nextFrame() {
  return new Promise((resolve) => {
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (run) => setTimeout(run, 16);
    schedule(resolve);
  });
}

// Имена юниформов берём из самих исходников шейдера: список, который ведут руками, разъезжается.
const UNIFORM_DECL = new RegExp(
  ["^\\s*uniform\\s+\\w+\\s+", "([A-Za-z_][A-Za-z0-9_]*)", "\\s*(?:\\[\\s*\\d+\\s*\\])?\\s*;"].join(""),
  "gm",
);

const declaredUniforms = (...sources) => [
  ...new Set(sources.flatMap((source) => Array.from(source.matchAll(UNIFORM_DECL), (found) => found[1]))),
];

// powerPreference: сцена с городом, тенями и отражениями — нужна дискретная видеокарта.
const CONTEXT_OPTIONS = {
  ...Object.fromEntries(["alpha", "antialias", "depth"].map((key) => [key, false])),
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
};

const skyContext = (canvas) =>
  canvas.getContext("webgl2", CONTEXT_OPTIONS) || refuse(tr("Видеокарта не дала WebGL2 — обновите драйвер видеокарты."));

const stillCompiling = (gl, program, extension) =>
  !gl.isContextLost() && !gl.getProgramParameter(program, extension.COMPLETION_STATUS_KHR);

async function compileAsync(gl) {
  const started = startProgram(gl);
  for (const parallel = gl.getExtension("KHR_parallel_shader_compile"); parallel && stillCompiling(gl, started.program, parallel); ) {
    await nextFrame();
  }
  return checkProgram(gl, started);
}

// Текстура 2D: привязать, прогнать шаги, отвязать.
function texture2D(gl, steps) {
  const texture = gl.createTexture();
  play(gl, [["bindTexture", "$TEXTURE_2D", texture], ...steps, ["bindTexture", "$TEXTURE_2D", null]]);
  return texture;
}

const texParams = (pairs) => pairs.map(([pname, value]) => ["texParameteri", "$TEXTURE_2D", pname, value]);

// Заглушка 1x1: сэмплер без привязанной текстуры на части драйверов Windows роняет вызов отрисовки.
const blankTextureOn = (gl) =>
  texture2D(gl, [
    ["texImage2D", "$TEXTURE_2D", 0, "$RGBA", 1, 1, 0, "$RGBA", "$UNSIGNED_BYTE", new Uint8Array(4)],
    ...texParams([
      ["$TEXTURE_MIN_FILTER", "$LINEAR"],
      ["$TEXTURE_MAG_FILTER", "$LINEAR"],
    ]),
  ]);

function uploadTexture(gl, image, repeat) {
  const wrap = repeat ? "$REPEAT" : "$CLAMP_TO_EDGE";
  return texture2D(gl, [
    ["pixelStorei", "$UNPACK_FLIP_Y_WEBGL", true],
    ["texImage2D", "$TEXTURE_2D", 0, "$RGBA", "$RGBA", "$UNSIGNED_BYTE", image],
    ["pixelStorei", "$UNPACK_FLIP_Y_WEBGL", false],
    ...texParams([
      ["$TEXTURE_WRAP_S", wrap],
      ["$TEXTURE_WRAP_T", wrap],
      ["$TEXTURE_MAG_FILTER", "$LINEAR"],
      ["$TEXTURE_MIN_FILTER", "$LINEAR_MIPMAP_LINEAR"],
    ]),
    ["generateMipmap", "$TEXTURE_2D"],
  ]);
}

/* ---------- рендерер окна: общий контекст и программа (docs/3D.md, правило 1) ---------- */

// Рендерер окна грузится в простое: кадр его загрузки не ждёт.
const host = { module: null, load: null };

function warmSkyProgram(module) {
  const warming = module.warmWindowProgram(SKY_PROGRAM, compileAsync);
  return warming === null || warming === undefined ? null : warming.catch(() => null);
}

function skyProgramReady(module) {
  const ready = Boolean(module.windowProgramReady(SKY_PROGRAM));
  if (!ready) warmSkyProgram(module);
  return ready;
}

const importWindowRenderer = () => {
  const adopt = (module) => {
    host.module = module;
    return warmSkyProgram(module);
  };
  const forget = () => {
    host.load = null;
  };
  return import("../../../features/workshop/engine/window-renderer.js").then(adopt, forget);
};

const whenIdle = () =>
  new Promise((resolve) => {
    const schedule = globalThis.requestIdleCallback || ((run) => setTimeout(run, 200));
    schedule(resolve, { timeout: 3000 });
  });

const loadWindowRendererIdle = () => {
  host.load ??= whenIdle().then(importWindowRenderer);
};

function joinWindow(canvas, library) {
  const lodger = library.joinWindowRenderer({});
  const refused = Boolean(lodger) && !canvas.getContext("2d", { alpha: false });
  if (refused) lodger.leave();
  return refused ? null : lodger;
}

// Общая программа неба в окне; при отказе жильца отпускаем и пробрасываем ошибку.
function adoptSharedProgram(windowed) {
  const release = (error) => {
    windowed.leave();
    throw error;
  };
  const ask = (resolve) => resolve(windowed.sharedProgram(SKY_PROGRAM, () => compileAsync(windowed.gl)));
  return new Promise(ask).catch(release);
}

/* ---------- рендерер на готовом контексте ---------- */

const opaque = () => ({ opaque: true });

function skyRendererOn(canvas, gl, program, windowed = null) {
  const claim = (sized) => windowed?.use(...(sized ? [canvas.width, canvas.height] : []));
  const flush = () => windowed?.present(canvas, opaque());
  claim(false);

  const slots = {};
  for (const name of declaredUniforms(VERTEX_SHADER, FRAGMENT_SHADER)) slots[name] = gl.getUniformLocation(program, name);
  const address = (name) => {
    if (name in slots) return slots[name];
    const template = tr("Юниформ {name} в шейдере неба не объявлен");
    return refuse(template.replace("{name}", name));
  };
  const push = (kind, name, value) => {
    const location = address(name);
    gl[`uniform${kind}`](location, ...UNIFORM_ARGS[kind](value));
  };

  const [vao, blankTexture] = [gl.createVertexArray(), blankTextureOn(gl)];
  const rt = { tex: { moon: null, starfield: null }, hat: null, hatDead: false };

  const makeHatPass = () => {
    try {
      return createCloudHatPass(gl, blankTexture);
    } catch (error) {
      console.warn(error);
      return null;
    }
  };

  const setCloudHats = (hats) => {
    if (!hats && !rt.hat) return;
    claim(false);
    if (!rt.hat && !rt.hatDead) {
      rt.hat = makeHatPass();
      rt.hatDead = !rt.hat;
    }
    rt.hat?.setHats(hats);
  };

  const hatSheets = {
    setCloudHatSheet(name, image) {
      claim(false);
      rt.hat?.setSheet(name, image);
    },
    hasCloudHatSheet: (name) => Boolean(rt.hat?.hasSheet(name)),
  };

  const swapSky = (slot, image, repeat) => {
    if (rt.tex[slot]) gl.deleteTexture(rt.tex[slot]);
    rt.tex[slot] = image ? uploadTexture(gl, image, repeat) : null;
  };

  const setSkyTextures = (images = {}) => {
    claim(false);
    Object.entries(SKY_SLOTS)
      .filter(([slot]) => slot in images)
      .forEach(([slot, repeat]) => swapSky(slot, images[slot], repeat));
  };

  const resize = (width, height, pixelRatio = 1) => {
    const [targetWidth, targetHeight] = fitCanvas(width, height, pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
  };

  const drawHats = (state, camera, clouds, [width, height]) => {
    if (!rt.hat || !clouds?.frag) return null;
    const basis = viewBasis(camera, width / height);
    const sky = { light: cloudLight(state), fog: skyFog(state) };
    return rt.hat.draw(width, height, basis, { ...clouds, ...sky }, timeOf(camera));
  };

  const aimAt = ({ framebuffer, count }) => {
    const attachments = [...Array.from({ length: count || 1 }).keys()].map((index) => gl.COLOR_ATTACHMENT0 + index);
    play(gl, [["bindFramebuffer", "$FRAMEBUFFER", framebuffer], ["drawBuffers", attachments]]);
  };

  const render = (state, camera = {}, ...extra) => {
    if (!state) return;
    const [weather = null, clouds = null] = extra;
    const target = camera.target || null;
    claim(!target);
    const view = ["width", "height"].map((side) => target?.[side] ?? canvas[side]);
    const hatLayer = drawHats(state, camera, clouds, view);
    if (target?.framebuffer) aimAt(target);
    play(gl, [["viewport", 0, 0, ...view], ["useProgram", program], ["bindVertexArray", vao]]);

    const frame = { state, camera, weather, view, rainbow: undefined };
    for (const [name, kind, pick] of SKY_UNIFORMS) push(kind, name, pick(frame));

    const layers = { ...rt.tex, hats: hatLayer };
    SAMPLERS.forEach(([slot, sampler, flag], unit) => {
      const texture = layers[slot];
      play(gl, [["activeTexture", `$TEXTURE${unit}`], ["bindTexture", "$TEXTURE_2D", texture || blankTexture]]);
      push("1i", sampler, unit);
      push("1f", flag, texture ? 1 : 0);
    });

    play(gl, [["drawArrays", "$TRIANGLES", 0, 3], ["bindVertexArray", null]]);
    if (!target) flush();
  };

  // Контекст теряем, только если холст уже ушёл со страницы: React StrictMode монтирует эффект дважды на том же холсте.
  const dispose = () => {
    claim(false);
    rt.hat?.dispose();
    const doomed = [
      ["deleteVertexArray", vao],
      windowed ? null : ["deleteProgram", program],
      ["deleteTexture", blankTexture],
      ...Object.values(rt.tex).map((texture) => texture && ["deleteTexture", texture]),
    ];
    play(gl, doomed.filter(Boolean));
    const loseContext = () => gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (!windowed && canvas.isConnected === false) loseContext();
    windowed?.leave();
  };

  const skyApi = { render, resize, setSkyTextures };
  const hatApi = { setCloudHats, ...hatSheets };
  return { gl, ...skyApi, ...hatApi, activate: () => claim(true), present: flush, dispose };
}

/* ---------- вход ---------- */

export const preloadSkyWindowRenderer = () => {
  const { module } = host;
  if (module) return Promise.resolve(warmSkyProgram(module));
  host.load = importWindowRenderer();
  return host.load;
};

export const createSkyRenderer = (canvas) => {
  const gl = skyContext(canvas);
  const built = startProgram(gl);
  return skyRendererOn(canvas, gl, checkProgram(gl, built));
};

export const createSkyRendererAsync = async (canvas, { share = false } = {}) => {
  const lazy = share && !host.module;
  if (lazy) loadWindowRendererIdle();
  const library = share ? host.module : null;
  const windowed = library && skyProgramReady(library) ? joinWindow(canvas, library) : null;
  if (windowed) return skyRendererOn(canvas, windowed.gl, await adoptSharedProgram(windowed), windowed);
  const gl = skyContext(canvas);
  const program = await compileAsync(gl);
  return skyRendererOn(canvas, gl, program);
};
