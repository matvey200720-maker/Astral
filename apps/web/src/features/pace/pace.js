/*
 * Общий темп хода «от 0 до 1» по этапам и ожидаемой длительности (18.11.2026): то, на чём стоят заставка запуска
 * (`features/onboarding/splash/contour-model.js`) и карточка загрузки сцены (`features/workshop/stage-loader/`), а позже —
 * «Загрузки». Чистые функции, без часов, холста и DOM: ход проверяется тестом (`test/pace.test.js`).
 *
 * Работа из N этапов делится на N лучей по 1/N. Настоящий счёт идёт ступенями: этап закрылся — ступень, а между ступенями
 * человек видел либо стоянку («до 70 % доходит, потом фриз»), либо рывок. Здесь ход ведётся по ожидаемому времени этапа:
 *
 *  • внутри луча цель идёт ровно, так, чтобы за ожидаемую длительность (`expect[k]`, мс — сглаженные длительности прошлых
 *    загрузок этого вида, `pace-memory.js`) пройти `reach` луча; дальше, если этап задерживается, цель плавно замедляется к
 *    потолку `ceiling` (узел луча — граница этапов — без закрытого этапа не пройден), но не встаёт;
 *  • этап закрылся раньше ожидаемого — ход догоняет узел ограниченным ускорением, позже — не прыгает при закрытии: скорость
 *    хода — состояние (`stepPace` сглаживает её за `CHASE.velocity` мс), а не производная цели;
 *  • настоящая доля внутри этапа (`partial`: листы текстур 3 из 10) поднимает цель, но не быстрее потолка;
 *  • к концу всей работы ход целится чуть дальше 1 и пересекает конец на ходу;
 *  • назад не идёт.
 *
 * 1 показывается только когда работа правда кончилась: пока `closed < count`, цель ниже узла следующего этапа.
 */

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Форма хода в долях луча: за ожидаемое время — `reach`, после `knee` скорость плавно падает к `ceiling`. */
export const RAY_PLAN = Object.freeze({
  reach: 0.68,
  knee: 0.56,
  ceiling: 0.96,
});
/** Как ход догоняет цель: к лучу — как в макете заставки, к концу — чуть быстрее; скорость сглаживается за `velocity` мс. */
export const CHASE = Object.freeze({ ray: 250, finish: 250, velocity: 110 });
/** К концу ход целится чуть дальше единицы и пересекает её на ходу, а не ползёт последние пиксели. */
export const FINISH_AIM = 1.03;

/**
 * Лучи хода для `count` этапов. Без `spans` лучи равные (заставка: четыре луча знака). С `spans` (ожидаемые длительности этапов,
 * мс) ширина луча пропорциональна длительности этапа: пока всё идёт по ожиданию, скорость хода одна на всех лучах — карточка
 * загрузки заполняется ровно, а не «быстро, медленно, быстро». `edges` — границы лучей от 0 до 1.
 */
export function planOf(count, spans = null, shape = RAY_PLAN) {
  const total = spans ? spans.reduce((sum, span) => sum + span, 0) : count;
  const edges = [0];
  for (let k = 0; k < count; k += 1)
    edges.push(k === count - 1 ? 1 : edges[k] + (spans ? spans[k] : 1) / total);
  const ray = 1 / count;
  return Object.freeze({
    count,
    total,
    edges: Object.freeze(edges),
    ray,
    shape,
    reach: shape.reach * ray,
    knee: shape.knee * ray,
    ceiling: shape.ceiling * ray,
  });
}

/**
 * Длительность этапа `index` (мс), которой верит ход: запомненная, зажатая в `min…max`; нет записи или она не число —
 * значение по умолчанию.
 */
export function spanOf(expect, index, { defaults, min, max }) {
  const asked = Number(expect?.[index]);
  return clamp(Number.isFinite(asked) ? asked : defaults[index], min, max);
}

/**
 * Куда тянется ход: `closed` закрытых этапов — `closed` лучей, плюс ползание вперёд за время `sinceMs` с последнего закрытия.
 * `limits` — `{ defaults, min, max }` для ожидаемых длительностей; `partial` — настоящая доля текущего этапа, 0…1; `cap` — потолок
 * (заставка при ошибке запуска).
 */
export function paceTarget(
  plan,
  closed,
  sinceMs,
  { expect, limits, partial = 0, cap = 1 },
) {
  if (closed >= plan.count) return 1;
  const span = spanOf(expect, closed, limits);
  const raw = (plan.reach * Math.max(0, sinceMs)) / span;
  const { knee, ceiling } = plan;
  const travel =
    raw <= knee
      ? raw
      : knee + (ceiling - knee) * Math.tanh((raw - knee) / (ceiling - knee));
  const known = Math.min(ceiling, Math.max(0, Math.min(1, partial)) * plan.ray);
  return Math.min(closed * plan.ray + Math.max(travel, known), cap);
}

/** Шаг хода: уровень и его скорость (доли хода в секунду) через `dtMs`. На закрытии этапа скорость растёт, а не прыгает. */
export function stepPace(level, velocity, target, dtMs) {
  const finishing = target >= 1;
  const aim = finishing ? FINISH_AIM : target;
  const wanted =
    (aim - level) / ((finishing ? CHASE.finish : CHASE.ray) / 1000);
  const v =
    velocity + (wanted - velocity) * (1 - Math.exp(-dtMs / CHASE.velocity));
  const next = level + ((velocity + v) / 2) * (dtMs / 1000);
  if (finishing && next >= 1) return { level: 1, velocity: 0 };
  return { level: next, velocity: v };
}

/** Забег хода: всё, что он помнит между шагами. Время `T` — мс от начала; `mark` — когда закрылся последний этап. */
export function createPaceRun(count, startMs = 0) {
  return {
    T: 0,
    L: 0,
    V: 0,
    closed: 0,
    mark: startMs,
    closedAt: Array.from({ length: count + 1 }, (_, k) => (k ? Infinity : 0)),
  };
}

/**
 * Шаг забега на `dt` мс. Вход: `closed` — сколько этапов закрыто подряд с первого, `partial` — настоящая доля текущего этапа,
 * `done` — вся работа кончилась (ход целится в конец), `expect` и `limits` — как у `paceTarget`. Назад ход не идёт.
 */
export function advancePace(plan, run, dt, input) {
  const T = run.T + dt;
  const closed = input.done ? plan.count : clamp(input.closed, 0, plan.count);
  const grew = closed > run.closed;
  const mark = grew ? T : run.mark;
  const partial = Math.max(input.partial ?? 0, grew ? 0 : (run.partial ?? 0));
  const target = paceTarget(plan, closed, T - mark, {
    expect: input.expect,
    limits: input.limits,
    partial,
    cap: input.cap ?? 1,
  });
  const stepped = stepPace(run.L, run.V, target, dt);
  const closedAt = run.closedAt.slice();
  for (let k = run.closed + 1; k <= closed; k += 1) closedAt[k] = T;
  return {
    T,
    L: Math.max(run.L, stepped.level),
    V: stepped.level < run.L ? 0 : stepped.velocity,
    closed: Math.max(run.closed, closed),
    mark,
    partial,
    closedAt,
  };
}

/**
 * Длительности этапов этого забега (мс от закрытия предыдущего; первый — от `startMs`) — то, что запоминает `pace-memory.js`.
 * `null`, если какой-то этап не закрыт.
 */
export function paceDurations(run, startMs = 0) {
  const at = run.closedAt.slice(1);
  if (!at.every(Number.isFinite)) return null;
  let before = startMs;
  return at.map((moment) => {
    const span = Math.max(0, moment - before);
    before = Math.max(before, moment);
    return span;
  });
}

/**
 * Траектория вперёд при неизменном входе: нужна, чтобы полосу вело не главным потоком (анимация `transform` на композиторе), а
 * готовым рядом точек, и показанное число брало то же значение по времени. Возвращает `{ samples, end }`: `samples[i]` —
 * `[мс от сейчас, уровень, скорость]` через каждые `sampleMs`, `end` — забег в конце горизонта.
 */
export function paceTrajectory(
  plan,
  run,
  input,
  { horizonMs = 4000, sampleMs = 50, stepMs = 25 } = {},
  advance = advancePace,
) {
  const samples = [[0, run.L, run.V]];
  let state = run;
  let at = 0;
  while (at < horizonMs) {
    const dt = Math.min(stepMs, horizonMs - at);
    state = advance(plan, state, dt, input);
    at += dt;
    if (at % sampleMs < 1e-9 || at >= horizonMs)
      samples.push([at, state.L, state.V]);
  }
  return { samples, end: state };
}

/*
 * Ход «сколько осталось» — для карточки загрузки сцены (18.11.2026). Ход по лучам (`advancePace`) нужен заставке: её лучи — этапы
 * на знаке, и узел зажигается с закрытием этапа. Полоса загрузки не привязана к этапам геометрией, ей нужна ровная скорость, и
 * `advanceToGo` даёт её без сборки из лучей: скорость хода — `(цель − уровень) / сколько ещё ждать`, цель — `TO_GO.goal`.
 * «Сколько ещё ждать» (`restOf`, мс) — остаток идущего этапа плюс ожидаемые длительности следующих:
 *
 *  • всё по ожиданию — остаток идущего этапа убывает на столько, на сколько идут часы, и скорость хода постоянна: никаких ступеней;
 *  • этап закрылся раньше — остаток исчезает, ход плавно ускоряется (скорость — состояние, сглаживается за `TO_GO.velocity` мс);
 *  • этап идёт дольше ожидаемого — остаток растёт вместе с ожиданием (`TO_GO.overrun` мс на каждую лишнюю мс), и ход замедляется
 *    плавно, а не упирается в потолок: полоса не бежит к цели и не стоит у неё на секунды (так было, пока остаток считался от
 *    потолка этапа, — на долгой загрузке «97 % и стоим»);
 *  • настоящая доля внутри этапа (`partial`: листы 3 из 10) поправляет остаток: сколько ушло на долю — столько уйдёт на
 *    остальное; когда «всего» листов растёт, доля падает, остаток растёт — ход замедляется, назад уровень не идёт;
 *  • до конца ход не доходит до единицы: единица — только когда работа правда кончилась (`done`), и ход пересекает её на ходу.
 */
export const TO_GO = Object.freeze({
  goal: 0.97,
  velocity: 200,
  minRemainingMs: 250,
  maxFactor: 3,
  /** Остаток идущего этапа не меньше этой доли его ожидаемой длительности, пока он идёт по ожиданию (конец этапа не обещает финиша). */
  reserve: 0.12,
  /** Этап дольше ожидаемого: на каждую лишнюю мс ожидания остаток растёт на столько мс. */
  overrun: 1,
  /** С какой доли внутри этапа остаток считается по настоящему счёту целиком (ниже — смесь с ожиданием по часам). */
  counted: 0.25,
});

/** Забег «сколько осталось»: как `createPaceRun`, но ход стартует с базовой скоростью, а не с нуля (нет разгона в начале). */
export function createToGoRun(plan, startMs = 0) {
  const run = createPaceRun(plan.count, startMs);
  return { ...run, V: (TO_GO.goal / plan.total) * 1000 };
}

/** Ожидаемая длительность этапа `k` (мс) по плану. */
const spanAt = (plan, k) => (plan.edges[k + 1] - plan.edges[k]) * plan.total;

/**
 * Сколько ещё ждать (мс) в миг `T` при `closed` закрытых этапах: идущий этап `closed` начался в `closedAt[closed]`, `partial` — его
 * настоящая доля (0…1, 0 — счёта нет). Ноль — когда все этапы закрыты.
 */
export function restOf(plan, closedAt, closed, T, partial = 0) {
  if (closed >= plan.count) return 0;
  const span = spanAt(plan, closed);
  const inStage = Math.max(0, T - closedAt[closed]);
  const floor = TO_GO.reserve * span;
  const left = span - inStage;
  const byClock =
    left > floor
      ? left
      : floor + TO_GO.overrun * Math.max(0, inStage - (span - floor));
  const share = clamp(partial, 0, 1 - TO_GO.reserve);
  const byCount = share > 0 ? (inStage * (1 - share)) / share : byClock;
  const trust = clamp(share / TO_GO.counted, 0, 1);
  const here = trust * byCount + (1 - trust) * byClock;
  return here + (1 - plan.edges[closed + 1]) * plan.total;
}

/** Шаг забега «сколько осталось» на `dt` мс. Вход — как у `advancePace` (`closed`, `partial`, `done`). Назад ход не идёт. */
export function advanceToGo(plan, run, dt, input) {
  const T = run.T + dt;
  const closed = input.done ? plan.count : clamp(input.closed, 0, plan.count);
  const grew = closed > run.closed;
  const partial = input.partial ?? 0;
  const closedAt = run.closedAt.slice();
  for (let k = run.closed + 1; k <= closed; k += 1) closedAt[k] = T;
  /* Работы стало больше, чем казалось (листов «всего» прибавилось после «все готово»): этап открывается заново, отсчёт его начала
     прежний — ожидание и настоящая доля вместе дают честный остаток. */
  if (closed < run.closed)
    for (let k = closed + 1; k <= run.closed; k += 1) closedAt[k] = Infinity;
  let wanted;
  if (closed >= plan.count)
    wanted = (FINISH_AIM - run.L) / (CHASE.finish / 1000);
  else {
    const remaining = Math.max(
      TO_GO.minRemainingMs,
      restOf(plan, closedAt, closed, T, partial),
    );
    wanted = Math.min(
      Math.max(((TO_GO.goal - run.L) / remaining) * 1000, 0),
      ((TO_GO.maxFactor * TO_GO.goal) / plan.total) * 1000,
    );
  }
  const v = run.V + (wanted - run.V) * (1 - Math.exp(-dt / TO_GO.velocity));
  const next = run.L + ((run.V + v) / 2) * (dt / 1000);
  const finished = closed >= plan.count && next >= 1;
  return {
    T,
    L: finished ? 1 : Math.max(run.L, next),
    V: finished ? 0 : v,
    closed,
    mark: grew ? T : run.mark,
    partial,
    closedAt,
  };
}
