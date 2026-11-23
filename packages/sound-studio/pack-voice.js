// Приводит дорожку 16 бит моно к частоте и длине игры, собирает WAV,
// узнаёт ствол по папке части пака и считает, все ли дорожки ствола есть.

const RATE_ERROR = 'Частота дорожки должна быть положительной.';
const WINDOW_SPAN = 24;
const REACH_BEFORE = 23;
const REACH_AFTER = 24;
const FADE_SECONDS = 0.005;
const SAMPLE_MIN = -32768;
const SAMPLE_MAX = 32767;
const WAV_HEADER_BYTES = 44;

export function packVoiceCoverage(voice, available) {
  const missing = voice.filter(({ stream }) => !available.has(stream)).map(({ stream }) => stream);
  return { complete: missing.length === 0, missing };
}

export function weaponPartKey(weaponId) {
  return weaponId.replace(/^WEAPON_/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Все хвосты папки от короткого к длинному, как пары [склейка, длина].
function* folderTails(folder) {
  const words = folder.toLowerCase().split('-');
  for (let length = 1; length <= words.length; length += 1) {
    yield [words.slice(-length).join(''), length];
  }
}

export function packPartWeapon(folder, weaponIds) {
  // Одна склейка бывает при разных длинах (пустые слова): Map оставит наибольшую.
  const longestTail = new Map(folderTails(folder));
  const { weapon } = [...weaponIds].reduce((best, candidate) => {
    const length = longestTail.get(weaponPartKey(candidate)) ?? 0;
    return length > best.length ? { weapon: candidate, length } : best;
  }, { weapon: null, length: 0 });
  return weapon;
}

export function pcmToWav(pcm, sampleRate) {
  const dataBytes = 2 * pcm.length;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  // Заголовок как таблица [чем писать, смещение, значение]; write* проверяют диапазон сами.
  const header = [
    ['write', 0, 'RIFF'],
    ['writeUInt32LE', 4, 36 + dataBytes],
    ['write', 8, 'WAVE'],
    ['write', 12, 'fmt '],
    ['writeUInt32LE', 16, 16],
    ['writeUInt16LE', 20, 1],
    ['writeUInt16LE', 22, 1],
    ['writeUInt32LE', 24, sampleRate],
    ['writeUInt32LE', 28, sampleRate * 2],
    ['writeUInt16LE', 32, 2],
    ['writeUInt16LE', 34, 16],
    ['write', 36, 'data'],
    ['writeUInt32LE', 40, dataBytes],
  ];
  for (const [writer, offset, value] of header) wav[writer](value, offset);
  for (let index = 0; index < pcm.length; index += 1) {
    wav.writeInt16LE(pcm[index], WAV_HEADER_BYTES + 2 * index);
  }
  return wav;
}

// Sinc с окном Блэкмана; окно считается от самого x и от среза не зависит.
const sincKernel = (cutoff) => (x) => (x === 0
  ? cutoff
  : (Math.sin(Math.PI * x * cutoff) / (Math.PI * x))
    * (0.42 + 0.5 * Math.cos((Math.PI * x) / WINDOW_SPAN) + 0.08 * Math.cos((2 * Math.PI * x) / WINDOW_SPAN)));

// Math.round даёт нужную половину вверх; NaN проходит и в Int16Array станет нулём.
const toSample = (value) => Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, Math.round(value)));

export function resamplePcm(pcm, fromRate, toRate) {
  if (fromRate === toRate) return Int16Array.from(pcm);
  if (!(fromRate > 0 && toRate > 0)) throw new RangeError(RATE_ERROR);

  const ratio = fromRate / toRate;
  const kernel = sincKernel(Math.min(1, 1 / ratio));
  const last = pcm.length - 1;
  const interpolate = (position) => {
    const center = Math.floor(position);
    const end = Math.min(last, center + REACH_AFTER);
    let sum = 0;
    for (let source = Math.max(0, center - REACH_BEFORE); source <= end; source += 1) {
      sum += pcm[source] * kernel(position - source);
    }
    return sum;
  };
  return Int16Array.from(
    { length: Math.floor(pcm.length / ratio) },
    (_, index) => toSample(interpolate(index * ratio)),
  );
}

// Гасит хвост уже обрезанного массива на месте. Нечисловая длина затухания значит «нет затухания».
function fadeTail(clip, rate) {
  const span = Math.min(clip.length, Math.round(FADE_SECONDS * rate)) || 0;
  const tail = clip.subarray(clip.length - span);
  tail.forEach((sample, step) => {
    tail[step] = Math.round(sample * ((span - step) / span));
  });
  return clip;
}

export function fitToWave(pcm, fromRate, wave) {
  const { sampleRate, samples } = wave;
  const converted = resamplePcm(pcm, fromRate, sampleRate);
  // Обычное сравнение и slice: отрицательное, дробное и null ведут себя как у массива (контракт).
  const trimmed = converted.length > samples;
  return {
    pcm: trimmed ? fadeTail(converted.slice(0, samples), sampleRate) : converted,
    sampleRate,
    trimmed,
    resampled: fromRate !== sampleRate,
  };
}
