/*
 * Отрисовка частиц окна мастерской так, как их рисует GTA V.
 *
 * Кадр собирается в HDR, как в игре: фон (рендер персонажа, обращённый в
 * HDR обратной кривой) пишет цвет и глубину рельефа; частицы ложатся поверх
 * шейдером-переносом `ptfx_sprite` (освещение таймцикла, мягкость по глубине,
 * смешение кадров, сложение для BlendSet 1); затем свечение по порогу,
 * экспозиция, кривая Хейбла, гамма — `ptfx-post.js`.
 *
 * Мир — как в игре: метры, ось Z вверх. Персонаж стоит в плоскости y = 0
 * лицом к камере (−Y); камера смотрит вдоль +Y без наклона — тогда плоская
 * картинка персонажа ложится на экран без искажений, а частицы, летящие к
 * камере или от неё, получают настоящую перспективу с настоящего расстояния
 * (дальность меняет и размер на экране, и эволюцию LOD правила — как в игре).
 */

import * as THREE from "three";
import { skipShaderChecks } from "../../../../features/workshop/model-stage/shader-warmup.js";
import { QUALITY_PROFILES, currentQuality } from "../../../../features/workshop/model-stage/quality-profile.js";
import { claimWindowRenderer, releaseWindowRenderer } from "../../../../features/workshop/engine/window-renderer.js";
import { SPRITE_FRAGMENT, SPRITE_VERTEX } from "./ptfx-shaders.js";
import {
  BLOOM_THRESHOLD_FRAGMENT,
  BLUR_FRAGMENT,
  COMPOSITE_FRAGMENT,
  DOWNSAMPLE_FRAGMENT,
  FILMIC_DEFAULTS,
} from "./ptfx-post.js";
import { bodyThickness, silhouetteDistance } from "./ptfx-backdrop.js";
import { buildModelGeometry, ModelBatch, TrailBatch } from "./ptfx-models.js";
import { createLocalLights, localLightUniforms, writeLocalLights } from "./ptfx-lights.js";

/* Атрибуты экземпляра спрайта: имя → число компонент. */
export const SPRITE_ATTRIBUTES = Object.freeze({
  iCorner: 3,
  iEdgeU: 3,
  iEdgeV: 3,
  iNormal: 3,
  iUvA: 4,
  iUvB: 4,
  iColour: 4,
  iParams: 4,
  iShape: 4,
  iLight: 4,
});

const FAR_DEPTH = 10000;
/* Высота глаз стреляющего, метры: стоящий человек. */
const SHOOTER_EYE_HEIGHT = 1.65;

const BACKDROP_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform vec3 uPlate;
uniform float uExposure;
uniform float uNear;
uniform float uFar;
uniform vec4 uFilmic0;
uniform vec4 uFilmic1;
uniform float uGamma;
uniform vec4 uPhotoRect;
uniform float uHasDepth;
in vec2 vUv;
out vec4 outColour;

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

void main() {
  vec2 local = (vUv - uPhotoRect.xy) / uPhotoRect.zw;
  vec3 colour = uPlate;
  if (local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0) {
    vec4 photo = texture(uPhoto, local);
    colour = mix(uPlate, photo.rgb, photo.a);
  }
  vec3 hdr = vec3(inverseFilmic(colour.r), inverseFilmic(colour.g), inverseFilmic(colour.b)) / uExposure;
  /* Без рельефа (плитка выбора, сцена без фигуры) фон стоит в самой дали. */
  if (uHasDepth < 0.5) {
    gl_FragDepth = 1.0;
  } else {
    float depth = texture(uDepth, vUv).r;
    float ndc = (uFar + uNear) / (uFar - uNear) - (2.0 * uFar * uNear) / ((uFar - uNear) * depth);
    gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
  }
  outColour = vec4(hdr, 1.0);
}
`;

function fullScreenQuad() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return geometry;
}

function postMaterial(fragmentShader, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: extra.vertexShader || /* glsl */ `
      precision highp float;
      in vec3 position;
      out vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader,
    uniforms,
    depthTest: extra.depthTest ?? false,
    depthWrite: extra.depthWrite ?? false,
    blending: THREE.NoBlending,
  });
}

/*
 * Сетка спрайта 3×3, как у игры: вершины в углах, серединах сторон и в
 * центре. Свет считается в вершинах, и центр, освещённый «лицом к камере»,
 * вместе с краями, освещёнными вбок (normalarc), даёт объём; мягкость по
 * softnesscurve тоже круглая только благодаря центральной вершине.
 */
function spriteGrid() {
  const corners = [];
  for (let row = 0; row < 3; row += 1)
    for (let column = 0; column < 3; column += 1) corners.push(column / 2, row / 2);
  const index = [];
  for (let row = 0; row < 2; row += 1)
    for (let column = 0; column < 2; column += 1) {
      const a = row * 3 + column;
      index.push(a, a + 1, a + 4, a, a + 4, a + 3);
    }
  return { corners: new Float32Array(corners), index };
}

const SPRITE_GRID = spriteGrid();

/*
 * Пачка спрайтов одного правила частиц: одна текстура, одна техника, одно
 * смешение. Буферы растут по мере надобности и не пересоздаются кадр за
 * кадром.
 */
export class SpriteBatch {
  /* `sceneUp: "y"` — пачка стоит в сцене с осью Y вверх (кадр улицы из игры): частицы считаются в осях игры, шейдер переводит. */
  constructor(key, { sceneUp = "z" } = {}) {
    this.key = key;
    this.sceneUp = sceneUp;
    this.capacity = 0;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute("corner", new THREE.BufferAttribute(SPRITE_GRID.corners, 2));
    this.geometry.setIndex(SPRITE_GRID.index);
    this.material = null;
    this.mesh = null;
    this.materialKey = "";
  }

  ensureCapacity(count) {
    if (count <= this.capacity) return;
    const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    for (const [name, size] of Object.entries(SPRITE_ATTRIBUTES)) {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    }
    this.capacity = capacity;
  }

  update(batch, shared) {
    this.ensureCapacity(batch.count);
    for (const name of Object.keys(SPRITE_ATTRIBUTES)) {
      const attribute = this.geometry.getAttribute(name);
      attribute.array.set(batch.attributes[name].subarray(0, batch.count * attribute.itemSize));
      attribute.needsUpdate = true;
    }
    this.geometry.instanceCount = batch.count;
    const technique = batch.technique;
    const materialKey = [
      technique.lit ? "L" : "",
      technique.soft ? "S" : "",
      technique.rgbOnly ? "R" : "",
      batch.additive ? "A" : "",
      this.sceneUp === "y" ? "Y" : "",
    ].join("");
    if (!this.material || this.materialKey !== materialKey) {
      this.material?.dispose();
      const defines = {};
      if (technique.lit) defines.LIT = "";
      if (technique.soft) defines.SOFT = "";
      if (technique.rgbOnly) defines.RGB_ONLY = "";
      if (batch.additive) defines.ADDITIVE = "";
      if (this.sceneUp === "y") defines.SCENE_Y_UP = "";
      this.material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: SPRITE_VERTEX,
        fragmentShader: SPRITE_FRAGMENT,
        defines,
        uniforms: {
          uTexture: { value: null },
          uSceneDepth: { value: null },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uHasSceneDepth: { value: 0 },
          uSoftShadowMult: { value: 0 },
          uSoftShadowOffset: { value: 0 },
          uAlphaCutoff: { value: new THREE.Vector3(0, 1, 1) },
          uExposureScale: shared.uExposureScale,
          uFogColour: shared.uFogColour,
          uFogParams: shared.uFogParams,
          uSunDirection: shared.uSunDirection,
          uSunColour: shared.uSunColour,
          uAmbientGradient: shared.uAmbientGradient,
          uAmbientBase: shared.uAmbientBase,
          uAmbientDirectional: shared.uAmbientDirectional,
          uAmbientDirectionalAxis: shared.uAmbientDirectionalAxis,
          uEmissiveMult: shared.uEmissiveMult,
          ...localLightUniforms(shared),
        },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: batch.additive ? THREE.OneFactor : THREE.SrcAlphaFactor,
        blendDst: batch.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      });
      this.materialKey = materialKey;
      if (this.mesh) this.mesh.material = this.material;
    }
    const uniforms = this.material.uniforms;
    uniforms.uTexture.value = batch.texture;
    uniforms.uSoftShadowMult.value = batch.softShadowMult ?? 0;
    uniforms.uSoftShadowOffset.value = batch.softShadowOffset ?? 0;
    const cutoff = batch.alphaCutoff || [0, 1, 1];
    uniforms.uAlphaCutoff.value.set(cutoff[0], cutoff[1], cutoff[2]);
    uniforms.uSceneDepth.value = shared.depthTexture;
    uniforms.uHasSceneDepth.value = shared.depthTexture ? 1 : 0;
    uniforms.uViewport.value.copy(shared.viewport);
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.frustumCulled = false;
    }
    return this.mesh;
  }

  dispose() {
    this.geometry.dispose();
    this.material?.dispose();
  }
}

/*
 * Общие значения света для материалов частиц: солнце, окружение, свечение, экспозиция частиц и местные огни.
 * Их держит рисовальщик окна, а рой в чужой сцене (улица из игры, `lamp-swarm.js`) — свои.
 */
export function createSharedUniforms() {
  return {
    uSunDirection: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
    uSunColour: { value: new THREE.Vector3(1, 1, 1) },
    uAmbientGradient: { value: new THREE.Vector4(0, 0, 0, 1) },
    uAmbientBase: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
    uAmbientDirectional: { value: new THREE.Vector3(0, 0, 0) },
    uAmbientDirectionalAxis: { value: new THREE.Vector3(0, 0, 1) },
    uEmissiveMult: { value: 1 },
    /*
     * Экспозиция частиц сверх экспозиции кадра. Кадр попаданий — HDR-кадр
     * игры, и она единица. Фон кадра фонарей — рисунок, а частицы ночью игра
     * показывает глазом, привыкшим к темноте (автомат экспозиции в полночь —
     * EV 2,4, в 5,3 раза ярче): без этого множителя ночной рой был бы чёрным.
     */
    uExposureScale: { value: 1 },
    /* Туман кадра игры (FX-сцены, `scene.fog`): цвет и (ближняя граница, дальняя граница, доля тумана). Доля 0 — тумана нет, шейдер ничего не меняет. */
    uFogColour: { value: new THREE.Vector3(0, 0, 0) },
    uFogParams: { value: new THREE.Vector3(0, 1, 0) },
    ...createLocalLights(),
    depthTexture: null,
    viewport: new THREE.Vector2(1, 1),
  };
}

/**
 * Туман кадра игры в общие значения: `{ color: [r, g, b], near, far, density }` из `scene.fog` или `null` (тумана нет). Частица на
 * расстоянии `d` вдоль взгляда уходит в цвет тумана на долю `density · clamp((d − near) / (far − near), 0, 1)`; цвет — в тех же
 * единицах, что цвет текстуры частицы (квадрат оттенка экрана).
 */
export function writeParticleFog(shared, fog) {
  if (!fog) {
    shared.uFogParams.value.set(0, 1, 0);
    return;
  }
  const [r, g, b] = fog.color;
  shared.uFogColour.value.set(r * r, g * g, b * b);
  shared.uFogParams.value.set(fog.near, fog.far, fog.density);
}

/** Запись света таймцикла в общие значения: солнце, окружение, свечение и экспозиция частиц. */
export function writeParticleLighting(shared, next) {
  if (!next) return;
  const { sun, ambient } = next;
  if (Number.isFinite(next.particleEmissive)) shared.uEmissiveMult.value = next.particleEmissive;
  if (Number.isFinite(next.particleExposure)) shared.uExposureScale.value = next.particleExposure;
  if (sun) {
    shared.uSunDirection.value.set(...sun.direction).normalize();
    shared.uSunColour.value.set(...sun.colour);
  }
  if (ambient) {
    shared.uAmbientGradient.value.set(...ambient.gradient);
    shared.uAmbientBase.value.set(...ambient.base);
    shared.uAmbientDirectional.value.set(...(ambient.directional || [0, 0, 0]));
    shared.uAmbientDirectionalAxis.value.set(...(ambient.directionalAxis || [0, 0, 1]));
  }
}

/**
 * Рисовальщик сцены частиц на холсте.
 *
 * `lighting` — свет таймцикла (солнце, окружение, экспозиция, кривая,
 * свечение); `setBackdrop` — картинка персонажа и её место на холсте;
 * `render(batches)` — пачки спрайтов, которые собрал движок.
 */
export function createPtfxRenderer({ canvas, lighting, share = false }) {
  /*
   * Рендерер окна (фаза 5, шаг 5.4) — по `share: true`: контекст и собранные программы те же, что у кадров
   * редакторов. Холст сцены остаётся своим (его держит разметка редактора, на нём мышь и размер), а готовый
   * кадр копируется в него (`present`): сведение пишет каждый пиксель с альфой 1 одним проходом, поэтому
   * сглаживание и альфа холста окна картинку не меняют (проверено побайтно, PLAN.md). По умолчанию — свой
   * контекст: на Windows копия в новый 2D-холст дороже заведения контекста (тёплый кадр 52 → 57 мс,
   * «Фонари» +15, замер 20.10), а сцене частиц другого выигрыша от общего контекста нет.
   */
  const owner = {};
  let windowed = share ? claimWindowRenderer(owner, { antialias: QUALITY_PROFILES[currentQuality()].antialias, strict: false }) : null;
  /* Холст уже с WebGL (тот же холст в StrictMode, прошлый раз — свой контекст) — копировать некуда. */
  if (windowed && !canvas.getContext("2d")) {
    releaseWindowRenderer(owner);
    windowed = null;
  }
  const renderer =
    windowed?.renderer ||
    new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance",
    });
  if (!windowed) skipShaderChecks(renderer);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 500);
  camera.up.set(0, 0, 1);

  const shared = createSharedUniforms();

  const state = {
    width: 1,
    height: 1,
    pixelRatio: 1,
    exposure: 1,
    bloomIntensity: 0.2,
    bloomThreshold: 0.4,
    bloomKnee: 1,
    bloomBlend: [1, 2, 0.5],
    filmic: { ...FILMIC_DEFAULTS },
    gamma: 2.2,
    backdrop: null,
    /* Кадр игры с глубиной (`setFrame`): камера и фон — оттуда, а не из `view`. */
    frame: null,
    /* eye — высота глаза стреляющего, метры (стоящий человек). */
    view: { distance: 6, centre: [0, 0, 1], metresPerPixel: 0.003, eye: SHOOTER_EYE_HEIGHT },
  };

  const hdrTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  /* Свечение: три уровня (¼, ⅛, 1/16 кадра), у каждого пара для размытия. */
  const bloomTarget = () =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
  const bloomLevels = [0, 1, 2].map(() => ({ a: bloomTarget(), b: bloomTarget() }));

  /*
   * Мир из настоящих сеток (3D-предпросмотры эффектов, задача 4А 18.10.2026):
   * тела, ствол, земля с тенями. Он рисуется в HDR-цель после фона, а мягкость
   * частиц читает глубину не из таблицы рельефа плоской картинки, а из второго
   * прохода по тому же миру — расстояние вдоль взгляда по каждому пикселю
   * (R, метры), как `vViewDepth` у частиц.
   */
  /* R32F и ближайший отсчёт — как у таблицы рельефа плоского кадра: глубину
     нельзя смешивать между соседними пикселями (ореол на границе силуэта), а
     половинный RGBA с линейным отсчётом в том же кадре, где в него рисуют,
     ронял GPU-процесс драйвера Intel UHD. */
  const viewDepthTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const viewDepthMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      precision highp float;
      in vec3 position;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      out float vViewZ;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vViewZ;
      out vec4 outColour;
      void main() {
        outColour = vec4(vViewZ, 0.0, 0.0, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const FAR_COLOUR = new THREE.Color().setRGB(FAR_DEPTH, FAR_DEPTH, FAR_DEPTH, THREE.LinearSRGBColorSpace);
  /* Мир сцены: `{ scene, shadows }` или `null` (плоская картинка фона). */
  let world = null;
  let shadowsDirty = false;

  const quad = fullScreenQuad();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const filmicUniforms = () => ({
    uFilmic0: {
      value: new THREE.Vector4(state.filmic.a, state.filmic.b, state.filmic.c, state.filmic.d),
    },
    uFilmic1: { value: new THREE.Vector4(state.filmic.e, state.filmic.f, state.filmic.w, 0) },
    uGamma: { value: state.gamma },
  });

  const backdropMaterial = postMaterial(
    BACKDROP_FRAGMENT,
    {
      uPhoto: { value: null },
      uDepth: { value: null },
      uHasDepth: { value: 0 },
      uPlate: { value: new THREE.Vector3(0.027, 0.027, 0.031) },
      uExposure: { value: 1 },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uPhotoRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      ...filmicUniforms(),
    },
    { depthTest: true, depthWrite: true },
  );
  backdropMaterial.depthFunc = THREE.AlwaysDepth;
  const thresholdMaterial = postMaterial(BLOOM_THRESHOLD_FRAGMENT, {
    uScene: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uExposure: { value: 1 },
    uThreshold: { value: 1 },
    uKnee: { value: 1 },
  });
  const blurMaterial = postMaterial(BLUR_FRAGMENT, {
    uSource: { value: null },
    uDirection: { value: new THREE.Vector2(1, 0) },
  });
  const downsampleMaterial = postMaterial(DOWNSAMPLE_FRAGMENT, {
    uSource: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
  });
  const compositeMaterial = postMaterial(COMPOSITE_FRAGMENT, {
    uScene: { value: null },
    uBloomSmall: { value: null },
    uBloomMed: { value: null },
    uBloomLarge: { value: null },
    uBloomBlend: { value: new THREE.Vector3(1, 2, 0.5) },
    uExposure: { value: 1 },
    uBloomIntensity: { value: 1 },
    ...filmicUniforms(),
  });

  const postScene = new THREE.Scene();
  const postMesh = new THREE.Mesh(quad, backdropMaterial);
  postMesh.frustumCulled = false;
  postScene.add(postMesh);

  const particleScene = new THREE.Scene();
  const batches = new Map();
  /* Модели частиц: сетки по имени модели и пачки экземпляров по ключу. */
  const meshes = new Map();
  const modelBatches = new Map();
  const trailBatches = new Map();

  let depthTexture = null;
  /* Неподвижные сетки сцены (украшения столба в кадре фонарей): рисуются
     после сцены шейдером и до частиц, с её глубиной. */
  let sceneObjects = [];

  function syncFilmic(material) {
    material.uniforms.uFilmic0?.value.set(state.filmic.a, state.filmic.b, state.filmic.c, state.filmic.d);
    material.uniforms.uFilmic1?.value.set(state.filmic.e, state.filmic.f, state.filmic.w, 0);
    if (material.uniforms.uGamma) material.uniforms.uGamma.value = state.gamma;
  }

  function applyLighting(next) {
    if (!next) return;
    const { post } = next;
    writeParticleLighting(shared, next);
    if (post) {
      state.exposure = post.exposure ?? state.exposure;
      state.bloomIntensity = post.bloomIntensity ?? state.bloomIntensity;
      state.bloomThreshold = post.bloomThreshold ?? state.bloomThreshold;
      state.bloomKnee = post.bloomKnee ?? state.bloomKnee;
      state.bloomBlend = post.bloomBlend ?? state.bloomBlend;
      state.filmic = { ...state.filmic, ...(post.filmic || {}) };
      state.gamma = post.gamma ?? state.gamma;
      for (const material of [backdropMaterial, compositeMaterial]) syncFilmic(material);
    }
  }
  applyLighting(lighting);

  /*
   * Камера: кадр холста — прямоугольник плоскости персонажа (метры на пиксель
   * и центр), расстояние — дальность боя. Угол зрения выводится из них,
   * поэтому картинка персонажа при любой дальности лежит на тех же пикселях.
   */
  /*
   * Глаз стреляющего — на высоте глаз человека, а не посередине фигуры.
   * Камера смотрит горизонтально, и плоскость персонажа ложится на экран без
   * искажений при любой высоте глаза; чтобы фигура осталась на своих
   * пикселях, окно проекции сдвигается (внецентренная проекция). Частицы,
   * летящие к стреляющему, при этом уходят в кадре туда же, куда в игре, —
   * а не вверх над головой, как у камеры на уровне груди.
   */
  function updateCamera() {
    if (state.frame) {
      /* Кадр игры: камера кадра как есть (положение, поворот, угол и дальности из scene.json). Вид — по кадру, а не по холсту: если
         холст другой пропорции, фон и частицы вместе растягиваются одинаково и остаются на своих местах. */
      const { position, rotation, fovY, near, far } = state.frame.camera;
      camera.aspect = state.frame.aspect;
      camera.fov = fovY;
      camera.near = near;
      camera.far = far;
      camera.position.set(position[0], position[1], position[2]);
      camera.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      backdropMaterial.uniforms.uNear.value = near;
      backdropMaterial.uniforms.uFar.value = far;
      return;
    }
    const { distance, centre, metresPerPixel, eye } = state.view;
    const widthMetres = state.width * metresPerPixel;
    const heightMetres = state.height * metresPerPixel;
    camera.aspect = state.width / state.height;
    camera.fov = (2 * Math.atan(heightMetres / 2 / distance) * 180) / Math.PI;
    camera.near = Math.max(0.05, distance * 0.05);
    camera.far = distance + 200;
    const eyeHeight = Number.isFinite(eye) ? eye : centre[2];
    camera.position.set(centre[0], centre[1] - distance, eyeHeight);
    camera.lookAt(centre[0], centre[1], eyeHeight);
    camera.updateMatrixWorld(true);
    const scale = camera.near / distance;
    const top = (centre[2] + heightMetres / 2 - eyeHeight) * scale;
    const bottom = (centre[2] - heightMetres / 2 - eyeHeight) * scale;
    const half = (widthMetres / 2) * scale;
    camera.projectionMatrix.makePerspective(-half, half, top, bottom, camera.near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    backdropMaterial.uniforms.uNear.value = camera.near;
    backdropMaterial.uniforms.uFar.value = camera.far;
  }

  /*
   * Рельеф: глубина от камеры до поверхности персонажа по каждому пикселю
   * холста (R32F). Вне силуэта — даль.
   */
  function rebuildDepth() {
    /* У кадра игры глубина своя и от размера холста не зависит. */
    if (state.frame) return;
    const backdrop = state.backdrop;
    if (!backdrop?.alpha) {
      depthTexture?.dispose();
      depthTexture = null;
      shared.depthTexture = null;
      backdropMaterial.uniforms.uDepth.value = null;
      backdropMaterial.uniforms.uHasDepth.value = 0;
      return;
    }
    const width = Math.max(1, Math.round(state.width));
    const height = Math.max(1, Math.round(state.height));
    const data = new Float32Array(width * height).fill(FAR_DEPTH);
    const { rect, alpha } = backdrop;
    const scaleX = alpha.width / rect.width;
    const scaleY = alpha.height / rect.height;
    const distance = state.view.distance;
    for (let y = 0; y < height; y += 1) {
      const sy = Math.floor((height - 1 - y - rect.y) * scaleY);
      if (sy < 0 || sy >= alpha.height) continue;
      for (let x = 0; x < width; x += 1) {
        const sx = Math.floor((x - rect.x) * scaleX);
        if (sx < 0 || sx >= alpha.width) continue;
        const thickness = alpha.thickness[sy * alpha.width + sx];
        if (thickness > 0 || alpha.inside[sy * alpha.width + sx]) data[y * width + x] = distance - thickness;
      }
    }
    depthTexture?.dispose();
    depthTexture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.FloatType);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.needsUpdate = true;
    shared.depthTexture = depthTexture;
    backdropMaterial.uniforms.uDepth.value = depthTexture;
    backdropMaterial.uniforms.uHasDepth.value = 1;
  }

  function resize(width, height, pixelRatio = 1) {
    state.width = Math.max(1, Math.round(width));
    state.height = Math.max(1, Math.round(height));
    state.pixelRatio = pixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(state.width, state.height, false);
    const w = Math.round(state.width * pixelRatio);
    const h = Math.round(state.height * pixelRatio);
    hdrTarget.setSize(w, h);
    viewDepthTarget.setSize(w, h);
    bloomLevels.forEach((level, index) => {
      const shift = 2 + index;
      level.a.setSize(Math.max(1, w >> shift), Math.max(1, h >> shift));
      level.b.setSize(Math.max(1, w >> shift), Math.max(1, h >> shift));
    });
    shared.viewport.set(w, h);
    updateCamera();
    rebuildDepth();
  }

  /**
   * Картинка персонажа: `image` — загруженный рендер, `rect` — где он лежит
   * на холсте (CSS-пиксели, от левого верхнего угла), `metresTall` — рост
   * кадра картинки в метрах.
   *
   * `relief: false` — картинка без рельефа (улица кадра фонарей): она целиком
   * даль, и разбирать её силуэт незачем. `eye` — высота глаза зрителя, если
   * это не стрелок (у улицы глаз стоит над тротуаром рисунка). `origin` —
   * мировая точка середины низа картинки на плоскости `y = 0`, если это не
   * начало координат (крупный план фонаря смотрит на лампу в восьми метрах
   * над землёй).
   */
  function setBackdrop({
    image,
    rect,
    metresTall,
    plate,
    relief = true,
    eye = SHOOTER_EYE_HEIGHT,
    origin = [0, 0],
  }) {
    state.frame = null;
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = true;
    texture.needsUpdate = true;
    backdropMaterial.uniforms.uPhoto.value?.dispose?.();
    backdropMaterial.uniforms.uPhoto.value = texture;
    if (plate) backdropMaterial.uniforms.uPlate.value.set(...plate);
    let alpha = null;
    if (relief) {
      /* Альфа картинки — в свою сетку, раз на картинку. */
      const scratch = document.createElement("canvas");
      scratch.width = image.naturalWidth || image.width;
      scratch.height = image.naturalHeight || image.height;
      const context = scratch.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      const alphaBytes = new Uint8Array(scratch.width * scratch.height);
      for (let i = 0; i < alphaBytes.length; i += 1) alphaBytes[i] = pixels[i * 4 + 3];
      const distance = silhouetteDistance(alphaBytes, scratch.width, scratch.height);
      const pixelsPerMetre = scratch.height / metresTall;
      const thickness = bodyThickness(distance, pixelsPerMetre);
      const inside = new Uint8Array(alphaBytes.length);
      for (let i = 0; i < alphaBytes.length; i += 1) inside[i] = alphaBytes[i] >= 128 ? 1 : 0;
      alpha = { width: scratch.width, height: scratch.height, thickness, inside };
    }
    state.backdrop = { rect, metresTall, alpha };
    state.view.metresPerPixel = metresTall / rect.height;
    state.view.eye = Number.isFinite(eye) ? eye : SHOOTER_EYE_HEIGHT;
    /* Центр холста — точка плоскости персонажа, на которую смотрит камера. */
    const figureCentreX = rect.x + rect.width / 2;
    state.view.centre = [
      origin[0] + (state.width / 2 - figureCentreX) * state.view.metresPerPixel,
      0,
      origin[1] + (rect.y + rect.height - state.height / 2) * state.view.metresPerPixel,
    ];
    backdropMaterial.uniforms.uPhotoRect.value.set(
      rect.x / state.width,
      1 - (rect.y + rect.height) / state.height,
      rect.width / state.width,
      rect.height / state.height,
    );
    updateCamera();
    rebuildDepth();
  }

  /**
   * Только пиксели картинки фона — та же фигура с подсветкой зон. Рельеф
   * (глубина по альфе) не пересчитывается: наведение на зону не должно
   * стоить разбора силуэта.
   */
  function setBackdropImage(image) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = true;
    texture.needsUpdate = true;
    backdropMaterial.uniforms.uPhoto.value?.dispose?.();
    backdropMaterial.uniforms.uPhoto.value = texture;
  }

  /**
   * Кадр без фигуры — плитка выбора эффекта: только подложка, камера смотрит
   * на точку `centre` (метры мира) с `distance`, в кадре — `metresTall` по
   * высоте. Глаз — на высоте центра: у плитки нет стреляющего.
   */
  function setPlate({ plate, centre = [0, 0, 0], metresTall = 1.2, distance = 3 } = {}) {
    state.frame = null;
    state.backdrop = null;
    if (plate) backdropMaterial.uniforms.uPlate.value.set(...plate);
    backdropMaterial.uniforms.uPhotoRect.value.set(2, 2, 1, 1);
    state.view.metresPerPixel = metresTall / state.height;
    state.view.centre = [...centre];
    state.view.eye = centre[2];
    state.view.distance = Math.max(1, distance);
    updateCamera();
    rebuildDepth();
  }

  /** Дальность камеры до персонажа, метры. */
  function setDistance(distance) {
    if (state.frame) return;
    state.view.distance = Math.max(1, distance);
    updateCamera();
    rebuildDepth();
  }

  /**
   * Кадр игры вместо рендера персонажа (FX-сцены, `docs/fx-scenes.md`): `image` — clean.png, `depth` — `{ width, height, data }`,
   * где `data` — метры вдоль оси взгляда по строкам сверху вниз (`decodeDepth`), `camera` — камера three из `threeCamera`.
   * Глубина кадра идёт и в фон (его `gl_FragDepth`: частица за колонной или телом не рисуется), и в мягкость частиц.
   */
  function setFrame({ image, depth, camera: frameCamera }) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = true;
    texture.needsUpdate = true;
    backdropMaterial.uniforms.uPhoto.value?.dispose?.();
    backdropMaterial.uniforms.uPhoto.value = texture;
    backdropMaterial.uniforms.uPhotoRect.value.set(0, 0, 1, 1);
    /* Текстура глубины идёт снизу вверх: строки кадра переворачиваются. */
    const { width, height, data } = depth;
    const rows = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) rows.set(data.subarray((height - 1 - y) * width, (height - y) * width), y * width);
    depthTexture?.dispose();
    depthTexture = new THREE.DataTexture(rows, width, height, THREE.RedFormat, THREE.FloatType);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    depthTexture.needsUpdate = true;
    shared.depthTexture = depthTexture;
    backdropMaterial.uniforms.uDepth.value = depthTexture;
    backdropMaterial.uniforms.uHasDepth.value = 1;
    state.backdrop = null;
    state.frame = { camera: frameCamera, aspect: image.naturalWidth ? image.naturalWidth / image.naturalHeight : width / height };
    updateCamera();
  }

  /** Мировая точка персонажа по доле картинки (0…1 слева и сверху). */
  function figurePoint(u, v) {
    const backdrop = state.backdrop;
    if (!backdrop?.alpha) return [0, 0, 1];
    const { alpha, metresTall } = backdrop;
    const widthMetres = (alpha.width / alpha.height) * metresTall;
    const sx = Math.min(alpha.width - 1, Math.max(0, Math.floor(u * alpha.width)));
    const sy = Math.min(alpha.height - 1, Math.max(0, Math.floor(v * alpha.height)));
    const thickness = alpha.thickness[sy * alpha.width + sx] || 0;
    return [(u - 0.5) * widthMetres, -thickness, (1 - v) * metresTall];
  }

  /*
   * Сцена шейдером вместо картинки фона — кадр фонарей: столб, земля и свет
   * лампы считаются на видеокарте в HDR той же камерой, что и частицы, и
   * пишут глубину — рой за столбом им и заслоняется. `spec` —
   * `{ fragmentShader, overlayShader?, uniforms }` (массивы чисел —
   * векторы), `null` — вернуть картинку фона. `overlayShader` рисуется ПОСЛЕ
   * частиц сложением — так игра кладёт светящийся воздух луча поверх роя.
   */
  let sceneMaterial = null;
  let overlayMaterial = null;
  const uniformValue = (value) => {
    if (Array.isArray(value) && value.length && Array.isArray(value[0])) return value.map(uniformValue);
    if (Array.isArray(value)) {
      if (value.length === 2) return new THREE.Vector2(...value);
      if (value.length === 3) return new THREE.Vector3(...value);
      if (value.length === 4) return new THREE.Vector4(...value);
    }
    return value;
  };
  function sceneUniforms() {
    return {
      uInvProjection: { value: new THREE.Matrix4() },
      uCameraWorld: { value: new THREE.Matrix4() },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
    };
  }
  function setSceneShader(spec) {
    if (!spec) {
      sceneMaterial?.dispose();
      sceneMaterial = null;
      overlayMaterial?.dispose();
      overlayMaterial = null;
      return;
    }
    if (spec.overlayShader && (!overlayMaterial || overlayMaterial.userData.fragment !== spec.overlayShader)) {
      overlayMaterial?.dispose();
      overlayMaterial = postMaterial(spec.overlayShader, sceneUniforms());
      overlayMaterial.blending = THREE.CustomBlending;
      overlayMaterial.blendEquation = THREE.AddEquation;
      overlayMaterial.blendSrc = THREE.OneFactor;
      overlayMaterial.blendDst = THREE.OneFactor;
      overlayMaterial.userData.fragment = spec.overlayShader;
    } else if (!spec.overlayShader && overlayMaterial) {
      overlayMaterial.dispose();
      overlayMaterial = null;
    }
    if (!sceneMaterial || sceneMaterial.userData.fragment !== spec.fragmentShader) {
      sceneMaterial?.dispose();
      sceneMaterial = postMaterial(spec.fragmentShader, sceneUniforms(), { depthTest: true, depthWrite: true });
      sceneMaterial.depthFunc = THREE.AlwaysDepth;
      sceneMaterial.userData.fragment = spec.fragmentShader;
    }
    for (const material of [sceneMaterial, overlayMaterial]) {
      if (!material) continue;
      for (const [name, value] of Object.entries(spec.uniforms || {})) {
        const uniform = material.uniforms[name];
        if (uniform) uniform.value = uniformValue(value);
        else material.uniforms[name] = { value: uniformValue(value) };
      }
    }
  }

  function syncSceneCamera(material) {
    material.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
    material.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    material.uniforms.uNear.value = camera.near;
    material.uniforms.uFar.value = camera.far;
  }

  /** Сетки моделей частиц из выгрузки правил: `{ имя: { parts } }`. */
  function setMeshes(source) {
    for (const mesh of meshes.values()) for (const part of mesh.parts) part.geometry.dispose();
    meshes.clear();
    for (const [name, mesh] of Object.entries(source || {})) meshes.set(String(name).toLowerCase(), buildModelGeometry(mesh));
    for (const batch of modelBatches.values()) batch.dispose();
    modelBatches.clear();
  }

  /*
   * Мир: цвет — в HDR-цель поверх фона (с глубиной), расстояния — во второй
   * цели для мягкости частиц. Тени карты обновляются только по требованию
   * (`invalidateShadows`): тела и свет стоят, а карта теней — лишний проход.
   */
  function renderWorld() {
    camera.updateMatrixWorld(true);
    if (shadowsDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowsDirty = false;
    }
    renderer.render(world.scene, camera);
    if (!world.softDepth || world.softDepth === "sample") return;
    renderer.setRenderTarget(viewDepthTarget);
    renderer.setClearColor(FAR_COLOUR, 1);
    renderer.clear(true, true, false);
    world.scene.overrideMaterial = viewDepthMaterial;
    renderer.render(world.scene, camera);
    world.scene.overrideMaterial = null;
    renderer.setRenderTarget(hdrTarget);
    renderer.setClearColor(0x000000, 1);
  }

  /*
   * `{ scene, shadows, softDepth }` — сцена с телами, светом и землёй; `null` —
   * убрать мир. `shadows: false` — без карты теней, `softDepth: false` — без
   * прохода расстояний: частицы тогда не мягнут о тело (для слабых видеочипов и
   * разбора отказов драйвера).
   */
  function setWorld(next) {
    world = next && next.scene ? { scene: next.scene, shadows: next.shadows !== false, softDepth: next.softDepth === undefined ? true : next.softDepth } : null;
    renderer.shadowMap.enabled = Boolean(world?.shadows);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    shadowsDirty = Boolean(world?.shadows);
    shared.depthTexture = !world ? depthTexture : world.softDepth && world.softDepth !== "pass" ? viewDepthTarget.texture : null;
  }

  /*
   * `list` — пачки спрайтов, `models` — пачки моделей частиц, `lookup` —
   * лист по имени текстуры (для частей моделей), `trails` — ленты.
   */
  function render(list = [], models = [], lookup = null, trails = []) {
    /* Фон: цвет и глубина рельефа — в HDR-цель. */
    backdropMaterial.uniforms.uExposure.value = state.exposure;
    renderer.setRenderTarget(hdrTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    if (sceneMaterial) {
      camera.updateMatrixWorld(true);
      syncSceneCamera(sceneMaterial);
      postMesh.material = sceneMaterial;
    } else postMesh.material = backdropMaterial;
    renderer.render(postScene, postCamera);
    if (world) renderWorld();

    /* Частицы: сперва модели (пишут глубину), затем спрайты в порядке
       событий, как их рисует игра. */
    particleScene.clear();
    for (const object of sceneObjects) particleScene.add(object);
    const used = new Set();
    const usedModels = new Set();
    for (const batch of models) {
      if (!batch?.count) continue;
      const mesh = meshes.get(String(batch.drawable).toLowerCase());
      if (!mesh) continue;
      mesh.parts.forEach((part, index) => {
        const texture = lookup?.(part.texture)?.texture || null;
        if (!texture) return;
        const key = `${batch.key}#${index}`;
        let model = modelBatches.get(key);
        if (!model) {
          model = new ModelBatch(key, part.geometry, shared);
          modelBatches.set(key, model);
        }
        const object = model.update(batch, texture);
        object.renderOrder = particleScene.children.length;
        particleScene.add(object);
        usedModels.add(key);
      });
    }
    for (const [key, model] of modelBatches) {
      if (usedModels.has(key)) continue;
      model.dispose();
      modelBatches.delete(key);
    }
    for (const batch of list) {
      if (!batch?.count) continue;
      let sprite = batches.get(batch.key);
      if (!sprite) {
        sprite = new SpriteBatch(batch.key);
        batches.set(batch.key, sprite);
      }
      const mesh = sprite.update(batch, shared);
      mesh.renderOrder = particleScene.children.length;
      particleScene.add(mesh);
      used.add(batch.key);
    }
    for (const [key, sprite] of batches) {
      if (used.has(key)) continue;
      sprite.dispose();
      batches.delete(key);
    }
    const usedTrails = new Set();
    for (const batch of trails) {
      if (!batch?.count || !batch.texture) continue;
      let trail = trailBatches.get(batch.key);
      if (!trail) {
        trail = new TrailBatch(batch.key);
        trailBatches.set(batch.key, trail);
      }
      const object = trail.update(batch);
      object.renderOrder = particleScene.children.length;
      particleScene.add(object);
      usedTrails.add(batch.key);
    }
    for (const [key, trail] of trailBatches) {
      if (usedTrails.has(key)) continue;
      trail.dispose();
      trailBatches.delete(key);
    }
    renderer.render(particleScene, camera);

    /* Светящийся воздух луча и ореолы — поверх частиц, как в игре. */
    if (overlayMaterial) {
      syncSceneCamera(overlayMaterial);
      postMesh.material = overlayMaterial;
      renderer.render(postScene, postCamera);
    }

    /*
     * Свечение: порог после экспозиции в четверть кадра, затем уровни ⅛ и
     * 1/16 уменьшением предыдущего; каждый уровень — гауссово размытие.
     */
    thresholdMaterial.uniforms.uScene.value = hdrTarget.texture;
    thresholdMaterial.uniforms.uTexel.value.set(1 / hdrTarget.width, 1 / hdrTarget.height);
    thresholdMaterial.uniforms.uExposure.value = state.exposure;
    thresholdMaterial.uniforms.uThreshold.value = state.bloomThreshold;
    thresholdMaterial.uniforms.uKnee.value = state.bloomKnee;
    postMesh.material = thresholdMaterial;
    renderer.setRenderTarget(bloomLevels[0].a);
    renderer.render(postScene, postCamera);
    bloomLevels.forEach((level, index) => {
      if (index > 0) {
        const previous = bloomLevels[index - 1].a;
        downsampleMaterial.uniforms.uSource.value = previous.texture;
        downsampleMaterial.uniforms.uTexel.value.set(1 / previous.width, 1 / previous.height);
        postMesh.material = downsampleMaterial;
        renderer.setRenderTarget(level.a);
        renderer.render(postScene, postCamera);
      }
      blurMaterial.uniforms.uSource.value = level.a.texture;
      blurMaterial.uniforms.uDirection.value.set(1 / level.a.width, 0);
      postMesh.material = blurMaterial;
      renderer.setRenderTarget(level.b);
      renderer.render(postScene, postCamera);
      blurMaterial.uniforms.uSource.value = level.b.texture;
      blurMaterial.uniforms.uDirection.value.set(0, 1 / level.b.height);
      renderer.setRenderTarget(level.a);
      renderer.render(postScene, postCamera);
    });

    /* Сведение в холст. */
    compositeMaterial.uniforms.uScene.value = hdrTarget.texture;
    compositeMaterial.uniforms.uBloomSmall.value = bloomLevels[0].a.texture;
    compositeMaterial.uniforms.uBloomMed.value = bloomLevels[1].a.texture;
    compositeMaterial.uniforms.uBloomLarge.value = bloomLevels[2].a.texture;
    compositeMaterial.uniforms.uBloomBlend.value.set(...state.bloomBlend);
    compositeMaterial.uniforms.uExposure.value = state.exposure;
    compositeMaterial.uniforms.uBloomIntensity.value = state.bloomIntensity;
    postMesh.material = compositeMaterial;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    /* Кадр — в свой холст: в той же задаче буфер окна ещё хранит картинку. */
    windowed?.present(canvas);
  }

  function dispose() {
    /* Программы сцены — следующему кадру на том же контексте: закрепить до того, как материалы уйдут. */
    windowed?.keepPrograms();
    for (const sprite of batches.values()) sprite.dispose();
    batches.clear();
    for (const model of modelBatches.values()) model.dispose();
    modelBatches.clear();
    for (const trail of trailBatches.values()) trail.dispose();
    trailBatches.clear();
    for (const mesh of meshes.values()) for (const part of mesh.parts) part.geometry.dispose();
    meshes.clear();
    hdrTarget.dispose();
    viewDepthTarget.dispose();
    viewDepthMaterial.dispose();
    for (const level of bloomLevels) {
      level.a.dispose();
      level.b.dispose();
    }
    depthTexture?.dispose();
    sceneMaterial?.dispose();
    overlayMaterial?.dispose();
    backdropMaterial.uniforms.uPhoto.value?.dispose?.();
    for (const material of [
      backdropMaterial,
      thresholdMaterial,
      blurMaterial,
      downsampleMaterial,
      compositeMaterial,
    ])
      material.dispose();
    quad.dispose();
    if (windowed) {
      /* Контекст окна живёт дальше: залитое сценой уже освобождено выше. */
      renderer.renderLists.dispose();
      releaseWindowRenderer(owner);
      windowed = null;
      return;
    }
    renderer.dispose();
    /* Контекст отпускаем, когда холст уже ушёл со страницы: в StrictMode тот же холст монтируется дважды. */
    if (!renderer.domElement?.isConnected) renderer.forceContextLoss?.();
  }

  return {
    camera,
    renderer,
    resize,
    setBackdrop,
    setBackdropImage,
    setPlate,
    setFrame,
    setMeshes,
    /* Свои сетки сцены (кадр фонарей: украшения столба); `[]` — убрать. */
    setSceneObjects: (objects) => {
      sceneObjects = Array.isArray(objects) ? objects.filter(Boolean) : [];
    },
    setSceneShader,
    setWorld,
    /* Теперь сцена другая (свет, положение тел): карта теней пересчитается в следующем кадре. */
    invalidateShadows: () => {
      shadowsDirty = Boolean(world?.shadows);
    },
    setDistance,
    setLighting: applyLighting,
    /** Туман кадра игры (`scene.fog`) или `null`: частицы вдали уходят в его цвет. */
    setFog: (fog) => writeParticleFog(shared, fog),
    /* Огни рядом с частицами (фонари кадра фонарей); по умолчанию их нет. */
    setLocalLights: (lights) => writeLocalLights(shared, lights),
    figurePoint,
    render,
    dispose,
    get view() {
      return state.view;
    },
  };
}
