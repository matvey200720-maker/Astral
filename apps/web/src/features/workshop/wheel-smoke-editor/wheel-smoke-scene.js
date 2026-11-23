/*
 * Кадр «Дыма из-под колёс»: машина на матовом полу, и из-под её колёс идёт
 * дым — тот самый, что уедет в игру.
 *
 * Дым — не рисунок. Это правила частиц ядра игрока (`wheel_burnout`,
 * `wheel_fric_hard`, искры обода, пламя колеса — выгрузка помощника из
 * `readWheelSmokeBase`), а у своей работы — их клоны, собранные тем же
 * заказом, что уйдёт установщику (`compileWheelSmoke` → `buildEffectClone`),
 * и проигранные движком RMPTFX окна (`ptfx-renderer.js`). Листы — из ядра
 * игрока; звёзды и сердечки — лист `wheelGlyphSheet`, те же пиксели, что
 * лягут в ядро. Без базы игры дыма в кадре нет вовсе — подпись это говорит.
 *
 * Два вида движения, как в игре играют два правила:
 *   • «Пробуксовка» (`burnout`) — машина стоит, задние колёса крутятся на
 *     месте, стоп-сигнал горит: правило прожига у задних колёс, дым уходит
 *     назад и стелется за машиной;
 *   • «Дрифт» (`drift`) — машина идёт боком (нос левее хода, контрруль), и
 *     пол едет под ней назад со скоростью хода: дым, уже рождённый в мире,
 *     уезжает вместе с полом, и за машиной ложится шлейф (владелец,
 *     11.10.2026: «чтобы дым отлетал назад автомобиля, а не под машиной
 *     дымелся»).
 *
 *   • «Воздушный пакет» (`slipstream`) — машина идёт на скорости: пол и
 *     рождённые частицы едут назад, как у дрифта, а от носа машины тянутся
 *     полосы воздуха (ленты `veh_slipstream`). Правило в игре стоит на
 *     едущей за чужой машиной; где именно на ней — не сверено.
 *
 * Эволюции — числа, которые игра даёт правилу у колеса. Подобраны по
 * правилам игрока (прогон в Node): у прожига дым густеет с трением, а
 * виден, только пока шина горячая (`temp`: оттенок правила прозрачен, пока
 * её нет), и тает с ростом скорости машины (`speed`); у трения дым рождают
 * `spin` и `speed`.
 *
 * Матрица эффекта у колеса: ось Y — назад от машины (туда земля уходит из-
 * под колеса), ось Z — в землю, точка — за пятном шины, низко. Подобрана по
 * правилам доноров (прогон в Node, четыре варианта): только в ней живут все
 * части прожига — столб и «висящий» дым уходят на 2–5 м назад, низкий туман
 * не проваливается под пол, — а искры обода летят назад по земле, как у
 * обода без шины. С осью Z вверх столб и туман рождались под полом и гасли,
 * с осью Y вверх дым и искры били в арку колеса. В игре не сверено.
 *
 * Камера — общая на всю мастерскую (`stage-camera.js`): ЛКМ — вокруг,
 * щелчок ПКМ — полёт, колесо — ближе и дальше, двойной щелчок — вид.
 * Цикл кадров — только пока кадр на экране (`start`/`stop` от ворот
 * внимания) и не чаще 60 кадров в секунду.
 */

import {
  EffectInstance,
  buildEffectClone,
  effectFrame,
  loadModel,
  modelBatches,
  spriteBatches,
  trailBatches,
} from "@modovik/ptfx-runtime";
import {
  WHEEL_GLYPHS,
  WHEEL_SMOKE_EXHAUST,
  WHEEL_SMOKE_EXHAUST_GROUPS,
  WHEEL_SMOKE_SLIPSTREAM,
  WHEEL_SMOKE_TARGETS,
  compileWheelSmoke,
  normalizeWheelSmokeProject,
  wheelGlyphSheet,
} from "@modovik/ptfx-studio/wheel-smoke.js";
import { MATTE_FLOOR_FRAGMENT, filmicUniforms, matteFloorUniforms } from "../../../components/desktop/workshop/ptfx/matte-floor.js";
import { sceneLighting } from "../../../components/desktop/workshop/ptfx/ptfx-lighting.js";
import { createPtfxRenderer } from "../../../components/desktop/workshop/ptfx/ptfx-renderer.js";
import { createTextureBank } from "../../../components/desktop/workshop/ptfx/ptfx-textures.js";
import { createStageCamera } from "../model-stage/stage-camera.js";
import { carExhaust, carPaint, carWheels, createWheelSmokeCar, gameCarAsset } from "./wheel-smoke-car.js";

/*
 * Что играет в кадре: дым у колёс («Пробуксовка», «Дрифт») или огонь у
 * выхлопной трубы («Задний огонь», «Хлопки»). Машина у огня стоит, труба —
 * кость `exhaust` модели, огонь вспыхивает через равные промежутки, как
 * при сбросе газа.
 */
export const WHEEL_SMOKE_MODES = Object.freeze(["burnout", "drift", "backfire", "misfire", "slipstream"]);
const EXHAUST_MODES = Object.freeze(["backfire", "misfire"]);
export const isExhaustMode = (mode) => EXHAUST_MODES.includes(mode);
/* Между вспышками огня: пока играет, потом пауза в секундах. */
const EXHAUST_GAP = 1.1;

/* Колёса, у которых играет дым: задние — ведущие у дрифт-машины (и у запасных колёс). */
const SMOKING_WHEELS = Object.freeze(["lr", "rr"]);

/*
 * Эволюции правила у колеса. Прожиг: трение полное, шина горячая наполовину
 * (горячее — дыма меньше, но он плотнее; холоднее — дым прозрачный), машина
 * почти стоит. Дрифт: трение полное, колёса крутятся, машина идёт боком.
 */
export const WHEEL_EVOLUTIONS = Object.freeze({
  burnout: Object.freeze({ friction: 1, speed: 0.05, temp: 0.5, bike: 0 }),
  drift: Object.freeze({ friction: 1, speed: 0.6, spin: 1, wet: 0 }),
  /* Огонь выхлопа: у задних правил игра даёт `damage` (побитость двигателя) и `banger` (рыдван) — здоровая машина. */
  backfire: Object.freeze({ damage: 0, banger: 0 }),
  misfire: Object.freeze({}),
  /* Воздушный пакет: игра даёт эволюции `slipstream` силу струи, полную. */
  slipstream: Object.freeze({ slipstream: 1 }),
});

/* Час света частиц: день — серый дым читается на тёмном полу. */
const HOUR = 14;
/* Прогрев перед показом: дым не должен разрастаться с нуля на каждой правке. */
const WARMUP = Object.freeze({ burnout: 3, drift: 4.2, backfire: 0, misfire: 0, slipstream: 2 });
const STEP = 1 / 30;
const MAX_STEP = 0.05;
/* Ползунок шлёт правку на каждый шаг: клоны собираются не чаще этого. */
const REBUILD_MS = 140;
/* Предел частоты идущего кадра (запас 3 мс — как у `stage-loop.js`). */
const FRAME_MS = 1000 / 60 - 3;

/* Пробуксовка: задние колёса на месте крутятся ~2 оборота в секунду. */
const BURNOUT_SPIN = 13;
/*
 * Дрифт: нос машины на `DRIFT_SLIP` рад левее хода (ход — +Y мира),
 * передние колёса — контрруль, задние крутятся быстрее, чем катятся; пол и
 * рождённые частицы едут назад со скоростью `DRIFT_SPEED` (м/с — меньше
 * настоящего дрифта, иначе шлейф не влез бы в кадр).
 */
const DRIFT_SLIP = 0.5;
const DRIFT_SPEED = 4.5;
const DRIFT_STEER = -0.38;
const DRIFT_SPIN = 22;
/*
 * Воздушный пакет: пол и рождённые полосы едут назад со скоростью хода,
 * колёса катятся без проскальзывания. Скорость меньше настоящей: полоса
 * живёт 0,7 с, и при этой скорости её хвост (≈ 8 м, как у правила) помещается в
 * кадр. Эффект — у носа: на `SLIP_NOSE` метров впереди передней оси, на
 * высоте капота.
 */
const SLIP_SPEED = 11;
const SLIP_NOSE = 0.75;
const SLIP_HEIGHT = 0.7;
/*
 * Полосы воздуха у игры бледные: цвет частицы — альфа до 0,16, лист ленты — мягкая
 * полоса с альфой около 0,13 в среднем, то есть около 2 % яркости: на тёмном полу кадра
 * их не разглядеть (в игре их вытягивают экспозиция и блум). Лента в кадре усилена по
 * альфе — частицы и правило те же, подпись об этом говорит.
 */
const SLIP_GAIN = 10;
const SLIP_GLOW = 8;
/* Точка эффекта в осях колеса: за пятном шины на долю радиуса, низко. */
const EMITTER_BACK = 0.6;
const EMITTER_HEIGHT = 0.4;
/* Крупный шаг сетки пола (`matteFloorUniforms`): сдвиг пола — по его модулю. */
const GRID = Object.freeze([0.5, 2.5, 0.42, 8]);
const GRID_REPEAT = GRID[1];

/*
 * Рамки камеры: машина боком справа, чуть сзади, за ней — место под
 * шлейф (владелец, 11.10.2026). Справа — потому что кольцо прожига и туман
 * выбрасывают частицы вдоль оси X эффекта, а она у колеса смотрит вправо
 * от машины. `width` и `height` — сколько метров сцены держать в кадре
 * по ширине и высоте: дальность камеры считается от них и от формы холста,
 * и узкий кадр (окно 1180 точек с панелью справа) не режет машине нос.
 */
const FOV = 38;
const FRAMES = Object.freeze({
  burnout: Object.freeze({ target: [0.5, -2.3, 0.95], width: 9.4, height: 4.2, view: { yaw: 1.42, pitch: 0.2, zoom: 1 } }),
  drift: Object.freeze({ target: [0.6, -2.8, 0.85], width: 10.4, height: 4.6, view: { yaw: 1.4, pitch: 0.26, zoom: 1 } }),
  /* Огонь выхлопа: камера сзади с той стороны, где труба, — труба и вспышка в кадре (цель — по трубе машины, `cameraFrame`). */
  backfire: Object.freeze({ target: [0.3, -2.6, 0.5], width: 3.6, height: 2, view: { yaw: 0.6, pitch: 0.08, zoom: 1 } }),
  misfire: Object.freeze({ target: [0.3, -2.6, 0.5], width: 3.6, height: 2, view: { yaw: 0.6, pitch: 0.08, zoom: 1 } }),
  /* Воздушный пакет: машина боком справа, за ней — место под полосы. */
  slipstream: Object.freeze({ target: [0.3, -2.6, 0.95], width: 11.5, height: 4.4, view: { yaw: 1.5, pitch: 0.2, zoom: 1 } }),
});

/*
 * Рамка камеры вида. У огня выхлопа труба стоит не там, где у запасной
 * машины: камера — сзади с той же стороны, куда выходит труба машины игры
 * (`focus.exhaust`, метры кадра), и смотрит на неё.
 */
function cameraFrame(mode, aspect, focus = {}) {
  const base = FRAMES[mode] || FRAMES.burnout;
  const spec = { ...base };
  if (EXHAUST_MODES.includes(mode) && focus.exhaust) {
    const [x, y, z] = focus.exhaust;
    const side = x >= 0 ? 1 : -1;
    spec.target = [x * 0.7, y - 0.5, z + 0.25];
    /* Сзади, со стороны трубы (орбита: глаз на (sin yaw, −cos yaw) от цели — при нуле строго за машиной): огонь летит назад — на камеру. */
    spec.view = { ...base.view, yaw: side * Math.abs(base.view.yaw) };
  }
  const tanY = Math.tan((FOV * Math.PI) / 360);
  const fit = () => {
    const wide = Math.max(0.2, aspect());
    return Math.max(spec.width / 2 / (tanY * wide), spec.height / 2 / tanY);
  };
  return {
    target: spec.target,
    radius: fit(),
    view: spec.view,
    zoomRange: [0.3, 2],
    pitchRange: [-0.02, 1.25],
    distance: (zoom) => fit() * zoom,
    fov: FOV,
    bounds: { min: [-24, -24, 0.15], max: [24, 24, 14] },
    floor: 0.15,
  };
}

function lightingFor(light, hour = HOUR) {
  const base = sceneLighting({ light, hour });
  /*
 * Порог блума выше игрового (0,4): кадр — студия, и белый кузов под
 * софтбоксом сильно выше 0,4 — блум обводил машину белым ореолом. Светятся
 * по-прежнему фары, стоп-сигналы и светящиеся виды дыма — звёзды, искры, огонь.
 */
  return { ...base, particleExposure: 1, post: { ...base.post, bloomIntensity: 0.26, bloomThreshold: 1.2 } };
}

function seedOf(id, generation) {
  let hash = 0x811c9dc5 ^ generation;
  for (const char of id) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* Лист значка — холстом, один раз на окно: те же пиксели, что у установщика. */
const glyphCanvases = new Map();
function glyphCanvas(glyph) {
  if (glyphCanvases.has(glyph)) return glyphCanvases.get(glyph);
  if (typeof document === "undefined") return null;
  const sheet = wheelGlyphSheet(glyph);
  const canvas = document.createElement("canvas");
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height), 0, 0);
  glyphCanvases.set(glyph, canvas);
  return canvas;
}
const GLYPH_BY_TEXTURE = new Map(Object.entries(WHEEL_GLYPHS).map(([id, item]) => [item.texture, id]));

/**
 * Матрица эффекта у колеса машины с курсом `heading` (рад, машина в начале
 * мира): ось Y — назад от машины, ось Z — в землю (см. шапку), точка — за
 * пятном шины, низко. Владелец (11.10.2026): дым отлетает назад, а не
 * дымится под машиной.
 */
export function wheelEffectFrame(heading, wheel) {
  const [x, y] = wheel.position;
  const radius = wheel.radius || 0.3;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const back = y - radius * EMITTER_BACK;
  return effectFrame({
    origin: [x * cos - back * sin, x * sin + back * cos, radius * EMITTER_HEIGHT],
    z: [0, 0, -1],
    up: [sin, -cos, 0],
  });
}

/**
 * Какое правило играет у колеса: штатное, клон работы или никакое («Без
 * дыма»). Ровно как `compileWheelSmoke` раскладывает столбцы wheelfx.dat:
 * выключенная в «Где» цель остаётся с дымом игры.
 */
export function wheelSmokeEffectFor(project, mode) {
  const compiled = compileWheelSmoke(project);
  /* Воздушный пакет: клон встаёт под штатным именем, в кадре окна — под своим. */
  if (mode === "slipstream") {
    const own = !compiled.slipstreamStock;
    return { name: own ? WHEEL_SMOKE_SLIPSTREAM.clone : WHEEL_SMOKE_SLIPSTREAM.stock, own, compiled };
  }
  /* Огонь выхлопа: правило группы (штатное или клон), по одному на показ. */
  if (isExhaustMode(mode)) {
    const effect = WHEEL_SMOKE_EXHAUST.find((item) => item.id === (mode === "misfire" ? "misfire" : "backfire"));
    const group = WHEEL_SMOKE_EXHAUST_GROUPS.find((item) => item.id === effect.group);
    const own = !compiled.exhaustStock && compiled.project[group.field];
    return { name: own ? effect.clone : effect.stock, own, compiled };
  }
  const target = WHEEL_SMOKE_TARGETS.find((item) => item.id === mode) || WHEEL_SMOKE_TARGETS[0];
  if (compiled.smokeStock || !compiled.project[target.id]) return { name: target.stock, own: false, compiled };
  if (compiled.project.look === "none") return { name: "", own: true, compiled };
  return { name: target.clone, own: true, compiled };
}

/**
 * Сцена на холсте. `onStatus({ failures, effect, particles, car })` — что в
 * кадре и что не собралось; `onCamera(mode, info)` — режим общей камеры.
 * `holdCar` — машину игры читают прямо сейчас (П6.7, 22.10.2026): пока она не пришла, в кадре один матовый пол —
 * колёса Astral без кузова на первые секунды не показываются; не прочиталась — встают они.
 */
export function createWheelSmokeScene({ canvas, onStatus = null, onCamera = null, share = true, holdCar = false }) {
  let hour = HOUR;
  let lighting = lightingFor(null, hour);
  /* `share: false` — свой контекст (обложка полки: снимает кадр до пяти секунд и рендерер окна не держит). */
  const renderer = createPtfxRenderer({ canvas, lighting, share });
  const bank = createTextureBank({
    onReady: () => {
      dirty = true;
      wake();
    },
  });
  let size = { width: 0, height: 0, ratio: 1 };
  let mode = "burnout";
  let project = normalizeWheelSmokeProject({});
  let base = null;
  let model = null;
  let modelKey = "";
  let effectName = "";
  /* Что решает дым в кадре: вид движения, правило и заказ клонов. */
  let projectKey = "";
  let instances = [];
  let failures = [];
  let car = null;
  let carFailure = "";
  let wheels = carWheels(null);
  let exhaust = carExhaust(null);
  /* Габариты машины (рамка кузова, метры кадра): полосы воздуха встают у её носа. */
  let carBounds = { min: [-0.92, -2.17, 0], max: [0.92, 2.04, 1.3] };
  let paint = carPaint("white").colour;
  /* Время движения машины: часы кадра, а не страницы — прогрев их двигает. */
  let clock = 0;
  let generation = 0;
  let running = false;
  let frame = 0;
  let last = 0;
  let drawnAt = Number.NEGATIVE_INFINITY;
  let dirty = true;
  /* Сколько пачек ушло на последнюю отрисовку: спрайты, модели, ленты (стенд и тест). */
  let batches = { sprites: 0, models: 0, trails: 0 };
  let rebuildTimer = 0;
  let stillFrame = 0;
  let disposed = false;
  /* Сдвиг сетки пола в дрифте, м по оси Y мира. */
  let groundOffset = 0;
  /* Форма холста — рамке камеры: дальность подбирается под неё. */
  const aspectOf = () => (size.width && size.height ? size.width / size.height : 16 / 9);

  const eye = createStageCamera({
    camera: renderer.camera,
    canvas,
    up: "z",
    /* Вид камеры переживает спячку окна (`features/hibernation/stage-views.js`). */
    memoryKey: "workshop:wheel-smoke",
    onChange: () => {
      dirty = true;
      wake();
    },
    onKick: () => wake(),
    onMode: (cameraMode, info) => onCamera?.(cameraMode, info),
  });
  const cameraFor = () => cameraFrame(mode, aspectOf, { exhaust });
  eye.setFrame(cameraFor());

  const particleCount = () =>
    instances.reduce((sum, item) => sum + [...item.effect.slots()].reduce((count, slot) => count + slot.particles.length, 0), 0);
  const report = () =>
    onStatus?.({
      failures: [...failures, ...(carFailure ? [carFailure] : [])],
      effect: effectName,
      particles: instances.length ? particleCount() : 0,
      car: Boolean(car),
      carKind,
      base: Boolean(base?.model),
    });

  function applyLighting() {
    renderer.setLighting(lighting);
    renderer.setSceneShader({
      fragmentShader: MATTE_FLOOR_FRAGMENT,
      uniforms: matteFloorUniforms(lighting, { grid: GRID, fade: 24 }),
    });
    car?.setLighting(filmicUniforms(lighting));
    dirty = true;
  }
  applyLighting();

  /* --- Машина --- */

  /*
   * Машина: своя игрока — дрифт-версия из его GTA V (`setCar`), а пока её
   * нет или игры нет — одни колёса Astral. Каждая смена — свой номер:
   * опоздавшая загрузка не ставит старую машину поверх новой.
   */
  let carTicket = 0;
  /* Что в кадре и что едет: `fallback` (колёса без кузова) или `game`. */
  let carKind = "";
  let carWanted = holdCar ? "game" : "";
  /* Машина игры ещё читается: кадр рисует пол без неё и без дыма. */
  let holding = holdCar;
  function mountCar(asset, kind) {
    holding = false;
    car?.dispose();
    car = createWheelSmokeCar(asset, { paint });
    carKind = kind;
    carFailure = "";
    wheels = carWheels(asset);
    exhaust = carExhaust(asset);
    carBounds = asset?.bounds || { min: [-0.92, -2.17, 0], max: [0.92, 2.04, 1.3] };
    /* У огня выхлопа камера смотрит на трубу — а у другой машины она в другом месте. */
    if (isExhaustMode(mode)) eye.setFrame(cameraFor());
    car.setLighting(filmicUniforms(lighting));
    renderer.setSceneObjects([car.object]);
    /* Колёса и труба другой машины — дым и огонь встают заново на её места. */
    if (model) place();
    pose();
    dirty = true;
    report();
    wake();
  }
  function mountFallback() {
    const ticket = ++carTicket;
    carWanted = "fallback";
    /* Следующим шагом, а не сразу: сцена ещё собирается ниже. */
    queueMicrotask(() => {
      if (disposed || ticket !== carTicket) return;
      mountCar(null, "fallback");
    });
  }
  if (!holdCar) mountFallback();

  /* Положение машины на часах `time`: курс, начало, вращение колёс. */
  /* Машина на часах `time`: курс, вращение колёс, руль, стоп-сигнал. Машина
     стоит на месте — в дрифте едет пол. */
  function kinematics(time) {
    if (isExhaustMode(mode)) return { heading: 0, rear: 0, front: 0, steer: 0, brake: 0, shake: 0 };
    if (mode === "slipstream") {
      const roll = (-SLIP_SPEED / (wheels[0]?.radius || 0.3)) * time;
      return { heading: 0, rear: roll, front: roll, steer: 0, brake: 0, shake: 0 };
    }
    if (mode === "drift") {
      const radius = wheels[0]?.radius || 0.3;
      return { heading: DRIFT_SLIP, rear: -DRIFT_SPIN * time, front: (-DRIFT_SPEED / radius) * time, steer: DRIFT_STEER, brake: 0, shake: 0 };
    }
    return { heading: 0, rear: -BURNOUT_SPIN * time, front: 0, steer: 0, brake: 1, shake: time };
  }

  const wheelFrame = (state, wheel) => wheelEffectFrame(state.heading, wheel);
  /*
   * Труба: ось Y эффекта — назад от машины, Z — вверх. Кость `exhaust` у машины
   * игры лежит у глушителя, на ~0,25 м глубже среза трубы (внутри бампера), и огонь,
   * рождённый там, прятался бы за кузовом: точка — у среза, у самой кормы. В игре не сверено.
   */
  const exhaustFrame = () => effectFrame({ origin: [exhaust[0], Math.min(exhaust[1], carBounds.min[1] + 0.06), exhaust[2]], z: [0, 0, 1], up: [0, -1, 0] });
  /*
   * Нос: два края капота — слева и справа, чуть выступая за кузов, на высоте
   * капота; Y эффекта — назад. Полоса из точки на оси машины шла бы внутри кузова
   * и скрывалась им, а так от краёв носа тянутся два следа вдоль бортов.
   */
  const noseFrame = (side) =>
    effectFrame({
      origin: [side * (Math.max(Math.abs(carBounds.min[0]), Math.abs(carBounds.max[0])) + 0.04), carBounds.max[1] - SLIP_NOSE, SLIP_HEIGHT],
      z: [0, 0, 1],
      up: [0, -1, 0],
    });

  /*
   * Дрифт: пол уезжает назад со скоростью хода — и рождённые частицы с ним
   * (они живут в мире, а не на колесе), и сетка пола. Сдвиг сетки — по
   * модулю крупного шага: рисунок тот же, числа не растут.
   */
  function scroll(dt) {
    if (mode !== "drift" && mode !== "slipstream") return;
    const shift = (mode === "drift" ? DRIFT_SPEED : SLIP_SPEED) * dt;
    for (const item of instances)
      for (const slot of item.effect.events) for (const particle of slot.particles) particle.position[1] -= shift;
    groundOffset = (groundOffset + shift) % GRID_REPEAT;
  }

  function pose() {
    if (!car) return;
    const state = kinematics(clock);
    car.setPose([0, 0], state.heading);
    for (const wheel of wheels) {
      const rear = wheel.id.endsWith("r");
      car.setWheel(wheel.id, rear ? state.rear : state.front, rear ? 0 : state.steer);
    }
    /* Пробуксовка: кузов мелко дрожит и чуть приседает на корму. */
    car.setBodyOffset(
      state.shake ? 0.004 * Math.sin(state.shake * 41) + 0.003 * Math.sin(state.shake * 23) : 0,
      state.shake ? 0.01 : 0,
    );
    car.setBrake(state.brake);
  }

  /* --- Дым --- */

  function lodOf() {
    const rule = model?.effects?.get(effectName);
    const { min, max } = rule?.lod || {};
    if (!(max > min)) return 0;
    const camera = renderer.camera.position;
    const distance = Math.hypot(camera.x, camera.y, camera.z - 0.6);
    return Math.min(Math.max((distance - min) / (max - min), 0), 1);
  }

  function evolutions() {
    return { ...WHEEL_EVOLUTIONS[mode], LOD: lodOf() };
  }

  /* Чей кадр у экземпляра: колесо, труба или нос машины. */
  const frameOf = (wheel, state, side) => (wheel ? wheelFrame(state, wheel) : mode === "slipstream" ? noseFrame(side) : exhaustFrame());
  const keyOf = (wheel, side) => wheel?.id || (mode === "slipstream" ? `nose${side}` : "exhaust");

  function newInstance(wheel, state, side = 0) {
    return new EffectInstance(model, effectName, {
      frame: frameOf(wheel, state, side),
      /* Зерно — одно на пересборку: правка цвета не перетасовывает дым. */
      seed: seedOf(`${mode}:${keyOf(wheel, side)}`, generation),
      evolutions: evolutions(),
      ground: 0,
      wind: [0.35, -0.2, 0],
      loop: true,
    });
  }

  /* Шаг движения и дыма на `dt` секунд часов кадра. */
  function advance(dt) {
    clock += dt;
    scroll(dt);
    const state = kinematics(clock);
    const lod = instances.length ? lodOf() : 0;
    for (const item of instances) {
      if (item.wheel) item.effect.frame = wheelFrame(state, item.wheel);
      item.effect.evolutions.LOD = lod;
      item.effect.step(dt);
      if (!item.effect.finished) continue;
      /* Огонь выхлопа вспыхивает с паузой, дым у колеса — без перерыва. */
      if (!item.wheel && mode !== "slipstream") {
        item.idle = (item.idle || 0) + dt;
        if (item.idle < EXHAUST_GAP) continue;
        item.idle = 0;
      }
      item.effect = newInstance(item.wheel, state, item.side);
    }
  }

  /* Экземпляры у задних колёс — заново, с прогревом. */
  function place() {
    instances = [];
    if (model && effectName && model.effects.has(effectName)) {
      try {
        const state = kinematics(clock);
        instances = mode === "slipstream"
          ? [-1, 1].map((side) => ({ wheel: null, side, effect: newInstance(null, state, side) }))
          : isExhaustMode(mode)
            ? [{ wheel: null, side: 0, effect: newInstance(null, state) }]
            : wheels
              .filter((wheel) => SMOKING_WHEELS.includes(wheel.id))
              .map((wheel) => ({ wheel, effect: newInstance(wheel, state) }));
        const warm = WARMUP[mode] || 3;
        clock -= warm;
        for (let time = 0; time < warm; time += STEP) advance(STEP);
      } catch (error) {
        failures.push(String(error?.message || error));
        instances = [];
      }
    }
    pose();
    dirty = true;
    report();
    wake();
  }

  /* Модель правил: штатные доноры и клоны работы — ровно тот заказ, что уйдёт помощнику. */
  function rebuild() {
    rebuildTimer = 0;
    failures = [];
    const choice = wheelSmokeEffectFor(project, mode);
    const exported = base?.model;
    projectKey = `${mode}|${choice.name}|${JSON.stringify(choice.compiled.clones)}`;
    effectName = choice.name;
    if (!exported) {
      model = null;
      modelKey = "";
      place();
      return;
    }
    const key = JSON.stringify(choice.compiled.clones);
    if (key !== modelKey || !model) {
      try {
        const textures = [...(exported.textures || []), ...choice.compiled.textures.map((item) => item.texture)];
        const clones = choice.compiled.clones.map((request) => buildEffectClone({ core: exported }, request, { coreTextures: textures }));
        model = loadModel(exported, ...clones);
        modelKey = key;
      } catch (error) {
        failures.push(String(error?.message || error));
        model = loadModel(exported);
        modelKey = "";
        /* Клон не собрался — в кадре дым игры, а подпись называет отказ. */
        effectName =
          mode === "slipstream"
            ? WHEEL_SMOKE_SLIPSTREAM.stock
            : isExhaustMode(mode)
              ? WHEEL_SMOKE_EXHAUST.find((item) => item.id === (mode === "misfire" ? "misfire" : "backfire"))?.stock || ""
              : WHEEL_SMOKE_TARGETS.find((item) => item.id === mode)?.stock || "";
      }
    }
    if (effectName && !model.effects.has(effectName)) failures.push(`в ядре игры нет правила ${effectName}`);
    place();
  }

  function scheduleRebuild() {
    if (rebuildTimer) return;
    rebuildTimer = window.setTimeout(rebuild, REBUILD_MS);
  }

  function lookup(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    const glyph = GLYPH_BY_TEXTURE.get(lower);
    if (glyph) return bank.canvas(lower, glyphCanvas(glyph), { columns: 1, rows: 1 });
    return bank.game(lower);
  }

  /* --- Кадр --- */

  function cameraBasis() {
    const camera = renderer.camera;
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      right: [e[0], e[1], e[2]],
      up: [e[4], e[5], e[6]],
    };
  }

  function draw() {
    eye.apply();
    renderer.setSceneShader({ fragmentShader: MATTE_FLOOR_FRAGMENT, uniforms: { uGroundOffset: [0, groundOffset] } });
    if (holding) {
      renderer.render([], [], lookup, []);
      batches = { sprites: 0, models: 0, trails: 0 };
      dirty = false;
      return;
    }
    car?.setEye(renderer.camera.position);
    const camera = cameraBasis();
    const sprites = [];
    const models = [];
    const trails = [];
    instances.forEach((item) => {
      const key = `wheel:${keyOf(item.wheel, item.side)}`;
      sprites.push(...spriteBatches(item.effect, camera, lookup, key));
      models.push(...modelBatches(item.effect, key));
      trails.push(...trailBatches(item.effect, camera, lookup, key));
    });
    if (mode === "slipstream")
      for (const batch of trails)
        for (let at = 0; at < batch.colours.length; at += 4) {
          batch.colours[at + 3] = Math.min(1, batch.colours[at + 3] * SLIP_GAIN);
          for (let channel = 0; channel < 3; channel += 1) batch.colours[at + channel] *= SLIP_GLOW;
        }
    renderer.render(sprites, models, lookup, trails);
    batches = { sprites: sprites.length, models: models.length, trails: trails.length };
    dirty = false;
  }

  /* Машина едет всегда, пока кадр на экране: и без дыма колёса крутятся. */
  const animating = () => !holding && (Boolean(car) || instances.length > 0);

  function tick(now) {
    frame = 0;
    if (!running) return;
    if (now - drawnAt < FRAME_MS && animating()) {
      schedule();
      return;
    }
    drawnAt = now;
    const dt = Math.min((now - (last || now)) / 1000, MAX_STEP);
    last = now;
    if (eye.moving()) eye.step(dt);
    if (animating()) {
      advance(dt);
      pose();
      draw();
    } else if (dirty || eye.moving()) draw();
    schedule();
  }

  function schedule() {
    if (running && !frame && (animating() || dirty || eye.moving())) frame = requestAnimationFrame(tick);
  }

  /* Кадр стоит (окно в фоне, кадр за краем) — правка рисуется неподвижным кадром. */
  function wake() {
    if (running) {
      schedule();
      return;
    }
    if (stillFrame || disposed) return;
    stillFrame = window.setTimeout(() => {
      stillFrame = 0;
      if (!running && dirty && !disposed) draw();
    }, 0);
  }

  function resize(width, height, ratio = 1) {
    const next = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), ratio };
    if (next.width === size.width && next.height === size.height && next.ratio === size.ratio) return;
    size = next;
    renderer.resize(size.width, size.height, ratio);
    applyLighting();
    wake();
  }

  return {
    resize,
    /** Работа редактора: дым пересобирается тем же заказом, что уйдёт в игру. */
    setProject(next) {
      project = normalizeWheelSmokeProject(next);
      /* Имя работы и выключенные цели, что дыма в кадре не меняют, — без
         пересборки: дым не перезапускается на каждую букву имени. */
      const choice = wheelSmokeEffectFor(project, mode);
      const key = `${mode}|${choice.name}|${JSON.stringify(choice.compiled.clones)}`;
      if (key === projectKey) return;
      projectKey = key;
      scheduleRebuild();
    },
    /** База из игры: `{ model, sheets, light? }` или `null`. */
    setBase(next) {
      base = next?.model ? next : null;
      lighting = lightingFor(base?.light || null, hour);
      applyLighting();
      bank.provideSheets(base?.sheets || null);
      renderer.setMeshes(base?.model?.meshes || {});
      model = null;
      modelKey = "";
      rebuild();
    },
    /** «Пробуксовка» или «Дрифт»: своё правило, своё движение, своя рамка. */
    setMode(next) {
      const wanted = WHEEL_SMOKE_MODES.includes(next) ? next : "burnout";
      if (wanted === mode) return;
      mode = wanted;
      clock = 0;
      groundOffset = 0;
      generation += 1;
      eye.setFrame(cameraFor());
      rebuild();
    },
    /**
     * Машина из игры игрока: ответ `readWheelSmokeCar` (`{ glb, car }`) или
     * `null` — тогда колёса без кузова. Не разобралась — остаются колёса, а
     * причина уходит в статус кадра.
     */
    setCar(next) {
      if (!next?.glb) {
        if (carWanted !== "fallback") mountFallback();
        return;
      }
      const ticket = ++carTicket;
      carWanted = "game";
      gameCarAsset(next.glb, next.car || {})
        .then((asset) => {
          if (disposed || ticket !== carTicket) return;
          mountCar(asset, "game");
        })
        .catch((error) => {
          if (disposed || ticket !== carTicket) return;
          carFailure = `машина игры не разобралась: ${String(error?.message || error)}`;
          report();
          if (carKind !== "fallback") mountFallback();
          else carWanted = "fallback";
        });
    },
    /** Краска кузова (`CAR_PAINTS`). */
    setPaint(id) {
      paint = carPaint(id).colour;
      car?.setPaint(paint);
      dirty = true;
      wake();
    },
    /* Час света частиц — для стенда разработки: кадр редактора держит день. */
    setHour(next) {
      hour = Number.isFinite(next) ? next : HOUR;
      lighting = lightingFor(base?.light || null, hour);
      applyLighting();
      wake();
    },
    /* Вид орбиты `{ yaw, pitch, zoom }` — снимок обложки и стенд. */
    setView: (view) => eye.setView(view),
    resetView: () => eye.reset(),
    toggleFly: () => eye.toggleFly(),
    setSpeed: (speed) => eye.setSpeed(speed),
    start() {
      running = true;
      last = 0;
      schedule();
    },
    stop() {
      running = false;
      eye.releaseKeys();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    },
    dispose() {
      disposed = true;
      running = false;
      if (frame) cancelAnimationFrame(frame);
      if (rebuildTimer) window.clearTimeout(rebuildTimer);
      if (stillFrame) window.clearTimeout(stillFrame);
      eye.dispose();
      car?.dispose();
      bank.dispose();
      renderer.dispose();
    },
    /* Собрать отложенную правку сейчас, а не по таймеру ползунка (снимок обложки). */
    flush() {
      if (!rebuildTimer) return;
      window.clearTimeout(rebuildTimer);
      rebuild();
    },
    /* Прогнать кадр вперёд без показа (снимок обложки: дым в разгаре). */
    advance(seconds) {
      for (let time = 0; time < seconds; time += STEP) advance(STEP);
      pose();
      dirty = true;
    },
    renderNow: () => {
      pose();
      draw();
    },
    /* Всё ли для снимка на месте: та машина, что просили, листы игры. */
    ready: () => (Boolean(car) && carKind === carWanted ? true : Boolean(carFailure)) && bank.pending() === 0,
    /* Что сейчас в кадре — для стенда разработки. */
    stats: () => ({
      running,
      mode,
      effect: effectName,
      instances: instances.length,
      particles: particleCount(),
      car: Boolean(car),
      carKind,
      batches,
      base: Boolean(base?.model),
      failures: [...failures, ...(carFailure ? [carFailure] : [])],
      ev: lighting.post.ev,
    }),
  };
}
