/*
 * Регулятор диска (20.11.2026, слово владельца: «диск не должен долбиться в сотку, он должен ограничиваться на 50 %… ни на последнем этапе, ни на каком… для абсолютно каждого ПК, как
 * любой установщик»).
 *
 * До сегодняшнего дня Astral щадил диск вслепую: потолки МБ/с по замеру диска (`disk-profile.js`), отдых после большой операции (`disk-care.js`), ступень ввода-вывода процесса.
 * Обратной связи не было нигде: всё это не знало, что диск уже занят чужой программой или что запись, лёгшая в кэш системы, сбросится всплеском уже после нашего `write`.
 * Занятость в Диспетчере задач («Активное время») — это 100 минус доля времени, когда у диска не было ни одного запроса; её и держит регулятор.
 *
 * Устройство — один регулятор на приложение, по диску:
 *   — датчик (`disk-sensor.js`) раз в секунду отдаёт активное время, очередь и отклик каждого физического диска; окно 1–2 с;
 *   — на диск заведена одна «доля обычной скорости» `scale` от `floorScale` до 1. Обычная скорость — то, что уже стоит в режиме установки (потолки `storage-manager.js`, отдых
 *     `disk-care.js`); регулятор только добавляет уступчивость и никогда не быстрее прежнего. Выше цели (50 %) доля падает быстро, ниже — растёт медленно: «сбрасывает быстро,
 *     растёт плавно». Чужая нагрузка в ту же сторону: диск занят чужим — доля падает до нижнего порога, установка идёт медленно, но не встаёт;
 *   — писатели и читатели берут решение отсюда: отдых после операции (`restFactor`), потолки для движка и сборок (`limits`), пауза между пачками мелких файлов (`gate`).
 *     Сам регулятор ничего не пишет и не читает — только считает;
 *   — «Быстрая установка» (`setActive(false)`) снимает всё сразу: доля 1, ворота открыты, потолков нет. Датчик не отвечает или отстал — тоже доля 1 («как раньше»), без ошибок.
 * Байты не меняются, только время.
 */

import { appendFileSync } from "node:fs";

export const GOVERNOR_ENV = "ASTRAL_DISK_GOVERNOR";
/** Целевая занятость диска в обычном режиме, %. */
export const TARGET_BUSY = 50;
/**
 * Ниже этой доли обычной скорости регулятор не опускает (решение ведущей 20.11: обычная установка не должна становиться дольше примерно вдвое-втрое даже на плохом диске; где цель 50 % и пол
 * спорят — пол выигрывает, и отчёт это говорит). Отдых после операции при полу — не больше 4 длин самой операции.
 */
export const FLOOR_SCALE = 0.4;
/** Потолок скорости не ниже этой доли того, что реально шло по диску, пока регулятор не вмешивался (тот же пол, но по скорости). */
export const FLOOR_SPEED_SHARE = 0.4;
/** Нижние пороги скорости, МБ/с: на любой доле потолок записи и чтения не меньше. */
export const FLOOR_WRITE_MBPS = 8;
export const FLOOR_READ_MBPS = 16;
/** Сколько датчик может молчать, пока ему верят, мс. */
export const SENSOR_STALE_MS = 5000;
/** Отдых между большими операциями при долях ниже 1 не длиннее, мс (при доле 1 — прежние 2000 в `disk-care.js`). */
export const MAX_REST_MS = 6000;
/** Датчик останавливается, когда работы с диском не было столько, мс: постоянный процесс опроса бездельничающему приложению не нужен. */
export const SENSOR_IDLE_MS = 20000;

/* Отклик диска, мс, выше которого диск считается перегруженным, даже если «занят» ещё не сто: у SSD норма — доли миллисекунды, у жёсткого диска — до десятка. */
export const HOT_LATENCY_MS = 50;
const OVER_MARGIN = 5;
const TOUCH_REFRESH_MS = 1000;
/* Выученная скорость (МБ/с, при которой активное время ≈ цели): берётся с отсчётов, где диск заметно занят и по нему идёт наш поток; сглаживается; для ответа нужно не меньше отсчётов. */
const LEARN_MIN_BUSY = 20;
const LEARN_MIN_MBPS = 4;
const LEARN_EMA = 0.3;
const LEARN_MIN_SAMPLES = 3;
const LEARN_CLAMP = [1, 20000];
const LEARN_RELEASE = 1.5;
/* Выше потолка режима (250/500 МБ/с) отпускать нечего: рост выученного останавливается здесь, МБ/с. */
const LEARN_RELEASE_MAX = 1000;
const LEARN_CHANGE = 0.15;
const UNDER_MARGIN = 10;
const SATURATED = 90;
const GROW_STEP = 0.05;
const GROW_FAST_STEP = 0.1;
const GROW_FAST_FACTOR = 1.5;
const SMOOTHING = 0.6;
/*
 * Чужая нагрузка (замечание тестового ПК 20.11, `docs/DISK-GOVERNOR-TESTPC-2011.md`, раздел 5): лёгкая соседка (запись 4 КБ со сбросом по кругу, 10–20 МБ/с) одна держит счётчик «Активное время» на 60–65 % при
 * отклике диска 0,1 мс. Занятость, которую мы не можем снять, не должна растягивать установку.
 * 1) «Шум»: отклик ≤ 1 мс и очередь ≤ 2 — диск отзывчив и очереди нет, сколько бы процентов ни показывал счётчик (большие блоки быстрее 1 мс не бывают); такие секунды не считаются нагрузкой, не учат опору и выученное, а упёршийся в потолок ход отпускают.
 * 2) «Не помогло — отпусти»: доля упала до 0,6 и ниже, а занятость не пошла следом (осталась не ниже 0,8 от прежней) — её держит не Astral: запоминаем её как чужую (`foreignBase`), цель поднимается
 *    на запас над ней (не выше 82 %: секунды выше 90 всё равно уходят), а при чужой занятости выше цели + 10 доля не опускается ниже 0,5.
 */
const NOISE_MAX_LATENCY_MS = 1;
const NOISE_MAX_QUEUE = 2;
const FOREIGN_LOW_SCALE = 0.6;
const FOREIGN_LOW_SECONDS = 4;
const FOREIGN_LEVER = 0.8;
const FOREIGN_HEADROOM = 12;
const FOREIGN_MAX_TARGET = 82;
const FOREIGN_FUTILE_OVER = 10;
/*
 * Мягкий сторож «Быстрой установки» (20.11, слово владельца: быстро, но диск не в сотку): цель не 50 %, а «не держать сотку подряд». Срабатывает только на насыщении — занятость ≥ 95 % И отклик ≥ 8 мс
 * или очередь ≥ 4 три секунды подряд (на быстром NVMe с большими блоками при сотке отклик доли миллисекунды — диск отзывчив, не трогаем); сбрасывает немного (доля не ниже 0,8), держит
 * срез 5 секунд и отпускает сразу, когда занятость ниже 92 %. Потолок среза — от того, что шло по диску в насыщении, а не от номинальных чисел. Только потолки писателей: отдыха и ворот в «Быстрой» нет.
 */
export const GUARD_ENV = "ASTRAL_DISK_GUARD";
export const GUARD_FLOOR_SCALE = 0.8;
const GUARD_BUSY = 95;
const GUARD_RELEASE_BUSY = 92;
const GUARD_LATENCY_MS = 8;
const GUARD_QUEUE = 4;
const GUARD_SECONDS = 3;
const GUARD_HOLD_SECONDS = 5;
/** Нижняя доля, когда занятость держит не Astral: «ниже половины обычной скорости не опускаться». */
export const FUTILE_FLOOR_SCALE = 0.5;
/* Самый сильный спад за один шаг: доля не падает быстрее, чем вдвое. */
const MAX_DROP = 0.5;
const MIN_DROP = 0.9;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Слово выключателя → `true` (включено), `false` (выключено) или `null` (не задано: решает канал). */
export function governorSwitch(value) {
  const word = String(value ?? "")
    .trim()
    .toLowerCase();
  if (word === "") return null;
  if (["0", "off", "false", "no", "нет"].includes(word)) return false;
  return true;
}

/**
 * Следующая доля обычной скорости по занятости диска. Чистая функция: тесты и регулятор считают одним кодом.
 * `busy` — сглаженная занятость, %; `peak` — последняя секунда без сглаживания.
 */
export function nextScale(
  scale,
  { busy, peak = busy, prevPeak = 0 },
  { target = TARGET_BUSY, floor = FLOOR_SCALE } = {},
) {
  /* Секунда в сотку сама по себе не повод падать вдвое: это сброс чужой или нашей прежней записи. Вдвое — когда сглажено ≥ 90 или сотка две секунды подряд. */
  const saturated =
    busy >= SATURATED || (peak >= SATURATED && prevPeak >= SATURATED);
  if (saturated) return clamp(scale * MAX_DROP, floor, 1);
  if (busy > target + OVER_MARGIN)
    return clamp(scale * clamp(target / busy, MAX_DROP, MIN_DROP), floor, 1);
  if (busy < target - UNDER_MARGIN)
    /* Свободно — растём быстро, множителем: путь от пола до 1 за секунды, а не за четверть минуты. */
    return clamp(
      busy < target / 2
        ? Math.max(scale * GROW_FAST_FACTOR, scale + GROW_FAST_STEP)
        : scale + GROW_STEP,
      floor,
      1,
    );
  return clamp(scale, floor, 1);
}

/** Буквы томов в имени физического диска Windows («0 C:» → C; «1 D: E:» → D, E; «C:» → C). */
const lettersOfDisk = (name) =>
  [...String(name).matchAll(/(^|\s)([A-Za-z]):/g)].map((found) =>
    found[2].toUpperCase(),
  );

/** Имя физического диска Windows («0 C:», «1 D: E:») содержит букву тома. */
const volumeLetter = (place) => {
  const match = /^([A-Za-z]):/.exec(
    String(place ?? "").replace(/^\\\\\?\\/, ""),
  );
  return match ? match[1].toUpperCase() : null;
};
const diskHasVolume = (diskName, letter) =>
  new RegExp(`(^|\\s)${letter}:`, "i").test(diskName);

/**
 * Регулятор. Часы и сон подставляются в тестах. `sensor` — `{ start(), stop(), subscribe(listener) → отписка }`; без датчика регулятор ничего не меняет.
 */
export function createDiskGovernor({
  now = () => performance.now(),
  sleep = null,
  target = TARGET_BUSY,
  floor = FLOOR_SCALE,
  staleMs = SENSOR_STALE_MS,
  idleMs = SENSOR_IDLE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  trace = null,
} = {}) {
  const timer = sleep || ((ms, signal) => abortableSleep(ms, signal));
  const disks = new Map();
  const listeners = new Set();
  const learnedListeners = new Set();
  const pendingSeeds = new Map();
  let sensor = null;
  let unsubscribe = null;
  let active = false;
  let guardMode = false;
  let sensorOk = false;
  let lastSampleAt = -Infinity;
  let failures = 0;
  let disabledReason = null;
  let sensorRunning = false;
  let idleTimer = null;
  let touchedAt = -Infinity;
  let holds = 0;

  const fresh = () =>
    active && !disabledReason && sensorOk && now() - lastSampleAt <= staleMs;
  /* Датчик — чужой код (процесс, модуль): его сбой регулятор не роняет, а считает отказом датчика. */
  const callSensor = (method, ...args) => {
    try {
      if (method === "start") sensorRunning = true;
      if (method === "stop") sensorRunning = false;
      return sensor?.[method]?.(...args);
    } catch {
      failures += 3;
      sensorOk = false;
      return undefined;
    }
  };
  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        /* слушатель не должен ронять регулятор */
      }
    }
  };

  function stateOf(name) {
    let state = disks.get(name);
    if (!state) {
      state = {
        scale: 1,
        busy: 0,
        smoothed: 0,
        queue: 0,
        latMs: 0,
        readMBps: 0,
        writeMBps: 0,
        refRead: 0,
        refWrite: 0,
        learnRead: 0,
        learnWrite: 0,
        learnSamples: 0,
        learnReported: { read: 0, write: 0 },
        rawBusy: 0,
        rawSmoothed: 0,
        noise: false,
        hiBusy: 0,
        lowRun: 0,
        foreignBase: 0,
        satRun: 0,
        guardHold: 0,
        satRead: 0,
        satWrite: 0,
        at: -Infinity,
      };
      /* Выученное в прошлых запусках — по буквам томов диска (`seedLearned`). */
      for (const letter of lettersOfDisk(name)) {
        const seed = pendingSeeds.get(letter);
        if (seed && !state.learnSamples) {
          state.learnWrite = seed.write;
          state.learnRead = seed.read;
          state.learnSamples = LEARN_MIN_SAMPLES;
          state.learnReported = { read: seed.read, write: seed.write };
        }
      }
      disks.set(name, state);
    }
    return state;
  }

  /** Цель с поправкой на чужую занятость: запас над ней, но не выше 82 % (секунды выше 90 всё равно уходят) и не ниже обычной цели. */
  const effectiveTarget = (state) =>
    state.foreignBase > 0
      ? clamp(state.foreignBase + FOREIGN_HEADROOM, target, FOREIGN_MAX_TARGET)
      : target;
  /** Пол доли: чужая занятость выше цели + 10 — ниже половины обычной скорости не опускаемся (наше снижение ей не поможет). */
  const floorFor = (state) =>
    state.foreignBase > target + FOREIGN_FUTILE_OVER
      ? Math.max(floor, FUTILE_FLOOR_SCALE)
      : floor;

  /**
   * Сторож «Быстрой»: насыщение (≥ 95 % и отклик/очередь выше порога) три секунды подряд — доля 0,8 на 5 секунд; не насыщение и занятость ниже 92 % — доля 1 сразу. Скорости насыщения
   * запоминаются: от них считается потолок среза.
   */
  function guardStep(state, measured, latMs, queue, noise) {
    const hot =
      !noise &&
      measured >= GUARD_BUSY &&
      (latMs >= GUARD_LATENCY_MS || queue >= GUARD_QUEUE);
    if (hot) {
      state.satRun += 1;
      if (state.scale >= 0.95) {
        const ema = (current, seen) =>
          seen >= LEARN_MIN_MBPS
            ? current > 0
              ? current * 0.7 + seen * 0.3
              : seen
            : current;
        state.satWrite = ema(state.satWrite, state.writeMBps);
        state.satRead = ema(state.satRead, state.readMBps);
      }
      if (state.satRun >= GUARD_SECONDS) {
        state.scale = GUARD_FLOOR_SCALE;
        state.guardHold = GUARD_HOLD_SECONDS;
      }
      return;
    }
    if (measured >= GUARD_RELEASE_BUSY) return;
    state.satRun = 0;
    if (state.guardHold > 0) {
      state.guardHold -= 1;
      return;
    }
    state.scale = 1;
  }

  /** Новый отсчёт датчика: `{ t, disks: { имя: { busy, queue, latMs } } }`. */
  function feed(sample) {
    if (!sample?.disks) return;
    lastSampleAt = now();
    sensorOk = true;
    failures = 0;
    let moved = false;
    for (const [name, value] of Object.entries(sample.disks)) {
      const measured = Number(value?.busy);
      if (!Number.isFinite(measured)) continue;
      const state = stateOf(name);
      const latMs = Number(value.latMs);
      const queue = Number(value.queue) || 0;
      const readMBps = Number(value.readMBps) || 0;
      const writeMBps = Number(value.writeMBps) || 0;
      /* «Шум»: отклик, очередь и поток известны датчику, и они у покоя — диск свободен, сколько бы процентов ни показывал счётчик (чужая мелкая запись со сбросом). Нет отклика или потока у датчика — не шум. */
      const noise =
        latMs > 0 && latMs <= NOISE_MAX_LATENCY_MS && queue <= NOISE_MAX_QUEUE;
      /* Отклик диска выше предела при заметной занятости — тоже «горячо»: очередь на диске растёт, а «занят» ещё может быть ниже сотни. */
      let busy =
        latMs >= HOT_LATENCY_MS && measured >= 40
          ? Math.max(measured, SATURATED + 1)
          : measured;
      if (noise) busy = Math.min(busy, target / 2 - 1);
      const previous = state.busy;
      const previousScale = state.scale;
      state.rawBusy = measured;
      state.rawSmoothed =
        state.at === -Infinity
          ? measured
          : SMOOTHING * measured + (1 - SMOOTHING) * state.rawSmoothed;
      state.noise = noise;
      state.busy = busy;
      state.smoothed =
        state.at === -Infinity
          ? busy
          : SMOOTHING * busy + (1 - SMOOTHING) * state.smoothed;
      state.queue = queue;
      state.latMs = Number(value.latMs) || 0;
      state.readMBps = readMBps;
      state.writeMBps = writeMBps;
      state.at = lastSampleAt;
      /* Диск упёрся в сотку, а идёт меньше прежнего «обычного хода», — значит, он стал медленнее (кончился буфер SLC): опора и пол по скорости считаются от того, что он отдаёт теперь. */
      if (busy >= SATURATED) {
        if (
          state.writeMBps >= LEARN_MIN_MBPS &&
          state.writeMBps < state.refWrite
        )
          state.refWrite = state.writeMBps;
        if (state.readMBps >= LEARN_MIN_MBPS && state.readMBps < state.refRead)
          state.refRead = state.readMBps;
      }
      if (guardMode) {
        guardStep(state, measured, latMs, queue, noise);
        if (state.scale !== previousScale) moved = true;
        continue;
      }
      /* Диск свободен (шум или занятость ниже порога): упёршийся в потолок ход отпускаем; иначе учимся. */
      if (noise || state.smoothed < effectiveTarget(state) - UNDER_MARGIN)
        releaseCap(state);
      else
        learn(
          state,
          busy,
          effectiveTarget(state),
          state.foreignBase > target + FOREIGN_FUTILE_OVER,
        );
      /* Что шло по диску, пока доля была 1, — опора для потолка там, где потолка режима нет (чтение движка на быстром диске): затем она стоит, пока регулятор держит диск. Секунды «шума» опору не учат: чужие 22 МБ/с — не наш ход. */
      if (state.scale >= 0.95 && !noise) {
        state.refRead = Math.max(state.refRead * 0.98, state.readMBps);
        state.refWrite = Math.max(state.refWrite * 0.98, state.writeMBps);
      }
      if (state.scale >= 0.95)
        state.hiBusy = Math.max(state.hiBusy * 0.98, state.rawSmoothed);
      /* Не помогло — отпусти: доля давно низкая, а занятость не пошла за ней — её держит не Astral. */
      if (state.scale <= FOREIGN_LOW_SCALE) {
        state.lowRun += 1;
        if (state.lowRun >= FOREIGN_LOW_SECONDS && state.hiBusy > 0) {
          const lever = state.rawSmoothed / Math.max(state.hiBusy, 1);
          if (
            lever >= FOREIGN_LEVER &&
            state.rawSmoothed > target + OVER_MARGIN
          )
            state.foreignBase =
              state.foreignBase > 0
                ? 0.7 * state.foreignBase + 0.3 * state.rawSmoothed
                : state.rawSmoothed;
          else if (lever < FOREIGN_LEVER) state.foreignBase *= 0.9;
        }
      } else state.lowRun = 0;
      /* Чужая занятость уходит вниз вслед за диском: пока занятость не ниже запомненной, она та же; стала ниже — соседка стихла. */
      if (state.foreignBase > 0 && state.rawSmoothed < state.foreignBase)
        state.foreignBase = 0.8 * state.foreignBase + 0.2 * state.rawSmoothed;
      if (state.foreignBase < 1) state.foreignBase = 0;
      if (active && !disabledReason) {
        const next = nextScale(
          state.scale,
          { busy: state.smoothed, peak: busy, prevPeak: previous },
          { target: effectiveTarget(state), floor: floorFor(state) },
        );
        if (next !== state.scale) moved = true;
        state.scale = next;
      }
    }
    if (moved || learnChanged) emit();
    if (learnChanged) {
      learnChanged = false;
      for (const listener of learnedListeners) {
        try {
          listener(learnedSnapshot());
        } catch {
          /* слушатель не должен ронять регулятор */
        }
      }
    }
    trace?.({ kind: "sample", t: Date.now(), disks: snapshot().disks });
  }

  function releaseCap(state) {
    /* Диск свободен (шум или занятость ниже цели − запас), а выученный потолок стоит ниже потолка режима: потолок занижен — выучен на шаге, где байт дороже по диску (снятие слоя против подготовки), или под чужой нагрузкой. Отпускаем его ×1,5 в секунду, не дожидаясь, пока диск нагреется. Ход, виденный датчиком, не условие: чтения из кэша файлов идут под потолком движка, а диска не касаются. */
    const release = (current) =>
      current > 0
        ? clamp(current * LEARN_RELEASE, LEARN_CLAMP[0], LEARN_RELEASE_MAX)
        : current;
    const write = release(state.learnWrite);
    const read = release(state.learnRead);
    if (write === state.learnWrite && read === state.learnRead) return;
    state.learnWrite = write;
    state.learnRead = read;
    const moved = (now, before) =>
      before === 0 ? now > 0 : Math.abs(now - before) / before >= LEARN_CHANGE;
    if (
      state.learnSamples >= LEARN_MIN_SAMPLES &&
      (moved(state.learnWrite, state.learnReported.write) ||
        moved(state.learnRead, state.learnReported.read))
    ) {
      state.learnReported = { read: state.learnRead, write: state.learnWrite };
      learnChanged = true;
    }
  }

  /* Скорость, при которой активное время было бы целью: что идёт по диску сейчас, помноженное на цель/занятость. Чужая нагрузка сюда попадает и занижает её — так и надо, мы уступаем. */
  function learn(state, busy, goal = target, onlyUp = false) {
    if (!active || disabledReason || busy < LEARN_MIN_BUSY) return;
    const factor = goal / busy;
    const one = (current, seen) => {
      if (!(seen >= LEARN_MIN_MBPS)) return current;
      const estimate = seen * factor;
      /* Диск держит чужая нагрузка: выученное не снижаем (оно считало бы чужую занятость нашей), только поднимаем. */
      if (onlyUp && current > 0 && estimate < current) return current;
      return clamp(
        current > 0
          ? current * (1 - LEARN_EMA) + estimate * LEARN_EMA
          : estimate,
        LEARN_CLAMP[0],
        LEARN_CLAMP[1],
      );
    };
    state.learnWrite = one(state.learnWrite, state.writeMBps);
    state.learnRead = one(state.learnRead, state.readMBps);
    state.learnSamples += 1;
    const moved = (now, before) =>
      before === 0 ? now > 0 : Math.abs(now - before) / before >= LEARN_CHANGE;
    if (
      state.learnSamples >= LEARN_MIN_SAMPLES &&
      (moved(state.learnWrite, state.learnReported.write) ||
        moved(state.learnRead, state.learnReported.read))
    ) {
      state.learnReported = { read: state.learnRead, write: state.learnWrite };
      learnChanged = true;
    }
  }
  let learnChanged = false;

  const snapshot = () => ({
    active,
    enabled: !disabledReason,
    disabledReason,
    sensorOk: fresh(),
    target,
    disks: Object.fromEntries(
      [...disks].map(([name, state]) => [
        name,
        {
          scale: state.scale,
          busy: Math.round(state.smoothed),
          rawBusy: Math.round(state.rawBusy),
          noise: state.noise,
          foreign: Math.round(state.foreignBase),
          queue: state.queue,
          latMs: state.latMs,
          readMBps: Math.round(state.readMBps),
          writeMBps: Math.round(state.writeMBps),
        },
      ]),
    ),
  });

  /* Диски, на которых лежат места; места без буквы тома (сетевые) и неизвестные — не знаем, доля 1. */
  function disksOfPlaces(places) {
    const letters = [
      ...new Set((places || []).map(volumeLetter).filter(Boolean)),
    ];
    if (!letters.length) return [];
    return [...disks].filter(([name]) =>
      letters.some((letter) => diskHasVolume(name, letter)),
    );
  }

  /* Диски мест; место не названо — все известные. */
  const watchedDisks = (places) =>
    places === null || places === undefined
      ? [...disks]
      : disksOfPlaces(Array.isArray(places) ? places : [places]);

  /** Доля обычной скорости для мест: самая малая среди их дисков (операция, что трогает два диска, идёт со скоростью более занятого). */
  function scaleFor(places) {
    if (!fresh()) return 1;
    let scale = 1;
    /* Место не названо — берём все диски, о которых знаем: самый занятый решает. */
    const watched =
      places === null || places === undefined
        ? [...disks]
        : disksOfPlaces(Array.isArray(places) ? places : [places]);
    for (const [, state] of watched) scale = Math.min(scale, state.scale);
    return scale;
  }

  /** Во сколько раз отдых после операции длиннее операции: 1 — как было («столько же»), на доле 0,1 — 19. */
  const restFactor = (places) => 2 / scaleFor(places) - 1;

  /** Потолки для движка и сборок из обычных: `base` — `{ writeMbps, readMbps }` режима (`0` или `null` — потолка нет); `observed` — что сейчас идёт по диску, МБ/с (для «нет потолка»). */
  function limits(base, places, { observed = null } = {}) {
    const scale = scaleFor(places);
    /* Выученная скорость заменяет номинальный потолок режима (250/500 МБ/с на диске, что отдаёт 70, ничего не держат): берётся меньшее. Только в обычном режиме. */
    const learned =
      active && !disabledReason && !guardMode ? learnedFor(places) : null;
    if (!observed) {
      const watched =
        places === null || places === undefined
          ? [...disks]
          : disksOfPlaces(Array.isArray(places) ? places : [places]);
      observed = {
        readMbps: watched.reduce(
          (sum, [, state]) => sum + (guardMode ? state.satRead : state.refRead),
          0,
        ),
        writeMbps: watched.reduce(
          (sum, [, state]) =>
            sum + (guardMode ? state.satWrite : state.refWrite),
          0,
        ),
      };
    }
    /* «Своя скорость» на этом диске — потолок режима, не выше того, что реально шло по диску (пока по диску не шло ничего — выученное). Пол потолка — доля её (не число): выученное, порча чужой нагрузкой и доля регулятора ниже него не опускают. */
    const ownSpeed = (nominal, seen, learnedValue) =>
      seen > 0
        ? nominal > 0
          ? Math.min(nominal, seen)
          : seen
        : learnedValue > 0
          ? learnedValue
          : nominal;
    const floorOf = (floorAbs, nominal, seen, learnedValue) =>
      Math.max(
        floorAbs,
        ownSpeed(nominal, seen, learnedValue) > 0
          ? Math.floor(
              ownSpeed(nominal, seen, learnedValue) * FLOOR_SPEED_SHARE,
            )
          : 0,
      );
    const capOf = (nominal, learnedValue, floorMbps) =>
      learnedValue > 0
        ? nominal > 0
          ? Math.min(nominal, Math.max(learnedValue, floorMbps))
          : Math.max(learnedValue, floorMbps)
        : nominal || 0;
    const nominalWrite = base?.writeMbps || 0;
    const nominalRead = base?.readMbps || 0;
    const writeFloor = floorOf(
      FLOOR_WRITE_MBPS,
      nominalWrite,
      observed?.writeMbps,
      learned?.write,
    );
    const readFloor = floorOf(
      FLOOR_READ_MBPS,
      nominalRead,
      observed?.readMbps,
      learned?.read,
    );
    const out = {
      scale,
      writeMbps: capOf(nominalWrite, learned?.write, writeFloor),
      readMbps: capOf(nominalRead, learned?.read, readFloor),
    };
    if (scale >= 1) return out;
    const apply = (cap, floorMbps, seen) => {
      /* Опора — не выше того, что реально шло по диску, пока доля была 1: потолок режима (250 МБ/с), которого диск и не достигал, ничего не держит, и доля уходила бы вниз вхолостую. */
      const reference =
        cap > 0 ? (seen > 0 ? Math.min(cap, seen) : cap) : seen > 0 ? seen : 0;
      /* Пол от выученного (больше потолка режима) потолок режима не обходит: ограничен итог здесь, а не `ownSpeed`, чтобы пол и опора считались как раньше, а потолок режима был последним словом. */
      if (!(reference > 0)) return cap;
      const stepped = Math.max(floorMbps, Math.floor(reference * scale));
      return cap > 0 ? Math.min(cap, stepped) : stepped;
    };
    out.writeMbps = apply(out.writeMbps, writeFloor, observed?.writeMbps);
    out.readMbps = apply(out.readMbps, readFloor, observed?.readMbps);
    return out;
  }

  /**
   * Ворота для работы пачками (распаковка тысяч мелких файлов, уборка): диск горячее цели — подождать. Ждёт не дольше `maxMs`; без датчика, в «Быстрой» и при
   * доле 1 с чистым диском — не ждёт вовсе.
   */
  async function gate(places, { signal = null, maxMs = 1500 } = {}) {
    touch();
    if (!fresh() || guardMode) return 0;
    let waited = 0;
    for (let round = 0; round < 4; round += 1) {
      const scale = scaleFor(places);
      const hot = watchedDisks(places).some(
        ([, state]) => state.smoothed > effectiveTarget(state) + OVER_MARGIN,
      );
      if (scale >= 1 && !hot) break;
      const wait = Math.min(
        maxMs - waited,
        Math.round(250 / Math.max(scale, floor)),
      );
      if (wait <= 0) break;
      await timer(wait, signal);
      waited += wait;
    }
    return waited;
  }

  /* Выученное по местам: самое медленное среди дисков (операция на двух дисках идёт со скоростью более медленного). Дисков ещё не видели — выученное из прошлых запусков по буквам томов. */
  function learnedFor(places) {
    const letters = [
      ...new Set((places || []).map(volumeLetter).filter(Boolean)),
    ];
    let write = 0;
    let read = 0;
    const take = (w, r) => {
      if (w > 0) write = write > 0 ? Math.min(write, w) : w;
      if (r > 0) read = read > 0 ? Math.min(read, r) : r;
    };
    if (places === null || places === undefined) {
      for (const [, state] of disks)
        if (state.learnSamples >= LEARN_MIN_SAMPLES)
          take(state.learnWrite, state.learnRead);
      for (const seed of pendingSeeds.values()) take(seed.write, seed.read);
    } else {
      for (const letter of letters) {
        const states = [...disks].filter(([name]) =>
          diskHasVolume(name, letter),
        );
        if (states.length) {
          for (const [, state] of states)
            if (state.learnSamples >= LEARN_MIN_SAMPLES)
              take(state.learnWrite, state.learnRead);
        } else {
          const seed = pendingSeeds.get(letter);
          if (seed) take(seed.write, seed.read);
        }
      }
    }
    return write > 0 || read > 0 ? { write, read } : null;
  }

  /** Что выучено: по диску — имя, буквы томов, скорости записи и чтения, МБ/с, сколько отсчётов. Для хранения между запусками. */
  function learnedSnapshot() {
    return [...disks]
      .filter(
        ([, state]) =>
          state.learnSamples >= LEARN_MIN_SAMPLES &&
          (state.learnWrite > 0 || state.learnRead > 0),
      )
      .map(([name, state]) => ({
        name,
        letters: lettersOfDisk(name),
        write: Math.round(state.learnWrite),
        read: Math.round(state.learnRead),
        samples: state.learnSamples,
      }));
  }

  /** Выученное в прошлых запусках: `[{ letters: ["C"], write, read }]`. Диск ещё не виден датчику — запись ждёт его первого отсчёта; ограничение диска для первой же команды берётся отсюда. */
  function seedLearned(entries) {
    for (const entry of entries || []) {
      const write =
        Number(entry?.write) > 0
          ? clamp(Number(entry.write), LEARN_CLAMP[0], LEARN_CLAMP[1])
          : 0;
      const read =
        Number(entry?.read) > 0
          ? clamp(Number(entry.read), LEARN_CLAMP[0], LEARN_CLAMP[1])
          : 0;
      if (!write && !read) continue;
      for (const letter of (entry.letters || []).map((value) =>
        String(value).toUpperCase(),
      )) {
        pendingSeeds.set(letter, { write, read });
        for (const [name, state] of disks) {
          if (diskHasVolume(name, letter) && !state.learnSamples) {
            state.learnWrite = write;
            state.learnRead = read;
            state.learnSamples = LEARN_MIN_SAMPLES;
            state.learnReported = { read, write };
          }
        }
      }
    }
  }

  /** Работа с диском идёт: поднять датчик, если он стоял, и отложить его остановку. Без обычного режима и при выключении — ничего. */
  function touch() {
    if (!active || disabledReason || !sensor) return;
    if (!sensorRunning) callSensor("start");
    /* Зовут на каждый блок записи (сотни в секунду): таймер простоя переставляем не чаще раза в секунду. */
    const time = now();
    if (idleTimer && time - touchedAt < TOUCH_REFRESH_MS) return;
    touchedAt = time;
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = setTimer(() => {
      idleTimer = null;
      /* Работа ещё идёт (команда движка, помощник): датчик не гасим, таймер заводим заново. */
      if (holds > 0) {
        touchedAt = -Infinity;
        touch();
        return;
      }
      callSensor("stop");
      for (const state of disks.values()) {
        state.scale = 1;
        state.at = -Infinity;
      }
      emit();
    }, idleMs);
    idleTimer?.unref?.();
  }

  const dropIdleTimer = () => {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = null;
  };

  /**
   * Работа с диском, которая идёт долго без своих «касаний» (команда движка на 30 секунд, помощник .NET): пока она держится, датчик не засыпает. Ответ — «отпустить» (один раз).
   */
  function hold() {
    holds += 1;
    touch();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds = Math.max(0, holds - 1);
      touch();
    };
  }

  return {
    touch,
    hold,
    learnedFor,
    learnedSnapshot,
    seedLearned,
    /** Подписка на заметные сдвиги выученного (для хранения между запусками); ответ — отписка. */
    onLearned(listener) {
      learnedListeners.add(listener);
      return () => learnedListeners.delete(listener);
    },
    /** Запись в журнал регулятора (`ASTRAL_DISK_GOVERNOR_TRACE`): стенды видят, какие потолки были и когда. Без журнала — ничего. */
    note(record) {
      trace?.({ ...record, t: Date.now() });
    },
    attach(next) {
      unsubscribe?.();
      callSensor("stop");
      dropIdleTimer();
      sensor = next;
      sensorOk = false;
      lastSampleAt = -Infinity;
      unsubscribe = callSensor("subscribe", feed) ?? null;
    },
    /** `true` — обычный режим, регулятор работает; `false` — «Быстрая установка»: доля везде 1. */
    setActive(next) {
      const value = next === true;
      const wasGuard = guardMode;
      guardMode = false;
      if (value === active && !wasGuard) return;
      if (wasGuard && value)
        for (const state of disks.values()) state.scale = 1;
      active = value;
      if (!active) {
        dropIdleTimer();
        for (const state of disks.values()) state.scale = 1;
        callSensor("stop");
      }
      emit();
    },
    /** Мягкий сторож «Быстрой установки» (`ASTRAL_DISK_GUARD`): датчик работает, доля падает только на насыщении; `true` — включить, `false` — выключить (как `setActive(false)`). */
    setGuard(next) {
      if (next !== true) {
        if (guardMode) this.setActive(false);
        return;
      }
      if (guardMode && active) return;
      guardMode = true;
      active = true;
      for (const state of disks.values()) {
        state.scale = 1;
        state.satRun = 0;
        state.guardHold = 0;
      }
      emit();
    },
    isGuard: () => guardMode && active && !disabledReason,
    /** Аварийное выключение: доля 1, датчик остановлен; возврат — `enable()`. */
    disable(reason = "выключено") {
      disabledReason = String(reason);
      dropIdleTimer();
      for (const state of disks.values()) state.scale = 1;
      callSensor("stop");
      emit();
    },
    enable() {
      disabledReason = null;
      emit();
    },
    /** Датчик сообщил об отказе: три подряд — датчик считается недоступным (доля 1) до следующего удачного отсчёта. */
    sensorFailed() {
      failures += 1;
      if (failures >= 3) {
        sensorOk = false;
        for (const state of disks.values()) state.scale = 1;
        emit();
      }
    },
    feed,
    scaleFor,
    restFactor,
    limits,
    gate,
    snapshot,
    isActive: () => active && !disabledReason,
    /** Подписка на смену долей; возвращает отписку. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    }
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/**
 * Пауза между пачками мелких файлов (распаковка, укладка, проверка тысяч файлов): диск горячее цели — подождать; регулятор выключен, диск свободен или датчика нет — не ждёт.
 * `place` — папка, куда идёт работа (по ней выбирается диск); без неё — самый занятый из известных.
 */
export const governedPause = (place, options) =>
  shared.gate(place ? [place] : null, options);

/* Единственный регулятор приложения: писатели (`disk-care.js`, копии, сборки) берут решение отсюда. Потоку копии и процессам сборки долю передаёт хозяин (`restScale`). */
/* Журнал регулятора для стендов: `ASTRAL_DISK_GOVERNOR_TRACE=<файл>` — по строке JSON на отсчёт датчика и на смену потолков. */
function traceToFile(file) {
  const target = String(file ?? "").trim();
  if (!target) return null;
  return (record) => {
    try {
      appendFileSync(target, `${JSON.stringify(record)}\n`);
    } catch {
      /* журнал — не повод ронять установку */
    }
  };
}

let shared = createDiskGovernor({
  trace: traceToFile(process.env.ASTRAL_DISK_GOVERNOR_TRACE),
});
export const diskGovernor = () => shared;
/** Стендам и тестам: подставить свой регулятор; без аргумента — новый настоящий. */
export function setDiskGovernorForTests(governor = null) {
  shared = governor || createDiskGovernor();
}
