/*
 * Сценарий выстрела на кадре игры (`docs/fx-scenes.md`, §6): по опорным точкам `scene.json` — что и когда рисуется. Чистая функция,
 * проверяется тестами; рисует это `frame-stage.js` правилами ядра игры игрока (`combat-shot-fx.js`) и клонами зон автора (`frame-hit-fx.js`).
 *
 * Мир — мир GTA (Z вверх), как в сцене: частицы ставятся в мировые точки опор, а камера кадра сама проецирует их на экран.
 *
 *   tracer — очередь («зажим»): полный магазин (30) в темпе ствола, каждый выстрел в свою точку веера `impacts[]`, потом перезарядка (≈2,5 с) — и снова,
 *            по кругу без конца, вспышка на каждый;
 *   hit    — та же очередь, но все пули — в тело или голову (`target.bone`): вспышка, след, эффект зоны автора в точке попадания;
 *   kill   — выстрел и экранный килл-эффект на «смерти»; кадры серии меняет шкала времени;
 *   screen-hit — полноэкранное наложение, 3D-частиц нет (очередь по краям экрана — `frame-screen-marks.js`, расписание то же).
 */
import { BULLET_SPEED } from "../combat-stage/combat-shot-fx.js";
import { DEFAULT_RPM, shotInterval } from "../combat-stage/combat-schedule.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v) => Math.hypot(v[0], v[1], v[2]);
const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const normalize = (v) => scale(v, 1 / (length(v) || 1));

/* Сколько секунд кадр держится после последнего события, прежде чем выстрел повторится. */
export const REST_SECONDS = 1.6;
/* Частота кадров игры, по которой ставятся штрихи следа: как у прежних сцен боя. */
export const GAME_FPS = 60;
/* Очередь, как в игре (владелец, 24.10 вечером): полный магазин карабина — 30 патронов в темпе ствола, перезарядка около 2,5 с (она идёт после
   последнего выстрела) и снова полный магазин, по кругу. */
export const MAGAZINE_SIZE = 30;
export const RELOAD_SECONDS = 2.5;
/* Выход пули стартует за точкой попадания по полёту на столько метров; у вида от лица жертвы его выводят к поверхности спины (`frame-stage.js`). */
export const EXIT_DEPTH = 0.2;
/* Кость сцены `hit` → зона редактора попаданий: «в тело» — `body`, «в голову» — `head`. */
export const ZONE_OF_BONE = Object.freeze({ chest: "body", head: "head" });
export const BONE_OF_ZONE = Object.freeze({ body: "chest", head: "head" });

/**
 * Один выстрел из дула в точку `to`: `{ direction, reach, flight }` или `null` (дула нет, или точка в дуле).
 */
export function bulletPath(muzzle, to, speed = BULLET_SPEED) {
  if (!muzzle || !to) return null;
  const offset = sub(to.world, muzzle.world);
  const reach = length(offset);
  if (!(reach > 0)) return null;
  return { direction: normalize(offset), reach, flight: reach / speed };
}

/** Сколько секунд длится один круг очереди: магазин в темпе ствола и перезарядка после последнего выстрела. */
export function burstCycle({ interval, magazine = MAGAZINE_SIZE, reload = RELOAD_SECONDS }) {
  return (magazine - 1) * interval + reload;
}

/** Когда начинается выстрел номер `index` очереди (секунды от первого): `magazine` выстрелов через `interval`, потом `reload`, и так по кругу. */
export function burstShotTime(burst, index) {
  const { interval, magazine = MAGAZINE_SIZE } = burst;
  return Math.floor(index / magazine) * burstCycle(burst) + (index % magazine) * interval;
}

/**
 * События k-го выстрела очереди: вспышка, след и попадание — в k-ю точку по кругу (веер `impacts[]` у трассера, одна точка у `hit`). Попадание — в стену
 * (`impact`), а у очереди «в тело / в голову» (`burst.zone`) — эффект зоны автора (`hit`).
 * @param {{ muzzle: object|null, points: object[], fps: number, speed: number, zone?: string|null, victimView?: boolean }} burst — `plan.burst`
 */
export function burstShot(burst, index) {
  const { muzzle, points, fps, speed, zone = null, victimView = false } = burst;
  if (!points.length) return [];
  const target = points[((index % points.length) + points.length) % points.length];
  const path = bulletPath(muzzle, target, speed);
  const steps = [];
  const back = path ? scale(path.direction, -1) : [0, -1, 0];
  if (muzzle) steps.push({ at: 0, kind: "flash", origin: muzzle.world, direction: muzzle.dir || path?.direction || [0, 1, 0] });
  if (path) steps.push({ at: 0, kind: "tracer", from: muzzle.world, direction: path.direction, reach: path.reach, fps });
  /* От лица жертвы камера стоит за её спиной: выход пули надо вывести к поверхности спины, иначе он спрятан в теле (`surface`, `frame-stage.js`). */
  steps.push({ at: path ? path.flight : 0, kind: zone ? "hit" : "impact", origin: target.world, direction: back, ...(zone ? { zone, ...(victimView ? { surface: true } : {}) } : {}) });
  return steps;
}

/** Какой кадр серии килла на экране в момент `seconds` от выстрела: последний, чей сдвиг уже наступил (0, если серии нет). */
export function frameIndexAt(frames, seconds) {
  let found = 0;
  (frames || []).forEach((frame, index) => {
    if (frame.offsetMs <= seconds * 1000 + 1e-6) found = index;
  });
  return found;
}

/**
 * @param {object} scene — разобранная сцена (`parseScene`)
 * @param {object} [options]
 * @param {number} [options.fps] — кадров игры в секунду (шаг штрихов следа)
 * @param {number} [options.speed] — скорость пули, м/с
 * @param {number} [options.rpm] — темп стрельбы, выстрелов в минуту (по умолчанию `scene.weapon.rpm`, иначе темп карабина игры)
 * @returns {{ mode: string, steps: object[], burst: object|null, duration: number, screen: object|null, zone: string|null }}
 *   `steps` — события одного выстрела (`flash`, `tracer`, `impact`, `hit`) по времени; `burst` — очередь трассера
 *   `{ interval, muzzle, points }`; `screen` — полноэкранное наложение; `duration` — когда выстрел отыграл, секунды.
 */
export function shotPlan(scene, { fps = GAME_FPS, speed = BULLET_SPEED, rpm = scene.weapon?.rpm || DEFAULT_RPM } = {}) {
  const { muzzle, target } = scene;
  const steps = [];
  let screen = null;
  let burst = null;
  let end = 0;
  let zone = null;
  const flash = (direction) => {
    if (muzzle) steps.push({ at: 0, kind: "flash", origin: muzzle.world, direction: muzzle.dir || direction || [0, 1, 0] });
  };
  /* Вспышка и след от дула к цели; `kind` — что случится у цели, когда пуля долетит (`hit` — зона автора, `none` — ничего). */
  const shot = (kind) => {
    const path = bulletPath(muzzle, target, speed);
    flash(path?.direction);
    if (path) steps.push({ at: 0, kind: "tracer", from: muzzle.world, direction: path.direction, reach: path.reach, fps });
    const flight = path ? path.flight : 0;
    if (target && kind !== "none") steps.push({ at: flight, kind, origin: target.world, direction: path ? scale(path.direction, -1) : [0, -1, 0], ...(kind === "hit" ? { zone } : {}) });
    end = flight;
    return flight;
  };
  switch (scene.mode) {
    case "tracer": {
      const points = scene.impacts?.length ? scene.impacts : target ? [target] : [];
      burst = { interval: shotInterval(rpm), magazine: MAGAZINE_SIZE, reload: RELOAD_SECONDS, muzzle, points, fps, speed };
      steps.push(...burstShot(burst, 0));
      end = Infinity;
      break;
    }
    case "hit":
      /* Магазин пуль в одну точку: каждая даёт вспышку, след и эффект зоны автора. */
      zone = ZONE_OF_BONE[target?.bone] || "body";
      burst = { interval: shotInterval(rpm), magazine: MAGAZINE_SIZE, reload: RELOAD_SECONDS, muzzle, points: target ? [target] : [], fps, speed, zone, victimView: scene.view === "victim" };
      steps.push(...burstShot(burst, 0));
      end = Infinity;
      break;
    case "kill": {
      /* Кровь килла — слой попаданий, он в своём редакторе; здесь вспышка и след, а экранный эффект идёт с моментом смерти. */
      const flight = muzzle ? shot("none") : 0;
      screen = { at: flight, kind: "kill", side: null };
      /* Серия кадров идёт дольше выстрела: сцена держится, пока не сменится последний кадр. */
      end = Math.max(flight, (scene.frames?.at(-1)?.offsetMs || 0) / 1000);
      break;
    }
    case "screen-hit":
      screen = { at: 0, kind: "screen-hit", side: "front" };
      flash();
      break;
    default:
      break;
  }
  return { mode: scene.mode, steps, burst, duration: end, screen, zone };
}

/** Один полный цикл показа одиночного выстрела: события + покой после них; очередь не кончается. */
export const cycleSeconds = (plan) => (plan.burst ? Infinity : plan.duration + REST_SECONDS);
