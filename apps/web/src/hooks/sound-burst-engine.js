import { burstSchedule } from "../features/catalog/sound-burst.js";

/*
 * Очередь выстрелов на Web Audio (владелец, 16.11.2026). Звук скачивается и разбирается ОДИН раз на адрес, потом из этого буфера
 * запускается столько источников, сколько выстрелов в расписании, — каждый на своём часе контекста (`features/catalog/sound-burst.js`).
 * Выстрел длиннее такта звучит поверх хвоста предыдущего, хвост последнего доигрывает до конца: не перезапуск одного <audio>, где
 * следующий выстрел обрывал бы предыдущий. На каждый выстрел нового запроса файла нет, на повторное нажатие тоже: буфер лежит в запасе.
 *
 * Громкость. Общий уровень — тот же 0,6, что у одиночного звука окна (`useSoundPlayer`, `volume`), а за ним мягкий ограничитель пиков:
 * хвосты накладываются, сумма может перешагнуть единицу и захрипеть — ограничитель (порог 0,7, выше плавно к единице) ловит только
 * такие пики, одиночный выстрел его не задевает.
 *
 * Чего нет — Web Audio, запроса файла, самого файла или разбора — `startBurst` отвечает «unavailable», и проигрыватель играет звук
 * по-старому одним выстрелом: кнопка не ломается.
 */

/** Общий уровень очереди: как `volume` одиночного звука окна. */
export const BURST_LEVEL = 0.6;
/** Первый выстрел — чуть позже «сейчас» контекста: источники успевают встать на свои часы. */
export const BURST_LEAD_SECONDS = 0.05;
/** Сколько разобранных звуков держим: список «Звуки мода» — десятки стволов, слушают по нескольку. */
const BUFFER_LIMIT = 24;

const state = { context: null, input: null, buffers: new Map(), run: null };

function audioContext() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  if (!state.context) {
    try {
      state.context = new Context();
    } catch {
      return null;
    }
  }
  return state.context;
}

/** Порог ограничителя: ниже — звук проходит как есть. Выше уровня очереди (0,6), поэтому одиночный выстрел его не задевает. */
export const LIMITER_KNEE = 0.7;

/**
 * Мягкий ограничитель одного отсчёта: до порога — сам отсчёт, выше — плавно прижимается к единице (касательная в пороге та же) и никогда
 * её не переходит. Нечётная: минус зеркален плюсу.
 */
export function softLimit(value) {
  const level = Math.abs(value);
  if (level <= LIMITER_KNEE) return value;
  const room = 1 - LIMITER_KNEE;
  return Math.sign(value) * (LIMITER_KNEE + room * Math.tanh((level - LIMITER_KNEE) / room));
}

/** Таблица для WaveShaper: вход от −1 до 1 равномерно, `points` отсчётов (нечётное число — ноль в середине). */
export function limiterCurve(points = 2049) {
  return Float32Array.from({ length: points }, (_, at) => softLimit((at / (points - 1)) * 2 - 1));
}

/*
 * Вход цепочки «общий уровень → мягкий ограничитель → выход»; собирается один раз на контекст. Ограничитель — WaveShaper, а не
 * DynamicsCompressor: компрессор Chromium сам добавляет усиление (замер в Electron 16.11.2026: пик 0,601 на входе → 0,705 на выходе), и очередь
 * звучала бы громче одиночного звука окна. Кривая до порога — тождество: ни усиления, ни задержки.
 */
function chainInput(context) {
  if (state.input) return state.input;
  const level = context.createGain();
  level.gain.value = BURST_LEVEL;
  const limiter = context.createWaveShaper();
  limiter.curve = limiterCurve();
  limiter.oversample = "2x";
  level.connect(limiter);
  limiter.connect(context.destination);
  state.input = level;
  return level;
}

async function decode(context, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`sound ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

/* Буфер звука по адресу: одно обещание на адрес; упавшее из запаса уходит, и следующее нажатие пробует заново. */
function bufferOf(context, url) {
  const known = state.buffers.get(url);
  if (known) return known;
  const pending = decode(context, url);
  state.buffers.set(url, pending);
  pending.catch(() => {
    if (state.buffers.get(url) === pending) state.buffers.delete(url);
  });
  if (state.buffers.size > BUFFER_LIMIT) state.buffers.delete(state.buffers.keys().next().value);
  return pending;
}

/** Снять очередь: все источники — и звучащие, и ещё не начавшиеся. Тишина сразу. */
export function stopBurst() {
  const run = state.run;
  state.run = null;
  if (!run) return;
  for (const source of run.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* источник уже отыграл */
    }
    try {
      source.disconnect();
    } catch {
      /* уже отключён */
    }
  }
}

/**
 * Запустить очередь звука по адресу.
 *
 * @param {object} input
 * @param {string} input.url адрес звука
 * @param {{interval: number, shots: number}} input.burst темп и число выстрелов (`burstPlan`)
 * @param {() => boolean} input.isCurrent всё ещё ли это нажатие последнее: нажали другое, пока звук добывался, — очередь не стартует
 * @param {() => void} input.onEnded хвост последнего выстрела доиграл сам
 * @returns {Promise<"started" | "stale" | "unavailable">}
 */
export async function startBurst({ url, burst, isCurrent, onEnded }) {
  const context = typeof fetch === "function" ? audioContext() : null;
  if (!context) return "unavailable";
  let buffer;
  try {
    buffer = await bufferOf(context, url);
  } catch {
    return isCurrent() ? "unavailable" : "stale";
  }
  if (!isCurrent()) return "stale";
  stopBurst();
  void context.resume?.();
  const { starts, end } = burstSchedule({ interval: burst.interval, duration: buffer.duration, shots: burst.shots });
  const input = chainInput(context);
  const base = context.currentTime + BURST_LEAD_SECONDS;
  const sources = starts.map((at) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(input);
    source.start(base + at);
    return source;
  });
  const run = { sources, context, base, end };
  state.run = run;
  /* Последний выстрел кончается позже всех: его конец — конец очереди. */
  sources[sources.length - 1].onended = () => {
    if (state.run !== run) return;
    state.run = null;
    onEnded();
  };
  return "started";
}

/**
 * Часы идущей очереди в виде, который читает полоса проигранного (`ModSounds`: `duration`, `currentTime` — как у <audio>): от начала
 * первого выстрела до конца хвоста последнего. Очереди нет — `null`.
 */
export function burstClock() {
  const run = state.run;
  if (!run) return null;
  return { duration: run.end, currentTime: Math.max(0, run.context.currentTime - run.base) };
}

/** Забыть всё: контекст, цепочку, запас звуков и очередь. Для тестов — окно этого не зовёт. */
export function resetBurstEngine() {
  stopBurst();
  state.context = null;
  state.input = null;
  state.buffers.clear();
}
