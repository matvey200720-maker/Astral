/*
 * Миниатюра модели без открытия в студии.
 *
 * У части моделей «Моделей» картинки в поставке нет: свой .glb, ствол пака,
 * вещь из игры. Раньше плитка ждала, пока модель откроют, и до тех пор
 * стояла значком. Здесь модель снимается в фоне: один общий холст WebGL,
 * по одной модели за раз, ракурс и свет — как у кадра студии (три четверти,
 * сбоку-спереди, прозрачный фон). Картинка кладётся в то же хранилище, что
 * снимок студии (`storeModelThumbnailBlob`), — на диск, и второй раз плитка
 * открывается сразу.
 *
 * Шейдеры — параллельным компилятором видеочипа, как у кадров мастерской
 * (`shader-warmup.js`, docs/3D.md, правило 7): снимок ждёт готовые программы, а
 * не стоит на их сборке, и журналы сборки вне разработки не читаются. Стенд
 * 21.10.2026 (закрытая ×4, картинки обвесов): без этого каждая новая модель
 * держала кадр 55–85 мс, первая на холодном кэше шейдеров — 477 мс.
 *
 * Где снимается (31.10.2026, замер полки вещей мастерской одежды в живом Electron на закрытой сборке ×4: первая плитка 1,2 с, все 17 — 4 с, главный поток занят разбором, сборкой,
 * кадром и `toBlob` самих плиток): снимок плитки без «tight» рисует поток (`model-thumbnail-worker.js`, `OffscreenCanvas`, кодирование WebP там же) — главному потоку остаются
 * хранилище и перерисовка. Поток греется заранее (`warmModelThumbnails`): рендерер, отражение студии и программа ткани собраны до первого щелчка по слоту. Нет потока, нет `OffscreenCanvas`,
 * поток отказал в окружении (`kind: "engine"`) — снимок идёт на холсте окна, как раньше. «tight» (картинки обвесов, обрезка полей на 2D-холсте) — всегда на холсте окна.
 */

import { tr } from "../../../../locales/ui.js";
import { trimmedFrame } from "./thumbnail-fit.js";
import { THUMBNAIL_SIZE, ThumbnailFailure, createThumbnailRenderer, disposeThumbnailRenderer, shootModel } from "./model-thumbnail-core.js";

/* Холст WebGL нужен, пока плитки снимаются. Без снимков столько времени —
   контекст отпускается (`forceContextLoss`) и заводится заново на следующий
   снимок: иначе он держал память видеочипа до закрытия окна (ОЗУ 15.10). */
const IDLE_MS = 30_000;
let shared = null;
let idle = null;
let busy = 0;

function release() {
  idle = null;
  if (!shared || busy) return;
  disposeThumbnailRenderer(shared);
  shared = null;
}

function renderer() {
  clearTimeout(idle);
  if (shared) return shared;
  shared = createThumbnailRenderer(document.createElement("canvas"));
  return shared;
}

const failureText = (code) => (code === "empty" ? tr("У модели нет видимой геометрии.") : tr("В файле модели нет сцены."));

/** Снимок на холсте окна: рендерер общий, кадр читается `toBlob`. Нужен «tight» и всё, что поток не смог. */
async function shootOnWindow(url, finish, tight = false) {
  const mine = renderer();
  const { canvas, gl } = mine;
  let shot = null;
  try {
    shot = await shootModel(mine, url, finish, { tight, alive: () => shared === mine });
  } catch (error) {
    if (error instanceof ThumbnailFailure) throw new Error(failureText(error.code));
    throw error;
  }
  /* Холст снимков отпустили посреди сборки — дальше рисовать нечем. */
  if (!shot) throw new Error(tr("Кадр модели не снялся."));
  try {
    /* Картинка обвеса — без прозрачных полей, по центру рамки плитки: холст снимков общий, обрезанная копия — отдельный.
       Тело упёрлось в край (рамка модели соврала) — снимаем шире, один раз. */
    let framed = canvas;
    if (tight) {
      let trimmed = trimmedFrame(canvas);
      if (trimmed.clipped) {
        shot.camera.zoom *= 0.55;
        shot.camera.updateProjectionMatrix();
        gl.render(mine.scene, shot.camera);
        trimmed = trimmedFrame(canvas);
      }
      framed = trimmed.canvas;
    }
    const blob = await new Promise((resolve) => framed.toBlob(resolve, "image/webp", 0.86));
    if (!blob) throw new Error(tr("Кадр модели не снялся."));
    return blob;
  } finally {
    shot.release();
  }
}

/* --- Поток снимков --- */

/* `undefined` — ещё не пробовали, `false` — потока нет или он отказал в окружении. Тест подменяет `Worker` и `OffscreenCanvas` глобалями. */
let worker;
let workerId = 0;
const answers = new Map();
const WORKER_LIMIT_MS = 30_000;

function thumbnailWorker() {
  if (worker !== undefined) return worker;
  worker = false;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function" || /jsdom/i.test(globalThis.navigator?.userAgent || "")) return worker;
  try {
    const created = new Worker(new URL("./model-thumbnail-worker.js", import.meta.url), { type: "module" });
    created.onmessage = (event) => {
      const { id } = event.data || {};
      const answer = answers.get(id);
      if (!answer) return;
      answers.delete(id);
      clearTimeout(answer.timer);
      answer.resolve(event.data);
    };
    created.onerror = () => dropWorker();
    worker = created;
  } catch {
    worker = false;
  }
  return worker;
}

/* Поток сломался или завис: ответы, что не пришли, считаются отказом окружения, снимки идут на холсте окна. */
function dropWorker() {
  const current = worker;
  worker = false;
  if (current) {
    try {
      current.terminate();
    } catch {
      /* уже закрыт */
    }
  }
  for (const [id, answer] of answers) {
    clearTimeout(answer.timer);
    answer.resolve({ id, error: { kind: "engine", code: "worker", message: "поток снимков остановился" } });
  }
  answers.clear();
}

function ask(message) {
  const current = thumbnailWorker();
  if (!current) return Promise.resolve({ error: { kind: "engine", code: "none", message: "потока нет" } });
  const id = ++workerId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => dropWorker(), WORKER_LIMIT_MS);
    answers.set(id, { resolve, timer });
    try {
      current.postMessage({ ...message, id });
    } catch (error) {
      answers.delete(id);
      clearTimeout(timer);
      resolve({ id, error: { kind: "engine", code: "post", message: String(error?.message || error) } });
    }
  });
}

/**
 * Прогреть поток снимков: рендерер, отражение студии и программа простой ткани собираются заранее, чтобы первая плитка не платила за холодный старт. Звать в простое при входе в
 * мастерскую одежды; нет потока — ничего не делает (окно не греет свой холст: это тот же главный поток, который прогрев и бережёт).
 */
export function warmModelThumbnails(finish = "cloth") {
  if (!thumbnailWorker()) return Promise.resolve(false);
  return ask({ type: "warm", finish }).then((answer) => Boolean(answer?.ready));
}

/**
 * Снимок модели по адресу (blob: или http): WebP-картинка или отказ.
 * `finish` — отделка профиля студии: «metal» у ствола, «cloth» у одежды. `tight` — кадр по самой модели (картинки
 * обвесов, `thumbnail-fit.js`): вытянутая модель — на три четверти со стороны торца, камера вписана по проекции
 * рамки, прозрачные поля обрезаны, картинка 2:1 по центру рамки плитки с отступом.
 */
export async function renderModelThumbnail(url, { finish = "metal", tight = false } = {}) {
  if (!tight && thumbnailWorker()) {
    const answer = await ask({ type: "shoot", url, finish });
    if (answer.blob) return answer.blob;
    /* Беда в модели — отказ как у холста окна (те же слова); в окружении потока — снимаем здесь. */
    if (answer.error?.kind === "model") {
      if (answer.error.code === "load") throw new Error(answer.error.message);
      throw new Error(failureText(answer.error.code));
    }
    if (answer.error?.code === "engine") dropWorker();
  }
  busy += 1;
  try {
    return await shootOnWindow(url, finish, tight);
  } finally {
    busy -= 1;
    if (!busy) {
      clearTimeout(idle);
      idle = setTimeout(release, IDLE_MS);
    }
  }
}

/** Для проверки: снимок глазами окна и сброс потока. */
export const modelThumbnailInternals = {
  size: THUMBNAIL_SIZE,
  resetWorker() {
    dropWorker();
    worker = undefined;
  },
};

/* Очередь: модели снимаются по одной, иначе десяток плиток разом заняли бы
   холст и главный поток. */
let tail = Promise.resolve();
/*
 * Фоновые снимки уступают тому, что человек просил сам (22.10.2026, студия ствола: смена обвеса — «Загружаем
 * модель…» висит, пока плитки обвесов и «Моделей» читают игру тем же каналом Astral Desktop). Пока открыта задержка
 * (`holdThumbnails`), новые снимки не начинаются — чтение игры достаётся запросу человека; идущий снимок доделывается.
 * Задержка снимается сама через `HOLD_MAX_MS`: плитки не должны остаться без картинок, если загрузка так и не
 * закончилась.
 */
const HOLD_MAX_MS = 30_000;
let holds = 0;
let waiting = [];
const resumeIfFree = () => {
  if (holds) return;
  const wake = waiting;
  waiting = [];
  for (const resume of wake) resume();
};
/** Открыть задержку фоновых снимков; вернёт «отпустить» (можно звать много раз). */
export function holdThumbnails() {
  holds += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    holds -= 1;
    resumeIfFree();
  };
  const timer = setTimeout(release, HOLD_MAX_MS);
  return release;
}
const turn = () => (holds ? new Promise((resume) => waiting.push(resume)) : Promise.resolve());
/**
 * Сколько ещё человек работает с окном, мс (0 — тихо): готовые плитки выходят на экран в тишине, а не посреди прокрутки или мазка — перерисовка мастерской стоит десятки мс главного потока
 * (31.10.2026, прокрутка холодной полки при ×4: быстрые плитки ложили четыре-пять перерисовок в первую секунду прокрутки, худший кадр 150–190 мс против 120–140).
 */
export const thumbnailQuietIn = () => (holds ? 100 : Math.max(0, quietUntil - performance.now()));
/**
 * Дождаться, пока человек не ждёт свою модель (`holdThumbnails`), — без тишины на ввод. Чтению игры для первых плиток тишина не нужна: она уходит в Desktop и возвращается готовыми байтами, а главному
 * потоку стоит только разобрать ответ; тишина нужна рисованию и записи, они стоят за `queueModelThumbnail`.
 */
export const whenThumbnailsFree = () => turn();

/*
 * Снимки уступают человеку, который работает (31.10.2026, замер мастерской одежды на закрытой сборке ×4): ползунок кисти — шаг p95 765 мс, мазок — 773 мс, при том что сами они ~10 мс: между
 * шагами шли фоновые снимки плиток (расцветки надетой вещи, сетка слота), и один `toBlob` занимал до 250 мс главного потока, а вместе они — до 40 % времени. Новый снимок не начинается, пока
 * человек держит кнопку мыши на кадре или ползунке, жмёт клавишу, крутит колесо или щёлкнул недавно; идущий доделывается. Тишина настала — очередь идёт дальше: плитки не остаются
 * без картинок, пока человек просто смотрит. Мышь без нажатой кнопки «работой» не считается.
 *
 * Сколько ждать — по роду ввода (тот же день, замер холодной полки: щелчок по значку слота открывал полку, и первая плитка ждала ещё 600 мс тишины — больше половины её секунды при ×4):
 *   работа с кадром или ползунком (мышь на холсте, ползунке, палитре, поле) — `WORK_QUIET_MS` после отпускания: мазки идут один за другим, и снимок между ними ломает следующий;
 *   щелчок по кнопке — вкладке, значку слота, плитке, «Применить» — `NAV_QUIET_MS`: это не работа, а переход, после которого плитки и нужны;
 *   колесо — `WHEEL_QUIET_MS`, клавиша — `KEY_QUIET_MS`.
 * Снимки плиток теперь рисует поток (`model-thumbnail-worker.js`) и главный поток почти не занимают, поэтому ждать дольше не нужно.
 */
const WORK_QUIET_MS = 600;
const NAV_QUIET_MS = 120;
const WHEEL_QUIET_MS = 250;
const KEY_QUIET_MS = 150;
/* Кнопка зажата, а движения нет дольше этого — считаем, что отпускание потерялось (мышь ушла за окно). */
const HELD_MAX_MS = 1500;
let quietUntil = Number.NEGATIVE_INFINITY;
let listening = false;
const WORK_TARGET = "canvas, input, textarea, select, [role='slider'], [contenteditable='true']";
const NAV_TARGET = "button, a, [role='button'], [role='tab'], [role='radio'], [role='menuitem']";
const isNavigation = (target) => typeof target?.closest === "function" && !target.closest(WORK_TARGET) && Boolean(target.closest(NAV_TARGET));
function listenForInput() {
  if (listening || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  listening = true;
  const wait = (ms) => {
    quietUntil = Math.max(quietUntil, performance.now() + ms);
  };
  const touch = (event) => {
    if (event.type === "pointermove") {
      /* Движение без кнопки не работа; с кнопкой — идёт мазок или протяжка. */
      if (event.buttons) wait(HELD_MAX_MS);
      return;
    }
    if (event.type === "wheel") return wait(WHEEL_QUIET_MS);
    if (event.type === "keydown") return wait(KEY_QUIET_MS);
    const navigation = isNavigation(event.target);
    if (event.type === "pointerdown") return wait(navigation ? NAV_QUIET_MS : HELD_MAX_MS);
    /* pointerup: после работы с кадром — полная тишина, после щелчка по кнопке — короткая; держание кнопки закончилось, полуторасекундный запас сгорает. */
    quietUntil = performance.now() + (navigation ? NAV_QUIET_MS : WORK_QUIET_MS);
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "keydown", "wheel"]) window.addEventListener(type, touch, { passive: true, capture: true });
}
/* Слушаем с загрузки модуля: щелчок, после которого очередь только начнёт работу, тоже считается. */
listenForInput();
const quiet = () =>
  new Promise((resolve) => {
    const check = () => {
      const wait = quietUntil - performance.now();
      if (wait <= 0) resolve();
      else setTimeout(check, Math.min(wait, 200));
    };
    check();
  });

export function queueModelThumbnail(task) {
  const go = async () => {
    await turn();
    await quiet();
    return task();
  };
  const run = tail.then(go, go);
  tail = run.catch(() => {});
  return run;
}
