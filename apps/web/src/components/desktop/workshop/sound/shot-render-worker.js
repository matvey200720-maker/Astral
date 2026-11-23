// Поток сведения выстрела: считает части живой стрельбы вне главного потока окна.
import { decodeShotWaves, shotRandom } from "./shot-render-waves.js";
import { mixShotParts } from "@modovik/sound-studio/shot-mix";

const SHELF = Object.freeze({ capacity: 3, refusal: "shot-not-loaded" });

// Стволы в порядке вставки: первый ключ Map всегда самый давний.
class Armory {
  #racks = new Map();

  stock(key, shot) {
    const rack = Object.assign({ program: shot.program }, { waves: decodeShotWaves(shot.waves) });
    this.#racks.delete(key);
    this.#racks.set(key, rack);
    while (this.#racks.size > SHELF.capacity) {
      this.#racks.delete(this.#racks.keys().next().value);
    }
  }

  require(key) {
    if (!this.#racks.has(key)) throw new Error(SHELF.refusal);
    return this.#racks.get(key);
  }
}

const armory = new Armory();

const asPart = (part) => {
  if (!part) return null;
  const { left, right, sampleRate, peak } = part;
  return { channels: [left, right], sampleRate, peak };
};

function serve(key, shot, options) {
  if (shot) armory.stock(key, shot);
  const rack = armory.require(key);
  const settings = Object.assign({}, options, { random: shotRandom(options.seed) });
  const mixed = mixShotParts(rack.program, rack.waves, settings);

  const first = asPart(mixed.first);
  const tail = asPart(mixed.tail);
  const shots = mixed.shots.map((part) => asPart(part));
  const { cadence, missing } = mixed;
  const buffers = [first, ...shots, tail]
    .filter(Boolean)
    .flatMap(({ channels }) => channels.map(({ buffer }) => buffer));
  return { buffers, parts: { first, shots, tail, cadence, skipped: mixed.skipped.length, missing } };
}

const succeed = (id, { parts, buffers }) => self.postMessage({ id, parts }, buffers);
const refuse = (id, failure) => self.postMessage({ id, error: String(failure?.message || failure) });

self.onmessage = (event) => {
  const message = event.data || {};
  const { id } = message;
  try {
    succeed(id, serve(message.key, message.shot, message.options === undefined ? {} : message.options));
  } catch (failure) {
    refuse(id, failure);
  }
};
