// Работа над списком с ограниченным числом одновременных операций («линий»).

// Запуски mapLimitDynamic, которым нужно перечитать предел по сообщению.
const waitingRuns = new Set();

// Число линий mapLimit: целая часть, не меньше 1; нечисловое значение — ноль линий.
function fixedLaneCount(limit) {
  const whole = Math.floor(Number(limit));
  return Number.isNaN(whole) ? 0 : Math.max(1, whole);
}

// Предел динамического варианта: целая часть, не меньше 1; нечисловое значение — 1.
function dynamicLaneCount(source) {
  const whole = Math.floor(Number(typeof source === "function" ? source() : source));
  return whole >= 1 ? whole : 1;
}

// Планировщик «следующий — по завершении любого»: элементы берутся строго по порядку.
class LanePool {
  closed = false;
  cursor = 0;
  running = 0;

  constructor(list, work, outcome) {
    this.list = list;
    this.work = work;
    this.outcome = outcome;
    this.results = new Array(list.length);
  }

  // Сколько операций может идти одновременно прямо сейчас.
  capacity() {
    throw new Error(`${this.constructor.name}: capacity() должен быть переопределён`);
  }

  pump() {
    if (this.closed) return;
    const capacity = this.capacity();
    while (!this.closed && this.cursor < this.list.length && this.running < capacity) {
      // Номер занимается до вызова work: сообщение из work не должно взять тот же элемент.
      const index = this.cursor;
      this.cursor = index + 1;
      this.launch(index);
    }
    if (!this.closed && this.cursor >= this.list.length && this.running === 0) {
      this.close();
      this.outcome.resolve(this.results);
    }
  }

  launch(index) {
    this.running += 1;
    let pending;
    try {
      pending = this.work(this.list[index], index);
    } catch (error) {
      this.fail(error);
      return;
    }
    Promise.resolve(pending).then(
      (value) => {
        this.results[index] = value;
        this.running -= 1;
        this.pump();
      },
      (error) => this.fail(error),
    );
  }

  // Первая ошибка отклоняет итог; идущие операции доделываются, их исходы теряются.
  fail(error) {
    if (this.closed) return;
    this.close();
    this.outcome.reject(error);
  }

  close() {
    this.closed = true;
  }
}

class FixedPool extends LanePool {
  constructor(list, work, outcome, lanes) {
    super(list, work, outcome);
    this.lanes = lanes;
  }

  capacity() {
    return this.lanes;
  }
}

class DynamicPool extends LanePool {
  constructor(list, getLimit, work, outcome) {
    super(list, work, outcome);
    this.getLimit = getLimit;
  }

  capacity() {
    return dynamicLaneCount(this.getLimit);
  }

  close() {
    super.close();
    waitingRuns.delete(this);
  }
}

export async function mapLimit(items, limit, work) {
  const list = Array.from(items);
  const lanes = fixedLaneCount(limit);
  // Ноль линий: ничего не стартует, результат — массив нужной длины без значений.
  if (lanes === 0) return new Array(list.length);

  return new Promise((resolve, reject) => {
    new FixedPool(list, work, { resolve, reject }, lanes).pump();
  });
}

export function mapLimitDynamic(items, getLimit, work) {
  const list = Array.from(items);
  return new Promise((resolve, reject) => {
    const pool = new DynamicPool(list, getLimit, work, { resolve, reject });
    waitingRuns.add(pool);
    // Первое чтение предела и первые вызовы work — на ближайшем ходу микрозадач.
    queueMicrotask(() => {
      try {
        pool.pump();
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function announceLaneLimitChanged() {
  for (const pool of [...waitingRuns]) pool.pump();
}
