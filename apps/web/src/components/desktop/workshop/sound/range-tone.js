// Тон ствола на стрельбище: цвет мастерской оружия, пропущенный через обратную
// плёночную кривую игры, чтобы кадр частиц вернул ему прежний вид.
import { FILMIC_DEFAULTS } from "../ptfx/ptfx-post.js";
import * as THREE from "three";

const PROGRAM_KEY = "astral-range-tone";
const FALLBACKS = Object.freeze({ exposure: 1, gamma: 2.2 });
const MARKS = Object.freeze({
  common: "#include <common>",
  dither: "#include <dithering_fragment>",
});

const FUNCTION_LINES = [
  "uniform float uRangeStudioExposure;",
  "uniform float uRangeExposure;",
  "uniform float uRangeGamma;",
  "uniform vec4 uRangeFilmic0;",
  "uniform vec3 uRangeFilmic1;",
  "",
  "vec3 rangeNeutral(vec3 colour) {",
  "  const float start = 0.76;",
  "  const float desaturation = 0.15;",
  "  float low = min(colour.r, min(colour.g, colour.b));",
  "  float offset = low < 0.08 ? low - 6.25 * low * low : 0.04;",
  "  colour -= offset;",
  "  float peak = max(colour.r, max(colour.g, colour.b));",
  "  if (peak < start) return colour;",
  "  float d = 1.0 - start;",
  "  float next = 1.0 - d * d / (peak + d - start);",
  "  colour *= next / peak;",
  "  float g = 1.0 - 1.0 / (desaturation * (peak - next) + 1.0);",
  "  return mix(colour, vec3(next), g);",
  "}",
  "",
  "vec3 rangeSrgb(vec3 linear) {",
  "  vec3 high = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) * 1.055 - 0.055;",
  "  return mix(high, linear * 12.92, step(linear, vec3(0.0031308)));",
  "}",
  "",
  "vec3 rangeInverseFilmic(vec3 display) {",
  "  float a = uRangeFilmic0.x, b = uRangeFilmic0.y, c = uRangeFilmic0.z, d = uRangeFilmic0.w;",
  "  float e = uRangeFilmic1.x, f = uRangeFilmic1.y, w = uRangeFilmic1.z;",
  "  float white = (w * (a * w + c * b) + d * e) / (w * (a * w + b) + d * f) - e / f;",
  "  vec3 y = pow(clamp(display, 0.0, 0.9999), vec3(uRangeGamma)) * white + e / f;",
  "  vec3 qa = a * (y - 1.0);",
  "  vec3 qb = b * (y - c);",
  "  vec3 qc = d * (f * y - e);",
  "  vec3 disc = max(qb * qb - 4.0 * qa * qc, vec3(0.0));",
  "  return max((-qb - sqrt(disc)) / (2.0 * qa), vec3(0.0)) / max(uRangeExposure, 1e-4);",
  "}",
];
const AFTER_COMMON = `\n\n${FUNCTION_LINES.join("\n")}\n`;
const AFTER_DITHER = `\n${" ".repeat(10)}gl_FragColor.rgb = rangeInverseFilmic(rangeSrgb(rangeNeutral(gl_FragColor.rgb * uRangeStudioExposure)));`;

// Первое вхождение метки сохраняется, вставка идёт сразу за ней.
const insertAfter = (source, mark, addition) => source.replace(mark, () => mark + addition);

export function createRangeTone({ studioExposure, post }) {
  const uniforms = Object.fromEntries(
    Object.entries({
      uRangeStudioExposure: studioExposure,
      uRangeExposure: FALLBACKS.exposure,
      uRangeGamma: FALLBACKS.gamma,
      uRangeFilmic0: new THREE.Vector4(),
      uRangeFilmic1: new THREE.Vector3(),
    }).map(([name, value]) => [name, { value }]),
  );

  const setPost = (next = {}) => {
    const curve = { ...FILMIC_DEFAULTS, ...next.filmic };
    const [exposure, gamma] = [
      Number(next.exposure) || FALLBACKS.exposure,
      Number(next.gamma) || FALLBACKS.gamma,
    ];
    uniforms.uRangeExposure.value = exposure;
    uniforms.uRangeGamma.value = gamma;
    uniforms.uRangeFilmic0.value.set(...["a", "b", "c", "d"].map((name) => curve[name]));
    uniforms.uRangeFilmic1.value.set(...["e", "f", "w"].map((name) => curve[name]));
  };

  const patch = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const withFunctions = shader.fragmentShader.replace(MARKS.common, () => MARKS.common + AFTER_COMMON);
    shader.fragmentShader = insertAfter(withFunctions, MARKS.dither, AFTER_DITHER);
  };

  setPost(post);
  return { key: PROGRAM_KEY, uniforms, setPost, patch };
}
