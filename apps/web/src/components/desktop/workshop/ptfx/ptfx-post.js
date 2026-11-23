/*
 * Постобработка кадра частиц — как у игры (`postfx.fxc`, проход Composite).
 *
 * GTA V рисует мир в HDR и сводит его в конце: экспозиция, свечение (bloom)
 * по порогу яркости, плёночная кривая Хейбла (visualsettings.dat,
 * `Tonemapping.bright.filmic.*`: A..F штатные, белая точка W = 4; таймцикл
 * может её заменить) и гамма. Частицы, которые в игре «светятся», светятся
 * именно этой цепочкой: эмиссия поднимает цвет выше единицы, bloom размывает
 * излишек.
 *
 * Фон сцены (рендер персонажа) — картинка, уже сведённая. Чтобы частицы
 * ложились на неё в том же пространстве, что в игре, картинка переводится
 * обратно в HDR точным обращением кривой (`inverseFilmic`): после сведения
 * фон выглядит ровно как исходник, а частицы поверх — как в игре.
 */

/* Кривая Хейбла (Uncharted 2), как в Composite: (x(Ax+CB)+DE)/(x(Ax+B)+DF) − E/F. */
export const FILMIC_DEFAULTS = Object.freeze({
  a: 0.22,
  b: 0.3,
  c: 0.1,
  d: 0.2,
  e: 0.01,
  f: 0.3,
  w: 4,
});

export function filmicCurve(x, p = FILMIC_DEFAULTS) {
  const { a, b, c, d, e, f } = p;
  return (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
}

/** Сведение одного канала: кривая, делённая на белую точку, и гамма. */
export function tonemapChannel(value, exposure = 1, p = FILMIC_DEFAULTS, gamma = 2.2) {
  const white = filmicCurve(p.w, p);
  const mapped = Math.min(Math.max(filmicCurve(Math.max(value * exposure, 0), p) / white, 0), 1);
  return mapped ** (1 / gamma);
}

/*
 * Обращение кривой: из сведённого значения — входное. Кривая — дробь двух
 * квадратных многочленов, и уравнение y·W = ƒ(x) сводится к квадратному
 * (коэффициенты ниже), корень берётся неотрицательный.
 */
export function inverseFilmic(display, exposure = 1, p = FILMIC_DEFAULTS, gamma = 2.2) {
  const { a, b, c, d, e, f } = p;
  const white = filmicCurve(p.w, p);
  const y = Math.min(Math.max(display, 0), 0.9999) ** gamma * white + e / f;
  /* y(Ax² + Bx + DF) = Ax² + CBx + DE */
  const qa = a * (y - 1);
  const qb = b * (y - c);
  const qc = d * (f * y - e);
  const disc = Math.max(qb * qb - 4 * qa * qc, 0);
  const x = qa === 0 ? -qc / qb : (-qb - Math.sqrt(disc)) / (2 * qa);
  return Math.max(x, 0) / exposure;
}

export const POST_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* Порог свечения: как CalcBloom0 — яркость после экспозиции, мягкое колено. */
export const BLOOM_THRESHOLD_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 outColour;
void main() {
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++)
      sum += texture(uScene, vUv + vec2(float(x), float(y)) * uTexel).rgb;
  vec3 colour = sum / 9.0 * uExposure;
  float lum = max(dot(colour, vec3(1.0 / 3.0)), 0.0);
  float weight = clamp((lum - uThreshold) * uKnee, 0.0, 1.0);
  outColour = vec4(lum > 0.0 ? colour * weight : vec3(0.0), 1.0);
}
`;

/* Разделимое гауссово размытие 9 отводов (как GaussBlur9x9). */
export const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform vec2 uDirection;
in vec2 vUv;
out vec4 outColour;
void main() {
  float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 colour = texture(uSource, vUv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    colour += texture(uSource, vUv + uDirection * float(i)).rgb * weights[i];
    colour += texture(uSource, vUv - uDirection * float(i)).rgb * weights[i];
  }
  outColour = vec4(colour, 1.0);
}
`;

/* Уменьшение уровня свечения вдвое: среднее четырёх соседей. */
export const DOWNSAMPLE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColour;
void main() {
  vec3 colour = texture(uSource, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  colour += texture(uSource, vUv + uTexel * vec2(0.5, -0.5)).rgb;
  colour += texture(uSource, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
  colour += texture(uSource, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  outColour = vec4(colour * 0.25, 1.0);
}
`;

/*
 * Сведение: экспозиция, свечение, кривая Хейбла, гамма. Свечение — три
 * уровня размытия с весами bloom.blurblendmult (small/med/large) и
 * множителем postfx_intensity_bloom · 0.25, как в Composite игры.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloomSmall;
uniform sampler2D uBloomMed;
uniform sampler2D uBloomLarge;
uniform vec3 uBloomBlend;
uniform float uExposure;
uniform float uBloomIntensity;
uniform vec4 uFilmic0;
uniform vec4 uFilmic1;
uniform float uGamma;
in vec2 vUv;
out vec4 outColour;

vec3 filmic(vec3 x) {
  float a = uFilmic0.x, b = uFilmic0.y, c = uFilmic0.z, d = uFilmic0.w;
  float e = uFilmic1.x, f = uFilmic1.y, w = uFilmic1.z;
  vec3 curve = (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
  float white = (w * (a * w + c * b) + d * e) / (w * (a * w + b) + d * f) - e / f;
  return clamp(curve / white, 0.0, 1.0);
}

void main() {
  vec4 scene = texture(uScene, vUv);
  vec3 bloom = texture(uBloomSmall, vUv).rgb * uBloomBlend.x
    + texture(uBloomMed, vUv).rgb * uBloomBlend.y
    + texture(uBloomLarge, vUv).rgb * uBloomBlend.z;
  vec3 hdr = max(scene.rgb * uExposure + bloom * uBloomIntensity * 0.25, 0.0);
  vec3 mapped = pow(filmic(hdr), vec3(1.0 / uGamma));
  outColour = vec4(mapped, 1.0);
}
`;
