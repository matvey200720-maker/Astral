/*
 * Шейдеры частиц — перенос математики `ptfx_sprite.fxc` игры.
 *
 * Это не «похожий» шейдер, а та же арифметика, что в байткоде GTA V Legacy
 * (common.rpf/shaders/win32_40_final/ptfx_sprite.fxc, разобранном
 * `D3DDisassemble`): техники RGBA/RGB, освещённые (`_lit`) и мягкие
 * (`_soft`), проходы BM0 (обычное смешение) и BM1 (сложение). Отличие только
 * в том, что игра строит вершины спрайта на процессоре и передаёт их в девяти
 * атрибутах, а здесь угол спрайта собирается из точки и двух рёбер.
 *
 * Что делает игра и повторено здесь:
 *  • текстура переводится в линейный цвет возведением RGB в квадрат (гамма 2),
 *    альфа — как есть; два кадра листа смешиваются долей `frameBlend`;
 *  • неосвещённые: цвет вершины c (как задан художником) плюс свечение
 *    c² · emissive, умноженные на текстуру;
 *  • освещённые: c² · (окружение по нормали + солнце с «обёрткой» wrap) —
 *    нормаль спрайта загибается от центра к краям на `normalArc`, отсюда
 *    объём у дыма; поверх — свечение tex · c · max(lum − 0.05, 0) · emissive;
 *  • мягкость: альфа гаснет, пока до сцены ближе √(1/softness) метра:
 *    saturate((Δ² − радиус·softnessCurve) · softness);
 *  • BM1 (BlendSet 1, сложение): цвет заранее умножен на альфу вершины,
 *    мягкость к альфе не применяется, текстурная альфа не участвует;
 *  • местные огни (`extralightmult`): до четырёх точечных огней рядом —
 *    фонарь, под которым кружит рой. Сцена без огней (попадания) их не
 *    задаёт, и свет там тот же, что был.
 */

import { LOCAL_LIGHT_GLSL } from "./ptfx-lights.js";

export const SPRITE_VERTEX = /* glsl */ `
precision highp float;

in vec2 corner;

in vec3 iCorner;
in vec3 iEdgeU;
in vec3 iEdgeV;
in vec3 iNormal;
in vec4 iUvA;
in vec4 iUvB;
in vec4 iColour;
/* x — доля второго кадра, y — свечение, z — мягкость, w — множитель альфы */
in vec4 iParams;
/* x — загиб нормали к краям (normalArc), y — сдвиг к камере, z — softnessCurve */
in vec4 iShape;
/* x — wrap, y — множитель солнца, z — множитель окружения */
in vec4 iLight;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;

uniform vec3 uSunDirection;
uniform vec3 uSunColour;
uniform vec4 uAmbientGradient;
uniform vec4 uAmbientBase;
uniform vec3 uAmbientDirectional;
uniform vec3 uAmbientDirectionalAxis;
/* particle_emissive_intensity_mult таймцикла. */
uniform float uEmissiveMult;
${LOCAL_LIGHT_GLSL}

out vec4 vUv;
out vec4 vColour;
out vec3 vRawColour;
out vec3 vSun;
out vec4 vParams;
out float vRadial;
out float vViewDepth;

void main() {
  vec3 world = iCorner + corner.x * iEdgeU + corner.y * iEdgeV;
  vec3 centre = iCorner + 0.5 * (iEdgeU + iEdgeV);
  float halfDiagonal = max(length(0.5 * (iEdgeU + iEdgeV)), 1e-6);
  /* Расстояние угла от центра в долях полудиагонали — для кривой мягкости. */
  vRadial = length(world - centre) / halfDiagonal * iShape.z;

#ifdef SCENE_Y_UP
  /* Частицы считаются в осях игры (Z вверх), а камера сцены кадра — Y вверх: точка игры (x, y, z) в сцене — (x, z, −y). */
  vec3 eye = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);
#else
  vec3 eye = cameraPosition;
#endif

  /* Сдвиг к камере (camerabias): спрайт вылезает из стены и из тела. */
  vec3 biased = world + normalize(eye - world) * iShape.y;
  vec3 biasedCentre = centre + normalize(eye - centre) * iShape.y;

  vUv = vec4(
    mix(iUvA.x, iUvA.z, corner.x), mix(iUvA.y, iUvA.w, 1.0 - corner.y),
    mix(iUvB.x, iUvB.z, corner.x), mix(iUvB.y, iUvB.w, 1.0 - corner.y)
  );

  vec3 c = iColour.rgb;
  vRawColour = c;
  vParams = vec4(iParams.x, iParams.y * uEmissiveMult, iParams.z, iParams.w);
  float alpha = iColour.a <= 0.000001 ? 0.0 : iColour.a * iParams.w;

#ifdef LIT
  vec3 radial = biased - biasedCentre;
  /* Центральная вершина (ближе ~3 см к центру) освещена «лицом к камере». */
  vec3 normal = dot(radial, radial) < 0.001 ? iNormal : normalize(radial);
  normal = normalize(mix(iNormal, normal, iShape.x));
  vec3 c2 = c * c;
  float wrap = iLight.x;
  float wrapDenominator = (wrap + 1.0) * (wrap + 1.0);
  float sun = clamp((clamp(dot(normal, -uSunDirection), 0.0, 1.0) + wrap) / wrapDenominator, 0.0, 1.0);
  /* Тонкая частица (крыло, лепесток) светится и с изнанки — обёртка 0.6. */
  vSun = c2 * sun * uSunColour * iLight.y + c2 * localLight(biased, normal, 0.6) * iLight.w;
  float gradient = max((normal.z + uAmbientGradient.w) * uAmbientBase.w, 0.0);
  vec3 natural = uAmbientGradient.rgb * gradient + uAmbientBase.rgb;
  vec3 directional = uAmbientDirectional * clamp(dot(uAmbientDirectionalAxis, normal), 0.0, 1.0);
  vColour = vec4(c2 * (natural + directional) * iLight.z, alpha);
#else
  vSun = vec3(0.0);
  vColour = vec4(c + c * c * iParams.y * uEmissiveMult, alpha);
#endif

#ifdef SCENE_Y_UP
  vec4 view = viewMatrix * vec4(biased.x, biased.z, -biased.y, 1.0);
#else
  vec4 view = viewMatrix * vec4(biased, 1.0);
#endif
  vViewDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

export const SPRITE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
/* Глубина сцены (метры вдоль взгляда) — рельеф персонажа, R-канал. */
uniform sampler2D uSceneDepth;
uniform vec2 uViewport;
uniform float uHasSceneDepth;
uniform float uSoftShadowMult;
uniform float uSoftShadowOffset;
uniform vec3 uAlphaCutoff;
uniform float uExposureScale;
/* Туман кадра игры: цвет и (ближняя граница, дальняя граница, доля) — доля 0 тумана нет. */
uniform vec3 uFogColour;
uniform vec3 uFogParams;

in vec4 vUv;
in vec4 vColour;
in vec3 vRawColour;
in vec3 vSun;
in vec4 vParams;
in float vRadial;
in float vViewDepth;

out vec4 outColour;

float sceneViewDepth() {
  return texture(uSceneDepth, gl_FragCoord.xy / uViewport).r;
}

void main() {
  vec4 a = texture(uTexture, vUv.xy);
  vec4 b = texture(uTexture, vUv.zw);
  a.rgb *= a.rgb;
  b.rgb *= b.rgb;
  vec4 tex = mix(a, b, clamp(vParams.x, 0.0, 1.0));

#ifdef RGB_ONLY
  /* Техника RGB: альфа из суммы каналов с порогом alphacutoffminmax. */
  float sum = tex.r + tex.g + tex.b;
  float above = clamp((sum - uAlphaCutoff.x) * 10000.0, 0.0, 1.0);
  float below = clamp((uAlphaCutoff.y + 0.001 - sum) * 10000.0, 0.0, 1.0);
  tex.a = sum + uAlphaCutoff.z * (above * below - sum);
#endif

  float soft = 1.0;
  float shadow = 1.0;
#ifdef SOFT
  if (uHasSceneDepth > 0.5) {
    float gap = sceneViewDepth() - vViewDepth;
    float d2 = gap * gap - vRadial;
    soft = clamp(d2 * vParams.z, 0.0, 1.0);
    float shade = clamp((d2 - uSoftShadowOffset) * vParams.z, 0.0, 1.0);
    shadow = shade + (1.0 - shade) * (1.0 - uSoftShadowMult);
  }
#endif

#ifdef LIT
  vec3 lit = (vColour.rgb + vSun) * shadow;
  vec3 colour = lit * tex.rgb;
  vec3 glow = tex.rgb * vRawColour;
  float glowAmount = clamp(dot(glow, vec3(0.2126, 0.7152, 0.0722)) - 0.05, 0.0, 1.0) * vParams.y;
  colour += glow * glowAmount;
#else
  vec3 colour = vColour.rgb * shadow * tex.rgb;
#endif

  /* Туман: расстояние вдоль взгляда — то же, что depthMeters опор сцены. Сложение гаснет, смешение уходит в цвет тумана. */
  float fog = uFogParams.z * clamp((vViewDepth - uFogParams.x) / max(uFogParams.y - uFogParams.x, 0.001), 0.0, 1.0);

#ifdef ADDITIVE
  colour *= vColour.a * (1.0 - fog);
  outColour = vec4(colour * uExposureScale, 1.0);
#else
  colour = mix(colour, uFogColour, fog);
  float alpha = clamp(vColour.a * soft * tex.a, 0.0, 1.0);
  outColour = vec4(colour * uExposureScale, alpha);
#endif
}
`;
