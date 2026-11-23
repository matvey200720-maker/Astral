/*
 * Сцена окна предпросмотра: рендерер, свет по таймциклу и управляющий кадрами.
 *
 * Отдельно от React по двум причинам. Первая — это императивный код: камера,
 * карта теней и цикл кадров живут между перерисовками, и заворачивать их в
 * состояние компонента значит пересоздавать контекст WebGL на каждое движение
 * мыши. Вторая — так сцену можно проверить тестом: React здесь ничего не
 * решает, а решает всё то, что ниже.
 *
 * Главное правило файла: кадр рисуется, только когда есть что показать нового.
 * Редактор дороги держат открытым часами рядом с игрой, и шестьдесят кадров в
 * секунду в неподвижное окно — это отнятые у игры кадры и разряженный ноутбук.
 * Поэтому здесь три выключателя: `dirty` (что-то изменилось), `animated`
 * (сцена сама движется) и видимость — окна на экране и вкладки в браузере.
 *
 * Четвёртый — внимание (`attention.js`): окно в фоне, под игрой или минуту без
 * касаний. Сама по себе сцена тогда не движется — проезд и полёт встают на
 * текущем кадре, — но на действие человека кадр по-прежнему отвечает: колесо
 * над окном в фоне на macOS доходит до страницы, и окно, которое на него
 * промолчит, выглядит сломанным.
 */

import * as THREE from "three";
import {
  attentionAllowsMotion,
  subscribeAttention,
} from "../../../../attention.js";
import {
  createReturnTrip,
  returnSeconds,
} from "../../../../features/workshop/model-stage/camera-return.js";
import {
  flyKeyAction,
  isTypingTarget,
} from "../../../../features/workshop/model-stage/fly-keys.js";
import {
  createSceneWarmup,
  skipShaderChecks,
} from "../../../../features/workshop/model-stage/shader-warmup.js";
import {
  QUALITY_LEVELS,
  QUALITY_PROFILES,
  rememberQuality,
} from "../../../../features/workshop/model-stage/quality-profile.js";
import { previewLighting } from "./preview-lighting.js";
import { createSkyDome } from "./sky-dome.js";
import { markWheel } from "../../../ui/wheel-mark.js";

/*
 * Профили качества — общие для всех сцен мастерской (`quality-profile.js`, 18.10.2026):
 * «высокий» — картинка студии оружия, «низкий» — без теней и сглаживания. Окно предпросмотра
 * остаётся единственным, кто меряет кадры («авто»), и итог замера запоминает для остальных.
 */
export { QUALITY_LEVELS, QUALITY_PROFILES };

/*
 * Шаг времени для кадра, снятого вручную. Шестьдесят кадров в секунду — не
 * измеренная величина, а условная: у того, кто снимает кадры пачкой, часов
 * сцены нет вовсе, а сцене нужен какой-то ход, чтобы проезд сдвинулся.
 */
const NOMINAL_DELTA = 1 / 60;

/* Сколько кадров меряем, прежде чем выбрать качество в режиме «авто». */
const PROBE_FRAMES = 48;
/* Первые кадры выкидываются: в них компиляция шейдеров и загрузка текстур,
   а не та скорость, с которой окно будет жить дальше. */
const PROBE_WARMUP = 12;
const PROBE_TIMEOUT_MS = 2500;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/*
 * Предохранитель на размер кадра.
 *
 * Окно предпросмотра не бывает больше полутора экранов — а вот контейнер,
 * высота которого считается по содержимому, вернуть такую высоту вполне может:
 * она и есть высота холста, который мы в него положили. Круг тут неразрешим по
 * своей природе (кто кого меряет), поэтому ответственность делится: контейнеру
 * положено иметь собственный размер, а окну — не разносить видеопамять, если
 * ему подсунули его же хвост.
 */
function surfaceLimit(value, viewport, fallback) {
  const ceiling = Math.max(640, Math.round((viewport || fallback) * 1.5));
  return clamp(Math.round(value || 0) || fallback, 1, ceiling);
}

const DEFAULT_ORBIT = { yaw: 2.35, pitch: 0.4, radius: 46 };

/*
 * Внешние рамки орбиты — то, за что не пустит никакая сцена.
 *
 * Не «настройка по умолчанию», а предохранитель: расстояние в ноль ставит
 * камеру внутрь точки взгляда, наклон в девяносто градусов ломает `lookAt`
 * вырожденным вектором вверх. Сцена вправе сузить диапазон сколько угодно, но
 * не вправе выйти за эти края.
 */
const ORBIT_BOUNDS = Object.freeze({
  radius: Object.freeze([3, 600]),
  pitch: Object.freeze([0.02, 1.42]),
});

/*
 * Полёт.
 *
 * Скорость взята по комнате, а не по улице: полёт заводился ради интерьеров,
 * а зал магазина — это семь метров в глубину. Метр с небольшим в секунду
 * позволяет остановиться у полки; Shift даёт втрое больше, и этого хватает
 * пересечь ангар, не отпуская клавишу.
 *
 * Нижняя граница по высоте — не «настройка», а тот же предохранитель, что и у
 * орбиты: под полом сцены пусто, а обратно оттуда не выбираются.
 */
const FLY_SPEED = 3.2;
const FLY_BOOST = 3;
const FLY_FLOOR = 0.3;
const FLY_PITCH_LIMIT = 1.45;
const DEFAULT_FOG_RANGE = [14, 900];

function disposeMaterial(material) {
  if (!material) return;
  for (const value of Object.values(material)) {
    if (value && value.isTexture) value.dispose();
  }
  material.dispose?.();
}

function disposeSubtree(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const material = object.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
}

/**
 * Поднимает сцену внутри переданного контейнера.
 *
 * Холст создаётся здесь и здесь же убирается, а не приходит из разметки:
 * контекст WebGL нельзя завести на холсте дважды, а React в строгом режиме
 * монтирует эффект два раза подряд на одном и том же узле. Свой холст на
 * каждый подъём сцены снимает этот вопрос целиком.
 *
 * Бросает, если WebGL недоступен — вызывающий обязан это поймать и показать
 * заглушку: отсутствие видеокарты не повод закрывать редактор.
 */
export function createPreviewStage(host, options = {}) {
  const {
    scene: adapter = null,
    assets = null,
    quality = "auto",
    camera: cameraMode = "orbit",
    timeOfDay = 12,
    weather = "EXTRASUNNY",
    region = "GLOBAL",
    onFrame = null,
    /* Режим сменила сама сцена (W A S D подняли в полёт, Esc вывел): окну — знать. */
    onCameraMode = null,
    postProcess: postProcessHook = null,
  } = options;

  let requested = quality;
  /* «Авто» стартует со среднего и правит себя по замеру: начинать с высокого
     значит показать первые секунды рывками именно тем, кому это важнее всего
     — людям на слабых машинах. */
  let level = QUALITY_LEVELS.includes(quality) ? quality : "medium";
  let profile = QUALITY_PROFILES[level];

  const canvas = (host.ownerDocument || globalThis.document).createElement(
    "canvas",
  );
  canvas.className = "preview-window-surface";
  canvas.setAttribute("aria-label", "Предпросмотр сцены");
  /* Блочный — прямо здесь, а не в листе стилей: от этого зависит, разойдётся
     ли замер размера (см. `resize`), а лист может и не доехать — окно поднимают
     и в стенде, и в тесте, где стилей нет вовсе. */
  canvas.style.display = "block";
  host.append(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      /* Сглаживание задаётся при создании контекста и позже не меняется.
         Поэтому в режиме «авто» окно стартует со сглаживанием, а понижая
         качество, гасит тени и плотность пикселей — их можно менять на живом
         контексте, и выигрыш от них больше, чем от снятого сглаживания. */
      antialias: quality === "auto" ? true : profile.antialias,
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
    });
  } catch (error) {
    /* Холст уже в разметке — без уборки на его месте останется пустой чёрный
       прямоугольник поверх заглушки, которую покажет вызывающий. */
    canvas.remove();
    throw error;
  }
  skipShaderChecks(renderer);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /*
   * Плёночная кривая, а не линейный вывод. Небо GTA живёт в HDR — `sky_hdr`
   * уходит за тридцать, — и без сведения полдень становится белым листом, а
   * ночь угольным прямоугольником. Экспозицию считает таймцикл, здесь она
   * только применяется.
   */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.25, 6000);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = "preview-key-light";
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  /* Цель направленного света обязана быть в сцене, иначе three считает её
     матрицу от прошлого кадра, и тени отстают на кадр при движении камеры. */
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x404040, 1);
  ambient.name = "preview-ambient";
  scene.add(ambient);

  const fog = new THREE.Fog(
    0x0a0d12,
    DEFAULT_FOG_RANGE[0],
    DEFAULT_FOG_RANGE[1],
  );
  scene.fog = fog;

  const dome = createSkyDome();
  scene.add(dome.object);

  /* ---------- состояние ---------- */

  let disposed = false;
  let dirty = true;
  let animated = false;
  let onScreen = true;
  let tabVisible =
    typeof document === "undefined" || document.visibilityState !== "hidden";
  /* Полное внимание к окну — см. «Внимание» ниже. */
  let attentive = attentionAllowsMotion();
  let raf = 0;
  let running = false;
  let last = 0;
  let elapsed = 0;
  /* Шаг последнего кадра — им живёт хук постобработки: эффект, который идёт во
     времени, считает свой ход не по часам браузера, а по ходу окна. */
  let lastDelta = 0;
  let renders = 0;
  let fogRange = [...DEFAULT_FOG_RANGE];
  let shadowExtent = 70;
  /* Последний принятый размер контейнера — см. `resize`. */
  let measured = [0, 0];
  let mode = cameraMode;
  let clock = { timeOfDay, weather, region };
  /*
   * Закрытая сцена объявляет себя сама. Окно не может это угадать: и арена, и
   * дорога для него — просто набор мешей, а разница между ними в том, доходит
   * ли до них небо. Флаг у переходника, а не свойство компонента, потому что
   * знает об этом тот, кто строит сцену, а не тот, кто ставит окно на страницу.
   */
  let exposure = {
    mode: adapter?.enclosed ? "enclosed" : "sky",
    stops: 0,
    bias: 0,
  };
  let lighting = previewLighting({
    timeOfDay,
    weather,
    region,
    exposureMode: exposure.mode,
    exposureStops: exposure.stops,
    exposureBias: exposure.bias,
  });

  function recomputeLighting() {
    lighting = previewLighting({
      timeOfDay: clock.timeOfDay,
      weather: clock.weather,
      region: clock.region,
      exposureMode: exposure.mode,
      exposureStops: exposure.stops,
      exposureBias: exposure.bias,
    });
    applyLighting();
  }

  /*
   * Пределы орбиты живут рядом с самой орбитой, а не в аргументах вызова:
   * колесо мыши и протяжка приходят из обработчиков событий, у которых на
   * руках нет ничего, кроме этого объекта.
   *
   * По умолчанию они равны внешним рамкам — окно, которому пределов не
   * задавали, ведёт себя ровно как раньше.
   */
  const orbit = {
    ...DEFAULT_ORBIT,
    target: new THREE.Vector3(0, 2.2, 0),
    minRadius: ORBIT_BOUNDS.radius[0],
    maxRadius: ORBIT_BOUNDS.radius[1],
    minPitch: ORBIT_BOUNDS.pitch[0],
    maxPitch: ORBIT_BOUNDS.pitch[1],
  };
  const clampRadius = (value) => clamp(value, orbit.minRadius, orbit.maxRadius);
  const clampPitch = (value) => clamp(value, orbit.minPitch, orbit.maxPitch);
  const drive = {
    from: new THREE.Vector3(0, 1.45, 140),
    to: new THREE.Vector3(0, 1.45, -140),
    speed: 14,
    progress: 0,
  };
  /*
   * Полёт: свободная камера вместо орбиты.
   *
   * Углы держатся здесь, а не читаются из камеры каждый кадр: чтение обратно
   * из кватерниона у отвесного взгляда теряет курс, и камера у самого потолка
   * начинала бы крутиться сама.
   *
   * `bounds` — коробка, за которую камеру не пускают. Её задаёт сцена: только
   * она знает, где у неё стены. Не задали — держим камеру над полом, а
   * остальное на совести того, кто летит.
   */
  const fly = {
    yaw: 0,
    pitch: 0,
    keys: new Set(),
    looking: null,
    bounds: null,
    /* Где камера стояла, когда взлетела: коробка полёта не затаскивает её к себе. */
    entry: null,
  };

  const probe = { active: quality === "auto", frames: [], startedAt: 0 };
  const recent = [];
  const clearColour = new THREE.Color();
  let reportedAt = 0;

  /* ---------- свет и небо ---------- */

  /*
   * Тени видны только внутри своей ортографической коробки, и её размер должен
   * знать тот, кто строит сцену: у арены мир — полсотни метров, у дороги —
   * несколько сотен. Коробка на весь возможный мир даёт карту теней, у которой
   * на метр приходится один пиксель, и тень превращается в лесенку.
   *
   * `updateProjectionMatrix` здесь обязателен: three не пересчитывает матрицу
   * камеры теней сам, и без вызова остаётся заводская коробка десять на десять
   * метров — тень попадает в неё только у самого центра сцены, и выглядит это
   * как «теней нет вообще».
   */
  function applyShadowExtent(radius) {
    const camera = sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.far = Math.max(radius * 6, 400);
    camera.updateProjectionMatrix();
    dirty = true;
  }

  function applyLighting() {
    const key = lighting.key;
    /* Направление света — это направление НА источник: three светит из
       позиции лампы в её цель. Поставить сюда вектор «куда светит» значит
       получить тени, лежащие в сторону солнца. */
    /* Лампу отодвигаем за пределы коробки теней: стоя внутри неё, направленный
       свет обрезал бы тени от всего, что выше её ближней плоскости. */
    const distance = Math.max(shadowExtent * 2.2, 120);
    sun.position.set(
      key.direction[0] * distance,
      key.direction[1] * distance,
      key.direction[2] * distance,
    );
    sun.target.position.set(0, 0, 0);
    sun.color.setRGB(
      key.colour[0],
      key.colour[1],
      key.colour[2],
      THREE.LinearSRGBColorSpace,
    );
    sun.intensity = key.intensity;
    sun.castShadow = profile.shadows && key.castShadow;

    ambient.color.setRGB(
      lighting.ambient.sky[0],
      lighting.ambient.sky[1],
      lighting.ambient.sky[2],
      THREE.LinearSRGBColorSpace,
    );
    ambient.groundColor.setRGB(
      lighting.ambient.ground[0],
      lighting.ambient.ground[1],
      lighting.ambient.ground[2],
      THREE.LinearSRGBColorSpace,
    );
    ambient.intensity = lighting.ambient.intensity;

    /*
     * Туман получает экранный цвет, а не линейный.
     *
     * `fog_fragment` в шейдере three стоит ПОСЛЕ `tonemapping_fragment`: к
     * моменту наложения тумана кадр уже сведён кривой и переведён в sRGB.
     * Линейный цвет тумана в сумерках уходит за двойку, и подмешивание двойки
     * в картинку, которая уже лежит в 0…1, упирает весь дальний план в белое —
     * по горизонту шла белая полоса в две-три строки на любой сцене, где есть
     * хоть одна горизонтальная поверхность.
     *
     * Пространство помечено линейным намеренно: числа должны дойти до униформы
     * как есть. Пометить их как sRGB значит попросить three перевести их ещё
     * раз — и земля у горизонта разойдётся с куполом на десяток уровней.
     */
    fog.color.setRGB(
      lighting.fog.display[0],
      lighting.fog.display[1],
      lighting.fog.display[2],
      THREE.LinearSRGBColorSpace,
    );
    fog.near = fogRange[0] * clamp(lighting.fog.falloff, 0.3, 2.6);
    fog.far = fogRange[1] * lighting.fog.falloff;

    renderer.toneMappingExposure = lighting.toneMappingExposure;
    /* Цвет очистки уже сведён кривой — он пишется в буфер мимо неё, в отличие
       от купола. Поэтому здесь sRGB, а у света и тумана линейный свет. */
    clearColour.setRGB(
      lighting.clearColour[0],
      lighting.clearColour[1],
      lighting.clearColour[2],
      THREE.SRGBColorSpace,
    );
    renderer.setClearColor(clearColour, 1);

    dome.apply(lighting);
    dirty = true;
  }

  /* ---------- качество ---------- */

  function applyQuality(next) {
    level = QUALITY_LEVELS.includes(next) ? next : "medium";
    profile = QUALITY_PROFILES[level];
    const density =
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(density, profile.pixelRatio));
    /* Замер размера пропускает совпавшие значения, а плотность пикселей меняет
       буфер при том же размере на экране: без сброса понижение качества не
       уменьшило бы ни одного пикселя. */
    measured = [0, 0];
    renderer.shadowMap.enabled = profile.shadows;
    sun.castShadow = profile.shadows && lighting.key.castShadow;
    if (profile.shadowMap)
      sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
    /* Карта теней держит текстуру прежнего размера, пока её не выбросить:
       понижение качества без этого экономит только рисование, но не память. */
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    resize();
    dirty = true;
  }

  function finishProbe() {
    probe.active = false;
    const samples = probe.frames.slice(PROBE_WARMUP).sort((a, b) => a - b);
    if (!samples.length) return;
    const median = samples[Math.floor(samples.length / 2)];
    /*
     * Порог по времени кадра, а не по «средним FPS»: одна долгая пауза на
     * компиляцию шейдера роняет среднее так, что окно уходит на низкое
     * качество навсегда. Медиана к таким выбросам глуха.
     */
    const chosen = median > 23 ? "low" : median < 10.5 ? "high" : "medium";
    /* Остальные сцены меряться нечем (сглаживание задаётся при создании контекста): берут этот итог. */
    rememberQuality(chosen);
    if (chosen !== level) applyQuality(chosen);
    updateAnimated();
  }

  /* ---------- камера ---------- */

  function applyOrbit() {
    const horizontal = Math.cos(orbit.pitch) * orbit.radius;
    camera.position.set(
      orbit.target.x + Math.sin(orbit.yaw) * horizontal,
      orbit.target.y + Math.sin(orbit.pitch) * orbit.radius,
      orbit.target.z + Math.cos(orbit.yaw) * horizontal,
    );
    camera.lookAt(orbit.target);
  }

  function applyDrive(delta) {
    const length = drive.from.distanceTo(drive.to) || 1;
    drive.progress = (drive.progress + (drive.speed * delta) / length) % 1;
    const position = drive.from.clone().lerp(drive.to, drive.progress);
    const ahead = drive.from
      .clone()
      .lerp(drive.to, (drive.progress + 0.05) % 1);
    /* Лёгкое покачивание: без него проезд читается как рельсовая тележка, а
       смысл режима — показать дорогу глазами водителя. */
    position.y += Math.sin(elapsed * 2.1) * 0.035;
    camera.position.copy(position);
    camera.lookAt(ahead.x, ahead.y + 0.4, ahead.z);
  }

  /* Углы полёта из того, куда камера смотрит сейчас: вход в режим не должен
     переставлять кадр. */
  function adoptFlyAngles() {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    fly.yaw = Math.atan2(-direction.x, -direction.z);
    fly.pitch = Math.asin(clamp(direction.y, -1, 1));
  }

  /*
   * Домой из полёта (13.10.2026, владелец: «включаешь полёт и выходишь из
   * него — камера не возвращается на стандартную позицию»).
   *
   * Раньше выход ставил точку взгляда перед камерой там, где она оказалась,
   * чтобы переключатель не дёргал зрителя туда, откуда он ушёл. Но тогда из
   * полёта в «Вокруг» зритель оставался в чужом углу сцены, а вернуть вид
   * можно было только заново. Теперь полёт — вылазка: орбита (`orbit`) за
   * него не меняется — ни углы полёта, ни клавиши её не трогают, — и выход
   * плавно перелетает на неё. Перелёт идёт по ходу окна (`elapsed`), как и
   * всё остальное в `step`.
   */
  const homeTrip = createReturnTrip();
  let homeward = null;

  function flyHomeToOrbit() {
    const fromPosition = camera.position.clone();
    const fromQuaternion = camera.quaternion.clone();
    applyOrbit();
    const toPosition = camera.position.clone();
    const toQuaternion = camera.quaternion.clone();
    const travel =
      fromPosition.distanceTo(toPosition) +
      orbit.radius * 0.25 * fromQuaternion.angleTo(toQuaternion);
    if (!homeTrip.begin(returnSeconds(travel, orbit.radius * 1.5), elapsed * 1000)) {
      return;
    }
    camera.position.copy(fromPosition);
    camera.quaternion.copy(fromQuaternion);
    homeward = { fromPosition, toPosition, fromQuaternion, toQuaternion };
  }

  function stepHomeward() {
    const k = homeTrip.progress(elapsed * 1000);
    if (k === null || k >= 1) {
      homeward = null;
      applyOrbit();
      updateAnimated();
    } else {
      camera.position.lerpVectors(
        homeward.fromPosition,
        homeward.toPosition,
        k,
      );
      camera.quaternion.slerpQuaternions(
        homeward.fromQuaternion,
        homeward.toQuaternion,
        k,
      );
    }
    dirty = true;
  }

  /* Руку положили на камеру посреди перелёта: он кончается сразу — камера
     уже на орбите и слушается руки, а не борется с перелётом за кадр. */
  function settleHome() {
    if (!homeward) return;
    homeward = null;
    homeTrip.cancel();
    applyOrbit();
    updateAnimated();
    dirty = true;
  }

  function applyFly(delta) {
    camera.quaternion.setFromEuler(
      new THREE.Euler(fly.pitch, fly.yaw, 0, "YXZ"),
    );
    const move = new THREE.Vector3();
    if (fly.keys.has("KeyW")) move.z -= 1;
    if (fly.keys.has("KeyS")) move.z += 1;
    if (fly.keys.has("KeyA")) move.x -= 1;
    if (fly.keys.has("KeyD")) move.x += 1;
    if (fly.keys.has("KeyE") || fly.keys.has("Space")) move.y += 1;
    if (fly.keys.has("KeyQ") || fly.keys.has("KeyC") || fly.keys.has("ControlLeft")) move.y -= 1;
    if (move.lengthSq() === 0) return false;
    const boost =
      fly.keys.has("ShiftLeft") || fly.keys.has("ShiftRight") ? FLY_BOOST : 1;
    move.normalize().multiplyScalar(FLY_SPEED * boost * delta);
    /* Подъём и снижение идут по мировой вертикали, а не по взгляду: иначе
       камера, наклонённая к полу, «поднималась» бы вперёд. */
    const lift = move.y;
    move.y = 0;
    move.applyQuaternion(camera.quaternion);
    move.y += lift;
    camera.position.add(move);
    holdInBounds();
    return true;
  }

  /* Смена режима камеры — и по просьбе окна, и от клавиш полёта. */
  function changeMode(next) {
    const wanted = ["orbit", "drive", "static", "fly"].includes(next)
      ? next
      : "orbit";
    if (wanted === mode) return;
    const wasFlying = mode === "fly";
    mode = wanted;
    if (mode === "fly") {
      homeward = null;
      homeTrip.cancel();
      adoptFlyAngles();
      fly.entry = camera.position.clone();
      holdInBounds();
    } else if (wasFlying) {
      fly.keys.clear();
      if (mode !== "drive") flyHomeToOrbit();
    } else if (mode !== "drive") {
      applyOrbit();
    }
    fly.looking = null;
    updateAnimated();
  }

  /*
   * Коробка и пол полёта не пускают дальше, но и не затаскивают (ТЗ 41-А,
   * 20.10.2026: «при WASD камера улетает далеко»): камера, что взлетела снаружи
   * коробки или ниже пола, остаётся там, где стояла, — коробка расширена на эту
   * точку.
   */
  function holdInBounds() {
    const box = fly.bounds;
    const entry = fly.entry;
    const floor = Math.min(
      box ? Math.max(box.min[1], FLY_FLOOR) : FLY_FLOOR,
      entry ? entry.y : Infinity,
    );
    camera.position.y = Math.max(camera.position.y, floor);
    if (!box) return;
    const low = (axis) => Math.min(box.min[axis], entry ? entry.getComponent(axis) : Infinity);
    const high = (axis) => Math.max(box.max[axis], entry ? entry.getComponent(axis) : -Infinity);
    camera.position.x = clamp(camera.position.x, low(0), high(0));
    camera.position.y = Math.min(camera.position.y, high(1));
    camera.position.z = clamp(camera.position.z, low(2), high(2));
  }

  function updateAnimated() {
    /* В полёте кадры идут, только пока держат клавишу: неподвижная камера в
       свободном режиме — это та же неподвижная картинка. */
    animated =
      probe.active ||
      mode === "drive" ||
      fly.keys.size > 0 ||
      Boolean(homeward);
    if (animated) schedule();
  }

  /* ---------- ввод ---------- */

  let dragging = null;
  let watchingKeys = false;
  /* Курсор над кадром: пока он тут, окно отдаёт кадру клавиши полёта. */
  let hovered = false;
  let rightClick = null;

  /*
   * Заявленные указатели.
   *
   * Холст один, а мышью на нём работают двое: окно крутит орбиту, сцена
   * двигает своё содержимое. Рассудить их может только тот, кто знает, попал ли
   * указатель в объект, — то есть сцена. Она и объявляет жест своим через
   * `ctx.claimPointer(event)`, а окно этот указатель дальше не трогает.
   *
   * Заявка живёт по `pointerId`, а не флагом «сейчас кто-то тащит»: пальцев на
   * планшете два, и заявленный первый не должен запрещать орбиту второму.
   *
   * Снимается она на отпускании, и слушатели для этого висят на окне в фазе
   * перехвата, а не на холсте: кнопку отпускают где угодно — за краем холста,
   * за краем окна браузера, — а забытая заявка означала бы холст, на котором
   * орбита больше никогда не заработает. Пока никто ничего не заявлял,
   * слушателей нет вовсе.
   */
  const claimed = new Set();
  let watchingClaims = false;

  const releaseClaim = (event) => {
    if (!claimed.delete(event.pointerId)) return;
    if (claimed.size === 0) watchClaims(false);
  };

  function watchClaims(on) {
    if (typeof window === "undefined" || on === watchingClaims) return;
    watchingClaims = on;
    const method = on ? "addEventListener" : "removeEventListener";
    window[method]("pointerup", releaseClaim, true);
    window[method]("pointercancel", releaseClaim, true);
  }

  function claimPointer(event) {
    if (!event) return;
    claimed.add(event.pointerId);
    watchClaims(true);
    /*
     * Орбита могла начаться раньше заявки, и это норма, а не гонка: слушатели
     * окна заведены до `adapter.mount`, а сцена узнаёт о попадании только в
     * своём обработчике. Поэтому начатый жест здесь же и разбирается — иначе
     * камера поедет со следующим движением мыши, посреди перетаскивания.
     *
     * Захват указателя при этом НЕ снимается: он не про орбиту, а про то,
     * чтобы события доезжали до холста, когда указатель ушёл за его край, —
     * сцене это нужно ровно так же.
     */
    if (dragging?.id === event.pointerId) dragging = null;
  }

  const onPointerDown = (event) => {
    /* ПКМ — тот же осмотр, что и ЛКМ; щелчок ПКМ в полёте — выход из него. */
    if (event.button === 2) rightClick = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    if (event.button !== 0 && event.button !== 2) return;
    /* Заявить указатель сцена может и раньше окна — если подписалась в фазе
       перехвата или просто раньше. Тогда камере тут делать нечего. */
    if (claimed.has(event.pointerId)) return;
    if (mode === "fly") {
      /* Осмотр протяжкой, без захвата мыши: захват браузер вправе не дать, а
         объяснять человеку, почему кадр не поворачивается, нечем. */
      fly.looking = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Указатель уже отпущен — осмотр всё равно работает через окно. */
      }
      return;
    }
    if (mode !== "orbit") return;
    settleHome();
    dragging = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: orbit.yaw,
      pitch: orbit.pitch,
    };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Указатель уже отпущен — вращение всё равно работает через окно. */
    }
  };

  const onPointerMove = (event) => {
    /* Окно открыли под неподвижным курсором: pointerenter мог не прийти. */
    if (event.pointerType !== "touch") hovered = true;
    if (rightClick?.id === event.pointerId) {
      rightClick.moved += Math.abs(event.clientX - rightClick.x) + Math.abs(event.clientY - rightClick.y);
    }
    if (fly.looking?.id === event.pointerId) {
      fly.yaw -= (event.clientX - fly.looking.x) * 0.0042;
      fly.pitch = clamp(
        fly.pitch - (event.clientY - fly.looking.y) * 0.0042,
        -FLY_PITCH_LIMIT,
        FLY_PITCH_LIMIT,
      );
      fly.looking.x = event.clientX;
      fly.looking.y = event.clientY;
      camera.quaternion.setFromEuler(
        new THREE.Euler(fly.pitch, fly.yaw, 0, "YXZ"),
      );
      requestRender();
      return;
    }
    if (!dragging || dragging.id !== event.pointerId) return;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    orbit.yaw = dragging.yaw - ((event.clientX - dragging.x) / width) * 3.4;
    /* Ниже земли камера не опускается: под сценой пусто, и «провалиться»
       орбитой туда легче, чем выбраться обратно. */
    orbit.pitch = clampPitch(
      dragging.pitch + ((event.clientY - dragging.y) / height) * 2.2,
    );
    applyOrbit();
    requestRender();
  };

  const onPointerUp = (event) => {
    if (rightClick?.id === event.pointerId) {
      const click = rightClick.moved < 4 && event.type !== "pointercancel";
      rightClick = null;
      if (click && mode === "fly") {
        changeMode("orbit");
        onCameraMode?.("orbit");
        requestRender();
      }
    }
    if (fly.looking?.id === event.pointerId) {
      fly.looking = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* см. ниже */
      }
      return;
    }
    if (dragging?.id !== event.pointerId) return;
    dragging = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* см. выше */
    }
  };

  const onWheel = (event) => {
    /* В полёте у свободной камеры нет расстояния до цели, и колесу нечего
       менять. Но курсор над сценой — значит, жест сцене: страница под окном
       не уезжает (жалоба 04.10, Т-159). */
    if (mode !== "orbit") {
      event.preventDefault();
      return;
    }
    /* Пока живёт заявленный жест, колесо тоже не наше: сцена крутит им объект
       в руке (интерьер, торговый центр), и подъехавшая заодно камера — то же
       самое вмешательство посреди перетаскивания. Событие не гасится: его
       остановит тот, кто его и просил. */
    if (claimed.size) return;
    event.preventDefault();
    settleHome();
    orbit.radius = clampRadius(orbit.radius * (1 + event.deltaY * 0.0012));
    applyOrbit();
    requestRender();
  };

  /*
   * Клавиши живут на окне, а не на холсте: холст не в фокусе — по нему возят
   * мышью, — и слушатель на нём молчал бы. С 18.10.2026 они слушаются, пока
   * курсор над кадром: W A S D поднимают в полёт сами (без щелчка и без
   * фокуса), а курсор ушёл — все клавиши отпущены. Esc и щелчок ПКМ выводят
   * из полёта домой.
   */
  const onKeyDown = (event) => {
    if (!hovered || isTypingTarget(event.target)) return;
    const action = flyKeyAction(event, { flying: mode === "fly" });
    /* Ctrl+W и Ctrl+Q над кадром — не закрытие окна (меню Electron по умолчанию их выполняет). */
    if (action === "guard") {
      event.preventDefault();
      return;
    }
    if (action === "start") {
      if (mode !== "orbit") return;
      changeMode("fly");
      onCameraMode?.("fly");
    } else if (action === "leave") {
      event.preventDefault();
      event.stopImmediatePropagation();
      changeMode("orbit");
      onCameraMode?.("orbit");
      requestRender();
      return;
    } else if (mode !== "fly" || (action !== "move" && action !== "boost")) {
      return;
    }
    /* Ctrl — вниз, а W A S D с Ctrl в руке — всё те же W A S D: сочетание окну не достаётся. */
    if (event.ctrlKey || event.metaKey || event.altKey || event.code === "Space") event.preventDefault();
    if (fly.keys.has(event.code)) return;
    fly.keys.add(event.code);
    updateAnimated();
  };
  const onKeyUp = (event) => {
    if (!fly.keys.delete(event.code)) return;
    updateAnimated();
  };
  const releaseKeys = () => {
    if (!fly.keys.size) return;
    fly.keys.clear();
    updateAnimated();
  };
  const onEnter = (event) => {
    if (event.pointerType !== "touch") hovered = true;
  };
  const onLeave = () => {
    hovered = false;
    releaseKeys();
  };
  const onContextMenu = (event) => event.preventDefault();

  function watchFlyKeys(on) {
    if (typeof window === "undefined" || on === watchingKeys) return;
    watchingKeys = on;
    const method = on ? "addEventListener" : "removeEventListener";
    window[method]("keydown", onKeyDown);
    window[method]("keyup", onKeyUp);
    window[method]("blur", releaseKeys);
    if (!on) releaseKeys();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  /* Колесо над кадром — приближение: метка для правила `scroll`. */
  markWheel(canvas);
  watchFlyKeys(true);

  /* ---------- размер ---------- */

  /*
   * Размер кадра.
   *
   * Здесь была петля, которая раздувала холст сама себя, и она стоит
   * объяснения целиком, потому что выглядит безобидно.
   *
   * Размер снимается с контейнера. Если холсту не задать размер в CSS, браузер
   * раскладывает его по атрибутному размеру — а атрибутный размер это размер
   * буфера, то есть измеренная величина, умноженная на плотность пикселей.
   * Контейнер, высота которого считается по содержимому, получает эту величину
   * обратно, следующий замер читает её как новую высоту — и на плотности 1.25
   * холст растёт в 1.25 раза за проход. Тридцать проходов — и это 2193×15122.
   * Крутить петлю есть кому и без нас: за контейнером следит ResizeObserver.
   *
   * Отсюда три вещи. Холст получает размер в CSS-пикселях (`updateStyle`), а
   * не только буфер, — иначе плотность попадает в вёрстку. Холст объявлен
   * блочным прямо в JS, а не в листе стилей, — строчный элемент добавляет
   * контейнеру несколько пикселей на нижнее выносное поле, и петля идёт уже
   * без всякой плотности, по пять пикселей за проход. И совпавший размер не
   * трогает ничего: без этого любое дрожание в полпикселя расходится.
   */
  function resize() {
    const width = surfaceLimit(host.clientWidth, window.innerWidth, 1280);
    const height = surfaceLimit(host.clientHeight, window.innerHeight, 720);
    if (width === measured[0] && height === measured[1]) return;
    measured = [width, height];
    renderer.setSize(width, height, true);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          resize();
          requestRender();
        })
      : null;
  resizeObserver?.observe(host);

  /* ---------- видимость ---------- */

  function setOnScreen(next) {
    if (onScreen === next) return;
    onScreen = next;
    if (!onScreen) stop();
    else {
      /* Пока окно было за краем экрана, могли смениться час и погода — кадр,
         который человек увидит первым, обязан быть свежим. */
      dirty = true;
      schedule();
    }
  }

  const intersection =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) setOnScreen(entry.isIntersecting);
          },
          { threshold: 0 },
        )
      : null;
  /* Наблюдателя может не быть (старый вебвью, тестовая среда) — тогда окно
     считается видимым: лучше лишний кадр, чем чёрный прямоугольник. */
  intersection?.observe(host);

  const onVisibilityChange = () => {
    tabVisible = document.visibilityState !== "hidden";
    if (!tabVisible) stop();
    else {
      dirty = true;
      schedule();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  /*
   * Внимание. Уход его ничего не отменяет: кадр, который уже в пути, мог
   * нести изменение и дорисуется, а дальше `tick` просто не продолжит
   * анимацию. Возврат — свежий кадр, и часы стартуют с нуля, как после
   * скрытой вкладки: иначе первый шаг проезда взял бы время, проведённое в
   * фоне.
   */
  const stopAttention = subscribeAttention(() => {
    const next = attentionAllowsMotion();
    if (next === attentive) return;
    attentive = next;
    if (!attentive) return;
    last = 0;
    dirty = true;
    schedule();
  });

  /* ---------- цикл кадров ---------- */

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    running = false;
    /* Время «замораживается»: иначе после возвращения из скрытой вкладки
       первый же кадр получит дельту в минуты и увезёт проезд за горизонт. */
    last = 0;
  }

  function schedule() {
    if (disposed || running || !onScreen || !tabVisible) return;
    /* Без внимания — только кадр по требованию, не анимация. */
    if (!dirty && !attentive) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  function requestRender() {
    if (disposed) return;
    dirty = true;
    schedule();
  }

  /* ---------- постобработка кадра ---------- */

  /*
   * Хук готового кадра.
   *
   * Экранный эффект игры — вспышка после убийства, ночной фильтр, кровь по
   * краям — принадлежит не сцене, а кадру: он одинаково ложится и на дорогу, и
   * на арену, и на то, что окно покажет завтра. Поэтому он вклинивается здесь,
   * между отрисовкой и глазами, а не отдельным переходником внутрь сцены.
   *
   * Место одно и выбрано не наугад — сразу после `renderer.render`, — и на то
   * три причины, каждая написана по случившейся поломке.
   *
   * 1. Кадр здесь УЖЕ СВЕДЁН: плёночная кривая применена, цвет переведён в
   *    sRGB и лежит в 0…1. Это ровно та же ловушка, что с туманом (см.
   *    `applyLighting` и шапку `PreviewWindow.jsx`): всё, что стоит до
   *    сведения, живёт в линейном HDR, где полуденное небо уходит за тридцать.
   *    Экранная заливка «половина непрозрачности поверх кадра», подмешанная
   *    туда, не видна вовсе, а число из HDR, подмешанное в сведённый кадр,
   *    упирает его в белое. Хук получает то же, что видит человек, и считает в
   *    тех же числах — иначе настроенный эффект врал бы про игру.
   *
   * 2. Кадр здесь ЕЩЁ ЕСТЬ. Буфер рисования WebGL живёт до того, как браузер
   *    покажет его на экране, а показывает он в конце задачи. Хук, отложенный
   *    хоть на кадр анимации, прочитал бы уже очищенный буфер — то есть чёрный
   *    прямоугольник вместо сцены. Отсюда же синхронный вызов, а не промис.
   *
   * 3. Место ОДНО на все способы получить кадр: и цикл, и снятый вручную
   *    `renderFrame` проходят через `present`. Два вызова на один кадр — это
   *    дважды наложенная виньетка и вдвое плотнее зерно; ноль вызовов в снятом
   *    кадре — это снимок для витрины без того эффекта, ради которого снимали.
   *
   * Рисует хук не в холст сцены, а в накладку поверх него: второго контекста на
   * холсте WebGL не завести, а нужен здесь именно 2D — им рисуют экранные
   * эффекты и превью карточек, и он умеет читать холст сцены как картинку.
   *
   * Цена без хука — одна проверка на кадр: накладки нет в разметке вовсе, и
   * гейт видимости не трогается ни на строку. Ноль кадров — ноль вызовов хука.
   */

  let postProcess =
    typeof postProcessHook === "function" ? postProcessHook : null;
  let overlay = null;
  let overlayContext = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = (host.ownerDocument || globalThis.document).createElement(
      "canvas",
    );
    overlay.className = "preview-window-overlay";
    overlay.setAttribute("aria-hidden", "true");
    /*
     * Раскладка задаётся здесь, а не только в листе стилей, и это не
     * перестраховка. Накладка лежит в том же контейнере, по которому меряется
     * размер кадра, — второй холст В ПОТОКЕ удвоил бы его высоту, и замер
     * начал бы кормить сам себя ровно так, как описано в `resize`. Окно
     * поднимают и в стенде, и в тесте, где листа стилей нет вовсе.
     */
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.display = "block";
    /* Мышь остаётся у сцены: орбита и колесо висят на холсте под накладкой. */
    overlay.style.pointerEvents = "none";
    host.append(overlay);
    /* В среде без 2D-контекста (jsdom) накладка остаётся пустой: окно от этого
       не ломается, просто эффекта в кадре нет. */
    overlayContext = overlay.getContext?.("2d") || null;
    return overlay;
  }

  function releaseOverlay() {
    overlay?.remove();
    overlay = null;
    overlayContext = null;
  }

  function paintOverlay() {
    const [width, height] = measured;
    if (!width || !height) return;
    const surface = ensureOverlay();
    if (!overlayContext) return;

    /* Накладка повторяет холст сцены по обоим размерам: буфер — чтобы копия
       кадра шла пиксель в пиксель, размер на экране — чтобы плотность не
       попала в вёрстку (та же причина, что и у `resize`). */
    const ratio = renderer.getPixelRatio?.() ?? 1;
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);
    if (surface.width !== bufferWidth || surface.height !== bufferHeight) {
      surface.width = bufferWidth;
      surface.height = bufferHeight;
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
    }

    overlayContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    /* Чистим за хука сами: хук, который ничего не нарисовал, обязан означать
       «кадр как есть», а не «кадр от прошлого раза поверх живой сцены». */
    overlayContext.clearRect(0, 0, width, height);

    try {
      postProcess({
        /* Сведённый кадр как картинка: `drawImage` берёт холст сцены прямо
           отсюда, пока буфер не очищен браузером (см. причину 2 выше). */
        source: canvas,
        context: overlayContext,
        canvas: surface,
        width,
        height,
        deltaSeconds: lastDelta,
        elapsedSeconds: elapsed,
        timeOfDay: lighting.hour,
        lighting,
      });
    } catch (error) {
      /* Хука зовут шестьдесят раз в секунду: бросивший на первом кадре бросит
         и на всех остальных, а исключение из `requestAnimationFrame` обрывает
         цикл — окно замерло бы целиком. Снимаем хук и рисуем дальше без него:
         сломанный эффект не повод погасить сцену. */
      postProcess = null;
      releaseOverlay();
      console.error("Постобработка окна предпросмотра сломалась", error);
    }
  }

  function setPostProcess(next) {
    const hook = typeof next === "function" ? next : null;
    if (hook === postProcess) return;
    postProcess = hook;
    /* Снятый хук уносит накладку с собой: оставленная, она держала бы последний
       обработанный кадр поверх живой сцены. Просить кадр при этом не надо — под
       накладкой всё это время лежал настоящий. */
    if (hook) requestRender();
    else releaseOverlay();
  }

  /*
   * Шаг обновления — одно место на все способы получить кадр.
   *
   * Раньше он жил внутри `tick`, и синхронный кадр его не проходил: камера
   * проезда стояла на месте, а фары, которые редактор зажигает в `update`,
   * не зажигались вовсе — ночная дорога снималась без единого источника
   * света, ради которого ночной проход и делают. Кадр без шага — это кадр
   * не той сцены, поэтому шаг вынесен сюда, и мимо него не проходит никто.
   */
  function step(delta) {
    elapsed += delta;
    lastDelta = delta;

    if (mode === "drive") {
      applyDrive(delta);
      dirty = true;
    } else if (mode === "fly" && applyFly(delta)) {
      dirty = true;
    }
    if (homeward) stepHomeward();
    /* Замер меряет настоящую отрисовку, а не пустые проходы цикла: иначе
       «авто» выберет качество по скорости, с которой окно ничего не делает. */
    if (probe.active) dirty = true;

    adapter?.update?.(context, {
      timeOfDay: lighting.hour,
      sky: lighting.sky,
      lighting,
      /* Множитель для собственного света закрытой сцены. Считает его окно,
         потому что диапазон экспозиции знает только оно; сцене остаётся
         умножить на него свои лампы. См. `interiorGainFor`. */
      interiorGain: lighting.interiorGain,
      deltaSeconds: delta,
      elapsedSeconds: elapsed,
    });
  }

  /*
   * Кадр наружу — единственное место, где сцена попадает в буфер.
   *
   * Отдельной функцией, а не двумя вызовами `renderer.render`, потому что
   * ровно здесь висит хук постобработки: он обязан отработать по разу на
   * каждый нарисованный кадр — и на кадр из цикла, и на снятый вручную.
   */
  function present() {
    renderer.render(scene, camera);
    dirty = false;
    renders += 1;
    if (postProcess) paintOverlay();
  }

  /*
   * Первый кадр сцены ждёт сборки программ. Сцену — дорогу, здание, зал —
   * собирает редактор при создании окна, и без прогрева её шейдеры
   * собирались бы прямо в первом `renderer.render`: окно стояло на сборке
   * (на Windows компилятор Direct3D работает на процессоре). Программы уходят
   * параллельному компилятору, а кадр рисуется по его ответу (`onReady` просит
   * кадр). Синхронный кадр (`renderFrame`) ждать не умеет и идёт сразу.
   * Дальнейшие изменения сцены прогрева не просят: они мелкие.
   */
  let warmStarted = false;
  const warmup = createSceneWarmup({
    renderer,
    scene,
    camera,
    alive: () => !disposed,
    onReady: () => requestRender(),
  });

  /** Синхронный кадр в обход цикла и проверок видимости. См. `renderFrame`. */
  function renderFrame({ deltaSeconds = NOMINAL_DELTA } = {}) {
    if (disposed) return false;
    resize();
    /*
     * Номинальная дельта, а не ноль: снимающий кадры не имеет часов сцены, а
     * нулевой шаг оставил бы проезд стоять на месте — тридцать снимков подряд
     * получились бы одним и тем же кадром с одной и той же точки.
     */
    step(clamp(Number(deltaSeconds) || 0, 0, 0.1));
    present();
    return true;
  }

  function tick(now) {
    raf = 0;
    running = false;
    if (disposed) return;
    if (!onScreen || !tabVisible) return;

    const delta = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
    last = now;
    step(delta);

    if (dirty && !warmup.ready) {
      if (!warmStarted) {
        warmStarted = true;
        warmup.warm();
      }
      /* Кадр попросит `onReady`; пустые проходы цикла не нужны. */
      last = 0;
      return;
    }
    if (dirty) {
      present();
      if (delta > 0) {
        recent.push(delta * 1000);
        if (recent.length > 60) recent.shift();
        if (probe.active) {
          if (!probe.startedAt) probe.startedAt = now;
          probe.frames.push(delta * 1000);
          if (
            probe.frames.length >= PROBE_FRAMES ||
            now - probe.startedAt > PROBE_TIMEOUT_MS
          ) {
            finishProbe();
          }
        }
      }
      /* Замеры наверх отдаются раз в полсекунды: они уходят в состояние React,
         а перерисовывать интерфейс шестьдесят раз в секунду ради двух цифр —
         это ровно та работа, от которой избавляет весь остальной файл. */
      if (onFrame && now - reportedAt > 500) {
        reportedAt = now;
        onFrame(metrics());
      }
    }

    if ((animated && attentive) || dirty) schedule();
  }

  /* ---------- контекст сцены ---------- */

  /*
   * Набор покрытий уходит редактору в обёртке. Текстура из игры доезжает
   * асинхронно, а окно рисует по требованию — без просьбы о кадре покрытие
   * останется базовым цветом до первого движения мыши. Обёртка просит кадр
   * сама, чтобы об этом не пришлось помнить каждому редактору по отдельности.
   */
  const withRender = (method) =>
    method &&
    ((id, settings = {}) =>
      method(id, {
        ...settings,
        onLoad: (texture) => {
          settings.onLoad?.(texture);
          requestRender();
        },
      }));

  const boundAssets = assets && {
    ...assets,
    texture: withRender(assets.texture?.bind(assets)),
    normalTexture: withRender(assets.normalTexture?.bind(assets)),
  };

  const context = {
    THREE,
    scene,
    camera,
    renderer,
    sun,
    ambient,
    fog,
    assets: boundAssets,
    /* Свойство, а не значение: качество меняется на живом окне (замер в режиме
       «авто», переключатель в редакторе), и снятая один раз копия соврала бы
       ровно там, где по ней и принимают решения — при сборке геометрии. */
    get quality() {
      return level;
    },
    /** Кадр по требованию: без него редактор не может показать свою правку. */
    requestRender,
    /**
     * Нарисовать кадр прямо сейчас, не дожидаясь цикла и не спрашивая про
     * видимость. Прогоняет полный шаг: `update` переходника и продвижение
     * проезда — на номинальные 1/60 секунды либо на `deltaSeconds`, если шаг
     * задан явно.
     *
     * Нужен там, где кадр — это результат, а не картинка на экране: снимок для
     * витрины мода, кадр для стенда, проверка в тесте. Обычный `requestRender`
     * в таких местах честно ничего не рисует — окна на экране нет, — и
     * вызывающему приходится подменять `visibilityState` и `rAF`. Это дешевле
     * отдать одним методом, чем чинить в каждом потребителе.
     */
    renderFrame,
    /**
     * Обработчик готового кадра — постобработка окна. Подробно, вместе с
     * причинами места, — в разделе «постобработка кадра» выше.
     *
     * Хук получает `{ source, context, canvas, width, height, deltaSeconds,
     * elapsedSeconds, timeOfDay, lighting }`: `source` — холст сцены со
     * сведённым кадром, `context` — 2D-контекст накладки поверх него,
     * размеры — в CSS-пикселях. Нарисованное в накладке и есть кадр, который
     * увидит человек; не нарисовавший ничего хук оставляет кадр как есть.
     *
     * `null` снимает хук и убирает накладку. Хук ничего не просит и ничего не
     * заводит: пока окна не видно, кадров нет — значит, нет и вызовов.
     */
    setPostProcess,
    /**
     * Размер коробки теней в метрах — половина стороны. Задаёт тот, кто знает
     * масштаб сцены; по умолчанию семьдесят метров.
     */
    setShadowExtent(radius) {
      shadowExtent = clamp(Number(radius) || 70, 4, 600);
      applyShadowExtent(shadowExtent);
      applyLighting();
      requestRender();
    },
    /**
     * По чему выставлять экспозицию.
     *
     * `sky` (по умолчанию) — по небу: улица, дорога, всё под открытым небом.
     *
     * `enclosed` — по рассеянному свету: зал, интерьер, всё, куда солнце не
     * достаёт. `fixed` со `stops` — когда сцену освещают её собственные лампы
     * и правильное число знает только редактор. `bias` — поправка «для глаз»
     * поверх любого режима.
     */
    setExposure({ mode: next, stops, bias } = {}) {
      if (next) exposure.mode = next;
      if (Number.isFinite(stops)) exposure.stops = stops;
      if (Number.isFinite(bias)) exposure.bias = bias;
      recomputeLighting();
      requestRender();
    },
    /**
     * Базовая дальность тумана сцены — её задаёт тот, кто знает масштаб мира:
     * у арены он сто метров, у дороги несколько сотен. Таймцикл потом гоняет
     * эту дальность по погоде и времени суток.
     */
    setFogRange(near, far) {
      fogRange = [Math.max(near, 0.1), Math.max(far, near + 1)];
      applyLighting();
    },
    /**
     * «Этот жест мой» — сцена забирает указатель у орбиты.
     *
     * Зовётся из обработчика сцены, когда та разобрала попадание: щёлкнули по
     * объекту, а не по пустому полу. Окно пропускает такой указатель ЦЕЛИКОМ —
     * нажатие, протяжку, отпускание и колесо, — а не только то событие, что
     * передали: иначе камера дёрнулась бы на середине перетаскивания.
     *
     * Порядок подписки при этом ничего не решает. Слушатели окна заведены на
     * холсте до `adapter.mount`, и раньше сцена не могла их опередить — отсюда
     * и брались перехваты на документе. Теперь начатую орбиту заявка разбирает
     * задним числом, поэтому заявить можно когда угодно: и до окна, и после.
     *
     * Что заявка НЕ делает: не трогает событие. Останавливать его дальше по
     * дереву — дело сцены, окну для своей орбиты этого не нужно.
     *
     * Ничего не заявившая сцена не замечает разницы: орбита у неё работает
     * ровно как раньше.
     */
    claimPointer,
    /**
     * Орбита: во что смотреть, с какого расстояния и в каких пределах.
     *
     * Действует и в режиме `static` — там это просто орбита, которую нельзя
     * покрутить мышью. Иначе редактор, поставивший неподвижную камеру, получал
     * бы её из настроек по умолчанию и не мог бы прицелиться вообще ничем.
     *
     * `minRadius`/`maxRadius` и `minPitch`/`maxPitch` — пределы, внутри которых
     * камеру держат колесо и протяжка. Нужны закрытым сценам: у зала под
     * крышей отъезд колесом на шестьсот метров выносит зрителя наружу сквозь
     * стену, и без предела каждый интерьер вынужден заново писать возврат
     * камеры в своём `update`. Пределы не заданы — поведение прежнее.
     */
    setOrbit({
      target,
      radius,
      yaw,
      pitch,
      minRadius,
      maxRadius,
      minPitch,
      maxPitch,
    } = {}) {
      homeward = null;
      homeTrip.cancel();
      if (target) orbit.target.set(target[0], target[1], target[2]);

      /* Пределы применяются раньше значений: сцена вправе одним вызовом и
         сузить диапазон, и поставить расстояние внутри него. */
      if (Number.isFinite(minRadius)) {
        orbit.minRadius = clamp(minRadius, ...ORBIT_BOUNDS.radius);
      }
      if (Number.isFinite(maxRadius)) {
        orbit.maxRadius = clamp(maxRadius, ...ORBIT_BOUNDS.radius);
      }
      if (Number.isFinite(minPitch)) {
        orbit.minPitch = clamp(minPitch, ...ORBIT_BOUNDS.pitch);
      }
      if (Number.isFinite(maxPitch)) {
        orbit.maxPitch = clamp(maxPitch, ...ORBIT_BOUNDS.pitch);
      }
      /* Перепутанные местами пределы не должны запирать камеру: верхний край
         подтягивается к нижнему, а не наоборот, — иначе опечатка в одном числе
         молча раздвинула бы диапазон вместо того, чтобы его сузить. */
      if (orbit.maxRadius < orbit.minRadius) orbit.maxRadius = orbit.minRadius;
      if (orbit.maxPitch < orbit.minPitch) orbit.maxPitch = orbit.minPitch;

      if (Number.isFinite(radius)) orbit.radius = radius;
      if (Number.isFinite(yaw)) orbit.yaw = yaw;
      if (Number.isFinite(pitch)) orbit.pitch = pitch;

      /* Текущее положение подтягивается в действующие пределы всегда, а не
         только когда его меняли этим же вызовом: сцена могла сузить диапазон
         после того, как человек уже отъехал колесом. */
      orbit.radius = clampRadius(orbit.radius);
      orbit.pitch = clampPitch(orbit.pitch);

      if (mode !== "drive") applyOrbit();
      requestRender();
    },
    /**
     * Коробка полёта: куда камеру пускают в свободном режиме.
     *
     * Задаёт её сцена, потому что стены знает только она. Без коробки камера
     * держится над полом, а наружу выходит свободно — за стеной у закрытой
     * сцены видны изнанки мешей, и сказать об этом честнее, чем делать вид,
     * будто стены её останавливают.
     *
     * `null` снимает ограничение.
     */
    setFlyBounds(box) {
      if (!box) {
        fly.bounds = null;
        return;
      }
      const min = box.min || [];
      const max = box.max || [];
      if (min.length !== 3 || max.length !== 3) return;
      fly.bounds = {
        min: min.map((value, index) => Math.min(value, max[index])),
        max: max.map((value, index) => Math.max(value, min[index])),
      };
      if (mode === "fly") {
        holdInBounds();
        requestRender();
      }
    },
    /** Маршрут проезда: откуда, куда и с какой скоростью. */
    setDriveTrack({ from, to, speed } = {}) {
      if (from) drive.from.set(from[0], from[1], from[2]);
      if (to) drive.to.set(to[0], to[1], to[2]);
      if (Number.isFinite(speed)) drive.speed = clamp(speed, 0.5, 90);
      requestRender();
    },
  };

  function metrics() {
    const sorted = [...recent].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return {
      quality: level,
      requested,
      fps: median ? Math.round(1000 / median) : 0,
      frameMs: Number(median.toFixed(2)),
      renders,
      pixelRatio: renderer.getPixelRatio?.() ?? 1,
      shadows: Boolean(renderer.shadowMap?.enabled),
      probing: probe.active,
      assetSource: assets?.source || "fallback",
    };
  }

  /* ---------- запуск ---------- */

  applyShadowExtent(shadowExtent);
  applyQuality(level);
  applyLighting();
  applyOrbit();
  /* Окно, поставленное сразу в полёт, обязано и подписаться на клавиши, и
     взять углы у камеры: `setCameraMode` до него ещё не дойдёт — режим уже
     тот, что просили. */
  if (mode === "fly") {
    adoptFlyAngles();
    holdInBounds();
  }

  /*
   * Всё, что переходник добавит в сцену, окно освободит при закрытии — включая
   * геометрию и материалы. Поэтому переходник обязан создавать их внутри
   * `mount`, а не держать общими между окнами: общая геометрия, освобождённая
   * первым закрытым окном, оставит второе с пустым буфером вершин.
   */
  try {
    adapter?.mount?.(context);
  } catch (error) {
    /* Сломанный редактор не должен утащить за собой окно: сцена уже поднята,
       небо и свет покажутся и без его содержимого. */
    stop();
    throw error;
  }

  updateAnimated();
  schedule();

  return {
    context,
    metrics,
    requestRender,
    renderFrame,
    setPostProcess,
    setTime(
      nextTimeOfDay,
      nextWeather = clock.weather,
      nextRegion = clock.region,
    ) {
      clock = {
        timeOfDay: nextTimeOfDay,
        weather: nextWeather,
        region: nextRegion,
      };
      recomputeLighting();
      schedule();
    },
    setQuality(next) {
      requested = next;
      if (next === "auto") {
        /* Повторный замер: качество могло быть выставлено руками, а машина —
           смениться (ноутбук ушёл с розетки, окно переехало на второй экран). */
        probe.active = true;
        probe.frames = [];
        probe.startedAt = 0;
        updateAnimated();
        return;
      }
      probe.active = false;
      applyQuality(next);
      updateAnimated();
      schedule();
    },
    /**
     * Режим камеры: орбита, проезд, неподвижная или полёт.
     *
     * Вход в полёт берёт углы у камеры там, где она видна сейчас (в том числе
     * посреди перелёта домой), а выход плавно возвращает её на орбиту, с
     * которой взлетели. Из проезда орбита сама ставит камеру каждый шаг.
     */
    setCameraMode(next) {
      changeMode(next);
      updateAnimated();
      requestRender();
    },
    get lighting() {
      return lighting;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      warmup.stop();
      stopAttention();
      resizeObserver?.disconnect();
      intersection?.disconnect();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      /* Клавиши полёта висят на окне и сами бы не снялись: редактор закрывают
         и в полёте. */
      watchFlyKeys(false);
      /* Заявки уходят вместе с окном: их слушатели висят не на холсте, и сами
         собой они бы не снялись — окно закрывают и посреди перетаскивания. */
      watchClaims(false);
      claimed.clear();

      try {
        adapter?.dispose?.();
      } catch {
        /* Уборка редактора не должна помешать уборке видеопамяти — она
           дороже, и без неё десяток открытий окна кончается вылетом. */
      }

      scene.remove(dome.object);
      dome.dispose();
      disposeSubtree(scene);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      assets?.dispose?.();
      renderer.dispose();
      /* Браузер держит контекст WebGL живым, пока на него ссылается холст.
         Их всего десяток на вкладку, а редакторов в мастерской больше. */
      renderer.forceContextLoss?.();
      canvas.remove();
      /* Накладка уходит вместе с холстом: она лежит в том же контейнере, и
         оставленная — это последний кадр эффекта, застывший на пустом месте. */
      postProcess = null;
      releaseOverlay();
    },
  };
}
