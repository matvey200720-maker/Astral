/*
 * Кадр игры с эффектом поверх (`docs/fx-scenes.md`, §8): фон — `clean.png` сцены, глубина — `depth.png`, камера — камера сцены;
 * вспышка, след и попадание рисуются правилами ядра игры игрока (`combat-shot-fx.js`), эффект зоны автора — клоном слоя
 * (`frame-hit-fx.js`), оба — в мировых точках опор. Глубина кадра прячет то, что оказалось за колонной или телом. Рисовальщик тот же,
 * что у 3D-сцены боя (`createPtfxRenderer`), только фон — не персонаж из игры, а кадр.
 *
 * Что играет, решает план (`frame-shot-plan.js`):
 *   • трассер — очередь без конца: магазин (30) в темпе ствола, каждый выстрел в свою точку веера `impacts[]`, вспышка на каждый, потом перезарядка (≈2,5 с);
 *   • попадание — та же очередь в тело или голову, эффект зоны автора в точке попадания;
 *   • килл — выстрел и серия кадров: кадр меняется по сдвигам `frames[].offsetMs`.
 *
 * Кадр рисуется, когда он другой: идёт выстрел или пришёл лист.
 */
import { createPtfxRenderer } from "../../../components/desktop/workshop/ptfx/ptfx-renderer.js";
import { sceneLighting } from "../../../components/desktop/workshop/ptfx/ptfx-lighting.js";
import { createTextureBank } from "../../../components/desktop/workshop/ptfx/ptfx-textures.js";
import { projectPoint, threeCamera } from "@modovik/fx-scenes/camera.js";
import { createShotFx } from "../combat-stage/combat-shot-fx.js";
import { createFrameHitFx } from "./frame-hit-fx.js";
import { EXIT_DEPTH, burstShot, burstShotTime, cycleSeconds, frameIndexAt, shotPlan } from "./frame-shot-plan.js";

/* Самый длинный шаг времени (вкладку свернули — выстрел не должен «догонять»). */
const MAX_STEP = 0.1;
/* Свечение поверх кадра игры: свет в нём уже запечён, лишнее заливает светлые места ореолом. */
const BLOOM_CAP = 0.15;
/* Не больше столько выстрелов очереди за один шаг: после долгого простоя очередь не высыпается разом. */
const MAX_BURST_CATCH_UP = 4;

export const SPEEDS = Object.freeze([1, 0.5, 0.25, 0.1]);

/* Поиск выхода пули к поверхности спины (вид от лица жертвы): шаг, предел и допуск глубины, м. */
const EXIT_STEP = 0.04;
const EXIT_SEARCH = 0.9;
const EXIT_BIAS = 0.05;

/* С какого числа идёт счёт случайных зёрен частиц выстрела. */
const SEED_START = 100;

const normalize = (v) => {
  const size = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / size, v[1] / size, v[2] / size];
};

/** Час кадра из `scene.time` (`{ hour, minute }`) или `null`. */
export function hourOf(time) {
  if (!time || !Number.isFinite(time.hour)) return null;
  return time.hour + (Number.isFinite(time.minute) ? time.minute : 0) / 60;
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {boolean} [options.share] — общий контекст рендерера окна; `false` — свой (обложка, стенд)
 * @param {(info: object) => void} [options.onShot] — начался выстрел: `{ plan }`; полноэкранный эффект (`plan.screen`) рисует хозяин сцены
 * @param {(info: { index: number, time: number }) => void} [options.onFrame] — сменился кадр серии килла
 * @param {(canvas: HTMLCanvasElement) => void} [options.onDraw] — после каждого кадра, пока холст хранит картинку
 * @param {(zoneId: string, settings: object) => object} [options.sprites] — картинки слоёв зоны автора для клона попадания
 * @param {boolean} [options.deterministic] — каждый выстрел начинается с одних и тех же случайных чисел частиц (обложки: момент, найденный одним проходом, во втором тот же)
 * @param {boolean} [options.single] — вместо магазина один выстрел (обложка эффекта попадания: один выстрел раскрывается чисто, а не месивом очереди)
 */
export function createFrameStage({ canvas, share = true, onShot = null, onFrame = null, onDraw = null, sprites = () => ({}), deterministic = false, single = false }) {
  let running = false;
  let raf = 0;
  let last = 0;
  let dirty = true;
  let paused = false;
  let loop = true;
  let speed = 1;
  let seed = SEED_START;
  let frame = null;
  let plan = null;
  let cam = null;
  let baseLight = null;
  let size = { width: 0, height: 0 };
  /* Время выстрела с его начала, события по времени (`hit`), очередь трассера, кадр серии. */
  let clock = 0;
  let queue = [];
  let burstAt = 0;
  let burstCount = 0;
  let frameIndex = 0;

  const onReady = () => {
    dirty = true;
    wake();
  };
  /* Листы ядра (вспышка, след) и листы клонов зоны — из разных выгрузок базы, и `provideSheets` у банка один на выгрузку. */
  const bank = createTextureBank({ onReady });
  const hitBank = createTextureBank({ onReady });
  let lighting = sceneLighting({ light: null, hour: 13 });
  const renderer = createPtfxRenderer({ canvas, lighting, share });
  const cameraPosition = () => renderer.camera.position;
  const fx = createShotFx({ bank, renderer, cameraPosition });
  const hits = createFrameHitFx({ bank: hitBank, cameraPosition, sprites });

  /* Лист по имени текстуры: ядро знает свои, клоны — свои; не нашлось у первого — спросим второго. */
  const lookup = (name) => fx.lookup(name) || hits.lookup(name);

  /* Сетки моделей частиц: ядра игры и клонов вместе. */
  let coreMeshes = {};
  function syncMeshes() {
    renderer.setMeshes({ ...coreMeshes, ...hits.meshes() });
  }

  /* --- Свет: таймцикл игры игрока на час кадра, направление солнца — со сцены --- */

  function refreshLight() {
    const scene = frame?.scene;
    let next = sceneLighting({ light: baseLight, hour: hourOf(scene?.time) ?? 13 });
    const sun = scene?.lighting?.sun;
    if (sun) {
      const direction = normalize(sun.direction);
      next = { ...next, sun: { ...next.sun, direction }, ambient: { ...next.ambient, directionalAxis: direction.map((value) => -value) } };
    }
    lighting = { ...next, post: { ...next.post, bloomIntensity: Math.min(next.post.bloomIntensity ?? BLOOM_CAP, BLOOM_CAP) } };
    renderer.setLighting(lighting);
    dirty = true;
  }

  /* --- Выстрел --- */

  /*
   * Вид от лица жертвы: камера за спиной жертвы, поэтому точка выхода пули (`EXIT_DEPTH` за входом) оказывается внутри тела, и карта глубины кадра прячет весь выход.
   * Двигаем её по полёту пули к камере, пока она не выйдет из-за поверхности спины (глубина точки не больше глубины кадра в этом пикселе), — так выход брызжет
   * из спины наружу, как видит жертва. Не нашлось до `EXIT_SEARCH` метров — обычная глубина.
   */
  function exitToSurface(origin, direction) {
    const depth = frame?.depth;
    const scene = frame?.scene;
    if (!depth || !scene) return EXIT_DEPTH;
    for (let k = EXIT_DEPTH; k <= EXIT_SEARCH; k += EXIT_STEP) {
      const point = [origin[0] - direction[0] * k, origin[1] - direction[1] * k, origin[2] - direction[2] * k];
      const projected = projectPoint(scene.camera, point, scene.resolution);
      const [u, v] = projected?.screen || [];
      if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return EXIT_DEPTH;
      const surface = depth.data[Math.floor(v * depth.height) * depth.width + Math.floor(u * depth.width)];
      if (projected.depthMeters <= surface + EXIT_BIAS) return k;
    }
    return EXIT_DEPTH;
  }

  /* Запустить событие плана `step`; `lag` — на сколько оно опоздало (шаг времени шире момента события). */
  function run(step, lag = 0) {
    seed += 1;
    if (step.kind === "flash") fx.flash({ origin: step.origin, direction: step.direction, seed, lag });
    else if (step.kind === "tracer") fx.tracer({ from: step.from, direction: step.direction, reach: step.reach, fps: step.fps, seed, lag, speed: plan?.burst?.speed, cover: true });
    else if (step.kind === "impact") fx.impact({ origin: step.origin, direction: step.direction, seed, delay: step.at, lag });
    else if (step.kind === "hit") hits.strike({ origin: step.origin, direction: step.direction, zone: step.zone, seed, lag, ...(step.surface ? { exitDepth: exitToSurface(step.origin, step.direction) } : {}) });
  }

  /* События одного выстрела: мгновенные — сразу, остальное (попадание, когда пуля долетит) — в очередь по времени. След и «стена» ведёт
     сам `fx` (у него свои отложенные штрихи), попадание зоны — очередь сцены. */
  function launch(steps, at = clock) {
    for (const step of steps) {
      if (step.kind === "hit" && step.at > 0) queue.push({ at: at + step.at, step });
      else run(step, clock - at);
    }
    queue.sort((left, right) => left.at - right.at);
  }

  function showFrame(index) {
    const source = frame?.frames?.[index];
    if (!source || !cam) return;
    frameIndex = index;
    renderer.setFrame({ image: source.image, depth: source.depth, camera: cam });
    dirty = true;
    onFrame?.({ index, time: clock });
  }

  function fire() {
    if (deterministic) seed = SEED_START;
    fx.reset();
    hits.reset();
    clock = 0;
    queue = [];
    burstAt = 0;
    burstCount = 0;
    if (frame?.frames && frameIndex !== 0) showFrame(0);
    frameIndex = 0;
    if (plan) {
      if (plan.burst) {
        /* Первый выстрел очереди — сразу; остальные идут по темпу ствола, а после полного магазина — перезарядка. */
        burstCount = 1;
        burstAt = burstShotTime(plan.burst, burstCount);
        launch(plan.steps);
      } else launch(plan.steps);
    }
    onShot?.({ plan });
    dirty = true;
    wake();
  }

  /* Время идёт на `dt` секунд: события по времени, очередь трассера, кадры серии; `true`, если картинка другая. */
  function advanceClock(dt) {
    let changed = false;
    if (fx.step(dt)) changed = true;
    if (hits.step(dt)) changed = true;
    clock += dt;
    while (queue.length && queue[0].at <= clock) {
      const item = queue.shift();
      run(item.step, clock - item.at);
      changed = true;
    }
    if (plan?.burst?.points.length) {
      let caught = 0;
      while (burstAt <= clock && caught < MAX_BURST_CATCH_UP) {
        launch(burstShot(plan.burst, burstCount), burstAt);
        burstCount += 1;
        burstAt = burstShotTime(plan.burst, burstCount);
        caught += 1;
        changed = true;
      }
      if (burstAt <= clock) burstAt = clock + plan.burst.interval;
    }
    if (frame?.frames) {
      const index = frameIndexAt(frame.frames, clock);
      if (index !== frameIndex) {
        showFrame(index);
        changed = true;
      }
    }
    return changed;
  }

  /* --- Кадр и цикл --- */

  function cameraBasis() {
    const camera = renderer.camera;
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    return { position: [camera.position.x, camera.position.y, camera.position.z], right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]] };
  }

  function collect() {
    const basis = cameraBasis();
    const shot = fx.collect(basis);
    const struck = hits.collect(basis);
    return {
      batches: [...shot.batches, ...struck.batches],
      models: [...shot.models, ...struck.models],
      trails: [...shot.trails, ...struck.trails],
    };
  }

  function draw() {
    const { batches, models, trails } = collect();
    renderer.render(batches, models, lookup, trails);
    onDraw?.(canvas);
    dirty = false;
  }

  const busy = () => fx.busy || hits.busy || queue.length > 0;
  const ready = () => fx.ready || hits.model !== null;
  const playing = () => !paused && plan && (plan.burst ? ready() : busy() || (loop && ready()));

  function tick(now) {
    raf = 0;
    const real = Math.min((now - (last || now)) / 1000, MAX_STEP);
    last = now;
    if (!paused && plan) {
      if (advanceClock(real * speed)) dirty = true;
      if (busy()) dirty = true;
      if (!plan.burst && loop && clock >= cycleSeconds(plan) && !busy()) fire();
    }
    if (dirty || busy()) draw();
    if (playing()) schedule();
    else last = 0;
  }

  function schedule() {
    if (running && !raf) raf = requestAnimationFrame(tick);
  }
  function wake() {
    schedule();
  }

  return {
    renderer,
    /**
     * Кадр сцены: `{ scene, image, depth, frames }` — `image` загруженный clean.png, `depth` — `{ width, height, data }` (`decodeDepth`);
     * у килла `frames` — серия `[{ index, offsetMs, image, depth }]`.
     */
    setFrame(next) {
      frame = next;
      plan = shotPlan(next.scene);
      /* Один выстрел: магазин из одного патрона, перезарядка — не дождаться. */
      if (single && plan.burst) plan = { ...plan, burst: { ...plan.burst, magazine: 1, reload: 1e6 } };
      cam = threeCamera(next.scene.camera);
      frameIndex = 0;
      renderer.setFrame({ image: next.image, depth: next.depth, camera: cam });
      renderer.setFog(next.scene.fog);
      refreshLight();
      fire();
    },
    /** База эффектов из игры игрока (`readPtfxBase`) или `null`: без неё правил частиц нет и поверх кадра ничего не рисуется. */
    setBase(base) {
      baseLight = base?.light || null;
      coreMeshes = base?.tracerScene?.exports?.[0]?.meshes || {};
      fx.setBase(base);
      hits.setBase(base);
      syncMeshes();
      refreshLight();
      if (plan) fire();
    },
    /** Зоны автора и какая играет: клон пересобирается, идущий выстрел доигрывает. Возвращает `true`, если очередь другая. */
    setZones(zones, order) {
      const changed = hits.setZones(zones, order);
      syncMeshes();
      dirty = true;
      wake();
      return changed;
    },
    /** Свой слот следа трассера: `{ canvas, width, length, nearHide }`. */
    setSlot(slot) {
      fx.setSlot(slot);
      dirty = true;
      wake();
    },
    shoot: fire,
    /** События вне сценария (стенд: вспышка за колонной проверяет глубину кадра). */
    play(steps) {
      fx.reset();
      hits.reset();
      clock = 0;
      queue = [];
      launch(steps, 0);
      onShot?.({ plan });
      dirty = true;
      wake();
    },
    setLoop(on) {
      loop = Boolean(on);
      wake();
    },
    setSpeed(value) {
      speed = SPEEDS.includes(value) ? value : 1;
    },
    setPaused(value) {
      paused = Boolean(value);
      wake();
    },
    resize(width, height, pixelRatio = 1) {
      const next = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
      if (next.width === size.width && next.height === size.height) return;
      size = next;
      renderer.resize(next.width, next.height, pixelRatio);
      dirty = true;
      wake();
    },
    start() {
      running = true;
      dirty = true;
      schedule();
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    },
    dispose() {
      this.stop();
      fx.reset();
      hits.reset();
      bank.dispose();
      hitBank.dispose();
      renderer.dispose();
    },
    /** Нарисовать сейчас (стенд, снимок). */
    drawNow: draw,
    /** Перемотать выстрел на `seconds` вперёд кадрами по 1/60 с и нарисовать: стенд и снимки не ждут `requestAnimationFrame` (в скрытой панели он стоит). */
    advance(seconds) {
      for (let left = seconds; left > 1e-9; left -= 1 / 60) advanceClock(Math.min(1 / 60, left));
      draw();
    },
    /**
     * Время ведёт хозяин, а не часы сцены (килл-эффект: шкала редактора): поставить выстрел на `seconds` от его начала и нарисовать.
     * Вперёд — доигрывает недостающее кадрами по 1/60 с; назад — выстрел начинается заново и доигрывается до нужного момента
     * (частицы хранят своё состояние, назад их не отмотать). Хозяин ставит `setPaused(true)`, чтобы часы сцены не шли сами.
     */
    seek(seconds) {
      const target = Math.max(0, Number(seconds) || 0);
      if (target < clock - 1e-6) fire();
      for (let left = target - clock; left > 1e-9; left -= 1 / 60) advanceClock(Math.min(1 / 60, left));
      draw();
    },
    /** Что сейчас живёт: для стенда и проверок. */
    inspect() {
      const { batches, models, trails } = collect();
      return {
        pending: bank.pending() + hitBank.pending(),
        sheets: bank.hasSheets,
        live: fx.liveCount,
        hits: hits.liveCount,
        time: clock,
        shots: burstCount,
        frame: frameIndex,
        flash: fx.hasFlash,
        tracer: fx.hasTracer,
        impact: fx.hasImpact,
        zones: hits.playlist,
        batches: batches.map((batch) => ({ key: batch.key, count: batch.count })),
        models: models.length,
        trails: trails.length,
      };
    },
    get plan() {
      return plan;
    },
    /** Правила ядра прочитаны (вспышка, след, попадание) или собраны клоны зоны. */
    get ready() {
      return ready();
    },
    get failure() {
      return fx.failure;
    },
    /** Клоны зоны, что не собрались: причины словами. */
    get zoneFailures() {
      return hits.failures;
    },
    get busy() {
      return busy();
    },
  };
}
