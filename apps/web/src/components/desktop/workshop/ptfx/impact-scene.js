/*
 * Сцена попаданий окна мастерской: выстрел за выстрелом — тот же эффект, что
 * окажется в игре.
 *
 * Что именно играет. Не правило донора, а клон, который соберёт установка:
 * рецепт слоя (`impactCloneRecipe` — одна функция для окна и установщика) →
 * клон (`buildEffectClone`, перенос `YptEffectClones.cs`, сверенный с ним
 * `scripts/probe-effect-clones.mjs`) → модель → движок частиц RMPTFX
 * (`@modovik/ptfx-runtime`) → рисовальщик с шейдером `ptfx_sprite` и светом
 * таймцикла игрока (`ptfx-renderer.js`, `ptfx-lighting.js`).
 *
 * Где играет. Входная сторона — у раны на лице фигуры, ось Z эффекта смотрит
 * на стреляющего (камеру): так игра ставит брызги попадания — наружу из раны.
 * Выходная — за телом, ось Z от камеры; её заслоняет рельеф фигуры. Дальность
 * камеры меняет эволюцию LOD правила ровно как в игре.
 */

import { ZONE_ANCHORS } from "../impact-figure.js";
import {
  EffectInstance,
  effectFrame,
  modelBatches,
  spriteBatches,
  trailBatches,
} from "@modovik/ptfx-runtime";
import { layerPictureKey } from "@modovik/ptfx-studio";
import { PLACEMENTS, cloneName, createImpactClones, lodValue } from "./impact-clones.js";
import { createPtfxRenderer } from "./ptfx-renderer.js";
import { sceneLighting } from "./ptfx-lighting.js";
import { createTextureBank } from "./ptfx-textures.js";

/* Дальность камеры: «вблизи» — бой на пяти-шести метрах, «вдали» — за
   верхней границей LOD штатной крови (40 м). */
export const IMPACT_VIEW_DISTANCE = Object.freeze({ near: 6, far: 45 });

/* Пауза между выстрелами и предел длины одного выброса. */
export const SHOT_PAUSE = 0.35;
const SHOT_LIMIT = 6;

/*
 * Матовый фон: точка выброса без фигуры — там, куда сцена ставит эффект,
 * когда силуэта нет (`figurePoint` → метр над землёй), — и высота кадра
 * вокруг неё: картинка до 1,1 м с разлётом умещается целиком.
 */
const MATTE_CENTRE = 1;
const MATTE_METRES = 1.8;

/*
 * Откуда стреляют: слева и чуть сверху, как летит пуля подачи сцены
 * (прежний кадр попаданий `ImpactBody`, удалён 13.11.2026; сейчас `CombatImpactStage`). Игра ставит ось Z входного эффекта против полёта пули —
 * наружу к стрелку, выходного — по полёту, из спины. Ровно в камеру ось не
 * смотрит: стрелок в игре не сидит в объективе, и брызги видны сбоку, а не
 * торцом.
 */
const yaw = (30 * Math.PI) / 180;
const pitch = (5 * Math.PI) / 180;
export const TOWARD_SHOOTER = Object.freeze([
  -Math.sin(yaw) * Math.cos(pitch),
  -Math.cos(yaw) * Math.cos(pitch),
  Math.sin(pitch),
]);
const ALONG_BULLET = Object.freeze(TOWARD_SHOOTER.map((value) => -value));

/**
 * Сцена на холсте. `sprites(zoneId, settings)` — картинки слоёв зоны для
 * текстур клона: `{ [index]: canvas }` для картинок и `{ ["sheet:" + index]:
 * { canvas, columns, rows } }` для своих листов брызг (как у старой схемы).
 */
export function createImpactScene({ canvas, sprites = () => ({}), onFrame = null }) {
  const bank = createTextureBank({
    onReady: () => {
      dirty = true;
      wake();
    },
  });
  const clones = createImpactClones({ bank, sprites });
  /* Рендерер окна (фаза 5): кадр сцены — копией в свой холст, буфер окна не пересоздаётся (рендерер «на кадр»). */
  const renderer = createPtfxRenderer({ canvas, lighting: sceneLighting({}), share: true });
  let dirty = true;
  /* Сцену показывают (`start`), и цикл кадров может идти. Идёт он только
     пока есть что двигать: см. `tick`. */
  let running = false;
  let distance = IMPACT_VIEW_DISTANCE.near;
  let paused = false;
  let shot = null;
  let shotIndex = 0;
  let clock = 0;
  let frame = 0;
  let last = 0;

  /** База эффектов из игры игрока (`readPtfxBase`) или `null`. */
  function setBase(next) {
    clones.setBase(next);
    renderer.setMeshes(clones.meshes());
    renderer.setLighting(sceneLighting({ light: next?.light || null, hour: 13 }));
    afterRebuild();
    wake();
  }

  /* Клон пересобран: без модели играть нечему, с моделью — кадр другой. */
  function afterRebuild() {
    if (!clones.model) shot = null;
    else dirty = true;
  }

  /** Зоны редактора и какие из них играют сейчас. */
  function setZones(nextZones, nextPlaylist) {
    if (clones.setZones(nextZones, nextPlaylist)) shot = null;
    afterRebuild();
    wake();
  }

  function setDistance(metres) {
    distance = metres;
    renderer.setDistance(metres);
    shot = null;
    dirty = true;
    wake();
  }

  function setPaused(value) {
    paused = Boolean(value);
    wake();
  }

  const lookup = (name) => clones.lookup(name);

  /* Выстрел: входная и выходная стороны зоны, свои зёрна. */
  function nextShot() {
    const model = clones.model;
    const playlist = clones.playlist;
    if (!model || !playlist.length) return null;
    const zoneId = playlist[shotIndex % playlist.length];
    const anchor = ZONE_ANCHORS[zoneId] || ZONE_ANCHORS.body;
    const seed = 0x51f15e + shotIndex * 7919;
    shotIndex += 1;
    const effects = [];
    for (const placement of PLACEMENTS) {
      const name = cloneName(zoneId, placement);
      const rule = model.effects.get(name);
      if (!rule) continue;
      const surface = renderer.figurePoint(anchor[0], anchor[1]);
      const front = placement === "front";
      const origin = front ? surface : [surface[0], -surface[1], surface[2]];
      const frame = effectFrame({ origin, z: front ? TOWARD_SHOOTER : ALONG_BULLET, up: [0, 0, 1] });
      effects.push({
        key: `${zoneId}:${placement}`,
        instance: new EffectInstance(model, name, {
          frame,
          seed: seed + (front ? 0 : 101),
          evolutions: { LOD: lodValue(rule, distance), angle: 0 },
        }),
      });
    }
    return effects.length ? { zoneId, effects, time: 0 } : null;
  }

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
    const camera = cameraBasis();
    const batches = [];
    const models = [];
    const trails = [];
    for (const item of shot?.effects || []) {
      batches.push(...spriteBatches(item.instance, camera, lookup, item.key));
      models.push(...modelBatches(item.instance, item.key));
      trails.push(...trailBatches(item.instance, camera, lookup, item.key));
    }
    renderer.render(batches, models, lookup, trails);
    dirty = false;
  }

  /** Что сейчас на сцене: выстрел или пауза перед следующим (и до него сколько). */
  function phase() {
    if (shot) return { playing: true, zoneId: shot.zoneId, time: shot.time, untilNext: 0 };
    const playlist = clones.playlist;
    const zoneId = playlist.length ? playlist[shotIndex % playlist.length] : null;
    return { playing: false, zoneId, time: 0, untilNext: Math.max(0, SHOT_PAUSE - clock) };
  }

  /*
   * Цикл кадров идёт, только пока есть что двигать.
   *
   * Прежде он крутился всегда и рисовал сцену на каждом обновлении экрана —
   * 120–144 раза в секунду, в том числе пустую: вошёл человек, эффекта ещё
   * не выбрал, а видеочип занят на треть (стенд `npm run perf`, 25.09.2026:
   * 36 % GPU и 14 % ядра в простое). Теперь кадр рисуется, когда он другой:
   * идёт выстрел, пришёл лист, сменились зоны, размер или дальность. Пауза
   * между выстрелами — время, а не кадры: сцена в ней стоит, и рисовать её
   * заново незачем. Остановленная сцена, пустая очередь или пауза — цикл
   * засыпает и просыпается от первой правки (`wake`).
   */
  function tick(now) {
    frame = 0;
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;
    onFrame?.(phase(), paused);
    if (paused || !clones.model || !clones.playlist.length) {
      if (dirty) draw();
      /* Спит до правки: время сцены не идёт, следующий кадр начнёт с нуля. */
      last = 0;
      return;
    }
    if (!shot) {
      clock += dt;
      if (clock >= SHOT_PAUSE) {
        clock = 0;
        shot = nextShot();
      }
    }
    if (shot) {
      shot.time += dt;
      for (const item of shot.effects) item.instance.step(dt);
      const done = shot.effects.every((item) => item.instance.finished) || shot.time > SHOT_LIMIT;
      draw();
      /* Последний кадр выстрела — пустой: следующая пауза стоит на нём. */
      if (done) {
        shot = null;
        dirty = true;
      }
    } else if (dirty) draw();
    schedule();
  }

  function schedule() {
    if (running && !frame) frame = requestAnimationFrame(tick);
  }

  /* Что-то поменялось: спящий цикл делает кадр (и дальше, если есть что
     двигать). Идущий цикл это и так увидит. */
  function wake() {
    schedule();
  }

  function start() {
    running = true;
    schedule();
  }

  function stop() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  /** Кадр в момент `time` выстрела `index` — для снимков и сверки. */
  function renderAt(time, index = 0) {
    shotIndex = index;
    shot = nextShot();
    if (shot) for (const item of shot.effects) item.instance.step(time);
    draw();
  }

  function dispose() {
    stop();
    bank.dispose();
    renderer.dispose();
  }

  return {
    renderer,
    setBase,
    setZones,
    setDistance,
    setPaused,
    setBackdrop: (options) => {
      renderer.setBackdrop(options);
      shot = null;
      dirty = true;
      wake();
    },
    setBackdropImage: (image) => {
      renderer.setBackdropImage(image);
      dirty = true;
      wake();
    },
    /*
     * Матовый фон вместо фигуры (задача 5 ТЗ 07.10.2026): эффект играет
     * посреди кадра в своём объёме — так видно, как своя картинка крутится и
     * разлетается, и ничто её не заслоняет. Камера та же — с той же дальности
     * (LOD), высота кадра — `metresTall` метров вокруг точки выброса.
     */
    setMatte: ({ plate, metresTall = MATTE_METRES } = {}) => {
      renderer.setPlate({
        plate,
        centre: [0, 0, MATTE_CENTRE],
        metresTall,
        distance,
      });
      shot = null;
      dirty = true;
      wake();
    },
    phase,
    /* Лист по имени текстуры — для проверки сцены на стенде. */
    textureOf: lookup,
    resize: (width, height, pixelRatio) => {
      renderer.resize(width, height, pixelRatio);
      dirty = true;
      wake();
    },
    start,
    stop,
    renderAt,
    dispose,
    get failures() {
      return clones.failures;
    },
    get model() {
      return clones.model;
    },
    get hasSheets() {
      return bank.hasSheets;
    },
  };
}

/* Куда прилетает пуля в каждой зоне — у фигуры (`impact-figure.js`): одна
   анатомия на силуэт эффектов и кадр звуков попадания. */
export { ZONE_ANCHORS };

/** Картинка слоя для сцены по ключу снимков человека. */
export const layerUploadKey = layerPictureKey;
