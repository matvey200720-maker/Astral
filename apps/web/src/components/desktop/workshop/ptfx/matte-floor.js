/*
 * Матовый фон кадров частиц с тонкой сеткой на земле — «Огонь и взрывы»
 * (`environment-scene.js`) и «Дым из-под колёс» (`wheel-smoke-scene.js`).
 *
 * Холст движка непрозрачный, поэтому фон рисует шейдер сцены: матовая
 * подложка, как `--fx-matte-stage` — чёрная (редизайн 17.10.2026; прежний
 * подъём #040404 → #131313 владелец называл «серым», 18.10.2026: «чёрный,
 * как у эффектов попадания, для всех»), с едва заметным светом сверху и
 * сеткой воды (#c8ccd2) на земле z = 0. Цвета задаются
 * отображаемыми и переводятся в HDR обратной плёночной кривой — экспозиция
 * кадра их не трогает, и фон одинаков у всех кадров.
 *
 * `uGroundOffset` сдвигает рисунок сетки, а не затухание: так пол «едет» под
 * машиной в дрифте, а светлое пятно вокруг сцены стоит на месте.
 *
 * Отдельным файлом нарочно: кадру дыма нужен только фон, а
 * `environment-scene.js` тянет за собой весь пакет студии эффектов.
 */

/* Обратная плёночная кривая (Хейбл, как `ptfx-post.js`): отображаемое → HDR. */
export const INVERSE_FILMIC_GLSL = /* glsl */ `
float inverseFilmic(float display) {
  float a = uFilmic0.x, b = uFilmic0.y, c = uFilmic0.z, d = uFilmic0.w;
  float e = uFilmic1.x, f = uFilmic1.y, w = uFilmic1.z;
  float white = (w * (a * w + c * b) + d * e) / (w * (a * w + b) + d * f) - e / f;
  float y = pow(clamp(display, 0.0, 0.9999), uGamma) * white + e / f;
  float qa = a * (y - 1.0);
  float qb = b * (y - c);
  float qc = d * (f * y - e);
  float disc = max(qb * qb - 4.0 * qa * qc, 0.0);
  float x = abs(qa) < 1e-8 ? -qc / qb : (-qb - sqrt(disc)) / (2.0 * qa);
  return max(x, 0.0);
}
`;

/* Матовый фон и сетка воды: в отображаемых цветах, доли 0…1. */
const MATTE_FROM = [0, 0, 0];
const MATTE_TO = [0, 0, 0];
const GRID_COLOUR = [200 / 255, 204 / 255, 210 / 255];

export const MATTE_FLOOR_FRAGMENT = /* glsl */ `
precision highp float;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uNear;
uniform float uFar;
uniform vec4 uFilmic0;
uniform vec4 uFilmic1;
uniform float uGamma;
uniform float uExposure;
uniform vec3 uMatteFrom;
uniform vec3 uMatteTo;
uniform vec3 uGridColour;
uniform vec4 uGrid;          // шаг тонкой, шаг крупной, сила, начало затухания
uniform float uGridFade;     // конец затухания, м
uniform vec2 uGroundOffset;  // сдвиг рисунка сетки: пол, что едет под машиной
in vec2 vUv;
out vec4 outColour;
${INVERSE_FILMIC_GLSL}
float gridLines(vec2 point, float step) {
  vec2 cell = point / step;
  vec2 width = max(fwidth(cell), vec2(1e-5));
  vec2 line = abs(fract(cell - 0.5) - 0.5) / width;
  return 1.0 - min(min(line.x, line.y), 1.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize((uCameraWorld * vec4(normalize(view.xyz / view.w), 0.0)).xyz);
  vec3 origin = uCameraWorld[3].xyz;

  /* Матовая подложка: диагональ сверху слева вниз направо и мягкий свет
     сверху — как у кадров мастерской. */
  float diagonal = clamp((vUv.x + (1.0 - vUv.y)) * 0.5, 0.0, 1.0);
  vec3 display = mix(uMatteFrom, uMatteTo, diagonal);
  vec2 top = (vUv - vec2(0.5, 0.88)) * vec2(1.0, 1.4);
  display += vec3(0.015) * (1.0 - smoothstep(0.0, 0.75, length(top)));

  /* Тонкая сетка на земле (z = 0), как у воды: тонкие линии каждые
     \`uGrid.x\` метров, крупные — каждые \`uGrid.y\`, затухание вдаль. */
  if (dir.z < -1e-5) {
    float t = -origin.z / dir.z;
    vec3 ground = origin + dir * t;
    float fade = 1.0 - smoothstep(uGrid.w, uGridFade, length(ground.xy));
    vec2 grid = ground.xy + uGroundOffset;
    float line = max(gridLines(grid, uGrid.x) * 0.55, gridLines(grid, uGrid.y));
    display = mix(display, uGridColour, clamp(line * uGrid.z * fade, 0.0, 1.0));
  }

  vec3 hdr = vec3(inverseFilmic(display.r), inverseFilmic(display.g), inverseFilmic(display.b)) / uExposure;
  /* Фон — в самой дали: пламя у земли не обрезается плоскостью сетки. */
  gl_FragDepth = 1.0;
  outColour = vec4(hdr, 1.0);
}
`;

/** Кривая и экспозиция кадра — униформы для шейдеров в отображаемых цветах. */
export function filmicUniforms(lighting) {
  const filmic = lighting.post.filmic;
  return {
    uFilmic0: [filmic.a, filmic.b, filmic.c, filmic.d],
    uFilmic1: [filmic.e, filmic.f, filmic.w, 0],
    uGamma: lighting.post.gamma,
    uExposure: lighting.post.exposure,
  };
}

/**
 * Униформы фона. `grid` — `[шаг тонкой, шаг крупной, сила, начало
 * затухания]` и `fade` — конец затухания, м.
 */
export function matteFloorUniforms(lighting, { grid = [0.5, 2.5, 0.42, 6], fade = 18 } = {}) {
  return {
    ...filmicUniforms(lighting),
    uMatteFrom: MATTE_FROM,
    uMatteTo: MATTE_TO,
    uGridColour: GRID_COLOUR,
    uGrid: grid,
    uGridFade: fade,
    uGroundOffset: [0, 0],
  };
}
