/*
 * Акустический профиль дорожки.
 *
 * У дорожек в игре нет имён — только хеши, и словарей к ним нет. Зато есть
 * сам звук. По нескольким дешёвым признакам — длительность, атака, доля
 * звучания, стационарность, спектральный центроид и плоскость спектра —
 * дорожки раскладываются на понятные человеку классы: удар, тональный,
 * шум, петля, длинный. Сирена — тональная и длинная, выстрел — короткий
 * удар, фон — петля. Те же признаки дают меру похожести: принёс свою сирену
 * — дорожки банка сортируются по близости к ней.
 *
 * Модуль чистый: работает и в main (WAV с диска), и в окне (AudioBuffer),
 * и в `node --test`. Никаких зависимостей — FFT на тридцать строк.
 */

const FFT_SIZE = 2048;
const MAX_WINDOWS = 6;
const PEAK_COLUMNS = 32;
const BLOCK_SECONDS = 0.01;

/* Радикс-2 FFT на месте: re/im — Float64Array длиной степени двойки. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const a = start + k;
        const b = a + length / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/* Усреднённый спектр мощности по нескольким окнам Ханна вдоль дорожки. */
function powerSpectrum(samples) {
  const n = samples.length;
  const size = Math.min(FFT_SIZE, 1 << Math.max(8, Math.ceil(Math.log2(Math.max(2, n)))));
  const bins = size / 2;
  const power = new Float64Array(bins);
  const windows = Math.max(1, Math.min(MAX_WINDOWS, Math.floor(n / size)));
  const step = windows > 1 ? Math.floor((n - size) / (windows - 1)) : 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let w = 0; w < windows; w += 1) {
    const offset = w * step;
    for (let i = 0; i < size; i += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      re[i] = offset + i < n ? samples[offset + i] * hann : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k += 1) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  return { power, bins, size };
}

/*
 * Тональность — доля энергии в узких пиках над локальным полом спектра.
 * Классическая «плоскость» на живых звуках почти всегда около нуля: спектр
 * любого натурального звука падает на десятки децибел к верху, и среднее
 * геометрическое тонет. А пики над полом есть только у звуков с высотой:
 * у сирены — почти вся энергия, у щелчка и шума — единицы процентов.
 */
function peakEnergyRatio(power, bins) {
  const logPower = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) logPower[k] = 10 * Math.log10(power[k] + 1e-20);
  const width = Math.max(4, Math.round(bins / 48));
  const prefix = new Float64Array(bins + 1);
  for (let k = 0; k < bins; k += 1) prefix[k + 1] = prefix[k] + logPower[k];
  let peak = 0;
  let total = 0;
  for (let k = 1; k < bins; k += 1) {
    const from = Math.max(0, k - width);
    const to = Math.min(bins, k + width + 1);
    const floor = (prefix[to] - prefix[from]) / (to - from);
    total += power[k];
    if (logPower[k] - floor > 8) peak += power[k];
  }
  return total > 0 ? peak / total : 0;
}

const db = (value) => (value > 0 ? 20 * Math.log10(value) : -120);
const round = (value, digits = 3) => Number(value.toFixed(digits));

/**
 * Признаки дорожки по её сэмплам (моно, -1..1). Возвращает компактный
 * объект: числа и 32 пика для мини-волны в строке списка.
 */
export function analyzeSamples(samples, sampleRate) {
  const n = samples.length;
  const rate = Number(sampleRate) || 44100;
  if (!n) {
    return {
      seconds: 0,
      rms: -120,
      peak: -120,
      crest: 0,
      attackMs: 0,
      sustain: 0,
      stationarity: 0,
      loopSeam: 0,
      centroidHz: 0,
      flatness: 1,
      tonality: 0,
      peaks: new Array(PEAK_COLUMNS).fill(0),
    };
  }
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
    energy += samples[i] * samples[i];
  }
  const rms = Math.sqrt(energy / n);

  /* Огибающая по блокам в 10 мс. */
  const block = Math.max(1, Math.round(rate * BLOCK_SECONDS));
  const blocks = Math.ceil(n / block);
  const envelope = new Float64Array(blocks);
  let envelopePeak = 0;
  for (let b = 0; b < blocks; b += 1) {
    let sum = 0;
    const from = b * block;
    const to = Math.min(n, from + block);
    for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
    envelope[b] = Math.sqrt(sum / Math.max(1, to - from));
    if (envelope[b] > envelopePeak) envelopePeak = envelope[b];
  }
  let attackBlock = 0;
  while (attackBlock < blocks && envelope[attackBlock] < envelopePeak * 0.9)
    attackBlock += 1;
  let active = 0;
  let mean = 0;
  for (let b = 0; b < blocks; b += 1) {
    if (envelope[b] >= envelopePeak * 0.1) active += 1;
    mean += envelope[b];
  }
  mean /= blocks;
  let variance = 0;
  for (let b = 0; b < blocks; b += 1) variance += (envelope[b] - mean) ** 2;
  const deviation = Math.sqrt(variance / blocks);
  const stationarity = mean > 0 ? Math.max(0, 1 - deviation / mean) : 0;
  const edge = Math.max(1, Math.round(blocks * 0.05));
  const edgeLevel = (from, to) => {
    let sum = 0;
    for (let b = from; b < to; b += 1) sum += envelope[b];
    return sum / Math.max(1, to - from);
  };
  const loopSeam =
    envelopePeak > 0
      ? Math.min(edgeLevel(0, edge), edgeLevel(blocks - edge, blocks)) / envelopePeak
      : 0;

  /* Спектр: центроид, плоскость (шум ≈ 1, тон ≈ 0). */
  const { power, bins, size } = powerSpectrum(samples);
  let weighted = 0;
  let total = 0;
  let logSum = 0;
  let counted = 0;
  const floor = 1e-12;
  for (let k = 1; k < bins; k += 1) {
    const hz = (k * rate) / size;
    weighted += hz * power[k];
    total += power[k];
    logSum += Math.log(power[k] + floor);
    counted += 1;
  }
  const centroidHz = total > 0 ? weighted / total : 0;
  const geometric = Math.exp(logSum / Math.max(1, counted));
  const arithmetic = total / Math.max(1, counted) + floor;
  const flatness = Math.min(1, Math.max(0, geometric / arithmetic));
  const tonality = peakEnergyRatio(power, bins);

  /* Пики для мини-волны. */
  const peaks = [];
  const column = n / PEAK_COLUMNS;
  for (let c = 0; c < PEAK_COLUMNS; c += 1) {
    let top = 0;
    const from = Math.floor(c * column);
    const to = Math.min(n, Math.floor((c + 1) * column));
    for (let i = from; i < to; i += 1) {
      const value = Math.abs(samples[i]);
      if (value > top) top = value;
    }
    peaks.push(round(top, 3));
  }

  return {
    seconds: round(n / rate, 4),
    rms: round(db(rms), 1),
    peak: round(db(peak), 1),
    crest: round(rms > 0 ? peak / rms : 0, 2),
    attackMs: round(attackBlock * BLOCK_SECONDS * 1000, 1),
    sustain: round(active / blocks, 3),
    stationarity: round(stationarity, 3),
    loopSeam: round(loopSeam, 3),
    centroidHz: Math.round(centroidHz),
    flatness: round(flatness, 3),
    tonality: round(tonality, 3),
    peaks,
  };
}

/** Классы дорожек — подписи и объяснения для чипов фильтра. */
export const TRACK_TAGS = Object.freeze([
  { id: "hit", title: "Удары", short: "удар", hint: "Короткие, резкая атака: выстрелы, щелчки, столкновения" },
  { id: "tonal", title: "Тональные", short: "тон", hint: "Слышна высота: сирены, клаксоны, гудки, сигналы" },
  { id: "noise", title: "Шумовые", short: "шум", hint: "Без выраженной высоты: ветер, шорохи, хвосты" },
  { id: "loop", title: "Петли", short: "петля", hint: "Ровный звук от начала до конца — фон и зацикленные" },
  { id: "long", title: "Длинные", short: "длин.", hint: "Дольше полутора секунд" },
]);

/** Классы по признакам; дорожка может быть и тональной, и длинной. */
export function tagsOf(features) {
  const f = features || {};
  const tags = [];
  // Очень короткий клип «звучит» целиком — доля звучания ему не судья.
  if (
    f.attackMs <= 25 &&
    f.seconds <= 0.8 &&
    (f.sustain <= 0.6 || f.seconds <= 0.15)
  )
    tags.push("hit");
  if (f.tonality >= 0.5 && f.seconds >= 0.12) tags.push("tonal");
  if (f.tonality <= 0.2 && f.seconds >= 0.12) tags.push("noise");
  if (f.seconds >= 0.5 && f.stationarity >= 0.55 && f.loopSeam >= 0.45)
    tags.push("loop");
  if (f.seconds >= 1.5) tags.push("long");
  return tags;
}

const log = (value) => Math.log(Math.max(1e-6, value));

/**
 * Расстояние между дорожками по признакам: чем меньше, тем похожее.
 * Длительность и высота — логарифмами (в два раза длиннее/выше — одно и то
 * же «расстояние» на любом масштабе), остальное — на своих шкалах.
 */
export function similarity(a, b) {
  if (!a || !b) return Infinity;
  const duration = Math.abs(log(a.seconds) - log(b.seconds));
  const pitch = Math.abs(log(a.centroidHz || 1) - log(b.centroidHz || 1));
  const tone = Math.abs((a.tonality || 0) - (b.tonality || 0));
  const attack = Math.abs(log((a.attackMs || 0) + 1) - log((b.attackMs || 0) + 1));
  const sustain = Math.abs((a.sustain || 0) - (b.sustain || 0));
  const loudness = Math.abs((a.rms || -60) - (b.rms || -60)) / 20;
  return round(
    duration * 1.2 + pitch * 1.0 + tone * 2.0 + attack * 0.5 + sustain * 0.8 + loudness * 0.3,
    4,
  );
}

/** Моно-сэмплы из буфера окна: каналы усредняются. */
export function monoSamples(channels) {
  const list = Array.isArray(channels) ? channels : [channels];
  if (list.length === 1) return list[0];
  const length = list[0].length;
  const out = new Float32Array(length);
  for (const channel of list)
    for (let i = 0; i < length; i += 1) out[i] += channel[i] / list.length;
  return out;
}

/** PCM16 little-endian → Float32 моно (-1..1); для WAV с диска. */
export function pcm16ToFloat(bytes, offset = 0, length = bytes.length - offset) {
  const frames = Math.floor(length / 2);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const lo = bytes[offset + i * 2];
    const hi = bytes[offset + i * 2 + 1];
    let value = (hi << 8) | lo;
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / 0x8000;
  }
  return out;
}
