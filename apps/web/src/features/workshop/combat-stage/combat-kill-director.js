/*
 * Режим «килл-эффект» 3D-сцены боя (задача 4А, 18.10.2026): наш персонаж с
 * оружием из игры стреляет во врага, враг падает, и поверх кадра встаёт эффект
 * убийства — слои постобработки, что рисует `kill-effect-painter.js`.
 *
 * Время ведёт шкала редактора: `api.setMoment(мс после килла)`. Ноль —
 * убивающий выстрел; пока шкала бежит вперёд, очередь стреляется вспышкой дула
 * и следом пули (`combat-shot-fx.js`), враг падает ходом `fallProgress`
 * (`combat-kill-plan.js`). Перемотка шкалы руками ставит врага в позу того
 * момента и новых выстрелов не делает.
 *
 * Не снимок из GTA: падение — поворот тела из игры, а не анимация игры. Рана на
 * враге и брызги на земле — по данным игры (`combat-decals.js`), частиц крови нет.
 */

import { sub, normalize, thirdPersonViews } from "./combat-layout.js";
import { KILL_SHOT_TIMES, fallProgress, shotsCrossed, toppleFor } from "./combat-kill-plan.js";
import { createShotFx } from "./combat-shot-fx.js";

/** Расстояние от нашего персонажа до врага, м. */
export const KILL_SEPARATION = 9;

/** Ракурсы килла: за плечом и из глаз нашего персонажа — он тот, кто стреляет. */
export const killViews = (layout) =>
  thirdPersonViews({ head: layout.shooterHead, forward: layout.direction, aim: layout.target });

export function createKillDirector(ctx) {
  const fx = createShotFx(ctx);
  let moment = 0;
  let previous = Number.NEGATIVE_INFINITY;
  let shots = 0;
  let applied = "";

  /* Поза врага в `moment`: падение вокруг ступней, которые остаются на месте. */
  function poseEnemy() {
    const enemy = ctx.victim;
    const layout = ctx.layout;
    if (!enemy || !layout) return false;
    const progress = fallProgress(moment);
    const key = `${progress.toFixed(4)}|${enemy.footLift}`;
    if (key === applied) return false;
    applied = key;
    const { tilt, lean, position } = toppleFor(progress, enemy.footLift);
    enemy.setPlacement({ position, yaw: layout.victim.yaw, tilt, lean });
    return true;
  }

  function fire(lag) {
    const layout = ctx.layout;
    if (!layout || !fx.ready) return;
    shots += 1;
    const seed = 0x6b11 + shots * 7919;
    const direction = layout.direction;
    const reach = Math.hypot(...sub(layout.target, layout.muzzle));
    fx.flash({ origin: layout.muzzle, direction: normalize(direction), seed, lag });
    fx.tracer({ from: layout.muzzle, direction: normalize(direction), reach, fps: 187, seed, lag });
    /* Рана на враге и брызги на земле: тело едет вместе с декалями, когда падает. */
    const enemy = ctx.victim;
    const through = enemy && ctx.decals ? enemy.pierce(layout.muzzle, direction) : null;
    if (through) ctx.decals.strike({ victim: enemy, through, direction: normalize(direction), zone: "body", seed, floorZ: 0 });
  }

  return {
    /* Выстрелами правит шкала, а не часы сцены. */
    get shooting() {
      return false;
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
      previous = Number.NEGATIVE_INFINITY;
      applied = "";
      ctx.decals?.clear();
    },
    onLayout() {
      applied = "";
      poseEnemy();
    },
    views: killViews,
    shadowBox: () => ({ centre: [0, -KILL_SEPARATION / 2, 1], reach: KILL_SEPARATION / 2 + 3 }),
    step(dt) {
      return fx.step(dt);
    },
    collect: (camera) => fx.collect(camera),
    api: {
      /**
       * Шкала редактора: `momentMs` — мс после килла. Вперёд на шаг — очередь
       * стреляет; скачок или шаг назад — только поза врага.
       */
      setMoment(momentMs) {
        if (!Number.isFinite(momentMs)) return;
        const before = previous;
        moment = momentMs;
        previous = momentMs;
        /* Шкалу отмотали назад — ран ещё нет: их поставят выстрелы, когда шкала дойдёт до них снова. */
        if (momentMs < before) ctx.decals?.clear();
        let changed = poseEnemy();
        for (const shot of shotsCrossed(before, momentMs, KILL_SHOT_TIMES)) {
          fire(Math.max(0, (momentMs - shot.at) / 1000));
          changed = true;
        }
        if (changed) ctx.mark();
      },
    },
  };
}
