/*
 * Эффект зоны автора в точке попадания на кадре игры (`docs/fx-scenes.md`, §6). Клон слоя тот же, что собирает установка
 * (`impact-clones.js`) и что играет 3D-сцена боя (`combat-impact-director.js`); отличие одно — тела в кадре как меша нет, есть
 * точка попадания `target.world`, и луч по нему не пускается: вход — у самой точки, выход — за ней по полёту пули. Глубина кадра
 * прячет то, что оказалось за телом, — выход со спины за ним и не виден, как в игре.
 *
 * Зона — `head` или `body` (кость сцены `target.bone`: `head` / `chest`).
 */
import { EffectInstance, effectFrame, modelBatches, spriteBatches, trailBatches } from "@modovik/ptfx-runtime";
import { PLACEMENTS, cloneName, createImpactClones } from "../../../components/desktop/workshop/ptfx/impact-clones.js";
import { shotLod } from "../combat-stage/combat-schedule.js";
import { EXIT_DEPTH } from "./frame-shot-plan.js";

/* Вход чуть впереди точки (к стрелку), чтобы поверхность тела не съела первые частицы; выход — за телом по полёту пули. */
const ENTRY_LIFT = 0.02;
/* Сколько попаданий живёт разом: очередь рисует по попаданию на выстрел. */
const MAX_HITS = 12;
const HIT_LIMIT = 6;

const along = (point, direction, k) => [point[0] + direction[0] * k, point[1] + direction[1] * k, point[2] + direction[2] * k];

/**
 * @param {object} options
 * @param {object} options.bank — банк листов клонов (`createTextureBank`)
 * @param {() => {x:number,y:number,z:number}} options.cameraPosition
 * @param {(zoneId: string, settings: object) => object} [options.sprites] — картинки слоёв зоны
 */
export function createFrameHitFx({ bank, cameraPosition, sprites = () => ({}) }) {
  const clones = createImpactClones({ bank, sprites });
  let hits = [];
  let counter = 0;

  return {
    lookup: clones.lookup,
    meshes: clones.meshes,
    get failures() {
      return clones.failures;
    },
    get model() {
      return clones.model;
    },
    get playlist() {
      return clones.playlist;
    },
    get busy() {
      return hits.length > 0;
    },
    get liveCount() {
      return hits.length;
    },
    setBase(base) {
      clones.setBase(base);
      hits = [];
    },
    /** Зоны редактора и какие играют: `true`, если очередь другая. */
    setZones(zones, order) {
      const changed = clones.setZones(zones, order);
      if (changed || !clones.model) hits = [];
      return changed;
    },
    reset() {
      hits = [];
    },
    /**
     * Попадание в зону: `origin` — точка на теле, `direction` — от тела к стрелку (против полёта пули), `exitDepth` — на сколько метров за точкой по полёту
     * пули стартует выход (`EXIT_DEPTH`; у вида от лица жертвы — до поверхности спины, `frame-stage.js`). Возвращает `true`, если что-то запущено
     * (у зоны есть клон).
     */
    strike({ origin, direction, zone, seed, lag = 0, exitDepth = EXIT_DEPTH }) {
      const model = clones.model;
      if (!model || !clones.playlist.includes(zone)) return false;
      const camera = cameraPosition();
      const effects = [];
      for (const placement of PLACEMENTS) {
        const name = cloneName(zone, placement);
        const rule = model.effects.get(name);
        if (!rule) continue;
        const front = placement === "front";
        const point = front ? along(origin, direction, ENTRY_LIFT) : along(origin, direction, -exitDepth);
        const distance = Math.hypot(camera.x - point[0], camera.y - point[1], camera.z - point[2]);
        const instance = new EffectInstance(model, name, {
          /* Игра ставит ось Z входного эффекта против полёта пули — наружу к стрелку, выходного — по полёту, из спины. */
          frame: effectFrame({ origin: point, z: front ? direction : direction.map((value) => -value), up: [0, 0, 1] }),
          seed: seed + (front ? 0 : 101),
          evolutions: { LOD: shotLod({ distance, lod: rule.lod }), angle: 0 },
        });
        if (lag > 0) instance.step(lag);
        counter += 1;
        effects.push({ key: `hit${counter}:${zone}:${placement}`, instance });
      }
      if (!effects.length) return false;
      hits.push({ effects, time: lag });
      while (hits.length > MAX_HITS) hits.shift();
      return true;
    },
    /** Шаг времени; `true`, если картинка изменилась. */
    step(dt) {
      for (const hit of hits) {
        hit.time += dt;
        for (const item of hit.effects) item.instance.step(dt);
      }
      const before = hits.length;
      hits = hits.filter((hit) => hit.time < HIT_LIMIT && !hit.effects.every((item) => item.instance.finished));
      return hits.length !== before || hits.length > 0;
    },
    collect(camera) {
      const batches = [];
      const models = [];
      const trails = [];
      for (const hit of hits)
        for (const item of hit.effects) {
          batches.push(...spriteBatches(item.instance, camera, clones.lookup, item.key));
          models.push(...modelBatches(item.instance, item.key));
          trails.push(...trailBatches(item.instance, camera, clones.lookup, item.key));
        }
      return { batches, models, trails };
    },
  };
}
