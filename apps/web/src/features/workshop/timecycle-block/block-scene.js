/*
 * Кадр таймцикла с кварталом из игры (задача 4Б ТЗ 18.10.2026): камера, цикл
 * кадров и состояние загрузки вокруг компоновщика (`block-compositor.js`).
 *
 * Камера — общая на все 3D-кадры мастерской (`stage-camera.js`): WASD сразу,
 * как только курсор над кадром, ЛКМ — осмотреться, колесо — приближение,
 * двойной щелчок — вид по умолчанию. Кадр стоит над домами у Davis Mega Mall;
 * после полёта камера возвращается на этот вид.
 *
 * Цикл. Пока камера летит или куда-то перелетает, кадр рисуется на каждый кадр
 * экрана, а в покое — тридцать раз в секунду, как плоский кадр неба: облака
 * плывут, а квартал дороже неба в разы. Если видеочип не тянет (кадр экрана
 * дольше двух десятков миллисекунд при полёте), разрешение ступенями
 * снижается, а сглаживание краёв выключается раньше разрешения: размытый
 * кадр хуже зубчатого, но ползущий хуже обоих.
 */

import * as THREE from "three";
import { createStageCamera } from "../model-stage/stage-camera.js";
import { createBlockCompositor } from "./block-compositor.js";
import { createGroundFloor } from "./block-ground.js";
import { flightCollide } from "./block-void.js";
import { buildFarWorld } from "./block-far.js";
import { loadSceneAsset } from "../model-stage/scene-asset.js";

/* Глаз — над крышами за три сотни метров от молла, взгляд на север, на него. Точки — в осях сцены (Y вверх),
   рыскание и тангаж — в осях игры: 0 — на север. */
export const DEFAULT_POSE = Object.freeze({ eye: [-70, 6, 150], yaw: 0.2, pitch: 0.02, fov: 62 });
/* Квартал в сцене — шестьсот-восемьсот метров: полёт по нему со скоростью, в которой он успевает читаться. */
const FRAME = Object.freeze({ target: [0, 6, 0], radius: 220, floor: 0.8 });

/* Небо с облаками — тридцать кадров в секунду, не частота экрана; допуск в четыре миллисекунды — от дрожания отметок. */
const CLOUD_FRAME_MS = 1000 / 30 - 4;
const CLOUD_MAX_STEP_MS = 100;
/* Разрешение кадра: ступени от экрана к «слабой видеокарте». */
const RESOLUTION_STEPS = Object.freeze([1, 0.8, 0.64]);
const RATIO_CAP = 1.25;
/* Квартал показывается целиком — когда приехали здание и остальные бандлы; если что-то едет дольше этого, кадр показывает то, что есть. */
const WHOLE_PATIENCE_MS = 30000;

/**
 * Квартал приехал целиком: здание есть (`real`) и ни один из бандлов (соседи, пропы, подмены) не в пути — или кадру
 * надоело ждать (`impatient`). Одно здание без соседей — рваный кадр с домами, что дорисовываются на глазах.
 */
export const quarterWhole = (model, impatient = false) => model?.status === "real" && (impatient || !model.progress?.pending?.length);
/* Кадр экрана дольше этого при полёте — видеочип не тянет; столько кадров подряд — решение. */
const SLOW_FRAME_MS = 24;
const SLOW_FRAMES = 40;

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas — холст, на котором небо уже создало контекст
 * @param {object} options.sky — `createSkyRendererAsync(canvas)`
 * @param {"low"|"medium"|"high"} [options.quality]
 * @param {(status: object) => void} [options.onStatus] — `{ status, reason, progress, step }`
 * @param {(mode: string, info: { speed: number }) => void} [options.onCamera]
 * @param {number} [options.lampSlots] — прожекторы уличных ламп (кадры фонарей и светофоров)
 * @param {string} [options.sectionId] — секция карты вместо квартала Davis
 * @param {object[]} [options.extraPlacements] — детали секции, которых в игре на этом месте нет: `{ piece, at: [x, y, z], yaw }`
 * @param {{ position: number[], yaw: number, pitch: number, fov: number }} [options.pose] — глаз кадра
 * @param {object|null} [options.volume] — объём кадра (`makeVolume`, `block-void.js`): за его краями чёрная пустота
 * @param {object|null} [options.flight] — докуда летит камера (`makeVolume`); без него полёт ограничен только землёй
 * @param {{ url: string, hole?: { centre: number[], radius: number } }|null} [options.farWorld] — дальний мир серой сеткой за краем квартала (`block-far.js`, пробный)
 * @param {boolean} [options.fixedDetail] — детали секции всегда в полной детализации, без подмен издалека (кадры «Фонарей»)
 */
export function createBlockScene({ canvas, sky, quality = "medium", onStatus = null, onCamera = null, lampSlots = 0, sectionId = "", extraPlacements = [], pose = DEFAULT_POSE, frame: frameOptions = FRAME, volume = null, flight = null, farWorld = null, fixedDetail = false }) {
  let dirty = true;
  let running = false;
  let frame = 0;
  let disposed = false;
  let skyState = null;
  let weather = null;
  let clouds = null;
  let visual = {};
  let hourTime = 0;
  let model = { status: "loading", reason: "", progress: null };
  /* Квартал целиком: здание приехало и догрузились остальные бандлы, либо терпение кончилось (`WHOLE_PATIENCE_MS`). */
  let impatient = false;
  let patience = null;
  const whole = () => quarterWhole(model, impatient);
  let size = { width: 0, height: 0, ratio: 1 };
  let step = 0;
  let slow = 0;
  let lastReport = "";

  /* Переходник квартала сообщает состояние ещё внутри `createBlockCompositor`: к тому часу компоновщика нет. */
  let compositor = null;
  compositor = createBlockCompositor(canvas, sky, {
    quality,
    lampSlots,
    sectionId,
    extraPlacements,
    fixedDetail,
    onModel: (next) => {
      model = next || model;
      if (model.status === "real" && !whole() && !patience && !disposed) {
        patience = setTimeout(() => {
          patience = null;
          if (disposed) return;
          impatient = true;
          compositor?.view.warm();
          report();
        }, WHOLE_PATIENCE_MS);
      }
      if (whole() && patience) {
        clearTimeout(patience);
        patience = null;
      }
      report();
    },
    onChange: () => {
      dirty = true;
    },
  });

  const camera = new THREE.PerspectiveCamera(DEFAULT_POSE.fov, 1, 0.4, 9000);
  const eye = createStageCamera({
    camera,
    canvas,
    up: "y",
    /* Вид камеры переживает спячку окна (`features/hibernation/stage-views.js`). */
    memoryKey: `workshop:timecycle-block:${sectionId}`,
    onChange: () => {
      dirty = true;
    },
    onKick: () => {
      dirty = true;
    },
    onMode: (mode, info) => onCamera?.(mode, info),
  });
  /* Пол полёта — земля под камерой, если кадр её просит (`frame.ground`): виды «Фонарей» стоят на настоящей дороге. */
  const groundFloor = createGroundFloor({ root: compositor.view.scene });
  compositor.setVolume(volume);
  /* Дальний мир без текстур (пробный, `block-far.js`): серая сетка вокруг квартала, внутри его круга треугольники убраны. */
  let far = null;
  if (farWorld?.url) {
    loadSceneAsset(farWorld.url)
      .then((asset) => {
        if (disposed) return;
        far = buildFarWorld(asset, { hole: farWorld.hole || null });
        compositor.view.scene.add(far.object);
        dirty = true;
      })
      .catch(() => {});
  }
  /* Рамка камеры: глаз и орбита вида; полёт — если вид его разрешает (`fly`), упирается в землю и в границы полёта. */
  function applyFrame(next, home) {
    const own = next || {};
    eye.setFrame({
      target: own.target || frameOptions.target,
      radius: own.radius || frameOptions.radius,
      inside: home,
      fly: own.fly ?? frameOptions.fly ?? true,
      floor: own.floor ?? frameOptions.floor,
      collide: flightCollide(flight, (own.ground ?? frameOptions.ground) ? groundFloor : null),
    });
  }
  applyFrame(frameOptions, pose);
  /* Кто ставит лампы на кадр: `(camera, state) => [лампа]`; `null` — кадр таймцикла, ламп нет. */
  let lampSource = null;
  /* Вода кадра (редактор «Вода»): числа для сведения; `null` — без воды. */
  let water = null;
  /* Кто живёт в кадре сам (рой частиц у лампы): `(camera, state, step) => void` перед каждым кадром; `step` — секунды с прошлого. */
  let frameHook = null;
  let hookedAt = 0;

  /** Что видит человек: квартал едет, программы собираются, готов, недоступен. */
  function status() {
    if (model.status === "schematic") return { status: "unavailable", reason: model.reason || "" };
    if (whole() && compositor?.view.compiled) return { status: "ready", phase: "", reason: "" };
    /* «Шейдеры» — квартал приехал целиком, видеочип собирает программы; иначе он ещё едет из игры (здание, соседи, пропы). */
    return { status: "loading", phase: whole() ? "shaders" : "model", reason: "" };
  }

  function report() {
    const next = { ...status(), step, antialias: compositor?.antialias ?? true };
    const key = JSON.stringify(next);
    if (key === lastReport) return;
    lastReport = key;
    dirty = true;
    onStatus?.(next);
  }

  /** Размер холста: небо ведёт его размер (`sky.resize`), компоновщик — свои цели под него. */
  function resize(width, height, ratio = 1) {
    size = { width, height, ratio };
    const effective = Math.min(RATIO_CAP, ratio) * RESOLUTION_STEPS[step];
    sky.resize(width, height, effective);
    compositor.resize(canvas.width, canvas.height);
    dirty = true;
  }

  function draw() {
    if (!skyState) return;
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.updateProjectionMatrix();
    if (lampSource) compositor.view.setLamps(lampSource(camera, skyState));
    if (frameHook) {
      const now = performance.now();
      frameHook(camera, skyState, hookedAt ? Math.min((now - hookedAt) / 1000, CLOUD_MAX_STEP_MS / 1000) : 0);
      hookedAt = now;
    }
    compositor.render({
      state: skyState,
      camera,
      weather,
      clouds,
      time: hourTime,
      visual,
      showBlock: model.status !== "schematic",
      water,
    });
  }

  /** Видеочип не тянет: сначала без сглаживания, затем ступенями ниже разрешение. */
  function relieve() {
    if (compositor.antialias) {
      compositor.antialias = false;
    } else if (step < RESOLUTION_STEPS.length - 1) {
      step += 1;
      resize(size.width, size.height, size.ratio);
    } else {
      return;
    }
    report();
  }

  let last = 0;
  let drawnAt = -Infinity;
  function tick(now) {
    if (!running || disposed) return;
    frame = requestAnimationFrame(tick);
    const elapsed = last ? now - last : 16;
    if (last) hourTime += Math.min(elapsed, CLOUD_MAX_STEP_MS) / 1000;
    last = now;
    if (eye.moving()) eye.step(Math.min(elapsed, CLOUD_MAX_STEP_MS) / 1000);
    eye.apply();
    const travelling = eye.travelling || eye.moving();
    if (!dirty && !travelling && now - drawnAt < CLOUD_FRAME_MS) return;
    if (travelling) {
      slow = elapsed > SLOW_FRAME_MS ? slow + 1 : Math.max(0, slow - 2);
      if (slow >= SLOW_FRAMES) {
        slow = 0;
        relieve();
      }
    } else {
      slow = 0;
    }
    dirty = false;
    drawnAt = now;
    draw();
  }

  return {
    compositor,
    camera: eye,
    resize,
    /** Небо на час и всё, что к нему приложено: осадки и радуга, шапки облаков, visualsettings игрока. */
    set(next) {
      if ("state" in next) skyState = next.state;
      if ("weather" in next) weather = next.weather;
      if ("clouds" in next) clouds = next.clouds;
      if ("visual" in next) visual = next.visual || {};
      dirty = true;
    },
    /** Перерисовать: пришли луна, звёзды, листы облаков. */
    invalidate() {
      dirty = true;
    },
    /** Лампы кадра: `(camera, state) => [лампа]` зовётся на каждый кадр; `null` — без ламп. */
    setLampSource(next) {
      lampSource = typeof next === "function" ? next : null;
      dirty = true;
    },
    /**
     * Своя жизнь кадра: `(camera, state, step) => void` зовётся перед каждым кадром, сцену кадра хук трогает сам
     * (`addObject`). Кадр и так перерисовывается не реже облаков; `null` — снять.
     */
    setFrameHook(next) {
      frameHook = typeof next === "function" ? next : null;
      hookedAt = 0;
      dirty = true;
    },
    /** Цвет полосы трубок эстакады: единичный цвет `[r, g, b]` (`bridgeStripTint`) или `null` — как в игре. */
    setStripTint(colour) {
      compositor.view.adapter.setStripTint(colour);
      dirty = true;
    },
    /** Общий свет кадра в долях единицы: 1 — открытое небо, меньше — под настилом (`lamp-street.js`). */
    setShade(value) {
      compositor.view.setShade(value);
      dirty = true;
    },
    /** Вода кадра: числа сведения (`water-frame.js`) или `null` — без воды. */
    setWater(next) {
      water = next || null;
      dirty = true;
    },
    /** Где стоят экземпляры детали квартала (для ламп): матрицы в осях сцены. */
    pieceMatrices: (key) => compositor.view.adapter.pieceMatrices(key),
    /** Лампы детали из данных игры (мосты): `[{ light, matrices }]`. */
    pieceLights: (key) => compositor.view.adapter.pieceLights(key),
    /** Меши детали секции: `[{ geometry, material, local }]` — столбы фонарей: профиль для украшения и листы для краски. */
    pieceParts: (key) => compositor.view.adapter.pieceParts(key),
    /** Краска корпуса детали по экземплярам (`mega-mall-scene.js`, `setPiecePaint`); `null` — как в игре. */
    setPiecePaint(key, spec) {
      compositor.view.adapter.setPiecePaint(key, spec);
      dirty = true;
    },
    /** Свой объект кадра (украшение столба) — в сцену квартала; сам он матрицу себе ставит. */
    addObject(object) {
      compositor.view.scene.add(object);
      dirty = true;
    },
    removeObject(object) {
      compositor.view.scene.remove(object);
      dirty = true;
    },
    /** Новый глаз кадра: вид по умолчанию и рамка орбиты (виды «Дорога», «Перекрёсток»). */
    setView(next) {
      applyFrame(next.frame, next.pose);
      dirty = true;
    },
    /**
     * Один кадр прямо сейчас, без цикла и перелёта: обложка (`block-capture.js`)
     * снимает холст в той же задаче, пока буфер кадра не сброшен.
     */
    renderOnce() {
      if (disposed) return;
      eye.apply();
      draw();
    },
    start() {
      if (running || disposed) return;
      running = true;
      last = 0;
      drawnAt = -Infinity;
      frame = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      eye.releaseKeys?.();
    },
    resetView() {
      eye.reset();
    },
    toggleFly() {
      eye.toggleFly();
    },
    setSpeed(speed) {
      eye.setSpeed(speed);
    },
    get mode() {
      return eye.mode;
    },
    get speed() {
      return eye.speed;
    },
    get status() {
      return status();
    },
    get quality() {
      return { step, antialias: compositor.antialias, scale: RESOLUTION_STEPS[step] };
    },
    dispose() {
      disposed = true;
      far?.dispose();
      if (patience) clearTimeout(patience);
      this.stop();
      eye.dispose();
      compositor.dispose();
    },
  };
}
