/*
 * Метки следов урона на кадре игры (`docs/fx-scenes.md`, режим `screen-hit`): кадр чистый, частиц нет — след на экране рисует
 * то же полноэкранное наложение, что и в редакторе «Эффекты попадания на экране» (`paintScreenHitMarks`).
 *
 * По игроку стреляют очередью, как в игре (владелец, 24.10 вечером): полный магазин карабина — 30 попаданий в темпе ствола, каждое со своей
 * стороны и у края экрана (слева, справа, сверху), потом перезарядка (≈2,5 с) — и снова магазин, по кругу. Расписание то же, что у очереди
 * трассера и попадания (`frame-shot-plan.js`). Чистая функция времени, проверяется тестами.
 */
import { DEFAULT_RPM, shotInterval } from "../combat-stage/combat-schedule.js";
import { screenHitsEnvelope, screenHitsSpan } from "../screen-hits-editor/screen-hits-painter.js";
import { MAGAZINE_SIZE, RELOAD_SECONDS, burstCycle, burstShotTime } from "./frame-shot-plan.js";

/*
 * Откуда стреляют по игроку: углы от центра экрана (0 — вправо, по часовой, y вниз), след встаёт у края в эту сторону. Слева, справа, сверху и
 * между ними; снизу следов нет (игра ставит их по бокам и сверху). Порядок такой, что подряд идущие попадания — с разных сторон.
 */
export const SCREEN_EDGE_ANGLES = Object.freeze([
  Math.PI, // слева
  0, // справа
  -Math.PI / 2, // сверху
  -Math.PI + 0.55, // слева-сверху
  -0.55, // справа-сверху
  -2.05, // сверху-слева
  -1.1, // сверху-справа
  Math.PI - 0.4, // слева, чуть ниже середины
]);

/** Откуда пришло попадание номер `index` магазина. Шаг 3 взаимно прост с восемью углами — все они идут по кругу. */
export const screenHitAngle = (index) => SCREEN_EDGE_ANGLES[(((index * 3) % SCREEN_EDGE_ANGLES.length) + SCREEN_EDGE_ANGLES.length) % SCREEN_EDGE_ANGLES.length];

/** Расписание очереди по игроку: `{ interval, magazine, reload }`; темп — ствола кадра (`scene.weapon.rpm`), иначе карабина игры. */
export function screenHitsBurst({ rpm = DEFAULT_RPM } = {}) {
  return { interval: shotInterval(rpm), magazine: MAGAZINE_SIZE, reload: RELOAD_SECONDS };
}

/** Длина круга очереди (магазин и перезарядка), мс: по ней крутится наложение. */
export const screenHitsBurstLoop = (options) => burstCycle(screenHitsBurst(options)) * 1000;

/** Сколько миллисекунд после попадания след виден сильнее всего (первый такой момент). */
export function screenHitPeak(project) {
  const span = screenHitsSpan(project);
  let best = 0;
  let level = -1;
  for (let step = 0; step <= 40; step += 1) {
    const elapsed = (span * step) / 40;
    const value = screenHitsEnvelope(project, elapsed);
    if (value > level + 1e-9) {
      level = value;
      best = elapsed;
    }
  }
  return best;
}

/**
 * Метки в момент `moment` круга очереди (мс от первого выстрела): по одной на каждое ещё видное попадание магазина, `angle` — откуда стреляли,
 * `elapsedMs` — сколько прошло с его попадания; новее — позже в списке (рисуются сверху). Попадание, что не успело догореть до конца круга,
 * дорисовывается в начале следующего: круг замкнут.
 * `moment = null` — три метки на пике, слева, справа и сверху: первый кадр редактора и стоящая сцена не пусты.
 * @returns {Array<{ angle: number, elapsedMs: number }>}
 */
export function screenHitMarks(project, moment = null, options = {}) {
  if (moment === null) {
    const peak = screenHitPeak(project);
    return SCREEN_EDGE_ANGLES.slice(0, 3).map((angle) => ({ angle, elapsedMs: peak }));
  }
  const burst = screenHitsBurst(options);
  const loop = burstCycle(burst) * 1000;
  const span = screenHitsSpan(project);
  const marks = [];
  for (let index = 0; index < burst.magazine; index += 1) {
    /* Выстрел, чей момент лёг на «сейчас» с погрешностью дробей (−1e-12 мс), уже наступил, а не отстаёт на целый круг. */
    const since = moment - burstShotTime(burst, index) * 1000;
    const settled = since < 0 && since > -1e-6 ? 0 : since;
    const elapsedMs = ((settled % loop) + loop) % loop;
    if (elapsedMs < span) marks.push({ angle: screenHitAngle(index), elapsedMs });
  }
  /* Старые — снизу, новые — сверху (у попаданий круга порядок выстрелов и порядок возраста могут разойтись). */
  return marks.sort((left, right) => right.elapsedMs - left.elapsedMs);
}
