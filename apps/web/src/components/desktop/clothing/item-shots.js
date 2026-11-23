/*
 * Снимки вещей самой GTA для плиток «Сделать заменёнку» (ТЗ 27.10.2026, п. 1; владелец: «чтобы отображались стандартные GTA-шные модельки,
 * чтобы человек понимал, на что он заменяет… не просто значок»).
 *
 * У вещи игры картинки на CDN нет. Её снимает у самого игрока тот же путь, что карточки категорий мастерской (`gun/clothing-cards.js`):
 * Astral Desktop находит вещь в оглавлении его игры, читает модель и первую расцветку в потоке чтения игры и отдаёт запрос снимка
 * (`readGameItemShot`, `apps/desktop/src/game-item-shot.js`), окно снимает его съёмщиком одежды (`clothing-shot.js`: прозрачный фон, вещь
 * вписана в квадрат). Правила `docs/3D.md`: один контекст WebGL (съёмщик один и отпускается, когда очередь пуста), снимки идут по одному, в
 * очереди — только то, что плитка просит, подъехав к краю окна (плитка ушла — снимок не берётся), готовый снимок ложится в хранилище мастерской
 * на диске — второй раз плитка открывается сразу, память кадров с потолком (`LIMIT`: лишнее освобождается, кроме снимков на экране).
 * Нет Astral Desktop, игры, вещи или модели — снимка нет, остаётся значок: образец не рисуется.
 *
 * Замер на закрытой сборке ×4 в Desktop (27.10.2026, `scripts/perf/baseline/clothing-pick-electron.mjs`): съёмщик, который отпускался после каждой пачки, за
 * прокрутку пересоздавался раз за разом (контекст WebGL, окружение, шейдеры — около секунды процессора ×4 каждый раз), а снимки поверх
 * прокрутки роняли сетку с 48–55 кадров/с до 16–18. Поэтому съёмщик держится после последнего снимка (`SHOOTER_HOLD_MS`), пока плитки на экране,
 * а снимок не начинается, пока сетку прокручивают (`SCROLL_QUIET_MS`).
 */

import { useEffect, useSyncExternalStore } from "react";
import { ITEM_SHOT_VERSION } from "@modovik/clothing/shot-request";
import { gameItemShotsAvailable, readGameItemShot } from "../../../api.js";
import { detectLegacyGame } from "../../../features/workshop/install-queue/game-root.js";
import { getWorkshopAsset, putWorkshopAsset } from "../workshop/workshop-assets.js";
import { photoOff } from "../../../features/clothing/photo-switches.js";
import { notePreviewFailure } from "../../../features/clothing/preview-journal.js";
import { createItemShooter } from "./item-shooter.js";

/* Шаги снимка для замера (стенд `scripts/perf/baseline/clothing-photos.mjs`): стенд заводит `globalThis.__astralShotTrace`, в приложении его нет — одна проверка. */
const trace = (step, key = "") => {
  const list = globalThis.__astralShotTrace;
  if (list) list.push([step, key, performance.now()]);
};

/** Сколько снимков держит окно: больше — самые давние, что не на экране, отпускаются. */
export const LIMIT = 600;

const pictures = new Map();
const failed = new Set();
/* Расцветки, которых у вещи нет в играх файлов (ответ Desktop `none`, 22.11.2026): плитка такой расцветки убирается из раскрытой вещи, а не рисуется пустой карточкой со значком. Память окна, на диск не пишется. */
/* Набор заменяется целиком при каждом изменении (снимок для `useSyncExternalStore`: новая ссылка — плитки пересчитываются). Сюда же попадают расцветки-заглушки игры (Rockstar оставил слот пустым, ответ `none` с причиной `stub`). */
let absent = new Set();
const absentListeners = new Set();
const setAbsent = (next) => {
  absent = next;
  for (const listener of absentListeners) listener();
};
const markAbsent = (key) => {
  if (!absent.has(key)) setAbsent(new Set(absent).add(key));
};

/** Расцветка названа заглушкой ЗАРАНЕЕ: по размеру файла из оглавления (`item.colourStubs`, строка ряда, `packages/clothing/colour-files.js`) — окно знает о ней без чтения файла и без мигания плитки. Вещи серверов полей не несут. */
const stubbedBySize = (item, colour) => !item?.server && Array.isArray(item?.colourStubs) && item.colourStubs.includes(colour);

/** Нет ли у вещи игры расцветки `colour`: размер файла в оглавлении назвал её заведомой заглушкой или Desktop ответил «такой расцветки нет» (чтение показало заглушку, файла нет). Вещи серверов — никогда: их ключ снимка совпал бы с вещью игры. */
export const shotAbsent = (item, colour, gone = absent) => !item?.server && (stubbedBySize(item, colour) || (gone.size > 0 && gone.has(itemShotKey({ ...item, shotColour: colour }))));

/** Сколько расцветок у вещи в строке (не меньше одной). */
const totalOf = (item, total) => Math.max(1, Number(total ?? item?.textures) || 1);

/**
 * Номера расцветок раскрытой вещи, у которых есть что показывать: `count` — сколько расцветок у неё всего (`itemColourCount`), `gone` — набор из `useAbsentShots()`. Номера остаются НАСТОЯЩИМИ (у куртки с настоящими
 * `a, b, c, m` и заглушками между ними это 0, 1, 2, 12 — «Расцветка 1, 2, 3, 13»; у обуви, где настоящая только 11-я, — одна плитка «Расцветка 11»): по ним ставится заменёнка, сдвигать их нельзя. Нулевая расцветка не особая:
 * если она заглушка, её плитки нет, как и любой другой.
 */
export const shownColours = (item, count, gone = absent) => Array.from({ length: count }, (_, index) => index).filter((index) => !shotAbsent(item, index, gone));

/**
 * Первая настоящая расцветка вещи — её картинка на плитке и расцветка по умолчанию при выборе вещи без раскрытия (владелец, 22.11.2026: «прятать пустые расцветки», не вещь с настоящими). `null` — настоящих нет ни одной.
 * Вещи серверов — всегда 0. Заведомые заглушки (`colourStubs`) обходятся без чтения; заглушка, которую показало чтение, помечена в памяти окна, и выбор сам идёт дальше.
 */
export function firstColour(item, total, gone = absent) {
  if (!item || item.server) return 0;
  const count = totalOf(item, total);
  for (let index = 0; index < count; index += 1) if (!shotAbsent(item, index, gone)) return index;
  return null;
}

/**
 * Вещь игры, которую не показываем вовсе (владелец, 22.11.2026: «Прятать»): у неё нет ни одной настоящей расцветки — все файлы заведомые заглушки (`colourStubs`) или Desktop ответил «такой расцветки нет» на каждую, что просили (прочитанная
 * шахматка, пустой файл, нет файлов расцветок). Вещь, у которой заглушка только первая, показывается: её картинка — первая настоящая расцветка (`firstColour`). Вещи серверов сюда не попадают.
 */
export const gameItemHidden = (item, gone = absent) => Boolean(item) && !item.server && firstColour(item, item.textures, gone) === null;

/** Число настоящих расцветок вещи (значок на плитке и счётчик): `total` — сколько их в строке вещи, минус заведомые заглушки и те, что Desktop уже назвал отсутствующими; не меньше одной. */
export const realColourCount = (item, total, gone = absent) => Math.max(1, Array.from({ length: totalOf(item, total) }, (_, index) => index).filter((index) => !shotAbsent(item, index, gone)).length);

/** Подписка плиток на уход расцветок: набор меняется, когда какая-то расцветка признана несуществующей. */
export function useAbsentShots() {
  return useSyncExternalStore(
    (listener) => {
      absentListeners.add(listener);
      return () => absentListeners.delete(listener);
    },
    () => absent,
    () => absent,
  );
}
/* Первая строка отказа вещи, у которой снимок не вышел: плитка по ней различает «в игре это место пустое» и общий отказ (22.11.2026). */
const failedWhy = new Map();
/* Сколько плиток сейчас просят снимок вещи: 0 — никто не ждёт, снимок в очереди пропускается. */
const wanted = new Map();
const mounted = new Map();
const pending = new Set();
const listeners = new Map();

/** Ключ вещи в снимках: пол, вид, папка (регистр не важен) и номер. */
export const itemShotKey = (item) =>
  `${item.gender}|${item.component}|${String(item.folder || "").toLowerCase()}|${item.drawable}${item.shotColour > 0 ? `|c${item.shotColour}` : ""}`;

/** Вещь, которую можно снять из игры: у неё есть пол, вид, папка и номер, а у окна — Astral Desktop. */
export const canShootItem = (item) =>
  Boolean(item) &&
  (item.gender === "male" || item.gender === "female") &&
  Boolean(item.component) &&
  Boolean(item.folder) &&
  Number.isInteger(item.drawable) &&
  gameItemShotsAvailable();

/** Есть ли чем снимать вещи игры: Astral Desktop. */
export const itemShotsAvailable = () => gameItemShotsAvailable();

const notify = (key) => {
  for (const listener of listeners.get(key) || []) listener();
};

/* Игра ищется один раз и без окна выбора папки: человек ничего не просил. */
let gameRoot = null;
const findGame = () => {
  gameRoot ||= detectLegacyGame().catch(() => "");
  return gameRoot;
};

/*
 * Снимки — по одному: контекст WebGL съёмщика один, и десятки плиток разом заняли бы видеочип и главный поток. Съёмщик отпускается, когда
 * очередь пуста.
 *
 * Очередь — не цепочка обещаний (круг 4, 28.10.2026; замер на закрытой сборке ×4: после быстрой прокрутки по списку сервера плитки на экране
 * не получали снимок и через 90 с — в цепочке стояли сотни плиток, мимо которых уже проехали, и каждая ещё ждала своей «тихой минуты», прежде
 * чем выяснить, что снимать её не нужно). Теперь ушедшая плитка выбывает из очереди без ожидания, а из тех, что на экране, первой идёт
 * самая свежая пачка — те, к кому подъехали сейчас, — и в пачке плитки идут по порядку сетки.
 */
let shooter = null;
let running = false;
let hold = null;
const queue = new Map();
/* Когда и какой пачкой плитка попросила снимок: пачка — плитки, что подъехали к краю окна в одни и те же 80 мс (первый экран, шаг прокрутки). */
const asked = new Map();
let askSeq = 0;
let askBatch = 0;
let lastAskAt = -Infinity;

/** Сколько плиток, подъехавших друг за другом, считаются одной пачкой. */
export const BATCH_MS = 80;

function markAsked(key) {
  const now = performance.now();
  if (now - lastAskAt > BATCH_MS) askBatch += 1;
  lastAskAt = now;
  asked.set(key, { batch: askBatch, seq: (askSeq += 1) });
}

/** Сколько съёмщик живёт после последнего снимка, пока плитки на экране: пачки плиток идут одна за другой, пересоздавать съёмщик каждый раз незачем. */
export const SHOOTER_HOLD_MS = 12_000;

/** Съёмщик отпущен: контекст WebGL, окружение и шейдеры освобождены. Очередь не пуста — не трогаем: он ещё нужен. */
function releaseShooter() {
  clearTimeout(hold);
  hold = null;
  if (running || queue.size) return;
  shooter?.dispose();
  shooter = null;
  stopWatchingScroll();
}

/* Снимок пропущен: плитка ушла с экрана, пока вещь стояла в очереди. Это не неудача — вернётся плитка, вещь снимется. */
const SKIPPED = Symbol("skipped");
/* Desktop ответил «такой расцветки у вещи нет»: не отказ, снимка не будет. */
const NO_COLOUR = Symbol("no-colour");

/** Плитки, что ушли с экрана, выбывают из очереди сразу: их снимок не нужен, и ждать для этого нечего. */
function dropGone() {
  for (const [key, entry] of queue) {
    if (wanted.get(key) > 0) continue;
    queue.delete(key);
    /* Прочитанное вперёд для ушедшей плитки больше не занимает места в `READ_AHEAD`: иначе три таких чтения навсегда закрыли бы чтение вперёд. */
    reads.delete(key);
    entry.resolve(SKIPPED);
  }
}

/** Раньше ли плитка `a` плитки `b` в очереди: свежая пачка первой, в пачке — раньше попросившая. Одно правило и для снимка, и для чтения вперёд. */
function before(a, b) {
  const x = asked.get(a) || { batch: 0, seq: 0 };
  const y = asked.get(b) || { batch: 0, seq: 0 };
  return x.batch !== y.batch ? x.batch > y.batch : x.seq < y.seq;
}

/** Следующая плитка: из просящих сейчас — самой свежей пачки, в пачке — раньше попросившая. */
function takeNext() {
  dropGone();
  let best = null;
  for (const [key, entry] of queue) if (!best || before(key, best.key)) best = { key, entry };
  if (best) queue.delete(best.key);
  return best?.entry || null;
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      dropGone();
      if (!queue.size) break;
      /* Тихая минута — один раз на снимок; пока ждали, пачки сменились, поэтому плитку выбираем после неё. */
      await quiet();
      const entry = takeNext();
      if (!entry) continue;
      trace("dequeued", entry.item ? itemShotKey(entry.item) : "");
      try {
        entry.resolve(await entry.task());
      } catch (error) {
        entry.reject(error);
      }
    }
  } finally {
    running = false;
    /* Плитки на экране — съёмщик ещё пригодится (прокрутка приносит новую пачку); окно закрыли — отпускается сразу. */
    if (queue.size) void pump();
    else if (mounted.size && shooter) hold = setTimeout(releaseShooter, SHOOTER_HOLD_MS);
    else releaseShooter();
  }
}

function enqueue(key, task, item = null, root = "") {
  clearTimeout(hold);
  hold = null;
  watchScroll();
  const done = new Promise((resolve, reject) => queue.set(key, { task, resolve, reject, item, root }));
  void pump();
  return done;
}

/*
 * Пока сетку прокручивают, снимок не начинается: прокрутка сама рисует плитки, и снимок поверх неё рвёт кадры (читает кадр с видеочипа,
 * режет по альфе, кодирует PNG — десятки миллисекунд на главном потоке, ×4 у тестера). Слушатель — только пока есть очередь.
 */
export const SCROLL_QUIET_MS = 200;
const IDLE_TIMEOUT_MS = 100;
let lastScroll = -Infinity;
let watching = false;
const onScroll = () => {
  lastScroll = performance.now();
};
function watchScroll() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("wheel", onScroll, { capture: true, passive: true });
}
function stopWatchingScroll() {
  if (!watching) return;
  watching = false;
  document.removeEventListener("scroll", onScroll, { capture: true });
  document.removeEventListener("wheel", onScroll, { capture: true });
}

/*
 * Между снимками — тихая минута окна (`requestIdleCallback`, но не дольше 250 мс): снимок держит главный поток десятки миллисекунд (чтение
 * кадра с видеочипа, обрезка по альфе), а плитки идут сотнями — прокрутка и нажатия не должны рваться (правила 8 и 12 `docs/3D.md`).
 */
const idle = () =>
  new Promise((resolve) => {
    /* Потолок ожидания тихой минуты — 100 мс, а не 250 (15.11.2026, замер на стенде: между снимками первого экрана «GTA» уходило 0,4–0,6 с; сам снимок идёт в потоке, главный поток держит только приём
       байтов; все восемь снимков 7,1 → 5,9 с на четырёх прогонах из четырёх). Прокрутку по-прежнему ждёт `SCROLL_QUIET_MS`. */
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: photoOff("idle") ? 250 : IDLE_TIMEOUT_MS });
    else setTimeout(resolve, 0);
  });

async function quiet() {
  for (;;) {
    await idle();
    /* Сетку прокрутили, пока ждали тихой минуты, — ждём, пока прокрутка стихнет, и снова тихой минуты. */
    const left = SCROLL_QUIET_MS - (performance.now() - lastScroll);
    if (left <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, left));
  }
}

const ITEM_SHOOTER = Object.freeze({ render: 768, size: 384, cover: false });

const cacheKey = (root, key) => `item-shot:v${ITEM_SHOT_VERSION}:${root.toLowerCase()}:${key}`;

/*
 * Чтение вещи заранее (01.11.2026, владелец: «некоторые очень долго прогружаются»): съёмщик занят по одной вещи, а читает Desktop в своём потоке, и ждать конца съёмки, чтобы начать чтение следующей, незачем.
 * Пока снимается одна, читаются следующие в очереди, не больше `READ_AHEAD`.
 */
/* Глубина чтения вперёд — три (15.11.2026, замер на стенде: шесть вместо трёх не ускоряют, а замедляют: поток чтения у Desktop один, шесть чтений разом ждут друг друга, и 2 МиБ ответа на каждое
   разбирает главный поток окна; все восемь снимков 6,5 с против 6,0 с). */
const READ_AHEAD = 3;
const reads = new Map();

/* Отказ снимка вещи игры больше не глотается молча (22.11.2026, пустой предпросмотр в 1.0.0): запись в журнал окна — код, первая строка слов, имя вещи. */
const noteShotRefusal = (item, error) =>
  notePreviewFailure({ source: "clothing-photo", stage: "Фото вещи игры не снялось", subject: item?.name || item?.key || itemShotKey(item), error });

const readShot = (item, root) => {
  const key = itemShotKey(item);
  if (!reads.has(key)) {
    trace("read-start", key);
    reads.set(
      key,
      /* Своё чтение у того, что не вещь игры: часть тела плитки блэкворка. */
      item.readShot ? item.readShot(root) : readGameItemShot({ gameRoot: root, gender: item.gender, component: item.component, folder: item.folder, ...(item.shotColour > 0 ? { colour: item.shotColour } : {}), drawable: item.drawable }),
    );
    reads.get(key).then(() => trace("read-end", key), () => trace("read-fail", key));
  }
  return reads.get(key);
};

/* Читаем вперёд в том же порядке, в каком очередь отдаёт плитки (`before`): по порядку вставки читались бы старые пачки, а свежая, которой снимок достанется следующей, ждала бы чтения (01.11.2026, тест «первой снимается самая свежая пачка»). */
function readAhead() {
  let started = reads.size;
  if (started >= READ_AHEAD) return;
  const ahead = [...queue].filter(([key, entry]) => !reads.has(key) && entry.item && wanted.get(key) > 0).sort(([a], [b]) => (before(a, b) ? -1 : 1));
  for (const [, entry] of ahead) {
    if (started >= READ_AHEAD) break;
    readShot(entry.item, entry.root).catch((error) => noteShotRefusal(entry.item, error));
    started += 1;
  }
}

async function flatPicture({ width, height, rgba }) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/*
 * Съёмщик поднимается, как только вещь пошла в очередь, а не после чтения её модели (15.11.2026): поток с контекстом WebGL и окружением собирается ≈ 1–2 с ×4, и раньше он начинал это
 * только по окончании первого чтения (≈ 0,3–1,5 с), так что первый снимок ждал сумму, а не большее из двух. Выключатель замера `early` — как раньше.
 */
function startShooter(key) {
  if (shooter) return;
  trace("shooter-create", key);
  shooter = createItemShooter(ITEM_SHOOTER);
}

async function shootItem(item, root) {
  const key = itemShotKey(item);
  const reading = readShot(item, root);
  readAhead();
  let shot;
  let flat;
  let none;
  try {
    ({ shot, flat, none } = await reading);
  } finally {
    reads.delete(key);
  }
  trace("read-taken", key);
  if (none === true) return NO_COLOUR;
  /* У вещи нет модели в игре (большие сумки: только место под неё), снимать нечего: картинка — сама её расцветка из игры. */
  if (flat) return flatPicture(flat);
  /* Плитка — 150 пикселей: съёмка 768, снимок 384 (в два раза чётче плитки), без обложки. Снимает поток с OffscreenCanvas (`item-shooter.js`):
     контекст, окружение, ожидание шейдеров и чтение кадра идут мимо окна. */
  startShooter(key);
  trace("shoot-start", key);
  const { bytes } = await shooter.shoot(shot);
  trace("shoot-end", key);
  return new Blob([bytes], { type: "image/png" });
}

async function itemBlob(item, key) {
  const root = await findGame();
  if (!root) return null;
  trace("game-found", key);
  const cached = await getWorkshopAsset(cacheKey(root, key)).catch(() => null);
  trace(cached ? "disk-hit" : "disk-miss", key);
  if (cached) return cached;
  if (!photoOff("early")) startShooter(key);
  /* Плитка ушла с экрана, пока вещь стояла в очереди, — очередь отдаёт `SKIPPED`, снимать её незачем. */
  const blob = await enqueue(key, () => shootItem(item, root), item, root);
  /* Снимок на плитку не ждёт записи на диск (IndexedDB, 70–100 мс на вещь): запись идёт следом. */
  if (blob && blob !== SKIPPED && blob !== NO_COLOUR) void putWorkshopAsset(cacheKey(root, key), blob).then(() => trace("stored", key), () => {});
  return blob;
}

/* Лишние снимки отпускаются: те, что на экране (плитка смонтирована), остаются. */
function trim() {
  if (pictures.size <= LIMIT) return;
  for (const [key, url] of pictures) {
    if (pictures.size <= LIMIT) break;
    if (mounted.get(key) > 0) continue;
    URL.revokeObjectURL(url);
    pictures.delete(key);
  }
}

/* Отказ «не удалось прочитать» (сбой чтения расцветки, 22.11.2026) — не приговор: окно не запоминает его на весь запуск, повторная просьба той же плитки (она вернулась на экран, окно открыли снова) уходит после этой паузы.
   Отказы «нашлось/нет» (нет вещи, модели, пустышка) помнятся, как прежде. Через IPC доезжает только текст отказа — по нему и различаем (`game-item-shot.js`). */
const TRANSIENT_REFUSAL = /не удалось прочитать/;
const RETRY_COOLDOWN_MS = 20_000;
const cooling = new Map();
const isCooling = (key) => cooling.get(key) > Date.now();

function load(item, key) {
  if (pictures.has(key) || pending.has(key) || failed.has(key) || isCooling(key)) return;
  pending.add(key);
  trace("ask", key);
  /* Прокрутка, что идёт уже сейчас, считается с первой просьбы, а не с выхода вещи в очередь (она ждёт игру и хранилище). */
  watchScroll();
  itemBlob(item, key)
    .then((blob) => {
      if (blob === SKIPPED) return;
      if (blob === NO_COLOUR) {
        markAbsent(key);
        return;
      }
      /* Игры на ПК нет — снимать нечего: значок. */
      if (!blob) {
        failed.add(key);
        return;
      }
      pictures.set(key, URL.createObjectURL(blob));
      trim();
    })
    /* Вещь не нашлась, нет модели или она пустышка — значок; повтор — со следующим запуском окна. */
    .catch((error) => {
      if (TRANSIENT_REFUSAL.test(String(error?.message || error))) cooling.set(key, Date.now() + RETRY_COOLDOWN_MS);
      else failed.add(key);
      /* Первая строка отказа — плитке для подсказки («в игре это место пустое» / общая), и в паузе повтора тоже. Запись в журнал окна (`noteShotRefusal`) не трогается: пишется на каждый настоящий отказ, в том числе на «не удалось прочитать». */
      failedWhy.set(key, String(error?.message ?? error ?? "").split(/\r?\n/)[0].slice(0, 200));
      noteShotRefusal(item, error);
    })
    .finally(() => {
      pending.delete(key);
      notify(key);
    });
}

/*
 * Прогрев (15.11.2026, замер на закрытой сборке ×4): первое чтение вещи в настоящем Desktop — ≈ 1,4 с, а в Node то же чтение — 0,25 с: остальное — запуск потока чтения игры у Desktop
 * (загрузка его модулей). Поток поднимается, пока человек ещё не дошёл до вкладки «GTA»: пустой вызов `warm` читает оглавление и ничего не снимает. Хранилище мастерской тоже
 * открывается заранее (первое обращение — 240 мс). Съёмщик (контекст WebGL) не поднимается: он нужен, только когда снимки действительно просят. Выключатель замера `warmup`.
 */
let warmed = false;
export function warmItemShots() {
  if (warmed || photoOff("warmup") || !gameItemShotsAvailable()) return;
  warmed = true;
  const start = () => {
    findGame()
      .then((root) => {
        if (!root) return;
        void getWorkshopAsset(cacheKey(root, "warm")).catch(() => null);
        return readGameItemShot({ gameRoot: root, warm: true }).catch(() => {});
      })
      .catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 800);
}

/** Забыть снятое в этом окне — для тестов (хранилище мастерской не трогается). */
export function resetItemShots() {
  for (const entry of queue.values()) entry.resolve(SKIPPED);
  queue.clear();
  reads.clear();
  asked.clear();
  lastAskAt = -Infinity;
  releaseShooter();
  lastScroll = -Infinity;
  for (const url of pictures.values()) URL.revokeObjectURL(url);
  pictures.clear();
  failed.clear();
  cooling.clear();
  setAbsent(new Set());
  failedWhy.clear();
  wanted.clear();
  mounted.clear();
  pending.clear();
  listeners.clear();
  gameRoot = null;
  warmed = false;
}

const bump = (map, key, step) => {
  const next = (map.get(key) || 0) + step;
  if (next > 0) map.set(key, next);
  else map.delete(key);
};

/**
 * Снимок вещи игры: `{ url, status }`, где `status` — `idle` (не просили), `pending` (очередь или съёмка), `ready` или `failed`. `asked` — плитка
 * подъехала к краю окна и снимок ей нужен; пока `false`, ничего не читается.
 */
export function useItemShot(item, asked) {
  const key = item && canShootItem(item) ? itemShotKey(item) : "";
  const snapshot = useSyncExternalStore(
    (listener) => {
      if (!key) return () => {};
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => listeners.get(key)?.delete(listener);
    },
    () => (key ? pictures.get(key) || (failed.has(key) || isCooling(key) ? "!" : pending.has(key) ? "…" : "") : ""),
    () => "",
  );
  useEffect(() => {
    if (!key) return undefined;
    bump(mounted, key, 1);
    return () => {
      bump(mounted, key, -1);
      /* Последняя плитка ушла (окно закрыли), очереди нет — съёмщик отпускается сразу, не ждёт `SHOOTER_HOLD_MS`. */
      if (!mounted.size) releaseShooter();
    };
  }, [key]);
  useEffect(() => {
    if (!key || !asked) return undefined;
    bump(wanted, key, 1);
    markAsked(key);
    load(item, key);
    return () => bump(wanted, key, -1);
    // Вещь — по ключу: новая запись той же вещи снимок не перезапрашивает.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, asked]);
  if (!key) return { url: "", status: "idle" };
  if (snapshot === "!") return { url: "", status: "failed", reason: failedWhy.get(key) || "" };
  if (snapshot === "…") return { url: "", status: "pending" };
  if (snapshot) return { url: snapshot, status: "ready" };
  return { url: "", status: asked ? "pending" : "idle" };
}
