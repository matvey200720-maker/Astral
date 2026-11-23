/*
 * Облачные шапки в кадре неба — отдельным проходом WebGL2.
 *
 * Купол неба рисуется одним полноэкранным треугольником, а шапка — это
 * модели из `v_clouds.rpf`: сотни вершин на слой, три листа плотности и три
 * нормалей. Проход рисует их в свой буфер с плавающей точкой (свет облаков —
 * в тех же HDR-единицах, что и купол: днём за двадцать), а шейдер купола
 * берёт из буфера свой пиксель и кладёт облака между небом и дымкой — там же,
 * где их рисует игра.
 *
 * Шейдеры — порт `clouds_*` игры по дизассемблеру (`common.rpf/shaders/
 * win32_40_final/clouds_*.fxc`, разобран заново 12.10.2026). Шейдеров у
 * шапок два семейства, и формулы у них разные:
 *
 *   clouds_animsoft, clouds_anim, clouds_altitude — три листа плотности и
 *     три нормалей, плотность 1 − g², масса — зелёным каналом вершины, сдвиг
 *     выедания — синим;
 *   clouds_fast, clouds_soft — один лист плотности и один нормалей,
 *     плотность 1 − g (без квадрата!), цвет вершины — только альфа.
 *
 * Прежний кадр рисовал все шапки первой формулой: у «быстрых» (перистые,
 * барашки, пряди, слой, полосы, пелена, пасмурно…) плотность выходила
 * гуще, и края моделей шапок проступали резкими многоугольниками.
 *
 * Остальное общее: заливка с четырёх сторон, «обёрнутый» свет, рассеяние
 * Корнетта — Шэнкса и пробой у кромок. Не перенесены мягкие края о
 * геометрию мира (в кадре нет буфера глубины) и туман по расстоянию — его в
 * кадре кладёт дымка купола поверх облаков.
 *
 * Листы нормалей в формате BC5 выкладка окна получает испорченными (в
 * декодере CodeWalker зелёный канал BC5 пишется в красный: зелёный — сплошь
 * 255, красный — шум блоками 4×4). Такой лист кадр не берёт: нормаль
 * выводится из того же листа плотности, рельефом по её градиенту — так,
 * как устроены целые листы нормалей игры (`contrails_nrm3`: нормаль ≈
 * −градиент плотности).
 */

import { cloudHatMotion, groundCloudLayers } from "@modovik/timecycle";
import { tr } from "../../../../locales/ui.js";

const HAT_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;
layout(location = 3) in vec2 aUv;
layout(location = 4) in vec4 aColour;

uniform vec3 uScale;
uniform vec3 uOrigin;
uniform float uAngle;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uProjection;
uniform vec2 uRescale1;
uniform vec2 uRescale2;
uniform vec2 uRescale3;
uniform vec2 uUvOffset1;
uniform vec2 uUvOffset2;
uniform vec2 uUvOffset3;
uniform vec3 uLightDirection;
uniform vec3 uLightColour;
uniform vec4 uScatter;   // g, g², множитель фазы, яркость
uniform vec4 uPiercing;  // степень, сила, сила по нормали, толщина
// Цвет тумана по направлению — тот же, что у купола (skyFogColour).
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec3 uFogSun;
uniform vec3 uFogEast;
uniform vec3 uFogMoon;
uniform vec3 uFogPowers;  // острота пятна солнца, луны; вес лунного пятна

out vec3 vNormal;
out vec3 vTangent;
out vec3 vBinormal;
out vec4 vColour;
out vec2 vUv1;
out vec4 vUv23;
out vec4 vPierce;
out vec3 vScatter;
out vec3 vFog;

const float NEAR = 1.0;

// Нулевой вектор (касательная без знака у части вершин) не нормируется в
// NaN: NaN в цвете гасил бы облако целиком.
vec3 unit(vec3 value, vec3 fallback) {
  float size = length(value);
  return size > 1e-6 ? value / size : fallback;
}

void main() {
  float c = cos(uAngle);
  float s = sin(uAngle);
  mat3 spin = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
  // Шапка стоит вокруг камеры, как в игре: мир здесь — смещение от глаза.
  vec3 world = spin * (aPosition * uScale) + uOrigin;
  vec3 dir = normalize(world);

  // Нормали — той же матрицей мира, что и позиция, с нормировкой после:
  // так делает вершинный шейдер игры.
  vNormal = unit(spin * (aNormal * uScale), -dir);
  vTangent = unit(spin * (aTangent.xyz * uScale), vec3(1.0, 0.0, 0.0));
  vBinormal = unit(
    spin * (cross(aTangent.xyz, aNormal) * aTangent.w * uScale),
    unit(cross(vTangent, vNormal), vec3(0.0, 0.0, 1.0))
  );
  vColour = aColour;

  vUv1 = aUv * uRescale1 + uUvOffset1;
  vUv23 = vec4(aUv * uRescale2 + uUvOffset2, aUv * uRescale3 + uUvOffset3);

  float mu = dot(dir, uLightDirection);
  vec3 across = uLightDirection * mu - dir;
  float acrossLength = length(across);
  vPierce.xyz = acrossLength > 1e-5 ? across / acrossLength : vec3(0.0);
  vPierce.w = pow(clamp(mu, 0.0, 1.0), max(uPiercing.x, 1e-3));

  float denominator = pow(abs(1.0 + uScatter.y - 2.0 * uScatter.x * mu), 1.5);
  vScatter = (1.0 + mu * mu) / max(denominator, 1e-4)
    * uScatter.z * uLightColour * uScatter.w;

  float toSun = pow(clamp(dot(dir, uSunDirection), 0.0, 1.0), max(uFogPowers.x, 0.01));
  float toMoon = pow(clamp(dot(dir, uMoonDirection), 0.0, 1.0), max(uFogPowers.y, 0.01))
    * uFogPowers.z;
  vFog = mix(mix(uFogEast, uFogMoon, toMoon), uFogSun, toSun);

  float x = dot(world, uRight);
  float y = dot(world, uUp);
  float z = dot(world, uForward);
  gl_Position = vec4(x * uProjection.x, y * uProjection.y, z - 2.0 * NEAR, z);
}`;

const HAT_FRAGMENT = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vTangent;
in vec3 vBinormal;
in vec4 vColour;
in vec2 vUv1;
in vec4 vUv23;
in vec4 vPierce;
in vec3 vScatter;
in vec3 vFog;
out vec4 fragColour;

uniform sampler2D uDensity;
uniform sampler2D uNormal;
uniform sampler2D uDetailDensity;
uniform sampler2D uDetailNormal;
uniform sampler2D uDetail2Density;
uniform sampler2D uDetail2Normal;

uniform vec3 uBlend;     // веса листов шапки (mAnimBlendWeights)
uniform vec3 uCombine;   // лист добавляет плотность
uniform vec3 uSculpt;    // лист выедает плотность
uniform vec3 uSkyColour;
uniform vec3 uEastMinusWest;
uniform vec3 uWestColour;
uniform vec3 uBounceColour;
uniform vec3 uAmbientColour;
uniform vec3 uCloudColour;
uniform vec3 uLightColour;
uniform vec3 uLightDirection;
uniform vec2 uDensityShiftScale;
uniform vec4 uPiercing;
uniform vec3 uScaleDiffuseFillAmbient;
uniform vec2 uWrap;
uniform float uFade;
// 1 — шейдер clouds_fast / clouds_soft: один лист, плотность 1 − g.
uniform float uSimple;

vec3 unpackNormal(vec4 texel) {
  vec2 xy = texel.xy * 2.0 - 1.0;
  return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

void main() {
  vec3 normal;
  float cover;
  float vertexAlpha = vColour.a;
  if (uSimple > 0.5) {
    // PSCloudsVertScatterPiercing (clouds_fast) и _Soft: плотность — 1 − g,
    // нормаль — один лист без нормировки, масса и выедание вершины не
    // участвуют.
    float single = 1.0 - texture(uDensity, vUv1).g;
    normal = unpackNormal(texture(uNormal, vUv1));
    cover = clamp((single - uDensityShiftScale.x) * uDensityShiftScale.y, 0.0, 1.0);
  } else {
    // PSCloudsVertScatterPiercing_AnimSoft / _Anim: плотность в листе
    // хранится в зелёном канале наоборот, 1 − g².
    vec3 grain = vec3(
      texture(uDensity, vUv1).g,
      texture(uDetailDensity, vUv23.xy).g,
      texture(uDetail2Density, vUv23.zw).g
    );
    vec3 density = (1.0 - grain * grain) * uBlend;
    vec3 weight = density * uCombine;

    normal = unpackNormal(texture(uNormal, vUv1)) * weight.x
      + unpackNormal(texture(uDetailNormal, vUv23.xy)) * weight.y
      + unpackNormal(texture(uDetail2Normal, vUv23.zw)) * weight.z;
    float normalLength = length(normal);
    normal = normalLength > 1e-5 ? normal / normalLength : vec3(0.0, 0.0, 1.0);

    // Детальные листы выедают края основной формы; синий канал вершины —
    // свой сдвиг, зелёный — доля массы.
    float erode = dot(density, uSculpt) + vColour.b;
    float body = max(max(weight.x, weight.y), weight.z);
    float mass = body * vColour.g - (1.0 - vColour.g * body) * erode;
    cover = clamp((mass - uDensityShiftScale.x) * uDensityShiftScale.y, 0.0, 1.0);
  }
  vec3 N = vTangent * normal.x + vBinormal * normal.y + vNormal * normal.z;

  // Заливка с четырёх сторон: восток и запад по N.x, отражённый снизу, небо сверху.
  vec3 facing = clamp(
    vec3(N.x * 0.5 + 0.5, N.z * -0.8 + 0.2, N.z * 0.571429 + 0.428571),
    0.0,
    1.0
  );
  vec3 fill = facing.x * uEastMinusWest + uWestColour
    + uBounceColour * facing.y + uSkyColour * facing.z;
  float wrapped = clamp(dot(N, uLightDirection) * uWrap.x + uWrap.y, 0.0, 1.0);
  vec3 light = wrapped * uLightColour * uScaleDiffuseFillAmbient.x
    + uScaleDiffuseFillAmbient.y * fill
    + uAmbientColour * uScaleDiffuseFillAmbient.z;

  float thin = clamp(1.0 - uPiercing.w * cover, 0.0, 1.0);

  vec3 colour = uCloudColour * light + thin * vScatter;
  float rim = clamp(dot(N, vPierce.xyz), 0.0, 1.0) * uPiercing.z;
  float pierce = vPierce.w * (vPierce.w * (1.0 - rim) + rim) * thin;
  colour += pierce * uLightColour * uPiercing.y;
  // Красный канал вершины бережёт от тумана: у нижней кромки шапки он мал,
  // и облака уходят в цвет горизонта, а не обрываются.
  colour = mix(colour, vFog, clamp(1.0 - vColour.r, 0.0, 1.0));

  float alpha = cover * vertexAlpha * uFade;
  fragColour = vec4(colour * alpha, alpha);
}`;

/*
 * Нормаль из листа плотности — на место испорченного листа BC5.
 *
 * Полноэкранный треугольник в текстуру того же размера: средний наклон
 * плотности 1 − g по полосе 7×7, нормаль = (−s·∂d/∂u, −s·∂d/∂v, 1). Знак и
 * наклон — по целому листу игры (`contrails_nrm3` против `contrails_ap3`:
 * нормаль ≈ −3.7 × градиент на тексель вдоль v, −1 вдоль u); `s` подобран по
 * кадрам 12.10.2026: при 8 облако — рельефная штукатурка, при 3 — плоское.
 * Пишется только xy, z шейдер шапки восстанавливает сам, как из листа игры.
 */
const DERIVE_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const DERIVE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform float uStrength;
out vec4 fragColour;

float densityAt(ivec2 at, ivec2 size) {
  ivec2 wrapped = ivec2((at.x % size.x + size.x) % size.x, (at.y % size.y + size.y) % size.y);
  return 1.0 - texelFetch(uSource, wrapped, 0).g;
}

// Наклон берётся по полосе 7×7 текселей, а не по соседям: соседний тексель
// ловит зерно сжатия листа, и облако выходит рельефной штукатуркой, а не
// клубами.
const int RADIUS = 3;

void main() {
  ivec2 size = textureSize(uSource, 0);
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec2 slope = vec2(0.0);
  for (int k = -RADIUS; k <= RADIUS; k++) {
    slope.x += densityAt(at + ivec2(RADIUS, k), size) - densityAt(at + ivec2(-RADIUS, k), size);
    slope.y += densityAt(at + ivec2(k, RADIUS), size) - densityAt(at + ivec2(k, -RADIUS), size);
  }
  // Средняя производная на тексель.
  slope /= float((2 * RADIUS + 1) * 2 * RADIUS);
  vec3 normal = normalize(vec3(-slope * uStrength, 1.0));
  fragColour = vec4(normal.xy * 0.5 + 0.5, normal.z * 0.5 + 0.5, 1.0);
}`;

/* Наклон выведенной нормали: середина между осями целого листа игры. */
const DERIVED_NORMAL_STRENGTH = 4;

/* Шейдеры шапок по joaat имени `.sps`: у этих — одна формула на один лист. */
const SIMPLE_SHADERS = new Set([
  2184108982, // clouds_fast.sps
  1481470665, // clouds_soft.sps
  3393424571, // clouds_fog.sps
]);

/**
 * Испорчен ли лист нормалей при выкладке: зелёный — сплошь 255, синий —
 * ноль (BC5 через декодер с ошибкой). У целых листов нормалей зелёный
 * гуляет вокруг 128, у DXT-листов синий почти 255.
 */
export function looksLikeLostNormal(pixels) {
  if (!pixels?.length) return false;
  for (let index = 0; index < pixels.length; index += 4)
    if (pixels[index + 1] < 250 || pixels[index + 2] > 5) return false;
  return true;
}

const SAMPLERS = [
  ["uDensity", "densitysampler"],
  ["uNormal", "normalsampler"],
  ["uDetailDensity", "detaildensitysampler"],
  ["uDetailNormal", "detailnormalsampler"],
  ["uDetail2Density", "detaildensity2sampler"],
  ["uDetail2Normal", "detailnormal2sampler"],
];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`${tr("Шейдер облачных шапок не собрался:")} ${log}`);
  }
  return shader;
}

const pair = (value, fallback) => [
  Number(value?.[0] ?? fallback[0]),
  Number(value?.[1] ?? fallback[1]),
];

/**
 * Проход шапок на контексте рендерера неба. Без буфера с плавающей точкой
 * (`EXT_color_buffer_float`) прохода нет: в восьми битах ночные облака
 * округлились бы в ноль, а дневные — в белое.
 */
export function createCloudHatPass(gl, blankTexture) {
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  const maxAnisotropy = anisotropy
    ? Math.min(gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT), 8)
    : 0;

  const link = (vertexSource, fragmentSource) => {
    const linked = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(linked, vertex);
    gl.attachShader(linked, fragment);
    gl.linkProgram(linked);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(linked);
      gl.deleteProgram(linked);
      throw new Error(`${tr("Программа облачных шапок не слинковалась:")} ${log}`);
    }
    return linked;
  };
  const program = link(HAT_VERTEX, HAT_FRAGMENT);
  const deriveProgram = link(DERIVE_VERTEX, DERIVE_FRAGMENT);
  const deriveVao = gl.createVertexArray();
  const location = new Map();
  const uniform = (name) => {
    if (!location.has(name)) location.set(name, gl.getUniformLocation(program, name));
    return location.get(name);
  };
  const set3 = (name, value) =>
    gl.uniform3f(uniform(name), value?.[0] || 0, value?.[1] || 0, value?.[2] || 0);

  /* Лист нормалей «ровно к зрителю» — на место недостающего: пустой лист
     развернул бы нормаль вбок, и облако освещалось бы не с той стороны. */
  const flatNormal = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, flatNormal);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([128, 128, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);

  let target = null;
  let hats = null;
  const uploaded = new Map();
  const sheets = new Map();
  /* Размеры листов и листы нормалей, испорченные выкладкой (BC5). */
  const sizes = new Map();
  const lostNormals = new Set();
  /* Нормали, выведенные из листа плотности: имя листа плотности → текстура. */
  const derived = new Map();

  /* Мип-уровень не шире 64 точек — по нему видно, цел ли лист нормалей. */
  function readSmallLevel(texture, width, height) {
    const level = Math.max(0, Math.floor(Math.log2(Math.max(width, height) / 64)));
    const w = Math.max(1, width >> level);
    const h = Math.max(1, height >> level);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
    let pixels = null;
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    return pixels;
  }

  /* Нормаль из листа плотности (`DERIVE_FRAGMENT`) — один раз на лист. */
  function derivedNormal(densityName) {
    const key = String(densityName).toLowerCase();
    if (derived.has(key)) return derived.get(key);
    const source = sheets.get(key);
    const size = sizes.get(key);
    if (!source || !size) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const levels = Math.floor(Math.log2(Math.max(size.width, size.height))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, size.width, size.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (maxAnisotropy > 1)
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete) {
      gl.viewport(0, 0, size.width, size.height);
      gl.disable(gl.BLEND);
      gl.useProgram(deriveProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(gl.getUniformLocation(deriveProgram, "uSource"), 0);
      gl.uniform1f(gl.getUniformLocation(deriveProgram, "uStrength"), DERIVED_NORMAL_STRENGTH);
      gl.bindVertexArray(deriveVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    if (!complete) {
      gl.deleteTexture(texture);
      return null;
    }
    derived.set(key, texture);
    return texture;
  }

  function forgetDerived(densityName) {
    const key = String(densityName).toLowerCase();
    if (!derived.has(key)) return;
    gl.deleteTexture(derived.get(key));
    derived.delete(key);
  }

  function ensureTarget(width, height) {
    if (target && target.width === width && target.height === height) return target;
    if (target) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      target = null;
      return null;
    }
    target = { width, height, texture, framebuffer };
    return target;
  }

  function releaseGeometry() {
    for (const drawable of uploaded.values())
      for (const part of drawable) {
        gl.deleteVertexArray(part.vao);
        for (const buffer of part.buffers) gl.deleteBuffer(buffer);
      }
    uploaded.clear();
  }

  function attribute(index, data, size, type, normalized) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, type, normalized, 0, 0);
    return buffer;
  }

  /* Модель уходит в видеопамять, когда её впервые показывают. */
  function drawableParts(file) {
    const key = String(file).toLowerCase();
    if (uploaded.has(key)) return uploaded.get(key);
    const drawable = hats?.drawables.get(key);
    if (!drawable) return null;
    const parts = drawable.geometries.map((geometry) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffers = [
        attribute(0, geometry.position, 3, gl.FLOAT, false),
        attribute(1, geometry.normal, 3, gl.FLOAT, false),
        attribute(2, geometry.tangent, 4, gl.FLOAT, false),
        attribute(3, geometry.uv, 2, gl.FLOAT, false),
        attribute(4, geometry.colour, 4, gl.UNSIGNED_BYTE, true),
      ];
      const indices = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index, gl.STATIC_DRAW);
      buffers.push(indices);
      gl.bindVertexArray(null);
      return { vao, buffers, count: geometry.index.length, geometry };
    });
    uploaded.set(key, parts);
    return parts;
  }

  /** Модели этой установки (`decodeCloudHatManifest`); `null` — снять. */
  function setHats(next) {
    if (next === hats) return;
    releaseGeometry();
    /* Листы другой установки могли называться так же и быть другими. */
    for (const texture of sheets.values()) gl.deleteTexture(texture);
    sheets.clear();
    for (const texture of derived.values()) gl.deleteTexture(texture);
    derived.clear();
    sizes.clear();
    lostNormals.clear();
    hats = next || null;
  }

  /** Лист шапки по имени: ImageBitmap с сырыми каналами. */
  function setSheet(name, image) {
    const key = String(name).toLowerCase();
    if (sheets.has(key)) gl.deleteTexture(sheets.get(key));
    forgetDerived(key);
    lostNormals.delete(key);
    sizes.delete(key);
    if (!image) {
      sheets.delete(key);
      return;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    /* Без переворота: координаты листов у игры идут сверху вниз, как строки
       картинки. Без премультипликации: в альфе и цвете — данные. */
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    /* Шапку видно у горизонта почти вскользь: без анизотропии листы там
       размываются в кашу. */
    if (maxAnisotropy > 1)
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    sheets.set(key, texture);
    sizes.set(key, { width: image.width, height: image.height });
    if (looksLikeLostNormal(readSmallLevel(texture, image.width, image.height)))
      lostNormals.add(key);
  }

  const hasSheet = (name) => sheets.has(String(name).toLowerCase());

  /*
   * Лист нормалей для пары «плотность — нормали» материала: свой, если он
   * цел; выведенный из плотности, если выкладка его испортила; ровный, если
   * нет ни того, ни другого.
   */
  function normalFor(normalName, densityName) {
    const key = String(normalName || "").toLowerCase();
    if (sheets.has(key) && !lostNormals.has(key)) return sheets.get(key);
    if (sheets.has(key) && hasSheet(densityName)) return derivedNormal(densityName);
    return null;
  }

  /**
   * Рисует шапку в свой буфер и возвращает его текстуру (или `null`, если
   * рисовать нечего). `view` — взгляд кадра, `clouds` — { frag, shading,
   * light, fog }, где `fog` — цвета тумана купола уже на fog_hdr и
   * направления светил, `seconds` — время анимации.
   */
  function draw(width, height, view, clouds, seconds) {
    const frag = clouds?.frag;
    const shading = clouds?.shading;
    if (!hats || !frag || !shading) return null;
    const layers = groundCloudLayers(frag)
      .map((layer) => ({ layer, parts: drawableParts(layer.file) }))
      .filter((entry) => entry.parts?.length);
    if (!layers.length) return null;
    const buffer = ensureTarget(width, height);
    if (!buffer) return null;

    /* Выведенные нормали — до прохода: у вывода свой буфер и своя программа. */
    for (const { parts } of layers)
      for (const part of parts)
        for (let pairIndex = 0; pairIndex < SAMPLERS.length; pairIndex += 2)
          normalFor(
            part.geometry.textures[SAMPLERS[pairIndex + 1][1]],
            part.geometry.textures[SAMPLERS[pairIndex][1]],
          );

    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    set3("uForward", view.forward);
    set3("uRight", view.right);
    set3("uUp", view.up);
    gl.uniform2f(uniform("uProjection"), view.projection[0], view.projection[1]);
    set3("uScale", [frag.scale?.x ?? 1, frag.scale?.y ?? 1, frag.scale?.z ?? 1]);
    set3("uOrigin", [frag.position?.x ?? 0, frag.position?.y ?? 0, frag.position?.z ?? 0]);

    set3("uLightDirection", clouds.light);
    set3("uLightColour", shading.lightColour);
    set3("uCloudColour", shading.cloudColour);
    set3("uAmbientColour", shading.ambientColour);
    set3("uSkyColour", shading.skyColour);
    set3("uBounceColour", shading.bounceColour);
    set3("uWestColour", shading.westColour);
    set3("uEastMinusWest", shading.eastMinusWestColour);
    set3("uScaleDiffuseFillAmbient", shading.scaleDiffuseFillAmbient);
    const fog = clouds.fog || {};
    set3("uSunDirection", fog.sunDirection);
    set3("uMoonDirection", fog.moonDirection);
    set3("uFogSun", fog.sun);
    set3("uFogEast", fog.east);
    set3("uFogMoon", fog.moon);
    gl.uniform3f(
      uniform("uFogPowers"),
      fog.sunPower ?? 8,
      fog.moonPower ?? 18,
      fog.moonWeight ?? 1,
    );
    gl.uniform2f(uniform("uDensityShiftScale"), ...shading.densityShiftScale);
    gl.uniform2f(uniform("uWrap"), ...shading.wrap);
    gl.uniform4f(uniform("uScatter"), ...shading.scatter);
    gl.uniform4f(uniform("uPiercing"), ...shading.piercing);
    gl.uniform1f(uniform("uFade"), Math.min(Math.max(clouds.fade ?? 1, 0), 1));
    SAMPLERS.forEach(([name], unit) => gl.uniform1i(uniform(name), unit));

    let drawn = 0;
    for (const { layer, parts } of layers) {
      const motion = cloudHatMotion(frag, layer, seconds);
      gl.uniform1f(uniform("uAngle"), motion.angle);
      for (const part of parts) {
        const { textures, parameters, shader } = part.geometry;
        /* Геометрия без основного листа не рисуется: плотности у неё нет. */
        if (!hasSheet(textures.densitysampler)) continue;
        const present = SAMPLERS.map(([, slot]) => hasSheet(textures[slot]));
        SAMPLERS.forEach(([, slot], unit) => {
          gl.activeTexture(gl.TEXTURE0 + unit);
          const bound =
            unit % 2
              ? normalFor(textures[slot], textures[SAMPLERS[unit - 1][1]]) || flatNormal
              : present[unit]
                ? sheets.get(textures[slot])
                : blankTexture;
          gl.bindTexture(gl.TEXTURE_2D, bound);
        });
        gl.uniform1f(uniform("uSimple"), SIMPLE_SHADERS.has(shader) ? 1 : 0);
        /* Детальный лист, которого у материала нет, из смеси выпадает. */
        const blend = motion.blend.map((value, index) =>
          index === 0 || (present[index * 2] && present[index * 2 + 1]) ? value : 0,
        );
        gl.uniform3f(uniform("uBlend"), ...blend);
        gl.uniform3f(uniform("uCombine"), ...motion.combine);
        gl.uniform3f(uniform("uSculpt"), ...motion.sculpt);
        [1, 2, 3].forEach((index) => {
          const rescale = pair(parameters[`gRescaleUV${index}`], [1, 1]);
          const base = pair(parameters[`gUVOffset${index}`], [0, 0]);
          const anim = pair(parameters[`cloudLayerAnimScale${index}`], [1, 1]);
          const moving = motion.offsets[index - 1];
          gl.uniform2f(uniform(`uRescale${index}`), rescale[0], rescale[1]);
          gl.uniform2f(
            uniform(`uUvOffset${index}`),
            base[0] + moving[0] * anim[0],
            base[1] + moving[1] * anim[1],
          );
        });
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
        drawn += 1;
      }
    }

    gl.bindVertexArray(null);
    for (let unit = 0; unit < SAMPLERS.length; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return drawn ? buffer.texture : null;
  }

  function dispose() {
    releaseGeometry();
    for (const texture of sheets.values()) gl.deleteTexture(texture);
    sheets.clear();
    for (const texture of derived.values()) gl.deleteTexture(texture);
    derived.clear();
    if (target) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
      target = null;
    }
    gl.deleteTexture(flatNormal);
    gl.deleteProgram(program);
    gl.deleteProgram(deriveProgram);
    gl.deleteVertexArray(deriveVao);
  }

  return { setHats, setSheet, hasSheet, draw, dispose };
}
