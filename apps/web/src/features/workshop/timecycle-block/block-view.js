/*
 * Квартал из игры в кадре таймцикла (задача 4Б ТЗ 18.10.2026): сцена three с
 * настоящим куском карты — секцией `sc1_22` Davis Mega Mall, её соседями,
 * пропами и подменами издалека (LOD, SLOD), — под светом таймцикла.
 *
 * Секцию собирает и ставит переходник «Мега Молла» (`mega-mall-scene.js`):
 * манифест, бандлы GLB, инстансы партиями, уровни детализации по дальности
 * камеры, лампы и свечение из данных игры. Здесь он стоит в своей сцене без
 * окна превью: сцене нужны лишь свет, тени и камера. Панели дизайна молла
 * (квады оверлея) — орган редактора фасадов, в кадре неба их нет.
 *
 * Кадр квартала — HDR в целевом буфере (`target`): цвет с плавающей точкой и
 * глубина. Небо, туман по дальности и сведение делает проход кадра
 * (`block-compositor.js`) теми же числами таймцикла, что и все остальное, —
 * поэтому материалы здесь не знают ни про экспозицию, ни про кривую.
 */

import * as THREE from "three";
import { createMegaMallScene } from "../../../components/desktop/workshop/mega-mall-scene.js";
import { blockLighting, shadowReach } from "./block-light.js";
import { compileScene } from "../model-stage/shader-warmup.js";
import { POLE_MODEL_NAMES } from "@modovik/street-light-contract/lamps";

/* Профиль без дизайна: секция из игры без наклеек. */
const PROFILE_ID = "davis-mega-mall.preview.v1";
/* Секция по умолчанию: у неё есть вывеска молла, у остальных секций карты — нет. */
const DAVIS_SECTION_ID = "davis-mega-mall";

/* Карты теней: чем слабее видеочип, тем меньше (замер на Intel UHD — перед отчётом). */
const SHADOW_MAP = Object.freeze({ low: 0, medium: 1024, high: 2048 });
/* Тень лежит вокруг камеры: дальше этого она не нужна, а карта растягивалась бы. */
const SHADOW_FOLLOW_MAX = 150;
const NEAR = 0.4;
const FAR = 9000;

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer — рендерер на общем контексте кадра
 * @param {"low"|"medium"|"high"} [options.quality]
 * @param {(info: object) => void} [options.onModel] — состояние загрузки квартала
 * @param {() => void} [options.onChange] — в сцене что-то изменилось: кадр надо перерисовать
 * @param {number} [options.lampSlots] — сколько прожекторов уличных ламп завести заранее (кадры фонарей и
 *   светофоров, задача 19 ТЗ 18.10.2026); число ламп входит в шейдер каждого материала, и новая лампа
 *   после сборки программ пересобрала бы их все
 * @param {string} [options.sectionId] — другая секция карты вместо квартала Davis (кадр «Под мостом» «Фонарей»)
 * @param {object[]} [options.extraPlacements] — детали секции, которых в игре на этом месте нет (`mega-mall-scene.js`)
 */
export function createBlockView({ renderer, quality = "medium", onModel = null, onChange = null, lampSlots = 0, sectionId = "", extraPlacements = [], fixedDetail = false }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, NEAR, FAR);
  camera.up.set(0, 1, 0);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  /* Тень включена всегда: смена `castShadow` пересобирает все программы квартала, а это пауза на кадр. */
  sun.castShadow = quality !== "low";
  const shadowSize = SHADOW_MAP[quality] || SHADOW_MAP.medium;
  if (shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
  }
  scene.add(sun, sun.target);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x808080, 1);
  scene.add(hemisphere);
  let shade = 1;

  /* Уличные лампы кадра фонарей: прожекторы без тени, нулевой яркости, пока их никто не просил. */
  const lampSpots = Array.from({ length: Math.max(0, lampSlots) }, () => {
    const spot = new THREE.SpotLight(0xffffff, 0, 50, 1, 0.45, 1.5);
    spot.castShadow = false;
    spot.name = "street-lamp";
    scene.add(spot, spot.target);
    return spot;
  });

  let reach = shadowReach();
  let target = null;
  let size = { width: 1, height: 1 };
  let info = { status: "loading", reason: "" };
  const lastLight = { shadows: true };
  /* Программы квартала собраны видеочипом заранее: первый кадр с ним не стоит на сборке. */
  let compiled = false;
  let warming = false;
  let disposed = false;

  const ctx = {
    THREE,
    scene,
    camera,
    renderer,
    quality,
    assets: null,
    setShadowExtent: (extent) => {
      reach = Math.min(shadowReach(extent / 1.6), SHADOW_FOLLOW_MAX * 2);
    },
    /* Туман и орбиту ведёт кадр, а не сцена: расстояния до тумана — таймцикл, камера — общая. */
    setFogRange: () => {},
    setOrbit: () => {},
    requestRender: () => onChange?.(),
  };

  const adapter = createMegaMallScene({
    profileId: PROFILE_ID,
    sectionId,
    extraPlacements,
    onModel: (next) => {
      info = next || info;
      hideEditorParts?.();
      /* Программы собираются, когда приехало всё: здание и остальные бандлы (соседи, пропы, подмены). Кадр,
         показанный по одному зданию, дорисовывал бы дома по мере приезда и пересобирал программы заново. */
      if (info.status === "real" && !info.progress?.pending?.length) warm();
      onModel?.(info);
      onChange?.();
    },
    onStats: () => onChange?.(),
  });
  adapter.mount(ctx);
  /*
   * Цвета вершин у зданий игры — маски шейдера (смешение слоёв, оклюзия, грязь), а не оттенок: как оттенок
   * они красят парковку и рекламу в пурпур. Без них диффуз такой, каким его видит игра на ровном свете.
   */
  /* Столбы фонарей красятся по экземплярам (кадры редактора «Фонари»): краска — только в партиях с их деталями. */
  adapter.setOptions({
    vertexColors: false,
    gameLamps: lampSlots <= 0,
    signLight: !sectionId || sectionId === DAVIS_SECTION_ID,
    paintable: POLE_MODEL_NAMES,
    /*
     * Кадры «Фонарей» (задача 40): камера ограничена объёмом улицы, и подмены издалека (LOD, SLOD) в нём ни к чему.
     * Всё здание и вся улица — в полной детализации сразу, без домов «в пол-текстуры» и рваных кусков, а бандл
     * подмен (на Davis — 4,7 МБ) не читается: кадр собирается быстрее.
     */
    ...(fixedDetail ? { lodMode: "hd", showLod: false } : {}),
  });
  /*
   * В кадре таймцикла нет того, что у переходника нужно окну редактора фасадов: панелей (квады оверлея дизайна)
   * и асфальтового круга «под зданием». Круг скрыл бы землю неба за кварталом: дальняя земля и вода — те, что
   * рисует шейдер неба, и подпись кадра говорит об этом.
   */
  function hideEditorParts() {
    scene.traverse((object) => {
      if (object.userData?.surfaceId || object.geometry?.type === "CircleGeometry") object.visible = false;
    });
  }
  hideEditorParts();

  /**
   * Собрать программы квартала параллельно и без остановки окна (`KHR_parallel_shader_compile`). Зовётся,
   * когда здание приехало и встало в сцену; пока сборка идёт, кадр рисует небо без квартала. Ожидание — своё
   * (`compileScene`), а не `compileAsync` three: его опрос роняет TypeError «reading 'isReady'», когда квартал
   * освобождён посреди сборки (закрыли кадр; авто-ошибки беты 14–16.10 в 3D-мастерской).
   */
  function warm() {
    if (warming || disposed || typeof renderer.compile !== "function") {
      if (typeof renderer.compile !== "function") compiled = true;
      return;
    }
    warming = true;
    scene.traverse((object) => {
      if (object.isPointLight || object.isSpotLight) object.visible = true;
    });
    Promise.resolve()
      .then(() => compileScene(renderer, scene, camera, () => !disposed))
      .catch(() => true)
      .then((done) => {
        warming = false;
        if (disposed || done === false) return;
        compiled = true;
        onChange?.();
        onModel?.(info);
      });
  }

  function setTarget(width, height) {
    size = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    if (target) target.dispose();
    const depth = new THREE.DepthTexture(size.width, size.height);
    depth.type = THREE.UnsignedIntType;
    target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      depthBuffer: true,
      generateMipmaps: false,
    });
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }

  /**
   * Свет квартала на час: числа таймцикла → лампы сцены. Цвет лампы — сама яркость
   * (больше единицы можно: `Color` three не зажимает), интенсивность — единица.
   */
  function setLighting(state) {
    const light = blockLighting(state);
    sun.color.setRGB(...light.sun.intensity, THREE.LinearSRGBColorSpace);
    sun.intensity = 1;
    sun.userData.direction = light.sun.direction;
    /* Нет тени (ночь без луны, сумерки) — карту не пересчитываем, а программы остаются те же. */
    renderer.shadowMap.autoUpdate = light.sun.shadows;
    lastLight.shadows = light.sun.shadows;
    hemisphere.color.setRGB(...light.hemisphere.intensity.sky, THREE.LinearSRGBColorSpace);
    hemisphere.groundColor.setRGB(...light.hemisphere.intensity.ground, THREE.LinearSRGBColorSpace);
    hemisphere.intensity = shade;
    return light;
  }

  /**
   * Общий свет кадра в долях: под настилом эстакады небо закрыто, и фон земли ниже, чем на открытом месте
   * (`lamp-street.js`, `UNDER_DECK_AMBIENT`). Прямой свет и лампы не трогает.
   */
  function setShade(value) {
    shade = Math.min(1, Math.max(0, Number(value)));
    if (!Number.isFinite(shade)) shade = 1;
    hemisphere.intensity = shade;
  }

  /**
   * Уличные лампы на кадр: `[{ position, target, colour, intensity, distance, decay, angle, penumbra }]` в осях
   * сцены; цвет — линейный. Лишние слоты гаснут нулевой яркостью.
   */
  function setLamps(list = []) {
    lampSpots.forEach((spot, index) => {
      const lamp = list[index];
      if (!lamp) {
        spot.intensity = 0;
        return;
      }
      spot.position.set(...lamp.position);
      spot.target.position.set(...lamp.target);
      spot.color.setRGB(...lamp.colour, THREE.LinearSRGBColorSpace);
      spot.intensity = lamp.intensity;
      spot.distance = lamp.distance;
      spot.decay = lamp.decay;
      spot.angle = lamp.angle;
      spot.penumbra = lamp.penumbra;
      spot.updateMatrixWorld(true);
      spot.target.updateMatrixWorld(true);
    });
  }

  /** Камера и тень за ней: `position` и `quaternion` ведёт общая камера мастерской. */
  function follow() {
    const direction = sun.userData.direction || [0, 1, 0];
    const centre = camera.position.clone();
    centre.y = Math.max(centre.y - 1.5, 0);
    sun.target.position.copy(centre);
    sun.position.set(centre.x + direction[0] * 400, centre.y + direction[1] * 400, centre.z + direction[2] * 400);
    const half = Math.min(reach, SHADOW_FOLLOW_MAX);
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 900 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld(true);
    sun.updateMatrixWorld(true);
  }

  /**
   * Кадр квартала в целевой буфер.
   *
   * @param {object} frame — `{ hour, night }`: час и ночь как доля (для ламп и окон)
   */
  function render(frame = {}) {
    if (!target) return;
    follow();
    adapter.update(ctx, {
      timeOfDay: frame.hour ?? 12,
      lighting: { daylight: 1 - (frame.night ?? 0) },
      /*
       * Лампы и окна горят своей яркостью, а ночная экспозиция (до ×8) делает с ними то же, что в игре.
       * Окно редактора фасадов делит их на экспозицию, чтобы свет зала не тускнел днём, — кадру неба
       * это не нужно: экспозиция у него одна на весь кадр, как у игры.
       */
      interiorGain: 1,
    });
    /*
     * Число включённых ламп входит в шейдер каждого материала: лампа, гаснущая и зажигающаяся по часу, на
     * каждом переходе пересобирала бы десятки программ и ставила кадр. Лампы стоят включёнными всегда, а
     * гаснут нулевой яркостью.
     */
    scene.traverse((object) => {
      if (object.isPointLight || object.isSpotLight) object.visible = true;
    });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  }

  return {
    scene,
    camera,
    sun,
    adapter,
    setTarget,
    setLighting,
    setShade,
    setLamps,
    render,
    near: NEAR,
    far: FAR,
    warm,
    get compiled() {
      return compiled;
    },
    get target() {
      return target;
    },
    get size() {
      return size;
    },
    get info() {
      return info;
    },
    dispose() {
      disposed = true;
      adapter.dispose();
      target?.dispose();
      target = null;
      sun.shadow.map?.dispose();
    },
  };
}
