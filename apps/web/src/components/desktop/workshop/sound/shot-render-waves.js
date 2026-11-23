// Дорожки выстрела: перевод PCM16 в числа и повторяемый генератор по зерну.
// Модуль листовой: его целиком подключает и окно, и поток сведения.

const SAMPLE_SCALE = 32768;
const LCG = Object.freeze({ multiplier: 1664525, increment: 1013904223, range: 2 ** 32 });
const NO_LOOP = -1;

// Горячий цикл: с хвоста к началу, только чтение 16-битного значения «младший байт первым».
function toFloats(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floats = new Float32Array(bytes.length >> 1);
  for (let slot = floats.length; slot-- > 0; ) {
    floats[slot] = view.getInt16(slot * 2, true) / SAMPLE_SCALE;
  }
  return floats;
}

const unpack = (wave) => {
  const raw = wave.pcm;
  const [sampleRate, headroom] = [wave.sampleRate, wave.headroom].map((field) => Number(field) || 0);
  const loopPoint = Number.isInteger(wave.loopPoint) ? wave.loopPoint : NO_LOOP;
  const pcm = toFloats(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  return [wave.key, { pcm, sampleRate, headroom, loopPoint }];
};

export const decodeShotWaves = (waves) => new Map([...(waves || [])].map((wave) => unpack(wave)));

export function shotRandom(seed = 1) {
  const lane = { state: Number(seed) >>> 0 || 1 };
  return () => {
    lane.state = (Math.imul(LCG.multiplier, lane.state) + LCG.increment) >>> 0;
    return lane.state / LCG.range;
  };
}
