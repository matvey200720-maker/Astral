/*
 * Ровный ход установки (владелец, 18.11.2026): «чтобы не просто до 70 % доходит, потом фриз, и там быстро прогружается — от 1 до 100 с одинаковой скоростью».
 *
 * Откуда рывки. Движок шлёт процент по своей шкале (`packages/install-engine`): скачивание 2…84 % по байтам, потом разом 88 (проверка) и 90 (подготовка),
 * тишина, пока собираются записи пакета, потом 99 и подмена архива, тоже на 99. У числа в окне выходили скачок на стыке, долгая стоянка на 90 и вторая — на 99.
 *
 * Чистая математика темпа, без окна и таймеров (время приходит снаружи, как в `splash/contour-model.js`):
 *   • три этапа — «скачивание» (по доле байт), «проверка и сборка» (движок молчит), «запись в игру» (по скопированным байтам, пока их шлют);
 *   • вес этапа — его ожидаемая длительность из памяти запусков (`readExpect`/`rememberRun`, по размеру пакета), без памяти — значения по умолчанию;
 *   • показанное число идёт с ровной скоростью между «уже точно есть» (пол: этап начался, байты пришли) и «потолком» (конец этапа минус запас) — этап без числа
 *     ползёт вперёд по ожидаемой длительности и у потолка не встаёт, а замедляется; настоящее завершение этапа подтягивает число сразу, но ограниченной скоростью;
 *   • число не обгоняет настоящий ход (потолок этапа, у измеряемого — пол плюс запас), не идёт назад, скорость меняется плавно.
 */

const MB = 1024 * 1024;

export const STAGE_COUNT = 3;
export const MEMORY_KEY = "astral-install-pace";
/** Доля прежнего значения при сглаживании: новая установка сдвигает ожидание на 40 %. */
const KEEP = 0.6;
/** Одна необычная установка (диск проснулся, сеть упала) не тянет ожидание дальше этого множителя прежнего значения. */
const OUTLIER = 2.5;
const SPAN_MIN = 300;
const SPAN_MAX = 600_000;

/** Ожидаемые длительности этапов (мс) по размеру пакета, пока памяти нет: скачивание, проверка и сборка, запись в игру. */
export const EXPECT_DEFAULT = Object.freeze({
  S: Object.freeze([3500, 2200, 2200]),
  M: Object.freeze([14000, 6000, 6000]),
  L: Object.freeze([45000, 22000, 14000]),
});

/* Темп. Скорости — проценты шкалы в секунду; `nominal` — скорость, с которой вся шкала пройдена за ожидаемое время. */
const PACE = Object.freeze({
  /** Ползущий этап: за ожидаемую длительность число проходит эту долю полосы этапа с постоянной скоростью; остальное — запас на случай, если этап затянулся
      (дальше замедляется как u / (1 + u), но не встаёт). Этап кончился в срок — недостающее подтягивается без скачка. */
  reach: 0.85,
  /** Запас до конца этапа: число не доходит до границы, пока движок не сказал, что этап кончился (процент шкалы). */
  marginMax: 1,
  marginShare: 0.08,
  /** На сколько измеряемый этап может опередить настоящую долю (процент шкалы). */
  lookahead: 1.2,
  /** Во сколько раз можно обогнать номинальную скорость, подтягиваясь к новому полу. */
  catchup: 3.5,
  /** То же к настоящей скорости измеряемого этапа. */
  followRate: 1.6,
  /** Конец: подтянуться до 100 быстрее обычного. */
  finish: 8,
  /** Постоянные времени, с: хвост за целью у измеряемого и у ползущего этапа; сглаживание самой скорости. */
  tauMeasured: 0.6,
  tauCreep: 0.4,
  tauVelocity: 0.5,
  /** Прирост доли за одно событие больше этого — не скорость сети (файлы, что уже лежали, засчитаны разом): в скорость не идёт. */
  jumpFraction: 0.06,
  /** Кадр длиннее — окно было свёрнуто: шаг не растягивается на секунды. */
  maxStepMs: 1000,
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finiteOr = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Ведро размера пакета: S — до 25 МБ, M — до 250 МБ, L — больше. Размер неизвестен — M. */
export function sizeBucket(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "M";
  if (size < 25 * MB) return "S";
  return size < 250 * MB ? "M" : "L";
}

function browserStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Ожидаемые длительности трёх этапов (мс) для ведра: то, что запомнено, иначе по умолчанию; каждое значение в пределах `SPAN_MIN…SPAN_MAX`. */
export function readExpect(bucket, storage = browserStore()) {
  const fallback = EXPECT_DEFAULT[bucket] || EXPECT_DEFAULT.M;
  try {
    const saved = JSON.parse(storage?.getItem(MEMORY_KEY) ?? "null");
    const list = saved?.v === 1 ? saved.b?.[bucket] : null;
    if (!Array.isArray(list) || list.length !== STAGE_COUNT)
      return [...fallback];
    return list.map((value, index) => {
      const span = Number(value);
      return Number.isFinite(span) && span > 0
        ? clamp(span, SPAN_MIN, SPAN_MAX)
        : fallback[index];
    });
  } catch {
    return [...fallback];
  }
}

/** Запомнить установку: `durations` — результат `paceDurations`. Вернёт, записалось ли; мусор, неполная и неудачная установка не записываются. */
export function rememberRun(bucket, durations, storage = browserStore()) {
  if (
    !EXPECT_DEFAULT[bucket] ||
    !Array.isArray(durations) ||
    durations.length !== STAGE_COUNT ||
    !durations.every((span) => Number.isFinite(span) && span >= 0)
  )
    return false;
  try {
    const before = readExpect(bucket, storage);
    const next = durations.map((span, index) =>
      Math.round(
        KEEP * before[index] +
          (1 - KEEP) *
            clamp(span, SPAN_MIN, Math.min(SPAN_MAX, before[index] * OUTLIER)),
      ),
    );
    const saved = JSON.parse(storage.getItem(MEMORY_KEY) ?? "null");
    const buckets =
      saved?.v === 1 && saved.b && typeof saved.b === "object" ? saved.b : {};
    storage.setItem(
      MEMORY_KEY,
      JSON.stringify({ v: 1, b: { ...buckets, [bucket]: next } }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Какому этапу принадлежит событие движка: 0 — скачивание, 1 — проверка и сборка, 2 — запись в игру, `"done"` — конец, `null` — события без шага.
 * Те же фазы у снятия и сброса (подготовка → сборка → `ready-to-commit` → `commit`), поэтому шкала годится и им.
 */
export function stageOfEvent(event) {
  const phase = String(event?.phase || "").toLowerCase();
  if (!phase) return null;
  if (/complete/.test(phase)) return "done";
  if (/commit|final|finish/.test(phase)) return 2;
  if (/download|write|extract|copy/.test(phase)) return 0;
  return 1;
}

/** Доля измеряемого этапа в событии: скачивание — `fraction`, запись — скопированные байты; `null`, если события числа не несут. */
function measuredFraction(stage, event) {
  if (stage === 0) {
    const value = Number(event?.fraction);
    return event?.fraction !== undefined &&
      event?.fraction !== null &&
      Number.isFinite(value)
      ? clamp(value, 0, 1)
      : null;
  }
  if (stage === 2) {
    const total = Number(event?.totalBytes);
    const copied = Number(event?.copiedBytes);
    return total > 0 && Number.isFinite(copied)
      ? clamp(copied / total, 0, 1)
      : null;
  }
  return null;
}

function layout(expect, skipDownload) {
  const spans = expect.map((span, index) =>
    index === 0 && skipDownload
      ? 0
      : clamp(finiteOr(span, 1000), SPAN_MIN, SPAN_MAX),
  );
  const sum = spans.reduce((a, b) => a + b, 0) || 1;
  const bounds = [0];
  spans.forEach((span) =>
    bounds.push(bounds[bounds.length - 1] + (span / sum) * 100),
  );
  bounds[STAGE_COUNT] = 100;
  return { spans, bounds, nominal: 100 / (sum / 1000) };
}

/** Новый ход установки. `expect` — ожидаемые длительности этапов (мс), `now` — миллисекунды любого отсчёта (дальше тот же). */
export function createPace({ expect = EXPECT_DEFAULT.M, now = 0 } = {}) {
  const base = layout(expect, false);
  return {
    expect: [...expect],
    ...base,
    stage: -1,
    enteredAt: [null, null, null],
    frac: null,
    rate: 0,
    fracAt: now,
    shown: 0,
    vel: 0,
    at: now,
    born: now,
    done: false,
    skippedDownload: false,
    durations: [null, null, null],
  };
}

function enter(state, stage, now) {
  const durations = state.durations.slice();
  const enteredAt = state.enteredAt.slice();
  if (
    state.stage >= 0 &&
    enteredAt[state.stage] !== null &&
    durations[state.stage] === null
  )
    durations[state.stage] = Math.max(0, now - enteredAt[state.stage]);
  enteredAt[stage] = now;
  return {
    ...state,
    stage,
    enteredAt,
    durations,
    frac: null,
    rate: 0,
    fracAt: now,
  };
}

/** Принять событие движка. Событие без шага шаг не меняет; запоздавшее событие прошлого этапа числа не двигает. */
export function feedPace(state, event, now) {
  let current = state;
  const wanted = stageOfEvent(event);
  if (current.done) {
    if (wanted === "done") return current;
    /* Новая попытка под тем же номером операции: ход начинается заново. */
    current = createPace({ expect: current.expect, now });
  }
  if (wanted === "done") {
    /* Конец без записи в игру (операции без неё): недостающие этапы закрываются одним моментом, прежний этап `enter` запоминает сам. */
    const next = current.stage < 2 ? enter(current, 2, now) : current;
    const durations = next.durations.slice();
    if (
      next.stage >= 0 &&
      next.enteredAt[next.stage] !== null &&
      durations[next.stage] === null
    )
      durations[next.stage] = Math.max(0, now - next.enteredAt[next.stage]);
    return { ...next, durations, done: true, stage: STAGE_COUNT };
  }
  if (current.stage < 0) {
    const first = wanted === null ? 0 : wanted;
    if (first > 0) {
      const base = layout(current.expect, true);
      current = { ...current, ...base, skippedDownload: true };
    }
    current = enter(current, first, now);
  } else if (wanted !== null && wanted > current.stage) {
    current = enter(current, wanted, now);
  }
  const stage = current.stage;
  const reported =
    wanted === null || wanted === stage ? measuredFraction(stage, event) : null;
  if (reported === null) return current;
  const frac = Math.max(current.frac ?? 0, reported);
  const dt = Math.max(1, now - current.fracAt) / 1000;
  const grown = current.frac === null ? 0 : frac - current.frac;
  const steady = grown > 0 && grown <= PACE.jumpFraction;
  const rate = steady
    ? current.rate
      ? 0.7 * current.rate + 0.3 * (grown / dt)
      : grown / dt
    : current.rate;
  return { ...current, frac, rate, fracAt: now };
}

/** Ползущий этап: x — доля ожидаемой длительности, ответ — доля полосы этапа (0…1). До x = 1 — прямая до `reach`, дальше замедляется и никогда не встаёт. */
export function creep(x) {
  const { reach } = PACE;
  if (x <= 1) return Math.max(0, x) * reach;
  const u = ((x - 1) * reach) / (1 - reach);
  return reach + (1 - reach) * (u / (1 + u));
}

/** Шаг хода: новое состояние с `shown` (0…100) и скоростью. Время `now` — то же, что у `feedPace`. */
export function stepPace(state, now) {
  const dtMs = clamp(now - state.at, 0, PACE.maxStepMs);
  if (dtMs <= 0 || state.stage < 0)
    return { ...state, at: Math.max(state.at, now) };
  const dt = dtMs / 1000;
  let target;
  let cap;
  let tau;
  let vmax = PACE.catchup * state.nominal;
  if (state.done) {
    target = 100;
    cap = 100;
    tau = PACE.tauCreep;
    vmax = PACE.finish * state.nominal;
  } else {
    const lo = state.bounds[state.stage];
    const hi = state.bounds[state.stage + 1];
    const span = hi - lo;
    const margin = Math.min(PACE.marginMax, span * PACE.marginShare);
    const floor = lo + span * (state.frac ?? 0);
    if (state.frac !== null) {
      target = floor;
      cap = Math.min(hi - margin, floor + PACE.lookahead);
      tau = PACE.tauMeasured;
      vmax = Math.max(vmax, PACE.followRate * span * state.rate);
    } else {
      const expected = state.expect[state.stage] || 1000;
      const x = Math.max(0, now - state.enteredAt[state.stage]) / expected;
      target = Math.max(floor, lo + (span - margin) * creep(x));
      cap = hi - margin;
      tau = PACE.tauCreep;
    }
    cap = Math.max(cap, floor);
  }
  const wanted = clamp((target - state.shown) / tau, 0, vmax);
  const vel =
    state.vel +
    (wanted - state.vel) * (1 - Math.exp(-dtMs / 1000 / PACE.tauVelocity));
  let shown = state.shown + ((state.vel + vel) / 2) * dt;
  shown = clamp(Math.max(shown, state.shown), 0, cap);
  const stopped = shown >= cap - 1e-9;
  return { ...state, shown, vel: stopped ? 0 : Math.max(0, vel), at: now };
}

/** Доля этапа `index` (0…1) по показанному числу — для полос героя. */
export function paceShare(state, index) {
  const lo = state.bounds[index];
  const hi = state.bounds[index + 1];
  return hi > lo
    ? clamp((state.shown - lo) / (hi - lo), 0, 1)
    : state.shown >= hi
      ? 1
      : 0;
}

/** Длительности трёх этапов (мс) законченной установки для памяти запусков; `null` — не дошла до конца, без скачивания или этап не наблюдался. */
export function paceDurations(state) {
  if (!state.done || state.skippedDownload) return null;
  return state.durations.every((span) => Number.isFinite(span) && span >= 20)
    ? state.durations
    : null;
}
