/*
 * Шейдеры проходов кадра таймцикла с кварталом из игры (задача 4Б ТЗ 18.10.2026).
 *
 * Порядок кадра: квартал → цель three (HDR + глубина); небо → цель неба (HDR,
 * без осадков и молнии); сведение неба и квартала с туманом по дальности и
 * осадками; свечение; экспозиция, плёночная кривая и гамма в холст. Всё, кроме
 * квартала и неба, — эти шейдеры, на одних числах таймцикла.
 *
 * Вода (кадр редактора «Вода», задача 20 ТЗ 18.10.2026) — тоже сведение: у моря
 * в игре нет моделей, это квады и туман, и игра красит воду тем же приёмом
 * (`PS_FogComposite`): по глубине сцены считается, сколько метров воды между
 * гладью и дном, и сквозь неё дно гаснет в цвет толщи.
 */

import { BLUR_FRAGMENT, DOWNSAMPLE_FRAGMENT } from "../../../components/desktop/workshop/ptfx/ptfx-post.js";

/* Размытие и уменьшение свечения — те же шейдеры, что у сцены частиц (гаусс 9 отводов, среднее четырёх соседей). */
export const BLUR_PASS = BLUR_FRAGMENT;
export const DOWNSAMPLE_PASS = DOWNSAMPLE_FRAGMENT;

/*
 * Яркость кадра для глаза игры: среднее по клеткам 4×4 яркости до экспозиции, с
 * потолком (диск солнца в сотни единиц не должен тянуть среднее вверх). Результат — в
 * цель с цепочкой мипов: вершина цепочки — среднее по кадру. Проход один на два кадра:
 * квартал в небе и небо без квартала (то, на чём модель глаза игры подогнана).
 */
export const LUMA_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uAlt;
uniform vec2 uTexel;
uniform float uCap;
uniform float uUseAlt;
in vec2 vUv;
out vec4 outColour;
void main() {
  float total = 0.0;
  for (int y = 0; y < 4; y++)
    for (int x = 0; x < 4; x++) {
      vec2 at = vUv + vec2(float(x) - 1.5, float(y) - 1.5) * uTexel;
      vec4 s = texture(uScene, at);
      /* Чёрная пустота объёма кадра (альфа 0,75, block-void.js) для глаза игры — небо: иначе взгляд в чёрную стену поднимал бы экспозицию. */
      vec3 c = (uUseAlt > 0.5 && s.a > 0.6 && s.a < 0.9) ? texture(uAlt, at).rgb : s.rgb;
      total += min(dot(c, vec3(0.2126, 0.7152, 0.0722)), uCap);
    }
  outColour = vec4(total / 16.0, 0.0, 0.0, 1.0);
}
`;

/*
 * Глаз игры (`PS_CalculateExposure`): EV = scale · L^power + offset + postfx_exposure,
 * в пределах [min, max]; множитель кадра 2^EV. Выход — одна точка:
 * (множитель, EV, доля набора «темно», L). Доля набора — по тому же EV, как у
 * сведения игры: ниже экспозиции набора «ярко» — целиком «ярко», выше набора «темно» — целиком «темно».
 *
 * L — модель кадра игры (`gameFrameLuminance`: только числа таймцикла), умноженная на
 * то, во сколько раз квартал изменил среднюю яркость кадра против неба без него.
 * Простое среднее настоящего кадра на рассвете и закате завышало яркость в 3–8 раз
 * против игры (сверка 18.10.2026 с замком экспозиции по часам), а модель лежит на игре
 * с ошибкой 0,15–0,25 стопа; от квартала берётся только поправка. Без квартала она
 * ровно единица — кадр совпадает с плоским кадром неба.
 */
export const EXPOSURE_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uLuma;
uniform sampler2D uLumaRef;
uniform float uTopLevel;
uniform float uModel;
uniform float uContent;
uniform vec2 uContentRange;
uniform vec4 uCurve;
uniform vec2 uLimit;
uniform vec2 uSets;
uniform float uOffset;
in vec2 vUv;
out vec4 outColour;
void main() {
  float frame = max(textureLod(uLuma, vec2(0.5), uTopLevel).r, 1e-6);
  float reference = max(textureLod(uLumaRef, vec2(0.5), uTopLevel).r, 1e-6);
  float ratio = uContent > 0.5 ? clamp(frame / reference, uContentRange.x, uContentRange.y) : 1.0;
  float L = max(uModel * ratio, 1e-6);
  float ev = clamp(uCurve.x * pow(L, uCurve.y) + uCurve.z + uCurve.w, uLimit.x, max(uLimit.x, uLimit.y));
  float span = uSets.y - uSets.x;
  float share = span > 0.0 ? clamp((ev - uSets.x) / span, 0.0, 1.0) : 0.0;
  outColour = vec4(exp2(ev + uOffset), ev, share, L);
}
`;

/* Порог свечения после экспозиции (как CalcBloom0): яркость кадра на множитель глаза, мягкое колено. */
export const THRESHOLD_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uExposure;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 outColour;
void main() {
  float exposure = texelFetch(uExposure, ivec2(0), 0).x;
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++)
      sum += texture(uScene, vUv + vec2(float(x), float(y)) * uTexel).rgb;
  vec3 colour = sum / 9.0 * exposure;
  float lum = max(dot(colour, vec3(1.0 / 3.0)), 0.0);
  float weight = clamp((lum - uThreshold) * uKnee, 0.0, 1.0);
  outColour = vec4(lum > 0.0 ? colour * weight : vec3(0.0), 1.0);
}
`;

/*
 * Сведение неба и квартала.
 *
 * Квартал стоит перед небом там, где у него есть глубина. Дальность до точки —
 * из глубины по лучу пикселя, высота над землёй — по лучу и дальности; туман
 * по дальности и низовой туман — те же формулы, что у процедурного города в
 * шейдере неба: цель перехода — цвет неба вдоль того же луча (он уже в цели
 * неба), а не произвольный цвет. Осадки и молния ложатся поверх всего кадра:
 * они между глазом и кварталом.
 */
export const COMPOSE_PASS = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D uSky;
uniform sampler2D uPrecip;
uniform sampler2D uBlock;
uniform sampler2D uDepth;
uniform float uBlockOn;
uniform float uNear;
uniform float uFar;
uniform vec2 uTan;
uniform vec2 uCamera;
uniform float uEyeHeight;

uniform vec4 uFogColour;
uniform float uFogHdr;
uniform float uFogDensity;
uniform float uMist;
uniform vec3 uFogHaze;
uniform float uFogHazeHdr;
uniform vec3 uLightColour;
uniform float uLightIntensity;
uniform float uDirectScale;
uniform vec3 uCityLight;
uniform float uNight;
uniform float uFlash;

/* Погода на земле: доля снега и мокрота (0…1), яркость белой горизонтали в кадре, глаз в осях игры, шаг по глубине. */
uniform float uSnowCover;
uniform float uWetness;
uniform vec3 uUpLight;
uniform vec3 uGroundEye;
uniform vec2 uPixel;

/* Вода: гладь лежит в плоскости uWaterEye = 0 (высота глаза над ней, под водой — минус). Цвета — яркость кадра: цвет воды на свет дня. */
uniform float uWaterOn;
uniform float uWaterEye;
uniform vec3 uWaterShore;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform float uWaterKappa;
uniform vec3 uWaterAbsorb;
uniform vec3 uWaterAbsorbUnder;
uniform vec3 uWaterSky;
uniform vec3 uWaterFog;
uniform vec3 uWaterTint;
uniform float uWaterUnderKappa;
uniform float uWaterVignette;
/* Рябь и блики гладью: где стоит глаз на карте, время волн, откуда светит солнце (луна) и чем. */
uniform vec2 uWaterEyeXY;
uniform float uWaterTime;
uniform vec3 uWaterSun;
uniform vec3 uWaterSunColour;

/* Объём кадра (block-void.js): глаз в осях игры от якоря, прямоугольник на земле (центр, sin и cos рыскания оси, полуразмеры), пол и потолок, глубина затухания у бока. */
uniform float uVoidOn;
uniform vec3 uEyeGame;
uniform vec2 uVoidCentre;
uniform vec2 uVoidAxis;
uniform vec2 uVoidHalf;
uniform vec2 uVoidZ;
uniform float uVoidFade;
/* Круг вместо прямоугольника (радиус — uVoidHalf.x) и бездна вместо чёрной пустоты за краем. */
uniform float uVoidDisc;
uniform float uVoidAbyss;

in vec2 vUv;
out vec4 outColour;

const float MIST_HEIGHT = 50.0;
const float WATER_REACH = 600.0;

/* Уклон мелкой волны в точке гладью: четыре бегущие волны, чем дальше, тем глаже (ряби вдали не различить). */
vec2 waterSlope(vec2 p, float distance) {
  float t = uWaterTime;
  vec2 slope = vec2(0.0);
  slope += vec2(0.80, 0.60) * (0.014 * 0.9 * cos(dot(p, vec2(0.80, 0.60)) * 0.9 + t * 1.1));
  slope += vec2(-0.55, 0.83) * (0.010 * 1.7 * cos(dot(p, vec2(-0.55, 0.83)) * 1.7 + t * 1.6));
  slope += vec2(0.95, -0.30) * (0.006 * 3.1 * cos(dot(p, vec2(0.95, -0.30)) * 3.1 + t * 2.3));
  slope += vec2(-0.30, -0.95) * (0.004 * 5.3 * cos(dot(p, vec2(-0.30, -0.95)) * 5.3 + t * 3.1));
  return slope * (1.0 / (1.0 + distance * 0.02));
}

float lowMist(float height, float distance) {
  if (uMist <= 0.0) return 0.0;
  float layer = exp(-max(height, 0.0) / MIST_HEIGHT);
  float reach = 1.0 - exp(-distance * 0.0009 * (0.4 + uMist));
  return clamp(layer * reach * (0.35 + 0.65 * uMist), 0.0, 0.97);
}

/*
 * Погода на земле (ТЗ 24.10.2026, п. 1): снег на горизонтальном и мокрый тёмный асфальт с бликом неба. Квартал — материалы
 * игры, их программы не трогаются: нормаль «вверх» берётся из глубины кадра по соседним точкам (с той стороны, где перепад
 * меньше), поэтому снег ложится на землю и крыши, а стены и края зданий остаются чистыми. Работает только при снеге или
 * дожде (ветка по юниформу), геометрия и материалы не пересоздаются.
 */
float groundHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float groundNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), f.x),
    mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

vec3 rayAt(vec2 uv) {
  vec2 nd = uv * 2.0 - 1.0;
  float yaw = uCamera.x;
  float pitch = uCamera.y;
  vec3 forward = vec3(sin(yaw) * cos(pitch), cos(yaw) * cos(pitch), sin(pitch));
  vec3 right = vec3(cos(yaw), -sin(yaw), 0.0);
  vec3 up = cross(right, forward);
  return normalize(forward + right * nd.x * uTan.x + up * nd.y * uTan.y);
}

/* Точка кадра в осях игры от глаза: луч пикселя на дальность из глубины. */
vec3 gamePosition(vec2 uv) {
  float zNdc = texture(uDepth, uv).r * 2.0 - 1.0;
  float viewZ = 2.0 * uNear * uFar / (uFar + uNear - zNdc * (uFar - uNear));
  return rayAt(uv) * (viewZ * length(vec3((uv * 2.0 - 1.0) * uTan, 1.0)));
}

vec3 groundWeather(vec3 lit, vec3 dir) {
  vec3 p0 = gamePosition(vUv);
  vec3 pr = gamePosition(vUv + vec2(uPixel.x, 0.0));
  vec3 pl = gamePosition(vUv - vec2(uPixel.x, 0.0));
  vec3 pu = gamePosition(vUv + vec2(0.0, uPixel.y));
  vec3 pd = gamePosition(vUv - vec2(0.0, uPixel.y));
  vec3 hx = length(pr - p0) < length(p0 - pl) ? pr - p0 : p0 - pl;
  vec3 hy = length(pu - p0) < length(p0 - pd) ? pu - p0 : p0 - pd;
  vec3 n = cross(hx, hy);
  float size = length(n);
  if (size < 1.0e-9) return lit;
  n /= size;
  if (dot(n, dir) > 0.0) n = -n;
  /* Скачок глубины на краю здания даёт мусорную нормаль: вблизи края слой не кладётся. */
  float reach = max(length(hx), length(hy)) / max(length(p0), 1.0);
  float flatUp = smoothstep(0.62, 0.9, n.z) * (1.0 - smoothstep(0.2, 0.45, reach));
  if (flatUp <= 0.0) return lit;

  vec2 world = uGroundEye.xy + p0.xy;
  /* Мелкая рябь с расстоянием гаснет в среднее: вдали она мерцала бы по пикселю. */
  float farFade = smoothstep(25.0, 140.0, length(p0));
  float coarseFade = smoothstep(50.0, 300.0, length(p0));
  float spots = mix(groundNoise(world * 0.35), 0.5, coarseFade) * 0.6 + mix(groundNoise(world * 1.9), 0.5, farFade) * 0.4;
  vec3 result = lit;
  float covered = 0.0;
  if (uSnowCover > 0.0) {
    covered = clamp(uSnowCover * 1.7 - 0.1 + (spots - 0.5) * 0.45, 0.0, 1.0) * flatUp;
    vec3 snow = uUpLight * 0.86;
    float shade = 0.82 + 0.18 * clamp(dot(lit, vec3(0.3333)) * 4.0 / max(dot(uUpLight, vec3(0.3333)), 1.0e-4), 0.0, 1.0);
    result = mix(result, snow * shade * (0.94 + 0.06 * spots), covered);
  }
  if (uWetness > 0.0) {
    float wet = uWetness * flatUp * (1.0 - covered);
    float puddle = smoothstep(0.35, 0.65, spots);
    result *= mix(1.0, 0.5, wet);
    /* Блик неба на мокром: зеркальный луч берёт пиксель кадра неба (как гладь воды), по Френелю, лужами сильнее. */
    /* Зеркало — ровная земля: нормаль из глубины на скользящем луче дрожит по пикселю, а блик от неё мерцал бы. */
    vec3 mirrored = reflect(dir, vec3(0.0, 0.0, 1.0));
    mirrored.z = max(mirrored.z, 0.02);
    vec3 forward = rayAt(vec2(0.5));
    vec3 right = vec3(cos(uCamera.x), -sin(uCamera.x), 0.0);
    vec3 up = cross(right, forward);
    float ahead = dot(mirrored, forward);
    vec2 mirrorNdc = vec2(dot(mirrored, right) / (max(ahead, 0.05) * uTan.x), dot(mirrored, up) / (max(ahead, 0.05) * uTan.y));
    vec3 reflection = ahead > 0.05
      ? texture(uSky, clamp(mirrorNdc, vec2(-0.97), vec2(0.97)) * 0.5 + 0.5).rgb
      : uFogColour.rgb * max(uFogHdr, 0.0) * 0.35;
    float facing = clamp(-dir.z, 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    result += reflection * fresnel * wet * (0.35 + 0.65 * puddle);
  }
  return result;
}

/* Бездна за краем круга мира: дымка горизонта, что к низу темнеет, а над горизонтом — небо; не чёрный купол. */
vec3 abyss(vec3 dir, vec3 sky) {
  vec3 haze = uFogColour.rgb * max(uFogHdr, 0.0) * 0.35;
  float below = clamp(-dir.z * 3.0, 0.0, 1.0);
  vec3 deepColour = haze * 0.06;
  vec3 floorColour = mix(haze * 0.8, deepColour, smoothstep(0.0, 1.0, below));
  return mix(floorColour, sky, smoothstep(-0.02, 0.06, dir.z));
}

void main() {
  vec3 sky = texture(uSky, vUv).rgb;
  vec3 colour = sky;
  vec2 ndc = vUv * 2.0 - 1.0;
  float depth = texture(uDepth, vUv).r;
  bool hit = uBlockOn > 0.5 && depth < 0.999999;

  /* Луч в осях игры — тот же базис, что у шейдера неба (рыскание, тангаж, без крена). */
  float yaw = uCamera.x;
  float pitch = uCamera.y;
  vec3 forward = vec3(sin(yaw) * cos(pitch), cos(yaw) * cos(pitch), sin(pitch));
  vec3 right = vec3(cos(yaw), -sin(yaw), 0.0);
  vec3 up = cross(right, forward);
  vec3 dir = normalize(forward + right * ndc.x * uTan.x + up * ndc.y * uTan.y);
  vec3 lit = vec3(0.0);
  float dist = 1.0e9;

  if (hit) {
    lit = texture(uBlock, vUv).rgb;
    if (uSnowCover > 0.0 || uWetness > 0.0) lit = groundWeather(lit, dir);
    float zNdc = depth * 2.0 - 1.0;
    float viewZ = 2.0 * uNear * uFar / (uFar + uNear - zNdc * (uFar - uNear));
    vec3 ray = vec3(ndc * uTan, 1.0);
    dist = viewZ * length(ray);
    float height = uEyeHeight + dir.z * dist;

    vec3 fog = uFogColour.rgb * max(uFogHdr, 0.0) * 0.35;
    float distanceFog = 1.0 - exp(-clamp(uFogDensity, 0.0, 60.0) * 0.000045 * dist);
    vec3 aerial = mix(fog * 0.85, sky, smoothstep(0.5, 0.96, distanceFog));
    float veil = clamp(
      distanceFog + (1.0 - distanceFog) * lowMist(height, dist),
      0.0,
      0.94 + 0.05 * uMist
    );
    colour = mix(lit, aerial, veil);
  }

  /*
   * Объём кадра: что вне прямоугольника улицы и ниже пола — чёрная пустота, не туман и не земля неба. Луч
   * из глаза (внутри объёма) уходит через бок или пол: здание, лежащее дальше выхода, и пустое место
   * заменяются чёрным: и если выход ниже потолка, и если выше — выше потолка **чёрный купол** (ТЗ 20.10.2026: «сверху не должно быть
   * ясности» — у кадров с куском территории небо и звёзды над улицей не рисуются). Кадр с объёмом — «Фонари»; у «Таймциклов» объёма
   * нет (uVoidOn выключен), и небо там остаётся. У самого бока то, что есть, гаснет к чёрному.
   * Альфа 0,75 отмечает пустоту для прохода яркости и не мешает сглаживанию (оно смотрит на 0,5).
   */
  float voided = 0.0;
  if (uVoidOn > 0.5) {
    vec2 e = uEyeGame.xy - uVoidCentre;
    vec2 eL = vec2(dot(e, uVoidAxis), e.x * uVoidAxis.y - e.y * uVoidAxis.x);
    vec2 dL = vec2(dot(dir.xy, uVoidAxis), dir.x * uVoidAxis.y - dir.y * uVoidAxis.x);
    float tSide = 1.0e9;
    if (uVoidDisc > 0.5) {
      /* Круг: луч из глаза внутри выходит там, где |eL + t·dL| = R (больший корень). */
      float qa = dot(dL, dL);
      float qb = dot(eL, dL);
      float qc = dot(eL, eL) - uVoidHalf.x * uVoidHalf.x;
      tSide = qa > 1.0e-10 ? max((-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa, 0.0) : 1.0e9;
    } else {
      float tu = dL.x > 1.0e-5 ? (uVoidHalf.x - eL.x) / dL.x : (dL.x < -1.0e-5 ? (-uVoidHalf.x - eL.x) / dL.x : 1.0e9);
      float tv = dL.y > 1.0e-5 ? (uVoidHalf.y - eL.y) / dL.y : (dL.y < -1.0e-5 ? (-uVoidHalf.y - eL.y) / dL.y : 1.0e9);
      tSide = max(min(tu, tv), 0.0);
    }
    float tFloor = dir.z < -1.0e-5 ? max((uVoidZ.x - uEyeGame.z) / dir.z, 0.0) : 1.0e9;
    float tIn = min(tSide, tFloor);
    if (hit && dist < tIn) {
      vec3 pos = uEyeGame + dir * dist;
      vec2 pe = pos.xy - uVoidCentre;
      float deep = uVoidDisc > 0.5 ? uVoidHalf.x - length(pe) : min(uVoidHalf.x - abs(dot(pe, uVoidAxis)), uVoidHalf.y - abs(pe.x * uVoidAxis.y - pe.y * uVoidAxis.x));
      colour = mix(colour, uVoidAbyss > 0.5 ? abyss(dir, sky) : vec3(0.0), 1.0 - smoothstep(0.0, max(uVoidFade, 0.01), deep));
    } else {
      float zExit = uEyeGame.z + dir.z * tSide;
      hit = false;
      dist = 1.0e9;
      /* Пустота и купол — оба чёрные; альфа 0,75 у обоих: проход яркости берёт на их месте небо без квартала. */
      colour = uVoidAbyss > 0.5 ? abyss(dir, sky) : vec3(0.0);
      voided = 1.0;
    }
  }

  /*
   * Вода. Сверху: луч вниз доходит до глади раньше дна (или дно — за гладью,
   * или дна нет — открытое море); в толще, длиной column, дно гаснет в цвет воды
   * по глубине (мель — глубь), а у глади отражается небо. Снизу: всё — толща; дно и
   * даль тонут в цвет подводного тумана, вверх виден «круг Снеллиуса» — окно в небо.
   * Поглощение по каналам: тот, чей цвет у воды сильнее, глохнет медленнее.
   */
  float waterTouch = 0.0;
  if (uWaterOn > 0.5) {
    float reach = hit ? dist : 1.0e9;
    if (uWaterEye > 0.0) {
      float tw = dir.z < -1.0e-4 ? uWaterEye / -dir.z : 1.0e9;
      if (tw < reach) {
        float column = hit ? min(dist - tw, WATER_REACH) : WATER_REACH;
        float floorDepth = hit ? max(-(uWaterEye + dir.z * dist), 0.0) : 80.0;
        float deep = clamp(floorDepth / 32.0, 0.0, 1.0);
        vec3 body = deep < 0.5 ? mix(uWaterShore, uWaterMid, deep * 2.0) : mix(uWaterMid, uWaterDeep, deep * 2.0 - 1.0);
        vec3 through = exp(-uWaterKappa * uWaterAbsorb * column);
        /* Рябь: уклон волны в точке глади; блеск дна мелью — свет, что дрожит на песке под волнами. */
        vec2 spot = uWaterEyeXY + dir.xy * tw;
        vec2 slope = waterSlope(spot, tw);
        vec3 normal = normalize(vec3(-slope, 1.0));
        float shimmer = 0.5 + 0.5 * sin(spot.x * 1.9 + uWaterTime * 1.2) * sin(spot.y * 2.3 - uWaterTime * 0.9);
        float shallows = (1.0 - smoothstep(0.0, 4.0, floorDepth)) / (1.0 + tw * 0.04);
        vec3 seabed = hit ? lit * (1.0 + 0.45 * shimmer * shimmer * shimmer * shallows) : vec3(0.0);
        vec3 beneath = seabed * through + body * (vec3(1.0) - through);
        float facing = clamp(dot(-dir, normal), 0.0, 1.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        vec3 haze = uFogColour.rgb * max(uFogHdr, 0.0) * 0.35;
        /* Небо в гладь: отражённый луч — это взгляд в небо под тем же углом над горизонтом, и пиксель неба с облаками берётся из кадра неба
           (зеркало по линии горизонта, ряби качают его); что вышло за верх кадра — верхняя кромка неба. Солнце — бликом по ряби. */
        vec3 mirrored = reflect(dir, normal);
        mirrored.z = max(mirrored.z, 0.02);
        float ahead = dot(mirrored, forward);
        vec2 mirrorNdc = vec2(dot(mirrored, right) / (max(ahead, 0.05) * uTan.x), dot(mirrored, up) / (max(ahead, 0.05) * uTan.y));
        vec3 reflection = ahead > 0.05
          ? texture(uSky, clamp(mirrorNdc, vec2(-0.97), vec2(0.97)) * 0.5 + 0.5).rgb
          : uWaterSky;
        float glint = pow(max(dot(mirrored, uWaterSun), 0.0), 360.0) * 3.0 + pow(max(dot(mirrored, uWaterSun), 0.0), 2600.0) * 40.0;
        vec3 surface = mix(beneath, reflection, fresnel) + uWaterSunColour * glint * fresnel;
        float away = 1.0 - exp(-clamp(uFogDensity, 0.0, 60.0) * 0.000045 * min(tw, 40000.0));
        /* Даль моря тонет в дымку у горизонта (с оттенком глуби — чтобы не серела), а не в цвет земли, что рисует небо под ним. */
        colour = mix(surface, mix(haze * 0.85, uWaterDeep, 0.4), clamp(away * 0.55, 0.0, 0.94));
        waterTouch = 1.0;
      }
    } else {
      float path = hit ? min(dist, WATER_REACH) : WATER_REACH;
      vec3 through = exp(-uWaterUnderKappa * uWaterAbsorbUnder * path);
      vec3 water = (hit ? lit * uWaterTint : vec3(0.0)) * through + uWaterFog * (vec3(1.0) - through);
      float tw = dir.z > 1.0e-4 ? -uWaterEye / dir.z : 1.0e9;
      if (tw < reach) {
        float window = smoothstep(0.6, 0.74, dir.z);
        vec3 seen = exp(-uWaterUnderKappa * uWaterAbsorbUnder * min(tw, WATER_REACH));
        water = mix(water, uWaterSky * uWaterTint * seen + uWaterFog * (vec3(1.0) - seen), window);
      }
      colour = water * (1.0 - uWaterVignette * smoothstep(0.35, 1.3, length(ndc)));
      waterTouch = 1.0;
    }
  }

  /* Осадки — между глазом и кадром: поверх неба и квартала. */
  vec2 fall = texture(uPrecip, vUv).rg;
  if (fall.x > 0.0) {
    float snowy = fall.y;
    vec3 hazeColour = uFogHaze * max(uFogHazeHdr, 0.0);
    vec3 lamps =
      uLightColour * uLightIntensity * uDirectScale * mix(0.012, 0.03, snowy)
      + uCityLight * uNight * mix(0.02, 0.05, snowy);
    vec3 fallColour = snowy > 0.5
      ? max(hazeColour * 1.6 + lamps, colour * 1.45)
      : colour * 0.7 + hazeColour * 0.12 * uNight + lamps;
    colour = mix(colour, fallColour, fall.x * 0.85);
  }

  /* Молния освещает весь кадр, а не одно облако. */
  colour *= 1.0 + uFlash * 1.6;
  colour += vec3(0.55, 0.62, 0.80) * uFlash * 0.25;

  /* Альфа — где кадр заняло здание: сглаживание краёв работает только там, звёзды в небе не размывает. */
  float onBlock = max(hit ? 1.0 : 0.0, waterTouch);
  outColour = vec4(colour, voided > 0.5 ? 0.75 : onBlock);
}
`;

/*
 * Сведение в холст: экспозиция кадра, свечение, плёночная кривая Хейбла с
 * набором, смешанным по экспозиции, насыщенность и гамма. Порядок — как у кадра
 * неба: умножение на 2^EV, кривая, насыщенность, гамма; свечение складывается
 * до кривой (Composite в postfx.fxc). Экспозиция и доля набора — из точки
 * глаза (`EXPOSURE_PASS`); наборы «ярко» и «темно» — юниформами (`frame-post.js`).
 */
export const PRESENT_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomSmall;
uniform sampler2D uBloomMed;
uniform sampler2D uBloomLarge;
uniform sampler2D uExposure;
uniform vec3 uBloomBlend;
uniform float uBloomIntensity;
uniform vec4 uBright0;
uniform vec4 uBright1;
uniform vec4 uDark0;
uniform vec4 uDark1;
uniform float uSaturation;
uniform float uGamma;
uniform float uOpaque;
in vec2 vUv;
out vec4 outColour;

void main() {
  vec4 eye = texelFetch(uExposure, ivec2(0), 0);
  float exposure = eye.x;
  /* Набор «темно» подмешивается по EV: на улице экспозиция у нижнего предела — кадр целиком на «ярко». */
  vec4 set0 = mix(uBright0, uDark0, eye.z);
  vec4 set1 = mix(uBright1, uDark1, eye.z);
  float a = set0.x, b = set0.y, c = set0.z, d = set0.w;
  float e = set1.x, f = set1.y, w = set1.z;

  vec4 frame = texture(uScene, vUv);
  vec3 scene = frame.rgb;
  vec3 bloom = texture(uBloomSmall, vUv).rgb * uBloomBlend.x
    + texture(uBloomMed, vUv).rgb * uBloomBlend.y
    + texture(uBloomLarge, vUv).rgb * uBloomBlend.z;
  vec3 x = max(scene * exposure + bloom * uBloomIntensity * 0.25, 0.0);
  vec3 curve = (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
  float white = (w * (a * w + c * b) + d * e) / (w * (a * w + b) + d * f) - e / f;
  vec3 mapped = clamp(curve / white, 0.0, 1.0);
  float grey = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(vec3(grey), mapped, clamp(uSaturation, 0.0, 2.0));
  outColour = vec4(pow(mapped, vec3(1.0 / uGamma)), mix(frame.a, 1.0, uOpaque));
}
`;

/*
 * Сглаживание краёв — FXAA по готовому кадру: ищем перепад яркости по четырём
 * соседям и четырём углам, берём направление края и усредняем вдоль него. Там,
 * где ни у пикселя, ни у соседей нет здания (альфа ноль), кадр не трогаем —
 * иначе звёзды в небе расплылись бы.
 */
export const FXAA_PASS = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColour;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 middle = texture(uImage, vUv);
  vec4 north = texture(uImage, vUv + vec2(0.0, -1.0) * uTexel);
  vec4 south = texture(uImage, vUv + vec2(0.0, 1.0) * uTexel);
  vec4 west = texture(uImage, vUv + vec2(-1.0, 0.0) * uTexel);
  vec4 east = texture(uImage, vUv + vec2(1.0, 0.0) * uTexel);
  if (max(max(middle.a, north.a), max(max(south.a, west.a), east.a)) < 0.5) {
    outColour = vec4(middle.rgb, 1.0);
    return;
  }
  float lM = luma(middle.rgb);
  float lN = luma(north.rgb);
  float lS = luma(south.rgb);
  float lW = luma(west.rgb);
  float lE = luma(east.rgb);
  float lMin = min(lM, min(min(lN, lS), min(lW, lE)));
  float lMax = max(lM, max(max(lN, lS), max(lW, lE)));
  if (lMax - lMin < max(0.03, lMax * 0.1)) {
    outColour = vec4(middle.rgb, 1.0);
    return;
  }
  float lNW = luma(texture(uImage, vUv + vec2(-1.0, -1.0) * uTexel).rgb);
  float lNE = luma(texture(uImage, vUv + vec2(1.0, -1.0) * uTexel).rgb);
  float lSW = luma(texture(uImage, vUv + vec2(-1.0, 1.0) * uTexel).rgb);
  float lSE = luma(texture(uImage, vUv + vec2(1.0, 1.0) * uTexel).rgb);

  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * scale, vec2(-8.0), vec2(8.0)) * uTexel;

  vec3 near = 0.5 * (
    texture(uImage, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture(uImage, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 wide = near * 0.5 + 0.25 * (
    texture(uImage, vUv + dir * -0.5).rgb +
    texture(uImage, vUv + dir * 0.5).rgb
  );
  float lWide = luma(wide);
  outColour = vec4((lWide < lMin || lWide > lMax) ? near : wide, 1.0);
}
`;
