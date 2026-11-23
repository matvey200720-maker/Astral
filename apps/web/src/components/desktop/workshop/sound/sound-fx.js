/*
 * Обработка звука студии: одна цепочка на выстрелы, попадания и готовые звуки.
 *
 * Ручки называются тем, что человек хочет сделать со звуком, а не тем, как
 * это сделано: «Приглушить», а не «ФНЧ 2,4 кГц»; «Реверберация», а не
 * «уровень свёртки». Сообщество просит ровно это — «тише», «глуше», «как с
 * глушителем», «как издалека» — и самые скачиваемые звуковые моды для RP
 * серверов именно такие.
 *
 * Вся обработка — один рендер OfflineAudioContext в частоту и длину дорожки
 * игры, поэтому ▶ в студии и файл в игре — одни и те же сэмплы. Шум для
 * реверберации — детерминированный: один и тот же звук с теми же ручками
 * даёт те же байты, иначе отпечаток «что стоит в игре» менялся бы от каждого
 * рендера.
 *
 * Цепочка: обрезка и реверс → скорость и тон → бас (полка 150 Гц) →
 * середина (1 кГц) → звонкость (полка 4 кГц) → приглушение (ФНЧ,
 * логарифмически от 20 кГц до 350 Гц) → жёсткость (мягкое насыщение) → сухой
 * сигнал, реверберация (свёртка с синтезированным хвостом) и эхо (повторы
 * с затуханием) → нормализация → громкость → мягкий предел → плавный вход и
 * спад.
 *
 * Скорость и тон (задача 3 ТЗ 07.10.2026) — раздельно: «Скорость» меняет
 * темп и не трогает высоту, «Тон» — высоту и не трогает длину. Прежде «Тон»
 * был скоростью плёнки (выше — значит и короче); такие работы читаются как
 * скорость, равная тону (`normalizeFx`), и звучат байт в байт как раньше.
 *
 * Подгонка длины (задача 6 ТЗ 10.10.2026, вечер): «как плёнка» (`tape` —
 * скорость меняет и высоту), «Срезать низ» (ФВЧ после «Приглушить»),
 * «Плотнее» (компрессор после искажения) и петля без щелчка (`loop`): хвост
 * отрезка уходит кроссфейдом в его начало (`sewLoop`), края не гасятся —
 * игра сама крутит звук по кругу. Схема ручек — в пакете
 * (`@modovik/sound-studio/sound-knobs`): ей же чистит назначения прежняя
 * студия.
 */

import {
  FX_DEFAULTS,
  FX_LIMITS,
  fxIsNeutral,
  fxKey,
  normalizeFx,
} from "@modovik/sound-studio/sound-knobs";
import { loopPlan, sewLoop } from "./sound-fit.js";
import { tr } from "../../../../locales/ui.js";

export { FX_DEFAULTS, FX_LIMITS, fxIsNeutral, fxKey, normalizeFx };

const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/*
 * «Приглушить» → частота среза. Слух логарифмический: равный шаг ползунка
 * должен звучать равным шагом глухоты, поэтому частота падает по степени,
 * а не по прямой. 0 % — фильтра нет вовсе (20 кГц), 100 % — 350 Гц: звук из-за
 * стены, дальше уже не выстрел, а стук.
 */
export const muffleCutoff = (muffle) =>
  20000 * (350 / 20000) ** Math.min(1, Math.max(0, finite(muffle, 0) / 100));

/*
 * «Срезать низ» → частота ФВЧ, так же по степени: 0 % — фильтра нет (20 Гц),
 * 100 % — 1,5 кГц, ниже которой не остаётся ни баса, ни тела звука. Вместе
 * с «Приглушить» даёт полосу рации и телефона.
 */
export const lowcutCutoff = (lowcut) =>
  20 * (1500 / 20) ** Math.min(1, Math.max(0, finite(lowcut, 0) / 100));

/*
 * «Плотнее» → компрессор: тихое подтягивается к громкому. 0 % — нет, 100 % —
 * порог −36 дБ и сжатие 12:1; громкость после него выравнивает
 * нормализация.
 */
export function compressorSettings(comp) {
  const amount = Math.min(1, Math.max(0, finite(comp, 0) / 100));
  return {
    threshold: -36 * amount,
    ratio: 1 + 11 * amount,
    knee: 10,
    attack: 0.003,
    release: 0.25,
  };
}

/* Псевдослучайный шум: xorshift от зерна — одинаковый на каждом рендере. */
export function seededNoise(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/*
 * Хвост реверберации: два канала затухающего шума с разным зерном (иначе
 * она встаёт посередине, как моно), с короткой задержкой первых отражений и
 * мягким верхом — улица, а не консервная банка.
 */
function impulseResponse(context, seconds) {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.round(rate * seconds));
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const noise = seededNoise(0x51d0 + channel * 7919);
    const predelay = Math.round(rate * (0.012 + channel * 0.007));
    let smooth = 0;
    for (let index = predelay; index < length; index += 1) {
      const time = (index - predelay) / rate;
      const decay = Math.exp((-6.9 * time) / seconds);
      /* Однополюсный фильтр: верх хвоста гаснет быстрее низа. */
      smooth += 0.35 * (noise() - smooth);
      data[index] = smooth * decay;
    }
  }
  return buffer;
}

/* Мягкое насыщение: tanh с компенсацией громкости, 0 — прямая. */
function driveCurve(amount) {
  const k = 1 + (Math.min(100, Math.max(0, amount)) / 100) * 18;
  const points = 2048;
  const curve = new Float32Array(points);
  const norm = Math.tanh(k);
  for (let index = 0; index < points; index += 1) {
    const x = (index / (points - 1)) * 2 - 1;
    curve[index] = Math.tanh(k * x) / norm;
  }
  return curve;
}

const decibels = (value) => 10 ** (value / 20);

/**
 * Растяжение по времени без смены тона (WSOLA): окна по 40 мс внахлёст,
 * каждое следующее ищется в пределах ±10 мс так, чтобы стыковаться с
 * прежним без щелчка. `factor` > 1 — длиннее.
 *
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {number} factor
 * @returns {Float32Array[]}
 */
export function timeStretch(channels, sampleRate, factor) {
  const length = channels[0]?.length || 0;
  if (!length || Math.abs(factor - 1) < 1e-4) return channels.map((data) => data.slice());
  const win = Math.max(64, Math.round(sampleRate * 0.04));
  const hop = Math.round(win / 2);
  const tolerance = Math.round(sampleRate * 0.01);
  const outLength = Math.max(1, Math.round(length * factor));
  const analysisHop = hop / factor;
  const window = new Float32Array(win);
  for (let index = 0; index < win; index += 1)
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (win - 1));
  /* Поиск стыка — по сумме каналов. */
  const mono = new Float32Array(length);
  for (const data of channels) for (let index = 0; index < length; index += 1) mono[index] += data[index];
  const out = channels.map(() => new Float32Array(outLength + win));
  const weight = new Float32Array(outLength + win);
  let previous = 0;
  for (let segment = 0, position = 0; position < outLength; segment += 1, position += hop) {
    const nominal = Math.min(length - 1, Math.round(segment * analysisHop));
    let best = nominal;
    if (segment > 0) {
      const natural = previous + hop;
      let score = -Infinity;
      for (let delta = -tolerance; delta <= tolerance; delta += 2) {
        const candidate = nominal + delta;
        if (candidate < 0 || candidate + win > length || natural + win > length) continue;
        let sum = 0;
        for (let index = 0; index < win; index += 4) sum += mono[natural + index] * mono[candidate + index];
        if (sum > score) {
          score = sum;
          best = candidate;
        }
      }
    }
    for (let channel = 0; channel < channels.length; channel += 1) {
      const data = channels[channel];
      const target = out[channel];
      for (let index = 0; index < win; index += 1) {
        const at = best + index;
        if (at >= length) break;
        target[position + index] += data[at] * window[index];
      }
    }
    for (let index = 0; index < win; index += 1) weight[position + index] += window[index];
    previous = best;
  }
  return out.map((data) => {
    const result = new Float32Array(outLength);
    for (let index = 0; index < outLength; index += 1)
      result[index] = weight[index] > 1e-3 ? data[index] / weight[index] : data[index];
    return result;
  });
}

/**
 * Тишина по краям: где звук начинается и кончается (выше `threshold` дБ от
 * пика). Для «Обрезать тишину» — те же секунды, что у ручек обрезки.
 */
export function silenceBounds(buffer, { threshold = -45 } = {}) {
  const channels = Array.from({ length: buffer.numberOfChannels || 1 }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  const length = channels[0]?.length || 0;
  let peak = 0;
  for (const data of channels) for (let index = 0; index < length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  if (!peak) return { start: 0, end: buffer.duration || 0 };
  const floor = peak * decibels(threshold);
  const loud = (index) => channels.some((data) => Math.abs(data[index]) > floor);
  let first = 0;
  while (first < length && !loud(first)) first += 1;
  let last = length - 1;
  while (last > first && !loud(last)) last -= 1;
  const rate = buffer.sampleRate;
  /* Запас в 5 мс: атака выстрела не срезается под корень. */
  const pad = Math.round(rate * 0.005);
  return {
    start: Math.max(0, first - pad) / rate,
    end: Math.min(length, last + 1 + pad) / rate,
  };
}

/* Отрезок звука (и задом наперёд) отдельным буфером частоты источника. */
function clipBuffer(context, source, start, clip, reverse) {
  const rate = source.sampleRate;
  const from = Math.floor(start * rate);
  const frames = Math.max(1, Math.min(source.length - from, Math.round(clip * rate)));
  const buffer = context.createBuffer(source.numberOfChannels, frames, rate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const data = source.getChannelData(channel).subarray(from, from + frames);
    const target = buffer.getChannelData(channel);
    if (reverse) for (let index = 0; index < frames; index += 1) target[index] = data[frames - 1 - index];
    else target.set(data);
  }
  return buffer;
}

/**
 * Рендер звука через цепочку.
 *
 * @param {AudioBuffer} source исходный звук (файл, дорожка игры, синтез)
 * @param {object} fx ручки (`normalizeFx`)
 * @param {{sampleRate: number, channels?: number, maxSamples?: number,
 *          stretch?: boolean}} target
 *   частота и число каналов результата; `maxSamples` — потолок длины (длина
 *   дорожки в игре); хвост реверберации и эха в него укладывается, а не
 *   выходит за край.
 * @returns {Promise<{channels: Float32Array[], sampleRate: number, samples: number, seconds: number}>}
 */
export async function renderFx(source, fx, target) {
  const value = normalizeFx(fx);
  const sampleRate = Math.round(Number(target?.sampleRate) || 44100);
  const channels = Math.min(2, Math.max(1, Number(target?.channels) || 1));
  const OfflineContext =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineContext)
    throw new Error(tr("Браузер не поддерживает офлайн-обработку звука."));

  const duration = source.duration;
  const start = Math.min(value.trimStart, Math.max(0, duration - 0.001));
  const end =
    value.trimEnd > start ? Math.min(value.trimEnd, duration) : duration;
  /* Петля берёт из-за конца отрезка материал на шов (`loopPlan`). */
  const plan = value.loop ? loopPlan(duration, value) : null;
  const clip = Math.max(0.001, end - start) + (plan ? plan.extra : 0);
  /* Тон — передискретизацией, темп — растяжением: выше тон без растяжения
     был бы ещё и короче (прежняя «плёнка»). «Как плёнка» (`tape`) — и
     скорость передискретизацией: быстрее значит и выше. */
  const pitchRatio = 2 ** (value.pitch / 12);
  const rate = value.tape ? pitchRatio * value.speed : pitchRatio;
  const stretch = rate / value.speed;
  const stretched = Math.abs(stretch - 1) >= 1e-4;
  const played = clip / value.speed;
  const echoWet = value.echo / 100;
  const reverbTail = echoWet > 0 ? value.room : 0;
  const echoOn = value.echoDelay > 0 && value.echoMix > 0;
  const echoTail = echoOn
    ? Math.min(4, (value.echoDelay / 1000) * (value.echoFeedback > 0 ? Math.log(0.001) / Math.log(value.echoFeedback / 100) : 1))
    : 0;
  const tail = Math.max(reverbTail, echoTail);
  const natural = Math.max(1, Math.round((played + tail) * sampleRate));
  const limit = Number(target?.maxSamples) > 0 ? Number(target.maxSamples) : 0;
  /* Петлю потолок не срезает: она сшивается на нём (ниже), и материал на
     шов за потолком нужен. */
  const frames = limit && !plan ? Math.min(limit, natural) : natural;

  const context = new OfflineContext(channels, frames, sampleRate);
  const node = context.createBufferSource();
  if (!stretched && !value.reverse) {
    /* Прежний путь: тон и темп вместе — скоростью воспроизведения. */
    node.buffer = source;
    if (node.playbackRate) node.playbackRate.value = rate;
  } else {
    const piece = clipBuffer(context, source, start, clip, value.reverse);
    if (!stretched) {
      node.buffer = piece;
      if (node.playbackRate) node.playbackRate.value = rate;
    } else {
      /* Сначала тон — в частоту результата, потом темп — растяжением. */
      const resampled = new OfflineContext(
        piece.numberOfChannels,
        Math.max(1, Math.round((clip / rate) * sampleRate)),
        sampleRate,
      );
      const voice = resampled.createBufferSource();
      voice.buffer = piece;
      if (voice.playbackRate) voice.playbackRate.value = rate;
      voice.connect(resampled.destination);
      voice.start(0);
      const pitched = await resampled.startRendering();
      const parts = timeStretch(
        Array.from({ length: pitched.numberOfChannels }, (_, channel) => pitched.getChannelData(channel)),
        sampleRate,
        stretch,
      );
      const buffer = context.createBuffer(parts.length, parts[0].length, sampleRate);
      parts.forEach((data, channel) => buffer.getChannelData(channel).set(data));
      node.buffer = buffer;
    }
  }

  const bass = context.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 150;
  bass.gain.value = value.bass;
  const treble = context.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 4000;
  treble.gain.value = value.treble;
  const muffle = context.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = Math.min(sampleRate / 2 - 10, muffleCutoff(value.muffle));
  muffle.Q.value = 0.707;
  node.connect(bass);
  if (value.mid !== 0) {
    /* Середина — только тронутая: нулевой фильтр меняет сэмплы на ничтожную
       долю, и стоящая в игре работа перестала бы совпадать с ▶. */
    const mid = context.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.9;
    mid.gain.value = value.mid;
    bass.connect(mid);
    mid.connect(treble);
  } else bass.connect(treble);
  treble.connect(muffle);

  let last = muffle;
  /* Новые звенья — только тронутые: нулевой фильтр сдвинул бы сэмплы
     стоящих в игре работ. */
  if (value.lowcut > 0) {
    const lowcut = context.createBiquadFilter();
    lowcut.type = "highpass";
    lowcut.frequency.value = Math.min(sampleRate / 2 - 10, lowcutCutoff(value.lowcut));
    lowcut.Q.value = 0.707;
    last.connect(lowcut);
    last = lowcut;
  }
  if (value.drive > 0) {
    const shaper = context.createWaveShaper();
    shaper.curve = driveCurve(value.drive);
    shaper.oversample = "4x";
    last.connect(shaper);
    last = shaper;
  }
  if (value.comp > 0) {
    const settings = compressorSettings(value.comp);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = settings.threshold;
    compressor.ratio.value = settings.ratio;
    compressor.knee.value = settings.knee;
    compressor.attack.value = settings.attack;
    compressor.release.value = settings.release;
    last.connect(compressor);
    last = compressor;
  }

  const dry = context.createGain();
  dry.gain.value = 1 - echoWet * 0.45;
  last.connect(dry);
  dry.connect(context.destination);
  if (echoWet > 0) {
    const convolver = context.createConvolver();
    convolver.normalize = true;
    convolver.buffer = impulseResponse(context, value.room);
    const wet = context.createGain();
    wet.gain.value = echoWet * 0.9;
    last.connect(convolver);
    convolver.connect(wet);
    wet.connect(context.destination);
  }
  if (echoOn) {
    /* Эхо — повторы: задержка с обратной связью, каждый повтор тише. */
    const delay = context.createDelay(1.5);
    delay.delayTime.value = value.echoDelay / 1000;
    const feedback = context.createGain();
    feedback.gain.value = value.echoFeedback / 100;
    const wet = context.createGain();
    wet.gain.value = value.echoMix / 100;
    last.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(context.destination);
  }

  if (!stretched && !value.reverse) node.start(0, start, clip);
  else node.start(0);
  const rendered = await context.startRendering();
  let output = [];
  for (let channel = 0; channel < channels; channel += 1)
    output.push(
      rendered.getChannelData(Math.min(channel, rendered.numberOfChannels - 1)).slice(),
    );
  /* Петля: хвост отрезка — кроссфейдом в начало, реверберация — по кругу.
     До нормализации: шов складывает два куска, и пик считается по итогу. */
  if (plan) {
    /* Потолок длины (место банка в памяти игры) — длина петли: шов ложится
       на него, а не срез поверх готовой петли. */
    const fade = Math.round(plan.fade * sampleRate);
    const body = Math.round(played * sampleRate);
    const capped = limit ? Math.min(body, limit + fade) : body;
    /* Срезанный конец отрезка — не хвост реверберации: по кругу он не
       ложится. */
    output = sewLoop(
      capped < body ? output.map((data) => data.subarray(0, capped)) : output,
      capped,
      fade,
    );
  }
  const length = output[0].length;

  /* Нормализация — до громкости: пик к 0,98, дальше громкость в децибелах.
     Громче нуля звук не режется, а мягко упирается в предел. */
  let peak = 0;
  for (const data of output)
    for (let index = 0; index < data.length; index += 1)
      peak = Math.max(peak, Math.abs(data[index]));
  const level =
    (value.normalize && peak > 0.0001 ? 0.98 / peak : 1) * decibels(value.gain);
  /* Край, где звук обрезан по длине дорожки игры: короткий спад вместо
     щелчка. Длина спада — ручка «Затухание», но не больше трети звука;
     плавный вход — так же, не больше трети. У петли краёв нет: игра крутит
     её по кругу, и спад дал бы провал на каждом обороте. */
  const fadeFrames = plan
    ? 0
    : Math.min(Math.round((value.fadeOut / 1000) * sampleRate), Math.floor(length / 3));
  const fadeInFrames = plan
    ? 0
    : Math.min(Math.round((value.fadeIn / 1000) * sampleRate), Math.floor(length / 3));
  for (const data of output)
    for (let index = 0; index < data.length; index += 1) {
      let sample = data[index] * level;
      if (Math.abs(sample) > 0.9)
        sample = Math.sign(sample) * (0.9 + 0.1 * Math.tanh((Math.abs(sample) - 0.9) / 0.1));
      const fromEnd = length - 1 - index;
      if (fromEnd < fadeFrames) sample *= fromEnd / fadeFrames;
      if (index < fadeInFrames) sample *= index / fadeInFrames;
      data[index] = sample;
    }
  return { channels: output, sampleRate, samples: length, seconds: length / sampleRate };
}

/**
 * Канал для дорожки игры из стерео-рендера: левая дорожка — левый канал,
 * правая — правый, центральная — их середина.
 */
export function channelFor(rendered, channel) {
  const [left, right = left] = rendered.channels;
  if (channel === "left") return left;
  if (channel === "right") return right;
  const mid = new Float32Array(left.length);
  for (let index = 0; index < mid.length; index += 1)
    mid[index] = (left[index] + right[index]) / 2;
  return mid;
}
