// Запас звуков в памяти окна: предел по весу и по числу записей, уходит самое давнее.
// Подписок и таймеров нет — React о запасе не знает.

const BYTES_PER_FLOAT = 4;

// Порядок вставки Map и есть очередь давности: первый ключ — самый давний.
class Ledger {
  #slots = new Map();
  #total = 0;
  #weightLimit;
  #countLimit;

  constructor(weightLimit, countLimit) {
    this.#weightLimit = weightLimit;
    this.#countLimit = countLimit;
  }

  get count() {
    return this.#slots.size;
  }

  get weight() {
    return this.#total;
  }

  has(key) {
    return this.#slots.has(key);
  }

  peek(key) {
    return this.#slots.get(key)?.value;
  }

  // Найденная запись становится самой свежей.
  touch(key) {
    const slot = this.#slots.get(key);
    if (slot === undefined) return undefined;
    this.#slots.delete(key);
    this.#slots.set(key, slot);
    return slot.value;
  }

  drop(key) {
    const slot = this.#slots.get(key);
    if (slot === undefined) return;
    this.#slots.delete(key);
    this.#total -= slot.weight;
  }

  wipe() {
    this.#slots.clear();
    this.#total = 0;
  }

  #overfull() {
    return this.#total > this.#weightLimit || this.#slots.size > this.#countLimit;
  }

  put(key, value, rawWeight) {
    this.drop(key);
    const asNumber = Number(rawWeight);
    const weight = asNumber > 0 ? asNumber : 0;
    if (weight > this.#weightLimit) return value;
    this.#slots.set(key, { value, weight });
    this.#total += weight;
    while (this.#slots.size > 0 && this.#overfull()) {
      this.drop(this.#slots.keys().next().value);
    }
    return value;
  }
}

export function createSoundCache({ maxBytes, maxEntries = Infinity }) {
  const ledger = new Ledger(maxBytes, maxEntries);
  return {
    get: (key) => ledger.touch(key),
    peek: (key) => ledger.peek(key),
    has: (key) => ledger.has(key),
    set: (key, value, bytes = 0) => ledger.put(key, value, bytes),
    delete: (key) => void ledger.drop(key),
    clear: () => void ledger.wipe(),
    get size() {
      return ledger.count;
    },
    get bytes() {
      return ledger.weight;
    },
  };
}

export const audioBufferBytes = (buffer) =>
  [Number(buffer?.length) || 0, Number(buffer?.numberOfChannels) || 1, BYTES_PER_FLOAT].reduce(
    (product, factor) => product * factor,
  );

const sumByteLength = (items) => items.reduce((sum, item) => sum + (item?.byteLength || 0), 0);

export const renderBytes = (rendered) =>
  [rendered?.channels, rendered?.wavs].map((list) => sumByteLength(list || [])).reduce((a, b) => a + b);
