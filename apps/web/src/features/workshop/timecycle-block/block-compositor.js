/*
 * Кадр таймцикла с кварталом из игры (задача 4Б ТЗ 18.10.2026): небо, квартал,
 * туман, осадки, свечение, экспозиция и кривая — одним контекстом WebGL2.
 *
 *   квартал (three) ─► цель three: HDR + глубина
 *   небо (шейдер неба) ─► цель неба: HDR, осадки отдельным вложением
 *   сведение ─► HDR кадра: квартал перед небом, туман, осадки, молния
 *   глаз ─► яркость кадра (¼ размера + цепочка мипов) → экспозиция одной точкой
 *   свечение ─► три уровня размытия (¼, ⅛, 1/16)
 *   сведение в холст ─► экспозиция, кривая Хейбла, насыщенность, гамма
 *
 * Небо рисует тот же шейдер, что и плоский кадр неба (`sky-renderer.js`), —
 * поэтому купол, облака, шапки, звёзды, радуга и осадки здесь те же, что в
 * редакторе. Квартал рисует three на общем контексте в свою цель; сверку
 * состояния (`renderer.resetState()`) делаем перед его кадром, а проходы
 * «голого» GL сами привязывают всё, что им нужно.
 */

import * as THREE from "three";
import { SCENE_LIGHT, lightningFlash } from "@modovik/timecycle";
import { CONTENT_RANGE, eyeParameters, filmicVectors, framePost } from "./frame-post.js";
import { blockLighting } from "./block-light.js";
import { voidUniforms } from "./block-void.js";
import { createBlockView } from "./block-view.js";
import { bindScreen, createGpuTimer, createPass, createTarget, supportsFloatTargets } from "./gl-pass.js";
import {
  BLUR_PASS,
  COMPOSE_PASS,
  DOWNSAMPLE_PASS,
  EXPOSURE_PASS,
  FXAA_PASS,
  LUMA_PASS,
  PRESENT_PASS,
  THRESHOLD_PASS,
} from "./block-shaders.js";

/* Небо — плавные градиенты и облака: считается в меньшем разрешении, края квартала берёт полный. */
const SKY_SCALE = 0.75;
const BLOOM_LEVELS = 3;
const DISPLAY_GAMMA = 2.2;
/* Потолок яркости пикселя в среднем по кадру: диск солнца в сотни единиц не должен тянуть глаз вниз. */
const LUMA_CAP = 24;

const { atan2, asin } = Math;

/**
 * Взгляд камеры three в осях неба: рыскание и тангаж (Z вверх, без крена).
 * Ось игры (x, y, z) в сцене — (x, z, −y).
 */
export function skyAngles(camera) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const game = { x: forward.x, y: -forward.z, z: forward.y };
  return { yaw: atan2(game.x, game.y), pitch: asin(Math.min(Math.max(game.z, -1), 1)) };
}

/**
 * @param {HTMLCanvasElement} canvas — холст, на котором небо уже создало контекст
 * @param {object} sky — `createSkyRendererAsync(canvas)`
 */
export function createBlockCompositor(canvas, sky, { quality = "medium", onModel = null, onChange = null, lampSlots = 0, sectionId = "", extraPlacements = [], fixedDetail = false } = {}) {
  const gl = sky.gl;
  if (!supportsFloatTargets(gl)) throw new Error("Видеокарта не умеет рисовать в буфер с плавающей точкой.");

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = quality !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const view = createBlockView({ renderer, quality, onModel, onChange, lampSlots, sectionId, extraPlacements, fixedDetail });

  const passes = {
    compose: createPass(gl, COMPOSE_PASS),
    luma: createPass(gl, LUMA_PASS),
    exposure: createPass(gl, EXPOSURE_PASS),
    present: createPass(gl, PRESENT_PASS),
    fxaa: createPass(gl, FXAA_PASS),
    threshold: createPass(gl, THRESHOLD_PASS),
    blur: createPass(gl, BLUR_PASS),
    down: createPass(gl, DOWNSAMPLE_PASS),
  };
  let targets = null;
  let sizes = { width: 0, height: 0, sky: [0, 0] };
  let lastPost = null;
  /* Объём кадра (`block-void.js`): чёрная пустота за его краями; `null` — без него. */
  let volume = null;
  let antialias = true;
  let timer = null;
  /* Замер проходов: со включённым `timer` каждый проход оборачивается запросом времени. */
  const stage = (label, run) => (timer ? timer.measure(label, run) : run());

  function disposeTargets() {
    if (!targets) return;
    targets.sky.dispose();
    targets.scene.dispose();
    targets.luma.dispose();
    targets.lumaSky.dispose();
    targets.eye.dispose();
    targets.image.dispose();
    for (const level of targets.bloom) {
      level.a.dispose();
      level.b.dispose();
    }
    targets = null;
  }

  function buildTargets(width, height) {
    disposeTargets();
    const skyWidth = Math.max(1, Math.round(width * SKY_SCALE));
    const skyHeight = Math.max(1, Math.round(height * SKY_SCALE));
    targets = {
      sky: createTarget(gl, skyWidth, skyHeight, { count: 2 }),
      scene: createTarget(gl, width, height),
      luma: createTarget(gl, Math.max(1, width >> 2), Math.max(1, height >> 2), { mipmaps: true }),
      lumaSky: createTarget(gl, Math.max(1, width >> 2), Math.max(1, height >> 2), { mipmaps: true }),
      eye: createTarget(gl, 1, 1, { linear: false }),
      image: createTarget(gl, width, height, { format: "rgba8" }),
      bloom: Array.from({ length: BLOOM_LEVELS }, (_, index) => {
        const shift = 2 + index;
        const w = Math.max(1, width >> shift);
        const h = Math.max(1, height >> shift);
        return { a: createTarget(gl, w, h), b: createTarget(gl, w, h) };
      }),
    };
    sizes = { width, height, sky: [skyWidth, skyHeight] };
    view.setTarget(width, height);
  }

  /** Размер кадра в точках устройства. */
  function resize(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === sizes.width && h === sizes.height && targets) return;
    buildTargets(w, h);
  }

  function ready() {
    return Object.values(passes).every((pass) => pass.ready());
  }

  /**
   * Кадр.
   *
   * @param {object} input
   * @param {object} input.state — `resolveSkyState`
   * @param {THREE.Camera} input.camera — камера (позиция и поворот ведёт общая камера мастерской)
   * @param {object} [input.weather] — осадки, снег, мокрота, радуга (`weatherConditions`)
   * @param {object} [input.clouds] — шапки облаков
   * @param {number} [input.time] — время облаков, с
   * @param {object} [input.visual] — visualsettings игрока
   * @param {boolean} [input.showBlock] — квартал в кадре (иначе чистое небо с землёй и водой)
   * @param {object|null} [input.water] — вода кадра редактора «Вода» (`water-frame.js`): `level` — высота глади в осях
   *   сцены, остальное — яркость цвета воды, поглощение, отражение неба и подводный туман; `null` — без воды
   */
  function render({ state, camera, weather = null, clouds = null, time = 0, visual = {}, showBlock = true, water = null }) {
    if (!state || !targets || !ready()) return null;
    /* Небо на рендерере окна (шаг Б фазы 5): свой черёд в общем контексте и буфер по холсту. */
    sky.activate?.();
    const { width, height } = sizes;
    const aspect = width / height;
    const fovRadians = (camera.fov * Math.PI) / 180;
    const half = Math.tan(fovRadians / 2);

    view.camera.position.copy(camera.position);
    view.camera.quaternion.copy(camera.quaternion);
    view.camera.fov = camera.fov;
    view.camera.aspect = aspect;
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);

    const light = blockLighting(state);
    const angles = skyAngles(view.camera);
    const eyeHeight = Math.max(view.camera.position.y, 0.5);

    /* 1. Квартал: пока его программы не собраны, кадр рисует небо без него. */
    const blockOn = showBlock && view.compiled;
    if (blockOn) {
      renderer.resetState();
      view.setLighting(state);
      stage("квартал", () => view.render({ hour: state.hour, night: light.night }));
    }

    /* 2. Небо: HDR, осадки вторым вложением, без молнии. */
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    stage("небо", () =>
      sky.render(
        state,
        {
          yaw: angles.yaw,
          pitch: angles.pitch,
          fov: fovRadians,
          time,
          hdrOut: true,
          showCity: false,
          eyeHeight,
          eyeXY: [view.camera.position.x, -view.camera.position.z],
          /* Шапки облаков привязывают экран, поэтому цель — не привязка до вызова, а описание для него. */
          target: { framebuffer: targets.sky.framebuffer, width: sizes.sky[0], height: sizes.sky[1], count: 2 },
        },
        weather,
        clouds,
      ),
    );

    /* 3. Сведение квартала и неба. */
    const post = framePost({ state, visual });
    lastPost = post;
    targets.scene.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const compose = passes.compose;
    stage("сведение", () => {
      compose.use();
      compose.texture("uSky", targets.sky.textures[0], { linear: true });
      compose.texture("uPrecip", targets.sky.textures[1], { linear: true });
      const blockTarget = view.target;
      const handle = (texture) => renderer.properties.get(texture).__webglTexture;
      compose.texture("uBlock", blockOn ? handle(blockTarget.texture) : targets.sky.textures[0]);
      compose.texture("uDepth", blockOn ? handle(blockTarget.depthTexture) : targets.sky.textures[0]);
      compose.set("uBlockOn", blockOn ? 1 : 0);
      compose.set("uNear", view.near);
      compose.set("uFar", view.far);
      compose.set("uTan", [half * aspect, half]);
      compose.set("uCamera", [angles.yaw, angles.pitch]);
      compose.set("uEyeHeight", eyeHeight);
      compose.set("uFogColour", state.fogColour);
      compose.set("uFogHdr", state.fogHdr);
      compose.set("uFogDensity", state.fogDensity);
      compose.set("uMist", (weather?.mist || 0) / 100);
      compose.set("uFogHaze", state.fogHazeColour);
      compose.set("uFogHazeHdr", state.fogHazeHdr);
      compose.set("uLightColour", state.lightDirColour);
      compose.set("uLightIntensity", state.lightDirIntensity);
      compose.set("uDirectScale", SCENE_LIGHT.direct);
      compose.set("uCityLight", light.artificial);
      compose.set("uNight", light.night);
      compose.set("uFlash", lightningFlash(time, weather?.lightning || 0));
      /* Снег и мокрый асфальт на земле квартала (`groundWeather` в шейдере): без погоды юниформы нули, и шейдер ветку пропускает. */
      const snow = Math.min(Math.max((weather?.snow || 0) / 100, 0), 1);
      const wet = Math.min(Math.max((weather?.wetness || 0) / 100, 0), 1);
      compose.set("uSnowCover", snow);
      compose.set("uWetness", wet);
      if (snow > 0 || wet > 0) {
        /* Яркость белой горизонтали: солнце по высоте света плюс небо сверху — те же числа, что у ламп квартала. */
        const lift = Math.max(light.sun.direction[1], 0);
        compose.set("uUpLight", light.sun.radiance.map((value, index) => value * lift + light.hemisphere.sky[index]));
        compose.set("uGroundEye", [view.camera.position.x, -view.camera.position.z, view.camera.position.y]);
        compose.set("uPixel", [1 / sizes.width, 1 / sizes.height]);
      }
      compose.set("uWaterOn", water ? 1 : 0);
      compose.set("uVoidOn", volume && blockOn ? 1 : 0);
      if (volume && blockOn) {
        const numbers = voidUniforms(volume);
        /* Глаз в осях игры от якоря: x — восток, y — север (−z сцены), z — вверх (y сцены). */
        compose.set("uEyeGame", [view.camera.position.x, -view.camera.position.z, view.camera.position.y]);
        compose.set("uVoidCentre", numbers.centre);
        compose.set("uVoidAxis", numbers.axis);
        compose.set("uVoidHalf", numbers.half);
        compose.set("uVoidZ", numbers.z);
        compose.set("uVoidFade", numbers.fade);
        compose.set("uVoidDisc", numbers.disc);
        compose.set("uVoidAbyss", numbers.abyss);
      }
      if (water) {
        compose.set("uWaterEye", view.camera.position.y - water.level);
        compose.set("uWaterShore", water.shore);
        compose.set("uWaterMid", water.mid);
        compose.set("uWaterDeep", water.deep);
        compose.set("uWaterKappa", water.kappa);
        compose.set("uWaterAbsorb", water.absorb);
        compose.set("uWaterAbsorbUnder", water.absorbUnder);
        compose.set("uWaterSky", water.sky);
        compose.set("uWaterFog", water.fog);
        compose.set("uWaterTint", water.tint);
        compose.set("uWaterUnderKappa", water.underKappa);
        compose.set("uWaterVignette", water.vignette);
        /* Глаз на карте (оси игры: x, y = −z сцены), время волн, солнце (луна) и его яркость. */
        compose.set("uWaterEyeXY", [view.camera.position.x, -view.camera.position.z]);
        compose.set("uWaterTime", time);
        compose.set("uWaterSun", water.sun);
        compose.set("uWaterSunColour", water.sunColour);
      }
      compose.draw();
    });

    /* 4. Глаз игры: средняя яркость настоящего кадра → экспозиция (одна точка на видеочипе, без чтения на процессор). */
    const eye = eyeParameters({ state, visual });
    stage("глаз", () => {
      targets.luma.bind();
      passes.luma.use();
      passes.luma.texture("uScene", targets.scene.texture, { linear: true });
      /* Пустота объёма считается небом без квартала; без объёма пиксели берутся как есть. */
      passes.luma.texture("uAlt", targets.sky.textures[0], { linear: true });
      passes.luma.set("uUseAlt", volume && blockOn ? 1 : 0);
      passes.luma.set("uTexel", [1 / sizes.width, 1 / sizes.height]);
      passes.luma.set("uCap", LUMA_CAP);
      passes.luma.draw();
      targets.luma.generateMipmaps();
      /* То же для неба без квартала: от него отсчитывается поправка на содержимое. */
      targets.lumaSky.bind();
      passes.luma.use();
      passes.luma.texture("uScene", targets.sky.textures[0], { linear: true });
      passes.luma.texture("uAlt", targets.sky.textures[0], { linear: true });
      passes.luma.set("uUseAlt", 0);
      passes.luma.set("uTexel", [1 / sizes.sky[0], 1 / sizes.sky[1]]);
      passes.luma.set("uCap", LUMA_CAP);
      passes.luma.draw();
      targets.lumaSky.generateMipmaps();
      targets.eye.bind();
      passes.exposure.use();
      passes.exposure.texture("uLuma", targets.luma.texture, { mipmapped: true });
      passes.exposure.texture("uLumaRef", targets.lumaSky.texture, { mipmapped: true });
      passes.exposure.set("uTopLevel", targets.luma.topLevel);
      passes.exposure.set("uModel", post.luminance);
      passes.exposure.set("uContent", blockOn ? 1 : 0);
      passes.exposure.set("uContentRange", [...CONTENT_RANGE]);
      passes.exposure.set("uCurve", eye.curve);
      passes.exposure.set("uLimit", eye.limit);
      passes.exposure.set("uSets", eye.sets);
      /* Над водой песок и пена пересвечивали кадр: экспозиция у воды ниже, под водой — как есть (`water-frame.js`). */
      passes.exposure.set("uOffset", water ? (view.camera.position.y > water.level ? water.exposureAbove : water.exposureUnder) : 0);
      passes.exposure.draw();
    });

    /* 5. Свечение: порог после экспозиции в четверть кадра, затем уровни ⅛ и 1/16. */
    stage("свечение", () => {
      const threshold = passes.threshold;
      const first = targets.bloom[0].a;
      first.bind();
      threshold.use();
      threshold.texture("uScene", targets.scene.texture, { linear: true });
      threshold.texture("uExposure", targets.eye.texture);
      /* Четверть кадра берёт клетку 4×4: девять отсчётов через два пикселя перекрывают её без дыр. */
      threshold.set("uTexel", [2 / sizes.width, 2 / sizes.height]);
      threshold.set("uThreshold", post.bloom.threshold);
      threshold.set("uKnee", post.bloom.knee);
      threshold.draw();
      targets.bloom.forEach((level, index) => {
        if (index > 0) {
          const previous = targets.bloom[index - 1].a;
          level.a.bind();
          passes.down.use();
          passes.down.texture("uSource", previous.texture, { linear: true });
          passes.down.set("uTexel", [1 / previous.width, 1 / previous.height]);
          passes.down.draw();
        }
        level.b.bind();
        passes.blur.use();
        passes.blur.texture("uSource", level.a.texture, { linear: true });
        passes.blur.set("uDirection", [1 / level.a.width, 0]);
        passes.blur.draw();
        level.a.bind();
        passes.blur.use();
        passes.blur.texture("uSource", level.b.texture, { linear: true });
        passes.blur.set("uDirection", [0, 1 / level.b.height]);
        passes.blur.draw();
      });
    });

    /* 6. Кривая и гамма в готовый кадр, затем сглаживание краёв в холст. */
    stage("кривая и сглаживание", () => {
      if (antialias) targets.image.bind();
      else {
        bindScreen(gl, canvas.width, canvas.height);
        gl.drawBuffers([gl.BACK]);
      }
      const present = passes.present;
      present.use();
      present.texture("uScene", targets.scene.texture, { linear: true });
      present.texture("uBloomSmall", targets.bloom[0].a.texture, { linear: true });
      present.texture("uBloomMed", targets.bloom[1].a.texture, { linear: true });
      present.texture("uBloomLarge", targets.bloom[2].a.texture, { linear: true });
      present.set("uBloomBlend", post.bloom.blend);
      present.set("uBloomIntensity", post.bloom.intensity);
      present.texture("uExposure", targets.eye.texture);
      const [bright0, bright1] = filmicVectors(eye.bright);
      const [dark0, dark1] = filmicVectors(eye.dark);
      present.set("uBright0", bright0);
      present.set("uBright1", bright1);
      present.set("uDark0", dark0);
      present.set("uDark1", dark1);
      present.set("uSaturation", post.saturation);
      present.set("uGamma", DISPLAY_GAMMA);
      present.set("uOpaque", antialias ? 0 : 1);
      present.draw();

      if (antialias) {
        bindScreen(gl, canvas.width, canvas.height);
        gl.drawBuffers([gl.BACK]);
        const fxaa = passes.fxaa;
        fxaa.use();
        fxaa.texture("uImage", targets.image.texture, { linear: true });
        fxaa.set("uTexel", [1 / sizes.width, 1 / sizes.height]);
        fxaa.draw();
      }
    });
    gl.bindVertexArray(null);
    /* Кадр из общего буфера — в холст (на своём контексте неба — ничего). */
    sky.present?.();
    timer?.collect();
    return post;
  }

  /**
   * Что решил глаз на последнем кадре: читает точку экспозиции с видеочипа.
   * Останавливает конвейер, поэтому — для замеров и подписи, не на каждый кадр.
   */
  function measureEye() {
    if (!targets) return null;
    const pixel = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.eye.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { exposure: pixel[0], ev: pixel[1], share: pixel[2], luminance: pixel[3] };
  }

  function dispose() {
    view.dispose();
    for (const pass of Object.values(passes)) pass.dispose();
    disposeTargets();
    renderer.dispose();
  }

  return {
    gl,
    renderer,
    view,
    resize,
    render,
    ready,
    measureEye,
    dispose,
    /** Объём кадра (`makeVolume`): за его краями — чёрная пустота; `null` — без объёма. */
    setVolume(next) {
      volume = next || null;
      onChange?.();
    },
    /** Замер проходов на видеочипе: `profile(true)`, несколько кадров, `profileReport()`. */
    profile(on) {
      timer = on ? timer || createGpuTimer(gl) : null;
      return Boolean(timer);
    },
    profileReport() {
      return timer?.report() || null;
    },
    /** Сглаживание краёв квартала (FXAA); слабой видеокарте его можно выключить. */
    get antialias() {
      return antialias;
    },
    set antialias(value) {
      antialias = Boolean(value);
      onChange?.();
    },
    get post() {
      return lastPost;
    },
    get failure() {
      return (
        Object.values(passes)
          .map((pass) => pass.failure)
          .find(Boolean) || ""
      );
    },
  };
}
