// Наблюдение за чтениями модели ствола из игры: журнал «что читается и сколько уже» и очерёдность
// «картинки обвесов уступают модели». Ответ чтения модуль не меняет.

export const SLOW_MS = 15000;
export const LONG_MS = 8000;

const SOURCE = "weapon-model";
const FAILURE_TEXT_LIMIT = 400;

// Счётчик идущих чтений: один на процесс, его делят все экземпляры и прямые вызовы.
class Counter {
  #value = 0;

  get value() {
    return this.#value;
  }

  enter() {
    this.#value += 1;
  }

  leave() {
    this.#value -= 1;
  }
}

const running = new Counter();
export const weaponReadsInFlight = () => running.value;

// Секунды с одной цифрой после точки; целое пишется без дробной части.
const tenthsOf = (ms) => Math.round(ms / 100);
const secondsText = (ms) => String(tenthsOf(ms) / 10);

// Вид запроса — первое подходящее правило «условие → слово».
const KIND_RULES = [
  ["прогрев ствола", (input) => Boolean(input?.warm)],
  ["картинка обвеса", (input) => input?.icon === true],
  ["контур ствола", (input) => input?.outline === true],
  ["обвесы слоем", (input) => input?.attachmentsOnly === true],
  ["модель с обвесами", (input, attachments) => attachments.length > 0],
];

const entriesOf = (value) => (value ? Object.entries(value) : []);
const listOf = (pairs, glue, describe) => pairs.map(([bone, value]) => `${bone}${glue}${describe(value)}`).join(", ");

// Слово запроса для журнала: «<вид> <модель> [<обвесы>] вид из каталога [<виды>]».
function requestWord(input) {
  const attachments = entriesOf(input?.attachments);
  const looks = entriesOf(input?.looks);
  const kind = KIND_RULES.find(([, applies]) => applies(input, attachments))?.[0] ?? "модель ствола";
  let word = `${kind} ${String(input?.model || "?")}`;
  if (attachments.length > 0) word += ` [${listOf(attachments, "=", String)}]`;
  if (looks.length > 0) word += ` вид из каталога [${listOf(looks, "~", (look) => String(look?.id || "?"))}]`;
  return word;
}

// Одно наблюдаемое чтение: начало, слово запроса, таймер «долго» и запись итога в журнал.
class Watch {
  #input;
  #run;
  #log;
  #status;
  #timing;
  #startedAt = 0;
  #word = "";
  #timer = null;

  constructor(input, run, { log, status, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.#input = input;
    this.#run = run;
    this.#log = log;
    this.#status = status;
    this.#timing = { now, setTimer, clearTimer };
  }

  // Запись строится только когда журнал есть: без журнала ни слов, ни состояния не вычисляется.
  #note(makeEntry) {
    this.#log?.record(makeEntry());
  }

  #consult() {
    const status = this.#status;
    return status ? status() : undefined;
  }

  #elapsed() {
    const { now } = this.#timing;
    return now() - this.#startedAt;
  }

  begin() {
    const { now, setTimer } = this.#timing;
    this.#startedAt = now();
    running.enter();
    this.#word = requestWord(this.#input);
    this.#timer = setTimer(() => this.#warnSlow(), SLOW_MS);
  }

  #warnSlow() {
    this.#note(() => ({
      level: "warn",
      source: SOURCE,
      message:
        `Чтение из игры идёт дольше ${secondsText(SLOW_MS)} с: ${this.#word}; ` +
        `запросов к игре разом — ${running.value}`,
      detail: this.#consult() || "",
    }));
  }

  // Время читается всегда; запись нужна только при долгом чтении (нечисловое время — не долгое).
  succeed() {
    const elapsed = this.#elapsed();
    if (elapsed >= LONG_MS) {
      this.#note(() => ({
        level: "info",
        source: SOURCE,
        message: `Прочитано за ${secondsText(elapsed)} с: ${this.#word}; запросов разом было ${running.value}`,
      }));
    }
  }

  // Время отказа читается только при построении записи: без журнала now() не зовётся.
  fail(error) {
    this.#note(() => {
      const elapsed = this.#elapsed();
      const text = String(error?.message || error).slice(0, FAILURE_TEXT_LIMIT);
      return {
        level: "warn",
        source: SOURCE,
        message: `Не прочиталось за ${secondsText(elapsed)} с: ${this.#word}`,
        detail: [text, this.#consult()].filter(Boolean).join("; "),
      };
    });
  }

  // Таймер снимается и после срабатывания; сбой clearTimer счётчик не уменьшает.
  end() {
    const { clearTimer } = this.#timing;
    clearTimer(this.#timer);
    running.leave();
  }

  // Чтение стартует синхронно. Сбой записи об успехе уходит в ту же ветку отказа, что и сбой чтения:
  // пишется вторая запись, затем прежняя ошибка летит наружу, а результат теряется.
  execute() {
    this.begin();
    const run = this.#run;
    return new Promise((resolve) => resolve(run()))
      .then((value) => {
        this.succeed();
        return value;
      })
      .catch((error) => {
        this.fail(error);
        throw error;
      })
      .finally(() => this.end());
  }
}

export async function watchWeaponRead(input, run, options = {}) {
  return new Watch(input, run, options).execute();
}

// Прогресс поиска по архивам: сколько раз сообщили и на каком архиве стоим.
class SearchProgress {
  #steps = 0;
  #lastArchive = "";

  note(update) {
    if (update?.phase !== "search") return;
    this.#steps += 1;
    this.#lastArchive = String(update.archive || "");
  }

  describe() {
    if (this.#steps === 0) return "поиск по архивам не начался";
    return `поиск по архивам: ${this.#steps}-й, ${this.#lastArchive}`;
  }
}

// Очерёдность: картинки обвесов (фоновые) прерываются, когда человек просит модель или контур.
class ReadScheduler {
  #log;
  #background = new Set();

  constructor(log) {
    this.#log = log;
  }

  backgroundCount() {
    return this.#background.size;
  }

  #admit(input, controller) {
    if (input?.icon === true || input?.warm) {
      this.#background.add(controller);
    } else {
      this.#background.forEach((other) => other.abort());
    }
  }

  async run(input, work) {
    const controller = new AbortController();
    this.#admit(input, controller);
    const progress = new SearchProgress();
    const read = () => work(controller.signal, (update) => progress.note(update));
    try {
      return await watchWeaponRead(input, read, { log: this.#log, status: () => progress.describe() });
    } finally {
      this.#background.delete(controller);
    }
  }
}

export function createWeaponReads({ log } = {}) {
  const scheduler = new ReadScheduler(log);
  return {
    run: (input, work) => scheduler.run(input, work),
    backgroundCount: () => scheduler.backgroundCount(),
  };
}
