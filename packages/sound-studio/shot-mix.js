// Сведение выстрела из дорожек игры: расписание соседа → слои с ресемплингом и фильтрами → стерео с коленом.
// Один код для превью и WAV, поэтому сэмплы совпадают бит в бит; порядок операций здесь значим.

import { envelopeEnd, envelopeValue, gainOf, shotVoices } from "./shot-voices.js";

const DEFAULT_OUTPUT_RATE = 48000;
const DEFAULT_VARIANTS = 4;
const TAIL_SECONDS = 0.02;
const CENTS_PER_OCTAVE = 1200;

const TAPS = 16;
const TAPS_BEFORE = 7;
const TAPS_AFTER = 8;
const PHASES = 256;

const KNEE = 0.9;
const KNEE_ROOM = 1 - KNEE;

const LOWPASS_CEILING = 20000;
const LOWPASS_NYQUIST_SHARE = 0.45;
const HIGHPASS_FLOOR = 10;

export function panPosition(degrees) {
  if (degrees === null || degrees === undefined) return 0;
  // Сложение намеренно без приведения: строка склеивается с числом.
  const wrapped = (((degrees + 180) % 360) + 360) % 360 - 180;
  const position = Math.sin((wrapped * Math.PI) / 180) / Math.SQRT1_2;
  return Math.max(-1, Math.min(1, position));
}

// --- Таблицы ядра живут в памяти модуля между вызовами, по одной на округлённый срез.

const kernelBySlice = new Map();

function blackmanWindow(m) {
  if (m <= 0 || m >= 1) return 0;
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * m) + 0.08 * Math.cos(4 * Math.PI * m);
}

function buildKernel(slice) {
  const table = new Float32Array((PHASES + 1) * TAPS);
  for (let phase = 0; phase <= PHASES; phase += 1) {
    for (let tap = 0; tap < TAPS; tap += 1) {
      const x = tap - TAPS_BEFORE - phase / PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * slice * x) / (Math.PI * slice * x);
      table[phase * TAPS + tap] = slice * sinc * blackmanWindow((x + 8) / 16);
    }
  }
  return table;
}

function kernelFor(step) {
  const slice = Math.round(Math.min(1, 1 / step) * 1000) / 1000;
  let table = kernelBySlice.get(slice);
  if (!table) {
    table = buildKernel(slice);
    kernelBySlice.set(slice, table);
  }
  return table;
}

// --- Что становится слоем.

function silenceMoment({ envelopes, fades }) {
  let moment = Infinity;
  for (const envelope of envelopes) moment = Math.min(moment, envelope.at + envelopeEnd(envelope, envelope.stop));
  for (const fade of fades) {
    if (fade.kind === "out") moment = Math.min(moment, fade.at + fade.length);
  }
  return moment;
}

// null: слоя нет. Math.min и Math.max здесь пропускают NaN, и он даёт ноль отсчётов.
function planLayer(voice, wave, rate) {
  const silence = silenceMoment(voice);
  const size = wave.pcm.length;
  const step = (wave.sampleRate / rate) * 2 ** (voice.pitch / CENTS_PER_OCTAVE);
  const begin = voice.offset * wave.sampleRate;
  const looped = wave.loopPoint >= 0 && Number.isFinite(voice.stop);
  if (!looped && begin >= size) return null;
  const natural = looped ? voice.stop - voice.start : (size - begin) / step / rate;
  const seconds = Math.max(0, Math.min(natural, silence - voice.start));
  const count = Math.ceil(seconds * rate);
  return count ? { count, step, begin, looped } : null;
}

// --- Отсчёты слоя.

// NaN (плавность нулевой длины в свой момент) проходит сквозь оба условия и остаётся в множителе.
function fadeIn(progress) {
  if (progress <= 0) return 0;
  return progress >= 1 ? 1 : progress;
}

function fadeOut(progress) {
  if (progress <= 0) return 1;
  return progress >= 1 ? 0 : 1 - progress;
}

function fadeFactor(fades, time) {
  let factor = 1;
  for (const fade of fades) {
    const progress = (time - fade.at) / fade.length;
    factor *= fade.kind === "in" ? fadeIn(progress) : fadeOut(progress);
  }
  return factor;
}

function renderLayer(voice, wave, plan, rate, shift) {
  const { pcm, loopPoint } = wave;
  const { count, step, begin, looped } = plan;
  const { start, envelopes, fades } = voice;
  const size = pcm.length;
  const kernel = kernelFor(step);
  const baseGain = gainOf(voice.gain - (wave.headroom || 0) + shift);
  const shaped = envelopes.length > 0 || fades.length > 0;
  const samples = new Float32Array(count);

  for (let n = 0; n < count; n += 1) {
    let position = begin + n * step;
    if (looped && position >= size) {
      // loopPoint не приводится: строка склеивается с остатком, и позиция уходит за волну.
      position = Number(loopPoint + (position - loopPoint) % (size - loopPoint));
    }
    const whole = Math.floor(position);
    const firstIndex = whole - TAPS_BEFORE;
    const lastIndex = Math.min(size - 1, whole + TAPS_AFTER);
    const tapShift = Math.round((position - whole) * PHASES) * TAPS - firstIndex;
    let sum = 0;
    for (let i = Math.max(0, firstIndex); i <= lastIndex; i += 1) sum += pcm[i] * kernel[tapShift + i];

    let gain = baseGain;
    if (shaped) {
      const time = start + n / rate;
      for (const envelope of envelopes) gain *= envelopeValue(envelope, time - envelope.at, envelope.stop);
      if (fades.length > 0) gain *= fadeFactor(fades, time);
    }
    samples[n] = sum * gain;
  }
  return samples;
}

// --- Фильтры: биквады Бристоу-Джонсона с Q = 1/√2.

const lowpassFeed = (cosW) => [(1 - cosW) / 2, 1 - cosW, (1 - cosW) / 2];
const highpassFeed = (cosW) => [(1 + cosW) / 2, -(1 + cosW), (1 + cosW) / 2];

function runBiquad(samples, feedOf, cutoff, rate) {
  const w = (2 * Math.PI * cutoff) / rate;
  const cosW = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const [rawB0, rawB1, rawB2] = feedOf(cosW);
  const b0 = rawB0 / a0;
  const b1 = rawB1 / a0;
  const b2 = rawB2 / a0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    samples[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
}

function applyFilters(samples, { lpf, hpf }, rate) {
  if (lpf < Math.min(LOWPASS_CEILING, LOWPASS_NYQUIST_SHARE * rate)) runBiquad(samples, lowpassFeed, lpf, rate);
  if (hpf > HIGHPASS_FLOOR) runBiquad(samples, highpassFeed, hpf, rate);
}

function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

// --- Сведение.

function addToChannels(left, right, { samples, shift, voice }) {
  const angle = ((panPosition(voice.pan) + 1) * Math.PI) / 4;
  const leftGain = Math.cos(angle);
  const rightGain = Math.sin(angle);
  const from = Math.max(0, -shift);
  const to = Math.min(samples.length, left.length - shift);
  for (let n = from; n < to; n += 1) {
    left[shift + n] += samples[n] * leftGain;
    right[shift + n] += samples[n] * rightGain;
  }
}

// Колено сразу и мерит пик до себя: два прохода по каналу тут незачем.
function compressAboveKnee(channel) {
  let peak = 0;
  for (let i = 0; i < channel.length; i += 1) {
    const sample = channel[i];
    const level = Math.abs(sample);
    peak = Math.max(peak, level);
    if (level > KNEE) {
      channel[i] = Math.sign(sample) * (KNEE + KNEE_ROOM * Math.tanh((level - KNEE) / KNEE_ROOM));
    }
  }
  return peak;
}

export function mixShot(voices, waves, { sampleRate, gain } = {}) {
  const outputRate = sampleRate || DEFAULT_OUTPUT_RATE;
  const rate = Number(outputRate);
  const shift = gain || 0;
  const missing = new Set();
  const rendered = [];
  const layers = [];
  let furthest = 0;

  let index = -1;
  for (const voice of voices) {
    index += 1;
    const wave = waves.get(voice.wave);
    if (!wave?.pcm?.length) {
      missing.add(voice.wave);
      continue;
    }
    const plan = planLayer(voice, wave, rate);
    if (!plan) continue;
    const samples = renderLayer(voice, wave, plan, rate, shift);
    applyFilters(samples, voice, rate);
    const offset = Math.round(voice.start * rate);
    furthest = Math.max(furthest, offset + samples.length);
    rendered.push({ samples, shift: offset, voice });
    layers.push({
      index,
      wave: voice.wave,
      start: voice.start,
      seconds: samples.length / rate,
      peak: peakOf(samples),
    });
  }

  const frames = Math.round(furthest + TAIL_SECONDS * rate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (const layer of rendered) addToChannels(left, right, layer);
  const peak = Math.max(compressAboveKnee(left), compressAboveKnee(right));
  return { left, right, sampleRate: outputRate, peak, missing: [...missing], layers };
}

// --- Части живой стрельбы.

function shiftedToOrigin(voice) {
  const { origin } = voice;
  return {
    ...voice,
    start: voice.start - origin,
    envelopes: voice.envelopes.map((envelope) => ({ ...envelope, at: envelope.at - origin })),
    fades: voice.fades.map((fade) => ({ ...fade, at: fade.at - origin })),
  };
}

// Какой список получит голос. Номер вне массива вариантов даёт undefined, и запись в него — TypeError.
function routeVoice(voice, parts, variantCount) {
  if (voice.part === "tail") return parts.tail;
  if (voice.shot === 0) return parts.first;
  return voice.shot <= variantCount ? parts.variants[voice.shot - 1] : null;
}

export function mixShotParts(program, waves, options = {}) {
  const { variants, suppressed, random } = options;
  const variantCount = Math.max(1, Math.floor(variants || DEFAULT_VARIANTS));
  const schedule = shotVoices(program, {
    shots: variantCount + 1,
    suppressed: Boolean(suppressed),
    random,
    openEnded: true,
  });

  const parts = {
    first: [],
    tail: [],
    variants: Array.from({ length: variantCount }, () => []),
  };
  for (const voice of schedule.voices) {
    const shifted = shiftedToOrigin(voice);
    const target = routeVoice(shifted, parts, variantCount);
    if (target !== null) target.push(shifted);
  }

  const mixPart = (voices) => (voices.length > 0 ? mixShot(voices, waves, options) : null);
  const first = mixPart(parts.first);
  const shots = parts.variants.filter((voices) => voices.length > 0).map(mixPart);
  const tail = mixPart(parts.tail);
  const missing = new Set(
    [first, ...shots, tail].flatMap((part) => (part ? part.missing : [])),
  );
  return {
    first,
    shots,
    tail,
    cadence: program?.auto ? schedule.interval : null,
    skipped: schedule.skipped,
    missing: [...missing],
  };
}

// --- WAV.

const HEADER_BYTES = 44;
const HEADER_TAGS = [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]];

export function stereoWav({ left, right, sampleRate }) {
  const frames = left.length;
  const bytes = new Uint8Array(HEADER_BYTES + frames * 4);
  const view = new DataView(bytes.buffer);
  for (const [offset, tag] of HEADER_TAGS) {
    for (let i = 0; i < tag.length; i += 1) view.setUint8(offset + i, tag.charCodeAt(i));
  }
  view.setUint32(4, 36 + frames * 4, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, frames * 4, true);

  const toPcm16 = (sample) => Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(HEADER_BYTES + frame * 4, toPcm16(left[frame]), true);
    view.setInt16(HEADER_BYTES + frame * 4 + 2, toPcm16(right[frame]), true);
  }
  return bytes;
}
