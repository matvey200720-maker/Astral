/*
 * Очередь выдачи ссылок на пакеты каталога — одна на главный процесс, то есть на устройство (23.11.2026, жалоба «сумки не встают при просмотре в мастерской»).
 * Сервер считает не больше 30 ссылок в минуту на устройство (`backend/internal/services/catalog/grants.go`: `downloadGrantRateLimit`), дальше 429. Журнал edge за ту минуту: 30 ответов 201
 * и сразу 11 отказов 429, почти все id разные — полка: наведение на плитки готовит вещь заранее, и когда человек выбрал вещь, предел уже выбран. Предел общий на мастерскую одежды, студию ствола,
 * каталог и установки, поэтому очередь стоит здесь, у общего входа `cloud-download-grant` (рядом с `grant-reuse.js`), а не в окне: окон может быть несколько.
 *
 * Уровни (четыре слова из закрытого списка, остальное и отсутствие слова — `choice`):
 *   — `choice` (ВЫБОР): надетое на других слотах, установка, пачки, арена, интерьеры, оружие и скины — всё, что делает человек. Идёт первым и всегда: бюджет кончился — ждёт своего слота, а не отказывает; 429 — ждёт конца минутного окна и повторяет;
 *   — `frame`: вещь в кадре — тот же ВЫБОР, но выбрали другую вещь — прежняя ждущая вещь этого же отправителя (`owner`, окно, явное поле) отменяется (`GRANT_CANCELLED`);
 *   — `press` (НАЖАТИЕ): прогрев по нажатию кнопки мыши на плитке — намерение выбрать. Вторым, ждёт так же;
 *   — `background` (ФОН): прогрев по наведению, съёмка плиток без обложки. В очередь НЕ копится: нет свободного слота прямо сейчас (очередь не пуста, сервер просил подождать, ушло уже полбюджета фона) —
 *     отказ `GRANT_SKIPPED` сразу, без повтора; 429 у фона не повторяется.
 * Бюджет — не больше `limit` (24, запас к 30) отправок за скользящую минуту по собственным отправкам; фону не больше `backgroundLimit` (10) из них. Почему 10, а не половина: 12 надетых вещей + 1 в кадре
 * должны уложиться в минуту (24 − 13 = 11 слотов остаётся выбору, когда фон выбрал свой потолок), а съёмка плиток просит до 18 ссылок на страницу (`FIRST` у полки) и по 3 вперёд — они не теряются, а
 * просятся снова, когда слот есть (в окне через 10 с), так что 10 в минуту — это страница плиток без обложки за ~2 минуты, а не отказ.
 * Время и ожидание подставляются: тесты идут без часов и сети.
 */

export const LEVELS = Object.freeze(["frame", "choice", "press", "background"]);
/* Порядок выдачи: вещь в кадре и выбор — первым, нажатие — вторым, фон — слота не ждёт. */
const RANK = Object.freeze({ frame: 0, choice: 0, press: 1, background: 2 });
export const GRANT_LIMIT = 24;
export const BACKGROUND_LIMIT = 10;

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 4;
/* Запас к границе минуты: часы сервера и компьютера могут расходиться на секунду. */
const BOUNDARY_MARGIN_MS = 1_000;

/** Фон не получил слот сразу: не ошибка, окно её не показывает и не пишет. Через мост Electron остаётся текст, поэтому в нём метка `GRANT_SKIPPED`. */
export class GrantSkippedError extends Error {
  constructor() {
    super("Grant request skipped (GRANT_SKIPPED).");
    this.name = "GrantSkippedError";
    this.code = "GRANT_SKIPPED";
  }
}

/** Ждущая вещь в кадре отменена: человек выбрал другую. Окно на эту метку молчит (`GRANT_CANCELLED` в тексте — через мост остаётся только он). */
export class GrantCancelledError extends Error {
  constructor() {
    super("Grant request cancelled (GRANT_CANCELLED).");
    this.name = "GrantCancelledError";
    this.code = "GRANT_CANCELLED";
  }
}

export const levelOf = (value) => (LEVELS.includes(value) ? value : "choice");

/** Сервер ответил пределом: статус 429 в ошибке или в её тексте («… (HTTP 429).»). */
export function isRateLimited(error) {
  if (error?.status === 429) return true;
  return /HTTP 429|rate exceeded/i.test(String(error?.message || ""));
}

const MAX_WAIT_MS = WINDOW_MS + BOUNDARY_MARGIN_MS;
const nextMinuteAfter = (moment) => (Math.floor(moment / WINDOW_MS) + 1) * WINDOW_MS + BOUNDARY_MARGIN_MS;
/* Отказ несёт уровень запроса, которому он достался: присоединившийся к чужому полёту (`createPacedGrant`) узнаёт, что отказ не его. */
const tagged = (error, level) => {
  if (error && typeof error === "object" && error.grantLevel === undefined) {
    try {
      error.grantLevel = level;
    } catch {
      /* замороженная ошибка — остаётся без метки */
    }
  }
  return error;
};
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGrantPacer({ limit = GRANT_LIMIT, backgroundLimit = BACKGROUND_LIMIT, now = () => Date.now(), sleep = defaultSleep } = {}) {
  /* Отправки за последнюю минуту: `{ at, level }`. */
  const sends = [];
  /* Ждущие `choice` и `press`. */
  const queue = [];
  let blockedUntil = 0;
  let pumping = false;
  let wake = null;

  const prune = () => {
    const moment = now();
    const edge = moment - WINDOW_MS;
    /* Часы ПК прыгнули назад (поправка времени): записи «из будущего» не вымылись бы, и выбор ждал бы на размер скачка. Их выбрасываем. */
    for (let index = sends.length - 1; index >= 0; index -= 1) if (sends[index].at > moment) sends.splice(index, 1);
    while (sends.length && sends[0].at <= edge) sends.shift();
  };
  const poke = () => {
    const call = wake;
    wake = null;
    call?.();
  };
  const take = () => {
    let at = -1;
    for (let index = 0; index < queue.length; index += 1) if (at < 0 || RANK[queue[index].level] < RANK[queue[at].level]) at = index;
    return at < 0 ? null : queue.splice(at, 1)[0];
  };

  const send = (item) => {
    const sentAt = now();
    sends.push({ at: sentAt, level: item.level });
    Promise.resolve()
      .then(item.run)
      .then(item.resolve, (error) => {
        /* Предел при непустом своём бюджете (чужой клиент на этом устройстве, прежняя версия в другом окне) — тоже сигнал «окно выбрано до …». Окно сервера — минута отправки, а не минута ответа:
           запрос ушёл в :59,5, отказ пришёл в :00,2 — ждать до конца прежней минуты (она уже кончилась), а не ещё целую. */
        if (isRateLimited(error)) blockedUntil = Math.max(blockedUntil, nextMinuteAfter(sentAt));
        if (isRateLimited(error) && item.level !== "background" && item.attempts + 1 < MAX_ATTEMPTS) {
          item.attempts += 1;
          queue.unshift(item);
          poke();
          pump();
          return;
        }
        item.reject(tagged(error, item.level));
      });
  };

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const moment = now();
        if (blockedUntil && moment >= blockedUntil) {
          /* Минутное окно сервера кончилось: счёт начинается заново. */
          blockedUntil = 0;
          sends.length = 0;
        }
        /* Пауза после 429 не длиннее минуты с запасом: часы, прыгнувшие назад, не растягивают её на размер скачка. */
        if (blockedUntil - moment > MAX_WAIT_MS) blockedUntil = nextMinuteAfter(moment);
        prune();
        const wait = Math.min(Math.max(blockedUntil - moment, sends.length >= limit ? sends[0].at + WINDOW_MS - moment : 0), MAX_WAIT_MS);
        if (wait > 0) {
          await Promise.race([sleep(wait), new Promise((resolve) => (wake = resolve))]);
          continue;
        }
        send(take());
      }
    } finally {
      pumping = false;
    }
  }

  return {
    /** Выдать ссылку: `run()` — сам запрос; `level` — `frame`, `choice` (по умолчанию), `press` или `background`; `owner` — кто просит (окно): ключ отмены ждущей вещи в кадре. */
    run(level, run, { owner } = {}) {
      const kind = levelOf(level);
      if (kind === "background") {
        prune();
        const background = sends.filter((entry) => entry.level === "background").length;
        if (queue.length || now() < blockedUntil || sends.length >= limit || background >= backgroundLimit) return Promise.reject(tagged(new GrantSkippedError(), "background"));
        return new Promise((resolve, reject) => send({ level: kind, run, attempts: 0, resolve, reject }));
      }
      return new Promise((resolve, reject) => {
        /* Выбрали другую вещь в кадре: ждущая прежняя вещь того же отправителя (явное поле `owner`) больше не нужна. */
        if (kind === "frame" && owner !== undefined) {
          for (let index = queue.length - 1; index >= 0; index -= 1) {
            if (queue[index].level !== "frame" || queue[index].owner !== owner) continue;
            queue.splice(index, 1)[0].reject(tagged(new GrantCancelledError(), "frame"));
          }
        }
        queue.push({ level: kind, owner, run, attempts: 0, resolve, reject });
        poke();
        pump();
      });
    },
    /** Сколько отправок за минуту, из них фоновых, сколько ждёт (тесты). */
    stats() {
      prune();
      return { sent: sends.length, background: sends.filter((entry) => entry.level === "background").length, waiting: queue.length, blockedUntil };
    },
  };
}

/**
 * Общий вход выдачи ссылки: повторная выдача (`reuse`, `grant-reuse.js`) первой, настоящий запрос к серверу — через очередь. Один полёт на мод у `reuse` делят все, кто просил этот мод, а уровни у них разные:
 * выбор, присоединившийся к летящему ФОНОВОМУ запросу того же мода (навёл — сразу щёлкнул) или к вещи в кадре, которую отменили, не получает чужой отказ (`GRANT_SKIPPED`, `GRANT_CANCELLED`, отказ фона без
 * повтора): он один раз спрашивает заново своим уровнем. Фон чужие отказы не переспрашивает.
 */
export function createPacedGrant({ reuse, pacer, request }) {
  const ask = (modID, level, owner) => reuse.get(modID, () => pacer.run(level, () => request(modID), { owner }));
  return async (modID, level, owner) => {
    const own = levelOf(level);
    try {
      return await ask(modID, own, owner);
    } catch (error) {
      const alien = own !== "background" && error?.grantLevel && error.grantLevel !== own;
      if (alien && (error.grantLevel === "background" || error instanceof GrantCancelledError)) return ask(modID, own, owner);
      throw error;
    }
  };
}
