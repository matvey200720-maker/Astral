/*
 * Облачный каталог главного процесса: запомненный и свежий (Т-27).
 *
 * Каталог на 3000 модов — 60 страниц v2 подряд, 4–14 секунд. Окно ждало
 * последнюю страницу на каждом запуске и всё это время показывало пустую
 * главную. Теперь:
 *
 *   - последний проверенный каталог лежит в userData (`cloud-catalog.json`)
 *     страницами, как они пришли из сети. На старте они собираются заново
 *     той же проверкой, что у сети (`catalogV2FromPages`), и окно получает
 *     каталог сразу, а свежий спрашивается фоном и приходит событием
 *     (`onUpdate`);
 *   - запомненного нет (первый запуск, другой облачный адрес или медиа-хост,
 *     битый файл) — окно получает событием первые страницы, пока идут
 *     остальные. Ответ на запрос остаётся полным каталогом: подготовке игры
 *     и мастерской нужен весь.
 *
 * Запрос свежего каталога один за раз: окно, подготовка игры и мастерская,
 * спросившие одновременно, ждут одних и тех же страниц.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  catalogV1FromPages,
  fetchCatalogV1,
} from "@modovik/contracts/catalog-v1";
import {
  CatalogV2Error,
  CatalogV2Unavailable,
  catalogV2FromPages,
  fetchCatalogV2,
} from "@modovik/contracts/catalog-v2";
import {
  AUDIO_ORIGINS,
  MEDIA_ORIGINS,
  normalizeAttribution,
  normalizeWork,
} from "@modovik/publishing";

export const REMEMBERED_CATALOG_FILE = "cloud-catalog.json";
const FORMAT = 1;
/* Страницы весят около 3,4 КБ на мод (2818 модов — 9,4 МБ, 29.10): каталог на 25 000 модов (предел клиента, `catalogV2Limits`) — около 85 МБ. */
const MAX_REMEMBERED_BYTES = 128 * 1024 * 1024;
/* Первые страницы окно видит сразу, дальше — не чаще этого: каждая
   промежуточная выборка — это весь уже пришедший каталог через IPC и
   перерисовка главной. */
export const PARTIAL_EVERY_MS = 1500;
/* Запомненный каталог не старше этого свежим не спрашивается: каждый запуск скачивал все страницы заново (на 2800 модах — 57 запросов и 9 МБ), хотя через минуту после
   прошлого запуска в каталоге ничего нового нет. «Повторить» и вход перекачивают всегда (30.10.2026). */
export const FRESH_FOR_MS = 3 * 60_000;
/* Одна страница каталога: потолок на запрос и тело, повторы по тому же курсору при обрыве связи и «не сейчас» сервера (`fetchCatalogV2`). Страница — до 250 КБ, на плохом
   Wi-Fi это секунды, а не минуты; зависший запрос без потолка держал всю цепочку страниц, пока не оборвётся сам. */
export const PAGE_TIMEOUT_MS = 20_000;
export const PAGE_RETRIES = 4;

/* Словари публикации для разбора каталога v2: пакет контрактов сам ни от чего не зависит. */
export const CATALOG_V2_DICTIONARIES = Object.freeze({
  mediaOrigins: MEDIA_ORIGINS,
  audioOrigins: AUDIO_ORIGINS,
  normalizeWork,
  normalizeAttribution,
});

/**
 * Разбор запомненного файла: чтение, JSON и проверка страниц той же проверкой,
 * что у сети. Чистая функция — её выполняет и поток пула (`remembered-catalog`,
 * `heavy-work-jobs.js`), и главный процесс, если пул не поднялся. На главном
 * процессе каталог на 5000 модов держал цикл событий на 0,3 с. Возвращает
 * `{ catalog, drop }`: `drop` — что сказать в журнале и стереть файл.
 * Другой облачный адрес или медиа-хост — не ошибка: файл заменит первый же
 * свежий каталог (`catalog: null`, файл цел).
 */
export async function readRememberedCatalogFile({ file, origin, mediaOrigin = "", dictionaries }) {
  let raw;
  try {
    if ((await fs.stat(file)).size > MAX_REMEMBERED_BYTES)
      throw new Error("файл больше предела");
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { catalog: null, drop: null };
    return { catalog: null, drop: `Astral: запомненный каталог не прочитан: ${error.message}` };
  }
  try {
    const value = JSON.parse(raw);
    if (value?.format !== FORMAT) throw new Error("неизвестный формат");
    if (value.origin !== origin) return { catalog: null, drop: null };
    /* Чей это каталог: аккаунт, под которым его скачали (пусто — файл прежней версии). */
    const account = typeof value.account === "string" ? value.account : "";
    /* Когда скачан: от этого зависит, спрашивать ли свежий каталог на старте (`FRESH_FOR_MS`). */
    const savedAt = Date.parse(value.savedAt) || 0;
    if (value.contract === "v2") {
      if (!mediaOrigin || value.mediaOrigin !== mediaOrigin) return { catalog: null, drop: null };
      return { catalog: catalogV2FromPages(value.pages, { mediaOrigin, dictionaries }), account, savedAt, drop: null };
    }
    if (value.contract === "v1") return { catalog: catalogV1FromPages(value.pages), account, savedAt, drop: null };
    throw new Error("неизвестный контракт каталога");
  } catch (error) {
    return { catalog: null, drop: `Astral: запомненный каталог отброшен: ${error.message}` };
  }
}

/**
 * Запомненный каталог: страницы `[{ cursor, payload }]` с адресом, откуда
 * они пришли. `read()` — каталог, заново проверенный, или `null`;
 * `write()` — заменить целиком. `offThread({ file, origin, mediaOrigin })` —
 * разбор в потоке пула (окно его не ждёт на главном процессе); сбой пула —
 * тот же разбор на главном процессе.
 */
export function rememberedCatalog({
  file,
  origin,
  mediaOrigin = "",
  dictionaries,
  now = () => Date.now(),
  offThread = null,
}) {
  const forget = () => fs.rm(file, { force: true }).catch(() => {});

  /* `{ catalog, account, savedAt }`: запомненный каталог, аккаунт, чей он (пусто — не знаем), и когда он скачан (мс; 0 — не знаем). */
  async function readWithAccount() {
    const input = { file, origin, mediaOrigin };
    let outcome;
    try {
      outcome = offThread ? await offThread(input) : await readRememberedCatalogFile({ ...input, dictionaries });
    } catch {
      outcome = await readRememberedCatalogFile({ ...input, dictionaries });
    }
    if (outcome.drop) {
      console.warn(outcome.drop);
      await forget();
    }
    return { catalog: outcome.catalog, account: outcome.account || "", savedAt: outcome.savedAt || 0 };
  }

  async function read() {
    return (await readWithAccount()).catalog;
  }

  async function write({ contract, pages, account = "" }) {
    const body = JSON.stringify({
      format: FORMAT,
      origin,
      ...(contract === "v2" && { mediaOrigin }),
      ...(account && { account }),
      contract,
      savedAt: new Date(now()).toISOString(),
      pages,
    });
    if (Buffer.byteLength(body) > MAX_REMEMBERED_BYTES) {
      await forget();
      return false;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    /* Через временный файл: оборванная запись не оставляет полкаталога. Имя
       своё у каждой записи: две записи одного процесса не должны делить файл. */
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, body);
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return true;
  }

  return { read, readWithAccount, write };
}

/**
 * `load()` — каталог для запроса окна: запомненный (свежий спрашивается
 * фоном) или, без него, свежий из сети. `onUpdate(catalog, { partial })` —
 * то, что окно должно увидеть без запроса: первые страницы, пока
 * запомненного нет (`partial: true`), и свежий каталог после того, как
 * окну уже отдали запомненный. `file` пуст — ничего не запоминается.
 */
export function createCloudCatalog({
  origin,
  mediaOrigin = "",
  dictionaries,
  fetchImpl = fetch,
  file = "",
  onUpdate = null,
  now = () => Date.now(),
  partialEveryMs = PARTIAL_EVERY_MS,
  offThread = null,
  /* Чей каталог скачивается: `() => id аккаунта` (локально, без сети; пусто — гость). Метка ложится в запомненный файл (`remembered`). */
  accountOf = null,
  /* Сколько запомненный каталог считается свежим; 0 — всегда спрашивать сеть. */
  freshForMs = FRESH_FOR_MS,
  pageTimeoutMs = PAGE_TIMEOUT_MS,
  pageRetries = PAGE_RETRIES,
  retryDelays,
  pause,
  /* Журнал: `(level, message)` — что с каталогом на старте и сколько это стоило (весь каталог, повторы страниц, уход на v1). */
  log = null,
}) {
  const memory = file
    ? rememberedCatalog({ file, origin, mediaOrigin, dictionaries, now, offThread })
    : null;
  /* Последний полный проверенный каталог: запомненный или свежий. */
  let latest = null;
  /* Аккаунт, чей `latest` (пусто — не знаем: файл прежней версии или гость). */
  let latestAccount = "";
  /* Когда скачан `latest` (мс): запомненный — по файлу, свежий — по часам процесса. */
  let latestAt = 0;
  let memoryRead = null;
  let fresh = null;
  /* Сколько модов окно уже видело первыми страницами: повтор после обрыва
     начинает с первой страницы, и каталог в окне не должен съёживаться. */
  let shownPartially = 0;

  /* Каталог v2 — витрина целиком (docs/superpowers/specs/
     2026-09-29-cloud-catalog-v2-design.md). Без медиа-хоста в настройках
     (ASTRAL_MEDIA_ORIGIN) v2 не спрашивается: его картинки некому отдать.
     Сервер на v1 (404), битая страница v2 — тот же каталог, но по v1. */
  async function fetchPages({ progressive }) {
    const pages = [];
    let shownAt = -Infinity;
    const onPage = ({ cursor, payload, done, snapshot }) => {
      pages.push({ cursor, payload });
      if (!progressive || !onUpdate || done) return;
      const at = now();
      if (at - shownAt < partialEveryMs) return;
      const partial = snapshot();
      if (partial.mods.length <= shownPartially) return;
      shownAt = at;
      shownPartially = partial.mods.length;
      onUpdate(partial, { partial: true });
    };
    if (mediaOrigin) {
      try {
        const catalog = await fetchCatalogV2({
          origin,
          mediaOrigin,
          dictionaries,
          fetchImpl,
          onPage,
          pageTimeoutMs,
          pageRetries,
          ...(retryDelays && { retryDelays }),
          ...(pause && { pause }),
          /* Не дотянулись до облака на этапе входа (обновление токена уже отстояло свой потолок): повтор страницы через секунду ждал бы тот же потолок заново. Повторяется сама страница. */
          isRetryable: (error) => error?.kind !== "unreachable" && error?.kind !== "rejected",
          onRetry: ({ page, attempt, error }) =>
            log?.("warn", `каталог: страница ${page} не пришла (${error?.name === "TimeoutError" ? "потолок" : error?.message || error}) — повтор ${attempt}`),
        });
        return { catalog, contract: "v2", pages };
      } catch (error) {
        /* v1 — только когда v2 «не здесь» или его данные негодны: сервер старше v2, битая страница. Обрыв связи и потолок v1 не лечит — тот же путь, те же страницы:
           раньше любой сбой на любой странице (в том числе потолок запроса) скидывал каталог на v1 и качал всё с первой страницы второй раз. */
        if (!(error instanceof CatalogV2Unavailable) && !(error instanceof CatalogV2Error)) throw error;
        log?.("warn", `каталог: v2 не вышел (${error.message}) — спрашиваем v1`);
        pages.length = 0;
      }
    }
    const catalog = await fetchCatalogV1({ origin, fetchImpl, onPage });
    return { catalog, contract: "v1", pages };
  }

  function refresh({ forceAnnounce = false } = {}) {
    if (fresh) return fresh;
    /* Окну уже отдали запомненный — свежий оно получит событием. Иначе оно
       ждёт этот запрос и видит первые страницы, пока идут остальные. */
    const announce = forceAnnounce || Boolean(latest);
    const started = now();
    fresh = fetchPages({ progressive: !announce })
      .then(async ({ catalog, contract, pages }) => {
        latest = catalog;
        latestAt = now();
        log?.("info", `каталог: ${catalog.mods.length} модов, ${pages.length} страниц, ${contract}, за ${((now() - started) / 1000).toFixed(1)} с`);
        /* Предел клиента: каталог обрезан, а не отброшен (до 03.11.2026 переросший предел каталог падал целиком). */
        if (catalog.truncated) log?.("warn", `каталог: дошли до предела клиента (${catalog.mods.length} модов) — остальные страницы не спрошены`);
        latestAccount = await currentAccount();
        await memory?.write({ contract, pages, account: latestAccount }).catch((error) => {
          console.warn(`Astral: каталог не запомнен: ${error.message}`);
        });
        if (announce) onUpdate?.(catalog, { partial: false });
        return catalog;
      })
      .finally(() => {
        fresh = null;
      });
    return fresh;
  }

  async function currentAccount() {
    try {
      return String((await accountOf?.()) || "");
    } catch {
      return "";
    }
  }

  /* Запомненный файл читается один раз за жизнь процесса: общий и для `load`, и для `remembered`. */
  function readMemory() {
    memoryRead ||= Promise.resolve(memory?.readWithAccount() ?? { catalog: null, account: "", savedAt: 0 }).then(({ catalog, account, savedAt }) => {
      if (!latest && catalog) {
        latest = catalog;
        latestAccount = account;
        latestAt = savedAt;
      }
    });
    return memoryRead;
  }

  /*
   * Запомненный каталог для аккаунта `accountId` — только с диска, сети не просит: окно видит его сразу, а открытость каталога и свежий проверяются фоном. Отдаётся лишь тому, кто его
   * скачал: каталог «только команде», и чужой файл (на компьютере вошёл другой человек) или файл прежней версии без метки сразу не показываются — они идут прежним путём (`load`).
   */
  async function remembered(accountId) {
    await readMemory();
    return accountId && latest && latestAccount === accountId ? latest : null;
  }

  /*
   * Запомненный каталог без метки аккаунта: файл прежней версии (до метки) или каталог гостя. Метка нужна, чтобы чужой каталог не показывался сразу; у файла без метки её нет, и он
   * ждёт ответа сети о доступе, как прежде, — но не дольше короткого бюджета (`catalogChecked`): после обновления Astral первый запуск ложился на тот же 8-секундный потолок, что и
   * вылечили для файлов с меткой. Каталог гостя пуст, а каталог прежней версии — того, кто на этом компьютере входил, и свежий каталог приходит событием сразу за ним.
   */
  async function rememberedUnlabelled() {
    await readMemory();
    return latest && !latestAccount ? latest : null;
  }

  async function load() {
    await readMemory();
    if (!latest) return refresh();
    /* Скачан только что — спрашивать нечего: страницы те же. */
    if (freshForMs > 0 && latestAt && now() - latestAt < freshForMs) return latest;
    refresh().catch((error) => {
      console.warn(`Astral: каталог не обновился: ${error.message}`);
    });
    return latest;
  }

  /*
   * Перекачать каталог заново и отдать окну событием — после входа или когда
   * вход поднялся позже, чем ушли страницы (бета 14.10.2026: у админа первые
   * страницы ушли без входа, и сервер честно отдал пустой каталог гостя).
   * Идущий запрос дожидается и спрашивается ещё раз: он мог уйти без входа.
   */
  async function reload() {
    if (fresh) await fresh.catch(() => {});
    return refresh({ forceAnnounce: true });
  }

  return { load, reload, remembered, rememberedUnlabelled };
}

/*
 * Открыт ли каталог этому аккаунту (бета 14.10.2026: каталог — только команде).
 * `request()` — ответ `GET /api/v1/app/catalog/access`: `{ status, body }` или
 * `null`, если человек не входил (спрашивать не у кого). Правила — лида:
 *   200 `{ open }`    — как сказал сервер;
 *   404               — старый сервер, ворот ещё нет: открыто;
 *   сеть, 5xx, любое другое — закрыто, и запомненный каталог не показывается.
 * Ответ помнится недолго: каталог просят окно, подготовка игры и мастерская,
 * и каждому незачем стучаться на сервер.
 */
export const CATALOG_ACCESS_TTL_MS = 60_000;

export function createCatalogAccess({
  request,
  now = () => Date.now(),
  ttlMs = CATALOG_ACCESS_TTL_MS,
}) {
  let answered = null;
  let pending = null;

  /* С 14.10.2026 (вечер) закрывает сервер: каталог «только команде» он сам
     отдаёт пустым тому, кому не положено, а этот вопрос всегда отвечает
     «открыт». Поэтому сбой вопроса (сеть, 5xx, 401 до подъёма входа) больше
     не прячет каталог — раньше у админа на старте он так и выходил пустым.
     Явное `{ open: false }` по-прежнему закрывает. */
  async function ask() {
    try {
      const answer = await request();
      if (answer?.status === 200 && answer.body?.open === false) return false;
      return true;
    } catch {
      return true;
    }
  }

  return {
    async isOpen() {
      if (answered && now() - answered.at < ttlMs) return answered.open;
      pending ||= ask()
        .then((open) => {
          answered = { open, at: now() };
          return open;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    /** После выхода из аккаунта прежний ответ не годится. */
    forget() {
      answered = null;
    },
  };
}

/** Облачная часть каталога, когда он закрыт: ни модов, ни разделов. */
export const CLOSED_CLOUD_CATALOG = Object.freeze({
  source: "astral-catalog-closed",
  platforms: [],
  categories: [],
  mods: [],
});
