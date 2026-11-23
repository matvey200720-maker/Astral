/*
 * Режим «попадания» 3D-сцены боя (задача 4А, 18.10.2026): выстрел за выстрелом
 * в голову или корпус жертвы — клон слоя в точке входа пули и в точке выхода,
 * найденных лучом по настоящему мешу тела. В кадре ровно то, что соберёт
 * установщик (`impact-clones.js`).
 *
 * Режиссёр — часть сцены (`combat-scene.js`): мир, актёры, камера, цикл кадров
 * и расписание выстрелов принадлежат ей, а он знает только, что именно
 * играет выстрел и как его рисовать. Через `ctx` он видит раскладку, актёров,
 * камеру и банк листов.
 */

import * as THREE from "three";
import { EffectInstance, effectFrame, modelBatches, spriteBatches, trailBatches } from "@modovik/ptfx-runtime";
import { PLACEMENTS, cloneName, createImpactClones } from "../../../components/desktop/workshop/ptfx/impact-clones.js";
import {
  FALLBACK_BODY,
  add,
  bodyToWorld,
  cross,
  dot,
  normalize,
  scale,
  sub,
  zoneCentre,
} from "./combat-layout.js";
import { shotLod } from "./combat-schedule.js";

/* Сколько выстрелов играет разом: очередь с кровью — десяток выбросов, и
   каждый — несколько пачек. Старейший уходит первым. */
const MAX_SHOTS = 12;
/* Предел длины одного выброса, с. */
const SHOT_LIMIT = 6;
/* Разброс точки попадания, м: очередь бьёт не в одно и то же место. */
const SCATTER = Object.freeze({ head: 0.035, body: 0.07 });
/* Радиус метки «куда летит»: единица прицела — 0,32 роста фигуры (1,85 м), как
   у метки на плоском силуэте, чтобы настройка значила то же. */
export const AIM_METRES = 0.32 * 1.85;

export function createImpactDirector(ctx, { sprites = () => ({}) } = {}) {
  const clones = createImpactClones({ bank: ctx.bank, sprites });
  let shots = [];
  let shotIndex = 0;

  const playlist = () => clones.playlist;

  /* Центр зоны жертвы в мире. */
  function zonePoint(zoneId) {
    const local = zoneCentre(zoneId, ctx.victim?.joints) || zoneCentre(zoneId, FALLBACK_BODY.joints);
    return bodyToWorld(local, ctx.layout.victim);
  }

  function nextShot(lag) {
    const model = clones.model;
    const zones = playlist();
    const layout = ctx.layout;
    if (!model || !zones.length || !layout) return null;
    const zoneId = zones[shotIndex % zones.length];
    const seed = 0x51f15e + shotIndex * 7919;
    shotIndex += 1;
    const scatter = SCATTER[zoneId] ?? SCATTER.body;
    const jitter = (salt) => ((((seed >>> salt) & 0xff) / 255) * 2 - 1) * scatter;
    const aim = add(zonePoint(zoneId), [jitter(0), 0, jitter(8)]);
    const direction = normalize(sub(aim, layout.muzzle));
    const victim = ctx.victim;
    const through = !ctx.matte && victim ? victim.pierce(layout.muzzle, direction) : null;
    const entry = through?.entry?.point || sub(aim, scale(direction, 0.12));
    const exit = through?.exit?.point || add(aim, scale(direction, 0.12));
    /* Раны на теле и брызги на землю — по тому же лучу, что поставил клоны (`combat-decals.js`). */
    if (through && ctx.decals) ctx.decals.strike({ victim, through, direction, zone: zoneId, seed, floorZ: 0 });
    const camera = ctx.cameraPosition();
    const effects = [];
    for (const placement of PLACEMENTS) {
      const name = cloneName(zoneId, placement);
      const rule = model.effects.get(name);
      if (!rule) continue;
      const front = placement === "front";
      const origin = front ? entry : exit;
      const distance = Math.hypot(camera.x - origin[0], camera.y - origin[1], camera.z - origin[2]);
      const instance = new EffectInstance(model, name, {
        /* Игра ставит ось Z входного эффекта против полёта пули — наружу к
           стрелку, выходного — по полёту, из спины. */
        frame: effectFrame({ origin, z: front ? scale(direction, -1) : direction, up: [0, 0, 1] }),
        seed: seed + (front ? 0 : 101),
        evolutions: { LOD: shotLod({ distance, lod: rule.lod }), angle: 0 },
      });
      if (lag > 0) instance.step(lag);
      effects.push({ key: `${shotIndex}:${zoneId}:${placement}`, instance });
    }
    return effects.length ? { zoneId, effects, time: lag } : null;
  }

  /* --- Метка «куда летит» ---
   * Направление слоя — доли от −1 до 1 в плоскости, перпендикулярной пуле:
   * x — вправо от стрелка, y — вниз, единица — `AIM_METRES`. Рецепт клона
   * читает их в системе самого эффекта (ось Z — к стрелку), поэтому метка
   * значит одно и то же в любом ракурсе. */
  const aimRight = () => normalize(cross(ctx.layout.direction, [0, 0, 1]));

  function aimWorld(zoneId, direction = { x: 0, y: 0 }) {
    const centre = zonePoint(zoneId);
    return add(centre, add(scale(aimRight(), direction.x * AIM_METRES), [0, 0, -direction.y * AIM_METRES]));
  }

  /** Метка на экране: `{ origin, point }` в CSS-пикселях или `null`. */
  function aimOnScreen(zoneId, direction) {
    if (!ctx.layout) return null;
    const origin = ctx.project(zonePoint(zoneId));
    const point = ctx.project(aimWorld(zoneId, direction));
    return origin && point ? { origin, point } : null;
  }

  /** Тянут ли метку отсюда: плоскость метки не должна лежать ребром к взгляду. */
  function aimReachable() {
    if (!ctx.layout) return false;
    const forward = new THREE.Vector3();
    ctx.renderer.camera.getWorldDirection(forward);
    return Math.abs(dot([forward.x, forward.y, forward.z], ctx.layout.direction)) > 0.3;
  }

  /** Доли метки из точки экрана (CSS-пиксели относительно холста). */
  function aimFromScreen(zoneId, cssX, cssY) {
    if (!ctx.layout || !aimReachable()) return null;
    const ray = ctx.rayAt(cssX, cssY);
    const normal = new THREE.Vector3(...ctx.layout.direction);
    const centre = new THREE.Vector3(...zonePoint(zoneId));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const offset = hit.sub(centre);
    const x = offset.dot(new THREE.Vector3(...aimRight())) / AIM_METRES;
    const y = -offset.z / AIM_METRES;
    const reach = Math.hypot(x, y);
    return reach <= 1 ? { x, y } : { x: x / reach, y: y / reach };
  }

  /** Какая зона под точкой экрана: `head`, `body` или `null` (мимо жертвы). */
  function pickZone(cssX, cssY) {
    const victim = ctx.victim;
    if (!victim || !ctx.layout) return null;
    const ray = ctx.rayAt(cssX, cssY);
    const hit = victim.pierce(ray.origin.toArray(), ray.direction.toArray(), 0);
    if (!hit) return null;
    const head = zonePoint("head");
    const body = zonePoint("body");
    /* Граница — на полпути между центрами головы и груди. */
    return hit.entry.point[2] > (head[2] + body[2]) / 2 ? "head" : "body";
  }

  return {
    /** Что рисует режим: нет ничего, пока не выбран слой. */
    get shooting() {
      return Boolean(ctx.layout) && Boolean(clones.model) && playlist().length > 0;
    },
    get playing() {
      return shots.length > 0;
    },
    get activeShots() {
      return shots.length;
    },
    get lastZone() {
      return shots.at(-1)?.zoneId || null;
    },
    get failures() {
      return clones.failures;
    },
    lookup: clones.lookup,
    /** База эффектов из игры игрока (`readPtfxBase`) или `null`. */
    setBase(base) {
      clones.setBase(base);
      ctx.renderer.setMeshes(clones.meshes());
      shots = [];
    },
    /** Свет игры игрока (`base.light`), если он есть. */
    baseLight: () => clones.base?.light || null,
    reset() {
      shots = [];
      shotIndex = 0;
      ctx.decals?.clear();
    },
    step(dt, shooting) {
      for (const shot of shots) {
        shot.time += dt;
        for (const item of shot.effects) item.instance.step(dt);
      }
      const before = shots.length;
      shots = shots.filter((shot) => shot.time < SHOT_LIMIT && !shot.effects.every((item) => item.instance.finished));
      let changed = shots.length !== before;
      if (shooting) {
        for (const lag of ctx.clock.advance(dt, shots.length)) {
          const shot = nextShot(lag);
          if (shot) {
            shots.push(shot);
            changed = true;
          }
        }
        while (shots.length > MAX_SHOTS) shots.shift();
      }
      return changed;
    },
    /** Пачки частиц для кадра. */
    collect(camera) {
      const batches = [];
      const models = [];
      const trails = [];
      for (const shot of shots)
        for (const item of shot.effects) {
          batches.push(...spriteBatches(item.instance, camera, clones.lookup, item.key));
          models.push(...modelBatches(item.instance, item.key));
          trails.push(...trailBatches(item.instance, camera, clones.lookup, item.key));
        }
      return { batches, models, trails };
    },
    api: {
      setZones(zones, order) {
        if (clones.setZones(zones, order) || !clones.model) shots = [];
        ctx.mark();
      },
      zonePoints: () => (ctx.layout ? { head: zonePoint("head"), body: zonePoint("body") } : null),
      aimOnScreen,
      aimFromScreen,
      aimReachable,
      pickZone,
      /** Кадр в момент `time` первого выстрела — для снимков и сверки. */
      renderAt(time = 0.4) {
        shots = [];
        shotIndex = 0;
        const shot = nextShot(0);
        if (shot) {
          for (const item of shot.effects) item.instance.step(time);
          shot.time = time;
          shots.push(shot);
        }
        ctx.drawNow();
      },
    },
  };
}
