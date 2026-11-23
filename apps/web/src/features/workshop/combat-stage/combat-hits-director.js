/*
 * Режим «следы урона на экране» 3D-сцены боя (задача 4А, 18.10.2026): наш
 * персонаж стоит на месте, камера — за его плечом, как в GTA от третьего
 * лица, а по нему по кругу стреляют три стрелка из игры игрока — слева,
 * справа позади и впереди (`combat-hits-plan.js`).
 *
 * Выстрел — вспышка дула и след пули правилами ядра игры (`combat-shot-fx.js`),
 * а в миг, когда пуля долетела, на экране встаёт метка со стороны стрелка:
 * её рисует `paintScreenHitMarks` поверх этой сцены теми же числами, что
 * уйдут в игру. Метки отдаёт `api.marks()` — экран кадра рисует их каждый кадр.
 *
 * Стрелки за краем кадра (слева и сзади) не видны — так и в игре: метка нужна
 * как раз затем, чтобы сказать, откуда стреляют; полёт камеры покажет всех.
 *
 * Не снимок из GTA: стрелки — одно и то же тело из игры игрока на трёх местах,
 * а попаданий по телу персонажа в кадре нет.
 */

import { bodyToWorld, normalize, sub, thirdPersonViews, turnBetween } from "./combat-layout.js";
import { HIT_FLIGHT, HIT_HEADING, hitShooters, liveMarks, loopEvents } from "./combat-hits-plan.js";
import { createShotFx } from "./combat-shot-fx.js";

/** Ракурсы следов урона: за плечом и из глаз нашего персонажа. */
export const hitsViews = (layout) => thirdPersonViews({ head: layout.victimHead, forward: HIT_HEADING });

export function createHitsDirector(ctx) {
  const fx = createShotFx(ctx);
  /* Время сцены, секунды: идёт, пока кадр не на паузе, и растягивается замедлением. */
  let time = 0;
  let timing = { loopMs: 2200, spanMs: 1400 };
  let hits = [];
  let shots = 0;
  /* Стрелки с телами: оригинал и его двойники. */
  let crowd = [];
  let source = null;

  const shooters = hitShooters();

  /* Двойники стрелка: те же сетки, свои места. Вне раскладки живут только метки. */
  function dropCrowd() {
    for (const member of crowd) {
      if (member.actor?.isClone) {
        ctx.world.remove(member.actor);
        member.actor.dispose();
      }
    }
    crowd = [];
  }

  function buildCrowd(actor) {
    dropCrowd();
    if (!actor) return;
    crowd = shooters.map((shooter, index) => {
      if (index === 0) return { shooter, actor };
      const copy = actor.clone();
      ctx.world.add(copy);
      return { shooter, actor: copy };
    });
  }

  /* Места стрелков: по кругу вокруг игрока, лицом к нему; дуло — в мире. */
  function placeCrowd() {
    const layout = ctx.layout;
    if (!layout) return;
    for (const member of crowd) {
      const { actor, shooter } = member;
      const position = [shooter.position[0], shooter.position[1], actor.footLift];
      const toward = normalize(sub([layout.victim.position[0], layout.victim.position[1], 0], [position[0], position[1], 0]));
      const forward = actor.forward || [0, 1, 0];
      const yaw = turnBetween([forward[0], forward[1], 0], toward);
      const placement = { position, yaw };
      actor.setPlacement(placement);
      member.muzzle = bodyToWorld(actor.muzzle || [0.3, 0.55, 0.5], placement);
    }
  }

  function fire(member, lag) {
    shots += 1;
    const layout = ctx.layout;
    const seed = 0x4177 + shots * 7919;
    hits.push({ angle: member.shooter.angle, at: time - lag + HIT_FLIGHT });
    if (!member.muzzle || !layout || !fx.ready) return;
    const aim = layout.target;
    const direction = normalize(sub(aim, member.muzzle));
    const reach = Math.hypot(...sub(aim, member.muzzle));
    fx.flash({ origin: member.muzzle, direction, seed, lag });
    /* Пуля идёт на 187 к/с: чем чаще кадры игры, тем плотнее след. */
    fx.tracer({ from: member.muzzle, direction, reach, fps: 187, seed, lag });
  }

  return {
    get shooting() {
      return Boolean(ctx.layout);
    },
    get playing() {
      return fx.busy;
    },
    get activeShots() {
      return fx.liveCount;
    },
    get lastZone() {
      return null;
    },
    get failures() {
      return fx.failure ? [fx.failure] : [];
    },
    lookup: fx.lookup,
    setBase(base) {
      fx.setBase(base);
    },
    baseLight: () => null,
    bloomCap: 1,
    reset() {
      fx.reset();
      hits = [];
      time = 0;
      shots = 0;
    },
    /** Тела пришли (или ушли): двойники собираются заново. */
    onActors(actors) {
      source = actors?.shooter || null;
      buildCrowd(source);
    },
    onLayout() {
      /* Враги стоят по кругу: оригинал занял место у жертвы — его переставляет это же место. */
      placeCrowd();
    },
    views: hitsViews,
    shadowBox: () => ({ centre: [0, -1, 1], reach: 15 }),
    step(dt, shooting) {
      const previous = time;
      let changed = fx.step(dt);
      if (shooting) {
        time += dt;
        const loop = timing.loopMs / 1000;
        for (const event of loopEvents(previous, time, loop, shooters.map((shooter) => shooter.delay))) {
          fire(crowd[event.index] || { shooter: shooters[event.index] }, time - event.at);
          changed = true;
        }
      }
      return changed;
    },
    collect: (camera) => fx.collect(camera),
    dispose() {
      dropCrowd();
    },
    api: {
      /** Длина круга и жизнь одного попадания, мс — из проекта. */
      setTiming(next = {}) {
        timing = {
          loopMs: Number.isFinite(next.loopMs) && next.loopMs > 0 ? next.loopMs : timing.loopMs,
          spanMs: Number.isFinite(next.spanMs) && next.spanMs > 0 ? next.spanMs : timing.spanMs,
        };
      },
      /** Метки на экране сейчас: `[{ angle, elapsedMs }]`. */
      marks() {
        const live = liveMarks(hits, time, timing.spanMs);
        hits = live.hits;
        return live.marks;
      },
      /** Сколько стрелков стоит в кадре (три — с телами из игры). */
      crowdSize: () => crowd.length,
    },
  };
}
