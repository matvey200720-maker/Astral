// Кэш асинхронных значений с потолком в байтах. Строящееся значение в сумму не входит
// и вытеснению не подлежит; пустой ответ (null, undefined) в кэше не остаётся.
// Давность — штамп последнего обращения: порядок вставки в Map для вытеснения не нужен.
class ByteLedger {
  #slots = new Map();
  #total = 0;
  #clock = 0;
  #limit;
  #measure;

  constructor(limit, measure) {
    this.#limit = limit;
    this.#measure = measure;
  }

  get bytes() {
    return this.#total;
  }

  get count() {
    return this.#slots.size;
  }

  has(key) {
    return this.#slots.has(key);
  }

  fetch(key, create) {
    const found = this.#slots.get(key);
    if (found) {
      found.stamp = ++this.#clock;
      return found.promise;
    }
    const produced = create();
    const slot = { key, promise: null, bytes: 0, done: false, stamp: ++this.#clock };
    slot.promise = Promise.resolve(produced).then((value) => this.#land(slot, value));
    this.#slots.set(key, slot);
    return slot.promise;
  }

  #land(slot, value) {
    if (value == null) {
      this.#slots.delete(slot.key);
      return value;
    }
    slot.bytes = this.#measure(value);
    slot.done = true;
    this.#total += slot.bytes;
    this.#shed();
    return value;
  }

  // Самая давняя из готовых записей; строящиеся не трогаются.
  #oldestDone() {
    let oldest = null;
    for (const slot of this.#slots.values()) {
      if (slot.done && (oldest === null || slot.stamp < oldest.stamp)) oldest = slot;
    }
    return oldest;
  }

  // Пока сумма не уложилась в бюджет (сравнение с NaN всегда ложно), уходит самая давняя готовая запись.
  #shed() {
    while (!(this.#total <= this.#limit)) {
      const victim = this.#oldestDone();
      if (victim === null) return;
      this.#slots.delete(victim.key);
      this.#total -= victim.bytes;
    }
  }
}

export function createByteBudgetCache(budget, measure) {
  const ledger = new ByteLedger(budget, measure);
  return {
    get: (key, create) => ledger.fetch(key, create),
    has: (key) => ledger.has(key),
    get bytes() {
      return ledger.bytes;
    },
    get size() {
      return ledger.count;
    },
  };
}
